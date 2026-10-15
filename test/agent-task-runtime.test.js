"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { deferred } = require("./helpers/agent-run-handler.js");
const { createAgentSessionRuntime, assignTaskWave } = require("../src/agent/runtime/agent-session-runtime.js");
const { normalizeRunControl } = require("../src/agent/runtime/session-input.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createResourceReservations } = require("../src/agent/runtime/resource-reservations.js");
const end = { id: "end", type: "function", function: { name: "end_turn", arguments: '{"status":"stop"}' } };

async function setup(t) {
  const fixture = sessionFixture(t); const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const runtime = createAgentSessionRuntime({ store: fixture.store });
  let main = await runtime.admit({ ...location, runId: "main", userMessage: "Write a report", inputId: "report" });
  await main.liveInput.boundary({ revision: 0 }); await main.liveInput.checkpoint({ revision: 1, engineSnapshot: { revision: 1 }, appendedMessages: [] });
  main = await runtime.admit({ ...location, runId: "main", resume: true });
  return { fixture, location, runtime, main };
}
function run(admission, runModelRound, extra = {}) {
  return runAgentTurn({ model: "execution", numCtx: 16384, runId: admission.runId, userMessage: admission.task.objective,
    initialInputId: admission.initialInputId, chatHistory: admission.chatHistory, engineSnapshot: admission.engineSnapshot,
    liveInput: admission.liveInput, runModelRound, executeToolCall: async () => ({ ok: true }), ...extra });
}
test("provider tool IDs may repeat in separate durable execution rounds", async (t) => {
  const { main } = await setup(t);
  const call = { id: "provider-call", function: { name: "read_file", arguments: { path: "report.txt" } } };
  let effects = 0;
  const perform = async () => ({ ok: true, count: ++effects });
  const first = await main.liveInput.prepareRound({ revision: 1, result: { ok: true, toolCalls: [call] }, engineSnapshot: { revision: 1 } });
  assert.equal((await main.execute({ toolCall: call }, perform)).count, 1);
  assert.equal((await main.execute({ toolCall: call }, perform)).count, 1);
  await main.liveInput.checkpoint({ revision: 1, engineSnapshot: { revision: 1 }, consumedPlanId: first.plan.id, appendedMessages: [] });
  await main.liveInput.prepareRound({ revision: 1, result: { ok: true, toolCalls: [call] }, engineSnapshot: { revision: 1 } });
  assert.equal((await main.execute({ toolCall: call }, perform)).count, 2);
});

test("initial child checkpoint reports application to the parent receipt", async (t) => {
  const fixture = sessionFixture(t); const events = [];
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: (event) => events.push(event) });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const main = await runtime.admit({ ...location, runId: "initial", userMessage: "Write a report", inputId: "report" });
  const result = await run(main, async () => ({ ok: true, fullText: "Report", toolCalls: [end] }));
  assert.equal(result.ok, true);
  assert.equal(events.filter((event) => event.type === "input_applied" && event.messageId === "report").length, 1);
  assert.equal(events.find((event) => event.type === "input_applied").sessionId, fixture.sessionId);
});

test("new main task archives its prior wave and ignores old child wave updates", async (t) => {
  const { main, runtime, location, fixture } = await setup(t);
  await fixture.store.transactSession(location.workspace, location.sessionId, (document) => { assignTaskWave(document.run_control, "main", { resultQueue: ["old-result"] }); return { ok: true }; });
  await main.liveInput.finalize({ revision: 1, cancellationEpoch: 0, engineSnapshot: { revision: 1 }, appendedMessages: [], status: "completed" });
  const next = await runtime.admit({ ...location, runId: "next-main", userMessage: "Fresh work", inputId: "fresh" });
  assert.equal(next.fresh, true);
  await fixture.store.transactSession(location.workspace, location.sessionId, (document) => { assignTaskWave(document.run_control, "main", { resultQueue: ["late-old-result"] }); return { ok: true }; });
  const cold = fixture.open().supervisor.snapshot(location).control;
  assert.equal(cold.ownerTaskId, next.taskId);
  assert.equal(cold.orchestrationWave, null);
  assert.deepEqual(cold.tasks.find((task) => task.id === main.taskId).orchestrationWave.value.resultQueue, ["late-old-result"]);
});

test("operation receipts prevent replay and unknown outcomes require reconciliation", async (t) => {
  const state = await setup(t); const request = { toolCall: { id: "write", function: { name: "apply_patch", arguments: { patch: "exact" } } }, taskRevision: 1 };
  let executions = 0;
  const first = await state.main.execute(request, async () => { executions++; return { ok: true, changed: "file" }; });
  assert.equal(first.ok, true);
  const restored = await createAgentSessionRuntime({ store: state.fixture.open().store }).admit({ ...state.location, runId: "main", resume: true });
  assert.deepEqual(await restored.execute(request, () => assert.fail("completed effect must not replay")), first);
  assert.equal(executions, 1);
  const uncertain = { ...request, toolCall: { ...request.toolCall, id: "unknown" } };
  const outcome = await restored.execute(uncertain, async () => { state.fixture.mode.available = false; return { ok: true }; });
  assert.equal(outcome.errorCode, "ACTION_OUTCOME_UNKNOWN"); state.fixture.mode.available = true;
  const cold = await createAgentSessionRuntime({ store: state.fixture.open().store }).admit({ ...state.location, runId: "main", resume: true });
  assert.equal((await cold.execute(uncertain, () => assert.fail("unknown effect must not replay"))).errorCode, "ACTION_OUTCOME_UNKNOWN");
});
test("cold unknown process ownership blocks writes instead of replaying or killing", async () => {
  const reservations = createResourceReservations({ listProcesses: async () => [{ status: "reconciliation_required", runId: "other" }] });
  const result = await reservations.execute({ workspace: "G:/one", runId: "main", toolCall: { function: { name: "apply_patch" } } }, () => assert.fail());
  assert.equal(result.errorCode, "RESOURCE_RECONCILIATION_REQUIRED");
});
test("cancelling a resource waiter keeps later writers behind the current owner", async () => {
  const reservations = createResourceReservations(); const entered = deferred(); const finish = deferred(); const order = [];
  const toolCall = { function: { name: "apply_patch" } };
  const owner = reservations.execute({ workspace: "G:/one", runId: "owner", toolCall }, async () => { entered.resolve(); await finish.promise; order.push("owner-done"); });
  await entered.promise;
  const signal = new AbortController();
  const cancelled = reservations.execute({ workspace: "G:/one", runId: "cancelled", toolCall, signal: signal.signal }, () => assert.fail());
  signal.abort(); assert.equal((await cancelled).errorCode, "RESOURCE_WAIT_STOPPED");
  const third = reservations.execute({ workspace: "G:/one", runId: "third", toolCall }, async () => order.push("third"));
  await new Promise(setImmediate); assert.deepEqual(order, []);
  finish.resolve(); await Promise.all([owner, third]); assert.deepEqual(order, ["owner-done", "third"]);
});
test("paused engine snapshots survive settlement and resume without resetting revision", async (t) => {
  const state = await setup(t);
  const first = await run(state.main, async () => ({ ok: true, toolCalls: [end] }), { orchestrationHold: () => true });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.reason, "ORCHESTRATION_HOLD"); assert.ok(first.engineSnapshot);
  assert.equal((await state.main.settle(first)).ok, true);
  const admitted = await createAgentSessionRuntime({ store: state.fixture.open().store }).admit({ ...state.location, runId: "main", resume: true });
  const resumed = await run(admitted, async () => ({ ok: true, fullText: "Done", toolCalls: [end] }));
  assert.equal(resumed.ok, true, resumed.error); assert.equal(resumed.finalText, "Done");
});
test("exhausted tasks settle as inconclusive and release the main task identity", async (t) => {
  const state = await setup(t);
  const result = await run(state.main, async () => assert.fail(), { engineSnapshot: { revision: 1, accounting: { noProgressRounds: 12 } } });
  assert.equal(result.runState.status, "inconclusive");
  assert.equal((await state.main.settle(result)).ok, true);
  const snapshot = state.runtime.supervisor.snapshot(state.location).control;
  assert.equal(snapshot.tasks[0].status, "inconclusive"); assert.equal(snapshot.activeTaskId, "");
  const fresh = await state.runtime.admit({ ...state.location, runId: "fresh", userMessage: "Write a shorter report", inputId: "short" }); assert.equal(fresh.ok, true, fresh.error);
});
test("admission rejects conflicting run identities and new text under an existing task ID", async (t) => {
  const state = await setup(t);
  const conflict = await state.runtime.admit({ ...state.location, runId: "new", taskId: state.main.taskId, userMessage: "Delete report", inputId: "delete" });
  assert.equal(conflict.code, "SESSION_TASK_CONFLICT");
  assert.equal(state.runtime.supervisor.snapshot(state.location).control.arrival, 1);
});
test("a saved ordinary tool round resumes after its first effect without another model call or effect replay", async (t) => {
  const state = await setup(t); const result = { ok: true, toolCalls: [
    { function: { name: "read_file", arguments: { path: "one.txt" } } },
    { function: { name: "read_file", arguments: { path: "two.txt" } } }, end,
  ] };
  const prepared = await state.main.liveInput.prepareRound({ revision: 1, result, engineSnapshot: { revision: 1, accounting: { providerAttempts: 1 } } });
  const firstCall = prepared.plan.result.toolCalls[0]; let effects = 0;
  await state.main.execute({ taskRevision: 1, toolCall: firstCall }, async () => { effects++; return { ok: true, content: "first" }; });
  const runtime = createAgentSessionRuntime({ store: state.fixture.open().store });
  const restored = await runtime.admit({ ...state.location, runId: "main", resume: true });
  const resumed = await run(restored, () => assert.fail("ordinary accepted round must not call model again"), {
    executeToolCall: (request) => restored.execute(request, async () => { effects++; return { ok: true, content: "second" }; }),
  });
  assert.equal(resumed.ok, true, resumed.error); assert.equal(effects, 2);
  const tools = resumed.appendedMessages.filter((message) => message.role === "tool");
  assert.equal(tools[0].tool_call_id, firstCall.id); assert.equal(new Set(tools.map((message) => message.tool_call_id)).size, 3);
});


test("a sub-prompt reaches the main task at the next boundary without a routing model call", async (t) => {
  const state = await setup(t);
  await state.runtime.receive({ ...state.location, input: { id: "echo", text: "also run an echo command" } });
  const applied = await state.main.liveInput.boundary({ revision: 1, plan: () => assert.fail("routing needs no model call") });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.deliveries.map((delivery) => [delivery.id, delivery.text]), [["echo", "also run an echo command"]]);
  const control = state.runtime.supervisor.snapshot(state.location).control;
  assert.equal(control.routes.at(-1).method, "main");
  assert.equal(control.tasks.length, 1);
});
test("input sent inside a delegated child's chat steers that child, and a stopped child's input is cancelled", async (t) => {
  const state = await setup(t);
  const child = await state.runtime.supervisor.startTask({ ...state.location, task: { taskId: "task:child", runId: "run:child", kind: "dependent", objective: "Fix the backend", dependencyOfTaskId: state.main.taskId } });
  assert.equal(child.ok, true, child.error);
  await state.runtime.receive({ ...state.location, input: { id: "blue", text: "Use blue", targetTaskId: "task:child" } });
  await state.main.liveInput.boundary({ revision: 1 });
  let control = state.runtime.supervisor.snapshot(state.location).control;
  assert.deepEqual([control.routes.at(-1).method, control.routes.at(-1).taskId], ["explicit", "task:child"]);
  await state.runtime.receive({ ...state.location, input: { id: "green", text: "Use green", targetTaskId: "task:child" } });
  await state.runtime.cancel({ ...state.location, taskId: "task:child" });
  const applied = await state.main.liveInput.boundary({ revision: 1 });
  assert.equal(applied.ok, true, applied.error);
  control = state.runtime.supervisor.snapshot(state.location).control;
  assert.equal(control.arrival, control.routed);
  assert.equal(control.routes.at(-1).method, "cancelled");
});
test("a saved independent task that never finished loads as stopped", () => {
  const control = normalizeRunControl({ version: 1, arrival: 0, routed: 0, cancellationEpoch: 0, activeTaskId: "", inputs: [], routes: [],
    tasks: [{ id: "task:old", runId: "run:old", kind: "independent", status: "running", revision: 0, appliedRevision: 0, deliveries: [] }],
    dispatches: [{ id: "dispatch:task:old", taskId: "task:old", status: "pending" }] });
  assert.equal(control.tasks[0].status, "stopped");
  assert.equal(control.dispatches[0].status, "failed");
});
test("workspace edits serialize, commands start after them, and reads and other workspaces run alongside", async () => {
  const reservations = createResourceReservations(); const started = deferred(); const finish = deferred(); const order = [];
  const mutate = { function: { name: "apply_patch", arguments: {} } };
  const first = reservations.execute({ workspace: "G:/one", runId: "a", toolCall: mutate }, async () => { order.push("first"); started.resolve(); await finish.promise; order.push("first-done"); });
  await started.promise;
  const second = reservations.execute({ workspace: "G:/one", runId: "b", toolCall: mutate }, async () => order.push("second"));
  await reservations.execute({ workspace: "G:/one", runId: "b", toolCall: { function: { name: "read_file" } } }, async () => order.push("read"));
  const command = reservations.execute({ workspace: "G:/one", runId: "b", toolCall: { function: { name: "exec_command", arguments: { command: "sleep 30" } } } }, async () => order.push("command"));
  await reservations.execute({ workspace: "G:/other", runId: "b", toolCall: mutate }, async () => order.push("other"));
  assert.deepEqual(order, ["first", "read", "other"]); finish.resolve(); await Promise.all([first, second, command]);
  assert.deepEqual(order, ["first", "read", "other", "first-done", "second", "command"]);
});
test("a long command does not hold the workspace for other commands", async () => {
  const reservations = createResourceReservations({ listProcesses: async () => [{ status: "running", runId: "main" }] });
  const sleeping = deferred(); const order = [];
  const sleep = { function: { name: "exec_command", arguments: { command: "sleep 30" } } };
  const one = reservations.execute({ workspace: "G:/one", runId: "main", toolCall: sleep }, async () => { order.push("one"); await sleeping.promise; });
  await reservations.execute({ workspace: "G:/one", runId: "main", toolCall: sleep }, async () => order.push("two"));
  await reservations.execute({ workspace: "G:/one", runId: "child", toolCall: { function: { name: "apply_patch" } } }, async () => order.push("child-edit"));
  assert.deepEqual(order, ["one", "two", "child-edit"]);
  sleeping.resolve(); await one;
});
