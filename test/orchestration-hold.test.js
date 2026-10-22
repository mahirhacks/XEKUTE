"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubagentCoordinator } = require("../src/agent/runtime/subagent-coordinator.js");
const { computeOrchestrationHold } = require("../src/agent/runtime/orchestration-hold.js");

test("computeOrchestrationHold is true for active children and unconsumed results", async () => {
  const coordinator = createSubagentCoordinator();
  coordinator.submitChild({
    parentKey: "p",
    childInvocationId: "c1",
    childSessionId: "s1",
    start: async () => new Promise(() => {}),
  });
  assert.equal(computeOrchestrationHold(coordinator, "p", {}), true);
  coordinator.completeChild("c1", { status: "completed", output: { text: "x" } });
  assert.equal(coordinator.hasUnconsumedResults("p"), true);
  assert.equal(computeOrchestrationHold(coordinator, "p", {}), true);
  assert.equal(computeOrchestrationHold(coordinator, "p", { parentContinuationScheduled: true }), true);
});

test("the continuation consuming a result does not wait on itself", async t => {
  const coordinator = createSubagentCoordinator();
  t.after(() => coordinator.shutdown());
  coordinator.submitChild({ parentKey: "p", childInvocationId: "c", childSessionId: "s", start: async () => ({ status: "completed", output: { text: "done" } }) });
  await new Promise(resolve => setImmediate(resolve));
  const resultId = coordinator.snapshot("p").resultQueue[0];
  assert.equal(coordinator.claimResult("p", resultId).ok, true);
  assert.equal(computeOrchestrationHold(coordinator, "p"), true);
  assert.equal(computeOrchestrationHold(coordinator, "p", { activeResultId: resultId }), false);
  assert.equal(computeOrchestrationHold(coordinator, "p", { activeResultId: "another-result" }), true);
  coordinator.submitChild({ parentKey: "p", childInvocationId: "other", childSessionId: "other-s", start: async () => ({ status: "completed", output: { text: "more" } }) });
  assert.equal(computeOrchestrationHold(coordinator, "p", { activeResultId: resultId }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(computeOrchestrationHold(coordinator, "p", { activeResultId: resultId }), true);
});
