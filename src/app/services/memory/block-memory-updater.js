"use strict";

const nodeCrypto = require("node:crypto");
const nodePath = require("node:path");
const { assertMemoryId, createOpaqueId, isMemoryId } = require("../../../contracts/memory/index.js");
const { operationFailure, clone } = require("../../storage/memory/memory-storage-utils.js");

// The updater is the application-layer bridge between the live agent loop and
// the durable block finalizer.  It deliberately knows nothing about model
// prompts or renderer state.  A caller may keep using the legacy context
// compiler while this bridge is disabled.
const BLOCK_MEMORY_UPDATER_VERSION = 1;
const SAFE_ID = /^(?:artifact|claim|entity|finding|inv|kb|op|procedure|proj|rel|sel|session|block|attempt|event)_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function workspaceKey(path, workspace) {
  const resolved = path.resolve(String(workspace || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function candidateArtifactRefs(value, result = [], depth = 0) {
  if (depth > 6 || result.length >= 100 || value == null) return result;
  if (typeof value === "string") {
    if (SAFE_ID.test(value) && value.startsWith("artifact_")) result.push(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) candidateArtifactRefs(item, result, depth + 1);
    return result;
  }
  if (typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    // Only inspect reference-shaped fields.  This keeps arbitrary tool output
    // out of the event metadata and avoids treating a body string as a ref.
    if (/(?:artifact|source|evidence|proof).*?(?:id|ref|reference|ids|refs)?$/i.test(key)) {
      candidateArtifactRefs(child, result, depth + 1);
    }
  }
  return result;
}

function safeAuthority(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    profile: text(source.profile || source.authorityProfile || "", 100),
    decision: text(source.decision || source.outcome || "", 100),
    allowed: source.allowed === true,
  };
}

function createBlockMemoryUpdater({
  executionCapture,
  blockFinalizer,
  projectIdentityStore,
  memoryStatus = null,
  memoryAuditStore = null,
  featureFlags = {},
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!executionCapture?.createBlock || !blockFinalizer?.finalize) throw new TypeError("Block memory updater requires capture and finalizer services.");
  if (!projectIdentityStore?.resolveProject) throw new TypeError("Block memory updater requires a project identity service.");
  const active = new Map();
  const completed = new Map();

  function enabled() { return featureFlags.blockMemoryUpdater === true; }
  function key(workspace, externalBlockId, sessionId) {
    return `${workspaceKey(path, workspace)}|${text(externalBlockId, 240)}|${text(sessionId, 240)}`;
  }
  function operationIdFor(workspace, externalBlockId, sessionId) {
    const source = `${workspaceKey(path, workspace)}|${text(externalBlockId, 240)}|${text(sessionId, 240)}`;
    const digest = crypto.createHash("sha256").update(source, "utf8").digest("hex").slice(0, 32);
    return `op_${digest}`;
  }
  function externalBlockId(input) { return text(input.blockId || input.block_id || "", 240); }

  function disabled() { return { ok: true, enabled: false, skipped: true, changed: false }; }

  async function begin(input = {}) {
    if (!enabled()) return disabled();
    const workspace = text(input.workspace, 4_000);
    const external = externalBlockId(input) || `runtime-${Date.now().toString(36)}`;
    const sessionId = text(input.sessionId || input.session_id || "", 240);
    if (!workspace) return operationFailure("MEMORY_BLOCK_WORKSPACE_REQUIRED", "A workspace is required for block memory updates.");
    const lookup = projectIdentityStore.resolveProject(workspace, {
      persist: true,
      projectId: input.projectId || input.project_id || "",
    });
    if (!lookup?.ok) return lookup;
    if (!lookup.projectId) return operationFailure("MEMORY_PROJECT_ID_REQUIRED", "A stable project ID is required for block memory updates.");
    const mapKey = key(workspace, external, sessionId);
    const prior = active.get(mapKey);
    if (prior) return { ok: true, enabled: true, duplicate: true, ...prior.public };
    const created = executionCapture.createBlock({
      workspace: lookup.workspace || workspace,
      projectId: lookup.projectId,
      // The existing session store uses hyphenated IDs.  The v2 execution
      // contract intentionally uses opaque underscore IDs, so retain the
      // external session/block IDs as metadata and generate v2 IDs here.
      operationId: operationIdFor(workspace, external, sessionId),
      sessionId: "",
      agentId: text(input.agentId || "agent-runtime", 240),
      actor: input.actor,
      authority: safeAuthority(input.authority),
    });
    if (!created?.ok) return created;
    const record = {
      mapKey,
      workspace: lookup.workspace || workspace,
      projectId: lookup.projectId,
      externalBlockId: external,
      sessionId,
      capture: created.capture,
      public: {
        projectId: lookup.projectId,
        blockId: created.capture.state().blockId,
        operationId: created.capture.state().operationId,
        externalBlockId: external,
        sessionId,
      },
      startedAt: new Date(now()).toISOString(),
      finalized: false,
    };
    active.set(mapKey, record);
    memoryStatus?.update?.({ project_id: record.projectId }, "durability", { state: "healthy", details: { blockId: record.public.blockId } });
    memoryAuditStore?.append?.(record.workspace, record.projectId, {
      category: "block_begin",
      operationId: record.public.operationId,
      blockId: record.public.blockId,
      state: "healthy",
      details: { phase: "capture" },
    });
    return { ok: true, enabled: true, ...clone(record.public), capture: undefined };
  }

  async function resolve(input = {}) {
    const external = externalBlockId(input);
    const sessionId = text(input.sessionId || input.session_id || "", 240);
    const mapKey = key(input.workspace, external, sessionId);
    const prior = active.get(mapKey);
    if (prior) return { ok: true, record: prior };
    const started = await begin(input);
    if (!started.ok) return started;
    return { ok: true, record: active.get(mapKey), started };
  }

  async function recordInvocation(input = {}) {
    if (!enabled()) return disabled();
    const resolved = await resolve(input);
    if (!resolved.ok) return resolved;
    const record = resolved.record;
    return record.capture.toolInvocation({
      toolName: input.toolName,
      invocationId: input.invocationId,
      argumentKeys: input.argumentKeys,
      authority: safeAuthority(input.authority),
      sourceIds: [record.public.blockId, record.public.operationId],
    });
  }

  async function recordResult(input = {}) {
    if (!enabled()) return disabled();
    const resolved = await resolve(input);
    if (!resolved.ok) return resolved;
    const record = resolved.record;
    const result = input.result && typeof input.result === "object" ? input.result : {};
    const lifecycle = result.lifecycle && typeof result.lifecycle === "object" ? result.lifecycle : {};
    const outcome = text(input.outcome || lifecycle.outcome || result.outcome || (result.ok === false ? "failed" : "completed"), 80);
    const artifacts = [...new Set(candidateArtifactRefs(input.artifactRefs || result, []))].slice(0, 100);
    const captured = record.capture.toolResult({
      toolName: input.toolName,
      invocationId: input.invocationId,
      outcome,
      summary: text(input.summary || lifecycle.summary || (result.ok === false ? result.code || "tool_failed" : "tool_completed"), 2_000),
      artifactRefs: artifacts,
      sourceIds: [record.public.blockId, record.public.operationId],
      authority: safeAuthority(input.authority || lifecycle.authority),
    });
    if (captured?.ok === false) {
      memoryStatus?.update?.({ project_id: record.projectId }, "durability", { state: "failed", code: captured.code || "MEMORY_EXECUTION_CAPTURE_FAILED", message: captured.error || "Execution event capture failed.", retryable: true, details: { phase: "tool_result" } });
    } else {
      memoryStatus?.update?.({ project_id: record.projectId }, "action", { state: outcome === "failed" ? "failed" : "healthy", code: outcome === "failed" ? "TOOL_ACTION_FAILED" : "", details: { phase: "tool_result" } });
    }
    memoryAuditStore?.append?.(record.workspace, record.projectId, {
      category: "tool_result",
      operationId: record.public.operationId,
      blockId: record.public.blockId,
      state: outcome,
      details: { phase: "action" },
    });
    return captured;
  }

  async function recordSpecialistReturn(input = {}) {
    if (!enabled()) return disabled();
    const resolved = await resolve(input);
    if (!resolved.ok) return resolved;
    return resolved.record.capture.specialistReturn({
      ...clone(input.payload || {}),
      session_id: resolved.record.sessionId,
      external_block_id: resolved.record.externalBlockId,
    }, { source_ids: [resolved.record.public.blockId] });
  }

  async function finish(input = {}) {
    if (!enabled()) return disabled();
    const resolved = await resolve(input);
    if (!resolved.ok) return resolved;
    const record = resolved.record;
    const status = text(input.status || input.outcome || "completed", 40).toLowerCase();
    const sealed = await record.capture.seal({
      status: ["completed", "failed", "cancelled", "interrupted"].includes(status) ? status : "completed",
      outcome: text(input.outcome || status, 80),
      summary: text(input.summary || "", 2_000),
    });
    if (!sealed.ok) return sealed;
    const capsule = sealed.capsule || record.capture.capsule();
    const finalized = await blockFinalizer.finalize({
      workspace: record.workspace,
      project_id: record.projectId,
      block_id: capsule.block_id,
      operation_id: capsule.operation_id,
      capsule,
    });
    if (finalized.ok) {
      record.finalized = true;
      active.delete(record.mapKey);
      completed.set(record.mapKey, { ...clone(record.public), finalizedAt: new Date(now()).toISOString(), result: clone(finalized) });
      record.capture.close();
      memoryStatus?.update?.({ project_id: record.projectId }, "semantic_finalization", { state: "healthy", details: { blockId: record.public.blockId, revision: finalized.project?.revision || 0 } });
      memoryStatus?.update?.({ project_id: record.projectId }, "outbox", { state: "healthy", details: { phase: "finalization" } });
      memoryStatus?.update?.({ project_id: record.projectId }, "projection", { state: finalized.projection?.skipped ? "disabled" : "pending", details: { phase: "finalization" } });
      memoryAuditStore?.append?.(record.workspace, record.projectId, {
        category: "block_finalization",
        operationId: record.public.operationId,
        blockId: record.public.blockId,
        state: "healthy",
        changed: finalized.changed,
        revision: finalized.project?.revision || 0,
        recordCount: finalized.reduction?.project_candidates || 0,
        warningCount: finalized.warnings?.length || finalized.residues?.length || 0,
        eventRangeHash: finalized.reduction?.event_range_hash,
        reductionHash: finalized.reduction?.reduction_hash,
        details: { phase: "semantic_finalization" },
      });
    } else {
      memoryStatus?.update?.({ project_id: record.projectId }, "semantic_finalization", { state: "failed", code: finalized.code || "MEMORY_FINALIZATION_FAILED", message: finalized.error || "Memory finalization failed.", retryable: Boolean(finalized.retryable), details: { phase: "semantic_finalization" } });
      memoryAuditStore?.append?.(record.workspace, record.projectId, {
        category: "block_finalization",
        operationId: record.public.operationId,
        blockId: record.public.blockId,
        state: "failed",
        code: finalized.code || "MEMORY_FINALIZATION_FAILED",
        retryable: Boolean(finalized.retryable),
        warningCount: finalized.residues?.length || 0,
        details: { phase: "semantic_finalization" },
      });
    }
    return { ...finalized, externalBlockId: record.externalBlockId, sessionId: record.sessionId };
  }

  function status(input = {}) {
    if (!enabled()) return disabled();
    const mapKey = key(input.workspace, externalBlockId(input), input.sessionId || input.session_id || "");
    const current = active.get(mapKey);
    const prior = completed.get(mapKey);
    return { ok: true, enabled: true, active: Boolean(current), completed: Boolean(prior), ...(current ? clone(current.public) : prior ? clone(prior) : {}) };
  }

  function close(input = {}) {
    const mapKey = key(input.workspace, externalBlockId(input), input.sessionId || input.session_id || "");
    const current = active.get(mapKey);
    if (!current) return { ok: true, changed: false };
    active.delete(mapKey);
    current.capture.close();
    return { ok: true, changed: true };
  }

  return Object.freeze({
    BLOCK_MEMORY_UPDATER_VERSION,
    enabled,
    begin,
    recordInvocation,
    recordResult,
    recordSpecialistReturn,
    finish,
    status,
    close,
    activeBlocks: () => active.size,
  });
}

module.exports = Object.freeze({ createBlockMemoryUpdater, BLOCK_MEMORY_UPDATER_VERSION });
