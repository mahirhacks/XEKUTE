const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/harness/core/tool-map");
const {
  commandGuardReason,
  buildEngagementPromptContext,
  filterToolsForMode,
  filterToolsForRoute,
  runAgentTurn,
  trimHistoryForContext,
} = require("../src/agent/controller");
const ContextRouter = require("../src/prompts/skills/context-router");
const { buildSystemContext } = require("../src/agent/prompt");
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

test("simple conversation uses compact context, no discovery, no tools, no evidence chrome, and no workspace writes", async (t) => {
  let roundPayload = null;
  let discoveryCalls = 0;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-greeting-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const result = await runAgentTurn({
    workspace,
    model: "local:small",
    numCtx: 4096,
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
    sendEvent() {},
    async runModelRound(payload) {
      roundPayload = payload;
      return { error: null, fullText: "Hey! How can I help?", toolCalls: [], usage: { promptTokens: 321, completionTokens: 7 } };
    },
    async executeToolCall() { throw new Error("A greeting must not execute tools."); },
    findWorkspaceFiles() { discoveryCalls += 1; return { results: [] }; },
    searchWorkspaceIndex() { discoveryCalls += 1; return { results: [] }; },
  });

  assert.equal(discoveryCalls, 0);
  assert.equal(roundPayload.tools.length, 0);
  assert.equal(roundPayload.messages.filter((message) => message.role === "user" && message.content === "hi").length, 1);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /OPERATING LOOP|XEKUTE AUTHORITY|UNTRUSTED CONTEXT DATA|previous assessment summary/);
  assert.match(roundPayload.messages[0].content, /Ordinary conversation is not an assessment request/i);
  assert.equal(result.contextRoute.kind, "conversation");
  assert.deepEqual(result.claims, []);
  assert.equal(result.operatorFeedback, null);
  assert.equal(result.finalText, "Hey! How can I help?");
  assert.equal(result.contextUsage.source, "ollama");
  assert.equal(result.contextUsage.promptTokens, 321);
  assert.deepEqual(result.contextUsage.toolNames, []);
  assert.equal(result.contextUsage.route.promptDepth, "compact");
  assert.deepEqual(fs.readdirSync(workspace), []);
});

test("progressive routing exposes only the relevant compact tool group", () => {
  const osRoute = ContextRouter.routeRequest({ text: "Fix src/app.js and run the tests", hasWorkspace: true, family: "assist", mode: "agent" });
  const osTools = ToolMap.compactTools(filterToolsForRoute(filterToolsForMode(ToolMap.TOOLS, "agent", "assist"), osRoute));
  assert.deepEqual(osRoute.toolCategories, ["os"]);
  assert.ok(osTools.some((tool) => tool.function.name === "patch_file"));
  assert.ok(osTools.some((tool) => tool.function.name === "run_command"));
  assert.ok(osTools.every((tool) => ToolMap.TOOL_META[tool.function.name].category === "os"));
  assert.ok(osTools.every((tool) => !tool.function.description.includes("\n")));

  const cyberRoute = ContextRouter.routeRequest({ text: "Run nmap against the authorized target", hasWorkspace: true, family: "testing", mode: "agent" });
  const cyberTools = filterToolsForRoute(filterToolsForMode(ToolMap.TOOLS, "agent", "testing"), cyberRoute);
  assert.deepEqual(cyberRoute.toolCategories, ["cyber"]);
  assert.ok(cyberTools.some((tool) => tool.function.name === "run_security_tool"));
  assert.ok(cyberTools.some((tool) => tool.function.name === "record_hypothesis"));
  assert.ok(cyberTools.every((tool) => ToolMap.TOOL_META[tool.function.name].category === "cyber"));
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

test("passive scan in assist mode warns via routing without security runner tools", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
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
  assert.equal(context.context.applicationOverview, "Customer portal");
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

test("text-only mutation output is withheld, retried, and fails without claiming a file change", async () => {
  const events = [];
  const roundPayloads = [];
  let rounds = 0;
  let executions = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:no-thinking",
    numCtx: 4096,
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
      payload.onToken("Sure! Here's a basic index.html file:\n```html\n<!doctype html>");
      return { error: null, aborted: true, fullText: "Sure! Here's a basic index.html file:", toolCalls: [] };
    },
    async executeToolCall() { executions += 1; return { ok: true }; },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(rounds, 2);
  assert.equal(executions, 0);
  assert.equal(result.ok, false);
  assert.match(result.error, /answered with text instead of calling a workspace tool/i);
  assert.ok(events.every((event) => event.type !== "content"));
  assert.match(roundPayloads[0].messages.map((message) => message.content).join("\n"), /WORKSPACE ACTION CONTRACT/);
  assert.match(roundPayloads[1].messages.map((message) => message.content).join("\n"), /requires real workspace actions/i);
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
    numCtx: 4096,
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
    numCtx: 4096,
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
    { fullText: "", toolCalls: [toolCall("read_file", { path: "Map/application-map.json" })] },
    { fullText: "", toolCalls: [] },
    { fullText: "Evidence-backed Map analysis.", toolCalls: [] },
  ];
  let round = 0;
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "reasoning-model",
    numCtx: 4096,
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
      return { ok: true, mode: "read", file: "Map/application-map.json", content: "{}", summary: "Read Map" };
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
  assert.match(agentPrompt, /SAFE AGENT/);
  assert.match(planPrompt, /SAFE PLANNER/);
  assert.match(askPrompt, /SAFE ASK/);
  assert.match(agentPrompt, /authorized web, API, and external-perimeter/i);
  assert.match(agentPrompt, /scanner signature/i);
  assert.match(agentPrompt, /unexpected impact/i);
  assert.match(planPrompt, /hypothesis-driven plan/i);
  assert.match(planPrompt, /completion gate/i);
  assert.match(askPrompt, /verified claims/i);
  assert.match(askPrompt, /missing evidence/i);

  const planTools = filterToolsForMode(ToolMap.TOOLS, "plan");
  assert.deepEqual(planTools.map((tool) => tool.function.name), ["create_file"]);
  const askTools = filterToolsForMode(ToolMap.TOOLS, "ask");
  assert.ok(askTools.length > 0);
  assert.ok(askTools.every((tool) => !ToolMap.isMutating(tool.function.name)));
  assert.ok(askTools.every((tool) => !["run_command", "start_process", "stop_process", "read_process", "run_security_tool"].includes(tool.function.name)));
  assert.match(planPrompt, /only allowed tool is create_file/i);
  assert.match(askPrompt, /read-only discovery, research, and Map tools/i);
  assert.match(askPrompt, /exact source URLs/i);
  assert.match(askPrompt, /Do not offer to start an active scan/i);

  let executed = 0;
  let round = 0;
  const roundPayloads = [];
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 4096,
    contextBudget: 4096,
    thinking: false,
    tools: ToolMap.TOOLS,
    mode: "ask",
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
  assert.match(roundPayloads[0].messages[0].content, /SAFE ASK/);
  assert.ok(roundPayloads[0].tools.length > 0);
  assert.ok(roundPayloads[0].tools.every((tool) => !ToolMap.isMutating(tool.function.name)));
  assert.ok(roundPayloads[0].tools.every((tool) => !["run_command", "start_process", "stop_process", "read_process", "run_security_tool"].includes(tool.function.name)));
});

test("ask mode blocks confirmation-shaped command output and keeps it out of the chat", async () => {
  const events = [];
  let roundPayload = null;
  let executed = 0;
  const rawCommandResponse = '{"command":"curl -s https://leadbondhuai.online","timeout_seconds":10}';
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 4096,
    contextBudget: 4096,
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
  assert.ok(roundPayload.tools.every((tool) => !["run_command", "start_process", "stop_process", "read_process", "run_security_tool"].includes(tool.function.name)));
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
    numCtx: 4096,
    contextBudget: 4096,
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
    numCtx: 4096,
    contextBudget: 4096,
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
  assert.ok(roundPayload.tools.length > 0);
  assert.ok(roundPayload.tools.every((tool) => tool.function.name !== "run_command"));
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

test("plan mode does not inspect automatically and exposes no tools for a normal plan", async () => {
  let round = 0;
  let executed = 0;
  const responses = [{ error: null, fullText: "1. Update src/app.js. 2. Run npm test later.", toolCalls: [] }];
  const roundPayloads = [];

  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:9b",
    numCtx: 4096,
    contextBudget: 4096,
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
      return { ok: true, mode: "create", summary: "Created plan" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed, 0);
  assert.equal(roundPayloads.length, 1);
  assert.equal(roundPayloads[0].tools.length, 0);
  assert.match(result.finalText, /src\/app\.js/);
});

test("plan mode can create a plan document but not arbitrary source files", async () => {
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
    numCtx: 4096,
    contextBudget: 4096,
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
  assert.deepEqual(roundPayloads[0].tools.map((tool) => tool.function.name), ["create_file"]);
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
    numCtx: 8192,
    contextBudget: 8192,
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
