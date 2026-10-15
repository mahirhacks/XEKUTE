"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { createSubagentCoordinator } = require("../../src/agent/runtime/subagent-coordinator.js");
const { computeOrchestrationHold } = require("../../src/agent/runtime/orchestration-hold.js");
const { isMemoryId } = require("../../src/contracts/memory/index.js");
const { createAgentSessionRuntime, assignTaskWave } = require("../../src/agent/runtime/agent-session-runtime.js");
const { createChatReferenceResolver } = require("../../src/agent/runtime/chat-references.js");

const mainSource = fs.readFileSync(path.join(__dirname, "../../src/app/electron/main.js"), "utf8");

function definition(start, end) {
  const first = mainSource.indexOf(start);
  const last = mainSource.indexOf(end, first);
  if (first < 0 || last < 0) throw new Error(`Main handler boundary is missing: ${start}`);
  return mainSource.slice(first, last);
}

// Exercise the production handler with injected boundaries without booting
// Electron, opening a window, or starting provider/process services.
const handlerSource = [
  definition("function rememberParentRunDescriptor(", "function appendParentRunHistory("),
  definition("function appendParentRunHistory(", "function scheduleParentContinuation("),
  definition("async function handleAgentRun(", 'ipcMain.handle("agent:run",'),
  definition('ipcMain.handle("agent:run",', '// The context meter reads Tier 1 directly'),
  definition("async function resumeInterruptedRuns(", 'ipcMain.handle("agent:pendingParentContinuations",'),
].join("\n");

function createAgentRunHandlerFixture() {
  const ready = [];
  const events = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => ready.push(result) });
  const parentRunDescriptors = new Map();
  const agentRunControllers = new Map();
  const ipcHandlers = new Map();
  const sender = { id: 1, isDestroyed: () => false, send: (_channel, event) => events.push(event) };
  const context = {
    crypto,
    path,
    fs: { existsSync: () => false },
    AbortController,
    ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    setImmediate,
    parentRunDescriptors,
    agentSessionRuntime: null,
    controlSessionOwners: new Map(),
    scheduleLiveInputWake() {},
    liveInputWakeups: new Set(),
    parkedCommandWaits: new Map(),
    taskResources: { execute: (_request, perform) => perform() },
    delegatedChildren: { checkpointChild() {}, loadChild() {} },
    createAgentSessionRuntime,
    createChatReferenceResolver,
    assignTaskWave,
    llmPreferences: () => ({}),
    getOpenRouterBaseUrl: () => "",
    getOpenRouterApiKey: () => "",
    parentRunChildren: new Map(),
    matchesAgentRunKey: (key, _senderId, sessionId) => key === `session:${sessionId}` || key.startsWith(`session:${sessionId}::`),
    agentRunControllers,
    parentContinuationOutbox: new Map(),
    resumeInFlight: new Set(),
    subagentCoordinator: coordinator,
    isMemoryId,
    powerSaveActive: false,
    bindAgentSender() {},
    abortAgentSession() {},
    senderForSession: (_id, fallback) => fallback,
    sessionRunKey: (id, background = false) => `session:${id || "__default__"}${background ? "::background" : ""}`,
    tier1SessionIdForRun: () => "session_00000000-0000-4000-8000-000000008101",
    tier1BlockId: () => "block_00000000-0000-4000-8000-000000008102",
    syncPowerSaveBlocker: () => { context.powerSaveActive = agentRunControllers.size > 0; },
    createAgentTerminalHost: () => ({}),
    terminals: new Map(),
    createHiddenCommandReveal() {},
    HIDDEN_COMMAND_REVEAL_MS: 1000,
    displayExecCommand() {},
    agentTerminalRunner: {},
    createRuntimeDelegationProvider: () => async () => ({}),
    toolCatalogFromRegistry: () => ({ mode: "native", tools: [] }),
    normalizeAuthorityProfile: (profile) => profile || "approve_for_me",
    readProjectProfile: () => null,
    normalizeProfile: (family, key) => ({ family, key }),
    defaultRegistry: {},
    selectInternalSkill: () => ({ ok: false }),
    createSpecialSkillToolDefinitions: () => [],
    registerChildRun() {},
    unregisterChildRun() {},
    getActiveProvider: () => "ollama",
    getBrowserTarget: () => "",
    registerDelegatedQuestion() {},
    parentContinuationInFlight: () => false,
    scheduleParentContinuation: () => false,
    scheduleParentQuestionContinuation() {},
    afterDelegatedQuestionResolved() {},
    buildSubagentResultPrompt: (result) => `Child result ${result.resultId}`,
    buildSubagentQuestionHeadPrompt: () => "Child question",
    runTier1CheckpointModel: async () => ({}),
    runOllamaAgentRound: async () => ({}),
    executeToolCall: async () => ({ ok: true }),
    requestToolApproval() {},
    requestOperatorQuestions() {},
    findWorkspaceFiles() {},
    searchWorkspaceIndex() {},
    globalGuidanceRoot: () => "",
    computeOrchestrationHold,
    Tunables: { LONG_HORIZON_STALE_RUN_MS: 1000 },
    objectiveFromRun: (run) => run.objective,
    liveRunForSession: (id) => agentRunControllers.has(`session:${id}`) || agentRunControllers.has(`session:${id}::background`),
    runAgentTurn: async () => ({ ok: true, finalText: "Done", runState: { status: "completed" }, appendedMessages: [] }),
    assessmentWorkspace: { createRun: () => ({ ok: false }), updateRun: () => ({ ok: true }) },
    container: {
      toolRegistry: {},
      mcpRuntime: { definitionsForSession: () => [] },
      assessmentIntelligence: {},
      memoryProjectIdentityStore: {
        resolveV3Project: () => ({ ok: true, projectId: "proj_00000000-0000-4000-8000-000000008100" }),
      },
      projectArtifacts: {},
      durableProcessManager: { reconcile: async () => [] },
      longHorizonRunStore: {
        known: () => [], listBySession: () => [], listResumeEligible: () => [],
        get: () => null,
        reconcile: async () => [], begin: async () => ({}),
        checkpoint: async () => ({}), finish: async () => ({}), resume: async () => ({}),
      },
      v3SessionStore: { record: async () => ({ ok: true, durable: true, encrypted: true }) },
    },
  };
  context.refreshParentOrchestrationFlags = (key) => ({
    orchestrationHold: computeOrchestrationHold(coordinator, key),
    pendingEndTurn: Boolean(parentRunDescriptors.get(key)?.pendingEndTurn),
  });
  const handlers = vm.runInNewContext(`${handlerSource}\n({ handleAgentRun, resumeInterruptedRuns })`, context);
  return { context, coordinator, ready, events, sender, handlers, invoke: (payload, options) => handlers.handleAgentRun({ sender }, payload, options), invokeIpc: (channel, payload) => ipcHandlers.get(channel)({ sender }, payload),
    installSessionRuntime: () => vm.runInContext(`${definition("const agentSessionRuntime = createAgentSessionRuntime(", "function scheduleLiveInputWake(")}\nagentSessionRuntime;`, context),
    installInputWake: () => vm.runInContext(definition("function scheduleLiveInputWake(", "let powerSaveBlockerId"), context),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

async function queueChildResult(fixture, parentKey = "session:parent") {
  fixture.coordinator.submitChild({
    parentKey, parentSessionId: "parent", senderId: "1",
    childInvocationId: "child-1", childSessionId: "child-session",
    start: async () => ({ status: "completed", output: { text: "child answer" }, metadata: {} }),
  });
  await tick();
  return fixture.coordinator.snapshot(parentKey).resultQueue[0];
}

module.exports = { createAgentRunHandlerFixture, deferred, tick, queueChildResult };
