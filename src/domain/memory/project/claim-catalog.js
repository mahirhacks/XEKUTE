"use strict";

const { assert, assertMemoryId, canonicalKeyHash, createOpaqueId, PROJECT_CLAIM_STATES } = require("../../../contracts/memory/index.js");
const { cloneSafe, text } = require("../value-safety.js");

const CLAIM_PREDICATES = Object.freeze([
  "has_hostname", "resolves_to_ip", "exposes_service", "uses_technology", "uses_authentication",
  "uses_session_mechanism", "accepts_parameter", "returns_data_object", "requires_role", "sets_cookie",
  "redirects_to", "supports_method", "scope_status", "environment_status", "is_third_party",
  "has_dependency", "observed_behavior", "has_component", "has_page", "belongs_to_workflow",
]);
const CLAIM_PREDICATE_SET = new Set(CLAIM_PREDICATES);

function iso(value, field, required = false) {
  const result = text(value, 80);
  if (!result && !required) return "";
  assert(result && !Number.isNaN(Date.parse(result)), "MEMORY_CLAIM_TIME_INVALID", `${field} must be a valid ISO timestamp.`);
  return new Date(result).toISOString();
}

function normalizeObject(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : { value: input };
  const entityId = String(source.entity_id || source.entityId || source.object_id || source.objectId || "").trim();
  if (entityId) {
    return { type: "entity_ref", entity_id: assertMemoryId(entityId, "entity") };
  }
  const value = source.value !== undefined ? source.value : source.object_value !== undefined ? source.object_value : source.object;
  assert(value !== undefined, "MEMORY_CLAIM_OBJECT_REQUIRED", "A claim requires a typed object value or entity reference.");
  const explicitType = text(source.type || source.value_type || source.valueType || "", 40).toLowerCase();
  const inferredType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const type = explicitType || inferredType;
  assert(["string", "number", "boolean", "null", "array", "object", "url", "entity_ref"].includes(type), "MEMORY_CLAIM_OBJECT_TYPE_INVALID", "The claim object type is unsupported.");
  return { type, value: cloneSafe(value) };
}

function normalizeClaim(input = {}, { projectId, recordId = "", observedAt = "", idFactory = null } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : {};
  if (source.project_id || source.projectId) assert(String(source.project_id || source.projectId) === projectId, "MEMORY_PROJECT_MISMATCH", "The claim belongs to a different project.");
  const subjectId = assertMemoryId(source.subject_id || source.subjectId || source.subject, "entity");
  const predicate = text(source.predicate, 120).toLowerCase();
  assert(CLAIM_PREDICATE_SET.has(predicate), "MEMORY_CLAIM_PREDICATE_INVALID", `Unsupported Project Memory predicate: ${predicate || "<empty>"}.`);
  const object = normalizeObject(source.object || (source.object_id || source.objectId ? { entity_id: source.object_id || source.objectId } : { type: source.value_type || source.valueType, value: source.value }));
  const state = text(source.state || "observed", 40).toLowerCase();
  assert(PROJECT_CLAIM_STATES.includes(state), "MEMORY_CLAIM_STATE_INVALID", `Unsupported Project Memory claim state: ${state}.`);
  const confidence = source.confidence == null ? 0.5 : Number(source.confidence);
  assert(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, "MEMORY_CLAIM_CONFIDENCE_INVALID", "Claim confidence must be between 0 and 1.");
  const observed = iso(source.observed_at || source.observedAt || observedAt, "observed_at", true);
  const suppliedId = recordId || source.record_id || source.recordId || source.id || "";
  const claimId = suppliedId ? assertMemoryId(suppliedId, "claim") : assertMemoryId(typeof idFactory === "function" ? idFactory("claim") : createOpaqueId("claim"), "claim");
  const scope = cloneSafe(source.scope || {});
  const result = {
    record_type: "claim",
    record_id: claimId,
    project_id: projectId,
    subject_id: subjectId,
    predicate,
    object,
    canonical_key: `${subjectId}|${predicate}|${JSON.stringify(object)}`,
    canonical_key_hash: canonicalKeyHash({ project_id: projectId, subject_id: subjectId, predicate, object }),
    state,
    confidence,
    observed_at: observed,
    valid_from: iso(source.valid_from || source.validFrom, "valid_from"),
    valid_to: iso(source.valid_to || source.validTo, "valid_to"),
    last_confirmed_at: iso(source.last_confirmed_at || source.lastConfirmedAt, "last_confirmed_at"),
    expires_at: iso(source.expires_at || source.expiresAt, "expires_at"),
    supersedes: source.supersedes ? assertMemoryId(source.supersedes, "claim") : "",
    superseded_by: source.superseded_by ? assertMemoryId(source.superseded_by, "claim") : "",
    scope,
  };
  if (result.valid_to && result.valid_from) assert(Date.parse(result.valid_to) >= Date.parse(result.valid_from), "MEMORY_CLAIM_TIME_INVALID", "valid_to cannot precede valid_from.");
  return result;
}

module.exports = Object.freeze({ CLAIM_PREDICATES, CLAIM_PREDICATE_SET, normalizeObject, normalizeClaim });
