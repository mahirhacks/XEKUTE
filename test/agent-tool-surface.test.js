"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Surface = require("../src/agent/tools/config/tool-surface.js");
const ModeSkills = require("../src/prompts/skills/mode-skills.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");

test("agent tool surface is always available and the mode skill names canonical tools", () => {
  assert.equal(Surface.toolsEnabled(), true);
  const askTools = Surface.providerTools("ask");
  const agentTools = Surface.providerTools("agent");
  assert.notDeepEqual(askTools, agentTools);
  assert.equal(agentTools.length, 22);
  assert.equal(agentTools.includes("update_project_artifacts"), true);
  assert.equal(agentTools.includes("manage_plan"), false);
  assert.equal(askTools.includes("ingest_traffic"), false);
  const skill = ModeSkills.render("agent");
  assert.match(skill, /exec_command/);
  assert.doesNotMatch(skill, /run_security_tool|start_process|load_tool_schemas/);
});

test("chat-leased MCP schemas remain visible only after mode filtering", () => {
  const dynamic = { type: "function", function: { name: "mcp__scout__host_search", parameters: { type: "object" } } };
  const read = { type: "function", function: { name: "read_file", parameters: { type: "object" } } };
  assert.deepEqual(ToolPort.toolsForProfile({ key: "ask" }, undefined, [read, dynamic]).map((tool) => tool.function.name), ["read_file", "mcp__scout__host_search"]);
});
