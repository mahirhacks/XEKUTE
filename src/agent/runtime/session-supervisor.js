"use strict";
const { normalizeRunControl, receiveInput, createTask, acceptRoutes } = require("./session-input.js");

function failure(error) { return { ok: false, code: error.code || "SESSION_CONTROL_FAILED", error: error.message || String(error) }; }
function createSessionSupervisor({ store, now = () => new Date().toISOString(), emit = () => {}, resolveChatReferences = () => "" } = {}) {
  if (!store?.transactSession || !store?.readControl) throw new TypeError("A transactional encrypted session store is required.");
  async function transact(workspace, sessionId, mutation, options) {
    try {
      return await store.transactSession(workspace, sessionId, (document) => {
        document.run_control = normalizeRunControl(document.run_control);
        return mutation(document.run_control, document);
      }, options);
    } catch (error) { return failure(error); }
  }
  function snapshot({ workspace = "", sessionId }) {
    try {
      const result = store.readControl(workspace, sessionId);
      if (!result?.ok) return result || { ok: false, code: "SESSION_READ_FAILED", error: "The session could not be read." };
      if (!result.exists) return { ok: false, code: "SESSION_NOT_FOUND", error: "The session does not exist." };
      if (!result.encrypted || result.durable !== true) return { ok: false, code: "SESSION_NOT_DURABLE", error: "The session is not stored durably in encrypted storage." };
      const control = normalizeRunControl(result.control);
      return { ok: true, control, batch: control.inputs.slice(control.routed), taskRevisions: Object.fromEntries(control.tasks.map((task) => [task.id, task.revision])) };
    } catch (error) { return failure(error); }
  }
  async function receive({ workspace = "", sessionId, input, binding = null }) {
    const result = await transact(workspace, sessionId, (control) => {
      if (input?.targetTaskId && !control.tasks.some((task) => task.id === input.targetTaskId && ["running", "waiting"].includes(task.status))
        && !control.inputs.some((entry) => entry.id === input.id)) return { ok: false, code: "INPUT_TARGET_UNAVAILABLE", error: "The selected task has already ended or does not exist." };
      const existing = control.inputs.some((entry) => entry.id === input?.id);
      const receipt = receiveInput(control, existing ? input : { ...input, contextText: resolveChatReferences({ workspace, sessionId, text: input?.text }) }, now());
      if (!receipt.duplicate && binding && !input.targetTaskId && !control.tasks.some((task) => task.kind === "primary" && ["running", "waiting"].includes(task.status))) control.intakeBinding = createTask({ binding }).binding;
      return { ok: true, value: receipt, write: !receipt.duplicate };
    }, { create: true });
    if (result?.ok) emit({ type: "input_received", sessionId, ...result.value });
    return result;
  }
  async function startTask({ workspace = "", sessionId, task: suppliedTask }) {
    return transact(workspace, sessionId, (control) => {
      const existing = control.tasks.find((task) => task.id === suppliedTask.taskId || task.runId === suppliedTask.runId);
      if (existing) {
        if (existing.id !== suppliedTask.taskId || existing.runId !== suppliedTask.runId || (suppliedTask.objective !== undefined && existing.objective !== suppliedTask.objective)
          || (suppliedTask.kind !== undefined && existing.kind !== suppliedTask.kind) || (suppliedTask.blockId !== undefined && existing.blockId !== suppliedTask.blockId)) return { ok: false, code: "SESSION_TASK_CONFLICT", error: "The task identity was already used for different work." };
        return { ok: true, value: existing, write: false };
      }
      const task = createTask(suppliedTask);
      if (task.kind === "primary" && control.tasks.some((entry) => entry.kind === "primary" && ["running", "waiting"].includes(entry.status))) return { ok: false, code: "PRIMARY_TASK_BUSY", error: "The session already has a running main task." };
      control.tasks.push(task);
      if (task.kind === "primary") control.activeTaskId = task.id;
      return { ok: true, value: task };
    }, { create: true });
  }
  async function acceptRouting({ workspace = "", sessionId, ...proposal }) {
    const result = await transact(workspace, sessionId, (control) => ({ ok: true, value: acceptRoutes(control, proposal) }));
    if (result?.ok) for (const delivery of result.value.deliveries) emit({ type: delivery.method === "cancelled" ? "input_cancelled" : "input_accepted", sessionId, ...delivery,
      taskIds: result.value.deliveries.filter((entry) => entry.messageId === delivery.messageId).map((entry) => entry.taskId) });
    return result;
  }
  function taskSnapshot({ workspace = "", sessionId, taskId }) {
    const result = snapshot({ workspace, sessionId });
    if (!result.ok) return result;
    const task = result.control.tasks.find((entry) => entry.id === taskId);
    if (!task) return { ok: false, code: "TASK_NOT_FOUND", error: "The task does not exist." };
    return { ok: true, task, cancellationEpoch: result.control.cancellationEpoch, deliveries: task.deliveries.filter((delivery) => delivery.revision > task.appliedRevision).map((delivery) => ({ ...delivery, input: result.control.inputs.find((entry) => entry.id === delivery.messageId) })) };
  }
  async function checkpointTask({ workspace = "", sessionId, taskId, expectedRevision, previousRevision = expectedRevision, engine, messages, blockId, consumedPlanId = "", allowStopped = false, mutation = null }) {
    return transact(workspace, sessionId, (control, document) => {
      const task = control.tasks.find((entry) => entry.id === taskId);
      if (!task || task.appliedRevision !== previousRevision || expectedRevision < previousRevision || expectedRevision > task.revision
        || (!["running", "waiting"].includes(task.status) && !(allowStopped && task.status === "stopped" && expectedRevision === previousRevision))) return { ok: false, code: "TASK_REVISION_STALE", error: "The applied task revision changed before its checkpoint could be stored." };
      if (blockId && blockId !== task.blockId) return { ok: false, code: "TASK_BLOCK_MISMATCH", error: "The checkpoint cannot replace another task's transcript." };
      task.appliedRevision = expectedRevision;
      task.engine = engine;
      if (consumedPlanId && task.pendingPlan?.id === consumedPlanId) delete task.pendingPlan;
      if (consumedPlanId && task.pendingExecution?.id === consumedPlanId) delete task.pendingExecution;
      if (messages) {
        const block = document.blocks.find((entry) => entry.block_id === (blockId || task.blockId));
        if (!block) return { ok: false, code: "MEMORY_BLOCK_NOT_FOUND", error: "The task's transcript block does not exist." };
        block.messages = messages;
      }
      if (mutation) mutation(control, document, task);
      return { ok: true, value: { taskId, revision: task.revision } };
    });
  }
  async function tryFinalize({ workspace = "", sessionId, taskId, expectedRevision, cancellationEpoch, status = "completed", messages, blockId, mutation = null, completionBarrier = null }) {
    return transact(workspace, sessionId, (control, document) => {
      const task = control.tasks.find((entry) => entry.id === taskId);
      if (!task || (status === "completed" ? task.revision !== expectedRevision || task.appliedRevision !== task.revision : task.appliedRevision !== expectedRevision)
        || control.cancellationEpoch !== cancellationEpoch) return { ok: false, code: "FINALIZATION_STALE", error: "The task changed before completion." };
      if (blockId && blockId !== task.blockId) return { ok: false, code: "TASK_BLOCK_MISMATCH", error: "Completion cannot replace another task's transcript." };
      if (["completed", "stopped", "failed", "inconclusive"].includes(task.status)) {
        if (task.status !== status) return { ok: false, code: "TERMINAL_STATUS_CONFLICT", error: "The task already ended with a different outcome." };
        return { ok: true, write: false, value: { completed: status === "completed", terminal: true, status: task.status, duplicate: true, taskId, revision: task.revision } };
      }
      if (status === "completed" && control.arrival !== control.routed) return { ok: true, write: false, value: { completed: false, reason: "PENDING_INPUT" } };
      if (status === "completed" && completionBarrier?.()) return { ok: true, write: false, value: { completed: false, reason: "PENDING_DEPENDENCIES" } };
      if (control.tasks.some((entry) => entry.dependencyOfTaskId === taskId && !["completed", "stopped", "failed", "inconclusive"].includes(entry.status))) return { ok: true, write: false, value: { completed: false, reason: "PENDING_DEPENDENCIES" } };
      if (!["completed", "stopped", "failed", "inconclusive"].includes(status)) return { ok: false, code: "TASK_STATUS_INVALID", error: "A terminal task status is required." };
      if (messages) {
        const block = document.blocks.find((entry) => entry.block_id === (blockId || task.blockId));
        if (!block) return { ok: false, code: "MEMORY_BLOCK_NOT_FOUND", error: "The task's transcript block does not exist." };
        block.messages = messages;
        block.outcome = status;
        block.completed_at = now();
      }
      task.status = status;
      if (mutation) mutation(control, document, task);
      delete task.pendingPlan;
      delete task.pendingExecution;
      task.completionIntent = { revision: task.revision, committedAt: now() };
      if (control.activeTaskId === taskId) control.activeTaskId = "";
      const dispatch = control.dispatches.find((entry) => entry.taskId === taskId);
      if (dispatch) dispatch.status = status === "completed" ? "completed" : "failed";
      return { ok: true, value: { completed: status === "completed", terminal: true, status, taskId, revision: task.revision } };
    });
  }
  async function cancel({ workspace = "", sessionId, taskId = "", scope = "task" }) {
    if (!["task", "session"].includes(scope) || (!taskId && scope !== "session")) return { ok: false, code: "CANCELLATION_SCOPE_INVALID", error: "Choose a task or the whole session to stop." };
    return transact(workspace, sessionId, (control) => {
      const owned = new Set([taskId]);
      for (let pass = 0; pass < control.tasks.length; pass += 1) {
        let changed = false;
        for (const task of control.tasks) if (owned.has(task.dependencyOfTaskId) && !owned.has(task.id)) { owned.add(task.id); changed = true; }
        if (!changed) break;
      }
      const tasks = control.tasks.filter((entry) => ["running", "waiting"].includes(entry.status) && (scope === "session" || owned.has(entry.id)));
      if (tasks.length) control.cancellationEpoch += 1;
      for (const task of tasks) {
        task.status = "stopped";
        task.completionIntent = null;
        delete task.pendingPlan;
        for (const dispatch of control.dispatches) if (dispatch.taskId === task.id && ["pending", "running", "waiting"].includes(dispatch.status)) { dispatch.status = "failed"; dispatch.errorCode = "TASK_STOPPED"; }
        if (control.activeTaskId === task.id) control.activeTaskId = "";
      }
      return { ok: true, write: tasks.length > 0, value: { taskIds: tasks.map((task) => task.id), cancellationEpoch: control.cancellationEpoch } };
    });
  }
  return Object.freeze({ receive, snapshot, startTask, acceptRouting, taskSnapshot, checkpointTask, tryFinalize, cancel });
}
module.exports = { createSessionSupervisor };
