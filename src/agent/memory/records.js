const crypto = require("crypto");
const { CLAIM_STATES, HYPOTHESIS_STATES, COVERAGE_STATES, VERDICTS } = require("../../prompts/rules/evidence-rules");

function stableId(prefix, seed = "") {
  return `${prefix}-${crypto.createHash("sha256").update(`${prefix}|${seed}|${Date.now()}|${crypto.randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16)}`;
}

function envelope(type, value = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    recordType: type,
    id: String(value.id || stableId(type, value.runId || value.target || "")),
    runId: String(value.runId || ""),
    createdAt: value.createdAt || now,
    updatedAt: now,
    provenance: value.provenance && typeof value.provenance === "object" ? value.provenance : {},
    target: value.target && typeof value.target === "object" ? value.target : value.target ? { value: String(value.target) } : {},
    scopeResult: value.scopeResult && typeof value.scopeResult === "object" ? value.scopeResult : {},
    model: String(value.model || ""),
    tool: value.tool && typeof value.tool === "object" ? value.tool : {},
    evidenceIds: [...new Set((Array.isArray(value.evidenceIds) ? value.evidenceIds : []).map(String).filter(Boolean))],
  };
}

function claimRecord(value = {}) {
  const state = CLAIM_STATES.has(value.state) ? value.state : "unsupported";
  return { ...envelope("claim", value), state, text: String(value.text || "").slice(0, 8000), rationale: String(value.rationale || "").slice(0, 4000) };
}

function hypothesisRecord(value = {}) {
  const status = HYPOTHESIS_STATES.has(value.status) ? value.status : "proposed";
  return { ...envelope("hypothesis", value), status, question: String(value.question || ""), supportingSignal: String(value.supportingSignal || ""), rejectingSignal: String(value.rejectingSignal || ""), evidencePlan: Array.isArray(value.evidencePlan) ? value.evidencePlan.map(String) : [], stopConditions: Array.isArray(value.stopConditions) ? value.stopConditions.map(String) : [] };
}

function actionProposal(value = {}) {
  return { ...envelope("action-proposal", value), adapterId: String(value.adapterId || ""), capability: String(value.capability || ""), risk: String(value.risk || "unknown"), configuration: value.configuration && typeof value.configuration === "object" ? value.configuration : {}, expectedSignal: String(value.expectedSignal || ""), timeoutMs: Number(value.timeoutMs) || 0 };
}

function policyDecision(value = {}) {
  return { ...envelope("policy-decision", value), actionId: String(value.actionId || ""), allowed: Boolean(value.allowed), requiresApproval: Boolean(value.requiresApproval), code: String(value.code || ""), reason: String(value.reason || "") };
}

function observationRecord(value = {}) {
  return { ...envelope("observation", value), actionId: String(value.actionId || ""), status: String(value.status || "complete"), parserConfidence: Math.max(0, Math.min(1, Number(value.parserConfidence) || 0)), truncated: Boolean(value.truncated), summary: String(value.summary || "") };
}

function verificationVerdict(value = {}) {
  const verdict = VERDICTS.has(value.verdict) ? value.verdict : "inconclusive";
  return { ...envelope("verification-verdict", value), verdict, supportedClaims: Array.isArray(value.supportedClaims) ? value.supportedClaims.map(String) : [], unsupportedClaims: Array.isArray(value.unsupportedClaims) ? value.unsupportedClaims.map(String) : [], missingEvidence: Array.isArray(value.missingEvidence) ? value.missingEvidence.map(String) : [], rationale: String(value.rationale || "") };
}

function findingCandidate(value = {}) {
  return { ...envelope("finding-candidate", value), finding: value.finding && typeof value.finding === "object" ? value.finding : {}, promotionStatus: String(value.promotionStatus || "pending") };
}

function coverageUpdate(value = {}) {
  const status = COVERAGE_STATES.has(value.status) ? value.status : "not-tested";
  return { ...envelope("coverage-update", value), framework: String(value.framework || ""), frameworkVersion: String(value.frameworkVersion || ""), procedureId: String(value.procedureId || ""), status, reason: String(value.reason || "") };
}

module.exports = { CLAIM_STATES, HYPOTHESIS_STATES, COVERAGE_STATES, VERDICTS, envelope, claimRecord, hypothesisRecord, actionProposal, policyDecision, observationRecord, verificationVerdict, findingCandidate, coverageUpdate };
