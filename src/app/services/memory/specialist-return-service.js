"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/index.js");
const { createSpecialistReturn } = require("../../../contracts/memory/multi-agent-contracts.js");
const { operationFailure, clone, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const SPECIALIST_RETURN_SERVICE_VERSION = 1;
const PROJECT_MUTATIONS = new Set(["upsert_entity", "upsert_claim", "upsert_relationship", "register_alias"]);
const MAX_CANDIDATES = 500;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }

function list(value, maximum = MAX_CANDIDATES) { return (Array.isArray(value) ? value : []).slice(0, maximum).map((entry) => clone(entry)); }

function projectCandidate(value, returnRecord, index) {
  const source = value && typeof value === "object" ? value : {};
  const mutation = text(source.mutation_type || source.mutationType || source.type, 80).toLowerCase();
  const payload = source.payload && typeof source.payload === "object" ? source.payload : null;
  if (!PROJECT_MUTATIONS.has(mutation) || !payload) return { candidate: null, residue: { index, reason: "specialist_project_fact_requires_explicit_mutation_and_payload" } };
  return {
    candidate: {
      mutation_type: mutation,
      payload: clone(payload),
      source_event_id: returnRecord.return_id,
      source_ids: [returnRecord.return_id, returnRecord.child_invocation_id].filter(Boolean),
      artifact_refs: [],
    },
    residue: null,
  };
}

function investigationCandidate(value, returnRecord, recordType, index) {
  const source = value && typeof value === "object" ? value : {};
  return {
    record_type: text(source.record_type || source.recordType || recordType, 80).toLowerCase() || recordType,
    legacy: false,
    source_event_id: returnRecord.return_id,
    source_ids: [returnRecord.return_id, returnRecord.child_invocation_id].filter(Boolean),
    artifact_refs: Array.isArray(source.artifact_refs || source.artifactRefs) ? [...new Set((source.artifact_refs || source.artifactRefs).map(String).filter(Boolean))].slice(0, 100) : [],
    value: clone(source),
    candidate_index: index,
  };
}

function artifactRefsOf(artifacts) {
  const refs = [];
  const residues = [];
  for (let index = 0; index < (Array.isArray(artifacts) ? artifacts : []).length; index += 1) {
    const source = artifacts[index];
    const value = typeof source === "string" ? source : source?.artifact_id || source?.artifactId || source?.record_id || source?.recordId || "";
    try { refs.push(assertMemoryId(value, "artifact")); }
    catch { residues.push({ index, reason: "specialist_artifact_reference_invalid" }); }
  }
  return { refs: [...new Set(refs)].sort().slice(0, 100), residues };
}

function toParentEvent(returnRecord) {
  const projectCandidates = [];
  const residues = [];
  for (let index = 0; index < returnRecord.proposed_project_facts.length; index += 1) {
    const result = projectCandidate(returnRecord.proposed_project_facts[index], returnRecord, index);
    if (result.candidate) projectCandidates.push(result.candidate);
    if (result.residue) residues.push(result.residue);
  }
  const investigationCandidates = [];
  for (const [field, recordType] of [["attempts", "attempt"], ["finding_candidates", "finding_candidate"], ["blockers", "blocker"], ["coverage", "coverage"], ["remaining_work", "remaining_work"]]) {
    const values = returnRecord[field] || [];
    for (let index = 0; index < values.length; index += 1) investigationCandidates.push(investigationCandidate(values[index], returnRecord, recordType, index));
  }
  const artifacts = artifactRefsOf(returnRecord.artifacts);
  residues.push(...artifacts.residues);
  return {
    event_type: "specialist_return",
    specialist_return_id: returnRecord.return_id,
    child_invocation_id: returnRecord.child_invocation_id,
    child_session_id: returnRecord.child_session_id,
    agent_id: returnRecord.agent_id,
    assignment_lease_id: returnRecord.assignment_lease_id,
    status: returnRecord.status,
    summary: returnRecord.summary,
    project_candidates: projectCandidates,
    investigation_candidates: investigationCandidates,
    verification_candidates: [],
    artifact_refs: artifacts.refs,
    source_ids: [returnRecord.return_id, returnRecord.child_invocation_id].filter(Boolean),
    remaining_work: list(returnRecord.remaining_work),
    residues: residues.slice(0, 1_000),
    provenance: clone(returnRecord.provenance),
  };
}

function createSpecialistReturnService({
  executionCapture = null,
  featureFlags = {},
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!crypto?.randomUUID) throw new TypeError("Specialist return service requires crypto.");
  const accepted = new Map();

  function enabled() { return featureFlags.multiAgentMemoryV2 === true; }

  async function accept(input = {}) {
    if (!enabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const source = input.return && typeof input.return === "object" ? input.return : input;
    let record;
    try { record = createSpecialistReturn({ ...source, project_id: input.project_id || input.projectId || source.project_id || source.projectId }, { now }); }
    catch (error) { return operationFailure(error.code || "MEMORY_SPECIALIST_RETURN_INVALID", error.message, error.details || {}); }
    const expectedProject = String(input.project_id || input.projectId || record.project_id);
    if (record.project_id !== expectedProject) return operationFailure("MEMORY_MULTI_AGENT_PROJECT_MISMATCH", "The specialist return does not belong to the parent project.", { expectedProjectId: expectedProject, actualProjectId: record.project_id });
    const parentBlockId = input.parent_block_id || input.parentBlockId || "";
    if (parentBlockId) {
      try { assertMemoryId(parentBlockId, "block"); } catch (error) { return operationFailure(error.code || "MEMORY_SPECIALIST_PARENT_BLOCK_INVALID", error.message, error.details || {}); }
    }
    const key = `${record.project_id}|${parentBlockId}|${record.return_id}`;
    const previous = accepted.get(key);
    if (previous) return { ...clone(previous), duplicate: true, changed: false };
    const parentEvent = toParentEvent(record);
    const result = {
      ok: true,
      service_version: SPECIALIST_RETURN_SERVICE_VERSION,
      operationId: input.operation_id || input.operationId || record.return_id,
      recordId: record.return_id,
      projectId: record.project_id,
      parentBlockId,
      parentEvent,
      changed: true,
      warnings: parentEvent.residues.length ? [{ code: "MEMORY_SPECIALIST_RETURN_RESIDUES", count: parentEvent.residues.length }] : [],
      receivedAt: timestamp(now),
    };
    const capture = input.executionCapture?.specialistReturn ? input.executionCapture : executionCapture;
    if (capture?.specialistReturn) {
      const state = capture.state?.();
      if (state?.projectId && state.projectId !== record.project_id) return operationFailure("MEMORY_MULTI_AGENT_PROJECT_MISMATCH", "The execution capture belongs to another project.", { expectedProjectId: record.project_id, actualProjectId: state.projectId });
      if (state?.blockId && parentBlockId && state.blockId !== parentBlockId) return operationFailure("MEMORY_SPECIALIST_PARENT_BLOCK_MISMATCH", "The specialist return targets another parent block.");
      const appended = await capture.specialistReturn(parentEvent, {
        event_id: record.return_id,
        artifact_refs: parentEvent.artifact_refs,
        source_ids: parentEvent.source_ids,
        actor: { type: "agent", id: record.agent_id },
        provenance: record.provenance,
      });
      if (!appended?.ok) return appended;
      result.event = appended.event || null;
      result.sequence = appended.sequence || 0;
    }
    accepted.set(key, clone(result));
    return result;
  }

  function clear() { accepted.clear(); return { ok: true, changed: true }; }

  return Object.freeze({ SPECIALIST_RETURN_SERVICE_VERSION, enabled, accept, toParentEvent, clear });
}

module.exports = Object.freeze({
  SPECIALIST_RETURN_SERVICE_VERSION,
  createSpecialistReturnService,
  toParentEvent,
});
