"use strict";

const { assert, assertMemoryId, createQueryRequest, canonicalJson } = require("../../../contracts/memory/index.js");
const { cloneSafe } = require("../value-safety.js");
const { normalizeProjectMemory } = require("./project-memory.js");

function failure(code, error, details = {}) { return { ok: false, code, error: String(error || "Project Memory query failed."), retryable: false, details }; }

function createProjectMemoryQuery({ now = () => new Date() } = {}) {
  function query(inputState, inputRequest = {}) {
    const projectId = String(inputRequest.project_id || inputRequest.projectId || inputState?.project_id || "").trim();
    let request;
    let state;
    try {
      assertMemoryId(projectId, "proj");
      state = normalizeProjectMemory(inputState, { projectId, now });
      request = createQueryRequest({ ...inputRequest, project_id: projectId });
    } catch (error) { return failure(error.code || "MEMORY_QUERY_INVALID", error.message, error.details || {}); }
    const operation = String(inputRequest.operation || inputRequest.kind || "overview").trim().toLowerCase();
    const sourceRevision = state.revision;
    const requestedRevision = request.source_revisions?.project == null ? null : Number(request.source_revisions.project);
    if (requestedRevision !== null && (!Number.isInteger(requestedRevision) || requestedRevision < 0)) return failure("MEMORY_QUERY_REVISION_INVALID", "The requested source revision is invalid.");
    if (requestedRevision !== null && requestedRevision > sourceRevision) return failure("MEMORY_QUERY_REVISION_UNAVAILABLE", "The requested Project Memory revision is not available.", { requestedRevision, sourceRevision }, true);
    const stale = requestedRevision !== null && requestedRevision < sourceRevision;
    const all = [
      ...state.entities.map((record) => ({ ...record, _kind: "entity" })),
      ...state.claims.map((record) => ({ ...record, _kind: "claim" })),
      ...state.relationships.map((record) => ({ ...record, _kind: "relationship" })),
    ];
    const searchTerm = String(request.filters?.search || inputRequest.search || request.objective || "").trim().toLowerCase();
    const filter = (record) => {
      if (request.filters?.record_id && record.record_id !== request.filters.record_id) return false;
      if (request.filters?.entity_type && record.entity_type !== String(request.filters.entity_type).toLowerCase()) return false;
      if (request.filters?.predicate && record.predicate !== String(request.filters.predicate).toLowerCase()) return false;
      if (request.filters?.relationship_type && record.relationship_type !== String(request.filters.relationship_type).toUpperCase()) return false;
      if (request.filters?.state && record.state !== String(request.filters.state).toLowerCase()) return false;
      if (!searchTerm) return true;
      return canonicalJson(record).toLowerCase().includes(searchTerm);
    };
    const selected = all.filter(filter).sort((left, right) => left.record_id.localeCompare(right.record_id));
    const bounded = Math.min(200, Math.max(1, request.limit || 50));
    const pageStart = request.cursor ? Math.max(0, selected.findIndex((record) => record.record_id === request.cursor) + 1) : 0;
    const page = selected.slice(pageStart, pageStart + bounded).map(({ _kind, ...record }) => cloneSafe(record));
    const base = { ok: true, operation, projectId, sourceRevision, stale, limit: bounded, requestedCount: selected.length, includedCount: page.length, omittedCount: Math.max(0, selected.length - pageStart - page.length), nextCursor: page.length === bounded ? page.at(-1).record_id : "", tokenEstimate: Math.ceil(JSON.stringify(page).length / 4), warnings: [] };
    if (operation === "overview") {
      return { ...base, overview: {
        revision: state.revision,
        entityCount: state.entities.length,
        claimCount: state.claims.length,
        relationshipCount: state.relationships.length,
        conflictCount: state.conflicts.filter((conflict) => conflict.state === "open").length,
        byEntityType: state.entities.reduce((result, entity) => { result[entity.entity_type] = (result[entity.entity_type] || 0) + 1; return result; }, {}),
        byClaimState: state.claims.reduce((result, claim) => { result[claim.state] = (result[claim.state] || 0) + 1; return result; }, {}),
        coverageInputsHash: state.coverage_inputs.hash,
        recentChanges: state.changes.slice(-10).map(cloneSafe),
      }, items: state.entities.slice(0, bounded).map(cloneSafe) };
    }
    if (operation === "entity") {
      const recordId = String(inputRequest.record_id || inputRequest.recordId || request.filters?.record_id || "").trim();
      try { assertMemoryId(recordId, "entity"); } catch (error) { return failure(error.code || "MEMORY_ENTITY_ID_INVALID", error.message, error.details || {}); }
      const entity = state.entities.find((candidate) => candidate.record_id === recordId);
      if (!entity) return failure("MEMORY_RECORD_NOT_FOUND", "The Project Memory entity was not found.", { recordId });
      const relatedClaims = state.claims.filter((claim) => claim.subject_id === recordId || (claim.object.type === "entity_ref" && claim.object.entity_id === recordId)).map(cloneSafe);
      const relatedRelationships = state.relationships.filter((relationship) => relationship.source_id === recordId || relationship.target_id === recordId).map(cloneSafe);
      return { ...base, entity: cloneSafe(entity), claims: relatedClaims.slice(0, bounded), relationships: relatedRelationships.slice(0, bounded), omittedCount: Math.max(0, relatedClaims.length + relatedRelationships.length - bounded * 2) };
    }
    if (operation === "neighbors") {
      const recordId = String(inputRequest.record_id || inputRequest.recordId || inputRequest.entity_id || inputRequest.entityId || "").trim();
      try { assertMemoryId(recordId, "entity"); } catch (error) { return failure(error.code || "MEMORY_ENTITY_ID_INVALID", error.message, error.details || {}); }
      const relationshipRows = state.relationships.filter((relationship) => relationship.source_id === recordId || relationship.target_id === recordId);
      const neighborIds = [...new Set(relationshipRows.map((relationship) => relationship.source_id === recordId ? relationship.target_id : relationship.source_id))];
      const neighbors = neighborIds.map((id) => state.entities.find((entity) => entity.record_id === id)).filter(Boolean).sort((left, right) => left.record_id.localeCompare(right.record_id)).slice(0, bounded).map(cloneSafe);
      return { ...base, centerId: recordId, neighbors, relationships: relationshipRows.slice(0, bounded).map(cloneSafe), omittedCount: Math.max(0, neighborIds.length - neighbors.length) };
    }
    if (operation === "claims") return { ...base, items: state.claims.filter(filter).slice(pageStart, pageStart + bounded).map(cloneSafe) };
    if (operation === "search") return { ...base, items: page };
    if (operation === "conflicts") return { ...base, items: state.conflicts.slice().sort((left, right) => String(left.conflict_id).localeCompare(String(right.conflict_id))).slice(pageStart, pageStart + bounded).map(cloneSafe) };
    if (operation === "changes") return { ...base, items: state.changes.slice().sort((left, right) => Number(left.revision) - Number(right.revision)).slice(pageStart, pageStart + bounded).map(cloneSafe) };
    if (operation === "provenance") {
      const recordId = String(inputRequest.record_id || inputRequest.recordId || "").trim();
      const record = all.find((candidate) => candidate.record_id === recordId);
      if (!record) return failure("MEMORY_RECORD_NOT_FOUND", "The Project Memory record was not found.", { recordId });
      return { ...base, record: cloneSafe(record), provenance: cloneSafe(record.provenance || {}), provenanceRefs: cloneSafe(record.provenance_refs || []) };
    }
    if (operation === "coverage_inputs" || operation === "coverage-inputs") return { ...base, coverageInputs: cloneSafe(state.coverage_inputs) };
    return failure("MEMORY_QUERY_OPERATION_INVALID", `Unsupported Project Memory query operation: ${operation}.`, { operation });
  }
  return Object.freeze({ query });
}

module.exports = Object.freeze({ createProjectMemoryQuery });
