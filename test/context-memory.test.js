const test = require("node:test");
const assert = require("node:assert/strict");

const ContextMemory = require("../src/agent/memory/context-memory");

test("context transcript is bounded and prioritizes recent exact workspace facts", () => {
  const messages = [];
  for (let index = 0; index < 30; index += 1) {
    messages.push({
      role: index % 2 ? "assistant" : "user",
      content: `old turn ${index} ${"noise ".repeat(80)}`,
    });
  }
  messages.push({
    role: "assistant",
    content: "Updated the runtime and verified the focused test.",
    tool_calls: [{
      function: {
        name: "run_command",
        arguments: { command: "npm test -- context-memory" },
      },
    }],
  });
  messages.push({
    role: "tool",
    tool_name: "run_command",
    content: "Command: npm test -- context-memory Exit: 0",
  });

  const transcript = ContextMemory.buildMemoryTranscript(
    "Prior decision: preserve src/ui/bootstrap.js behavior.",
    messages,
    { contextTokens: 4096 },
  );

  assert.ok(transcript.length <= ContextMemory.transcriptCharLimit(4096) + 50);
  assert.match(transcript, /preserve src\/ui\/bootstrap\.js behavior/);
  assert.match(transcript, /npm test -- context-memory/);
  assert.match(transcript, /Exit: 0/);
  assert.doesNotMatch(transcript, /old turn 0/);
});

test("fallback memory is structured, factual, and context bounded", () => {
  const summary = ContextMemory.buildFallbackSummary(
    "## Objective\n- Keep the terminal stable.",
    [
      { role: "user", content: "Add reliable context summarization without losing recent messages." },
      { role: "assistant", content: "Added src/agent/memory/context-memory.js." },
      { role: "tool", tool_name: "run_command", content: "npm test exited 0" },
    ],
    { contextTokens: 4096 },
  );

  assert.match(summary, /## Objective/);
  assert.match(summary, /## Requirements and preferences/);
  assert.match(summary, /## Verification and failures/);
  assert.match(summary, /context-memory\.js/);
  assert.match(summary, /npm test exited 0/);
  assert.ok(summary.length <= ContextMemory.summaryCharLimit(4096) + 80);
});

test("model summaries are normalized and capped without code fences", () => {
  const raw = "```markdown\n## Objective\n- Continue the task.\n## Open work and next step\n- Run tests.\n```";
  const normalized = ContextMemory.normalizeSummary(raw, 200);
  assert.equal(normalized.startsWith("## Objective"), true);
  assert.doesNotMatch(normalized, /```/);

  const capped = ContextMemory.normalizeSummary(`## Objective\n${"x".repeat(2000)}\n## Open work\nRun tests.`, 300);
  assert.ok(capped.length <= 340);
  assert.match(capped, /older detail omitted/);
  assert.match(capped, /Run tests/);
});

test("memory transcript retains web page targets for source continuity", () => {
  const entry = ContextMemory.messageEntry({
    role: "assistant",
    tool_calls: [{ function: { name: "fetch_url", arguments: { url: "https://example.com/reference" } } }],
  });
  assert.match(entry, /fetch_url\(https:\/\/example\.com\/reference\)/);
});

test("messages appended during compaction are retained after the history swap", () => {
  const recent = [
    { role: "user", content: "recent request" },
    { role: "assistant", content: "recent answer" },
  ];
  const liveHistory = [
    { role: "user", content: "archived" },
    { role: "assistant", content: "archived answer" },
    ...recent,
    { role: "user", content: "message submitted while summarizing" },
  ];

  const merged = ContextMemory.mergeRecentWithAppended(recent, liveHistory, 4);
  assert.equal(merged.length, 3);
  assert.equal(merged.at(-1).content, "message submitted while summarizing");
});
