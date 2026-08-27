"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const { createMemoryManifestStore, MEMORY_DOMAINS } = require("./memory-manifest-store.js");
const {
  atomicWriteJson,
  assertNoSecretKeys,
  clone,
  fileSha256,
  hashText,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_KIND = "xekute-memory-snapshot";

function createMemorySnapshotStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  manifestStore = null,
  now = () => new Date(),
  maxSnapshotBytes = MAX_SNAPSHOT_BYTES,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory snapshot store dependencies are required.");
  const manifests = manifestStore || createMemoryManifestStore({ fs, path, crypto, now });

  function workspaceRoot(workspace) { return resolvedWorkspace(path, workspace); }
  function domainName(domain) {
    const value = String(domain || "").trim().toLowerCase();
    if (!MEMORY_DOMAINS.includes(value)) throw Object.assign(new Error("The memory snapshot domain is unsupported."), { code: "MEMORY_SNAPSHOT_DOMAIN_INVALID" });
    return value;
  }
  function snapshotFile(workspace, domain) { return path.join(manifests.snapshotsDirectory(workspace), `${domainName(domain)}.json`); }
  function backupFile(workspace, domain) { return `${snapshotFile(workspace, domain)}.bak`; }
  function emptyState(domain) { return domainName(domain) === "project" ? { records: [], entities: [], claims: [], relationships: [] } : { records: [] }; }

  function validateEnvelope(value, projectId, domain) {
    assertMemoryId(projectId, "proj");
    const actualProjectId = String(value?.project_id || "").trim();
    if (actualProjectId !== projectId) throw Object.assign(new Error("The snapshot belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    if (String(value?.memory_type || "") !== domain) throw Object.assign(new Error("The snapshot domain does not match its requested memory domain."), { code: "MEMORY_SNAPSHOT_DOMAIN_INVALID", details: { expectedDomain: domain, actualDomain: value?.memory_type || "" } });
    const revision = Number(value?.revision);
    if (!Number.isInteger(revision) || revision < 0) throw Object.assign(new Error("The snapshot revision is invalid."), { code: "MEMORY_REVISION_INVALID" });
    assertNoSecretKeys(value);
    return true;
  }

  function contentHash(projectId, domain, revision, state) {
    return hashText(crypto, canonicalJson({ project_id: projectId, memory_type: domain, revision, state }));
  }

  function normalizeSnapshot(value, projectId, domain) {
    const normalizedDomain = domainName(domain);
    const source = value && typeof value === "object" ? value : {};
    const revision = Number(source.revision || 0);
    const state = source.state && typeof source.state === "object" ? source.state : source;
    const result = {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      kind: SNAPSHOT_KIND,
      memory_type: normalizedDomain,
      project_id: assertMemoryId(projectId, "proj"),
      revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      created_at: String(source.created_at || timestamp(now)).trim().slice(0, 80),
      updated_at: String(source.updated_at || timestamp(now)).trim().slice(0, 80),
      state: clone(state),
    };
    validateEnvelope(result, projectId, normalizedDomain);
    const serialized = JSON.stringify(result);
    if (Buffer.byteLength(serialized, "utf8") > maxSnapshotBytes) throw Object.assign(new Error(`The memory snapshot exceeds the ${maxSnapshotBytes}-byte limit.`), { code: "MEMORY_SNAPSHOT_TOO_LARGE", details: { maximumBytes: maxSnapshotBytes } });
    result.content_hash = contentHash(projectId, normalizedDomain, result.revision, result.state);
    return result;
  }

  function read(workspace, projectId, domain) {
    let root;
    let normalizedDomain;
    try {
      root = workspaceRoot(workspace);
      assertMemoryId(projectId, "proj");
      normalizedDomain = domainName(domain);
    } catch (error) {
      return operationFailure(error.code || "MEMORY_SNAPSHOT_INPUT_INVALID", error.message, error.details || {});
    }
    const manifest = manifests.read(root, projectId);
    if (!manifest.ok) return manifest;
    const file = snapshotFile(root, normalizedDomain);
    if (!manifest.initialized && !fs.existsSync(file)) return { ok: true, initialized: false, exists: false, recovered: false, snapshot: normalizeSnapshot({ state: emptyState(normalizedDomain), revision: 0 }, projectId, normalizedDomain), path: file };
    const loaded = readJsonWithBackup({ fs }, file, { validate: (value) => validateEnvelope(value, projectId, normalizedDomain) });
    if (!loaded.ok) return operationFailure("MEMORY_SNAPSHOT_CORRUPT", `The ${normalizedDomain} snapshot could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: Boolean(manifest.initialized), exists: false, recovered: false, snapshot: normalizeSnapshot({ state: emptyState(normalizedDomain), revision: 0 }, projectId, normalizedDomain), path: file, warning: "The manifest has no materialized snapshot for this domain." };
    try {
      const snapshot = normalizeSnapshot(loaded.value, projectId, normalizedDomain);
      const expectedHash = contentHash(projectId, normalizedDomain, snapshot.revision, snapshot.state);
      if (snapshot.content_hash && snapshot.content_hash !== expectedHash) return operationFailure("MEMORY_SNAPSHOT_HASH_MISMATCH", "The snapshot content hash does not match its state.", { path: file, expectedHash, actualHash: snapshot.content_hash }, true);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", snapshot, state: clone(snapshot.state), path: file, sourcePath: loaded.sourcePath, sha256: fileSha256({ fs, crypto }, loaded.sourcePath || file) };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_SNAPSHOT_INVALID", `The ${normalizedDomain} snapshot is invalid: ${error.message}.`, { path: file, ...(error.details || {}) });
    }
  }

  function write(workspace, projectId, domain, input, { revision = null, expectedBaseRevision = null, backup = true, allowCorruptReplace = false } = {}) {
    let root;
    let normalizedDomain;
    try { root = workspaceRoot(workspace); assertMemoryId(projectId, "proj"); normalizedDomain = domainName(domain); } catch (error) { return operationFailure(error.code || "MEMORY_SNAPSHOT_INPUT_INVALID", error.message, error.details || {}); }
    const initialized = manifests.initialize(root, projectId, { reason: "snapshot_write" });
    if (!initialized.ok) return initialized;
    let current = read(root, projectId, normalizedDomain);
    if (!current.ok) {
      if (!allowCorruptReplace) return current;
      current = { ok: true, exists: false, snapshot: normalizeSnapshot({ state: emptyState(normalizedDomain), revision: 0 }, projectId, normalizedDomain) };
    }
    const currentRevision = Number(current.snapshot?.revision || 0);
    const nextRevision = revision == null ? currentRevision : Number(revision);
    if (!Number.isInteger(nextRevision) || nextRevision < currentRevision) return operationFailure("MEMORY_REVISION_CONFLICT", "A snapshot cannot move backwards in revision.", { currentRevision, requestedRevision: nextRevision });
    if (expectedBaseRevision !== null && Number(expectedBaseRevision) !== currentRevision) return operationFailure("MEMORY_REVISION_CONFLICT", "The snapshot base revision is stale.", { currentRevision, expectedBaseRevision: Number(expectedBaseRevision) }, true);
    let snapshot;
    try {
      snapshot = normalizeSnapshot({
        ...(input && typeof input === "object" ? clone(input) : { state: input }),
        state: input?.state && typeof input.state === "object" ? input.state : (input && typeof input === "object" ? input : {}),
        revision: nextRevision,
      }, projectId, normalizedDomain);
    } catch (error) {
      return operationFailure(error.code || "MEMORY_SNAPSHOT_INVALID", error.message, error.details || {});
    }
    const previousHash = current.snapshot?.content_hash || (current.exists ? contentHash(projectId, normalizedDomain, currentRevision, current.snapshot?.state) : "");
    if (current.exists && previousHash === snapshot.content_hash) return { ok: true, changed: false, previousRevision: currentRevision, revision: currentRevision, snapshot: current.snapshot, path: snapshotFile(root, normalizedDomain), manifestRevision: manifests.read(root, projectId).manifest.manifest_revision };
    const file = snapshotFile(root, normalizedDomain);
    try {
      atomicWriteJson({ fs, path, crypto }, file, snapshot, {
        backup,
        validate: (text) => validateEnvelope(JSON.parse(text), projectId, normalizedDomain),
      });
    } catch (error) {
      return operationFailure("MEMORY_SNAPSHOT_WRITE_FAILED", `The ${normalizedDomain} snapshot could not be written: ${error.message}.`, { path: file }, true);
    }
    const updatedManifest = manifests.update(root, projectId, (manifest) => {
      manifest.domain_revisions[normalizedDomain] = nextRevision;
      manifest.snapshots[normalizedDomain] = {
        revision: nextRevision,
        file: `snapshots/${normalizedDomain}.json`,
        sha256: fileSha256({ fs, crypto }, file),
        updated_at: snapshot.updated_at,
      };
      return manifest;
    }, { reason: "snapshot_write" });
    // Manifest updates are synchronous in the current manifest store. Keep
    // this defensive branch so a future async adapter still returns a clear
    // failure rather than silently exposing an unreferenced snapshot.
    if (updatedManifest && typeof updatedManifest.then === "function") return updatedManifest.then((result) => result.ok ? { ok: true, changed: true, previousRevision: currentRevision, revision: nextRevision, snapshot, path: file, manifestRevision: result.manifest.manifest_revision } : result);
    if (!updatedManifest.ok) return updatedManifest;
    return { ok: true, changed: true, previousRevision: currentRevision, revision: nextRevision, snapshot, path: file, manifestRevision: updatedManifest.manifest.manifest_revision };
  }

  function rebuild(workspace, projectId, domain, events, { initialState = null, reducer } = {}) {
    if (typeof reducer !== "function") return operationFailure("MEMORY_SNAPSHOT_REDUCER_REQUIRED", "Snapshot rebuild requires a reducer function.");
    const normalizedDomain = domainName(domain);
    let state = clone(initialState == null ? emptyState(normalizedDomain) : initialState);
    for (const event of Array.isArray(events) ? events : []) state = reducer(state, clone(event));
    const current = read(workspace, projectId, normalizedDomain);
    if (!current.ok) return current;
    const revision = (Array.isArray(events) ? events.length : 0) ? Math.max(Number(current.snapshot?.revision || 0), Number(events.at(-1)?.revision || events.length)) : Number(current.snapshot?.revision || 0);
    return write(workspace, projectId, normalizedDomain, { state }, { revision });
  }

  return Object.freeze({
    SNAPSHOT_SCHEMA_VERSION,
    MAX_SNAPSHOT_BYTES: maxSnapshotBytes,
    snapshotFile,
    backupFile,
    emptyState,
    normalizeSnapshot,
    read,
    write,
    rebuild,
  });
}

module.exports = Object.freeze({ createMemorySnapshotStore, SNAPSHOT_SCHEMA_VERSION, MAX_SNAPSHOT_BYTES });
