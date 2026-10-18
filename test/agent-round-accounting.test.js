"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoundAccounting, waitForRetry } = require("../src/agent/runtime/round-accounting.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { endTurnRound } = require("./helpers/end-turn-call.js");
const { coherentTail, completeExchanges } = require("../src/agent/runtime/tool-protocol.js");

test("transport counters survive restoration without spending an operational round", () => {
  const first = createRoundAccounting();
  first.attempt(); first.outputSegment(); first.attempt(); first.outputSegment();
  const resumed = createRoundAccounting({ snapshot: first.snapshot() });
  resumed.operationalRound(); resumed.attempt();
  assert.deepEqual(resumed.snapshot(), { operationalRounds: 1, providerAttempts: 3, outputSegments: 2, protocolRepairs: 0, noProgressRounds: 1, consecutiveOutputSegments: 0, consecutiveProtocolRepairs: 0, progressFingerprints: [] });
});

test("malformed identifiable calls are paired and visible to the next model without execution", async () => {
  let rounds = 0;
  let executions = 0;
  const result = await runAgentTurn({
    userMessage: "Read the file", modeFamily: "assist", maxAgentRounds: 3,
    tools: [{ type: "function", function: { name: "exec_command", parameters: {} } }],
    executeToolCall: async () => { executions += 1; return { ok: true }; },
    runModelRound: async ({ messages }) => {
      if (++rounds === 1) return { toolCalls: [{ id: "bad-json", function: { name: "exec_command", arguments: "{" } }] };
      const assistant = messages.find((m) => m.tool_calls?.some((c) => c.id === "bad-json"));
      const outcome = messages.find((m) => m.tool_call_id === "bad-json");
      assert.ok(assistant);
      assert.match(outcome.content, /MALFORMED_TOOL_ARGUMENTS/);
      return endTurnRound("Finished");
    },
  });
  assert.equal(executions, 0);
  assert.equal(result.runState.status, "completed");
  assert.equal(result.runState.accounting.protocolRepairs, 1);
  assert.equal(result.appendedMessages.filter((m) => m.tool_call_id === "bad-json").length, 1);
});

for (const scenario of [
  { name: "output continuation", limits: { outputSegments: 3 }, expected: "OUTPUT_CONTINUATION_LIMIT", response: { fullText: "x", toolCalls: [], finishReason: "length" } },
  { name: "unusable envelope", limits: { protocolRepairs: 2 }, expected: "MODEL_PROTOCOL_REPAIR_LIMIT", response: { toolCalls: [null] } },
  { name: "silent non-progress", limits: { noProgressRounds: 3 }, expected: "AGENT_NO_PROGRESS", response: { fullText: "Working", toolCalls: [] } },
]) {
  test(`${scenario.name} reaches a bounded checkpoint under an unlimited job budget`, async () => {
    let calls = 0;
    const result = await runAgentTurn({ userMessage: "Do the task", roundLimits: scenario.limits, runModelRound: async () => { calls += 1; return scenario.response; } });
    assert.ok(calls <= 3);
    assert.equal(result.runState.status, "inconclusive");
    assert.equal(result.runState.stopReason, scenario.expected);
    assert.equal(result.runState.accounting.providerAttempts, calls);
  });
}

test("thrown transient errors retry with the same prompt and bounded attempts", async () => {
  let calls = 0;
  const result = await runAgentTurn({ userMessage: "Hello", retryDelayMs: 0, runModelRound: async () => {
    if (++calls < 3) { const error = new Error("network unavailable"); error.code = "ECONNRESET"; throw error; }
    return endTurnRound("Hello");
  } });
  assert.equal(calls, 3);
  assert.equal(result.runState.status, "completed");
  assert.equal(result.runState.accounting.providerAttempts, 3);
});

test("a failed partially streamed answer is not replayed", async () => {
  let calls = 0;
  const result = await runAgentTurn({ userMessage: "Hello", runModelRound: async ({ onToken }) => {
    calls += 1; onToken("Partial"); return { error: "network unavailable", code: "ECONNRESET" };
  } });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});

test("abort interrupts retry backoff immediately", async () => {
  const controller = new AbortController();
  const waiting = waitForRetry(60000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
  assert.equal(await waitForRetry(1, controller.signal), false);
});

test("a resumed slice retains counters and receives a fresh finite slice allowance", async () => {
  const result = await runAgentTurn({ userMessage: "Continue", maxAgentRounds: 1, roundAccountingSnapshot: { operationalRounds: 9, providerAttempts: 12 }, runModelRound: async () => endTurnRound() });
  assert.equal(result.runState.status, "completed");
  assert.equal(result.runState.accounting.operationalRounds, 10);
  assert.equal(result.runState.accounting.providerAttempts, 13);
});

test("duplicate call IDs do not execute twice and all protocol outcomes have unique IDs", async () => {
  let rounds = 0;
  let executions = 0;
  const result = await runAgentTurn({ userMessage: "Run a check", tools: [{ type: "function", function: { name: "exec_command", parameters: {} } }],
    executeToolCall: async () => { executions += 1; return { ok: true, value: { stdout: "done" } }; },
    runModelRound: async () => ++rounds === 1 ? { toolCalls: [1, 2].map(() => ({ id: "same", function: { name: "exec_command", arguments: {} } })) } : endTurnRound(),
  });
  assert.equal(executions, 1);
  const outcomes = result.appendedMessages.filter((message) => message.role === "tool");
  assert.equal(new Set(outcomes.map((message) => message.tool_call_id)).size, outcomes.length);
  assert.ok(outcomes.some((message) => /DUPLICATE_TOOL_CALL_ID/.test(message.content)));
});

test("unchanged observations do not reset progress after resume or sampling clock changes", () => {
  const first = createRoundAccounting();
  first.observation("status", { ok: true, value: { alive: true, stdout: "", sampledAt: 1 } });
  first.operationalRound(); first.operationalRound();
  const resumed = createRoundAccounting({ snapshot: first.snapshot() });
  assert.equal(resumed.observation("status", { value: { sampledAt: 2, stdout: "", alive: true }, ok: true }), false);
  assert.equal(resumed.snapshot().noProgressRounds, 2);
  assert.equal(resumed.observation("status", { ok: true, value: { alive: true, stdout: "new output", sampledAt: 3 } }), true);
  assert.equal(resumed.snapshot().noProgressRounds, 0);
});

test("compaction keeps a complete batch and drops orphaned results before restoring feedback", () => {
  const calls = Array.from({ length: 6 }, (_, i) => ({ id: `call-${i}`, function: { name: "read" } }));
  const batch = [{ role: "assistant", tool_calls: calls }, ...calls.map((call) => ({ role: "tool", tool_call_id: call.id, content: "error" }))];
  assert.deepEqual(coherentTail([{ role: "user", content: "request" }, ...batch], 4), batch);
  assert.deepEqual(completeExchanges(batch.slice(-4)), []);
});

test("production checkpoint and progress contracts contain restorable accounting", async () => {
  const checkpoints = [];
  const result = await runAgentTurn({ userMessage: "Complete", checkpointRun: async (patch) => checkpoints.push(patch), runModelRound: async () => endTurnRound() });
  assert.deepEqual(checkpoints.at(-1).checkpoint.accounting, result.runState.accounting);
  assert.equal(checkpoints.at(-1).checkpoint.accounting.providerAttempts, 1);
});
