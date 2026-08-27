"use strict";

const { assert } = require("./memory-errors.js");
const { assertMemoryId, canonicalKeyHash, createOpaqueId } = require("./memory-identity.js");
const { EVIDENCE_STATES, assertActor, assertProvenance, assertSensitivity } = require("./memory-lifecycle.js");

const EVIDENCE_CONTRACT_VERSION = 1;
const EVIDENCE_SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);
const EVIDENCE_STATE_TRANSITIONS = Object.freeze({
  verified: Object.freeze(["needs_retest", "remediated", "accepted_risk", "duplicate"]),
  needs_retest: Object.freeze(["verified", "remediated", "accepted_risk", "duplicate"]),
  remediated: Object.freeze(["needs_retest", "accepted_risk"]),
  accepted_risk: Object.freeze(["needs_retest", "verified"]),
  duplicate: Object.freeze([]),
});
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret[_-]?value|raw[_-]?value|password)$/i;

function text(value, maximum = 8_000) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_FIELD_TOO_LARGE", "An Evidence field exceeds its maximum length.", { maximum });
  return result;
}

function safeClone(value, depth = 0, key = "") {
  assert(depth <= 10, "MEMORY_PAYLOAD_TOO_DEEP", "Evidence values may not be nested this deeply.");
  assert(!SECRET_KEY.test(String(key || "")), "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in Evidence Memory.", { field: String(key) });
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    assert(value.length <= 500, "MEMORY_ARRAY_TOO_LARGE", "An Evidence list contains too many values.");
    return value.map((entry) => safeClone(entry, depth + 1));
  }
  assert(typeof value === "object", "MEMORY_PAYLOAD_INVALID", "Evidence values must be JSON-compatible.");
  return Object.entries(value).reduce((result, [childKey, child]) => {
    result[text(childKey, 120)] = safeClone(child, depth + 1, childKey);
    return result;
  }, {});
}

function object(value, field) {
  assert(value && typeof value === "object" && !Array.isArray(value), "MEMORY_EVIDENCE_OBJECT_REQUIRED", `${field} must be an object.`);
  return safeClone(value);
}

function iso(value, field, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value == null || value === "" ? fallback : String(value));
  assert(!Number.isNaN(date.getTime()), "MEMORY_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function id(value, prefix, factory = null) {
  if (value) return assertMemoryId(value, prefix);
  return createOpaqueId(prefix, factory ? { uuid: factory } : {});
}

function ids(value, prefix, field, maximum = 100) {
  assert(Array.isArray(value), "MEMORY_EVIDENCE_REFERENCES_REQUIRED", `${field} must be a non-empty array.`);
  const result = [...new Set(value.map((entry) => assertMemoryId(entry, prefix)))].slice(0, maximum);
  assert(result.length > 0, "MEMORY_EVIDENCE_REFERENCES_REQUIRED", `${field} must contain at least one reference.`);
  return result;
}

function hash(value, field, required = false) {
  const result = String(value || "").trim().toLowerCase();
  if (!required && !result) return "";
  assert(HASH_PATTERN.test(result), "MEMORY_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  return result;
}

function actorOf(input) {
  const actor = input?.actor ? safeClone(input.actor) : { type: "system", id: "evidence-memory" };
  assertActor(actor);
  return actor;
}

function provenanceOf(input) {
  const provenance = input?.provenance ? safeClone(input.provenance) : null;
  assertProvenance(provenance);
  return provenance;
}

function sensitivityOf(value) { return assertSensitivity(value || "confidential"); }

function severityOf(value) {
  const severity = text(value, 40).toLowerCase();
  assert(EVIDENCE_SEVERITIES.includes(severity), "MEMORY_EVIDENCE_SEVERITY_INVALID", "Evidence Memory accepts only low, medium, high, or critical confirmed vulnerabilities.", { severity });
  return severity;
}

function stateOf(value = "verified") {
  const state = text(value, 60).toLowerCase();
  assert(EVIDENCE_STATES.includes(state), "MEMORY_EVIDENCE_STATE_INVALID", `Unsupported Evidence lifecycle state: ${state || "<empty>"}.`);
  return state;
}

function canEvidenceTransition(from, to) {
  const source = stateOf(from);
  const target = stateOf(to);
  return source === target || Boolean(EVIDENCE_STATE_TRANSITIONS[source]?.includes(target));
}

function assertEvidenceTransition(from, to) {
  assert(canEvidenceTransition(from, to), "MEMORY_LIFECYCLE_TRANSITION_INVALID", `Illegal Evidence lifecycle transition: ${String(from || "<empty>")} -> ${String(to || "<empty>")}.`, { from, to });
  return true;
}

function createFindingRecord(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_EVIDENCE_FINDING_INVALID", "A confirmed Evidence finding must be an object.");
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const findingId = id(input.finding_id || input.findingId || input.record_id || input.recordId, "finding", idFactory);
  const title = text(input.title || input.name || "", 500);
  assert(title, "MEMORY_EVIDENCE_TITLE_REQUIRED", "A confirmed finding requires a title.");
  const vulnerabilityClass = text(input.vulnerability_class || input.vulnerabilityClass || input.classification || "", 300);
  assert(vulnerabilityClass, "MEMORY_EVIDENCE_CLASS_REQUIRED", "A confirmed finding requires a vulnerability class.");
  const affectedEntityIds = ids(input.affected_entity_ids || input.affectedEntityIds || input.affected_refs || input.affectedRefs, "entity", "affected_entity_ids");
  const proofRefs = ids(input.proof_refs || input.proofRefs || input.evidence_refs || input.evidenceRefs, "artifact", "proof_refs");
  const reproductionRefs = ids(input.reproduction_refs || input.reproductionRefs || input.attempt_refs || input.attemptRefs, "attempt", "reproduction_refs");
  const investigationIds = ids(input.investigation_ids || input.investigationIds || (input.investigation_id ? [input.investigation_id] : []), "inv", "investigation_ids");
  const confidence = Number(input.confidence);
  assert(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, "MEMORY_EVIDENCE_CONFIDENCE_INVALID", "A confirmed finding confidence must be between 0 and 1.");
  const impact = input.impact && typeof input.impact === "object" ? object(input.impact, "impact") : text(input.impact, 4_000);
  assert((typeof impact === "string" && impact.length > 0) || (impact && Object.keys(impact).length > 0), "MEMORY_EVIDENCE_IMPACT_REQUIRED", "A confirmed finding requires an impact description.");
  const remediation = input.remediation && typeof input.remediation === "object" ? object(input.remediation, "remediation") : text(input.remediation, 4_000);
  assert((typeof remediation === "string" && remediation.length > 0) || (remediation && Object.keys(remediation).length > 0), "MEMORY_EVIDENCE_REMEDIATION_REQUIRED", "A confirmed finding requires remediation guidance.");
  const reproduction = input.reproduction || input.reproduction_requirements || input.reproductionRequirements;
  assert((typeof reproduction === "string" && text(reproduction, 4_000).length > 0) || (reproduction && typeof reproduction === "object" && Object.keys(reproduction).length > 0), "MEMORY_EVIDENCE_REPRODUCTION_REQUIRED", "A confirmed finding requires bounded reproduction requirements.");
  const verification = object(input.verification || input.verification_metadata || input.verificationMetadata, "verification");
  const verdict = text(verification.verdict || input.verdict || "accept", 80).toLowerCase();
  assert(["accept", "verified"].includes(verdict), "MEMORY_EVIDENCE_VERIFICATION_REQUIRED", "Evidence findings require an accepting verification verdict.");
  const procedureReference = text(verification.procedure_id || verification.procedureId || verification.procedure_reference || verification.procedureReference || input.procedure_reference || input.procedureReference || "", 500);
  assert(procedureReference, "MEMORY_EVIDENCE_VERIFICATION_REQUIRED", "A confirmed finding requires its verification procedure reference.");
  const createdAt = iso(input.created_at || input.createdAt, "created_at", now());
  const verifiedAt = iso(verification.verified_at || verification.verifiedAt || input.verified_at || input.verifiedAt, "verified_at", createdAt);
  const state = stateOf(input.state || input.status || "verified");
  assert(state === "verified", "MEMORY_EVIDENCE_INITIAL_STATE_INVALID", "New Evidence findings must enter in the verified state.");
  const fingerprint = hash(input.fingerprint, "fingerprint", false) || canonicalKeyHash({ project_id: projectId, affected_entity_ids: affectedEntityIds, vulnerability_class: vulnerabilityClass.toLowerCase(), title: title.toLowerCase(), proof_refs: proofRefs });
  const result = {
    schema_version: EVIDENCE_CONTRACT_VERSION,
    memory_type: "evidence",
    record_type: "finding",
    record_id: findingId,
    finding_id: findingId,
    project_id: projectId,
    state,
    severity: severityOf(input.severity),
    confidence,
    title,
    vulnerability_class: vulnerabilityClass,
    description: text(input.description || input.summary || "", 8_000),
    affected_entity_ids: affectedEntityIds,
    affected_resources: Array.isArray(input.affected_resources || input.affectedResources) ? safeClone(input.affected_resources || input.affectedResources).slice(0, 100) : [],
    proof_refs: proofRefs,
    reproduction_refs: reproductionRefs,
    investigation_ids: investigationIds,
    impact,
    reproduction: typeof reproduction === "string" ? text(reproduction, 4_000) : safeClone(reproduction),
    remediation,
    fingerprint,
    verification: {
      ...verification,
      verdict,
      procedure_reference: procedureReference,
      verified_at: verifiedAt,
    },
    verification_history: Array.isArray(input.verification_history || input.verificationHistory) ? safeClone(input.verification_history || input.verificationHistory).slice(-100) : [],
    retest: input.retest && typeof input.retest === "object" ? object(input.retest, "retest") : { state: "not_run" },
    report: input.report && typeof input.report === "object" ? object(input.report, "report") : { redacted: true },
    created_at: createdAt,
    updated_at: iso(input.updated_at || input.updatedAt, "updated_at", createdAt),
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: sensitivityOf(input.sensitivity),
    canonical_key_hash: hash(input.canonical_key_hash || input.canonicalKeyHash, "canonical_key_hash", false) || fingerprint,
  };
  return result;
}

function createVerificationRecord(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_EVIDENCE_VERIFICATION_INVALID", "An Evidence verification record must be an object.");
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const findingId = assertMemoryId(input.finding_id || input.findingId, "finding");
  const recordId = id(input.record_id || input.recordId, "finding", idFactory);
  const verdict = text(input.verdict, 80).toLowerCase();
  assert(["accept", "verified", "reject", "inconclusive"].includes(verdict), "MEMORY_EVIDENCE_VERDICT_INVALID", "An Evidence verification verdict is unsupported.");
  const procedureReference = text(input.procedure_reference || input.procedureReference || input.procedure_id || input.procedureId, 500);
  assert(procedureReference, "MEMORY_EVIDENCE_VERIFICATION_REQUIRED", "An Evidence verification requires a procedure reference.");
  const proofRefs = input.proof_refs || input.proofRefs || input.evidence_refs || input.evidenceRefs;
  const result = {
    schema_version: EVIDENCE_CONTRACT_VERSION,
    memory_type: "evidence",
    record_type: "verification",
    record_id: recordId,
    project_id: projectId,
    finding_id: findingId,
    verdict,
    reason: text(input.reason, 4_000),
    procedure_reference: procedureReference,
    proof_refs: ids(proofRefs, "artifact", "proof_refs"),
    verified_at: iso(input.verified_at || input.verifiedAt, "verified_at", now()),
    independent: input.independent === true,
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: sensitivityOf(input.sensitivity),
  };
  assert(result.reason, "MEMORY_EVIDENCE_VERIFICATION_REASON_REQUIRED", "An Evidence verification requires a reason.");
  return result;
}

function createRemediationRecord(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_EVIDENCE_REMEDIATION_INVALID", "A remediation record must be an object.");
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const findingId = assertMemoryId(input.finding_id || input.findingId, "finding");
  const recordId = id(input.record_id || input.recordId, "finding", idFactory);
  const remediation = input.remediation && typeof input.remediation === "object" ? object(input.remediation, "remediation") : text(input.remediation || input.guidance || input.description, 4_000);
  assert((typeof remediation === "string" && remediation.length > 0) || (remediation && Object.keys(remediation).length > 0), "MEMORY_EVIDENCE_REMEDIATION_REQUIRED", "A remediation record requires remediation guidance.");
  const claimedAt = iso(input.claimed_at || input.claimedAt || input.applied_at || input.appliedAt, "claimed_at", now());
  return {
    schema_version: EVIDENCE_CONTRACT_VERSION,
    memory_type: "evidence",
    record_type: "remediation",
    record_id: recordId,
    project_id: projectId,
    finding_id: findingId,
    remediation,
    claimed_at: claimedAt,
    status: text(input.status || "claimed", 80).toLowerCase(),
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: sensitivityOf(input.sensitivity),
  };
}

function createRetestRecord(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_EVIDENCE_RETEST_INVALID", "A retest record must be an object.");
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const findingId = assertMemoryId(input.finding_id || input.findingId, "finding");
  const recordId = id(input.record_id || input.recordId, "finding", idFactory);
  const attemptRefs = ids(input.attempt_refs || input.attemptRefs || input.reproduction_refs || input.reproductionRefs, "attempt", "attempt_refs");
  const proofRefs = ids(input.proof_refs || input.proofRefs || input.evidence_refs || input.evidenceRefs, "artifact", "proof_refs");
  const procedureReference = text(input.procedure_reference || input.procedureReference || input.procedure_id || input.procedureId, 500);
  assert(procedureReference, "MEMORY_EVIDENCE_VERIFICATION_REQUIRED", "A retest requires its verification procedure reference.");
  const outcome = text(input.outcome || input.result || "inconclusive", 80).toLowerCase();
  assert(["remediated", "still_vulnerable", "inconclusive", "blocked", "error"].includes(outcome), "MEMORY_EVIDENCE_RETEST_OUTCOME_INVALID", "The retest outcome is unsupported.");
  const retestedAt = iso(input.retested_at || input.retestedAt || input.verified_at || input.verifiedAt, "retested_at", now());
  return {
    schema_version: EVIDENCE_CONTRACT_VERSION,
    memory_type: "evidence",
    record_type: "retest",
    record_id: recordId,
    project_id: projectId,
    finding_id: findingId,
    attempt_refs: attemptRefs,
    proof_refs: proofRefs,
    procedure_reference: procedureReference,
    outcome,
    reason: text(input.reason || input.summary, 4_000),
    retested_at: retestedAt,
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: sensitivityOf(input.sensitivity),
  };
}

function validate(factory, input, options = {}) {
  try { return { ok: true, value: factory(input, options) }; } catch (error) { return { ok: false, code: error.code || "MEMORY_EVIDENCE_CONTRACT_INVALID", error: error.message, retryable: Boolean(error.retryable), details: error.details || {} }; }
}

module.exports = Object.freeze({
  EVIDENCE_CONTRACT_VERSION,
  EVIDENCE_SEVERITIES,
  EVIDENCE_STATES,
  EVIDENCE_STATE_TRANSITIONS,
  createFindingRecord,
  createVerificationRecord,
  createRemediationRecord,
  createRetestRecord,
  canEvidenceTransition,
  assertEvidenceTransition,
  validateFindingRecord: (input, options) => validate(createFindingRecord, input, options),
  validateVerificationRecord: (input, options) => validate(createVerificationRecord, input, options),
  validateRemediationRecord: (input, options) => validate(createRemediationRecord, input, options),
  validateRetestRecord: (input, options) => validate(createRetestRecord, input, options),
});
