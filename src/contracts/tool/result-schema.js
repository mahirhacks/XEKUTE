"use strict";

const crypto = require("node:crypto");

const PRIMARY_OUTCOMES = Object.freeze(["success", "failure", "denied", "approval_required", "restricted", "partial", "inconclusive"]);
const VERIFICATION_STATUSES = Object.freeze(["verified", "failed", "partial", "inconclusive"]);
const RECOVERY_ACTIONS = Object.freeze(["retry", "modify_arguments", "switch_tool", "replan", "escalate", "stop"]);
const ROLLBACK_STATUSES = Object.freeze(["not_required", "rollback_completed", "rollback_failed"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
}

function integrityHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function createLifecycleResult({ invocationId, outcome, rawResult = {}, reason = "", restrictions = [], executionMetadata = {}, verification = null, recovery = null, rollback = null, auditReference = "", timestamps = {} } = {}) {
  if (typeof invocationId !== "string" || !invocationId.trim()) throw new TypeError("invocationId is required");
  if (!PRIMARY_OUTCOMES.includes(outcome)) throw new TypeError("Unsupported primary outcome");
  const verified = verification || { status: outcome === "success" ? "verified" : outcome === "partial" ? "partial" : "inconclusive", evidence: [], reason: "" };
  if (!VERIFICATION_STATUSES.includes(verified.status)) throw new TypeError("Unsupported verification status");
  const recovered = recovery || { status: "none", action: null, reason: "", sourceOutcome: outcome, nextInvocationId: "", restrictions: [], selectedAt: "" };
  if (recovered.status === "recovery_selected" && !RECOVERY_ACTIONS.includes(recovered.action)) throw new TypeError("Unsupported recovery action");
  if (!['none', 'recovery_selected'].includes(recovered.status)) throw new TypeError("Unsupported recovery status");
  const rolledBack = rollback || { status: "not_required", action: "", reason: "", restoredArtifacts: [], compensationReference: "", error: "", completedAt: "" };
  if (!ROLLBACK_STATUSES.includes(rolledBack.status)) throw new TypeError("Unsupported rollback status");
  const startedAt = timestamps.startedAt || new Date().toISOString();
  const completedAt = timestamps.completedAt || new Date().toISOString();
  const base = {
    invocationId,
    outcome,
    capabilityData: rawResult?.value ?? rawResult?.data ?? {},
    reason: String(reason || ""),
    error: rawResult?.error || "",
    restrictions: Array.isArray(restrictions) ? restrictions : [],
    executionMetadata,
    verification: verified,
    recovery: recovered,
    rollback: rolledBack,
    auditReference,
    timestamps: { startedAt, completedAt },
  };
  return { ...base, integrityHash: integrityHash(base) };
}

module.exports = { PRIMARY_OUTCOMES, RECOVERY_ACTIONS, ROLLBACK_STATUSES, VERIFICATION_STATUSES, createLifecycleResult, integrityHash };
