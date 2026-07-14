const test = require("node:test");
const assert = require("node:assert/strict");

const ToolMap = require("../src/tools/tool-map");
const {
  commandGuardReason,
  filterToolsForMode,
  runAgentTurn,
  trimHistoryForContext,
} = require("../src/agent/agent-controller");
const { buildSystemContext } = require("../src/agent/agent-prompt");

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

test("runAgentTurn keeps calling tools until multi-file web requests are complete", async () => {
  const executed = [];
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
    workspace: "G:/Pointer/tmp",
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
    sendEvent() {},
    async runModelRound(payload) {
      roundPayloads.push(payload);
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

test("mode prompts and tool lists are distinct and read-only modes are enforced", async () => {
  const agentPrompt = buildSystemContext({ mode: "agent", numCtx: 4096, userMessage: "Fix it" });
  const planPrompt = buildSystemContext({ mode: "plan", numCtx: 4096, userMessage: "Plan it" });
  const askPrompt = buildSystemContext({ mode: "ask", numCtx: 4096, userMessage: "Explain it" });
  assert.match(agentPrompt, /AGENT MODE/);
  assert.match(planPrompt, /PLAN MODE/);
  assert.match(askPrompt, /ASK MODE/);
  assert.match(agentPrompt, /authorized pentest operator/i);
  assert.match(agentPrompt, /scanner output as leads/i);
  assert.match(agentPrompt, /stop on unexpected impact/i);
  assert.match(planPrompt, /hypothesis-driven test plan/i);
  assert.match(planPrompt, /stop condition/i);
  assert.match(askPrompt, /confirmed vulnerability/i);
  assert.match(askPrompt, /remains unverified/i);

  const planTools = filterToolsForMode(ToolMap.TOOLS, "plan");
  assert.ok(planTools.length > 0);
  assert.ok(planTools.every((tool) => !ToolMap.isMutating(tool.function.name)));
  assert.ok(planTools.every((tool) => tool.function.name !== "run_command"));
  assert.ok(planTools.some((tool) => tool.function.name === "search_web"));
  assert.ok(planTools.some((tool) => tool.function.name === "fetch_url"));
  assert.match(askPrompt, /exact source URLs/i);

  let executed = 0;
  let round = 0;
  const roundPayloads = [];
  const result = await runAgentTurn({
    workspace: "G:/Pointer/tmp",
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
  assert.match(roundPayloads[0].messages[0].content, /ASK MODE/);
  assert.ok(roundPayloads[0].tools.every((tool) => !ToolMap.isMutating(tool.function.name)));
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

test("plan mode requires one grounded workspace inspection before finalizing", async () => {
  let round = 0;
  let executed = 0;
  const responses = [
    { error: null, fullText: "Generic plan.", toolCalls: [] },
    { error: null, fullText: "", toolCalls: [toolCall("inspect_workspace", {})] },
    { error: null, fullText: "1. Update src/app.js. 2. Run npm test later.", toolCalls: [] },
  ];

  const result = await runAgentTurn({
    workspace: "G:/Pointer/tmp",
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
    async runModelRound() { return responses[round++]; },
    async executeToolCall({ toolCall: call }) {
      executed += 1;
      assert.equal(call.function.name, "inspect_workspace");
      return { ok: true, mode: "inspect", summary: "Node project with npm test" };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(executed, 1);
  assert.match(result.finalText, /src\/app\.js/);
  assert.ok(result.appendedMessages.some((message) => /not grounded/i.test(message.content || "")));
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
    workspace: "G:/Pointer/tmp",
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
