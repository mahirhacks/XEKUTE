"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { rendererDefinitions } = require("./helpers/renderer-source.js");
const { validateIpcRequest } = require("../src/contracts/ipc/IpcContracts.js");

test("chat snapshots preserve nested delegation arguments without exceeding IPC depth", () => {
  const args = { agents: [{ contextPackage: { scope: { allowedFiles: { item: ["recon/inventory.json"] }, prohibited: { item: ["writes"] } } }, resources: { tools: { item: ["read_file", "search_workspace"] } } }] };
  const original = { role: "assistant", content: "", tool_calls: [{ id: "delegate-1", type: "function", function: { name: "delegate_agent", arguments: args } }] };
  const session = { memoryBlockHistoryStart: 0, history: [{ role: "user", content: "Inspect the bundle" }, original] };
  const scope = {};
  vm.runInNewContext(rendererDefinitions("activeChatHistoryTranscript"), scope);
  const raw = { transcript: session.history };
  assert.match(validateIpcRequest("chat-history:event", [raw]).message, /nesting/);
  const transcript = scope.activeChatHistoryTranscript(session);
  for (const channel of ["chat-history:event", "chat-history:update", "chat-history:save-before-close"]) {
    assert.equal(validateIpcRequest(channel, [{ transcript }]), null, channel);
  }
  const persisted = transcript[1].tool_calls[0].function.arguments;
  assert.equal(typeof persisted, "string");
  assert.deepEqual(JSON.parse(persisted), args);
  assert.strictEqual(original.tool_calls[0].function.arguments, args, "saving does not mutate live tool calls");
});

test("chat snapshots retain string arguments, tool results, and the current block boundary", () => {
  const scope = {};
  vm.runInNewContext(rendererDefinitions("activeChatHistoryTranscript"), scope);
  const history = [
    { role: "user", content: "Earlier task" },
    { role: "user", content: "Current task" },
    { role: "assistant", content: "", tool_calls: [{ id: "read-1", function: { name: "read_file", arguments: '{"path":"report.md"}' } }] },
    { role: "tool", tool_call_id: "read-1", content: "Saved report" },
  ];
  const result = scope.activeChatHistoryTranscript({ history, memoryBlockHistoryStart: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), history.slice(1));
});
