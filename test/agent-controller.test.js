const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AgentToolSurface = require("../src/agent/tools/config/tool-surface.js");
const {
  MAX_AGENT_ROUNDS,
  buildEngagementPromptContext,
  isReasonablyLargeAgentRequest,
  runAgentTurn,
  trimHistoryForContext,
  selectHistoryGroups,
  fitMessagesToContext,
  advanceTowardPhase,
  toolCallSignature,
} = require("../src/agent/controller/agent-controller.js");
const { classifyEvidenceRequirement } = require("../src/agent/runtime/evidence-classifier.js");
const ContextRouter = require("../src/prompts/skills/context-router");
const ModeSkills = require("../src/prompts/skills/mode-skills");
const { buildSystemContext } = require("../src/agent/runtime/prompt-context.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");

test("agent tool surface is enabled by default in controller turns", () => {
  assert.equal(AgentToolSurface.toolsEnabled(), true);
});

test("the temporary task-list tool is exposed only for reasonably large Agent requests", async () => {
  assert.equal(isReasonablyLargeAgentRequest("Fix the typo in README.md"), false);
  assert.equal(isReasonablyLargeAgentRequest("Implement the following:\n- inspect the updater\n- fix notification state\n- verify packaging"), false);
  assert.equal(isReasonablyLargeAgentRequest("Implement the following:\n- inspect the updater\n- fix notification state\n- update the tests\n- verify packaging"), true);
  assert.equal(isReasonablyLargeAgentRequest("Inspect the code. Update the parser. Run the tests."), false);
  assert.equal(isReasonablyLargeAgentRequest("Inspect the code. Update the parser. Add regression coverage. Run the tests."), true);
  const seen = [];
  const run = (userMessage) => runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage,
    runModelRound: async ({ tools }) => {
      seen.push(tools.map((tool) => tool.function.name));
      return { fullText: "done", toolCalls: [] };
    },
  });
  await run("Fix the typo in README.md");
  await run("Implement the following:\n- inspect the updater\n- fix notification state\n- update the tests\n- verify packaging");
  assert.equal(seen[0].includes("update_task_list"), false);
  assert.equal(seen[1].includes("update_task_list"), true);
  assert.equal(seen[0].includes("manage_plan"), false);
  assert.equal(seen[1].includes("manage_plan"), false);
});

test("a large Agent task publishes checklist updates and removes the checklist on completion", async () => {
  const events = [];
  let round = 0;
  const tasks = [
    { id: "inspect", title: "Inspect current behavior", status: "in_progress" },
    { id: "change", title: "Implement the change", status: "pending" },
    { id: "cover", title: "Add regression coverage", status: "pending" },
    { id: "verify", title: "Verify the result", status: "pending" },
  ];
  await runAgentTurn({
    workspace: path.resolve("."),
    mode: "agent",
    userMessage: "Implement the following:\n- inspect current behavior\n- make the required change\n- add regression coverage\n- verify the result",
    sendEvent: (event) => events.push(event),
    runModelRound: async () => {
      if (round++ === 0) return { fullText: "", toolCalls: [{ id: "tasks", type: "function", function: { name: "update_task_list", arguments: JSON.stringify({ tasks }) } }] };
      return { fullText: "Done", toolCalls: [] };
    },
    executeToolCall: async () => ({ ok: true, value: { tasks, completed: false, currentIndex: 0, total: 4 } }),
  });
  assert.equal(events.some((event) => event.type === "task_brief"), false);
  assert.equal(events.some((event) => event.type === "task_list" && event.tasks?.length === 4), true);
  assert.equal(events.some((event) => event.type === "task_list" && event.clear === true), true);
});

test("nested plan-bound turns validate against the binding without closing the parent plan", async () => {
  const planBinding = { planId: "plan-1", contentHash: "hash-1", runId: "parent-run" };
  const lifecycleCalls = [];
  const modeWorkflow = {
    loadState: () => ({ planBinding }),
    contextPacket: () => null,
    finishPlanRun: () => lifecycleCalls.push("finish-plan"),
  };
  const intelligence = { completeRun: () => lifecycleCalls.push("complete-intelligence") };
  const run = async (nested) => runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 8192,
    contextBudget: 8192,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    modeWorkflow,
    intelligence,
    planBinding,
    nested,
    userMessage: "summarize the delegated result",
    chatHistory: [],
    sendEvent() {},
    async runModelRound() { return { ok: true, fullText: "done", toolCalls: [], finishReason: "stop" }; },
    async executeToolCall() { return { ok: true }; },
  });

  await run(true);
  assert.deepEqual(lifecycleCalls, [], "child completion must not finalize the parent plan");
  await run(false);
  assert.deepEqual(lifecycleCalls, ["complete-intelligence", "finish-plan"]);
});

test("nested plan-bound actions remain provisional until the parent records them", async () => {
  const planBinding = { planId: "plan-1", contentHash: "hash-1", runId: "parent-run" };
  const calls = [];
  let round = 0;
  const modeWorkflow = {
    loadState: () => ({ planBinding }),
    contextPacket: () => null,
    validateAction: () => ({ ok: true, stepId: "step-1" }),
    recordProducedEvidence: () => calls.push("produced-evidence"),
    recordPlanAction: () => calls.push("plan-action"),
  };
  const intelligence = {
    recordRunEvidence: () => calls.push("run-evidence"),
  };
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 8192,
    contextBudget: 8192,
    tools: [{ type: "function", function: { name: "apply_patch", description: "patch", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    modeWorkflow,
    intelligence,
    planBinding,
    nested: true,
    userMessage: "apply the delegated patch",
    chatHistory: [],
    sendEvent() {},
    async runModelRound() {
      round += 1;
      if (round === 1) {
        return {
          ok: true,
          fullText: "",
          toolCalls: [{ id: "call-1", type: "function", function: { name: "apply_patch", arguments: {} } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "done", toolCalls: [], finishReason: "stop" };
    },
    async executeToolCall() { return { ok: true, evidenceIds: ["ev-1"] }; },
  });

  assert.deepEqual(calls, [], "child execution must not mutate parent workflow state");
  assert.deepEqual(result.provisionalPlan?.evidenceIds, ["ev-1"]);
  assert.equal(result.provisionalPlan?.actions.length, 1);
  assert.equal(result.provisionalPlan?.actions[0].stepId, "step-1");
});

test("scope-only dispatch returns raw tool results to the model", async (t) => {

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-gates-off-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  let rounds = 0;
  const allRoundPayloads = [];
  const toolResultsSeen = [];
  const result = await runAgentTurn({
    workspace,
    model: "local:small",
    numCtx: 8192,
    thinking: false,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a command", parameters: {} } }],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "run pwd" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    userMessage: "run pwd",
    sendEvent(event) {
      if (event.type === "tool_result") toolResultsSeen.push(event.result);
    },
    async runModelRound(payload) {
      rounds += 1;
      allRoundPayloads.push(payload);
      if (rounds > 1) return { error: null, fullText: "Done.", toolCalls: [], usage: { promptTokens: 10, completionTokens: 5 } };
      return {
        error: null,
        fullText: "Running pwd.",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "exec_command", arguments: JSON.stringify({ executable: process.execPath, args: ["-e", "console.log(process.cwd())"] }) } }],
        usage: { promptTokens: 100, completionTokens: 10 },
      };
    },
    // Simulates the main.js dispatcher: registry adapter + restricted context.
    async executeToolCall({ toolCall }) {
      const name = toolCall?.function?.name;
      if (name === "exec_command") {
        return { ok: true, value: { stdout: "REAL_STDOUT_MARKER", stderr: "", exitCode: 0, executable: process.execPath, args: [] } };
      }
      return { ok: false, error: `Unknown tool '${name}'`, code: "UNKNOWN_TOOL", retryable: false };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(result.runState?.status, "completed", "gates-off run should complete");
  // The tool executed (no gate blocked it).
  assert.ok(toolResultsSeen.length >= 1, "tool_result event must fire");
  assert.equal(toolResultsSeen[0].ok, true, "exec result must be ok");
  // The model-facing content must include the real stdout, not {}.
  const lastPayload = allRoundPayloads[allRoundPayloads.length - 1];
  const toolMessages = (lastPayload?.messages || []).filter((m) => m.role === "tool");
  assert.ok(toolMessages.length >= 1, "a tool message must be pushed to the model");
  const content = toolMessages[toolMessages.length - 1].content;
  assert.ok(!content.includes('"payload":"{}"'), "model must not see empty {} payload");
  assert.ok(content.includes("REAL_STDOUT_MARKER"), "model must see the real stdout");
});

test("simple conversation uses compact context with no tool execution and no workspace writes", async (t) => {
  let roundPayload = null;
  let discoveryCalls = 0;
  const events = [];
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-greeting-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const result = await runAgentTurn({
    workspace,
    model: "local:small",
    numCtx: 32768,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "hi" }],
    contextSummary: "A very large previous assessment summary that must not enter a greeting.",
    dirMap: "ROOT/\n  app.js",
    activeFile: { path: "app.js", content: "console.log('hello')" },
    extraFiles: [],
    userMessage: "hi",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      roundPayload = payload;
      return { error: null, fullText: "Hey! How can I help?", toolCalls: [], usage: { promptTokens: 321, completionTokens: 7 } };
    },
    async executeToolCall() { throw new Error("A greeting must not execute tools."); },
    findWorkspaceFiles() { discoveryCalls += 1; return { results: [] }; },
    searchWorkspaceIndex() { discoveryCalls += 1; return { results: [] }; },
  });

  assert.equal(discoveryCalls, 0);
  assert.equal(Array.isArray(roundPayload.tools), true);
  assert.ok(roundPayload.tools.length > 0, "agent mode now exposes the registry tool catalog");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "apply_patch"), "catalog includes apply_patch");
  assert.match(roundPayload.messages.map((message) => message.content).join("\n"), /XEKUTE VAPT SYSTEM PROMPT/i);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /run_traffsucker|run_security_tool|load_tool_schemas/i);
  assert.equal(roundPayload.messages.filter((message) => message.role === "user" && message.content === "hi").length, 1);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /OPERATING LOOP|XEKUTE AUTHORITY|UNTRUSTED CONTEXT DATA|previous assessment summary/);
  assert.match(roundPayload.messages[0].content, /Casual conversation does not start an assessment/i);
  assert.equal(result.contextRoute.kind, "conversation");
  assert.equal(result.finalText, "Hey! How can I help?");
  assert.equal(result.contextUsage.source, "ollama");
  assert.equal(result.contextUsage.promptTokens, 321);
  assert.ok(Array.isArray(result.contextUsage.toolNames));
  assert.equal(result.contextUsage.route.promptDepth, "compact");
  assert.deepEqual(fs.readdirSync(workspace), []);
});

test("length-limited model output continues automatically without persisting synthetic prompts", async () => {
  const events = [];
  const rounds = [];
  const result = await runAgentTurn({
    workspace: "",
    model: "provider/limited-output",
    numCtx: 32768,
    contextBudget: 32768,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Explain the complete vulnerability." }],
    userMessage: "Explain the complete vulnerability.",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      rounds.push(payload);
      if (rounds.length === 1) {
        payload.onToken("The vulnerabili");
        return {
          ok: true,
          fullText: "The vulnerabili",
          toolCalls: [],
          finishReason: "length",
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      }
      payload.onToken("ty is confirmed and fully explained.");
      return {
        ok: true,
        fullText: "ty is confirmed and fully explained.",
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 120, completionTokens: 12 },
      };
    },
    async executeToolCall() { throw new Error("Output continuation should not need a tool."); },
  });

  assert.equal(rounds.length, 2);
  assert.equal(result.finalText, "The vulnerability is confirmed and fully explained.");
  assert.ok(rounds[1].messages.some((message) => message.role === "user" && /Continue the same assistant response exactly where it stopped/.test(message.content)));
  assert.ok(rounds[1].messages.some((message) => message.role === "assistant" && message.content === "The vulnerabili"));
  assert.equal(events.filter((event) => event.type === "output_continuation").length, 1);
  assert.deepEqual(
    result.appendedMessages.map((message) => ({ role: message.role, content: message.content })),
    [{ role: "assistant", content: "The vulnerability is confirmed and fully explained." }],
  );
});

test("output continuations do not consume the operational agent-round budget", async () => {
  let calls = 0;
  const continuationSegments = 5;
  const result = await runAgentTurn({
    workspace: "",
    model: "provider/limited-output",
    numCtx: 32768,
    contextBudget: 32768,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Produce a long report." }],
    userMessage: "Produce a long report.",
    sendEvent() {},
    maxAgentRounds: 3,
    async runModelRound() {
      calls += 1;
      if (calls <= continuationSegments) {
        return { ok: true, fullText: "x", toolCalls: [], finishReason: "length" };
      }
      return { ok: true, fullText: "done", toolCalls: [], finishReason: "stop" };
    },
    async executeToolCall() { throw new Error("Output continuation should not execute tools."); },
  });

  assert.equal(calls, continuationSegments + 1);
  assert.equal(result.runState.status, "completed");
  assert.equal(result.finalText, `${"x".repeat(continuationSegments)}done`);
});

test("tool-access questions receive the registry tool surface", async () => {
  let roundPayload = null;
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 8192,
    contextBudget: 8192,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    userMessage: "can you see if you have any access to any tools?",
    sendEvent: () => {},
    async runModelRound(payload) {
      roundPayload = payload;
      return {
        error: null,
        fullText: "I have access to the 17 registry tools (exec_command, read_file, apply_patch, ...).",
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 18 },
      };
    },
    async executeToolCall() {
      throw new Error("Tool-access questions must not execute tools.");
    },
  });

  assert.ok(Array.isArray(roundPayload.tools) && roundPayload.tools.length > 0, "agent mode exposes the registry tool catalog");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "apply_patch"), "catalog includes apply_patch");
  assert.match(result.finalText, /17 registry tools/i);
});

test("request classification selects workflow, hypothesis, or ordinary conversation", () => {
  const workflow = ContextRouter.routeRequest({
    text: "fix this",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    activeFile: { path: "src/app.js" },
  });
  assert.equal(workflow.interactionType, "workflow");
  assert.equal(workflow.classification.taskBrief, true);
  assert.equal(workflow.osMode, "write");

  const calculatorUpgrade = ContextRouter.routeRequest({
    text: "can you make the calculator better?",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
  });
  assert.equal(calculatorUpgrade.interactionType, "workflow");
  assert.deepEqual(calculatorUpgrade.toolCategories, ["os"]);
  assert.equal(calculatorUpgrade.osMode, "write");

  const delegatedUpgrade = ContextRouter.routeRequest({
    text: "idk just make it better",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    history: [
      { role: "user", content: "can you make the calculator better?" },
      { role: "assistant", content: "Which improvements would you like, or should I apply a sensible general upgrade to the calculator?" },
    ],
  });
  assert.equal(delegatedUpgrade.interactionType, "workflow");
  assert.equal(delegatedUpgrade.inheritedIntent, true);
  assert.equal(delegatedUpgrade.osMode, "write");

  const retryUpgrade = ContextRouter.routeRequest({
    text: "try again",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    history: [
      { role: "user", content: "can you make the calculator better?" },
      { role: "assistant", content: "I can improve the calculator without changing unrelated files." },
    ],
  });
  assert.equal(retryUpgrade.inheritedIntent, true);
  assert.equal(retryUpgrade.osMode, "write");
  assert.equal(retryUpgrade.osMutates, true);

  const hypothesis = ContextRouter.routeRequest({
    text: "run a passive scan and report findings",
    hasWorkspace: true,
    family: "testing",
    mode: "agent",
  });
  assert.equal(hypothesis.interactionType, "hypothesis");
  assert.equal(hypothesis.classification.evidence, true);
  assert.equal(hypothesis.responseRequirements.evidence, true);

  const conversation = ContextRouter.routeRequest({ text: "what is XSS?", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(conversation.interactionType, "conversation");
  assert.equal(conversation.classification.taskBrief, false);
});

test("open project includes project and workspace context when requested", () => {
  const route = ContextRouter.routeRequest({ text: "What targets are in scope?", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(route.includeProjectContext, true);
  assert.equal(route.includeWorkspaceContext, true);
  assert.equal(route.includeWorkspaceDiscovery, false);

  const greeting = ContextRouter.routeRequest({ text: "hi", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(greeting.includeProjectContext, false);
  assert.equal(greeting.includeWorkspaceContext, false);
});

test("passive scan requests route cyber tools in testing mode", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    family: "testing",
    mode: "agent",
  });
  assert.deepEqual(route.toolCategories, ["cyber"]);
  assert.ok(route.cyberCapabilities.includes("active"));
});

test("passive scan in read-only modes routes cyber research without active capability", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    mode: "ask",
  });
  assert.deepEqual(route.toolCategories, ["cyber"]);
  assert.ok(!route.cyberCapabilities.includes("active"));
});

test("project prompt context merges workspace scope files with app-managed profile", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-scope-context-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });
  const inScopePath = path.join(root, "scope", "in-scope.json");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets = [{ id: "target-1", assetType: "domain", value: "app.example.com", notes: "primary app" }];
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`, "utf8");

  const context = buildEngagementPromptContext({
    workspace: root,
    projectProfile: {
      project: { name: "Example App" },
      scope: { inScopeTargets: [], notes: "profile note" },
      context: { applicationOverview: "Customer portal" },
    },
  });

  assert.equal(context.project.name, "Example App");
  assert.equal(context.application.applicationOverview, "Customer portal");
  assert.equal(context.scope.inScopeTargets[0].value, "app.example.com");
  assert.equal(context.scope.notes, "profile note");
  fs.rmSync(parent, { recursive: true, force: true });
});

test("scope questions in an open project inject project settings and scope guidance", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-scope-prompt-"));
  const root = path.join(parent, "assessment");
  const workspaceApi = createAssessmentWorkspace({ fs, path });
  workspaceApi.repair(root, { createRoot: true });
  const inScopePath = path.join(root, "scope", "in-scope.json");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets = [{ id: "target-1", assetType: "domain", value: "app.example.com" }];
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`, "utf8");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  let roundPayload = null;
  const result = await runAgentTurn({
    workspace: root,
    model: "local:small",
    numCtx: 8192,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "testing",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n  scope/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "What targets are in scope?",
    sendEvent() {},
    async runModelRound(payload) {
      roundPayload = payload;
      return { error: null, fullText: "app.example.com is in scope.", toolCalls: [], usage: { promptTokens: 900, completionTokens: 12 } };
    },
    async executeToolCall() { throw new Error("Scope questions should not execute tools."); },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  const prompt = roundPayload.messages.map((message) => message.content).join("\n");
  assert.match(prompt, /XEKUTE PROJECT SETTINGS/);
  assert.match(prompt, /app\.example\.com/);
  assert.match(prompt, /filesystem and network scope separately/i);
  assert.match(prompt, /UNTRUSTED CONTEXT DATA/);
  assert.ok(Array.isArray(roundPayload.tools) && roundPayload.tools.length > 0, "ask mode exposes its read-only tool set");
  assert.ok(roundPayload.tools.every((tool) => ["ask_questions", "read_file", "search_workspace", "inspect_environment", "query_knowledge", "web_research"].includes(tool.function?.name)), "ask tools are read-only");
  assert.equal(result.contextRoute.includeProjectContext, true);
});

test("inherited confirmations can complete with a normal text answer when no tool is selected", async () => {
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "assistant", content: "Would you like me to inspect the workspace and update the file?" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "yes",
    sendEvent() {},
    async runModelRound() {
      return { error: null, fullText: "Yes — I can help with that.", toolCalls: [], usage: { promptTokens: 120, completionTokens: 8 } };
    },
    async executeToolCall() { throw new Error("No tool should be required for a plain answer."); },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalText, "Yes — I can help with that.");
});

test("mode prompts stay distinct while the tool surface is registry-backed", () => {
  const agentPrompt = buildSystemContext({ mode: "agent", numCtx: 4096, userMessage: "Fix it" });
  const planPrompt = buildSystemContext({ mode: "plan", numCtx: 4096, userMessage: "Plan it" });
  const askPrompt = buildSystemContext({ mode: "ask", numCtx: 4096, userMessage: "Explain it" });
  const hypothesisPrompt = buildSystemContext({ mode: "hypothesis", numCtx: 4096, userMessage: "Hypothesize" });
  assert.match(agentPrompt, /PROFILE — Agent/);
  assert.match(planPrompt, /PROFILE — Plan/);
  assert.match(hypothesisPrompt, /PROFILE — Hypothesis/);
  assert.match(askPrompt, /PROFILE — Ask/);
  assert.match(ModeSkills.render("agent"), /tools/i);
  assert.match(planPrompt, /PROFILE — Plan/i);
  assert.match(planPrompt, /workspace tools/i);
  assert.match(askPrompt, /read-only tools/i);
  assert.match(askPrompt, /inconclusive/i);
  assert.match(hypothesisPrompt, /PROFILE — Hypothesis/i);
  assert.match(askPrompt, /Runtime scope checks are enforced/i);
});

test("response evidence classification stays quiet for workspace work and escalates for evidence runs", () => {
  const workspaceRoute = ContextRouter.routeRequest({ text: "Create .xekute/skills/basic-test.md", hasWorkspace: true, family: "assist", mode: "agent" });
  const workspaceRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: workspaceRoute,
    userMessage: "Create .xekute/skills/basic-test.md",
  });
  assert.equal(workspaceRequirement.required, false);
  assert.equal(workspaceRequirement.mode, "evidence_not_required");

  const testingRoute = ContextRouter.routeRequest({ text: "Run a passive scan and report findings", hasWorkspace: true, family: "testing", mode: "agent" });
  const testingRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: testingRoute,
    userMessage: "Run a passive scan and report findings",
    assessmentRequested: true,
  });
  assert.equal(testingRequirement.required, true);
  assert.equal(testingRequirement.mode, "evidence_required");

  const producedRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: workspaceRoute,
    userMessage: "Inspect this file",
    evidenceIds: ["ev-1"],
  });
  assert.equal(producedRequirement.reason, "evidence-produced");
});

test("context limits remain operational without command policy branches", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"context ".repeat(120)}`,
  }));
  const trimmed = trimHistoryForContext(history, 4096);
  assert.ok(trimmed.length < history.length);
  assert.equal(trimmed.at(-1).content, history.at(-1).content);
});

test("selectHistoryGroups restores chronological order after anchor pinning", () => {
  const objective = "scan the target";
  const groups = [
    [{ role: "user", content: objective }],
    [{ role: "assistant", content: "older reply" }],
    [{ role: "user", content: "recent follow-up" }],
  ];
  const selection = selectHistoryGroups(groups, {
    budget: 10_000,
    anchorOptions: { objectiveMessage: objective },
  });
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.selected.map((group) => group[0].content), [
    objective,
    "older reply",
    "recent follow-up",
  ]);
});

test("fitMessagesToContext fails closed when mandatory anchors exceed the budget", () => {
  const objective = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(" ");
  const fitted = fitMessagesToContext({
    baseMessages: [{ role: "system", content: "fixed prompt" }],
    history: [{ role: "user", content: objective }],
    promptBudget: 512,
    anchorOptions: { objectiveMessage: objective },
  });
  assert.equal(fitted.ok, false);
  assert.equal(fitted.overflow, true);
});

test("fitMessagesToContext rejects fixed-only overflow", () => {
  const fixed = Array.from({ length: 3000 }, (_, index) => `fixed${index}`).join(" ");
  const fitted = fitMessagesToContext({
    baseMessages: [{ role: "system", content: fixed }],
    history: [],
    promptBudget: 512,
  });
  assert.equal(fitted.ok, false);
  assert.equal(fitted.overflow, true);
});

test("agent lifecycle permits justified or skipped phase transitions without approval gates", () => {
  const AgentRuntime = require("../src/agent/runtime/agent-runtime.js");
  const runState = AgentRuntime.createRunState({ runId: "run-phase", profile: "agent" });
  const step = advanceTowardPhase(runState, "execution", {
    reason: "Skip inventory",
    profile: { key: "agent" },
    cyberAction: true,
  });
  assert.equal(step.ok, true);
  assert.equal(runState.phase, "execution");
});

test("tool signatures canonicalize argument key order", () => {
  const first = toolCallSignature({
    toolName: "search_workspace",
    args: { query: "xekute", limit: 4, options: { language: "en", safe: true } },
  });
  const second = toolCallSignature({
    toolName: "search_workspace",
    args: { options: { safe: true, language: "en" }, limit: 4, query: "xekute" },
  });
  assert.equal(first, second);
});
