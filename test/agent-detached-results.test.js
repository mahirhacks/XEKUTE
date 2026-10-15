"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createResourceReservations } = require("../src/agent/runtime/resource-reservations.js");
const Tunables = require("../src/agent/runtime/tunables.js");
const { deferred, createAgentRunHandlerFixture } = require("./helpers/agent-run-handler.js");

const end = (id = "end") => ({ id, type: "function", function: { name: "end_turn", arguments: '{"status":"stop"}' } });
const read = (id) => ({ id, type: "function", function: { name: "read_file", arguments: '{"path":"notes.md"}' } });
const said = (messages, pattern) => messages.some((message) => pattern.test(String(message.content || "")));

async function admittedTask(t) {
  const fixture = sessionFixture(t);
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: () => {} });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const admitted = await runtime.admit({ ...location, runId: "run-notes", userMessage: "Summarize the notes", inputId: "notes", binding: { provider: "ollama", model: "execution" } });
  assert.equal(admitted.ok, true);
  const run = (runModelRound, extra = {}) => runAgentTurn({ workspace: fixture.workspace, model: "execution", numCtx: 16384,
    userMessage: admitted.task.objective, runId: admitted.runId, initialInputId: admitted.initialInputId, chatHistory: admitted.chatHistory,
    liveInput: admitted.liveInput, engineSnapshot: admitted.engineSnapshot, runModelRound, executeToolCall: async () => ({ ok: true, value: "notes" }), ...extra });
  return { runtime, location, admitted, run };
}

function commandSession() {
  const main = createAgentRunHandlerFixture();
  return main;
}

test("a run resumed by another prompt cannot complete while an earlier detached command still runs", async (t) => {
  const fixture = sessionFixture(t);
  const main = commandSession();
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const senders = new Map();
  main.context.bindAgentSender = (sessionId, sender) => senders.set(String(sessionId), sender);
  main.context.senderForSession = (sessionId, fallback) => senders.get(String(sessionId)) || fallback;
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: {
    name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } } },
  } }] });
  main.context.container.durableProcessManager.runningCommands = () => [];
  main.installInputWake();
  const waiting = deferred(); const exit = deferred(); const resumed = deferred(); const finished = deferred();
  main.context.executeToolCall = async () => { waiting.resolve(); await exit.promise; return { ok: true, value: { mode: "command", status: "complete", exitCode: 0, stdout: "slept" } }; };
  const requests = [];
  main.context.runOllamaAgentRound = async (_sender, request) => {
    requests.push(request.messages);
    if (requests.length === 1) return { ok: true, fullText: "Starting the sleep.", toolCalls: [{ id: "sleep", type: "function", function: { name: "exec_command", arguments: { command: "sleep 30" } } }] };
    if (requests.length === 2) return { ok: true, fullText: "Echo noted.", toolCalls: [end("echo")] };
    if (requests.length === 3) {
      assert.ok(said(request.messages, /say hi/));
      resumed.resolve();
      return { ok: true, fullText: "Hi.", toolCalls: [end("hi")] };
    }
    assert.ok(said(request.messages, /finished after the round moved on/), "the late result reaches the resumed task");
    finished.resolve();
    return { ok: true, fullText: "Sleep done.", toolCalls: [end("done")] };
  };
  const operation = main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Run a 30 second sleep", model: "execution", numCtx: 16384, provider: "ollama" });
  await waiting.promise;
  await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "steer-echo", text: "also run an echo command" });
  assert.equal((await operation).commandWait, true);
  await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "steer-hi", text: "and say hi" });
  await resumed.promise;
  const settled = () => main.events.filter((event) => event.type === "parent_run_settled");
  for (let i = 0; i < 200 && !settled().length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled().at(-1)?.commandWait, true, "the resumed run parks instead of completing");
  exit.resolve();
  let timer;
  try {
    await Promise.race([finished.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("the late result never reached the task")), 5_000); })]);
  } finally { clearTimeout(timer); }
  assert.equal(requests.length, 4);
});

test("a detached call missing after a restart becomes a note to the model instead of a hang", async (t) => {
  const { admitted, run } = await admittedTask(t);
  const requests = [];
  const result = await run(async (request) => {
    requests.push(request.messages);
    return { ok: true, fullText: requests.length === 1 ? "Done." : "Rechecked.", toolCalls: [end(`end-${requests.length}`)] };
  }, { engineSnapshot: { ...(admitted.engineSnapshot || {}), pendingResults: [["result:old-run:sleep", { callId: "sleep", toolName: "exec_command" }]] } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.runState.status, "completed");
  assert.equal(requests.length, 2);
  assert.ok(said(requests[1], /exec_command call sleep never reported back because the app restarted/));
});

test("a late result that cannot be saved is retried, then reported to the model as lost", async (t) => {
  const { runtime, location, admitted, run } = await admittedTask(t);
  const savedRetry = Tunables.LATE_RESULT_RETRY_MS;
  Tunables.LATE_RESULT_RETRY_MS = [1, 1];
  t.after(() => { Tunables.LATE_RESULT_RETRY_MS = savedRetry; });
  let attempts = 0;
  const lost = deferred();
  admitted.liveInput.deliverResult = async () => {
    attempts += 1;
    if (attempts === 3) setImmediate(lost.resolve);
    return { ok: false, code: "MEMORY_SECURE_STORAGE_UNAVAILABLE", error: "storage unavailable" };
  };
  const reading = deferred(); const release = deferred();
  const requests = [];
  const first = await (async () => {
    const operation = run(async (request) => {
      requests.push(request.messages);
      if (requests.length === 1) return { ok: true, fullText: "Reading.", toolCalls: [read("slow-read")] };
      return { ok: true, fullText: "Noted.", toolCalls: [end("noted")] };
    }, { executeToolCall: async () => { reading.resolve(); await release.promise; return { ok: true, value: "notes" }; } });
    await reading.promise;
    await runtime.receive({ ...location, input: { id: "steer", text: "also list the authors" } });
    return operation;
  })();
  assert.equal(first.commandWait, true, "the task waits for the detached read");
  release.resolve();
  await lost.promise;
  assert.equal(attempts, 3);
  const resumed = await run(async (request) => {
    requests.push(request.messages);
    return { ok: true, fullText: "Handled.", toolCalls: [end(`end-${requests.length}`)] };
  }, { engineSnapshot: first.engineSnapshot });
  assert.equal(resumed.runState.status, "completed");
  assert.ok(said(requests.at(-1), /read_file call slow-read never reported back because its result could not be saved/));
});

test("tool calls in a response cut off at the output limit are not run", async (t) => {
  const { run } = await admittedTask(t);
  const executed = [];
  const requests = [];
  const result = await run(async (request) => {
    requests.push(request.messages);
    if (requests.length === 1) return { ok: true, fullText: "Reading", finishReason: "length", toolCalls: [read("cut")] };
    if (requests.length === 2) return { ok: true, fullText: "Reading again.", toolCalls: [read("whole")] };
    return { ok: true, fullText: "Summary.", toolCalls: [end()] };
  }, { executeToolCall: async (call) => { executed.push(call.id || call.callId); return { ok: true, value: "notes" }; } });
  assert.equal(result.runState.status, "completed");
  assert.ok(said(requests[1], /hit the output limit, so its tool calls \(read_file\) were not run/));
  assert.equal(executed.includes("cut"), false);
  assert.equal(executed.length, 1);
});

test("a command waits for an in-progress file edit but never for another command", async () => {
  const reservations = createResourceReservations();
  const order = [];
  const editDone = deferred();
  const call = (name) => ({ function: { name } });
  const edit = reservations.execute({ workspace: "/w", toolCall: call("apply_patch") }, async () => { order.push("edit start"); await editDone.promise; order.push("edit end"); return { ok: true }; });
  await new Promise(setImmediate);
  const sleep = deferred();
  const first = reservations.execute({ workspace: "/w", toolCall: call("exec_command") }, async () => { order.push("command 1"); await sleep.promise; return { ok: true }; });
  await new Promise(setImmediate);
  assert.deepEqual(order, ["edit start"], "the command waits for the edit");
  editDone.resolve();
  await edit;
  await new Promise(setImmediate);
  const second = reservations.execute({ workspace: "/w", toolCall: call("exec_command") }, async () => { order.push("command 2"); return { ok: true }; });
  await second;
  assert.deepEqual(order, ["edit start", "edit end", "command 1", "command 2"], "the second command runs while the first is still going");
  sleep.resolve();
  await first;
});
