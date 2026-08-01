const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createChatSessionStore } = require("../src/app/services/chat-session-store");

test("chat sessions persist independently per workspace until explicitly removed", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-chats-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const store = createChatSessionStore({ fs, path, crypto, baseDir });

  assert.equal(store.load("assessment-a").exists, false);
  store.save("assessment-a", {
    activeSessionId: "chat-1",
    sessions: [{ id: "chat-1", title: "JWT review", history: [{ role: "user", content: "decode this" }] }],
  });
  store.save("assessment-b", { activeSessionId: "", sessions: [] });

  const restored = store.load("assessment-a");
  assert.equal(restored.exists, true);
  assert.equal(restored.version, 2);
  assert.equal(restored.activeSessionId, "chat-1");
  assert.equal(restored.sessions[0].messages[0].content, "decode this");
  assert.equal(restored.sessions[0].messagesHtml, undefined);
  assert.deepEqual(store.load("assessment-b").sessions, []);
  assert.notEqual(store.sessionFile("assessment-a"), store.sessionFile("assessment-b"));
});

test("chat v2 persistence encrypts canonical messages and recovers its last backup", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-chats-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const protector = {
    available: () => true,
    encrypt: (text) => Buffer.from(text, "utf8").toString("base64"),
    decrypt: (payload) => Buffer.from(payload, "base64").toString("utf8"),
  };
  const store = createChatSessionStore({ fs, path, crypto, baseDir, protector });
  const state = {
    activeSessionId: "chat-secure",
    sessions: [{ id: "chat-secure", title: "Secrets", history: [{ role: "user", content: "private-token" }], messagesHtml: "<b>must not persist</b>", lastContextUsage: { source: "ollama", promptTokens: 321, contextWindow: 4096, sections: [{ key: "system", label: "System", color: "#a7a7ab", tokens: 200 }] } }],
  };
  store.save("assessment-secure", state);
  store.save("assessment-secure", state);
  const file = store.sessionFile("assessment-secure");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(onDisk, /private-token|must not persist/);
  assert.equal(JSON.parse(onDisk).encrypted, true);

  fs.writeFileSync(file, "{damaged", "utf8");
  const recovered = store.load("assessment-secure");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.sessions[0].messages[0].content, "private-token");
  assert.equal(recovered.sessions[0].lastContextUsage.promptTokens, 321);
});

test("a damaged chat store fails open without blocking the application", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-chats-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const store = createChatSessionStore({ fs, path, crypto, baseDir });
  const file = store.sessionFile("assessment-a");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{broken", "utf8");
  const result = store.load("assessment-a");
  assert.deepEqual(result.sessions, []);
  assert.match(result.warning, /could not be read/i);
});
