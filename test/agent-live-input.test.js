"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { runModelAttempt } = require("../src/agent/runtime/model-attempt.js");
const { deferred, createAgentRunHandlerFixture } = require("./helpers/agent-run-handler.js");
const end = (id = "end") => ({ id, type: "function", function: { name: "end_turn", arguments: '{"status":"stop"}' } });
async function setup(t) {
  const fixture = sessionFixture(t);
  const events = [];
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: (event) => events.push(event) });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const admitted = await runtime.admit({ ...location, runId: "run-report", userMessage: "Write me a detailed report", inputId: "report", binding: { provider: "ollama", model: "execution" } });
  assert.equal(admitted.ok, true);
  const run = (admission, runModelRound, extra = {}) => runAgentTurn({ workspace: fixture.workspace, model: "execution", numCtx: 16384,
    userMessage: admission.task.objective, runId: admission.runId, initialInputId: admission.initialInputId, chatHistory: admission.chatHistory,
    liveInput: admission.liveInput, engineSnapshot: admission.engineSnapshot, runModelRound,
    executeToolCall: async () => ({ ok: true }), ...extra });
  return { fixture, runtime, location, admitted, run, events };
}
test("Arial arriving during a model round reaches the next normal round as a user message", async (t) => {
  const { fixture, runtime, location, admitted, run, events } = await setup(t);
  const entered = deferred(); const finish = deferred(); const requests = [];
  const operation = run(admitted, async (request) => {
    requests.push(JSON.parse(JSON.stringify(request.messages)));
    if (requests.length === 1) { entered.resolve(); await finish.promise; return { ok: true, fullText: "Report", toolCalls: [end()] }; }
    assert.match(request.messages.at(-1).content, /arial font/);
    return { ok: true, fullText: "Report in Arial", toolCalls: [end("finish")] };
  });
  await entered.promise;
  const receipt = await runtime.receive({ ...location, input: { id: "arial", text: "and make sure the report uses arial font" } });
  assert.equal(receipt.durable, true); assert.equal(receipt.status, "received");
  assert.equal(requests[0].some((message) => String(message.content).includes("arial font")), false);
  finish.resolve(); const result = await operation;
  assert.equal(result.ok, true, result.error); assert.equal(result.runState.status, "completed"); assert.equal(requests.length, 2);
  assert.equal(result.finalText, "Report in Arial");
  const state = fixture.open().supervisor.snapshot(location).control;
  assert.equal(state.tasks[0].appliedRevision, 2); assert.equal(state.tasks[0].status, "completed");
  assert.equal(result.appendedMessages.filter((message) => message.source_message_id === "arial").length, 1);
  assert.equal(events.some((event) => event.type === "input_applied" && event.messageId === "arial"), true);
  assert.equal(result.appendedMessages.filter((message) => message.role === "tool").every((message) => message.content), true);
});
test("steering received during a provider retry suppresses stale tool effects", async (t) => {
  const { runtime, location, admitted, run } = await setup(t);
  const entered = deferred(); const finish = deferred(); const executed = [];
  let rounds = 0;
  const operation = run(admitted, async (request) => {
    rounds += 1;
    if (rounds === 1) return { ok: false, code: "MODEL_ROUND_FAILED", error: "ECONNRESET" };
    if (rounds === 2) {
      entered.resolve();
      await finish.promise;
      return { ok: true, toolCalls: [{ id: "stale-delete", type: "function", function: { name: "exec_command", arguments: '{"command":"delete important.txt"}' } }] };
    }
    assert.ok(request.messages.some((message) => String(message.content || "").includes("Do not run the deletion command")));
    return { ok: true, fullText: "I will leave the file in place.", toolCalls: [end("finish")] };
  }, {
    tools: [{ type: "function", function: { name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } } } } }],
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { deleted: true } }; },
    retryDelayMs: 1,
  });
  await entered.promise;
  const receipt = await runtime.receive({ ...location, input: { id: "cancel-delete", text: "Do not run the deletion command" } });
  assert.equal(receipt.durable, true);
  finish.resolve();
  const result = await operation;
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(executed, [], "the pre-steering model declaration never reaches a tool executor");
  assert.equal(rounds, 3);
});
test("an arrival racing execution-plan persistence supersedes the live model round", async (t) => {
  const { runtime, location, admitted, run } = await setup(t);
  const executed = [];
  let rounds = 0;
  let injected = false;
  const liveInput = {
    ...admitted.liveInput,
    async prepareRound(args) {
      if (!injected) {
        injected = true;
        const receipt = await runtime.receive({ ...location, input: { id: "cancel-before-effect", text: "Do not run the stale command" } });
        assert.equal(receipt.durable, true);
      }
      return admitted.liveInput.prepareRound(args);
    },
  };
  const result = await run(admitted, async (request) => {
    rounds += 1;
    if (rounds === 1) return { ok: true, toolCalls: [{ id: "stale-live", type: "function", function: { name: "exec_command", arguments: '{"command":"remove important.txt"}' } }] };
    assert.ok(request.messages.some((message) => String(message.content || "").includes("Do not run the stale command")));
    return { ok: true, fullText: "I will not run that command.", toolCalls: [end("finish-live")] };
  }, {
    liveInput,
    tools: [{ type: "function", function: { name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } } } } }],
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { removed: true } }; },
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(executed, [], "the result is fenced inside prepareRound before its executor starts");
  assert.equal(rounds, 2);
});
test("encrypted receipt failure leaves the input unapplied and does not acknowledge it", async (t) => {
  const { fixture, runtime, location } = await setup(t);
  fixture.mode.available = false;
  const receipt = await runtime.receive({ ...location, input: { id: "font", text: "Use Arial" } });
  assert.equal(receipt.ok, false); assert.equal(receipt.code, "MEMORY_SECURE_STORAGE_UNAVAILABLE");
  fixture.mode.available = true;
  assert.equal(fixture.open().supervisor.snapshot(location).control.arrival, 1);
});
test("a model attempt deadline settles a provider that ignores abort and suppresses its late tokens", async () => {
  const finished = deferred(); let callback; const tokens = [];
  const result = await runModelAttempt({ timeoutMs: 10, run: async (request) => { callback = request.onToken; await finished.promise; callback("late"); return { ok: true }; }, request: { onToken: (token) => tokens.push(token) } });
  assert.equal(result.code, "MODEL_ATTEMPT_TIMEOUT"); finished.resolve(); await new Promise(setImmediate);
  assert.deepEqual(tokens, []);
});
test("completion compares the durable arrival watermark and cannot lose a late message", async (t) => {
  const { fixture, runtime, location, admitted } = await setup(t);
  await admitted.liveInput.boundary({ revision: 0, plan: () => assert.fail() });
  await admitted.liveInput.checkpoint({ revision: 1, engineSnapshot: { revision: 1 }, appendedMessages: [] });
  await runtime.receive({ ...location, input: { id: "late", text: "Use Arial" } });
  const result = await admitted.liveInput.finalize({ revision: 1, cancellationEpoch: 0, appendedMessages: [], engineSnapshot: { revision: 1 }, status: "completed" });
  assert.equal(result.completed, false); assert.equal(result.reason, "PENDING_INPUT");
  assert.equal(fixture.open().supervisor.snapshot(location).control.tasks[0].status, "running");
});
test("the production run and submitInput handlers route steering through encrypted task storage", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.agentSessionRuntime = createAgentSessionRuntime({ store: fixture.store });
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  const entered = deferred(); const release = deferred(); let rounds = 0;
  main.context.runOllamaAgentRound = async (_sender, request) => {
    rounds++;
    assert.equal(request.provider, "ollama");
    if (rounds === 1) { entered.resolve(); await release.promise; return { ok: true, toolCalls: [end()] }; }
    return { ok: true, fullText: "Arial report", toolCalls: [end("done")] };
  };
  const operation = main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Write a report", model: "execution", numCtx: 16384, provider: "ollama" });
  await entered.promise;
  const receipt = await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "font", text: "Use Arial" });
  assert.equal(receipt.durable, true); assert.equal(receipt.encrypted, true);
  release.resolve(); const result = await operation;
  assert.equal(result.ok, true, result.error); assert.equal(rounds, 2);
  const state = fixture.open().supervisor.snapshot({ workspace: "", sessionId: result.memorySessionId }).control;
  assert.equal(state.tasks[0].status, "completed"); assert.equal(state.tasks[0].appliedRevision, 2);
  assert.equal(main.context.agentRunControllers.size, 0); assert.equal(main.context.powerSaveActive, false);
});
test("a steering prompt resumes a parked run while its command process is still live", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const senders = new Map();
  main.context.bindAgentSender = (sessionId, sender) => senders.set(String(sessionId), sender);
  main.context.senderForSession = (sessionId, fallback) => senders.get(String(sessionId)) || fallback;
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: {
    name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" }, context: { type: "string" } } },
  } }] });
  main.context.container.durableProcessManager.runningCommands = () => [{ processId: "sleep-process" }];
  main.installInputWake();

  let rounds = 0;
  const resumed = deferred();
  const echoExecuted = deferred();
  main.context.runOllamaAgentRound = async (_senderId, request) => {
    rounds++;
    if (rounds === 1) return { ok: true, fullText: "Starting the sleep command.", toolCalls: [
      { id: "sleep", type: "function", function: { name: "exec_command", arguments: { command: "sleep 15", context: "sleep command" } } }, end("sleep-end"),
    ] };
    assert.ok(request.messages.some((message) => String(message.content || "").includes("also run an echo command")), "the resumed model call must receive steering before process exit");
    resumed.resolve();
    return { ok: true, fullText: "Running the echo command.", toolCalls: [
      { id: "echo", type: "function", function: { name: "exec_command", arguments: { command: "echo ready", context: "echo command" } } }, end("echo-end"),
    ] };
  };
  main.context.executeToolCall = async ({ toolCall }) => {
    const command = String(toolCall.function.arguments.command || "");
    if (command.includes("sleep")) return { ok: true, value: { processId: "sleep-process", command, mode: "process_start", status: "running", startedAt: Date.now() } };
    echoExecuted.resolve();
    return { ok: true, value: { processId: "echo-process", command, mode: "process_complete", status: "complete", stdout: "ready", exitCode: 0 } };
  };

  const first = await main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Run a sleep command", model: "execution", numCtx: 16384, provider: "ollama" });
  assert.equal(first.ok, true, first.error || "");
  assert.equal(first.commandWait, true);
  assert.equal(first.pendingEndTurn, false);
  const receipt = await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "steer-echo", targetTaskId: first.taskId, text: "also run an echo command" });
  assert.equal(receipt.durable, true);
  let resumeTimeout;
  try {
    await Promise.race([resumed.promise, new Promise((_, reject) => { resumeTimeout = setTimeout(() => reject(new Error("steering did not resume before command exit")), 1_000); })]);
  } finally {
    clearTimeout(resumeTimeout);
  }
  await echoExecuted.promise;
  assert.equal(rounds, 2);
});
test("images sent with a steering prompt reach the model on that message", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const senders = new Map();
  main.context.bindAgentSender = (sessionId, sender) => senders.set(String(sessionId), sender);
  main.context.senderForSession = (sessionId, fallback) => senders.get(String(sessionId)) || fallback;
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: {
    name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" }, context: { type: "string" } } },
  } }] });
  main.context.container.durableProcessManager.runningCommands = () => [{ processId: "sleep-process" }];
  main.installInputWake();

  let rounds = 0;
  const resumed = deferred();
  const echoExecuted = deferred();
  main.context.runOllamaAgentRound = async (_senderId, request) => {
    rounds++;
    if (rounds === 1) return { ok: true, fullText: "Starting the sleep command.", toolCalls: [
      { id: "sleep", type: "function", function: { name: "exec_command", arguments: { command: "sleep 15", context: "sleep command" } } }, end("sleep-end"),
    ] };
    const steering = request.messages.find((message) => message.source_message_id === "steer-echo");
    assert.deepEqual(steering?.images, ["iVBORw0KGgo="], "the steering message carries its image");
    assert.equal(request.messages.filter((message) => message.images?.length).length, 1, "no other message gets the image");
    resumed.resolve();
    return { ok: true, fullText: "Running the echo command.", toolCalls: [
      { id: "echo", type: "function", function: { name: "exec_command", arguments: { command: "echo ready", context: "echo command" } } }, end("echo-end"),
    ] };
  };
  main.context.executeToolCall = async ({ toolCall }) => {
    const command = String(toolCall.function.arguments.command || "");
    if (command.includes("sleep")) return { ok: true, value: { processId: "sleep-process", command, mode: "process_start", status: "running", startedAt: Date.now() } };
    echoExecuted.resolve();
    return { ok: true, value: { processId: "echo-process", command, mode: "process_complete", status: "complete", stdout: "ready", exitCode: 0 } };
  };

  const first = await main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Run a sleep command", model: "execution", numCtx: 16384, provider: "ollama" });
  assert.equal(first.ok, true, first.error || "");
  assert.equal(first.commandWait, true);
  assert.equal(first.pendingEndTurn, false);
  const receipt = await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "steer-echo", targetTaskId: first.taskId, text: "also run an echo command", images: [{ name: "shot.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }] });
  assert.equal(receipt.durable, true);
  let resumeTimeout;
  try {
    await Promise.race([resumed.promise, new Promise((_, reject) => { resumeTimeout = setTimeout(() => reject(new Error("steering did not resume before command exit")), 1_000); })]);
  } finally {
    clearTimeout(resumeTimeout);
  }
  await echoExecuted.promise;
  assert.equal(rounds, 2);
});
test("invalid steering images are refused before the message is saved", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const refused = await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "bad", text: "look", images: [{ dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }] });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "USER_IMAGES_INVALID");
});
test("a steering prompt frees a round blocked on a long command, and the command's late result wakes the task", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const senders = new Map();
  main.context.bindAgentSender = (sessionId, sender) => senders.set(String(sessionId), sender);
  main.context.senderForSession = (sessionId, fallback) => senders.get(String(sessionId)) || fallback;
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: {
    name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" }, wait_ms: { type: "integer" } } },
  } }] });
  main.context.container.durableProcessManager.runningCommands = () => [];
  main.installInputWake();
  const waiting = deferred(); const exit = deferred(); const woke = deferred();
  main.context.executeToolCall = async () => { waiting.resolve(); await exit.promise; return { ok: true, value: { mode: "command", status: "complete", exitCode: 0, stdout: "slept" } }; };
  const requests = [];
  main.context.runOllamaAgentRound = async (_sender, request) => {
    requests.push(request.messages);
    if (requests.length === 1) return { ok: true, fullText: "Starting the sleep.", toolCalls: [{ id: "sleep", type: "function", function: { name: "exec_command", arguments: { command: "sleep 30", wait_ms: 35000 } } }] };
    if (requests.length === 2) {
      assert.ok(request.messages.some((message) => String(message.content || "").includes("also run an echo command")), "the steering message reaches the next round");
      assert.ok(request.messages.some((message) => message.role === "tool" && /continues in the background/.test(String(message.content))), "the blocked call gets a background outcome");
      return { ok: true, fullText: "Echo noted; waiting for the sleep.", toolCalls: [end("wait")] };
    }
    assert.ok(request.messages.some((message) => /finished after the round moved on/.test(String(message.content)) && /slept/.test(String(message.content))), "the late result reaches the task");
    woke.resolve();
    return { ok: true, fullText: "The sleep finished and the echo is done.", toolCalls: [end("done")] };
  };
  const startedAt = Date.now();
  const operation = main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Run a 30 second sleep", model: "execution", numCtx: 16384, provider: "ollama" });
  await waiting.promise;
  const receipt = await main.invokeIpc("agent:submitInput", { sessionId: "ui-session", messageId: "steer-echo", text: "also run an echo command" });
  assert.equal(receipt.durable, true);
  const parked = await operation;
  assert.equal(parked.ok, true, parked.error);
  assert.equal(parked.commandWait, true);
  assert.equal(requests.length, 2);
  assert.ok(Date.now() - startedAt < 10_000, "the agent answered while the command was still running");
  exit.resolve();
  let wakeTimeout;
  try {
    await Promise.race([woke.promise, new Promise((_, reject) => { wakeTimeout = setTimeout(() => reject(new Error("the late result did not wake the task")), 5_000); })]);
  } finally { clearTimeout(wakeTimeout); }
  assert.equal(requests.length, 3);
});
test("a parked command's exit reaches the task inbox and wakes it once every awaited command is done", async (t) => {
  const fixture = sessionFixture(t);
  const main = createAgentRunHandlerFixture();
  main.context.runAgentTurn = runAgentTurn;
  main.context.container.v3SessionStore = fixture.store;
  main.installSessionRuntime();
  const senders = new Map();
  main.context.bindAgentSender = (sessionId, sender) => senders.set(String(sessionId), sender);
  main.context.senderForSession = (sessionId, fallback) => senders.get(String(sessionId)) || fallback;
  main.context.toolCatalogFromRegistry = () => ({ mode: "native", tools: [{ type: "function", function: {
    name: "exec_command", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } } },
  } }] });
  let report;
  main.context.createAgentTerminalHost = ({ sendAgentEvent }) => { report = sendAgentEvent; return {}; };
  let running = ["one", "two"];
  main.context.container.durableProcessManager.runningCommands = () => running.map((processId) => ({ processId }));
  main.installInputWake();
  main.context.executeToolCall = async ({ toolCall }) => ({ ok: true, value: { processId: toolCall.id, mode: "process_start", status: "running", startedAt: Date.now() } });
  const woke = deferred(); const requests = [];
  main.context.runOllamaAgentRound = async (_sender, request) => {
    requests.push(request.messages);
    if (requests.length === 1) return { ok: true, fullText: "Starting both.", toolCalls: [
      { id: "one", type: "function", function: { name: "exec_command", arguments: { command: "sleep 10" } } },
      { id: "two", type: "function", function: { name: "exec_command", arguments: { command: "sleep 20" } } }, end("park"),
    ] };
    const reports = request.messages.filter((message) => /^The command "sleep/.test(String(message.content)));
    assert.deepEqual(reports.map((message) => /\((one|two)\) finished/.exec(message.content)?.[1]), ["one", "two"]);
    woke.resolve();
    return { ok: true, fullText: "Both sleeps finished.", toolCalls: [end("done")] };
  };
  const parked = await main.invokeIpc("agent:run", { sessionId: "ui-session", userMessage: "Run two sleeps", model: "execution", numCtx: 16384, provider: "ollama" });
  assert.equal(parked.commandWait, true, parked.error || parked.reason);
  running = ["two"];
  report({ type: "agent_command_output", deliverToSession: true, processId: "one", command: "sleep 10", status: "complete", exitCode: 0, stdout: "first" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(requests.length, 1, "one finished command does not wake the task while another is awaited");
  running = [];
  report({ type: "agent_command_output", deliverToSession: true, processId: "two", command: "sleep 20", status: "complete", exitCode: 0, stdout: "second" });
  let wakeTimeout;
  try {
    await Promise.race([woke.promise, new Promise((_, reject) => { wakeTimeout = setTimeout(() => reject(new Error("the last command did not wake the task")), 5_000); })]);
  } finally { clearTimeout(wakeTimeout); }
  assert.equal(requests.length, 2);
});
test("tool-round steering waits for every declared outcome before entering the next request", async (t) => {
  const { runtime, location, admitted, run } = await setup(t);
  const started = deferred(); const finish = deferred(); let rounds = 0;
  const calls = ["one", "two"].map((id) => ({ id, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `${id}.txt` }) } }));
  const operation = run(admitted, async (request) => {
    if (++rounds === 1) return { ok: true, toolCalls: calls };
    const declaration = request.messages.findIndex((message) => message.tool_calls?.some((call) => call.id === "one"));
    assert.equal(request.messages[declaration + 1].tool_call_id, "one");
    assert.equal(request.messages[declaration + 2].tool_call_id, "two");
    assert.match(request.messages.at(-1).content, /Use Arial/);
    return { ok: true, toolCalls: [end()] };
  }, { executeToolCall: async () => { started.resolve(); await finish.promise; return { ok: true, content: "text" }; } });
  await started.promise;
  await runtime.receive({ ...location, input: { id: "font", text: "Use Arial" } });
  assert.equal(rounds, 1); finish.resolve();
  const result = await operation; assert.equal(result.ok, true, result.error); assert.equal(rounds, 2);
});
test("Stop during pending admission aborts the claimed controller before a task ID exists", async (t) => {
  const fixture = sessionFixture(t); const main = createAgentRunHandlerFixture();
  const runtime = createAgentSessionRuntime({ store: fixture.store }); const entered = deferred(); const finish = deferred();
  main.context.agentSessionRuntime = { ...runtime, admit: async (input) => { entered.resolve(); await finish.promise; return runtime.admit(input); } };
  main.context.runAgentTurn = runAgentTurn;
  main.context.abortAgentSession = (senderId, sessionId) => { assert.equal(senderId, main.sender.id); assert.equal(sessionId, "ui"); for (const controller of main.context.agentRunControllers.values()) controller.abort(); };
  const operation = main.invokeIpc("agent:run", { sessionId: "ui", userMessage: "Write a report", numCtx: 16384 });
  await entered.promise; const stopped = await main.invokeIpc("agent:cancelTask", { sessionId: "ui" });
  assert.equal(stopped.pendingAdmission, true); finish.resolve(); const result = await operation;
  assert.equal(result.aborted, true); assert.equal(main.context.agentRunControllers.size, 0);
  assert.equal(runtime.supervisor.snapshot({ workspace: "", sessionId: result.memorySessionId }).control.tasks[0].status, "stopped");
});
test("steering received before initial admission joins the main task in arrival order", async (t) => {
  const fixture = sessionFixture(t); const runtime = createAgentSessionRuntime({ store: fixture.store });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  await runtime.receive({ ...location, input: { id: "font", text: "Use Arial" } });
  const admitted = await runtime.admit({ ...location, runId: "first", userMessage: "Write a report", inputId: "report" });
  assert.equal(admitted.task.objective, "Write a report");
  const result = await admitted.liveInput.boundary({ revision: 0 });
  assert.equal(result.ok, true, result.error); assert.deepEqual(result.deliveries.map((entry) => entry.text), ["Use Arial", "Write a report"]);
});
