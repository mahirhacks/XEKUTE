"use strict";

// Runtime implementation for delegate_agent. Production Electron runs use the
// injected coordinator so child turns are background jobs; isolated adapter
// tests may omit it and retain the synchronous provider contract.

const crypto = require("node:crypto");
const { redactStructuredValue, redactSecrets } = require("../../shared/secret-redaction.js");
const { requireReceipt } = require("./delegated-child-store.js");
const { identifyToolCalls } = require("./tool-protocol.js");
const { spillChildReport } = require("./child-report-spill.js");
const { archetypeFor, narrowToolsForArchetype } = require("./child-archetypes.js");

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

function jsonSection(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function appendSteeringUpdate(contextText, steeringSections = []) {
  if (!Array.isArray(steeringSections) || !steeringSections.length) return contextText;
  const blocks = steeringSections.map((section, index) => `### Steering update ${index + 1}\n${String(section || "").trim()}`);
  return `${contextText}\n\n## Steering update\n${blocks.join("\n\n")}`;
}

function scopeHosts(scope = {}) {
  const hosts = [];
  for (const key of ["hosts", "targets", "inScope", "allowedHosts"]) {
    const value = scope?.[key];
    if (Array.isArray(value)) hosts.push(...value.map((item) => String(item || "").trim()).filter(Boolean));
    else if (typeof value === "string" && value.trim()) hosts.push(value.trim());
  }
  return [...new Set(hosts)].slice(0, 40);
}

function pointerLines(resources = {}) {
  const lines = ["Read project artifacts under .xekute/ with read_file or search_workspace."];
  const projectId = String(resources.projectId || resources.project_id || "").trim();
  if (projectId) lines.push(`Project id: ${projectId.slice(0, 120)}`);
  const paths = [];
  for (const key of ["artifactPaths", "paths", "files"]) {
    const value = resources?.[key];
    if (Array.isArray(value)) paths.push(...value.map((item) => String(item || "").trim()).filter(Boolean));
  }
  for (const file of paths.slice(0, 20)) lines.push(`Path: ${file.slice(0, 300)}`);
  return lines.join("\n");
}

function buildChildContextText(input, executionContext, steeringSections = []) {
  const contextPackage = input?.contextPackage && typeof input.contextPackage === "object"
    ? { ...input.contextPackage }
    : {};
  const task = String(input?.task || "").slice(0, MAX_TASK_CHARS);
  const archetype = archetypeFor(contextPackage.role);
  const expectedOutput = input?.expectedOutput && typeof input.expectedOutput === "object"
    ? input.expectedOutput
    : {};
  const scope = contextPackage.scope && typeof contextPackage.scope === "object" ? contextPackage.scope : {};
  const resources = contextPackage.resources && typeof contextPackage.resources === "object" ? contextPackage.resources : {};
  const hosts = scopeHosts(scope);
  const workspaceRoot = String(executionContext?.workspace?.root || "").slice(0, 500);
  const sections = [
    "## Objective",
    task,
    "",
    ...(archetype ? ["## Role", archetype.guidance, ""] : []),
    "## Authority",
    String(contextPackage.authority || executionContext?.authority || "").slice(0, 500),
    "",
    "## Workspace",
    workspaceRoot || "(workspace root is available to read_file and search_workspace)",
    "",
    "## In-scope hosts",
    hosts.length ? hosts.join("\n") : "(use the workspace scope; do not assume hosts that are not in project scope)",
    "",
    "## Pointers",
    pointerLines(resources),
    "",
    "## Inherited runtime",
    `parentInvocationId: ${String(executionContext?.invocationId || "").slice(0, 200)}`,
    "",
    "## Expected output",
    String(expectedOutput.description || "").slice(0, 1_000),
    "",
    "## Return format (required)",
    "Return one JSON object only, at most 2000 characters in summary:",
    '{"status":"done|blocked|needs_operator","summary":"...","evidenceRefs":["workspace-relative path or evidence id"],"unverified":["claim you could not check"]}',
    "status done means you checked the claim. status blocked means you could not finish. status needs_operator means the parent must ask the user.",
    "Complete the task, editing workspace files with apply_patch when it asks for changes. Do not call delegate_agent. Then return the JSON object.",
    String(expectedOutput.format || "").slice(0, 500),
  ];
  let contextText = sections.join("\n");
  if (contextText.length > MAX_CONTEXT_CHARS) contextText = `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n[bounded by XEKUTE]`;
  return appendSteeringUpdate(contextText, steeringSections);
}

function parseChildFinding(text = "") {
  const raw = String(text || "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed = null;
  if (match) {
    try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
  }
  const status = String(parsed?.status || "").toLowerCase();
  if (!parsed || !["done", "blocked", "needs_operator"].includes(status)) {
    return {
      status: "blocked",
      summary: raw.slice(0, MAX_SUMMARY_CHARS),
      evidenceRefs: [],
      unverified: raw ? [raw.slice(0, MAX_SUMMARY_CHARS)] : ["The child did not return the required JSON object."],
      ...(raw.length > MAX_SUMMARY_CHARS ? { truncated: true, fullText: raw } : {}),
    };
  }
  const refs = Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs.map((item) => String(item || "").slice(0, 300)).filter(Boolean).slice(0, 40) : [];
  const unverified = Array.isArray(parsed.unverified) ? parsed.unverified.map((item) => String(item || "").slice(0, 500)).filter(Boolean).slice(0, 40) : [];
  const fullSummary = String(parsed.summary || raw);
  return {
    status,
    summary: fullSummary.slice(0, MAX_SUMMARY_CHARS),
    evidenceRefs: refs,
    unverified,
    ...(fullSummary.length > MAX_SUMMARY_CHARS ? { truncated: true, fullText: raw } : {}),
  };
}

// A report that does not fit the summary is saved in full and the summary ends
// with a pointer to it. The returned finding never carries the full text.
function boundChildFinding(finding, { workspace, childInvocationId, retainSecrets = false } = {}) {
  const { truncated, fullText, ...kept } = finding;
  if (!truncated) return kept;
  // `retainSecrets` is the project's "Redact secrets" setting turned off.
  const spilled = spillChildReport({ workspace, childInvocationId, text: fullText, ...(retainSecrets ? { redact: (text) => text } : {}) });
  const pointer = spilled.ok ? `\n[Summary shortened. Full report: ${spilled.relativePath}]` : "\n[Summary shortened. The full report could not be saved.]";
  return {
    ...kept,
    summary: kept.summary.slice(0, MAX_SUMMARY_CHARS - pointer.length) + pointer,
    evidenceRefs: spilled.ok ? [...kept.evidenceRefs, spilled.relativePath].slice(0, 40) : kept.evidenceRefs,
  };
}

function isRetryableChildFailure(result = {}) {
  if (result?.aborted) return false;
  const detail = `${result?.code || ""} ${result?.error || ""} ${result?.runState?.stopReason || ""}`;
  if (/policy|scope|denied|workspace_out_of_scope/i.test(detail)) return false;
  return /timeout|timed out|econnreset|econnrefused|rate limit|too many requests|\b429\b|\b502\b|\b503\b|unavailable|network/i.test(detail);
}

function isModelAvailabilityFailure(result = {}) {
  if (result?.ok !== false || result?.aborted) return false;
  const detail = `${result?.code || ""} ${result?.error || ""}`;
  return /(?:openrouter[^\n]*\b404\b|no endpoints? available|model[^\n]*(?:not found|unavailable)|provider[^\n]*(?:not available|unavailable))/i.test(detail);
}

function childResultStatus(result = {}) {
  if (result?.aborted) return "stopped";
  if (result?.ok === false) return "failed";
  const runtimeStatus = String(result?.runState?.status || "").toLowerCase();
  // The coordinator and UI have one shared terminal vocabulary. Preserve the
  // raw runtime status in metadata, but fail closed for incomplete outcomes so
  // an inconclusive child can never be treated as a successful completion.
  if (runtimeStatus === "stopped") return "stopped";
  if (["failed", "inconclusive", "waiting"].includes(runtimeStatus)) return "failed";
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
  listRunningCommands = async () => [],
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
  getTier1Model = () => null,
  loadChatReferenceSnapshot = null,
  workingReferences = [],
  toolMetadataForName = () => null,
  skillRouter = null,
  checklistEnabled = false,
  checkpointRun = () => Promise.resolve(),
  checkpointChild = null,
  loadChild = null,
  onChildCheckpoint = null,
  beforeChildFinalize = null,
  parentSessionAliases = [],
  onResultReady = null,
  onQuestionEnqueued = null,
  registerDelegatedQuestion = null,
  onDelegatedQuestionResolved = null,
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
      .filter((tool) => {
        const name = String(tool?.function?.name || tool?.name || "");
        return name !== "delegate_agent";
      });
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

  function buildRun({ input, executionContext = null, childSessionId, blockId = "", childInvocationId, childController, generation, operation, previousHistory = [], model = "", steeringSections = [], engine }) {
    const inheritedContext = executionContext || { mode, role: mode, workspace: { root: workspace }, invocationId: childInvocationId };
    const contextText = buildChildContextText(input, inheritedContext, steeringSections);
    const childModel = String(model || subagentModel || parentModel || "").trim();
    const childTools = narrowToolsForArchetype(currentTools(), archetypeFor(input?.contextPackage?.role));
    const childActions = [];
    const delegatedQuestionProvider = typeof registerDelegatedQuestion === "function"
      ? async (proposal) => {
        if (!coordinator?.enqueueQuestion) {
          throw Object.assign(new Error("Delegated question routing is unavailable."), { code: "DELEGATE_AGENT_PROVIDER_UNAVAILABLE" });
        }
        const requestId = String(proposal.requestId || "");
        const enqueued = coordinator.enqueueQuestion({
          parentKey: runKey,
          questionRequestId: requestId,
          childInvocationId,
          childSessionId,
          parentSessionId: sessionId,
          payload: proposal,
        });
        if (!enqueued.ok) {
          throw Object.assign(new Error(enqueued.error || "Could not enqueue delegated question."), { code: enqueued.code || "DELEGATION_FAILED" });
        }
        sendChildEvent(childSessionId, childInvocationId, {
          type: "questions_required",
          ...proposal,
          delegatedChild: true,
          childSessionId,
          parentSessionId: sessionId,
        });
        try { onQuestionEnqueued?.({ ...enqueued, proposal, childInvocationId, childSessionId, parentKey: runKey }); } catch { /* best effort */ }
        return registerDelegatedQuestion({
          ...proposal,
          childInvocationId,
          childSessionId,
          parentKey: runKey,
          parentSessionId: sessionId,
        });
      }
      : null;
    const executeChildToolCall = async (request) => {
      const toolName = String(request?.toolCall?.function?.name || request?.toolCall?.toolName || "");
      if (toolName === "delegate_agent") {
        const denied = { ok: false, error: { code: "CHILD_TOOL_DENIED", message: "Delegated children cannot spawn agents." } };
        childActions.push({ toolName, target: targetFromToolCall(request), ok: false, code: "CHILD_TOOL_DENIED" });
        return denied;
      }
      let toolResult;
      const effectId = `${engine.cachedRound?.id || engine.runId}:${request.toolCall?.id || request.toolCall?.callId || crypto.randomUUID()}`;
      const signature = crypto.createHash("sha256").update(JSON.stringify(request.toolCall)).digest("hex");
      const prior = engine.completedEffects.get(effectId);
      if (prior) {
        if (prior.signature !== signature) throw Object.assign(new Error("The saved child tool call has different arguments."), { code: "CHILD_EFFECT_CONFLICT" });
        return prior.result;
      }
      try {
        if (checkpointChild) await engine.persist({ effect: { id: effectId, roundId: engine.cachedRound?.id, signature, toolName, status: "started" } });
        toolResult = await executeToolCall({
          ...request,
          sessionId: childSessionId,
          model: childModel,
          provider: engine.contextPlan.provider,
          blockId,
          nested: true,
          authorityProfile: engine.binding.authorityProfile,
          childInvocationId,
          durableRunId: engine.runId,
          operationId: effectId,
          ...(toolName === "ask_questions" && delegatedQuestionProvider ? { questionProvider: delegatedQuestionProvider } : {}),
        });
        if (checkpointChild) await engine.persist({ effect: { id: effectId, roundId: engine.cachedRound?.id, signature, toolName, status: "completed", result: toolResult } });
        engine.completedEffects.set(effectId, { signature, result: toolResult });
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
      childActions,
      run: async () => {
        const liveInput = coordinator?.peekSteerQueue && coordinator?.acknowledgeSteers && coordinator?.sealSteering ? {
          boundary: async ({ revision }) => {
            if (engine.cachedRound) return { ok: true, revision, cancellationEpoch: 0, deliveries: [], pendingPlan: engine.cachedRound };
            for (const item of coordinator.peekSteerQueue(childInvocationId, runKey)) {
              if (!engine.deliveries.has(item.id)) {
                engine.revision += 1;
                engine.deliveries.set(item.id, { id: item.id, text: item.instruction, contextText: item.contextText, revision: engine.revision, ...(item.intentScope ? { intentScope: item.intentScope } : {}) });
              }
            }
            return { ok: true, revision: engine.revision, cancellationEpoch: 0,
              deliveries: [...engine.deliveries.values()].filter((item) => item.revision > revision) };
          },
          prepareRound: async ({ revision, result, engineSnapshot }) => {
            const id = `child-round:${crypto.randomUUID()}`;
            const plan = { id, revision, result: identifyToolCalls(result, id), accounting: engineSnapshot.accounting };
            if (checkpointChild) await engine.persist({ engineSnapshot: { ...engineSnapshot, pendingPlan: plan } });
            engine.cachedRound = plan;
            return { ok: true, plan };
          },
          checkpoint: async ({ engineSnapshot, appendedMessages, consumedPlanId }) => {
            const pending = coordinator.peekSteerQueue(childInvocationId, runKey);
            const applied = new Set(engineSnapshot.appliedInputIds || []);
            if (!checkpointChild && pending.some((item) => applied.has(item.id))) throw Object.assign(new Error("The child steering checkpoint requires encrypted durable storage."), { code: "CHILD_DURABILITY_REQUIRED" });
            const pendingPlan = consumedPlanId === engine.cachedRound?.id ? null : engine.cachedRound;
            engineSnapshot = { ...engineSnapshot, pendingPlan };
            if (checkpointChild) await engine.persist({ engineSnapshot, appendedMessages });
            engine.cachedRound = pendingPlan;
            await checkpointRun({ runId: engine.runId, status: engineSnapshot.runState?.status || "running",
              checkpoint: { accounting: engineSnapshot.accounting, engineSnapshot }, appendedMessages },
            { childSessionId, childInvocationId, generation, operation });
            engine.snapshot = engineSnapshot;
            coordinator.acknowledgeSteers(childInvocationId, runKey, engineSnapshot.appliedInputIds || []);
            return { ok: true };
          },
          finalize: async ({ engineSnapshot, appendedMessages }) => {
            if (checkpointChild) {
              const prepared = { ...engineSnapshot, pendingCompletion: { revision: engineSnapshot.revision },
                runState: { ...engineSnapshot.runState, status: "running", completedAt: "" } };
              engine.preparedCompletion = prepared.pendingCompletion;
              const receipt = await engine.persist({ engineSnapshot: prepared, appendedMessages });
              if (typeof beforeChildFinalize === "function") {
                const gate = await beforeChildFinalize({ childInvocationId, childSessionId, engineRef: receipt.value.engineRef, engineSnapshot: prepared });
                if (gate?.ok !== true) throw Object.assign(new Error(gate?.error || "The parent did not accept the child completion checkpoint."), { code: gate?.code || "CHILD_FINALIZATION_FAILED" });
                if (typeof gate.completed !== "boolean") throw Object.assign(new Error("The parent child-completion response has no terminal decision."), { code: "CHILD_FINALIZATION_INVALID" });
                if (gate.completed !== true) return gate;
              }
              engine.finalizationAccepted = true;
              await engine.persist({ engineSnapshot: { ...engineSnapshot, pendingCompletion: null }, appendedMessages, terminal: true });
              engine.preparedCompletion = null;
            }
            return coordinator.sealSteering(childInvocationId, runKey);
          },
        } : null;
        const lastResult = await runAgentTurn({
            workspace,
            runId: engine.runId,
            engineSnapshot: engine.snapshot,
            releasePendingEndTurn: Boolean(engine.snapshot?.pendingCompletion),
            roundAccountingSnapshot: engine.snapshot?.accounting || null,
            model: childModel,
            numCtx: Math.max(4_096, Number(engine.binding.numCtx) || 8_192),
            contextBudget: Math.max(4_096, Number(contextPlan?.promptBudgetTokens || numCtx) || 8_192),
            contextPlan: engine.contextPlan,
            thinking: engine.binding.thinking,
            reasoningEffort: engine.binding.reasoningEffort,
            tools: childTools,
            mode: engine.binding.mode,
            modeFamily: engine.binding.modeFamily,
            projectProfile,
            projectId,
            intelligence,
            tier1Context,
            tier1Model: getTier1Model({ model: childModel, provider: engine.contextPlan.provider, reasoningEffort: engine.binding.reasoningEffort }),
            loadChatReferenceSnapshot,
            workingReferences,
            authorityProfile: engine.binding.authorityProfile,
            sessionId: childSessionId,
            memorySessionId: memorySessionIdFor(childSessionId, childInvocationId),
            userMessage: String(input?.task || ""),
            initialInputId: `${engine.runId}:initial`,
            chatHistory: [...engine.history],
            specialSkill: { prompt: contextText },
            skillRouter: skillRouter ? { ...skillRouter, freshRun: operation === "spawn" } : null,
            checklistEnabled,
            liveInput,
            signal: childController.signal,
            sendEvent: (event) => sendChildEvent(childSessionId, childInvocationId, event),
            runModelRound: (roundPayload) => runModelRound(senderId, roundPayload, {
              onThinking: roundPayload.onThinking,
              onToken: roundPayload.onToken,
              onToolCalls: roundPayload.onToolCalls,
              onStreamEvent: roundPayload.onStreamEvent,
            }, engine.runId),
            executeToolCall: executeChildToolCall,
            listRunningCommands,
            toolMetadataForName: (name) => toolMetadataForName(name, childSessionId),
            checkpointRun: async (patch) => {
              await checkpointRun(patch, { childSessionId, childInvocationId, generation, operation });
              if (patch.checkpoint?.engineSnapshot) engine.snapshot = patch.checkpoint.engineSnapshot;
            },
            nested: true,
            maxAgentRounds: Infinity,
          });
        if (lastResult?.engineSnapshot && !(engine.finalizationAccepted && engine.preparedCompletion)) engine.snapshot = lastResult.engineSnapshot;
        if (checkpointChild && !liveInput && lastResult?.engineSnapshot) await engine.persist({ engineSnapshot: lastResult.engineSnapshot, appendedMessages: lastResult.appendedMessages || [] });
        if (Array.isArray(lastResult?.appendedMessages)) engine.history.push(...lastResult.appendedMessages);
        return lastResult;
      },
    };
  }

  async function executeChild({ input, executionContext = null, childSessionId, blockId = "", childInvocationId, childController, generation = 1, operation = "spawn", previousHistory = [], model = "", dispatch = null, assignment = null, cleanup = null, restored = null } = {}) {
    const selectedChildModel = String(subagentModel || parentModel || "").trim();
    let effectiveModel = String(model || selectedChildModel).trim();
    const requestedModel = effectiveModel;
    let fallbackUsed = false;
    const engine = {
      runId: restored?.engineRef.runId || `child:${crypto.createHash("sha256").update(`${runKey}|${childInvocationId}|${generation}|${operation}`).digest("hex").slice(0, 40)}`,
      history: restored?.history || (Array.isArray(previousHistory) ? [...previousHistory] : []),
      prefixMessages: restored?.prefixMessages || [], snapshot: restored?.engineSnapshot || null,
      revision: restored?.engineSnapshot?.revision || 0, deliveries: new Map(),
      contextPlan: restored?.binding?.contextPlan || (contextPlan ? { ...contextPlan, provider: contextPlan.provider || getActiveProvider() } : { provider: getActiveProvider() }),
      binding: restored?.binding || { numCtx, thinking, reasoningEffort, authorityProfile, mode, modeFamily },
      preparedCompletion: restored?.engineSnapshot?.pendingCompletion || null,
      cachedRound: restored?.engineSnapshot?.pendingPlan || null,
      completedEffects: new Map((restored?.completedEffects || []).map((effect) => [effect.id, effect])),
    };
    for (const message of engine.snapshot?.inputMessages || []) if (message.source_message_id && message.task_revision > 0) engine.deliveries.set(message.source_message_id, { id: message.source_message_id, text: message.content, revision: message.task_revision, ...(message.intent_scope ? { intentScope: message.intent_scope } : {}) });
    engine.persist = async ({ engineSnapshot = engine.snapshot, appendedMessages = engine.appendedMessages || [], effect = null, terminal = false } = {}) => {
      if (!terminal && engineSnapshot && engine.preparedCompletion) {
        if (engineSnapshot.revision === engine.preparedCompletion.revision) engineSnapshot = { ...engineSnapshot, pendingCompletion: engine.preparedCompletion,
          runState: { ...engineSnapshot.runState, status: "running", completedAt: "" } };
        else engine.preparedCompletion = null;
      }
      const receipt = requireReceipt(await checkpointChild({ workspace, childSessionId, childInvocationId, parentSessionId: sessionId,
        blockId, runId: engine.runId, originalGoal: String(input?.task || ""), input, generation, operation,
        binding: { ...(restored?.binding || {}), provider: engine.contextPlan.provider, contextPlan: engine.contextPlan,
          model: effectiveModel, ...engine.binding },
        engineSnapshot, prefixMessages: engine.prefixMessages, appendedMessages, effect }));
      const child = coordinator?.getChild?.(childInvocationId, runKey);
      if (child) child.engineRef = receipt.value.engineRef;
      if (typeof onChildCheckpoint === "function") await onChildCheckpoint({ childSessionId, childInvocationId, engineRef: receipt.value.engineRef });
      engine.snapshot = engineSnapshot;
      engine.appendedMessages = appendedMessages;
      return receipt;
    };
    let runSpec = buildRun({ input, executionContext, childSessionId, blockId, childInvocationId, childController, generation, operation, previousHistory, model: effectiveModel, engine });
    sendChildEvent(childSessionId, childInvocationId, {
      type: "subagent_started",
      status: "working",
      operation,
      model: String(subagentModel || parentModel || "").trim(),
      task: String(input?.task || ""),
      summary: oneLiner(input?.task || "", "Working on delegated task"),
    });
    try {
      if (checkpointChild) await engine.persist();
      let result = await runSpec.run();
      let retried = false;
      if (!engine.finalizationAccepted && runSpec.childActions.length === 0 && isRetryableChildFailure(result) && !childController.signal.aborted && childResultStatus(result) === "failed") {
        retried = true;
        sendChildEvent(childSessionId, childInvocationId, { type: "subagent_activity", model: effectiveModel, summary: "Retrying the child once after a model or timeout failure." });
        runSpec = buildRun({ input, executionContext, childSessionId, blockId, childInvocationId, childController, generation, operation, previousHistory, model: effectiveModel, engine });
        result = await runSpec.run();
      }
      const fallbackModel = String(parentModel || "").trim();
      if (!engine.finalizationAccepted && fallbackModel && effectiveModel !== fallbackModel && runSpec.childActions.length === 0 && isModelAvailabilityFailure(result) && !childController.signal.aborted) {
        sendChildEvent(childSessionId, childInvocationId, { type: "subagent_activity", model: fallbackModel, summary: `Selected sub-agent model was unavailable; retrying with ${fallbackModel}.` });
        fallbackUsed = true;
        effectiveModel = fallbackModel;
        runSpec = buildRun({ input, executionContext, childSessionId, blockId, childInvocationId, childController, generation, operation, previousHistory, model: effectiveModel, engine });
        result = await runSpec.run();
      }
      const runtimeStatus = String(result?.runState?.status || "").toLowerCase();
      const status = childController.signal.aborted
        ? "stopped"
        : childResultStatus(result);
      let finding = boundChildFinding(parseChildFinding(result?.finalText || ""), { workspace, childInvocationId, retainSecrets: projectProfile?.dataHandling?.redactSecrets === false });
      const childSummary = finding.summary.slice(0, MAX_SUMMARY_CHARS);
      const error = String(result?.error || result?.runState?.stopReason || "").slice(0, MAX_SUMMARY_CHARS);
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
        output: {
          text: childSummary,
          format: "json",
          summary: childSummary,
          finding,
        },
        metadata: {
          model: effectiveModel,
          requestedModel,
          fallbackUsed,
          retried,
          provider: engine.contextPlan.provider,
          sessionId: childSessionId,
          runtimeStatus,
          executedTools: Boolean(result?.executedTools),
          actions: actionSummary(runSpec.childActions),
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

  function acceptancePayload({ childInvocationId, childSessionId = "", status = "queued", operation = "spawn", summary = "", format = "text", extra = {} }) {
    return {
      ok: true,
      acceptance: true,
      childInvocationId,
      childSessionId,
      status,
      operation,
      output: { text: "", format, summary },
      metadata: { sessionId: childSessionId, operation, ...extra },
      ...extra,
    };
  }

  const delegate = async function delegate(input, executionContext, runtime = {}) {
    const operation = String(input?.operation || "spawn").toLowerCase();
    if (!coordinator) {
      if (operation !== "spawn" && operation !== "follow_up") {
        throw Object.assign(new Error("Delegation coordinator is unavailable."), { code: "DELEGATE_AGENT_PROVIDER_UNAVAILABLE" });
      }
    } else if (operation === "list") {
      return acceptancePayload({
        childInvocationId: "list",
        status: "completed",
        operation: "list",
        summary: "Roster listed.",
        format: "json",
        children: coordinator.listChildren(runKey),
      });
    } else if (operation === "inspect") {
      const entry = coordinator.getRosterEntry(runKey, input?.childInvocationId);
      if (!entry) throw Object.assign(new Error("The delegated child no longer exists."), { code: "UNKNOWN_SUBAGENT" });
      return acceptancePayload({
        childInvocationId: entry.childInvocationId,
        childSessionId: entry.childSessionId,
        status: entry.status,
        operation: "inspect",
        summary: entry.taskSummary,
        roster: entry,
      });
    } else if (operation === "stop") {
      const existing = coordinator.getChild(input?.childInvocationId, runKey);
      if (!existing) throw Object.assign(new Error("The delegated child no longer exists."), { code: "UNKNOWN_SUBAGENT" });
      if (existing.status === "completed" || existing.status === "stopped" || existing.status === "failed") {
        return acceptancePayload({
          childInvocationId: existing.childInvocationId,
          childSessionId: existing.childSessionId,
          status: existing.status,
          operation: "stop",
          summary: "Child already terminal.",
        });
      }
      coordinator.cancelChild(existing.childInvocationId, runKey);
      return acceptancePayload({
        childInvocationId: existing.childInvocationId,
        childSessionId: existing.childSessionId,
        status: "stopped",
        operation: "stop",
        summary: "Stop accepted.",
      });
    } else if (operation === "steer") {
      const instruction = buildChildContextText(input, executionContext);
      const steered = coordinator.enqueueSteer({
        parentKey: runKey,
        childInvocationId: input?.childInvocationId,
        instruction,
      });
      if (!steered.ok) throw Object.assign(new Error(steered.error || "Steer rejected."), { code: steered.code || "DELEGATION_FAILED" });
      return acceptancePayload({
        childInvocationId: steered.childInvocationId,
        childSessionId: steered.childSessionId,
        status: steered.status,
        operation: "steer",
        summary: "Steer queued.",
        steerQueueLength: steered.steerQueueLength,
      });
    } else if (operation === "resolve_question") {
      const resolution = String(input?.resolution || "").toLowerCase();
      const resolved = coordinator.resolveQuestion({
        parentKey: runKey,
        questionRequestId: input?.questionRequestId || "",
        resolution,
      });
      if (!resolved.ok) throw Object.assign(new Error(resolved.error || "Question could not be resolved."), { code: resolved.code || "DELEGATION_FAILED" });
      try { onDelegatedQuestionResolved?.(resolved, input); } catch { /* best effort */ }
      return {
        ok: true,
        questionRequestId: resolved.questionRequestId,
        childInvocationId: resolved.childInvocationId,
        childSessionId: resolved.childSessionId,
        resolution: resolved.resolution,
        escalated: resolved.escalated,
      };
    }

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
      return acceptancePayload({
        childInvocationId: existing.childInvocationId,
        childSessionId,
        status: queued.status,
        operation: "follow_up",
        summary: "Follow-up accepted.",
        format: String(prepared.input.expectedOutput?.format || "text"),
        generation: queued.generation,
        memoryDispatch: prepared.dispatch ? { packetId: prepared.dispatch.packet?.packet_id || "", packetHash: prepared.dispatch.packetHash || "" } : null,
        memoryAssignment: prepared.assignment?.lease ? { leaseId: prepared.assignment.lease.lease_id } : null,
      });
    }

    const spawnAgents = Array.isArray(input?.agents) && input.agents.length
      ? input.agents
      : [{
        task: input?.task,
        contextPackage: input?.contextPackage,
        expectedOutput: input?.expectedOutput,
      }];

    if (coordinator && operation === "spawn") {
      const admission = coordinator.validateSpawnAdmission?.(runKey, spawnAgents.length);
      if (admission && !admission.ok) {
        throw Object.assign(new Error(admission.error || "Spawn rejected."), { code: admission.code || "DELEGATION_FAILED" });
      }
    }

    const acceptedChildren = [];
    for (const agentSpec of spawnAgents) {
      const spawnInput = { ...input, ...agentSpec, operation: "spawn" };
    const childInvocationId = `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const childSessionSeed = `subagent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const childSession = await beginSession({
      childSessionId: childSessionSeed,
      childInvocationId,
      task: spawnInput?.task,
      model: String(subagentModel || parentModel || ""),
      operation,
    });
    const childSessionId = childSession.sessionId;
    const prepared = await prepareDelegation({ input: spawnInput, executionContext, childInvocationId, childSessionId, operation });
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
            task: String(spawnInput?.task || ""),
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
            output: { text: "", format: String(spawnInput?.expectedOutput?.format || "text"), summary: "Stopped before the child started." },
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
      acceptedChildren.push({
        childInvocationId,
        childSessionId,
        status: started.status,
        generation: started.generation,
      });
      continue;
    }

    try {
      const outcome = await executeChild({ input: prepared.input, executionContext, childSessionId, blockId: childSession.blockId, childInvocationId, childController, generation: 1, operation, model: String(subagentModel || parentModel || "").trim(), dispatch: prepared.dispatch, assignment: prepared.assignment, cleanup: childControllerState.cleanup });
      return { childInvocationId, output: outcome.output, status: outcome.status, metadata: outcome.metadata };
    } finally {
      unregisterChildRun?.(childSessionId);
    }
    }

    if (coordinator && acceptedChildren.length) {
      const head = acceptedChildren[0];
      return acceptancePayload({
        childInvocationId: head.childInvocationId,
        childSessionId: head.childSessionId,
        status: head.status,
        operation: "spawn",
        summary: acceptedChildren.length === 1
          ? "Child accepted and running in the background."
          : `${acceptedChildren.length} delegated children accepted and running in the background.`,
        format: String(spawnAgents[0]?.expectedOutput?.format || "text"),
        generation: head.generation,
        children: acceptedChildren.map(({ childInvocationId, childSessionId, status }) => ({ childInvocationId, childSessionId, status })),
      });
    }

    throw Object.assign(new Error("Delegation coordinator is unavailable."), { code: "DELEGATE_AGENT_PROVIDER_UNAVAILABLE" });
  };
  delegate.recoverChildren = async (runtime = {}) => {
    const recovered = [];
    for (const child of coordinator?.recoverableChildren?.(runKey) || []) {
      try {
        if (!loadChild || !checkpointChild) throw Object.assign(new Error("Durable child recovery is unavailable."), { code: "CHILD_RECOVERY_UNAVAILABLE" });
        const receipt = requireReceipt(await loadChild({ workspace, engineRef: child.engineRef }));
        const saved = receipt.value;
        const parentIds = new Set([sessionId, ...(Array.isArray(parentSessionAliases) ? parentSessionAliases : [])].map(String));
        if (saved.childInvocationId !== child.childInvocationId || !parentIds.has(saved.parentSessionId)) throw Object.assign(new Error("The child engine belongs to another parent."), { code: "CHILD_REFERENCE_INVALID" });
        if (saved.pendingEffects?.length) throw Object.assign(new Error("A child tool effect has an unknown outcome. Reconcile it before resuming."), { code: "CHILD_EFFECT_UNKNOWN" });
        coordinator.acknowledgeSteers(child.childInvocationId, runKey, saved.engineSnapshot?.appliedInputIds || []);
        if (["completed", "stopped", "failed"].includes(saved.status) && !child.steerQueue.length) {
          const status = saved.status === "stopped" ? "stopped" : childResultStatus({ runState: { status: saved.status }, executedTools: saved.engineSnapshot?.executedTools });
          const finding = parseChildFinding(saved.engineSnapshot?.finalText || "");
          coordinator.completeChild(child.childInvocationId, { status, output: { text: finding.summary, format: "json", finding }, metadata: { recovered: true, engineRef: child.engineRef, executedTools: Boolean(saved.engineSnapshot?.executedTools) } });
          recovered.push({ childInvocationId: child.childInvocationId, status });
          continue;
        }
        const state = createChildController(runtime);
        childSessionBindings.set(child.childSessionId, { sessionId: child.childSessionId, blockId: saved.engineRef.blockId, projectId: receipt.projectId });
        registerChildRun?.({ parentRunKey: runKey, childSessionId: child.childSessionId, controller: state.controller });
        const resumed = coordinator.resumeRestoredChild({ childInvocationId: child.childInvocationId, parentKey: runKey, controller: state.controller,
          onCancel: state.cleanup,
          start: () => executeChild({ input: saved.input, childSessionId: child.childSessionId, blockId: saved.engineRef.blockId,
            childInvocationId: child.childInvocationId, childController: state.controller, generation: saved.generation,
            operation: saved.operation, model: saved.binding.model || child.model, restored: saved,
            cleanup: () => { state.cleanup(); unregisterChildRun?.(child.childSessionId); } }) });
        if (!resumed.ok) { state.cleanup(); unregisterChildRun?.(child.childSessionId); throw Object.assign(new Error(resumed.error), { code: resumed.code }); }
        recovered.push({ childInvocationId: child.childInvocationId, status: "working", runId: saved.engineRef.runId });
      } catch (error) {
        coordinator.completeChild(child.childInvocationId, { status: "failed", output: { text: "", summary: error.message },
          metadata: { error: error.message, code: error.code || "CHILD_RECOVERY_FAILED", engineRef: child.engineRef } });
        recovered.push({ childInvocationId: child.childInvocationId, status: "failed", code: error.code || "CHILD_RECOVERY_FAILED" });
      }
    }
    return { ok: true, recovered };
  };
  return delegate;
}

module.exports = {
  MAX_TASK_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_SUMMARY_CHARS,
  WORKSPACE_MUTATION_TOOLS,
  oneLiner,
  buildChildContextText,
  appendSteeringUpdate,
  isModelAvailabilityFailure,
  childResultStatus,
  parseChildFinding,
  boundChildFinding,
  isRetryableChildFailure,
  createRuntimeDelegationProvider,
};
