"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId, createOpaqueId, canonicalJson, canonicalKeyHash } = require("./memory-identity.js");
const { assertSensitivity } = require("./memory-lifecycle.js");

const MULTI_AGENT_SCHEMA_VERSION = 1;
const DISPATCH_PACKET_MAX_BYTES = 64 * 1024;
const SPECIALIST_RETURN_MAX_BYTES = 64 * 1024;
const MAX_REFS = 200;
const MAX_ITEMS = 200;
const MAX_TEXT = 8_000;
const ASSIGNMENT_STATES = Object.freeze(["queued", "active", "released", "expired", "cancelled"]);
const SPECIALIST_STATUSES = Object.freeze(["completed", "partial", "failed", "cancelled", "inconclusive"]);
const MEMORY_REF_PREFIXES = Object.freeze(["entity", "claim", "rel", "inv", "attempt", "finding", "artifact", "kb", "procedure", "sel", "op", "event", "block"]);
const MEMORY_REF_PREFIX_SET = new Set(MEMORY_REF_PREFIXES);
const SECRET_KEY_RE = /(?:authorization|cookie|set[_-]?cookie|token|secret|password|passwd|private[_-]?key|passphrase|credential|raw[_-]?value|request[_-]?body|response[_-]?body)/i;
const SECRET_TEXT_RE = /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}|\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[=:]\s*[^\s,;]+/i;

function text(value, maximum = MAX_TEXT) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_MULTI_AGENT_FIELD_TOO_LARGE", "A multi-agent field exceeds its maximum length.", { maximum });
  assert(!SECRET_TEXT_RE.test(result), "MEMORY_MULTI_AGENT_SECRET_TEXT", "Multi-agent packets and returns cannot contain raw secret material.");
  return result;
}

function cloneSafe(value, depth = 0, key = "") {
  assert(depth <= 10, "MEMORY_MULTI_AGENT_PAYLOAD_TOO_DEEP", "A multi-agent payload is nested too deeply.");
  assert(!SECRET_KEY_RE.test(String(key || "")), "MEMORY_MULTI_AGENT_SECRET_FIELD", "Multi-agent payloads cannot contain raw secret fields.", { field: String(key || "") });
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value, 8_000);
  if (Array.isArray(value)) {
    assert(value.length <= MAX_ITEMS, "MEMORY_MULTI_AGENT_LIST_TOO_LARGE", "A multi-agent list exceeds its maximum item count.", { maximum: MAX_ITEMS });
    return value.map((entry) => cloneSafe(entry, depth + 1));
  }
  assert(typeof value === "object", "MEMORY_MULTI_AGENT_PAYLOAD_INVALID", "Multi-agent payloads must be JSON-compatible.");
  const output = {};
  for (const [childKey, child] of Object.entries(value)) output[text(childKey, 120)] = cloneSafe(child, depth + 1, childKey);
  return output;
}

function refList(value, prefixes = MEMORY_REF_PREFIX_SET) {
  assert(value === undefined || Array.isArray(value), "MEMORY_MULTI_AGENT_REFS_INVALID", "Memory reference lists must be arrays.");
  const refs = [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry || "").trim()).filter(Boolean))];
  assert(refs.length <= MAX_REFS, "MEMORY_MULTI_AGENT_REFS_TOO_LARGE", "A multi-agent reference list is too large.", { maximum: MAX_REFS });
  return refs.map((entry) => {
    const prefix = entry.split("_", 1)[0];
    assert(prefixes.has(prefix), "MEMORY_MULTI_AGENT_REF_INVALID", "A multi-agent reference uses an unsupported memory ID prefix.", { value: entry });
    return assertMemoryId(entry, prefix);
  }).sort();
}

function boundedRevisionMap(value) {
  assert(value === undefined || (value && typeof value === "object" && !Array.isArray(value)), "MEMORY_MULTI_AGENT_REVISIONS_INVALID", "source_revisions must be an object.");
  const output = {};
  for (const [key, revision] of Object.entries(value || {})) {
    const cleanKey = text(key, 80);
    const number = Number(revision);
    assert(Number.isSafeInteger(number) && number >= 0, "MEMORY_MULTI_AGENT_REVISION_INVALID", "Source revisions must be non-negative integers.", { key: cleanKey });
    output[cleanKey] = number;
  }
  return output;
}

function boundedReturnSchema(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "MEMORY_SPECIALIST_RETURN_SCHEMA_REQUIRED", "A specialist return schema is required.");
  const result = {
    format: text(value.format || "structured", 120),
    description: text(value.description || "Structured specialist result", 2_000),
    fields: Array.isArray(value.fields) ? value.fields.map((field) => text(field, 120)).filter(Boolean).slice(0, 100) : [],
  };
  assert(result.format, "MEMORY_SPECIALIST_RETURN_FORMAT_REQUIRED", "A specialist return format is required.");
  return result;
}

function boundedItems(value, field) {
  assert(value === undefined || Array.isArray(value), "MEMORY_MULTI_AGENT_ITEMS_INVALID", `${field} must be an array.`);
  return (Array.isArray(value) ? value : []).slice(0, MAX_ITEMS).map((item) => cloneSafe(item));
}

function boundedArtifactItems(value) {
  assert(value === undefined || Array.isArray(value), "MEMORY_MULTI_AGENT_ITEMS_INVALID", "artifacts must be an array.");
  return (Array.isArray(value) ? value : []).slice(0, MAX_ITEMS).map((item) => {
    if (typeof item === "string") return assertMemoryId(item, "artifact");
    assert(item && typeof item === "object" && !Array.isArray(item), "MEMORY_SPECIALIST_ARTIFACT_INVALID", "A specialist artifact must be a reference or bounded metadata object.");
    for (const key of Object.keys(item)) assert(!/^(?:content|data|body|request|response|headers|raw)/i.test(key), "MEMORY_SPECIALIST_ARTIFACT_BODY_FORBIDDEN", "Specialist returns may contain artifact references but not artifact bodies.", { field: key });
    const artifactId = item.artifact_id || item.artifactId || item.record_id || item.recordId;
    if (artifactId) assertMemoryId(artifactId, "artifact");
    return cloneSafe(item);
  });
}

function assertProjectScoped(value, projectId, depth = 0) {
  if (value === null || value === undefined || depth > 10) return true;
  if (Array.isArray(value)) {
    for (const item of value) assertProjectScoped(item, projectId, depth + 1);
    return true;
  }
  if (typeof value !== "object") return true;
  const embedded = value.project_id || value.projectId;
  if (embedded !== undefined && embedded !== null && String(embedded) !== "") {
    assert(String(embedded) === projectId, "MEMORY_MULTI_AGENT_PROJECT_MISMATCH", "A specialist packet contains a record from another project.", { expectedProjectId: projectId, actualProjectId: String(embedded) });
  }
  for (const child of Object.values(value)) assertProjectScoped(child, projectId, depth + 1);
  return true;
}

function requiredActorId(value, field) {
  const result = text(value, 240);
  assert(result, "MEMORY_MULTI_AGENT_ACTOR_REQUIRED", `${field} is required.`, { field });
  return result;
}

function iso(value, field, fallback = new Date()) {
  const raw = value == null || value === "" ? fallback : value;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  assert(!Number.isNaN(date.getTime()), "MEMORY_MULTI_AGENT_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function createDispatchPacket(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_DISPATCH_PACKET_INVALID", "A specialist dispatch packet must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const packet = {
    schema_version: MULTI_AGENT_SCHEMA_VERSION,
    packet_type: "specialist_dispatch",
    packet_id: input.packet_id || input.packetId ? assertMemoryId(input.packet_id || input.packetId, "event") : createOpaqueId("event", idFactory ? { uuid: idFactory } : {}),
    project_id: projectId,
    parent_session_id: requiredActorId(input.parent_session_id || input.parentSessionId, "parent_session_id"),
    parent_agent_id: requiredActorId(input.parent_agent_id || input.parentAgentId, "parent_agent_id"),
    child_invocation_id: text(input.child_invocation_id || input.childInvocationId, 240),
    child_session_id: text(input.child_session_id || input.childSessionId, 240),
    objective: text(input.objective || input.task, 4_000),
    authority_profile: requiredActorId(input.authority_profile || input.authorityProfile, "authority_profile"),
    target_refs: refList(input.target_refs || input.targetRefs),
    investigation_refs: refList(input.investigation_refs || input.investigationRefs, new Set(["inv", "attempt", "artifact", "procedure", "kb", "entity", "claim", "rel"])),
    test_case_refs: refList(input.test_case_refs || input.testCaseRefs, new Set(["inv"])),
    artifact_refs: refList(input.artifact_refs || input.artifactRefs, new Set(["artifact"])),
    memory_slices: cloneSafe(input.memory_slices || input.memorySlices || {}),
    graph_slice: cloneSafe(input.graph_slice || input.graphSlice || {}),
    knowledge: cloneSafe(input.knowledge || {}),
    source_revisions: boundedRevisionMap(input.source_revisions || input.sourceRevisions),
    return_schema: boundedReturnSchema(input.return_schema || input.returnSchema || input.expected_output || input.expectedOutput),
    sensitivity_ceiling: assertSensitivity(input.sensitivity_ceiling || input.sensitivityCeiling || "confidential"),
    created_at: iso(input.created_at || input.createdAt, "created_at", now()),
    inherited_sensitive_handles: [],
  };
  assertProjectScoped(packet.memory_slices, projectId);
  assertProjectScoped(packet.graph_slice, projectId);
  assertProjectScoped(packet.knowledge, projectId);
  assert(packet.objective, "MEMORY_MULTI_AGENT_OBJECTIVE_REQUIRED", "A specialist objective is required.");
  const inheritedHandles = input.inherited_sensitive_handles || input.inheritedSensitiveHandles;
  assert(inheritedHandles === undefined || inheritedHandles === null || (Array.isArray(inheritedHandles) && inheritedHandles.length === 0), "MEMORY_MULTI_AGENT_HANDLE_INHERIT_FORBIDDEN", "Sensitive handles cannot be inherited in a specialist dispatch packet.");
  assert(Buffer.byteLength(JSON.stringify(packet), "utf8") <= DISPATCH_PACKET_MAX_BYTES, "MEMORY_DISPATCH_PACKET_TOO_LARGE", "The specialist dispatch packet exceeds its serialized size limit.", { maximumBytes: DISPATCH_PACKET_MAX_BYTES });
  return Object.freeze(packet);
}

function createAssignmentLease(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_ASSIGNMENT_LEASE_INVALID", "An assignment lease must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const investigationId = assertMemoryId(input.investigation_id || input.investigationId, "inv");
  const testCaseId = assertMemoryId(input.test_case_id || input.testCaseId, "inv");
  const issuedAt = iso(input.issued_at || input.issuedAt, "issued_at", now());
  const defaultExpiry = new Date(new Date(issuedAt).getTime() + 5 * 60 * 1_000);
  const expiresAt = iso(input.expires_at || input.expiresAt, "expires_at", defaultExpiry);
  assert(new Date(expiresAt).getTime() > new Date(issuedAt).getTime(), "MEMORY_ASSIGNMENT_EXPIRY_INVALID", "An assignment lease must expire after it is issued.");
  const state = text(input.state || "active", 40).toLowerCase();
  assert(ASSIGNMENT_STATES.includes(state), "MEMORY_ASSIGNMENT_STATE_INVALID", "An assignment lease has an unsupported state.", { state });
  const leaseId = input.lease_id || input.leaseId
    ? assertMemoryId(input.lease_id || input.leaseId, "op")
    : createOpaqueId("op", idFactory ? { uuid: idFactory } : {});
  return Object.freeze({
    schema_version: MULTI_AGENT_SCHEMA_VERSION,
    record_type: "assignment_lease",
    lease_id: leaseId,
    project_id: projectId,
    investigation_id: investigationId,
    test_case_id: testCaseId,
    agent_id: requiredActorId(input.agent_id || input.agentId, "agent_id"),
    session_id: requiredActorId(input.session_id || input.sessionId, "session_id"),
    assignment_id: input.assignment_id || input.assignmentId ? assertMemoryId(input.assignment_id || input.assignmentId, "inv") : "",
    exclusive: input.exclusive !== false,
    state,
    issued_at: issuedAt,
    expires_at: expiresAt,
    heartbeat_at: iso(input.heartbeat_at || input.heartbeatAt, "heartbeat_at", issuedAt),
    released_at: input.released_at || input.releasedAt ? iso(input.released_at || input.releasedAt, "released_at") : "",
    release_reason: text(input.release_reason || input.releaseReason, 500),
    canonical_key_hash: String(input.canonical_key_hash || input.canonicalKeyHash || canonicalKeyHash({ project_id: projectId, investigation_id: investigationId, test_case_id: testCaseId, exclusive: input.exclusive !== false })).toLowerCase(),
  });
}

function createSpecialistReturn(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_SPECIALIST_RETURN_INVALID", "A specialist return must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const status = text(input.status || input.terminal_state || input.terminalState, 40).toLowerCase();
  assert(SPECIALIST_STATUSES.includes(status), "MEMORY_SPECIALIST_STATUS_INVALID", "A specialist return has an unsupported terminal status.", { status });
  assert(input.confirmed_findings === undefined && input.confirmedFindings === undefined && input.findings === undefined, "MEMORY_SPECIALIST_DIRECT_FINDING_FORBIDDEN", "Specialist returns cannot directly create confirmed findings; return candidates for verification.");
  const result = {
    schema_version: MULTI_AGENT_SCHEMA_VERSION,
    return_type: "specialist_return",
    return_id: input.return_id || input.returnId ? assertMemoryId(input.return_id || input.returnId, "event") : createOpaqueId("event", idFactory ? { uuid: idFactory } : {}),
    project_id: projectId,
    parent_session_id: requiredActorId(input.parent_session_id || input.parentSessionId, "parent_session_id"),
    child_session_id: requiredActorId(input.child_session_id || input.childSessionId, "child_session_id"),
    child_invocation_id: requiredActorId(input.child_invocation_id || input.childInvocationId, "child_invocation_id"),
    agent_id: requiredActorId(input.agent_id || input.agentId, "agent_id"),
    assignment_lease_id: input.assignment_lease_id || input.assignmentLeaseId ? assertMemoryId(input.assignment_lease_id || input.assignmentLeaseId, "op") : "",
    status,
    attempts: boundedItems(input.attempts, "attempts"),
    artifacts: boundedArtifactItems(input.artifacts),
    proposed_project_facts: boundedItems(input.proposed_project_facts || input.proposedProjectFacts, "proposed_project_facts"),
    finding_candidates: boundedItems(input.finding_candidates || input.findingCandidates || input.candidates, "finding_candidates"),
    blockers: boundedItems(input.blockers, "blockers"),
    coverage: boundedItems(input.coverage, "coverage"),
    remaining_work: boundedItems(input.remaining_work || input.remainingWork, "remaining_work"),
    source_revisions: boundedRevisionMap(input.source_revisions || input.sourceRevisions),
    summary: text(input.summary, 4_000),
    provenance: cloneSafe(input.provenance || { source_type: "runtime_event", source_refs: [input.child_invocation_id || input.childInvocationId || "specialist"] }),
    returned_at: iso(input.returned_at || input.returnedAt, "returned_at", now()),
  };
  assert(result.provenance && typeof result.provenance === "object", "MEMORY_SPECIALIST_PROVENANCE_REQUIRED", "A specialist return requires provenance.");
  assert(Buffer.byteLength(JSON.stringify(result), "utf8") <= SPECIALIST_RETURN_MAX_BYTES, "MEMORY_SPECIALIST_RETURN_TOO_LARGE", "The specialist return exceeds its serialized size limit.", { maximumBytes: SPECIALIST_RETURN_MAX_BYTES });
  return Object.freeze(result);
}

function createHandoffPacket(input = {}, { idFactory = null, now = () => new Date() } = {}) {
  const packet = createDispatchPacket({
    ...input,
    packet_type: "handoff",
    objective: input.objective || input.task || "Continue the delegated investigation.",
    parent_session_id: input.parent_session_id || input.parentSessionId || input.successor_session_id || input.successorSessionId,
    parent_agent_id: input.parent_agent_id || input.parentAgentId || input.successor_agent_id || input.successorAgentId,
    child_session_id: input.child_session_id || input.childSessionId || input.successor_session_id || input.successorSessionId,
    child_invocation_id: input.child_invocation_id || input.childInvocationId || "handoff",
  }, { idFactory, now });
  return Object.freeze({ ...packet, packet_type: "handoff", predecessor_session_id: text(input.predecessor_session_id || input.predecessorSessionId, 240), inherited_sensitive_handles: [] });
}

function validateDispatchPacket(input, options) { return validate((value) => createDispatchPacket(value, options), input); }
function validateAssignmentLease(input, options) { return validate((value) => createAssignmentLease(value, options), input); }
function validateSpecialistReturn(input, options) { return validate((value) => createSpecialistReturn(value, options), input); }
function validateHandoffPacket(input, options) { return validate((value) => createHandoffPacket(value, options), input); }

module.exports = Object.freeze({
  MULTI_AGENT_SCHEMA_VERSION,
  DISPATCH_PACKET_MAX_BYTES,
  SPECIALIST_RETURN_MAX_BYTES,
  ASSIGNMENT_STATES,
  SPECIALIST_STATUSES,
  createDispatchPacket,
  createAssignmentLease,
  createSpecialistReturn,
  createHandoffPacket,
  validateDispatchPacket,
  validateAssignmentLease,
  validateSpecialistReturn,
  validateHandoffPacket,
  canonicalDispatchPacket: (input, options) => canonicalJson(createDispatchPacket(input, options)),
});
