"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../src/app/storage/memory/v3-session-store.js");
const projectId = "proj_00000000-0000-4000-8000-000000008731";
const sessionId = "session_00000000-0000-4000-8000-000000008732";

function fixture(t, fsOverride = fs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-async-commit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release;
  const gate = { wait: false };
  const encode = text => Buffer.from(text).toString("base64");
  const protector = { available: () => true, encrypt: encode, decrypt: value => Buffer.from(value, "base64").toString(),
    encryptAsync: async text => { if (gate.wait) await new Promise(resolve => { release = resolve; }); if (gate.fail) throw new Error("Keyring unavailable"); return encode(text); } };
  const sensitive = createTier1SensitiveStore({ fs: fsOverride, baseDir: root, protector });
  const store = createV3SessionStore({ sensitiveStore: sensitive, projectIdentityStore: { resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }) } });
  const reload = () => createV3SessionStore({ sensitiveStore: createTier1SensitiveStore({ fs: fsOverride, baseDir: root, protector }), projectIdentityStore: { resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }) } });
  return { root, sensitive, store, gate, reload, release: () => release() };
}

test("async commits acknowledge durability only after encryption and atomic replacement", async t => {
  const f = fixture(t);
  f.gate.wait = true;
  let acknowledged = false;
  const pending = f.store.begin(f.root, { sessionId, userPrompt: "Do the task" }).then(result => { acknowledged = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false, "a pending encrypted write is not a durable receipt");
  assert.equal(fs.existsSync(f.sensitive.transcriptFile(projectId, sessionId)), false);
  f.release();
  const receipt = await pending;
  assert.equal(receipt.durable, true);
  assert.equal(f.reload().load(f.root).sessions[0].history[0].content, "Do the task");
  assert.equal(fs.readFileSync(f.sensitive.transcriptFile(projectId, sessionId), "utf8").includes("Do the task"), false);
});

test("async keyring failure preserves ephemeral operation and existing durable data", async t => {
  const f = fixture(t);
  f.gate.fail = true;
  const ephemeral = await f.store.begin(f.root, { sessionId, userPrompt: "Temporary task" });
  assert.equal(ephemeral.ok, true);
  assert.equal(ephemeral.durable, false);
  assert.equal(fs.existsSync(f.sensitive.transcriptFile(projectId, sessionId)), false);
  f.gate.fail = false;
  const durable = await f.store.record(f.root, { type: "snapshot", sessionId, blockId: ephemeral.blockId, displayHtml: "Saved view" });
  assert.equal(durable.durable, true);
  f.gate.fail = true;
  const failed = await f.store.record(f.root, { type: "snapshot", sessionId, blockId: ephemeral.blockId, displayHtml: "Unsaved view" });
  assert.equal(failed.ok, false);
  assert.equal(f.reload().load(f.root).sessions[0].messagesHtml, "Saved view");
});

test("async rename failure leaves the last encrypted primary intact", async t => {
  let reject = false;
  const promises = new Proxy(fs.promises, { get(target, name) { if (name === "rename") return async (...args) => { if (reject) throw new Error("rename rejected"); return target.rename(...args); }; return target[name]; } });
  const fakeFs = Object.create(fs); Object.defineProperty(fakeFs, "promises", { value: promises });
  const f = fixture(t, fakeFs);
  const opened = await f.store.begin(f.root, { sessionId, userPrompt: "Original task" });
  const file = f.sensitive.transcriptFile(projectId, sessionId), before = fs.readFileSync(file, "utf8");
  reject = true;
  const result = await f.store.record(f.root, { type: "snapshot", sessionId, blockId: opened.blockId, displayHtml: "New view" });
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.readdirSync(path.dirname(file)).some(file => file.endsWith(".tmp")), false);
});

test("close snapshots queue behind a pending commit and flush drains both", async t => {
  const f = fixture(t);
  const opened = await f.store.begin(f.root, { sessionId, userPrompt: "Task" });
  f.gate.wait = true;
  const first = f.store.record(f.root, { type: "snapshot", sessionId, blockId: opened.blockId, displayHtml: "First" });
  await new Promise(resolve => setImmediate(resolve));
  const close = f.store.recordSync(f.root, { type: "snapshot", sessionId, blockId: opened.blockId, displayHtml: "Final view" });
  assert.equal(close.queued, true);
  assert.equal(close.durable, false);
  f.gate.wait = false; f.release();
  assert.equal((await first).ok, true);
  await f.store.flush();
  assert.equal(f.store.load(f.root).sessions[0].messagesHtml, "Final view");
});
