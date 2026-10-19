"use strict";

// When Tier 1 memory cannot be saved the chat keeps working in memory, says so
// through its save health, and recovers by itself once a save succeeds.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009931";
const sessionId = "session_00000000-0000-4000-8000-000000009932";
const LIMIT = 10_000_000;
const turns = (count) => Array.from({ length: count }, (_, turn) => [
  { role: "user", content: `Question ${turn}` },
  { role: "assistant", content: `Answer ${turn}` },
]).flat();

// A store whose writes fail while `failing` is set.
function flakyStore(error = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })) {
  const control = { failing: true, writes: 0 };
  const fail = () => { control.writes += 1; if (control.failing) throw error; return { ok: true, durable: true }; };
  return { control, store: { writeActive: fail, writeCheckpoint: fail, writeReleasedBlock: fail } };
}

function realStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-save-health-"));
  const protector = { available: () => true, encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"), decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8") };
  return { root, store: createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector }) };
}

test("a failed save marks the chat and the next successful save clears it", () => {
  const { control, store } = flakyStore();
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  tier1.setActiveConversation(projectId, sessionId, turns(2));
  assert.deepEqual(tier1.saveHealth(projectId, sessionId), { ok: false, reason: "disk_full", code: "ENOSPC" });
  assert.equal(tier1.state(projectId, sessionId).active.length, 4, "the ledger stays in memory");
  control.failing = false;
  tier1.appendConversation(projectId, sessionId, turns(1));
  assert.deepEqual(tier1.saveHealth(projectId, sessionId), { ok: true });
});

test("memory kept only in this process because secure storage is unavailable counts as unsaved", () => {
  const store = { writeActive: () => ({ ok: true, durable: false, ephemeral: true, warning: "Electron secure storage is unavailable" }) };
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  tier1.setActiveConversation(projectId, sessionId, turns(1));
  assert.equal(tier1.saveHealth(projectId, sessionId).reason, "secure_storage");
});

test("a summary whose save fails still applies in memory", async () => {
  const { store } = flakyStore(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  tier1.setActiveConversation(projectId, sessionId, turns(3));
  const result = await tier1.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess", allow_model: false, effective_context_limit: LIMIT });
  assert.equal(result.ok, true, result.code);
  assert.ok(tier1.state(projectId, sessionId).summary, "the summary is in memory");
  assert.equal(tier1.state(projectId, sessionId).active.length, 0);
  assert.equal(tier1.saveHealth(projectId, sessionId).reason, "no_access");
});

test("a block whose copy cannot be saved is not released", () => {
  const { store } = flakyStore();
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  tier1.setActiveConversation(projectId, sessionId, turns(3));
  const result = tier1.evictBlocks(projectId, sessionId, [{ index: 0 }]);
  assert.deepEqual(result.evicted, []);
  assert.equal(result.rejected[0].index, 0);
  assert.equal(tier1.activeBlocks(projectId, sessionId)[0].state, "active");
  assert.equal(tier1.saveHealth(projectId, sessionId).ok, false);
});

test("a deleted session folder is recreated by the next save, and a lost copy says so on recall", () => {
  const { root, store } = realStore();
  try {
    const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
    tier1.setActiveConversation(projectId, sessionId, turns(3));
    assert.equal(tier1.evictBlocks(projectId, sessionId, [{ index: 0 }]).evicted.length, 1);
    fs.rmSync(store.sessionDir(projectId, sessionId), { recursive: true, force: true });
    tier1.appendConversation(projectId, sessionId, turns(1));
    assert.deepEqual(tier1.saveHealth(projectId, sessionId), { ok: true });
    const reloaded = createTier1ContextCoordinator({ sensitiveStore: store });
    assert.equal(reloaded.state(projectId, sessionId).active.length, 7, "the whole ledger was written again");
    const recalled = reloaded.recallBlock(projectId, sessionId, 0);
    assert.equal(recalled.code, "MEMORY_BLOCK_COPY_LOST");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a run tells the renderer when memory stops and starts being saved", async () => {
  const { control, store } = flakyStore();
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  const run = async () => {
    const events = [];
    await runAgentTurn({
      workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
      projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Status?", chatHistory: [],
      sendEvent: (event) => events.push(event),
      async runModelRound() { return { ok: true, fullText: "Fine.", toolCalls: [endTurnCall()], finishReason: "stop" }; },
      async executeToolCall() { return { ok: true, value: {} }; },
    });
    return events.filter((event) => event.type === "memory_save_health");
  };
  const failing = await run();
  assert.equal(failing.length, 1, "one notice while saving fails");
  assert.deepEqual({ ok: failing[0].ok, reason: failing[0].reason }, { ok: false, reason: "disk_full" });
  control.failing = false;
  const recovered = await run();
  assert.equal(recovered.at(-1)?.ok, true, "the next run says memory is saved again");
});

test("an unsaved summary keeps the saved ledger it replaced, and the warning, until the summary saves", async () => {
  const saved = { active: null, checkpoint: null };
  const control = { checkpointFails: true };
  const store = {
    writeActive: (_p, _s, active) => { saved.active = active.map((message) => message.content); return { ok: true, durable: true }; },
    writeCheckpoint: (_p, _s, value) => { if (control.checkpointFails) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" }); saved.checkpoint = value; return { ok: true, durable: true }; },
  };
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: store });
  tier1.setActiveConversation(projectId, sessionId, turns(3));
  const before = [...saved.active];
  assert.equal((await tier1.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess", allow_model: false, effective_context_limit: LIMIT })).ok, true);
  tier1.setActiveConversation(projectId, sessionId, [{ role: "user", content: "Next question" }]);
  assert.deepEqual(saved.active, before, "the saved ledger still holds the turns the unsaved summary covers");
  assert.equal(tier1.saveHealth(projectId, sessionId).ok, false, "the warning stays while the summary is unsaved");
  control.checkpointFails = false;
  tier1.appendConversation(projectId, sessionId, [{ role: "assistant", content: "Next answer" }]);
  assert.ok(saved.checkpoint, "the summary is saved on the next try");
  assert.deepEqual(saved.active, ["Next question", "Next answer"], "then the shortened ledger follows");
  assert.deepEqual(tier1.saveHealth(projectId, sessionId), { ok: true });
});
