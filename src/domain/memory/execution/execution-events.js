"use strict";

const nodeCrypto = require("node:crypto");
const { assert, assertMemoryId, assertActor, assertProvenance, assertSensitivity, createOpaqueId } = require("../../../contracts/memory/index.js");

const EXECUTION_EVENT_SCHEMA_VERSION = 1;
const EXECUTION_EVENT_TYPES = Object.freeze([
  "tool_invocation_started",
  "tool_result_captured",
  "artifact_registered",
  "verification_verdict",
  "process_state",
  "specialist_return",
  "operator_assertion",
  "block_completed",
  "block_failed",
  "block_cancelled",
  "block_interrupted",
]);
const EXECUTION_EVENT_TYPE_SET = new Set(EXECUTION_EVENT_TYPES);
const SECRET_KEY = /^(?:raw[_-]?cookie|cookie(?:[_-]?(?:value|header))?|set[_-]?cookie|authorization(?:[_-]?header)?|proxy[_-]?authorization|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret(?:[_-]?value)?|raw[_-]?value|password|credential)$/i;
const MAX_DEPTH = 8;
const MAX_ARRAY = 200;
const MAX_OBJECT_KEYS = 120;

function text(value, maximum = 4_000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function sanitize(value, redactedFields, path = "", depth = 0) {
  assert(depth <= MAX_DEPTH, "MEMORY_PAYLOAD_TOO_DEEP", "Execution event payloads may not be nested this deeply.");
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, 8_000);
  if (Array.isArray(value)) {
    assert(value.length <= MAX_ARRAY, "MEMORY_ARRAY_TOO_LARGE", "Execution event arrays exceed the supported item count.");
    return value.map((entry, index) => sanitize(entry, redactedFields, path ? `${path}[${index}]` : `[${index}]`, depth + 1));
  }
  assert(typeof value === "object", "MEMORY_PAYLOAD_INVALID", "Execution event payloads must be JSON-compatible.");
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    const cleanKey = text(key, 120);
    const childPath = path ? `${path}.${cleanKey}` : cleanKey;
    if (SECRET_KEY.test(cleanKey)) {
      redactedFields.push(childPath);
      result[`${cleanKey}_redacted`] = true;
      continue;
    }
    result[cleanKey] = sanitize(child, redactedFields, childPath, depth + 1);
  }
  return result;
}

function defaultActor(value) {
  const source = value && typeof value === "object" ? value : {};
  return { type: source.type || "agent", id: text(source.id || "execution-capture", 240) };
}

function defaultProvenance(value, blockId, now) {
  const source = value && typeof value === "object" ? value : {};
  return {
    source_type: source.source_type || source.sourceType || "runtime_event",
    source_refs: Array.isArray(source.source_refs || source.sourceRefs) && (source.source_refs || source.sourceRefs).length
      ? [...new Set((source.source_refs || source.sourceRefs).map((entry) => text(entry, 300)).filter(Boolean))].slice(0, 50)
      : [`block:${blockId}`],
    captured_at: source.captured_at || source.capturedAt || now,
    ...(source.tool_name || source.toolName ? { tool_name: text(source.tool_name || source.toolName, 160) } : {}),
  };
}

function createExecutionEvent(input = {}, { now = () => new Date(), crypto = nodeCrypto, idFactory = null } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_EXECUTION_EVENT_INVALID", "An execution event must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const blockId = assertMemoryId(input.block_id || input.blockId, "block");
  const operationId = assertMemoryId(input.operation_id || input.operationId, "op");
  const eventType = text(input.event_type || input.eventType || input.type, 120).toLowerCase();
  assert(EXECUTION_EVENT_TYPE_SET.has(eventType), "MEMORY_EXECUTION_EVENT_TYPE_INVALID", `Unsupported execution event type: ${eventType || "<empty>"}.`);
  const eventId = input.event_id || input.eventId || (typeof idFactory === "function" ? idFactory("event") : createOpaqueId("event", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }));
  assertMemoryId(eventId, "event");
  const occurredAtValue = input.occurred_at || input.occurredAt || (typeof now === "function" ? now() : now);
  const occurredAt = new Date(occurredAtValue);
  assert(!Number.isNaN(occurredAt.getTime()), "MEMORY_TIMESTAMP_INVALID", "Execution event occurred_at must be a valid timestamp.");
  const blockSequence = Number(input.block_sequence ?? input.blockSequence ?? 1);
  assert(Number.isInteger(blockSequence) && blockSequence >= 1, "MEMORY_EXECUTION_SEQUENCE_INVALID", "Execution event block_sequence must be a positive integer.");
  const redactedFields = [];
  const payload = sanitize(input.payload && typeof input.payload === "object" ? input.payload : {}, redactedFields);
  const artifactRefs = [...new Set((Array.isArray(input.artifact_refs || input.artifactRefs) ? (input.artifact_refs || input.artifactRefs) : []).map((entry) => assertMemoryId(entry, "artifact")))].slice(0, 100);
  const sourceIds = [...new Set((Array.isArray(input.source_ids || input.sourceIds) ? (input.source_ids || input.sourceIds) : []).map((entry) => text(entry, 300)).filter(Boolean))].slice(0, 100);
  const actor = defaultActor(input.actor);
  const provenance = defaultProvenance(input.provenance, blockId, occurredAt.toISOString());
  assertActor(actor);
  assertProvenance(provenance);
  const sensitivity = assertSensitivity(input.sensitivity || "internal");
  const authority = input.authority && typeof input.authority === "object" ? sanitize(input.authority, redactedFields, "authority") : {};
  const event = {
    schema_version: EXECUTION_EVENT_SCHEMA_VERSION,
    event_class: "execution",
    event_id: eventId,
    project_id: projectId,
    block_id: blockId,
    operation_id: operationId,
    block_sequence: blockSequence,
    event_type: eventType,
    occurred_at: occurredAt.toISOString(),
    actor,
    provenance,
    sensitivity,
    authority,
    artifact_refs: artifactRefs,
    source_ids: sourceIds,
    payload,
    ...(redactedFields.length ? { redacted_fields: [...new Set(redactedFields)].sort() } : {}),
  };
  return Object.freeze(event);
}

function validateExecutionEvent(input, options = {}) {
  try { return { ok: true, event: createExecutionEvent(input, options) }; } catch (error) {
    return { ok: false, code: error.code || "MEMORY_EXECUTION_EVENT_INVALID", error: error.message, retryable: Boolean(error.retryable), details: error.details || {} };
  }
}

module.exports = Object.freeze({
  EXECUTION_EVENT_SCHEMA_VERSION,
  EXECUTION_EVENT_TYPES,
  EXECUTION_EVENT_TYPE_SET,
  createExecutionEvent,
  validateExecutionEvent,
});
