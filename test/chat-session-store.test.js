"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSessionMemoryStore } = require("../src/app/storage/session-memory-store.js");

function fixture(t, protector = null) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-test-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  return {
    baseDir,
    store: createSessionMemoryStore({ fs, path, crypto, baseDir, protector }),
  };
}

test("canonical memory is lazy, per-project, and sequential", async (t) => {
  const { baseDir, store } = fixture(t);
  const workspace = path.join(baseDir, "project");
  assert.equal(store.load(workspace).exists, false);
  assert.equal((await store.begin(workspace, { userPrompt: "   " })).persisted, false);
  assert.equal(fs.existsSync(path.join(baseDir, "project-registry.json")), false);

  const first = await store.begin(workspace, { userPrompt: "first", userMessageId: "u-1" });
  const second = await store.begin(workspace, { sessionId: first.sessionId, userPrompt: "second", userMessageId: "u-2" });
  assert.equal(first.blockId, "block_1");
  assert.equal(second.blockId, "block_2");
  assert.equal(store.load(workspace).sessions[0].memorySessionId, first.sessionId);
});

test("events preserve questions, repeated tools, partial output, and transcript", async (t) => {
  const { store } = fixture(t);
  const workspace = path.join(os.tmpdir(), `xekute-events-${crypto.randomUUID()}`);
  const started = await store.begin(workspace, { userPrompt: "inspect" });
  await store.record(workspace, { sessionId: started.sessionId, blockId: started.blockId, type: "questions_presented", questions: [{ id: "q-1", prompt: "Host?", options: ["app", "api"] }] });
  await store.record(workspace, { sessionId: started.sessionId, blockId: started.blockId, type: "questions_answered", answers: [{ questionId: "q-1", selectedOptionId: "opt-1" }] });
  await store.record(workspace, { sessionId: started.sessionId, blockId: started.blockId, type: "tool_usage", toolNames: ["read_file", "read_file"] });
  await store.record(workspace, { sessionId: started.sessionId, blockId: started.blockId, type: "outcome", messageId: "a-1", text: "done", outcome: "completed", transcript: [{ role: "user", content: "inspect" }, { role: "assistant", content: "done" }] });
  const block = store.load(workspace).data[started.projectId][started.sessionId][started.blockId];
  assert.equal(block.user_prompt, "inspect");
  assert.equal(block.ai_prompt, "done");
  assert.deepEqual(block.tool_usage, ["read_file", "read_file"]);
  assert.equal(block.questions_id["q-1"].answer, "app");
  assert.equal(block.__meta.transcript.at(-1).content, "done");
});

test("archive, close, reopen, delete, encryption, and backup recovery work", async (t) => {
  const protector = { available: () => true, encrypt: (text) => Buffer.from(text).toString("base64"), decrypt: (text) => Buffer.from(text, "base64").toString() };
  const { store } = fixture(t, protector);
  const workspace = path.join(os.tmpdir(), `xekute-lifecycle-${crypto.randomUUID()}`);
  const started = await store.begin(workspace, { userPrompt: "keep" });
  const file = store.projectFile(started.projectId);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).encrypted, true);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /keep/);
  await store.close(workspace, started.sessionId);
  assert.equal(store.load(workspace).closedSessions.length, 1);
  await store.record(workspace, { type: "archive", sessionId: started.sessionId });
  assert.equal(store.load(workspace).archivedSessions.length, 1);
  await store.record(workspace, { type: "unarchive", sessionId: started.sessionId });
  await store.reopen(workspace, started.sessionId);
  fs.writeFileSync(file, "{broken", "utf8");
  assert.equal(store.load(workspace).recovered, true);
  assert.equal((await store.deleteSession(workspace, started.sessionId)).removed, true);
  assert.equal(store.load(workspace).sessions.length, 0);
});
