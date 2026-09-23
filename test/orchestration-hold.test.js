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
