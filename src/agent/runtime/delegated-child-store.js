"use strict";

const crypto = require("node:crypto");
const { createTask, receiveInput, acceptRoutes } = require("./session-input.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function requireReceipt(receipt) {
  if (receipt?.ok !== true || receipt.encrypted !== true || receipt.durable !== true) {
    throw Object.assign(new Error(receipt?.error || "The child checkpoint has no encrypted durable receipt."), { code: receipt?.code || "CHILD_DURABILITY_REQUIRED" });
  }
  return receipt;
}

function createDelegatedChildStore({ v3SessionStore } = {}) {
  if (typeof v3SessionStore?.transactSession !== "function") throw new TypeError("v3SessionStore.transactSession is required");

  async function checkpointChild({ workspace = "", childSessionId, childInvocationId, parentSessionId = "", blockId = "", runId,
    originalGoal, input = null, binding = {}, generation = 1, operation = "spawn", engineSnapshot = null,
    prefixMessages = [], appendedMessages = [], effect = null } = {}) {
    if (!childSessionId || !childInvocationId || !runId || typeof originalGoal !== "string") throw Object.assign(new Error("A stable child identity and original goal are required."), { code: "CHILD_IDENTITY_REQUIRED" });
    const taskId = `delegated:${digest(`${childInvocationId}|${runId}`).slice(0, 40)}`;
    const savedBlockId = /^block_[a-z0-9._:-]{8,240}$/i.test(blockId) ? blockId : `block_${digest(`${childInvocationId}|${runId}`)}`;
    const receipt = await v3SessionStore.transactSession(workspace, childSessionId, (document) => {
      const state = document.run_control;
      let task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        if (state.tasks.some((entry) => entry.blockId === savedBlockId || entry.runId === runId)) return { ok: false, code: "CHILD_IDENTITY_CONFLICT", error: "The child transcript belongs to another engine." };
        task = createTask({ taskId, runId, objective: originalGoal, binding, blockId: savedBlockId });
        task.childRun = { childInvocationId, parentSessionId, generation, operation, input: clone(input || { task: originalGoal, contextPackage: {}, expectedOutput: {} }) };
        state.tasks.push(task);
        state.activeTaskId = task.id;
      }
      if (task.runId !== runId || task.objective !== originalGoal || task.childRun?.childInvocationId !== childInvocationId) return { ok: false, code: "CHILD_IDENTITY_CONFLICT", error: "The checkpoint does not match the child's original task." };
      if (engineSnapshot) {
        if (engineSnapshot.runId !== runId || !Number.isSafeInteger(engineSnapshot.revision) || engineSnapshot.revision < task.appliedRevision) return { ok: false, code: "CHILD_CHECKPOINT_STALE", error: "The child checkpoint belongs to an obsolete engine." };
        const status = String(engineSnapshot.runState?.status || "running");
        task.status = ["running", "waiting", "completed", "stopped", "failed", "inconclusive"].includes(status) ? status : "running";
        const fresh = (engineSnapshot.inputMessages || []).filter((message) => Number.isSafeInteger(message.task_revision) && message.task_revision > task.revision)
          .sort((left, right) => left.task_revision - right.task_revision);
        for (const message of fresh) {
          if (message.task_revision !== task.revision + 1 || !message.source_message_id) return { ok: false, code: "CHILD_DELIVERY_INVALID", error: "The child checkpoint skipped a steering revision." };
          const priorRouted = state.routed;
          receiveInput(state, { id: message.source_message_id, text: message.source_text || message.content,
            ...(message.source_text ? { contextText: message.reference_context || message.content.slice(message.source_text.length) } : {}), targetTaskId: task.id });
          acceptRoutes(state, { expectedRouted: priorRouted, cancellationEpoch: state.cancellationEpoch,
            routes: [{ messageId: message.source_message_id, taskId: task.id, expectedRevision: task.revision, method: "explicit" }] });
        }
        if (task.revision !== engineSnapshot.revision) return { ok: false, code: "CHILD_DELIVERY_INVALID", error: "The child revision has no matching original input." };
        task.appliedRevision = engineSnapshot.revision;
        task.engine = clone(engineSnapshot);
        state.activeTaskId = ["running", "waiting"].includes(task.status) ? task.id : "";
      }
      if (effect) {
        if (typeof effect.id !== "string" || !effect.id || !["started", "completed"].includes(effect.status)) return { ok: false, code: "CHILD_EFFECT_INVALID", error: "A tool effect must have a stable identity and status." };
        task.childRun.effects ||= [];
        const prior = task.childRun.effects.find((entry) => entry.id === effect.id);
        if (prior?.status === "completed" && effect.status === "started") return { ok: false, code: "CHILD_EFFECT_REPLAY", error: "A completed child effect cannot be started again." };
        if (prior?.signature && effect.signature !== prior.signature) return { ok: false, code: "CHILD_EFFECT_CONFLICT", error: "The effect identity belongs to another tool call." };
        const savedEffect = clone(effect);
        if (prior) Object.assign(prior, savedEffect);
        else task.childRun.effects.push(savedEffect);
        const currentRound = task.engine?.pendingPlan?.id;
        task.childRun.effects = [...task.childRun.effects.filter((entry) => entry.status !== "completed" || (currentRound && entry.roundId === currentRound)),
          ...task.childRun.effects.filter((entry) => entry.status === "completed" && entry.roundId !== currentRound).slice(-128)];
      }
      let block = document.blocks.find((entry) => entry.block_id === savedBlockId);
      if (!block) { block = { block_id: savedBlockId, user_prompt: originalGoal, messages: [], outcome: "pending" }; document.blocks.push(block); }
      const initialId = `${runId}:initial`;
      const initial = { id: `event_${digest(initialId)}`, role: "user", content: originalGoal, source_message_id: initialId, task_id: taskId, task_revision: 0 };
      const prefix = clone(prefixMessages);
      if (!prefix.some((message) => message.source_message_id === initialId || (message.role === "user" && message.content === originalGoal))) prefix.unshift(initial);
      block.messages = [...prefix, ...clone(appendedMessages)].map((message) => ({ ...message, task_id: taskId }));
      block.user_prompt_id = block.messages.find((message) => message.role === "user" && message.content === originalGoal)?.id || initial.id;
      block.outcome = task.status;
      const engineRef = { version: 1, sessionId: document.session_id, taskId, runId, blockId: savedBlockId, generation, operation,
        revision: task.appliedRevision, sourceMessageIds: [...(task.engine?.appliedInputIds || [])], pendingCompletion: Boolean(task.engine?.pendingCompletion) };
      return { ok: true, value: { engineRef } };
    }, { create: true, requireDurable: true });
    return requireReceipt(receipt);
  }

  async function loadChild({ workspace = "", engineRef } = {}) {
    if (engineRef?.version !== 1 || !engineRef.sessionId || !engineRef.taskId || !engineRef.runId) throw Object.assign(new Error("A durable child engine reference is required."), { code: "CHILD_REFERENCE_REQUIRED" });
    const receipt = await v3SessionStore.transactSession(workspace, engineRef.sessionId, (document) => {
      const task = document.run_control.tasks.find((entry) => entry.id === engineRef.taskId);
      const block = document.blocks.find((entry) => entry.block_id === engineRef.blockId);
      if (!task || !block || task.runId !== engineRef.runId || task.blockId !== engineRef.blockId || !task.childRun) return { ok: false, code: "CHILD_REFERENCE_INVALID", error: "The saved child engine does not match its transcript." };
      return { ok: true, write: false, value: { originalGoal: task.objective, binding: clone(task.binding),
        engineSnapshot: task.engine ? clone(task.engine) : null, status: task.status,
        history: document.blocks.flatMap((entry) => clone(entry.messages || [])), prefixMessages: clone(block.messages),
        input: clone(task.childRun.input), childInvocationId: task.childRun.childInvocationId,
        pendingEffects: clone((task.childRun.effects || []).filter((entry) => entry.status !== "completed")),
        completedEffects: clone((task.childRun.effects || []).filter((entry) => entry.status === "completed")),
        parentSessionId: task.childRun.parentSessionId, generation: task.childRun.generation, operation: task.childRun.operation, engineRef: clone(engineRef) } };
    }, { requireDurable: true });
    return requireReceipt(receipt);
  }

  return Object.freeze({ checkpointChild, loadChild });
}

module.exports = { createDelegatedChildStore, requireReceipt };
