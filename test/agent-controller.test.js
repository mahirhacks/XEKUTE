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
  fitMessagesToContext,
  advanceTowardPhase,
  toolCallSignature,
} = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator, CHECKPOINT_RATIO } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { classifyEvidenceRequirement } = require("../src/agent/runtime/evidence-classifier.js");
const ContextRouter = require("../src/prompts/skills/context-router");
const ModeSkills = require("../src/prompts/skills/mode-skills");
const { buildSystemContext } = require("../src/agent/runtime/prompt-context.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");

test("agent tool surface is enabled by default in controller turns", () => {
  assert.equal(AgentToolSurface.toolsEnabled(), true);
});

test("Agent catalog never includes the retired task-list tool", async () => {
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
  assert.equal(seen[1].includes("update_task_list"), false);
  assert.equal(seen[0].includes("update_project_artifacts"), false);
  assert.equal(seen[1].includes("update_project_artifacts"), false);
});

test("Agent turns do not publish a task-list surface", async () => {
  const events = [];
  await runAgentTurn({
    workspace: path.resolve("."),
    mode: "agent",
    userMessage: "Implement the following:\n- inspect current behavior\n- make the required change\n- add regression coverage\n- verify the result",
    sendEvent: (event) => events.push(event),
    runModelRound: async () => ({ fullText: "Done", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true }),
  });
  assert.equal(events.some((event) => event.type === "task_brief"), false);
  assert.equal(events.some((event) => event.type === "task_list"), false);
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

test("Tier 1 keeps the current prompt before assistant/tool turns and preserves the exact turn transcript", async () => {
  const rounds = [];
  let round = 0;
  const projectId = "proj_00000000-0000-4000-8000-000000004101";
  const sessionId = "session_00000000-0000-4000-8000-000000004102";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "run the check",
    chatHistory: [],
    sendEvent() {},
    async runModelRound(payload) {
      rounds.push(payload.messages.map((message) => ({
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
      })));
      round += 1;
      if (round === 1) {
        return {
          ok: true,
          fullText: "",
          toolCalls: [{ id: "call-check", type: "function", function: { name: "exec_command", arguments: {} } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "done", toolCalls: [], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: true, value: { summary: "check completed" } };
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(rounds.length, 2);
  const currentPrompt = (message) => message.role === "user" && message.content === "run the check";
  const firstPromptIndex = rounds[0].findIndex(currentPrompt);
  const secondPromptIndex = rounds[1].findIndex(currentPrompt);
  const assistantToolIndex = rounds[1].findIndex((message) => message.role === "assistant" && Array.isArray(message.tool_calls));
  const toolResultIndex = rounds[1].findIndex((message) => message.role === "tool");
  assert.equal(rounds[0].filter(currentPrompt).length, 1);
  assert.equal(firstPromptIndex, rounds[0].length - 1, "the initial provider request ends with the current user prompt");
  assert.equal(rounds[1].filter(currentPrompt).length, 1);
  assert.ok(secondPromptIndex >= 0 && secondPromptIndex < assistantToolIndex, "the current prompt precedes the assistant tool call");
  assert.ok(assistantToolIndex < toolResultIndex, "the tool result follows the assistant tool call");
  assert.equal(rounds[1].at(-1).role, "tool");
  assert.deepEqual(result.appendedMessages.map((message) => message.role), ["assistant", "tool", "assistant"]);
  assert.equal(result.appendedMessages.some(currentPrompt), false, "the protected prompt is not duplicated in appended transcript messages");
  const active = tier1.state(projectId, sessionId).active;
  assert.deepEqual(active.map((message) => message.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(active[0].content, "run the check");
  assert.equal(active[1].tool_calls[0].function.name, "exec_command");
  assert.equal(active[2].content.includes("check completed"), true);
  assert.equal(active[3].content, "done");
  assert.deepEqual(result.contextUsage.sections.map((section) => section.label), ["System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP", "Summarized Conversation", "Active Conversation", "Current Workflow"]);
});

test("Tier 1 excludes tool attempts that never crossed the execution boundary", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004111";
  const sessionId = "session_00000000-0000-4000-8000-000000004112";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  let round = 0;
  const result = await runAgentTurn({
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "try the unavailable reader",
    chatHistory: [],
    sendEvent() {},
    async runModelRound() {
      round += 1;
      if (round === 1) return { ok: true, fullText: "Trying.", toolCalls: [{ id: "call-missing", type: "function", function: { name: "read_file", arguments: { path: "missing.txt" } } }], finishReason: "tool_calls" };
      return { ok: true, fullText: "The reader was unavailable.", toolCalls: [], finishReason: "stop" };
    },
    async executeToolCall() { throw new Error("an unavailable tool must not execute"); },
  });

  assert.equal(result.ok, true);
  const active = tier1.state(projectId, sessionId).active;
  assert.deepEqual(active.map((message) => message.role), ["user", "assistant"]);
  assert.equal(JSON.stringify(active).includes("call-missing"), false);
  assert.equal(JSON.stringify(active).includes("TOOL_UNAVAILABLE"), false);
});

test("Tier 1 usage snapshots keep local section tokens instead of OpenRouter prompt totals", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004121";
  const sessionId = "session_00000000-0000-4000-8000-000000004122";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  const result = await runAgentTurn({
    model: "provider/reconciled-model",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
    mode: "ask",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "Explain the result.",
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      return {
        ok: true,
        provider: "openrouter",
        fullText: "Done.",
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 777, completionTokens: 9, source: "openrouter" },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.contextUsage.source, "estimate");
  assert.equal(result.contextUsage.tokenCalculation.method, "tier1-approximate");
  assert.notEqual(result.contextUsage.promptTokens, 777);
  assert.equal(result.contextUsage.sections.length, 9);
  assert.equal(
    result.contextUsage.sections.reduce((sum, section) => sum + section.tokens, 0),
    result.contextUsage.promptTokens,
  );
  const active = result.contextUsage.sections.find((section) => section.key === "active_conversation");
  assert.ok(active.tokens > 0, "Active Conversation must come from the T1 ledger");
  const expectedActive = Number(result.contextUsage.tier1?.rows?.["Active Conversation"]) || 0;
  assert.equal(active.tokens, expectedActive);

  const snapshots = events.filter((event) => event.type === "context_usage" && event.usage?.sections?.length === 9);
  assert.ok(snapshots.length >= 2);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.usage.source, "estimate");
    assert.notEqual(snapshot.usage.promptTokens, 777);
    assert.equal(snapshot.usage.tokenCalculation.method, "tier1-approximate");
    assert.equal(
      snapshot.usage.sections.reduce((sum, section) => sum + section.tokens, 0),
      snapshot.usage.promptTokens,
      "section rows must match the T1 approximate total",
    );
  }
  assert.equal(events.some((event) => event.type === "context_usage" && event.usage?.source === "openrouter"), false);
});

test("a Tier 1 preview fills the meter before the first send without running the model", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004141";
  const sessionId = "session_00000000-0000-4000-8000-000000004142";
  const { previewTier1Usage } = require("../src/agent/controller/agent-controller.js");
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  const preview = await previewTier1Usage({
    model: "provider/meter-model",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    async runModelRound() { throw new Error("a context preview must not call the model"); },
    async executeToolCall() { throw new Error("a context preview must not execute tools"); },
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.preview, true);
  assert.equal(preview.contextUsage.source, "estimate");
  assert.equal(preview.contextUsage.tokenCalculation.method, "tier1-approximate");
  assert.equal(preview.contextUsage.sections.length, 9);
  const rows = Object.fromEntries(preview.contextUsage.sections.map((section) => [section.key, section.tokens]));
  assert.ok(rows.system_prompt > 0, "Block A rows are available before the first send");
  assert.ok(rows.tool_definitions > 0);
  assert.equal(rows.active_conversation, 0, "an unsent chat has no active conversation");
  assert.deepEqual(tier1.state(projectId, sessionId).active, [], "a preview does not seed the ledger");
  assert.equal(events.length, 0, "a preview publishes no run events");
});

test("Tier 1 meter updates when the active ledger changes and survives a coordinator restart", async () => {
  const crypto = require("node:crypto");
  const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
  const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-t1-meter-restart-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const projectId = "proj_00000000-0000-4000-8000-000000004131";
  const sessionId = "session_00000000-0000-4000-8000-000000004132";
  const first = createTier1ContextCoordinator({ sensitiveStore: store });
  const events = [];
  let round = 0;
  try {
    const firstTurn = await runAgentTurn({
      model: "provider/meter-model",
      numCtx: 32_768,
      contextBudget: 32_768,
      contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
      mode: "agent",
      modeFamily: "assist",
      projectId,
      memorySessionId: sessionId,
      tier1Context: first,
      userMessage: "run the check",
      chatHistory: [],
      sendEvent(event) { events.push(event); },
      async runModelRound() {
        round += 1;
        if (round === 1) {
          return {
            ok: true,
            provider: "openrouter",
            fullText: "",
            toolCalls: [{ id: "call-check", type: "function", function: { name: "exec_command", arguments: {} } }],
            finishReason: "tool_calls",
            usage: { promptTokens: 777, completionTokens: 2, source: "openrouter" },
          };
        }
        return {
          ok: true,
          provider: "openrouter",
          fullText: "done",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 777, completionTokens: 4, source: "openrouter" },
        };
      },
      async executeToolCall() {
        return { ok: true, value: { summary: "check completed" } };
      },
    });
    assert.equal(firstTurn.ok, true, JSON.stringify(firstTurn.error || ""));
    const usageEvents = events.filter((event) => event.type === "context_usage" && event.usage?.source === "estimate");
    assert.ok(usageEvents.length >= 3);
    const activeTokens = usageEvents.map((event) => (
      event.usage.sections.find((section) => section.key === "active_conversation")?.tokens || 0
    ));
    assert.ok(activeTokens.some((tokens, index) => index > 0 && tokens > activeTokens[0]), "Active Conversation tokens must rise when T1 appends");
    assert.equal(usageEvents.every((event) => event.usage.promptTokens !== 777), true);

    const restarted = createTier1ContextCoordinator({ sensitiveStore: store });
    const secondTurn = await runAgentTurn({
      model: "provider/meter-model",
      numCtx: 32_768,
      contextBudget: 32_768,
      contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
      mode: "ask",
      modeFamily: "assist",
      projectId,
      memorySessionId: sessionId,
      tier1Context: restarted,
      userMessage: "continue the review",
      chatHistory: [],
      sendEvent() {},
      async runModelRound() {
        return { ok: true, fullText: "Continuing.", toolCalls: [], finishReason: "stop" };
      },
    });
    assert.equal(secondTurn.ok, true, JSON.stringify(secondTurn.error || ""));
    const restored = restarted.state(projectId, sessionId).active;
    assert.ok(restored.some((message) => message.role === "user" && message.content === "run the check"));
    assert.ok(restored.some((message) => message.role === "tool" || String(message.content || "").includes("check completed")));
    assert.ok(restored.some((message) => message.role === "user" && message.content === "continue the review"));
    const secondActive = secondTurn.contextUsage.sections.find((section) => section.key === "active_conversation");
    assert.ok(secondActive.tokens > activeTokens[0], "restarted T1 Active Conversation must include the persisted ledger");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test("passive scan routing is not reduced by the selected mode", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    mode: "ask",
  });
  assert.deepEqual(route.toolCategories, ["cyber"]);
  assert.ok(route.cyberCapabilities.includes("active"));
});

test("project prompt context uses app-managed profile scope", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-scope-context-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const context = buildEngagementPromptContext({
    workspace: root,
    projectProfile: {
      project: { name: "Example App" },
      scope: {
        inScopeTargets: [{ id: "target-1", assetType: "domain", value: "app.example.com", notes: "primary app" }],
        notes: "profile note",
      },
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
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  let roundPayload = null;
  const result = await runAgentTurn({
    workspace: root,
    projectProfile: {
      project: { name: "Example App" },
      scope: { inScopeTargets: [{ id: "target-1", assetType: "domain", value: "app.example.com" }] },
    },
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
  assert.ok(Array.isArray(roundPayload.tools) && roundPayload.tools.length > 0, "ask mode exposes the canonical tool set");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "search_workspace"), "ask mode can inspect workspace evidence");
  assert.equal(roundPayload.tools.some((tool) => tool.function?.name === "exec_command"), false, "ask mode does not include exec_command");
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
  const leftoverPlan = buildSystemContext({ mode: "plan", numCtx: 4096, userMessage: "Plan it" });
  const askPrompt = buildSystemContext({ mode: "ask", numCtx: 4096, userMessage: "Explain it" });
  const leftoverHypothesis = buildSystemContext({ mode: "hypothesis", numCtx: 4096, userMessage: "Hypothesize" });
  assert.match(agentPrompt, /PROFILE — Agent/);
  assert.match(leftoverPlan, /PROFILE — Ask/);
  assert.match(leftoverHypothesis, /PROFILE — Ask/);
  assert.match(askPrompt, /PROFILE — Ask/);
  assert.match(ModeSkills.render("agent"), /tools/i);
  assert.doesNotMatch(leftoverPlan, /PROFILE — Plan/);
  assert.doesNotMatch(leftoverHypothesis, /PROFILE — Hypothesis/);
  assert.match(askPrompt, /read-only questions and analysis/i);
  assert.match(askPrompt, /inconclusive/i);
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

test("fitMessagesToContext fails closed when mandatory anchors exceed the budget", () => {
  const objective = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(" ");
  const fitted = fitMessagesToContext({
    baseMessages: [{ role: "system", content: "fixed prompt" }],
    history: [{ role: "user", content: objective }],
    promptBudget: 512,
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

test("a Tier 1 checkpoint fills summarized conversation and current workflow usage", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004301";
  const sessionId = "session_00000000-0000-4000-8000-000000004302";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  let modelCalls = 0;
  const chatHistory = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Turn ${index}: ${"finding ".repeat(80)}`,
  }));
  const result = await runAgentTurn({
    model: "local:small",
    numCtx: 4_096,
    contextBudget: 4_096,
    contextPlan: { provider: "ollama", effectiveLimitTokens: 4_096, promptBudgetTokens: 4_096 },
    mode: "ask",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "Continue the investigation from the last finding.",
    chatHistory,
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("wrap-up resume must not call runModelRound more than twice");
      }
      return { ok: true, fullText: "Continuing from the checkpoint.", toolCalls: [], finishReason: "stop" };
    },
  });

  assert.equal(result.ok, true, result.error || "");
  const completed = events.filter((event) => event.type === "context_checkpoint" && event.status === "completed");
  assert.ok(completed.length, "the controller must complete at least one conversation checkpoint");
  const latestCheckpoint = completed.at(-1);
  assert.ok(latestCheckpoint.summarizedConversationTokens > 0, "summarized conversation must receive checkpoint tokens");
  assert.ok(latestCheckpoint.currentWorkflowTokens > 0, "current workflow must be populated by the checkpoint");
  assert.equal(Boolean(latestCheckpoint.currentWorkflow), true);

  const usageAfter = [...events].reverse().find((event) => event.type === "context_usage" && Array.isArray(event.usage?.sections));
  assert.ok(usageAfter, "a context usage snapshot must follow the checkpoint");
  const summarized = usageAfter.usage.sections.find((section) => section.key === "summarized_conversation");
  const workflow = usageAfter.usage.sections.find((section) => section.key === "current_workflow");
  assert.ok(summarized?.tokens > 0);
  assert.ok(workflow?.tokens > 0);
});

function memoryIds(n) {
  return {
    projectId: `proj_00000000-0000-4000-8000-00000000${n}`,
    sessionId: `session_00000000-0000-4000-8000-00000000${n}`,
  };
}

function activeConversationHasRole(assembled, role) {
  const components = assembled?.blocks?.B?.components || [];
  const active = components.find((entry) => entry.label === "Active Conversation");
  return Array.isArray(active?.value) && active.value.some((message) => message?.role === role);
}

function delegateTier1(inner, extras = {}) {
  return {
    assemble: (...args) => inner.assemble(...args),
    pressure: extras.pressure || ((...args) => inner.pressure(...args)),
    appendConversation: (...args) => inner.appendConversation(...args),
    checkpoint: extras.checkpoint || ((...args) => inner.checkpoint(...args)),
    setActiveConversation: (...args) => inner.setActiveConversation?.(...args),
    setWorkflow: (...args) => inner.setWorkflow?.(...args),
    state: (...args) => inner.state?.(...args),
  };
}

function createWrapUpCrossingCoordinator({
  failCheckpoint = false,
  stayOverAfterRotate = false,
  onAfterCheckpoint = null,
} = {}) {
  const inner = createTier1ContextCoordinator();
  let rotated = false;
  return delegateTier1(inner, {
    pressure(input) {
      const base = inner.pressure(input);
      const assembled = input.assembled;
      const crossed = activeConversationHasRole(assembled, "assistant")
        || activeConversationHasRole(assembled, "tool");
      if (!rotated) {
        return { ...base, threshold: crossed ? 0 : Number.MAX_SAFE_INTEGER };
      }
      return { ...base, threshold: stayOverAfterRotate ? 0 : Number.MAX_SAFE_INTEGER };
    },
    async checkpoint(...args) {
      if (failCheckpoint) {
        return { ok: false, code: "MEMORY_CHECKPOINT_FAILED", error: "forced checkpoint failure" };
      }
      const result = await inner.checkpoint(...args);
      if (result?.ok && result?.checkpointed) rotated = true;
      if (typeof onAfterCheckpoint === "function") onAfterCheckpoint(result);
      return result;
    },
  });
}

function wrapUpTurnOptions({ ids, events, tier1, runModelRound, extra = {} }) {
  return {
    model: "local:small",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "ollama", effectiveLimitTokens: 32_768, promptBudgetTokens: 32_768 },
    mode: "ask",
    modeFamily: "assist",
    projectId: ids.projectId,
    memorySessionId: ids.sessionId,
    tier1Context: tier1,
    userMessage: "Continue the investigation from the last finding.",
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    runModelRound,
    async executeToolCall() {
      return { ok: true, value: { summary: "check completed" } };
    },
    ...extra,
    projectId: ids.projectId,
    memorySessionId: ids.sessionId,
    tier1Context: extra.tier1Context || tier1,
  };
}

test("wrap-up block_complete rotates then resumes the same turn", async () => {
  assert.equal(CHECKPOINT_RATIO, 0.90);
  const ids = memoryIds(4401);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Continuing after the summarized conversation.", toolCalls: [], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
  const started = events.filter((event) => event.type === "context_checkpoint" && event.status === "started");
  const completed = events.filter((event) => event.type === "context_checkpoint" && event.status === "completed");
  assert.ok(started.some((event) => event.reason === "block_complete"));
  assert.ok(completed.some((event) => event.reason === "block_complete"));
});

test("a tool-free turn under 90% completes without a wrap-up checkpoint", async () => {
  const ids = memoryIds(4402);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createTier1ContextCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      return { ok: true, fullText: "XSS is cross-site scripting.", toolCalls: [], finishReason: "stop" };
    },
    extra: { userMessage: "What is XSS?" },
  }));

  assert.equal(modelCalls, 1);
  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.runState.status, "completed");
  assert.equal(events.some((event) => event.type === "context_checkpoint"), false);
});

test("wrap-up resume latches after one continue when pressure stays at 90%", async () => {
  const ids = memoryIds(4403);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ stayOverAfterRotate: true }),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("latch must not allow a third runModelRound");
      }
      return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
});

test("in-loop block_complete checkpoint failure is inconclusive", async () => {
  const ids = memoryIds(4404);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ failCheckpoint: true }),
    async runModelRound() {
      modelCalls += 1;
      return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.code, "MEMORY_CHECKPOINT_FAILED");
  assert.equal(result.runState.status, "inconclusive");
  assert.notEqual(result.runState.status, "completed");
  assert.equal(modelCalls, 1);
  assert.ok(Array.isArray(result.failureRecords));
  assert.equal(typeof result.executedTools, "boolean");
  assert.ok(Array.isArray(result.evidenceIds));
  assert.equal("lastUsage" in result, true);
  assert.equal("contextUsage" in result, true);
});

test("abort after wrap-up checkpoint does not resume the model", async () => {
  const ids = memoryIds(4405);
  const events = [];
  let modelCalls = 0;
  const abort = new AbortController();
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({
      onAfterCheckpoint() { abort.abort(); },
    }),
    async runModelRound() {
      modelCalls += 1;
      return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
    },
    extra: { signal: abort.signal },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.runState.status, "stopped");
  assert.equal(modelCalls, 1);
});

test("tool-call batches are not checkpointed until the batch seals", async () => {
  const ids = memoryIds(4406);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          ok: true,
          fullText: "",
          toolCalls: [{ id: "call-pair", type: "function", function: { name: "exec_command", arguments: {} } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "The check finished.", toolCalls: [], finishReason: "stop" };
    },
    extra: {
      mode: "agent",
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  const firstToolOpen = events.findIndex((event) => event.type === "tool_call" || event.type === "tool_start");
  const lastToolResult = events.findLastIndex((event) => event.type === "tool_result");
  assert.ok(firstToolOpen >= 0, "a tool_call or tool_start must be emitted");
  assert.ok(lastToolResult >= 0, "tool_result must be emitted");
  const between = events.slice(firstToolOpen, lastToolResult + 1);
  assert.equal(between.some((event) => event.type === "context_checkpoint"), false);
  const toolResultsCheckpoint = events.findIndex((event) => event.type === "context_checkpoint" && event.reason === "tool_results");
  assert.ok(toolResultsCheckpoint > lastToolResult, "reason tool_results must fire only after the batch seals");
  assert.equal(events.some((event) => event.type === "context_checkpoint" && event.reason === "tool_results" && events.indexOf(event) < lastToolResult), false);
});

test("before_model_call does not force a checkpoint when active conversation is empty", async () => {
  const ids = memoryIds(4407);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ stayOverAfterRotate: true }),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("empty-active resume must not loop");
      }
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Continuing after rotation.", toolCalls: [], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(events.some((event) => event.type === "context_checkpoint" && event.reason === "before_model_call"), false);
});

test("unlimited MAX_AGENT_ROUNDS still resumes wrap-up in the same for-loop", async () => {
  assert.equal(MAX_AGENT_ROUNDS, 0);
  const ids = memoryIds(4408);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Resumed in the same turn.", toolCalls: [], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
});

test("finite maxAgentRounds refunds the wrap-up round so resume is not post-loop", async () => {
  const ids = memoryIds(4409);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Resumed after the wrap-up checkpoint.", toolCalls: [], finishReason: "stop" };
    },
    extra: { maxAgentRounds: 1 },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
  assert.notEqual(result.runState.status, "inconclusive");
});

test("post-loop round-limit block_complete stays terminal", async () => {
  const ids = memoryIds(4410);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createTier1ContextCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      return {
        ok: true,
        fullText: "",
        toolCalls: [{ id: `call-limit-${modelCalls}`, type: "function", function: { name: "exec_command", arguments: { n: modelCalls } } }],
        finishReason: "tool_calls",
      };
    },
    extra: {
      mode: "agent",
      maxAgentRounds: 1,
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    },
  }));

  assert.equal(modelCalls, 1);
  assert.equal(result.runState.status, "inconclusive");
  assert.equal(result.ok, true);
  const blockComplete = events.filter((event) => event.type === "context_checkpoint" && event.reason === "block_complete");
  assert.equal(blockComplete.some((event) => event.status === "started" || event.status === "completed"), false);
});

test("model rounds emit stop only when finishReason is stop and there are no tool calls", async () => {
  const events = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "Check package.json",
    tools: [{ type: "function", function: { name: "exec_command", description: "run a command", parameters: {} } }],
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          ok: true,
          fullText: "Reading the file.",
          toolCalls: [{ id: "call-1", type: "function", function: { name: "exec_command", arguments: { executable: process.execPath, args: ["-e", "console.log(1)"] } } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "The start script is electron .", toolCalls: [], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: true, value: { stdout: "1", stderr: "", exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  const roundsEmitted = events.filter((event) => event.type === "model_round");
  assert.equal(roundsEmitted.length, 2);
  assert.equal(roundsEmitted[0].finishReason, "tool_calls");
  assert.equal(roundsEmitted[0].stop, false);
  assert.equal(roundsEmitted[1].finishReason, "stop");
  assert.equal(roundsEmitted[1].stop, true);
  assert.equal(result.finalText, "The start script is electron .");
});
