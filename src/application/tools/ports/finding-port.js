"use strict";

const { validateFindingCandidate } = require("../../../domain/assessment/finding-gate");

function createFindingPort({ assessmentWorkspace, fs, path, verifier = null } = {}) {
  function evidenceFor(context, refs) {
    const result = assessmentWorkspace?.readJsonl?.(context.workspace, "evidence/index.jsonl", { limit: 2000 });
    const wanted = new Set((Array.isArray(refs) ? refs : []).map(String));
    return (result?.records || []).filter((record) => wanted.has(String(record.id || record.requestId)));
  }
  function findingFor(context, findingId) {
    try {
      const document = JSON.parse(fs.readFileSync(path.join(context.workspace, "findings", "findings.json"), "utf8"));
      return (document.findings || []).find((finding) => String(finding.id) === String(findingId)) || null;
    } catch {
      return null;
    }
  }
  async function execute(input, context) {
    if (input.action === "create" || input.action === "update" || input.action === "deduplicate" || input.action === "attach_evidence") {
      const finding = input.finding || {
        id: input.finding_id,
        title: input.title,
        asset: { targetId: input.asset_id },
        severity: input.severity,
        confidence: input.confidence,
        evidence: input.evidence_refs,
        remediation: { recommendation: input.remediation },
        provenance: input.provenance,
        status: "draft",
      };
      const evidence = evidenceFor(context, finding.evidence);
      const gate = validateFindingCandidate(finding, { evidenceRecords: evidence, requireConfirmation: false });
      if (!gate.ok) return { ok: false, error: gate.errors.map((item) => item.message).join(" "), code: gate.errors[0]?.code || "FINDING_GATE_FAILED" };
      if (input.action === "deduplicate") return { ok: true, fingerprint: gate.candidate.fingerprint, duplicate: false, evidence_refs: gate.candidate.evidence };
      if (typeof assessmentWorkspace?.appendFinding !== "function") return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Finding storage is unavailable." };
      const stored = assessmentWorkspace.appendFinding(context.workspace, gate.candidate);
      if (stored.error) return stored;
      return { ok: true, finding_id: stored.finding?.id || gate.candidate.id, evidence_refs: gate.candidate.evidence, provenance: gate.candidate.provenance || "unified-tool" };
    }
    if (["assess", "confirm", "negative_control", "retest", "status"].includes(input.action)) {
      if (typeof verifier !== "function") return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Independent verifier is unavailable." };
      const finding = input.finding || findingFor(context, input.finding_id);
      if (!finding) return { ok: false, error: "Finding was not found.", code: "FINDING_NOT_FOUND" };
      const result = await verifier({ finding, findingId: input.finding_id, evidenceRefs: input.evidence_refs, action: input.action, context });
      return { ok: Boolean(result?.ok), status: result?.status || "inconclusive", evidence_refs: input.evidence_refs || [], summary: result?.summary || "Verifier result recorded." };
    }
    return { ok: false, error: `Unsupported finding action: ${input.action}`, code: "UNKNOWN_ACTION" };
  }
  return Object.freeze({ execute });
}

module.exports = { createFindingPort };
