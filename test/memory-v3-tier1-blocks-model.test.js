"use strict";

// Model-based fuzz of the block ledger. A plain reference model records what
// every block index was issued for, which indexes were released and which are
// pinned; after every random operation the coordinator must agree with it.
// Unlike the smaller fuzz next to it, runs cross ACTIVE_MAX, fork sessions,
// restart from the encrypted store and checkpoint between releases.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createTier1ContextCoordinator, ACTIVE_MAX } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { describeBlocks } = require("../src/agent/tools/process/context-blocks.js");

const projectId = "proj_00000000-0000-4000-8000-000000007101";
const LIMIT = 50_000_000;
const sessionIds = Array.from({ length: 6 }, (_, i) => `session_00000000-0000-4000-8000-00000000710${i}`);

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-blocks-model-"));
  const protector = { available: () => true, encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"), decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8") };
  return { root, store: createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector }) };
}

function makeTurn(label, random, { huge = false, open = false } = {}) {
  const messages = [{ role: "user", content: `Request ${label}`, source_message_id: `msg_${label}` }];
  const pairs = huge ? 600 + Math.floor(random() * 700) : Math.floor(random() * 5);
  for (let i = 0; i < pairs; i += 1) {
    const id = `call-${label}-${i}`;
    messages.push({ role: "assistant", content: "", tool_calls: [{ id, function: { name: "exec_command", arguments: JSON.stringify({ command: `probe ${label} ${i}` }) } }] });
    messages.push({ role: "tool", tool_call_id: id, tool_name: "exec_command", content: `out ${label}-${i}` });
  }
  if (open) messages.push({ role: "assistant", content: "", tool_calls: [{ id: `call-${label}-open`, function: { name: "exec_command", arguments: "{}" } }] });
  else messages.push({ role: "assistant", content: `Done ${label}` });
  return messages;
}

const totals = {};
const contents = (messages) => messages.map((message) => JSON.stringify([message.role, message.content, message.tool_call_id || ""]));

for (const seed of [3, 7, 11, 19, 23, 42, 101, 2024]) {
  test(`the block ledger agrees with a reference model through trims, forks, restarts and checkpoints (seed ${seed})`, async () => {
    const random = rng(seed);
    const { root, store } = makeStore();
    try {
      let coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
      // Per session: index -> the full original messages of the block it named.
      const model = new Map(sessionIds.map((id) => [id, { issued: new Map(), released: new Set(), pinned: new Set() }]));
      let session = sessionIds[0];
      let forks = 1;
      let label = 1;
      const covered = { append: 0, huge: 0, resend: 0, release: 0, recall: 0, pin: 0, restart: 0, checkpoint: 0, fork: 0, trimmed: 0 };
      const blocks = () => coordinator.activeBlocks(projectId, session);
      const ledger = () => coordinator.state(projectId, session).active;
      const learn = () => {
        const state = model.get(session);
        for (const block of blocks()) {
          if (block.state !== "active") continue;
          const known = state.issued.get(block.index);
          // The first message of a block names the block; a trimmed head keeps
          // the original's index, so the original must end with what survives.
          if (!known) state.issued.set(block.index, block.messages.map((message) => ({ ...message })));
        }
      };
      const check = (step) => {
        const state = model.get(session);
        const list = blocks();
        const at = `seed ${seed} step ${step} ${session.slice(-2)}`;
        const indexes = list.map((block) => block.index);
        assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, `${at}: indexes ascend`);
        assert.equal(new Set(indexes).size, indexes.length, `${at}: no duplicate index`);
        for (const block of list) {
          const original = state.issued.get(block.index);
          if (block.state === "evicted") {
            assert.equal(block.messages.length, 1, `${at}: a released block is one tombstone`);
            assert.ok(state.released.has(block.index), `${at}: block ${block.index} shows released only if it was`);
            continue;
          }
          assert.ok(original, `${at}: block ${block.index} was issued`);
          const now = contents(block.messages);
          const was = contents(original);
          const grown = now.length >= was.length && was.every((entry, i) => entry === now[i]);
          const trimmed = block === list[0] && now.length <= was.length && now.every((entry, i) => entry === was[was.length - now.length + i]);
          assert.ok(grown || trimmed, `${at}: block ${block.index} still holds the messages it was issued for`);
          if (grown && now.length > was.length) state.issued.set(block.index, block.messages.map((message) => ({ ...message })));
          assert.equal(block.pinned, state.pinned.has(block.index), `${at}: pin state of block ${block.index}`);
        }
        for (const index of state.released) {
          const recalled = coordinator.recallBlock(projectId, session, index);
          assert.equal(recalled.ok, true, `${at}: released block ${index} stays recallable (${recalled.code})`);
          assert.deepEqual(contents(recalled.messages), contents(state.issued.get(index)).slice(-recalled.messages.length), `${at}: recall of ${index} returns what was released`);
        }
        assert.ok(ledger().length <= ACTIVE_MAX, `${at}: the ledger stays within ACTIVE_MAX`);
        const rows = describeBlocks(list, Math.max(0, list.length - 1));
        assert.deepEqual(rows.map((row) => row.index), indexes.slice(-rows.length), `${at}: the UI rows name the same blocks`);
        for (const row of rows) assert.equal(row.pinned, state.pinned.has(row.index) && row.state !== "released", `${at}: UI pin of ${row.index}`);
      };

      coordinator.appendConversation(projectId, session, makeTurn(label++, random));
      learn();
      for (let step = 0; step < 90; step += 1) {
        const roll = random();
        const state = model.get(session);
        if (roll < 0.25) {
          const huge = random() < 0.12;
          const before = ledger().length;
          coordinator.appendConversation(projectId, session, makeTurn(label++, random, { huge, open: random() < 0.1 }));
          covered.append += 1;
          if (huge) covered.huge += 1;
          if (before + 1 > ACTIVE_MAX || ledger().length === ACTIVE_MAX) covered.trimmed += 1;
        } else if (roll < 0.35) {
          // The controller re-sends its own copies, sometimes without the stamps.
          const strip = random() < 0.5;
          const copy = ledger().map((message) => {
            const { block_index: index, ...rest } = message;
            return strip && message.block_tombstone !== true ? rest : { ...message, block_index: index };
          });
          coordinator.setActiveConversation(projectId, session, [...copy, ...makeTurn(label++, random)]);
          covered.resend += 1;
        } else if (roll < 0.55) {
          const list = blocks();
          const picks = Array.from({ length: 1 + Math.floor(random() * 3) }, () => list[Math.floor(random() * list.length)]?.index);
          const result = coordinator.evictBlocks(projectId, session, picks);
          assert.equal(result.ok, true);
          for (const entry of result.evicted) {
            assert.equal(state.pinned.has(entry.index), false, `seed ${seed} step ${step}: a pinned block is never released`);
            assert.notEqual(entry.index, list.at(-1).index, `seed ${seed} step ${step}: the newest block is never released`);
            state.released.add(entry.index);
            covered.release += 1;
          }
          for (const rejected of result.rejected) {
            if (state.pinned.has(rejected.index)) assert.equal(rejected.code, "BLOCK_PINNED");
          }
        } else if (roll < 0.62) {
          const candidates = [...state.released];
          if (candidates.length) {
            coordinator.recallBlock(projectId, session, candidates[Math.floor(random() * candidates.length)]);
            covered.recall += 1;
          }
        } else if (roll < 0.72) {
          const live = blocks().filter((block) => block.state === "active");
          const block = live[Math.floor(random() * live.length)];
          if (block) {
            const pin = random() < 0.7;
            const result = coordinator.pinBlock(projectId, session, block.index, pin);
            assert.equal(result.ok, true);
            if (pin) state.pinned.add(block.index); else state.pinned.delete(block.index);
            covered.pin += 1;
          }
        } else if (roll < 0.80) {
          const before = JSON.stringify(blocks().map((block) => [block.index, block.state, block.pinned, contents(block.messages)]));
          coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
          assert.equal(JSON.stringify(blocks().map((block) => [block.index, block.state, block.pinned, contents(block.messages)])), before, `seed ${seed} step ${step}: a restart restores the same blocks and pins`);
          covered.restart += 1;
        } else if (roll < 0.90) {
          const result = await coordinator.checkpoint({ project_id: projectId, session_id: session, objective: "Review the hosts.", allow_model: false, effective_context_limit: LIMIT });
          assert.equal(result.ok, true, result.code);
          state.pinned.clear();
          coordinator.appendConversation(projectId, session, makeTurn(label++, random));
          covered.checkpoint += 1;
        } else if (forks < sessionIds.length) {
          const target = sessionIds[forks++];
          assert.equal(coordinator.cloneSession(projectId, session, target).ok, true);
          const copy = model.get(target);
          for (const [index, messages] of state.issued) copy.issued.set(index, messages);
          for (const index of state.released) copy.released.add(index);
          for (const index of state.pinned) copy.pinned.add(index);
          session = target;
          covered.fork += 1;
        }
        // A trim drops whole blocks off the front, and their pins with them.
        const present = new Set(blocks().map((block) => block.index));
        for (const index of [...model.get(session).pinned]) if (!present.has(index)) model.get(session).pinned.delete(index);
        learn();
        check(step);
      }
      for (const [name, total] of Object.entries(covered)) {
        if (name !== "fork" && name !== "trimmed" && name !== "huge") assert.ok(total > 0, `seed ${seed}: exercised ${name}`);
      }
      for (const [name, total] of Object.entries(covered)) totals[name] = (totals[name] || 0) + total;
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("the seeds together cross ACTIVE_MAX, trim a block and fork", () => {
  // Guards the fuzz itself: without these the cap and fork paths go untested.
  assert.ok(totals.huge > 3, JSON.stringify(totals));
  assert.ok(totals.trimmed > 3, JSON.stringify(totals));
  assert.ok(totals.fork > 3, JSON.stringify(totals));
});
