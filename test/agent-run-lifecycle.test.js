"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentRunHandlerFixture, deferred, tick, queueChildResult } = require("./helpers/agent-run-handler.js");

test("busy input leaves the admitted parent's descriptor and controller unchanged", async () => {
  const fixture = createAgentRunHandlerFixture();
  const wait = deferred();
  fixture.context.runAgentTurn = () => wait.promise;
  const running = fixture.invoke({ sessionId: "parent", userMessage: "Original task" });
  const descriptor = fixture.context.parentRunDescriptors.get("session:parent");
  const controller = fixture.context.agentRunControllers.get("session:parent");
  const rejected = await fixture.invoke({ sessionId: "parent", userMessage: "New task" });
  assert.equal(rejected.code, "PARENT_BUSY");
  assert.strictEqual(fixture.context.parentRunDescriptors.get("session:parent"), descriptor);
  assert.equal(descriptor.payload.userMessage, "Original task");
  assert.strictEqual(fixture.context.agentRunControllers.get("session:parent"), controller);
  assert.equal(controller.signal.aborted, false);
  wait.resolve({ ok: true, runState: { status: "completed" } });
  await running;
});

test("setup failure after controller registration cleans controller, power blocker, and admission", async () => {
  const fixture = createAgentRunHandlerFixture();
  fixture.context.container.mcpRuntime.definitionsForSession = () => { throw new Error("MCP setup failed"); };
  await assert.rejects(fixture.invoke({ sessionId: "parent", userMessage: "Task" }), /MCP setup failed/);
  assert.equal(fixture.context.agentRunControllers.size, 0);
  assert.equal(fixture.context.powerSaveActive, false);
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "IDLE");
});

test("descriptor setup failure after admission releases its parent turn", async () => {
  const fixture = createAgentRunHandlerFixture();
  fixture.context.parentRunDescriptors.set = () => { throw new Error("Descriptor setup failed"); };
  await assert.rejects(fixture.invoke({ sessionId: "parent", userMessage: "Task" }), /Descriptor setup failed/);
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "IDLE");
  assert.equal(fixture.context.agentRunControllers.size, 0);
});

test("parent admission and controller remain owned through final transcript and run-index persistence", async () => {
  const fixture = createAgentRunHandlerFixture();
  const transcript = deferred();
  const index = deferred();
  fixture.context.container.v3SessionStore.record = () => transcript.promise;
  fixture.context.container.longHorizonRunStore.finish = () => index.promise;
  const running = fixture.invoke({ sessionId: "parent", workspace: "G:/workspace", userMessage: "Original task" });
  await tick();
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "BUSY");
  assert.equal(fixture.context.agentRunControllers.size, 1);
  assert.equal(fixture.context.powerSaveActive, true);
  assert.equal((await fixture.invoke({ sessionId: "parent", userMessage: "While saving" })).code, "PARENT_BUSY");
  transcript.resolve({ ok: true, durable: true, encrypted: true });
  await tick();
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "BUSY");
  assert.equal(fixture.context.agentRunControllers.size, 1);
  index.resolve({});
  assert.equal((await running).ok, true);
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "IDLE");
  assert.equal(fixture.context.agentRunControllers.size, 0);
  assert.equal(fixture.context.powerSaveActive, false);
});

test("failed child-result continuation retains its FIFO packet without retrying automatically", async () => {
  const fixture = createAgentRunHandlerFixture();
  const resultId = await queueChildResult(fixture);
  const announcements = fixture.ready.length;
  fixture.context.runAgentTurn = async () => ({ ok: false, error: "Provider failed", runState: { status: "failed" } });
  const failed = await fixture.invoke({ sessionId: "parent", continuation: { resultId } }, { automaticContinuation: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(fixture.coordinator.snapshot("session:parent").resultQueue, [resultId]);
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "IDLE");
  fixture.coordinator.pumpResults("session:parent");
  assert.equal(fixture.ready.length, announcements);
  fixture.coordinator.beginParentTurn("session:parent");
  fixture.coordinator.finishParentTurn("session:parent");
  assert.equal(fixture.ready.at(-1).resultId, resultId);
});

for (const stored of [
  { ok: false, code: "TRANSCRIPT_IO_FAILED", error: "Disk write failed" },
  { ok: true, durable: false, encrypted: false },
  { ok: true, durable: true, encrypted: false },
  undefined,
]) {
  test(`unsuccessful final transcript persistence fails continuation and retains packet: ${JSON.stringify(stored)}`, async () => {
    const fixture = createAgentRunHandlerFixture();
    const resultId = await queueChildResult(fixture);
    const statuses = [];
    fixture.context.container.v3SessionStore.record = async () => stored;
    fixture.context.container.longHorizonRunStore.finish = async (_workspace, _id, status) => { statuses.push(status); };
    const outcome = await fixture.invoke({ workspace: "G:/workspace", sessionId: "parent", continuation: { resultId } }, { automaticContinuation: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.runState.status, "failed");
    assert.deepEqual(statuses, ["failed"]);
    assert.deepEqual(fixture.coordinator.snapshot("session:parent").resultQueue, [resultId]);
    assert.equal(fixture.context.agentRunControllers.size, 0);
  });
}

test("successful continuation persists its acknowledged wave before releasing parent admission", async () => {
  const fixture = createAgentRunHandlerFixture();
  const resultId = await queueChildResult(fixture);
  const saved = deferred();
  let wave;
  fixture.context.container.longHorizonRunStore.checkpoint = (_workspace, _id, patch) => {
    wave = patch.checkpoint.orchestrationWave;
    return saved.promise;
  };
  const running = fixture.invoke({ workspace: "G:/workspace", sessionId: "parent", continuation: { resultId } }, { automaticContinuation: true });
  await tick();
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "PROCESSING_RESULT");
  assert.deepEqual(fixture.coordinator.snapshot("session:parent").resultQueue, [resultId]);
  assert.deepEqual(wave.resultQueue, []);
  assert.equal(wave.processingResultId, "");
  assert.equal(fixture.context.agentRunControllers.size, 1);
  saved.resolve({});
  assert.equal((await running).ok, true);
  assert.deepEqual(fixture.coordinator.snapshot("session:parent").resultQueue, []);
  assert.equal(fixture.coordinator.snapshot("session:parent").state, "IDLE");
  const restarted = createAgentRunHandlerFixture();
  restarted.coordinator.restoreWave("session:parent", wave);
  assert.deepEqual(restarted.coordinator.snapshot("session:parent").resultQueue, []);
});

test("a question continuation cannot enter another admission's claimed result", async () => {
  const fixture = createAgentRunHandlerFixture();
  const resultId = await queueChildResult(fixture);
  assert.equal(fixture.coordinator.claimResult("session:parent", resultId).ok, true);
  const outcome = await fixture.invoke({ sessionId: "parent", continuation: { questionRequestId: "question-1" } });
  assert.equal(outcome.code, "PARENT_BUSY");
  assert.equal(fixture.context.parentRunDescriptors.size, 0);
  assert.equal(fixture.coordinator.snapshot("session:parent").processingResultId, resultId);
});

test("cleanup never removes a replacement controller registered under the same key", async () => {
  const fixture = createAgentRunHandlerFixture();
  const replacement = new AbortController();
  fixture.context.runAgentTurn = async () => {
    fixture.context.agentRunControllers.set("session:parent", replacement);
    return { ok: true, runState: { status: "completed" } };
  };
  await fixture.invoke({ sessionId: "parent", userMessage: "Task" });
  assert.strictEqual(fixture.context.agentRunControllers.get("session:parent"), replacement);
  assert.equal(replacement.signal.aborted, false);
  assert.equal(fixture.context.powerSaveActive, true);
});

test("interrupted-run recovery passes its saved run identity and accounting into the execution engine", async () => {
  const fixture = createAgentRunHandlerFixture();
  const calls = [];
  const accounting = { providerAttempts: 5, outputSegments: 2, protocolRepairs: 1 };
  const saved = { runId: "durable-original", sessionId: "parent", objective: "Original task", model: "model-1", checkpoint: { accounting } };
  fixture.context.container.longHorizonRunStore.known = () => ["G:/workspace"];
  fixture.context.container.longHorizonRunStore.listResumeEligible = () => [saved];
  fixture.context.container.longHorizonRunStore.resume = async () => saved;
  fixture.context.runAgentTurn = async (payload) => {
    calls.push(payload);
    return { ok: true, runState: { status: "completed" } };
  };
  const started = await fixture.handlers.resumeInterruptedRuns({ sender: fixture.sender }, ["parent"]);
  assert.equal(started[0], "durable-original");
  await tick();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, "durable-original");
  assert.strictEqual(calls[0].roundAccountingSnapshot, accounting);
  assert.equal(fixture.context.parentRunDescriptors.get("session:parent").durableRunId, "durable-original");
});

test("admission restores checkpoint accounting while preserving an explicitly supplied snapshot", async () => {
  const fixture = createAgentRunHandlerFixture();
  const checkpoint = { providerAttempts: 7 };
  const supplied = { providerAttempts: 9 };
  const calls = [];
  fixture.context.container.longHorizonRunStore.get = (_workspace, runId) => {
    assert.equal(runId, "saved-run");
    return { checkpoint: { accounting: checkpoint } };
  };
  fixture.context.runAgentTurn = async (payload) => {
    calls.push(payload);
    return { ok: true, runState: { status: "completed" } };
  };
  await fixture.invoke({ workspace: "G:/workspace", sessionId: "parent", runId: "saved-run", userMessage: "Resume" });
  assert.strictEqual(calls[0].roundAccountingSnapshot, checkpoint);
  await fixture.invoke({ workspace: "G:/workspace", sessionId: "parent", runId: "saved-run", userMessage: "Resume", roundAccountingSnapshot: supplied });
  assert.strictEqual(calls[1].roundAccountingSnapshot, supplied);
});
