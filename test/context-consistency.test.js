"use strict";

// Regressions found by verifying checkpoint summarization against the block
// ledger: each test names the inconsistency it pins down.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createReleaseBlocksTool, createRecallBlockTool, renderReleasedBlock } = require("../src/agent/tools/process/context-blocks.js");
const { boundChildFinding } = require("../src/agent/runtime/delegation-provider.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const P = "proj_00000000-0000-4000-8000-000000009501";
const S = "session_00000000-0000-4000-8000-000000009502";
const FORK = "session_00000000-0000-4000-8000-000000009503";
const LIMIT = 10_000_000;

function turn(label, toolPairs = 0) {
  const messages = [{ role: "user", content: `Question ${label}` }];
  for (let i = 0; i < toolPairs; i += 1) {
    const id = `c-${label}-${i}`;
    messages.push({ role: "assistant", content: "", tool_calls: [{ id, function: { name: "exec_command", arguments: "{}" } }] });
    messages.push({ role: "tool", tool_call_id: id, tool_name: "exec_command", content: `r ${label} ${i}` });
  }
  messages.push({ role: "assistant", content: `Answer ${label}` });
  return messages;
}

const assemble = (coordinator, active) => coordinator.assemble({ project_id: P, session_id: S, system_prompt: "s", active_conversation: active, effective_context_limit: LIMIT });

test("a credential the redactor names only by `passphrase:` no longer fails every checkpoint", async () => {
  const coordinator = createTier1ContextCoordinator();
  coordinator.recordDirective(P, S, { text: "use passphrase: hunter2phrase for the key", sourceMessageId: "steer-1" });
  const active = [
    { role: "user", content: "check the box", source_message_id: "in-1" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "exec_command", arguments: JSON.stringify({ command: "cat /etc/app.conf" }) } }] },
    { role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true, payload: { stdout: "passphrase: hunter2phrase" } }) },
  ];
  for (let run = 0; run < 2; run += 1) {
    const result = await coordinator.checkpoint({ project_id: P, session_id: S, objective: "x", allow_model: false, effective_context_limit: LIMIT, active_conversation: active });
    assert.equal(result.ok, true, `run ${run}: ${result.code}`);
    assert.equal(JSON.stringify(result.checkpoint).includes("hunter2phrase"), false);
  }
  assert.equal(coordinator.state(P, S).directives.length, 0, "the directive is consumed instead of blocking later checkpoints");
});

test("the v2 request carries a protected prompt that is not in the ledger yet", async () => {
  let seen = "";
  const coordinator = createTier1ContextCoordinator({ policy: { requestV2: true } });
  await coordinator.checkpoint({ project_id: P, session_id: S, objective: "o", current_user_prompt: "PROMPT-MARKER-42 please", effective_context_limit: LIMIT,
    model: async (input) => { seen = JSON.stringify(input); return { grounded_facts: [] }; }, active_conversation: [{ role: "assistant", content: "hi" }] });
  assert.match(seen, /PROMPT-MARKER-42/);
});

test("a valid answer that only misses its budget is not sent for repair", async () => {
  const calls = [];
  const coordinator = createTier1ContextCoordinator();
  const constraints = Array.from({ length: 400 }, (_, i) => `constraint ${i} ${"z".repeat(150)}`);
  await coordinator.checkpoint({ project_id: P, session_id: S, objective: "o", constraints, effective_context_limit: 20_000,
    model: async (input) => { calls.push(input.repair === true ? "repair" : "first"); return { grounded_facts: [] }; },
    active_conversation: [{ role: "user", content: "go", source_message_id: "in-1" }] });
  assert.deepEqual(calls, ["first"]);
});

test("a repair call resends the redacted request it is repairing", async () => {
  const calls = [];
  const coordinator = createTier1ContextCoordinator();
  await coordinator.checkpoint({ project_id: P, session_id: S, objective: "Assess 10.0.0.5", effective_context_limit: LIMIT,
    model: async (input) => { calls.push(input); return calls.length === 1 ? "not a checkpoint" : {}; },
    active_conversation: [{ role: "user", content: "Assess 10.0.0.5 password: hunter2hunter2", source_message_id: "in-1" }] });
  const repair = calls.find((input) => input.repair === true);
  assert.ok(repair, "an answer that is not an object is repaired once");
  assert.equal(repair.objective, calls[0].objective);
  assert.deepEqual(repair.active_conversation, calls[0].active_conversation);
  assert.equal(JSON.stringify(calls).includes("hunter2hunter2"), false);
});

test("a front trim inside a block keeps that block's index, so a released block 0 stays recallable", () => {
  const coordinator = createTier1ContextCoordinator();
  assemble(coordinator, [...turn("A", 2), ...turn("B", 2), ...turn("C", 2)]);
  assert.deepEqual(coordinator.evictBlocks(P, S, [{ index: 0 }]).evicted.map((entry) => entry.index), [0]);
  coordinator.appendConversation(P, S, turn("D", 1100));
  const blocks = coordinator.activeBlocks(P, S);
  assert.equal(blocks[0].messages[0].role, "tool", "the trim cut into block D");
  assert.deepEqual(blocks.map((block) => block.index), [3]);
  coordinator.appendConversation(P, S, turn("E"));
  assert.equal(coordinator.evictBlocks(P, S, [{ index: 0 }]).evicted.length, 0, "no live block answers to index 0");
  const recalled = coordinator.recallBlock(P, S, 0);
  assert.equal(recalled.ok, true);
  assert.equal(recalled.messages[0].content, "Question A");
});

test("a pin on the live task survives the checkpoint that empties the ledger", async () => {
  // Pins are pruned when the ledger is persisted, so this needs a store.
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: { writeActive: () => ({ ok: true }), writeCheckpoint: () => ({ ok: true }) } });
  const live = { role: "user", content: "Live task", source_message_id: "msg_live" };
  const ledger = [...turn("A"), live, { role: "assistant", content: "working" }];
  assemble(coordinator, ledger);
  assert.equal(coordinator.pinBlock(P, S, 1).ok, true);
  assert.equal(coordinator.pinBlock(P, S, 0).ok, true);
  assert.equal((await coordinator.checkpoint({ project_id: P, session_id: S, allow_model: false, effective_context_limit: LIMIT })).ok, true);
  // The controller re-sends the live task carrying the index it was stamped with.
  coordinator.setActiveConversation(P, S, [{ ...live, block_index: live.block_index }]);
  assert.deepEqual(coordinator.activeBlocks(P, S).map((block) => [block.index, block.pinned]), [[1, true]]);
  assert.equal(coordinator.pinBlock(P, S, 0).ok, false, "the summarized block's pin went with it");
});

test("a forked chat can recall blocks released before a checkpoint", async () => {
  const coordinator = createTier1ContextCoordinator();
  assemble(coordinator, [...turn("A"), ...turn("B"), ...turn("C")]);
  coordinator.evictBlocks(P, S, [{ index: 0 }]);
  assert.equal((await coordinator.checkpoint({ project_id: P, session_id: S, allow_model: false, effective_context_limit: LIMIT })).ok, true);
  assert.equal(coordinator.cloneSession(P, S, FORK).ok, true);
  const recalled = coordinator.recallBlock(P, FORK, 0);
  assert.equal(recalled.ok, true, recalled.code);
  assert.equal(recalled.messages[0].content, "Question A");
});

test("recall pages through a block too large for one result", () => {
  const messages = [{ role: "user", content: "Dump" }, { role: "assistant", content: `BEGIN ${"x".repeat(3_000)} MIDDLE ${"y".repeat(3_000)} END` }];
  const first = renderReleasedBlock(messages, { maxChars: 2_000 });
  assert.equal(first.truncated, true);
  assert.doesNotMatch(first.text, /MIDDLE/);
  const pages = [];
  assert.equal(typeof first.nextOffset, "number");
  for (let offset = first.nextOffset; offset != null && pages.length < 100;) {
    const page = renderReleasedBlock(messages, { maxChars: 2_000, offset });
    pages.push(page.text);
    offset = page.nextOffset;
  }
  const full = renderReleasedBlock(messages, { maxChars: 1_000_000 }).text;
  assert.equal(full.slice(0, first.nextOffset) + pages.join(""), full);
});

test("a saved child report keeps secrets when the project turns redaction off", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-child-report-"));
  try {
    const finding = { summary: "s", evidenceRefs: [], truncated: true, fullText: "found password: hunter2hunter2 on the host" };
    for (const retainSecrets of [false, true]) {
      const bounded = boundChildFinding(finding, { workspace, childInvocationId: `child-${retainSecrets}`, retainSecrets });
      const saved = fs.readFileSync(path.join(workspace, ...bounded.evidenceRefs.at(-1).split("/")), "utf8");
      assert.equal(saved.includes("hunter2hunter2"), retainSecrets);
    }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

const tool = (adapter) => ({ type: "function", function: { name: adapter.name, description: adapter.description, parameters: adapter.inputSchema } });
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });

async function runScript(script, { tier1, chatHistory, events }) {
  let round = 0;
  return runAgentTurn({
    workspace: "", model: "local:small", numCtx: 1_000_000, contextBudget: 1_000_000,
    tools: [tool(createReleaseBlocksTool()), tool(createRecallBlockTool())],
    mode: "agent", modeFamily: "assist", projectId: P, memorySessionId: S, tier1Context: tier1,
    userMessage: "Summarize what you found", chatHistory,
    sendEvent: (event) => events.push(event),
    async runModelRound() {
      const step = script[Math.min(round, script.length - 1)];
      round += 1;
      return { ok: true, fullText: "", finishReason: "tool_calls", toolCalls: step() };
    },
    async executeToolCall() { throw new Error("context block tools never reach the execution pipeline"); },
  });
}

test("the model can release blocks after the ledger outgrows the coordinator's cap, and the chat is told", async () => {
  const tier1 = createTier1ContextCoordinator();
  const events = [];
  const chatHistory = [];
  for (let i = 0; i < 1_100; i += 1) chatHistory.push({ role: "user", content: `Question ${i}` }, { role: "assistant", content: `Answer ${i}` });
  let head = null;
  let target = null;
  const result = await runScript([
    () => {
      [head, target] = tier1.activeBlocks(P, S).slice(0, 2);
      return [call("release-1", "release_blocks", { operation: "release", blocks: [{ index: head.index }, { index: target.index }] })];
    },
    () => [endTurnCall()],
  ], { tier1, chatHistory, events });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.ok(head.index > 0, "the oldest blocks were trimmed away");
  assert.equal(head.partial, true, "the cap cut into the head block");
  // The notice is sent only for blocks actually released; the old offset bug
  // rejected every one of them as BLOCK_MISALIGNED. A head the cap cut into is
  // never released by halves.
  const notice = events.find((event) => event.type === "context_release");
  assert.deepEqual([notice?.reason, notice?.status, notice?.indices], ["model", "completed", [target.index]]);
});

test("a block whose opener the cap trimmed off is never released by halves", () => {
  // Releasing only the surviving tail would let a re-sent ledger bring the
  // opener back as a second block with the same index (see the controller fuzz).
  const coordinator = createTier1ContextCoordinator();
  const full = [...turn("Z", 400)];
  for (let i = 0; i < 700; i += 1) full.push(...turn(`B${i}`));
  coordinator.setActiveConversation(P, S, full);
  const [head, next] = coordinator.activeBlocks(P, S);
  assert.equal(head.partial, true);
  assert.equal(next.partial, undefined);
  const result = coordinator.evictBlocks(P, S, [{ index: head.index }, { index: next.index }]);
  assert.deepEqual(result.rejected, [{ index: head.index, code: "BLOCK_PARTIAL" }]);
  assert.deepEqual(result.evicted.map((entry) => entry.index), [next.index]);
});
