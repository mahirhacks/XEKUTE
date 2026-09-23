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

test("openrouter idleTimeoutMs 0 disables the stream watchdog", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "llm", "openrouter", "openrouter-stream.js"), "utf8");
  assert.match(source, /idleDisabled = idleTimeoutRaw === 0 \|\| idleTimeoutRaw === null/);
  const stream = new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "late" }, finish_reason: "stop" }] })}\n\n`));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }, 40);
    },
  });
  const result = await captureOpenRouterStream(stream, {}, { idleTimeoutMs: 0, totalTimeoutMs: 0 });
  assert.equal(result.fullText, "late");
});

test("Ollama agent chat bodies pin keep_alive", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(source, /keep_alive: ollamaKeepAlive\(\)/);
  assert.match(source, /function ollamaKeepAlive\(\)/);
});

