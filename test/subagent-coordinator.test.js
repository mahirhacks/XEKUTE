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

test("a fresh primary task keeps its admitted turn and clears prior failed packets", async () => {
  const packets = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => { packets.push(result); return true; } });
  coordinator.beginParentTurn("parent");
  coordinator.submitChild({ parentKey: "parent", childInvocationId: "old", childSessionId: "old-session", task: "Prior task",
    start: async () => ({ status: "failed", output: { text: "Prior failure" } }) });
  await tick();
  coordinator.finishParentTurn("parent", { stopped: true });
  assert.equal(coordinator.hasUnconsumedResults("parent"), true);
  assert.equal(coordinator.beginParentTurn("parent").ok, true);
  const reset = coordinator.resetParentForTask("parent");
  assert.equal(reset.state, "BUSY");
  assert.equal(reset.removed, 1);
  assert.equal(coordinator.beginParentTurn("parent").code, "PARENT_BUSY");
  assert.equal(coordinator.hasUnconsumedResults("parent"), false);
  assert.deepEqual(coordinator.listChildren("parent"), []);
  assert.equal(coordinator.exportWave("parent").wave, null);
  coordinator.submitChild({ parentKey: "parent", childInvocationId: "fresh", childSessionId: "fresh-session", task: "Fresh task",
    start: async () => ({ status: "completed", output: { text: "Fresh answer" } }) });
  await tick();
  assert.equal(packets.length, 0, "the fresh turn owns result delivery until it finishes");
  coordinator.finishParentTurn("parent");
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0].children.map((child) => [child.childInvocationId, child.output.text]), [["fresh", "Fresh answer"]]);
});

test("fresh task reset aborts old children and ignores their late completion even when IDs are reused", async () => {
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 1 });
  const oldWait = deferred();
  const freshWait = deferred();
  const otherWait = deferred();
  const oldController = new AbortController();
  const queuedController = new AbortController();
  const otherController = new AbortController();
  let queuedStarted = 0;
  let queuedCancelled = 0;
  coordinator.beginParentTurn("parent");
  coordinator.submitChild({ parentKey: "parent", childInvocationId: "same-id", childSessionId: "old-session", task: "Old work", controller: oldController, start: () => oldWait.promise });
  coordinator.submitChild({ parentKey: "parent", childInvocationId: "old-queued", childSessionId: "queued-session", task: "Old queued work", controller: queuedController,
    start: async () => { queuedStarted += 1; return { status: "completed" }; }, onCancel: () => { queuedCancelled += 1; } });
  coordinator.submitChild({ parentKey: "other", childInvocationId: "other-child", childSessionId: "other-session", task: "Other work", controller: otherController, start: () => otherWait.promise });
  await tick();
  coordinator.enqueueSteer({ parentKey: "parent", childInvocationId: "same-id", instruction: "Old steering" });
  coordinator.enqueueQuestion({ parentKey: "parent", childInvocationId: "same-id", childSessionId: "old-session", questionRequestId: "old-question", payload: { question: "Old question" } });
  const reset = coordinator.resetParentForTask("parent");
  assert.equal(reset.cancelled, 2);
  assert.deepEqual(reset.questionRequestIds, ["old-question"]);
  assert.equal(oldController.signal.reason, "PARENT_TASK_REPLACED");
  assert.equal(queuedController.signal.aborted, true);
  assert.equal(queuedCancelled, 1);
  assert.equal(queuedStarted, 0);
  assert.equal(otherController.signal.aborted, false);
  assert.equal(coordinator.peekQuestionHead("parent"), null);
  assert.equal(coordinator.snapshot("parent").state, "BUSY");
  assert.equal(coordinator.snapshot("parent").activeCount, 0);
  assert.deepEqual(coordinator.snapshot("parent").queuedChildren, []);
  coordinator.submitChild({ parentKey: "parent", childInvocationId: "same-id", childSessionId: "fresh-session", task: "Fresh work", start: () => freshWait.promise });
  await tick();
  oldWait.resolve({ status: "failed", output: { text: "Stale answer" } });
  await tick();
  assert.equal(coordinator.getChild("same-id", "parent").childSessionId, "fresh-session");
  assert.equal(coordinator.getChild("same-id", "parent").status, "working");
  assert.equal(coordinator.snapshot("parent").activeCount, 1);
  assert.equal(coordinator.hasUnconsumedResults("parent"), false);
  freshWait.resolve({ status: "completed", output: { text: "Fresh answer" } });
  otherWait.resolve({ status: "completed", output: { text: "Other answer" } });
  await tick();
  const fresh = coordinator.exportWave("parent");
  assert.deepEqual(fresh.resultQueue[0].children.map((child) => child.output.text), ["Fresh answer"]);
  assert.equal(fresh.children.some((child) => child.childSessionId === "old-session"), false);
  assert.equal(coordinator.getChild("other-child", "other").status, "completed");
});

test("steering preserves original text and IDs until explicit acknowledgment", async () => {
  const coordinator = createSubagentCoordinator();
  const wait = deferred();
  coordinator.submitChild({ parentKey: "parent", parentSessionId: "session", childInvocationId: "child", childSessionId: "child-session", task: "Inspect", start: () => wait.promise });
  await tick();
  const original = `  Arial\n${"x".repeat(13_000)}  `;
  const first = coordinator.enqueueSteer({ parentKey: "parent", childInvocationId: "child", instruction: original });
  const second = coordinator.enqueueSteer({ parentKey: "parent", childInvocationId: "child", instruction: "Keep headings" });
  assert.equal(first.ok, true);
  assert.notEqual(first.messageId, second.messageId);
  const peeked = coordinator.peekSteerQueue("child", "parent");
  assert.equal(peeked[0].instruction, original);
  peeked[0].instruction = "changed by caller";
  assert.equal(coordinator.peekSteerQueue("child", "parent")[0].instruction, original);
  assert.deepEqual(coordinator.acknowledgeSteers("child", "parent", [first.messageId]), { ok: true, acknowledged: 1 });
  assert.deepEqual(coordinator.acknowledgeSteers("child", "parent", [first.messageId]), { ok: true, acknowledged: 0 });
  assert.equal(coordinator.peekSteerQueue("child", "parent")[0].id, second.messageId);
  assert.equal(coordinator.enqueueSteer({ parentKey: "parent", childInvocationId: "child", instruction: "x".repeat(100_001) }).code, "STEER_TOO_LARGE");
  assert.equal(coordinator.peekSteerQueue("child", "parent").length, 1);
  assert.deepEqual(coordinator.sealSteering("child", "parent"), { ok: true, completed: false, reason: "PENDING_INPUT" });
  coordinator.acknowledgeSteers("child", "parent", [second.messageId]);
  assert.deepEqual(coordinator.sealSteering("child", "parent"), { ok: true, completed: true });
  assert.equal(coordinator.enqueueSteer({ parentKey: "parent", childInvocationId: "child", instruction: "Late message" }).code, "SUBAGENT_NOT_ACTIVE");
  wait.resolve({ status: "completed" });
  await tick();
});

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
  assert.equal(results.length, 0, "a single completion does not wake the parent while the wave is open");
  assert.equal(lifecycle.some((event) => event.type === "subagent_queued" && event.childInvocationId === "child-4"), true);

  coordinator.finishParentTurn("sender::parent");
  assert.equal(results.length, 0, "the parent stays quiet until every child in the wave is terminal");
  waits.get("child-1").resolve({ status: "completed", output: { text: "one" }, metadata: {} });
  waits.get("child-3").resolve({ status: "failed", output: { text: "three" }, metadata: {} });
  waits.get("child-4").resolve({ status: "stopped", output: { text: "four" }, metadata: {} });
  await tick();
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "batch");
  assert.equal(results[0].children.length, 4);
  assert.equal(results[0].children.some((child) => child.childInvocationId === "child-2" && child.status === "completed"), true);
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
  assert.equal(firstResult.kind, "batch");
  assert.equal(firstResult.children[0].childSessionId, "child-session");

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
  assert.equal(results[0].kind, "batch");
  assert.equal(results[0].children[0].status, "failed");
  assert.equal(results[0].children[0].metadata.runtimeStatus, "inconclusive");
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

test("operator stop without a claimed result pauses FIFO until the next user turn", async () => {
  const ready = [];
  const coordinator = createSubagentCoordinator({ onResultReady: (result) => ready.push(result) });
  const wait = deferred();
  coordinator.beginParentTurn("p");
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child-1",
    childSessionId: "child-session",
    start: () => wait.promise,
  });
  coordinator.finishParentTurn("p", { stopped: true });
  wait.resolve({ status: "completed", output: { text: "late" }, metadata: {} });
  await tick();
  assert.equal(ready.length, 0);

  coordinator.beginParentTurn("p");
  coordinator.finishParentTurn("p");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].kind, "batch");
  assert.equal(ready[0].children[0].childInvocationId, "child-1");
});

test("cancelChildrenForParent aborts working and queued children", async () => {
  const activeController = new AbortController();
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 1 });
  const working = deferred();
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "working",
    childSessionId: "working-session",
    controller: activeController,
    start: () => working.promise,
  });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "queued",
    childSessionId: "queued-session",
    start: async () => ({ status: "completed", output: { text: "unexpected" } }),
  });
  await tick();
  const cancelled = coordinator.cancelChildrenForParent("p");
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.cancelled, 2);
  assert.equal(activeController.signal.aborted, true);
  working.resolve({
    status: "stopped",
    output: { text: "", summary: "stopped" },
    metadata: { error: "Stopped by operator" },
  });
  await tick();
  assert.equal(coordinator.getChild("working", "p").status, "stopped");
  assert.equal(coordinator.getChild("queued", "p").status, "stopped");
});

test("stopping one parent does not stop another parent's children", async () => {
  const stoppedController = new AbortController();
  const otherController = new AbortController();
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 2 });
  const stopped = deferred();
  const other = deferred();
  coordinator.submitChild({
    parentKey: "orchestrator-a",
    parentSessionId: "session-a",
    childInvocationId: "child-a",
    childSessionId: "child-a-session",
    controller: stoppedController,
    start: () => stopped.promise,
  });
  coordinator.submitChild({
    parentKey: "orchestrator-b",
    parentSessionId: "session-b",
    childInvocationId: "child-b",
    childSessionId: "child-b-session",
    controller: otherController,
    start: () => other.promise,
  });
  await tick();
  const cancelled = coordinator.cancelChildrenForParent("orchestrator-a", "OPERATOR_STOPPED");
  assert.equal(cancelled.cancelled, 1);
  assert.equal(stoppedController.signal.aborted, true);
  assert.equal(otherController.signal.aborted, false);
  assert.equal(coordinator.getChild("child-b", "orchestrator-b").status, "working");
  stopped.resolve({ status: "stopped", output: { text: "", summary: "stopped" }, metadata: { error: "Stopped by operator" } });
  other.resolve({ status: "completed", output: { text: "still running" } });
  await tick();
  assert.equal(coordinator.getChild("child-a", "orchestrator-a").status, "stopped");
  assert.equal(coordinator.getChild("child-b", "orchestrator-b").status, "completed");
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

test("question FIFO head, roster pendingQuestion, steer queue, and hold predicates", async () => {
  const coordinator = createSubagentCoordinator();
  coordinator.submitChild({
    parentKey: "parent-key",
    parentSessionId: "parent",
    childInvocationId: "child-a",
    childSessionId: "child-session-a",
    start: async () => new Promise(() => {}),
  });
  coordinator.enqueueQuestion({
    parentKey: "parent-key",
    questionRequestId: "q-1",
    childInvocationId: "child-a",
    childSessionId: "child-session-a",
    payload: { reason: "first" },
  });
  coordinator.enqueueQuestion({
    parentKey: "parent-key",
    questionRequestId: "q-2",
    childInvocationId: "child-a",
    childSessionId: "child-session-a",
    payload: { reason: "second" },
  });
  const head = coordinator.peekQuestionHead("parent-key");
  assert.equal(head.questionRequestId, "q-1");
  const roster = coordinator.listChildren("parent-key");
  assert.equal(roster.length, 1);
  assert.equal(typeof roster[0].pendingQuestion, "boolean");
  assert.equal(roster[0].pendingQuestion, true);
  const wrong = coordinator.resolveQuestion({ parentKey: "parent-key", questionRequestId: "q-2", resolution: "skip" });
  assert.equal(wrong.code, "QUESTION_NOT_HEAD");
  const skipped = coordinator.resolveQuestion({ parentKey: "parent-key", resolution: "skip" });
  assert.equal(skipped.ok, true);
  assert.equal(coordinator.peekQuestionHead("parent-key").questionRequestId, "q-2");
  const steered = coordinator.enqueueSteer({ parentKey: "parent-key", childInvocationId: "child-a", instruction: "focus on tests" });
  assert.equal(steered.ok, true);
  assert.equal(coordinator.drainSteerQueue("child-a", "parent-key").length, 1);
  coordinator.finishParentTurn("parent-key");
  assert.equal(coordinator.listChildren("parent-key").length, 1);
  assert.equal(coordinator.hasActiveChildren("parent-key"), true);
  coordinator.completeChild("child-a", { status: "completed", output: { text: "done" } });
  assert.equal(coordinator.hasUnconsumedResults("parent-key"), true);
  assert.equal(coordinator.getRosterEntry("parent-key", "child-a").pendingQuestion, false);
});

test("spawn admission accepts up to five children and rejects a sixth batch", () => {
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 5 });
  assert.equal(coordinator.validateSpawnAdmission("parent-key", 5).ok, true);
  assert.equal(coordinator.validateSpawnAdmission("parent-key", 6).code, "TOO_MANY_SUBAGENTS");
});

test("spawn admission rejects another wave until the batch is claimed", async () => {
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 5 });
  coordinator.submitChild({
    parentKey: "parent-key",
    childInvocationId: "child-1",
    childSessionId: "session-1",
    start: async () => ({ status: "completed", output: { text: "done" } }),
  });
  await tick();
  const blocked = coordinator.validateSpawnAdmission("parent-key", 1);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "SPAWN_WHILE_CHILDREN_ACTIVE");
  const resultId = coordinator.pendingResultsForSender("")[0].resultId;
  assert.equal(coordinator.claimResult("parent-key", resultId).ok, true);
  coordinator.finishParentTurn("parent-key", { resultId });
  assert.equal(coordinator.validateSpawnAdmission("parent-key", 1).ok, true);
});

test("a reloaded wave restores an open child as blocked and keeps one unconsumed batch", async () => {
  const original = createSubagentCoordinator({ maxActiveChildren: 2 });
  const waiting = deferred();
  original.submitChild({
    parentKey: "parent-key",
    parentSessionId: "parent-session",
    childInvocationId: "done-child",
    childSessionId: "done-session",
    start: async () => ({ status: "completed", output: { text: "found it", finding: { status: "done", summary: "found it", evidenceRefs: ["notes.md"], unverified: [] } } }),
  });
  original.submitChild({
    parentKey: "parent-key",
    parentSessionId: "parent-session",
    childInvocationId: "open-child",
    childSessionId: "open-session",
    start: () => waiting.promise,
  });
  await tick();
  const snapshot = original.exportWave("parent-key");
  assert.equal(snapshot.wave.pendingIds.includes("open-child"), true);
  const restored = createSubagentCoordinator();
  const recovery = restored.restoreWave("parent-key", snapshot);
  assert.equal(recovery.hold, true);
  assert.equal(restored.hasActiveChildren("parent-key"), false);
  assert.equal(restored.hasUnconsumedResults("parent-key"), true);
  assert.equal(recovery.pendingBatch.kind, "batch");
  const open = recovery.pendingBatch.children.find((child) => child.childInvocationId === "open-child");
  assert.equal(open.status, "failed");
  assert.equal(open.output.finding.status, "blocked");
  assert.equal(restored.validateSpawnAdmission("parent-key", 1).code, "SPAWN_WHILE_CHILDREN_ACTIVE");
});

test("a sealed wave retries delivery without waiting for another parent turn", async () => {
  let calls = 0;
  const coordinator = createSubagentCoordinator({
    onResultReady: () => {
      calls += 1;
      return calls > 1;
    },
  });
  coordinator.submitChild({
    parentKey: "p",
    parentSessionId: "parent",
    childInvocationId: "child",
    childSessionId: "child-session",
    start: async () => ({ status: "stopped", output: { text: "", summary: "Stopped" } }),
  });
  await tick();
  assert.equal(calls, 2);
  assert.equal(coordinator.hasUnconsumedResults("p"), true);
});

test("a spawn while children work joins their wave, and a finished unreviewed wave blocks the next spawn", async () => {
  const coordinator = createSubagentCoordinator({ maxActiveChildren: 5 });
  let finish;
  const start = () => new Promise((resolve) => { finish = () => resolve({ status: "completed", output: { text: "ok" } }); });
  coordinator.submitChild({
    parentKey: "parent-key",
    childInvocationId: "child-1",
    childSessionId: "session-1",
    start,
  });
  assert.equal(coordinator.openChildCount("parent-key"), 1);
  assert.equal(coordinator.validateSpawnAdmission("parent-key", 1).ok, true);
  for (let i = 0; i < 5 && !finish; i += 1) await new Promise(setImmediate);
  finish();
  for (let i = 0; i < 5 && coordinator.openChildCount("parent-key"); i += 1) await new Promise(setImmediate);
  const blocked = coordinator.validateSpawnAdmission("parent-key", 1);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "SPAWN_WHILE_CHILDREN_ACTIVE");
});
