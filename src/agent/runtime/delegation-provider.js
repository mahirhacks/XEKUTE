"use strict";

// Production delegation provider: runs the delegated task as a REAL child agent
// turn (second runAgentTurn on its own session) instead of a single tool-less
// model reply. The raw delegate_agent adapter stays authority-free; this module
// only supplies the runtime provider the adapter invokes.
//
// The child gets the parent's tool surface minus delegate_agent (one nesting
// level), the same authority pipeline via the shared executeToolCall, and its
// own session so the renderer can open and stop it independently.

const crypto = require("node:crypto");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");
const { inferEditTarget, isEditRequest } = require("./prompt-context.js");

const MAX_TASK_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 32_000;
const MAX_SUMMARY_CHARS = 2_000;
const WORKSPACE_MUTATION_TOOLS = new Set(["apply_patch"]);

function oneLiner(task, fallback = "") {
  const value = String(task || "").trim().replace(/\s+/g, " ");
  return (value || String(fallback || "")).slice(0, 160);
}

function buildChildContextText(input, executionContext) {
  const contextPackage = input?.contextPackage && typeof input.contextPackage === "object"
    ? { ...input.contextPackage }
    : {};
  // Project memory has its own bounded channel in runAgentTurn. Keeping it out
  // of this packet prevents it from crowding out the delegation contract.
  delete contextPackage.projectMemory;
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
  if (contextText.length > MAX_CONTEXT_CHARS) {
    contextText = `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n[bounded by XEKUTE]`;
  }
  return contextText;
}

function requestedWorkspaceMutation(input = {}) {
  const task = String(input?.task || "");
  const target = inferEditTarget(task, null, "")
    || (/\b(?:create|write|edit|modify|update|patch|replace|save)\b[\s\S]{0,120}?\b([\w./\\-]+\.[a-z0-9]{1,12})\b/i.exec(task)?.[1] || "");
  return {
    required: Boolean(target && isEditRequest(task)),
    target: String(target || "").replace(/\\/g, "/"),
  };
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
  if (["failed", "stopped", "inconclusive", "waiting"].includes(runtimeStatus)) return runtimeStatus;
  if (mutation.required && !actions.some((action) => action.ok && WORKSPACE_MUTATION_TOOLS.has(action.toolName))) {
    return "failed";
  }
  return "completed";
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
  runAgentTurn,
  runModelRound,
  executeToolCall,
  beginChildSession,
  sendToRenderer,
  registerChildRun,
  unregisterChildRun,
  getActiveProvider = () => "",
} = {}) {
  if (typeof runAgentTurn !== "function") throw new TypeError("runAgentTurn is required");
  if (typeof runModelRound !== "function") throw new TypeError("runModelRound is required");
  if (typeof executeToolCall !== "function") throw new TypeError("executeToolCall is required");

  return async function delegate(input, executionContext, runtime = {}) {
    const childInvocationId = `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const childSessionId = String(
      (await beginChildSession?.({
        workspace,
        parentSessionId: sessionId,
        childInvocationId,
        title: `Sub-agent: ${oneLiner(input?.task || "", "delegated task")}`,
        task: String(input?.task || ""),
        model: String(subagentModel || parentModel || ""),
      }))?.sessionId || `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    );
    const selectedChildModel = String(subagentModel || parentModel || "").trim();
    const fallbackModel = String(parentModel || "").trim();
    const summary = oneLiner(input?.expectedOutput?.description || input?.task || "", "");
    const mutation = requestedWorkspaceMutation(input);
    const childContextText = buildChildContextText(input, executionContext);

    const childEvent = (event = {}) => {
      sendToRenderer?.({
        ...event,
        sessionId: childSessionId,
        parentSessionId: sessionId,
        childInvocationId,
        source: "subagent",
      });
      // Mirrored on the parent session so the parent card can render even when
      // the child session is not open.
      if (sessionId && sessionId !== childSessionId) {
        sendToRenderer?.({
          ...event,
          sessionId,
          parentSessionId: sessionId,
          childSessionId,
          childInvocationId,
          source: "subagent",
        });
      }
    };

    const childController = new AbortController();
    registerChildRun?.({ parentRunKey: runKey, childSessionId, controller: childController });
    const bridgeAbort = () => {
      if (!childController.signal.aborted) childController.abort(runtime?.signal?.reason || "PARENT_AGENT_ABORTED");
    };
    if (runtime?.signal?.aborted) bridgeAbort();
    else runtime?.signal?.addEventListener?.("abort", bridgeAbort, { once: true });
    const cleanup = () => {
      runtime?.signal?.removeEventListener?.("abort", bridgeAbort);
      unregisterChildRun?.(childSessionId);
    };

    const childTools = (Array.isArray(tools) ? tools : [])
      .filter((tool) => String(tool?.function?.name || tool?.name || "") !== "delegate_agent");

    childEvent({ type: "subagent_started", model: selectedChildModel, summary });

    try {
      const childActions = [];
      const executeChildToolCall = async (request) => {
        const toolName = String(request?.toolCall?.function?.name || request?.toolCall?.toolName || "");
        let toolResult;
        try {
          toolResult = await executeToolCall({
            ...request,
            sessionId: childSessionId,
            nested: true,
            authorityProfile,
            planBinding: null,
          });
        } catch (error) {
          childActions.push({ toolName, ok: false, code: String(error?.code || "TOOL_EXECUTION_FAILED") });
          throw error;
        }
        childActions.push({
          toolName,
          ok: Boolean(toolResult?.ok && !toolResult?.error),
          code: String(toolResult?.error?.code || toolResult?.errorCode || toolResult?.code || ""),
        });
        return toolResult;
      };
      const runChild = (childModel, attempt) => runAgentTurn({
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
          projectMemory: input?.contextPackage?.projectMemory || null,
          authorityProfile,
          sessionId: childSessionId,
          userMessage: String(input?.task || ""),
          contextSummary: childContextText,
          chatHistory: [],
          signal: childController.signal,
          sendEvent: childEvent,
          runModelRound: (roundPayload) => runModelRound(senderId, roundPayload, {
            onThinking: roundPayload.onThinking,
            onToken: roundPayload.onToken,
            onToolCalls: roundPayload.onToolCalls,
            onStreamEvent: roundPayload.onStreamEvent,
          }, `${runKey}::${childInvocationId}::${attempt}`),
          executeToolCall: executeChildToolCall,
          toolMetadataForName: () => null,
          getBrowserTarget: () => "",
          checkpointRun: () => Promise.resolve(),
        });

      let effectiveModel = selectedChildModel || fallbackModel;
      let fallbackUsed = false;
      let result = await runChild(effectiveModel, "primary");
      if (
        fallbackModel
        && effectiveModel !== fallbackModel
        && childActions.length === 0
        && isModelAvailabilityFailure(result)
        && !childController.signal.aborted
      ) {
        fallbackUsed = true;
        effectiveModel = fallbackModel;
        childEvent({
          type: "subagent_activity",
          model: effectiveModel,
          summary: `Selected sub-agent model was unavailable; retrying with ${effectiveModel}.`,
        });
        result = await runChild(effectiveModel, "fallback");
      }

      const status = childResultStatus(result, mutation, childActions);
      const childSummary = String(result?.finalText || "").trim().slice(0, MAX_SUMMARY_CHARS);
      const mutationFailure = status === "failed" && mutation.required
        && !childActions.some((action) => action.ok && WORKSPACE_MUTATION_TOOLS.has(action.toolName))
        ? `The delegated task required a real write to ${mutation.target || "the workspace"}, but the child completed without a successful apply_patch call.`
        : "";
      const error = String(mutationFailure || result?.error || result?.runState?.stopReason || "").slice(0, MAX_SUMMARY_CHARS);
      const terminalEventType = status === "completed"
        ? "subagent_completed"
        : status === "stopped"
          ? "subagent_stopped"
          : "subagent_failed";
      childEvent({
        type: terminalEventType,
        status,
        model: effectiveModel,
        summary: childSummary || error,
        executedTools: Boolean(result?.executedTools),
      });

      return {
        childInvocationId,
        output: {
          text: childSummary,
          format: String(input?.expectedOutput?.format || "text"),
          summary: String(input?.expectedOutput?.description || input?.task || "").slice(0, MAX_SUMMARY_CHARS),
        },
        status,
        metadata: {
          model: effectiveModel,
          requestedModel: selectedChildModel,
          provider: getActiveProvider(),
          sessionId: childSessionId,
          executedTools: Boolean(result?.executedTools),
          actions: childActions.slice(-50),
          fallbackUsed,
          mutationRequired: mutation.required,
          mutationTarget: mutation.target,
          evidenceIds: Array.isArray(result?.evidenceIds) ? result.evidenceIds : [],
          error,
        },
      };
    } catch (error) {
      childEvent({ type: "subagent_failed", status: "failed", summary: String(error?.message || "Child agent failed.") });
      const wrapped = new Error(error?.message || "Child agent failed.");
      wrapped.code = error?.code || "SUBAGENT_MODEL_FAILED";
      throw wrapped;
    } finally {
      cleanup();
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
