"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalKeyHash, createOpaqueId } = require("../../../contracts/memory/index.js");
const { createMemoryManifestStore, MEMORY_DOMAINS } = require("./memory-manifest-store.js");
const { clone, operationFailure, resolvedWorkspace, timestamp } = require("./memory-storage-utils.js");

const WATERMARK_SCHEMA_VERSION = 1;

function createMemoryWatermarkStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  manifestStore = null,
  now = () => new Date(),
  pollIntervalMs = 10,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory watermark store dependencies are required.");
  const manifests = manifestStore || createMemoryManifestStore({ fs, path, crypto, now });
  const queues = new Map();
  const waiters = new Map();

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function normalizedProjectId(projectId) { return assertMemoryId(projectId, "proj"); }
  function normalizedBlockId(blockId) { return assertMemoryId(blockId, "block"); }
  function normalizedOperationId(operationId) { return assertMemoryId(operationId, "op"); }
  function queueKey(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }

  function enqueue(workspace, projectId, operation) {
    const key = queueKey(workspace, projectId);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function notify(workspace, projectId) {
    const key = queueKey(workspace, projectId);
    const pending = waiters.get(key) || [];
    waiters.delete(key);
    for (const waiter of pending) waiter();
  }

  function watermarkFromManifest(manifest, { initialized = true, warning = "" } = {}) {
    const finalization = manifest.finalization || {};
    return {
      schema_version: WATERMARK_SCHEMA_VERSION,
      project_id: manifest.project_id,
      initialized,
      latest_sealed_block_id: String(finalization.latest_sealed_block_id || ""),
      latest_sealed_event_range: clone(finalization.latest_sealed_event_range),
      latest_sealed_position: Number(finalization.latest_sealed_position || 0),
      latest_applied_block_id: String(finalization.latest_applied_block_id || ""),
      latest_applied_position: Number(finalization.latest_applied_position || 0),
      domain_revisions: clone(manifest.domain_revisions || {}),
      pending_outbox_count: Number(manifest.outbox?.pending_count || 0),
      pending_finalization_count: Number(finalization.pending_count || 0),
      failed_operations: clone(finalization.failed_operations || []),
      failure_state: clone(finalization.failure_state || null),
      source_manifest_revision: Number(manifest.manifest_revision || 0),
      updated_at: String(finalization.updated_at || manifest.updated_at || ""),
      ...(warning ? { warning } : {}),
    };
  }

  function status(workspace, projectId) {
    let root;
    try { root = rootOf(workspace); normalizedProjectId(projectId); } catch (error) { return operationFailure(error.code || "MEMORY_WATERMARK_INPUT_INVALID", error.message, error.details || {}); }
    const loaded = manifests.read(root, projectId);
    if (!loaded.ok) return loaded;
    return { ok: true, watermark: watermarkFromManifest(loaded.manifest, { initialized: loaded.initialized, warning: loaded.warning || "" }), manifest: loaded.manifest };
  }

  function seal(workspace, projectId, input = {}) {
    return enqueue(workspace, projectId, async () => {
      let root;
      let operationId;
      let blockId;
      try {
        root = rootOf(workspace);
        normalizedProjectId(projectId);
        operationId = normalizedOperationId(input.operation_id || input.operationId || createOpaqueId("op", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }));
        blockId = normalizedBlockId(input.block_id || input.blockId);
      } catch (error) { return operationFailure(error.code || "MEMORY_WATERMARK_INPUT_INVALID", error.message, error.details || {}); }
      const eventRange = input.sealed_event_range && typeof input.sealed_event_range === "object" ? clone(input.sealed_event_range) : (input.sealedEventRange && typeof input.sealedEventRange === "object" ? clone(input.sealedEventRange) : {});
      const eventRangeHash = String(input.event_range_hash || input.eventRangeHash || canonicalKeyHash(eventRange)).trim().toLowerCase();
      const initialized = manifests.initialize(root, projectId, { reason: "block_seal" });
      if (!initialized.ok) return initialized;
      const loaded = manifests.read(root, projectId);
      if (!loaded.ok) return loaded;
      const finalization = loaded.manifest.finalization;
      const priorOperation = finalization.sealed_operations.find((entry) => entry.operation_id === operationId);
      if (priorOperation) {
        if (priorOperation.block_id !== blockId || priorOperation.event_range_hash !== eventRangeHash) return operationFailure("MEMORY_WATERMARK_IDEMPOTENCY_CONFLICT", "The operation is already sealed for a different block or event range.", { operationId });
        return { ok: true, changed: false, duplicate: true, operationId, blockId, position: priorOperation.position, watermark: watermarkFromManifest(loaded.manifest), manifestRevision: loaded.manifest.manifest_revision };
      }
      const priorBlock = finalization.sealed_operations.find((entry) => entry.block_id === blockId);
      if (priorBlock) return operationFailure("MEMORY_WATERMARK_BLOCK_CONFLICT", "The block is already sealed by another operation.", { blockId, operationId: priorBlock.operation_id });
      const requestedPosition = input.position == null ? Number(finalization.latest_sealed_position || 0) + 1 : Number(input.position);
      if (!Number.isInteger(requestedPosition) || requestedPosition !== Number(finalization.latest_sealed_position || 0) + 1) return operationFailure("MEMORY_WATERMARK_POSITION_INVALID", "Finalization positions must be strictly ordered.", { expected: Number(finalization.latest_sealed_position || 0) + 1, requested: requestedPosition });
      const stamp = timestamp(now);
      const updated = await manifests.update(root, projectId, (manifest) => {
        const state = manifest.finalization;
        state.latest_sealed_block_id = blockId;
        state.latest_sealed_event_range = { ...eventRange, hash: eventRangeHash };
        state.latest_sealed_position = requestedPosition;
        state.pending_count = Math.max(0, requestedPosition - Number(state.latest_applied_position || 0));
        state.sealed_operations = [...(state.sealed_operations || []), { operation_id: operationId, block_id: blockId, position: requestedPosition, event_range_hash: eventRangeHash, sealed_at: stamp }].slice(-10_000);
        state.updated_at = stamp;
        return manifest;
      }, { reason: "block_seal" });
      if (!updated.ok) return updated;
      const result = { ok: true, changed: true, duplicate: false, operationId, blockId, position: requestedPosition, watermark: watermarkFromManifest(updated.manifest), manifestRevision: updated.manifest.manifest_revision };
      notify(root, projectId);
      return result;
    });
  }

  function apply(workspace, projectId, input = {}) {
    return enqueue(workspace, projectId, async () => {
      let root;
      let operationId;
      let blockId;
      try { root = rootOf(workspace); normalizedProjectId(projectId); operationId = normalizedOperationId(input.operation_id || input.operationId); blockId = normalizedBlockId(input.block_id || input.blockId); } catch (error) { return operationFailure(error.code || "MEMORY_WATERMARK_INPUT_INVALID", error.message, error.details || {}); }
      const loaded = manifests.read(root, projectId);
      if (!loaded.ok) return loaded;
      if (!loaded.initialized) return operationFailure("MEMORY_WATERMARK_SEAL_REQUIRED", "A block must be sealed before it can be applied.", { blockId, operationId });
      const finalization = loaded.manifest.finalization;
      const sealed = finalization.sealed_operations.find((entry) => entry.operation_id === operationId && entry.block_id === blockId);
      if (!sealed) return operationFailure("MEMORY_WATERMARK_SEAL_REQUIRED", "The block operation has not been sealed.", { blockId, operationId });
      const priorApplied = finalization.applied_operations.find((entry) => entry.operation_id === operationId && entry.block_id === blockId);
      if (priorApplied) return { ok: true, changed: false, duplicate: true, operationId, blockId, position: priorApplied.position, watermark: watermarkFromManifest(loaded.manifest), manifestRevision: loaded.manifest.manifest_revision };
      const currentAppliedPosition = Number(finalization.latest_applied_position || 0);
      if (sealed.position !== currentAppliedPosition + 1) return operationFailure("MEMORY_WATERMARK_PREDECESSOR_PENDING", "A preceding finalization position has not been applied yet.", { blockId, position: sealed.position, latestAppliedPosition: currentAppliedPosition });
      const requestedRevisions = input.domain_revisions && typeof input.domain_revisions === "object" ? input.domain_revisions : (input.domainRevisions && typeof input.domainRevisions === "object" ? input.domainRevisions : {});
      for (const [domain, value] of Object.entries(requestedRevisions)) {
        if (!MEMORY_DOMAINS.includes(domain)) return operationFailure("MEMORY_WATERMARK_DOMAIN_INVALID", "A watermark update referenced an unsupported domain.", { domain });
        const next = Number(value);
        if (!Number.isInteger(next) || next < Number(loaded.manifest.domain_revisions[domain] || 0)) return operationFailure("MEMORY_WATERMARK_REVISION_INVALID", "A watermark cannot move a memory domain backwards.", { domain, current: loaded.manifest.domain_revisions[domain], requested: value });
      }
      const updated = await manifests.update(root, projectId, (manifest) => {
        const state = manifest.finalization;
        state.latest_applied_block_id = blockId;
        state.latest_applied_position = sealed.position;
        state.pending_count = Math.max(0, Number(state.latest_sealed_position || 0) - sealed.position);
        state.applied_operations = [...(state.applied_operations || []), { operation_id: operationId, block_id: blockId, position: sealed.position, applied_at: timestamp(now) }].slice(-10_000);
        state.failed_operations = (state.failed_operations || []).filter((value) => value !== operationId);
        state.failure_state = null;
        state.updated_at = timestamp(now);
        for (const [domain, value] of Object.entries(requestedRevisions)) manifest.domain_revisions[domain] = Number(value);
        return manifest;
      }, { reason: "block_apply" });
      if (!updated.ok) return updated;
      const result = { ok: true, changed: true, duplicate: false, operationId, blockId, position: sealed.position, watermark: watermarkFromManifest(updated.manifest), manifestRevision: updated.manifest.manifest_revision };
      notify(root, projectId);
      return result;
    });
  }

  function fail(workspace, projectId, input = {}) {
    return enqueue(workspace, projectId, async () => {
      let root;
      let operationId;
      try { root = rootOf(workspace); normalizedProjectId(projectId); operationId = normalizedOperationId(input.operation_id || input.operationId); } catch (error) { return operationFailure(error.code || "MEMORY_WATERMARK_INPUT_INVALID", error.message, error.details || {}); }
      const loaded = manifests.read(root, projectId);
      if (!loaded.ok) return loaded;
      if (!loaded.initialized) return operationFailure("MEMORY_WATERMARK_SEAL_REQUIRED", "The failed operation has no initialized project watermark.", { operationId });
      const error = { code: String(input.error?.code || input.code || "MEMORY_FINALIZATION_FAILED").slice(0, 120), message: String(input.error?.message || input.error || "Finalization failed.").slice(0, 2_000), retryable: Boolean(input.retryable) };
      const updated = await manifests.update(root, projectId, (manifest) => {
        const state = manifest.finalization;
        state.failed_operations = [...new Set([...(state.failed_operations || []), operationId])].slice(-100);
        state.failure_state = { operation_id: operationId, ...error, at: timestamp(now) };
        state.updated_at = timestamp(now);
        return manifest;
      }, { reason: "block_failure" });
      if (!updated.ok) return updated;
      notify(root, projectId);
      return { ok: true, changed: true, operationId, watermark: watermarkFromManifest(updated.manifest), manifestRevision: updated.manifest.manifest_revision };
    });
  }

  async function waitFor(workspace, projectId, { blockId = "", position = null, timeoutMs = 250 } = {}) {
    let root;
    try { root = rootOf(workspace); normalizedProjectId(projectId); if (blockId) normalizedBlockId(blockId); } catch (error) { return operationFailure(error.code || "MEMORY_WATERMARK_INPUT_INVALID", error.message, error.details || {}); }
    const deadline = Date.now() + Math.min(250, Math.max(0, Number(timeoutMs) || 250));
    const targetPosition = position == null ? null : Number(position);
    const satisfied = (current) => {
      if (!current.ok) return current;
      const watermark = current.watermark;
      if (targetPosition !== null) return watermark.latest_applied_position >= targetPosition;
      if (blockId) return watermark.latest_applied_block_id === blockId;
      return watermark.pending_finalization_count === 0;
    };
    while (true) {
      const current = status(root, projectId);
      const result = satisfied(current);
      if (result === current || result) {
        if (!current.ok) return current;
        if (result) return { ok: true, satisfied: true, pending: false, watermark: current.watermark };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        if (!current.ok) return current;
        return { ok: true, satisfied: false, pending: true, code: "MEMORY_FINALIZATION_PENDING", watermark: current.watermark, gap: { blockId, position: targetPosition, latestAppliedPosition: current.watermark.latest_applied_position, latestSealedPosition: current.watermark.latest_sealed_position } };
      }
      await new Promise((resolve) => {
        const key = queueKey(root, projectId);
        let settled = false;
        let timer;
        const remove = () => {
          const entries = waiters.get(key) || [];
          const index = entries.indexOf(wake);
          if (index >= 0) entries.splice(index, 1);
          if (entries.length) waiters.set(key, entries); else waiters.delete(key);
        };
        const wake = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          remove();
          resolve();
        };
        timer = setTimeout(wake, Math.min(remaining, Math.max(1, Number(pollIntervalMs) || 10)));
        const entries = waiters.get(key) || [];
        entries.push(wake);
        waiters.set(key, entries);
      });
    }
  }

  return Object.freeze({
    WATERMARK_SCHEMA_VERSION,
    status,
    watermark: status,
    seal,
    apply,
    fail,
    waitFor,
  });
}

module.exports = Object.freeze({ createMemoryWatermarkStore, WATERMARK_SCHEMA_VERSION });
