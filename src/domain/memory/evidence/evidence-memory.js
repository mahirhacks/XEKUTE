"use strict";

const { assert, assertMemoryId, canonicalJson, canonicalKeyHash, createMutationCommand, mutationResult } = require("../../../contracts/memory/index.js");
const { cloneSafe } = require("../value-safety.js");
const {
  createFindingRecord,
  createVerificationRecord,
  createRemediationRecord,
  createRetestRecord,
  assertEvidenceTransition,
} = require("../../../contracts/memory/evidence-contracts.js");

const EVIDENCE_MEMORY_SCHEMA_VERSION = 1;
const COLLECTIONS = Object.freeze(["findings", "verifications", "remediations", "retests"]);
const ALLOWED_MUTATIONS = Object.freeze(["create_finding", "upsert_finding", "record_verification", "set_finding_state", "record_remediation", "record_retest"]);

function failure(code, error, details = {}, retryable = false) { return { ok: false, code, error: String(error || "Evidence Memory operation failed."), retryable: Boolean(retryable), details: details && typeof details === "object" ? details : {} }; }
function stamp(now) { const value = typeof now === "function" ? now() : now; const date = value instanceof Date ? value : new Date(value); assert(!Number.isNaN(date.getTime()), "MEMORY_TIMESTAMP_INVALID", "The Evidence Memory clock returned an invalid date."); return date.toISOString(); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function list(value, max = 10_000) { return Array.isArray(value) ? value.slice(-max).map((entry) => cloneSafe(entry)) : []; }
function refsOf(provenance) { return [...new Set([...(Array.isArray(provenance?.source_refs) ? provenance.source_refs : []), ...(Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs : [])].map((value) => String(value || "").trim()).filter(Boolean))].sort().slice(0, 200); }

function emptyEvidenceMemory(projectId, now = () => new Date()) {
  return { schema_version: EVIDENCE_MEMORY_SCHEMA_VERSION, kind: "xekute-evidence-memory", memory_type: "evidence", project_id: assertMemoryId(projectId, "proj"), revision: 0, created_at: stamp(now), updated_at: stamp(now), findings: [], verifications: [], remediations: [], retests: [], changes: [], processed_operations: [] };
}

function normalizeEvidenceMemory(input, { projectId, now = () => new Date() } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : {};
  const actual = String(source.project_id || source.projectId || projectId);
  assertMemoryId(actual, "proj");
  assert(actual === projectId, "MEMORY_PROJECT_MISMATCH", "Evidence Memory belongs to a different project.", { expectedProjectId: projectId, actualProjectId: actual });
  const base = emptyEvidenceMemory(projectId, now);
  const result = { ...base, ...cloneSafe(source), schema_version: EVIDENCE_MEMORY_SCHEMA_VERSION, kind: "xekute-evidence-memory", memory_type: "evidence", project_id: projectId, revision: Math.max(0, Number(source.revision) || 0), created_at: String(source.created_at || base.created_at), updated_at: String(source.updated_at || base.updated_at) };
  for (const collection of COLLECTIONS) result[collection] = list(source[collection]);
  result.changes = list(source.changes);
  result.processed_operations = list(source.processed_operations);
  return result;
}

function payloadOf(command) {
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  return payload.record && typeof payload.record === "object" ? { ...payload.record, ...payload } : payload;
}

function eventTime(command, now) { return command.provenance?.captured_at || command.provenance?.capturedAt || stamp(now); }
function decorate(record, command, revision, previous, now) {
  const refs = [...new Set([...(Array.isArray(previous?.provenance_refs) ? previous.provenance_refs : []), ...refsOf(command.provenance)])].sort().slice(0, 200);
  return { ...record, project_id: command.project_id, operation_id: command.operation_id, revision_created: Number(previous?.revision_created ?? revision), revision_updated: revision, created_at: previous?.created_at || record.created_at || eventTime(command, now), updated_at: stamp(now), actor: cloneSafe(command.actor), provenance: cloneSafe(record.provenance || command.provenance), provenance_refs: refs, last_observed_at: eventTime(command, now) };
}
function materialRecord(record) { const result = clone(record); for (const field of ["operation_id", "revision_created", "revision_updated", "created_at", "updated_at", "actor", "provenance", "provenance_refs", "last_observed_at"]) delete result[field]; return result; }

function upsertRecord(state, collectionName, record, command, revision, now, { allowStateTransition = true } = {}) {
  const collection = state[collectionName];
  const fingerprint = record.fingerprint || record.canonical_key_hash || "";
  const index = collection.findIndex((entry) => entry.record_id === record.record_id || (fingerprint && (entry.fingerprint === fingerprint || entry.canonical_key_hash === fingerprint)));
  if (index < 0) { collection.push(decorate(record, command, revision, null, now)); return { ok: true, changed: true, recordIds: [record.record_id], conflicts: [], warnings: [] }; }
  const previous = collection[index];
  if (previous.record_id !== record.record_id && fingerprint && previous.fingerprint === fingerprint) return failure("MEMORY_EVIDENCE_DUPLICATE_FINGERPRINT", "The Evidence finding fingerprint already belongs to another finding.", { canonicalFindingId: previous.record_id, fingerprint });
  if (allowStateTransition && previous.state && record.state && previous.state !== record.state) {
    try { assertEvidenceTransition(previous.state, record.state); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
  }
  const merged = decorate({ ...previous, ...record, record_id: previous.record_id, finding_id: previous.finding_id || record.finding_id, fingerprint: previous.fingerprint || record.fingerprint, canonical_key_hash: previous.canonical_key_hash || record.canonical_key_hash }, command, revision, previous, now);
  if (canonicalJson(materialRecord(previous)) === canonicalJson(materialRecord(merged)) && canonicalJson(previous.provenance_refs || []) === canonicalJson(merged.provenance_refs || [])) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
  collection[index] = merged;
  return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
}

function findFinding(state, id) { return state.findings.find((entry) => entry.record_id === String(id || "") || entry.finding_id === String(id || "")) || null; }

function applyOne(state, command, revision, now, idFactory) {
  if (!ALLOWED_MUTATIONS.includes(command.mutation_type)) return failure("MEMORY_EVIDENCE_MUTATION_INVALID", `Unsupported Evidence Memory mutation: ${command.mutation_type}.`);
    const payload = payloadOf(command);
    try {
      if (command.mutation_type === "create_finding" || command.mutation_type === "upsert_finding") {
      if (payload.verification_gate !== true && payload.verificationGate !== true) return failure("MEMORY_EVIDENCE_VERIFICATION_GATE_REQUIRED", "Evidence Memory findings can only be created by an accepting verification gate.");
      if (payload.promoted_from_verification !== true && payload.promotedFromVerification !== true) return failure("MEMORY_EVIDENCE_PROMOTION_REQUIRED", "Evidence Memory findings must identify a verification promotion.");
      const record = createFindingRecord({ ...payload, project_id: command.project_id, actor: payload.actor || command.actor, provenance: payload.provenance || command.provenance }, { idFactory, now });
      const previous = findFinding(state, record.record_id);
      if (!previous && state.findings.some((entry) => entry.fingerprint === record.fingerprint)) return failure("MEMORY_EVIDENCE_DUPLICATE_FINGERPRINT", "The Evidence finding fingerprint already exists.", { fingerprint: record.fingerprint });
      return upsertRecord(state, "findings", record, command, revision, now);
    }
    if (command.mutation_type === "record_verification") {
      const record = createVerificationRecord({ ...payload, project_id: command.project_id, actor: payload.actor || command.actor, provenance: payload.provenance || command.provenance }, { idFactory, now });
      const finding = findFinding(state, record.finding_id);
      if (!finding) return failure("MEMORY_REFERENCE_NOT_FOUND", "The Evidence verification references an unknown finding.", { recordId: record.finding_id });
      const existing = state.verifications.find((entry) => entry.record_id === record.record_id);
      if (existing) return { ok: true, changed: false, recordIds: [existing.record_id], conflicts: [], warnings: [] };
      state.verifications.push({ ...record, operation_id: command.operation_id, revision_created: revision, revision_updated: revision, provenance_refs: refsOf(command.provenance) });
      finding.verification_history = [...(Array.isArray(finding.verification_history) ? finding.verification_history : []), { verification_id: record.record_id, verdict: record.verdict, reason: record.reason, proof_refs: clone(record.proof_refs), verified_at: record.verified_at, independent: record.independent }].slice(-100);
      return { ok: true, changed: true, recordIds: [record.record_id, finding.record_id], conflicts: [], warnings: [] };
    }
    if (command.mutation_type === "set_finding_state") {
      const findingId = command.target_record_id || payload.finding_id || payload.findingId;
      const finding = findFinding(state, findingId);
      if (!finding) return failure("MEMORY_REFERENCE_NOT_FOUND", "The Evidence finding was not found.", { recordId: String(findingId || "") });
      const nextState = String(payload.state || payload.status || "").trim().toLowerCase();
      try { assertEvidenceTransition(finding.state, nextState); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
      if (nextState === "duplicate") {
        const duplicateOf = String(payload.duplicate_of || payload.duplicateOf || "").trim();
        if (!duplicateOf || duplicateOf === finding.record_id || !findFinding(state, duplicateOf)) return failure("MEMORY_EVIDENCE_DUPLICATE_REFERENCE_INVALID", "A duplicate finding must reference an existing canonical finding.");
        finding.duplicate_of = duplicateOf;
      }
      if (finding.state === nextState) return { ok: true, changed: false, recordIds: [finding.record_id], conflicts: [], warnings: [] };
      finding.state = nextState;
      finding.updated_at = stamp(now);
      finding.revision_updated = revision;
      finding.operation_id = command.operation_id;
      finding.actor = cloneSafe(command.actor);
      finding.provenance = cloneSafe(command.provenance);
      finding.provenance_refs = [...new Set([...(finding.provenance_refs || []), ...refsOf(command.provenance)])].sort().slice(0, 200);
      return { ok: true, changed: true, recordIds: [finding.record_id], conflicts: [], warnings: [] };
    }
    if (command.mutation_type === "record_remediation" || command.mutation_type === "record_retest") {
      const findingId = command.target_record_id || payload.finding_id || payload.findingId;
      const finding = findFinding(state, findingId);
      if (!finding) return failure("MEMORY_REFERENCE_NOT_FOUND", "The Evidence operation references an unknown finding.", { recordId: String(findingId || "") });
      const collectionName = command.mutation_type === "record_remediation" ? "remediations" : "retests";
      const stableRecordId = payload.record_id || `finding_${canonicalKeyHash({ operation_id: command.operation_id, finding_id: finding.record_id, mutation: command.mutation_type, payload }).slice(0, 32)}`;
      const supplied = { ...cloneSafe(payload), project_id: command.project_id, actor: payload.actor || command.actor, provenance: payload.provenance || command.provenance, record_id: stableRecordId, finding_id: finding.record_id };
      const record = command.mutation_type === "record_remediation"
        ? createRemediationRecord(supplied, { idFactory, now })
        : createRetestRecord(supplied, { idFactory, now });
      record.operation_id = command.operation_id;
      record.revision_created = revision;
      record.revision_updated = revision;
      record.created_at = eventTime(command, now);
      record.updated_at = eventTime(command, now);
      record.actor = cloneSafe(command.actor);
      record.provenance = cloneSafe(command.provenance);
      record.provenance_refs = refsOf(command.provenance);
      const index = state[collectionName].findIndex((entry) => entry.record_id === record.record_id);
      const priorRecord = index >= 0 ? state[collectionName][index] : null;
      if (index >= 0 && canonicalJson(materialRecord(priorRecord)) === canonicalJson(materialRecord(record))) return { ok: true, changed: false, recordIds: [record.record_id], conflicts: [], warnings: [] };
      if (index >= 0) state[collectionName][index] = record; else state[collectionName].push(record);
      const previousFinding = canonicalJson(materialRecord(finding));
      if (command.mutation_type === "record_remediation") {
        const shouldMarkRemediated = payload.mark_remediated !== false && payload.markRemediated !== false;
        if (shouldMarkRemediated && finding.state !== "remediated") {
          try { assertEvidenceTransition(finding.state, "remediated"); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
          finding.state = "remediated";
        }
        finding.remediation_claim = { record_id: record.record_id, remediation: cloneSafe(record.remediation), claimed_at: record.claimed_at, actor: cloneSafe(record.actor) };
      } else {
        const nextState = record.outcome === "remediated" ? "remediated" : record.outcome === "still_vulnerable" ? "verified" : "needs_retest";
        if (finding.state !== nextState) {
          try { assertEvidenceTransition(finding.state, nextState); } catch (error) { return failure(error.code || "MEMORY_LIFECYCLE_TRANSITION_INVALID", error.message, error.details || {}); }
          finding.state = nextState;
        }
        finding.retest = { record_id: record.record_id, outcome: record.outcome, retested_at: record.retested_at, proof_refs: cloneSafe(record.proof_refs), attempt_refs: cloneSafe(record.attempt_refs) };
        finding.retest_history = [...(Array.isArray(finding.retest_history) ? finding.retest_history : []), cloneSafe(finding.retest)].slice(-100);
      }
      finding.updated_at = stamp(now);
      finding.revision_updated = revision;
      finding.operation_id = command.operation_id;
      finding.actor = cloneSafe(command.actor);
      finding.provenance = cloneSafe(command.provenance);
      finding.provenance_refs = [...new Set([...(finding.provenance_refs || []), ...refsOf(command.provenance)])].sort().slice(0, 200);
      const findingChanged = previousFinding !== canonicalJson(materialRecord(finding));
      return { ok: true, changed: true, recordIds: [record.record_id, finding.record_id], conflicts: [], warnings: findingChanged ? [] : [{ code: "MEMORY_EVIDENCE_FINDING_UNCHANGED", message: "The lifecycle record was recorded without changing the finding body." }] };
    }
  } catch (error) {
    return failure(error.code || "MEMORY_EVIDENCE_RECORD_INVALID", error.message, error.details || {});
  }
  return failure("MEMORY_EVIDENCE_MUTATION_INVALID", "The Evidence Memory mutation was not handled.");
}

function sortState(state) {
  for (const collection of COLLECTIONS) state[collection].sort((left, right) => String(left.record_id || "").localeCompare(String(right.record_id || "")));
  state.changes.sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0) || String(left.operation_id || "").localeCompare(String(right.operation_id || "")));
  state.changes = state.changes.slice(-10_000);
  state.processed_operations = state.processed_operations.slice(-10_000);
  return state;
}

function applyEvidenceMutations(inputState, inputCommands, { projectId, now = () => new Date(), idFactory = null } = {}) {
  let state;
  try { state = normalizeEvidenceMemory(inputState, { projectId, now }); } catch (error) { return failure(error.code || "MEMORY_EVIDENCE_STATE_INVALID", error.message, error.details || {}); }
  const listOfCommands = Array.isArray(inputCommands) ? inputCommands : [inputCommands];
  if (!listOfCommands.length || !listOfCommands[0]) return failure("MEMORY_MUTATION_REQUIRED", "At least one Evidence Memory mutation is required.");
  let commands;
  try { commands = listOfCommands.map((command) => createMutationCommand({ ...command, memory_type: "evidence", project_id: projectId })); } catch (error) { return failure(error.code || "MEMORY_MUTATION_INVALID", error.message, error.details || {}); }
  const operationId = commands[0].operation_id;
  if (commands.some((command) => command.operation_id !== operationId)) return failure("MEMORY_OPERATION_ID_CONFLICT", "An Evidence mutation batch must use one operation ID.");
  const processed = state.processed_operations.find((entry) => entry.operation_id === operationId);
  if (processed?.result) return { ...cloneSafe(processed.result), replayed: true };
  if (commands.some((command) => command.expected_base_revision !== state.revision)) return failure("MEMORY_REVISION_CONFLICT", "The Evidence Memory base revision is stale.", { expectedBaseRevision: commands[0].expected_base_revision, currentRevision: state.revision }, true);
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

module.exports = Object.freeze({ EVIDENCE_MEMORY_SCHEMA_VERSION, COLLECTIONS, ALLOWED_MUTATIONS, emptyEvidenceMemory, normalizeEvidenceMemory, applyEvidenceMutations });
