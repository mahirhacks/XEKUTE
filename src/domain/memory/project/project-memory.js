"use strict";

const { assert, assertMemoryId, canonicalJson, canonicalKeyHash, createAlias, createMutationCommand, mutationResult } = require("../../../contracts/memory/index.js");
const { PROJECT_CLAIM_STATES, canTransition, isAssistantProseProvenance } = require("../../../contracts/memory/memory-lifecycle.js");
const { cloneSafe, text } = require("../value-safety.js");
const { normalizeEntity } = require("./entity-catalog.js");
const { normalizeClaim } = require("./claim-catalog.js");
const { normalizeRelationship } = require("./relationship-catalog.js");

const PROJECT_MEMORY_SCHEMA_VERSION = 1;
const ALLOWED_MUTATIONS = Object.freeze(["upsert_entity", "upsert_claim", "upsert_relationship", "supersede_claim", "retract_claim", "merge_entity", "register_alias"]);
const REJECTED_PROJECT_RECORDS = new Set(["hypothesis", "attempt", "finding", "finding_candidate", "vulnerability", "negative_result", "failure", "test_case", "blocker", "investigation"]);

function failure(code, error, details = {}, retryable = false) {
  return { ok: false, code, error: String(error || "Project Memory operation failed."), retryable: Boolean(retryable), details: details && typeof details === "object" ? details : {} };
}

function stamp(now) {
  const date = typeof now === "function" ? now() : now;
  return new Date(date instanceof Date ? date : String(date)).toISOString();
}

function sortedUnique(values, limit = 500) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort().slice(0, limit);
}

function refsOf(provenance) {
  return sortedUnique([...(Array.isArray(provenance?.source_refs) ? provenance.source_refs : []), ...(Array.isArray(provenance?.sourceRefs) ? provenance.sourceRefs : [])], 200);
}

function materialRecord(record) {
  const copy = { ...record };
  for (const field of ["created_at", "updated_at", "revision_created", "revision_updated", "provenance_refs", "last_observed_at", "last_confirmed_at", "provenance"]) delete copy[field];
  return copy;
}

function withRecordMetadata(record, command, revision, current = null, now = () => new Date()) {
  const sourceRefs = refsOf(command.provenance);
  const mergedRefs = sortedUnique([...(Array.isArray(current?.provenance_refs) ? current.provenance_refs : []), ...sourceRefs], 200);
  const occurredAt = command.provenance?.captured_at || command.provenance?.capturedAt || stamp(now);
  const result = {
    ...record,
    revision_created: Number(current?.revision_created ?? revision),
    revision_updated: revision,
    created_at: current?.created_at || stamp(now),
    updated_at: stamp(now),
    provenance_refs: mergedRefs,
    provenance: cloneSafe(command.provenance),
    last_observed_at: occurredAt,
  };
  if (record.record_type === "claim" && record.state === "verified") result.last_confirmed_at = occurredAt;
  return result;
}

function emptyProjectMemory(projectId, now = () => new Date()) {
  return {
    schema_version: PROJECT_MEMORY_SCHEMA_VERSION,
    kind: "xekute-project-memory",
    memory_type: "project",
    project_id: assertMemoryId(projectId, "proj"),
    revision: 0,
    created_at: stamp(now),
    updated_at: stamp(now),
    entities: [],
    claims: [],
    relationships: [],
    conflicts: [],
    changes: [],
    aliases: [],
    processed_operations: [],
    coverage_inputs: { hash: canonicalKeyHash({}), values: {} },
  };
}

function normalizeProjectMemory(input, { projectId, now = () => new Date() } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : {};
  const base = emptyProjectMemory(projectId, now);
  assertMemoryId(String(source.project_id || projectId), "proj");
  assert(String(source.project_id || projectId) === projectId, "MEMORY_PROJECT_MISMATCH", "Project Memory belongs to a different project.");
  const result = {
    ...base,
    ...cloneSafe(source),
    schema_version: PROJECT_MEMORY_SCHEMA_VERSION,
    kind: "xekute-project-memory",
    memory_type: "project",
    project_id: projectId,
    revision: Math.max(0, Number(source.revision) || 0),
    entities: [],
    claims: [],
    relationships: [],
    conflicts: Array.isArray(source.conflicts) ? cloneSafe(source.conflicts).slice(-500) : [],
    changes: Array.isArray(source.changes) ? cloneSafe(source.changes).slice(-10_000) : [],
    aliases: Array.isArray(source.aliases) ? cloneSafe(source.aliases).slice(-10_000) : [],
    processed_operations: Array.isArray(source.processed_operations) ? cloneSafe(source.processed_operations).slice(-10_000) : [],
  };
  for (const item of Array.isArray(source.entities) ? source.entities : []) {
    try { result.entities.push(preserveRecordMetadata(item, normalizeEntity(item, { projectId, recordId: item.record_id || item.recordId || item.id }))); } catch { /* Invalid historical records are omitted from a normalized view. */ }
  }
  result.entities.sort((left, right) => left.record_id.localeCompare(right.record_id));
  const entityTypes = new Map(result.entities.map((item) => [item.record_id, item.entity_type]));
  for (const item of Array.isArray(source.claims) ? source.claims : []) {
    try {
      const normalized = normalizeClaim(item, { projectId, recordId: item.record_id || item.recordId || item.id, observedAt: item.observed_at || item.observedAt });
      result.claims.push(preserveRecordMetadata(item, normalized));
    } catch { /* Invalid historical records are omitted from a normalized view. */ }
  }
  result.claims.sort((left, right) => left.record_id.localeCompare(right.record_id));
  for (const item of Array.isArray(source.relationships) ? source.relationships : []) {
    try {
      const normalized = normalizeRelationship(item, { projectId, recordId: item.record_id || item.recordId || item.id, sourceType: entityTypes.get(item.source_id || item.sourceId) || "", targetType: entityTypes.get(item.target_id || item.targetId) || "", observedAt: item.observed_at || item.observedAt });
      result.relationships.push(preserveRecordMetadata(item, normalized));
    } catch { /* Invalid historical records are omitted from a normalized view. */ }
  }
  result.relationships.sort((left, right) => left.record_id.localeCompare(right.record_id));
  result.coverage_inputs = coverageInputs(result);
  return result;
}

function coverageInputs(state) {
  const relevantTypes = new Set(["application", "component", "endpoint", "graphql_operation", "websocket_channel", "input_surface", "role", "authentication_mechanism", "session_mechanism", "technology", "workflow", "environment"]);
  const values = {
    entities: state.entities.filter((entity) => relevantTypes.has(entity.entity_type)).map((entity) => ({ type: entity.entity_type, key: entity.canonical_key_hash })).sort((left, right) => `${left.type}|${left.key}`.localeCompare(`${right.type}|${right.key}`)),
    claims: state.claims.filter((claim) => ["uses_technology", "uses_authentication", "uses_session_mechanism", "requires_role", "accepts_parameter", "scope_status", "environment_status"].includes(claim.predicate)).map((claim) => claim.canonical_key_hash).sort(),
  };
  return { hash: canonicalKeyHash(values), values };
}

function findById(collection, id) { return collection.findIndex((item) => item.record_id === id); }

function preserveRecordMetadata(source, normalized) {
  const metadata = {};
  for (const field of ["revision_created", "revision_updated", "created_at", "updated_at", "provenance", "provenance_refs", "last_observed_at", "last_confirmed_at", "supersedes", "superseded_by"]) {
    if (source?.[field] !== undefined) metadata[field] = cloneSafe(source[field]);
  }
  return { ...normalized, ...metadata };
}

function commandPayload(command, key) {
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  return payload[key] && typeof payload[key] === "object" ? payload[key] : payload;
}

function assertFactualCommand(command) {
  if (isAssistantProseProvenance(command.provenance)) return failure("MEMORY_PROJECT_PROVENANCE_INVALID", "Assistant prose cannot satisfy Project Memory factual provenance.");
  const recordType = String(command.payload?.record_type || command.payload?.recordType || command.payload?.memory_type || command.payload?.memoryType || "").trim().toLowerCase();
  if (REJECTED_PROJECT_RECORDS.has(recordType)) return failure("MEMORY_PROJECT_OWNERSHIP_VIOLATION", `Project Memory cannot own ${recordType} records.`, { recordType });
  return null;
}

function applyOne(state, command, revision, now, idFactory) {
  const rejected = assertFactualCommand(command);
  if (rejected) return rejected;
  if (!ALLOWED_MUTATIONS.includes(command.mutation_type)) return failure("MEMORY_PROJECT_MUTATION_INVALID", `Unsupported Project Memory mutation: ${command.mutation_type}.`);
  const refs = refsOf(command.provenance);
  if (!refs.length && command.provenance?.source_type !== "operator_assertion") return failure("MEMORY_PROJECT_PROVENANCE_REQUIRED", "Project Memory mutations require source references.");
  if (command.mutation_type === "upsert_entity") {
    let entity;
    try { entity = normalizeEntity(commandPayload(command, "entity"), { projectId: state.project_id, idFactory }); } catch (error) { return failure(error.code || "MEMORY_ENTITY_INVALID", error.message, error.details || {}); }
    const index = state.entities.findIndex((item) => item.canonical_key_hash === entity.canonical_key_hash);
    if (index >= 0) {
      const previous = state.entities[index];
      const merged = withRecordMetadata({ ...previous, ...entity, record_id: previous.record_id, aliases: sortedUnique([...(previous.aliases || []), ...(entity.aliases || [])], 100) }, command, revision, previous, now);
      const changed = canonicalJson(materialRecord(previous)) !== canonicalJson(materialRecord(merged)) || canonicalJson(previous.provenance_refs || []) !== canonicalJson(merged.provenance_refs || []);
      if (!changed) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.entities[index] = merged;
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    state.entities.push(withRecordMetadata(entity, command, revision, null, now));
    return { ok: true, changed: true, recordIds: [entity.record_id], conflicts: [], warnings: [] };
  }
  if (command.mutation_type === "upsert_claim") {
    let claim;
    try { claim = normalizeClaim(commandPayload(command, "claim"), { projectId: state.project_id, idFactory, observedAt: command.provenance?.captured_at || command.provenance?.capturedAt }); } catch (error) { return failure(error.code || "MEMORY_CLAIM_INVALID", error.message, error.details || {}); }
    if (!state.entities.some((entity) => entity.record_id === claim.subject_id)) return failure("MEMORY_REFERENCE_NOT_FOUND", "A Project Memory claim subject does not exist.", { recordId: claim.subject_id });
    if (claim.object.type === "entity_ref" && !state.entities.some((entity) => entity.record_id === claim.object.entity_id)) return failure("MEMORY_REFERENCE_NOT_FOUND", "A Project Memory claim object does not exist.", { recordId: claim.object.entity_id });
    const exact = state.claims.findIndex((item) => item.canonical_key_hash === claim.canonical_key_hash);
    if (exact >= 0) {
      const previous = state.claims[exact];
      let nextState = claim.state;
      if (previous.state !== claim.state && !canTransition(previous.state, claim.state)) return failure("MEMORY_LIFECYCLE_TRANSITION_INVALID", `Illegal claim lifecycle transition: ${previous.state} -> ${claim.state}.`, { from: previous.state, to: claim.state });
      const merged = withRecordMetadata({ ...previous, ...claim, record_id: previous.record_id, state: nextState }, command, revision, previous, now);
      const changed = canonicalJson(materialRecord(previous)) !== canonicalJson(materialRecord(merged)) || canonicalJson(previous.provenance_refs || []) !== canonicalJson(merged.provenance_refs || []);
      if (!changed) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.claims[exact] = merged;
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    const competing = state.claims.filter((item) => item.subject_id === claim.subject_id && item.predicate === claim.predicate && item.canonical_key_hash !== claim.canonical_key_hash && !["superseded", "retracted", "expired"].includes(item.state));
    let conflictIds = [];
    if (competing.length) {
      for (const prior of competing) {
        if (canTransition(prior.state, "disputed")) prior.state = "disputed";
        conflictIds.push(prior.record_id);
      }
      claim.state = "disputed";
      const conflictId = `conflict_${canonicalKeyHash({ subject: claim.subject_id, predicate: claim.predicate, claims: [...conflictingIds(competing), claim.record_id].sort() }).slice(0, 48)}`;
      state.conflicts.push({ conflict_id: conflictId, project_id: state.project_id, subject_id: claim.subject_id, predicate: claim.predicate, claim_ids: [...conflictingIds(competing), claim.record_id].sort(), state: "open", detected_at: stamp(now) });
    }
    const decorated = withRecordMetadata(claim, command, revision, null, now);
    state.claims.push(decorated);
    return { ok: true, changed: true, recordIds: [claim.record_id, ...conflictIds], conflicts: conflictIds, warnings: conflictIds.length ? ["conflicting_claims_marked_disputed"] : [] };
  }
  if (command.mutation_type === "upsert_relationship") {
    const payload = commandPayload(command, "relationship");
    const source = state.entities.find((entity) => entity.record_id === (payload.source_id || payload.sourceId || payload.from));
    const target = state.entities.find((entity) => entity.record_id === (payload.target_id || payload.targetId || payload.to));
    if (!source || !target) return failure("MEMORY_REFERENCE_NOT_FOUND", "A Project Memory relationship endpoint does not exist.", { sourceId: payload.source_id || payload.sourceId || payload.from, targetId: payload.target_id || payload.targetId || payload.to });
    let relationship;
    try { relationship = normalizeRelationship(payload, { projectId: state.project_id, sourceType: source.entity_type, targetType: target.entity_type, idFactory, observedAt: command.provenance?.captured_at || command.provenance?.capturedAt }); } catch (error) { return failure(error.code || "MEMORY_RELATIONSHIP_INVALID", error.message, error.details || {}); }
    const index = state.relationships.findIndex((item) => item.canonical_key_hash === relationship.canonical_key_hash);
    if (index >= 0) {
      const previous = state.relationships[index];
      const merged = withRecordMetadata({ ...previous, ...relationship, record_id: previous.record_id }, command, revision, previous, now);
      const changed = canonicalJson(materialRecord(previous)) !== canonicalJson(materialRecord(merged)) || canonicalJson(previous.provenance_refs || []) !== canonicalJson(merged.provenance_refs || []);
      if (!changed) return { ok: true, changed: false, recordIds: [previous.record_id], conflicts: [], warnings: [] };
      state.relationships[index] = merged;
      return { ok: true, changed: true, recordIds: [previous.record_id], conflicts: [], warnings: [] };
    }
    state.relationships.push(withRecordMetadata(relationship, command, revision, null, now));
    return { ok: true, changed: true, recordIds: [relationship.record_id], conflicts: [], warnings: [] };
  }
  if (["supersede_claim", "retract_claim"].includes(command.mutation_type)) {
    const claimId = String(command.target_record_id || command.payload?.claim_id || command.payload?.claimId || "").trim();
    if (!claimId) return failure("MEMORY_TARGET_RECORD_REQUIRED", "A claim lifecycle mutation requires target_record_id.");
    const index = findById(state.claims, claimId);
    if (index < 0) return failure("MEMORY_REFERENCE_NOT_FOUND", "The target Project Memory claim was not found.", { recordId: claimId });
    const nextState = command.mutation_type === "retract_claim" ? "retracted" : "superseded";
    const previous = state.claims[index];
    if (!canTransition(previous.state, nextState)) return failure("MEMORY_LIFECYCLE_TRANSITION_INVALID", `Illegal claim lifecycle transition: ${previous.state} -> ${nextState}.`, { from: previous.state, to: nextState });
    if (previous.state === nextState) return { ok: true, changed: false, recordIds: [claimId], conflicts: [], warnings: [] };
    state.claims[index] = withRecordMetadata({ ...previous, state: nextState }, command, revision, previous, now);
    return { ok: true, changed: true, recordIds: [claimId], conflicts: [], warnings: [] };
  }
  if (command.mutation_type === "merge_entity") {
    const sourceId = String(command.payload?.source_entity_id || command.payload?.sourceEntityId || "").trim();
    const targetId = String(command.payload?.target_entity_id || command.payload?.targetEntityId || "").trim();
    const sourceIndex = findById(state.entities, sourceId);
    const targetIndex = findById(state.entities, targetId);
    if (sourceIndex < 0 || targetIndex < 0) return failure("MEMORY_REFERENCE_NOT_FOUND", "Both merge entities must exist.", { sourceId, targetId });
    if (sourceId === targetId) return { ok: true, changed: false, recordIds: [targetId], conflicts: [], warnings: [] };
    const source = state.entities[sourceIndex];
    const target = state.entities[targetIndex];
    state.entities[targetIndex] = withRecordMetadata({ ...target, aliases: sortedUnique([...(target.aliases || []), source.record_id, ...(source.aliases || [])], 100) }, command, revision, target, now);
    state.entities[sourceIndex] = withRecordMetadata({ ...source, state: "superseded", superseded_by: targetId }, command, revision, source, now);
    state.aliases.push({ project_id: state.project_id, alias_type: "merge_redirect", legacy_id: sourceId, canonical_id: targetId });
    return { ok: true, changed: true, recordIds: [sourceId, targetId], conflicts: [], warnings: [] };
  }
  if (command.mutation_type === "register_alias") {
    const legacyId = text(command.payload?.legacy_id || command.payload?.legacyId || "", 240);
    const canonicalId = String(command.payload?.canonical_id || command.payload?.canonicalId || "").trim();
    if (!legacyId || !canonicalId) return failure("MEMORY_ALIAS_INVALID", "An alias requires both legacy_id and canonical_id.");
    try { assertMemoryId(canonicalId, "entity"); createAlias({ projectId: state.project_id, legacyId, canonicalId, aliasType: command.payload?.alias_type || command.payload?.aliasType || "legacy" }); } catch (error) { return failure(error.code || "MEMORY_ALIAS_INVALID", error.message, error.details || {}); }
    if (!state.entities.some((entity) => entity.record_id === canonicalId)) return failure("MEMORY_REFERENCE_NOT_FOUND", "An alias canonical entity does not exist.", { recordId: canonicalId });
    const duplicate = state.aliases.some((alias) => alias.legacy_id === legacyId && alias.canonical_id === canonicalId);
    if (duplicate) return { ok: true, changed: false, recordIds: [canonicalId], conflicts: [], warnings: [] };
    state.aliases.push({ project_id: state.project_id, alias_type: text(command.payload?.alias_type || command.payload?.aliasType || "legacy", 40), legacy_id: legacyId, canonical_id: canonicalId });
    state.aliases.sort((left, right) => `${left.legacy_id}|${left.canonical_id}`.localeCompare(`${right.legacy_id}|${right.canonical_id}`));
    return { ok: true, changed: true, recordIds: [canonicalId], conflicts: [], warnings: [] };
  }
  return failure("MEMORY_PROJECT_MUTATION_INVALID", "The Project Memory mutation was not handled.");
}

function conflictingIds(items) { return items.map((item) => item.record_id); }

function applyProjectMutations(inputState, inputCommands, { projectId, now = () => new Date(), idFactory = null } = {}) {
  let state;
  try { state = normalizeProjectMemory(inputState, { projectId, now }); } catch (error) { return failure(error.code || "MEMORY_PROJECT_STATE_INVALID", error.message, error.details || {}); }
  const list = Array.isArray(inputCommands) ? inputCommands : [inputCommands];
  if (!list.length) return failure("MEMORY_MUTATION_REQUIRED", "At least one Project Memory mutation is required.");
  let commands;
  try { commands = list.map((command) => createMutationCommand({ ...command, memory_type: "project", project_id: projectId })); } catch (error) { return failure(error.code || "MEMORY_MUTATION_INVALID", error.message, error.details || {}); }
  const operationId = commands[0].operation_id;
  if (commands.some((command) => command.operation_id !== operationId)) return failure("MEMORY_OPERATION_ID_CONFLICT", "A mutation batch must use one operation ID.");
  const processed = state.processed_operations.find((entry) => entry.operation_id === operationId);
  if (processed?.result) return { ...cloneSafe(processed.result), replayed: true };
  for (const command of commands) {
    if (command.expected_base_revision !== state.revision) return failure("MEMORY_REVISION_CONFLICT", "The Project Memory base revision is stale.", { expectedBaseRevision: command.expected_base_revision, currentRevision: state.revision }, true);
  }
  const nextRevision = state.revision + 1;
  const before = JSON.stringify(state);
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
  const changed = before !== JSON.stringify(state);
  if (!changed) return mutationResult({ operationId, recordIds: [...new Set(recordIds)], previousRevision: state.revision, revision: state.revision, changed: false, conflicts, warnings });
  state.revision = nextRevision;
  state.updated_at = stamp(now);
  state.coverage_inputs = coverageInputs(state);
  const change = { revision: nextRevision, operation_id: operationId, mutation_types: mutationTypes, record_ids: [...new Set(recordIds)].sort(), changed_at: stamp(now), source_block_id: commands[0].block_id || "" };
  state.changes.push(change);
  state.changes = state.changes.slice(-10_000);
  const result = mutationResult({ operationId, recordIds: [...new Set(recordIds)], previousRevision: nextRevision - 1, revision: nextRevision, changed: true, conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)] });
  state.processed_operations.push({ operation_id: operationId, idempotency_key: commands[0].idempotency_key, revision: nextRevision, result: cloneSafe(result) });
  state.processed_operations = state.processed_operations.slice(-10_000);
  state.entities.sort((left, right) => left.record_id.localeCompare(right.record_id));
  state.claims.sort((left, right) => left.record_id.localeCompare(right.record_id));
  state.relationships.sort((left, right) => left.record_id.localeCompare(right.record_id));
  return { ...result, state };
}

module.exports = Object.freeze({ PROJECT_MEMORY_SCHEMA_VERSION, ENTITY_TYPES: require("./entity-catalog.js").ENTITY_TYPES, ALLOWED_MUTATIONS, emptyProjectMemory, normalizeProjectMemory, coverageInputs, applyProjectMutations });
