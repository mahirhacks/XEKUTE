"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");

test("ask and agent are the only operating modes", () => {
  for (const mode of ["ask", "agent"]) {
    assert.equal(ModeRegistry.normalizeProfile(mode).key, mode);
    assert.ok(Array.isArray(ModeRegistry.MODE_TOOL_GROUPS[mode]));
  }
  const ask = ModeRegistry.MODE_TOOL_GROUPS.ask;
  const agent = ModeRegistry.MODE_TOOL_GROUPS.agent;
  assert.equal(ask.length, 5);
  assert.equal(agent.length, 12);
  assert.equal(ask.includes("manage_plan"), false);
  assert.equal(ask.includes("ingest_traffic"), false);
  assert.equal(ask.includes("exec_command"), false);
  assert.equal(agent.includes("update_project_artifacts"), false);
  assert.equal(ModeRegistry.normalizeProfile("plan").key, "ask");
  assert.equal(ModeRegistry.normalizeProfile("hypothesis").key, "ask");
  assert.equal(ModeRegistry.normalizeProfile("planner").key, "ask");
});

test("authority labels are not part of mode normalization", () => {
  assert.equal(ModeRegistry.normalizeProfile({ key: "agent", authority: "full" }).key, "agent");
  assert.equal(ModeRegistry.normalizeProfile({ key: "plan", authority: "ask" }).key, "ask");
});
