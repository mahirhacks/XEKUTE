"use strict";

const crypto = require("node:crypto");

const PHASES = Object.freeze(["preflight", "execution", "observation", "verification", "complete"]);
const CLAIM_STATES = Object.freeze(["observed", "inferred", "hypothesis", "verified", "rejected", "inconclusive", "unsupported"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "inconclusive", "waiting", "artifact_sync_failed"]);

function stableId(prefix = "run") {
  return prefix + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
}

function createRunState({ runId = "", profile = "agent", objective = "", model = "" } = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: String(runId || stableId("run")),
    profile: String(profile || "agent"),
    model: String(model || ""),
    phase: "preflight",
    status: "running",
    objective: String(objective || "").slice(0, 4000),
    actionIds: [],
    evidenceIds: [],
    verification: { status: "not-run", details: "" },
    limitations: [],
    createdAt: now,
    updatedAt: now,
    completedAt: "",
    stopReason: "",
    toolCount: 0,
    failedToolCount: 0,
  };
}

function transition(state, nextPhase, { reason = "", limitations = [] } = {}) {
  if (!state || !PHASES.includes(String(nextPhase || ""))) {
    return { ok: false, code: "INVALID_PHASE", error: "Unknown agent lifecycle phase." };
  }
  const next = String(nextPhase);
  const currentIndex = PHASES.indexOf(state.phase);
  const nextIndex = PHASES.indexOf(next);
  if (nextIndex < currentIndex && next !== "complete") {
    return { ok: false, code: "PHASE_REGRESSION", error: "Agent lifecycle phases cannot regress." };
  }
  if (nextIndex > currentIndex + 1) {
    for (let index = currentIndex + 1; index < nextIndex; index += 1) {
      state.limitations.push("Lifecycle phase skipped: " + PHASES[index] + ".");
    }
  }
  state.phase = next;
  state.updatedAt = new Date().toISOString();
  if (reason) state.lastTransitionReason = String(reason).slice(0, 1000);
  for (const limitation of Array.isArray(limitations) ? limitations : []) {
    if (limitation) state.limitations.push(String(limitation));
  }
  return { ok: true, state };
}

function advancePhase(state, targetPhase, options = {}) {
  if (!targetPhase || state?.phase === targetPhase) return { ok: true, state };
  return transition(state, targetPhase, options);
}

function noteAction(state, { actionId = "", ok = false, evidenceIds = [], verification = null } = {}) {
  if (actionId && !state.actionIds.includes(String(actionId))) state.actionIds.push(String(actionId));
  state.toolCount += 1;
  if (!ok) state.failedToolCount += 1;
  for (const evidenceId of Array.isArray(evidenceIds) ? evidenceIds : []) {
    if (evidenceId && !state.evidenceIds.includes(String(evidenceId))) state.evidenceIds.push(String(evidenceId));
  }
  if (verification && typeof verification === "object") state.verification = { ...state.verification, ...verification };
  state.updatedAt = new Date().toISOString();
  return { ok: Boolean(ok), state };
}

function finalize(state, { status = "completed", reason = "", limitations = [] } = {}) {
  const finalStatus = TERMINAL_STATUSES.has(status) ? status : "failed";
  state.status = finalStatus;
  state.stopReason = String(reason || "");
  for (const limitation of Array.isArray(limitations) ? limitations : []) {
    if (limitation) state.limitations.push(String(limitation));
  }
  state.phase = "complete";
  state.completedAt = new Date().toISOString();
  state.updatedAt = state.completedAt;
  return state;
}

function evidenceIdsFromResults(results = []) {
  const ids = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const candidates = [
      result?.evidenceId,
      result?.evidence?.id,
      result?.value?.evidenceId,
      ...(Array.isArray(result?.evidenceIds) ? result.evidenceIds : []),
      ...(Array.isArray(result?.value?.evidenceIds) ? result.value.evidenceIds : []),
    ];
    for (const id of candidates) if (id) ids.add(String(id));
  }
  return [...ids];
}

const UNSUPPORTED_VULNERABILITY_RE = /\b(?:confirmed|verified|proven)\s+(?:critical\s+|high\s+|medium\s+|low\s+)?(?:vulnerability|finding)|\bis vulnerable\b/i;
const OVERBROAD_SECURITY_RE = /\b(?:is|appears|seems)\s+(?:fully\s+)?secure\b/gi;

function validateFinalClaims(text, { executedTools = false, evidenceIds = [], actionResults = [] } = {}) {
  let value = String(text || "").trim();
  const warnings = [];
  if (OVERBROAD_SECURITY_RE.test(value)) {
    warnings.push("Security conclusions must describe the documented tested conditions.");
    value = value.replace(OVERBROAD_SECURITY_RE, "had no issue observed under the documented tested conditions");
  }
  if (UNSUPPORTED_VULNERABILITY_RE.test(value) && evidenceIds.length === 0) {
    warnings.push("The vulnerability claim has no linked evidence and remains inconclusive.");
  }
  if (/\b(?:ran|passed|succeeded|completed)\b.*\b(?:test|scan|command|tool|request)\b/i.test(value) && !executedTools) {
    warnings.push("The response implied execution without a matching tool execution record.");
  }
  if (Array.isArray(actionResults) && actionResults.some((result) => result?.error || result?.ok === false)) {
    if (/\b(?:passed|succeeded|completed|fixed)\b/i.test(value)) warnings.push("The response used success language after a failed tool result.");
  }
  return { ok: warnings.length === 0, text: value, warnings };
}

module.exports = {
  PHASES,
  CLAIM_STATES,
  TERMINAL_STATUSES,
  createRunState,
  transition,
  advancePhase,
  noteAction,
  finalize,
  evidenceIdsFromResults,
  validateFinalClaims,
};
