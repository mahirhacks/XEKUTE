"use strict";
const crypto = require("node:crypto");
const { createTask, receiveInput, normalizeRunControl } = require("./session-input.js");
const { createSessionSupervisor } = require("./session-supervisor.js");
const { routeSessionInput, stableTaskId } = require("./session-routing.js");
const { identifyToolCalls } = require("./tool-protocol.js");
const { referencedChatMessage } = require("./chat-references.js");

function memoryId(kind, seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return `${kind}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function unwrap(result) { return result?.ok ? { ...result, ...result.value } : result; }
function assignTaskWave(control, runId, value) {
  const owner = control.tasks.find((entry) => entry.runId === runId);
  if (!owner) return;
  owner.orchestrationWave = { runId, value };
  if (!control.ownerTaskId || control.ownerTaskId === owner.id) control.orchestrationWave = owner.orchestrationWave;
}
function createAgentSessionRuntime({ store, emit = () => {}, wake = () => {}, onDelivery = null, resolveChatReferences = () => "" } = {}) {
  const supervisor = createSessionSupervisor({ store, emit, resolveChatReferences });
  const loadChatReferenceSnapshot = (input) => resolveChatReferences.loadSnapshot(input);
  // Running tools listen here so an operator message can free the round while
  // they finish in the background.
  const inputWatchers = new Map();
  const sessionKey = (workspace, sessionId) => `${workspace}|${sessionId}`;
  async function receive({ workspace = "", sessionId, input, binding = null }) {
    const receipt = await supervisor.receive({ workspace, sessionId, input, binding });
    if (receipt.ok) {
      for (const notify of [...(inputWatchers.get(sessionKey(workspace, sessionId)) || [])]) notify();
      wake({ workspace, sessionId });
    }
    return unwrap(receipt);
  }
  async function admit({ workspace = "", sessionId, runId, blockId, taskId, userMessage, inputId, binding = {}, resume = false, snapshotWave = null, continuationResultId = "", completionBarrier = null }) {
    const originalText = userMessage;
    const receipt = await store.transactSession(workspace, sessionId, (document) => {
      const control = document.run_control = normalizeRunControl(document.run_control);
      let task = control.tasks.find((entry) => entry.id === taskId || entry.runId === runId);
      if (task && ((taskId && task.id !== taskId) || (runId && task.runId !== runId)
        || (!resume && ((userMessage !== undefined && task.objective !== userMessage) || (inputId && task.initialInputId !== inputId))))) return { ok: false, code: "SESSION_TASK_CONFLICT", error: "This task identity was already admitted for different work." };
      if (!task && resume) task = control.tasks.find((entry) => entry.id === control.activeTaskId);
      if (task && !["running", "waiting"].includes(task.status)) return { ok: false, code: "TASK_ALREADY_TERMINAL", error: "This task has already ended." };
      let fresh = false;
      if (!task) {
        if (control.tasks.some((entry) => entry.kind === "primary" && ["running", "waiting"].includes(entry.status))) return { ok: false, code: "PRIMARY_TASK_BUSY", error: "The session already has a running task. Submit input to its supervisor." };
        task = createTask({ taskId: taskId || stableTaskId(sessionId, runId), runId, objective: userMessage, binding, kind: "primary",
          blockId: blockId || memoryId("block", `${sessionId}|${runId}`) });
        control.tasks.push(task); control.activeTaskId = task.id; fresh = true;
        const sourceId = inputId || `initial:${runId}`;
        const existingInput = control.inputs.find((input) => input.id === sourceId);
        if (existingInput && existingInput.text !== originalText) return { ok: false, code: "MESSAGE_ID_CONFLICT", error: "The initial input identity has different text." };
        if (sourceId && !existingInput) receiveInput(control, { id: sourceId, text: originalText, targetTaskId: task.id,
          contextText: resolveChatReferences({ workspace, sessionId, text: originalText }) });
        task.initialInputId = sourceId;
      }
      if (!task.blockId) task.blockId = blockId || memoryId("block", `${sessionId}|${task.runId}`);
      let block = document.blocks.find((entry) => entry.block_id === task.blockId);
      if (!block) {
        block = { block_id: task.blockId, user_prompt: task.objective, messages: [], outcome: "running" };
        document.blocks.push(block);
      }
      if (task.initialInputId && !block.messages.some((message) => message.source_message_id === task.initialInputId) && fresh) {
        const initial = control.inputs.find((input) => input.id === task.initialInputId);
        block.messages = [{ role: "user", ...referencedChatMessage(originalText, initial?.contextText), source_message_id: task.initialInputId, task_id: task.id, task_revision: 0 }];
      }
      if (fresh) {
        const previous = control.tasks.find((entry) => entry.id === control.ownerTaskId) || control.tasks.find((entry) => entry.runId === control.orchestrationWave?.runId);
        if (previous && control.orchestrationWave?.runId === previous.runId) previous.orchestrationWave = control.orchestrationWave;
        control.ownerTaskId = task.id;
        control.orchestrationWave = task.orchestrationWave || null;
      }
      return { ok: true, value: { task, fresh, messages: block.messages, history: document.blocks.flatMap((entry) => entry.messages || []) } };
    }, { create: true });
    if (!receipt.ok) return receipt;
    const { task, messages, history } = receipt.value;
    const location = { workspace, sessionId, taskId: task.id };
    let appliedRevision = task.appliedRevision;
    let finalReceipt = null;
    const emittedInputs = new Set();
    const prefix = messages.map((message) => ({ ...message }));
    const transcript = (delta, engineSnapshot) => {
      const inputs = new Map((engineSnapshot?.inputMessages || []).filter((message) => message.reference_prepared && message.source_message_id).map((message) => [message.source_message_id, message]));
      return [...prefix.map((message) => inputs.has(message.source_message_id) ? { ...message, ...inputs.get(message.source_message_id) } : message),
        ...(delta || []).map((message) => ({ ...message, task_id: task.id }))];
    };
    const waveMutation = (acceptedResultId = "") => snapshotWave ? (control) => { assignTaskWave(control, task.runId, snapshotWave({ acceptedResultId })); } : null;
    async function deliverPending(snapshot) {
      if (!onDelivery) return;
      for (const target of snapshot.control.tasks.filter((entry) => entry.kind === "dependent" && ["running", "waiting"].includes(entry.status))) {
        for (const delivery of target.deliveries.filter((entry) => entry.revision > target.appliedRevision)) {
          await onDelivery({ workspace, sessionId, target, delivery, input: snapshot.control.inputs.find((entry) => entry.id === delivery.messageId) });
        }
      }
    }
    const liveInput = {
      loadChatReferenceSnapshot: (snapshotId) => loadChatReferenceSnapshot({ workspace, snapshotId }),
      watchInput() {
        const key = sessionKey(workspace, sessionId);
        let notify;
        const arrived = new Promise((resolve) => { notify = resolve; });
        if (!inputWatchers.has(key)) inputWatchers.set(key, new Set());
        inputWatchers.get(key).add(notify);
        const unread = supervisor.snapshot(location);
        if (unread.ok && unread.batch.some((input) => !input.id.startsWith("result:"))) notify();
        return { arrived, stop() {
          inputWatchers.get(key)?.delete(notify);
          if (!inputWatchers.get(key)?.size) inputWatchers.delete(key);
        } };
      },
      // A tool or command that finished after its round moved on reports here.
      // It reaches the task at its next boundary, waking it if it is parked.
      async deliverResult({ id, text }) {
        const receipt = await supervisor.receive({ workspace, sessionId, input: { id, text, targetTaskId: task.id } });
        if (receipt.ok) wake({ workspace, sessionId });
        return unwrap(receipt);
      },
      async boundary({ revision }) {
        let snapshot = supervisor.snapshot(location);
        if (!snapshot.ok) return snapshot;
        await deliverPending(snapshot);
        let current = snapshot.control.tasks.find((entry) => entry.id === task.id);
        if (!current || !["running", "waiting"].includes(current.status)) return { ok: false, code: "TASK_STOPPED", error: "The task was stopped.", aborted: true };
        if (snapshot.batch.length && current.kind === "primary" && !current.pendingPlan) {
          const proposal = routeSessionInput({ ...snapshot, planningTaskId: task.id });
          if (!proposal.ok) return proposal;
          let accepted = await supervisor.acceptRouting({ ...location, expectedRouted: snapshot.control.routed,
            cancellationEpoch: snapshot.control.cancellationEpoch, planningTaskId: task.id, ...proposal });
          if (!accepted.ok && accepted.code === "ROUTING_SNAPSHOT_STALE") {
            const fresh = supervisor.snapshot(location);
            if (!fresh.ok) return fresh;
            const retry = routeSessionInput({ ...fresh, planningTaskId: task.id });
            if (!retry.ok) return retry;
            accepted = await supervisor.acceptRouting({ ...location, expectedRouted: fresh.control.routed,
              cancellationEpoch: fresh.control.cancellationEpoch, planningTaskId: task.id, ...retry });
          }
          if (!accepted.ok) return accepted;
          snapshot = supervisor.snapshot(location);
          if (!snapshot.ok) return snapshot;
          await deliverPending(snapshot);
          current = snapshot.control.tasks.find((entry) => entry.id === task.id);
        }
        const pendingExecution = current.pendingExecution;
        const hasUnreadInput = snapshot.batch.length > 0;
        const executionWatermark = pendingExecution?.inputWatermark;
        const executionSuperseded = pendingExecution && (pendingExecution.revision !== current.revision
          || (Number.isSafeInteger(executionWatermark) ? snapshot.control.arrival > executionWatermark : hasUnreadInput));
        if (executionSuperseded) {
          const discarded = await store.transactSession(workspace, sessionId, (document) => {
            const control = document.run_control = normalizeRunControl(document.run_control);
            const owner = control.tasks.find((entry) => entry.id === task.id);
            const plan = owner?.pendingExecution;
            if (!plan || plan.id !== pendingExecution.id) return { ok: true, write: false };
            const unread = control.arrival > control.routed;
            const stale = plan.revision !== owner.revision
              || (Number.isSafeInteger(plan.inputWatermark) ? control.arrival > plan.inputWatermark : unread);
            if (stale) delete owner.pendingExecution;
            return { ok: true, write: stale };
          });
          if (!discarded.ok) return discarded;
          snapshot = supervisor.snapshot(location);
          if (!snapshot.ok) return snapshot;
          current = snapshot.control.tasks.find((entry) => entry.id === task.id);
        }
        if (current.pendingExecution && current.pendingExecution.revision === revision && current.appliedRevision === revision
          && !(snapshot.control.arrival > (current.pendingExecution.inputWatermark ?? snapshot.control.arrival))) return { ok: true, revision,
          arrival: snapshot.control.arrival, cancellationEpoch: snapshot.control.cancellationEpoch, deliveries: [], pendingPlan: current.pendingExecution };
        const inputs = new Map(snapshot.control.inputs.map((input) => [input.id, input]));
        return { ok: true, revision: current.revision, arrival: snapshot.control.arrival, cancellationEpoch: snapshot.control.cancellationEpoch,
          deliveries: current.deliveries.filter((delivery) => delivery.revision > revision).map((delivery) => ({ id: delivery.messageId, text: inputs.get(delivery.messageId).text, contextText: inputs.get(delivery.messageId).contextText, revision: delivery.revision,
            intentScope: delivery.intentScope })),
          pendingPlan: current.pendingPlan || null };
      },
      async prepareRound({ revision, result, engineSnapshot, inputWatermark }) {
        const receipt = await store.transactSession(workspace, sessionId, (document) => {
          const control = document.run_control = normalizeRunControl(document.run_control);
          const owner = document.run_control.tasks.find((entry) => entry.id === task.id);
          const expectedArrival = Number.isSafeInteger(inputWatermark) ? inputWatermark : control.arrival;
          if (control.arrival !== expectedArrival || control.arrival !== control.routed) return { ok: false, code: "TASK_INPUT_PENDING", error: "New session input arrived before this execution round could be persisted." };
          if (!owner || !["running", "waiting"].includes(owner.status) || owner.appliedRevision !== revision || owner.revision !== revision) return { ok: false, code: "TASK_REVISION_STALE", error: "The task cannot persist this execution round." };
          if (owner.pendingExecution) return { ok: false, code: "EXECUTION_ROUND_PENDING", error: "A previous execution round must be reconciled first." };
          const id = `execution:${crypto.randomUUID()}`;
          const plan = { id, taskId: task.id, revision, inputWatermark: expectedArrival, result: identifyToolCalls(result, id), accounting: engineSnapshot.accounting };
          owner.engine = engineSnapshot; owner.pendingExecution = plan;
          return { ok: true, value: plan };
        });
        return receipt.ok ? { ...receipt, plan: receipt.value } : receipt;
      },
      async checkpoint({ revision, previousRevision, appendedMessages, engineSnapshot, consumedPlanId, allowStopped, mutation = null }) {
        const result = await supervisor.checkpointTask({ ...location, expectedRevision: revision, previousRevision: previousRevision ?? appliedRevision,
          engine: engineSnapshot, messages: transcript(appendedMessages, engineSnapshot), consumedPlanId, allowStopped, mutation });
        if (result.ok) {
          appliedRevision = revision;
          const appliedIds = new Set(engineSnapshot?.appliedInputIds || []);
          const appliedDeliveries = supervisor.taskSnapshot(location).task?.deliveries.filter((delivery) => delivery.revision <= revision && appliedIds.has(delivery.messageId)) || [];
          for (const message of [...(appendedMessages || []), ...appliedDeliveries.map((delivery) => ({ source_message_id: delivery.messageId, task_revision: delivery.revision }))]) if (message.source_message_id && !emittedInputs.has(message.source_message_id)) {
            emittedInputs.add(message.source_message_id);
            emit({ type: "input_applied", sessionId, taskId: task.id, messageId: message.source_message_id, revision: message.task_revision });
          }
        }
        return unwrap(result);
      },
      async finalize({ revision, cancellationEpoch, appendedMessages, engineSnapshot, status }) {
        const saved = await liveInput.checkpoint({ revision, appendedMessages, engineSnapshot: { ...engineSnapshot, pendingCompletion: { revision, status } } });
        if (!saved.ok) return saved;
        const result = await supervisor.tryFinalize({ ...location, expectedRevision: revision, cancellationEpoch, status, messages: transcript(appendedMessages, engineSnapshot), mutation: waveMutation(continuationResultId), completionBarrier });
        if (result.ok && result.value?.terminal) finalReceipt = result;
        return unwrap(result);
      },
    };
    return { ...receipt, ...receipt.value, taskId: task.id, runId: task.runId, blockId: task.blockId,
      initialInputId: task.initialInputId, engineSnapshot: task.engine, chatHistory: history, liveInput, getFinalReceipt: () => finalReceipt,
      async settle(result) {
        if (finalReceipt) return finalReceipt;
        const current = supervisor.taskSnapshot(location);
        if (!current.ok) return current;
        const snapshot = result.engineSnapshot || current.task.engine;
        const accepted = result.ok && !result.aborted && !["failed", "stopped", "inconclusive"].includes(result.runState?.status);
        const saved = await liveInput.checkpoint({ revision: snapshot?.revision ?? appliedRevision, appendedMessages: result.appendedMessages, engineSnapshot: snapshot, allowStopped: result.aborted, mutation: waveMutation(accepted ? continuationResultId : "") });
        if (!saved.ok) return saved;
        if (result.aborted) return supervisor.cancel({ ...location, taskId: task.id });
        if (!result.ok || result.runState?.status === "inconclusive") return supervisor.tryFinalize({ ...location, expectedRevision: appliedRevision,
          cancellationEpoch: supervisor.snapshot(location).control?.cancellationEpoch, status: result.runState?.status === "inconclusive" ? "inconclusive" : "failed" });
        return saved;
      },
      async execute(request, execute) {
        const call = request.toolCall;
        let operationId;
        if (!call?.id && !call?.callId) return { ok: false, errorCode: "OPERATION_ID_REQUIRED", error: "A stable tool call ID is required for supervised execution." };
        const signature = crypto.createHash("sha256").update(JSON.stringify(call)).digest("hex");
        const prepared = await store.transactSession(workspace, sessionId, (document) => {
          const control = document.run_control = normalizeRunControl(document.run_control);
          const owner = control.tasks.find((entry) => entry.id === task.id);
          if (!owner || !["running", "waiting"].includes(owner.status)
            || (request.taskRevision !== undefined && (owner.appliedRevision !== request.taskRevision || owner.revision !== request.taskRevision))
            || (Number.isSafeInteger(request.inputWatermark) && control.arrival > request.inputWatermark)) return { ok: false, code: "TOOL_TASK_STALE", error: "The task no longer owns this tool round." };
          operationId = `${task.runId}:${owner.pendingExecution?.id || owner.pendingPlan?.id || `revision:${owner.appliedRevision}`}:${call.id || call.callId}`;
          owner.operations ||= [];
          const prior = owner.operations.find((operation) => operation.id === operationId);
          if (prior) {
            if (prior.signature !== signature) return { ok: false, code: "OPERATION_ID_CONFLICT", error: "The tool call ID already belongs to another operation." };
            return { ok: true, write: false, value: prior };
          }
          const operation = { id: operationId, signature, status: "pending", revision: owner.appliedRevision, toolName: call.function?.name || call.toolName };
          owner.operations.push(operation);
          return { ok: true, value: { ...operation, fresh: true } };
        });
        if (!prepared.ok) return { ok: false, errorCode: prepared.code, error: prepared.error, retryable: false };
        if (prepared.value.status === "completed") return prepared.value.result;
        if (!prepared.value.fresh) return { ok: false, errorCode: "ACTION_OUTCOME_UNKNOWN", error: "This operation may already have run. Inspect its files or process handle before choosing a new action.", operationId, retryable: false };
        let outcome;
        try { outcome = await execute({ ...request, operationId }); }
        catch (error) { outcome = { ok: false, error: error.message, errorCode: error.code || "TOOL_EXECUTION_FAILED" }; }
        const completed = await store.transactSession(workspace, sessionId, (document) => {
          const operation = document.run_control.tasks.find((entry) => entry.id === task.id)?.operations?.find((entry) => entry.id === operationId);
          if (!operation || operation.signature !== signature) return { ok: false, code: "OPERATION_STALE", error: "The operation receipt changed." };
          operation.status = "completed"; operation.result = outcome;
          return { ok: true };
        });
        return completed.ok ? outcome : { ok: false, errorCode: "ACTION_OUTCOME_UNKNOWN", error: "The tool ran but its outcome could not be stored. Reconcile the operation before retrying.", operationId, retryable: false };
      } };
  }
  return { admit, receive, supervisor, loadChatReferenceSnapshot, cancel: (input) => supervisor.cancel(input) };
}
module.exports = { createAgentSessionRuntime, memoryId, assignTaskWave };
