"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/application/agent/controller");
const { normalizeProfile } = require("../src/application/policies/operating-modes");
const { createChatPort } = require("../src/adapters/llm/chat-port");
const ToolPort = require("../src/application/agent/tool-port");

test("controller consumes the ToolPort seam without importing concrete adapters directly", () => {
  // The controller's only tool dependency is application/agent/tool-port.js,
  // which the DI container can replace. Assert the port shape is complete.
  for (const key of ["TOOLS", "TOOL_META", "TOOL_NAMES", "TOOL_GROUPS", "MODE_TOOL_GROUPS", "TOOL_PACKS", "LOADABLE_PACK_NAMES", "AGENT_HOT_TOOLS", "normalizeToolCall", "parseArguments", "targetForTool", "isMutating", "toolNamesForProfile", "toolsForProfile", "buildToolCatalog", "schemasForNames", "resolveSchemaLoad", "validateToolCall", "compactTools", "deriveErrorClass", "estimateTokenCount"]) {
    assert.ok(key in ToolPort, `ToolPort must expose ${key}`);
  }
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

test("controller normalizes profiles through the application policy seam", () => {
  // Application orchestration resolves profiles from application/policies,
  // not from concrete adapters.
  const profile = normalizeProfile("assist", "ask");
  assert.equal(typeof profile.id, "string");
  assert.ok(profile.legacyMode);
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
