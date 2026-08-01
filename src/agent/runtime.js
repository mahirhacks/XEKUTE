const crypto = require("crypto");
const { PHASES, COMPLETION_GATES, TERMINAL_STATUSES } = require("../prompts/skills/agentic-loop");
const { CLAIM_STATES } = require("../prompts/skills/bugbounty");

function stableId(prefix = "state") {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function createRunState({ runId, profile, objective = "", model = "" } = {}) {
  return {
    schemaVersion: 1,
    id: String(runId || stableId("run")),
    profile: String(profile || "assist:ask"),
    model: String(model || ""),
    phase: "preflight",
    status: "running",
    objective: String(objective || "").slice(0, 2000),
    knownFacts: [],
    unknowns: [],
    hypothesisId: "",
    proposedActionId: "",
    expectedSignal: "",
    completionGate: "preflight-reviewed",
    evidenceIds: [],
    actionIds: [],
    verification: { status: "not-run", details: "" },
    limitations: [],
    skippedPhases: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: "",
    stopReason: "",
  };
}

function phaseIndex(phase) {
  return PHASES.indexOf(String(phase || ""));
}

function transition(state, nextPhase, { reason = "", approvedBy = "", limitations = [] } = {}) {
  const current = phaseIndex(state?.phase);
  const next = phaseIndex(nextPhase);
  if (current < 0 || next < 0) return { ok: false, code: "INVALID_PHASE", error: `Unknown phase: ${nextPhase}` };
  if (next < current) return { ok: false, code: "PHASE_REGRESSION", error: "Assessment phases cannot move backwards; start a new verification/retest cycle instead." };
  const jump = next > current + 1;
  if (jump && (!String(reason).trim() || !String(approvedBy).trim())) {
    return { ok: false, code: "PHASE_JUMP_JUSTIFICATION_REQUIRED", error: "Skipping assessment phases requires a reason and approving operator." };
  }
  if (jump) {
    for (let index = current + 1; index < next; index += 1) {
      state.skippedPhases.push({ phase: PHASES[index], reason: String(reason), approvedBy: String(approvedBy), recordedAt: new Date().toISOString() });
    }
    state.limitations.push(...(Array.isArray(limitations) ? limitations.map(String) : []));
  }
  state.phase = nextPhase;
  state.updatedAt = new Date().toISOString();
  state.completionGate = completionGateFor(nextPhase);
  return { ok: true, state };
}

function completionGateFor(phase) {
  return COMPLETION_GATES[phase] || "unknown";
}

function noteAction(state, { actionId = "", ok = false, evidenceIds = [], verification = null } = {}) {
  if (actionId && !state.actionIds.includes(actionId)) state.actionIds.push(String(actionId));
  for (const id of Array.isArray(evidenceIds) ? evidenceIds : []) if (id && !state.evidenceIds.includes(String(id))) state.evidenceIds.push(String(id));
  if (verification) state.verification = { ...state.verification, ...verification };
  state.updatedAt = new Date().toISOString();
  return { ok: Boolean(ok), state };
}

function finalize(state, { status = "completed", reason = "", limitations = [] } = {}) {
  const normalizedStatus = TERMINAL_STATUSES.has(status) ? status : "failed";
  state.status = normalizedStatus;
  state.stopReason = String(reason || "");
  state.limitations.push(...(Array.isArray(limitations) ? limitations.map(String).filter(Boolean) : []));
  state.completedAt = new Date().toISOString();
  state.updatedAt = state.completedAt;
  state.phase = "complete";
  state.completionGate = "terminal-run-record-written";
  return state;
}

function evidenceIdsFromResults(results = []) {
  const ids = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const candidates = [result?.evidenceId, result?.evidence?.id, ...(Array.isArray(result?.evidenceIds) ? result.evidenceIds : [])];
    for (const id of candidates) if (id) ids.add(String(id));
  }
  return [...ids];
}

function completionIssues(state, { assessmentRequested = false, activeActions = false, actionResults = [] } = {}) {
  const issues = [];
  if (!assessmentRequested) return issues;
  if (!state?.hypothesisId) issues.push("No testable hypothesis was recorded.");
  if (!Array.isArray(state?.actionIds) || !state.actionIds.length) issues.push("No normalized action proposal reached the runtime.");
  if (activeActions && (!Array.isArray(state?.evidenceIds) || !state.evidenceIds.length)) issues.push("No admissible evidence record was produced by the active action.");
  if ((Array.isArray(actionResults) ? actionResults : []).some((result) => result?.error || result?.ok === false || ["partial", "aborted", "timeout"].includes(result?.status))) {
    issues.push("At least one proposed action failed, was partial, aborted, or timed out.");
  }
  return issues;
}

function validateFinalClaims(text, { executedTools = false, evidenceIds = [], verification = null, actionResults = [] } = {}) {
  let value = String(text || "").trim();
  const warnings = [];
  value = value.replace(/\b(?:is|appears|seems)\s+(?:fully\s+)?secure\b/gi, "had no issue observed under the documented tested conditions");
  const confirmedClaim = /\b(?:confirmed|verified|proven)\s+(?:critical\s+|high\s+|medium\s+|low\s+)?(?:vulnerability|finding)|\bis vulnerable\b/i.test(value);
  if (confirmedClaim && !evidenceIds.length) {
    warnings.push("A vulnerability claim lacked admissible evidence and was downgraded to an inconclusive hypothesis.");
    value = value
      .replace(/\bconfirmed\b/gi, "suspected")
      .replace(/\bverified\b/gi, "suspected")
      .replace(/\bproven\b/gi, "suspected")
      .replace(/\bis vulnerable\b/gi, "may be vulnerable");
  }
  const actionSuccess = /\b(?:test|scan|command|tool|request)\s+(?:ran|passed|succeeded|completed)\b/i.test(value);
  if (actionSuccess && !executedTools) warnings.push("The response implied execution without a matching runtime action record.");
  if (actionSuccess && (Array.isArray(actionResults) ? actionResults : []).some((result) => result?.error || result?.ok === false || ["partial", "aborted", "timeout"].includes(result?.status))) warnings.push("The response used action-success language after a failed, partial, aborted, or timed-out action.");
  if (verification?.status === "failed" && /\b(?:fixed|complete|successful|passed)\b/i.test(value)) warnings.push("The latest verification failed; success language is not admissible.");
  if (warnings.length) value = `**Inconclusive runtime validation**\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n\n${value}`;
  return { ok: warnings.length === 0, text: value, warnings };
}

module.exports = { PHASES, CLAIM_STATES, TERMINAL_STATUSES, createRunState, transition, noteAction, finalize, evidenceIdsFromResults, completionIssues, validateFinalClaims };
