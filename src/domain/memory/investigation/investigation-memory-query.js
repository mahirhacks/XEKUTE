"use strict";

const { assertMemoryId } = require("../../../contracts/memory/index.js");
const { cloneSafe } = require("../value-safety.js");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function limitOf(value) { return Math.min(MAX_LIMIT, Math.max(1, Number(value) || DEFAULT_LIMIT)); }
function offsetOf(value) { const offset = Number.parseInt(String(value || "0"), 10); return Number.isInteger(offset) && offset >= 0 ? offset : 0; }
function paginate(items, request = {}) {
  const limit = limitOf(request.limit);
  const offset = offsetOf(request.cursor);
  const page = items.slice(offset, offset + limit).map(cloneSafe);
  return { items: page, nextCursor: offset + page.length < items.length ? String(offset + page.length) : "", total: items.length, omitted: Math.max(0, items.length - offset - page.length) };
}
function sorted(values) { return (Array.isArray(values) ? values : []).slice().sort((left, right) => String(left.record_id || "").localeCompare(String(right.record_id || ""))); }

function createInvestigationMemoryQuery({ now = () => new Date() } = {}) {
  function query(state, request = {}) {
    const operation = text(request.operation || request.kind || "overview", 80).toLowerCase();
    const filters = request.filters && typeof request.filters === "object" ? request.filters : {};
    const source = state && typeof state === "object" ? state : {};
    const allRecords = [
      ...(source.programmes || []),
      ...(source.investigations || []),
      ...(source.applicability || []),
      ...(source.test_cases || []),
      ...(source.assignments || []),
      ...(source.attempts || []),
      ...(source.negative_results || []),
      ...(source.candidates || []),
      ...(source.blockers || []),
      ...(source.coverage || []),
      ...(source.remaining_work || []),
    ];
    const byId = (collection, id) => (source[collection] || []).find((entry) => entry.record_id === String(id || ""));
    const filtered = (collection) => sorted(source[collection]).filter((record) => {
      if (filters.investigation_id && record.investigation_id !== String(filters.investigation_id)) return false;
      if (filters.test_case_id && record.test_case_id !== String(filters.test_case_id)) return false;
      if (filters.procedure_id && record.procedure_id !== String(filters.procedure_id)) return false;
      if (filters.status && String(record.state || record.status || "") !== String(filters.status)) return false;
      if (filters.outcome && String(record.outcome || "") !== String(filters.outcome)) return false;
      return true;
    });
    if (operation === "overview") {
      return { ok: true, project_id: source.project_id, revision: source.revision, overview: {
        programmeCount: source.programmes?.length || 0,
        investigationCount: source.investigations?.length || 0,
        testCaseCount: source.test_cases?.length || 0,
        attemptCount: source.attempts?.length || 0,
        negativeResultCount: source.negative_results?.length || 0,
        candidateCount: source.candidates?.length || 0,
        blockerCount: source.blockers?.filter((entry) => entry.status === "open").length || 0,
        coverageCount: source.coverage?.length || 0,
        remainingWorkCount: source.remaining_work?.length || 0,
      }, sourceRevision: source.revision };
    }
    if (operation === "investigation" || operation === "details") {
      const id = filters.record_id || request.record_id || request.investigation_id || request.investigationId;
      const investigation = byId("investigations", id);
      if (!investigation) return { ok: false, code: "MEMORY_RECORD_NOT_FOUND", error: "The Investigation record was not found.", retryable: false, details: { recordId: String(id || "") } };
      return { ok: true, project_id: source.project_id, revision: source.revision, investigation: cloneSafe(investigation), test_cases: filtered("test_cases").filter((entry) => entry.investigation_id === investigation.record_id), applicability: filtered("applicability").filter((entry) => entry.investigation_id === investigation.record_id), assignments: filtered("assignments").filter((entry) => entry.investigation_id === investigation.record_id), attempts: filtered("attempts").filter((entry) => entry.investigation_id === investigation.record_id), negative_results: filtered("negative_results").filter((entry) => entry.investigation_id === investigation.record_id), candidates: filtered("candidates").filter((entry) => entry.investigation_id === investigation.record_id), blockers: filtered("blockers").filter((entry) => entry.investigation_id === investigation.record_id), coverage: filtered("coverage").filter((entry) => entry.investigation_id === investigation.record_id), sourceRevision: source.revision };
    }
    const collectionByOperation = {
      programmes: "programmes",
      programme: "programmes",
      investigations: "investigations",
      applicability: "applicability",
      test_cases: "test_cases",
      testcases: "test_cases",
      assignments: "assignments",
      attempts: "attempts",
      negative_results: "negative_results",
      candidates: "candidates",
      blockers: "blockers",
      coverage: "coverage",
      remaining_work: "remaining_work",
      changes: "changes",
      records: null,
      search: null,
      provenance: null,
    };
    if (operation === "search") {
      const term = text(request.query || filters.query || "", 500).toLowerCase();
      const matches = allRecords.filter((record) => !term || JSON.stringify(record).toLowerCase().includes(term));
      const page = paginate(sorted(matches), request);
      return { ok: true, project_id: source.project_id, revision: source.revision, ...page, sourceRevision: source.revision };
    }
    if (operation === "records") {
      const page = paginate(sorted(allRecords), request);
      return { ok: true, project_id: source.project_id, revision: source.revision, ...page, sourceRevision: source.revision };
    }
    if (operation === "provenance") {
      const recordId = request.record_id || filters.record_id;
      const record = allRecords.find((entry) => entry.record_id === String(recordId || ""));
      if (!record) return { ok: false, code: "MEMORY_RECORD_NOT_FOUND", error: "The Investigation record was not found.", retryable: false, details: { recordId: String(recordId || "") } };
      return { ok: true, project_id: source.project_id, revision: source.revision, record_id: record.record_id, provenance: cloneSafe(record.provenance || {}), provenance_refs: cloneSafe(record.provenance_refs || []), sourceRevision: source.revision };
    }
    const collection = collectionByOperation[operation];
    if (collection) {
      const page = paginate(filtered(collection), request);
      return { ok: true, project_id: source.project_id, revision: source.revision, ...page, sourceRevision: source.revision };
    }
    if (operation === "changes") {
      const page = paginate((source.changes || []).slice().sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0)), request);
      return { ok: true, project_id: source.project_id, revision: source.revision, ...page, sourceRevision: source.revision };
    }
    return { ok: false, code: "MEMORY_QUERY_OPERATION_INVALID", error: `Unsupported Investigation query operation: ${operation}.`, retryable: false, details: { operation } };
  }

  return Object.freeze({ query, now });
}

module.exports = Object.freeze({ createInvestigationMemoryQuery, DEFAULT_LIMIT, MAX_LIMIT });
