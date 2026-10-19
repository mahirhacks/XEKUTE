"use strict";

// Stopping a run while its context is being summarized discards that
// summarization completely; the next run summarizes again from the start.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009601";
const sessionId = "session_00000000-0000-4000-8000-000000009602";
const LIMIT = 1_000_000;

const ledger = () => [
  { role: "user", content: "Scan 10.0.0.5", source_message_id: "in-1" },
  { role: "assistant", content: "Port 22 is open on 10.0.0.5." },
  { role: "user", content: "Check the TLS setup", source_message_id: "in-2" },
  { role: "assistant", content: "TLS 1.0 is still enabled." },
];

// A store that records writes, so a test can prove nothing was persisted.
function recordingStore() {
  const writes = [];
  return { writes, store: { writeCheckpoint: (...args) => { writes.push(args); return { ok: true }; }, writeActive: () => ({ ok: true }) } };
}

// A summarizer that waits until it is told to answer or is stopped.
function pendingModel() {
  const calls = [];
  let answer = null;
  const model = (payload, { signal } = {}) => new Promise((resolve, reject) => {
    calls.push({ payload, signal });
    answer = () => resolve({ grounded_facts: [] });
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" })), { once: true });
  });
  return { model, calls, answer: () => answer?.() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("stopping during the summarizer call writes nothing and leaves the ledger as it was", async () => {
  const { writes, store } = recordingStore();
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
  coordinator.setActiveConversation(projectId, sessionId, ledger());
  coordinator.recordDirective(projectId, sessionId, { text: "Stay off 10.0.0.9", sourceMessageId: "steer-1" });
  const before = JSON.stringify(coordinator.state(projectId, sessionId));
  const stop = new AbortController();
  const summarizer = pendingModel();
  const running = coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess 10.0.0.5", effective_context_limit: LIMIT, model: summarizer.model, signal: stop.signal });
  await tick();
  assert.equal(summarizer.calls.length, 1);
  assert.equal(summarizer.calls[0].signal, stop.signal, "the adapter gets the stop signal to cancel its own request");
  stop.abort();
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.code, "MEMORY_CHECKPOINT_INTERRUPTED");
  assert.equal(result.interrupted, true);
  assert.equal(result.activePreserved, true);
  assert.deepEqual(writes, [], "no checkpoint was persisted");
  assert.equal(JSON.stringify(coordinator.state(projectId, sessionId)), before, "ledger, summary and directives are unchanged");
});

test("a stop is not covered up by the deterministic fallback summary", async () => {
  const coordinator = createTier1ContextCoordinator();
  coordinator.setActiveConversation(projectId, sessionId, ledger());
  const stop = new AbortController();
  // A model that fails as the stop arrives would normally fall back to the
  // deterministic reducer; a stop must not.
  const model = async () => { stop.abort(); throw new Error("connection reset"); };
  const result = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess", effective_context_limit: LIMIT, model, signal: stop.signal });
  assert.equal(result.code, "MEMORY_CHECKPOINT_INTERRUPTED");
  assert.equal(coordinator.state(projectId, sessionId).summary, null);
  assert.equal(coordinator.state(projectId, sessionId).active.length, 4);
});

test("a stop that arrives as the summarizer answers still discards the answer", async () => {
  const coordinator = createTier1ContextCoordinator();
  coordinator.setActiveConversation(projectId, sessionId, ledger());
  const stop = new AbortController();
  const model = async () => { const answer = { grounded_facts: [] }; stop.abort(); return answer; };
  const result = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess", effective_context_limit: LIMIT, model, signal: stop.signal });
  assert.equal(result.code, "MEMORY_CHECKPOINT_INTERRUPTED");
  assert.equal(coordinator.state(projectId, sessionId).summary, null);
});

test("an already stopped run never calls the summarizer", async () => {
  const coordinator = createTier1ContextCoordinator();
  coordinator.setActiveConversation(projectId, sessionId, ledger());
  let called = false;
  const result = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, effective_context_limit: LIMIT, model: async () => { called = true; return {}; }, signal: AbortSignal.abort() });
  assert.equal(result.code, "MEMORY_CHECKPOINT_INTERRUPTED");
  assert.equal(called, false);
});

test("after an interrupted summary the next one starts from the beginning and completes", async () => {
  const coordinator = createTier1ContextCoordinator();
  coordinator.setActiveConversation(projectId, sessionId, ledger());
  const stop = new AbortController();
  const first = pendingModel();
  const running = coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess 10.0.0.5", effective_context_limit: LIMIT, model: first.model, signal: stop.signal });
  await tick();
  stop.abort();
  assert.equal((await running).code, "MEMORY_CHECKPOINT_INTERRUPTED");
  let seen = null;
  const resumed = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess 10.0.0.5", effective_context_limit: LIMIT, model: async (payload) => { seen = payload; return { grounded_facts: [] }; } });
  assert.equal(resumed.ok, true, resumed.code);
  assert.equal(JSON.stringify(seen).includes("TLS 1.0 is still enabled"), true, "the whole ledger is summarized again");
  assert.equal(coordinator.state(projectId, sessionId).active.length, 0);
});

test("stopping a run mid-summary reports it interrupted, starts no other summary, and the next run summarizes", async () => {
  const inner = createTier1ContextCoordinator();
  const tier1 = { ...inner, pressure: (input) => ({ ...inner.pressure(input), threshold: 0 }) };
  const history = ledger().map(({ source_message_id: _id, ...message }) => message);
  const runTurn = ({ signal, tier1Model, events }) => runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, tier1Model, userMessage: "Summarize the findings", chatHistory: history,
    signal, sendEvent: (event) => events.push(event),
    async runModelRound() { return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" }; },
    async executeToolCall() { return { ok: true, value: {} }; },
  });

  const stop = new AbortController();
  const summarizer = pendingModel();
  const events = [];
  const stopped = runTurn({ signal: stop.signal, tier1Model: summarizer.model, events });
  for (let i = 0; i < 50 && !summarizer.calls.length; i += 1) await tick();
  assert.equal(summarizer.calls.length, 1, "the run reached the summarizer");
  stop.abort();
  const result = await stopped;
  assert.equal(result.aborted || result.runState?.status === "stopped" || result.ok === false, true, JSON.stringify({ ok: result.ok, code: result.code, status: result.runState?.status }));
  const checkpoints = events.filter((event) => event.type === "context_checkpoint");
  assert.deepEqual(checkpoints.map((event) => event.status), ["started", "interrupted"], "one summary started and it was interrupted");
  assert.equal(inner.state(projectId, sessionId).summary, null, "nothing was summarized");

  const nextEvents = [];
  const next = await runTurn({ signal: null, tier1Model: async () => ({ grounded_facts: [] }), events: nextEvents });
  assert.equal(next.ok, true, JSON.stringify(next.error || ""));
  assert.ok(nextEvents.some((event) => event.type === "context_checkpoint" && event.status === "completed"), "the next run summarizes from the start");
  assert.ok(inner.state(projectId, sessionId).summary, "the summary now exists");
});
