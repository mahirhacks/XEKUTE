"use strict";

const { assert } = require("./memory-errors.js");

const MEMORY_TYPES = Object.freeze(["project", "session", "investigation", "evidence", "knowledge"]);
const SENSITIVITY_LEVELS = Object.freeze(["public", "internal", "confidential", "restricted"]);
const PROJECT_CLAIM_STATES = Object.freeze(["observed", "inferred", "verified", "disputed", "superseded", "retracted", "expired"]);
const INVESTIGATION_STATUSES = Object.freeze(["pending", "in_progress", "blocked", "completed", "not_applicable", "cancelled", "needs_retest"]);
const INVESTIGATION_OUTCOMES = Object.freeze(["supported", "not_reproduced", "inconclusive", "blocked", "error"]);
const EVIDENCE_STATES = Object.freeze(["verified", "needs_retest", "remediated", "accepted_risk", "duplicate"]);
const ACTOR_TYPES = Object.freeze(["system", "operator", "agent", "tool", "importer"]);
const PROVENANCE_TYPES = Object.freeze(["tool_result", "runtime_event", "operator_assertion", "project_profile", "import", "canonical_derivation", "artifact"]);

const OWNERSHIP = Object.freeze({
  project: Object.freeze(["entity", "claim", "relationship", "target_fact"]),
  session: Object.freeze(["transcript", "checkpoint", "operational_context", "sensitive_working_entry", "sensitive_handle", "sensitive_lease", "sensitive_audit"]),
  investigation: Object.freeze(["programme", "investigation", "applicability", "target_binding", "procedure_binding", "test_case", "assignment", "attempt", "hypothesis", "negative_result", "coverage", "finding_candidate", "blocker", "remaining_work"]),
  evidence: Object.freeze(["finding", "verification", "remediation", "retest"]),
  knowledge: Object.freeze(["release", "procedure", "selection"]),
});

const COMMON_TRANSITIONS = Object.freeze({
  active: Object.freeze(["superseded", "retracted", "expired"]),
  observed: Object.freeze(["inferred", "verified", "disputed", "superseded", "retracted", "expired"]),
  inferred: Object.freeze(["verified", "disputed", "superseded", "retracted", "expired"]),
  verified: Object.freeze(["disputed", "superseded", "retracted", "expired"]),
  disputed: Object.freeze(["verified", "superseded", "retracted", "expired"]),
});

function assertMemoryType(value) {
  const type = String(value || "");
  assert(MEMORY_TYPES.includes(type), "MEMORY_TYPE_INVALID", `Unsupported memory type: ${type || "<empty>"}.`);
  return type;
}

function assertSensitivity(value) {
  const sensitivity = String(value || "");
  assert(SENSITIVITY_LEVELS.includes(sensitivity), "MEMORY_SENSITIVITY_INVALID", "General memory records require a supported non-secret sensitivity level.", { sensitivity });
  return sensitivity;
}

function assertOwner(memoryType, recordType) {
  const owner = assertMemoryType(memoryType);
  const type = String(recordType || "");
  assert(OWNERSHIP[owner].includes(type), "MEMORY_OWNERSHIP_VIOLATION", `Record type '${type || "<empty>"}' is not owned by '${owner}' memory.`, { memoryType: owner, recordType: type });
  return true;
}

function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(COMMON_TRANSITIONS[String(from || "")]?.includes(String(to || "")));
}

function assertTransition(from, to) {
  assert(canTransition(from, to), "MEMORY_LIFECYCLE_TRANSITION_INVALID", `Illegal lifecycle transition: ${String(from || "<empty>")} -> ${String(to || "<empty>")}.`, { from, to });
  return true;
}

function assertActor(actor) {
  assert(actor && typeof actor === "object", "MEMORY_ACTOR_INVALID", "An actor attribution is required.");
  assert(ACTOR_TYPES.includes(String(actor.type || "")), "MEMORY_ACTOR_TYPE_INVALID", "The actor type is not supported.");
  assert(String(actor.id || "").trim().length > 0, "MEMORY_ACTOR_ID_INVALID", "An actor ID is required.");
  return true;
}

function assertProvenance(provenance) {
  assert(provenance && typeof provenance === "object", "MEMORY_PROVENANCE_REQUIRED", "Durable memory records require provenance.");
  const sourceType = String(provenance.source_type || provenance.sourceType || "");
  assert(PROVENANCE_TYPES.includes(sourceType), "MEMORY_PROVENANCE_TYPE_INVALID", "The provenance source type is not supported.", { sourceType });
  const refs = Array.isArray(provenance.source_refs || provenance.sourceRefs) ? (provenance.source_refs || provenance.sourceRefs).filter(Boolean) : [];
  const operatorRef = String(provenance.operator_record_ref || "").trim();
  assert(refs.length > 0 || operatorRef.length > 0, "MEMORY_PROVENANCE_REFERENCE_REQUIRED", "Durable memory records require at least one source reference.");
  return true;
}

function isAssistantProseProvenance(provenance) {
  const sourceType = String(provenance?.source_type || provenance?.sourceType || "").toLowerCase();
  return sourceType === "assistant_prose" || sourceType === "model_output" || sourceType === "conversation";
}

module.exports = Object.freeze({ MEMORY_TYPES, SENSITIVITY_LEVELS, PROJECT_CLAIM_STATES, INVESTIGATION_STATUSES, INVESTIGATION_OUTCOMES, EVIDENCE_STATES, ACTOR_TYPES, PROVENANCE_TYPES, OWNERSHIP, COMMON_TRANSITIONS, assertMemoryType, assertSensitivity, assertOwner, canTransition, assertTransition, assertActor, assertProvenance, isAssistantProseProvenance });
