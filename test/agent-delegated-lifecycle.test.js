"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentRunHandlerFixture, deferred, tick } = require("./helpers/agent-run-handler.js");
const { createRuntimeDelegationProvider } = require("../src/agent/runtime/delegation-provider.js");
const { createDelegatedChildStore } = require("../src/agent/runtime/delegated-child-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createTask, acceptRoutes, receiveInput } = require("../src/agent/runtime/session-input.js");
const end = (id) => ({ id, type: "function", function: { name: "end_turn", arguments: { status: "stop" } } });
async function until(predicate) { for (let attempt = 0; attempt < 500; attempt++) { const value = predicate(); if (value) return value; await tick(); } throw new Error("Lifecycle did not reach the expected checkpoint"); }

for (const terminalPriorTask of [false, true]) test(`cold unread receipt starts execution after crash, prior task completed=${terminalPriorTask}`, async (t) => {
  const storage = sessionFixture(t); const location = { workspace: "", sessionId: storage.sessionId };
  const previous = createAgentSessionRuntime({ store: storage.store });
  if (terminalPriorTask) {
    const old = await previous.admit({ ...location, runId: "old", userMessage: "Old work", inputId: "old-input" });
    await old.liveInput.boundary({ revision: 0 });
    await old.liveInput.checkpoint({ revision: 1, engineSnapshot: { revision: 1 }, appendedMessages: [] });
    await old.liveInput.finalize({ revision: 1, cancellationEpoch: 0, engineSnapshot: { revision: 1 }, appendedMessages: [], status: "completed" });
  }
  await previous.receive({ ...location, input: { id: "new", text: "A new task after receipt" }, binding: { provider: "ollama", model: "captured-worker" } });
  const cold = storage.open(); const main = createAgentRunHandlerFixture();
  main.context.container.v3SessionStore = cold.store;
  main.context.tier1SessionIdForRun = (id) => id;
  main.context.senderForSession = () => main.sender;
  main.context.runAgentTurn = runAgentTurn;
  let models = 0;
  main.context.runOllamaAgentRound = async (_sender, request) => { models += 1; assert.equal(request.model, "captured-worker");
    assert.equal(request.messages.filter((message) => message.content === "A new task after receipt").length, 1);
    return { ok: true, fullText: "Recovered answer", toolCalls: [end("new-done")] }; };
  const runtime = main.installSessionRuntime(); main.installInputWake();
  const started = await main.handlers.resumeInterruptedRuns({ sender: main.sender }, [storage.sessionId]);
  assert.deepEqual([...started], [`intake:${storage.sessionId}`]);
  await until(() => runtime.supervisor.snapshot(location).control.tasks.some((task) => task.objective === "A new task after receipt" && task.status === "completed"));
  assert.equal(models, 1);
  assert.equal(runtime.supervisor.snapshot(location).batch.length, 0);
});

test("failed parent cancels its required children", async (t) => {
  const storage = sessionFixture(t); const main = createAgentRunHandlerFixture();
  main.context.container.v3SessionStore = storage.store;
  const runtime = main.installSessionRuntime();
  main.context.runAgentTurn = async (payload) => {
    const location = { workspace: "", sessionId: main.context.tier1SessionIdForRun(payload.sessionId) };
    const parent = runtime.supervisor.snapshot(location).control.tasks.find((task) => task.kind === "primary");
    await runtime.supervisor.startTask({ ...location, task: { taskId: "required-child", runId: "required-run", kind: "dependent", dependencyOfTaskId: parent.id } });
    return { ok: false, error: "model unavailable", runState: { status: "failed" }, engineSnapshot: { revision: 0 }, appendedMessages: [] };
  };
  const result = await main.invoke({ sessionId: "parent", userMessage: "Original report", model: "worker" });
  assert.equal(result.ok, false);
  const state = runtime.supervisor.snapshot({ workspace: "", sessionId: result.memorySessionId }).control;
  assert.equal(state.tasks.find((task) => task.id === "required-child").status, "stopped");
});
test("production delegation persists child steering and atomically acknowledges its canonical wave", async (t) => {
  const storage = sessionFixture(t); const main = createAgentRunHandlerFixture();
  main.context.container.v3SessionStore = storage.store;
  main.context.delegatedChildren = createDelegatedChildStore({ v3SessionStore: storage.store });
  main.context.createRuntimeDelegationProvider = createRuntimeDelegationProvider;
  main.context.runAgentTurn = runAgentTurn;
  main.context.senderForSession = () => main.sender;
  const runtime = main.installSessionRuntime();
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: { name: "delegate_agent", description: "Delegate", parameters: {} } }] });
  main.context.executeToolCall = async (request) => request.toolCall.function.name === "delegate_agent"
    ? { ok: true, value: await request.delegationProvider(request.toolCall.function.arguments, { signal: request.signal }) }
    : { ok: true };
  const entered = deferred(); const release = deferred(); let parentRounds = 0; let childRounds = 0; let dependentId;
  main.context.runOllamaAgentRound = async (_sender, request) => {
    if (request.model === "worker") {
      if (++childRounds === 1) { entered.resolve(); await release.promise; return { ok: true, fullText: '{"status":"done","summary":"Original inspection"}', toolCalls: [end("child-first")] }; }
      assert.equal(request.messages.filter((message) => message.source_message_id === "font").length, 1);
      return { ok: true, fullText: '{"status":"done","summary":"Inspection in Arial"}', toolCalls: [end("child-last")] };
    }
    if (++parentRounds === 1) return { ok: true, toolCalls: [{ id: "spawn", type: "function", function: { name: "delegate_agent", arguments: {
      task: "Inspect a report", contextPackage: { role: "agent", resources: {} }, expectedOutput: { format: "text" },
    } } }, end("parent-hold")] };
    return { ok: true, fullText: "Inspection in Arial", toolCalls: [end(`parent-${parentRounds}`)] };
  };
  const payload = { sessionId: "parent", userMessage: "Inspect the report", model: "execution", subagentModel: "worker", numCtx: 16384 };
  const original = await main.invoke(payload);
  assert.equal(original.ok, true, original.error); assert.equal(original.reason, "ORCHESTRATION_HOLD");
  await entered.promise;
  const location = { workspace: "", sessionId: original.memorySessionId };
  const child = runtime.supervisor.snapshot(location).control.tasks.find((task) => task.kind === "dependent");
  dependentId = child.id;
  assert.ok(child?.delegatedChild?.engineRef);
  const received = await main.invokeIpc("agent:submitInput", { sessionId: "parent", messageId: "font", text: "Use Arial.", targetTaskId: dependentId });
  assert.equal(received.durable, true);
  const resumed = await main.invoke({ ...payload, runId: original.runId, taskId: original.taskId }, { liveInputContinuation: true });
  assert.equal(resumed.ok, true, resumed.error); release.resolve();
  const packetId = await until(() => main.coordinator.snapshot("session:parent").resultQueue[0]);
  await until(() => runtime.supervisor.taskSnapshot({ ...location, taskId: child.id }).task.status === "completed");
  const finished = await main.invoke({ ...payload, runId: original.runId, taskId: original.taskId, continuation: { resultId: packetId } }, { automaticContinuation: true });
  assert.equal(finished.ok, true, finished.error); assert.equal(finished.reason, "ORCHESTRATION_HOLD");
  const released = await main.invoke({ ...payload, runId: original.runId, taskId: original.taskId }, { releasePendingEndTurn: true });
  assert.equal(released.ok, true, released.error); assert.equal(released.runState.status, "completed");
  assert.equal(released.finalText, "Inspection in Arial");
  const cold = storage.open().supervisor.snapshot(location).control;
  assert.equal(cold.tasks.find((task) => task.id === child.id).appliedRevision, 1);
  assert.deepEqual(cold.orchestrationWave.value.resultQueue, []);
  assert.equal(childRounds, 2);
  assert.equal(cold.routes.at(-1).method, "explicit");
  assert.ok(main.events.some((event) => event.type === "input_applied" && event.messageId === "font"));
});
