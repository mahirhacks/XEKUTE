"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/index.js");
const { createExecutionEvent } = require("../../../domain/memory/execution/execution-events.js");
const { clone, operationFailure, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const BLOCK_CAPTURE_VERSION = 1;
const TERMINAL_EVENT_TYPES = new Set(["block_completed", "block_failed", "block_cancelled", "block_interrupted"]);

function createExecutionCapture({
  eventStore,
  artifactRegistry = null,
  fs = null,
  path = null,
  crypto = nodeCrypto,
  now = () => new Date(),
  idFactory = null,
} = {}) {
  if (!eventStore?.append) throw new TypeError("Execution capture requires an event store.");
  const captures = new Map();

  function id(prefix) {
    return typeof idFactory === "function"
      ? idFactory(prefix)
      : createOpaqueId(prefix, { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
  }

  function key(workspace, projectId, blockId) { return `${resolvedWorkspace(path || require("node:path"), workspace)}|${projectId}|${blockId}`; }
  function inputId(value, prefix) { return assertMemoryId(value, prefix); }

  function createBlock({ workspace, projectId, blockId = "", operationId = "", sessionId = "", agentId = "execution-capture", actor = null, authority = {} } = {}) {
    let root;
    try {
      if (!path) root = String(workspace || "");
      else root = resolvedWorkspace(path, workspace);
      inputId(projectId, "proj");
      blockId = inputId(blockId || id("block"), "block");
      operationId = inputId(operationId || id("op"), "op");
      if (sessionId) inputId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_EXECUTION_CAPTURE_INPUT_INVALID", error.message, error.details || {});
    }
    const captureKey = key(root, projectId, blockId);
    const existing = captures.get(captureKey);
    if (existing) {
      if (existing.operationId !== operationId) return operationFailure("MEMORY_EXECUTION_BLOCK_CONFLICT", "The block is already captured by another operation.", { blockId, operationId: existing.operationId });
      return existing.publicState();
    }
    const state = {
      version: BLOCK_CAPTURE_VERSION,
      workspace: root,
      projectId,
      blockId,
      operationId,
      sessionId,
      agentId: String(agentId || "execution-capture").slice(0, 240),
      actor: actor || { type: "agent", id: String(agentId || "execution-capture").slice(0, 240) },
      authority: authority && typeof authority === "object" ? clone(authority) : {},
      blockSequence: 0,
      firstSequence: 0,
      lastSequence: 0,
      events: [],
      sealed: false,
      terminal: null,
      busy: Promise.resolve(),
    };
    state.publicState = () => ({
      ok: true,
      version: state.version,
      workspace: state.workspace,
      projectId: state.projectId,
      blockId: state.blockId,
      operationId: state.operationId,
      sessionId: state.sessionId,
      blockSequence: state.blockSequence,
      firstSequence: state.firstSequence,
      lastSequence: state.lastSequence,
      eventCount: state.events.length,
      sealed: state.sealed,
      terminal: clone(state.terminal),
    });
    state.enqueue = (operation) => {
      const prior = state.busy;
      const next = prior.catch(() => {}).then(operation);
      state.busy = next.catch(() => {});
      return next;
    };
    captures.set(captureKey, state);

    const capture = {
      state: state.publicState,
      append: (eventType, payload = {}, options = {}) => state.enqueue(async () => {
        if (state.sealed) {
          if (TERMINAL_EVENT_TYPES.has(eventType) && state.terminal?.event_type === eventType) return { ok: true, changed: false, duplicate: true, event: clone(state.terminal), capsule: capsuleOf(state) };
          return operationFailure("MEMORY_EXECUTION_BLOCK_SEALED", "No execution events can be appended after block sealing.", { blockId: state.blockId });
        }
        state.blockSequence += 1;
        let event;
        try {
          event = createExecutionEvent({
            ...options,
            project_id: state.projectId,
            block_id: state.blockId,
            operation_id: state.operationId,
            event_type: eventType,
            block_sequence: state.blockSequence,
            actor: options.actor || state.actor,
            authority: options.authority || state.authority,
            payload,
            provenance: options.provenance || {
              source_type: "runtime_event",
              source_refs: [`block:${state.blockId}`],
              captured_at: timestamp(now),
              ...(options.tool_name ? { tool_name: options.tool_name } : {}),
            },
            event_id: options.event_id || options.eventId || id("event"),
          }, { now, crypto, idFactory });
        } catch (error) {
          state.blockSequence -= 1;
          return operationFailure(error.code || "MEMORY_EXECUTION_EVENT_INVALID", error.message, error.details || {});
        }
        const persisted = await eventStore.append(state.workspace, state.projectId, "execution", event);
        if (!persisted.ok) {
          state.blockSequence -= 1;
          return persisted;
        }
        const stored = persisted.event || event;
        state.events.push(clone(stored));
        state.firstSequence = state.firstSequence || Number(persisted.sequence || stored.sequence || 0);
        state.lastSequence = Number(persisted.sequence || stored.sequence || state.lastSequence);
        return { ok: true, changed: Boolean(persisted.changed), duplicate: Boolean(persisted.duplicate), event: clone(stored), sequence: state.lastSequence, capsule: capsuleOf(state) };
      }),
      toolInvocation: ({ toolName, invocationId = "", argumentKeys = [], authority = {}, sourceIds = [] } = {}) => capture.append("tool_invocation_started", {
        tool_name: String(toolName || "tool").slice(0, 160),
        invocation_id: String(invocationId || id("event")).slice(0, 240),
        argument_keys: [...new Set((Array.isArray(argumentKeys) ? argumentKeys : []).map((value) => String(value).slice(0, 120)).filter(Boolean))].slice(0, 100),
      }, { authority, source_ids: sourceIds, tool_name: toolName }),
      toolResult: ({ toolName, invocationId = "", outcome = "completed", summary = "", artifactRefs = [], sourceIds = [], authority = {} } = {}) => capture.append("tool_result_captured", {
        tool_name: String(toolName || "tool").slice(0, 160),
        invocation_id: String(invocationId || "").slice(0, 240),
        outcome: String(outcome || "completed").slice(0, 80),
        summary: String(summary || "").slice(0, 2_000),
      }, { artifact_refs: artifactRefs, source_ids: sourceIds, authority, tool_name: toolName }),
      verification: ({ verdict, findingId = "", summary = "", evidenceRefs = [], sourceIds = [] } = {}) => capture.append("verification_verdict", {
        verdict: String(verdict || "inconclusive").slice(0, 80),
        finding_id: String(findingId || "").slice(0, 240),
        summary: String(summary || "").slice(0, 2_000),
      }, { artifact_refs: evidenceRefs, source_ids: sourceIds }),
      processState: (payload = {}) => capture.append("process_state", payload),
      specialistReturn: (payload = {}, options = {}) => capture.append("specialist_return", payload, options),
      operatorAssertion: (payload = {}, options = {}) => capture.append("operator_assertion", payload, { ...options, actor: options.actor || { type: "operator", id: "operator" }, provenance: options.provenance || { source_type: "operator_assertion", source_refs: [`block:${state.blockId}`], captured_at: timestamp(now) } }),
      registerArtifact: async (input = {}) => {
        if (!artifactRegistry?.register) return operationFailure("MEMORY_ARTIFACT_REGISTRY_UNAVAILABLE", "The artifact registry is unavailable.", {}, true);
        const result = artifactRegistry.register(state.workspace, state.projectId, input);
        if (!result.ok) return result;
        const event = await capture.append("artifact_registered", { artifact_id: result.artifactId, kind: result.artifact?.kind || "artifact", integrity_state: result.artifact?.integrity_state || "unknown" }, { artifact_refs: [result.artifactId], source_ids: [result.artifactId] });
        return { ...result, event };
      },
      seal: ({ status = "completed", outcome = "completed", summary = "" } = {}) => state.enqueue(async () => {
        const eventType = status === "failed" ? "block_failed" : status === "cancelled" ? "block_cancelled" : status === "interrupted" ? "block_interrupted" : "block_completed";
        if (state.sealed) {
          if (state.terminal?.event_type === eventType) return { ok: true, changed: false, duplicate: true, event: clone(state.terminal), capsule: capsuleOf(state) };
          return operationFailure("MEMORY_EXECUTION_BLOCK_CONFLICT", "The block was already sealed with another terminal status.", { blockId: state.blockId, terminalType: state.terminal?.event_type });
        }
        // Use append's queue only after releasing this operation. Calling the
        // public append here would wait on the same promise, so persist the
        // terminal event directly with the same validation path.
        state.blockSequence += 1;
        let event;
        try {
          event = createExecutionEvent({
            project_id: state.projectId,
            block_id: state.blockId,
            operation_id: state.operationId,
            event_type: eventType,
            block_sequence: state.blockSequence,
            actor: state.actor,
            authority: state.authority,
            payload: { status, outcome, summary: String(summary || "").slice(0, 2_000), event_count: state.events.length },
            provenance: { source_type: "runtime_event", source_refs: [`block:${state.blockId}`], captured_at: timestamp(now) },
            event_id: id("event"),
          }, { now, crypto, idFactory });
        } catch (error) {
          state.blockSequence -= 1;
          return operationFailure(error.code || "MEMORY_EXECUTION_EVENT_INVALID", error.message, error.details || {});
        }
        const persisted = await eventStore.append(state.workspace, state.projectId, "execution", event);
        if (!persisted.ok) {
          state.blockSequence -= 1;
          return persisted;
        }
        state.terminal = clone(persisted.event || event);
        state.events.push(clone(state.terminal));
        state.firstSequence = state.firstSequence || Number(persisted.sequence || state.terminal.sequence || 0);
        state.lastSequence = Number(persisted.sequence || state.terminal.sequence || state.lastSequence);
        state.sealed = true;
        const capsule = capsuleOf(state);
        return { ok: true, changed: Boolean(persisted.changed), duplicate: Boolean(persisted.duplicate), event: clone(state.terminal), capsule };
      }),
      capsule: () => capsuleOf(state),
      events: () => clone(state.events),
      close: () => { captures.delete(captureKey); return { ok: true, changed: true }; },
    };
    return { ok: true, capture };
  }

  function capsuleOf(state) {
    return {
      version: BLOCK_CAPTURE_VERSION,
      project_id: state.projectId,
      block_id: state.blockId,
      operation_id: state.operationId,
      first_sequence: state.firstSequence,
      last_sequence: state.lastSequence,
      event_count: state.events.length,
      event_ids: state.events.map((event) => event.event_id),
      sealed: state.sealed,
      terminal_event_id: state.terminal?.event_id || "",
      status: state.terminal?.payload?.status || (state.sealed ? "completed" : "open"),
    };
  }

  function get(workspace, projectId, blockId) {
    try { assertMemoryId(projectId, "proj"); assertMemoryId(blockId, "block"); } catch (error) { return operationFailure(error.code || "MEMORY_EXECUTION_CAPTURE_INPUT_INVALID", error.message, error.details || {}); }
    return captures.get(key(workspace, projectId, blockId))?.publicState() || operationFailure("MEMORY_EXECUTION_BLOCK_NOT_FOUND", "The execution block is not active in this process.", { blockId });
  }

  return Object.freeze({ BLOCK_CAPTURE_VERSION, createBlock, get, activeBlocks: () => captures.size });
}

module.exports = Object.freeze({ createExecutionCapture, BLOCK_CAPTURE_VERSION });
