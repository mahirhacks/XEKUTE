"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalKeyHash } = require("../../../contracts/memory/index.js");
const { operationFailure, clone, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");
const { safeProjection } = require("../../storage/memory/derived-memory-index.js");

const DERIVED_MEMORY_PROJECTION_SERVICE_VERSION = 1;
const PROJECT_COLLECTIONS = Object.freeze(["entities", "claims", "relationships", "conflicts", "aliases", "changes"]);
const INVESTIGATION_COLLECTIONS = Object.freeze(["programmes", "investigations", "applicability", "test_cases", "assignments", "attempts", "negative_results", "candidates", "blockers", "coverage", "remaining_work"]);
const EVIDENCE_COLLECTIONS = Object.freeze(["findings", "verifications", "remediations", "retests"]);

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function array(value) { return Array.isArray(value) ? value : []; }

function revisionOf(value) {
  if (value && typeof value === "object") return Math.max(0, Number(value.revision ?? value.sourceRevision ?? value.source_revision ?? value.state?.revision ?? 0) || 0);
  return 0;
}

function stateOf(value) {
  if (value?.state && typeof value.state === "object") return value.state;
  return value && typeof value === "object" ? value : {};
}

function recordIdOf(record, domain, collection, index, crypto = nodeCrypto) {
  const supplied = String(record?.record_id || record?.recordId || record?.id || record?.[`${collection.slice(0, -1)}_id`] || "").trim();
  if (supplied) return supplied;
  const digest = crypto.createHash("sha256").update(JSON.stringify(record || {}), "utf8").digest("hex").slice(0, 32);
  return `${domain}_${collection}_${index}_${digest}`;
}

function titleOf(record, domain, recordId) {
  const values = [
    record?.title,
    record?.label,
    record?.name,
    record?.hostname,
    record?.host,
    record?.route,
    record?.template,
    record?.url,
    record?.vulnerability_class,
    record?.objective,
    record?.predicate,
    record?.relationship_type,
  ];
  return text(values.find((value) => String(value || "").trim()) || `${domain}:${recordId}`, 500);
}

function lifecycleOf(record) {
  return text(record?.lifecycle_state || record?.lifecycleState || record?.state || record?.status || record?.verification_status || record?.outcome || "", 80);
}

function projectionRecord(domain, collection, record, sourceRevision, index, crypto = nodeCrypto) {
  const value = record && typeof record === "object" ? clone(record) : { value: record };
  const recordId = recordIdOf(value, domain, collection, index, crypto);
  const safe = safeProjection(value);
  const data = safe && typeof safe === "object" ? safe : {};
  const title = titleOf(value, domain, recordId);
  return {
    project_id: value.project_id,
    domain,
    record_id: recordId,
    record_type: text(value.record_type || value.recordType || collection.replace(/s$/, "") || domain, 120),
    lifecycle_state: lifecycleOf(value),
    source_revision: sourceRevision,
    canonical_key: text(value.canonical_key || value.canonicalKey || value.canonical_key_hash || value.canonicalKeyHash || value.fingerprint || "", 160),
    title,
    searchable_text: text(`${title} ${JSON.stringify(data)}`, 20_000),
    data,
    provenance: safeProjection(value.provenance || {}),
  };
}

function refs(value, names) {
  const result = [];
  for (const name of names) {
    const candidate = value?.[name];
    if (Array.isArray(candidate)) result.push(...candidate);
    else if (candidate) result.push(candidate);
  }
  return [...new Set(result.map((item) => typeof item === "object" ? (item.entity_id || item.entityId || item.record_id || item.recordId || item.id || "") : item).map((item) => String(item || "").trim()).filter(Boolean))];
}

function edgeOf(source, target, type, sourceDomain, targetDomain, sourceRevision, data = {}, provenance = {}) {
  return {
    source_id: String(source || "").trim(),
    target_id: String(target || "").trim(),
    edge_type: text(type, 120),
    source_domain: text(sourceDomain, 80),
    target_domain: text(targetDomain, 80),
    source_revision: sourceRevision,
    data: safeProjection(data),
    provenance: safeProjection(provenance),
  };
}

function projectRelationships(projectState, sourceRevision) {
  const edges = [];
  for (const relationship of array(projectState.relationships)) {
    const source = relationship.source_id || relationship.sourceId;
    const target = relationship.target_id || relationship.targetId;
    if (source && target && relationship.relationship_type) edges.push(edgeOf(source, target, relationship.relationship_type, "project", "project", sourceRevision, { relationship_id: relationship.record_id }, relationship.provenance));
  }
  for (const claim of array(projectState.claims)) {
    const subject = claim.subject_id || claim.subjectId;
    const object = claim.object?.entity_id || claim.object?.entityId;
    if (subject && object) edges.push(edgeOf(subject, object, `CLAIMS_${String(claim.predicate || "fact").toUpperCase()}`, "project", "project", sourceRevision, { claim_id: claim.record_id }, claim.provenance));
  }
  return edges;
}

function projectCrossMemoryEdges(investigationState, evidenceState, sourceRevisions) {
  const edges = [];
  for (const investigation of array(investigationState.investigations)) {
    const id = investigation.record_id;
    for (const procedureId of refs(investigation, ["procedure_ids", "procedureIds", "procedure_id", "procedureId"])) edges.push(edgeOf(id, procedureId, "USES_PROCEDURE", "investigation", "knowledge", sourceRevisions.investigation, {}, investigation.provenance));
    for (const entityId of refs(investigation, ["target_bindings", "targetBindings", "target_entity_ids", "targetEntityIds"])) edges.push(edgeOf(id, entityId, "TARGETS", "investigation", "project", sourceRevisions.investigation, {}, investigation.provenance));
  }
  for (const attempt of array(investigationState.attempts)) {
    for (const artifactId of refs(attempt, ["artifact_refs", "artifactRefs"])) edges.push(edgeOf(attempt.record_id, artifactId, "USES_ARTIFACT", "investigation", "artifact", sourceRevisions.investigation, {}, attempt.provenance));
  }
  for (const candidate of array(investigationState.candidates)) {
    for (const entityId of refs(candidate, ["affected_entity_ids", "affectedEntityIds", "target_entity_ids", "targetEntityIds"])) edges.push(edgeOf(candidate.record_id, entityId, "AFFECTS", "investigation", "project", sourceRevisions.investigation, {}, candidate.provenance));
  }
  for (const finding of array(evidenceState.findings)) {
    for (const entityId of refs(finding, ["affected_entity_ids", "affectedEntityIds"])) edges.push(edgeOf(finding.record_id, entityId, "AFFECTS", "evidence", "project", sourceRevisions.evidence, {}, finding.provenance));
    for (const investigationId of refs(finding, ["investigation_ids", "investigationIds"])) edges.push(edgeOf(finding.record_id, investigationId, "CONFIRMED_BY", "evidence", "investigation", sourceRevisions.evidence, {}, finding.provenance));
    for (const artifactId of refs(finding, ["proof_refs", "proofRefs", "reproduction_refs", "reproductionRefs"])) edges.push(edgeOf(finding.record_id, artifactId, "PROVEN_BY", "evidence", "artifact", sourceRevisions.evidence, {}, finding.provenance));
  }
  return edges.filter((edge) => edge.source_id && edge.target_id && edge.edge_type);
}

function createDerivedMemoryProjectionService({
  index,
  projectRepository = null,
  investigationRepository = null,
  evidenceRepository = null,
  artifactRegistry = null,
  manifestStore = null,
  watermarkStore = null,
  featureFlags = {},
  enabled = undefined,
  crypto = nodeCrypto,
  now = () => new Date(),
  schedule = (callback) => setImmediate(callback),
} = {}) {
  if (!index?.replace || !index?.upsert || !index?.overview) throw new TypeError("A derived memory index is required.");
  const jobs = new Map();
  const rootOf = (workspace) => resolvedWorkspace(require("node:path"), workspace);

  function isEnabled() { return enabled === undefined ? featureFlags.derivedMemoryViews === true : enabled === true; }
  function keyFor(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }

  async function loadSource(repository, workspace, projectId, supplied) {
    if (supplied !== undefined && supplied !== null) {
      if (supplied && typeof supplied === "object" && typeof supplied.ok === "boolean") return supplied;
      return { ok: true, initialized: true, revision: revisionOf(supplied), state: stateOf(supplied) };
    }
    if (!repository?.load) return { ok: true, initialized: false, revision: 0, state: {} };
    return repository.load(workspace, projectId);
  }

  async function loadArtifacts(workspace, projectId, supplied) {
    if (supplied !== undefined) return { ok: true, artifacts: array(supplied), sourceRevision: 0 };
    if (!artifactRegistry?.list) return { ok: true, artifacts: [], sourceRevision: 0 };
    const artifacts = [];
    let cursor = "";
    let sourceRevision = 0;
    for (let page = 0; page < 1_000; page += 1) {
      const result = await artifactRegistry.list(workspace, projectId, { limit: 200, cursor });
      if (!result?.ok) return result;
      artifacts.push(...array(result.artifacts || result.records));
      sourceRevision = Number(result.sourceRevision ?? result.revision ?? sourceRevision) || sourceRevision;
      const next = String(result.nextCursor || result.next_cursor || "");
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { ok: true, artifacts, sourceRevision };
  }

  async function collectCanonicalProjection({ workspace, projectId, sources = {} } = {}) {
    let id;
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_PROJECTION_INPUT_INVALID", error.message, error.details || {}); }
    if (!workspace) return operationFailure("MEMORY_DERIVED_PROJECTION_WORKSPACE_REQUIRED", "A workspace is required for derived projection.");
    const [projectResult, investigationResult, evidenceResult, artifactsResult] = await Promise.all([
      loadSource(projectRepository, workspace, id, sources.project),
      loadSource(investigationRepository, workspace, id, sources.investigation),
      loadSource(evidenceRepository, workspace, id, sources.evidence),
      loadArtifacts(workspace, id, sources.artifacts),
    ]);
    for (const result of [projectResult, investigationResult, evidenceResult, artifactsResult]) if (!result?.ok) return result;
    const projectState = stateOf(projectResult);
    const investigationState = stateOf(investigationResult);
    const evidenceState = stateOf(evidenceResult);
    const sourceRevisions = {
      project: revisionOf(projectResult),
      investigation: revisionOf(investigationResult),
      evidence: revisionOf(evidenceResult),
      artifact: Number(artifactsResult.sourceRevision || 0),
    };
    const records = [];
    const addCollection = (domain, state, collections, revision) => {
      for (const collection of collections) for (const [index, record] of array(state[collection]).entries()) records.push({ ...projectionRecord(domain, collection, { ...record, project_id: id }, revision, index, crypto), project_id: id });
    };
    addCollection("project", projectState, PROJECT_COLLECTIONS, sourceRevisions.project);
    addCollection("investigation", investigationState, INVESTIGATION_COLLECTIONS, sourceRevisions.investigation);
    addCollection("evidence", evidenceState, EVIDENCE_COLLECTIONS, sourceRevisions.evidence);
    for (const [index, artifact] of array(artifactsResult.artifacts).entries()) records.push({ ...projectionRecord("artifact", "artifacts", { ...artifact, project_id: id }, sourceRevisions.artifact, index, crypto), project_id: id });
    const edges = [
      ...projectRelationships(projectState, sourceRevisions.project),
      ...projectCrossMemoryEdges(investigationState, evidenceState, sourceRevisions),
    ].map((edge) => ({ ...edge, project_id: id }));
    const watermark = watermarkStore?.status ? (watermarkStore.status(workspace, id)?.watermark || null) : null;
    return { ok: true, project_id: id, records, edges, sourceRevisions, watermark, counts: { records: records.length, edges: edges.length }, captured_at: timestamp(now) };
  }

  async function updateManifest(workspace, projectId, result, sourceRevisions, status = "ready") {
    if (!manifestStore?.update || !result?.ok) return { ok: true, skipped: true };
    const updated = await manifestStore.update(workspace, projectId, (manifest) => {
      manifest.projections.sqlite = {
        ...(manifest.projections.sqlite || {}),
        revision: Number(result.projection_revision || result.projectionRevision || 0),
        source_revisions: clone(sourceRevisions || {}),
        updated_at: timestamp(now),
        status,
      };
      return manifest;
    }, { reason: "derived_sqlite_projection" });
    return updated;
  }

  async function rebuild(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const collected = await collectCanonicalProjection(input);
    if (!collected.ok) return collected;
    const result = index.replace(input.workspace, collected.project_id, { records: collected.records, edges: collected.edges, sourceRevisions: collected.sourceRevisions, watermark: collected.watermark });
    if (!result.ok) return result;
    const manifest = await updateManifest(input.workspace, collected.project_id, result, collected.sourceRevisions, "ready");
    const warnings = [...(result.warnings || [])];
    if (manifest?.ok === false) warnings.push({ code: manifest.code || "MEMORY_MANIFEST_UPDATE_FAILED", message: manifest.error || "The SQLite projection status could not be updated." });
    return { ...result, project_id: collected.project_id, sourceRevisions: collected.sourceRevisions, watermark: collected.watermark, warnings };
  }

  async function patch(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    let projectId;
    try { projectId = assertMemoryId(input.projectId || input.project_id, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_PROJECTION_INPUT_INVALID", error.message, error.details || {}); }
    const result = index.upsert(input.workspace, projectId, { records: array(input.records), edges: array(input.edges), sourceRevisions: input.sourceRevisions || input.source_revisions || {}, watermark: input.watermark || null });
    if (!result.ok) return result;
    const manifest = await updateManifest(input.workspace, projectId, result, input.sourceRevisions || input.source_revisions || {}, "ready");
    return { ...result, project_id: projectId, warnings: manifest?.ok === false ? [{ code: manifest.code, message: manifest.error }] : [] };
  }

  function scheduleRebuild(input = {}) {
    if (!isEnabled()) return Promise.resolve({ ok: true, enabled: false, skipped: true, changed: false });
    let projectId;
    try { projectId = assertMemoryId(input.projectId || input.project_id, "proj"); } catch (error) { return Promise.resolve(operationFailure(error.code || "MEMORY_DERIVED_PROJECTION_INPUT_INVALID", error.message, error.details || {})); }
    const key = keyFor(input.workspace, projectId);
    const previous = jobs.get(key) || Promise.resolve();
    const job = previous
      .catch(() => {})
      .then(() => new Promise((resolve) => {
        schedule(() => {
          rebuild({ ...input, projectId })
            .then(resolve)
            .catch((error) => resolve(operationFailure("MEMORY_DERIVED_PROJECTION_FAILED", error.message, {}, true)));
        });
      }))
      .finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
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
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_PROJECTION_INPUT_INVALID", error.message, error.details || {}); }
    return { ok: true, enabled: isEnabled(), project_id: id, status: jobs.has(keyFor(workspace, id)) ? "building" : "idle", pending: jobs.has(keyFor(workspace, id)) ? 1 : 0 };
  }

  return Object.freeze({
    DERIVED_MEMORY_PROJECTION_SERVICE_VERSION,
    enabled: isEnabled,
    collectCanonicalProjection,
    rebuild,
    patch,
    scheduleRebuild,
    whenIdle,
    status,
  });
}

module.exports = Object.freeze({
  DERIVED_MEMORY_PROJECTION_SERVICE_VERSION,
  createDerivedMemoryProjectionService,
  projectionRecord,
  projectRelationships,
  projectCrossMemoryEdges,
});
