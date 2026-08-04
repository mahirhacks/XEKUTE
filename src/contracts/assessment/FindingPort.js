"use strict";

/**
 * FindingPort
 *
 * Contract for finding-candidate normalization, fingerprinting, evidence
 * relevance, verifier requirements, and promotion-gate decisions. Implemented by
 * the domain finding gate; injected so application services never import a
 * concrete validator.
 */

const FindingPort = Object.freeze({
  normalizeSeverity(value) { return "unassigned"; },
  fingerprint(finding) { return ""; },
  evidenceRelevant(finding, evidence) { return false; },
  requiresIndependentVerifier(finding) { return false; },
  validateFindingCandidate(finding, options) { return { ok: false, errors: [], warnings: [] }; },
});

module.exports = FindingPort;
