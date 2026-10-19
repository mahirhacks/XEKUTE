"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createReleaseBlocksTool, createRecallBlockTool } = require("../src/agent/tools/process/context-blocks.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000006001";
const sessionId = "session_00000000-0000-4000-8000-000000006002";

const toolDefinition = (adapter) => ({ type: "function", function: { name: adapter.name, description: adapter.description, parameters: adapter.inputSchema } });
const TOOLS = [toolDefinition(createReleaseBlocksTool()), toolDefinition(createRecallBlockTool())];
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });
const history = () => [
  { role: "user", content: "Scan 10.0.0.5 for open ports" },
  { role: "assistant", content: "Ports 22 and 443 are open." },
  { role: "user", content: "Check the TLS configuration" },
  { role: "assistant", content: "TLS 1.0 is still enabled." },
];

async function runScript(script, { tier1 = createTier1ContextCoordinator(), chatHistory = history(), userMessage = "Summarize what you found", extra = {}, events = [] } = {}) {
  const seen = [];
  let round = 0;
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    tools: TOOLS,
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage,
    chatHistory,
    ...extra,
    sendEvent: (event) => events.push(event),
    async runModelRound(payload) {
      seen.push(payload.messages.map((message) => ({ role: message.role, content: message.content, tool_call_id: message.tool_call_id })));
      const step = script[Math.min(round, script.length - 1)];
      round += 1;
      return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: step(seen) };
    },
    async executeToolCall() { throw new Error("context block tools never reach the execution pipeline"); },
  });
  return { result, seen, tier1 };
}

function lastTool(messages) {
  const envelope = JSON.parse(messages.filter((message) => message.role === "tool").at(-1).content);
  const payload = typeof envelope.payload === "string" && envelope.payload ? JSON.parse(envelope.payload) : {};
  return { ok: envelope.ok, errorCode: envelope.errorCode, error: envelope.error, ...payload };
}

test("the model lists, releases and recalls earlier turns, and its provider history shrinks and grows accordingly", async () => {
  const { result, seen, tier1 } = await runScript([
    () => [call("list-1", "release_blocks", { operation: "list" })],
    () => [call("release-1", "release_blocks", { operation: "release", blocks: [{ index: 0, note: "ports recorded in the report" }] })],
    () => [call("recall-1", "recall_block", { index: 0 })],
    () => [endTurnCall()],
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(seen.length, 4);

  const listing = lastTool(seen[1]);
  const listValue = listing;
  assert.equal(listValue.operation, "list");
  assert.deepEqual(listValue.blocks.map((block) => [block.index, block.releasable]), [[0, true], [1, true], [2, false]]);
  assert.equal(listValue.blocks[0].summary, "Scan 10.0.0.5 for open ports");

  const before = seen[1].filter((message) => message.content === "Scan 10.0.0.5 for open ports").length;
  const after = seen[2].filter((message) => message.content === "Scan 10.0.0.5 for open ports").length;
  assert.equal(before, 1);
  assert.equal(after, 0, "the released turn is gone from the provider history");
  const tombstone = seen[2].find((message) => /^\[Block 0 released from context/.test(String(message.content)));
  assert.ok(tombstone, "a tombstone replaces the released turn");
  assert.match(tombstone.content, /started by "Scan 10\.0\.0\.5 for open ports"/);
  assert.match(tombstone.content, /Note: ports recorded in the report/);
  assert.equal(seen[2].some((message) => message.content === "Check the TLS configuration"), true, "other turns are untouched");

  const released = lastTool(seen[2]);
  assert.deepEqual(released.released.map((entry) => entry.index), [0]);

  const recalled = lastTool(seen[3]);
  const recallValue = recalled;
  assert.equal(recallValue.operation, "recall");
  assert.match(recallValue.transcript, /\[user\] Scan 10\.0\.0\.5 for open ports/);
  assert.match(recallValue.transcript, /\[assistant\] Ports 22 and 443 are open\./);

  const active = tier1.state(projectId, sessionId).active;
  assert.equal(active[0].block_tombstone, true);
  assert.deepEqual(active.map((message) => message.block_index).filter((index) => index !== undefined), [0, 1, 2]);
  assert.equal(result.appendedMessages.some((message) => message.block_tombstone), false, "the tombstone is not persisted as a turn message");
  assert.deepEqual(result.appendedMessages.map((message) => message.role), ["assistant", "tool", "assistant", "tool", "assistant", "tool", "assistant", "tool"]);
});

test("the task in progress cannot be released, and unknown or repeated blocks are reported", async () => {
  const { result, seen, tier1 } = await runScript([
    () => [call("release-live", "release_blocks", { operation: "release", blocks: [{ index: 2 }, { index: 77 }] })],
    () => [call("release-twice", "release_blocks", { operation: "release", blocks: [{ index: 0 }] })],
    () => [call("release-again", "release_blocks", { operation: "release", blocks: [{ index: 0 }] })],
    () => [endTurnCall()],
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  const first = lastTool(seen[1]);
  const firstValue = first;
  assert.deepEqual(firstValue.released, []);
  assert.deepEqual(firstValue.rejected.map((entry) => [entry.index, entry.code]), [[2, "BLOCK_IN_CURRENT_TASK"], [77, "BLOCK_NOT_FOUND"]]);

  const again = lastTool(seen[3]);
  assert.deepEqual(again.rejected.map((entry) => entry.code), ["BLOCK_ALREADY_RELEASED"]);
  assert.equal(tier1.activeBlocks(projectId, sessionId).filter((block) => block.state === "evicted").length, 1);
});

test("recalling a block that is still in context or was never released fails cleanly", async () => {
  const { result, seen } = await runScript([
    () => [call("recall-live", "recall_block", { index: 1 })],
    () => [call("recall-none", "recall_block", { index: 9 })],
    () => [endTurnCall()],
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(lastTool(seen[1]).errorCode, "MEMORY_BLOCK_ACTIVE");
  assert.equal(lastTool(seen[2]).errorCode, "MEMORY_BLOCK_NOT_RELEASED");
});

test("invalid release requests are rejected without touching context", async () => {
  const { result, seen, tier1 } = await runScript([
    () => [call("bad-op", "release_blocks", { operation: "purge" })],
    () => [call("empty", "release_blocks", { operation: "release", blocks: [] })],
    () => [endTurnCall()],
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(lastTool(seen[1]).errorCode, "INVALID_CONTEXT_OPERATION");
  assert.equal(lastTool(seen[2]).errorCode, "INVALID_CONTEXT_OPERATION");
  assert.equal(tier1.activeBlocks(projectId, sessionId).some((block) => block.state === "evicted"), false);
});

test("steering input appended mid-run keeps the original prompt's block protected", async () => {
  const tier1 = createTier1ContextCoordinator();
  const { result, seen } = await runScript([
    () => [call("list-1", "release_blocks", { operation: "list" })],
    () => [endTurnCall()],
  ], { tier1, chatHistory: [], userMessage: "Only turn" });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  const listing = lastTool(seen[1]);
  assert.deepEqual(listing.blocks.map((block) => [block.index, block.releasable]), [[0, false]]);
});

const longHistory = () => Array.from({ length: 5 }, (_, turn) => [
  { role: "user", content: `Question ${turn}: enumerate service ${turn} on 10.0.0.${turn + 1}` },
  { role: "assistant", content: `Answer ${turn}: service ${turn} exposes ${turn + 20}/tcp. ${"detail ".repeat(40)}` },
]).flat();
const FORCE_RELEASE = { triggerRatio: 0.001, targetRatio: 0, keepRecent: 1, minBlockTokens: 0, tombstoneTokens: 0 };

test("pressure releases the oldest finished turns in one batch before the first request and keeps history append-only afterward", async () => {
  const events = [];
  const { result, seen, tier1 } = await runScript([
    () => [call("list-1", "release_blocks", { operation: "list" })],
    () => [endTurnCall()],
  ], { chatHistory: longHistory(), userMessage: "Summarize everything", extra: { contextReleasePolicy: FORCE_RELEASE }, events });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));

  const tombstones = seen[0].filter((message) => /^\[Block \d+ released from context/.test(String(message.content)));
  assert.deepEqual(tombstones.map((message) => Number(/Block (\d+)/.exec(message.content)[1])), [0, 1, 2, 3]);
  assert.match(tombstones[0].content, /hosts: 10\.0\.0\.1; ports: 20\/tcp/);
  assert.equal(seen[0].some((message) => String(message.content).startsWith("Question 0")), false);
  assert.equal(seen[0].some((message) => String(message.content).startsWith("Question 4")), true, "the newest finished turn stays");
  assert.equal(seen[0].at(-1).content, "Summarize everything", "the live prompt is last");

  assert.deepEqual(seen[1].slice(0, seen[0].length), seen[0], "the provider history only grows after the batch release");
  assert.equal(seen[1].filter((message) => /released from context/.test(String(message.content))).length, 4, "no further release churn");

  const released = events.filter((event) => event.type === "context_release");
  assert.deepEqual(released.map((event) => event.status), ["started", "completed"]);
  assert.deepEqual(released[1].indices, [0, 1, 2, 3]);
  assert.ok(released[1].tokensFreed > 0);
  assert.equal(tier1.activeBlocks(projectId, sessionId).filter((block) => block.state === "evicted").length, 4);
});

test("automatic release can be switched off and never fires below the trigger", async () => {
  const off = await runScript([() => [endTurnCall()]], { chatHistory: longHistory(), extra: { contextReleasePolicy: FORCE_RELEASE, contextAutoRelease: false } });
  assert.equal(off.seen[0].some((message) => /released from context/.test(String(message.content))), false);
  assert.equal(off.seen[0].some((message) => String(message.content).startsWith("Question 0")), true);

  const quiet = await runScript([() => [endTurnCall()]], { chatHistory: longHistory() });
  assert.equal(quiet.seen[0].some((message) => /released from context/.test(String(message.content))), false, "a small prompt stays far below the default trigger");
});

test("a run without Tier 1 memory reports context blocks as unavailable instead of failing", async () => {
  const seen = [];
  let round = 0;
  const result = await require("../src/agent/controller/agent-controller.js").runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32768, contextBudget: 32768, tools: TOOLS, mode: "agent", modeFamily: "assist",
    userMessage: "hello", chatHistory: [], sendEvent() {},
    async runModelRound(payload) {
      seen.push(payload.messages);
      round += 1;
      return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: round === 1 ? [call("list-1", "release_blocks", { operation: "list" })] : [endTurnCall()] };
    },
    async executeToolCall() { throw new Error("context block tools never reach the execution pipeline"); },
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(lastTool(seen[1]).errorCode, "CONTEXT_BLOCKS_UNAVAILABLE");
});

test("a pinned block is not releasable by the model or by pressure", async () => {
  const tier1 = createTier1ContextCoordinator();
  tier1.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", active_conversation: longHistory().map((message) => ({ ...message })), effective_context_limit: 32768 });
  assert.equal(tier1.pinBlock(projectId, sessionId, 1).ok, true);

  const manual = await runScript([
    () => [call("list-1", "release_blocks", { operation: "list" })],
    () => [call("release-1", "release_blocks", { operation: "release", blocks: [{ index: 1 }, { index: 0 }] })],
    () => [endTurnCall()],
  ], { tier1, chatHistory: longHistory(), userMessage: "Summarize everything" });
  assert.equal(manual.result.ok, true, JSON.stringify(manual.result.error || ""));
  const listing = lastTool(manual.seen[1]);
  assert.deepEqual(listing.blocks.map((block) => [block.index, block.pinned, block.releasable]).slice(0, 3), [[0, false, true], [1, true, false], [2, false, true]]);
  const released = lastTool(manual.seen[2]);
  assert.deepEqual(released.released.map((entry) => entry.index), [0]);
  assert.deepEqual(released.rejected, [{ index: 1, code: "BLOCK_PINNED" }]);

  const pressured = createTier1ContextCoordinator();
  pressured.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", active_conversation: longHistory().map((message) => ({ ...message })), effective_context_limit: 32768 });
  pressured.pinBlock(projectId, sessionId, 0);
  const auto = await runScript([() => [endTurnCall()]], { tier1: pressured, chatHistory: longHistory(), userMessage: "Summarize everything", extra: { contextReleasePolicy: FORCE_RELEASE } });
  assert.deepEqual(auto.seen[0].filter((message) => /^\[Block \d+ released/.test(String(message.content))).map((message) => Number(/Block (\d+)/.exec(message.content)[1])), [1, 2, 3]);
  assert.equal(auto.seen[0].some((message) => String(message.content).startsWith("Question 0")), true, "the pinned turn stays in context");
});

test("released blocks survive an app restart: a new run sees the tombstone and can recall the block from the encrypted store", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-blocks-restart-"));
  const protector = { available: () => true, encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"), decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8") };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  try {
    const first = await runScript([
      () => [call("release-1", "release_blocks", { operation: "release", blocks: [{ index: 0, note: "ports saved" }] })],
      () => [endTurnCall()],
    ], { tier1: createTier1ContextCoordinator({ sensitiveStore: store }) });
    assert.equal(first.result.ok, true, JSON.stringify(first.result.error || ""));
    assert.deepEqual(lastTool(first.seen[1]).released.map((entry) => entry.index), [0]);

    const second = await runScript([
      () => [call("recall-1", "recall_block", { index: 0 })],
      () => [endTurnCall()],
    ], { tier1: createTier1ContextCoordinator({ sensitiveStore: store }), chatHistory: [], userMessage: "Follow up on the ports" });
    assert.equal(second.result.ok, true, JSON.stringify(second.result.error || ""));
    const firstRequest = second.seen[0];
    assert.equal(firstRequest.some((message) => /^\[Block 0 released from context/.test(String(message.content))), true, "the tombstone is restored from disk");
    assert.equal(firstRequest.some((message) => message.content === "Scan 10.0.0.5 for open ports"), false);
    assert.equal(firstRequest.some((message) => message.content === "Check the TLS configuration"), true);
    assert.equal(firstRequest.at(-1).content, "Follow up on the ports");

    const recalled = lastTool(second.seen[1]);
    assert.equal(recalled.operation, "recall");
    assert.match(recalled.transcript, /\[user\] Scan 10\.0\.0\.5 for open ports/);
    assert.deepEqual(second.tier1.activeBlocks(projectId, sessionId).map((block) => block.index), [0, 1, 2, 3], "indexes continue across the restart");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("recalling a very large block returns a bounded transcript and says it was cut", async () => {
  const huge = [
    { role: "user", content: "Dump the whole config" },
    { role: "assistant", content: `BEGIN ${"config-line ".repeat(20_000)} END` },
    ...history(),
  ];
  const { result, seen } = await runScript([
    () => [call("release-1", "release_blocks", { operation: "release", blocks: [{ index: 0 }] })],
    () => [call("recall-1", "recall_block", { index: 0 })],
    () => [endTurnCall()],
  ], { chatHistory: huge });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  const recalled = lastTool(seen[2]);
  assert.equal(recalled.truncated, true);
  assert.ok(recalled.transcript.length < 25_000, `a 32k-token window allows about 23.6k characters (${recalled.transcript.length})`);
  assert.ok(recalled.tokens > 50_000, "the real block is far larger than what was returned");
  assert.match(recalled.transcript, /^\[user\] Dump the whole config/);
  assert.match(recalled.transcript, /characters omitted/);
  assert.match(recalled.transcript, /END$/);
});

test("a round far below the trigger does not build the block view at all", async () => {
  const viewsFor = async (extra) => {
    const tier1 = createTier1ContextCoordinator();
    let views = 0;
    const counting = { ...tier1, activeBlocks: (...args) => { views += 1; return tier1.activeBlocks(...args); } };
    const run = await runScript([() => [endTurnCall()]], { tier1: counting, chatHistory: longHistory(), extra });
    assert.equal(run.result.ok, true, JSON.stringify(run.result.error || ""));
    return views;
  };
  const withoutRelease = await viewsFor({ contextAutoRelease: false });
  const quiet = await viewsFor({});
  assert.equal(quiet, withoutRelease, "below the trigger, automatic release adds no block reads beyond the usage meter's");
  const forced = await viewsFor({ contextReleasePolicy: FORCE_RELEASE });
  assert.ok(forced > withoutRelease, "above the trigger the block view is built");
});
