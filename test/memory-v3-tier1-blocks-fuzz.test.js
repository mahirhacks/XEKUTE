"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");

const projectId = "proj_00000000-0000-4000-8000-000000007001";
const sessionId = "session_00000000-0000-4000-8000-000000007002";
const LIMIT = 500_000;

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-blocks-fuzz-"));
  const protector = { available: () => true, encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"), decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8") };
  return { root, store: createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector }) };
}

function makeTurn(label, random) {
  const messages = [{ role: "user", content: `Request ${label} for 10.0.${label % 250}.${(label * 7) % 250}` }];
  const toolCount = Math.floor(random() * 4);
  for (let position = 0; position < toolCount; position += 1) {
    const id = `call-${label}-${position}`;
    messages.push({ role: "assistant", content: "", tool_calls: [{ id, function: { name: random() < 0.5 ? "exec_command" : "read_file", arguments: JSON.stringify({ path: `f${label}.txt` }) } }] });
    messages.push({ role: "tool", tool_call_id: id, tool_name: "exec_command", content: `output ${label}-${position} ${"x".repeat(Math.floor(random() * 200))}` });
  }
  messages.push({ role: "assistant", content: `Done ${label}` });
  return messages;
}

function assertInvariants(coordinator, ledger, step) {
  const blocks = coordinator.activeBlocks(projectId, sessionId);
  for (let position = 1; position < blocks.length; position += 1) {
    assert.ok(blocks[position].index > blocks[position - 1].index, `${step}: block indexes strictly increase`);
  }
  for (const block of blocks) {
    if (block.state === "evicted") {
      assert.equal(block.messages.length, 1, `${step}: a released block is exactly one tombstone`);
      continue;
    }
    const open = new Set();
    for (const message of block.messages) {
      if (message.role === "assistant") for (const call of message.tool_calls || []) open.add(call.id);
      if (message.role === "tool") assert.ok(open.delete(message.tool_call_id), `${step}: tool result ${message.tool_call_id} follows its call inside block ${block.index}`);
    }
    if (block !== blocks.at(-1)) assert.equal(open.size, 0, `${step}: block ${block.index} has no dangling tool calls`);
  }
  for (const [index, original] of ledger.originals) {
    const live = blocks.find((block) => block.index === index);
    if (live && live.state === "active") assert.deepEqual(live.messages.map((message) => message.content), original.map((message) => message.content), `${step}: block ${index} is unchanged while in context`);
  }
}

for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
  test(`randomized block operations keep indexes stable, pairs intact and released content exact (seed ${seed})`, async () => {
    const random = rng(seed);
    const { root, store } = makeStore();
    try {
      let coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
      const ledger = { originals: new Map(), nextLabel: 1, seenIndexes: new Set(), known: new Set() };
      const covered = { appended: 0, resent: 0, released: 0, rejected: 0, pinned: 0, restarted: 0, checkpointed: 0 };
      const send = (messages) => coordinator.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", active_conversation: messages, effective_context_limit: LIMIT });
      const current = () => coordinator.state(projectId, sessionId).active;
      const stripped = () => current().map((message) => { const { block_index, ...rest } = message; return JSON.parse(JSON.stringify(rest)); });
      const remember = () => {
        for (const block of coordinator.activeBlocks(projectId, sessionId)) {
          if (block.state === "active" && !ledger.originals.has(block.index)) ledger.originals.set(block.index, block.messages.map((message) => JSON.parse(JSON.stringify(message))));
        }
      };

      send(makeTurn(ledger.nextLabel++, random));
      remember();
      for (let step = 0; step < 60; step += 1) {
        const roll = step === 30 ? 0.99 : random();
        const label = `seed ${seed} step ${step}`;
        if (roll < 0.30) {
          coordinator.appendConversation(projectId, sessionId, makeTurn(ledger.nextLabel++, random));
          covered.appended += 1;
        } else if (roll < 0.45) {
          covered.resent += 1;
          send([...stripped(), ...makeTurn(ledger.nextLabel++, random)]);
        } else if (roll < 0.75) {
          remember();
          const blocks = coordinator.activeBlocks(projectId, sessionId);
          const picks = Array.from({ length: 1 + Math.floor(random() * 3) }, () => (random() < 0.15 ? 9999 : blocks[Math.floor(random() * Math.max(1, blocks.length))]?.index));
          const before = coordinator.activeBlocks(projectId, sessionId);
          const result = coordinator.evictBlocks(projectId, sessionId, picks);
          assert.equal(result.ok, true, label);
          covered.released += result.evicted.length;
          covered.rejected += result.rejected.length;
          for (const entry of result.evicted) {
            const original = ledger.originals.get(entry.index);
            assert.ok(original, `${label}: released block ${entry.index} was recorded`);
            assert.deepEqual(coordinator.recallBlock(projectId, sessionId, entry.index).messages.map((message) => message.content), original.map((message) => message.content), `${label}: recall returns the original messages`);
            assert.ok(entry.tokensAfter <= entry.tokensBefore + 400, `${label}: a tombstone is not much larger than what it replaced`);
          }
          assert.equal(result.evicted.some((entry) => entry.index === before.at(-1).index), false, `${label}: the newest block is never released`);
        } else if (roll < 0.85) {
          const blocks = coordinator.activeBlocks(projectId, sessionId).filter((block) => block.state === "active");
          covered.pinned += 1;
          if (blocks.length) coordinator.pinBlock(projectId, sessionId, blocks[Math.floor(random() * blocks.length)].index, random() < 0.7);
        } else if (roll < 0.95) {
          coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
          covered.restarted += 1;
        } else {
          covered.checkpointed += 1;
          remember();
          const checkpoint = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Review the hosts.", allow_model: false, effective_context_limit: LIMIT });
          assert.equal(checkpoint.ok, true, label);
          coordinator.appendConversation(projectId, sessionId, makeTurn(ledger.nextLabel++, random));
        }
        remember();
        const present = new Set(coordinator.activeBlocks(projectId, sessionId).map((block) => block.index));
        if (roll >= 0.95) ledger.known.clear();
        for (const index of ledger.known) assert.ok(present.has(index), `${label}: block ${index} kept its index (in context or released)`);
        for (const index of present) ledger.known.add(index);
        for (const block of coordinator.activeBlocks(projectId, sessionId)) {
          if (block.state === "active") ledger.seenIndexes.add(block.index);
        }
        assertInvariants(coordinator, ledger, label);
      }

      for (const [name, total] of Object.entries(covered)) assert.ok(total > 0, `seed ${seed}: the run exercised ${name}`);
      const indexes = coordinator.activeBlocks(projectId, sessionId).map((block) => block.index);
      assert.equal(new Set(indexes).size, indexes.length, `seed ${seed}: no duplicate indexes at the end`);
      for (const [index, original] of ledger.originals) {
        const recalled = coordinator.recallBlock(projectId, sessionId, index);
        if (recalled.ok) assert.deepEqual(recalled.messages.map((message) => message.content), original.map((message) => message.content), `seed ${seed}: block ${index} is recoverable after the run`);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
