"use strict";

const STATES = Object.freeze(["created", "awaiting_approval", "approved", "dispatching", "running", "checkpointed", "awaiting_decision", "terminal"]);
const TERMINAL_RESULTS = Object.freeze(["success", "partial", "denied", "failed", "unavailable", "cancelled"]);

function validateOperationState(state) {
  if (!state || typeof state !== "object") return { ok: false, code: "OPERATION_STATE_INVALID", error: "Operation state is missing" };
  if (!STATES.includes(state.state)) return { ok: false, code: "OPERATION_STATE_INVALID", error: "Operation state is invalid" };
  if (state.state === "terminal" && !TERMINAL_RESULTS.includes(state.resultStatus)) return { ok: false, code: "OPERATION_TERMINAL_RESULT_INVALID", error: "Terminal operation result is invalid" };
  if (!String(state.operationId || "") || !String(state.auditId || "")) return { ok: false, code: "OPERATION_REFERENCES_REQUIRED", error: "Operation and audit IDs are required" };
  return { ok: true, state };
}

module.exports = { STATES, TERMINAL_RESULTS, validateOperationState };
