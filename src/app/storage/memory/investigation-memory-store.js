"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/index.js");
const { applyInvestigationMutations, emptyInvestigationMemory, normalizeInvestigationMemory } = require("../../../domain/memory/investigation/investigation-memory.js");
const { createInvestigationMemoryQuery } = require("../../../domain/memory/investigation/investigation-memory-query.js");
const { createMemoryManifestStore } = require("./memory-manifest-store.js");
const { createMemoryEventStore } = require("./event-store.js");
const { createMemorySnapshotStore } = require("./snapshot-store.js");
const { clone, operationFailure, resolvedWorkspace, timestamp } = require("./memory-storage-utils.js");

const INVESTIGATION_MEMORY_REPOSITORY_VERSION = 1;

function createInvestigationMemoryRepository({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  manifestStore = null,
  eventStore = null,
  snapshotStore = null,
  now = () => new Date(),
  idFactory = null,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Investigation Memory repository dependencies are required.");
  const manifests = manifestStore || createMemoryManifestStore({ fs, path, crypto, now });
  const events = eventStore || createMemoryEventStore({ fs, path, crypto, manifestStore: manifests, now });
  const snapshots = snapshotStore || createMemorySnapshotStore({ fs, path, crypto, manifestStore: manifests, now });
  const queries = createInvestigationMemoryQuery({ now });
  const queues = new Map();

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function queueKey(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }
  function enqueue(workspace, projectId, operation) {
    const key = queueKey(workspace, projectId);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function empty(projectId) { return emptyInvestigationMemory(projectId, now); }

  async function replay(workspace, projectId) {
    const history = await events.readAll(workspace, projectId, "semantic");
    if (!history.ok) return history;
    let state = empty(projectId);
    for (const event of history.events) {
      if (event.event_type !== "investigation_memory_mutation") continue;
      if (event.payload?.state && typeof event.payload.state === "object") {
        try { state = normalizeInvestigationMemory(event.payload.state, { projectId, now }); } catch (error) { return operationFailure("MEMORY_INVESTIGATION_REPLAY_FAILED", `Investigation Memory replay failed: ${error.message}.`, { eventId: event.event_id }, true); }
        continue;
      }
      const applied = applyInvestigationMutations(state, event.payload?.commands || [], { projectId, now, idFactory });
      if (!applied.ok) return operationFailure("MEMORY_INVESTIGATION_REPLAY_FAILED", applied.error, { eventId: event.event_id, cause: applied.code }, true);
      state = applied.state || state;
    }
    return { ok: true, state, events: history.events.filter((event) => event.event_type === "investigation_memory_mutation"), warnings: history.warnings || [] };
  }

  async function load(workspace, projectId, { rebuildOnCorrupt = true } = {}) {
    let root;
    try { root = rootOf(workspace); assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_INVESTIGATION_INPUT_INVALID", error.message, error.details || {}); }
    const snapshot = snapshots.read(root, projectId, "investigation");
    if (snapshot.ok && snapshot.exists) {
      try {
        const state = normalizeInvestigationMemory(snapshot.state || snapshot.snapshot.state, { projectId, now });
        return { ok: true, initialized: true, exists: true, state, revision: state.revision, source: "snapshot", recovered: Boolean(snapshot.recovered), warning: snapshot.warning || "" };
      } catch (error) {
        if (!rebuildOnCorrupt) return operationFailure("MEMORY_INVESTIGATION_SNAPSHOT_INVALID", error.message, { path: snapshot.path }, true);
      }
    } else if (!snapshot.ok && !rebuildOnCorrupt) return snapshot;
    const rebuilt = await replay(root, projectId);
    if (!rebuilt.ok) return rebuilt;
    if (rebuilt.state.revision > 0 && rebuildOnCorrupt) {
      const restored = snapshots.write(root, projectId, "investigation", { state: rebuilt.state }, { revision: rebuilt.state.revision, allowCorruptReplace: true });
      const completed = restored && typeof restored.then === "function" ? await restored : restored;
      if (!completed.ok) return { ok: true, initialized: true, exists: false, state: rebuilt.state, revision: rebuilt.state.revision, source: "event_replay", warning: completed.error, warnings: rebuilt.warnings };
      return { ok: true, initialized: true, exists: true, state: rebuilt.state, revision: rebuilt.state.revision, source: "event_replay", recovered: true, warnings: rebuilt.warnings };
    }
    return { ok: true, initialized: rebuilt.state.revision > 0, exists: rebuilt.state.revision > 0, state: rebuilt.state, revision: rebuilt.state.revision, source: "event_replay", warnings: rebuilt.warnings };
  }

  function apply(workspace, projectId, commands, { blockId = "", sealedEventRange = {}, finalizationPosition = null } = {}) {
    return enqueue(workspace, projectId, async () => {
      let root;
      try { root = rootOf(workspace); assertMemoryId(projectId, "proj"); if (blockId) assertMemoryId(blockId, "block"); } catch (error) { return operationFailure(error.code || "MEMORY_INVESTIGATION_INPUT_INVALID", error.message, error.details || {}); }
      const loaded = await load(root, projectId);
      if (!loaded.ok) return loaded;
      const applied = applyInvestigationMutations(loaded.state, commands, { projectId, now, idFactory });
      if (!applied.ok) return applied;
      if (applied.replayed) return { ...applied, state: loaded.state, source: "replayed", finalized: true };
      if (!applied.changed) return { ...applied, state: loaded.state, source: "no_op" };
      const result = { ok: true, operationId: applied.operationId, recordIds: applied.recordIds, previousRevision: applied.previousRevision, revision: applied.revision, changed: true, conflicts: applied.conflicts, warnings: applied.warnings };
      const event = await events.append(root, projectId, "semantic", {
        event_type: "investigation_memory_mutation",
        operation_id: applied.operationId,
        block_id: blockId || undefined,
        occurred_at: timestamp(now),
        payload: {
          memory_type: "investigation",
          commands: Array.isArray(commands) ? clone(commands) : [clone(commands)],
          result,
          state: clone(applied.state),
          sealed_event_range: clone(sealedEventRange),
          finalization_position: finalizationPosition,
        },
      });
      if (!event.ok) return operationFailure("MEMORY_INVESTIGATION_EVENT_COMMIT_FAILED", event.error || "The Investigation Memory event could not be appended.", { operationId: applied.operationId }, true);
      const saved = await snapshots.write(root, projectId, "investigation", { state: applied.state }, { revision: applied.revision, expectedBaseRevision: loaded.state.revision });
      if (!saved.ok) return { ...result, finalized: false, warning: saved.error, pendingSnapshot: true, eventId: event.eventId };
      return { ...result, finalized: true, eventId: event.eventId, snapshotPath: saved.path, manifestRevision: saved.manifestRevision, state: applied.state };
    });
  }

  async function rebuild(workspace, projectId) {
    const replayed = await replay(workspace, projectId);
    if (!replayed.ok) return replayed;
    const saved = snapshots.write(workspace, projectId, "investigation", { state: replayed.state }, { revision: replayed.state.revision, allowCorruptReplace: true });
    const completed = saved && typeof saved.then === "function" ? await saved : saved;
    if (!completed.ok) return completed;
    return { ok: true, rebuilt: true, state: replayed.state, revision: replayed.state.revision, snapshotPath: completed.path, warnings: replayed.warnings };
  }

  function query(workspace, projectId, request = {}) {
    return load(workspace, projectId).then((loaded) => {
      if (!loaded.ok) return loaded;
      return { ...queries.query(loaded.state, { ...request, project_id: projectId }), source: loaded.source, recovered: Boolean(loaded.recovered) };
    });
  }

  function status(workspace, projectId) {
    return load(workspace, projectId).then((loaded) => loaded.ok ? { ok: true, projectId, initialized: loaded.initialized, revision: loaded.revision, source: loaded.source, recovered: Boolean(loaded.recovered), warning: loaded.warning || "" } : loaded);
  }

  return Object.freeze({
    INVESTIGATION_MEMORY_REPOSITORY_VERSION,
    empty,
    load,
    apply,
    query,
    rebuild,
    status,
    replay,
  });
}

module.exports = Object.freeze({ createInvestigationMemoryRepository, INVESTIGATION_MEMORY_REPOSITORY_VERSION });
