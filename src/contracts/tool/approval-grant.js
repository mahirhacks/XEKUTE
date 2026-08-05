"use strict";

const crypto = require("node:crypto");

function issueApprovalGrant({
  assessmentId,
  actorId,
  runId,
  targetPattern,
  operationCategories = [],
  allowedTestCategories = [],
  maximumIntensity = "read",
  rateLimit = 1,
  concurrency = 1,
  expiresAt = Date.now() + 300000,
  authorizationVersion = "authorization-v1",
  integrityTag = "",
} = {}) {
  return Object.freeze({
    grant_id: `approval-${crypto.randomUUID()}`,
    assessment_id: String(assessmentId || ""),
    actor_id: String(actorId || ""),
    valid_for_run: String(runId || ""),
    target_pattern: String(targetPattern || ""),
    operation_categories: [...new Set(operationCategories.map(String))],
    allowed_test_categories: [...new Set(allowedTestCategories.map(String))],
    maximum_intensity: String(maximumIntensity),
    rate_limit: Math.max(0.1, Number(rateLimit) || 1),
    concurrency: Math.max(1, Math.round(Number(concurrency) || 1)),
    issued_at: new Date().toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    revoked: false,
    authorization_version: String(authorizationVersion),
    integrity_tag: String(integrityTag || ""),
  });
}

function targetMatches(pattern, target) {
  const rule = String(pattern || "").toLowerCase().trim();
  let value = String(target || "").toLowerCase().trim();
  if (!rule || !value) return false;
  try { value = new URL(value).hostname.toLowerCase(); } catch { /* Hostname input is already normalized. */ }
  if (rule === value) return true;
  if (rule.startsWith("*.")) return value.endsWith(rule.slice(1));
  return false;
}

function validateApprovalGrant(grant, expected = {}, { now = Date.now(), verifyIntegrity = null } = {}) {
  if (!grant || typeof grant !== "object") return { ok: false, code: "APPROVAL_INVALID", error: "Approval grant is missing" };
  if (grant.revoked) return { ok: false, code: "APPROVAL_REVOKED", error: "Approval grant is revoked" };
  const expiry = Date.parse(grant.expires_at);
  if (!Number.isFinite(expiry) || now >= expiry) return { ok: false, code: "APPROVAL_EXPIRED", error: "Approval grant has expired" };
  const pairs = [["assessment_id", "assessmentId", "APPROVAL_ASSESSMENT_MISMATCH"], ["actor_id", "actorId", "APPROVAL_ACTOR_MISMATCH"], ["valid_for_run", "runId", "APPROVAL_RUN_MISMATCH"], ["authorization_version", "authorizationVersion", "APPROVAL_AUTHORIZATION_VERSION_MISMATCH"]];
  for (const [field, expectedKey, code] of pairs) if (expected[expectedKey] != null && String(grant[field]) !== String(expected[expectedKey])) return { ok: false, code, error: `Approval grant does not match ${expectedKey}` };
  if (expected.target != null && !targetMatches(grant.target_pattern, expected.target)) return { ok: false, code: "APPROVAL_TARGET_MISMATCH", error: "Approval grant target does not match" };
  if (expected.operationCategory != null && !grant.operation_categories.includes(String(expected.operationCategory))) return { ok: false, code: "APPROVAL_CATEGORY_MISMATCH", error: "Approval grant does not cover this operation category" };
  if (expected.testCategory != null && grant.allowed_test_categories.length && !grant.allowed_test_categories.includes(String(expected.testCategory))) return { ok: false, code: "APPROVAL_TEST_CATEGORY_MISMATCH", error: "Approval grant does not cover this test category" };
  if (typeof verifyIntegrity === "function" && !verifyIntegrity(grant)) return { ok: false, code: "APPROVAL_INTEGRITY_INVALID", error: "Approval grant integrity validation failed" };
  return { ok: true, grant };
}

module.exports = { issueApprovalGrant, targetMatches, validateApprovalGrant };
