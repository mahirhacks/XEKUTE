"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/memory-identity.js");
const {
  atomicWriteJson,
  clone,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const MANIFEST_SCHEMA_VERSION = 1;
const MEMORY_DOMAINS = Object.freeze(["project", "investigation", "evidence"]);
const EVENT_STREAMS = Object.freeze(["execution", "semantic"]);

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function createMemoryManifestStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory manifest store dependencies are required.");

  function workspaceRoot(workspace) { return resolvedWorkspace(path, workspace); }
  function memoryDirectory(workspace) { return path.join(workspaceRoot(workspace), ".xekute", "memory"); }
  function manifestFile(workspace) { return path.join(memoryDirectory(workspace), "manifest.json"); }
  function eventsDirectory(workspace) { return path.join(memoryDirectory(workspace), "events"); }
  function snapshotsDirectory(workspace) { return path.join(memoryDirectory(workspace), "snapshots"); }

  function emptyStream() {
    return { next_sequence: 1, total_events: 0, total_bytes: 0, segments: [] };
  }

  function emptyManifest(projectId) {
    const id = assertMemoryId(projectId, "proj");
    const stamp = timestamp(now);
    return {
      schema_version: MANIFEST_SCHEMA_VERSION,
      kind: "xekute-memory-manifest",
      project_id: id,
      created_at: stamp,
      updated_at: stamp,
      manifest_revision: 0,
      domain_revisions: Object.fromEntries(MEMORY_DOMAINS.map((domain) => [domain, 0])),
      event_streams: Object.fromEntries(EVENT_STREAMS.map((stream) => [stream, emptyStream()])),
      snapshots: Object.fromEntries(MEMORY_DOMAINS.map((domain) => [domain, {
        revision: 0,
        file: `snapshots/${domain}.json`,
        sha256: "",
        updated_at: "",
      }])),
      outbox: {
        pending_count: 0,
        last_sequence: 0,
        last_operation_id: "",
        failed_count: 0,
      },
      finalization: {
        latest_sealed_block_id: "",
        latest_sealed_event_range: null,
        latest_sealed_position: 0,
        latest_applied_block_id: "",
        latest_applied_position: 0,
        pending_count: 0,
        failed_operations: [],
        failure_state: null,
        sealed_operations: [],
        applied_operations: [],
        updated_at: stamp,
      },
      projections: {
        sqlite: { revision: 0, source_revisions: {}, updated_at: "", status: "not_built" },
        graph: { revision: 0, source_revisions: {}, updated_at: "", status: "not_built" },
      },
      knowledge_base_release: "",
    };
  }

  function normalizeSegment(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      segment_id: String(source.segment_id || "").trim().slice(0, 240),
      file: String(source.file || "").trim().slice(0, 500),
      first_sequence: nonNegativeInteger(source.first_sequence, 0),
      last_sequence: nonNegativeInteger(source.last_sequence, 0),
      event_count: nonNegativeInteger(source.event_count, 0),
      bytes: nonNegativeInteger(source.bytes, 0),
      sha256: String(source.sha256 || "").trim().slice(0, 128),
      closed_at: String(source.closed_at || "").trim().slice(0, 80),
    };
  }

  function normalizeManifest(value, projectId) {
    const base = emptyManifest(projectId);
    const source = value && typeof value === "object" ? value : {};
    const actualProjectId = String(source.project_id || source.projectId || projectId || "").trim();
    assertMemoryId(actualProjectId, "proj");
    assertMemoryId(projectId, "proj");
    if (actualProjectId !== projectId) {
      const error = new Error("The memory manifest belongs to a different project.");
      error.code = "MEMORY_PROJECT_MISMATCH";
      error.details = { expectedProjectId: projectId, actualProjectId };
      throw error;
    }
    const result = {
      ...base,
      ...clone(source),
      schema_version: MANIFEST_SCHEMA_VERSION,
      kind: "xekute-memory-manifest",
      project_id: projectId,
      manifest_revision: nonNegativeInteger(source.manifest_revision, 0),
      domain_revisions: { ...base.domain_revisions },
      event_streams: { ...base.event_streams },
      snapshots: { ...base.snapshots },
      outbox: { ...base.outbox },
      finalization: { ...base.finalization },
      projections: { ...base.projections },
    };
    for (const domain of MEMORY_DOMAINS) result.domain_revisions[domain] = nonNegativeInteger(source.domain_revisions?.[domain], 0);
    for (const stream of EVENT_STREAMS) {
      const input = source.event_streams?.[stream] && typeof source.event_streams[stream] === "object" ? source.event_streams[stream] : {};
      result.event_streams[stream] = {
        ...emptyStream(),
        ...clone(input),
        next_sequence: Math.max(1, nonNegativeInteger(input.next_sequence, 1)),
        total_events: nonNegativeInteger(input.total_events, 0),
        total_bytes: nonNegativeInteger(input.total_bytes, 0),
        segments: (Array.isArray(input.segments) ? input.segments : []).map(normalizeSegment).filter((segment) => segment.file).slice(-10_000),
      };
    }
    for (const domain of MEMORY_DOMAINS) {
      const input = source.snapshots?.[domain] && typeof source.snapshots[domain] === "object" ? source.snapshots[domain] : {};
      result.snapshots[domain] = {
        ...base.snapshots[domain],
        ...clone(input),
        revision: nonNegativeInteger(input.revision, 0),
        file: String(input.file || base.snapshots[domain].file).trim().slice(0, 500),
        sha256: String(input.sha256 || "").trim().slice(0, 128),
        updated_at: String(input.updated_at || "").trim().slice(0, 80),
      };
    }
    result.outbox = {
      ...base.outbox,
      ...(source.outbox && typeof source.outbox === "object" ? clone(source.outbox) : {}),
      pending_count: nonNegativeInteger(source.outbox?.pending_count, 0),
      last_sequence: nonNegativeInteger(source.outbox?.last_sequence, 0),
      last_operation_id: String(source.outbox?.last_operation_id || "").trim().slice(0, 240),
      failed_count: nonNegativeInteger(source.outbox?.failed_count, 0),
    };
    result.finalization = {
      ...base.finalization,
      ...(source.finalization && typeof source.finalization === "object" ? clone(source.finalization) : {}),
      latest_sealed_block_id: String(source.finalization?.latest_sealed_block_id || "").trim().slice(0, 240),
      latest_sealed_event_range: source.finalization?.latest_sealed_event_range && typeof source.finalization.latest_sealed_event_range === "object" ? clone(source.finalization.latest_sealed_event_range) : null,
      latest_sealed_position: nonNegativeInteger(source.finalization?.latest_sealed_position, 0),
      latest_applied_block_id: String(source.finalization?.latest_applied_block_id || "").trim().slice(0, 240),
      latest_applied_position: nonNegativeInteger(source.finalization?.latest_applied_position, 0),
      pending_count: nonNegativeInteger(source.finalization?.pending_count, 0),
      failed_operations: (Array.isArray(source.finalization?.failed_operations) ? source.finalization.failed_operations : []).map((entry) => String(entry || "").trim()).filter(Boolean).slice(-100),
      failure_state: source.finalization?.failure_state && typeof source.finalization.failure_state === "object" ? clone(source.finalization.failure_state) : null,
      sealed_operations: (Array.isArray(source.finalization?.sealed_operations) ? source.finalization.sealed_operations : []).filter((entry) => entry && typeof entry === "object").map((entry) => ({
        operation_id: String(entry.operation_id || "").trim().slice(0, 240),
        block_id: String(entry.block_id || "").trim().slice(0, 240),
        position: nonNegativeInteger(entry.position, 0),
        event_range_hash: String(entry.event_range_hash || "").trim().slice(0, 128),
        sealed_at: String(entry.sealed_at || "").trim().slice(0, 80),
      })).slice(-10_000),
      applied_operations: (Array.isArray(source.finalization?.applied_operations) ? source.finalization.applied_operations : []).filter((entry) => entry && typeof entry === "object").map((entry) => ({
        operation_id: String(entry.operation_id || "").trim().slice(0, 240),
        block_id: String(entry.block_id || "").trim().slice(0, 240),
        position: nonNegativeInteger(entry.position, 0),
        applied_at: String(entry.applied_at || "").trim().slice(0, 80),
      })).slice(-10_000),
      updated_at: String(source.finalization?.updated_at || "").trim().slice(0, 80),
    };
    for (const name of ["sqlite", "graph"]) {
      const input = source.projections?.[name] && typeof source.projections[name] === "object" ? source.projections[name] : {};
      result.projections[name] = {
        ...base.projections[name],
        ...clone(input),
        revision: nonNegativeInteger(input.revision, 0),
        source_revisions: input.source_revisions && typeof input.source_revisions === "object" ? clone(input.source_revisions) : {},
        updated_at: String(input.updated_at || "").trim().slice(0, 80),
        status: String(input.status || "not_built").trim().slice(0, 40),
      };
    }
    result.created_at = String(source.created_at || base.created_at).trim().slice(0, 80);
    result.updated_at = String(source.updated_at || base.updated_at).trim().slice(0, 80);
    result.knowledge_base_release = String(source.knowledge_base_release || "").trim().slice(0, 240);
    return result;
  }

  function read(rawWorkspace, projectId) {
    let workspace;
    try { workspace = workspaceRoot(rawWorkspace); assertMemoryId(projectId, "proj"); } catch (error) {
      return operationFailure(error.code || "MEMORY_MANIFEST_INPUT_INVALID", error.message, error.details || {});
    }
    const file = manifestFile(workspace);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_MANIFEST_CORRUPT", `The memory manifest could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: false, exists: false, recovered: false, manifest: emptyManifest(projectId), path: file, workspace };
    try {
      const manifest = normalizeManifest(loaded.value, projectId);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", manifest, path: file, workspace, sourcePath: loaded.sourcePath };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_MANIFEST_INVALID", `The memory manifest is invalid: ${error.message}.`, { path: file, ...(error.details || {}) }, false);
    }
  }

  function initialize(rawWorkspace, projectId, { reason = "semantic_write" } = {}) {
    let workspace;
    try { workspace = workspaceRoot(rawWorkspace); assertMemoryId(projectId, "proj"); } catch (error) {
      return operationFailure(error.code || "MEMORY_MANIFEST_INPUT_INVALID", error.message, error.details || {});
    }
    const current = read(workspace, projectId);
    if (!current.ok) return current;
    if (current.initialized) return { ...current, created: false };
    const manifest = emptyManifest(projectId);
    manifest.initialization_reason = String(reason || "semantic_write").trim().slice(0, 80);
    try {
      const written = atomicWriteJson({ fs, path, crypto }, manifestFile(workspace), manifest, {
        validate: (text) => normalizeManifest(JSON.parse(text), projectId),
      });
      return { ok: true, initialized: true, created: true, recovered: false, manifest, path: written.path, workspace };
    } catch (error) {
      return operationFailure("MEMORY_MANIFEST_WRITE_FAILED", `The memory manifest could not be initialized: ${error.message}.`, { path: manifestFile(workspace) }, true);
    }
  }

  function update(rawWorkspace, projectId, mutate, { reason = "semantic_write" } = {}) {
    if (typeof mutate !== "function") return Promise.resolve(operationFailure("MEMORY_MANIFEST_MUTATOR_REQUIRED", "A manifest update requires a mutator function."));
    const workspace = workspaceRoot(rawWorkspace);
    return Promise.resolve().then(() => {
      const initialized = initialize(workspace, projectId, { reason });
      if (!initialized.ok) return initialized;
      const current = read(workspace, projectId);
      if (!current.ok) return current;
      const before = current.manifest;
      const candidate = clone(before);
      const returned = mutate(candidate, clone(before));
      const next = returned && typeof returned === "object" ? returned : candidate;
      next.updated_at = timestamp(now);
      next.manifest_revision = nonNegativeInteger(before.manifest_revision, 0) + 1;
      let normalized;
      try { normalized = normalizeManifest(next, projectId); } catch (error) {
        return operationFailure(error.code || "MEMORY_MANIFEST_INVALID", `The updated memory manifest is invalid: ${error.message}.`, error.details || {});
      }
      try {
        const written = atomicWriteJson({ fs, path, crypto }, manifestFile(workspace), normalized, {
          validate: (text) => normalizeManifest(JSON.parse(text), projectId),
        });
        return { ok: true, initialized: true, created: Boolean(initialized.created), changed: true, manifest: normalized, path: written.path, previousRevision: before.manifest_revision, revision: normalized.manifest_revision };
      } catch (error) {
        return operationFailure("MEMORY_MANIFEST_WRITE_FAILED", `The memory manifest could not be updated: ${error.message}.`, { path: manifestFile(workspace) }, true);
      }
    });
  }

  function status(rawWorkspace, projectId) {
    const loaded = read(rawWorkspace, projectId);
    if (!loaded.ok) return loaded;
    const manifest = loaded.manifest;
    return {
      ok: true,
      initialized: loaded.initialized,
      exists: loaded.exists,
      recovered: Boolean(loaded.recovered),
      path: loaded.path,
      projectId,
      manifestRevision: manifest.manifest_revision,
      domainRevisions: clone(manifest.domain_revisions),
      finalization: clone(manifest.finalization),
      outbox: clone(manifest.outbox),
      projections: clone(manifest.projections),
      warning: loaded.warning || "",
    };
  }

  return Object.freeze({
    MANIFEST_SCHEMA_VERSION,
    MEMORY_DOMAINS,
    EVENT_STREAMS,
    memoryDirectory,
    manifestFile,
    eventsDirectory,
    snapshotsDirectory,
    emptyManifest,
    normalizeManifest,
    read,
    initialize,
    update,
    status,
  });
}

module.exports = Object.freeze({ createMemoryManifestStore, MANIFEST_SCHEMA_VERSION, MEMORY_DOMAINS, EVENT_STREAMS });
