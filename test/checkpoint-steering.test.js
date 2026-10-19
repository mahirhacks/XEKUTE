"use strict";

// Steering sent while the context is being summarized waits with the session
// supervisor and joins the conversation only after the summary is done.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009701";
const sessionId = "session_00000000-0000-4000-8000-000000009702";
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("steering sent during summarization is not summarized and reaches the model once, after the summary", async (t) => {
  const fixture = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: () => {} });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const admitted = await runtime.admit({ ...location, runId: "run-steer", userMessage: "Assess the staging hosts", inputId: "initial", binding: { provider: "ollama", model: "local:small" } });
  assert.equal(admitted.ok, true, admitted.error);

  const inner = createTier1ContextCoordinator();
  let forceCheckpoint = true;
  const tier1 = { ...inner, pressure: (input) => (forceCheckpoint ? { ...inner.pressure(input), threshold: 0 } : inner.pressure(input)) };
  // The summarizer is held open until the test lets it answer.
  const summaries = [];
  let answer = null;
  const tier1Model = (payload) => new Promise((resolve) => { summaries.push(JSON.stringify(payload)); answer = () => resolve({ grounded_facts: [] }); });

  const steering = ["Steer A: also check 10.7.0.1", "Steer B: skip port 80", "Steer C: report in Markdown"];
  const requests = [];
  const events = [];
  const running = runAgentTurn({
    workspace: fixture.workspace, model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "agent", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, tier1Model,
    userMessage: admitted.task.objective, runId: admitted.runId, initialInputId: admitted.initialInputId, liveInput: admitted.liveInput, engineSnapshot: admitted.engineSnapshot,
    chatHistory: [{ role: "user", content: "Earlier: scan 10.0.0.5" }, { role: "assistant", content: "Port 22 is open." }, ...admitted.chatHistory],
    sendEvent: (event) => events.push(event),
    async runModelRound(payload) {
      requests.push(payload.messages.map((message) => String(message.content || "")));
      forceCheckpoint = false;
      return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() { return { ok: true, value: {} }; },
  });

  for (let i = 0; i < 100 && !answer; i += 1) await tick();
  assert.ok(answer, "the summary started before the first model call");
  for (const [index, text] of steering.entries()) {
    const receipt = await runtime.receive({ ...location, input: { id: `steer-${index}`, text } });
    assert.equal(receipt.durable, true, "steering is saved by the supervisor while the summary runs");
  }
  await tick();
  assert.equal(requests.length, 0, "no model call happens while the summary runs");
  answer();
  const result = await running;
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));

  assert.equal(summaries.length, 1);
  assert.equal(requests.length, 1, "the first model request is rebuilt after steering that arrived during summarization");
  for (const text of steering) assert.equal(summaries[0].includes(text), false, `"${text}" was not part of the summary`);
  assert.ok(events.some((event) => event.type === "context_checkpoint" && event.status === "completed"));
  const delivered = requests.find((messages) => steering.every((text) => messages.some((content) => content.includes(text))));
  assert.ok(delivered, "every steering message reaches the model after the summary");
  for (const text of steering) assert.equal(delivered.filter((content) => content.includes(text)).length, 1, `"${text}" appears once`);
  const ledger = inner.state(projectId, sessionId).active.map((message) => String(message.content || ""));
  for (const text of steering) assert.equal(ledger.filter((content) => content.includes(text)).length, 1, `"${text}" is in the conversation once`);
});
