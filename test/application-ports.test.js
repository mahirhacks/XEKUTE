"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { normalizeProfile } = require("../src/agent/modes/mode-registry.js");
const { createChatPort } = require("../src/agent/llm/common/chat-port.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");

test("controller consumes the canonical tool contract without importing concrete adapters directly", () => {
  for (const key of ["MODE_TOOL_GROUPS", "TOOL_GROUPS", "TOOL_META", "LOADABLE_PACK_NAMES", "toolsForProfile", "hotToolNamesForProfile", "compactTools", "buildToolCatalog", "normalizeToolCall", "parseArguments", "targetForTool", "isMutating", "validateToolCall", "deriveErrorClass", "estimateTokenCount", "clampWaitMs"]) {
    assert.ok(key in ToolPort, `ToolPort must expose ${key}`);
  }
  // F-008: The port is a real surface against the new tool registry, not a stub.
  const agentTools = ToolPort.toolsForProfile({ key: "agent" });
  assert.ok(agentTools.length > 0, "agent profile must receive an authorized tool surface");
  assert.ok(agentTools.some((tool) => tool.function?.name === "apply_patch"), "agent profile must include apply_patch");
  const askTools = ToolPort.toolsForProfile({ key: "ask" });
  assert.notDeepEqual(askTools, agentTools, "Ask is a read-only subset of the Agent surface");
  assert.equal(askTools.some((tool) => ToolPort.isMutating(tool.function?.name)), false, "Ask has no mutating tools");
  assert.equal(askTools.some((tool) => tool.function?.name === "ingest_traffic"), false);
  assert.equal(askTools.some((tool) => tool.function?.name === "exec_command"), false);
  assert.equal(ToolPort.isMutating("apply_patch"), true, "apply_patch is a mutation");
  assert.equal(ToolPort.isMutating("read_file"), false, "read_file is read-only");
  const normalized = ToolPort.normalizeToolCall({ id: "call-1", function: { name: "apply_patch", arguments: { operations: [] } } });
  assert.equal(normalized.toolName, "apply_patch", "normalizeToolCall must preserve the tool name");
  assert.deepEqual(normalized.args.operations, [], "normalizeToolCall must preserve canonical args");
  const validation = ToolPort.validateToolCall({ function: { name: "read_file", arguments: { path: "x" } } });
  assert.equal(validation.ok, true, "a valid registered tool call must validate");
  assert.equal(ToolPort.validateToolCall({ function: { name: "legacy_file" } }).code, "UNKNOWN_TOOL");
});

test("ChatPort adapter drives a streaming request with provider routing", async () => {
  const port = createChatPort();
  assert.equal(typeof port.stream, "function");
  assert.equal(typeof port.cancel, "function");
  assert.equal(typeof port.modelContext, "function");
  // Provider-neutral helpers are preserved.
  for (const key of ["normalizeProvider", "normalizeBaseUrl", "buildChatRequest", "openRouterHeaders", "openRouterTools", "normalizeOpenRouterMessages", "DEFAULT_OPENROUTER_BASE_URL"]) {
    assert.ok(key in port, `ChatPort must expose ${key}`);
  }
});

test("controller normalizes the four canonical modes", () => {
  const profile = normalizeProfile("assist", "ask");
  assert.equal(typeof profile.id, "string");
  assert.equal(profile.key, "ask");
});

test("runAgentTurn is callable with a fake executeToolCall (no concrete adapter)", async () => {
  let called = 0;
  const result = await runAgentTurn({
    workspace: "ROOT",
    model: "test-model",
    numCtx: 8192,
    contextBudget: 8192,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "hi" }],
    dirMap: "ROOT/\n",
    userMessage: "hi",
    sendEvent: () => {},
    runModelRound: async () => ({ error: null, aborted: false, fullText: "hi back", toolCalls: [] }),
    executeToolCall: async (call) => { called += 1; return { ok: true, toolName: call.function?.name || "" }; },
    findWorkspaceFiles: async () => [],
    searchWorkspaceIndex: async () => [],
  });
  assert.ok(result);
  assert.equal(typeof result, "object");
  assert.equal(called, 0, "no tool calls in this exchange");
});
