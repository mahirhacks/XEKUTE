const test = require("node:test");
const assert = require("node:assert/strict");
const { isMemoryId } = require("../src/contracts/memory/memory-identity.js");

async function load() {
  return import("../src/ui/features/history/chat-memory-session.js");
}

test("a new chat session gets a session_ id on first send and keeps it after", async () => {
  const { ensureChatMemorySessionId, isChatMemorySessionId } = await load();
  const session = { id: "chat-123", memorySessionId: "" };
  const first = ensureChatMemorySessionId(session, () => "11111111-2222-3333-4444-555555555555");
  assert.equal(first, "session_11111111-2222-3333-4444-555555555555");
  assert.equal(session.memorySessionId, first);
  assert.equal(isChatMemorySessionId(first), true);
  assert.equal(isMemoryId(first, "session"), true);
  const second = ensureChatMemorySessionId(session, () => "should-not-run");
  assert.equal(second, first);
});

test("an existing memorySessionId is left alone even when it is a legacy chat id", async () => {
  const { ensureChatMemorySessionId } = await load();
  const session = { id: "chat-123", memorySessionId: "chat-123" };
  assert.equal(ensureChatMemorySessionId(session, () => "new-uuid"), "chat-123");
});
