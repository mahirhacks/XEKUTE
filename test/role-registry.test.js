"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");

test("ask, agent, plan, and hypothesis are normalized as modes", () => {
  for (const mode of ["ask", "agent", "plan", "hypothesis"]) {
    assert.equal(ModeRegistry.normalizeProfile(mode).key, mode);
    assert.ok(Array.isArray(ModeRegistry.MODE_TOOL_GROUPS[mode]));
  }
  const ask = ModeRegistry.MODE_TOOL_GROUPS.ask;
  const agent = ModeRegistry.MODE_TOOL_GROUPS.agent;
  const hypothesis = ModeRegistry.MODE_TOOL_GROUPS.hypothesis;
  const plan = ModeRegistry.MODE_TOOL_GROUPS.plan;
  assert.equal(ask.length, 7);
  assert.equal(agent.length, 22);
  assert.equal(hypothesis.length, 8);
  assert.equal(plan.length, 8);
  assert.equal(ask.includes("manage_plan"), false);
  assert.equal(ask.includes("ingest_traffic"), false);
  assert.equal(ask.includes("exec_command"), false);
  assert.equal(hypothesis.includes("update_project_artifacts"), true);
  assert.equal(plan.includes("update_project_artifacts"), true);
  assert.equal(agent.includes("update_project_artifacts"), true);
});

test("authority labels are not part of mode normalization", () => {
  assert.equal(ModeRegistry.normalizeProfile({ key: "agent", authority: "full" }).key, "agent");
  assert.equal(ModeRegistry.normalizeProfile({ key: "plan", authority: "ask" }).key, "plan");
});
