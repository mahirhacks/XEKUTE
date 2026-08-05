"use strict";

const IDENTITY_KINDS = Object.freeze(["user", "role", "session"]);
const IDENTITY_STATUSES = Object.freeze(["active", "expired", "revoked", "unavailable"]);

function identityDescriptor(input = {}) {
  return Object.freeze({
    identity_id: String(input.identity_id || ""),
    assessment_id: String(input.assessment_id || ""),
    kind: IDENTITY_KINDS.includes(input.kind) ? input.kind : "session",
    role: String(input.role || "analyst"),
    capabilities: [...new Set((Array.isArray(input.capabilities) ? input.capabilities : []).map(String))].slice(0, 20),
    session_status: IDENTITY_STATUSES.includes(input.session_status) ? input.session_status : "unavailable",
    expires_at: String(input.expires_at || ""),
    revoked: Boolean(input.revoked),
    selection_scope: ["operation", "run", "assessment"].includes(input.selection_scope) ? input.selection_scope : "operation",
    selected_by: String(input.selected_by || ""),
    selection_expires_at: String(input.selection_expires_at || ""),
  });
}

function validateIdentityDescriptor(identity, expected = {}) {
  if (!identity || typeof identity !== "object") return { ok: false, code: "IDENTITY_INVALID", error: "Identity descriptor is missing" };
  for (const key of ["identity_id", "assessment_id", "session_status"]) if (!String(identity[key] || "")) return { ok: false, code: "IDENTITY_INVALID", error: `Identity field ${key} is required` };
  if (!IDENTITY_KINDS.includes(identity.kind) || !IDENTITY_STATUSES.includes(identity.session_status)) return { ok: false, code: "IDENTITY_INVALID", error: "Identity kind or status is invalid" };
  if (expected.assessmentId != null && identity.assessment_id !== String(expected.assessmentId)) return { ok: false, code: "IDENTITY_ASSESSMENT_MISMATCH", error: "Identity belongs to another assessment" };
  if (identity.revoked || identity.session_status === "revoked") return { ok: false, code: "IDENTITY_REVOKED", error: "Identity is revoked" };
  if (identity.expires_at && Date.parse(identity.expires_at) <= Date.now()) return { ok: false, code: "IDENTITY_EXPIRED", error: "Identity has expired" };
  return { ok: true, identity };
}

module.exports = { IDENTITY_KINDS, IDENTITY_STATUSES, identityDescriptor, validateIdentityDescriptor };
