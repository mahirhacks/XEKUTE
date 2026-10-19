"use strict";

// Pinned turns: a budget of a quarter of the window, kept word for word
// through summaries, and the oldest dropped when the window shrinks. The block
// panel lists only the last six turns, pinned blocks always.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator, isTurnStart } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { visibleContextBlocks, renderContextBlocksHtml } = require("../src/ui/features/chat/context-blocks-view.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009941";
const sessionId = "session_00000000-0000-4000-8000-000000009942";
const turn = (label, words = 10) => [
  { role: "user", content: `Question ${label}` },
  { role: "assistant", content: `Answer ${label}: ${"detail ".repeat(words)}` },
];

function assemble(tier1, active, limit) {
  return tier1.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "s", active_conversation: active, effective_context_limit: limit });
}

test("a pin past a quarter of the window is refused", () => {
  const tier1 = createTier1ContextCoordinator();
  assemble(tier1, [...turn("A", 900), ...turn("B", 900), ...turn("C")], 10_000);
  assert.equal(tier1.pinBlock(projectId, sessionId, 0).ok, true);
  const refused = tier1.pinBlock(projectId, sessionId, 1);
  assert.equal(refused.code, "BLOCK_PIN_BUDGET");
  assert.equal(tier1.pinBlock(projectId, sessionId, 0, false).ok, true, "unpinning always works");
  assert.equal(tier1.pinBlock(projectId, sessionId, 1).ok, true, "the freed budget can be used");
});

test("a pinned turn stays word for word through a summary, and is not summarized", async () => {
  const inner = createTier1ContextCoordinator();
  const tier1 = { ...inner, pressure: (input) => ({ ...inner.pressure(input), threshold: 0 }) };
  const history = [...turn("Keep me"), ...turn("Old"), ...turn("Older")];
  assemble(inner, history.map((message) => ({ ...message })), 32_768);
  assert.equal(inner.pinBlock(projectId, sessionId, 0).ok, true);
  let summarized = "";
  const result = await runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Summarize", chatHistory: history,
    tier1Model: async (payload) => { summarized = JSON.stringify(payload); return { grounded_facts: [] }; },
    sendEvent() {},
    async runModelRound() { return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" }; },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.ok(summarized, "a summary ran");
  assert.equal(summarized.includes("Question Keep me"), false, "the pinned turn was not summarized");
  assert.ok(summarized.includes("Question Old"));
  const blocks = inner.activeBlocks(projectId, sessionId);
  assert.equal(blocks[0].messages[0].content, "Question Keep me", "the pinned turn is still in context word for word");
  assert.equal(blocks[0].pinned, true);
});

test("when the window shrinks, the oldest pins past the budget are summarized and unpinned", async () => {
  const inner = createTier1ContextCoordinator();
  const tier1 = { ...inner, pressure: (input) => ({ ...inner.pressure(input), threshold: 0 }) };
  const history = [...turn("First pin", 700), ...turn("Second pin", 700), ...turn("Plain")];
  assemble(inner, history.map((message) => ({ ...message })), 1_000_000);
  assert.equal(inner.pinBlock(projectId, sessionId, 0).ok, true);
  assert.equal(inner.pinBlock(projectId, sessionId, 1).ok, true);
  const result = await runAgentTurn({
    workspace: "", model: "local:small", numCtx: 8_192, contextBudget: 8_192, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Continue", chatHistory: history,
    sendEvent() {},
    async runModelRound() { return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" }; },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  const blocks = inner.activeBlocks(projectId, sessionId);
  const contents = blocks.map((block) => block.messages[0].content);
  assert.equal(contents.includes("Question First pin"), false, "the older pin no longer fits and was summarized");
  assert.equal(contents.includes("Question Second pin"), true, "the newer pin fits and stays");
  assert.deepEqual(blocks.filter((block) => block.pinned).map((block) => block.messages[0].content), ["Question Second pin"]);
});

test("a turn is a prompt the operator sent; steering and late results are not new turns", () => {
  assert.equal(isTurnStart({ role: "user", content: "Scan" }), true);
  assert.equal(isTurnStart({ role: "user", content: "Scan", source_message_id: "in-1", task_revision: 0 }), true);
  assert.equal(isTurnStart({ role: "user", content: "also port 80", source_message_id: "steer-1", task_revision: 2 }), false);
  assert.equal(isTurnStart({ role: "user", content: "late", source_message_id: "result:abc" }), false);
  assert.equal(isTurnStart({ role: "tool", content: "x", block_partial: true }), false);
  assert.equal(isTurnStart({ role: "user", content: "[Block 0 released ...]", block_tombstone: true, turn_start: true }), true);
  const tier1 = createTier1ContextCoordinator();
  assemble(tier1, [...turn("A"), ...turn("B"), ...turn("C")], 100_000);
  assert.equal(tier1.evictBlocks(projectId, sessionId, [{ index: 0 }]).evicted.length, 1);
  assert.equal(tier1.activeBlocks(projectId, sessionId)[0].turnStart, true, "a released turn still counts as a turn");
});

test("the panel lists the last six turns, and pinned blocks always", () => {
  const rows = [];
  for (let turnNumber = 0; turnNumber < 9; turnNumber += 1) {
    rows.push({ index: rows.length, turnStart: true, tokens: 10, summary: `Turn ${turnNumber}`, pinned: turnNumber === 1 });
    rows.push({ index: rows.length, turnStart: false, tokens: 10, summary: `Steering in turn ${turnNumber}` });
  }
  const visible = visibleContextBlocks(rows);
  assert.deepEqual(visible.filter((row) => row.turnStart).map((row) => row.summary), ["Turn 1", "Turn 3", "Turn 4", "Turn 5", "Turn 6", "Turn 7", "Turn 8"]);
  assert.equal(visible.some((row) => row.summary === "Steering in turn 2"), false, "blocks of older turns are gone");
  assert.equal(visible.some((row) => row.summary === "Steering in turn 3"), true, "a visible turn keeps its steering blocks");
  const html = renderContextBlocksHtml(rows, { pinBudgetTokens: 25 });
  assert.match(html, /1 pinned \(10 of 25\)/);
  assert.match(html, /data-block-pin="17" aria-pressed="false" aria-label="Pin block 17" title="Pin: keep this turn word for word\."/);
  const full = renderContextBlocksHtml(rows.map((row) => (row.pinned ? { ...row, tokens: 20 } : row)), { pinBudgetTokens: 25 });
  assert.match(full, /data-block-pin="17"[^>]*title="Pinned turns can use at most a quarter of the context window\." disabled/);
});

test("an old pinned block stays listed past the 40-row cap so it can be unpinned", () => {
  const { describeBlocks } = require("../src/agent/tools/process/context-blocks.js");
  const blocks = Array.from({ length: 50 }, (_, index) => ({ index, state: "active", pinned: index === 0, tokenEstimate: 10, messages: [{ role: "user", content: `Turn ${index}` }], turnStart: true }));
  const rows = describeBlocks(blocks, 49);
  assert.equal(rows[0].index, 0);
  assert.equal(rows[0].pinned, true);
  const html = renderContextBlocksHtml(rows, { pinBudgetTokens: 100 });
  assert.match(html, /data-block-pin="0" aria-pressed="true"/);
  assert.match(html, /1 pinned \(10 of 100\)/);
});
