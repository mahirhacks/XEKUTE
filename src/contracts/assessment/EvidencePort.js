"use strict";

/**
 * EvidencePort
 *
 * Contract for evidence operations: append/read/hash/redact metadata plus
 * evidence identifiers. Implemented by the assessment workspace; injected so
 * application/domain consumers never depend on a concrete storage module.
 */

const EvidencePort = Object.freeze({
  appendEvidenceRecord(workspace, record) { return null; },
  readEvidence(workspace, evidenceIds) { return { ok: false, records: [] }; },
  evidenceHash(record) { return ""; },
  redactEvidenceRecord(record) { return record; },
});

module.exports = EvidencePort;
