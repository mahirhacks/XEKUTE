const test = require("node:test");
const assert = require("node:assert/strict");
const ContextBudget = require("../src/adapters/llm/context-budget");

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
  assert.ok(plan.responseReserveTokens <= 8192);
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

test("token estimates are shared across context planning consumers", () => {
  assert.equal(ContextBudget.estimateTokenCount(""), 0);
  assert.ok(ContextBudget.estimateTokenCount("const value = 42;\n") > 0);
  assert.ok(ContextBudget.estimateTokenCount("API response: 你好") >= 4);
});
