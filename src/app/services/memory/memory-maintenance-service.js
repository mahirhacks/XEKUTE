"use strict";

const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/memory-identity.js");
const { operationFailure, clone, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const MEMORY_MAINTENANCE_SERVICE_VERSION = 1;
const DEFAULT_ITERATIONS = 3;
const MAX_ITERATIONS = 20;
const PERFORMANCE_THRESHOLDS_MS = Object.freeze({
  warm_context_assembly_p95: 250,
  common_memory_query_p95: 100,
  startup_p95: 1_000,
  finalization_p95: 250,
  compression_p95: 250,
  rebuild_p95: 5_000,
  large_history_p95: 2_000,
});

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Number(sorted[index].toFixed(3));
}

function idFor(crypto, prefix, input) {
  const value = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID();
  return createOpaqueId(prefix, { uuid: () => value, seed: input });
}

function createMemoryMaintenanceService({
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  projectIdentityStore = null,
  projectProfileStore = null,
  manifestStore = null,
  eventStore = null,
  watermarkStore = null,
  retrievalService = null,
  contextCheckpoint = null,
  derivedProjection = null,
  graphView = null,
  artifactRegistry = null,
  sensitiveWorkingMemory = null,
  operationalContextStore = null,
  sessionMemoryStore = null,
  auditStore = null,
  memoryStatus = null,
} = {}) {
  if (!path || !crypto) throw new TypeError("Memory maintenance service dependencies are required.");
  const benchmarks = new Map();

  function scope(input = {}, { requireProject = true } = {}) {
    const workspace = resolvedWorkspace(path, input.workspace);
    const requested = String(input.projectId || input.project_id || "").trim();
    if (requested) assertMemoryId(requested, "proj");
    if (!projectIdentityStore?.resolveProject) {
      if (requireProject && !requested) return operationFailure("MEMORY_PROJECT_ID_REQUIRED", "A protected project ID is required for memory maintenance.");
      return { ok: true, workspace, projectId: requested };
    }
    const resolved = projectIdentityStore.resolveProject(workspace, { persist: false, projectId: requested });
    if (!resolved?.ok) return resolved;
    const projectId = String(resolved.projectId || requested || "");
    if (requireProject && !projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "The workspace has no initialized protected project ID.");
    return { ok: true, workspace: resolved.workspace || workspace, projectId };
  }

  function profileFor(workspace) {
    try {
      const value = typeof projectProfileStore === "function" ? projectProfileStore(workspace) : projectProfileStore?.read?.(workspace);
      const profile = value?.profile || value;
      return profile && typeof profile === "object" ? profile : {};
    } catch { return {}; }
  }

  async function maybe(value) { return value && typeof value.then === "function" ? await value : value; }

  async function cleanup(input = {}) {
    let current;
    try { current = scope(input); } catch (error) { return operationFailure(error.code || "MEMORY_MAINTENANCE_INPUT_INVALID", error.message, error.details || {}); }
    if (!current?.ok) return current;
    const operationId = String(input.operationId || input.operation_id || idFor(crypto, "op", { workspace: current.workspace, projectId: current.projectId })).slice(0, 240);
    const actions = [];
    const warnings = [];
    let changed = false;
    const profile = profileFor(current.workspace);
    const retentionDays = input.retentionDays == null ? profile.dataHandling?.retentionDays : input.retentionDays;

    if (input.sessionId && input.agentId && sensitiveWorkingMemory?.cleanupExpired) {
      const expired = await maybe(sensitiveWorkingMemory.cleanupExpired({
        ...input,
        workspace: current.workspace,
        projectId: current.projectId,
        trusted: true,
        purpose: "maintenance_expiry_cleanup",
      }));
      actions.push({ type: "sensitive_expiry", result: clone(expired) });
      if (expired?.ok === false) warnings.push({ code: expired.code, message: expired.error });
      changed = changed || Boolean(expired?.changed);
    }

    if (input.deleteSensitive === true && sensitiveWorkingMemory?.cleanupProject) {
      const deleted = await maybe(sensitiveWorkingMemory.cleanupProject({
        ...input,
        workspace: current.workspace,
        projectId: current.projectId,
        trusted: true,
        operationId,
        purpose: "project_sensitive_retention_cleanup",
      }));
      actions.push({ type: "sensitive_project_delete", result: clone(deleted) });
      if (deleted?.ok === false) warnings.push({ code: deleted.code, message: deleted.error });
      changed = changed || Boolean(deleted?.changed);
    }

    if (artifactRegistry?.expire && input.expireArtifacts !== false) {
      const expired = await maybe(artifactRegistry.expire(current.workspace, current.projectId, {
        nowAt: input.nowAt || now(),
        retentionDays,
        includePinned: input.includePinned === true,
        reason: input.reason || "project_retention_expired",
      }));
      actions.push({ type: "artifact_retention", result: clone(expired) });
      if (expired?.ok === false) warnings.push({ code: expired.code, message: expired.error });
      changed = changed || Boolean(expired?.changed);
    }

    if (input.verifyArtifacts === true && artifactRegistry?.list && artifactRegistry?.verify) {
      const listed = await maybe(artifactRegistry.list(current.workspace, current.projectId, { limit: 200 }));
      const verification = [];
      if (listed?.ok) {
        for (const artifact of listed.artifacts || []) verification.push(await maybe(artifactRegistry.verify(current.workspace, current.projectId, artifact.artifact_id)));
      } else warnings.push({ code: listed?.code, message: listed?.error });
      actions.push({ type: "artifact_integrity", result: { ok: verification.every((result) => result?.ok !== false), checked: verification.length, failed: verification.filter((result) => result?.ok === false || result?.integrityState === "hash_mismatch").length } });
    }

    if (operationalContextStore?.expire && retentionDays != null && input.expireCheckpoints !== false) {
      const expired = await maybe(operationalContextStore.expire({
        workspace: current.workspace,
        projectId: current.projectId,
        retentionDays,
        nowAt: input.nowAt || now(),
        excludeSessionId: input.sessionId || "",
      }));
      actions.push({ type: "operational_context_retention", result: clone(expired) });
      if (expired?.ok === false) warnings.push(...(Array.isArray(expired.warnings) && expired.warnings.length ? expired.warnings : [{ code: expired.code, message: expired.error }]));
      changed = changed || Boolean(expired?.changed);
    }

    if (input.deleteSession === true) {
      if (!input.sessionId) warnings.push({ code: "MEMORY_SESSION_REQUIRED", message: "deleteSession requires a session ID." });
      else {
        if (operationalContextStore?.deleteSession) {
          const deletedContext = await maybe(operationalContextStore.deleteSession({ workspace: current.workspace, projectId: current.projectId, sessionId: input.sessionId }));
          actions.push({ type: "operational_context_delete", result: clone(deletedContext) });
          if (deletedContext?.ok === false) warnings.push({ code: deletedContext.code, message: deletedContext.error });
          changed = changed || Boolean(deletedContext?.changed);
        }
        if (sessionMemoryStore) {
          const store = typeof sessionMemoryStore === "function" ? sessionMemoryStore() : sessionMemoryStore;
          const deletedTranscript = await maybe(store?.deleteSession?.(current.workspace, input.sessionId));
          actions.push({ type: "transcript_delete", result: clone(deletedTranscript) });
          if (deletedTranscript?.ok === false) warnings.push({ code: deletedTranscript.code, message: deletedTranscript.error });
          changed = changed || Boolean(deletedTranscript?.removed);
        }
      }
    }

    const result = {
      ok: warnings.length === 0,
      operationId,
      project_id: current.projectId,
      previousRevision: 0,
      revision: 0,
      changed,
      conflicts: [],
      warnings: warnings.slice(0, 100),
      actions,
      retained_semantic_history: true,
      generated_at: timestamp(now),
    };
    if (auditStore?.append) {
      const audited = auditStore.append(current.workspace, current.projectId, {
        operationId,
        category: "memory_maintenance",
        state: result.ok ? (changed ? "completed" : "no_op") : "degraded",
        changed,
        warningCount: result.warnings.length,
        details: { action_count: actions.length, semantic_history: "retained" },
      });
      if (audited?.ok === false) {
        result.warnings.push({ code: audited.code, message: "Maintenance completed but its redacted audit record could not be written." });
        result.ok = false;
      }
    }
    memoryStatus?.update?.({ project_id: current.projectId }, "sensitive_store", { state: result.ok ? "healthy" : "degraded", code: result.ok ? "" : "MEMORY_MAINTENANCE_DEGRADED", message: result.ok ? "Retention maintenance completed." : "Retention maintenance requires attention.", details: { changed } });
    return result;
  }

  function defaultWorkloads(current, input) {
    const sessionId = text(input.sessionId || input.session_id);
    return {
      startup: () => manifestStore?.status?.(current.workspace, current.projectId) || { ok: true, skipped: true },
      finalization: () => watermarkStore?.status?.(current.workspace, current.projectId) || { ok: true, skipped: true },
      retrieval: () => retrievalService?.query?.({ workspace: current.workspace, project_id: current.projectId, objective: "maintenance benchmark", domains: ["project"], limit: 50, token_budget: 4_000, sensitivity_ceiling: "confidential" }) || { ok: true, skipped: true },
      compression: () => sessionId && contextCheckpoint?.status?.({ workspace: current.workspace, projectId: current.projectId, sessionId }) || { ok: true, skipped: true },
      rebuild: () => derivedProjection?.rebuild?.({ workspace: current.workspace, projectId: current.projectId }) || graphView?.rebuild?.({ workspace: current.workspace, projectId: current.projectId }) || { ok: true, skipped: true },
      large_history: () => eventStore?.status?.(current.workspace, current.projectId, "execution") || { ok: true, skipped: true },
    };
  }

  async function benchmark(input = {}) {
    let current;
    try { current = scope(input); } catch (error) { return operationFailure(error.code || "MEMORY_BENCHMARK_INPUT_INVALID", error.message, error.details || {}); }
    if (!current?.ok) return current;
    const iterations = Math.min(MAX_ITERATIONS, Math.max(1, Math.floor(number(input.iterations, DEFAULT_ITERATIONS))));
    const defaults = defaultWorkloads(current, input);
    const supplied = input.workloads && typeof input.workloads === "object" ? input.workloads : {};
    const names = ["startup", "finalization", "retrieval", "compression", "rebuild", "large_history"];
    const results = {};
    for (const name of names) {
      const workload = typeof supplied[name] === "function" ? supplied[name] : defaults[name];
      if (typeof workload !== "function") {
        results[name] = { measured: false, passed: false, reason: "workload_unavailable" };
        continue;
      }
      const samples = [];
      let failed = null;
      for (let index = 0; index < iterations; index += 1) {
        const started = performance.now();
        try {
          const value = await workload({ workspace: current.workspace, projectId: current.projectId, iteration: index, input: clone(input) });
          if (value?.ok === false) failed = value;
        } catch (error) {
          failed = { ok: false, code: error.code || "MEMORY_BENCHMARK_WORKLOAD_FAILED", error: error.message };
        }
        samples.push(Number((performance.now() - started).toFixed(3)));
        if (failed) break;
      }
      const thresholdKey = name === "retrieval" ? "common_memory_query_p95" : name === "compression" ? "compression_p95" : name === "rebuild" ? "rebuild_p95" : name === "large_history" ? "large_history_p95" : `${name}_p95`;
      const threshold = PERFORMANCE_THRESHOLDS_MS[thresholdKey] || PERFORMANCE_THRESHOLDS_MS.common_memory_query_p95;
      const p95 = percentile(samples, 0.95);
      results[name] = {
        measured: true,
        iterations: samples.length,
        samples_ms: samples,
        min_ms: Number(Math.min(...samples).toFixed(3)),
        max_ms: Number(Math.max(...samples).toFixed(3)),
        p50_ms: percentile(samples, 0.50),
        p95_ms: p95,
        threshold_ms: threshold,
        passed: !failed && p95 <= threshold,
        ...(failed ? { failure: { code: failed.code, error: text(failed.error, 500) } } : {}),
      };
    }
    const result = {
      ok: Object.values(results).every((entry) => entry.passed === true),
      version: MEMORY_MAINTENANCE_SERVICE_VERSION,
      project_id: current.projectId,
      generated_at: timestamp(now),
      iterations,
      thresholds_ms: PERFORMANCE_THRESHOLDS_MS,
      results,
    };
    benchmarks.set(`${current.workspace}|${current.projectId}`, clone(result));
    return result;
  }

  function status(input = {}) {
    let current;
    try { current = scope(input, { requireProject: false }); } catch (error) { return operationFailure(error.code || "MEMORY_MAINTENANCE_INPUT_INVALID", error.message); }
    if (!current?.ok) return current;
    return { ok: true, version: MEMORY_MAINTENANCE_SERVICE_VERSION, project_id: current.projectId, last_benchmark: clone(benchmarks.get(`${current.workspace}|${current.projectId}`) || null), thresholds_ms: PERFORMANCE_THRESHOLDS_MS };
  }

  return Object.freeze({ MEMORY_MAINTENANCE_SERVICE_VERSION, PERFORMANCE_THRESHOLDS_MS, cleanup, retention: cleanup, benchmark, status });
}

module.exports = Object.freeze({ MEMORY_MAINTENANCE_SERVICE_VERSION, PERFORMANCE_THRESHOLDS_MS, percentile, createMemoryMaintenanceService });
