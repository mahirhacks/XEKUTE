const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ReadableStream } = require("node:stream/web");
const { captureOpenRouterStream } = require("../src/agent/llm/openrouter/openrouter-stream.js");

function openRouterStream(lines) {
  const encoded = new TextEncoder().encode(`${lines.join("\n\n")}\n\n`);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

test("openrouter stream capture preserves a length finish reason", async () => {
  const result = await captureOpenRouterStream(openRouterStream([
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Interrupted response" }, finish_reason: "length" }] })}`,
    "data: [DONE]",
  ]));

  assert.equal(result.fullText, "Interrupted response");
  assert.equal(result.finishReason, "length");
  assert.equal(result.streamCompleted, true);
});

test("active OpenRouter streams have no default total lifetime", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "llm", "openrouter", "openrouter-stream.js"), "utf8");
  assert.match(source, /totalTimeoutMs = Number\.isFinite\(configuredTotalTimeoutMs\) && configuredTotalTimeoutMs > 0/);
  assert.doesNotMatch(source, /options\.totalTimeoutMs\) \|\| 300000/);
});

test("openrouter stream capture fails when idle too long", async () => {
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    () => captureOpenRouterStream(stream, {}, { idleTimeoutMs: 30, totalTimeoutMs: 200 }),
    /stalled/i,
  );
});
