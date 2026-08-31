"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");
const { evaluateToolScope } = require("../src/agent/authority/scope/scope-policy.js");

test("every mode exposes the canonical surface and does not depend on authority labels", () => {
  assert.deepEqual(ModeRegistry.MODE_TOOL_GROUPS, ToolPort.MODE_TOOL_GROUPS);
  const ask = ModeRegistry.MODE_TOOL_GROUPS.ask;
  const agent = ModeRegistry.MODE_TOOL_GROUPS.agent;
  const hypothesis = ModeRegistry.MODE_TOOL_GROUPS.hypothesis;
  const plan = ModeRegistry.MODE_TOOL_GROUPS.plan;
  assert.equal(ask.length, 7);
  assert.equal(agent.length, 22);
  assert.equal(hypothesis.length, 8);
  assert.equal(plan.length, 8);
  assert.deepEqual(ask, ["ask_questions", "read_file", "search_workspace", "inspect_environment", "query_assessment", "expand_evidence", "query_knowledge"]);
  assert.equal(ask.includes("ingest_traffic"), false);
  assert.equal(ask.includes("exec_command"), false);
  assert.equal(hypothesis.includes("update_project_artifacts"), true);
  assert.equal(plan.includes("update_project_artifacts"), true);
  assert.equal(agent.includes("update_project_artifacts"), true);
  assert.equal(ModeRegistry.normalizeProfile({ key: "agent", authority: "full" }).key, "agent");
});

test("scope decisions are independent of the UI authority label", () => {
  const args = { path: "notes.md" };
  const ask = evaluateToolScope({ workspace: process.cwd(), toolName: "read_file", args, projectProfile: { authority: "ask" } });
  const full = evaluateToolScope({ workspace: process.cwd(), toolName: "read_file", args, projectProfile: { authority: "full" } });
  assert.deepEqual(ask, full);
});
