const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createChatSessionStore } = require("../src/app/services/chat-session-store");

test("chat memory metadata persists alongside the complete canonical transcript", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-chat-memory-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const store = createChatSessionStore({ fs, path, crypto, baseDir });
  store.save("scope", {
    activeSessionId: "chat-1",
    sessions: [{
      id: "chat-1",
      messages: [
        { id: "m-1", role: "user", content: "original requirement" },
        { id: "m-2", role: "assistant", content: "implemented" },
      ],
      memory: {
        version: 2,
        summary: "## Objective\n- original requirement",
        source: "model",
        status: "ready",
        archivedThroughMessageId: "m-1",
        archivedMessageCount: 1,
        summaryTokens: 8,
      },
      lastContextUsage: { provider: "openrouter", source: "openrouter", model: "acme/model", promptTokens: 100, effectiveLimitTokens: 32768 },
    }],
  });
  const restored = store.load("scope").sessions[0];
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.memory.archivedThroughMessageId, "m-1");
  assert.equal(restored.memory.archivedMessageCount, 1);
  assert.equal(restored.lastContextUsage.provider, "openrouter");
  assert.equal(restored.lastContextUsage.effectiveLimitTokens, 32768);
});

test("structured failure memory persists through canonical session memory", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-failure-memory-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const store = createChatSessionStore({ fs, path, crypto, baseDir });
  const FailureMemory = require("../src/application/agent/memory/failure-memory");
  const record = FailureMemory.buildFailureRecord({
    toolName: "read_file",
    signature: "read_file:{\"path\":\"missing.js\"}",
    errorClass: "not_found",
    count: 2,
  });
  store.save("scope", {
    activeSessionId: "chat-1",
    sessions: [{
      id: "chat-1",
      messages: [],
      memory: {
        version: 2,
        summary: "",
        status: "empty",
        failureRecords: [record],
      },
    }],
  });
  const restored = store.load("scope").sessions[0].memory.failureRecords[0];
  assert.equal(restored.toolName, "read_file");
  assert.equal(restored.signature, "read_file:{\"path\":\"missing.js\"}");
  assert.equal(restored.errorClass, "not_found");
});

test("failure memory expiry and signature scoping keep other tool signatures usable", () => {
  const FailureMemory = require("../src/application/agent/memory/failure-memory");
  const expired = FailureMemory.normalizeRecord({
    toolName: "read_file",
    signature: "read_file:{\"path\":\"old.js\"}",
    errorClass: "not_found",
    count: 2,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const active = FailureMemory.buildFailureRecord({
    toolName: "read_file",
    signature: "read_file:{\"path\":\"a.js\"}",
    errorClass: "not_found",
    count: 2,
  });
  const pruned = FailureMemory.pruneFailureRecords([expired, active]);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].signature, "read_file:{\"path\":\"a.js\"}");

  const failedToolCalls = new Map();
  const failedToolClasses = new Map();
  const failedErrorClassesGlobal = new Map();
  FailureMemory.applyFailureRecordsToRuntime(pruned, failedToolCalls, failedToolClasses, failedErrorClassesGlobal);
  assert.equal(failedToolClasses.has("read_file:{\"path\":\"a.js\"}"), true);
  assert.equal(failedToolClasses.has("read_file:{\"path\":\"b.js\"}"), false);
  assert.equal(failedErrorClassesGlobal.size, 0);
});
