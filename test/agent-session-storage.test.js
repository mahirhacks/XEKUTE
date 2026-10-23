"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createV3SessionStore, DEFAULT_APP_PROJECT_ID } = require("../src/app/storage/memory/v3-session-store.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { atomicWriteText } = require("../src/app/storage/memory/memory-storage-utils.js");
const { receiveInput, createTask, acceptRoutes } = require("../src/agent/runtime/session-input.js");

const PROJECT = "proj_agent_storage";
const SESSION = "session_agent_storage";

function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-agent-session-storage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const mode = { available: true, fault: "", copies: 0, writes: 0, identityCalls: 0 };
  const key = crypto.randomBytes(32);
  const protector = {
    available: () => mode.available,
    encrypt(value) {
      if (mode.fault === "encrypt") throw new Error("Injected encryption failure");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    },
    decrypt(payload) {
      const bytes = Buffer.from(payload, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
  const fsImpl = {
    ...fs,
    writeFileSync(...args) {
      if (mode.fault === "write") throw Object.assign(new Error("Injected write failure"), { code: "EIO" });
      mode.writes += 1;
      return fs.writeFileSync(...args);
    },
    fsyncSync(...args) {
      if (mode.fault === "fsync") throw Object.assign(new Error("Injected fsync failure"), { code: "EIO" });
      return fs.fsyncSync(...args);
    },
    renameSync(...args) {
      if (mode.fault === "rename") throw Object.assign(new Error("Injected rename failure"), { code: "EPERM" });
      return fs.renameSync(...args);
    },
    copyFileSync(...args) { mode.copies += 1; return fs.copyFileSync(...args); },
  };
  const projectIdentityStore = {
    resolveV3Project() {
      mode.identityCalls += 1;
      return { ok: true, projectId: PROJECT, workspace, canonical: workspace };
    },
  };
  const open = (options = {}) => {
    const sensitive = createTier1SensitiveStore({ fs: fsImpl, path, crypto, baseDir: path.join(root, "app-protected"), protector });
    const store = createV3SessionStore({ sensitiveStore: sensitive, projectIdentityStore, ...options });
    return { store, sensitive };
  };
  return { root, workspace, mode, protector, fsImpl, projectIdentityStore, open, ...open() };
}

function receive(store, workspace, id = "message:1", text = "Original instruction") {
  return store.transactSession(workspace, SESSION, (document) => ({
    ok: true, value: receiveInput(document.run_control, { id, text }),
  }), { create: true });
}

test("intake is encrypted on disk, survives restart, and stays out of renderer history until delivery", async (t) => {
  const h = harness(t);
  const instruction = "Use Arial.\nKeep this exact token: Bearer private-agent-session-token";
  const receipt = await receive(h.store, h.workspace, "message:1", instruction);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.encrypted, true);
  assert.equal(receipt.durable, true);
  assert.equal(receipt.value.sequence, 1);
  const file = h.sensitive.transcriptFile(PROJECT, SESSION);
  const raw = fs.readFileSync(file, "utf8");
  assert.equal(JSON.parse(raw).encrypted, true);
  assert.equal(raw.includes(instruction), false);
  assert.equal(raw.includes("private-agent-session-token"), false);
  const restarted = h.open();
  const read = restarted.store.readControl(h.workspace, SESSION);
  assert.equal(read.exists, true);
  assert.equal(read.encrypted, true);
  assert.equal(read.durable, true);
  assert.equal(read.control.inputs[0].text, instruction);
  assert.deepEqual(restarted.store.load(h.workspace).sessions[0].history, []);
  assert.equal(restarted.store.load(h.workspace).sessions[0].run_control, undefined);
});

test("concurrent queued mutations each read the latest committed journal and write once", async (t) => {
  const h = harness(t);
  const receipts = await Promise.all(Array.from({ length: 24 }, (_, index) => receive(h.store, h.workspace, `message:${index + 1}`, `Instruction ${index + 1}`)));
  assert.equal(receipts.every((receipt) => receipt.ok && receipt.durable), true);
  assert.deepEqual(receipts.map((receipt) => receipt.value.sequence), Array.from({ length: 24 }, (_, index) => index + 1));
  const read = h.store.readControl(h.workspace, SESSION);
  assert.equal(read.control.arrival, 24);
  assert.equal(h.mode.writes, 24);
  assert.deepEqual(read.control.inputs.map((input) => input.text), Array.from({ length: 24 }, (_, index) => `Instruction ${index + 1}`));
});

test("renderer snapshots and recordSync cannot erase or replace canonical control state", async (t) => {
  const h = harness(t);
  const begun = await h.store.begin(h.workspace, { sessionId: SESSION, userPrompt: "Original request" });
  assert.equal((await receive(h.store, h.workspace)).ok, true);
  const queued = receive(h.store, h.workspace, "message:2", "New constraint");
  const synchronous = h.store.recordSync(h.workspace, {
    type: "snapshot", sessionId: SESSION, blockId: begun.blockId,
    transcript: [{ role: "assistant", content: "Snapshot display" }],
    displayHtml: "<div>display</div>", run_control: { version: 0 },
  });
  assert.equal(synchronous.ok, true);
  assert.equal((await queued).ok, true);
  const expected = h.store.readControl(h.workspace, SESSION).control;
  for (const type of ["session_meta", "snapshot", "transcript", "outcome", "assistant", "ai_output", "tool_usage", "close", "reopen", "archive", "unarchive"]) {
    const saved = await h.store.record(h.workspace, {
      type, sessionId: SESSION, blockId: begun.blockId, text: "Display output", toolNames: ["read_file"],
      sessionMeta: { title: "Updated title", run_control: { version: 0 } },
      run_control: { version: 0 },
    });
    assert.equal(saved.ok, true, type);
    assert.deepEqual(h.store.readControl(h.workspace, SESSION).control, expected, type);
  }
  assert.equal((await h.store.begin(h.workspace, { sessionId: SESSION, userPrompt: "Another block" })).ok, true);
  assert.deepEqual(h.store.readControl(h.workspace, SESSION).control, expected);
  assert.equal(h.open().store.load(h.workspace).sessions[0].messagesHtml, "<div>display</div>");
});

test("one transaction commits task completion and transcript, while unread arrivals reject finalization", async (t) => {
  const h = harness(t);
  await receive(h.store, h.workspace);
  const task = createTask({ taskId: "task:main", runId: "run:main", objective: "Original instruction" });
  assert.equal((await h.store.transactSession(h.workspace, SESSION, (document) => ({
    ok: true, value: acceptRoutes(document.run_control, {
      expectedRouted: 0, cancellationEpoch: 0, tasks: [task],
      routes: [{ messageId: "message:1", taskId: task.id, expectedRevision: 0 }],
    }),
  }))).ok, true);
  const finish = (document) => {
    if (document.run_control.arrival !== document.run_control.routed) return { ok: false, code: "INPUT_PENDING" };
    document.run_control.tasks[0].status = "completed";
    document.blocks.push({ block_id: "block_final", messages: [{ role: "assistant", content: "Final answer" }], outcome: "completed" });
    return { ok: true, value: "completed" };
  };
  await receive(h.store, h.workspace, "message:2", "One more correction");
  const before = fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8");
  assert.equal((await h.store.transactSession(h.workspace, SESSION, finish)).code, "INPUT_PENDING");
  assert.equal(fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8"), before);
  await h.store.transactSession(h.workspace, SESSION, (document) => ({
    ok: true, value: acceptRoutes(document.run_control, {
      expectedRouted: 1, cancellationEpoch: 0,
      routes: [{ messageId: "message:2", taskId: task.id, expectedRevision: 1 }],
    }),
  }));
  assert.equal((await h.store.transactSession(h.workspace, SESSION, finish)).ok, true);
  const reopened = h.open().store;
  assert.equal(reopened.readControl(h.workspace, SESSION).control.tasks[0].status, "completed");
  assert.equal(reopened.load(h.workspace).sessions[0].history.at(-1).content, "Final answer");
});

test("renderer snapshots preserve task-owned messages, tool evidence, outcome, and delivery metadata", async (t) => {
  const h = harness(t);
  const begun = await h.store.begin(h.workspace, { sessionId: SESSION, userPrompt: "Canonical request" });
  await receive(h.store, h.workspace);
  const task = createTask({ taskId: "task:owned", runId: "run:owned", blockId: begun.blockId });
  await h.store.transactSession(h.workspace, SESSION, (document) => {
    acceptRoutes(document.run_control, {
      expectedRouted: 0, cancellationEpoch: 0, tasks: [task],
      routes: [{ messageId: "message:1", taskId: task.id, expectedRevision: 0 }],
    });
    document.blocks[0].messages = [{ role: "assistant", content: "Canonical output", source_message_id: "message:1", task_id: task.id, task_revision: 1 }];
    document.blocks[0].tool_events = [{ tool_name: "read_file", executed: true }];
    document.blocks[0].outcome = "running";
    return { ok: true };
  });
  const canonical = h.sensitive.readTranscript(PROJECT, SESSION).value.blocks[0];
  for (const type of ["snapshot", "transcript", "outcome", "assistant", "ai_output", "tool_usage"]) {
    const result = h.store.recordSync(h.workspace, {
      type, sessionId: SESSION, blockId: begun.blockId,
      transcript: [{ role: "assistant", content: "Untrusted replacement" }],
      messages: [{ role: "user", content: "Another replacement" }],
      text: "Renderer append", outcome: "failed", toolEvents: [], toolNames: ["exec_command"],
      displayHtml: "<div>Updated display</div>", sessionMeta: { title: "Updated title" },
    });
    assert.equal(result.ok, true, type);
    assert.deepEqual(h.sensitive.readTranscript(PROJECT, SESSION).value.blocks[0], canonical, type);
  }
  const read = h.sensitive.readTranscript(PROJECT, SESSION).value;
  assert.equal(read.display_html, "<div>Updated display</div>");
  assert.equal(read.metadata.title, "Updated title");
  assert.equal(canonical.messages[0].source_message_id, "message:1");
  assert.equal(canonical.messages[0].task_id, task.id);
  assert.equal(canonical.messages[0].task_revision, 1);
  assert.equal((await h.store.transactSession(h.workspace, SESSION, (document) => {
    document.blocks[0].messages[0].content = "New canonical output";
    document.blocks[0].outcome = "completed";
    return { ok: true };
  })).ok, true);
  assert.equal(h.sensitive.readTranscript(PROJECT, SESSION).value.blocks[0].messages[0].content, "New canonical output");
});

test("unavailable secure storage refuses receipt before mutation without advancing ephemeral state", async (t) => {
  const h = harness(t);
  h.mode.available = false;
  let mutations = 0;
  const refused = await h.store.transactSession(h.workspace, SESSION, (document) => {
    mutations += 1;
    return { ok: true, value: receiveInput(document.run_control, { id: "message:1", text: "New request" }) };
  }, { create: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "MEMORY_SECURE_STORAGE_UNAVAILABLE");
  assert.equal(mutations, 0);
  assert.equal(h.store.readControl(h.workspace, SESSION).exists, false);
  assert.equal(fs.existsSync(h.sensitive.transcriptFile(PROJECT, SESSION)), false);
});

test("late keyring unavailability during mutation cannot advance an ephemeral journal", async (t) => {
  const h = harness(t);
  const refused = await h.store.transactSession(h.workspace, SESSION, (document) => {
    const value = receiveInput(document.run_control, { id: "message:1", text: "Original instruction" });
    h.mode.available = false;
    return { ok: true, value };
  }, { create: true });
  assert.equal(refused.ok, false);
  h.mode.available = true;
  assert.equal(h.store.readControl(h.workspace, SESSION).exists, false);
});

test("explicit nondurable compatibility writes report ephemeral state and strict transactions refuse it", async (t) => {
  const h = harness(t);
  h.mode.available = false;
  const ephemeral = await h.store.transactSession(h.workspace, SESSION, (document) => ({
    ok: true, value: receiveInput(document.run_control, { id: "message:1", text: "Ephemeral request" }),
  }), { create: true, requireDurable: false });
  assert.equal(ephemeral.ok, true);
  assert.equal(ephemeral.encrypted, false);
  assert.equal(ephemeral.durable, false);
  assert.equal(h.store.readControl(h.workspace, SESSION).durable, false);
  assert.equal((await receive(h.store, h.workspace, "message:2")).ok, false);
  assert.equal(h.store.readControl(h.workspace, SESSION).control.arrival, 1);
  assert.equal(h.open().store.readControl(h.workspace, SESSION).exists, false);
});

test("a missing write receipt cannot acknowledge a commit and retry recovers the existing message ID", async (t) => {
  const h = harness(t);
  const lostReceipt = createV3SessionStore({
    projectIdentityStore: h.projectIdentityStore,
    sensitiveStore: { ...h.sensitive, async writeTranscriptAsync(...args) { await h.sensitive.writeTranscriptAsync(...args); } },
  });
  const missing = await receive(lostReceipt, h.workspace);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "MEMORY_TRANSCRIPT_WRITE_FAILED");
  const retry = await receive(h.open().store, h.workspace);
  assert.equal(retry.ok, true);
  assert.equal(retry.value.duplicate, true);
  assert.equal(retry.value.sequence, 1);
  assert.equal(h.store.readControl(h.workspace, SESSION).control.arrival, 1);
});

test("async or invalid mutations cannot publish partially changed control state", async (t) => {
  const h = harness(t);
  await receive(h.store, h.workspace);
  const before = fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8");
  const asyncResult = await h.store.transactSession(h.workspace, SESSION, async (document) => {
    receiveInput(document.run_control, { id: "message:2", text: "Discarded instruction" });
    return { ok: true };
  });
  assert.equal(asyncResult.code, "SESSION_MUTATION_ASYNC");
  const invalid = await h.store.transactSession(h.workspace, SESSION, (document) => {
    document.run_control.arrival = 900;
    return { ok: true };
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "SESSION_CONTROL_INVALID");
  assert.equal(fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8"), before);
});

test("write:false returns only existing durable state and never publishes its mutated copy", async (t) => {
  const h = harness(t);
  const empty = await h.store.transactSession(h.workspace, SESSION, () => ({ ok: true, write: false }), { create: true });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "SESSION_DURABILITY_REQUIRED");
  await receive(h.store, h.workspace);
  const before = fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8");
  const duplicate = await h.store.transactSession(h.workspace, SESSION, (document) => {
    const value = receiveInput(document.run_control, { id: "message:1", text: "Original instruction" });
    document.run_control.cancellationEpoch = 99;
    return { ok: true, write: false, value };
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.value.duplicate, true);
  assert.equal(duplicate.durable, true);
  assert.equal(fs.readFileSync(h.sensitive.transcriptFile(PROJECT, SESSION), "utf8"), before);
});

for (const fault of ["encrypt", "write", "fsync", "rename"]) {
  test(`failed ${fault} preserves the last encrypted primary and never acknowledges the new input`, async (t) => {
    const h = harness(t);
    await receive(h.store, h.workspace);
    const file = h.sensitive.transcriptFile(PROJECT, SESSION);
    const before = fs.readFileSync(file, "utf8");
    h.mode.fault = fault;
    const refused = await receive(h.store, h.workspace, "message:2", "Uncommitted instruction");
    assert.equal(refused.ok, false);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(h.mode.copies, 0);
    assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false);
    h.mode.fault = "";
    assert.equal(h.open().store.readControl(h.workspace, SESSION).control.arrival, 1);
  });
}

test("readable writes retain their existing copy fallback and best-effort fsync contract", (t) => {
  const h = harness(t);
  const file = path.join(h.root, "readable.json");
  fs.writeFileSync(file, "old", "utf8");
  h.mode.fault = "rename";
  assert.equal(atomicWriteText({ fs: h.fsImpl, path, crypto }, file, "new", { backup: false }).ok, true);
  assert.equal(h.mode.copies, 1);
  assert.equal(fs.readFileSync(file, "utf8"), "new");
  h.mode.fault = "fsync";
  assert.equal(atomicWriteText({ fs: h.fsImpl, path, crypto }, file, "newer", { backup: false }).ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), "newer");
});

test("corrupt primary refuses read and create cannot reset a previously committed journal", async (t) => {
  const h = harness(t);
  await receive(h.store, h.workspace);
  const file = h.sensitive.transcriptFile(PROJECT, SESSION);
  fs.writeFileSync(file, "{corrupt encrypted primary", "utf8");
  const restarted = h.open().store;
  assert.equal(restarted.readControl(h.workspace, SESSION).ok, false);
  assert.equal((await receive(restarted, h.workspace, "message:2")).ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), "{corrupt encrypted primary");
});

test("encrypted control corruption and envelope hash mismatch fail closed", async (t) => {
  const h = harness(t);
  await receive(h.store, h.workspace);
  const file = h.sensitive.transcriptFile(PROJECT, SESSION);
  const document = h.sensitive.readTranscript(PROJECT, SESSION).value;
  document.run_control.arrival = 2;
  assert.equal(h.sensitive.writeFile(file, document, { requireDurable: true }).ok, true);
  assert.equal(h.store.readControl(h.workspace, SESSION).code, "SESSION_CONTROL_INVALID");
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  envelope.sha256 = "0".repeat(64);
  fs.writeFileSync(file, JSON.stringify(envelope), "utf8");
  assert.equal(h.store.readControl(h.workspace, SESSION).code, "MEMORY_SENSITIVE_HASH_MISMATCH");
});

test("projectless sessions use stable app storage and never write a user workspace identity", async (t) => {
  const h = harness(t);
  const receipt = await receive(h.store, "");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.projectId, DEFAULT_APP_PROJECT_ID);
  assert.equal(h.mode.identityCalls, 0);
  assert.deepEqual(fs.readdirSync(h.workspace), []);
  assert.equal(fs.existsSync(h.sensitive.transcriptFile(DEFAULT_APP_PROJECT_ID, SESSION)), true);
  assert.equal(h.open().store.readControl("", SESSION).control.arrival, 1);
  assert.equal(h.store.load("").sessions[0].id, SESSION);
  assert.equal(h.open({ appProjectId: "proj_other_app" }).store.readControl("", SESSION).exists, false);
});

test("mutation identity changes are rejected and reads return independent control copies", async (t) => {
  const h = harness(t);
  await receive(h.store, h.workspace);
  const refused = await h.store.transactSession(h.workspace, SESSION, (document) => {
    document.session_id = "session_other";
    return { ok: true };
  });
  assert.equal(refused.code, "MEMORY_TRANSCRIPT_INVALID");
  const read = h.store.readControl(h.workspace, SESSION);
  read.control.inputs[0].text = "Caller changed its copy";
  assert.equal(h.store.readControl(h.workspace, SESSION).control.inputs[0].text, "Original instruction");
});

test("composer receipt and child target metadata survive encrypted session reload", async (t) => {
  const h = harness(t); await receive(h.store, h.workspace);
  const metadata = { draftText: "Keep this draft", taskId: "task:child", parentMemorySessionId: "session_parent", sourceMessageIds: ["message:1"],
    liveInputs: [{ id: "message:1", text: "Use Arial", status: "received", taskId: "task:child" }], promptQueue: [{ id: "legacy:1", text: "Unacked original" }] };
  assert.equal((await h.store.record(h.workspace, { type: "session_meta", sessionId: SESSION, sessionMeta: metadata })).ok, true);
  const cold = h.open().store.load(h.workspace).sessions[0];
  for (const [key, value] of Object.entries(metadata)) assert.deepEqual(cold[key], value);
});
