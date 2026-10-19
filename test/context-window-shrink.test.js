"use strict";

// Switching a chat to a model with a much smaller window: the next send fits
// the chat into the new window by itself, with at most one summary per round.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator, summaryBudget } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009901";
const sessionId = "session_00000000-0000-4000-8000-000000009902";
const WINDOW = 32_768;

const turns = (count, words) => Array.from({ length: count }, (_, turn) => [
  { role: "user", content: `Question ${turn}: check 10.0.${turn}.1` },
  { role: "assistant", content: `Answer ${turn}: ${"finding ".repeat(words)}` },
]).flat();

function run({ tier1, chatHistory, events, rounds }) {
  return runAgentTurn({
    workspace: "", model: "local:small", numCtx: WINDOW, contextBudget: WINDOW, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Summarize where we are", chatHistory,
    sendEvent: (event) => events.push(event),
    async runModelRound(payload) {
      rounds.push(payload);
      return { ok: true, fullText: "Here is where we are.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
}

const summariesBeforeFirstCall = (events) => {
  const firstUsage = events.findIndex((event) => event.type === "context_usage" && event.usage?.promptTokens);
  return events.filter((event, index) => event.type === "context_checkpoint" && event.status === "completed" && (firstUsage < 0 || index <= firstUsage)).length;
};

test("a chat far bigger than the new window fits on the next send with at most one summary", async () => {
  const tier1 = createTier1ContextCoordinator();
  const events = [];
  const rounds = [];
  // About 120K tokens of history against a 32K window.
  const result = await run({ tier1, chatHistory: turns(40, 800), events, rounds });
  assert.equal(result.ok, true, JSON.stringify({ code: result.code, error: result.error }));
  assert.notEqual(result.code, "MANDATORY_CONTEXT_LIMIT");
  assert.ok(rounds.length >= 1, "the model was called");
  assert.ok(summariesBeforeFirstCall(events) <= 1, "never more than one summary before the model call");
});

test("a summary written for a large window is refit to the small one instead of overflowing it", async () => {
  const tier1 = createTier1ContextCoordinator();
  // A long engagement summarized under a 1M window keeps many facts.
  tier1.setActiveConversation(projectId, sessionId, turns(400, 6).map((message, index) => ({ ...message, content: `${message.content} host-${index}.example` })));
  const big = await tier1.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Assess the estate", allow_model: false, effective_context_limit: 1_000_000 });
  assert.equal(big.ok, true, big.code);
  const bigTokens = Math.ceil(JSON.stringify(big.checkpoint).length / 3.6);
  assert.ok(bigTokens > summaryBudget(WINDOW), `the old summary (${bigTokens}) is over the small window's budget (${summaryBudget(WINDOW)})`);

  const events = [];
  const rounds = [];
  const result = await run({ tier1, chatHistory: [], events, rounds });
  assert.equal(result.ok, true, JSON.stringify({ code: result.code, error: result.error }));
  assert.ok(rounds.length >= 1, "the model was called");
  const refit = tier1.state(projectId, sessionId).summary;
  assert.ok(Math.ceil(JSON.stringify(refit).length / 3.6) <= summaryBudget(WINDOW) * 1.1, "the summary now fits the small window's budget");
  assert.equal(events.filter((event) => event.type === "context_checkpoint" && event.status === "completed").length >= 1, true);
});
