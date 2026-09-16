"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendTerminalOutput,
  createActiveTerminalCatalog,
  denyUserTerminalControl,
  stripAnsi,
} = require("../src/app/services/terminal/active-terminal-catalog.js");

function catalogWith(records = []) {
  const terminals = new Map();
  for (const [id, record] of records) terminals.set(id, record);
  const catalog = createActiveTerminalCatalog({ terminals });
  return { terminals, catalog };
}

test("user_active_terminal updates on tab select and becomes null when the panel is collapsed", () => {
  const { catalog, terminals } = catalogWith([
    ["term-1", { ownerId: "w1", agent: false, profileId: "powershell" }],
    ["term-2", { ownerId: "w1", agent: false, profileId: "powershell" }],
  ]);
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "term-1",
    panelOpen: true,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "term-2", name: "powershell (2)", agent: false },
    ],
  });
  assert.equal(catalog.getUserActiveTerminal("w1").terminalId, "term-1");
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "term-2",
    panelOpen: true,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "term-2", name: "powershell (2)", agent: false },
    ],
  });
  assert.equal(catalog.getUserActiveTerminal("w1").terminalId, "term-2");
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "term-2",
    panelOpen: false,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "term-2", name: "powershell (2)", agent: false },
    ],
  });
  assert.equal(catalog.getUserActiveTerminal("w1").terminalId, null);
  assert.equal(terminals.size, 2);
});

test("view returns null terminal when nothing is focused and lists user plus same-chat agent tabs", async () => {
  const { catalog } = catalogWith([
    ["term-1", { ownerId: "w1", agent: false, profileId: "powershell", outputTail: "PS>" }],
    ["agent-1", { ownerId: "w1", agent: true, sessionId: "chat-a", processId: "process-1", command: "npm test", outputTail: "ok" }],
    ["agent-other", { ownerId: "w1", agent: true, sessionId: "chat-b", processId: "process-2", command: "secret" }],
  ]);
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: null,
    panelOpen: false,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "agent-1", name: "npm test", agent: true },
      { id: "agent-other", name: "secret", agent: true },
    ],
  });
  const result = await catalog.view({ ownerId: "w1", chatSessionId: "chat-a" });
  assert.equal(result.ok, true);
  assert.equal(result.value.user_active_terminal, null);
  assert.equal(result.value.terminal, null);
  const ids = result.value.sessions.map((item) => item.terminal_id).sort();
  assert.deepEqual(ids, ["agent-1", "term-1"]);
  const user = result.value.sessions.find((item) => item.terminal_id === "term-1");
  const agent = result.value.sessions.find((item) => item.terminal_id === "agent-1");
  assert.equal(user.can_read, true);
  assert.equal(user.can_control, false);
  assert.equal(user.origin, "user");
  assert.equal(agent.can_control, true);
  assert.equal(agent.origin, "agent");
});

test("view of the focused tab works for both user-made and agent-made sessions", async () => {
  const { catalog, terminals } = catalogWith([
    ["term-1", { ownerId: "w1", agent: false, profileId: "powershell" }],
    ["agent-1", { ownerId: "w1", agent: true, sessionId: "chat-a", processId: "process-1", command: "npm test" }],
  ]);
  appendTerminalOutput(terminals.get("term-1"), "hello from user\n");
  appendTerminalOutput(terminals.get("agent-1"), "hello from agent\n");
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "term-1",
    panelOpen: true,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "agent-1", name: "npm test", agent: true },
    ],
  });
  const userView = await catalog.view({ ownerId: "w1", chatSessionId: "chat-a" });
  assert.equal(userView.value.user_active_terminal, "term-1");
  assert.equal(userView.value.terminal.origin, "user");
  assert.equal(userView.value.terminal.can_control, false);
  assert.match(userView.value.terminal.output, /hello from user/);

  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "agent-1",
    panelOpen: true,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "agent-1", name: "npm test", agent: true },
    ],
  });
  const agentView = await catalog.view({ ownerId: "w1", chatSessionId: "chat-a" });
  assert.equal(agentView.value.user_active_terminal, "agent-1");
  assert.equal(agentView.value.terminal.origin, "agent");
  assert.equal(agentView.value.terminal.can_control, true);
  assert.match(agentView.value.terminal.output, /hello from agent/);
});

test("the operator's focused agent tab from another chat remains readable", async () => {
  const { catalog, terminals } = catalogWith([
    ["agent-other", { ownerId: "w1", agent: true, sessionId: "chat-b", processId: "process-2", command: "other" }],
  ]);
  appendTerminalOutput(terminals.get("agent-other"), "visible now");
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "agent-other",
    panelOpen: true,
    tabs: [{ id: "agent-other", name: "other", agent: true }],
  });
  const result = await catalog.view({ ownerId: "w1", chatSessionId: "chat-a" });
  assert.equal(result.ok, true);
  assert.equal(result.value.user_active_terminal, "agent-other");
  assert.match(result.value.terminal.output, /visible now/);
});

test("reading another chat's unfocused agent terminal is denied", async () => {
  const { catalog } = catalogWith([
    ["agent-other", { ownerId: "w1", agent: true, sessionId: "chat-b", processId: "process-2", command: "other" }],
    ["term-1", { ownerId: "w1", agent: false, profileId: "powershell" }],
  ]);
  catalog.setUserActiveTerminal({
    ownerId: "w1",
    terminalId: "term-1",
    panelOpen: true,
    tabs: [
      { id: "term-1", name: "powershell", agent: false },
      { id: "agent-other", name: "other", agent: true },
    ],
  });
  const result = await catalog.view({ ownerId: "w1", chatSessionId: "chat-a", terminalId: "agent-other" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TERMINAL_NOT_IN_SESSION");
});

test("denyUserTerminalControl blocks operator sessions and allows agent sessions", () => {
  assert.equal(denyUserTerminalControl({ agent: true }), null);
  assert.equal(denyUserTerminalControl({ agent: false }).error.code, "TERMINAL_CONTROL_DENIED");
  assert.equal(denyUserTerminalControl(null).error.code, "TERMINAL_NOT_FOUND");
});

test("appendTerminalOutput keeps a bounded tail and stripAnsi removes CSI sequences", () => {
  const record = { outputTail: "" };
  appendTerminalOutput(record, "\u001b[32mgreen\u001b[0m text", 8);
  assert.equal(record.outputTail.length <= 8, true);
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");
});
