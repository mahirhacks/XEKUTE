"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { captureOllamaStream } = require("../src/adapters/llm/ollama/ollama-stream");

function fragmentedStream(text, cuts = []) {
  const bytes = new TextEncoder().encode(text);
  const points = [...cuts, bytes.length]
    .map((value) => Math.max(0, Math.min(bytes.length, value)))
    .filter((value, index, values) => value > (values[index - 1] ?? -1));
  return new ReadableStream({
    start(controller) {
      let offset = 0;
      for (const point of points) {
        if (point > offset) controller.enqueue(bytes.slice(offset, point));
        offset = point;
      }
      controller.close();
    },
  });
}

test("losslessly demultiplexes fragmented UTF-8 thinking, content, and tool calls", async () => {
  const rows = [
    JSON.stringify({ message: { thinking: "Inspecting café… " }, done: false }),
    JSON.stringify({ message: {
      thinking: "evidence",
      content: "Partial answer",
      tool_calls: [{ index: 0, function: { name: "read_file", arguments: { path: "Map/application-map.json" } } }],
    }, done: false }),
    JSON.stringify({ message: { content: " complete." }, done: true, done_reason: "stop", prompt_eval_count: 42, eval_count: 7 }),
  ];
  const source = `${rows[0]}\n${rows[1]}\n${rows[2]}`; // Deliberately no final newline.
  const events = [];
  const thinking = [];
  const content = [];
  const tools = [];
  const splitInsideMultibyte = new TextEncoder().encode(rows[0]).indexOf(0xc3) + 1;

  const result = await captureOllamaStream(
    fragmentedStream(source, [1, 7, splitInsideMultibyte, 39, 83, 141]),
    {
      onEvent: (event) => events.push(event.sequence),
      onThinking: (delta) => thinking.push(delta),
      onContent: (delta) => content.push(delta),
      onToolCalls: (calls) => tools.push(calls),
    },
  );

  assert.equal(thinking.join(""), "Inspecting café… evidence");
  assert.equal(content.join(""), "Partial answer complete.");
  assert.equal(result.thinking, thinking.join(""));
  assert.equal(result.fullText, content.join(""));
  assert.equal(result.toolCalls[0].function.name, "read_file");
  assert.equal(result.toolCalls[0].function.arguments.path, "Map/application-map.json");
  assert.equal(tools.length, 1);
  assert.deepEqual(events, [1, 2, 3]);
  assert.equal(result.done, true);
  assert.equal(result.sequence, 3);
  assert.deepEqual(result.usage, {
    promptTokens: 42,
    completionTokens: 7,
    totalTokens: 49,
    source: "ollama",
  });
});

test("supports native reasoning aliases without reclassifying ordinary content", async () => {
  const stream = fragmentedStream([
    JSON.stringify({ message: { reasoning_content: "Reasoning alias." }, done: false }),
    JSON.stringify({ message: { content: "Normal qwen3 answer." }, done: true }),
  ].join("\n"));
  const result = await captureOllamaStream(stream);
  assert.equal(result.thinking, "Reasoning alias.");
  assert.equal(result.fullText, "Normal qwen3 answer.");
});

test("fails visibly on malformed complete NDJSON instead of silently dropping output", async () => {
  const stream = fragmentedStream('{"message":{"thinking":"kept"}}\nnot-json\n');
  await assert.rejects(
    captureOllamaStream(stream),
    (error) => error.code === "OLLAMA_STREAM_PARSE" && error.details.sequence === 2,
  );
});
