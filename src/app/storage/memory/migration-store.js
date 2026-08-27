"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { createMigrationBatch, createMigrationRollback, MIGRATION_CONTRACT_VERSION } = require("../../../contracts/memory/migration-contracts.js");
const { atomicWriteJson, clone, operationFailure, readJsonWithBackup, resolvedWorkspace } = require("./memory-storage-utils.js");

const MIGRATION_STORE_VERSION = 1;

function createMigrationStore({ fs = nodeFs, path = nodePath, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Migration store dependencies are required.");
  const queues = new Map();

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function directory(workspace) { return path.join(rootOf(workspace), ".xekute", "memory", "migrations"); }
  function stateFile(workspace) { return path.join(directory(workspace), "state.json"); }
  function stamp() { return new Date(now()).toISOString(); }
  function key(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }
  function enqueue(workspace, projectId, operation) {
    const queueKey = key(workspace, projectId);
    const previous = queues.get(queueKey) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const pending = next.finally(() => { if (queues.get(queueKey) === pending) queues.delete(queueKey); });
    queues.set(queueKey, pending);
    return pending;
  }

  function empty(projectId) {
    return {
      schema_version: MIGRATION_STORE_VERSION,
      contract_version: MIGRATION_CONTRACT_VERSION,
      kind: "xekute-memory-migration-store",
      project_id: projectId,
      revision: 0,
      created_at: stamp(),
      updated_at: stamp(),
      batches: [],
      rollbacks: [],
    };
  }

  function normalize(value, projectId) {
    const source = value && typeof value === "object" ? value : {};
    const actual = String(source.project_id || source.projectId || projectId || "");
    if (actual !== projectId) throw Object.assign(new Error("The migration store belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId: actual } });
    const batches = (Array.isArray(source.batches) ? source.batches : []).map((entry) => {
      try { return createMigrationBatch(entry); } catch { return null; }
    }).filter(Boolean);
    const rollbacks = (Array.isArray(source.rollbacks) ? source.rollbacks : []).map((entry) => {
      try { return createMigrationRollback(entry); } catch { return null; }
    }).filter(Boolean);
    return {
      schema_version: MIGRATION_STORE_VERSION,
      contract_version: MIGRATION_CONTRACT_VERSION,
      kind: "xekute-memory-migration-store",
      project_id: projectId,
      revision: Number.isSafeInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
      created_at: String(source.created_at || stamp()),
      updated_at: String(source.updated_at || stamp()),
      batches,
      rollbacks,
    };
  }

  function read(workspace, projectId) {
    let root;
    try { root = rootOf(workspace); } catch (error) { return operationFailure("MEMORY_MIGRATION_WORKSPACE_REQUIRED", error.message); }
    const file = stateFile(root);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_MIGRATION_STORE_CORRUPT", `The migration state could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: false, exists: false, recovered: false, state: empty(projectId), path: file };
    try {
      const state = normalize(loaded.value, projectId);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", state, path: file, sourcePath: loaded.sourcePath };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_MIGRATION_STORE_INVALID", error.message, { path: file, ...(error.details || {}) });
    }
  }

  function persist(workspace, state) {
    const file = stateFile(workspace);
    try {
      const written = atomicWriteJson({ fs, path, crypto }, file, normalize(state, state.project_id), {
        validate: (value) => normalize(JSON.parse(value), state.project_id),
      });
      return { ok: true, path: written.path, state: normalize(state, state.project_id) };
    } catch (error) {
      return operationFailure("MEMORY_MIGRATION_STORE_WRITE_FAILED", `The migration state could not be written: ${error.message}.`, { path: file }, true);
    }
  }

  function get(workspace, projectId, operationId) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const id = String(operationId || "");
    const batch = loaded.state.batches.find((entry) => entry.operation_id === id);
    if (!batch) return operationFailure("MEMORY_MIGRATION_BATCH_NOT_FOUND", "The migration batch was not found.", { operationId: id });
    return { ok: true, batch: clone(batch), stateRevision: loaded.state.revision, warning: loaded.warning || "" };
  }

  function list(workspace, projectId, { limit = 50, cursor = "" } = {}) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const maximum = Math.min(200, Math.max(1, Number(limit) || 50));
    const items = loaded.state.batches.slice().sort((a, b) => a.operation_id.localeCompare(b.operation_id));
    const start = cursor ? Math.max(0, items.findIndex((entry) => entry.operation_id === cursor) + 1) : 0;
    const page = items.slice(start, start + maximum).map(clone);
    return { ok: true, initialized: loaded.initialized, project_id: projectId, items: page, total: items.length, nextCursor: page.length === maximum ? page.at(-1).operation_id : "", revision: loaded.state.revision, warnings: loaded.warning ? [{ code: "MEMORY_MIGRATION_STORE_RECOVERED", message: loaded.warning }] : [] };
  }

  async function saveBatch(workspace, projectId, input) {
    return enqueue(workspace, projectId, async () => {
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      let batch;
      try { batch = createMigrationBatch({ ...input, project_id: projectId }); } catch (error) { return operationFailure(error.code || "MEMORY_MIGRATION_BATCH_INVALID", error.message, error.details || {}); }
      const state = loaded.state;
      const existing = state.batches.find((entry) => entry.operation_id === batch.operation_id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(batch)) return operationFailure("MEMORY_MIGRATION_BATCH_CONFLICT", "The migration operation ID already refers to different batch metadata.", { operationId: batch.operation_id });
        return { ok: true, changed: false, duplicate: true, batch: clone(existing), revision: state.revision, path: loaded.path };
      }
      state.batches.push(batch);
      state.batches.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
      state.revision += 1;
      state.updated_at = stamp();
      const saved = persist(workspace, state);
      return saved.ok ? { ok: true, changed: true, duplicate: false, batch: clone(batch), previousRevision: state.revision - 1, revision: state.revision, path: saved.path } : saved;
    });
  }

  async function updateBatch(workspace, projectId, operationId, patch = {}) {
    return enqueue(workspace, projectId, async () => {
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      const index = loaded.state.batches.findIndex((entry) => entry.operation_id === String(operationId || ""));
      if (index < 0) return operationFailure("MEMORY_MIGRATION_BATCH_NOT_FOUND", "The migration batch was not found.", { operationId });
      const next = { ...loaded.state.batches[index], ...clone(patch), project_id: projectId, operation_id: loaded.state.batches[index].operation_id, updated_at: stamp() };
      let normalized;
      try { normalized = createMigrationBatch(next); } catch (error) { return operationFailure(error.code || "MEMORY_MIGRATION_BATCH_INVALID", error.message, error.details || {}); }
      if (JSON.stringify(normalized) === JSON.stringify(loaded.state.batches[index])) return { ok: true, changed: false, batch: clone(normalized), revision: loaded.state.revision };
      loaded.state.batches[index] = normalized;
      loaded.state.revision += 1;
      loaded.state.updated_at = stamp();
      const saved = persist(workspace, loaded.state);
      return saved.ok ? { ok: true, changed: true, batch: clone(normalized), previousRevision: loaded.state.revision - 1, revision: loaded.state.revision, path: saved.path } : saved;
    });
  }

  async function rollback(workspace, projectId, operationId, { reason = "operator_requested", rollbackOperationId = "" } = {}) {
    return enqueue(workspace, projectId, async () => {
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      const index = loaded.state.batches.findIndex((entry) => entry.operation_id === String(operationId || ""));
      if (index < 0) return operationFailure("MEMORY_MIGRATION_BATCH_NOT_FOUND", "The migration batch was not found.", { operationId });
      const current = clone(loaded.state.batches[index]);
      if (current.state === "rolled_back" && current.rollback?.excluded) return { ok: true, changed: false, replayed: true, batch: clone(current), revision: loaded.state.revision };
      const excludedRecordIds = Object.fromEntries(Object.entries(current.imported_record_ids || {}).map(([domain, ids]) => [domain, ids]));
      let rollbackRecord;
      try {
        rollbackRecord = createMigrationRollback({ project_id: projectId, operation_id: current.operation_id, rollback_operation_id: rollbackOperationId || `op_${crypto.randomUUID()}`, reason, excluded_record_ids: excludedRecordIds, created_at: stamp() });
      } catch (error) { return operationFailure(error.code || "MEMORY_MIGRATION_ROLLBACK_INVALID", error.message, error.details || {}); }
      current.state = "rolled_back";
      current.rolled_back_at = rollbackRecord.created_at;
      current.updated_at = rollbackRecord.created_at;
      current.rollback = { available: true, reason: rollbackRecord.reason, excluded: true };
      loaded.state.rollbacks.push(rollbackRecord);
      loaded.state.batches[index] = createMigrationBatch(current);
      loaded.state.revision += 1;
      loaded.state.updated_at = stamp();
      const saved = persist(workspace, loaded.state);
      return saved.ok ? { ok: true, changed: true, batch: clone(loaded.state.batches[index]), rollback: clone(rollbackRecord), previousRevision: loaded.state.revision - 1, revision: loaded.state.revision, path: saved.path } : saved;
    });
  }

  function excludedRecordIds(workspace, projectId) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const excluded = {};
    for (const batch of loaded.state.batches) {
      if (batch.state !== "rolled_back" || !batch.rollback?.excluded) continue;
      for (const [domain, ids] of Object.entries(batch.imported_record_ids || {})) excluded[domain] = [...new Set([...(excluded[domain] || []), ...ids])];
    }
    return { ok: true, project_id: projectId, excluded, revision: loaded.state.revision, initialized: loaded.initialized };
  }

  function status(workspace, projectId) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const batches = loaded.state.batches;
    return { ok: true, project_id: projectId, initialized: loaded.initialized, revision: loaded.state.revision, state: batches.some((entry) => ["importing", "partial"].includes(entry.state)) ? "pending" : batches.some((entry) => entry.state === "failed") ? "failed" : batches.some((entry) => entry.state === "rolled_back") ? "degraded" : batches.length ? "healthy" : "idle", batch_count: batches.length, pending_count: batches.filter((entry) => ["importing", "partial"].includes(entry.state)).length, failed_count: batches.filter((entry) => entry.state === "failed").length, rolled_back_count: batches.filter((entry) => entry.state === "rolled_back").length, warning: loaded.warning || "" };
  }

  return Object.freeze({ MIGRATION_STORE_VERSION, directory, stateFile, empty, read, list, get, saveBatch, updateBatch, rollback, excludedRecordIds, status });
}

module.exports = Object.freeze({ createMigrationStore, MIGRATION_STORE_VERSION });
