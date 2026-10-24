"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentRunHandlerFixture } = require("./helpers/agent-run-handler.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const savedEngine = () => ({ revision: 0, cancellationEpoch: 0,
  checklist: { main_goal: "Inspect and verify the application", items: [
    { id: "inspect", label: "Inspect application", description: "Inspect the local application.", status: "completed" },
    { id: "verify", label: "Verify behavior", description: "Verify the observed behavior.", status: "in_progress" },
  ] },
  activeSkillRecords: [{ id: "evidence-review", description: "Review evidence", instructions: "EXACT_SAVED_SKILL" }],
  skillRouterState: { decisionModel: "original-decision-model" }, successfulToolRefs: ["completed-read"],
});

test("explicit resume restores the stopped task without adding input and fences its previous writer", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const first = await runtime.admit({ ...f, runId: "run:original", userMessage: "Inspect and verify", binding: { model: "original-model" } });
  await first.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...f, taskId: first.taskId });
  assert.equal((await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true })).code, "TASK_ALREADY_TERMINAL");
  const resumed = await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true, resumeStopped: true });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.fresh, false);
  assert.equal(resumed.runId, first.runId);
  assert.equal(resumed.blockId, first.blockId);
  assert.equal(resumed.taskId, first.taskId);
  assert.deepEqual(resumed.engineSnapshot, { ...savedEngine(), cancellationEpoch: 1 });
  assert.equal(resumed.task.binding.model, "original-model");
  assert.equal(runtime.supervisor.snapshot(f).control.inputs.length, 1, "Resume is not another user prompt");
  const late = await first.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  assert.equal(late.ok, false, "the old invocation cannot replace resumed state");
  assert.deepEqual(runtime.supervisor.snapshot(f).control.tasks[0].engine, resumed.engineSnapshot);
  assert.equal((await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true, resumeStopped: true })).code, "TASK_RESUME_UNAVAILABLE");
});

test("resume cannot replace another active task or revive a completed task", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const first = await runtime.admit({ ...f, runId: "run:old", userMessage: "Old request" });
  await first.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...f, taskId: first.taskId });
  const fresh = await runtime.admit({ ...f, runId: "run:new", userMessage: "A fresh request" });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.engineSnapshot, null);
  assert.equal((await runtime.admit({ ...f, taskId: first.taskId, runId: first.runId, resume: true, resumeStopped: true })).code, "PRIMARY_TASK_BUSY");
  await runtime.cancel({ ...f, taskId: fresh.taskId });
  const missing = await runtime.admit({ ...f, taskId: "task:missing", runId: "run:missing", resume: true, resumeStopped: true });
  assert.equal(missing.code, "TASK_RESUME_UNAVAILABLE");
});

test("a fresh request after Stop can checkpoint and reach the actual model loop", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const stopped = await runtime.admit({ ...f, runId: "run:stopped", userMessage: "Earlier request" });
  await stopped.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...f, taskId: stopped.taskId });
  const fresh = await runtime.admit({ ...f, runId: "run:fresh-after-stop", userMessage: "Answer the new request" });
  let modelCalls = 0;
  const result = await runAgentTurn({ model: "execution", numCtx: 32768, mode: "agent", runId: fresh.runId,
    userMessage: fresh.task.objective, initialInputId: fresh.initialInputId, chatHistory: fresh.chatHistory,
    liveInput: fresh.liveInput, engineSnapshot: fresh.engineSnapshot,
    runModelRound: async () => { modelCalls++; return { ok: true, fullText: "The new request was answered.", toolCalls: [endTurnCall("fresh-answer")] }; },
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(modelCalls, 1);
  assert.equal(result.finalText, "The new request was answered.");
  assert.equal(result.engineSnapshot.checklist, null, "new work does not inherit the stopped checklist");
  assert.deepEqual(result.engineSnapshot.activeSkillRecords, []);
  assert.equal((await fresh.settle(result)).ok, true);
  const control = runtime.supervisor.snapshot(f).control;
  assert.equal(control.tasks.find(task => task.id === stopped.taskId).status, "stopped");
  assert.equal(control.tasks.find(task => task.id === fresh.taskId).status, "completed");
});

test("stopping a child does not invalidate its still-running parent's checkpoint", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const parent = await runtime.admit({ ...f, runId: "run:parent", userMessage: "Parent request" });
  await parent.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.supervisor.startTask({ ...f, task: { taskId: "task:child", runId: "run:child", kind: "dependent", dependencyOfTaskId: parent.taskId } });
  await runtime.cancel({ ...f, taskId: "task:child" });
  const saved = await parent.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(runtime.supervisor.taskSnapshot({ ...f, taskId: parent.taskId }).task.status, "running");
});

test("the production run endpoint answers a fresh request after a previous task was stopped", async t => {
  const f = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  const runtime = main.context.agentSessionRuntime = createAgentSessionRuntime({ store: f.store });
  main.context.container.v3SessionStore = f.store;
  main.context.runAgentTurn = runAgentTurn;
  let calls = 0;
  main.context.runOllamaAgentRound = async () => { calls++; return { ok: true, fullText: "Answered after the earlier Stop.", toolCalls: [endTurnCall("answer-new-prompt")] }; };
  const location = { workspace: "", sessionId: main.context.tier1SessionIdForRun() };
  const old = await runtime.admit({ ...location, runId: "run:stopped-before-endpoint", userMessage: "Old work" });
  await old.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...location, taskId: old.taskId });
  const result = await main.invokeIpc("agent:run", { sessionId: "fresh-ui", model: "execution", provider: "ollama", numCtx: 32768,
    userMessage: "Dig deeper into the report", userMessageId: "new-message-after-stop" });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.finalText, "Answered after the earlier Stop.");
  assert.equal(calls, 1);
  assert.equal(runtime.supervisor.taskSnapshot({ ...location, taskId: result.taskId }).task.status, "completed");
});

test("recovery can continue a task stranded before its first checkpoint after Stop", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const old = await runtime.admit({ ...f, runId: "run:before-stranded", userMessage: "Old request" });
  await old.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...f, taskId: old.taskId });
  const stranded = await runtime.admit({ ...f, runId: "run:stranded", userMessage: "The request that could not checkpoint" });
  assert.equal(stranded.engineSnapshot, null);
  const reopened = createAgentSessionRuntime({ store: f.open().store });
  const recovered = await reopened.admit({ ...f, runId: stranded.runId, taskId: stranded.taskId, resume: true });
  const result = await runAgentTurn({ model: "execution", numCtx: 32768, mode: "agent", runId: recovered.runId,
    userMessage: recovered.task.objective, initialInputId: recovered.initialInputId, chatHistory: recovered.chatHistory,
    liveInput: recovered.liveInput, engineSnapshot: recovered.engineSnapshot,
    runModelRound: async () => ({ ok: true, fullText: "Recovered the existing request.", toolCalls: [endTurnCall("finish-recovery")] }),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal((await recovered.settle(result)).ok, true);
  const state = reopened.supervisor.snapshot(f).control;
  assert.equal(state.inputs.length, 2, "recovery does not add another copy of the prompt");
  assert.equal(state.tasks.find(task => task.id === stranded.taskId).status, "completed");
});

test("the previous invocation cannot adopt a resumed task through another boundary or tool call", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const first = await runtime.admit({ ...f, runId: "run:ownership", userMessage: "Keep ownership scoped to the invocation" });
  await first.liveInput.checkpoint({ revision: 0, engineSnapshot: savedEngine(), appendedMessages: [] });
  await runtime.cancel({ ...f, taskId: first.taskId });
  const resumed = await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true, resumeStopped: true });
  assert.equal(resumed.ok, true);
  const staleBoundary = await first.liveInput.boundary({ revision: 0 });
  assert.equal(staleBoundary.ok, false);
  assert.equal(staleBoundary.aborted, true);
  const stalePlan = await first.liveInput.prepareRound({ revision: 0, result: { ok: true, toolCalls: [] }, engineSnapshot: savedEngine() });
  assert.equal(stalePlan.ok, false);
  assert.equal(stalePlan.aborted, true);
  let executions = 0;
  const staleTool = await first.execute({ toolCall: { id: "old-invocation-tool", function: { name: "read_file", arguments: { path: "NOTES.md" } } } }, async () => { executions++; return { ok: true }; });
  assert.equal(staleTool.ok, false);
  assert.equal(executions, 0);
  assert.deepEqual(runtime.supervisor.taskSnapshot({ ...f, taskId: first.taskId }).task.engine, resumed.engineSnapshot);
});

test("production Resume uses the saved task and configuration while a typed prompt starts fresh", async t => {
  const f = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.tier1BlockId = id => id || "block_00000000-0000-4000-8000-000000008102";
  main.context.agentSessionRuntime = createAgentSessionRuntime({ store: f.store });
  main.context.container.v3SessionStore = f.store;
  const calls = [];
  main.context.runAgentTurn = async request => {
    calls.push(request);
    if (calls.length === 1) return { ok: false, aborted: true, runState: { status: "stopped" }, engineSnapshot: savedEngine(), appendedMessages: [] };
    return { ok: true, finalText: "Done", runState: { status: "completed" }, engineSnapshot: request.engineSnapshot || { revision: 0 }, appendedMessages: [] };
  };
  const first = await main.invokeIpc("agent:run", { sessionId: "resume-ui", model: "original-model", provider: "ollama", numCtx: 16384, userMessage: "Inspect and verify" });
  const resumed = await main.invokeIpc("agent:run", { sessionId: "resume-ui", model: "new-preference", provider: "ollama", resumeTaskId: first.taskId });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.taskId, first.taskId);
  assert.equal(resumed.runId, first.runId);
  assert.equal(calls[1].model, "original-model");
  assert.deepEqual(calls[1].engineSnapshot.checklist, savedEngine().checklist);
  assert.deepEqual(calls[1].engineSnapshot.activeSkillRecords, savedEngine().activeSkillRecords);
  assert.equal(calls[1].userMessage, "Inspect and verify");
  await main.context.agentSessionRuntime.cancel({ workspace: "", sessionId: resumed.memorySessionId, taskId: resumed.taskId });
  const fresh = await main.invokeIpc("agent:run", { sessionId: "resume-ui", blockId: "block_00000000-0000-4000-8000-000000008199", model: "new-preference", provider: "ollama", numCtx: 16384, userMessage: "Different task", userMessageId: "fresh-message" });
  assert.equal(fresh.ok, true, fresh.error);
  assert.notEqual(fresh.taskId, first.taskId);
  assert.equal(calls[2].engineSnapshot, null);
  assert.equal(calls[2].model, "new-preference");
});

test("the actual agent loop resumes its checklist and skill instructions without replaying finished actions", async t => {
  const f = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: f.store });
  const first = await runtime.admit({ ...f, runId: "run:loop", userMessage: "Inspect the application, verify behavior, and report findings" });
  const abort = new AbortController();
  const executed = [];
  let round = 0;
  const routing = { enabled: true, freshRun: true, model: "saved-decision-model", candidates: [] };
  const argumentsFor = admission => ({ model: "execution", numCtx: 32768, mode: "agent", runId: admission.runId,
    userMessage: admission.task.objective, initialInputId: admission.initialInputId, chatHistory: admission.chatHistory,
    liveInput: admission.liveInput, engineSnapshot: admission.engineSnapshot, skillRouter: routing,
    executeToolCall: request => admission.execute(request, async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { content: "Fixture evidence" } }; }),
  });
  const read = id => ({ id, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "NOTES.md" }) } });
  const stopped = await runAgentTurn({ ...argumentsFor(first), signal: abort.signal,
    specialSkill: { manifest: { id: "evidence-review", description: "Review evidence" }, prompt: "SAVED_SKILL_INSTRUCTIONS" },
    runModelRound: async () => {
      if (++round === 1) return { fullText: "", toolCalls: [
        { id: "create-checklist", type: "function", function: { name: "manage_task_checklist", arguments: JSON.stringify({ action: "create", ...savedEngine().checklist }) } },
        read("finished-read"),
      ] };
      await runtime.cancel({ ...f, taskId: first.taskId });
      abort.abort();
      return { aborted: true, error: "Stopped by operator" };
    },
  });
  assert.equal(stopped.aborted, true);
  await first.settle(stopped);
  const resumed = await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true, resumeStopped: true });
  assert.equal(resumed.ok, true, resumed.error);
  const events = [];
  let resumedRounds = 0;
  const completed = await runAgentTurn({ ...argumentsFor(resumed), skillRouter: { ...routing, freshRun: false },
    sendEvent: event => events.push(event),
    runModelRound: async ({ messages }) => {
      assert.match(JSON.stringify(messages), /SAVED_SKILL_INSTRUCTIONS/);
      assert.match(JSON.stringify(messages), /Verify behavior/);
      return ++resumedRounds === 1 ? { fullText: "", toolCalls: [{ ...read("new-read"), function: { name: "read_file", arguments: JSON.stringify({ path: "VERIFY.md" }) } }] }
        : { fullText: "Verified the saved work.", toolCalls: [endTurnCall("finish-resumed")] };
    },
  });
  assert.equal(completed.ok, true, completed.error);
  assert.deepEqual(executed, ["finished-read", "new-read"]);
  assert.deepEqual(completed.engineSnapshot.checklist, stopped.engineSnapshot.checklist);
  assert.equal(events.some(event => event.type === "task_list" && event.tasks?.[1]?.status === "in_progress"), true);
  assert.equal(events.some(event => event.type === "skills_loaded"), false, "saved instructions remain loaded");
  assert.equal((await resumed.settle(completed)).ok, true);
  assert.equal((await runtime.admit({ ...f, runId: first.runId, taskId: first.taskId, resume: true, resumeStopped: true })).code, "TASK_RESUME_UNAVAILABLE");
});
