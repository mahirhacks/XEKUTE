const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const {
  commandGuardReason,
  classifyEvidenceRequirement,
  buildEngagementPromptContext,
  filterToolsForMode,
  filterToolsForRoute,
  runAgentTurn,
  trimHistoryForContext,
  selectHistoryGroups,
  fitMessagesToContext,
  isAnchorHistoryGroup,
  advanceTowardPhase,
  toolCallSignature,
} = require("../src/application/agent/controller");
const PlanDocument = require("../src/application/planning/plan-document");
const ContextRouter = require("../src/prompts/skills/context-router");
const { buildSystemContext } = require("../src/application/agent/prompt");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");

function toolCall(name, args) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: {
      name,
      arguments: args,
    },
  };
}

test("simple conversation uses compact context, no discovery, no evidence chrome, and no workspace writes", async (t) => {
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
    tools: ToolMap.TOOLS,
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
  // Agent starts with hot schemas only; traffsucker remains catalog-granted.
  assert.ok(roundPayload.tools.some((tool) => tool.function.name === "load_tool_schemas"));
  assert.equal(roundPayload.tools.some((tool) => tool.function.name === "run_traffsucker"), false);
  assert.match(roundPayload.messages.map((message) => message.content).join("\n"), /run_traffsucker/);
  assert.equal(roundPayload.messages.filter((message) => message.role === "user" && message.content === "hi").length, 1);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /OPERATING LOOP|XEKUTE AUTHORITY|UNTRUSTED CONTEXT DATA|previous assessment summary/);
  assert.match(roundPayload.messages[0].content, /A casual message does not start execution or preflight/i);
  assert.equal(result.contextRoute.kind, "conversation");
  assert.deepEqual(result.claims, []);
  assert.equal(result.operatorFeedback, null);
  assert.equal(result.finalText, "Hey! How can I help?");
  assert.equal(result.contextUsage.source, "ollama");
  assert.equal(result.contextUsage.promptTokens, 321);
  assert.ok(result.contextUsage.toolNames.includes("load_tool_schemas"));
  assert.equal(result.contextUsage.toolNames.includes("run_traffsucker"), false);
  assert.equal(result.contextUsage.route.promptDepth, "compact");
  assert.deepEqual(fs.readdirSync(workspace), []);
});

test("mode owns tool exposure; request classification does not shrink agent tools", () => {
  const agentTools = ToolMap.compactTools(filterToolsForMode(ToolMap.TOOLS, "agent"));
  assert.ok(agentTools.some((tool) => tool.function.name === "patch_file"));
  assert.ok(agentTools.some((tool) => tool.function.name === "run_command"));
  assert.ok(agentTools.some((tool) => tool.function.name === "search_web"));
  assert.ok(agentTools.some((tool) => tool.function.name === "fetch_url"));
  assert.ok(agentTools.some((tool) => tool.function.name === "run_security_tool"));
  assert.ok(agentTools.some((tool) => tool.function.name === "run_traffsucker"));
  assert.ok(agentTools.some((tool) => tool.function.name === "load_tool_schemas"));
  assert.ok(agentTools.some((tool) => tool.function.name === "record_hypothesis"));
  assert.ok(agentTools.every((tool) => !tool.function.description.includes("\n")));

  // Legacy route helper is a passthrough and must not filter by wording.
  const osRoute = ContextRouter.routeRequest({ text: "Fix src/app.js and run the tests", hasWorkspace: true, mode: "agent" });
  const passedThrough = filterToolsForRoute(agentTools, osRoute);
  assert.equal(passedThrough.length, agentTools.length);
  assert.ok(passedThrough.some((tool) => tool.function.name === "run_traffsucker"));

  const hot = new Set(ToolMap.hotToolNamesForProfile("agent"));
  assert.ok(hot.has("load_tool_schemas"));
  assert.equal(hot.has("run_traffsucker"), false);
});

test("planner mode exposes its full mode tool surface including operator questions", () => {
  const plannerTools = ToolMap.compactTools(filterToolsForMode(ToolMap.TOOLS, "planner"));
  assert.ok(plannerTools.some((tool) => tool.function.name === "request_operator_questions"));
  assert.ok(plannerTools.some((tool) => tool.function.name === "create_file"));
  assert.ok(plannerTools.some((tool) => tool.function.name === "write_file"));
  assert.equal(plannerTools.some((tool) => tool.function.name === "run_security_tool"), false);
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

test("assist Agent routes an edit of the active file to write-capable tools", async () => {
  let firstRound = null;
  let round = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n  src/\n    app.js\n",
    activeFile: { path: "src/app.js", content: "const value = 1;\n" },
    extraFiles: [],
    userMessage: "fix this",
    sendEvent() {},
    async runModelRound(payload) {
      if (!firstRound) firstRound = payload;
      round += 1;
      if (round === 1) return { fullText: "", toolCalls: [toolCall("patch_file", { path: "src/app.js", patches: [{ find: "const value = 1;", replace: "const value = 2;" }] })] };
      return { fullText: "Updated the active file.", toolCalls: [] };
    },
    async executeToolCall({ toolCall: call }) {
      return { ok: true, mutated: true, mode: "patch", file: call.function.arguments.path, summary: "Updated src/app.js." };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.contextRoute.interactionType, "workflow");
  assert.ok(firstRound.tools.some((tool) => tool.function.name === "patch_file"));
  assert.equal(result.completedEdit, true);
});

test("assist Agent inherits a retried calculator upgrade and enforces a file mutation", async () => {
  let firstRound = null;
  let round = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [
      { role: "user", content: "can you make the calculator better?" },
      { role: "assistant", content: "I can improve the calculator without changing unrelated files." },
      { role: "user", content: "try again" },
    ],
    contextSummary: "",
    dirMap: "ROOT/\n  calculator/\n    index.html\n    script.js\n    styles.css\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "try again",
    sendEvent() {},
    async runModelRound(payload) {
      if (!firstRound) firstRound = payload;
      round += 1;
      if (round === 1) {
        return {
          fullText: "",
          toolCalls: [toolCall("patch_file", { path: "calculator/script.js", patches: [{ find: "const value = 1;", replace: "const value = 2;" }] })],
        };
      }
      return { fullText: "Improved the calculator.", toolCalls: [] };
    },
    async executeToolCall({ toolCall: call }) {
      return { ok: true, mutated: true, mode: "patch", file: call.function.arguments.path, summary: "Edited files." };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.contextRoute.inheritedIntent, true);
  assert.equal(result.contextRoute.osMode, "write");
  assert.ok(firstRound.tools.some((tool) => tool.function.name === "read_file"));
  assert.ok(firstRound.tools.some((tool) => tool.function.name === "patch_file"));
  assert.equal(result.completedEdit, true);
});

test("open project always includes scope, authority, and workspace context", () => {
  const route = ContextRouter.routeRequest({ text: "What targets are in scope?", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(route.includeProjectContext, true);
  assert.equal(route.includeAuthority, true);
  assert.equal(route.includeWorkspaceContext, true);
  assert.equal(route.includeWorkspaceDiscovery, false);

  const greeting = ContextRouter.routeRequest({ text: "hi", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(greeting.includeProjectContext, false);
  assert.equal(greeting.includeAuthority, false);
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

test("scope questions in an open project inject project settings and authority", async (t) => {
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
    tools: ToolMap.TOOLS,
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
  assert.match(prompt, /XEKUTE AUTHORITY/);
  assert.match(prompt, /UNTRUSTED CONTEXT DATA/);
  assert.equal(result.contextRoute.includeProjectContext, true);
});

test("text-only mutation answer completes gracefully without claiming a file change", async () => {
  const events = [];
  const roundPayloads = [];
  let rounds = 0;
  let executions = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:no-thinking",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Can you create me an index.html file?",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      rounds += 1;
      roundPayloads.push(payload);
      payload.onToken("Sure! Here's a basic index.html file:");
      return { error: null, aborted: true, fullText: "Sure! Here's a basic index.html file:", toolCalls: [] };
    },
    async executeToolCall() { executions += 1; return { ok: true }; },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(rounds, 2);
  assert.equal(executions, 0);
  // No longer a hard failure: the turn completes with the model's prose.
  assert.equal(result.ok, true);
  assert.match(result.finalText, /index\.html file/i);
  assert.match(roundPayloads[0].messages.map((message) => message.content).join("\n"), /WORKSPACE ACTION CONTRACT/);
  assert.match(roundPayloads[1].messages.map((message) => message.content).join("\n"), /requires real workspace actions/i);
});

test("inherited confirmations can complete with a normal text answer when no tool is selected", async () => {
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
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

test("a no-thinking model can recover through the strict structured tool fallback", async () => {
  let round = 0;
  const executed = [];
  const responses = [
    { aborted: true, fullText: "Sure! Here's your file:", toolCalls: [] },
    { fullText: '{"tool":"create_file","arguments":{"path":"index.html","content":"<!doctype html><title>Ready</title>"}}', toolCalls: [] },
    { fullText: "Created index.html.", toolCalls: [] },
    { fullText: "Created index.html.", toolCalls: [] },
  ];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:no-thinking",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Create index.html without tests",
    sendEvent() {},
    async runModelRound(payload) {
      const response = responses[round++];
      payload.onToken(response.fullText);
      return response;
    },
    async executeToolCall({ toolCall }) {
      executed.push(toolCall);
      const args = toolCall.function.arguments;
      return { ok: true, mode: "create", file: args.path, content: args.content, mutated: true, summary: `Created ${args.path}.` };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].function.name, "create_file");
  assert.equal(executed[0].function.arguments.path, "index.html");
  assert.match(executed[0].function.arguments.content, /<!doctype html>/i);
  assert.match(result.finalText, /Created index\.html/);
});

test("runAgentTurn keeps calling tools until multi-file web requests are complete", async () => {
  const executed = [];
  const events = [];
  const roundPayloads = [];
  let round = 0;

  const responses = [
    {
      error: null,
      fullText: "",
      toolCalls: [
        toolCall("create_file", {
          path: "index.html",
          content: "<!doctype html><html></html>",
        }),
      ],
    },
    {
      error: null,
      fullText: "I've created the files for you.",
      toolCalls: [],
    },
    {
      error: null,
      fullText: "",
      toolCalls: [
        toolCall("create_file", {
          path: "styles.css",
          content: "body { font-family: sans-serif; }\n",
        }),
        toolCall("create_file", {
          path: "script.js",
          content: "console.log('ready');\n",
        }),
      ],
    },
    {
      error: null,
      fullText: "",
      toolCalls: [],
    },
    {
      error: null,
      fullText: "Created index.html, styles.css, and script.js.",
      toolCalls: [],
    },
  ];

  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "huihui_ai/deepseek-r1-abliterated:8b",
    numCtx: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    chatHistory: [{ role: "user", content: "hello" }],
    contextSummary: "",
    dirMap: "TEST/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Can you create 3 files? Create an html, css and javascript file",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      roundPayloads.push(payload);
      payload.onThinking?.(`reasoning-round-${round + 1}\n`);
      const response = responses[round];
      round += 1;
      return response;
    },
    async executeToolCall({ toolCall }) {
      const { name, arguments: args } = toolCall.function;
      executed.push({ name, path: args.path });
      return {
        ok: true,
        toolName: name,
        mode: name === "create_file" ? "create" : "full",
        file: args.path,
        content: args.content || "",
        mutated: true,
        summary: `Created ${args.path}.`,
      };
    },
    findWorkspaceFiles() {
      return { ok: true, count: 0, results: [] };
    },
    searchWorkspaceIndex() {
      return { ok: true, count: 0, results: [] };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    executed.map((item) => item.path),
    ["index.html", "styles.css", "script.js"],
  );
  assert.match(result.finalText, /styles\.css/);
  assert.equal(Object.hasOwn(result, "thinking"), false);
  assert.ok(events.some((event) => event.type === "thinking"));
  assert.ok(events.filter((event) => event.type === "thinking").every((event) => !Object.hasOwn(event, "delta")));
  assert.ok(result.appendedMessages.every((message) => !Object.hasOwn(message, "thinking")));
  assert.ok(roundPayloads[0].tools.length > 0);
  assert.ok(roundPayloads[1].tools.length > 0);
  assert.ok(roundPayloads[2].tools.length > 0);
  assert.ok(roundPayloads[4].tools.length > 0);

  const reminderMessage = result.appendedMessages.find(
    (msg) => msg.role === "user" && /still needs separate web files/i.test(msg.content),
  );
  assert.ok(reminderMessage, "expected an incomplete multi-file reminder");

  const verificationMessage = result.appendedMessages.find(
    (msg) => msg.role === "user" && /Before summarizing, verify the assessment or workspace changes/i.test(msg.content),
  );
  assert.ok(verificationMessage, "expected a verification reminder after code edits");
});

test("analysis runs request a final synthesis when a model goes silent after a read tool", async () => {
  const responses = [
    { fullText: "", toolCalls: [toolCall("search_web", { query: "application map" })] },
    { fullText: "", toolCalls: [] },
    { fullText: "Evidence-backed Map analysis.", toolCalls: [] },
  ];
  let round = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "reasoning-model",
    numCtx: 32768,
    thinking: true,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "Map/application-map.json\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Check the Map and analyze it",
    sendEvent() {},
    async runModelRound() { return responses[round++]; },
    async executeToolCall() {
      return { ok: true, mode: "web_search", query: "application map", content: "{}", summary: "Read Map" };
    },
    findWorkspaceFiles() { return { ok: true, results: [] }; },
    searchWorkspaceIndex() { return { ok: true, results: [] }; },
  });
  assert.equal(round, 3);
  assert.match(result.finalText, /Evidence-backed Map analysis/);
});

test("mode prompts and tool lists are distinct and read-only modes are enforced", async () => {
  const agentPrompt = buildSystemContext({ mode: "agent", numCtx: 4096, userMessage: "Fix it" });
  const planPrompt = buildSystemContext({ mode: "plan", numCtx: 4096, userMessage: "Plan it" });
  const askPrompt = buildSystemContext({ mode: "ask", numCtx: 4096, userMessage: "Explain it" });
  const hypothesisPrompt = buildSystemContext({ mode: "hypothesis", numCtx: 4096, userMessage: "Hypothesize" });
  assert.match(agentPrompt, /PROFILE — Agent/);
  assert.match(planPrompt, /PROFILE — Plan/);
  assert.match(hypothesisPrompt, /PROFILE — Hypothesis/);
  assert.match(askPrompt, /PROFILE — Ask/);
  assert.match(agentPrompt, /authorized web, API, and external-perimeter/i);
  assert.match(agentPrompt, /scanner signature/i);
  assert.match(agentPrompt, /unexpected impact/i);
  assert.match(planPrompt, /MODE SKILL|hypothesis plan/i);
  assert.match(planPrompt, /completion gate/i);
  assert.match(askPrompt, /Read-only analysis|MODE SKILL/i);
  assert.match(askPrompt, /missing evidence|inconclusive/i);

  const planTools = filterToolsForMode(ToolMap.TOOLS, "planner", "xekute");
  assert.deepEqual(
    planTools.map((tool) => tool.function.name).sort(),
    [...ToolMap.MODE_TOOL_GROUPS.planner].sort(),
  );
  const hypothesisTools = filterToolsForMode(ToolMap.TOOLS, "hypothesis", "xekute");
  assert.ok(hypothesisTools.some((tool) => tool.function.name === "read_file"));
  assert.equal(hypothesisTools.some((tool) => tool.function.name === "create_file"), false);
  const askTools = filterToolsForMode(ToolMap.TOOLS, "ask", "xekute");
  assert.ok(askTools.length > 0);
  assert.ok(askTools.every((tool) => !ToolMap.isMutating(tool.function.name) || tool.function.name === "request_operator_questions"));
  assert.ok(askTools.some((tool) => tool.function.name === "read_process"));
  assert.ok(askTools.every((tool) => !["run_command", "start_process", "stop_process", "run_security_tool"].includes(tool.function.name)));
  assert.match(planPrompt, /Create or revise plans/i);
  assert.match(hypothesisPrompt, /Read-only hypothesis formation/i);
  assert.match(askPrompt, /Never execute, mutate records, or emit action JSON/i);
  assert.match(askPrompt, /exact source URLs/i);

  let executed = 0;
  let round = 0;
  const roundPayloads = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "ask",
    modeFamily: "xekute",
    chatHistory: [{ role: "user", content: "Can you create app.js?" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Can you create app.js?",
    sendEvent() {},
    async runModelRound(payload) {
      roundPayloads.push(payload);
      round += 1;
      return round === 1
        ? { error: null, fullText: "", toolCalls: [toolCall("create_file", { path: "app.js", content: "" })] }
        : { error: null, fullText: "Ask mode cannot modify files.", toolCalls: [] };
    },
    async executeToolCall() {
      executed += 1;
      return { ok: true, mutated: true };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed, 0);
  assert.match(roundPayloads[0].messages[0].content, /PROFILE — Ask/);
  assert.ok(roundPayloads[0].tools.length > 0);
  assert.ok(roundPayloads[0].tools.every((tool) => !ToolMap.isMutating(tool.function.name)));
  assert.ok(askTools.every((tool) => !["run_command", "start_process", "stop_process", "run_security_tool"].includes(tool.function.name)));
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
    actionResults: [{ ok: true, evidenceIds: ["ev-1"] }],
  });
  assert.equal(producedRequirement.reason, "evidence-produced");
});

test("ask mode blocks confirmation-shaped command output and keeps it out of the chat", async () => {
  const events = [];
  let roundPayload = null;
  let executed = 0;
  const rawCommandResponse = '{"command":"curl -s https://leadbondhuai.online","timeout_seconds":10}';
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "ask",
    modeFamily: "testing",
    chatHistory: [
      { role: "user", content: "What should I do first?" },
      { role: "assistant", content: "Would you like me to begin a reconnaissance scan?" },
      { role: "user", content: "yes" },
    ],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "yes",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      roundPayload = payload;
      payload.onToken('{"command":');
      payload.onToken('"curl -s https://leadbondhuai.online","timeout_seconds":10}');
      return { error: null, fullText: rawCommandResponse, toolCalls: [] };
    },
    async executeToolCall() {
      executed += 1;
      return { ok: true };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.ok(roundPayload.tools.length > 0);
  assert.ok(roundPayload.tools.every((tool) => !ToolMap.isMutating(tool.function.name)));
  assert.ok(roundPayload.tools.every((tool) => !["run_command", "start_process", "stop_process", "run_security_tool"].includes(tool.function.name)));
  assert.equal(executed, 0);
  assert.match(result.finalText, /Ask mode is read-only/i);
  assert.doesNotMatch(result.finalText, /curl|timeout_seconds|\"command\"/i);
  assert.ok(events.every((event) => event.type !== "content"));
  assert.ok(events.some((event) => event.type === "activity" && event.kind === "warn"));
  assert.ok(result.appendedMessages.some((message) => message.role === "assistant" && /Ask mode is read-only/i.test(message.content)));
});

test("ask mode does not display or execute a forbidden native tool call", async () => {
  const events = [];
  let executed = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "yes" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "yes",
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      return { error: null, fullText: "", toolCalls: [toolCall("run_command", { command: "curl https://leadbondhuai.online" })] };
    },
    async executeToolCall() {
      executed += 1;
      return { ok: true };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(executed, 0);
  assert.match(result.finalText, /Ask mode is read-only/i);
  assert.equal(events.filter((event) => event.type === "tool_call").length, 0);
  assert.ok(events.some((event) => event.type === "activity" && event.kind === "warn"));
});

test("agent mode carries an affirmative action follow-up into routing and blocks raw command fallback", async () => {
  const events = [];
  let roundPayload = null;
  let executed = 0;
  const rawCommandResponse = '{"command":"curl -s https://leadbondhuai.online","timeout_seconds":10}';
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [
      { role: "user", content: "What should I do first?" },
      { role: "assistant", content: "Would you like me to begin a passive reconnaissance scan on https://leadbondhuai.online?" },
      { role: "user", content: "yes" },
    ],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "yes",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      roundPayload = payload;
      payload.onToken(rawCommandResponse);
      return { error: null, fullText: rawCommandResponse, toolCalls: [] };
    },
    async executeToolCall() {
      executed += 1;
      return { ok: true };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.contextRoute.inheritedIntent, true);
  assert.equal(result.contextRoute.kind, "cyber");
  assert.ok(roundPayload.tools.some((tool) => tool.function.name === "load_tool_schemas"));
  // Active cyber tools start catalog-only until load_tool_schemas expands them.
  assert.equal(roundPayload.tools.some((tool) => tool.function.name === "run_security_tool"), false);
  assert.ok(roundPayload.tools.some((tool) => tool.function.name === "run_command"));
  assert.match(roundPayload.messages.map((message) => message.content).join("\n"), /run_security_tool|run_traffsucker/);
  assert.equal(executed, 0);
  assert.match(result.finalText, /No command was run/i);
  assert.doesNotMatch(result.finalText, /curl|timeout_seconds|\"command\"/i);
  assert.ok(events.every((event) => event.type !== "content"));
  assert.ok(events.some((event) => event.type === "activity" && event.kind === "warn"));
});

test("context and command guardrails bound history and block destructive commands", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"context ".repeat(120)}`,
  }));
  const trimmed = trimHistoryForContext(history, 4096);
  assert.ok(trimmed.length < history.length);
  assert.equal(trimmed.at(-1).content, history.at(-1).content);
  assert.match(commandGuardReason("git reset --hard HEAD~1"), /blocked/i);
  assert.equal(commandGuardReason("npm test"), "");
});

test("plan mode saves the plan to a dated file instead of dumping it in chat", async () => {
  const planPath = PlanDocument.buildPlanDocumentPath("Plan a refactor");
  let round = 0;
  let executed = 0;
  const responses = [
    { error: null, fullText: "", toolCalls: [toolCall("create_file", { path: planPath, content: "# Plan\n" })] },
    { error: null, fullText: "Saved the plan document.", toolCalls: [] },
  ];
  const roundPayloads = [];

  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "plan",
    chatHistory: [{ role: "user", content: "Plan a refactor" }],
    contextSummary: "",
    dirMap: "ROOT/\n  src/\n    app.js",
    activeFile: null,
    extraFiles: [],
    userMessage: "Plan a refactor",
    sendEvent() {},
    async runModelRound(payload) { roundPayloads.push(payload); return responses[round++]; },
    async executeToolCall() {
      executed += 1;
      return { ok: true, mode: "create", file: planPath, mutated: true, summary: "Created plan" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed, 1);
  assert.ok(roundPayloads[0].tools.some((tool) => tool.function.name === "create_file"));
  assert.match(result.finalText, /Saved the plan document/i);
});

test("planner mode exposes the full planner tool surface", async () => {
  const responses = [
    { error: null, fullText: "", toolCalls: [toolCall("create_file", { path: "plans/refactor-plan.md", content: "# Plan\n" })] },
    { error: null, fullText: "Saved the plan.", toolCalls: [] },
  ];
  let round = 0;
  let executed = 0;
  const roundPayloads = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "plan",
    chatHistory: [{ role: "user", content: "Create plans/refactor-plan.md" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Create plans/refactor-plan.md",
    sendEvent() {},
    async runModelRound(payload) { roundPayloads.push(payload); return responses[round++]; },
    async executeToolCall({ toolCall: call }) {
      executed += 1;
      assert.equal(call.function.name, "create_file");
      return { ok: true, mode: "create", file: "plans/refactor-plan.md", mutated: true, summary: "Created plan" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed, 1);
  assert.deepEqual(
    [...roundPayloads[0].tools.map((tool) => tool.function.name)].sort(),
    [...ToolMap.MODE_TOOL_GROUPS.planner].sort(),
  );
});

test("plan mode reads and updates an existing plan in place", async () => {
  const planPath = "plans/refactor-plan.md";
  const responses = [
    { error: null, fullText: "", toolCalls: [toolCall("read_file", { path: planPath })] },
    { error: null, fullText: "", toolCalls: [toolCall("patch_file", { path: planPath, search: "Old priority", replace: "New priority" })] },
    { error: null, fullText: "Updated the existing plan.", toolCalls: [] },
  ];
  const executed = [];
  const roundPayloads = [];
  let round = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "plan",
    chatHistory: [{ role: "user", content: `Update ${planPath} with the new priority` }],
    contextSummary: "",
    dirMap: "ROOT/\n  plans/\n    refactor-plan.md",
    activeFile: { path: planPath, content: "# Plan\n\nOld priority\n" },
    extraFiles: [],
    userMessage: `Update ${planPath} with the new priority`,
    sendEvent() {},
    async runModelRound(payload) { roundPayloads.push(payload); return responses[round++]; },
    async executeToolCall({ toolCall: call }) {
      executed.push(call.function.name);
      if (call.function.name === "read_file") {
        return { ok: true, mode: "read", file: planPath, content: "# Plan\n\nOld priority\n", mutated: false, summary: "Read plan" };
      }
      return { ok: true, mode: "patch", file: planPath, mutated: true, summary: "Updated plan" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(executed, ["read_file", "patch_file"]);
  assert.equal(executed.includes("create_file"), false);
  assert.match(roundPayloads[0].messages.map((message) => message.content).join("\n"), /Update the existing hypothesis plan in place/);
  assert.match(result.finalText, /Updated the existing plan/);
});

test("failed verification triggers a repair reminder and successful rerun", async () => {
  const responses = [
    { error: null, fullText: "", toolCalls: [toolCall("patch_file", { path: "app.js", search: "old", replace: "new" })] },
    { error: null, fullText: "", toolCalls: [toolCall("run_command", { command: "npm test" })] },
    { error: null, fullText: "Done.", toolCalls: [] },
    { error: null, fullText: "", toolCalls: [toolCall("patch_file", { path: "app.js", search: "new", replace: "fixed" })] },
    { error: null, fullText: "", toolCalls: [toolCall("run_command", { command: "npm test" })] },
    { error: null, fullText: "Fixed and tested.", toolCalls: [] },
    { error: null, fullText: "Fixed app.js; npm test passed.", toolCalls: [] },
  ];
  let round = 0;
  let commandRuns = 0;

  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:14b",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    chatHistory: [{ role: "user", content: "Fix app.js" }],
    contextSummary: "",
    dirMap: "ROOT/\n  app.js",
    activeFile: { path: "app.js", content: "old" },
    extraFiles: [],
    userMessage: "Fix app.js",
    sendEvent() {},
    async runModelRound() {
      return responses[round++];
    },
    async executeToolCall({ toolCall: call }) {
      const name = call.function.name;
      const args = call.function.arguments;
      if (name === "run_command") {
        commandRuns += 1;
        return {
          ok: true,
          mode: "command",
          command: args.command,
          exitCode: commandRuns === 1 ? 1 : 0,
          stdout: commandRuns === 1 ? "" : "passed",
          stderr: commandRuns === 1 ? "failed" : "",
          mutated: false,
        };
      }
      return { ok: true, mode: "patch", file: args.path, mutated: true, summary: `Updated ${args.path}` };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(commandRuns, 2);
  assert.match(result.finalText, /passed/i);
  assert.ok(result.appendedMessages.some((message) => /latest verification failed/i.test(message.content || "")));
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

test("measured prompt tokens use a multi-round ceiling before disabling tools", async () => {
  let round = 0;
  let secondRoundHadTools = false;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n  app.js",
    activeFile: { path: "app.js", content: "console.log('x')" },
    extraFiles: [],
    userMessage: "Patch app.js to log hello",
    sendEvent() {},
    async runModelRound(payload) {
      round += 1;
      if (round === 1) {
        return {
          error: null,
          fullText: "",
          toolCalls: [toolCall("read_file", { path: "app.js" })],
          usage: { promptTokens: 1200, completionTokens: 1 },
        };
      }
      if (round === 2) secondRoundHadTools = payload.tools.length > 0;
      return { error: null, fullText: "Done.", toolCalls: [], usage: { promptTokens: 1300, completionTokens: 2 } };
    },
    async executeToolCall({ toolCall }) {
      return { ok: true, content: "console.log('x')", summary: "read app.js" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(result.ok, true);
  assert.ok(round >= 2);
  assert.equal(secondRoundHadTools, true);
});

test("agent profile blocks unjustified multi-phase jumps without operator approval when cyber actions run", () => {
  const AgentRuntime = require("../src/application/agent/runtime");
  const runState = AgentRuntime.createRunState({ runId: "run-phase", profile: "agent" });
  const step = advanceTowardPhase(runState, "execution", {
    reason: "Skip inventory",
    profile: { key: "agent" },
    operatorApproved: false,
    cyberAction: true,
  });
  assert.equal(step.ok, false);
  assert.equal(step.blocked, true);
  assert.equal(step.code, "PHASE_TRANSITION_BLOCKED");
});

test("parallel read-only tools finalize results in call order and suppress post-stop events", async () => {
  const events = [];
  const executionOrder = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n  a.js\n  b.js",
    activeFile: null,
    extraFiles: [],
    userMessage: "Read a.js and b.js",
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      return {
        error: null,
        fullText: "",
        toolCalls: [
          toolCall("read_file", { path: "a.js" }),
          toolCall("read_file", { path: "b.js" }),
        ],
      };
    },
    async executeToolCall({ toolCall }) {
      const path = toolCall.function.arguments.path;
      executionOrder.push(path);
      if (path === "a.js") {
        return { ok: true, sensitiveDataExposure: true, content: "alpha", summary: "alpha" };
      }
      return { ok: true, content: "beta", summary: "beta" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(executionOrder, ["a.js", "b.js"]);
  const toolResults = events.filter((event) => event.type === "tool_result");
  assert.equal(toolResults.length, 1);
  assert.equal(toolResults[0].result.summary, "alpha");
});

test("tool signatures canonicalize argument key order", () => {
  const first = toolCallSignature({
    toolName: "search_web",
    args: { query: "xekute", limit: 4, options: { language: "en", safe: true } },
  });
  const second = toolCallSignature({
    toolName: "search_web",
    args: { options: { safe: true, language: "en" }, limit: 4, query: "xekute" },
  });
  assert.equal(first, second);
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

test("testing tools progress through inventory, hypothesis, execution, and observation", async () => {
  let round = 0;
  const phases = [];
  const executed = [];
  const responses = [
    { error: null, fullText: "", toolCalls: [toolCall("search_web", { query: "example.com inventory" })] },
    { error: null, fullText: "", toolCalls: [toolCall("load_tool_schemas", { packs: ["evidence"] })] },
    { error: null, fullText: "", toolCalls: [toolCall("record_hypothesis", { id: "hyp-1", question: "Is the documented behavior exposed?", expected_signal: "Public documentation" })] },
    { error: null, fullText: "", toolCalls: [toolCall("search_web", { query: "example.com documented behavior" })] },
    { error: null, fullText: "The hypothesis remains inconclusive.", toolCalls: [] },
  ];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    authority: { superMode: "full", permissions: { evidenceManagement: true, webResearch: true } },
    chatHistory: [{ role: "user", content: "Research example.com and test a hypothesis" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Research example.com and test a hypothesis",
    sendEvent(event) {
      if (event.type === "run_state") phases.push(event.state.phase);
    },
    async runModelRound() { return responses[round++]; },
    async executeToolCall({ toolCall: call }) {
      executed.push(call.function.name);
      if (call.function.name === "load_tool_schemas") {
        return {
          ok: true,
          mode: "schema_load",
          loaded: ["record_hypothesis", "list_datasets", "ingest_assessment_records", "record_finding_candidate", "verify_finding_candidate", "annotate_map_finding"],
          summary: "Loaded evidence schemas",
        };
      }
      return { ok: true, summary: `${call.function.name} completed` };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(executed, ["search_web", "load_tool_schemas", "record_hypothesis", "search_web"]);
  assert.ok(phases.includes("inventory"));
  assert.ok(phases.includes("hypothesis"));
  assert.ok(phases.includes("execution"));
  assert.ok(phases.includes("observation"));
});

test("rejected tool execution becomes an ordered tool result", async () => {
  let round = 0;
  let executions = 0;
  const events = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Create broken.txt" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Create broken.txt",
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      round += 1;
      if (round === 1) return { error: null, fullText: "", toolCalls: [toolCall("create_file", { path: "broken.txt", content: "x" })] };
      return { error: null, fullText: "The file could not be created.", toolCalls: [] };
    },
    async executeToolCall() {
      executions += 1;
      throw new Error("disk unavailable");
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(executions, 1);
  assert.equal(result.ok, true);
  assert.ok(events.some((event) => event.type === "tool_result" && event.result?.errorCode === "TOOL_EXECUTION_FAILED"));
  assert.ok(result.appendedMessages.some((message) => message.role === "tool" && /disk unavailable/i.test(message.content)));
});

test("a serial repeated failure is persisted for the exact signature", async () => {
  let round = 0;
  let executions = 0;
  const repeated = toolCall("read_file", { path: "missing.js" });
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Read missing.js" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "Read missing.js",
    sendEvent() {},
    async runModelRound() {
      round += 1;
      if (round <= 2) {
        return {
          error: null,
          fullText: "",
          toolCalls: [{ ...repeated, id: `read-${round}` }],
        };
      }
      return { error: null, fullText: "The file is unavailable.", toolCalls: [] };
    },
    async executeToolCall() {
      executions += 1;
      return { ok: false, error: "File not found", errorCode: "DATASET_NOT_FOUND", errorClass: "not_found_or_schema" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(executions, 1);
  assert.equal(result.failureRecords.length, 1);
  assert.equal(result.failureRecords[0].toolName, "read_file");
  assert.match(result.failureRecords[0].signature, /missing\.js/);
});

test("duplicate reads in one batch execute only once", async () => {
  let round = 0;
  let executions = 0;
  const events = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Read a.js twice" }],
    contextSummary: "",
    dirMap: "ROOT/\n  a.js",
    activeFile: null,
    extraFiles: [],
    userMessage: "Read a.js twice",
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      round += 1;
      if (round === 1) {
        return {
          error: null,
          fullText: "",
          toolCalls: [
            toolCall("read_file", { path: "a.js" }),
            toolCall("read_file", { path: "a.js" }),
          ],
        };
      }
      return { error: null, fullText: "Read completed.", toolCalls: [] };
    },
    async executeToolCall() {
      executions += 1;
      return { ok: true, content: "a", summary: "a" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(result.ok, true);
  assert.equal(executions, 1);
  const results = events.filter((event) => event.type === "tool_result");
  assert.equal(results.length, 2);
  assert.equal(results[1].result.errorCode, "REDUNDANT_READ");
});

test("the strict cumulative ceiling prevents an extra summary round", async () => {
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    contextBudget: 16384,
    contextPlan: {
      provider: "ollama",
      model: "local:small",
      effectiveLimitTokens: 16384,
      promptBudgetTokens: 16384,
      responseReserveTokens: 0,
      safetyMarginTokens: 0,
    },
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Read a.js" }],
    contextSummary: "",
    dirMap: "ROOT/\n  a.js",
    activeFile: null,
    extraFiles: [],
    userMessage: "Read a.js",
    sendEvent() {},
    async runModelRound() {
      rounds += 1;
      return {
        error: null,
        fullText: "",
        toolCalls: [toolCall("read_file", { path: "a.js" })],
        usage: { promptTokens: 200_000, completionTokens: 1 },
      };
    },
    async executeToolCall() { return { ok: true, content: "a", summary: "a" }; },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });
  assert.equal(rounds, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /token budget exceeded/i);
});
