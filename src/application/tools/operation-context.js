"use strict";

const { createExecutionContext, id } = require("../../contracts/tool/execution-context");

const TERMINAL_STATES = new Set(["success", "partial", "denied", "failed", "unavailable", "cancelled"]);
const NON_TERMINAL_STATES = new Set(["awaiting_approval", "approved", "dispatching", "running", "checkpointed", "awaiting_decision"]);

function createOperationContext({
  operationId = id("operation"),
  auditId = id("audit"),
  actorId = "agent",
  profile = "agent",
  toolName = "",
  input = {},
  target = "",
  category = "",
  workspace = "",
  model = "",
  deadline = null,
  abortSignal = null,
  scopeDecision = null,
  auditSink = null,
  stateSink = null,
} = {}) {
  const createdAt = new Date().toISOString();
  const state = {
    operationId: String(operationId),
    auditId: String(auditId),
    actorId: String(actorId || "agent"),
    profile: String(profile || "agent"),
    toolName: String(toolName || ""),
    target: String(target || ""),
    category: String(category || ""),
    workspace: String(workspace || ""),
    input: JSON.parse(JSON.stringify(input || {})),
    status: "created",
    audit: [],
    evidenceRefs: [],
    cleanup: { attempted: false, completed: false, error: "" },
    createdAt,
    updatedAt: createdAt,
  };
  const execution = createExecutionContext({ operationId, auditId, actorId, profile, target, category, workspace, model, deadline, abortSignal, scopeDecision });

  function record(event, fields = {}) {
    const entry = {
      operation_id: state.operationId,
      audit_id: state.auditId,
      workspace: state.workspace,
      event: String(event),
      status: state.status,
      timestamp: new Date().toISOString(),
      ...fields,
    };
    state.audit.push(entry);
    state.updatedAt = entry.timestamp;
    if (typeof auditSink === "function") auditSink(entry);
    return entry;
  }

  function transition(status, fields = {}) {
    const next = String(status || "");
    if (!TERMINAL_STATES.has(next) && !NON_TERMINAL_STATES.has(next)) {
      throw new Error(`Invalid operation state: ${next}`);
    }
    if (TERMINAL_STATES.has(state.status)) return { ...state };
    state.status = next;
    record(`state_${next}`, fields);
    if (typeof stateSink === "function") stateSink(snapshot());
    return snapshot();
  }

  function addEvidence(refs = []) {
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      const value = String(ref || "").trim();
      if (value && value.length <= 160 && !state.evidenceRefs.includes(value)) state.evidenceRefs.push(value);
    }
    return [...state.evidenceRefs];
  }

  function markCleanup(fields = {}) {
    state.cleanup = { ...state.cleanup, ...fields, attempted: true };
    record("cleanup", { cleanup: state.cleanup });
    if (typeof stateSink === "function") stateSink(snapshot());
    return { ...state.cleanup };
  }

  function snapshot() {
    const current = state.status;
    const terminal = TERMINAL_STATES.has(current);
    return {
      ...JSON.parse(JSON.stringify(state)),
      state: terminal ? "terminal" : current,
      resultStatus: terminal ? current : "",
    };
  }

  record("operation_created", { tool: state.toolName, profile: state.profile, target: state.target, category: state.category });
  return Object.freeze({
    ...execution,
    get status() { return state.status; },
    get toolName() { return state.toolName; },
    get input() { return JSON.parse(JSON.stringify(state.input)); },
    record,
    transition,
    addEvidence,
    markCleanup,
    snapshot,
    checkpoint(cursor = { sequence: 0, current: "", lastConsumed: 0 }) {
      const next = { ...cursor, sequence: Number(cursor.sequence || 0) + 1, current: `checkpoint-${Number(cursor.sequence || 0) + 1}-${id("cp").slice(0, 20)}` };
      state.checkpoint = next;
      record("checkpoint", { checkpoint_id: next.current, checkpoint_sequence: next.sequence });
      if (typeof stateSink === "function") stateSink(snapshot());
      return next;
    },
    consumeCheckpoint(checkpointId) {
      const tracked = state.checkpoint || {};
      if (checkpointId && tracked.lastConsumed != null && checkpointId === tracked.lastConsumed) {
        return { ok: false, code: "OPERATION_RESUME_DUPLICATE" };
      }
      if (checkpointId && checkpointId !== tracked.current) {
        return { ok: false, code: "OPERATION_RESUME_DUPLICATE" };
      }
      if (tracked.sequence == null || tracked.sequence === 0) {
        return { ok: false, code: "CONTROL_INVALID", error: "No checkpoint token exists to consume." };
      }
      tracked.lastConsumed = tracked.current;
      state.checkpoint = tracked;
      record("checkpoint_consumed", { checkpoint_id: tracked.current });
      if (typeof stateSink === "function") stateSink(snapshot());
      return { ok: true, checkpointId: tracked.current };
    },
  });
}

module.exports = { createOperationContext, TERMINAL_STATES };
