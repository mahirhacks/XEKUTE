"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../src/app/storage/memory/v3-session-store.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-history-load-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectId = "proj_history_load", decryptions = { count: 0 };
  const sensitiveStore = createTier1SensitiveStore({ baseDir: root, protector: { available: () => true,
    encrypt: text => Buffer.from(text).toString("base64"),
    decrypt: text => { decryptions.count++; return Buffer.from(text, "base64").toString(); },
  } });
  const store = createV3SessionStore({ sensitiveStore, projectIdentityStore: { resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }) } });
  const seed = (id, updatedAt) => sensitiveStore.writeFile(sensitiveStore.transcriptFile(projectId, id), {
    schema_version: 3, project_id: projectId, session_id: id, metadata: { title: id, status: "active", updated_at: updatedAt, created_at: updatedAt },
    blocks: [{ block_id: "block_history_load", user_prompt_id: "event_prompt", user_prompt: "Inspect the fixture",
      messages: [{ id: "event_prompt", role: "user", content: "Inspect the fixture" }], tool_events: [{ private_runtime_payload: "large private state".repeat(1000) }] }],
    display_html: "<div>Saved view</div>", ui_transcript: { version: 1, runs: [{ user: { message: "Inspect the fixture" }, events: [] }] },
  });
  return { root, projectId, sensitiveStore, store, seed, decryptions };
}

test("history load preserves stored recency and sends only one message history", t => {
  const f = fixture(t);
  f.seed("session_a_new", "2026-10-22T08:00:00Z");
  f.seed("session_z_old", "2026-10-21T08:00:00Z");
  const loaded = f.store.load(f.root);
  assert.equal(loaded.activeSessionId, "session_a_new");
  assert.equal(loaded.sessions.find(session => session.id === "session_a_new").updatedAt, "2026-10-22T08:00:00Z");
  assert.equal(loaded.sessions[0].history[0].content, "Inspect the fixture");
  assert.equal(loaded.sessions[0].transcript.runs[0].user.message, "Inspect the fixture");
  assert.equal(Object.hasOwn(loaded.sessions[0], "messages"), false, "the IPC response does not duplicate history");
  assert.equal(JSON.stringify(loaded).includes("private_runtime_payload"), false);
  loaded.sessions[0].history[0].content = "Changed UI copy";
  loaded.sessions[0].transcript.runs[0].user.message = "Changed UI view";
  const reloaded = f.store.load(f.root).sessions[0];
  assert.equal(reloaded.history[0].content, "Inspect the fixture");
  assert.equal(reloaded.transcript.runs[0].user.message, "Inspect the fixture");
});

test("browsing old chats does not retain every runtime document in the write cache", t => {
  const f = fixture(t);
  f.seed("session_history", "2026-10-22T08:00:00Z");
  f.store.load(f.root);
  assert.equal(f.decryptions.count, 1);
  f.sensitiveStore.readTranscript(f.projectId, "session_history");
  assert.equal(f.decryptions.count, 2, "the first runtime read owns and caches its own copy");
  f.sensitiveStore.readTranscript(f.projectId, "session_history");
  assert.equal(f.decryptions.count, 2, "normal runtime reads still reuse the cache");
});
