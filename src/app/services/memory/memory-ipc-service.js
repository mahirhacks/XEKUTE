"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/memory-identity.js");
const { createMemoryIpcRequest } = require("../../../contracts/ipc/memory-ipc-contracts.js");
const { operationFailure, clone, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const MEMORY_IPC_SERVICE_VERSION = 1;

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function redacted(value, key = "", depth = 0, seen = new WeakSet()) {
  if (depth > 10) return "[OMITTED_TOO_DEEP]";
  if (/(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|raw[_-]?value|ciphertext)/i.test(String(key || ""))) return undefined;
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
  if (typeof value !== "object") return String(value).slice(0, 2_000);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redacted(entry, "", depth + 1, seen)).filter((entry) => entry !== undefined).slice(0, 500);
  const result = {};
  for (const [childKey, child] of Object.entries(value)) {
    const next = redacted(child, childKey, depth + 1, seen);
    if (next !== undefined) result[childKey] = next;
  }
  return result;
}

function disabled(reason = "memoryUiV2 is disabled") {
  return { ok: true, enabled: false, skipped: true, changed: false, reason };
}

function emptyDomain(projectId, domain) {
  return {
    ok: true,
    enabled: true,
    initialized: false,
    project_id: projectId || "",
    domain,
    revision: 0,
    sourceRevision: 0,
    records: [],
    items: [],
    omitted: 0,
    warnings: [],
  };
}

function createMemoryIpcService({
  container,
  featureFlags = container?.memoryFeatureFlags || {},
  now = () => new Date(),
  crypto = nodeCrypto,
} = {}) {
  if (!container || typeof container !== "object") throw new TypeError("Memory IPC service requires the DI container.");

  function enabled() { return featureFlags.memoryUiV2 === true; }

  function resolve(input, { requireProject = false } = {}) {
    const workspace = input.workspace;
    const requestedProjectId = input.project_id || input.projectId || "";
    const resolver = container.memoryProjectIdentityStore;
    if (!resolver?.resolveProject) return operationFailure("MEMORY_PROJECT_REGISTRY_UNAVAILABLE", "The protected project registry is unavailable.", {}, true);
    const identity = resolver.resolveProject(workspace, { persist: false, projectId: requestedProjectId });
    if (!identity?.ok) return identity;
    if (requestedProjectId && !identity.persisted) {
      return operationFailure("MEMORY_PROJECT_NOT_BOUND", "The requested project ID is not bound to this workspace in the protected registry.", { projectId: requestedProjectId }, false);
    }
    if (requireProject && !identity.projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "The workspace has no initialized project memory.", { workspace: identity.workspace });
    return identity;
  }

  function projectScope(input, options = {}) {
    const identity = resolve(input, options);
    if (!identity?.ok) return identity;
    return { ...identity, projectId: identity.projectId || "", workspace: identity.workspace };
  }

  async function status(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:status", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return { ...disabled(), project_id: request.project_id, session_id: request.session_id };
    const scope = projectScope(request);
    if (!scope.ok) return scope;
    const projectId = scope.projectId;
    const base = container.memoryStatus?.read?.({ project_id: projectId, session_id: request.session_id }) || { ok: true, dimensions: {} };
    const result = {
      ok: true,
      enabled: true,
      schema_version: MEMORY_IPC_SERVICE_VERSION,
      project_id: projectId,
      session_id: request.session_id,
      initialized: Boolean(projectId),
      workspace: { bound: Boolean(projectId), source: scope.source || "uninitialized", warning: scope.warning || "" },
      dimensions: clone(base.dimensions || {}),
      domains: {},
      finalization: null,
      outbox: null,
      projections: {},
      warnings: [],
      updated_at: timestamp(now),
    };
    if (!projectId) return result;
    const tasks = [
      ["project", container.memoryProjectMemoryRepository?.status?.(scope.workspace, projectId)],
      ["investigation", container.memoryInvestigationMemoryRepository?.status?.(scope.workspace, projectId)],
      ["evidence", container.memoryEvidenceMemoryRepository?.status?.(scope.workspace, projectId)],
    ];
    const loadedDomains = await Promise.all(tasks.map(async ([domain, value]) => [domain, value && typeof value.then === "function" ? await value : value]));
    for (const [domain, loaded] of loadedDomains) if (loaded) result.domains[domain] = redacted(loaded);
    const finalization = container.memoryWatermarkStore?.status?.(scope.workspace, projectId);
    if (finalization?.ok) result.finalization = redacted(finalization.watermark || finalization);
    else if (finalization?.ok === false) result.warnings.push({ code: finalization.code, message: finalization.error });
    const outbox = container.memoryOutboxStore?.list?.(scope.workspace, projectId, { limit: 200 });
    if (outbox?.ok) result.outbox = redacted(outbox);
    else if (outbox?.ok === false) result.warnings.push({ code: outbox.code, message: outbox.error });
    const sqlite = container.memoryDerivedMemoryIndex?.overview?.(scope.workspace, projectId);
    if (sqlite?.ok) result.projections.sqlite = redacted(sqlite);
    const graph = container.memoryGraphView?.status?.(scope.workspace, projectId);
    if (graph?.ok) result.projections.graph = redacted(graph);
    const checkpoint = request.session_id ? container.memoryContextCheckpoint?.status?.({ workspace: scope.workspace, projectId, sessionId: request.session_id }) : null;
    if (checkpoint?.ok) result.projections.checkpoint = redacted(checkpoint);
    const dimension = (state, patch = {}) => ({
      state,
      code: text(patch.code, 120),
      message: text(patch.message || patch.error, 1_000),
      retryable: Boolean(patch.retryable),
      details: redacted(patch.details || {}),
      updated_at: timestamp(now),
    });
    const domainFailure = loadedDomains.find(([, loaded]) => loaded?.ok === false);
    const initializedDomain = loadedDomains.some(([, loaded]) => loaded?.initialized === true);
    if (domainFailure) result.dimensions.durability = dimension("failed", { code: domainFailure[1].code, message: domainFailure[1].error, retryable: Boolean(domainFailure[1].retryable), details: { domain: domainFailure[0] } });
    else if (initializedDomain && result.dimensions.durability?.state === "unknown") result.dimensions.durability = dimension("healthy", { details: { domains: loadedDomains.length } });

    const watermark = result.finalization || {};
    if (watermark.failure_state || (Array.isArray(watermark.failed_operations) && watermark.failed_operations.length)) {
      result.dimensions.semantic_finalization = dimension("failed", { code: watermark.failure_state?.code || "MEMORY_FINALIZATION_FAILED", message: watermark.failure_state?.message || "One or more memory finalizations failed.", retryable: Boolean(watermark.failure_state?.retryable), details: { failed_operations: watermark.failed_operations?.length || 0 } });
    } else if (Number(watermark.pending_finalization_count || 0) > 0) {
      result.dimensions.semantic_finalization = dimension("pending", { code: "MEMORY_FINALIZATION_PENDING", message: "A sealed block is waiting for semantic finalization.", retryable: true, details: { pending: Number(watermark.pending_finalization_count) || 0 } });
    } else if (watermark.initialized) {
      result.dimensions.semantic_finalization = dimension("healthy", { details: { latest_applied_position: Number(watermark.latest_applied_position) || 0 } });
    }

    if (result.outbox) {
      const entries = Array.isArray(result.outbox.entries) ? result.outbox.entries : [];
      const pending = Number(result.outbox.pendingCount || result.outbox.pending_count || 0) || entries.filter((entry) => ["pending", "processing", "interrupted"].includes(entry?.state)).length;
      const failed = entries.filter((entry) => entry?.state === "failed").length;
      result.dimensions.outbox = failed > 0
        ? dimension("failed", { code: "MEMORY_OUTBOX_FAILED", message: "One or more memory outbox operations failed.", retryable: true, details: { failed } })
        : pending > 0
          ? dimension("pending", { code: "MEMORY_OUTBOX_PENDING", message: "Memory destinations are still being applied.", retryable: true, details: { pending } })
          : result.outbox.initialized ? dimension("healthy", { details: { entries: entries.length } }) : result.dimensions.outbox;
    }

    if (featureFlags.derivedMemoryViews !== true) result.dimensions.projection = dimension("disabled", { code: "MEMORY_DERIVED_VIEWS_DISABLED", message: "Derived SQLite and graph views are disabled by feature flag." });
    else {
      const projectionStates = [result.projections.sqlite?.status, result.projections.graph?.status].filter(Boolean);
      if (projectionStates.includes("building")) result.dimensions.projection = dimension("pending", { code: "MEMORY_PROJECTION_PENDING", message: "A derived memory projection is rebuilding.", retryable: true });
      else if (projectionStates.length && projectionStates.every((status) => ["idle", "ready"].includes(status))) result.dimensions.projection = dimension("healthy", { details: { projections: projectionStates.length } });
    }

    if (request.session_id) {
      result.dimensions.summarization = checkpoint?.ok
        ? dimension("healthy", { details: { session: "bound" } })
        : dimension("unknown", { code: checkpoint?.code || "MEMORY_CHECKPOINT_UNAVAILABLE", message: checkpoint?.error || "No active context checkpoint is available." });
    }
    result.dimensions.sensitive_store = featureFlags.sensitiveWorkingMemory === true
      ? dimension("healthy", { details: { protection: "opaque_handles_only" } })
      : dimension("disabled", { code: "MEMORY_SENSITIVE_STORE_DISABLED", message: "Sensitive Working Memory is disabled by feature flag." });
    const migration = container.memoryMigration?.status?.(scope.workspace, projectId);
    if (migration?.ok) {
      const migrationState = ["idle", "healthy", "pending", "failed", "degraded"].includes(migration.state) ? migration.state : "unknown";
      result.dimensions.migration = dimension(migrationState, {
        code: migrationState === "failed" ? "MEMORY_MIGRATION_FAILED" : migrationState === "pending" ? "MEMORY_MIGRATION_PENDING" : "",
        message: migrationState === "idle" ? "No migration batch has been recorded for this project." : migrationState === "healthy" ? "Legacy migration metadata is healthy." : migrationState === "pending" ? "Legacy migration work is pending recovery or completion." : migrationState === "degraded" ? "A migration batch was rolled back and canonical records remain excluded by metadata." : migration.warning || "Migration status is unavailable.",
        retryable: migrationState === "pending" || migrationState === "failed",
        details: { batch_count: migration.batch_count || 0, pending_count: migration.pending_count || 0, failed_count: migration.failed_count || 0, rolled_back_count: migration.rolled_back_count || 0 },
      });
    } else {
      result.dimensions.migration = dimension("disabled", { code: "MEMORY_MIGRATION_DISABLED", message: "Migration is not configured for this project." });
    }
    const audit = container.memoryAuditStore?.summary?.(scope.workspace, projectId);
    if (audit?.ok) {
      result.audit = redacted(audit);
      if (audit.warnings?.length) result.warnings.push(...audit.warnings.map((warning) => ({ code: warning.code, message: "Memory audit diagnostics require attention." })));
    } else if (audit?.ok === false) result.warnings.push({ code: audit.code, message: audit.error });
    const maintenance = container.memoryMaintenance?.status?.({ workspace: scope.workspace, projectId });
    if (maintenance?.ok) result.maintenance = redacted(maintenance);
    else if (maintenance?.ok === false) result.warnings.push({ code: maintenance.code, message: "Memory maintenance status is unavailable." });
    return result;
  }

  async function diagnostics(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:diagnostics", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope;
    if (!scope.projectId) return { ok: true, enabled: true, project_id: "", records: [], total: 0, verification: { ok: true, records: 0, warnings: [] } };
    const auditStore = container.memoryAuditStore;
    if (!auditStore?.list) return operationFailure("MEMORY_AUDIT_UNAVAILABLE", "Memory audit diagnostics are unavailable.", {}, true);
    const listed = auditStore.list(scope.workspace, scope.projectId, { limit: request.limit, cursor: request.cursor });
    if (!listed?.ok) return redacted(listed);
    const verification = request.verify && auditStore.verify ? auditStore.verify(scope.workspace, scope.projectId) : null;
    return redacted({ ok: true, enabled: true, project_id: scope.projectId, records: listed.records, total: listed.total, nextCursor: listed.nextCursor, warnings: listed.warnings, verification });
  }

  async function queryDomain(channel, input, domain, repository) {
    let request;
    try { request = createMemoryIpcRequest(channel, input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope.code === "MEMORY_PROJECT_UNINITIALIZED" ? emptyDomain("", domain) : scope;
    if (!scope.projectId) return emptyDomain("", domain);
    if (!repository?.query) return operationFailure("MEMORY_DOMAIN_UNAVAILABLE", `The ${domain} memory query service is unavailable.`, { domain }, true);
    const result = await repository.query(scope.workspace, scope.projectId, { ...request, project_id: scope.projectId });
    return result?.ok === false ? result : redacted({ ...result, enabled: true, project_id: scope.projectId, domain });
  }

  async function graphQuery(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:graphQuery", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope.code === "MEMORY_PROJECT_UNINITIALIZED" ? emptyDomain("", "graph") : scope;
    if (!scope.projectId) return emptyDomain("", "graph");
    if (request.operation === "status") return redacted(container.memoryGraphView?.status?.(scope.workspace, scope.projectId) || { ok: false, code: "MEMORY_GRAPH_UNAVAILABLE", error: "The memory graph is unavailable." });
    if (request.operation === "rebuild") {
      const rebuilt = await container.memoryGraphView?.rebuild?.({ workspace: scope.workspace, projectId: scope.projectId });
      return redacted(rebuilt || operationFailure("MEMORY_GRAPH_UNAVAILABLE", "The memory graph is unavailable."));
    }
    const graphView = container.memoryGraphView;
    if (!graphView?.query) return operationFailure("MEMORY_GRAPH_UNAVAILABLE", "The memory graph query service is unavailable.", {}, true);
    const result = graphView.query(scope.workspace, scope.projectId, {
      operation: request.operation,
      node_id: request.node_id,
      from: request.from,
      to: request.to,
      query: request.query,
      edge_types: request.edge_types,
      depth: request.depth,
      limit: request.limit,
      cursor: request.cursor,
    });
    return redacted(result);
  }

  function artifactList(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:artifactList", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope.code === "MEMORY_PROJECT_UNINITIALIZED" ? emptyDomain("", "artifact") : scope;
    if (!scope.projectId) return emptyDomain("", "artifact");
    const result = container.memoryArtifactRegistry?.list?.(scope.workspace, scope.projectId, request);
    return redacted(result || operationFailure("MEMORY_ARTIFACT_REGISTRY_UNAVAILABLE", "The artifact registry is unavailable.", {}, true));
  }

  function artifactExpand(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:artifactExpand", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request, { requireProject: true });
    if (!scope.ok) return scope;
    const result = container.memoryArtifactRegistry?.expand?.(scope.workspace, scope.projectId, request.artifact_id, { maxBytes: request.max_bytes, maxChars: request.max_chars, includeRaw: false });
    return redacted(result || operationFailure("MEMORY_ARTIFACT_REGISTRY_UNAVAILABLE", "The artifact registry is unavailable.", {}, true));
  }

  function checkpoint(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:checkpoint", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request, { requireProject: true });
    if (!scope.ok) return scope;
    const result = container.memoryContextCheckpoint?.read?.({ workspace: scope.workspace, projectId: scope.projectId, sessionId: request.session_id });
    return redacted(result || operationFailure("MEMORY_CONTEXT_UNAVAILABLE", "Operational Context is unavailable.", {}, true));
  }

  async function finalizationHealth(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:finalizationHealth", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request, { requireProject: true });
    if (!scope.ok) return scope;
    const watermarkStore = container.memoryWatermarkStore;
    if (!watermarkStore?.status) return operationFailure("MEMORY_WATERMARK_UNAVAILABLE", "The finalization watermark is unavailable.", {}, true);
    const waited = request.wait_ms > 0 && request.block_id
      ? await watermarkStore.waitFor(scope.workspace, scope.projectId, { blockId: request.block_id, timeoutMs: request.wait_ms })
      : watermarkStore.status(scope.workspace, scope.projectId);
    if (!waited?.ok) return redacted(waited);
    const watermark = waited.watermark || waited;
    return redacted({ ok: true, enabled: true, project_id: scope.projectId, block_id: request.block_id, pending: Boolean(waited.pending || watermark.pending_finalization_count > 0), satisfied: waited.satisfied !== false, watermark, outbox: container.memoryOutboxStore?.list?.(scope.workspace, scope.projectId, { limit: 50 }) || null, projections: { sqlite: container.memoryDerivedProjection?.status?.(scope.workspace, scope.projectId) || null, graph: container.memoryGraphView?.status?.(scope.workspace, scope.projectId) || null } });
  }

  async function migrationPreview(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:migrationPreview", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const service = container.memoryMigration;
    if (!service?.preview) return { ok: true, enabled: true, available: false, status: "not_configured", project_id: request.project_id || "", warnings: [{ code: "MEMORY_MIGRATION_UNAVAILABLE", message: "Migration preview is not available until Phase N is enabled." }] };
    const scope = projectScope(request);
    if (!scope.ok) return scope;
    return redacted(await service.preview({ ...request, workspace: scope.workspace, projectId: scope.projectId, refresh: request.refresh }));
  }

  async function securityAudit(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:securityAudit", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope;
    const service = container.memorySecurityAudit;
    if (!service?.auditWorkspace) return operationFailure("MEMORY_SECURITY_AUDIT_UNAVAILABLE", "Memory security audit is unavailable.", {}, true);
    return redacted(service.auditWorkspace({
      workspace: scope.workspace,
      projectId: scope.projectId,
      includeLegacyCompatibility: request.include_legacy_compatibility,
    }));
  }

  async function maintenanceStatus(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:maintenanceStatus", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request);
    if (!scope.ok) return scope;
    const service = container.memoryMaintenance;
    if (!service?.status) return operationFailure("MEMORY_MAINTENANCE_UNAVAILABLE", "Memory maintenance is unavailable.", {}, true);
    return redacted(service.status({ workspace: scope.workspace, projectId: scope.projectId }));
  }

  async function maintenanceBenchmark(input = {}) {
    let request;
    try { request = createMemoryIpcRequest("memory:maintenanceBenchmark", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request, { requireProject: true });
    if (!scope.ok) return scope;
    const service = container.memoryMaintenance;
    if (!service?.benchmark) return operationFailure("MEMORY_MAINTENANCE_UNAVAILABLE", "Memory maintenance is unavailable.", {}, true);
    return redacted(await service.benchmark({ workspace: scope.workspace, projectId: scope.projectId, iterations: request.iterations }));
  }

  async function operatorMutation(input = {}, senderId = "") {
    let request;
    try { request = createMemoryIpcRequest("memory:operatorMutation", input); } catch (error) { return operationFailure(error.code || "MEMORY_IPC_REQUEST_INVALID", error.message, error.details || {}); }
    if (!enabled()) return disabled();
    const scope = projectScope(request, { requireProject: true });
    if (!scope.ok) return scope;
    const actorId = `renderer:${text(senderId || "main", 120)}`;
    const provenance = { source_type: "operator_assertion", operator_record_ref: request.operation_id, captured_at: timestamp(now) };
    const commands = request.commands.map((command) => ({
      ...command,
      operation_id: request.operation_id,
      idempotency_key: command.idempotency_key || request.operation_id,
      project_id: scope.projectId,
      memory_type: request.memory_type,
      expected_base_revision: request.expected_revision,
      actor: { type: "operator", id: actorId },
      provenance,
      sensitivity: "internal",
    }));
    const repository = request.memory_type === "project"
      ? container.memoryProjectMemoryRepository
      : request.memory_type === "investigation"
        ? container.memoryInvestigationMemoryRepository
        : container.memoryEvidenceMemoryRepository;
    if (!repository?.apply) return operationFailure("MEMORY_DOMAIN_UNAVAILABLE", `The ${request.memory_type} memory mutation service is unavailable.`, { memoryType: request.memory_type }, true);
    const result = await repository.apply(scope.workspace, scope.projectId, commands);
    return redacted({ ...result, enabled: true, actor: { type: "operator", id: actorId }, memory_type: request.memory_type });
  }

  return Object.freeze({
    MEMORY_IPC_SERVICE_VERSION,
    enabled,
    status,
    diagnostics,
    queryProject: (input) => queryDomain("memory:projectQuery", input, "project", container.memoryProjectMemoryRepository),
    queryInvestigation: (input) => queryDomain("memory:investigationQuery", input, "investigation", container.memoryInvestigationMemoryRepository),
    queryEvidence: (input) => queryDomain("memory:evidenceQuery", input, "evidence", container.memoryEvidenceMemoryRepository),
    graphQuery,
    artifactList,
    artifactExpand,
    checkpoint,
    finalizationHealth,
    migrationPreview,
    securityAudit,
    maintenanceStatus,
    maintenanceBenchmark,
    operatorMutation,
  });
}

module.exports = Object.freeze({ MEMORY_IPC_SERVICE_VERSION, createMemoryIpcService, redacted });
