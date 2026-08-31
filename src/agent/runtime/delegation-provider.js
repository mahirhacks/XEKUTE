"use strict";

// Runtime implementation for delegate_agent. Production Electron runs use the
// injected coordinator so child turns are background jobs; isolated adapter
// tests may omit it and retain the synchronous provider contract.

const crypto = require("node:crypto");
const { redactStructuredValue, redactSecrets } = require("../../shared/secret-redaction.js");
const { inferEditTarget, isEditRequest } = require("./prompt-context.js");

const MAX_TASK_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 32_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_ACTIONS = 50;
const WORKSPACE_MUTATION_TOOLS = new Set(["apply_patch"]);
const LIFECYCLE_EVENTS = new Set(["subagent_queued", "subagent_started", "subagent_activity", "subagent_completed", "subagent_stopped", "subagent_failed"]);

// Tier 1's encrypted transcript/checkpoint store is keyed by a stable
// session identity, not by the random run ID generated for one child turn.
// Keep this derivation aligned with main.js so child finalization and the
// child controller reopen the same durable session after a restart.
function memorySessionIdFor(rawSessionId, stableKey = "") {
  const value = String(rawSessionId || "").trim();
  if (/^session_[a-z0-9._:-]{8,240}$/i.test(value)) return value;
  const digest = crypto.createHash("sha256").update(`${value}|${String(stableKey || "")}`).digest("hex").slice(0, 40);
  return `session_${digest}`;
}

function oneLiner(task, fallback = "") {
  const value = String(task || "").trim().replace(/\s+/g, " ");
  return (value || String(fallback || "")).slice(0, 160);
}

function buildChildContextText(input, executionContext) {
  const contextPackage = input?.contextPackage && typeof input.contextPackage === "object"
    ? { ...input.contextPackage }
    : {};
  const safeContext = redactStructuredValue({
    task: String(input?.task || "").slice(0, MAX_TASK_CHARS),
    context: contextPackage,
    expectedOutput: input?.expectedOutput || {},
    inheritedRuntime: {
      mode: executionContext?.mode || executionContext?.role || "agent",
      workspace: executionContext?.workspace?.root || "",
      parentInvocationId: executionContext?.invocationId || "",
    },
  });
  let contextText = JSON.stringify(safeContext, null, 2);
  if (contextText.length > MAX_CONTEXT_CHARS) contextText = `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n[bounded by XEKUTE]`;
  return contextText;
}

function requestedWorkspaceMutation(input = {}) {
  const task = String(input?.task || "");
  const target = inferEditTarget(task, null, "")
    || (/\b(?:create|write|edit|modify|update|patch|replace|save)\b[\s\S]{0,120}?\b([\w./\\-]+\.[a-z0-9]{1,12})\b/i.exec(task)?.[1] || "");
  return { required: Boolean(target && isEditRequest(task)), target: String(target || "").replace(/\\/g, "/") };
}

function isModelAvailabilityFailure(result = {}) {
  if (result?.ok !== false || result?.aborted) return false;
  const detail = `${result?.code || ""} ${result?.error || ""}`;
  return /(?:openrouter[^\n]*\b404\b|no endpoints? available|model[^\n]*(?:not found|unavailable)|provider[^\n]*(?:not available|unavailable))/i.test(detail);
}

function childResultStatus(result = {}, mutation = {}, actions = []) {
  if (result?.aborted) return "stopped";
  if (result?.ok === false) return "failed";
  const runtimeStatus = String(result?.runState?.status || "").toLowerCase();
  // The coordinator and UI have one shared terminal vocabulary. Preserve the
  // raw runtime status in metadata, but fail closed for incomplete outcomes so
  // an inconclusive child can never be treated as a successful completion.
  if (runtimeStatus === "stopped") return "stopped";
  if (["failed", "inconclusive", "waiting"].includes(runtimeStatus)) return "failed";
  if (mutation.required && !actions.some((action) => action.ok && WORKSPACE_MUTATION_TOOLS.has(action.toolName))) return "failed";
  return "completed";
}

function targetFromToolCall(request = {}) {
  const args = request?.toolCall?.function?.arguments;
  const value = args && typeof args === "object" ? args : {};
  const target = value.path || value.file || value.target || value.cwd || value.url || "";
  return redactSecrets(String(target || "")).slice(0, 240);
}

function actionSummary(actions = []) {
  return (Array.isArray(actions) ? actions : []).slice(-MAX_ACTIONS).map((action) => ({
    toolName: String(action?.toolName || "").slice(0, 120),
    target: String(action?.target || "").slice(0, 240),
    ok: Boolean(action?.ok),
    code: String(action?.code || "").slice(0, 120),
  }));
}

function createRuntimeDelegationProvider({
  senderId,
  runKey,
  parentModel,
  subagentModel,
  numCtx,
  thinking,
  reasoningEffort,
  contextPlan,
  workspace = "",
  mode = "agent",
  modeFamily = "xekute",
  authorityProfile = "approve_for_me",
  projectProfile = null,
  sessionId = "",
  tools = [],
  getTools = null,
  coordinator = null,
  runAgentTurn,
  runModelRound,
  executeToolCall,
  beginChildSession,
  sendToRenderer,
  registerChildRun,
  unregisterChildRun,
  recordChildSession,
  finalizeChildContext,
  specialistDispatch = null,
  specialistReturnService = null,
  recordSpecialistReturn = null,
  assignmentLeases = null,
  projectId = "",
  parentBlockId = "",
  getActiveProvider = () => "",
  intelligence = null,
  tier1Context = null,
  workingReferences = [],
  toolMetadataForName = () => null,
  getBrowserTarget = () => "",
  checkpointRun = () => Promise.resolve(),
  onResultReady = null,
} = {}) {
  if (typeof runAgentTurn !== "function") throw new TypeError("runAgentTurn is required");
  if (typeof runModelRound !== "function") throw new TypeError("runModelRound is required");
  if (typeof executeToolCall !== "function") throw new TypeError("executeToolCall is required");
  const childSessionBindings = new Map();

  function assignmentInput(input = {}) {
    const resources = input?.contextPackage?.resources && typeof input.contextPackage.resources === "object"
      ? input.contextPackage.resources
      : {};
    const investigationId = input.investigationId || input.investigation_id || resources.investigationId || resources.investigation_id || "";
    const testCaseId = input.testCaseId || input.test_case_id || resources.testCaseId || resources.test_case_id || "";
    return {
      investigationId: String(investigationId || "").trim(),
      testCaseId: String(testCaseId || "").trim(),
    };
  }

  async function prepareDelegation({ input, executionContext = null, childInvocationId, childSessionId, operation = "spawn" } = {}) {
    let prepared = input && typeof input === "object" ? { ...input, contextPackage: { ...(input.contextPackage || {}) } } : input;
    let dispatch = null;
    const dispatchEnabled = specialistDispatch?.enabled?.() === true;
    if (dispatchEnabled && specialistDispatch?.build) {
      dispatch = await specialistDispatch.build({
        workspace,
        projectId,
        parentSessionId: sessionId,
        parentAgentId: `agent:${runKey}`,
        childInvocationId,
        childSessionId,
        objective: input?.task || "",
        authorityProfile,
        expectedOutput: input?.expectedOutput || {},
        targetRefs: input?.targetRefs || input?.target_refs || [],
        investigationRefs: input?.investigationRefs || input?.investigation_refs || [],
        testCaseRefs: input?.testCaseRefs || input?.test_case_refs || [],
        artifactRefs: input?.artifactRefs || input?.artifact_refs || [],
        mode,
      });
      if (!dispatch?.ok) {
        const error = Object.assign(new Error(dispatch?.error || "Specialist dispatch packet creation failed."), { code: dispatch?.code || "MEMORY_DISPATCH_PACKET_FAILED", details: dispatch?.details || {} });
        throw error;
      }
      prepared.contextPackage = {
        role: String(prepared.contextPackage.role || mode || "agent"),
        authority: String(prepared.contextPackage.authority || authorityProfile || "approve_for_me"),
        scope: prepared.contextPackage.scope && typeof prepared.contextPackage.scope === "object" ? prepared.contextPackage.scope : {},
        identity: prepared.contextPackage.identity && typeof prepared.contextPackage.identity === "object" ? prepared.contextPackage.identity : {},
        resources: prepared.contextPackage.resources && typeof prepared.contextPackage.resources === "object" ? prepared.contextPackage.resources : {},
        memoryPacket: dispatch.packet,
      };
    }

    let assignment = null;
    const refs = assignmentInput(prepared);
    if (dispatchEnabled && assignmentLeases?.acquire && refs.investigationId && refs.testCaseId) {
      const boundProjectId = String(dispatch?.packet?.project_id || projectId || "");
      assignment = await assignmentLeases.acquire({
        workspace,
        projectId: boundProjectId,
        investigationId: refs.investigationId,
        testCaseId: refs.testCaseId,
        agentId: `agent:${childInvocationId}`,
        sessionId: childSessionId,
        exclusive: true,
      });
      if (!assignment?.ok) {
        const error = Object.assign(new Error(assignment?.error || "The Investigation assignment could not be acquired."), { code: assignment?.code || "MEMORY_ASSIGNMENT_ACQUIRE_FAILED", details: assignment?.details || {}, retryable: Boolean(assignment?.retryable) });
        throw error;
      }
    }
    return { input: prepared, dispatch, assignment };
  }

  async function releaseAssignment(assignment) {
    if (!assignment?.lease || !assignmentLeases?.release) return;
    try {
      await assignmentLeases.release({
        workspace,
        projectId: assignment.lease.project_id || projectId,
        leaseId: assignment.lease.lease_id,
        agentId: assignment.lease.agent_id,
        sessionId: assignment.lease.session_id,
        reason: "child_terminal",
      });
    } catch { /* Lease expiry remains the safe recovery path. */ }
  }

  function currentTools() {
    const source = typeof getTools === "function" ? getTools() : tools;
    return (Array.isArray(source) ? source : [])
      .filter((tool) => String(tool?.function?.name || tool?.name || "") !== "delegate_agent");
  }

  coordinator?.registerParent?.(runKey, {
    parentSessionId: sessionId,
    senderId,
    workspace,
    onResultReady: (result) => {
      const metadata = result.metadata && typeof result.metadata === "object" ? { ...result.metadata } : {};
      delete metadata.appendedMessages;
      sendToRenderer?.({
        type: "subagent_result_ready",
        sessionId,
        parentSessionId: sessionId,
        childInvocationId: result.childInvocationId,
        childSessionId: result.childSessionId,
        resultId: result.resultId,
        generation: result.generation,
        status: result.status,
        model: result.model,
        task: result.task,
        output: result.output,
        metadata,
        source: "subagent",
        continuationOwner: typeof onResultReady === "function" ? "main" : "renderer",
      });
      // The main process is the FIFO owner in production. Returning a truthy
      // value lets the coordinator distinguish a scheduled hand-off from a
      // renderer-only observer; the renderer fallback remains available when
      // no main scheduler was injected (for isolated adapters/tests).
      if (typeof onResultReady === "function") {
        try { return onResultReady(result); } catch { return false; }
      }
      return true;
    },
  });

  function sendChildEvent(childSessionId, childInvocationId, event = {}, parentEvent = false) {
    const binding = childSessionBindings.get(String(childSessionId || "")) || {};
    sendToRenderer?.({
      ...event,
      blockId: event.blockId || binding.blockId || "",
      projectId: event.projectId || binding.projectId || "",
      sessionId: childSessionId,
      parentSessionId: sessionId,
      childInvocationId,
      childSessionId,
      source: "subagent",
    });
    // Only lifecycle events are mirrored to the parent. Raw child model/tool
    // events stay in the child session and cannot corrupt parent prose.
    if (parentEvent || LIFECYCLE_EVENTS.has(String(event.type || ""))) {
      sendToRenderer?.({
        ...event,
        blockId: event.blockId || binding.blockId || "",
        projectId: event.projectId || binding.projectId || "",
        sessionId,
        parentSessionId: sessionId,
        childInvocationId,
        childSessionId,
        source: "subagent",
      });
    }
  }

  function createChildController(runtime = {}) {
    const controller = new AbortController();
    const bridgeAbort = () => {
      if (!controller.signal.aborted) controller.abort(runtime?.signal?.reason || "PARENT_AGENT_ABORTED");
    };
    if (runtime?.signal?.aborted) bridgeAbort();
    else runtime?.signal?.addEventListener?.("abort", bridgeAbort, { once: true });
    return { controller, cleanup: () => runtime?.signal?.removeEventListener?.("abort", bridgeAbort) };
  }

  async function beginSession({ childSessionId, childInvocationId, task, model, operation = "spawn" }) {
    const result = await beginChildSession?.({
      workspace,
      parentSessionId: sessionId,
      childSessionId,
      childInvocationId,
      title: `Sub-agent: ${oneLiner(task, "delegated task")}`,
      task: String(task || ""),
      model: String(model || ""),
      operation,
    });
    const resolvedSessionId = String(result?.sessionId || childSessionId || `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`);
    const binding = {
      sessionId: resolvedSessionId,
      blockId: String(result?.blockId || ""),
      projectId: String(result?.projectId || ""),
    };
    childSessionBindings.set(resolvedSessionId, binding);
    if (String(childSessionId || "") && childSessionId !== resolvedSessionId) childSessionBindings.set(String(childSessionId), binding);
    return binding;
  }

  function buildRun({ input, executionContext = null, childSessionId, blockId = "", childInvocationId, childController, generation, operation, previousHistory = [], model = "" }) {
    const mutation = requestedWorkspaceMutation(input);
    const inheritedContext = executionContext || { mode, role: mode, workspace: { root: workspace }, invocationId: childInvocationId };
    const contextText = buildChildContextText(input, inheritedContext);
    const childModel = String(model || subagentModel || parentModel || "").trim();
    const childTools = currentTools();
    const childContextText = contextText;
    const childActions = [];
    const executeChildToolCall = async (request) => {
      const toolName = String(request?.toolCall?.function?.name || request?.toolCall?.toolName || "");
      let toolResult;
      try {
        toolResult = await executeToolCall({
          ...request,
          sessionId: childSessionId,
          blockId,
          nested: true,
          authorityProfile,
          childInvocationId,
        });
      } catch (error) {
        childActions.push({ toolName, target: targetFromToolCall(request), ok: false, code: String(error?.code || "TOOL_EXECUTION_FAILED") });
        throw error;
      }
      childActions.push({
        toolName,
        target: targetFromToolCall(request),
        ok: Boolean(toolResult?.ok && !toolResult?.error),
        code: String(toolResult?.error?.code || toolResult?.errorCode || toolResult?.code || ""),
      });
      return toolResult;
    };
    return {
      mutation,
      childActions,
      run: () => runAgentTurn({
        workspace,
        model: childModel,
        numCtx: Math.max(4_096, Number(numCtx) || 8_192),
        contextBudget: Math.max(4_096, Number(contextPlan?.promptBudgetTokens || numCtx) || 8_192),
        contextPlan: contextPlan || null,
        thinking,
        reasoningEffort,
        tools: childTools,
        mode,
        modeFamily,
        projectProfile,
        intelligence,
        tier1Context,
        workingReferences,
        authorityProfile,
        sessionId: childSessionId,
        memorySessionId: memorySessionIdFor(childSessionId, childInvocationId),
        userMessage: String(input?.task || ""),
        chatHistory: Array.isArray(previousHistory) ? previousHistory : [],
        signal: childController.signal,
        sendEvent: (event) => sendChildEvent(childSessionId, childInvocationId, event),
        runModelRound: (roundPayload) => runModelRound(senderId, roundPayload, {
          onThinking: roundPayload.onThinking,
          onToken: roundPayload.onToken,
          onToolCalls: roundPayload.onToolCalls,
          onStreamEvent: roundPayload.onStreamEvent,
        }, `${runKey}::${childInvocationId}::${generation || operation || "run"}`),
        executeToolCall: executeChildToolCall,
        toolMetadataForName: (name) => toolMetadataForName(name, childSessionId),
        getBrowserTarget,
        checkpointRun: (patch) => checkpointRun(patch, { childSessionId, childInvocationId, generation, operation }),
        nested: true,
      }),
    };
  }

  async function executeChild({ input, executionContext = null, childSessionId, blockId = "", childInvocationId, childController, generation = 1, operation = "spawn", previousHistory = [], model = "", dispatch = null, assignment = null, cleanup = null } = {}) {
    const selectedChildModel = String(subagentModel || parentModel || "").trim();
    let effectiveModel = String(model || selectedChildModel).trim();
    const requestedModel = effectiveModel;
    let fallbackUsed = false;
    let runSpec = buildRun({ input, executionContext, childSessionId, blockId, childInvocationId, childController, generation, operation, previousHistory, model: effectiveModel });
    sendChildEvent(childSessionId, childInvocationId, {
      type: "subagent_started",
      status: "working",
      operation,
      model: String(subagentModel || parentModel || "").trim(),
      task: String(input?.task || ""),
      summary: oneLiner(input?.task || "", "Working on delegated task"),
    });
    try {
      let result = await runSpec.run();
      const fallbackModel = String(parentModel || "").trim();
      if (fallbackModel && effectiveModel !== fallbackModel && runSpec.childActions.length === 0 && isModelAvailabilityFailure(result) && !childController.signal.aborted) {
        sendChildEvent(childSessionId, childInvocationId, { type: "subagent_activity", model: fallbackModel, summary: `Selected sub-agent model was unavailable; retrying with ${fallbackModel}.` });
        fallbackUsed = true;
        effectiveModel = fallbackModel;
        runSpec = buildRun({ input, executionContext, childSessionId, blockId, childInvocationId, childController, generation, operation, previousHistory, model: effectiveModel });
        result = await runSpec.run();
      }
      const runtimeStatus = String(result?.runState?.status || "").toLowerCase();
      const status = childResultStatus(result, runSpec.mutation, runSpec.childActions);
      const childSummary = String(result?.finalText || "").trim().slice(0, MAX_SUMMARY_CHARS);
      const mutationFailure = status === "failed" && runSpec.mutation.required
        && !runSpec.childActions.some((action) => action.ok && WORKSPACE_MUTATION_TOOLS.has(action.toolName))
        ? `The delegated task required a real write to ${runSpec.mutation.target || "the workspace"}, but the child completed without a successful apply_patch call.`
        : "";
      const error = String(mutationFailure || result?.error || result?.runState?.stopReason || "").slice(0, MAX_SUMMARY_CHARS);
      const terminalType = status === "completed" ? "subagent_completed" : status === "stopped" ? "subagent_stopped" : "subagent_failed";
      let specialistReturn = null;
      const returnedPayload = result?.specialistReturn || result?.specialist_return || result?.memorySpecialistReturn || result?.structuredReturn || null;
      if (returnedPayload && typeof returnedPayload === "object") {
        const candidate = {
          ...returnedPayload,
          project_id: returnedPayload.project_id || returnedPayload.projectId || projectId,
          parent_session_id: returnedPayload.parent_session_id || returnedPayload.parentSessionId || sessionId,
          child_session_id: returnedPayload.child_session_id || returnedPayload.childSessionId || childSessionId,
          child_invocation_id: returnedPayload.child_invocation_id || returnedPayload.childInvocationId || childInvocationId,
          agent_id: returnedPayload.agent_id || returnedPayload.agentId || `agent:${childInvocationId}`,
          status: returnedPayload.status || (status === "completed" ? "completed" : status === "stopped" ? "cancelled" : "failed"),
          parent_block_id: returnedPayload.parent_block_id || returnedPayload.parentBlockId || parentBlockId,
        };
        try {
          specialistReturn = specialistReturnService?.accept
            ? await specialistReturnService.accept({ ...candidate, parentBlockId: candidate.parent_block_id, executionCapture: null })
            : null;
          if (specialistReturn?.ok && typeof recordSpecialistReturn === "function") {
            specialistReturn = await recordSpecialistReturn({ ...candidate, normalized: specialistReturn });
          }
        } catch (error) {
          specialistReturn = { ok: false, code: error.code || "MEMORY_SPECIALIST_RETURN_FAILED", error: String(error.message || "Specialist return was rejected.").slice(0, MAX_SUMMARY_CHARS) };
        }
      }
      const outcome = {
        status,
        output: { text: childSummary, format: String(input?.expectedOutput?.format || "text"), summary: String(input?.expectedOutput?.description || input?.task || "").slice(0, MAX_SUMMARY_CHARS) },
        metadata: {
          model: effectiveModel,
          requestedModel,
          fallbackUsed,
          provider: getActiveProvider(),
          sessionId: childSessionId,
          runtimeStatus,
          executedTools: Boolean(result?.executedTools),
          actions: actionSummary(runSpec.childActions),
          mutationRequired: runSpec.mutation.required,
          mutationTarget: runSpec.mutation.target,
          evidenceIds: Array.isArray(result?.evidenceIds) ? result.evidenceIds : [],
          provisionalPlan: result?.provisionalPlan || null,
          error,
          appendedMessages: Array.isArray(result?.appendedMessages) ? result.appendedMessages : [],
          memoryDispatch: dispatch ? { packetId: dispatch.packet?.packet_id || "", packetHash: dispatch.packetHash || "", contextState: dispatch.contextState || "" } : null,
          memoryAssignment: assignment?.lease ? { leaseId: assignment.lease.lease_id, investigationId: assignment.lease.investigation_id, testCaseId: assignment.lease.test_case_id } : null,
          specialistReturn: specialistReturn ? { ok: specialistReturn.ok !== false, returnId: specialistReturn.recordId || specialistReturn.parentEvent?.specialist_return_id || "", code: specialistReturn.ok === false ? specialistReturn.code || "MEMORY_SPECIALIST_RETURN_FAILED" : "" } : null,
        },
      };
      sendChildEvent(childSessionId, childInvocationId, {
        type: terminalType,
        status,
        model: effectiveModel,
        task: String(input?.task || ""),
        summary: childSummary || error,
        executedTools: Boolean(result?.executedTools),
        operation,
      });
      try {
        await recordChildSession?.({
          workspace,
          sessionId: childSessionId,
          blockId,
          childInvocationId,
          operation,
          model: effectiveModel,
          status,
          output: outcome.output,
          metadata: outcome.metadata,
        });
      } catch (error) {
        outcome.metadata.sessionPersistence = {
          ok: false,
          error: String(error?.message || "Child session persistence failed.").slice(0, MAX_SUMMARY_CHARS),
        };
      }
      if (typeof finalizeChildContext === "function") {
        try {
          const sharedContext = await finalizeChildContext({
            workspace,
            sessionId: childSessionId,
            blockId,
            childInvocationId,
            operation,
            model: effectiveModel,
            status,
            task: String(input?.task || ""),
            output: outcome.output,
            metadata: outcome.metadata,
            messages: Array.isArray(result?.appendedMessages) ? result.appendedMessages : [],
            evidenceIds: Array.isArray(result?.evidenceIds) ? result.evidenceIds : [],
          });
          outcome.metadata.sharedContext = redactStructuredValue(
            sharedContext && typeof sharedContext === "object"
              ? sharedContext
              : { ok: true },
          );
        } catch (error) {
          // Child work remains reviewable even if shared-context consolidation
          // fails. Surface the failure to the parent instead of silently
          // claiming that every other agent can already see the episode.
          outcome.metadata.sharedContext = {
            ok: false,
            error: String(error?.message || "Shared project context consolidation failed.").slice(0, MAX_SUMMARY_CHARS),
            code: String(error?.code || "SHARED_CONTEXT_CONSOLIDATION_FAILED").slice(0, 120),
          };
        }
      }
      return outcome;
    } catch (error) {
      const status = childController.signal.aborted ? "stopped" : "failed";
      sendChildEvent(childSessionId, childInvocationId, {
        type: status === "stopped" ? "subagent_stopped" : "subagent_failed",
        status,
        task: String(input?.task || ""),
        summary: String(error?.message || (status === "stopped" ? "Child agent stopped." : "Child agent failed.")),
        operation,
      });
      const outcome = { status, output: { text: "", format: "text", summary: "" }, metadata: { sessionId: childSessionId, model: effectiveModel, requestedModel, fallbackUsed, error: String(error?.message || "Child agent failed."), memoryDispatch: dispatch ? { packetId: dispatch.packet?.packet_id || "", packetHash: dispatch.packetHash || "" } : null, memoryAssignment: assignment?.lease ? { leaseId: assignment.lease.lease_id, investigationId: assignment.lease.investigation_id, testCaseId: assignment.lease.test_case_id } : null } };
      try {
        await recordChildSession?.({ workspace, sessionId: childSessionId, blockId, childInvocationId, operation, model: effectiveModel, status: outcome.status, output: outcome.output, metadata: outcome.metadata });
      } catch (persistenceError) {
        outcome.metadata.sessionPersistence = {
          ok: false,
          error: String(persistenceError?.message || "Child session persistence failed.").slice(0, MAX_SUMMARY_CHARS),
        };
      }
      if (typeof finalizeChildContext === "function") {
        try {
          const sharedContext = await finalizeChildContext({
            workspace,
            sessionId: childSessionId,
            blockId,
            childInvocationId,
            operation,
            model: effectiveModel,
            status,
            task: String(input?.task || ""),
            output: outcome.output,
            metadata: outcome.metadata,
            messages: [],
            evidenceIds: [],
          });
          outcome.metadata.sharedContext = redactStructuredValue(
            sharedContext && typeof sharedContext === "object"
              ? sharedContext
              : { ok: true },
          );
        } catch (finalizationError) {
          outcome.metadata.sharedContext = {
            ok: false,
            error: String(finalizationError?.message || "Shared project context consolidation failed.").slice(0, MAX_SUMMARY_CHARS),
            code: String(finalizationError?.code || "SHARED_CONTEXT_CONSOLIDATION_FAILED").slice(0, 120),
          };
        }
      }
      return outcome;
    } finally {
      await releaseAssignment(assignment);
      cleanup?.();
    }
  }

  return async function delegate(input, executionContext, runtime = {}) {
    const operation = String(input?.operation || "spawn").toLowerCase() === "follow_up" ? "follow_up" : "spawn";
    if (coordinator && operation === "follow_up") {
      const existing = coordinator.getChild(input?.childInvocationId, runKey);
      if (!existing) throw Object.assign(new Error("The delegated child no longer exists."), { code: "UNKNOWN_SUBAGENT" });
      const selectedModel = existing.model || String(subagentModel || parentModel || "").trim();
      const childControllerState = createChildController(runtime);
      const childController = childControllerState.controller;
      const childSession = await beginSession({ childSessionId: existing.childSessionId, childInvocationId: existing.childInvocationId, task: input.task, model: selectedModel, operation });
      const childSessionId = childSession.sessionId;
      const previousHistory = Array.isArray(existing.history) ? existing.history : [];
      const prepared = await prepareDelegation({ input, executionContext, childInvocationId: existing.childInvocationId, childSessionId, operation });
      const queued = coordinator.submitFollowUp({
        childInvocationId: existing.childInvocationId,
        parentKey: runKey,
        task: prepared.input.task,
        summary: prepared.input.expectedOutput?.description || prepared.input.task,
        metadata: {
          operation,
          memoryDispatch: prepared.dispatch ? { packetId: prepared.dispatch.packet?.packet_id || "", packetHash: prepared.dispatch.packetHash || "" } : null,
          memoryAssignment: prepared.assignment?.lease ? { leaseId: prepared.assignment.lease.lease_id, investigationId: prepared.assignment.lease.investigation_id, testCaseId: prepared.assignment.lease.test_case_id } : null,
        },
        controller: childController,
        onCancel: () => {
          sendChildEvent(childSessionId, existing.childInvocationId, {
            type: "subagent_stopped",
            status: "stopped",
            operation,
            model: selectedModel,
            task: String(input?.task || ""),
            summary: "Stopped before the child started.",
          });
          Promise.resolve(recordChildSession?.({
            workspace,
            sessionId: childSessionId,
            blockId: childSession.blockId,
            childInvocationId: existing.childInvocationId,
            operation,
            model: selectedModel,
            status: "stopped",
            output: { text: "", format: String(input.expectedOutput?.format || "text"), summary: "Stopped before the child started." },
            metadata: { sessionId: childSessionId, model: selectedModel, error: "Stopped before the child started." },
          })).catch(() => {});
          releaseAssignment(prepared.assignment).catch(() => {});
          childControllerState.cleanup();
          unregisterChildRun?.(existing.childSessionId);
        },
        start: () => executeChild({ input: prepared.input, executionContext, childSessionId, blockId: childSession.blockId, childInvocationId: existing.childInvocationId, childController, generation: existing.generation + 1, operation, previousHistory, model: selectedModel, dispatch: prepared.dispatch, assignment: prepared.assignment, cleanup: () => { childControllerState.cleanup(); unregisterChildRun?.(existing.childSessionId); } }),
      });
      if (!queued.ok) {
        childControllerState.cleanup();
        throw Object.assign(new Error(queued.error), { code: queued.code });
      }
      // Register only after acceptance. A rejected follow-up must not replace
      // or remove the controller belonging to the already-running child.
      registerChildRun?.({ parentRunKey: runKey, childSessionId: existing.childSessionId, controller: childController });
      sendChildEvent(childSessionId, existing.childInvocationId, {
        type: queued.status === "queued" ? "subagent_queued" : "subagent_started",
        status: queued.status,
        operation,
        model: selectedModel,
        task: String(prepared.input?.task || ""),
        summary: oneLiner(input?.task || "", "Working on delegated follow-up"),
      });
      return { childInvocationId: existing.childInvocationId, output: { text: "", format: String(prepared.input.expectedOutput?.format || "text"), summary: "Follow-up accepted." }, status: queued.status, metadata: { sessionId: childSessionId, operation, generation: queued.generation, memoryDispatch: prepared.dispatch ? { packetId: prepared.dispatch.packet?.packet_id || "", packetHash: prepared.dispatch.packetHash || "" } : null, memoryAssignment: prepared.assignment?.lease ? { leaseId: prepared.assignment.lease.lease_id } : null } };
    }

    const childInvocationId = `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const childSessionSeed = `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const childSession = await beginSession({
      childSessionId: childSessionSeed,
      childInvocationId,
      task: input?.task,
      model: String(subagentModel || parentModel || ""),
      operation,
    });
    const childSessionId = childSession.sessionId;
    const prepared = await prepareDelegation({ input, executionContext, childInvocationId, childSessionId, operation });
    const childControllerState = createChildController(runtime);
    const childController = childControllerState.controller;
    registerChildRun?.({ parentRunKey: runKey, childSessionId, controller: childController });
    const summary = oneLiner(prepared.input?.expectedOutput?.description || prepared.input?.task || "", "");
    const started = coordinator
      ? coordinator.submitChild({
        parentKey: runKey,
        parentSessionId: sessionId,
        senderId,
        workspace,
        childInvocationId,
        childSessionId,
        model: String(subagentModel || parentModel || "").trim(),
        task: String(prepared.input?.task || ""),
        summary,
        metadata: {
          memoryDispatch: prepared.dispatch ? { packetId: prepared.dispatch.packet?.packet_id || "", packetHash: prepared.dispatch.packetHash || "" } : null,
          memoryAssignment: prepared.assignment?.lease ? { leaseId: prepared.assignment.lease.lease_id, investigationId: prepared.assignment.lease.investigation_id, testCaseId: prepared.assignment.lease.test_case_id } : null,
        },
        controller: childController,
        onCancel: () => {
          sendChildEvent(childSessionId, childInvocationId, {
            type: "subagent_stopped",
            status: "stopped",
            operation,
            model: String(subagentModel || parentModel || "").trim(),
            task: String(input?.task || ""),
            summary: "Stopped before the child started.",
          });
          Promise.resolve(recordChildSession?.({
            workspace,
            sessionId: childSessionId,
            blockId: childSession.blockId,
            childInvocationId,
            operation,
            model: String(subagentModel || parentModel || "").trim(),
            status: "stopped",
            output: { text: "", format: String(input?.expectedOutput?.format || "text"), summary: "Stopped before the child started." },
            metadata: { sessionId: childSessionId, model: String(subagentModel || parentModel || "").trim(), error: "Stopped before the child started." },
          })).catch(() => {});
          releaseAssignment(prepared.assignment).catch(() => {});
          childControllerState.cleanup();
          unregisterChildRun?.(childSessionId);
        },
        start: () => executeChild({ input: prepared.input, executionContext, childSessionId, blockId: childSession.blockId, childInvocationId, childController, generation: 1, operation, model: String(subagentModel || parentModel || "").trim(), dispatch: prepared.dispatch, assignment: prepared.assignment, cleanup: () => { childControllerState.cleanup(); unregisterChildRun?.(childSessionId); } }),
      })
      : null;
    if (coordinator) {
      if (!started.ok) {
        childControllerState.cleanup();
        unregisterChildRun?.(childSessionId);
        throw Object.assign(new Error(started.error), { code: started.code });
      }
      sendChildEvent(childSessionId, childInvocationId, {
        type: started.status === "queued" ? "subagent_queued" : "subagent_started",
        status: started.status,
        operation,
        model: String(subagentModel || parentModel || "").trim(),
        task: String(prepared.input?.task || ""),
        summary,
      });
      return { childInvocationId, output: { text: "", format: String(prepared.input?.expectedOutput?.format || "text"), summary: "Child accepted and running in the background." }, status: started.status, metadata: { sessionId: childSessionId, operation, generation: started.generation, memoryDispatch: prepared.dispatch ? { packetId: prepared.dispatch.packet?.packet_id || "", packetHash: prepared.dispatch.packetHash || "" } : null, memoryAssignment: prepared.assignment?.lease ? { leaseId: prepared.assignment.lease.lease_id } : null } };
    }

    try {
      const outcome = await executeChild({ input: prepared.input, executionContext, childSessionId, blockId: childSession.blockId, childInvocationId, childController, generation: 1, operation, model: String(subagentModel || parentModel || "").trim(), dispatch: prepared.dispatch, assignment: prepared.assignment, cleanup: childControllerState.cleanup });
      return { childInvocationId, output: outcome.output, status: outcome.status, metadata: outcome.metadata };
    } finally {
      unregisterChildRun?.(childSessionId);
    }
  };
}

module.exports = {
  MAX_TASK_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_SUMMARY_CHARS,
  WORKSPACE_MUTATION_TOOLS,
  oneLiner,
  buildChildContextText,
  requestedWorkspaceMutation,
  isModelAvailabilityFailure,
  childResultStatus,
  createRuntimeDelegationProvider,
};
