"use strict";

const nodeCrypto = require("node:crypto");
const { assert, assertMemoryId, canonicalJson, canonicalKeyHash } = require("../../../contracts/memory/index.js");
const { validateExecutionEvent, EXECUTION_EVENT_TYPE_SET } = require("./execution-events.js");

const BLOCK_REDUCTION_VERSION = 1;
const PROJECT_CANDIDATE_TYPES = new Set(["upsert_entity", "upsert_claim", "upsert_relationship", "register_alias"]);
const MAX_CANDIDATES = 500;
const MAX_RESIDUES = 1_000;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function stableHash(value) {
  return nodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function capsuleHash(capsule) {
  const copy = clone(capsule) || {};
  delete copy.reduction_hash;
  delete copy.integrity_hash;
  return canonicalKeyHash(copy);
}

function validTerminal(event) {
  return Boolean(event && ["block_completed", "block_failed", "block_cancelled", "block_interrupted"].includes(event.event_type));
}

function validateExecutionCapsule(capsule, events = []) {
  const source = capsule && typeof capsule === "object" ? capsule : {};
  const errors = [];
  try { assertMemoryId(source.project_id || source.projectId, "proj"); } catch (error) { errors.push(error.message); }
  try { assertMemoryId(source.block_id || source.blockId, "block"); } catch (error) { errors.push(error.message); }
  try { assertMemoryId(source.operation_id || source.operationId, "op"); } catch (error) { errors.push(error.message); }
  if (Number(source.version) !== BLOCK_REDUCTION_VERSION) errors.push("Unsupported execution capsule version.");
  if (source.sealed !== true) errors.push("An execution capsule must be sealed before reduction.");
  const list = Array.isArray(events) ? events : [];
  const ids = Array.isArray(source.event_ids || source.eventIds) ? (source.event_ids || source.eventIds).map(String) : [];
  if (Number(source.event_count) !== list.length) errors.push("Execution capsule event_count does not match its event list.");
  if (ids.length !== list.length || new Set(ids).size !== ids.length) errors.push("Execution capsule event IDs are incomplete or duplicated.");
  const sorted = [...list].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  if (sorted.some((event, index) => event !== list[index])) errors.push("Execution events are not ordered by journal sequence.");
  const first = Number(source.first_sequence || source.firstSequence || 0);
  const last = Number(source.last_sequence || source.lastSequence || 0);
  if (list.length && (Number(list[0].sequence) !== first || Number(list.at(-1).sequence) !== last)) errors.push("Execution capsule range does not cover the supplied events.");
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index];
    const checked = validateExecutionEvent(event);
    if (!checked.ok) errors.push(`event ${index + 1}: ${checked.error}`);
    if (ids[index] !== event?.event_id) errors.push(`event ${index + 1}: event ID does not match the capsule.`);
    if (event?.project_id !== source.project_id || event?.block_id !== source.block_id || event?.operation_id !== source.operation_id) errors.push(`event ${index + 1}: ownership does not match the capsule.`);
  }
  const terminal = list.at(-1);
  if (!terminal || !validTerminal(terminal) || terminal.event_id !== source.terminal_event_id) errors.push("The final event is not the capsule terminal event.");
  if (errors.length) return { ok: false, code: "MEMORY_EXECUTION_CAPSULE_INVALID", error: errors.join(" "), errors };
  return { ok: true, capsule: clone(source), events: list.map(clone), event_range_hash: stableHash({ first, last, event_ids: ids }) };
}

function candidateValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return clone(value);
}

function candidateList(payload, keys) {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function projectCandidateFrom(raw, event) {
  const source = candidateValue(raw);
  if (!source) return null;
  const mutationType = text(source.mutation_type || source.mutationType || source.type, 80).toLowerCase();
  if (!PROJECT_CANDIDATE_TYPES.has(mutationType)) return null;
  const payload = source.payload && typeof source.payload === "object" ? source.payload : source;
  return {
    mutation_type: mutationType,
    payload: clone(payload),
    source_event_id: event.event_id,
    source_ids: [event.event_id, ...(event.source_ids || [])].slice(0, 100),
    artifact_refs: [...new Set([...(event.artifact_refs || []), ...(source.artifact_refs || source.artifactRefs || [])].map(String).filter(Boolean))].slice(0, 100),
  };
}

function investigationCandidate(raw, event, type = "execution") {
  const source = candidateValue(raw);
  if (!source) return null;
  const recordType = text(source.record_type || source.recordType || source.type || type, 80).toLowerCase();
  return {
    record_type: recordType,
    legacy: false,
    source_event_id: event.event_id,
    source_ids: [event.event_id, ...(event.source_ids || [])].slice(0, 100),
    artifact_refs: [...new Set([...(event.artifact_refs || []), ...(source.artifact_refs || source.artifactRefs || [])].map(String).filter(Boolean))].slice(0, 100),
    value: clone(source),
  };
}

function verificationCandidate(raw, event) {
  const source = candidateValue(raw) || {};
  return {
    finding_id: text(source.finding_id || source.findingId || event.payload?.finding_id || "", 240),
    verdict: text(source.verdict || event.payload?.verdict || "inconclusive", 80).toLowerCase(),
    summary: text(source.summary || event.payload?.summary || "", 2_000),
    source_event_id: event.event_id,
    artifact_refs: [...new Set([...(event.artifact_refs || []), ...(source.artifact_refs || source.artifactRefs || [])].map(String).filter(Boolean))].slice(0, 100),
    value: clone(source),
  };
}

function toolFingerprint(event, payload) {
  return canonicalKeyHash({
    tool: text(payload.tool_name || payload.toolName || "tool", 160).toLowerCase(),
    target: text(payload.normalized_target || payload.target || "", 500),
    identity: text(payload.identity_ref || payload.identityId || "", 240),
    role: text(payload.role || "", 160),
    auth_state: text(payload.auth_state || payload.authState || "", 120),
    outcome: text(payload.outcome || payload.status || "", 120).toLowerCase(),
    response_schema_hash: text(payload.response_schema_hash || payload.responseSchemaHash || "", 128),
    security_flags: [...new Set((Array.isArray(payload.security_flags) ? payload.security_flags : []).map((value) => text(value, 120)).filter(Boolean))].sort(),
    event_type: event.event_type,
  });
}

function trafficFingerprint(value) {
  const source = value && typeof value === "object" ? value : {};
  return canonicalKeyHash({
    method: text(source.method || "GET", 20).toUpperCase(),
    route: text(source.normalized_route || source.route || source.path || "", 1_000),
    identity_ref: text(source.identity_ref || source.identityId || "", 240),
    role: text(source.role || "", 160),
    auth_state: text(source.auth_state || source.authState || "", 120),
    status: Number(source.status || source.status_code || source.statusCode || 0) || 0,
    response_schema_hash: text(source.response_schema_hash || source.responseSchemaHash || "", 128),
    security_flags: [...new Set((Array.isArray(source.security_flags) ? source.security_flags : []).map((entry) => text(entry, 120)).filter(Boolean))].sort(),
  });
}

function reduceExecutionBlock({ capsule, events = [] } = {}) {
  const checked = validateExecutionCapsule(capsule, events);
  if (!checked.ok) return { ok: false, ...checked, version: BLOCK_REDUCTION_VERSION, records: [], residues: [{ reason: "invalid_execution_capsule" }] };
  const projectCandidates = [];
  const investigationCandidates = [];
  const verificationCandidates = [];
  const residues = [];
  const toolMap = new Map();
  const trafficMap = new Map();
  for (const event of checked.events) {
    if (!EXECUTION_EVENT_TYPE_SET.has(event.event_type)) {
      residues.push({ reason: "unknown_execution_event", event_id: event.event_id });
      continue;
    }
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (["tool_invocation_started", "tool_result_captured"].includes(event.event_type)) {
      const key = toolFingerprint(event, payload);
      const prior = toolMap.get(key) || { fingerprint: key, tool: text(payload.tool_name || "tool", 160), outcomes: {}, count: 0, event_ids: [], artifact_refs: [] };
      prior.count += 1;
      const outcome = text(payload.outcome || payload.status || "observed", 120).toLowerCase();
      prior.outcomes[outcome] = (prior.outcomes[outcome] || 0) + 1;
      prior.event_ids = [...new Set([...prior.event_ids, event.event_id])].sort().slice(0, 100);
      prior.artifact_refs = [...new Set([...prior.artifact_refs, ...(event.artifact_refs || [])])].sort().slice(0, 100);
      toolMap.set(key, prior);
    }
    for (const rawTraffic of candidateList(payload, ["traffic", "traffic_events", "traffic_candidates"])) {
      if (!rawTraffic || typeof rawTraffic !== "object") { residues.push({ reason: "invalid_traffic_candidate", event_id: event.event_id }); continue; }
      const fingerprint = trafficFingerprint(rawTraffic);
      const prior = trafficMap.get(fingerprint) || { fingerprint, count: 0, representative: clone(rawTraffic), event_ids: [], artifact_refs: [] };
      prior.count += 1;
      prior.event_ids = [...new Set([...prior.event_ids, event.event_id])].sort().slice(0, 100);
      prior.artifact_refs = [...new Set([...prior.artifact_refs, ...(event.artifact_refs || [])])].sort().slice(0, 100);
      trafficMap.set(fingerprint, prior);
    }
    for (const raw of candidateList(payload, ["project_candidates", "project_facts", "projectMutations"])) {
      const candidate = projectCandidateFrom(raw, event);
      if (candidate) projectCandidates.push(candidate);
      else residues.push({ reason: "invalid_project_candidate", event_id: event.event_id });
    }
    for (const raw of candidateList(payload, ["investigation_candidates", "attempts", "negative_results", "blockers", "coverage"])) {
      const candidate = investigationCandidate(raw, event, payload.record_type || "execution");
      if (candidate) investigationCandidates.push(candidate);
      else residues.push({ reason: "invalid_investigation_candidate", event_id: event.event_id });
    }
    if (event.event_type === "verification_verdict") {
      verificationCandidates.push(verificationCandidate(payload, event));
    }
    if (event.event_type === "specialist_return") {
      for (const raw of candidateList(payload, ["project_candidates", "project_facts"])) {
        const candidate = projectCandidateFrom(raw, event);
        if (candidate) projectCandidates.push(candidate); else residues.push({ reason: "invalid_specialist_project_candidate", event_id: event.event_id });
      }
      for (const raw of candidateList(payload, ["investigation_candidates", "attempts", "negative_results", "blockers", "coverage"])) {
        const candidate = investigationCandidate(raw, event, "specialist_return");
        if (candidate) investigationCandidates.push(candidate); else residues.push({ reason: "invalid_specialist_investigation_candidate", event_id: event.event_id });
      }
    }
  }
  const dedupe = (items, key) => {
    const map = new Map();
    for (const item of items) map.set(key(item), item);
    return [...map.values()].sort((left, right) => key(left).localeCompare(key(right))).slice(0, MAX_CANDIDATES);
  };
  const result = {
    ok: true,
    version: BLOCK_REDUCTION_VERSION,
    project_id: checked.capsule.project_id,
    block_id: checked.capsule.block_id,
    operation_id: checked.capsule.operation_id,
    event_range_hash: checked.event_range_hash,
    project_candidates: dedupe(projectCandidates, (item) => `${item.mutation_type}|${canonicalJson(item.payload)}`),
    investigation_candidates: dedupe(investigationCandidates, (item) => `${item.record_type}|${canonicalJson(item.value)}|${item.source_event_id}`),
    verification_candidates: dedupe(verificationCandidates, (item) => `${item.finding_id}|${item.verdict}|${item.source_event_id}`),
    tool_clusters: [...toolMap.values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    traffic_clusters: [...trafficMap.values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    residues: residues.slice(0, MAX_RESIDUES),
    terminal: clone(checked.events.at(-1)),
  };
  const { reduction_hash: _ignoredReductionHash, ...unsignedResult } = result;
  result.reduction_hash = stableHash(unsignedResult);
  return result;
}

module.exports = Object.freeze({
  BLOCK_REDUCTION_VERSION,
  validateExecutionCapsule,
  reduceExecutionBlock,
  stableHash,
  trafficFingerprint,
});
