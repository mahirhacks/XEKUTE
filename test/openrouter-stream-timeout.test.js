const test = require("node:test");
const assert = require("node:assert/strict");
const { ReadableStream } = require("node:stream/web");
const { captureOpenRouterStream } = require("../src/adapters/llm/openrouter/openrouter-stream");

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
