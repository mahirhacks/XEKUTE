"use strict";

// Durable context is deliberately smaller than a transcript.  This module is
// the trust boundary: parsers receive lifecycle results, never chat prose.
const crypto = require("node:crypto");
const { integrityHash } = require("../../../contracts/tool/result-schema.js");

const CAPSULE_VERSION = 1;
const CLAIM_STATES = Object.freeze(["verified", "observed", "failed", "inconclusive", "hypothesis", "user_assertion", "unsupported"]);
const RECORD_KINDS = Object.freeze(["mutation", "assessment", "retrieval", "execution", "requirement", "residue"]);

function text(value, limit = 2000) {
  return String(value == null ? "" : value).normalize("NFC").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, limit);
}
function redacted(value, limit = 2000) {
  return text(value, limit)
    .replace(/(authorization|x-api-key|api[_-]?key|token|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(?:sk|or|ghp)_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}
function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}
function canonicalPath(value, workspace = "") {
  const raw = text(value, 4096).replace(/\\/g, "/");
  const root = text(workspace, 4096).replace(/\\/g, "/").replace(/\/+$/, "");
  return root && raw.toLowerCase().startsWith(root.toLowerCase() + "/") ? raw.slice(root.length + 1) : raw;
}
function canonicalUrl(value) {
  const raw = text(value, 4096);
  try {
    const url = new URL(raw);
    url.protocol = url.protocol.toLowerCase(); url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
    url.hash = "";
    return url.toString();
  } catch { return raw; }
}
function parseObject(value) {
  if (!value || typeof value === "object") return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (typeof value !== "string" || value.length > 1_000_000) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function lifecycleValid(result) {
  if (!result || typeof result !== "object" || !result.integrityHash) return false;
  const { integrityHash: supplied, ...unsigned } = result;
  return supplied === integrityHash(unsigned);
}
function references(result = {}) {
  const value = parseObject(result.capabilityData);
  const candidates = [result.auditReference, result.invocationId, ...(result.verification?.evidence || []), ...(value.evidenceIds || []), ...(value.evidence_refs || [])];
  return [...new Set(candidates.map((item) => text(typeof item === "string" ? item : item?.id || item?.reference || "", 240)).filter(Boolean))].sort();
}
function record({ kind, claimState, subject, value = {}, source = {}, required = false, template = "observation" } = {}) {
  const canonical = {
    kind: RECORD_KINDS.includes(kind) ? kind : "residue",
    claimState: CLAIM_STATES.includes(claimState) ? claimState : "unsupported",
    subject: redacted(subject, 1000),
    value,
    sourceRefs: [...new Set((source.refs || []).map((item) => text(item, 240)).filter(Boolean))].sort(),
    evidenceIds: [...new Set((source.evidenceIds || []).map((item) => text(item, 240)).filter(Boolean))].sort(),
    required: Boolean(required), template: text(template, 80) || "observation",
  };
  canonical.valueHash = stableId("value", canonical.value);
  canonical.id = stableId("record", { kind: canonical.kind, claimState: canonical.claimState, subject: canonical.subject, valueHash: canonical.valueHash, refs: canonical.sourceRefs });
  return canonical;
}
function residue(reason, source = {}) { return record({ kind: "residue", claimState: "unsupported", subject: "Unresolved tool result", value: { reason: text(reason, 240) }, source, template: "residue" }); }
function explicitUserRecords(message, source = {}) {
  const value = redacted(message, 4000);
  const explicit = /\b(?:remember|save|keep)\b/i.test(value);
  const requirement = /\b(?:please|must|mustn't|do not|don't|need|should|prefer|only|always|never|implement|build|fix|create|use|avoid|allow|require)\b/i.test(value);
  if (!explicit && !requirement) return [];
  return [record({ kind: "requirement", claimState: "user_assertion", subject: value, value: { attributedTo: "user", explicit, requirement: !explicit }, source, required: true, template: "user_assertion" })];
}
function createCapsule({ sessionId = "", blockId = "", sequence = 0, toolName = "", args = {}, lifecycleResult = null, records = [], residues = [] } = {}) {
  const capsule = {
    schemaVersion: CAPSULE_VERSION, sessionId: text(sessionId, 240), blockId: text(blockId, 240), sequence: Number(sequence) || 0,
    toolName: text(toolName, 160), argumentSignature: stableId("args", redacted(JSON.stringify(args || {}), 8000)),
    lifecycle: lifecycleResult ? { invocationId: text(lifecycleResult.invocationId, 240), outcome: text(lifecycleResult.outcome, 80), integrityHash: text(lifecycleResult.integrityHash, 128), valid: lifecycleValid(lifecycleResult) } : null,
    records: records.map((entry) => entry?.id && entry?.valueHash
      ? { ...entry, sourceRefs: [...new Set(entry.sourceRefs || [])].sort(), evidenceIds: [...new Set(entry.evidenceIds || [])].sort() }
      : record(entry)), residues: residues.map((entry) => residue(entry.reason || entry, entry.source || {})),
    createdAt: new Date().toISOString(),
  };
  capsule.integrityHash = stableId("capsule", { ...capsule, integrityHash: undefined });
  return capsule;
}

module.exports = { CAPSULE_VERSION, CLAIM_STATES, RECORD_KINDS, text, redacted, stableId, canonicalPath, canonicalUrl, parseObject, lifecycleValid, references, record, residue, explicitUserRecords, createCapsule };
