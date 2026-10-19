"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000009801";
const sessionId = "session_00000000-0000-4000-8000-000000009802";

test("a restart after checkpoint commit but before active-ledger replacement does not replay summarized turns", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-checkpoint-restart-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  let failActiveWrite = false;
  const faultingStore = {
    ...store,
    writeActive(...args) {
      if (failActiveWrite) {
        return { ok: false, code: "MEMORY_SENSITIVE_WRITE_FAILED", error: "simulated interruption" };
      }
      return store.writeActive(...args);
    },
  };
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: faultingStore });
  const ledger = [
    { role: "user", content: "Scan 10.0.0.5 for open ports" },
    { role: "assistant", content: "Port 22 is open." },
    { role: "user", content: "Check the TLS configuration" },
    { role: "assistant", content: "TLS 1.0 is enabled." },
  ];
  coordinator.setActiveConversation(projectId, sessionId, ledger);
  failActiveWrite = true;

  const checkpoint = await coordinator.checkpoint({
    project_id: projectId,
    session_id: sessionId,
    objective: "Assess 10.0.0.5",
    active_conversation: ledger.slice(2),
    active_after_checkpoint: ledger.slice(0, 2),
    allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(checkpoint.ok, true, checkpoint.code);
  assert.deepEqual(coordinator.state(projectId, sessionId).active, ledger.slice(0, 2), "the live process keeps the pinned block excluded from the summary");

  const restarted = createTier1ContextCoordinator({ sensitiveStore: store }).state(projectId, sessionId);
  assert.ok(restarted.summary, "the committed checkpoint survives restart");
  assert.deepEqual(restarted.active, ledger.slice(0, 2), "only the block excluded from the summary is restored as active context");
});

test("a committed transition recovers the active ledger when the active file is corrupt", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-checkpoint-corrupt-active-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const faultingStore = { ...store, writeActive: () => ({ ok: false, code: "MEMORY_SENSITIVE_WRITE_FAILED", error: "simulated interruption" }) };
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: faultingStore });
  const ledger = [
    { role: "user", content: "Scan 10.0.0.5" },
    { role: "assistant", content: "Port 22 is open." },
    { role: "user", content: "Check TLS" },
    { role: "assistant", content: "TLS 1.0 is enabled." },
  ];
  coordinator.setActiveConversation(projectId, sessionId, ledger);
  const checkpoint = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, objective: "Assess 10.0.0.5",
    active_conversation: ledger.slice(2), active_after_checkpoint: ledger.slice(0, 2), allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(checkpoint.ok, true, checkpoint.code);
  fs.writeFileSync(store.activeFile(projectId, sessionId), "corrupt active envelope");

  const restarted = createTier1ContextCoordinator({ sensitiveStore: store }).state(projectId, sessionId);
  assert.ok(restarted.summary);
  assert.deepEqual(restarted.active, ledger.slice(0, 2), "the committed transition is authoritative over the corrupt active file");
});

test("corrupt current checkpoint falls back to the previous checkpoint's matching active ledger", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-checkpoint-fallback-ledger-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
  const ledger = [
    { role: "user", content: "Scan 10.0.0.5" },
    { role: "assistant", content: "Port 22 is open." },
    { role: "user", content: "Check TLS" },
    { role: "assistant", content: "TLS 1.0 is enabled." },
  ];
  coordinator.setActiveConversation(projectId, sessionId, ledger);
  const first = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, objective: "First assessment",
    active_conversation: ledger.slice(2), active_after_checkpoint: ledger.slice(0, 2), allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(first.ok, true, first.code);
  const second = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, objective: "Second assessment",
    active_conversation: ledger.slice(0, 2), active_after_checkpoint: ledger.slice(2), allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(second.ok, true, second.code);
  fs.writeFileSync(store.checkpointFile(projectId, sessionId, "current"), "corrupt current checkpoint");

  const restarted = createTier1ContextCoordinator({ sensitiveStore: store }).state(projectId, sessionId);
  assert.equal(restarted.summary.checkpoint_id, first.checkpoint.checkpoint_id, "the previous summary is the recovered checkpoint");
  assert.deepEqual(restarted.active, ledger.slice(0, 2), "the recovered summary is paired with its original active ledger");
});

test("a failed later checkpoint keeps the recovery ledger for the last committed checkpoint", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-checkpoint-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let failSecondCheckpoint = false;
  const protector = {
    available: () => true,
    encrypt(value) {
      const parsed = JSON.parse(String(value));
      if (failSecondCheckpoint && parsed.objective === "Second objective") throw new Error("simulated checkpoint write failure");
      return Buffer.from(String(value), "utf8").toString("base64");
    },
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  let failActiveWrite = false;
  const faultingStore = {
    ...store,
    writeActive(...args) {
      if (failActiveWrite) return { ok: false, code: "MEMORY_SENSITIVE_WRITE_FAILED", error: "simulated interruption" };
      return store.writeActive(...args);
    },
  };
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: faultingStore });
  const ledger = [
    { role: "user", content: "Scan 10.0.0.5 for open ports" },
    { role: "assistant", content: "Port 22 is open." },
    { role: "user", content: "Check the TLS configuration" },
    { role: "assistant", content: "TLS 1.0 is enabled." },
  ];
  coordinator.setActiveConversation(projectId, sessionId, ledger);
  failActiveWrite = true;

  const first = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, objective: "First objective",
    active_conversation: ledger, active_after_checkpoint: ledger.slice(0, 2), allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(first.ok, true, first.code);
  const firstCheckpointId = first.checkpoint.checkpoint_id;

  failSecondCheckpoint = true;
  const second = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, objective: "Second objective",
    active_conversation: ledger.slice(2), active_after_checkpoint: ledger.slice(0, 2), allow_model: false,
    effective_context_limit: 1_000_000,
  });
  assert.equal(second.ok, true, second.code);
  assert.equal(second.stored.ok, false, "the later checkpoint failed to commit");

  const restarted = createTier1ContextCoordinator({ sensitiveStore: store }).state(projectId, sessionId);
  assert.equal(restarted.summary.checkpoint_id, firstCheckpointId, "the prior committed checkpoint remains current");
  assert.deepEqual(restarted.active, ledger.slice(0, 2), "the prior checkpoint's matching active ledger remains recoverable");
});
