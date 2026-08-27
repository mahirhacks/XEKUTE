"use strict";

const {
  assert,
  assertMemoryId,
  canonicalJson,
  canonicalKeyHash,
  createMutationCommand,
  mutationResult,
} = require("../../../contracts/memory/index.js");
const { cloneSafe } = require("../value-safety.js");
const {
  createProgrammeRecord,
  createInvestigationRecord,
  createApplicabilityRecord,
  createTestCaseRecord,
  createAssignmentRecord,
  createAttemptRecord,
  createNegativeResultRecord,
  createFindingCandidateRecord,
  createBlockerRecord,
  createCoverageRecord,
  assertInvestigationTransition,
  statusOf,
} = require("../../../contracts/memory/investigation-contracts.js");

const INVESTIGATION_MEMORY_SCHEMA_VERSION = 1;
const COLLECTIONS = Object.freeze([
  "programmes",
  "investigations",
  "applicability",
  "test_cases",
  "assignments",
  "attempts",
  "negative_results",
  "candidates",
  "blockers",
  "coverage",
  "remaining_work",
]);
const ALLOWED_MUTATIONS = Object.freeze([
  "upsert_programme",
  "upsert_investigation",
  "upsert_applicability",
  "upsert_test_case",
  "assign_test_case",
  "release_assignment",
  "record_attempt",
  "record_negative_result",
  "record_candidate",
  "set_candidate_verification",
  "upsert_blocker",
  "upsert_coverage",
  "mark_needs_retest",
  "set_investigation_status",
]);

function failure(code, error, details = {}, retryable = false) {
  return { ok: false, code, error: String(error || "Investigation Memory operation failed."), retryable: Boolean(retryable), details: details && typeof details === "object" ? details : {} };
}

function stamp(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  assert(!Number.isNaN(date.getTime()), "MEMORY_TIMESTAMP_INVALID", "The Investigation Memory clock returned an invalid date.");
  return date.toISOString();
}

function list(value, maximum = 10_000) {
  return Array.isArray(value) ? value.slice(-maximum).map((entry) => cloneSafe(entry)) : [];
}

function refsOf(provenance) {
  return [...new Set([
    ...(Array.isArray(provenance?.source_refs) ? provenance.source_refs : []),
    ...(Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))].sort().slice(0, 200);
}

function emptyInvestigationMemory(projectId, now = () => new Date()) {
  return {
    schema_version: INVESTIGATION_MEMORY_SCHEMA_VERSION,
    kind: "xekute-investigation-memory",
    memory_type: "investigation",
    project_id: assertMemoryId(projectId, "proj"),
    revision: 0,
    created_at: stamp(now),
    updated_at: stamp(now),
    programmes: [],
    investigations: [],
    applicability: [],
    test_cases: [],
    assignments: [],
    attempts: [],
    negative_results: [],
    candidates: [],
    blockers: [],
    coverage: [],
    remaining_work: [],
    changes: [],
    processed_operations: [],
  };
}

function normalizeInvestigationMemory(input, { projectId, now = () => new Date() } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : {};
  const sourceProject = String(source.project_id || source.projectId || projectId);
  assertMemoryId(sourceProject, "proj");
  assert(sourceProject === projectId, "MEMORY_PROJECT_MISMATCH", "Investigation Memory belongs to a different project.", { expectedProjectId: projectId, actualProjectId: sourceProject });
  const base = emptyInvestigationMemory(projectId, now);
  const result = { ...base, ...cloneSafe(source), schema_version: INVESTIGATION_MEMORY_SCHEMA_VERSION, kind: "xekute-investigation-memory", memory_type: "investigation", project_id: projectId };
  result.revision = Math.max(0, Number(source.revision) || 0);
  result.created_at = String(source.created_at || base.created_at);
  result.updated_at = String(source.updated_at || base.updated_at);
  for (const collection of COLLECTIONS) {
    result[collection] = list(source[collection]);
  }
  result.changes = list(source.changes);
  result.processed_operations = list(source.processed_operations);
  return result;
}

function payloadOf(command) {
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  return payload.record && typeof payload.record === "object" ? { ...payload.record, ...payload } : payload;
}

function eventTime(command, now) {
  return command.provenance?.captured_at || command.provenance?.capturedAt || stamp(now);
}

function decorate(record, command, revision, previous, now) {
  const capturedAt = eventTime(command, now);
  const previousRefs = Array.isArray(previous?.provenance_refs) ? previous.provenance_refs : [];
  return {
    ...record,
    project_id: command.project_id,
    operation_id: command.operation_id,
    revision_created: Number(previous?.revision_created ?? revision),
    revision_updated: revision,
    created_at: previous?.created_at || capturedAt,
    updated_at: stamp(now),
    actor: cloneSafe(command.actor),
    provenance: cloneSafe(record.provenance || command.provenance),
    provenance_refs: [...new Set([...previousRefs, ...refsOf(command.provenance)])].sort().slice(0, 200),
    last_observed_at: capturedAt,
  };
}

function materialRecord(record) {
  const result = cloneSafe(record);
  for (const field of ["operation_id", "revision_created", "revision_updated", "created_at", "updated_at", "actor", "provenance", "provenance_refs", "last_observed_at"]) delete result[field];
  return result;
}

function findIndex(collection, record) {
  if (!Array.isArray(collection)) return -1;
  const id = String(record.record_id || "").trim();
  const key = String(record.canonical_key_hash || "").trim();
  return collection.findIndex((entry) => (id && entry.record_id === id) || (key && entry.canonical_key_hash === key));
}

function upsertRecord(state, collectionName, record, command, revision, now, { allowStatus = true } = {}) {
  const collection = state[collectionName];
  const index = findIndex(collection, record);
  if (index < 0) {
    collection.push(decorate(record, command, revision, null, now));
    return { ok: true, changed: true, recordIds: [record.record_id], conflicts: [], warnings: [] };
  }
  const previous = collection[index];
  if (allowStatus && previous.state && record.state && previous.state !== record.state) {
    try { assertInvestigationTransition(previous.state, record.state); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
  }
  const merged = decorate({ ...previous, ...record, record_id: previous.record_id, canonical_key_hash: previous.canonical_key_hash || record.canonical_key_hash }, command, revision, previous, now);
  for (const field of ["programme_id", "investigation_id", "applicability_id", "test_case_id", "assignment_id", "attempt_id", "candidate_id", "blocker_id", "coverage_id"]) {
    if (previous[field]) merged[field] = previous[field];
  }
  const changed = canonicalJson(materialRecord(previous)) !== canonicalJson(materialRecord(merged)) || canonicalJson(previous.provenance_refs || []) !== canonicalJson(merged.provenance_refs || []);
  if (!changed) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
  collection[index] = merged;
  return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
}

function findById(state, collectionName, id) {
  const value = String(id || "").trim();
  return state[collectionName]?.find((record) => record.record_id === value) || null;
}

function requireReference(state, collectionName, id, message = "The referenced Investigation record was not found.") {
  const record = findById(state, collectionName, id);
  return record || failure("MEMORY_REFERENCE_NOT_FOUND", message, { recordId: String(id || "") });
}

function recordWithCommand(payload, command) {
  return {
    ...payload,
    project_id: command.project_id,
    actor: payload.actor || command.actor,
    provenance: payload.provenance || command.provenance,
  };
}

function applyOne(state, command, revision, now, idFactory) {
  if (!ALLOWED_MUTATIONS.includes(command.mutation_type)) return failure("MEMORY_INVESTIGATION_MUTATION_INVALID", `Unsupported Investigation Memory mutation: ${command.mutation_type}.`);
  const payload = payloadOf(command);
  try {
    if (command.mutation_type === "upsert_programme") {
      const record = createProgrammeRecord(recordWithCommand(payload, command), { idFactory });
      return upsertRecord(state, "programmes", record, command, revision, now);
    }
    if (command.mutation_type === "upsert_investigation") {
      const record = createInvestigationRecord(recordWithCommand(payload, command), { idFactory });
      if (record.programme_id && !findById(state, "programmes", record.programme_id)) return failure("MEMORY_REFERENCE_NOT_FOUND", "The Investigation programme does not exist.", { recordId: record.programme_id });
      const result = upsertRecord(state, "investigations", record, command, revision, now);
      if (result.ok && result.changed && record.programme_id) {
        const programme = findById(state, "programmes", record.programme_id);
        if (programme && !programme.investigation_ids.includes(result.recordIds[0])) programme.investigation_ids = [...programme.investigation_ids, result.recordIds[0]].sort();
      }
      return result;
    }
    if (command.mutation_type === "upsert_applicability") {
      const record = createApplicabilityRecord(recordWithCommand(payload, command), { idFactory });
      const reference = requireReference(state, "investigations", record.investigation_id, "The applicability record references an unknown Investigation.");
      if (reference.ok === false) return reference;
      return upsertRecord(state, "applicability", record, command, revision, now);
    }
    if (command.mutation_type === "upsert_test_case") {
      const record = createTestCaseRecord(recordWithCommand(payload, command), { idFactory });
      const reference = requireReference(state, "investigations", record.investigation_id, "The test case references an unknown Investigation.");
      if (reference.ok === false) return reference;
      const result = upsertRecord(state, "test_cases", record, command, revision, now);
      if (result.ok && result.changed) {
        const investigation = findById(state, "investigations", record.investigation_id);
        if (investigation && !investigation.test_case_ids.includes(result.recordIds[0])) investigation.test_case_ids = [...investigation.test_case_ids, result.recordIds[0]].sort();
      }
      return result;
    }
    if (command.mutation_type === "assign_test_case") {
      const record = createAssignmentRecord(recordWithCommand(payload, command), { idFactory });
      const testCase = requireReference(state, "test_cases", record.test_case_id, "The assignment references an unknown test case.");
      if (testCase.ok === false) return testCase;
      const investigation = requireReference(state, "investigations", record.investigation_id, "The assignment references an unknown Investigation.");
      if (investigation.ok === false) return investigation;
      const active = state.assignments.find((entry) => entry.test_case_id === record.test_case_id && entry.exclusive && !["released", "expired", "cancelled"].includes(entry.state) && entry.record_id !== record.record_id);
      if (active) return failure("MEMORY_ASSIGNMENT_CONFLICT", "The exclusive test case is already assigned.", { assignmentId: active.record_id, testCaseId: record.test_case_id }, true);
      return upsertRecord(state, "assignments", record, command, revision, now);
    }
    if (command.mutation_type === "release_assignment") {
      const assignmentId = command.target_record_id || payload.assignment_id || payload.assignmentId;
      const index = state.assignments.findIndex((entry) => entry.record_id === String(assignmentId || ""));
      if (index < 0) return failure("MEMORY_REFERENCE_NOT_FOUND", "The assignment to release was not found.", { recordId: String(assignmentId || "") });
      const previous = state.assignments[index];
      const next = decorate({ ...previous, state: "cancelled", release_reason: String(payload.reason || payload.release_reason || "released").slice(0, 500) }, command, revision, previous, now);
      if (canonicalJson(materialRecord(previous)) === canonicalJson(materialRecord(next))) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.assignments[index] = next;
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    if (command.mutation_type === "set_candidate_verification") {
      const candidateId = command.target_record_id || payload.candidate_id || payload.candidateId;
      const index = state.candidates.findIndex((entry) => entry.record_id === String(candidateId || "") || entry.candidate_id === String(candidateId || ""));
      if (index < 0) return failure("MEMORY_REFERENCE_NOT_FOUND", "The finding candidate was not found.", { recordId: String(candidateId || "") });
      const previous = state.candidates[index];
      const nextStatus = String(payload.verification_status || payload.verificationStatus || "").trim().toLowerCase();
      const allowedStatuses = new Set(["unverified", "inconclusive", "verified", "rejected", "needs_retest"]);
      if (!allowedStatuses.has(nextStatus)) return failure("MEMORY_CANDIDATE_VERIFICATION_STATUS_INVALID", "The candidate verification status is unsupported.", { status: nextStatus });
      const next = decorate({
        ...previous,
        verification_status: nextStatus,
        verification_record_id: payload.verification_record_id || payload.verificationRecordId || previous.verification_record_id || "",
        verification_reason: String(payload.reason || payload.verification_reason || previous.verification_reason || "").slice(0, 4_000),
        verification_refs: Array.isArray(payload.verification_refs || payload.verificationRefs) ? cloneSafe(payload.verification_refs || payload.verificationRefs).slice(0, 100) : (previous.verification_refs || []),
      }, command, revision, previous, now);
      if (canonicalJson(materialRecord(previous)) === canonicalJson(materialRecord(next))) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.candidates[index] = next;
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    if (command.mutation_type === "mark_needs_retest" || command.mutation_type === "set_investigation_status") {
      const investigationId = command.target_record_id || payload.investigation_id || payload.investigationId;
      const index = state.investigations.findIndex((entry) => entry.record_id === String(investigationId || ""));
      if (index < 0) return failure("MEMORY_REFERENCE_NOT_FOUND", "The target Investigation was not found.", { recordId: String(investigationId || "") });
      const previous = state.investigations[index];
      const nextStatus = command.mutation_type === "mark_needs_retest" ? "needs_retest" : statusOf(payload.status || payload.state);
      try { assertInvestigationTransition(previous.state, nextStatus); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
      if (previous.state === nextStatus) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.investigations[index] = decorate({ ...previous, state: nextStatus, status_reason: String(payload.reason || "").slice(0, 2_000) }, command, revision, previous, now);
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    if (command.mutation_type === "record_attempt" || command.mutation_type === "record_negative_result" || command.mutation_type === "record_candidate" || command.mutation_type === "upsert_blocker" || command.mutation_type === "upsert_coverage") {
      const fallbackType = command.mutation_type === "record_attempt" ? "attempt" : command.mutation_type === "record_negative_result" ? "negative_result" : command.mutation_type === "record_candidate" ? "finding_candidate" : command.mutation_type === "upsert_blocker" ? "blocker" : "coverage";
      const supplied = { ...recordWithCommand(payload, command), record_type: payload.record_type || fallbackType };
      const record = fallbackType === "attempt"
        ? createAttemptRecord(supplied, { idFactory })
        : fallbackType === "negative_result"
          ? createNegativeResultRecord(supplied, { idFactory })
          : fallbackType === "finding_candidate"
            ? createFindingCandidateRecord(supplied, { idFactory })
            : fallbackType === "blocker"
              ? createBlockerRecord(supplied, { idFactory })
              : createCoverageRecord(supplied, { idFactory });
      const investigationId = record.investigation_id || record.investigationId;
      if (investigationId && !findById(state, "investigations", investigationId)) return failure("MEMORY_REFERENCE_NOT_FOUND", "The Investigation record does not exist.", { recordId: String(investigationId) });
      const collectionName = fallbackType === "attempt" ? "attempts" : fallbackType === "negative_result" ? "negative_results" : fallbackType === "finding_candidate" ? "candidates" : fallbackType === "blocker" ? "blockers" : "coverage";
      return upsertRecord(state, collectionName, record, command, revision, now, { allowStatus: false });
    }
  } catch (error) {
    return failure(error.code || "MEMORY_INVESTIGATION_RECORD_INVALID", error.message, error.details || {});
  }
  return failure("MEMORY_INVESTIGATION_MUTATION_INVALID", "The Investigation Memory mutation was not handled.");
}

function sortState(state) {
  for (const collection of COLLECTIONS) state[collection].sort((left, right) => String(left.record_id || "").localeCompare(String(right.record_id || "")));
  state.changes.sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0) || String(left.operation_id || "").localeCompare(String(right.operation_id || "")));
  state.processed_operations = state.processed_operations.slice(-10_000);
  state.changes = state.changes.slice(-10_000);
  return state;
}

function applyInvestigationMutations(inputState, inputCommands, { projectId, now = () => new Date(), idFactory = null } = {}) {
  let state;
  try { state = normalizeInvestigationMemory(inputState, { projectId, now }); } catch (error) { return failure(error.code || "MEMORY_INVESTIGATION_STATE_INVALID", error.message, error.details || {}); }
  const listOfCommands = Array.isArray(inputCommands) ? inputCommands : [inputCommands];
  if (!listOfCommands.length || !listOfCommands[0]) return failure("MEMORY_MUTATION_REQUIRED", "At least one Investigation Memory mutation is required.");
  let commands;
  try { commands = listOfCommands.map((command) => createMutationCommand({ ...command, memory_type: "investigation", project_id: projectId })); } catch (error) { return failure(error.code || "MEMORY_MUTATION_INVALID", error.message, error.details || {}); }
  const operationId = commands[0].operation_id;
  if (commands.some((command) => command.operation_id !== operationId)) return failure("MEMORY_OPERATION_ID_CONFLICT", "A mutation batch must use one operation ID.");
  const processed = state.processed_operations.find((entry) => entry.operation_id === operationId);
  if (processed?.result) return { ...cloneSafe(processed.result), replayed: true };
  if (commands.some((command) => command.expected_base_revision !== state.revision)) return failure("MEMORY_REVISION_CONFLICT", "The Investigation Memory base revision is stale.", { expectedBaseRevision: commands[0].expected_base_revision, currentRevision: state.revision }, true);
  const nextRevision = state.revision + 1;
  const before = canonicalJson(state);
  const recordIds = [];
  const conflicts = [];
  const warnings = [];
  const mutationTypes = [];
  for (const command of commands) {
    const result = applyOne(state, command, nextRevision, now, idFactory);
    if (!result.ok) return result;
    mutationTypes.push(command.mutation_type);
    recordIds.push(...(result.recordIds || []));
    conflicts.push(...(result.conflicts || []));
    warnings.push(...(result.warnings || []));
  }
  const changed = before !== canonicalJson(state);
  if (!changed) return mutationResult({ operationId, recordIds: [...new Set(recordIds)], previousRevision: state.revision, revision: state.revision, changed: false, conflicts, warnings });
  state.revision = nextRevision;
  state.updated_at = stamp(now);
  state.changes.push({ revision: nextRevision, operation_id: operationId, mutation_types: [...new Set(mutationTypes)], record_ids: [...new Set(recordIds)].sort(), changed_at: stamp(now), source_block_id: commands[0].block_id || "" });
  const result = mutationResult({ operationId, recordIds: [...new Set(recordIds)], previousRevision: nextRevision - 1, revision: nextRevision, changed: true, conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)] });
  state.processed_operations.push({ operation_id: operationId, idempotency_key: commands[0].idempotency_key, revision: nextRevision, result: cloneSafe(result) });
  sortState(state);
  return { ...result, state };
}

module.exports = Object.freeze({
  INVESTIGATION_MEMORY_SCHEMA_VERSION,
  COLLECTIONS,
  ALLOWED_MUTATIONS,
  emptyInvestigationMemory,
  normalizeInvestigationMemory,
  applyInvestigationMutations,
  canInvestigationTransition: require("../../../contracts/memory/investigation-contracts.js").canInvestigationTransition,
});
