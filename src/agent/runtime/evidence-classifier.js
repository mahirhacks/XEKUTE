"use strict";

function classifyEvidenceRequirement({ profile, contextRoute = {}, userMessage = "", evidenceIds = [], assessmentRequested = false } = {}) {
  const ids = Array.isArray(evidenceIds) ? evidenceIds.map(String).filter(Boolean) : [];
  const routeEvidence = contextRoute?.responseRequirements?.evidence === true;
  const explicitEvidence = /\b(?:evidence|finding|hypothesis|verify|scan|assessment|security report)\b/i.test(String(userMessage || ""));
  const required = Boolean(routeEvidence || assessmentRequested || ids.length || (explicitEvidence && profile?.key === "agent"));
  return {
    required,
    mode: required ? "evidence_required" : "evidence_not_required",
    reason: ids.length ? "evidence-produced" : required ? "security-or-evidence-request" : "ordinary-response",
    evidenceIds: ids,
  };
}

module.exports = { classifyEvidenceRequirement };
