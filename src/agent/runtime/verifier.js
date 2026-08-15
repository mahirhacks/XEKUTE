const { VERDICTS } = require("../../prompts/skills/triage");
const TriagePrompts = require("../../prompts/instructions/triage.js");

function boundedEvidencePacket(claim = {}, evidence = [], { maxRecords = 20, maxChars = 24000 } = {}) {
  let remaining = maxChars;
  const records = [];
  for (const item of Array.isArray(evidence) ? evidence.slice(0, maxRecords) : []) {
    const normalized = {
      id: String(item?.id || ""),
      sha256: String(item?.sha256 || ""),
      targetId: String(item?.targetId || ""),
      url: String(item?.url || ""),
      source: String(item?.source || item?.capturedBy || ""),
      status: String(item?.status || "complete"),
      excerpt: String(item?.excerpt || item?.notes || item?.request || item?.response || "").slice(0, Math.max(0, Math.min(4000, remaining))),
    };
    remaining -= normalized.excerpt.length;
    records.push(normalized);
    if (remaining <= 0) break;
  }
  return { claim, evidence: records, limitations: Array.isArray(claim?.limitations) ? claim.limitations : [] };
}

function verifierMessages(packet) {
  return [
    {
      role: "system",
      content: TriagePrompts.VERIFIER_SYSTEM_PROMPT,
    },
    { role: "user", content: `UNTRUSTED VERIFICATION PACKET\n${JSON.stringify(packet)}` },
  ];
}

function parseVerifierResponse(value) {
  let parsed = value;
  if (typeof value === "string") {
    const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { parsed = JSON.parse(text); }
    catch { return { ok: false, verdict: "inconclusive", error: "Verifier returned malformed JSON." }; }
  }
  if (!parsed || typeof parsed !== "object" || !VERDICTS.has(parsed.verdict)) {
    return { ok: false, verdict: "inconclusive", error: "Verifier returned an invalid verdict." };
  }
  const list = (key) => Array.isArray(parsed[key]) ? parsed[key].map(String).filter(Boolean).slice(0, 100) : [];
  const normalized = {
    ok: true,
    verdict: parsed.verdict,
    supportedClaims: list("supportedClaims"),
    unsupportedClaims: list("unsupportedClaims"),
    missingEvidence: list("missingEvidence"),
    falsePositiveChecks: list("falsePositiveChecks"),
    rationale: String(parsed.rationale || "").slice(0, 8000),
  };
  if (normalized.verdict === "accept" && (!normalized.supportedClaims.length || normalized.unsupportedClaims.length || normalized.missingEvidence.length || !normalized.falsePositiveChecks.length || !normalized.rationale.trim())) {
    return { ...normalized, ok: false, verdict: "inconclusive", error: "An accepting verifier verdict requires supported claims, false-positive checks, rationale, and no unsupported or missing evidence." };
  }
  return normalized;
}



module.exports = { VERDICTS, boundedEvidencePacket, verifierMessages, parseVerifierResponse };
