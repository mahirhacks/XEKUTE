"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");
const { createToolRegistry, registerViewActiveTerminal } = require("../src/agent/tools/config/tool-registry.js");
const { createViewActiveTerminalTool } = require("../src/agent/tools/process/view-active-terminal.js");
const { createActiveTerminalCatalog, appendTerminalOutput } = require("../src/app/services/terminal/active-terminal-catalog.js");

function restricted(root = "G:/workspace") {
  return projectExecutionContext(createExecutionContext({
    invocationId: "view-term-test",
    toolName: "view_active_terminal",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root },
    sessionId: "chat-a",
  }));
}

test("view_active_terminal reports the focused tab and refuses missing catalog", async () => {
  const terminals = new Map();
  terminals.set("term-1", { ownerId: 3, agent: false, profileId: "powershell" });
  appendTerminalOutput(terminals.get("term-1"), "ready>");
  const catalog = createActiveTerminalCatalog({ terminals });
  catalog.setUserActiveTerminal({
    ownerId: 3,
    terminalId: "term-1",
    panelOpen: true,
    tabs: [{ id: "term-1", name: "powershell", agent: false }],
  });
  const tool = createViewActiveTerminalTool({ catalog });
  const result = await tool.execute({}, restricted(), { ownerId: 3, sessionId: "chat-a" });
  assert.equal(result.ok, true);
  assert.equal(result.value.user_active_terminal, "term-1");
  assert.equal(result.value.terminal.can_control, false);
  assert.match(result.value.terminal.output, /ready>/);

  const registry = createToolRegistry();
  registerViewActiveTerminal(registry, tool);
  assert.equal(registry.has("view_active_terminal"), true);

  const unbound = createViewActiveTerminalTool();
  const missing = await unbound.execute({}, restricted(), { ownerId: 3 });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "ACTIVE_TERMINAL_CATALOG_UNAVAILABLE");
});
