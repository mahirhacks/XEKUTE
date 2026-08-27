"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId, createOpaqueId } = require("./memory-identity.js");
const { assertActor, assertProvenance, assertSensitivity } = require("./memory-lifecycle.js");

const SENSITIVE_CONTRACT_VERSION = 1;
const SENSITIVE_ENTRY_TYPES = Object.freeze([
  "cookie",
  "access_token",
  "refresh_token",
  "csrf_token",
  "nonce",
  "authorization_header",
  "browser_storage",
  "certificate_chain",
  "certificate_passphrase",
]);
const SENSITIVE_STATES = Object.freeze(["active", "rotated", "revoked", "expired", "deleted"]);
const SENSITIVE_SOURCE_TYPES = Object.freeze(["identity_vault", "browser_context", "trusted_response", "operator", "request_adapter"]);
const RAW_SECRET_KEYS = /^(?:value|raw[_-]?value|raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|password|secret(?:[_-]?value)?)$/i;

function text(value, maximum = 2_000) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_FIELD_TOO_LARGE", "A Sensitive Working Memory field exceeds its maximum length.", { maximum });
  return result;
}

function iso(value, field, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value == null || value === "" ? fallback : String(value));
  assert(!Number.isNaN(date.getTime()), "MEMORY_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function boundedClone(value, depth = 0, key = "") {
  assert(depth <= 8, "MEMORY_PAYLOAD_TOO_DEEP", "Sensitive metadata is nested too deeply.");
  assert(!RAW_SECRET_KEYS.test(String(key || "")), "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in handles or metadata.", { field: String(key) });
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, 4_000);
  if (Array.isArray(value)) {
    assert(value.length <= 100, "MEMORY_ARRAY_TOO_LARGE", "Sensitive metadata contains too many values.");
    return value.map((entry) => boundedClone(entry, depth + 1));
  }
  assert(typeof value === "object", "MEMORY_PAYLOAD_INVALID", "Sensitive metadata must be JSON-compatible.");
  return Object.entries(value).reduce((result, [childKey, child]) => {
    result[text(childKey, 120)] = boundedClone(child, depth + 1, childKey);
    return result;
  }, {});
}

function actorOf(input) {
  const actor = input?.actor ? boundedClone(input.actor) : { type: "system", id: "sensitive-working-memory" };
  assertActor(actor);
  return actor;
}

function provenanceOf(input) {
  const provenance = input?.provenance ? boundedClone(input.provenance) : null;
  assertProvenance(provenance);
  return provenance;
}

function projectIdOf(input) { return assertMemoryId(input?.project_id || input?.projectId, "proj"); }

function requiredText(value, field, maximum = 240) {
  const result = text(value, maximum);
  assert(result, "MEMORY_FIELD_REQUIRED", `${field} is required.`, { field });
  return result;
}

function entryTypeOf(value) {
  const type = text(value, 80).toLowerCase();
  assert(SENSITIVE_ENTRY_TYPES.includes(type), "MEMORY_SENSITIVE_TYPE_INVALID", `Unsupported sensitive entry type: ${type || "<empty>"}.`, { type });
  return type;
}

function stateOf(value = "active") {
  const state = text(value, 40).toLowerCase();
  assert(SENSITIVE_STATES.includes(state), "MEMORY_SENSITIVE_STATE_INVALID", `Unsupported Sensitive Working Memory state: ${state || "<empty>"}.`, { state });
  return state;
}

function sourceTypeOf(value = "request_adapter") {
  const source = text(value, 80).toLowerCase();
  assert(SENSITIVE_SOURCE_TYPES.includes(source), "MEMORY_SENSITIVE_SOURCE_INVALID", `Unsupported sensitive source: ${source || "<empty>"}.`, { source });
  return source;
}

function createSensitiveHandle(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_SENSITIVE_HANDLE_INVALID", "A sensitive handle must be an object.");
  // This validation intentionally walks metadata but never accepts a secret
  // value. Raw values are admitted only by the trusted adapter service.
  boundedClone(input.metadata || {});
  const projectId = projectIdOf(input);
  const handleId = input.handle_id || input.handleId
    ? assertMemoryId(input.handle_id || input.handleId, "sel")
    : createOpaqueId("sel", idFactory ? { uuid: idFactory } : {});
  const createdAt = iso(input.created_at || input.createdAt, "created_at", now());
  const expiresAt = iso(input.expires_at || input.expiresAt, "expires_at", new Date(new Date(createdAt).getTime() + 60 * 60 * 1_000));
  assert(new Date(expiresAt).getTime() > new Date(createdAt).getTime(), "MEMORY_SENSITIVE_EXPIRY_INVALID", "A sensitive handle must expire after it is created.");
  const state = stateOf(input.state || "active");
  assert(state !== "deleted", "MEMORY_SENSITIVE_STATE_INVALID", "Deleted sensitive entries cannot be exposed as handles.");
  const entryType = entryTypeOf(input.entry_type || input.entryType || input.secret_type || input.secretType);
  const sessionId = requiredText(input.session_id || input.sessionId, "session_id");
  const agentId = requiredText(input.agent_id || input.agentId, "agent_id");
  const identityId = text(input.identity_id || input.identityId, 240);
  const origin = text(input.origin, 2_000);
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { assert(false, "MEMORY_SENSITIVE_ORIGIN_INVALID", "Sensitive origin must be a valid URL."); }
    assert(["http:", "https:", "ws:", "wss:"].includes(parsed.protocol), "MEMORY_SENSITIVE_ORIGIN_INVALID", "Sensitive origin must use a supported web protocol.");
  }
  const metadata = boundedClone(input.metadata || {});
  return Object.freeze({
    schema_version: SENSITIVE_CONTRACT_VERSION,
    memory_type: "session",
    record_type: "sensitive_handle",
    record_id: handleId,
    handle_id: handleId,
    project_id: projectId,
    session_id: sessionId,
    agent_id: agentId,
    identity_id: identityId,
    entry_type: entryType,
    origin,
    browser_context: text(input.browser_context || input.browserContext, 240),
    state,
    created_at: createdAt,
    updated_at: iso(input.updated_at || input.updatedAt, "updated_at", createdAt),
    expires_at: expiresAt,
    generation: Number.isInteger(input.generation) && input.generation >= 0 ? input.generation : 0,
    delegation: Object.freeze({ allowed: input.delegation?.allowed === true, scope: text(input.delegation?.scope, 240) }),
    metadata,
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: assertSensitivity("restricted"),
  });
}

function createSensitiveLease(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_SENSITIVE_LEASE_INVALID", "A sensitive use lease must be an object.");
  const projectId = projectIdOf(input);
  const leaseId = input.lease_id || input.leaseId
    ? assertMemoryId(input.lease_id || input.leaseId, "op")
    : createOpaqueId("op", idFactory ? { uuid: idFactory } : {});
  const handleIds = [...new Set((Array.isArray(input.handle_ids || input.handleIds) ? (input.handle_ids || input.handleIds) : [input.handle_id || input.handleId]).filter(Boolean).map((value) => assertMemoryId(value, "sel")))];
  assert(handleIds.length > 0, "MEMORY_SENSITIVE_HANDLES_REQUIRED", "A sensitive use lease requires at least one handle.");
  const issuedAt = iso(input.issued_at || input.issuedAt, "issued_at", now());
  const expiresAt = iso(input.expires_at || input.expiresAt, "expires_at", new Date(new Date(issuedAt).getTime() + 60 * 1_000));
  assert(new Date(expiresAt).getTime() > new Date(issuedAt).getTime(), "MEMORY_SENSITIVE_EXPIRY_INVALID", "A sensitive lease must expire after it is issued.");
  const sessionId = requiredText(input.session_id || input.sessionId, "session_id");
  const agentId = requiredText(input.agent_id || input.agentId, "agent_id");
  return Object.freeze({
    schema_version: SENSITIVE_CONTRACT_VERSION,
    memory_type: "session",
    record_type: "sensitive_lease",
    record_id: leaseId,
    lease_id: leaseId,
    project_id: projectId,
    session_id: sessionId,
    agent_id: agentId,
    handle_ids: handleIds,
    purpose: requiredText(input.purpose, "purpose", 500),
    adapter: requiredText(input.adapter || input.tool_name || input.toolName, "adapter", 240),
    issued_at: issuedAt,
    expires_at: expiresAt,
    state: "issued",
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: assertSensitivity("restricted"),
  });
}

function createSensitiveAuditRecord(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_SENSITIVE_AUDIT_INVALID", "A sensitive audit record must be an object.");
  const projectId = projectIdOf(input);
  const recordId = input.record_id || input.recordId
    ? assertMemoryId(input.record_id || input.recordId, "event")
    : createOpaqueId("event", idFactory ? { uuid: idFactory } : {});
  const outcome = requiredText(input.outcome, "outcome", 120);
  const decision = input.decision && typeof input.decision === "object" ? boundedClone(input.decision) : {};
  return Object.freeze({
    schema_version: SENSITIVE_CONTRACT_VERSION,
    memory_type: "session",
    record_type: "sensitive_audit",
    record_id: recordId,
    project_id: projectId,
    session_id: requiredText(input.session_id || input.sessionId, "session_id"),
    agent_id: requiredText(input.agent_id || input.agentId, "agent_id"),
    handle_ids: [...new Set((Array.isArray(input.handle_ids || input.handleIds) ? (input.handle_ids || input.handleIds) : []).filter(Boolean).map((value) => assertMemoryId(value, "sel")))],
    lease_id: input.lease_id || input.leaseId ? assertMemoryId(input.lease_id || input.leaseId, "op") : "",
    purpose: text(input.purpose, 500),
    adapter: text(input.adapter || input.tool_name || input.toolName, 240),
    decision,
    outcome,
    recorded_at: iso(input.recorded_at || input.recordedAt, "recorded_at", now()),
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: assertSensitivity("restricted"),
  });
}

module.exports = Object.freeze({
  SENSITIVE_CONTRACT_VERSION,
  SENSITIVE_ENTRY_TYPES,
  SENSITIVE_STATES,
  SENSITIVE_SOURCE_TYPES,
  createSensitiveHandle,
  createSensitiveLease,
  createSensitiveAuditRecord,
  validateSensitiveHandle: (input, options) => validate((value) => createSensitiveHandle(value, options), input),
  validateSensitiveLease: (input, options) => validate((value) => createSensitiveLease(value, options), input),
  validateSensitiveAuditRecord: (input, options) => validate((value) => createSensitiveAuditRecord(value, options), input),
});
