"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubagentCoordinator } = require("../src/agent/runtime/subagent-coordinator.js");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test("coordinator admits three children, queues the fourth, and starts it FIFO", async () => {
  const starts = [];
  const lifecycle = [];
  const results = [];
  const waits = new Map();
  const coordinator = createSubagentCoordinator({
    maxActiveChildren: 3,
    onLifecycle: (event) => lifecycle.push(event),
    onResultReady: (result) => results.push(result),
  });
  coordinator.beginParentTurn("sender::parent");

  for (let index = 1; index <= 4; index += 1) {
    const wait = deferred();
    waits.set(`child-${index}`, wait);
    coordinator.submitChild({
      parentKey: "sender::parent",
      parentSessionId: "parent",
      childInvocationId: `child-${index}`,
      childSessionId: `session-${index}`,
      task: `task ${index}`,
      start: () => {
        starts.push(index);
        return wait.promise;
      },
    });
  }

  await tick();
  assert.deepEqual(starts, [1, 2, 3]);
  assert.deepEqual(coordinator.snapshot("sender::parent").queuedChildren, ["child-4"]);

  waits.get("child-2").resolve({ status: "completed", output: { text: "two" }, metadata: {} });
  await tick();
  assert.deepEqual(starts, [1, 2, 3, 4]);
  assert.equal(results.length, 0, "results wait until the parent turn is idle");
  assert.equal(lifecycle.some((event) => event.type === "subagent_queued" && event.childInvocationId === "child-4"), true);

  coordinator.finishParentTurn("sender::parent");
  assert.equal(results.length, 1);
  assert.equal(results[0].childInvocationId, "child-2");
  assert.equal(results[0].status, "completed");
});

test("result handoff is one-at-a-time and a follow-up reuses the child session/history", async () => {
  const waits = new Map();
  const ready = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => ready.push(result) });
  const first = deferred();
  waits.set("child-1", first);
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child-1",
    childSessionId: "child-session",
    start: () => first.promise,
  });
  await tick();
  first.resolve({
    status: "completed",
    output: { text: "initial" },
    metadata: { appendedMessages: [{ role: "assistant", content: "initial" }] },
  });
  await tick();
  coordinator.finishParentTurn("p");
  const firstResult = ready.at(-1);
  assert.equal(firstResult.childSessionId, "child-session");

  const claim = coordinator.claimResult("p", firstResult.resultId);
  assert.equal(claim.ok, true);
  assert.equal(coordinator.beginParentTurn("p", { continuation: true }).ok, true);
  coordinator.finishParentTurn("p", { resultId: firstResult.resultId });
  assert.deepEqual(coordinator.getChild("child-1", "p").history, [{ role: "assistant", content: "initial" }]);

  const follow = deferred();
  const queued = coordinator.submitFollowUp({
    parentKey: "p",
    childInvocationId: "child-1",
    task: "please verify it",
    controller: new AbortController(),
    start: (child) => {
      assert.equal(child.childSessionId, "child-session");
      return follow.promise;
    },
  });
  assert.equal(queued.ok, true);
  await tick();
  follow.resolve({ status: "completed", output: { text: "verified" }, metadata: {} });
  await tick();
  assert.equal(coordinator.getChild("child-1", "p").generation, 2);
  assert.equal(coordinator.getChild("child-1", "p").childSessionId, "child-session");
});

test("snapshot distinguishes an ordinary parent turn from FIFO result processing", async () => {
  const wait = deferred();
  const coordinator = createSubagentCoordinator();
  coordinator.beginParentTurn("p");
  assert.equal(coordinator.snapshot("p").state, "BUSY");
  coordinator.finishParentTurn("p");
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child",
    childSessionId: "child-session",
    start: () => wait.promise,
  });
  await tick();
  wait.resolve({ status: "completed", output: { text: "ready" }, metadata: {} });
  await tick();
  const result = coordinator.pendingResultsForSender("")[0];
  assert.equal(coordinator.claimResult("p", result.resultId).ok, true);
  assert.equal(coordinator.snapshot("p").state, "PROCESSING_RESULT");
});

test("a failed result notification is retried at the next idle boundary", async () => {
  const ready = [];
  let first = true;
  const coordinator = createSubagentCoordinator({
    onResultReady: (result) => {
      ready.push(result.resultId);
      if (first) {
        first = false;
        return false;
      }
      return true;
    },
  });
  coordinator.beginParentTurn("p");
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child",
    childSessionId: "child-session",
    start: async () => ({ status: "completed", output: { text: "ready" }, metadata: {} }),
  });
  await tick();
  coordinator.finishParentTurn("p");
  assert.deepEqual(ready.length, 1);
  coordinator.beginParentTurn("p");
  coordinator.finishParentTurn("p");
  assert.deepEqual(ready.length, 2);
});

test("queued children can be stopped without consuming an active slot", async () => {
  const active = deferred();
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 1 });
  coordinator.submitChild({ parentKey: "p", parentSessionId: "parent", childInvocationId: "active", childSessionId: "a", start: () => active.promise });
  coordinator.submitChild({ parentKey: "p", parentSessionId: "parent", childInvocationId: "queued", childSessionId: "q", start: async () => ({ status: "completed", output: { text: "unexpected" } }) });
  await tick();
  const stopped = coordinator.cancelChild("queued", "p");
  assert.equal(stopped.ok, true);
  assert.equal(stopped.result.status, "stopped");
  assert.equal(coordinator.snapshot("p").activeCount, 1);
  active.resolve({ status: "completed", output: { text: "done" }, metadata: {} });
  await tick();
  assert.equal(coordinator.snapshot("p").activeCount, 0);
});

test("unknown and inconclusive child outcomes fail closed", async () => {
  const results = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => results.push(result) });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "inconclusive",
    childSessionId: "child-session",
    start: async () => ({ status: "inconclusive", output: { text: "not enough context" }, metadata: {} }),
  });
  await tick();
  coordinator.finishParentTurn("p");
  assert.equal(coordinator.getChild("inconclusive", "p").status, "failed");
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].metadata.runtimeStatus, "inconclusive");
});

test("a stopped parent continuation leaves the FIFO result available for the next turn", async () => {
  const ready = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => ready.push(result) });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child",
    childSessionId: "child-session",
    start: async () => ({ status: "completed", output: { text: "result" }, metadata: {} }),
  });
  await tick();
  coordinator.finishParentTurn("p");
  const resultId = ready[0].resultId;
  assert.equal(coordinator.claimResult("p", resultId).ok, true);
  coordinator.finishParentTurn("p", { resultId, stopped: true });
  assert.equal(coordinator.snapshot("p").resultQueue.length, 1);

  coordinator.beginParentTurn("p");
  coordinator.finishParentTurn("p");
  assert.equal(ready.at(-1).resultId, resultId);
});

test("shutdown aborts active children, stops queued children, and closes admission", async () => {
  const activeController = new AbortController();
  const activeResult = new Promise((resolve) => {
    activeController.signal.addEventListener("abort", () => resolve({
      status: "stopped",
      output: { text: "", summary: "shutdown" },
      metadata: { error: "Application shutdown" },
    }), { once: true });
  });
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 1 });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    senderId: "sender",
    childInvocationId: "active",
    childSessionId: "active-session",
    controller: activeController,
    start: () => activeResult,
  });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    senderId: "sender",
    childInvocationId: "queued",
    childSessionId: "queued-session",
    start: async () => ({ status: "completed", output: { text: "unexpected" } }),
  });
  await tick();

  const shutdown = await coordinator.shutdown({ timeoutMs: 250 });
  assert.equal(activeController.signal.aborted, true);
  assert.equal(shutdown.activeChildren, 0);
  assert.equal(coordinator.snapshot("p").activeCount, 0);
  assert.equal(coordinator.getChild("active", "p").status, "stopped");
  assert.equal(coordinator.getChild("queued", "p").status, "stopped");
  assert.equal(coordinator.submitChild({
    parentKey: "p",
    childInvocationId: "after-shutdown",
    start: async () => ({ status: "completed" }),
  }).code, "SUBAGENT_COORDINATOR_CLOSED");
});

test("pending result recovery returns only unclaimed results for the requested sender", async () => {
  const coordinator = createSubagentCoordinator();
  coordinator.submitChild({
    parentKey: "sender::parent",
    parentSessionId: "parent-session",
    senderId: "sender",
    childInvocationId: "child",
    childSessionId: "child-session",
    start: async () => ({ status: "completed", output: { text: "ready" } }),
  });
  await tick();
  const pending = coordinator.pendingResultsForSender("sender");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].parentSessionId, "parent-session");
  assert.equal(coordinator.pendingResultsForSender("other").length, 0);

  const claim = coordinator.claimResult("sender::parent", pending[0].resultId);
  assert.equal(claim.ok, true);
  assert.equal(coordinator.pendingResultsForSender("sender").length, 0, "claimed results are in-flight, not recoverable duplicates");
});
