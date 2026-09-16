const test = require("node:test");
const assert = require("node:assert/strict");
const { sameTerminalOwner, findLiveTerminal } = require("../src/app/services/terminal/terminal-ownership.js");

test("terminal ownership compares window ids as strings so number/string mismatch is not a false reject", () => {
  assert.equal(sameTerminalOwner({ ownerId: 7 }, { id: 7 }), true);
  assert.equal(sameTerminalOwner({ ownerId: "7" }, { id: 7 }), true);
  assert.equal(sameTerminalOwner({ ownerId: 7 }, { id: "7" }), true);
  assert.equal(sameTerminalOwner({ ownerId: 8 }, { id: 7 }), false);
  assert.equal(sameTerminalOwner(null, { id: 7 }), false);
});

test("live terminal lookup finds the session by map key or durable process id", () => {
  const terminals = new Map([
    ["agent-abc-supervised-1", { processId: "proc-123", ownerId: 2 }],
  ]);
  assert.equal(findLiveTerminal(terminals, "agent-abc-supervised-1").record.processId, "proc-123");
  assert.equal(findLiveTerminal(terminals, "proc-123").terminalId, "agent-abc-supervised-1");
  assert.equal(findLiveTerminal(terminals, "missing").record, null);
});
