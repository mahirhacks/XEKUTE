"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId, canonicalKeyHash, createOpaqueId } = require("./memory-identity.js");
const {
  assertActor,
  assertProvenance,
  assertSensitivity,
} = require("./memory-lifecycle.js");

const OPERATIONAL_CONTEXT_SCHEMA_VERSION = 1;
const MAX_LIST = 500;
const MAX_REFS = 500;
const MAX_TEXT = 8_000;
const MAX_SYNOPSIS_TEXT = 20_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const SECRET_KEY = /(?:^|[_-])(raw|secret|password|passwd|token|cookie|authorization|credential|private[_-]?key|passphrase|nonce|bearer)(?:$|[_-])/i;
const RAW_VALUE_KEY = /^(?:value|raw|body|request|response|stdout|stderr|headers?|payload|content)$/i;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = MAX_TEXT, { preserveNewlines = false } = {}) {
  const result = String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  assert(result.length <= maximum, "MEMORY_CONTEXT_FIELD_TOO_LARGE", "An operational-context field exceeds its maximum length.", { maximum });
  return preserveNewlines ? result : result.replace(/[\r\n]/g, " ");
}

function identifier(value, field, { required = false, fallback = "" } = {}) {
  const result = text(value || fallback, 240);
  if (required) assert(result, "MEMORY_CONTEXT_IDENTIFIER_REQUIRED", `${field} is required.`, { field });
  if (result) assert(ID_PATTERN.test(result), "MEMORY_CONTEXT_IDENTIFIER_INVALID", `${field} is invalid.`, { field });
  return result;
}

function sessionId(value, field = "session_id") {
  return identifier(value, field, { required: true });
}

function list(value, field, maximum = MAX_LIST, itemMaximum = 1_000) {
  assert(value === undefined || Array.isArray(value), "MEMORY_CONTEXT_LIST_INVALID", `${field} must be an array.`, { field });
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry, itemMaximum))
    .filter(Boolean))].slice(0, maximum);
}

function object(value, field, { maxKeys = 100, allowRawKeys = false } = {}) {
  assert(value === undefined || (value && typeof value === "object" && !Array.isArray(value)), "MEMORY_CONTEXT_OBJECT_INVALID", `${field} must be an object.`, { field });
  const source = value && typeof value === "object" ? value : {};
  assert(Object.keys(source).length <= maxKeys, "MEMORY_CONTEXT_OBJECT_TOO_LARGE", `${field} contains too many keys.`, { field, maximum: maxKeys });
  return safeClone(source, 0, field, { allowRawKeys });
}

function safeClone(value, depth = 0, key = "", { allowRawKeys = false } = {}) {
  assert(depth <= 8, "MEMORY_CONTEXT_PAYLOAD_TOO_DEEP", "Operational context values may not be nested this deeply.");
  const keyText = String(key || "");
  if (SECRET_KEY.test(keyText) || (!allowRawKeys && RAW_VALUE_KEY.test(keyText))) {
    assert(false, "MEMORY_CONTEXT_SECRET_FIELD", "Raw secret or body fields are not permitted in Operational Context.", { field: keyText });
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, MAX_TEXT, { preserveNewlines: true });
  if (Array.isArray(value)) {
    assert(value.length <= MAX_LIST, "MEMORY_CONTEXT_ARRAY_TOO_LARGE", "Operational context arrays are too large.");
    return value.map((entry) => safeClone(entry, depth + 1, "", { allowRawKeys }));
  }
  assert(typeof value === "object", "MEMORY_CONTEXT_VALUE_INVALID", "Operational context values must be JSON-compatible.");
  return Object.entries(value).reduce((result, [childKey, child]) => {
    result[text(childKey, 120)] = safeClone(child, depth + 1, childKey, { allowRawKeys });
    return result;
  }, {});
}

function iso(value, field, fallback = new Date()) {
  const raw = value == null || value === "" ? fallback : value;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  assert(!Number.isNaN(date.getTime()), "MEMORY_CONTEXT_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function revision(value, field, fallback = 0) {
  const number = value == null || value === "" ? fallback : Number(value);
  assert(Number.isSafeInteger(number) && number >= 0, "MEMORY_CONTEXT_REVISION_INVALID", `${field} must be a non-negative integer.`, { field });
  return number;
}

function hash(value, field, { required = false } = {}) {
  const result = text(value, 64).toLowerCase();
  if (!result && !required) return "";
  assert(HASH_PATTERN.test(result), "MEMORY_CONTEXT_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  return result;
}

function id(value, prefix = "event", field = "record_id") {
  if (value) return assertMemoryId(value, prefix);
  return createOpaqueId(prefix);
}

function actorOf(input = {}) {
  const actor = input.actor ? safeClone(input.actor) : { type: "system", id: "operational-context" };
  assertActor(actor);
  return actor;
}

function provenanceOf(input = {}, sourceRefs = []) {
  const provenance = input.provenance
    ? safeClone(input.provenance)
    : { source_type: "runtime_event", source_refs: sourceRefs, captured_at: new Date().toISOString() };
  assertProvenance(provenance);
  return provenance;
}

function sensitivityOf(value = "internal") {
  return assertSensitivity(value || "internal");
}

function safeRefs(value, field = "refs", maximum = MAX_REFS) {
  return list(value, field, maximum, 240);
}

function baseRecord(input, recordType, { prefix = "event", recordId = "" } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_CONTEXT_RECORD_INVALID", `${recordType} must be an object.`);
  // Scan the complete producer payload before projecting known fields. This
  // prevents an unexpected raw body or secret field from being silently
  // ignored by a narrower constructor.
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const createdAt = iso(input.created_at || input.createdAt, "created_at");
  const updatedAt = iso(input.updated_at || input.updatedAt, "updated_at", createdAt);
  const result = {
    schema_version: OPERATIONAL_CONTEXT_SCHEMA_VERSION,
    memory_type: "session",
    record_type: recordType,
    record_id: id(input.record_id || input.recordId || recordId, prefix),
    project_id: projectId,
    created_at: createdAt,
    updated_at: updatedAt,
    actor: actorOf(input),
    provenance: provenanceOf(input, input.source_refs || input.sourceRefs || []),
    sensitivity: sensitivityOf(input.sensitivity || "internal"),
  };
  return result;
}

function createTranscriptBoundary(input = {}) {
  const result = baseRecord(input, "transcript_boundary");
  result.session_id = sessionId(input.session_id || input.sessionId);
  result.first_block_id = identifier(input.first_block_id || input.firstBlockId, "first_block_id");
  result.last_block_id = identifier(input.last_block_id || input.lastBlockId, "last_block_id");
  result.first_message_id = identifier(input.first_message_id || input.firstMessageId, "first_message_id");
  result.last_message_id = identifier(input.last_message_id || input.lastMessageId, "last_message_id");
  result.block_count = revision(input.block_count ?? input.blockCount, "block_count");
  result.message_count = revision(input.message_count ?? input.messageCount, "message_count");
  result.transcript_hash = hash(input.transcript_hash || input.transcriptHash, "transcript_hash", { required: true });
  result.source_revision = revision(input.source_revision ?? input.sourceRevision, "source_revision");
  result.status = text(input.status || "sealed", 40).toLowerCase();
  assert(["open", "sealed", "merged"].includes(result.status), "MEMORY_CONTEXT_BOUNDARY_STATUS_INVALID", "Transcript boundary status is invalid.");
  result.block_ids = safeRefs(input.block_ids || input.blockIds, "block_ids");
  result.message_ids = safeRefs(input.message_ids || input.messageIds, "message_ids");
  return Object.freeze(result);
}

function createHandleMetadata(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const result = {
    handle_id: identifier(source.handle_id || source.handleId, "handle_id"),
    entry_type: text(source.entry_type || source.entryType, 80),
    origin: text(source.origin, 2_000),
    status: text(source.status || "active", 40).toLowerCase(),
    expires_at: source.expires_at || source.expiresAt ? iso(source.expires_at || source.expiresAt, "expires_at") : null,
  };
  assert(result.handle_id && !SECRET_KEY.test(result.handle_id), "MEMORY_CONTEXT_HANDLE_METADATA_INVALID", "Safe handle metadata requires an opaque handle ID.");
  assert(result.entry_type.length > 0, "MEMORY_CONTEXT_HANDLE_METADATA_INVALID", "Safe handle metadata requires an entry type.");
  assert(["active", "rotated", "revoked", "expired", "deleted", "unknown"].includes(result.status), "MEMORY_CONTEXT_HANDLE_STATUS_INVALID", "Safe handle metadata status is invalid.");
  return result;
}

function createToolLedgerEntry(input = {}) {
  const result = baseRecord(input, "tool_ledger_entry");
  result.session_id = sessionId(input.session_id || input.sessionId);
  result.ledger_id = result.record_id;
  result.category = text(input.category || "tool", 40).toLowerCase();
  assert(["tool", "traffic"].includes(result.category), "MEMORY_CONTEXT_LEDGER_CATEGORY_INVALID", "A ledger entry category is invalid.");
  result.fingerprint = hash(input.fingerprint, "fingerprint", { required: true });
  result.tool_name = text(input.tool_name || input.toolName, 160);
  assert(result.tool_name, "MEMORY_CONTEXT_TOOL_NAME_REQUIRED", "A ledger entry requires a tool name.");
  result.target_key = text(input.target_key || input.targetKey, 2_000);
  result.identity_ref = identifier(input.identity_ref || input.identityRef, "identity_ref");
  result.role = text(input.role, 160);
  result.auth_state = text(input.auth_state || input.authState, 160);
  result.terminal_outcome = text(input.terminal_outcome || input.terminalOutcome || input.outcome || "unknown", 80).toLowerCase();
  result.status = text(input.status || "observed", 40).toLowerCase();
  result.response_schema_hash = hash(input.response_schema_hash || input.responseSchemaHash, "response_schema_hash");
  result.variation_flags = safeRefs(input.variation_flags || input.variationFlags, "variation_flags", 50);
  result.count = Math.max(1, revision(input.count, "count", 1));
  result.failure_count = revision(input.failure_count ?? input.failureCount, "failure_count");
  result.retry_count = revision(input.retry_count ?? input.retryCount, "retry_count");
  result.omitted_count = revision(input.omitted_count ?? input.omittedCount, "omitted_count");
  result.first_observed_at = iso(input.first_observed_at || input.firstObservedAt, "first_observed_at", result.created_at);
  result.last_observed_at = iso(input.last_observed_at || input.lastObservedAt, "last_observed_at", result.updated_at);
  result.representative_artifact_refs = safeRefs(input.representative_artifact_refs || input.representativeArtifactRefs, "representative_artifact_refs", 100);
  result.failure_artifact_refs = safeRefs(input.failure_artifact_refs || input.failureArtifactRefs, "failure_artifact_refs", 100);
  result.source_message_ids = safeRefs(input.source_message_ids || input.sourceMessageIds, "source_message_ids", 100);
  result.canonical_key_hash = hash(input.canonical_key_hash || input.canonicalKeyHash || canonicalKeyHash({
    project_id: result.project_id,
    session_id: result.session_id,
    category: result.category,
    tool_name: result.tool_name.toLowerCase(),
    target_key: result.target_key,
    identity_ref: result.identity_ref,
    role: result.role,
    auth_state: result.auth_state,
    terminal_outcome: result.terminal_outcome,
    status: result.status,
    response_schema_hash: result.response_schema_hash,
    variation_flags: result.variation_flags,
  }), "canonical_key_hash", { required: true });
  return Object.freeze(result);
}

function createConversationSynopsis(input = {}) {
  const result = baseRecord(input, "conversation_synopsis");
  result.session_id = sessionId(input.session_id || input.sessionId);
  result.boundary_id = identifier(input.boundary_id || input.boundaryId, "boundary_id");
  result.generated_by = text(input.generated_by || input.generatedBy || "deterministic", 40).toLowerCase();
  assert(["deterministic", "model"].includes(result.generated_by), "MEMORY_CONTEXT_SYNOPSIS_GENERATOR_INVALID", "Synopsis generator must be deterministic or model.");
  result.objective = text(input.objective, MAX_SYNOPSIS_TEXT, { preserveNewlines: true });
  result.constraints = list(input.constraints, "constraints", 100, 2_000);
  result.decisions = list(input.decisions, "decisions", 200, 2_000);
  result.blockers = list(input.blockers, "blockers", 200, 2_000);
  result.unresolved_questions = list(input.unresolved_questions || input.unresolvedQuestions, "unresolved_questions", 200, 2_000);
  result.next_actions = list(input.next_actions || input.nextActions, "next_actions", 200, 2_000);
  result.known_gaps = list(input.known_gaps || input.knownGaps, "known_gaps", 200, 2_000);
  result.retained_refs = safeRefs(input.retained_refs || input.retainedRefs, "retained_refs", 200);
  result.source_message_ids = safeRefs(input.source_message_ids || input.sourceMessageIds, "source_message_ids", 500);
  result.source_record_ids = safeRefs(input.source_record_ids || input.sourceRecordIds, "source_record_ids", 500);
  result.validation = object(input.validation, "validation", { maxKeys: 30 });
  result.content_hash = hash(input.content_hash || input.contentHash || canonicalKeyHash({
    boundary_id: result.boundary_id,
    generated_by: result.generated_by,
    objective: result.objective,
    constraints: result.constraints,
    decisions: result.decisions,
    blockers: result.blockers,
    unresolved_questions: result.unresolved_questions,
    next_actions: result.next_actions,
    known_gaps: result.known_gaps,
    retained_refs: result.retained_refs,
    source_message_ids: result.source_message_ids,
    source_record_ids: result.source_record_ids,
  }), "content_hash", { required: true });
  return Object.freeze(result);
}

function createOperationalContextCheckpoint(input = {}) {
  const result = baseRecord(input, "operational_context_checkpoint");
  result.session_id = sessionId(input.session_id || input.sessionId);
  result.checkpoint_id = result.record_id;
  result.operation_id = assertMemoryId(input.operation_id || input.operationId || createOpaqueId("op"), "op");
  result.revision = revision(input.revision, "revision");
  result.previous_revision = revision(input.previous_revision ?? input.previousRevision, "previous_revision");
  assert(result.revision >= result.previous_revision, "MEMORY_CONTEXT_REVISION_INVALID", "Checkpoint revision cannot precede its previous revision.");
  result.trigger = text(input.trigger || "explicit", 40).toLowerCase();
  assert(["prepare", "compress", "urgent", "emergency", "handoff", "close", "model_change", "explicit", "recovery"].includes(result.trigger), "MEMORY_CONTEXT_TRIGGER_INVALID", "Checkpoint trigger is invalid.");
  result.objective = text(input.objective, MAX_SYNOPSIS_TEXT, { preserveNewlines: true });
  result.completion_criteria = list(input.completion_criteria || input.completionCriteria, "completion_criteria", 100, 2_000);
  result.operator_constraints = list(input.operator_constraints || input.operatorConstraints, "operator_constraints", 100, 2_000);
  result.decisions = list(input.decisions, "decisions", 200, 2_000);
  result.mode = text(input.mode, 100);
  result.phase = text(input.phase, 160);
  result.active_investigations = safeRefs(input.active_investigations || input.activeInvestigations, "active_investigations", 200);
  result.active_processes = safeRefs(input.active_processes || input.activeProcesses, "active_processes", 200);
  result.blockers = list(input.blockers, "blockers", 200, 2_000);
  result.unresolved_questions = list(input.unresolved_questions || input.unresolvedQuestions, "unresolved_questions", 200, 2_000);
  result.next_actions = list(input.next_actions || input.nextActions, "next_actions", 200, 2_000);
  result.retained_refs = safeRefs(input.retained_refs || input.retainedRefs, "retained_refs", 500);
  result.source_revisions = object(input.source_revisions || input.sourceRevisions, "source_revisions", { maxKeys: 50 });
  for (const [key, value] of Object.entries(result.source_revisions)) result.source_revisions[key] = revision(value, `source_revisions.${key}`);
  result.known_gaps = list(input.known_gaps || input.knownGaps, "known_gaps", 200, 2_000);
  result.recent_tail_boundary = input.recent_tail_boundary || input.recentTailBoundary
    ? createTranscriptBoundary({
        ...(input.recent_tail_boundary || input.recentTailBoundary),
        project_id: result.project_id,
        session_id: result.session_id,
        actor: result.actor,
        provenance: result.provenance,
      })
    : null;
  result.safe_handle_metadata = (Array.isArray(input.safe_handle_metadata || input.safeHandleMetadata)
    ? (input.safe_handle_metadata || input.safeHandleMetadata)
    : []).slice(0, 200).map(createHandleMetadata);
  result.synopsis = input.synopsis ? createConversationSynopsis({
    ...(input.synopsis && typeof input.synopsis === "object" ? input.synopsis : {}),
    project_id: result.project_id,
    session_id: result.session_id,
    boundary_id: result.recent_tail_boundary?.record_id || result.record_id,
    actor: result.actor,
    provenance: result.provenance,
  }) : null;
  result.tool_ledger = (Array.isArray(input.tool_ledger || input.toolLedger)
    ? (input.tool_ledger || input.toolLedger)
    : []).slice(0, 500).map((entry) => createToolLedgerEntry({
      ...entry,
      project_id: result.project_id,
      session_id: result.session_id,
      actor: result.actor,
      provenance: result.provenance,
    }));
  result.pending_gaps = object(input.pending_gaps || input.pendingGaps, "pending_gaps", { maxKeys: 50 });
  result.transcript_boundary = input.transcript_boundary || input.transcriptBoundary
    ? createTranscriptBoundary({
        ...(input.transcript_boundary || input.transcriptBoundary),
        project_id: result.project_id,
        session_id: result.session_id,
        actor: result.actor,
        provenance: result.provenance,
      })
    : null;
  result.content_hash = hash(input.content_hash || input.contentHash || canonicalKeyHash({
    project_id: result.project_id,
    session_id: result.session_id,
    revision: result.revision,
    trigger: result.trigger,
    objective: result.objective,
    completion_criteria: result.completion_criteria,
    operator_constraints: result.operator_constraints,
    decisions: result.decisions,
    mode: result.mode,
    phase: result.phase,
    active_investigations: result.active_investigations,
    active_processes: result.active_processes,
    blockers: result.blockers,
    unresolved_questions: result.unresolved_questions,
    next_actions: result.next_actions,
    retained_refs: result.retained_refs,
    source_revisions: result.source_revisions,
    known_gaps: result.known_gaps,
    safe_handle_metadata: result.safe_handle_metadata,
    synopsis: result.synopsis,
    tool_ledger: result.tool_ledger,
    pending_gaps: result.pending_gaps,
    transcript_boundary: result.transcript_boundary,
  }), "content_hash", { required: true });
  return Object.freeze(result);
}

function validateSynopsis(input, options = {}) {
  const result = createConversationSynopsis(input);
  const allowedRefs = new Set((Array.isArray(options.allowedRefs) ? options.allowedRefs : []).map((value) => String(value)));
  const sourceIds = [...result.source_record_ids, ...result.retained_refs];
  const invented = allowedRefs.size ? sourceIds.filter((value) => !allowedRefs.has(value)) : [];
  assert(!invented.length, "MEMORY_CONTEXT_SYNOPSIS_UNKNOWN_REFERENCE", "The synopsis referenced an unknown record or handle.", { invented });
  const required = new Set((Array.isArray(options.requiredSourceMessageIds) ? options.requiredSourceMessageIds : []).map((value) => String(value)));
  const missing = [...required].filter((value) => !result.source_message_ids.includes(value));
  assert(!missing.length, "MEMORY_CONTEXT_SYNOPSIS_REQUIRED_RECORD_MISSING", "The synopsis omitted a required source message.", { missing });
  return result;
}

module.exports = Object.freeze({
  OPERATIONAL_CONTEXT_SCHEMA_VERSION,
  MAX_LIST,
  MAX_REFS,
  createTranscriptBoundary,
  createToolLedgerEntry,
  createConversationSynopsis,
  createOperationalContextCheckpoint,
  createHandleMetadata,
  validateSynopsis,
  validateTranscriptBoundary: (input) => validate(createTranscriptBoundary, input),
  validateToolLedgerEntry: (input) => validate(createToolLedgerEntry, input),
  validateConversationSynopsis: (input, options) => validate(() => validateSynopsis(input, options), input),
  validateOperationalContextCheckpoint: (input) => validate(createOperationalContextCheckpoint, input),
});
