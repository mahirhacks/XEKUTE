const crypto = require("crypto");
const ScopeEngine = require("../scope/scope-engine");

const CONFIRMED_STATUSES = new Set(["confirmed", "reported", "remediated", "retest-required"]);
const VALID_SEVERITIES = new Set(["informational", "low", "medium", "high", "critical", "unassigned"]);

function normalizeSeverity(value) {
  const severity = String(value || "unassigned").toLowerCase();
  if (severity === "info") return "informational";
  if (severity === "easy") return "low";
  return VALID_SEVERITIES.has(severity) ? severity : "unassigned";
}

function fingerprint(finding) {
  const stable = [finding?.title, finding?.asset?.host || finding?.asset?.url, finding?.asset?.endpoint, finding?.classification?.vulnerabilityType]
    .map((value) => String(value || "").trim().toLowerCase()).join("|");
  return crypto.createHash("sha256").update(stable).digest("hex");
}

function evidenceRelevant(finding, evidence) {
  const targetId = String(finding?.asset?.targetId || "");
  if (targetId && String(evidence?.targetId || "") === targetId) return true;
  const findingTarget = ScopeEngine.canonicalTarget(finding?.asset?.url || finding?.asset?.host || "");
  const evidenceTarget = ScopeEngine.canonicalTarget(evidence?.url || evidence?.host || "");
  if (findingTarget && evidenceTarget && findingTarget.hostname === evidenceTarget.hostname) return true;
  return !targetId && !findingTarget && Boolean(evidence?.filePath || evidence?.requestId);
}

function requiresIndependentVerifier(finding) {
  const severity = normalizeSeverity(finding?.severity);
  const type = String(finding?.classification?.vulnerabilityType || "").toLowerCase();
  const categories = Array.isArray(finding?.classification?.owaspCategories) ? finding.classification.owaspCategories.join(" ").toLowerCase() : "";
  return ["high", "critical"].includes(severity)
    || String(finding?.source || "").toLowerCase().includes("scanner")
    || /auth|authori[sz]ation|access.?control|idor|business.?logic|workflow/.test(`${type} ${categories}`)
    || Boolean(finding?.verification?.contradictoryEvidence);
}

function validateFindingCandidate(finding, { evidenceRecords = [], scope = {}, requireConfirmation = null } = {}) {
  const candidate = { ...finding, severity: normalizeSeverity(finding?.severity) };
  const errors = [];
  const warnings = [];
  const confirmed = requireConfirmation == null ? CONFIRMED_STATUSES.has(String(candidate.status || "draft")) : Boolean(requireConfirmation);
  const evidenceIds = Array.isArray(candidate.evidence) ? [...new Set(candidate.evidence.map(String).filter(Boolean))] : [];
  const evidenceById = new Map((Array.isArray(evidenceRecords) ? evidenceRecords : []).map((record) => [String(record?.id || ""), record]));
  const resolvedEvidence = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  const missingEvidenceIds = evidenceIds.filter((id) => !evidenceById.has(id));
  if (confirmed && !evidenceIds.length) errors.push({ code: "EVIDENCE_REQUIRED", message: "Confirmed findings require admissible evidence IDs." });
  if (confirmed && missingEvidenceIds.length) errors.push({ code: "EVIDENCE_NOT_FOUND", message: `Evidence records do not exist: ${missingEvidenceIds.join(", ")}` });
  if (confirmed && resolvedEvidence.some((record) => !/^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")))) errors.push({ code: "EVIDENCE_HASH_INVALID", message: "Every evidence record must carry a valid SHA-256 digest." });
  if (confirmed && resolvedEvidence.some((record) => record?.hashValid === false)) errors.push({ code: "EVIDENCE_HASH_MISMATCH", message: "An evidence artifact no longer matches its recorded SHA-256 digest." });
  if (confirmed && resolvedEvidence.some((record) => !evidenceRelevant(candidate, record))) errors.push({ code: "EVIDENCE_TARGET_MISMATCH", message: "Every referenced evidence record must be relevant to the affected asset." });

  const targetValue = candidate?.asset?.url || candidate?.asset?.host || "";
  if (confirmed && !targetValue && !candidate?.asset?.targetId) errors.push({ code: "FINDING_TARGET_REQUIRED", message: "Confirmed findings require an affected in-scope target." });
  if (confirmed && targetValue) {
    const scopeDecision = ScopeEngine.evaluateTarget(targetValue, scope);
    if (!scopeDecision.allowed) errors.push({ code: scopeDecision.code || "TARGET_OUT_OF_SCOPE", message: scopeDecision.reason || "The finding target is not in scope." });
  }

  const reproduction = candidate.reproduction || {};
  if (confirmed && (!Array.isArray(reproduction.steps) || !reproduction.steps.length)) errors.push({ code: "REPRODUCTION_REQUIRED", message: "Confirmed findings require reproduction steps." });
  if (confirmed && !String(reproduction.expectedResult || "").trim()) errors.push({ code: "EXPECTED_RESULT_REQUIRED", message: "Expected secure behavior must be recorded." });
  if (confirmed && !String(reproduction.observedResult || "").trim()) errors.push({ code: "OBSERVED_RESULT_REQUIRED", message: "Observed behavior must be recorded." });
  const singleShotLimitation = (Array.isArray(candidate.limitations) ? candidate.limitations : []).some((value) => /single.?shot|not repeat|production safety|one.?time/i.test(String(value)));
  if (confirmed && candidate?.verification?.reproductionSuccessful !== true && !singleShotLimitation) errors.push({ code: "REPRODUCTION_VERDICT_REQUIRED", message: "Record successful reproduction or a justified single-shot limitation before confirmation." });
  if (confirmed && !String(candidate?.impact?.technical || "").trim()) errors.push({ code: "TECHNICAL_IMPACT_REQUIRED", message: "Technical behavior and impact must be recorded separately." });
  if (confirmed && !String(candidate?.impact?.business || "").trim()) errors.push({ code: "BUSINESS_IMPACT_REQUIRED", message: "Business impact must be recorded separately from technical behavior." });
  const checks = Array.isArray(candidate?.verification?.falsePositiveChecks) ? candidate.verification.falsePositiveChecks.filter((value) => String(value).trim()) : [];
  if (confirmed && !checks.length) errors.push({ code: "FALSE_POSITIVE_CHECK_REQUIRED", message: "At least one false-positive check is required." });
  const verifierEvidenceId = String(candidate?.verification?.verifierEvidenceId || "");
  const verifierEvidence = verifierEvidenceId ? evidenceById.get(verifierEvidenceId) : null;
  const verifierAuthentic = Boolean(verifierEvidence && evidenceIds.includes(verifierEvidenceId) && verifierEvidence.type === "verification-verdict" && verifierEvidence.source === "pointer-hybrid-verifier" && /^[a-f0-9]{64}$/i.test(String(candidate?.verification?.packetSha256 || "")));
  if (confirmed && requiresIndependentVerifier(candidate) && (candidate?.verification?.verdict !== "accept" || !verifierAuthentic)) errors.push({ code: "VERIFIER_REQUIRED", message: "This candidate requires an accepting XEKUTE hybrid-verifier record linked as evidence." });
  if (candidate?.verification?.verdict === "inconclusive" || candidate?.verification?.verdict === "reject") errors.push({ code: "VERIFIER_REJECTED", message: "An inconclusive or rejected verifier verdict cannot be promoted." });
  if (!confirmed && missingEvidenceIds.length) warnings.push(`Unresolved evidence IDs: ${missingEvidenceIds.join(", ")}`);

  return {
    ok: errors.length === 0,
    candidate: { ...candidate, evidence: evidenceIds, fingerprint: candidate.fingerprint || fingerprint(candidate) },
    errors,
    warnings,
    resolvedEvidence,
    missingEvidenceIds,
    requiresVerifier: requiresIndependentVerifier(candidate),
  };
}

module.exports = { CONFIRMED_STATUSES, VALID_SEVERITIES, normalizeSeverity, fingerprint, evidenceRelevant, requiresIndependentVerifier, validateFindingCandidate };
