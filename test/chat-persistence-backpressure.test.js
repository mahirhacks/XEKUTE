"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("a slow view save keeps only the latest pending snapshot per chat", async () => {
  const timers = [], writes = [];
  const session = { id: "chat", value: 0 };
  let release;
  const scope = { appState: { activeChatPersistenceScope: "project" }, chatPersistenceTimers: new Map(), chatPersistenceInFlight: new Map(), pendingChatSnapshots: new Map(),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    persistChatHistorySnapshot: (_scope, current) => { writes.push(current.value); return new Promise(resolve => { release = resolve; }); },
  };
  vm.runInNewContext(rendererDefinitions("schedulePersistChatSessions"), scope);
  scope.schedulePersistChatSessions(session); timers.shift()();
  for (let index = 1; index <= 100; index++) { session.value = index; scope.schedulePersistChatSessions(session); }
  assert.deepEqual(writes, [0]);
  assert.equal(timers.length, 0, "a slow save does not accumulate timed snapshot jobs");
  release({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  timers.shift()();
  assert.deepEqual(writes, [0, 100], "the next save captures the latest state");
  release({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 0);
});

test("optional live captures defer to idle time and can be cancelled", () => {
  let timer, idle, captured = 0, cancelled = 0;
  const scope = {
    liveChatSnapshotTimers: new Map(), liveChatSnapshotIdles: new Map(), LIVE_CHAT_SNAPSHOT_MS: 1200,
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {},
    requestIdleCallback: fn => { idle = fn; return 2; }, cancelIdleCallback: () => { cancelled++; idle = null; },
    syncChatRunSession: () => { captured++; },
  };
  vm.runInNewContext(rendererDefinitions("scheduleLiveChatSnapshot", "cancelLiveChatSnapshot"), scope);
  const run = { session: { id: "chat" } };
  scope.scheduleLiveChatSnapshot(run);
  timer();
  assert.equal(captured, 0, "optional view capture waits for idle time");
  assert.equal(typeof idle, "function");
  scope.cancelLiveChatSnapshot(run);
  assert.equal(captured, 0);
  assert.equal(cancelled, 1);
  assert.equal(idle, null);
  scope.scheduleLiveChatSnapshot(run);
  timer(); idle();
  assert.equal(captured, 1);
});
