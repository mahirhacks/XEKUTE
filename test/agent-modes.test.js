"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");
const { evaluateToolScope } = require("../src/agent/authority/scope/scope-policy.js");

test("every mode exposes the canonical surface and does not depend on authority labels", () => {
  assert.deepEqual(ModeRegistry.MODE_TOOL_GROUPS, ToolPort.MODE_TOOL_GROUPS);
  for (const mode of ["ask", "hypothesis", "plan", "agent"]) {
    assert.equal(ModeRegistry.MODE_TOOL_GROUPS[mode].length, ToolPort.REGISTRY_TOOL_NAMES.length);
    assert.equal(ModeRegistry.MODE_TOOL_GROUPS[mode].includes("manage_plan"), true);
    assert.equal(ModeRegistry.MODE_TOOL_GROUPS[mode].includes("ingest_traffic"), true);
    assert.equal(ModeRegistry.MODE_TOOL_GROUPS[mode].includes("exec_command"), true);
  }
  assert.equal(ModeRegistry.normalizeProfile({ key: "agent", authority: "full" }).key, "agent");
});

test("scope decisions are independent of the UI authority label", () => {
  const args = { path: "notes.md" };
  const ask = evaluateToolScope({ workspace: process.cwd(), toolName: "read_file", args, projectProfile: { authority: "ask" } });
  const full = evaluateToolScope({ workspace: process.cwd(), toolName: "read_file", args, projectProfile: { authority: "full" } });
  assert.deepEqual(ask, full);
});

test("action memory keeps sensitive output intact", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { appendAgentAction } = require("../src/agent/memory/action-memory.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-actions-"));
  const result = appendAgentAction(root, { runId: "run-1", type: "tool_result", tool: "read_file", ok: true, output: "top-secret" });
  assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(root, ".xekute", "logs", "agent-actions.jsonl"), "utf8"), /top-secret/);
  fs.rmSync(root, { recursive: true, force: true });
});
