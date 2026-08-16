const test = require("node:test");
const assert = require("node:assert/strict");
const ContextBudget = require("../src/agent/runtime/context-budget.js");

test("OpenRouter metadata resolves an automatic working budget below the official maximum", () => {
  const plan = ContextBudget.resolveContextPlan({
    provider: "openrouter",
    model: "acme/model",
    metadata: { context_length: 131072, top_provider: { max_completion_tokens: 8192 } },
    preference: { mode: "auto" },
  });
  assert.equal(plan.modelMaxTokens, 131072);
  assert.equal(plan.effectiveLimitTokens, 131072);
  assert.ok(plan.promptBudgetTokens < plan.effectiveLimitTokens);
  // The reserve scales with the model's max completion (not a fixed 8192 cap).
  assert.ok(plan.responseReserveTokens > 0);
  assert.ok(plan.responseReserveTokens <= 8192, "reserve is bounded by the model's max completion");
  assert.equal(plan.provider, "openrouter");
});

test("custom context caps are clamped to the model maximum and remain provider-qualified", () => {
  const plan = ContextBudget.resolveContextPlan({
    provider: "openrouter",
    model: "acme/model",
    metadata: { contextWindowTokens: 32768 },
    preference: { mode: "custom", limitTokens: 65536 },
  });
  assert.equal(plan.mode, "custom");
  assert.equal(plan.effectiveLimitTokens, 32768);
  assert.equal(plan.source, "manual");
  assert.equal(ContextBudget.contextKey("openrouter", "acme/model"), "openrouter:acme/model");
});

test("context options expose only values supported by the official maximum", () => {
  assert.deepEqual(ContextBudget.contextOptions(65536), [4096, 8192, 16384, 32768, 65536]);
  assert.deepEqual(ContextBudget.contextOptions(2048), [2048]);
});

test("OpenRouter reasoning metadata exposes only the selected model's supported efforts", () => {
  const metadata = ContextBudget.normalizeModelMetadata({
    id: "openai/gpt-5",
    supported_parameters: ["reasoning", "tools"],
    reasoning: {
      supported_efforts: ["low", "high", "not-a-real-effort"],
      default_effort: "low",
      default_enabled: true,
      mandatory: false,
    },
  });
  assert.deepEqual(metadata.reasoning, {
    available: true,
    selectable: true,
    supportedEfforts: ["high", "low"],
    defaultEffort: "low",
    defaultEnabled: true,
    supportsMaxTokens: false,
    mandatory: false,
  });
});

test("OpenRouter reasoning metadata handles gateway-wide effort support and mandatory reasoning", () => {
  const metadata = ContextBudget.normalizeModelMetadata({
    supported_parameters: ["reasoning"],
    reasoning: { supported_efforts: null, mandatory: true },
  });
  assert.equal(metadata.reasoning.selectable, true);
  assert.equal(metadata.reasoning.mandatory, true);
  assert.deepEqual(metadata.reasoning.supportedEfforts, ContextBudget.REASONING_EFFORT_ORDER);
});

test("models without an effort list remain automatic instead of showing fabricated levels", () => {
  const metadata = ContextBudget.normalizeModelMetadata({
    supported_parameters: ["reasoning"],
  });
  assert.deepEqual(metadata.reasoning, {
    available: true,
    selectable: false,
    supportedEfforts: [],
    defaultEffort: null,
    defaultEnabled: null,
    supportsMaxTokens: false,
    mandatory: false,
  });
});

test("token estimates are shared across context planning consumers", () => {
  assert.equal(ContextBudget.estimateTokenCount(""), 0);
  assert.ok(ContextBudget.estimateTokenCount("const value = 42;\n") > 0);
  assert.ok(ContextBudget.estimateTokenCount("API response: 你好") >= 4);
});
