"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");
const { BROWSER_ACTION_INPUT_SCHEMA } = require("../src/agent/tools/assessment/browser-action.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");
const RequestIntentRules = require("../src/prompts/rules/request-intent-rules.js");

function catalog() {
  return ToolPort.REGISTRY_TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description: name,
      parameters: name === "browser_action" ? BROWSER_ACTION_INPUT_SCHEMA : { type: "object", properties: {} },
    },
  }));
}

async function captureTools({ userMessage, mode = "agent" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-preflight-"));
  let captured;
  try {
    await runAgentTurn({
      mode,
      workspace: root,
      userMessage,
      tools: catalog(),
      runModelRound: async ({ tools }) => {
        if (!captured) captured = tools.map((tool) => tool.function.name);
        if (!captured.browserEnum) {
          const browser = tools.find((tool) => tool.function.name === "browser_action");
          captured.browserEnum = browser?.function?.parameters?.properties?.action?.enum || null;
        }
        return { fullText: mode === "ask" ? "ask reply" : "done", toolCalls: [] };
      },
      executeToolCall: async () => ({ ok: true }),
    });
    return captured;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("isActiveProbeRequest matches scan/probe language and tool names", () => {
  assert.equal(RequestIntentRules.isActiveProbeRequest("Please scan the login host"), true);
  assert.equal(RequestIntentRules.isActiveProbeRequest("Summarize the engagement notes"), false);
  assert.equal(RequestIntentRules.isActiveProbeRequest("Use exec_command if needed"), true);
});

test("Agent turns expose probe tools without a first-turn strip", async () => {
  const tools = await captureTools({ userMessage: "Summarize the engagement notes" });
  for (const name of ["replay_request", "web_research", "exec_command", "delegate_agent"]) {
    assert.equal(tools.includes(name), true, name);
  }
  assert.ok(tools.includes("browser_action"));
  assert.ok(tools.browserEnum.includes("navigate"));
});

test("Ask catalog is the local read surface", () => {
  assert.deepEqual([...ModeRegistry.MODE_TOOL_GROUPS.ask], [
    "ask_questions", "read_file", "search_workspace",
  ]);
  assert.equal(ModeRegistry.MODE_TOOL_GROUPS.ask.includes("exec_command"), false);
  assert.equal(ModeRegistry.MODE_TOOL_GROUPS.ask.includes("query_knowledge"), false);
  assert.equal(ModeRegistry.MODE_TOOL_GROUPS.ask.includes("update_project_artifacts"), false);
});
