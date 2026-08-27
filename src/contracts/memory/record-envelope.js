"use strict";

const crypto = require("node:crypto");
const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId } = require("./memory-identity.js");
const { assertOwner, assertSensitivity, assertActor, assertProvenance, MEMORY_TYPES } = require("./memory-lifecycle.js");

const SCHEMA_VERSION = 1;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 8_000;
const MAX_ARRAY_ITEMS = 200;
const ENVELOPE_FIELDS = new Set(["schema_version", "memory_type", "record_type", "record_id", "project_id", "revision_created", "revision_updated", "state", "created_at", "updated_at", "actor", "provenance", "sensitivity", "operation_id", "payload", "extensions"]);
const SECRET_KEYS = new Set(["cookie", "raw_cookie", "authorization", "authorization_header", "access_token", "refresh_token", "csrf_token", "private_key", "client_private_key", "passphrase", "raw_value", "secret", "secret_value", "bearer_token", "password"]);

function text(value, maximum = MAX_STRING_LENGTH) {
  const result = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  assert(result.length <= maximum, "MEMORY_FIELD_TOO_LARGE", "A memory field exceeds its maximum length.", { maximum });
  return result;
}

function cloneBounded(value, depth = 0, key = "") {
  assert(depth <= 10, "MEMORY_PAYLOAD_TOO_DEEP", "Memory payload nesting is too deep.");
  if (SECRET_KEYS.has(String(key).toLowerCase())) assert(false, "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in general memory.", { field: String(key) });
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string") return text(value);
    return value;
  }
  if (Array.isArray(value)) {
    assert(value.length <= MAX_ARRAY_ITEMS, "MEMORY_ARRAY_TOO_LARGE", "A memory array exceeds its maximum item count.", { maximum: MAX_ARRAY_ITEMS });
    return value.map((entry) => cloneBounded(entry, depth + 1, ""));
  }
  assert(value && typeof value === "object", "MEMORY_PAYLOAD_INVALID", "Memory payloads must contain JSON-compatible values.");
  return Object.keys(value).reduce((result, field) => {
    const cleanKey = text(field, 120);
    assert(!SECRET_KEYS.has(cleanKey.toLowerCase()), "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in general memory.", { field: cleanKey });
    result[cleanKey] = cloneBounded(value[field], depth + 1, cleanKey);
    return result;
  }, {});
}

function isoTimestamp(value, field) {
  const result = text(value, 80);
  assert(result && !Number.isNaN(Date.parse(result)), "MEMORY_TIMESTAMP_INVALID", `${field} must be a valid ISO timestamp.`, { field });
  return new Date(result).toISOString();
}

function createRecordEnvelope(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_ENVELOPE_INVALID", "A memory record envelope must be an object.");
  for (const key of Object.keys(input)) assert(ENVELOPE_FIELDS.has(key), "MEMORY_ENVELOPE_UNKNOWN_FIELD", `Unknown memory envelope field: ${key}.`, { field: key });
  assert(Number(input.schema_version || SCHEMA_VERSION) === SCHEMA_VERSION, "MEMORY_SCHEMA_VERSION_UNSUPPORTED", "Unsupported memory envelope schema version.");
  const memoryType = String(input.memory_type || "");
  assert(MEMORY_TYPES.includes(memoryType), "MEMORY_TYPE_INVALID", "The memory envelope has an unsupported memory type.");
  const recordType = text(input.record_type, 120);
  assert(recordType.length > 0, "MEMORY_RECORD_TYPE_REQUIRED", "A record type is required.");
  assertOwner(memoryType, recordType);
  const recordId = assertMemoryId(input.record_id);
  const projectId = assertMemoryId(input.project_id, "proj");
  const revisionCreated = Number(input.revision_created);
  const revisionUpdated = Number(input.revision_updated);
  assert(Number.isInteger(revisionCreated) && revisionCreated >= 0, "MEMORY_REVISION_INVALID", "revision_created must be a non-negative integer.");
  assert(Number.isInteger(revisionUpdated) && revisionUpdated >= revisionCreated, "MEMORY_REVISION_INVALID", "revision_updated must be an integer at least revision_created.");
  const state = text(input.state, 80);
  assert(state.length > 0, "MEMORY_STATE_REQUIRED", "A lifecycle state is required.");
  assertActor(input.actor);
  assertProvenance(input.provenance);
  const payload = cloneBounded(input.payload && typeof input.payload === "object" ? input.payload : {});
  const record = {
    schema_version: SCHEMA_VERSION,
    memory_type: memoryType,
    record_type: recordType,
    record_id: recordId,
    project_id: projectId,
    revision_created: revisionCreated,
    revision_updated: revisionUpdated,
    state,
    created_at: isoTimestamp(input.created_at, "created_at"),
    updated_at: isoTimestamp(input.updated_at, "updated_at"),
    actor: cloneBounded(input.actor),
    provenance: cloneBounded(input.provenance),
    sensitivity: assertSensitivity(input.sensitivity || "confidential"),
    operation_id: text(input.operation_id, 240),
    payload,
    ...(input.extensions === undefined ? {} : { extensions: cloneBounded(input.extensions) }),
  };
  assert(record.operation_id.length > 0, "MEMORY_OPERATION_ID_REQUIRED", "A memory record requires an operation ID.");
  assert(Buffer.byteLength(JSON.stringify(record), "utf8") <= MAX_RECORD_BYTES, "MEMORY_RECORD_TOO_LARGE", "The memory record exceeds the maximum serialized size.", { maximumBytes: MAX_RECORD_BYTES });
  return Object.freeze(record);
}

function createMutationCommand(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_MUTATION_INVALID", "A mutation command must be an object.");
  const operationId = text(input.operation_id, 240);
  const idempotencyKey = text(input.idempotency_key || operationId, 240);
  const projectId = assertMemoryId(input.project_id, "proj");
  const memoryType = String(input.memory_type || "");
  assert(MEMORY_TYPES.includes(memoryType), "MEMORY_TYPE_INVALID", "Mutation memory type is unsupported.");
  const expectedBaseRevision = Number(input.expected_base_revision);
  assert(Number.isInteger(expectedBaseRevision) && expectedBaseRevision >= 0, "MEMORY_REVISION_INVALID", "expected_base_revision must be a non-negative integer.");
  assert(operationId.length > 0, "MEMORY_OPERATION_ID_REQUIRED", "A mutation requires an operation ID.");
  assert(idempotencyKey.length > 0, "MEMORY_IDEMPOTENCY_KEY_REQUIRED", "A mutation requires an idempotency key.");
  assertActor(input.actor);
  assertProvenance(input.provenance);
  const result = {
    schema_version: SCHEMA_VERSION,
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    block_id: input.block_id ? assertMemoryId(input.block_id, "block") : null,
    sealed_event_range: input.sealed_event_range && typeof input.sealed_event_range === "object" ? cloneBounded(input.sealed_event_range) : null,
    finalization_position: input.finalization_position == null ? null : Number(input.finalization_position),
    project_id: projectId,
    memory_type: memoryType,
    expected_base_revision: expectedBaseRevision,
    actor: cloneBounded(input.actor),
    session_id: input.session_id ? assertMemoryId(input.session_id, "session") : null,
    mutation_type: text(input.mutation_type, 120),
    target_record_id: input.target_record_id ? assertMemoryId(input.target_record_id) : null,
    canonical_key: input.canonical_key === undefined ? null : cloneBounded(input.canonical_key),
    payload: cloneBounded(input.payload && typeof input.payload === "object" ? input.payload : {}),
    provenance: cloneBounded(input.provenance),
    sensitivity: assertSensitivity(input.sensitivity || "confidential"),
  };
  assert(result.mutation_type.length > 0, "MEMORY_MUTATION_TYPE_REQUIRED", "A mutation type is required.");
  if (result.finalization_position !== null) assert(Number.isInteger(result.finalization_position) && result.finalization_position >= 0, "MEMORY_FINALIZATION_POSITION_INVALID", "finalization_position must be a non-negative integer.");
  return Object.freeze(result);
}

function createQueryRequest(input = {}) {
  const projectId = assertMemoryId(input.project_id, "proj");
  const limit = input.limit == null ? 50 : Number(input.limit);
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 200, "MEMORY_QUERY_LIMIT_INVALID", "Query limit must be between 1 and 200.");
  const graphDepth = input.graph_depth == null ? 1 : Number(input.graph_depth);
  assert(Number.isInteger(graphDepth) && graphDepth >= 0 && graphDepth <= 3, "MEMORY_GRAPH_DEPTH_INVALID", "Graph depth must be between 0 and 3.");
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    project_id: projectId,
    objective: text(input.objective, 2_000),
    domains: [...new Set((Array.isArray(input.domains) ? input.domains : []).map(String).filter(Boolean))],
    filters: cloneBounded(input.filters && typeof input.filters === "object" ? input.filters : {}),
    source_revisions: cloneBounded(input.source_revisions && typeof input.source_revisions === "object" ? input.source_revisions : {}),
    limit,
    cursor: text(input.cursor, 1_000),
    token_budget: input.token_budget == null ? 0 : Math.max(0, Number(input.token_budget) || 0),
    sensitivity_ceiling: assertSensitivity(input.sensitivity_ceiling || "confidential"),
    graph_depth: graphDepth,
    expand_artifacts: Boolean(input.expand_artifacts),
  });
}

function createRevisionManifest(input = {}) {
  const projectId = assertMemoryId(input.project_id, "proj");
  const domains = input.domains && typeof input.domains === "object" ? input.domains : {};
  const result = { schema_version: SCHEMA_VERSION, project_id: projectId, domains: {}, graph_projection_revision: Number(input.graph_projection_revision || 0), knowledge_base_release: text(input.knowledge_base_release, 240), finalization_watermark: cloneBounded(input.finalization_watermark && typeof input.finalization_watermark === "object" ? input.finalization_watermark : {}) };
  for (const [key, value] of Object.entries(domains)) {
    const revision = Number(value);
    assert(Number.isInteger(revision) && revision >= 0, "MEMORY_REVISION_INVALID", "Domain revisions must be non-negative integers.", { domain: key });
    result.domains[text(key, 80)] = revision;
  }
  return Object.freeze(result);
}

function mutationResult(input = {}) {
  const previousRevision = Number(input.previousRevision || 0);
  const revision = Number(input.revision == null ? previousRevision : input.revision);
  assert(Number.isInteger(previousRevision) && previousRevision >= 0, "MEMORY_REVISION_INVALID", "previousRevision must be a non-negative integer.");
  assert(Number.isInteger(revision) && revision >= previousRevision, "MEMORY_REVISION_INVALID", "revision must be at least previousRevision.");
  return Object.freeze({ ok: true, operationId: text(input.operationId, 240), recordIds: [...new Set((Array.isArray(input.recordIds) ? input.recordIds : []).map((id) => assertMemoryId(id)))], previousRevision, revision, changed: Boolean(input.changed), conflicts: Array.isArray(input.conflicts) ? cloneBounded(input.conflicts) : [], warnings: Array.isArray(input.warnings) ? cloneBounded(input.warnings) : [] });
}

module.exports = Object.freeze({ SCHEMA_VERSION, MAX_RECORD_BYTES, createRecordEnvelope, createMutationCommand, createQueryRequest, createRevisionManifest, mutationResult, validateRecordEnvelope: (input) => validate(createRecordEnvelope, input), validateMutationCommand: (input) => validate(createMutationCommand, input), validateQueryRequest: (input) => validate(createQueryRequest, input) });
