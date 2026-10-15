"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createDelegatedChildStore } = require("../src/agent/runtime/delegated-child-store.js");
const { createSubagentCoordinator } = require("../src/agent/runtime/subagent-coordinator.js");
const { createRuntimeDelegationProvider } = require("../src/agent/runtime/delegation-provider.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const tool = { type: "function", function: { name: "read_file", description: "Read file", parameters: {} } };

test("cold child recovery reuses a completed effect before its round checkpoint", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const coordinator = createSubagentCoordinator();
  const crash = deferred();
  let effects = 0;
  const call = { id: "effect1", type: "function", function: { name: "read_file", arguments: { path: "report.txt" } } };
  const common = { senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId, parentModel: "worker", tools: [tool], runAgentTurn,
    executeToolCall: async () => { effects += 1; return { ok: true, value: { content: "Saved outcome" } }; } };
  const first = createRuntimeDelegationProvider({ ...common, coordinator, ...childStore,
    beginChildSession: async () => ({ ok: true, sessionId: "session_child_effect_recovery" }),
    checkpointChild: async (args) => { const receipt = await childStore.checkpointChild(args); if (args.effect?.status === "completed") { crash.resolve(); await new Promise(() => {}); } return receipt; },
    runModelRound: async () => ({ ok: true, toolCalls: [call] }) });
  await first({ task: "Inspect report", contextPackage: {}, expectedOutput: { format: "text" } });
  await crash.promise;
  const wave = JSON.parse(JSON.stringify(coordinator.exportWave("s::parent")));
  const freshStore = createDelegatedChildStore({ v3SessionStore: fixture.open().store });
  const saved = await freshStore.loadChild({ workspace: fixture.workspace, engineRef: wave.children[0].engineRef });
  assert.equal(saved.value.pendingEffects.length, 0);
  assert.equal(saved.value.engineSnapshot.pendingPlan.result.toolCalls[0].id, "effect1");
  const nextCoordinator = createSubagentCoordinator(); nextCoordinator.restoreWave("s::parent", wave);
  const terminal = deferred(); let models = 0;
  const next = createRuntimeDelegationProvider({ ...common, coordinator: nextCoordinator, ...freshStore,
    runModelRound: async (_sender, payload) => { models += 1; assert.equal(payload.messages.some((message) => message.tool_call_id === "effect1" && message.content.includes("Saved outcome")), true);
      return { ok: true, fullText: "Done", toolCalls: [endTurnCall()] }; },
    sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) terminal.resolve(event); } });
  await next.recoverChildren();
  assert.equal((await terminal.promise).type, "subagent_completed");
  assert.equal(effects, 1); assert.equal(models, 1);
});

test("child checkpoints persist originals and engine only in the encrypted child session", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const goal = "Original detailed child report";
  const text = "  Arial\nKeep every heading.  ";
  const args = { workspace: fixture.workspace, childSessionId: "session_child_checkpoint", childInvocationId: "child-1", parentSessionId: fixture.sessionId,
    runId: "run:child-1", originalGoal: goal, input: { task: goal }, binding: { provider: "openrouter", model: "worker", apiKey: "must-not-store" } };
  const initial = await childStore.checkpointChild(args);
  const snapshot = { runId: args.runId, revision: 1, inputMessages: [{ role: "user", content: goal, source_message_id: `${args.runId}:initial`, task_revision: 0 },
    { role: "user", content: text, source_message_id: "steer:font", task_revision: 1 }],
    appliedInputIds: [`${args.runId}:initial`, "steer:font"], accounting: { providerAttempts: 3, operationalRounds: 2 }, runState: { status: "running" } };
  const saved = await childStore.checkpointChild({ ...args, engineSnapshot: snapshot, appendedMessages: [snapshot.inputMessages[1], { role: "assistant", content: "Draft" }] });
  assert.equal(saved.encrypted && saved.durable, true);
  assert.equal(saved.value.engineRef.runId, initial.value.engineRef.runId);
  assert.equal(saved.value.engineRef.blockId, initial.value.engineRef.blockId);
  assert.equal(saved.value.engineRef.revision, 1);
  assert.deepEqual(saved.value.engineRef.sourceMessageIds, [`${args.runId}:initial`, "steer:font"]);
  const fresh = createDelegatedChildStore({ v3SessionStore: fixture.open().store });
  const loaded = await fresh.loadChild({ workspace: fixture.workspace, engineRef: saved.value.engineRef });
  assert.equal(loaded.value.originalGoal, goal);
  assert.equal(loaded.value.engineSnapshot.accounting.providerAttempts, 3);
  assert.deepEqual(loaded.value.history.map((message) => message.content), [goal, text, "Draft"]);
  assert.equal(loaded.value.history[1].source_message_id, "steer:font");
  assert.equal(loaded.value.binding.apiKey, undefined);
  const control = fixture.open().store.readControl(fixture.workspace, saved.value.engineRef.sessionId);
  assert.equal(control.control.tasks[0].revision, 1);
  assert.equal(control.control.tasks[0].appliedRevision, 1);
  assert.equal(control.control.inputs[0].text, text);
  const ownFile = fixture.store.sessionFile(fixture.workspace, saved.value.engineRef.sessionId);
  assert.equal(fs.readFileSync(ownFile, "utf8").includes(goal), false);
  assert.equal(fs.readFileSync(ownFile, "utf8").includes(text), false);
  assert.equal(fixture.store.readControl(fixture.workspace, fixture.sessionId).exists, false);
});

test("child checkpoint rejects unavailable encryption and nondurable receipts", async (t) => {
  const fixture = sessionFixture(t);
  fixture.mode.available = false;
  const args = { childSessionId: "session_child_failure", childInvocationId: "child-1", runId: "run:child-1", originalGoal: "Inspect" };
  await assert.rejects(createDelegatedChildStore({ v3SessionStore: fixture.store }).checkpointChild(args), { code: "MEMORY_SECURE_STORAGE_UNAVAILABLE" });
  for (const receipt of [{ ok: false, code: "DISK_FAILED", error: "disk" }, { ok: true, encrypted: false, durable: true }, { ok: true, encrypted: true, durable: false }]) {
    const store = createDelegatedChildStore({ v3SessionStore: { transactSession: async () => receipt } });
    await assert.rejects(store.checkpointChild(args), { code: receipt.code || "CHILD_DURABILITY_REQUIRED" });
  }
});

for (const failure of [{ ok: false, code: "DISK_FAILED", error: "disk unavailable" }, { ok: true, encrypted: false, durable: true }, { ok: true, encrypted: true, durable: false }]) {
  test(`a rejected child receipt retains steering: ${failure.code || (failure.encrypted ? "not durable" : "not encrypted")}`, async (t) => {
    const fixture = sessionFixture(t);
    const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
    const coordinator = createSubagentCoordinator();
    const terminal = deferred();
    let source;
    const provider = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
      parentModel: "worker", coordinator, tools: [tool], ...childStore,
      checkpointChild: (args) => args.engineSnapshot?.revision > 0 ? failure : childStore.checkpointChild(args),
      beginChildSession: async () => ({ ok: true, sessionId: "session_child_bad_receipt" }), runAgentTurn,
      runModelRound: async () => ({ toolCalls: [{ id: "read", type: "function", function: { name: "read_file", arguments: { path: "report.txt" } } }] }),
      executeToolCall: async ({ childInvocationId }) => { source = coordinator.enqueueSteer({ parentKey: "s::parent", childInvocationId, instruction: "  Use Arial  " }); return { ok: true, value: { content: "draft" } }; },
      sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) terminal.resolve(event); },
    });
    const acceptance = await provider({ task: "Inspect the report", contextPackage: { role: "agent", resources: {} }, expectedOutput: { format: "text" } });
    assert.equal((await terminal.promise).type, "subagent_failed");
    assert.deepEqual(coordinator.peekSteerQueue(acceptance.childInvocationId, "s::parent").map((message) => [message.id, message.instruction]), [[source.messageId, "  Use Arial  "]]);
    const ref = coordinator.getChild(acceptance.childInvocationId).engineRef;
    const saved = await childStore.loadChild({ workspace: fixture.workspace, engineRef: ref });
    assert.equal(saved.value.engineSnapshot.revision, 0);
    assert.equal(saved.value.history.some((message) => message.source_message_id === source.messageId), false);
  });
}

test("a restart resumes the child checkpoint and applies pending steering once", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const firstCoordinator = createSubagentCoordinator();
  const inFlight = deferred();
  const parentController = new AbortController();
  let round = 0;
  let latestRef;
  const original = "Inspect the report draft and identify improvements";
  const first = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    parentModel: "worker", getActiveProvider: () => "openrouter", coordinator: firstCoordinator, tools: [tool], ...childStore,
    beginChildSession: async () => ({ ok: true, sessionId: "session_child_recovery" }), runAgentTurn,
    runModelRound: async () => {
      round += 1;
      if (round === 1) return { fullText: "Reading the draft", toolCalls: [{ id: "read-1", type: "function", function: { name: "read_file", arguments: { path: "report.txt" } } }] };
      inFlight.resolve();
      return new Promise(() => {});
    },
    executeToolCall: async () => ({ ok: true, value: { content: "The original draft" } }),
    onChildCheckpoint: ({ engineRef }) => { latestRef = engineRef; },
  });
  const acceptance = await first({ task: original, contextPackage: { role: "agent", resources: {} }, expectedOutput: { format: "text" } }, null, { signal: parentController.signal });
  await inFlight.promise;
  const source = firstCoordinator.enqueueSteer({ parentKey: "s::parent", childInvocationId: acceptance.childInvocationId, instruction: "  Use Arial for all headings.\n  " });
  const wave = firstCoordinator.exportWave("s::parent");
  assert.deepEqual(wave.children[0].engineRef, latestRef);
  assert.equal(wave.children[0].steerQueue[0].id, source.messageId);
  assert.equal(JSON.stringify(wave).includes("The original draft"), false);
  const fresh = fixture.open();
  const freshStore = createDelegatedChildStore({ v3SessionStore: fresh.store });
  const nextCoordinator = createSubagentCoordinator();
  assert.equal(nextCoordinator.restoreWave("s::parent", JSON.parse(JSON.stringify(wave))).hold, true);
  assert.equal(nextCoordinator.getChild(acceptance.childInvocationId).status, "interrupted");
  const terminal = deferred();
  const seen = [];
  const recoveredPayloads = [];
  const next = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    parentModel: "changed-model", getActiveProvider: () => "ollama", coordinator: nextCoordinator, tools: [tool], ...freshStore,
    runAgentTurn: (payload) => { recoveredPayloads.push(payload); return runAgentTurn(payload); },
    runModelRound: async (_sender, payload) => { seen.push(payload); return { fullText: "The report now uses Arial.", toolCalls: [endTurnCall()] }; },
    executeToolCall: async () => { throw new Error("The saved read must not repeat"); },
    sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) terminal.resolve(event); },
  });
  const resumed = await next.recoverChildren();
  assert.equal(resumed.recovered[0].status, "working");
  assert.equal((await terminal.promise).type, "subagent_completed");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, "worker");
  assert.equal(seen[0].contextPlan.provider, "openrouter");
  assert.equal(seen[0].messages.filter((message) => message.content === "  Use Arial for all headings.\n  ").length, 1);
  assert.equal(seen[0].messages.some((message) => message.content === original), true);
  assert.equal(seen[0].messages.some((message) => message.role === "tool" && message.tool_call_id === "read-1"), true);
  assert.equal(recoveredPayloads[0].runId, latestRef.runId);
  assert.equal(nextCoordinator.getChild(acceptance.childInvocationId).generation, 1);
  const reopened = await freshStore.loadChild({ workspace: fixture.workspace, engineRef: latestRef });
  assert.equal(reopened.value.status, "completed");
  assert.equal(reopened.value.engineSnapshot.accounting.operationalRounds, 2);
  assert.equal(reopened.value.history.filter((message) => message.source_message_id === source.messageId).length, 1);
  assert.equal(nextCoordinator.peekSteerQueue(acceptance.childInvocationId, "s::parent").length, 0);
  parentController.abort("TEST_CLEANUP");
  await firstCoordinator.shutdown({ timeoutMs: 100 });
  await tick();
});

test("recovery refuses to replay a child effect with an unknown outcome", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const saved = await childStore.checkpointChild({ workspace: fixture.workspace, childSessionId: "session_child_unknown", childInvocationId: "child-unknown",
    parentSessionId: fixture.sessionId, runId: "run:unknown", originalGoal: "Inspect", effect: { id: "tool-1", toolName: "exec_command", status: "started" } });
  const coordinator = createSubagentCoordinator();
  coordinator.restoreWave("s::parent", { parentSessionId: fixture.sessionId, workspace: fixture.workspace,
    wave: { waveId: "wave-1", sealed: false, pendingIds: ["child-unknown"] },
    children: [{ childInvocationId: "child-unknown", childSessionId: "session_child_unknown", status: "working", generation: 1, engineRef: saved.value.engineRef, steerQueue: [{ id: "steer:pending", instruction: "Use Arial" }] }] });
  const provider = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    coordinator, ...childStore, runAgentTurn: () => { throw new Error("Must not rerun"); }, runModelRound: async () => {}, executeToolCall: async () => {} });
  const result = await provider.recoverChildren();
  assert.equal(result.recovered[0].code, "CHILD_EFFECT_UNKNOWN");
  assert.equal(coordinator.getChild("child-unknown").status, "failed");
  assert.equal(coordinator.peekSteerQueue("child-unknown", "s::parent")[0].instruction, "Use Arial");
});

test("terminal child recovery acknowledges already saved steering without another model round", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const saved = await childStore.checkpointChild({ workspace: fixture.workspace, childSessionId: "session_child_terminal", childInvocationId: "child-terminal",
    parentSessionId: fixture.sessionId, runId: "run:terminal", originalGoal: "Inspect the report",
    engineSnapshot: { runId: "run:terminal", revision: 1, appliedInputIds: ["steer:font"], inputMessages: [{ role: "user", content: "Use Arial", source_message_id: "steer:font", task_revision: 1 }],
      finalText: "The report uses Arial", runState: { status: "running" } }, appendedMessages: [{ role: "user", content: "Use Arial", source_message_id: "steer:font", task_revision: 1 }] });
  const loaded = await childStore.loadChild({ workspace: fixture.workspace, engineRef: saved.value.engineRef });
  await childStore.checkpointChild({ workspace: fixture.workspace, childSessionId: "session_child_terminal", childInvocationId: "child-terminal",
    parentSessionId: fixture.sessionId, runId: "run:terminal", originalGoal: "Inspect the report",
    engineSnapshot: { ...loaded.value.engineSnapshot, runState: { status: "completed" } }, prefixMessages: loaded.value.prefixMessages });
  const coordinator = createSubagentCoordinator();
  coordinator.restoreWave("s::parent", { parentSessionId: fixture.sessionId, wave: { waveId: "wave-1", sealed: false, pendingIds: ["child-terminal"] },
    children: [{ childInvocationId: "child-terminal", childSessionId: "session_child_terminal", status: "working", generation: 1, engineRef: saved.value.engineRef, steerQueue: [{ id: "steer:font", instruction: "Use Arial" }] }] });
  const provider = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId, coordinator, ...childStore,
    runAgentTurn: () => { throw new Error("Must not rerun terminal engine"); }, runModelRound: async () => {}, executeToolCall: async () => {} });
  const result = await provider.recoverChildren();
  assert.equal(result.recovered[0].status, "completed");
  assert.equal(coordinator.peekSteerQueue("child-terminal", "s::parent").length, 0);
});

test("prepared child completion waits for a parent-journal delivery before sealing", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const coordinator = createSubagentCoordinator();
  const terminal = deferred();
  const requests = [];
  let gateCalls = 0;
  let source;
  const provider = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    parentModel: "worker", coordinator, ...childStore, runAgentTurn,
    beginChildSession: async () => ({ ok: true, sessionId: "session_child_prepared_delivery" }),
    runModelRound: async (_sender, payload) => { requests.push(payload); return { fullText: requests.length === 1 ? "Report draft" : "Report uses Arial", toolCalls: [endTurnCall()] }; },
    executeToolCall: async () => { throw new Error("No tool effect is required"); },
    beforeChildFinalize: async ({ childInvocationId, engineRef, engineSnapshot }) => {
      gateCalls += 1;
      const saved = await childStore.loadChild({ workspace: fixture.workspace, engineRef });
      assert.equal(saved.value.status, "running");
      assert.equal(saved.value.engineSnapshot.pendingCompletion.revision, engineSnapshot.revision);
      if (gateCalls === 1) {
        assert.equal(coordinator.getChild(childInvocationId).steeringClosed, undefined);
        setImmediate(() => { source = coordinator.enqueueSteer({ parentKey: "s::parent", childInvocationId, instruction: "Use Arial" }); });
        return { ok: true, completed: false, reason: "PENDING_INPUT" };
      }
      if (!source || !engineRef.sourceMessageIds.includes(source.messageId)) return { ok: true, completed: false, reason: "PENDING_INPUT" };
      assert.equal(engineRef.sourceMessageIds.includes(source.messageId), true);
      return { ok: true, completed: true };
    },
    sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) terminal.resolve(event); },
  });
  const accepted = await provider({ task: "Write a detailed report", contextPackage: {}, expectedOutput: { format: "text" } });
  assert.equal((await terminal.promise).type, "subagent_completed");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.filter((message) => message.content === "Use Arial").length, 1);
  const final = await childStore.loadChild({ workspace: fixture.workspace, engineRef: coordinator.getChild(accepted.childInvocationId).engineRef });
  assert.equal(final.value.status, "completed");
  assert.equal(final.value.engineSnapshot.pendingCompletion, null);
  assert.equal(final.value.engineSnapshot.accounting.providerAttempts, 2);
  assert.equal(coordinator.getChild(accepted.childInvocationId).steeringClosed, true);
});

test("terminal write failure keeps prepared completion recoverable without a model replay", async (t) => {
  const fixture = sessionFixture(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const coordinator = createSubagentCoordinator();
  const terminal = deferred();
  let parentAcceptances = 0;
  const provider = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    parentModel: "worker", coordinator, ...childStore, runAgentTurn,
    checkpointChild: (args) => args.engineSnapshot?.runState?.status === "completed" ? { ok: false, code: "CHILD_TERMINAL_WRITE_FAILED", error: "disk unavailable" } : childStore.checkpointChild(args),
    beginChildSession: async () => ({ ok: true, sessionId: "session_child_prepared_recovery" }),
    runModelRound: async () => ({ fullText: "The saved report", toolCalls: [endTurnCall()] }), executeToolCall: async () => {},
    beforeChildFinalize: async () => { parentAcceptances += 1; return { ok: true, completed: true }; },
    sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) terminal.resolve(event); },
  });
  const accepted = await provider({ task: "Write a detailed report", contextPackage: {}, expectedOutput: { format: "text" } });
  assert.equal((await terminal.promise).type, "subagent_failed");
  const wave = coordinator.exportWave("s::parent");
  assert.equal(wave.children[0].engineRef.pendingCompletion, true);
  const saved = await childStore.loadChild({ workspace: fixture.workspace, engineRef: wave.children[0].engineRef });
  assert.equal(saved.value.status, "running");
  assert.equal(saved.value.engineSnapshot.finalText, "The saved report");
  assert.equal(saved.value.engineSnapshot.accounting.providerAttempts, 1);
  assert.equal(saved.value.engineSnapshot.pendingCompletion.revision, 0);
  const freshStore = createDelegatedChildStore({ v3SessionStore: fixture.open().store });
  const freshCoordinator = createSubagentCoordinator();
  freshCoordinator.restoreWave("s::parent", JSON.parse(JSON.stringify(wave)));
  assert.equal(freshCoordinator.getChild(accepted.childInvocationId).status, "interrupted");
  const resumedTerminal = deferred();
  let modelCalls = 0;
  let releasePending;
  const next = createRuntimeDelegationProvider({ senderId: "s", runKey: "s::parent", workspace: fixture.workspace, sessionId: fixture.sessionId,
    parentModel: "changed-model", coordinator: freshCoordinator, ...freshStore,
    runAgentTurn: (payload) => { releasePending = payload.releasePendingEndTurn; return runAgentTurn(payload); },
    runModelRound: async () => { modelCalls += 1; throw new Error("Prepared completion must not call the model"); }, executeToolCall: async () => {},
    beforeChildFinalize: async ({ engineSnapshot }) => { assert.equal(engineSnapshot.finalText, "The saved report"); parentAcceptances += 1; return { ok: true, completed: true }; },
    sendToRenderer: (event) => { if (["subagent_completed", "subagent_failed"].includes(event.type)) resumedTerminal.resolve(event); },
  });
  assert.equal((await next.recoverChildren()).recovered[0].status, "working");
  assert.equal((await resumedTerminal.promise).type, "subagent_completed");
  assert.equal(releasePending, true);
  assert.equal(modelCalls, 0);
  assert.equal(parentAcceptances, 2);
  const complete = await freshStore.loadChild({ workspace: fixture.workspace, engineRef: freshCoordinator.getChild(accepted.childInvocationId).engineRef });
  assert.equal(complete.value.status, "completed");
  assert.equal(complete.value.engineSnapshot.accounting.providerAttempts, 1);
});
