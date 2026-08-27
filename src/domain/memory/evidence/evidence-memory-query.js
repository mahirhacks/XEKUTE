"use strict";

const { cloneSafe } = require("../value-safety.js");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function paginate(items, request = {}) { const limit = Math.min(MAX_LIMIT, Math.max(1, Number(request.limit) || DEFAULT_LIMIT)); const offsetValue = Number.parseInt(String(request.cursor || "0"), 10); const offset = Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0; const page = items.slice(offset, offset + limit).map(cloneSafe); return { items: page, nextCursor: offset + page.length < items.length ? String(offset + page.length) : "", total: items.length, omitted: Math.max(0, items.length - offset - page.length) }; }

function createEvidenceMemoryQuery() {
  function query(state, request = {}) {
    const operation = text(request.operation || request.kind || "overview", 80).toLowerCase();
    const filters = request.filters && typeof request.filters === "object" ? request.filters : {};
    const requestedSeverity = filters.severity ? String(filters.severity).trim().toLowerCase() : "";
    const requestedState = filters.state ? String(filters.state).trim().toLowerCase() : "";
    const findings = (state.findings || []).filter((finding) =>
      (!requestedSeverity || finding.severity === requestedSeverity)
      && (!requestedState || finding.state === requestedState)
    ).sort((left, right) => String(left.record_id).localeCompare(String(right.record_id)));
    if (operation === "overview") return { ok: true, project_id: state.project_id, revision: state.revision, overview: { findingCount: state.findings.length, verifiedCount: state.findings.filter((entry) => entry.state === "verified").length, needsRetestCount: state.findings.filter((entry) => entry.state === "needs_retest").length, remediatedCount: state.findings.filter((entry) => entry.state === "remediated").length, verificationCount: state.verifications.length, retestCount: state.retests.length }, sourceRevision: state.revision };
    if (operation === "finding" || operation === "details") {
      const id = request.record_id || request.finding_id || request.findingId || filters.record_id;
      const finding = state.findings.find((entry) => entry.record_id === String(id || "") || entry.finding_id === String(id || ""));
      if (!finding) return { ok: false, code: "MEMORY_RECORD_NOT_FOUND", error: "The Evidence finding was not found.", retryable: false, details: { recordId: String(id || "") } };
      return { ok: true, project_id: state.project_id, revision: state.revision, finding: cloneSafe(finding), verifications: state.verifications.filter((entry) => entry.finding_id === finding.record_id).map(cloneSafe), remediations: state.remediations.filter((entry) => entry.finding_id === finding.record_id).map(cloneSafe), retests: state.retests.filter((entry) => entry.finding_id === finding.record_id).map(cloneSafe), sourceRevision: state.revision };
    }
    if (operation === "findings" || operation === "search") {
      const term = text(request.query || filters.query || "", 500).toLowerCase();
      const matches = findings.filter((finding) => !term || JSON.stringify(finding).toLowerCase().includes(term));
      return { ok: true, project_id: state.project_id, revision: state.revision, ...paginate(matches, request), sourceRevision: state.revision };
    }
    if (operation === "verifications" || operation === "remediations" || operation === "retests" || operation === "changes") {
      const collection = operation;
      const values = (state[collection] || []).slice().sort((left, right) => String(left.record_id || "").localeCompare(String(right.record_id || "")));
      return { ok: true, project_id: state.project_id, revision: state.revision, ...paginate(values, request), sourceRevision: state.revision };
    }
    if (operation === "report") {
      const reportFindings = findings.map((finding) => ({
        record_id: finding.record_id,
        finding_id: finding.finding_id,
        state: finding.state,
        severity: finding.severity,
        confidence: finding.confidence,
        title: finding.title,
        vulnerability_class: finding.vulnerability_class,
        description: finding.description,
        affected_entity_ids: cloneSafe(finding.affected_entity_ids),
        proof_refs: cloneSafe(finding.proof_refs),
        reproduction_refs: cloneSafe(finding.reproduction_refs),
        investigation_ids: cloneSafe(finding.investigation_ids),
        impact: cloneSafe(finding.impact),
        reproduction: cloneSafe(finding.reproduction),
        remediation: cloneSafe(finding.remediation_claim || finding.remediation),
        verification: cloneSafe(finding.verification),
        retest: cloneSafe(finding.retest),
      }));
      return { ok: true, project_id: state.project_id, revision: state.revision, ...paginate(reportFindings, request), sourceRevision: state.revision, redacted: true };
    }
    if (operation === "provenance") {
      const id = request.record_id || filters.record_id;
      const record = [...state.findings, ...state.verifications, ...state.remediations, ...state.retests].find((entry) => entry.record_id === String(id || ""));
      if (!record) return { ok: false, code: "MEMORY_RECORD_NOT_FOUND", error: "The Evidence record was not found.", retryable: false, details: { recordId: String(id || "") } };
      return { ok: true, project_id: state.project_id, revision: state.revision, record_id: record.record_id, provenance: cloneSafe(record.provenance || {}), provenance_refs: cloneSafe(record.provenance_refs || []), sourceRevision: state.revision };
    }
    return { ok: false, code: "MEMORY_QUERY_OPERATION_INVALID", error: `Unsupported Evidence query operation: ${operation}.`, retryable: false, details: { operation } };
  }
  return Object.freeze({ query });
}

module.exports = Object.freeze({ createEvidenceMemoryQuery, DEFAULT_LIMIT, MAX_LIMIT });
