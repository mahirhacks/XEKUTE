const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildChatRequest } = require("../src/agent/llm/openrouter/providers.js");

test("OpenRouter requests preserve an explicitly requested output cap and deterministic transform policy", () => {
  const request = buildChatRequest({
    apiKey: "test-key",
    model: "acme/model",
    messages: [{ role: "user", content: "hello" }],
    maxCompletionTokens: 32000,
    plugins: [{ id: "context-compression", enabled: false }],
  });
  assert.equal(request.body.max_completion_tokens, 32000);
  assert.deepEqual(request.body.plugins, [{ id: "context-compression", enabled: false }]);
});

test("OpenRouter requests encode the selected reasoning effort and ignore automatic or invalid values", () => {
  const high = buildChatRequest({
    apiKey: "test-key",
    model: "openai/gpt-5",
    messages: [{ role: "user", content: "hello" }],
    reasoningEffort: "HIGH",
  });
  assert.deepEqual(high.body.reasoning, { effort: "high" });
  assert.equal(Object.hasOwn(high.body, "think"), false);

  const automatic = buildChatRequest({
    apiKey: "test-key",
    model: "openai/gpt-5",
    messages: [],
    reasoningEffort: "auto",
  });
  assert.equal(Object.hasOwn(automatic.body, "reasoning"), false);

  const invalid = buildChatRequest({
    apiKey: "test-key",
    model: "openai/gpt-5",
    messages: [],
    reasoningEffort: "ultra",
  });
  assert.equal(Object.hasOwn(invalid.body, "reasoning"), false);
});

test("live OpenRouter chat does not turn context reserve into an output cap", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const start = main.indexOf("async function runOpenRouterChat");
  const end = main.indexOf("async function runOpenRouterAgentRound", start);
  const liveChat = main.slice(start, end);

  assert.match(liveChat, /maxCompletionTokens:\s*maxCompletionTokens \|\| undefined/);
  assert.doesNotMatch(liveChat, /maxCompletionTokens:\s*maxCompletionTokens \|\| contextPlan\?\.responseReserveTokens/);
  assert.match(liveChat, /finishReason:\s*captured\.finishReason/);
});

test("renderer keeps Ollama thinking separate from OpenRouter effort selection", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const markup = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.match(markup, /id="ollama-thinking-row"/);
  assert.match(markup, /id="openrouter-reasoning-row"[^>]*>[\s\S]*?<div class="model-edit-label">Effort<\/div>/);
  assert.match(markup, /id="reasoning-options"/);
  assert.match(renderer, /reasoningEffort: runContextPlan\.provider === "openrouter"/);
  assert.match(renderer, /function renderReasoningOptions\(/);
  assert.match(renderer, /className = "reasoning-option"[\s\S]*?codicon codicon-check/);
  assert.match(renderer, /model-item-effort/);
  assert.match(renderer, /if \(!editingModel \|\| isOpenRouterProvider\(\)\) return;/);
  assert.match(styles, /\.model-edit-section\[hidden\],[\s\S]*?display: none !important;/);
  assert.match(styles, /\.reasoning-options\s*\{[\s\S]*?flex-direction: column;/);
});

test("Models settings pins enabled models above disabled models without changing group order", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  assert.match(renderer, /function enabledModelsFirst\(models, enabled = loadEnabledModels\(\)\)/);
  assert.match(renderer, /\.\.\.catalog\.filter\(\(name\) => enabled\.has\(name\)\)[\s\S]*?\.\.\.catalog\.filter\(\(name\) => !enabled\.has\(name\)\)/);
  assert.match(renderer, /const catalog = enabledModelsFirst\(modelsSettingsCatalog\(\)\);/);
});
