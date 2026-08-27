"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const { applyProjectMutations } = require("../../../domain/memory/project/project-memory.js");
const { reduceExecutionBlock } = require("../../../domain/memory/execution/block-reducer.js");
const { clone, operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");
const { commitWithRevisionRetry } = require("./optimistic-memory-commit.js");

const BLOCK_FINALIZER_VERSION = 1;
const MUTATION_ORDER = Object.freeze({ upsert_entity: 0, upsert_claim: 1, upsert_relationship: 2, register_alias: 3 });

function stableOperationId(crypto, prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 32)}`;
}

function createBlockFinalizer({
  eventStore,
  projectRepository,
  investigationMemoryService = null,
  derivedProjection = null,
  derivedGraph = null,
  watermarkStore,
  finalizationStore = null,
  featureFlags = {},
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!eventStore?.readAll || !projectRepository?.load || !projectRepository?.apply || !watermarkStore?.seal || !watermarkStore?.apply) throw new TypeError("Block finalizer requires event, Project Memory, and watermark services.");
  const queues = new Map();

  function queueKey(workspace, projectId) { return `${workspace}|${projectId}`; }
  function enqueue(workspace, projectId, operation) {
    const key = queueKey(workspace, projectId);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function failureFrom(result, fallbackCode, operationId, blockId) {
    return {
      ...(result && result.ok === false ? result : operationFailure(fallbackCode, "Block finalization failed.", {}, true)),
      operationId,
      blockId,
    };
  }

  async function loadEvents(workspace, projectId, capsule) {
    const first = Number(capsule.first_sequence || capsule.firstSequence || 0);
    const last = Number(capsule.last_sequence || capsule.lastSequence || 0);
    if (!Number.isInteger(first) || first < 1 || !Number.isInteger(last) || last < first) return operationFailure("MEMORY_EXECUTION_RANGE_INVALID", "The sealed execution range is invalid.");
    return eventStore.readAll(workspace, projectId, "execution", { fromSequence: first, toSequence: last, blockId: capsule.block_id || capsule.blockId });
  }

  function projectCommand(candidate, projectId, blockId, operationId, expectedBaseRevision, eventTime) {
    return {
      operation_id: operationId,
      idempotency_key: operationId,
      project_id: projectId,
      memory_type: "project",
      expected_base_revision: expectedBaseRevision,
      actor: { type: "system", id: "block-finalizer" },
      session_id: null,
      block_id: blockId,
      sealed_event_range: null,
      finalization_position: null,
      mutation_type: candidate.mutation_type,
      payload: clone(candidate.payload || {}),
      provenance: {
        source_type: "runtime_event",
        source_refs: [candidate.source_event_id, ...(candidate.source_ids || [])].filter(Boolean).slice(0, 100),
        captured_at: eventTime,
      },
      sensitivity: "internal",
    };
  }

  function preflightProjectCandidates(state, candidates, projectId, blockId, operationId, eventTime) {
    const ordered = [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => {
      const leftKey = `${MUTATION_ORDER[left.mutation_type] ?? 9}|${left.mutation_type}|${canonicalJson(left.payload || {})}`;
      const rightKey = `${MUTATION_ORDER[right.mutation_type] ?? 9}|${right.mutation_type}|${canonicalJson(right.payload || {})}`;
      return leftKey.localeCompare(rightKey);
    });
    let cursor = state;
    const accepted = [];
    const residues = [];
    ordered.forEach((candidate, index) => {
      const testOperation = stableOperationId(crypto, "op", { operationId, blockId, index, candidate });
      const command = projectCommand(candidate, projectId, blockId, testOperation, cursor.revision, eventTime);
      const applied = applyProjectMutations(cursor, [command], { projectId, now, idFactory: (prefix) => stableOperationId(crypto, prefix, { operationId, index, prefix }) });
      if (!applied.ok) {
        residues.push({ reason: "invalid_project_candidate", code: applied.code, error: applied.error, source_event_id: candidate.source_event_id, mutation_type: candidate.mutation_type });
        return;
      }
      accepted.push({ ...candidate, _order: index });
      if (applied.state) cursor = applied.state;
    });
    return { accepted: accepted.map(({ _order, ...candidate }) => candidate), residues };
  }

  async function applyProjectWithRetry({ workspace, projectId, blockId, operationId, eventTime, candidates, eventRange, sealedPosition, initialLoaded }) {
    const attempted = await commitWithRevisionRetry({
      operationId,
      read: async ({ attempt }) => attempt === 1 ? initialLoaded : projectRepository.load(workspace, projectId),
      build: async (loaded) => {
        if (!loaded?.ok) return loaded;
        const preflight = preflightProjectCandidates(loaded.state, candidates, projectId, blockId, operationId, eventTime);
        const commands = preflight.accepted.map((candidate) => projectCommand(candidate, projectId, blockId, operationId, loaded.revision, eventTime));
        const noOp = { ok: true, operationId, recordIds: [], previousRevision: loaded.revision, revision: loaded.revision, changed: false, conflicts: [], warnings: [] };
        return {
          ok: true,
          commands,
          preflight,
          loaded,
          ...(commands.length ? {} : { result: { ok: true, projectResult: noOp, preflight, loaded } }),
        };
      },
      commit: async (plan, loaded) => {
        const projectResult = await projectRepository.apply(workspace, projectId, plan.commands, { blockId, sealedEventRange: eventRange, finalizationPosition: sealedPosition });
        if (!projectResult?.ok) return projectResult;
        return { ok: true, projectResult, preflight: plan.preflight, loaded };
      },
    });
    if (!attempted?.ok) return attempted;
    return {
      ok: true,
      projectResult: attempted.projectResult,
      preflight: attempted.preflight || { accepted: [], residues: [] },
      loaded: attempted.loaded || initialLoaded,
      retry: attempted.retry || { attempts: 1, history: [] },
    };
  }

  async function finalize(input = {}) {
    const workspace = String(input.workspace || "");
    const projectId = String(input.project_id || input.projectId || "");
    const blockId = String(input.block_id || input.blockId || "");
    const operationId = String(input.operation_id || input.operationId || "");
    try { assertMemoryId(projectId, "proj"); assertMemoryId(blockId, "block"); assertMemoryId(operationId, "op"); } catch (error) { return operationFailure(error.code || "MEMORY_FINALIZATION_INPUT_INVALID", error.message, error.details || {}); }
    if (!workspace) return operationFailure("MEMORY_FINALIZATION_WORKSPACE_REQUIRED", "A workspace is required for block finalization.");
    return enqueue(workspace, projectId, async () => {
      const capsule = input.capsule && typeof input.capsule === "object" ? clone(input.capsule) : null;
      if (!capsule) return failureFrom(operationFailure("MEMORY_EXECUTION_CAPSULE_REQUIRED", "A sealed execution capsule is required."), "MEMORY_EXECUTION_CAPSULE_REQUIRED", operationId, blockId);
      const eventsResult = Array.isArray(input.events) ? { ok: true, events: input.events.map(clone), warnings: [] } : await loadEvents(workspace, projectId, capsule);
      if (!eventsResult.ok) return failureFrom(eventsResult, "MEMORY_EXECUTION_EVENTS_UNAVAILABLE", operationId, blockId);
      const reduction = reduceExecutionBlock({ capsule, events: eventsResult.events || [] });
      if (!reduction.ok) return failureFrom(reduction, "MEMORY_EXECUTION_REDUCTION_FAILED", operationId, blockId);
      const eventRange = { first_sequence: capsule.first_sequence, last_sequence: capsule.last_sequence, event_ids: capsule.event_ids, hash: reduction.event_range_hash };
      let durable = null;
      if (finalizationStore?.persist) {
        durable = finalizationStore.persist({
          operation_id: operationId,
          project_id: projectId,
          block_id: blockId,
          event_range_hash: reduction.event_range_hash,
          sealed_event_range: eventRange,
          payload: { capsule, reduction_hash: reduction.reduction_hash },
        });
        if (!durable.ok) return failureFrom(durable, "MEMORY_FINALIZATION_PERSIST_FAILED", operationId, blockId);
        const processing = finalizationStore.markProcessing?.(operationId);
        if (processing && !processing.ok) return failureFrom(processing, "MEMORY_FINALIZATION_STATE_FAILED", operationId, blockId);
      }
      const sealed = await watermarkStore.seal(workspace, projectId, { operation_id: operationId, block_id: blockId, sealed_event_range: eventRange, event_range_hash: reduction.event_range_hash });
      if (!sealed.ok) {
        finalizationStore?.markFailed?.(operationId, sealed, { retryable: Boolean(sealed.retryable) });
        return failureFrom(sealed, "MEMORY_WATERMARK_SEAL_FAILED", operationId, blockId);
      }
      const loaded = await projectRepository.load(workspace, projectId);
      if (!loaded.ok) {
        await watermarkStore.fail(workspace, projectId, { operation_id: operationId, error: loaded, retryable: true });
        finalizationStore?.markFailed?.(operationId, loaded, { retryable: true });
        return failureFrom(loaded, "MEMORY_PROJECT_LOAD_FAILED", operationId, blockId);
      }
      const eventTime = reduction.terminal?.occurred_at || timestamp(now);
      const projectAttempt = await applyProjectWithRetry({
        workspace,
        projectId,
        blockId,
        operationId,
        eventTime,
        candidates: reduction.project_candidates,
        eventRange,
        sealedPosition: sealed.position,
        initialLoaded: loaded,
      });
      if (!projectAttempt.ok) {
        await watermarkStore.fail(workspace, projectId, { operation_id: operationId, error: projectAttempt, retryable: Boolean(projectAttempt.retryable) });
        finalizationStore?.markFailed?.(operationId, projectAttempt, { retryable: Boolean(projectAttempt.retryable) });
        return { ...projectAttempt, operationId, blockId, reduction, residues: reduction.residues };
      }
      const projectResult = projectAttempt.projectResult;
      const preflight = projectAttempt.preflight;
      let investigationResult = { ok: true, skipped: true, changed: false, previousRevision: null, revision: null, appliedCandidates: 0, residues: [] };
      if (featureFlags.investigationMemoryV2 === true && investigationMemoryService?.applyExecution) {
        const investigationOperationId = stableOperationId(crypto, { operationId, blockId, channel: "investigation" });
        investigationResult = await investigationMemoryService.applyExecution({
          workspace,
          projectId,
          operationId: investigationOperationId,
          blockId,
          candidates: reduction.investigation_candidates,
          sealedEventRange: eventRange,
          finalizationPosition: sealed.position,
        });
      }
      const domainRevisions = { project: Number(projectResult.revision ?? loaded.revision) };
      if (investigationResult.ok && investigationResult.revision != null) domainRevisions.investigation = Number(investigationResult.revision);
      const applied = await watermarkStore.apply(workspace, projectId, { operation_id: operationId, block_id: blockId, domain_revisions: domainRevisions });
      if (!applied.ok) {
        await watermarkStore.fail(workspace, projectId, { operation_id: operationId, error: applied, retryable: true });
        finalizationStore?.markFailed?.(operationId, applied, { retryable: true });
        return failureFrom(applied, "MEMORY_WATERMARK_APPLY_FAILED", operationId, blockId);
      }
      // Derived indexes are rebuildable views. Schedule them only after the
      // canonical watermark has advanced, and never make semantic finalization
      // wait for or fail on a projection worker.
      let projection = { sqlite_scheduled: false, graph_scheduled: false, skipped: true };
      if (featureFlags.derivedMemoryViews === true && derivedProjection?.scheduleRebuild) {
        projection = { ...projection, sqlite_scheduled: true, skipped: false };
        derivedProjection.scheduleRebuild({ workspace, projectId, precedingBlockId: blockId }).catch(() => {});
      }
      if (featureFlags.derivedMemoryViews === true && derivedGraph?.scheduleRebuild) {
        projection = { ...projection, graph_scheduled: true, skipped: false };
        derivedGraph.scheduleRebuild({ workspace, projectId, precedingBlockId: blockId }).catch(() => {});
      }
      const result = {
        ok: true,
        finalizer_version: BLOCK_FINALIZER_VERSION,
        operationId,
        blockId,
        changed: Boolean(projectResult.changed),
        project: projectResult,
        retry: projectAttempt.retry,
        investigation: investigationResult,
        reduction: {
          reduction_hash: reduction.reduction_hash,
          event_range_hash: reduction.event_range_hash,
          project_candidates: reduction.project_candidates.length,
          investigation_candidates: reduction.investigation_candidates.length,
          verification_candidates: reduction.verification_candidates.length,
          tool_clusters: reduction.tool_clusters.length,
          traffic_clusters: reduction.traffic_clusters.length,
        },
        residues: [...reduction.residues, ...preflight.residues, ...(investigationResult.residues || [])],
        projection,
        watermark: applied.watermark,
        durable,
      };
      finalizationStore?.markCompleted?.(operationId, result);
      return result;
    });
  }

  return Object.freeze({ BLOCK_FINALIZER_VERSION, finalize, activeProjects: () => queues.size });
}

module.exports = Object.freeze({ createBlockFinalizer, BLOCK_FINALIZER_VERSION });
