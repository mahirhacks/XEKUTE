"use strict";

// One writer per chat: two runs for the same memory session never interleave
// their ledger writes, and a fork taken while a run is going copies the state
// from before that run.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009921";
const sessionId = "session_00000000-0000-4000-8000-000000009922";
const forkId = "session_00000000-0000-4000-8000-000000009923";
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the writer lease is granted in order and a stopped waiter leaves the queue", async () => {
  const tier1 = createTier1ContextCoordinator();
  const order = [];
  const releaseFirst = await tier1.acquireWriter(projectId, sessionId);
  const stop = new AbortController();
  const stopped = tier1.acquireWriter(projectId, sessionId, { signal: stop.signal }).then(() => order.push("stopped"), (error) => order.push(error.code));
  const second = tier1.acquireWriter(projectId, sessionId).then((release) => { order.push("second"); return release; });
  await tick();
  assert.deepEqual(order, [], "nobody else gets the lease while it is held");
  stop.abort();
  await stopped;
  releaseFirst();
  const releaseSecond = await second;
  assert.deepEqual(order, ["SESSION_WRITER_ABORTED", "second"]);
  releaseSecond();
  releaseSecond();
  const third = await tier1.acquireWriter(projectId, sessionId);
  third();
});

test("a fork during a run copies the state from before the run", async () => {
  const tier1 = createTier1ContextCoordinator();
  tier1.setActiveConversation(projectId, sessionId, [{ role: "user", content: "Finished question" }, { role: "assistant", content: "Finished answer" }]);
  const release = await tier1.acquireWriter(projectId, sessionId);
  // The running turn has an open tool call when the fork happens.
  tier1.appendConversation(projectId, sessionId, [
    { role: "user", content: "Running question" },
    { role: "assistant", content: "", tool_calls: [{ id: "open-1", function: { name: "exec_command", arguments: "{}" } }] },
  ]);
  assert.equal(tier1.cloneSession(projectId, sessionId, forkId).ok, true);
  assert.deepEqual(tier1.state(projectId, forkId).active.map((message) => message.content), ["Finished question", "Finished answer"]);
  const runningIndex = tier1.activeBlocks(projectId, sessionId).at(-1).index;
  tier1.appendConversation(projectId, forkId, [{ role: "user", content: "Fork question" }]);
  assert.ok(tier1.activeBlocks(projectId, forkId).at(-1).index > runningIndex, "the fork never reuses an index the running turn took");
  release();
  const after = "session_00000000-0000-4000-8000-000000009924";
  tier1.cloneSession(projectId, sessionId, after);
  assert.equal(tier1.state(projectId, after).active.length, 4, "once the run ends a fork copies everything");
});

test("two runs for one chat take turns, and neither loses the other's messages", async () => {
  const tier1 = createTier1ContextCoordinator();
  const calls = [];
  let finishFirst = null;
  const run = (name, prompt, hold) => runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: prompt, chatHistory: [],
    sendEvent() {},
    async runModelRound() {
      calls.push(name);
      if (hold) await new Promise((resolve) => { finishFirst = resolve; });
      return { ok: true, fullText: `${name} done`, toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
  const first = run("first", "Foreground question", true);
  for (let i = 0; i < 100 && !finishFirst; i += 1) await tick();
  const second = run("second", "Background question", false);
  for (let i = 0; i < 20; i += 1) await tick();
  // Release the held run even when the check fails, so a regression cannot hang the suite.
  try { assert.deepEqual(calls, ["first"], "the second run waits for the first to finish"); } finally { finishFirst(); }
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(calls, ["first", "second"]);
  const ledger = tier1.state(projectId, sessionId).active.map((message) => String(message.content || ""));
  assert.ok(ledger.includes("Foreground question"), "the first run's turn is kept");
  assert.ok(ledger.includes("Background question"), "the second run's turn is kept");
});

test("a run stopped while waiting for the chat ends without touching it", async () => {
  const tier1 = createTier1ContextCoordinator();
  const release = await tier1.acquireWriter(projectId, sessionId);
  const stop = new AbortController();
  let called = false;
  const waiting = runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Queued question", chatHistory: [], signal: stop.signal,
    sendEvent() {}, async runModelRound() { called = true; return { ok: true, fullText: "", toolCalls: [endTurnCall()] }; },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
  await tick();
  stop.abort();
  const result = await waiting;
  assert.equal(result.aborted, true);
  assert.equal(called, false);
  assert.equal(tier1.state(projectId, sessionId).active.length, 0);
  release();
});
