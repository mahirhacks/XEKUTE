"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId, canonicalJson } = require("../../../contracts/memory/index.js");
const { assertSensitivity, SENSITIVITY_LEVELS } = require("../../../contracts/memory/memory-lifecycle.js");
const { createRetrievalRequest, createRetrievalResult, RETRIEVAL_DOMAINS } = require("../../../contracts/memory/retrieval-contracts.js");
const { operationFailure, clone, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const RETRIEVAL_SERVICE_VERSION = 1;
const SENSITIVITY_RANK = Object.freeze(Object.fromEntries(SENSITIVITY_LEVELS.map((value, index) => [value, index])));

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function tokenEstimate(value) { return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value == null ? null : value), "utf8") / 4)); }
function stableItemKey(item) { return `${item.domain}|${item.record_id || item.id || ""}|${canonicalJson(item.record || item.value || {})}`; }
function encodeCursor(value) { return Buffer.from(String(value || ""), "utf8").toString("base64url"); }
function decodeCursor(value) { try { return Buffer.from(String(value || ""), "base64url").toString("utf8"); } catch { return ""; } }

function createMemoryRetrievalService({
  projectRepository = null,
  investigationRepository = null,
  evidenceRepository = null,
  knowledgeStore = null,
  graphProvider = null,
  artifactRegistry = null,
  checkpointProvider = null,
  recentTailProvider = null,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  const leases = new Map();

  function providerFor(domain) {
    if (domain === "project") return projectRepository;
    if (domain === "investigation") return investigationRepository;
    if (domain === "evidence") return evidenceRepository;
    if (domain === "knowledge") return knowledgeStore;
    if (domain === "graph") return graphProvider;
    if (domain === "artifact") return artifactRegistry;
    if (domain === "checkpoint") return checkpointProvider;
    if (domain === "recent_tail") return recentTailProvider;
    return null;
  }

  function normalizedRecord(domain, value, index, providerResult = {}) {
    const record = value && typeof value === "object" ? clone(value) : { value: text(value, 4_000) };
    const recordId = String(record.record_id || record.recordId || record.entity_id || record.entityId || record.claim_id || record.claimId || record.finding_id || record.findingId || record.artifact_id || record.artifactId || record.id || `${domain}-${index}`).trim();
    const sensitivity = SENSITIVITY_LEVELS.includes(String(record.sensitivity || "")) ? String(record.sensitivity) : domain === "artifact" ? "confidential" : "internal";
    return {
      domain,
      record_id: recordId,
      record_type: text(record.record_type || record.recordType || record.type || domain, 120),
      sensitivity,
      source_revision: Number(providerResult.sourceRevision ?? providerResult.revision ?? record.revision ?? record.source_revision ?? 0) || 0,
      provenance: clone(record.provenance || record.source_refs || record.sourceRefs || []),
      record,
    };
  }

  function flattenProject(result) {
    if (!result || typeof result !== "object") return [];
    if (Array.isArray(result.records)) return result.records;
    const records = [];
    for (const key of ["entities", "claims", "relationships", "conflicts", "changes", "aliases"]) {
      for (const value of Array.isArray(result[key]) ? result[key] : []) records.push({ ...value, record_type: value.record_type || key });
    }
    return records;
  }

  async function readDomain(domain, input, request) {
    const provider = providerFor(domain);
    if (!provider) return { ok: true, records: [], sourceRevision: 0, warnings: [{ code: "MEMORY_DOMAIN_UNAVAILABLE", domain }] };
    try {
      let result;
      if (domain === "project" && provider.query) result = await provider.query(input.workspace, input.projectId, { ...request.filters, limit: request.limit, cursor: request.cursor, source_revisions: request.source_revisions });
      else if (domain === "artifact" && provider.list) result = await provider.list(input.workspace, input.projectId, { ...(request.filters || {}), limit: request.limit, cursor: request.cursor });
      else if (domain === "knowledge" && provider.catalogue) result = await provider.catalogue(request.filters?.release_id || request.filters?.releaseId || "");
      else if (typeof provider === "function") result = await provider({ ...input, request, domain });
      else if (provider.query) result = await provider.query({ ...request, workspace: input.workspace, project_id: input.projectId, graph_depth: request.graph_depth });
      else if (provider.list) result = await provider.list({ ...request, workspace: input.workspace, project_id: input.projectId });
      else result = { ok: true, records: [] };
      if (result?.ok === false) return result;
      const sourceRevision = Number(result?.sourceRevision ?? result?.revision ?? result?.source_revision ?? 0) || 0;
      const values = domain === "project" ? flattenProject(result) : domain === "artifact" ? (result.artifacts || result.records || []) : domain === "knowledge" ? (result.catalogue || result.items || result.records || []) : (result.records || result.items || result.nodes || result.results || (Array.isArray(result) ? result : []));
      return { ok: true, records: values, sourceRevision, warnings: Array.isArray(result?.warnings) ? result.warnings : [] };
    } catch (error) {
      return operationFailure("MEMORY_RETRIEVAL_PROVIDER_FAILED", `The ${domain} memory provider failed: ${error.message}.`, { domain }, true);
    }
  }

  async function query(input = {}) {
    let request;
    try { request = createRetrievalRequest({ ...input, domains: Array.isArray(input.domains) && input.domains.length ? input.domains : ["project"] }); } catch (error) { return operationFailure(error.code || "MEMORY_RETRIEVAL_REQUEST_INVALID", error.message, error.details || {}); }
    const workspace = String(input.workspace || "").trim();
    if (!workspace) return operationFailure("MEMORY_RETRIEVAL_WORKSPACE_REQUIRED", "A workspace is required for retrieval.");
    const domains = request.domains.filter((domain) => RETRIEVAL_DOMAINS.includes(domain));
    const loaded = await Promise.all(domains.map((domain) => readDomain(domain, { workspace, projectId: request.project_id }, request)));
    const warnings = loaded.flatMap((result) => result.warnings || []).slice(0, 100);
    const currentRevisions = {};
    const candidates = [];
    for (let domainIndex = 0; domainIndex < loaded.length; domainIndex += 1) {
      const result = loaded[domainIndex];
      const domain = domains[domainIndex];
      if (!result.ok) { warnings.push({ code: result.code, domain, error: result.error }); continue; }
      currentRevisions[domain] = result.sourceRevision || 0;
      for (let index = 0; index < result.records.length; index += 1) candidates.push(normalizedRecord(domain, result.records[index], index, result));
    }
    candidates.sort((left, right) => stableItemKey(left).localeCompare(stableItemKey(right)));
    const cursorKey = decodeCursor(request.cursor);
    const start = cursorKey ? (() => {
      const index = candidates.findIndex((item) => stableItemKey(item) > cursorKey);
      return index < 0 ? candidates.length : index;
    })() : 0;
    const records = [];
    const omitted = [];
    let usedTokens = 0;
    for (const candidate of candidates.slice(start < 0 ? candidates.length : start)) {
      const rank = SENSITIVITY_RANK[candidate.sensitivity] ?? SENSITIVITY_RANK.confidential;
      if (rank > SENSITIVITY_RANK[request.sensitivity_ceiling]) {
        omitted.push({ domain: candidate.domain, record_id: candidate.record_id, reason: "sensitivity_ceiling" });
        continue;
      }
      if (records.length >= request.limit) { omitted.push({ domain: candidate.domain, record_id: candidate.record_id, reason: "record_limit" }); continue; }
      const itemTokens = tokenEstimate(candidate);
      if (usedTokens + itemTokens > request.token_budget) { omitted.push({ domain: candidate.domain, record_id: candidate.record_id, reason: "token_budget", tokens: itemTokens }); continue; }
      usedTokens += itemTokens;
      records.push({ ...candidate, provenance: request.include_provenance ? candidate.provenance : undefined });
    }
    const staleness = Object.entries(request.source_revisions).some(([domain, expected]) => currentRevisions[domain] !== undefined && currentRevisions[domain] < expected) ? "stale" : warnings.some((warning) => warning.code === "MEMORY_FINALIZATION_PENDING") ? "pending" : "current";
    const last = records.at(-1);
    return createRetrievalResult({
      request,
      project_id: request.project_id,
      records,
      omitted,
      omissions: { total: omitted.length, byReason: omitted.reduce((map, item) => { map[item.reason] = (map[item.reason] || 0) + 1; return map; }, {}) },
      source_revisions: currentRevisions,
      staleness,
      next_cursor: records.length === request.limit && last ? encodeCursor(stableItemKey(last)) : null,
      token_accounting: { used_tokens: usedTokens, omitted_tokens: omitted.reduce((sum, item) => sum + Number(item.tokens || 0), 0) },
      warnings,
    });
  }

  function leaseKey(projectId, sessionId) { return `${projectId}|${text(sessionId, 240)}`; }
  function leaseId() { return createOpaqueId("sel", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }); }

  function leaseKnowledge({ projectId, sessionId, releaseId, procedureIds = [], objective = "" } = {}) {
    let project;
    try { project = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_KB_LEASE_INPUT_INVALID", error.message, error.details || {}); }
    const session = text(sessionId, 240);
    if (!session) return operationFailure("MEMORY_KB_SESSION_REQUIRED", "A session is required for a Knowledge lease.");
    if (!knowledgeStore?.get) return operationFailure("MEMORY_KB_STORE_UNAVAILABLE", "The Knowledge release store is unavailable.");
    const loaded = knowledgeStore.get(releaseId);
    if (!loaded.ok) return loaded;
    const ids = [...new Set((Array.isArray(procedureIds) ? procedureIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
    const selected = ids.length ? ids.map((id) => loaded.release.procedures.find((procedure) => procedure.procedure_id === id || procedure.aliases.includes(id))).filter(Boolean) : loaded.release.procedures.slice(0, 50);
    if (ids.length !== selected.length) return operationFailure("MEMORY_KB_PROCEDURE_NOT_FOUND", "One or more requested procedures are not in the selected release.", { releaseId, procedureIds: ids });
    const record = { lease_id: leaseId(), project_id: project, session_id: session, objective: text(objective, 2_000), release_id: loaded.release.release_id, content_hash: loaded.release.content_hash, procedure_ids: selected.map((procedure) => procedure.procedure_id), bodies: clone(selected), created_at: timestamp(now), active: true, released_at: "" };
    leases.set(leaseKey(project, session), record);
    return { ok: true, lease_id: record.lease_id, project_id: project, session_id: session, release_id: record.release_id, content_hash: record.content_hash, procedure_ids: clone(record.procedure_ids), bodies: clone(record.bodies), expires_on: "compression_or_close_or_release_invalidation_or_explicit_release" };
  }

  function getKnowledgeLease({ projectId, sessionId } = {}) {
    const record = leases.get(leaseKey(String(projectId || ""), sessionId));
    if (!record || !record.active) return { ok: true, active: false, lease: record ? { lease_id: record.lease_id, release_id: record.release_id, content_hash: record.content_hash, procedure_ids: clone(record.procedure_ids) } : null };
    return { ok: true, active: true, lease: { lease_id: record.lease_id, project_id: record.project_id, session_id: record.session_id, objective: record.objective, release_id: record.release_id, content_hash: record.content_hash, procedure_ids: clone(record.procedure_ids), bodies: clone(record.bodies) } };
  }

  function releaseKnowledgeLease({ projectId, sessionId, leaseId: requested = "" } = {}) {
    const key = leaseKey(String(projectId || ""), sessionId);
    const record = leases.get(key);
    if (!record || (requested && record.lease_id !== requested)) return { ok: true, changed: false };
    record.active = false;
    record.released_at = timestamp(now);
    record.bodies = [];
    return { ok: true, changed: true, lease_id: record.lease_id, release_id: record.release_id, procedure_ids: clone(record.procedure_ids) };
  }

  function expireSession(sessionId, projectId = "") {
    const changed = [];
    for (const record of leases.values()) if (record.session_id === String(sessionId || "") && (!projectId || record.project_id === projectId) && record.active) { releaseKnowledgeLease({ projectId: record.project_id, sessionId: record.session_id, leaseId: record.lease_id }); changed.push(record.lease_id); }
    return { ok: true, changed: changed.length, leaseIds: changed };
  }
  function invalidateRelease(releaseId) {
    const changed = [];
    for (const record of leases.values()) if (record.release_id === String(releaseId || "") && record.active) { releaseKnowledgeLease({ projectId: record.project_id, sessionId: record.session_id, leaseId: record.lease_id }); changed.push(record.lease_id); }
    return { ok: true, changed: changed.length, leaseIds: changed };
  }
  function expireOnCompression(projectId, sessionId) { return expireSession(sessionId, projectId); }
  function activeLeaseCount() { return [...leases.values()].filter((record) => record.active).length; }

  return Object.freeze({
    RETRIEVAL_SERVICE_VERSION,
    query,
    leaseKnowledge,
    getKnowledgeLease,
    releaseKnowledgeLease,
    expireSession,
    expireOnCompression,
    invalidateRelease,
    activeLeaseCount,
  });
}

module.exports = Object.freeze({ createMemoryRetrievalService, RETRIEVAL_SERVICE_VERSION, tokenEstimate, stableItemKey });
