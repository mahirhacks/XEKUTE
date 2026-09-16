"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ContextBudget = require("../src/agent/runtime/context-budget.js");

test("contextOptions lists standard windows that fit under the model maximum", () => {
  assert.deepEqual(ContextBudget.contextOptions(1_048_576), [
    4_096,
    8_192,
    16_384,
    32_768,
    65_536,
    131_072,
    262_144,
    524_288,
    1_048_576,
  ]);
  assert.deepEqual(ContextBudget.contextOptions(262_144), [
    4_096,
    8_192,
    16_384,
    32_768,
    65_536,
    131_072,
    262_144,
  ]);
  assert.deepEqual(ContextBudget.contextOptions(200_000), [
    4_096,
    8_192,
    16_384,
    32_768,
    65_536,
    131_072,
    200_000,
  ]);
});

test("contextOptions keeps the model maximum even when it is not a standard size", () => {
  assert.deepEqual(ContextBudget.contextOptions(4096), [4096]);
  assert.deepEqual(ContextBudget.contextOptions(8192), [4096, 8192]);
});

test("formatContextWindowLabel matches picker labels for standard windows", () => {
  assert.equal(ContextBudget.formatContextWindowLabel(4_096), "4K");
  assert.equal(ContextBudget.formatContextWindowLabel(32_768), "32K");
  assert.equal(ContextBudget.formatContextWindowLabel(65_536), "64K");
  assert.equal(ContextBudget.formatContextWindowLabel(131_072), "128K");
  assert.equal(ContextBudget.formatContextWindowLabel(262_144), "256K");
  assert.equal(ContextBudget.formatContextWindowLabel(1_048_576), "1M");
  assert.equal(ContextBudget.formatContextWindowLabel(2_097_152), "2M");
  assert.equal(ContextBudget.formatContextWindowLabel(128_000), "128K");
  assert.equal(ContextBudget.formatContextWindowLabel(200_000), "200K");
});

test("legacyContextLabelToTokens parses binary K and M labels", () => {
  assert.equal(ContextBudget.legacyContextLabelToTokens("128K"), 131_072);
  assert.equal(ContextBudget.legacyContextLabelToTokens("1M"), 1_048_576);
});

test("pickerContextOptions shows the top 3 standard windows that fit the model", () => {
  assert.deepEqual(ContextBudget.pickerContextOptions(1_048_576), [131_072, 262_144, 1_048_576]);
  assert.deepEqual(ContextBudget.pickerContextOptions(200_000), [32_768, 131_072]);
  assert.deepEqual(ContextBudget.pickerContextOptions(262_144), [32_768, 131_072, 262_144]);
  assert.deepEqual(ContextBudget.pickerContextOptions(32_768), [32_768]);
  assert.deepEqual(ContextBudget.pickerContextOptions(8_192), [4_096, 8_192]);
});

test("formatPickerContextLabel uses compact standard names", () => {
  assert.equal(ContextBudget.formatPickerContextLabel(32_768), "32K");
  assert.equal(ContextBudget.formatPickerContextLabel(131_072), "128K");
  assert.equal(ContextBudget.formatPickerContextLabel(262_144), "262K");
  assert.equal(ContextBudget.formatPickerContextLabel(1_048_576), "1M");
});
