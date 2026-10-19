"use strict";

// Drives whole agent runs with a scripted model that mixes real tool work with
// random release_blocks / recall_block calls, under policies that force
// automatic release and checkpoints. Every provider payload and every meter
// update is checked against the coordinator.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createReleaseBlocksTool, createRecallBlockTool } = require("../src/agent/tools/process/context-blocks.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000007201";
const sessionId = "session_00000000-0000-4000-8000-000000007202";

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const definition = (adapter) => ({ type: "function", function: { name: adapter.name, description: adapter.description, parameters: adapter.inputSchema } });
const TOOLS = [definition(createReleaseBlocksTool()), definition(createRecallBlockTool()), { type: "function", function: { name: "exec_command", description: "run a command", parameters: {} } }];
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function history(turns, random) {
  return Array.from({ length: turns }, (_, turn) => [
    { role: "user", content: `Question ${turn}: enumerate 10.0.${turn}.1` },
    { role: "assistant", content: `Answer ${turn}: ${"port detail ".repeat(10 + Math.floor(random() * 60))}` },
  ]).flat();
}

function toolEnvelope(message) {
  try {
    const envelope = JSON.parse(message.content);
    const payload = typeof envelope.payload === "string" && envelope.payload ? JSON.parse(envelope.payload) : {};
    return { ok: envelope.ok, errorCode: envelope.errorCode, ...payload };
  } catch { return null; }
}

function checkPayload(messages, prompt, at) {
  const calls = new Set();
  const answered = new Set();
  for (const message of messages) {
    if (message.role === "assistant") for (const toolCall of message.tool_calls || []) calls.add(toolCall.id);
    if (message.role === "tool") {
      assert.ok(calls.has(message.tool_call_id), `${at}: tool result ${message.tool_call_id} follows its call`);
      assert.equal(answered.has(message.tool_call_id), false, `${at}: ${message.tool_call_id} is answered once`);
      answered.add(message.tool_call_id);
    }
  }
  for (const id of calls) assert.ok(answered.has(id), `${at}: call ${id} has a result`);
  assert.equal(messages.filter((message) => message.role === "user" && message.content === prompt).length, 1, `${at}: the live prompt is present once`);
  const tombstones = messages.map((message) => /^\[Block (\d+) released/.exec(String(message.content || ""))?.[1]).filter(Boolean).map(Number);
  assert.equal(new Set(tombstones).size, tombstones.length, `${at}: each released block has one tombstone`);
}

const CASES = [1, 4, 9, 16, 25, 36].map((seed) => ({ seed, turns: null })).concat([{ seed: 49, turns: 1_100 }, { seed: 64, turns: 1_050 }]);
const totals = { checkpoints: 0, released: 0, recalled: 0, pressure: 0 };

for (const { seed, turns } of CASES) {
  test(`random block tool use under release and checkpoint pressure keeps every payload valid (seed ${seed}${turns ? `, ${turns} prior turns` : ""})`, async () => {
    const random = rng(seed);
    const inner = createTier1ContextCoordinator();
    // Forces a checkpoint at random pressure checks, on top of the real trigger.
    let forceCheckpoint = false;
    const tier1 = { ...inner, pressure: (input) => (forceCheckpoint ? { ...inner.pressure(input), threshold: 0 } : inner.pressure(input)) };
    const events = [];
    const payloads = [];
    const prompt = `Continue the assessment (seed ${seed})`;
    const outcomes = { released: 0, recalled: 0, recallFailed: 0, rejected: 0, executed: 0 };
    const releasedOpeners = new Map();
    let round = 0;
    const rounds = 14 + Math.floor(random() * 10);
    const result = await runAgentTurn({
      workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: TOOLS, mode: "agent", modeFamily: "assist",
      projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: prompt, chatHistory: history(turns || 20 + Math.floor(random() * 30), random),
      contextReleasePolicy: { triggerRatio: 0.2 + random() * 0.3, targetRatio: 0.1, keepRecent: 1 + Math.floor(random() * 2), minBlockTokens: 0 },
      sendEvent: (event) => events.push(event),
      async runModelRound(payload) {
        payloads.push(payload.messages.map((message) => ({ ...message })));
        const at = `seed ${seed} round ${round}`;
        checkPayload(payload.messages, prompt, at);
        // Read back what the previous round's block tool did.
        const last = payload.messages.filter((message) => message.role === "tool").at(-1);
        const previous = last && toolEnvelope(last);
        if (previous?.operation === "release") {
          for (const entry of previous.released || []) {
            outcomes.released += 1;
            const block = tier1.activeBlocks(projectId, sessionId).find((candidate) => candidate.index === entry.index);
            if (block) assert.equal(block.state, "evicted", `${at}: block ${entry.index} reported released is a tombstone`);
          }
          outcomes.rejected += (previous.rejected || []).length;
        }
        if (previous?.operation === "recall") outcomes.recalled += 1;
        if (previous && previous.ok === false && last.content.includes("recall")) outcomes.recallFailed += 1;

        round += 1;
        forceCheckpoint = random() < 0.2;
        if (round > rounds) return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" };
        const blocks = tier1.activeBlocks(projectId, sessionId);
        const roll = random();
        const id = `r${round}`;
        if (roll < 0.4) return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "exec_command", { command: `scan ${round}` })] };
        if (roll < 0.65) {
          const picks = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ index: blocks[Math.floor(random() * blocks.length)]?.index ?? 0 }));
          for (const pick of picks) {
            const block = blocks.find((candidate) => candidate.index === pick.index && candidate.state === "active");
            if (block) releasedOpeners.set(pick.index, String(block.messages[0].content || ""));
          }
          return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "release_blocks", { operation: "release", blocks: picks })] };
        }
        if (roll < 0.85) {
          const released = blocks.filter((block) => block.state === "evicted");
          const index = released.length ? released[Math.floor(random() * released.length)].index : Math.floor(random() * 5);
          return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "recall_block", { index })] };
        }
        return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "release_blocks", { operation: "list" })] };
      },
      async executeToolCall({ toolCall }) {
        outcomes.executed += 1;
        return { ok: true, value: { stdout: `scan output ${toolCall.id} ${"open port ".repeat(80 + Math.floor(random() * 400))}`, exitCode: 0 } };
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error || ""));
    totals.checkpoints += events.filter((event) => event.type === "context_checkpoint" && event.status === "completed").length;
    totals.pressure += events.filter((event) => event.type === "context_release" && event.status === "completed" && event.reason === "pressure").length;
    totals.released += outcomes.released;
    totals.recalled += outcomes.recalled;

    // Every recall of a block this run saw released returned that block.
    for (const [index, payload] of payloads.entries()) {
      for (const message of payload.filter((entry) => entry.role === "tool")) {
        const envelope = toolEnvelope(message);
        if (envelope?.operation !== "recall") continue;
        const opener = releasedOpeners.get(envelope.index);
        if (opener && envelope.transcript) assert.ok(envelope.transcript.includes(opener.slice(0, 40)), `seed ${seed} payload ${index}: recall of ${envelope.index} returns its own turn`);
      }
    }

    // The meter's block list always names blocks the coordinator has, in order.
    const usages = events.filter((event) => event.type === "context_usage" && Array.isArray(event.usage?.blocks));
    assert.ok(usages.length > 0, "the meter was updated");
    const finalBlocks = tier1.activeBlocks(projectId, sessionId);
    const lastUsage = usages.at(-1).usage.blocks;
    assert.deepEqual(lastUsage.map((row) => row.index), finalBlocks.map((block) => block.index).slice(-lastUsage.length), `seed ${seed}: the last meter update matches the ledger`);
    for (const row of lastUsage) {
      const block = finalBlocks.find((candidate) => candidate.index === row.index);
      assert.equal(row.state === "released", block.state === "evicted", `seed ${seed}: meter state of block ${row.index}`);
    }
    for (const usage of usages) {
      const indexes = usage.usage.blocks.map((row) => row.index);
      assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, `seed ${seed}: meter rows ascend`);
      assert.equal(new Set(indexes).size, indexes.length, `seed ${seed}: meter rows are unique`);
    }
    // Releases the chat was told about are exactly the releases that happened.
    const notices = events.filter((event) => event.type === "context_release" && event.status === "completed").flatMap((event) => event.indices);
    assert.equal(new Set(notices).size, notices.length, `seed ${seed}: a block is announced as released once`);
    assert.ok(outcomes.executed > 0 && outcomes.released + notices.length > 0, `seed ${seed}: the run exercised work and release ${JSON.stringify(outcomes)}`);
  });
}

test("the runs together checkpointed, released by pressure and by the model, and recalled", () => {
  // Guards the fuzz itself: a run that stops reaching a path stops testing it.
  for (const [name, total] of Object.entries(totals)) assert.ok(total > 2, `${name}: ${JSON.stringify(totals)}`);
});

const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");

// The production path: the session supervisor admits the run, and operator
// steering arrives while blocks are released and checkpoints run.
for (const seed of [5, 12, 31, 77]) {
  test(`steering that arrives mid-run stays in context through releases and checkpoints (seed ${seed})`, async (t) => {
    const random = rng(seed);
    const fixture = sessionFixture(t);
    const runtime = createAgentSessionRuntime({ store: fixture.store, emit: () => {} });
    const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
    const prompt = `Assess the staging hosts (seed ${seed})`;
    const admitted = await runtime.admit({ ...location, runId: `run-${seed}`, userMessage: prompt, inputId: "initial", binding: { provider: "ollama", model: "local:small" } });
    assert.equal(admitted.ok, true, admitted.error);
    const inner = createTier1ContextCoordinator();
    let forceCheckpoint = false;
    const tier1 = { ...inner, pressure: (input) => (forceCheckpoint ? { ...inner.pressure(input), threshold: 0 } : inner.pressure(input)) };
    const events = [];
    const steering = [];
    let round = 0;
    const rounds = 12 + Math.floor(random() * 8);
    const result = await runAgentTurn({
      workspace: fixture.workspace, model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: TOOLS, mode: "agent", modeFamily: "assist",
      projectId, memorySessionId: sessionId, tier1Context: tier1,
      userMessage: admitted.task.objective, runId: admitted.runId, initialInputId: admitted.initialInputId, liveInput: admitted.liveInput, engineSnapshot: admitted.engineSnapshot,
      chatHistory: [...history(15 + Math.floor(random() * 20), random), ...admitted.chatHistory],
      contextReleasePolicy: { triggerRatio: 0.2 + random() * 0.3, targetRatio: 0.1, keepRecent: 1, minBlockTokens: 0 },
      sendEvent: (event) => events.push(event),
      async runModelRound(payload) {
        const at = `seed ${seed} round ${round}`;
        checkPayload(payload.messages, prompt, at);
        const texts = payload.messages.map((message) => String(message.content || ""));
        for (const text of steering) assert.equal(texts.filter((entry) => entry.includes(text)).length >= 1, true, `${at}: steering "${text}" is still in context`);
        for (const text of texts) {
          const startedBy = /^\[Block \d+ released from context: .*started by "([^"]*)"/.exec(text)?.[1] || "";
          assert.equal(Boolean(startedBy) && (prompt.startsWith(startedBy) || steering.some((entry) => entry.startsWith(startedBy))), false, `${at}: a task message was never released`);
        }
        round += 1;
        forceCheckpoint = random() < 0.25;
        if (random() < 0.3 && round <= rounds) {
          const text = `Steer ${seed}-${round}: also check 10.7.${round}.1`;
          const receipt = await runtime.receive({ ...location, input: { id: `steer-${round}`, text } });
          if (receipt.durable) steering.push(text);
        }
        if (round > rounds) return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" };
        const blocks = tier1.activeBlocks(projectId, sessionId);
        const roll = random();
        const id = `s${round}`;
        if (roll < 0.5) return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "exec_command", { command: `scan ${round}` })] };
        if (roll < 0.8) return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "release_blocks", { operation: "release", blocks: [{ index: blocks[Math.floor(random() * blocks.length)]?.index ?? 0 }] })] };
        return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: [call(id, "recall_block", { index: Math.floor(random() * 10) })] };
      },
      async executeToolCall() { return { ok: true, value: { stdout: `open port ${"tcp ".repeat(100 + Math.floor(random() * 500))}`, exitCode: 0 } }; },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error || ""));
    assert.ok(events.some((event) => event.type === "context_checkpoint" && event.status === "completed"), `seed ${seed}: a checkpoint ran`);
    assert.ok(steering.length > 0, `seed ${seed}: steering arrived`);
  });
}
