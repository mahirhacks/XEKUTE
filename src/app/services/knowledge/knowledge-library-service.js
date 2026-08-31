"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

function createKnowledgeLibraryService({ store, kag, artifacts, projectIdentityStore, now = () => new Date() } = {}) {
  if (!store || !kag || !artifacts || !projectIdentityStore) throw new TypeError("Knowledge library dependencies are required.");

  function projectId(workspace) {
    const resolved = projectIdentityStore.resolveProject(workspace, { persist: false });
    return resolved?.project_id || resolved?.projectId || resolved?.id || "";
  }

  function artifactStates(workspace, id) {
    const snapshot = artifacts.inspect(workspace);
    if (!snapshot.ok) return snapshot;
    const entities = [];
    const claims = [];
    const stamp = now().toISOString();
    const sourceId = (value) => `artifact_${crypto.createHash("sha256").update(String(value || "artifact")).digest("hex").slice(0, 48)}`;
    const provenanceFor = (refs, capturedAt = stamp) => ({ source_type: "artifact", source_refs: [...new Set((refs || []).map(sourceId))].slice(0, 500), captured_at: capturedAt || stamp, redacted: true });
    const addEntity = ({ type, key, label, value, refs = [], updatedAt = stamp }) => {
      const digest = crypto.createHash("sha256").update(`${type}|${key}`).digest("hex").slice(0, 48);
      const recordId = `entity_${digest}`;
      entities.push({ record_id: recordId, entity_type: type, canonical_key: String(key || "artifact"), label: String(label || key || "artifact").slice(0, 500), aliases: [], attributes: { value: String(value || "").slice(0, 12_000) }, state: "active", confidence: 1, provenance: provenanceFor(refs, updatedAt) });
      claims.push({ record_id: `claim_${digest}`, subject_ref: recordId, predicate: "artifact_fact", value: String(value || "").slice(0, 12_000), epistemic_state: "user_asserted", confidence: 1, provenance: provenanceFor(refs, updatedAt) });
    };
    for (const [section, entries] of Object.entries(snapshot.project.documents || {})) {
      for (const entry of entries) {
        addEntity({ type: section, key: `${section}:${entry.key}`, label: entry.key, value: entry.value, refs: entry.source_refs, updatedAt: entry.observed_at || entry.updated_at });
      }
    }
    for (const hypothesis of snapshot.hypotheses) addEntity({ type: "hypothesis", key: hypothesis.id, label: hypothesis.title, value: JSON.stringify(hypothesis), refs: hypothesis.evidence_refs, updatedAt: hypothesis.updated_at });
    for (const item of snapshot.checklist) addEntity({ type: "investigation_checklist", key: item.id, label: item.title, value: JSON.stringify(item), refs: [...(item.tool_refs || []), ...(item.evidence_refs || [])], updatedAt: item.updated_at });
    for (const evidence of snapshot.evidence) addEntity({ type: "evidence", key: evidence.id, label: evidence.title, value: JSON.stringify({ status: evidence.status, confidence: evidence.confidence, summary: evidence.summary, impact: evidence.impact }), refs: evidence.source_refs, updatedAt: evidence.updated_at });
    const coverageFingerprint = crypto.createHash("sha256").update(JSON.stringify(snapshot.revisions)).digest("hex");
    return {
      ok: true,
      projectState: { schema_version: 3, kind: "xekute-project-memory-v3", project_id: id, revision: 0, updated_at: stamp, authority_binding: null, entities, relationships: [], claims, conflicts: [], coverage_fingerprint: coverageFingerprint, source_revisions: {}, extensions: { source: "project-artifacts" } },
      investigationState: { schema_version: 3, kind: "xekute-investigation-memory-v3", project_id: id, revision: 0, updated_at: stamp, procedures: [], coverage: [], attempts: [], assignments: [], candidates: [], blockers: [], source_revisions: {}, kag: { project_revision: 0, release_hashes: [], scoring_version: "artifact-derived", solver_model: "none", solver_state: "ready" }, extensions: { source: "project-artifacts", active_hypothesis_count: snapshot.hypotheses.filter((item) => item.status !== "closed").length, checklist_count: snapshot.checklist.length } },
      evidenceState: { schema_version: 3, kind: "xekute-evidence-memory-v3", project_id: id, revision: 0, updated_at: stamp, findings: snapshot.evidence.filter((item) => item.status === "verified").slice(0, 200).map((item) => ({ id: item.id, status: item.status, severity: item.severity })), events: [], source_revisions: {}, extensions: { source: "project-artifacts", verified_evidence_count: snapshot.evidence.filter((item) => item.status === "verified").length } },
      snapshot,
    };
  }

  async function query({ workspace = "", query = "", skill = "", phase = "", limit = 10, offset = 0 } = {}) {
    const id = projectId(workspace);
    if (!id) return { ok: false, code: "KNOWLEDGE_PROJECT_ID_UNAVAILABLE", error: "Project identity is unavailable." };
    const states = artifactStates(workspace, id);
    if (!states.ok) return states;
    const combinedQuery = [query, skill, phase].filter(Boolean).join(" ").slice(0, 4_000);
    const result = await kag.retrieve(id, combinedQuery, { limit: Math.min(200, Math.max(1, Number(limit) + Number(offset))), projectState: states.projectState, investigationState: states.investigationState, evidenceState: states.evidenceState });
    if (!result?.ok) return result;
    return { ...result, records: (result.records || []).slice(Number(offset) || 0, (Number(offset) || 0) + Math.max(1, Number(limit) || 10)), source: "tier3-artifact-query" };
  }

  function status(workspace = "") {
    const id = projectId(workspace);
    const listed = store.list?.() || { ok: true, releases: [] };
    if (!listed.ok) return listed;
    const health = id ? kag.health(id) : { ok: true, status: "not_built", model: "none", chunkCount: 0, vectorCount: 0, recordCount: 0, releaseCount: listed.releases.length };
    return { ok: true, releases: listed.releases || [], health, model: health.model || "none" };
  }

  function remove(releaseId = "") {
    const loaded = store.get(releaseId);
    if (!loaded.ok) return loaded;
    const userFile = store.releaseFile(releaseId);
    if (!fs.existsSync(userFile)) return { ok: false, code: "KNOWLEDGE_BUNDLED_RELEASE_PROTECTED", error: "Bundled knowledge releases cannot be removed." };
    try { fs.unlinkSync(userFile); return { ok: true, removed: true, release_id: releaseId }; }
    catch (error) { return { ok: false, code: "KNOWLEDGE_REMOVE_FAILED", error: error.message }; }
  }

  function reindex(workspace = "") {
    const id = projectId(workspace);
    if (!id) return { ok: false, code: "KNOWLEDGE_PROJECT_ID_UNAVAILABLE", error: "Project identity is unavailable." };
    const states = artifactStates(workspace, id);
    if (!states.ok) return states;
    return kag.rebuildProjectIndex(id, states.projectState, states.investigationState, states.evidenceState);
  }

  return Object.freeze({ query, status, previewInstall: store.previewInstall, install: store.install, remove, reindex, list: store.list, get: store.get, artifactStates });
}

module.exports = { createKnowledgeLibraryService };
