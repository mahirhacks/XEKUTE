"use strict";

const crypto = require("node:crypto");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function operationDigest(input = {}) {
  const normalized = input && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input).filter(([key]) => !["scope_decision_id", "operation_digest"].includes(key)))
    : input;
  return crypto.createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex");
}

function issueScopeDecision({
  assessmentId,
  actorId,
  target,
  operationCategory,
  intensity = "read",
  operationInput = {},
  operationDigestValue = "",
  policyVersion = "policy-v1",
  authorizationVersion = "authorization-v1",
  expiresAt = Date.now() + 300000,
  integrityTag = "",
} = {}) {
  const decision = {
    decision_id: `scope-${crypto.randomUUID()}`,
    assessment_id: String(assessmentId || ""),
    actor_id: String(actorId || ""),
    target: String(target || ""),
    operation_category: String(operationCategory || ""),
    intensity: String(intensity || "read"),
    operation_digest: String(operationDigestValue || operationDigest(operationInput)),
    policy_version: String(policyVersion),
    authorization_version: String(authorizationVersion),
    decided_at: new Date().toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    integrity_tag: String(integrityTag || ""),
  };
  return Object.freeze(decision);
}

function validateScopeDecision(decision, expected = {}, { now = Date.now(), verifyIntegrity = null } = {}) {
  if (!decision || typeof decision !== "object") return { ok: false, code: "SCOPE_DECISION_INVALID", error: "Scope decision is missing" };
  for (const key of ["decision_id", "assessment_id", "actor_id", "target", "operation_category", "operation_digest", "policy_version", "authorization_version", "integrity_tag"]) {
    if (!String(decision[key] || "").trim()) return { ok: false, code: "SCOPE_DECISION_INVALID", error: `Scope decision field ${key} is required` };
  }
  const expiry = Date.parse(decision.expires_at);
  if (!Number.isFinite(expiry) || now >= expiry) return { ok: false, code: "SCOPE_DECISION_EXPIRED", error: "Scope decision has expired" };
  for (const [key, code] of [["assessmentId", "SCOPE_ASSESSMENT_MISMATCH"], ["actorId", "SCOPE_ACTOR_MISMATCH"], ["target", "SCOPE_TARGET_MISMATCH"], ["operationCategory", "SCOPE_CATEGORY_MISMATCH"], ["policyVersion", "SCOPE_POLICY_VERSION_MISMATCH"], ["authorizationVersion", "SCOPE_AUTHORIZATION_VERSION_MISMATCH"]]) {
    if (expected[key] != null && String(decision[key === "assessmentId" ? "assessment_id" : key === "actorId" ? "actor_id" : key === "operationCategory" ? "operation_category" : key === "policyVersion" ? "policy_version" : key === "authorizationVersion" ? "authorization_version" : "target"]) !== String(expected[key])) {
      return { ok: false, code, error: `Scope decision does not match ${key}` };
    }
  }
  if (expected.operationInput !== undefined && operationDigest(expected.operationInput) !== decision.operation_digest) return { ok: false, code: "SCOPE_OPERATION_DIGEST_MISMATCH", error: "Scope decision does not bind this operation input" };
  if (typeof verifyIntegrity === "function" && !verifyIntegrity(decision)) return { ok: false, code: "SCOPE_INTEGRITY_INVALID", error: "Scope decision integrity validation failed" };
  return { ok: true, decision };
}

module.exports = { canonicalJson, operationDigest, issueScopeDecision, validateScopeDecision };
