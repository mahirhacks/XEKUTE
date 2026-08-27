"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, isMemoryId } = require("../../../contracts/memory/index.js");
const { operationFailure, clone, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");
const { safeProjection } = require("../../storage/memory/derived-memory-index.js");
const { createMapProjectionAdapter } = require("./map-projection-adapter.js");

const MEMORY_GRAPH_VIEW_SERVICE_VERSION = 1;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function array(value) { return Array.isArray(value) ? value : []; }
function stateOf(value) { return value?.state && typeof value.state === "object" ? value.state : value && typeof value === "object" ? value : {}; }
function revisionOf(value) { return Math.max(0, Number(value?.revision ?? value?.sourceRevision ?? value?.source_revision ?? value?.state?.revision ?? 0) || 0); }

function referenceValues(value, keys) {
  const values = [];
  for (const key of keys) {
    const item = value?.[key];
    if (Array.isArray(item)) values.push(...item);
    else if (item) values.push(item);
  }
  return [...new Set(values.map((item) => typeof item === "object" ? item.entity_id || item.entityId || item.record_id || item.recordId || item.id || "" : item).map((item) => String(item || "").trim()).filter(Boolean))];
}

function referenceDomain(id) {
  const prefix = String(id || "").split("_", 1)[0];
  if (["entity", "claim", "rel"].includes(prefix)) return "project";
  if (["inv", "attempt"].includes(prefix)) return "investigation";
  if (prefix === "finding") return "evidence";
  if (prefix === "artifact") return "artifact";
  if (["kb", "procedure", "sel"].includes(prefix)) return "knowledge";
  return "";
}

function referenceType(id) {
  const prefix = String(id || "").split("_", 1)[0];
  return prefix || "reference";
}

function nodeFromRecord(record, projectId) {
  const data = record?.data && typeof record.data === "object" ? clone(record.data) : {};
  const nodeId = String(record?.record_id || record?.recordId || record?.node_id || record?.nodeId || "").trim();
  return {
    project_id: projectId,
    node_id: nodeId,
    record_id: nodeId,
    domain: text(record?.domain || "project", 80).toLowerCase(),
    record_type: text(record?.record_type || record?.recordType || record?.type || "record", 120),
    lifecycle_state: text(record?.lifecycle_state || record?.lifecycleState || record?.state || record?.status || "", 80),
    source_revision: revisionOf(record),
    canonical_key: text(record?.canonical_key || record?.canonicalKey || "", 160),
    label: text(record?.title || record?.label || record?.name || nodeId, 500),
    data: safeProjection(data) || {},
    provenance: safeProjection(record?.provenance || {}) || {},
  };
}

function placeholderNode(projectId, id, domain, sourceRevision, label = "") {
  return {
    project_id: projectId,
    node_id: id,
    record_id: id,
    domain,
    record_type: referenceType(id),
    lifecycle_state: "reference",
    source_revision: sourceRevision,
    canonical_key: "",
    label: text(label || id, 500),
    data: { reference_only: true },
    provenance: { source_type: "canonical_derivation", source_refs: [id] },
  };
}

function edge(source, target, type, sourceDomain, targetDomain, sourceRevision, provenance = {}) {
  return { source_id: source, target_id: target, edge_type: text(type, 120), source_domain: sourceDomain, target_domain: targetDomain, source_revision: sourceRevision, data: {}, provenance: safeProjection(provenance) || {} };
}

function createMemoryGraphView({
  store,
  derivedProjection = null,
  knowledgeStore = null,
  mapAdapter = null,
  mapProvider = null,
  manifestStore = null,
  featureFlags = {},
  enabled = undefined,
  crypto = nodeCrypto,
  now = () => new Date(),
  schedule = (callback) => setImmediate(callback),
} = {}) {
  if (!store?.replace || !store?.query || !store?.read) throw new TypeError("A memory graph store is required.");
  const adapter = mapAdapter || createMapProjectionAdapter({ crypto });
  const jobs = new Map();

  function isEnabled() { return enabled === undefined ? featureFlags.derivedMemoryViews === true : enabled === true; }
  function keyFor(workspace, projectId) { return `${resolvedWorkspace(require("node:path"), workspace)}|${projectId}`; }

  async function canonicalSources(input = {}) {
    if (Array.isArray(input.records)) return { ok: true, project_id: input.projectId || input.project_id, records: input.records, edges: array(input.edges), sourceRevisions: input.sourceRevisions || input.source_revisions || {}, watermark: input.watermark || null, warnings: array(input.warnings) };
    if (derivedProjection?.collectCanonicalProjection) return derivedProjection.collectCanonicalProjection(input);
    return { ok: true, project_id: input.projectId || input.project_id, records: [], edges: [], sourceRevisions: {}, watermark: null, warnings: [] };
  }

  async function pinnedKnowledge(projectId, baseRecords, supplied) {
    const raw = supplied === undefined ? [] : Array.isArray(supplied) ? supplied : [supplied];
    const releases = [];
    const procedureIds = new Set();
    for (const record of baseRecords) {
      const data = record?.data || record || {};
      for (const id of referenceValues(data, ["procedure_ids", "procedureIds", "procedure_id", "procedureId"])) if (id.startsWith("procedure_")) procedureIds.add(id);
      for (const id of referenceValues(data, ["knowledge_release_id", "knowledgeReleaseId", "release_id", "releaseId"])) if (id.startsWith("kb_")) releases.push(id);
    }
    for (const item of raw) {
      const release = item?.release || item;
      if (!release || typeof release !== "object") continue;
      const releaseId = String(release.release_id || release.releaseId || "").trim();
      if (releaseId.startsWith("kb_")) releases.push(release);
      for (const procedure of array(release.procedures || item.procedures)) if (procedure?.procedure_id || procedure?.procedureId) procedureIds.add(String(procedure.procedure_id || procedure.procedureId));
    }
    const resolvedReleases = [];
    for (const item of releases) {
      const loaded = typeof item === "string" && knowledgeStore?.get ? knowledgeStore.get(item) : { ok: true, release: item };
      if (!loaded?.ok || !loaded.release) continue;
      const release = loaded.release;
      const releaseId = String(release.release_id || release.releaseId || "").trim();
      if (!releaseId.startsWith("kb_")) continue;
      resolvedReleases.push(release);
      for (const procedure of array(release.procedures)) if (procedure?.procedure_id) procedureIds.add(procedure.procedure_id);
    }
    return { releases: resolvedReleases, procedureIds: [...procedureIds].sort() };
  }

  async function collectGraphProjection(input = {}) {
    let projectId;
    try { projectId = assertMemoryId(input.projectId || input.project_id, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_PROJECT_INVALID", error.message, error.details || {}); }
    const base = await canonicalSources({ ...input, projectId });
    if (!base?.ok) return base;
    const nodes = [];
    const nodeIds = new Set();
    const warnings = [...array(base.warnings)];
    const addNode = (value) => {
      if (!value?.node_id || nodeIds.has(value.node_id)) return;
      nodeIds.add(value.node_id);
      nodes.push({ ...value, project_id: projectId });
    };
    for (const record of array(base.records)) {
      try { addNode(nodeFromRecord({ ...record, project_id: projectId }, projectId)); } catch (error) { warnings.push({ code: error.code || "MEMORY_GRAPH_NODE_INVALID", message: text(error.message, 500) }); }
    }
    const revisions = { ...(base.sourceRevisions || {}) };
    const baseEdges = array(base.edges).map((value) => ({ ...value, project_id: projectId }));
    const knowledge = await pinnedKnowledge(projectId, array(base.records), input.knowledge);
    for (const release of knowledge.releases) {
      const releaseId = String(release.release_id || "").trim();
      addNode({ ...placeholderNode(projectId, releaseId, "knowledge", revisions.knowledge || 0, release.name || release.title || releaseId), record_type: "release", data: safeProjection({ release_id: releaseId, content_hash: release.content_hash, state: release.state, source: release.source, catalogue: release.catalogue }) || {}, provenance: { source_type: "canonical_derivation", source_refs: [releaseId] } });
      for (const procedure of array(release.procedures)) {
        const procedureId = String(procedure.procedure_id || "").trim();
        if (!procedureId) continue;
        addNode({ ...placeholderNode(projectId, procedureId, "knowledge", revisions.knowledge || 0, procedure.title || procedureId), record_type: "procedure", data: safeProjection({ procedure_id: procedureId, release_id: releaseId, title: procedure.title, objective: procedure.objective, target_features: procedure.target_features, classifications: procedure.classifications, source_refs: procedure.source_refs }) || {}, provenance: { source_type: "canonical_derivation", source_refs: [releaseId, procedureId] } });
        baseEdges.push(edge(releaseId, procedureId, "CONTAINS_PROCEDURE", "knowledge", "knowledge", revisions.knowledge || 0, { source_refs: [releaseId] }));
      }
    }
    for (const procedureId of knowledge.procedureIds) if (!nodeIds.has(procedureId) && isMemoryId(procedureId, "procedure")) addNode(placeholderNode(projectId, procedureId, "knowledge", revisions.knowledge || 0));
    const addReferences = (record) => {
      const data = record?.data || {};
      const sourceId = String(record?.record_id || "").trim();
      const sourceDomain = text(record?.domain || "project", 80);
      const sourceRevision = Number(record?.source_revision || 0) || 0;
      const references = [
        ...referenceValues(data, ["procedure_ids", "procedureIds", "procedure_id", "procedureId"]).map((id) => [id, "USES_PROCEDURE"]),
        ...referenceValues(data, ["knowledge_release_id", "knowledgeReleaseId", "release_id", "releaseId"]).map((id) => [id, "USES_RELEASE"]),
        ...referenceValues(data, ["artifact_refs", "artifactRefs", "proof_refs", "proofRefs", "reproduction_refs", "reproductionRefs"]).map((id) => [id, "PROVEN_BY"]),
        ...referenceValues(data, ["affected_entity_ids", "affectedEntityIds", "target_entity_ids", "targetEntityIds"]).map((id) => [id, "TARGETS"]),
        ...referenceValues(data, ["investigation_ids", "investigationIds"]).map((id) => [id, "CONFIRMED_BY"]),
        ...referenceValues(data, ["finding_id", "findingId"]).map((id) => [id, "RELATES_TO"]),
      ];
      for (const [targetId, relation] of references) {
        const targetDomain = referenceDomain(targetId);
        if (!targetDomain || !isMemoryId(targetId)) continue;
        if (!nodeIds.has(targetId)) addNode(placeholderNode(projectId, targetId, targetDomain, sourceRevision));
        baseEdges.push(edge(sourceId, targetId, relation, sourceDomain, targetDomain, sourceRevision, record?.provenance));
      }
    };
    for (const record of array(base.records)) addReferences(record);
    if (mapProvider || input.map) {
      let map = input.map;
      if (map === undefined && typeof mapProvider === "function") map = await mapProvider(input.workspace, projectId);
      const mapped = adapter.normalize(input.workspace || "", projectId, map?.graph || map || {});
      if (mapped.ok) {
        for (const node of mapped.nodes) addNode(node);
        baseEdges.push(...mapped.edges);
        warnings.push(...array(mapped.warnings));
        revisions.map = Number(map?.revision || map?.sourceRevision || 0) || 0;
      } else warnings.push({ code: mapped.code || "MEMORY_MAP_PROJECTION_FAILED", message: mapped.error || "The Map projection failed." });
    }
    const edges = baseEdges.filter((value) => value && value.source_id && value.target_id).map((value) => ({ ...value, project_id: projectId }));
    return { ok: true, project_id: projectId, nodes, edges, sourceRevisions: revisions, watermark: base.watermark || null, warnings: warnings.slice(0, 500), captured_at: timestamp(now) };
  }

  async function updateManifest(workspace, projectId, result, sourceRevisions) {
    if (!manifestStore?.update || !result?.ok) return { ok: true, skipped: true };
    return manifestStore.update(workspace, projectId, (manifest) => {
      manifest.projections.graph = { ...(manifest.projections.graph || {}), revision: Number(result.projection_revision || 0), source_revisions: clone(sourceRevisions || {}), updated_at: timestamp(now), status: "ready" };
      return manifest;
    }, { reason: "derived_graph_projection" });
  }

  async function rebuild(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const collected = await collectGraphProjection(input);
    if (!collected.ok) return collected;
    const result = store.replace(input.workspace, collected.project_id, { nodes: collected.nodes, edges: collected.edges, source_revisions: collected.sourceRevisions, watermark: collected.watermark, warnings: collected.warnings });
    if (!result.ok) return result;
    const manifest = await updateManifest(input.workspace, collected.project_id, result, collected.sourceRevisions);
    const warnings = [...(result.warnings || []), ...collected.warnings];
    if (manifest?.ok === false) warnings.push({ code: manifest.code || "MEMORY_MANIFEST_UPDATE_FAILED", message: manifest.error || "The graph projection status could not be updated." });
    return { ...result, project_id: collected.project_id, sourceRevisions: collected.sourceRevisions, watermark: collected.watermark, warnings };
  }

  function query(workspace, projectId, input = {}) { return store.query(workspace, projectId, input); }

  function scheduleRebuild(input = {}) {
    if (!isEnabled()) return Promise.resolve({ ok: true, enabled: false, skipped: true, changed: false });
    let projectId;
    try { projectId = assertMemoryId(input.projectId || input.project_id, "proj"); } catch (error) { return Promise.resolve(operationFailure(error.code || "MEMORY_GRAPH_PROJECT_INVALID", error.message, error.details || {})); }
    const key = keyFor(input.workspace, projectId);
    const previous = jobs.get(key) || Promise.resolve();
    const job = previous.catch(() => {}).then(() => new Promise((resolve) => {
      schedule(() => rebuild({ ...input, projectId }).then(resolve).catch((error) => resolve(operationFailure("MEMORY_GRAPH_REBUILD_FAILED", error.message, {}, true))));
    })).finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
    jobs.set(key, job);
    return job;
  }

  async function whenIdle(workspace = "", projectId = "") {
    const selected = projectId ? [jobs.get(keyFor(workspace, projectId))].filter(Boolean) : [...jobs.values()];
    await Promise.all(selected.map((job) => job.catch(() => {})));
    return { ok: true, pending: 0 };
  }

  function status(workspace, projectId) {
    let id;
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_PROJECT_INVALID", error.message, error.details || {}); }
    return { ok: true, enabled: isEnabled(), project_id: id, status: jobs.has(keyFor(workspace, id)) ? "building" : "idle", pending: jobs.has(keyFor(workspace, id)) ? 1 : 0 };
  }

  return Object.freeze({ MEMORY_GRAPH_VIEW_SERVICE_VERSION, enabled: isEnabled, collectGraphProjection, rebuild, query, scheduleRebuild, whenIdle, status });
}

module.exports = Object.freeze({ MEMORY_GRAPH_VIEW_SERVICE_VERSION, createMemoryGraphView, nodeFromRecord, referenceDomain });
