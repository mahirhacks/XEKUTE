const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatRequest } = require("../src/adapters/llm/openrouter/providers");

test("OpenRouter requests carry the app output reserve and deterministic transform policy", () => {
  const request = buildChatRequest({
    apiKey: "test-key",
    model: "acme/model",
    messages: [{ role: "user", content: "hello" }],
    maxCompletionTokens: 1200,
    plugins: [{ id: "context-compression", enabled: false }],
  });
  assert.equal(request.body.max_completion_tokens, 1200);
  assert.deepEqual(request.body.plugins, [{ id: "context-compression", enabled: false }]);
});
