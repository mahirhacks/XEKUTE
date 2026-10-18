"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTier1ContextCoordinator, keepNewest } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const projectId = "proj_00000000-0000-4000-8000-000000009201";
const sessionId = "session_00000000-0000-4000-8000-000000009202";
const BIG = 10_000_000;

const checkpointOf = (coordinator, input = {}) => coordinator.checkpoint({
  project_id: projectId, session_id: sessionId, objective: "Review the lab range.", allow_model: false, effective_context_limit: BIG, ...input,
});

test("keepNewest keeps the last occurrence of each value and the newest entries", () => {
  assert.deepEqual(keepNewest(["a", "b", "a", "c"], 2), ["a", "c"]);
  assert.deepEqual(keepNewest(["a", "b", "a", "c"], 10), ["b", "a", "c"]);
  assert.deepEqual(keepNewest(["x", null, "", undefined, 7, "x"], 5), [7, "x"].map(String));
  assert.deepEqual(keepNewest(["a", "b"], 0), []);
  assert.deepEqual(keepNewest(["a", "b"], -3), []);
  assert.deepEqual(keepNewest(null, 3), []);
  assert.deepEqual(keepNewest([], 3), []);
});

test("once 300 facts exist, a new fact replaces the oldest instead of being discarded", async () => {
  const coordinator = createTier1ContextCoordinator();
  const seeded = Array.from({ length: 300 }, (_, index) => ({ role: "user", content: `Seed ${index}` }));
  assert.equal((await checkpointOf(coordinator, { active_conversation: seeded })).ok, true);
  const second = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "Newest finding on 10.0.0.77" }] });
  const facts = second.checkpoint.grounded_facts;
  assert.equal(facts.length, 300);
  assert.equal(facts.at(-1), "User request: Newest finding on 10.0.0.77");
  assert.equal(facts.includes("User request: Seed 299"), true);
  assert.equal(facts.includes("User request: Seed 0"), false);
});

test("significant events are merged across checkpoints, oldest first", async () => {
  const coordinator = createTier1ContextCoordinator();
  await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "scan" }], tool_events: [{ tool_name: "nmap_scan", outcome: "success" }] });
  const second = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "fuzz" }], tool_events: [{ tool_name: "ffuf_scan", outcome: "failure" }] });
  assert.deepEqual(second.checkpoint.significant_events, ["nmap_scan: success", "ffuf_scan: failure"]);
});

test("a repeated event moves to its newest position instead of piling up", async () => {
  const coordinator = createTier1ContextCoordinator();
  const events = (names) => names.map((tool_name) => ({ tool_name, outcome: "success" }));
  await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "a" }], tool_events: events(["nmap_scan", "ffuf_scan"]) });
  const second = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "b" }], tool_events: events(["nmap_scan"]) });
  assert.deepEqual(second.checkpoint.significant_events, ["ffuf_scan: success", "nmap_scan: success"]);
});

test("unresolved work from earlier checkpoints is kept alongside the current continuation", async () => {
  const coordinator = createTier1ContextCoordinator();
  const workflow = (action) => ({ state: "active", objective: "Review", continuation_point: { next_action: action } });
  await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "a" }], current_workflow: workflow("Test the login form on 10.0.0.5") });
  const second = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "b" }], current_workflow: workflow("Review the TLS configuration") });
  assert.deepEqual(second.checkpoint.unresolved_work, ["Test the login form on 10.0.0.5", "Review the TLS configuration"]);
});

test("under a tiny budget the newest facts survive, the oldest go, and every constraint stays", async () => {
  const coordinator = createTier1ContextCoordinator();
  const tools = Array.from({ length: 200 }, (_, index) => ({ tool_name: "nmap", outcome: "success", safe_excerpt: `finding-${index}-${"x".repeat(400)}` }));
  const result = await checkpointOf(coordinator, {
    active_conversation: [{ role: "user", content: "scan" }], tool_events: tools, constraints: ["no DoS", "no prod DB"], effective_context_limit: 20_000,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.checkpoint.constraints, ["no DoS", "no prod DB"]);
  const facts = result.checkpoint.grounded_facts;
  assert.equal(facts.at(-1).includes("finding-199-"), true);
  assert.equal(facts.some((fact) => fact.includes("finding-0-")), false);
  assert.ok(facts.length > 0 && facts.length < 200);
  assert.ok(result.trimmed.grounded_facts > 0, "the loss is reported");
});

test("under pressure facts are shed before events, because an event is the cheap record of what was tried", async () => {
  const coordinator = createTier1ContextCoordinator();
  const tools = Array.from({ length: 60 }, (_, index) => ({ tool_name: `tool_${index}`, outcome: "success", safe_excerpt: `result-${index}-${"y".repeat(300)}` }));
  const result = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "scan" }], tool_events: tools, effective_context_limit: 20_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checkpoint.significant_events.length, 60, "every event is still there");
  assert.equal(result.checkpoint.significant_events.at(-1), "tool_59: success");
  assert.ok(result.checkpoint.grounded_facts.length < 60);
});

test("constraints are shortened as a last resort and are never dropped", async () => {
  const coordinator = createTier1ContextCoordinator();
  const constraints = Array.from({ length: 6 }, (_, index) => `restriction ${index} ${"z".repeat(1_000)}`);
  const result = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "scan" }], constraints, effective_context_limit: 20_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checkpoint.constraints.length, 6);
  assert.ok(result.checkpoint.constraints.every((entry) => entry.length <= 240));
  assert.equal(result.checkpoint.constraints[0].startsWith("restriction 0"), true);
  assert.equal(result.trimmed.constraintsTruncated, 240);
});

test("a checkpoint that cannot fit its budget is refused and the ledger is kept", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [{ role: "user", content: "keep me" }];
  const constraints = Array.from({ length: 200 }, (_, index) => `restriction ${index} ${"z".repeat(1_800)}`);
  const result = await checkpointOf(coordinator, { active_conversation: ledger, constraints, effective_context_limit: 20_000 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MEMORY_CHECKPOINT_BUDGET_EXCEEDED");
  assert.equal(result.activePreserved, true);
  assert.equal(coordinator.state(projectId, sessionId).summary, null, "nothing was stored");
});

test("the objective keeps its newest steering at the tail when it is cut", async () => {
  const coordinator = createTier1ContextCoordinator();
  const objective = `START ${"a".repeat(14_000)} END-OF-INPUTS skip 10.0.0.9`;
  const result = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "scan" }], objective });
  assert.equal(result.ok, true);
  assert.equal(result.checkpoint.objective.startsWith("START"), true);
  assert.equal(result.checkpoint.objective.endsWith("END-OF-INPUTS skip 10.0.0.9"), true);
  assert.ok(result.checkpoint.objective.length <= 8_000);

  const tight = await checkpointOf(createTier1ContextCoordinator(), { active_conversation: [{ role: "user", content: "scan" }], objective, effective_context_limit: 20_000 });
  assert.equal(tight.checkpoint.objective.endsWith("skip 10.0.0.9"), true);
  assert.ok(tight.checkpoint.objective.length <= 1_000);
});

test("an oversized tool name cannot break the checkpoint", async () => {
  const coordinator = createTier1ContextCoordinator();
  const result = await checkpointOf(coordinator, { active_conversation: [{ role: "user", content: "scan" }], tool_events: [{ tool_name: "t".repeat(5_000), outcome: "success" }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.checkpoint.grounded_facts.every((fact) => fact.length <= 2_000));
});

test("the model is shown the NEWEST window of a long ledger and told how much was omitted", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = Array.from({ length: 250 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index}` }));
  let payload = null;
  const result = await checkpointOf(coordinator, { active_conversation: ledger, allow_model: true, model: async (request) => { payload = request; return {}; } });
  assert.equal(result.ok, true);
  const messages = payload.deterministic_reduction.messages;
  assert.equal(messages.length, 100);
  assert.equal(messages[0].content, "message-150");
  assert.equal(messages.at(-1).content, "message-249");
  assert.equal(payload.deterministic_reduction.message_count, 250);
  assert.equal(payload.active_conversation.length, 100);
  assert.equal(payload.active_conversation.at(-1).content, "message-249");
  assert.deepEqual(payload.omitted_before, { messages: 150, tool_events: 0, active_conversation: 150 });
});

test("a model that returns many facts keeps all of them up to the field cap", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = Array.from({ length: 150 }, (_, index) => ({ role: "user", content: `observed host 10.1.0.${index} service ${index}` }));
  const facts = ledger.map((message) => message.content);
  const result = await checkpointOf(coordinator, { active_conversation: ledger, allow_model: true, model: async () => ({ grounded_facts: facts }) });
  assert.equal(result.ok, true);
  assert.equal(result.modelUsed, "model");
  assert.equal(result.checkpoint.grounded_facts.includes("observed host 10.1.0.149 service 149"), true, "entries past the old 100 cap survive");
});

test("model facts rank between old and new: a trim by cap removes the oldest, never this reduction's own", async () => {
  const coordinator = createTier1ContextCoordinator();
  const seeded = Array.from({ length: 300 }, (_, index) => ({ role: "user", content: `Seed ${index}` }));
  await checkpointOf(coordinator, { active_conversation: seeded });
  const result = await checkpointOf(coordinator, {
    active_conversation: [{ role: "user", content: "Newest finding on 10.0.0.77" }], allow_model: true,
    model: async () => ({ grounded_facts: ["Newest finding on 10.0.0.77 noted by the model"] }),
  });
  const facts = result.checkpoint.grounded_facts;
  assert.equal(facts.length, 300);
  assert.equal(facts.includes("User request: Newest finding on 10.0.0.77"), true);
  assert.equal(facts.includes("User request: Seed 0"), false);
});

test("the checkpoint call is told why it runs, and the completed event says whether the task was mid-flight", async () => {
  const inner = createTier1ContextCoordinator();
  const reasons = [];
  const tier1 = {
    ...inner,
    pressure: (input) => ({ ...inner.pressure(input), threshold: 0 }),
    checkpoint: (input) => { reasons.push(input.reason); return inner.checkpoint(input); },
  };
  const events = [];
  const result = await runAgentTurn({
    workspace: "", model: "local:small", numCtx: 32_768, contextBudget: 32_768, tools: [], mode: "ask", modeFamily: "assist",
    projectId, memorySessionId: sessionId, tier1Context: tier1, userMessage: "Summarize the findings", chatHistory: [],
    sendEvent: (event) => events.push(event),
    async runModelRound() { return { ok: true, fullText: "Done.", toolCalls: [endTurnCall()], finishReason: "stop" }; },
    async executeToolCall() { return { ok: true, value: {} }; },
  });
  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  const completed = events.filter((event) => event.type === "context_checkpoint" && event.status === "completed");
  assert.ok(completed.length >= 1);
  const beforeModel = completed.find((event) => event.reason === "before_model_call");
  assert.ok(beforeModel, "a checkpoint ran before the first model call");
  assert.equal(beforeModel.midTask, true);
  assert.equal(beforeModel.modelUsed, "deterministic");
  assert.equal(typeof beforeModel.pressureTokens, "number");
  assert.deepEqual(beforeModel.trimmed, {});
  assert.ok(reasons.includes("before_model_call"));
  const atEnd = completed.find((event) => event.reason === "block_complete");
  if (atEnd) assert.equal(atEnd.midTask, false, "end of turn is a real boundary");
});
