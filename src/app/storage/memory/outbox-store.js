"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, createOpaqueId, MEMORY_TYPES } = require("../../../contracts/memory/index.js");
const { createMemoryManifestStore } = require("./memory-manifest-store.js");
const {
  atomicWriteJson,
  assertNoSecretKeys,
  clone,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const OUTBOX_SCHEMA_VERSION = 1;
const OUTBOX_STATES = Object.freeze(["pending", "processing", "completed", "failed", "cancelled", "interrupted"]);

function createMemoryOutboxStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  manifestStore = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory outbox store dependencies are required.");
  const manifests = manifestStore || createMemoryManifestStore({ fs, path, crypto, now });
  const queues = new Map();

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function outboxFile(workspace) { return path.join(manifests.memoryDirectory(workspace), "outbox.json"); }
  function validState(state) {
    const value = String(state || "pending").trim().toLowerCase();
    if (!OUTBOX_STATES.includes(value)) throw Object.assign(new Error("The outbox state is unsupported."), { code: "MEMORY_OUTBOX_STATE_INVALID" });
    return value;
  }
  function normalizeEntry(input = {}, projectId) {
    const entryId = String(input.entry_id || input.entryId || "").trim() || createOpaqueId("event", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
    assertMemoryId(entryId, "event");
    const operationId = assertMemoryId(input.operation_id || input.operationId, "op");
    const actualProjectId = assertMemoryId(input.project_id || input.projectId || projectId, "proj");
    if (projectId && actualProjectId !== projectId) throw Object.assign(new Error("The outbox entry belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    const sourceMemory = String(input.source_memory || input.sourceMemory || "").trim().toLowerCase();
    const destinationMemory = String(input.destination_memory || input.destinationMemory || "").trim().toLowerCase();
    if (!MEMORY_TYPES.includes(sourceMemory) || !MEMORY_TYPES.includes(destinationMemory)) throw Object.assign(new Error("Outbox source and destination memory domains are invalid."), { code: "MEMORY_OUTBOX_DOMAIN_INVALID" });
    const sourceRevision = Number(input.source_revision ?? input.sourceRevision ?? 0);
    if (!Number.isInteger(sourceRevision) || sourceRevision < 0) throw Object.assign(new Error("The outbox source revision is invalid."), { code: "MEMORY_REVISION_INVALID" });
    const state = validState(input.state);
    const createdAt = String(input.created_at || input.createdAt || timestamp(now)).trim();
    const updatedAt = String(input.updated_at || input.updatedAt || createdAt).trim();
    if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) throw Object.assign(new Error("Outbox timestamps are invalid."), { code: "MEMORY_TIMESTAMP_INVALID" });
    const result = {
      schema_version: OUTBOX_SCHEMA_VERSION,
      entry_id: entryId,
      operation_id: operationId,
      project_id: actualProjectId,
      source_memory: sourceMemory,
      source_revision: sourceRevision,
      destination_memory: destinationMemory,
      destination_mutation: input.destination_mutation && typeof input.destination_mutation === "object" ? clone(input.destination_mutation) : (input.destinationMutation && typeof input.destinationMutation === "object" ? clone(input.destinationMutation) : {}),
      state,
      attempts: Math.max(0, Number(input.attempts) || 0),
      claimed_by: String(input.claimed_by || input.claimedBy || "").trim().slice(0, 240),
      lease_expires_at: input.lease_expires_at || input.leaseExpiresAt ? String(input.lease_expires_at || input.leaseExpiresAt).trim().slice(0, 80) : "",
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(updatedAt).toISOString(),
      completed_at: input.completed_at || input.completedAt ? String(input.completed_at || input.completedAt).trim().slice(0, 80) : "",
      error: input.error && typeof input.error === "object" ? clone(input.error) : null,
      result: input.result && typeof input.result === "object" ? clone(input.result) : {},
    };
    assertNoSecretKeys(result);
    return result;
  }

  function emptyOutbox(projectId) { return { schema_version: OUTBOX_SCHEMA_VERSION, kind: "xekute-memory-outbox", project_id: assertMemoryId(projectId, "proj"), revision: 0, created_at: timestamp(now), updated_at: timestamp(now), entries: [] }; }

  function normalizeOutbox(value, projectId) {
    const source = value && typeof value === "object" ? value : {};
    const actualProjectId = assertMemoryId(source.project_id || projectId, "proj");
    if (actualProjectId !== projectId) throw Object.assign(new Error("The outbox belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    return {
      schema_version: OUTBOX_SCHEMA_VERSION,
      kind: "xekute-memory-outbox",
      project_id: projectId,
      revision: Number.isInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
      created_at: String(source.created_at || timestamp(now)).trim().slice(0, 80),
      updated_at: String(source.updated_at || timestamp(now)).trim().slice(0, 80),
      entries: (Array.isArray(source.entries) ? source.entries : []).map((entry) => normalizeEntry(entry, projectId)),
    };
  }

  function read(workspace, projectId) {
    let root;
    try { root = rootOf(workspace); assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INPUT_INVALID", error.message, error.details || {}); }
    const file = outboxFile(root);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_OUTBOX_CORRUPT", `The memory outbox could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: false, exists: false, recovered: false, outbox: emptyOutbox(projectId), path: file };
    try {
      const outbox = normalizeOutbox(loaded.value, projectId);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", outbox, path: file, sourcePath: loaded.sourcePath };
    } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INVALID", `The memory outbox is invalid: ${error.message}.`, { path: file, ...(error.details || {}) }); }
  }

  function persist(workspace, outbox) {
    const root = rootOf(workspace);
    let normalized;
    try { normalized = normalizeOutbox(outbox, outbox.project_id); } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INVALID", error.message, error.details || {}); }
    try {
      const written = atomicWriteJson({ fs, path, crypto }, outboxFile(root), normalized, { validate: (text) => normalizeOutbox(JSON.parse(text), normalized.project_id) });
      return { ok: true, path: written.path, outbox: normalized };
    } catch (error) { return operationFailure("MEMORY_OUTBOX_WRITE_FAILED", `The memory outbox could not be written: ${error.message}.`, { path: outboxFile(root) }, true); }
  }

  async function syncManifest(root, projectId, outbox) {
    const pendingCount = outbox.entries.filter((entry) => ["pending", "processing", "interrupted"].includes(entry.state)).length;
    const failedCount = outbox.entries.filter((entry) => entry.state === "failed").length;
    const updated = await manifests.update(root, projectId, (manifest) => {
      manifest.outbox.pending_count = pendingCount;
      manifest.outbox.failed_count = failedCount;
      manifest.outbox.last_sequence = outbox.revision;
      manifest.outbox.last_operation_id = outbox.entries.at(-1)?.operation_id || manifest.outbox.last_operation_id || "";
      return manifest;
    }, { reason: "outbox_update" });
    return updated;
  }

  function queueKey(workspace) { return rootOf(workspace); }
  function enqueue(workspace, operation) {
    const key = queueKey(workspace);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function findEntry(outbox, entryId) { return outbox.entries.findIndex((entry) => entry.entry_id === entryId); }

  function transitionAllowed(previous, next) {
    if (previous === next) return true;
    const allowed = {
      pending: new Set(["processing", "cancelled", "failed"]),
      processing: new Set(["completed", "failed", "interrupted", "cancelled"]),
      interrupted: new Set(["pending", "processing", "cancelled"]),
      failed: new Set(["pending", "cancelled"]),
      completed: new Set(),
      cancelled: new Set(),
    };
    return Boolean(allowed[previous]?.has(next));
  }

  function enqueueEntry(workspace, projectId, input = {}) {
    return enqueue(workspace, async () => {
      let entry;
      try { entry = normalizeEntry(input, projectId); } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INPUT_INVALID", error.message, error.details || {}); }
      const initialized = manifests.initialize(rootOf(workspace), projectId, { reason: "outbox_enqueue" });
      if (!initialized.ok) return initialized;
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      const outbox = loaded.outbox;
      const sameOperation = outbox.entries.filter((candidate) => candidate.operation_id === entry.operation_id && candidate.destination_memory === entry.destination_memory);
      if (sameOperation.length) {
        const prior = sameOperation[0];
        if (canonicalJson(prior.destination_mutation) !== canonicalJson(entry.destination_mutation) || prior.source_memory !== entry.source_memory || prior.source_revision !== entry.source_revision) return operationFailure("MEMORY_OUTBOX_IDEMPOTENCY_CONFLICT", "The operation already has a different destination mutation.", { operationId: entry.operation_id, destinationMemory: entry.destination_memory });
        return { ok: true, changed: false, duplicate: true, entry: clone(prior), revision: outbox.revision, path: outboxFile(rootOf(workspace)) };
      }
      outbox.entries.push(entry);
      outbox.revision += 1;
      outbox.updated_at = timestamp(now);
      const saved = persist(workspace, outbox);
      if (!saved.ok) return saved;
      const manifest = await syncManifest(rootOf(workspace), projectId, outbox);
      if (!manifest.ok) return operationFailure("MEMORY_OUTBOX_MANIFEST_SYNC_FAILED", manifest.error || "The outbox was saved but its manifest could not be updated.", { operationId: entry.operation_id }, true);
      return { ok: true, changed: true, duplicate: false, entry: clone(entry), previousRevision: outbox.revision - 1, revision: outbox.revision, operationId: entry.operation_id, path: saved.path };
    });
  }

  function transition(workspace, projectId, entryId, state, patch = {}) {
    return enqueue(workspace, async () => {
      let nextState;
      try { assertMemoryId(projectId, "proj"); assertMemoryId(entryId, "event"); nextState = validState(state); } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INPUT_INVALID", error.message, error.details || {}); }
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      const index = findEntry(loaded.outbox, entryId);
      if (index < 0) return operationFailure("MEMORY_OUTBOX_NOT_FOUND", "The outbox entry was not found.", { entryId });
      const current = loaded.outbox.entries[index];
      if (!transitionAllowed(current.state, nextState)) return operationFailure("MEMORY_OUTBOX_TRANSITION_INVALID", "The outbox entry cannot make that lifecycle transition.", { entryId, from: current.state, to: nextState });
      let next;
      try { next = normalizeEntry({ ...current, ...patch, state: nextState, updated_at: timestamp(now), attempts: nextState === "processing" ? current.attempts + 1 : current.attempts, completed_at: nextState === "completed" ? timestamp(now) : current.completed_at }, projectId); } catch (error) { return operationFailure(error.code || "MEMORY_OUTBOX_INVALID", error.message, error.details || {}); }
      loaded.outbox.entries[index] = next;
      loaded.outbox.revision += 1;
      loaded.outbox.updated_at = timestamp(now);
      const saved = persist(workspace, loaded.outbox);
      if (!saved.ok) return saved;
      const manifest = await syncManifest(rootOf(workspace), projectId, loaded.outbox);
      if (!manifest.ok) return operationFailure("MEMORY_OUTBOX_MANIFEST_SYNC_FAILED", manifest.error || "The outbox status was saved but the manifest could not be updated.", { entryId }, true);
      return { ok: true, changed: true, entry: clone(next), previousState: current.state, state: nextState, revision: loaded.outbox.revision };
    });
  }

  function list(workspace, projectId, { states = [], destinationMemory = "", limit = 50 } = {}) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const wanted = new Set((Array.isArray(states) ? states : []).map((state) => String(state).trim().toLowerCase()).filter((state) => OUTBOX_STATES.includes(state)));
    const bounded = Math.min(200, Math.max(1, Number(limit) || 50));
    const entries = loaded.outbox.entries.filter((entry) => (!wanted.size || wanted.has(entry.state)) && (!destinationMemory || entry.destination_memory === destinationMemory)).slice(0, bounded).map(clone);
    return { ok: true, initialized: loaded.initialized, entries, total: loaded.outbox.entries.length, pendingCount: loaded.outbox.entries.filter((entry) => ["pending", "processing", "interrupted"].includes(entry.state)).length, revision: loaded.outbox.revision, warnings: loaded.warning ? [{ code: "MEMORY_OUTBOX_RECOVERED", message: loaded.warning }] : [] };
  }

  function get(workspace, projectId, entryId) {
    try { assertMemoryId(entryId, "event"); } catch (error) { return operationFailure(error.code, error.message, error.details || {}); }
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const entry = loaded.outbox.entries.find((candidate) => candidate.entry_id === entryId);
    if (!entry) return operationFailure("MEMORY_OUTBOX_NOT_FOUND", "The outbox entry was not found.", { entryId });
    return { ok: true, entry: clone(entry), revision: loaded.outbox.revision };
  }

  function recover(workspace, projectId) {
    return enqueue(workspace, async () => {
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      const recovered = [];
      for (const entry of loaded.outbox.entries) {
        if (!["processing", "interrupted"].includes(entry.state)) continue;
        entry.state = "pending";
        entry.claimed_by = "";
        entry.lease_expires_at = "";
        entry.updated_at = timestamp(now);
        entry.error = { code: "MEMORY_OUTBOX_RECOVERED", message: "Recovered after process interruption.", retryable: true };
        recovered.push(entry.entry_id);
      }
      if (!recovered.length) return { ok: true, changed: false, recovered: [], revision: loaded.outbox.revision };
      loaded.outbox.revision += 1;
      loaded.outbox.updated_at = timestamp(now);
      const saved = persist(workspace, loaded.outbox);
      if (!saved.ok) return saved;
      const manifest = await syncManifest(rootOf(workspace), projectId, loaded.outbox);
      if (!manifest.ok) return operationFailure("MEMORY_OUTBOX_MANIFEST_SYNC_FAILED", manifest.error || "The outbox was recovered but its manifest could not be updated.", {}, true);
      return { ok: true, changed: true, recovered, revision: loaded.outbox.revision };
    });
  }

  return Object.freeze({
    OUTBOX_SCHEMA_VERSION,
    OUTBOX_STATES,
    outboxFile,
    emptyOutbox,
    normalizeEntry,
    normalizeOutbox,
    read,
    enqueue: enqueueEntry,
    transition,
    list,
    get,
    recover,
  });
}

module.exports = Object.freeze({ createMemoryOutboxStore, OUTBOX_SCHEMA_VERSION, OUTBOX_STATES });
