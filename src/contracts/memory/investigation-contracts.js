"use strict";

const { assert } = require("./memory-errors.js");
const { assertMemoryId, canonicalKeyHash, createOpaqueId } = require("./memory-identity.js");
const {
  INVESTIGATION_STATUSES,
  INVESTIGATION_OUTCOMES,
  assertActor,
  assertProvenance,
  assertSensitivity,
} = require("./memory-lifecycle.js");

const INVESTIGATION_CONTRACT_VERSION = 1;
const STATUS_SET = new Set(INVESTIGATION_STATUSES);
const OUTCOME_SET = new Set(INVESTIGATION_OUTCOMES);
const MAX_LIST = 500;
const MAX_TEXT = 8_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const PROCEDURE_PATTERN = /^procedure_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret[_-]?value|raw[_-]?value|password)$/i;

const INVESTIGATION_RECORD_TYPES = Object.freeze([
  "programme",
  "investigation",
  "applicability",
  "target_binding",
  "procedure_binding",
  "test_case",
  "assignment",
  "attempt",
  "negative_result",
  "finding_candidate",
  "blocker",
  "coverage",
  "remaining_work",
]);

const INVESTIGATION_STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["in_progress", "blocked", "completed", "not_applicable", "cancelled"]),
  in_progress: Object.freeze(["blocked", "completed", "cancelled", "needs_retest", "not_applicable"]),
  blocked: Object.freeze(["pending", "in_progress", "completed", "cancelled", "needs_retest", "not_applicable"]),
  completed: Object.freeze(["needs_retest"]),
  not_applicable: Object.freeze(["needs_retest"]),
  cancelled: Object.freeze([]),
  needs_retest: Object.freeze(["pending", "in_progress", "blocked", "completed", "cancelled", "not_applicable"]),
});

function list(value, maximum = MAX_LIST, itemMaximum = 500) {
  assert(value === undefined || Array.isArray(value), "MEMORY_INVESTIGATION_LIST_INVALID", "Investigation list fields must be arrays.");
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => boundedText(entry, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function safeClone(value, depth = 0, key = "") {
  assert(depth <= 10, "MEMORY_PAYLOAD_TOO_DEEP", "Investigation values may not be nested this deeply.");
  assert(!SECRET_KEY.test(String(key || "")), "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in Investigation Memory.", { field: String(key) });
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedText(value);
  if (Array.isArray(value)) {
    assert(value.length <= MAX_LIST, "MEMORY_ARRAY_TOO_LARGE", "An Investigation list contains too many values.");
    return value.map((entry) => safeClone(entry, depth + 1));
  }
  assert(typeof value === "object", "MEMORY_PAYLOAD_INVALID", "Investigation values must be JSON-compatible.");
  return Object.entries(value).reduce((result, [childKey, child]) => {
    result[boundedText(childKey, 120)] = safeClone(child, depth + 1, childKey);
    return result;
  }, {});
}

function text(value, maximum = MAX_TEXT) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_FIELD_TOO_LARGE", "An Investigation field exceeds its maximum length.", { maximum });
  return result;
}

function object(value, field = "metadata") {
  assert(value === undefined || (value && typeof value === "object" && !Array.isArray(value)), "MEMORY_INVESTIGATION_OBJECT_INVALID", `${field} must be an object.`);
  return value && typeof value === "object" ? safeClone(value) : {};
}

function boundedText(value, maximum = MAX_TEXT) { return text(value, maximum); }

function iso(value, field, fallback = new Date()) {
  const raw = value == null || value === "" ? fallback : value;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  assert(!Number.isNaN(date.getTime()), "MEMORY_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function id(value, prefix, factory = null) {
  if (value) return assertMemoryId(value, prefix);
  return createOpaqueId(prefix, factory ? { uuid: factory } : {});
}

function projectRevision(value) {
  const revision = Number(value);
  assert(Number.isInteger(revision) && revision >= 0, "MEMORY_REVISION_INVALID", "An Investigation must pin a non-negative Project revision.");
  return revision;
}

function assertHash(value, field, { required = true } = {}) {
  const hash = String(value || "").trim().toLowerCase();
  if (!required && !hash) return "";
  assert(HASH_PATTERN.test(hash), "MEMORY_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  return hash;
}

function actorOf(input) {
  const actor = input && input.actor ? safeClone(input.actor) : { type: "system", id: "investigation-memory" };
  assertActor(actor);
  return actor;
}

function provenanceOf(input) {
  const provenance = input && input.provenance ? safeClone(input.provenance) : null;
  assertProvenance(provenance);
  return provenance;
}

function sensitivityOf(value = "internal") {
  return assertSensitivity(value || "internal");
}

function statusOf(value = "pending") {
  const status = String(value || "pending").trim().toLowerCase();
  assert(STATUS_SET.has(status), "MEMORY_INVESTIGATION_STATUS_INVALID", `Unsupported Investigation status: ${status || "<empty>"}.`);
  return status;
}

function outcomeOf(value = "inconclusive") {
  const outcome = String(value || "inconclusive").trim().toLowerCase();
  assert(OUTCOME_SET.has(outcome), "MEMORY_INVESTIGATION_OUTCOME_INVALID", `Unsupported Investigation outcome: ${outcome || "<empty>"}.`);
  return outcome;
}

function assertProcedureId(value) {
  const procedureId = String(value || "").trim();
  assert(PROCEDURE_PATTERN.test(procedureId), "MEMORY_PROCEDURE_ID_INVALID", "A pinned procedure ID is invalid.");
  return procedureId;
}

function canonicalInvestigationKey(input = {}) {
  return canonicalKeyHash({
    project_id: input.project_id,
    programme_id: input.programme_id || "",
    procedure_id: input.procedure_id || "",
    target_bindings: Array.isArray(input.target_bindings) ? input.target_bindings : [],
    objective: boundedText(input.objective || input.title || "", 2_000).toLowerCase(),
  });
}

function baseRecord(input, recordType, prefix = "inv", factory = null) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_INVESTIGATION_RECORD_INVALID", `${recordType} must be an object.`);
  safeClone(input);
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const recordId = id(input.record_id || input.recordId || input[`${recordType}_id`] || input[`${recordType}Id`], prefix, factory);
  const createdAt = iso(input.created_at || input.createdAt, "created_at");
  const updatedAt = iso(input.updated_at || input.updatedAt, "updated_at", createdAt);
  const lifecycleRecord = new Set(["programme", "investigation", "applicability", "test_case", "assignment"]);
  const lifecycleStatus = lifecycleRecord.has(recordType) ? (input.status || input.state || "pending") : (input.state || "pending");
  const result = {
    schema_version: INVESTIGATION_CONTRACT_VERSION,
    memory_type: "investigation",
    record_type: recordType,
    record_id: recordId,
    project_id: projectId,
    state: statusOf(lifecycleStatus),
    created_at: createdAt,
    updated_at: updatedAt,
    actor: actorOf(input),
    provenance: provenanceOf(input),
    sensitivity: sensitivityOf(input.sensitivity || "internal"),
    canonical_key_hash: String(input.canonical_key_hash || input.canonicalKeyHash || "").trim().toLowerCase(),
    revision_created: Number.isInteger(Number(input.revision_created)) ? Number(input.revision_created) : 0,
    revision_updated: Number.isInteger(Number(input.revision_updated)) ? Number(input.revision_updated) : 0,
  };
  assert(result.revision_created >= 0 && result.revision_updated >= result.revision_created, "MEMORY_REVISION_INVALID", "Investigation record revisions are invalid.");
  return result;
}

function createProgrammeRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "programme", "inv", idFactory);
  result.programme_id = result.record_id;
  result.objective = boundedText(input.objective || input.title || "", 2_000);
  assert(result.objective, "MEMORY_INVESTIGATION_OBJECTIVE_REQUIRED", "An Investigation programme objective is required.");
  result.description = boundedText(input.description || "", 4_000);
  result.project_revision = projectRevision(input.project_revision ?? input.projectRevision);
  result.knowledge_release_id = assertMemoryId(input.knowledge_release_id || input.knowledgeReleaseId, "kb");
  result.knowledge_content_hash = assertHash(input.knowledge_content_hash || input.knowledgeContentHash, "knowledge_content_hash");
  result.investigation_ids = list(input.investigation_ids || input.investigationIds, MAX_LIST, 240);
  result.custom = Boolean(input.custom);
  result.canonical_key_hash = result.canonical_key_hash || canonicalInvestigationKey({ ...input, project_id: result.project_id });
  return result;
}

function createInvestigationRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "investigation", "inv", idFactory);
  result.investigation_id = result.record_id;
  result.programme_id = input.programme_id || input.programmeId ? assertMemoryId(input.programme_id || input.programmeId, "inv") : "";
  result.objective = boundedText(input.objective || input.title || "", 2_000);
  result.custom = Boolean(input.custom || input.kind === "custom");
  result.verification_rule = object(input.verification_rule || input.verificationRule, "verification_rule");
  result.safety_constraints = list(input.safety_constraints || input.safetyConstraints, 100, 1_000);
  if (result.custom) {
    assert(result.objective, "MEMORY_INVESTIGATION_OBJECTIVE_REQUIRED", "A custom Investigation requires an objective.");
    assert(Object.keys(result.verification_rule).length > 0, "MEMORY_INVESTIGATION_VERIFICATION_RULE_REQUIRED", "A custom Investigation requires a verification rule.");
    assert(result.safety_constraints.length > 0, "MEMORY_INVESTIGATION_SAFETY_REQUIRED", "A custom Investigation requires safety constraints.");
  }
  assert(result.objective, "MEMORY_INVESTIGATION_OBJECTIVE_REQUIRED", "An Investigation objective is required.");
  result.project_revision = projectRevision(input.project_revision ?? input.projectRevision);
  result.knowledge_release_id = assertMemoryId(input.knowledge_release_id || input.knowledgeReleaseId, "kb");
  result.knowledge_content_hash = assertHash(input.knowledge_content_hash || input.knowledgeContentHash, "knowledge_content_hash");
  result.procedure_id = input.procedure_id || input.procedureId ? assertProcedureId(input.procedure_id || input.procedureId) : "";
  result.procedure_ids = list(input.procedure_ids || input.procedureIds, MAX_LIST, 240).map(assertProcedureId);
  if (result.procedure_id && !result.procedure_ids.includes(result.procedure_id)) result.procedure_ids.unshift(result.procedure_id);
  result.target_bindings = Array.isArray(input.target_bindings || input.targetBindings) ? safeClone(input.target_bindings || input.targetBindings).slice(0, MAX_LIST) : [];
  result.coverage_hash = assertHash(input.coverage_hash || input.coverageHash, "coverage_hash", { required: false });
  result.priority = Math.max(0, Math.min(100, Number(input.priority) || 0));
  result.test_case_ids = list(input.test_case_ids || input.testCaseIds, MAX_LIST, 240);
  result.remaining_work = list(input.remaining_work || input.remainingWork, MAX_LIST, 2_000);
  result.canonical_key_hash = result.canonical_key_hash || canonicalInvestigationKey({ ...input, project_id: result.project_id, procedure_id: result.procedure_id, target_bindings: result.target_bindings });
  return result;
}

function createApplicabilityRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "applicability", "inv", idFactory);
  result.applicability_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.procedure_id = assertProcedureId(input.procedure_id || input.procedureId);
  result.project_revision = projectRevision(input.project_revision ?? input.projectRevision);
  result.knowledge_release_id = assertMemoryId(input.knowledge_release_id || input.knowledgeReleaseId, "kb");
  result.knowledge_content_hash = assertHash(input.knowledge_content_hash || input.knowledgeContentHash, "knowledge_content_hash");
  result.coverage_hash = assertHash(input.coverage_hash || input.coverageHash, "coverage_hash", { required: false });
  result.reason = boundedText(input.reason || "", 2_000);
  result.action = boundedText(input.action || input.proposal_type || input.proposalType || "create", 80).toLowerCase();
  result.target_binding = input.target_binding || input.targetBinding ? safeClone(input.target_binding || input.targetBinding) : null;
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, investigation_id: result.investigation_id, procedure_id: result.procedure_id, target_binding: result.target_binding, action: result.action });
  return result;
}

function createTestCaseRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "test_case", "inv", idFactory);
  result.test_case_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.procedure_id = assertProcedureId(input.procedure_id || input.procedureId);
  result.objective = boundedText(input.objective || input.title || "", 2_000);
  assert(result.objective, "MEMORY_TEST_CASE_OBJECTIVE_REQUIRED", "A test case objective is required.");
  result.verification_rule = object(input.verification_rule || input.verificationRule, "verification_rule");
  result.safety_constraints = list(input.safety_constraints || input.safetyConstraints, 100, 1_000);
  result.target_bindings = Array.isArray(input.target_bindings || input.targetBindings) ? safeClone(input.target_bindings || input.targetBindings).slice(0, MAX_LIST) : [];
  result.coverage_dimensions = object(input.coverage_dimensions || input.coverageDimensions, "coverage_dimensions");
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, investigation_id: result.investigation_id, procedure_id: result.procedure_id, objective: result.objective, target_bindings: result.target_bindings });
  return result;
}

function createAssignmentRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "assignment", "inv", idFactory);
  result.assignment_id = result.record_id;
  result.test_case_id = assertMemoryId(input.test_case_id || input.testCaseId, "inv");
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.agent_id = boundedText(input.agent_id || input.agentId || "", 240);
  result.session_id = input.session_id || input.sessionId ? assertMemoryId(input.session_id || input.sessionId, "session") : "";
  result.exclusive = input.exclusive !== false;
  result.lease_expires_at = input.lease_expires_at || input.leaseExpiresAt ? iso(input.lease_expires_at || input.leaseExpiresAt, "lease_expires_at") : "";
  result.heartbeat_at = input.heartbeat_at || input.heartbeatAt ? iso(input.heartbeat_at || input.heartbeatAt, "heartbeat_at") : "";
  result.release_reason = boundedText(input.release_reason || input.releaseReason || "", 500);
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, test_case_id: result.test_case_id, agent_id: result.agent_id, session_id: result.session_id });
  return result;
}

function referenceList(value, prefix, maximum = 200) {
  const values = list(value, maximum, 240);
  return values.map((entry) => assertMemoryId(entry, prefix));
}

function assertSanitizedAttemptInput(input) {
  for (const field of ["payload", "raw_payload", "rawPayload", "request_body", "requestBody", "response_body", "responseBody", "authorization", "cookie", "access_token", "refresh_token"]) {
    assert(input?.[field] === undefined || input?.[field] === null || input?.[field] === "", "MEMORY_ATTEMPT_RAW_PAYLOAD_FORBIDDEN", `Attempt field '${field}' must not contain raw request, response, or credential material.`, { field });
  }
  const textValues = [input?.expected_behavior, input?.observed_behavior, input?.expectedBehavior, input?.observedBehavior].map((value) => String(value || ""));
  assert(textValues.every((value) => !/-----BEGIN [^-]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]+/i.test(value)), "MEMORY_ATTEMPT_SECRET_TEXT", "Attempt behavior text must not contain raw secret material.");
}

function createAttemptRecord(input = {}, { idFactory = null } = {}) {
  assertSanitizedAttemptInput(input);
  const result = baseRecord(input, "attempt", "attempt", idFactory);
  result.attempt_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.test_case_id = assertMemoryId(input.test_case_id || input.testCaseId, "inv");
  result.target_binding = input.target_binding || input.targetBinding ? safeClone(input.target_binding || input.targetBinding) : null;
  result.environment = input.environment && typeof input.environment === "object" ? safeClone(input.environment) : boundedText(input.environment || "", 500);
  result.identity_ref = boundedText(input.identity_ref || input.identityRef || "", 240);
  result.role = boundedText(input.role || input.role_ref || input.roleRef || "", 240);
  result.payload_class = boundedText(input.payload_class || input.payloadClass || "", 500);
  assert(result.payload_class, "MEMORY_ATTEMPT_PAYLOAD_CLASS_REQUIRED", "An attempt requires a sanitized payload class.");
  result.tool_refs = referenceList(input.tool_refs || input.toolRefs, "op", 100);
  result.artifact_refs = referenceList(input.artifact_refs || input.artifactRefs, "artifact", 100);
  result.expected_behavior = boundedText(input.expected_behavior || input.expectedBehavior || "", 4_000);
  result.observed_behavior = boundedText(input.observed_behavior || input.observedBehavior || "", 4_000);
  result.outcome = outcomeOf(input.outcome || "inconclusive");
  result.coverage_dimensions = object(input.coverage_dimensions || input.coverageDimensions, "coverage_dimensions");
  result.stop_condition = boundedText(input.stop_condition || input.stopCondition || "", 1_000);
  result.invocation_id = boundedText(input.invocation_id || input.invocationId || "", 240);
  result.variant_key = boundedText(input.variant_key || input.variantKey || "", 500);
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({
    project_id: result.project_id,
    investigation_id: result.investigation_id,
    test_case_id: result.test_case_id,
    target_binding: result.target_binding,
    environment: result.environment,
    identity_ref: result.identity_ref,
    role: result.role,
    payload_class: result.payload_class,
    invocation_id: result.invocation_id,
    variant_key: result.variant_key,
  });
  return result;
}

function createNegativeResultRecord(input = {}, { idFactory = null } = {}) {
  assert(input.global_claim !== true && input.globalClaim !== true, "MEMORY_NEGATIVE_RESULT_SCOPE_INVALID", "A negative result cannot claim global security.");
  const result = createAttemptRecord({ ...input, record_id: input.record_id || input.attempt_id || input.attemptId, outcome: input.outcome || "not_reproduced" }, { idFactory });
  assert(["not_reproduced", "inconclusive", "blocked", "error"].includes(result.outcome), "MEMORY_NEGATIVE_RESULT_OUTCOME_INVALID", "A negative result must be scoped to a non-confirming outcome.");
  result.record_type = "negative_result";
  result.negative = true;
  result.claim_scope = input.claim_scope || input.claimScope ? safeClone(input.claim_scope || input.claimScope) : { investigation_id: result.investigation_id, test_case_id: result.test_case_id };
  result.limitation = boundedText(input.limitation || input.reason || "", 2_000);
  return result;
}

function createFindingCandidateRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "finding_candidate", "inv", idFactory);
  result.candidate_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.attempt_ids = referenceList(input.attempt_ids || input.attemptIds, "attempt", 100);
  result.artifact_refs = referenceList(input.artifact_refs || input.artifactRefs, "artifact", 100);
  result.vulnerability_class = boundedText(input.vulnerability_class || input.vulnerabilityClass || input.title || "", 500);
  assert(result.vulnerability_class, "MEMORY_CANDIDATE_CLASS_REQUIRED", "A finding candidate requires a vulnerability class.");
  result.severity = boundedText(input.severity || "", 40).toLowerCase();
  result.summary = boundedText(input.summary || "", 4_000);
  result.verification_status = boundedText(input.verification_status || input.verificationStatus || "unverified", 80).toLowerCase();
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, investigation_id: result.investigation_id, vulnerability_class: result.vulnerability_class, affected_refs: input.affected_refs || input.affectedRefs || [], attempt_ids: result.attempt_ids });
  return result;
}

function createBlockerRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "blocker", "inv", idFactory);
  result.blocker_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.kind = boundedText(input.kind || input.type || "external_dependency", 120);
  result.description = boundedText(input.description || input.reason || "", 2_000);
  assert(result.description, "MEMORY_BLOCKER_DESCRIPTION_REQUIRED", "A blocker requires a description.");
  result.status = boundedText(input.blocker_status || input.blockerStatus || input.status || "open", 40).toLowerCase();
  result.resolution = boundedText(input.resolution || "", 2_000);
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, investigation_id: result.investigation_id, kind: result.kind, description: result.description });
  return result;
}

function createCoverageRecord(input = {}, { idFactory = null } = {}) {
  const result = baseRecord(input, "coverage", "inv", idFactory);
  result.coverage_id = result.record_id;
  result.investigation_id = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  result.test_case_id = input.test_case_id || input.testCaseId ? assertMemoryId(input.test_case_id || input.testCaseId, "inv") : "";
  result.dimensions = object(input.dimensions || input.coverage_dimensions || input.coverageDimensions, "dimensions");
  result.status = boundedText(input.coverage_status || input.coverageStatus || input.status || "covered", 80).toLowerCase();
  result.attempt_ids = referenceList(input.attempt_ids || input.attemptIds, "attempt", 100);
  result.canonical_key_hash = result.canonical_key_hash || canonicalKeyHash({ project_id: result.project_id, investigation_id: result.investigation_id, test_case_id: result.test_case_id, dimensions: result.dimensions });
  return result;
}

function canInvestigationTransition(from, to) {
  const source = statusOf(from);
  const target = statusOf(to);
  return source === target || Boolean(INVESTIGATION_STATUS_TRANSITIONS[source]?.includes(target));
}

function assertInvestigationTransition(from, to) {
  assert(canInvestigationTransition(from, to), "MEMORY_LIFECYCLE_TRANSITION_INVALID", `Illegal Investigation lifecycle transition: ${String(from || "<empty>")} -> ${String(to || "<empty>")}.`, { from, to });
  return true;
}

function normalizeContract(factory, input, options = {}) {
  try { return { ok: true, value: factory(input, options) }; } catch (error) { return { ok: false, code: error.code || "MEMORY_INVESTIGATION_CONTRACT_INVALID", error: error.message, retryable: Boolean(error.retryable), details: error.details || {} }; }
}

module.exports = Object.freeze({
  INVESTIGATION_CONTRACT_VERSION,
  INVESTIGATION_RECORD_TYPES,
  INVESTIGATION_STATUS_TRANSITIONS,
  INVESTIGATION_STATUSES,
  INVESTIGATION_OUTCOMES,
  createProgrammeRecord,
  createInvestigationRecord,
  createApplicabilityRecord,
  createTestCaseRecord,
  createAssignmentRecord,
  createAttemptRecord,
  createNegativeResultRecord,
  createFindingCandidateRecord,
  createBlockerRecord,
  createCoverageRecord,
  canInvestigationTransition,
  assertInvestigationTransition,
  assertProcedureId,
  statusOf,
  outcomeOf,
  projectRevision,
  assertHash,
  canonicalInvestigationKey,
  validateProgrammeRecord: (input, options) => normalizeContract(createProgrammeRecord, input, options),
  validateInvestigationRecord: (input, options) => normalizeContract(createInvestigationRecord, input, options),
  validateApplicabilityRecord: (input, options) => normalizeContract(createApplicabilityRecord, input, options),
  validateTestCaseRecord: (input, options) => normalizeContract(createTestCaseRecord, input, options),
  validateAssignmentRecord: (input, options) => normalizeContract(createAssignmentRecord, input, options),
  validateAttemptRecord: (input, options) => normalizeContract(createAttemptRecord, input, options),
  validateNegativeResultRecord: (input, options) => normalizeContract(createNegativeResultRecord, input, options),
  validateFindingCandidateRecord: (input, options) => normalizeContract(createFindingCandidateRecord, input, options),
  validateBlockerRecord: (input, options) => normalizeContract(createBlockerRecord, input, options),
  validateCoverageRecord: (input, options) => normalizeContract(createCoverageRecord, input, options),
});
