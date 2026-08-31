"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createToolRegistry, REGISTRY_ERROR_CODES } = require("../src/agent/tools/config/tool-registry.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");
const ModeRegistry = require("../src/agent/modes/mode-registry.js");

test("the registry is explicit and rejects malformed or duplicate entries", () => {
  const registry = createToolRegistry();
  assert.equal(registry.size(), 0);
  assert.throws(() => registry.register(null), new RegExp(REGISTRY_ERROR_CODES.INVALID_ENTRY));
  registry.register({ name: "read_file", adapter: { execute() {} }, inputSchema: {} });
  assert.throws(() => registry.register({ name: "read_file", adapter: { execute() {} }, inputSchema: {} }), new RegExp(REGISTRY_ERROR_CODES.DUPLICATE_NAME));
});

test("mode registry is the only mode/capability mapping", () => {
  assert.deepEqual(ModeRegistry.MODE_TOOL_GROUPS, ToolPort.MODE_TOOL_GROUPS);
  assert.deepEqual(Object.keys(ModeRegistry.MODES).sort(), ["agent", "ask", "hypothesis", "plan"]);
  assert.equal(ModeRegistry.normalizeProfile("planner").key, "plan");
  assert.equal(ModeRegistry.normalizeProfile("ask").key, "ask");
});

test("canonical registry inventory has exactly 22 names in stable order", () => {
  const registry = createToolRegistry();
  for (const name of ToolPort.REGISTRY_TOOL_NAMES) registry.register({ name, adapter: { execute() {} }, inputSchema: {} });
  assert.deepEqual(registry.names(), ToolPort.REGISTRY_TOOL_NAMES);
  assert.equal(registry.size(), ToolPort.REGISTRY_TOOL_NAMES.length);
  assert.equal(registry.has("check_scope"), false);
});
