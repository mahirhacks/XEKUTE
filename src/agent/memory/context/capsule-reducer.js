"use strict";
const C = require("./context-capsule.js");
const SECTION_BY_KIND = Object.freeze({ requirement: "Requirements and preferences", mutation: "Workspace state and completed work", assessment: "Verification and failures", execution: "Verification and failures", retrieval: "Coverage and references", residue: "Known gaps" });
function capsuleIntegrityValid(capsule) { if (!capsule?.integrityHash) return false; const { integrityHash, ...unsigned } = capsule; return integrityHash === C.stableId("capsule", unsigned); }
function reduceCapsules(capsules = [], { userRecords = [] } = {}) {
  const residues = []; const byKey = new Map(); const latestMutation = new Map();
  for (const capsule of [...capsules].sort((a, b) => String(a.blockId).localeCompare(String(b.blockId)) || Number(a.sequence) - Number(b.sequence))) {
    if (capsule?.schemaVersion !== 1 || !capsule?.lifecycle?.valid || !capsuleIntegrityValid(capsule)) { residues.push({ reason: "invalid_capsule_integrity", capsuleId: capsule?.integrityHash || "" }); continue; }
    for (const entry of capsule.residues || []) residues.push(entry);
    for (const record of capsule.records || []) {
      if (!record?.id || !C.RECORD_KINDS.includes(record.kind) || !C.CLAIM_STATES.includes(record.claimState) || !record.valueHash || !Array.isArray(record.sourceRefs) || !record.sourceRefs.length) { residues.push({ reason: "invalid_or_unsourced_record", capsuleId: capsule.integrityHash }); continue; }
      const key = [record.kind, record.subject, record.claimState, record.valueHash].join("\0");
      const revision = C.text(record?.value?.revision || "", 160);
      if (record.kind === "mutation" && record.claimState === "verified" && revision) {
        const stateKey = `${record.subject}\0${record.value?.tool || ""}`;
        const previous = latestMutation.get(stateKey);
        if (previous && previous !== key) byKey.delete(previous);
        latestMutation.set(stateKey, key);
      }
      const prior = byKey.get(key);
      if (prior) { prior.count += 1; prior.sourceRefs = [...new Set([...prior.sourceRefs, ...(record.sourceRefs || [])])].sort(); prior.evidenceIds = [...new Set([...prior.evidenceIds, ...(record.evidenceIds || [])])].sort(); prior.required ||= Boolean(record.required); }
      else byKey.set(key, { ...record, count: 1 });
    }
  }
  // Explicit user memories are attributed requirements; they intentionally
  // bypass lifecycle verification but retain their non-factual claim state.
  for (const record of userRecords || []) {
    if (record?.claimState !== "user_assertion") continue;
    const key = [record.kind, record.subject, record.claimState, record.valueHash].join("\0");
    if (!byKey.has(key)) byKey.set(key, { ...record, required: true, count: 1 });
  }
  const records = [...byKey.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
  return { version: 1, records, residues, requiredIds: records.filter((r) => r.required || ["verified", "failed", "user_assertion"].includes(r.claimState)).map((r) => r.id), reductionHash: C.stableId("reduction", records) };
}
function defaultSynthesisPlan(reduced) { return { version: 1, items: reduced.records.map((record, index) => ({ section: SECTION_BY_KIND[record.kind] || "Known gaps", template: record.template, recordIds: [record.id], order: index })) }; }
function validateSynthesisPlan(plan, reduced) { const records = new Map(reduced.records.map((r) => [r.id, r])); const items = Array.isArray(plan?.items) ? plan.items : null; if (!items) return { ok: false, errors: ["items must be an array"], items: [], missingRequired: [...reduced.requiredIds] }; const seen = new Set(); const valid = []; const errors = [];
  for (const item of items) { const ids = Array.isArray(item?.recordIds) ? item.recordIds : []; const selected = ids.map((id) => records.get(id)).filter(Boolean); if (!selected.length || selected.length !== ids.length || new Set(ids).size !== ids.length || selected.some((record) => seen.has(record.id))) { errors.push("item references an unknown or duplicate record ID"); continue; } const first = selected[0]; if (selected.some((r) => SECTION_BY_KIND[r.kind] !== item.section || (item.template && item.template !== r.template) || r.kind !== first.kind || r.claimState !== first.claimState)) { errors.push("item has incompatible section, template, kind, or claim state"); continue; } selected.forEach((r) => seen.add(r.id)); valid.push({ section: item.section, template: item.template || first.template, recordIds: ids, order: Number(item.order) || 0 }); }
  const missing = reduced.requiredIds.filter((id) => !seen.has(id)); if (missing.length) errors.push(`missing required records: ${missing.join(",")}`); return { ok: !errors.length, errors, items: valid, missingRequired: missing };
}
function statement(record) { const suffix = record.count > 1 ? ` (repeated ${record.count} times)` : ""; const state = record.claimState === "user_assertion" ? "User assertion (unverified): " : record.claimState === "verified" ? "Verified: " : record.claimState === "failed" ? "Failed: " : record.claimState === "inconclusive" ? "Inconclusive: " : "Observed: "; const tool = C.text(record.value?.tool || "", 160); const refs = record.sourceRefs?.length ? ` [sources: ${record.sourceRefs.join(", ")}]` : ""; return `${state}${record.subject}${tool ? ` via ${tool}` : ""}${suffix}${refs}`; }
function renderCanonicalMarkdown(validation, reduced) { const records = new Map(reduced.records.map((r) => [r.id, r])); const sections = new Map(); for (const item of [...validation.items].sort((a, b) => a.order - b.order || a.section.localeCompare(b.section))) { const lines = item.recordIds.map((id) => statement(records.get(id))); if (!sections.has(item.section)) sections.set(item.section, []); sections.get(item.section).push(...lines); } return [...sections.entries()].map(([heading, lines]) => `## ${heading}\n${[...new Set(lines)].map((line) => `- ${line}`).join("\n")}`).join("\n\n"); }
function projectDelta(reduced, { sessionId = "", blockId = "" } = {}) { const delta = { sessionId, completedWork: [], findings: [], failures: [], negativeResults: [], decisions: [] }; for (const record of reduced.records || []) { const base = { id: record.id, summary: statement(record), sourceRefs: record.sourceRefs || [] }; if (record.kind === "mutation" && record.claimState === "verified") delta.completedWork.push({ ...base, toolName: record.value?.tool || "", outcome: "completed" }); else if (record.kind === "assessment" && record.claimState === "verified") delta.findings.push({ ...base, status: "verified" }); else if (record.claimState === "failed") delta.failures.push({ ...base, toolName: record.value?.tool || "", outcome: "failed" }); else if (record.kind === "assessment" && record.claimState === "inconclusive") delta.negativeResults.push({ ...base, confidence: "inconclusive" }); else if (record.claimState === "user_assertion") delta.decisions.push({ ...base, kind: "explicit_project_memory", confidence: "explicit" }); } delta.idempotencyKey = C.stableId("capsule_project_delta", { sessionId, blockId, reductionHash: reduced.reductionHash }); return delta; }
module.exports = { SECTION_BY_KIND, capsuleIntegrityValid, reduceCapsules, defaultSynthesisPlan, validateSynthesisPlan, renderCanonicalMarkdown, projectDelta };
