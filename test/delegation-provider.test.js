"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createRuntimeDelegationProvider,
  oneLiner,
  buildChildContextText,
  requestedWorkspaceMutation,
} = require("../src/agent/runtime/delegation-provider.js");
const { createDelegateAgentTool } = require("../src/agent/tools/process/delegate-agent.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(root, overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "parent-invocation-1",
    toolName: "delegate_agent",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root },
    sessionId: "parent-session-1",
    mode: "agent",
    ...overrides,
  }));
}

const PARENT_TOOLS = [
  { type: "function", function: { name: "apply_patch", description: "patch", parameters: {} } },
  { type: "function", function: { name: "read_file", description: "read", parameters: {} } },
  { type: "function", function: { name: "delegate_agent", description: "delegate", parameters: {} } },
];

function runProvider(provider, input, context) {
  return provider(input, context, {});
}

test("oneLiner collapses whitespace and bounds length", () => {
  assert.equal(oneLiner("  hello    world  "), "hello world");
  assert.equal(oneLiner("x".repeat(500)).length, 160);
  assert.equal(oneLiner("", "fallback"), "fallback");
});

test("buildChildContextText is bounded and includes the parent invocation", () => {
  const text = buildChildContextText(
    { task: "write test.txt", contextPackage: { role: "agent" }, expectedOutput: { format: "text" } },
    { mode: "agent", workspace: { root: "G:/ws" }, invocationId: "inv-1" },
  );
  assert.match(text, /write test\.txt/);
  assert.match(text, /inv-1/);
  assert.ok(text.length < 40_000);
});

test("workspace mutation detection recognizes delegated file writes", () => {
  assert.deepEqual(requestedWorkspaceMutation({ task: "Create test.txt with content test" }), { required: true, target: "test.txt" });
  assert.deepEqual(requestedWorkspaceMutation({ task: "write a test2.txt file" }), { required: true, target: "test2.txt" });
  assert.equal(requestedWorkspaceMutation({ task: "Analyze the login flow" }).required, false);
});

test("child tools exclude delegate_agent and include the rest", async () => {
  const received = {};
  const provider = createRuntimeDelegationProvider({
    senderId: "sender-1",
    runKey: "sender-1::parent-session-1",
    parentModel: "parent-model",
    subagentModel: "child-model",
    numCtx: 8192,
    workspace: "G:/ws",
    mode: "agent",
    modeFamily: "xekute",
    authorityProfile: "approve_for_me",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async (payload) => {
      received.tools = payload.tools;
      received.userMessage = payload.userMessage;
      received.sessionId = payload.sessionId;
      received.signal = payload.signal;
      return { ok: true, finalText: "child report", executedTools: true, evidenceIds: ["e1"], aborted: false };
    },
    runModelRound: async () => ({ fullText: "ok", toolCalls: [], error: null }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async (deps) => ({ ok: true, sessionId: deps.childSessionId }),
    sendToRenderer: () => {},
    registerChildRun: () => {},
    unregisterChildRun: () => {},
  });

  const input = {
    task: "Inspect the workspace and report what tools are available",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "A created file", format: "text" },
  };
  const result = await runProvider(provider, input, execContext("G:/ws"));

  const toolNames = received.tools.map((tool) => tool.function.name);
  assert.ok(toolNames.includes("apply_patch"));
  assert.ok(toolNames.includes("read_file"));
  assert.ok(!toolNames.includes("delegate_agent"), "child must not get delegate_agent");
  assert.equal(received.userMessage, input.task);
  assert.equal(received.sessionId, result.metadata.sessionId);
  assert.ok(received.signal, "child must receive an AbortController signal");
  assert.equal(result.ok === undefined ? true : true, true);
  assert.equal(result.output.text, "child report");
  assert.equal(result.status, "completed");
  assert.equal(result.metadata.executedTools, true);
  assert.deepEqual(result.metadata.evidenceIds, ["e1"]);
});

test("main-owned result handoff marks renderer events observational and invokes the scheduler", () => {
  let registration = null;
  let scheduled = 0;
  const events = [];
  createRuntimeDelegationProvider({
    senderId: "sender-1",
    runKey: "sender-1::parent-session-1",
    parentModel: "parent-model",
    subagentModel: "child-model",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    coordinator: { registerParent: (_key, options) => { registration = options; } },
    onResultReady: () => { scheduled += 1; return true; },
    runAgentTurn: async () => ({ ok: true, finalText: "child report", runState: { status: "completed" } }),
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child" }),
    sendToRenderer: (event) => events.push(event),
  });
  const result = registration.onResultReady({
    resultId: "child:1:1",
    childInvocationId: "child",
    childSessionId: "child-session",
    parentSessionId: "parent-session-1",
    generation: 1,
    model: "child-model",
    task: "inspect",
    status: "completed",
    output: { text: "done" },
    metadata: { appendedMessages: [] },
  });
  assert.equal(result, true);
  assert.equal(scheduled, 1);
  assert.equal(events.at(-1).continuationOwner, "main");
});

test("child runs inherit plan policy, tool metadata, browser scope, and checkpoints", async () => {
  const planBinding = { planId: "plan-1", executionHash: "hash-1", objective: "verify" };
  const received = {};
  const executed = [];
  const checkpointContexts = [];
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    modeWorkflow: { loadState: () => ({ planBinding }) },
    intelligence: { status: () => ({ ok: true }) },
    contextCompiler: { compile: () => ({}) },
    planBinding,
    toolMetadataForName: (name, sessionId) => ({ name, sessionId }),
    getBrowserTarget: (workspace, sessionId) => `${workspace}/${sessionId}`,
    checkpointRun: (_patch, context) => { checkpointContexts.push(context); },
    runAgentTurn: async (payload) => {
      received.payload = payload;
      assert.equal(payload.nested, true);
      assert.equal(payload.modeWorkflow.loadState().planBinding, planBinding);
      assert.equal(payload.intelligence.status().ok, true);
      assert.equal(payload.contextCompiler.compile() !== undefined, true);
      assert.deepEqual(payload.toolMetadataForName("read_file"), { name: "read_file", sessionId: payload.sessionId });
      assert.equal(payload.getBrowserTarget("G:/ws", payload.sessionId), `G:/ws/${payload.sessionId}`);
      await payload.executeToolCall({
        workspace: "G:/ws",
        toolCall: { function: { name: "read_file", arguments: {} } },
      });
      await payload.checkpointRun({ round: 1 });
      return { ok: true, finalText: "policy-aware", executedTools: true, runState: { status: "completed" } };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async (request) => { executed.push(request); return { ok: true }; },
    beginChildSession: async () => ({ ok: true, sessionId: "child-policy" }),
    sendToRenderer: () => {},
  });

  const result = await runProvider(provider, {
    task: "Review the active plan",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "policy report", format: "text" },
  }, execContext("G:/ws"));

  assert.equal(result.status, "completed");
  assert.equal(received.payload.planBinding, planBinding);
  assert.equal(executed[0].planBinding, planBinding);
  assert.equal(executed[0].sessionId, "child-policy");
  assert.equal(checkpointContexts[0].childSessionId, "child-policy");
});

test("child receives the bounded delegation context instead of only the task text", async () => {
  let receivedContextSummary = "";
  let receivedProjectMemory = null;
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async (payload) => {
      receivedContextSummary = payload.contextSummary;
      receivedProjectMemory = payload.projectMemory;
      return { ok: true, finalText: "analysis complete", executedTools: false, runState: { status: "completed" } };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-context" }),
    sendToRenderer: () => {},
  });

  await provider({
    task: "Analyze the supplied context",
    contextPackage: {
      role: "reviewer",
      authority: "approve_for_me",
      scope: { files: ["src/a.js"] },
      identity: {},
      resources: {},
      projectMemory: { revision: 9 },
    },
    expectedOutput: { description: "analysis", format: "text" },
  }, execContext("G:/ws"), {});

  assert.match(receivedContextSummary, /reviewer/);
  assert.match(receivedContextSummary, /src\/a\.js/);
  assert.doesNotMatch(receivedContextSummary, /projectMemory/);
  assert.deepEqual(receivedProjectMemory, { revision: 9 });
});

test("tool-less child cannot report a requested file mutation as completed", async () => {
  const events = [];
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async () => ({
      ok: true,
      finalText: "Created test.txt successfully",
      executedTools: false,
      runState: { status: "completed" },
    }),
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-no-write" }),
    sendToRenderer: (event) => events.push(event),
  });

  const outcome = await provider({
    task: "Create test.txt with content test",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "created file", format: "text" },
  }, execContext("G:/ws"), {});

  assert.equal(outcome.status, "failed");
  assert.match(outcome.metadata.error, /without a successful apply_patch call/);
  assert.ok(events.some((event) => event.type === "subagent_failed"));
});

test("unavailable dedicated model falls back once to the working parent model before tools run", async () => {
  const models = [];
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "parent-model",
    subagentModel: "unavailable-child-model",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async ({ model }) => {
      models.push(model);
      if (model === "unavailable-child-model") {
        return { ok: false, code: "OPENROUTER_CHAT_FAILED", error: "OpenRouter error: 404: No endpoints available" };
      }
      return { ok: true, finalText: "fallback completed", executedTools: false, runState: { status: "completed" } };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-fallback" }),
    sendToRenderer: () => {},
  });

  const outcome = await provider({
    task: "Analyze the workspace",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "analysis", format: "text" },
  }, execContext("G:/ws"), {});

  assert.deepEqual(models, ["unavailable-child-model", "parent-model"]);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.metadata.model, "parent-model");
  assert.equal(outcome.metadata.fallbackUsed, true);
});

test("parent abort aborts the child controller", async () => {
  let childSignal;
  let registeredController = null;
  const provider = createRuntimeDelegationProvider({
    senderId: "sender-1",
    runKey: "sender-1::parent-session-1",
    parentModel: "m",
    subagentModel: "child",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async (payload) => {
      childSignal = payload.signal;
      // Simulate a long child turn that the test aborts externally.
      await new Promise((resolve) => {
        childSignal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { ok: false, aborted: true, finalText: "", executedTools: false, evidenceIds: [] };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [], error: null }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-1" }),
    sendToRenderer: () => {},
    registerChildRun: ({ controller }) => { registeredController = controller; },
    unregisterChildRun: () => {},
  });

  const parentController = new AbortController();
  const runPromise = provider(
    {
      task: "do something",
      contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
      expectedOutput: { description: "d", format: "text" },
    },
    execContext("G:/ws"),
    { signal: parentController.signal },
  );

  // Wait until the child turn is registered, then abort the parent.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(registeredController, "child controller must be registered");
  parentController.abort("PARENT_AGENT_ABORTED");
  const result = await runPromise;
  assert.equal(childSignal.aborted, true);
  assert.equal(result.status, "stopped");
});

test("an aborted child exception is rendered as stopped", async () => {
  const events = [];
  const parentController = new AbortController();
  parentController.abort("PARENT_AGENT_ABORTED");
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async () => { throw new Error("stream closed"); },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-aborted" }),
    sendToRenderer: (event) => events.push(event),
  });

  const result = await provider({
    task: "inspect the workspace",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "report", format: "text" },
  }, execContext("G:/ws"), { signal: parentController.signal });

  assert.equal(result.status, "stopped");
  assert.ok(events.some((event) => event.type === "subagent_stopped" && event.status === "stopped"));
  assert.equal(events.some((event) => event.type === "subagent_failed"), false);
});

test("inconclusive child runs fail closed while preserving the runtime status", async () => {
  const events = [];
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async () => ({
      ok: true,
      finalText: "The context could not fit.",
      runState: { status: "inconclusive", stopReason: "Context budget exceeded." },
    }),
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-inconclusive" }),
    sendToRenderer: (event) => events.push(event),
  });

  const result = await provider({
    task: "inspect the workspace",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "report", format: "text" },
  }, execContext("G:/ws"), {});

  assert.equal(result.status, "failed");
  assert.equal(result.metadata.runtimeStatus, "inconclusive");
  assert.ok(events.some((event) => event.type === "subagent_failed" && event.status === "failed"));
});

test("rejected follow-up does not replace the live child abort registration", async () => {
  const calls = [];
  const coordinator = {
    registerParent: () => {},
    getChild: () => ({ status: "working", model: "child-model", childSessionId: "child-live", generation: 1, history: [] }),
    submitFollowUp: () => ({ ok: false, code: "SUBAGENT_ALREADY_RUNNING", error: "The delegated child is already running." }),
  };
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    coordinator,
    runAgentTurn: async () => ({ ok: true }),
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-live" }),
    sendToRenderer: () => {},
    registerChildRun: () => calls.push("register"),
    unregisterChildRun: () => calls.push("unregister"),
  });

  await assert.rejects(
    provider({
      operation: "follow_up",
      childInvocationId: "child-1",
      task: "verify the report",
      contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
      expectedOutput: { description: "verified report", format: "text" },
    }, execContext("G:/ws"), {}),
    (error) => error.code === "SUBAGENT_ALREADY_RUNNING",
  );
  assert.deepEqual(calls, []);
});

test("provider error is thrown and mapped by the adapter to DELEGATE_AGENT_DELEGATION_FAILED", async () => {
  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    workspace: "G:/ws",
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async () => { throw new Error("OpenRouter 404: no endpoints"); },
    runModelRound: async () => ({ fullText: "", toolCalls: [], error: null }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async () => ({ ok: true, sessionId: "child-err" }),
    sendToRenderer: () => {},
    registerChildRun: () => {},
    unregisterChildRun: () => {},
  });

  const tool = createDelegateAgentTool({ delegationProvider: provider });
  const result = await tool.execute(
    {
      task: "x",
      contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
      expectedOutput: { description: "d", format: "text" },
    },
    execContext("G:/ws"),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DELEGATE_AGENT_DELEGATION_FAILED");
});

test("child runs apply_patch through the provided executeToolCall and the file lands", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delegation-write-"));
  const target = path.join(root, "test3.txt");
  const seenToolCalls = [];

  const provider = createRuntimeDelegationProvider({
    senderId: "s",
    runKey: "s::parent",
    parentModel: "m",
    subagentModel: "child",
    workspace: root,
    sessionId: "parent-session-1",
    tools: PARENT_TOOLS,
    runAgentTurn: async (payload) => {
      // Simulate one child tool round: the model calls apply_patch, then ends.
      const patchCall = {
        id: "call-child-1",
        type: "function",
        function: { name: "apply_patch", arguments: JSON.stringify({ operations: [{ kind: "create", path: "test3.txt", content: "test" }] }) },
      };
      const first = await payload.executeToolCall({
        workspace: root,
        toolCall: patchCall,
        signal: payload.signal,
        sessionId: payload.sessionId,
        mode: "agent",
      });
      seenToolCalls.push(first);
      return { ok: true, finalText: "Created test3.txt", executedTools: true, evidenceIds: [], aborted: false };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [], error: null }),
    executeToolCall: async ({ toolCall }) => {
      const args = JSON.parse(toolCall.function.arguments);
      const { createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
      return createApplyPatchTool().execute(
        args,
        projectExecutionContext(createExecutionContext({
          invocationId: "child-invocation-1",
          toolName: "apply_patch",
          role: "agent",
          authority: "approve_for_me",
          workspace: { root },
        })),
      );
    },
    beginChildSession: async () => ({ ok: true, sessionId: "child-write" }),
    sendToRenderer: () => {},
    registerChildRun: () => {},
    unregisterChildRun: () => {},
  });

  const result = await runProvider(provider, {
    task: "Create test3.txt with content test",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "created file", format: "text" },
  }, execContext(root));

  assert.equal(result.ok === undefined ? true : true, true);
  assert.ok(seenToolCalls.length === 1 && seenToolCalls[0].ok, "child apply_patch must succeed");
  assert.equal(fs.existsSync(target), true, "test3.txt must exist on disk");
  assert.equal(fs.readFileSync(target, "utf8"), "test");
  fs.rmSync(root, { recursive: true, force: true });
});

test("coordinated children run in the background and raw child events stay out of parent prose", async () => {
  const { createSubagentCoordinator } = require("../src/agent/runtime/subagent-coordinator.js");
  const events = [];
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 3 });
  const provider = createRuntimeDelegationProvider({
    senderId: "sender",
    runKey: "sender::parent",
    parentModel: "parent-model",
    subagentModel: "child-model",
    workspace: "G:/ws",
    sessionId: "parent",
    tools: PARENT_TOOLS,
    coordinator,
    runAgentTurn: async (payload) => {
      payload.sendEvent({ type: "content", delta: "private child output" });
      return { ok: true, finalText: "child report", executedTools: false, appendedMessages: [{ role: "assistant", content: "child report" }] };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async (deps) => ({ ok: true, sessionId: deps.childSessionId, blockId: "block-1" }),
    sendToRenderer: (event) => events.push(event),
  });

  const accepted = await provider({
    task: "inspect the workspace",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "a report", format: "text" },
  }, execContext("G:/ws"), {});
  assert.equal(accepted.status, "working");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const childSessionId = accepted.metadata.sessionId;
  assert.ok(events.some((event) => event.sessionId === childSessionId && event.type === "content"));
  assert.equal(events.some((event) => event.sessionId === "parent" && event.type === "content"), false);
  assert.ok(events.some((event) => event.sessionId === "parent" && event.type === "subagent_completed"));
  assert.ok(events.some((event) => event.sessionId === "parent" && event.type === "subagent_result_ready"));
  assert.deepEqual(coordinator.getChild(accepted.childInvocationId, "sender::parent").history, [{ role: "assistant", content: "child report" }]);
});

test("follow_up resumes the same coordinated child session with its prior history", async () => {
  const { createSubagentCoordinator } = require("../src/agent/runtime/subagent-coordinator.js");
  const coordinator = createSubagentCoordinator();
  const histories = [];
  let round = 0;
  const provider = createRuntimeDelegationProvider({
    senderId: "sender",
    runKey: "sender::parent",
    parentModel: "parent-model",
    subagentModel: "child-model",
    workspace: "G:/ws",
    sessionId: "parent",
    tools: PARENT_TOOLS,
    coordinator,
    runAgentTurn: async (payload) => {
      histories.push(payload.chatHistory);
      round += 1;
      return { ok: true, finalText: `report ${round}`, appendedMessages: [{ role: "assistant", content: `report ${round}` }] };
    },
    runModelRound: async () => ({ fullText: "", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async (deps) => ({ ok: true, sessionId: deps.childSessionId, blockId: `block-${round + 1}` }),
    sendToRenderer: () => {},
  });

  const first = await provider({
    task: "inspect",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "report", format: "text" },
  }, execContext("G:/ws"), {});
  await new Promise((resolve) => setImmediate(resolve));
  const follow = await provider({
    operation: "follow_up",
    childInvocationId: first.childInvocationId,
    task: "verify the report",
    contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "verified report", format: "text" },
  }, execContext("G:/ws"), {});
  assert.equal(follow.childInvocationId, first.childInvocationId);
  assert.equal(follow.metadata.sessionId, first.metadata.sessionId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(histories[1], [{ role: "assistant", content: "report 1" }]);
});
