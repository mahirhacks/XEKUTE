"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ContextBudget = require("../src/agent/runtime/context-budget.js");

test("contextOptions exposes only context_limit / 1, / 2, and / 3 rounded up to whole thousands", () => {
  assert.deepEqual(ContextBudget.contextOptions(1_048_576), [1_048_576, 525_000, 350_000]);
  assert.deepEqual(ContextBudget.contextOptions(262_144), [262_144, 132_000, 88_000]);
});

test("contextOptions drops fractions below the minimum window", () => {
  assert.deepEqual(ContextBudget.contextOptions(4096), [4096, 3000]);
  assert.deepEqual(ContextBudget.contextOptions(8192), [8192, 5000, 3000]);
});
