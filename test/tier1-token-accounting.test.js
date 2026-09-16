"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Accounting = require("../src/agent/runtime/tier1-token-accounting.js");

const SECTIONS = [
  { key: "system_prompt", tokens: 101 },
  { key: "tool_definitions", tokens: 57 },
  { key: "rules", tokens: 31 },
  { key: "skills", tokens: 19 },
  { key: "subagents", tokens: 0 },
  { key: "mcp", tokens: 11 },
  { key: "summarized_conversation", tokens: 0 },
  { key: "active_conversation", tokens: 83 },
  { key: "current_workflow", tokens: 0 },
];

test.beforeEach(() => Accounting.resetCalibrationsForTest());

test("Tier 1 reconciliation is deterministic and exactly matches the provider total", () => {
  const first = Accounting.reconcileSections(SECTIONS, 1_003);
  const second = Accounting.reconcileSections(SECTIONS, 1_003);

  assert.deepEqual(first, second);
  assert.equal(first.reduce((sum, section) => sum + section.tokens, 0), 1_003);
  assert.deepEqual(first.map((section) => section.key), SECTIONS.map((section) => section.key));
  assert.equal(first.find((section) => section.key === "subagents").tokens, 0);
  assert.equal(first.find((section) => section.key === "system_prompt").localTokens, 101);
});

test("provider measurements calibrate later local preflight counts per provider and model", () => {
  assert.equal(Accounting.calibratedPromptTokens(1_000, { provider: "ollama", model: "qwen3" }), 1_000);
  const observed = Accounting.rememberCalibration({
    provider: "ollama",
    model: "qwen3",
    estimatedTokens: 1_000,
    measuredTokens: 1_250,
  });

  assert.equal(observed.factor, 1.25);
  assert.equal(Accounting.calibratedPromptTokens(2_000, { provider: "ollama", model: "qwen3" }), 2_500);
  assert.equal(Accounting.calibratedPromptTokens(2_000, { provider: "openrouter", model: "qwen3" }), 2_000);
});

test("zero provider usage is not treated as an authoritative empty prompt", () => {
  assert.equal(Accounting.positiveMeasuredTokens(0), null);
  assert.equal(Accounting.positiveMeasuredTokens(null), null);
  assert.equal(Accounting.positiveMeasuredTokens(42), 42);
});

test("reconciled usage retains local attribution diagnostics without changing the public rows", () => {
  const usage = Accounting.reconcileUsage({
    source: "estimate",
    promptTokens: 302,
    localPromptTokens: 302,
    sections: SECTIONS,
  }, 777, { source: "openrouter", measuredAt: "2026-09-01T00:00:00.000Z" });

  assert.equal(usage.promptTokens, 777);
  assert.equal(usage.sections.reduce((sum, section) => sum + section.tokens, 0), 777);
  assert.equal(usage.tokenCalculation.method, "provider-reconciled");
  assert.equal(usage.tokenCalculation.localPromptTokens, 302);
  assert.equal(usage.tokenCalculation.sectionReconciledTotal, 777);
});
