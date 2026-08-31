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

async function captureTools({ isFirstAgentTurn, userMessage, mode = "agent" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-preflight-"));
  let captured;
  let round = 0;
  try {
    await runAgentTurn({
      mode,
      workspace: root,
      userMessage,
      requireArtifactFinalization: mode !== "ask",
      isFirstAgentTurn,
      tools: catalog(),
      runModelRound: async ({ tools }) => {
        if (!captured) captured = tools.map((tool) => tool.function.name);
        if (!captured.browserEnum) {
          const browser = tools.find((tool) => tool.function.name === "browser_action");
          captured.browserEnum = browser?.function?.parameters?.properties?.action?.enum || null;
        }
        round += 1;
        if (mode !== "ask" && round === 1) return { fullText: "", toolCalls: [] };
        if (mode !== "ask") {
          return {
            fullText: "",
            toolCalls: [{ id: "finalizer", function: { name: "update_project_artifacts", arguments: { no_op_reason: "preflight test" } } }],
          };
        }
        return { fullText: "ask reply", toolCalls: [] };
      },
      executeToolCall: async () => ({ ok: true, staging_id: "txn-preflight" }),
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

test("first Agent turn strips probe tools unless the operator asked for an active probe", async () => {
  const stripped = await captureTools({ isFirstAgentTurn: true, userMessage: "Summarize the engagement notes" });
  for (const name of ["replay_request", "run_test_case", "web_research", "attack_graph", "exec_command", "delegate_agent"]) {
    assert.equal(stripped.includes(name), false, name);
  }
  assert.ok(stripped.includes("browser_action"));
  assert.deepEqual(stripped.browserEnum, ["list_pages", "close_page"]);
  const probe = await captureTools({ isFirstAgentTurn: true, userMessage: "Please scan the authorized target" });
  for (const name of ["replay_request", "run_test_case", "web_research", "attack_graph", "exec_command", "delegate_agent"]) {
    assert.equal(probe.includes(name), true, name);
  }
});

test("second Agent turn restores probe tools", async () => {
  const restored = await captureTools({ isFirstAgentTurn: false, userMessage: "Summarize the engagement notes" });
  for (const name of ["replay_request", "run_test_case", "web_research", "attack_graph", "exec_command", "delegate_agent"]) {
    assert.equal(restored.includes(name), true, name);
  }
  assert.ok(restored.browserEnum.includes("navigate"));
});

test("Ask catalog excludes update_project_artifacts", () => {
  assert.equal(ModeRegistry.MODE_TOOL_GROUPS.ask.includes("update_project_artifacts"), false);
  assert.deepEqual([...ModeRegistry.MODE_TOOL_GROUPS.ask], [
    "ask_questions", "read_file", "search_workspace", "inspect_environment", "query_assessment", "expand_evidence", "query_knowledge",
  ]);
});
