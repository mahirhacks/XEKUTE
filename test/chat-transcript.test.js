"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

async function load() {
  return import("../src/ui/features/chat/chat-transcript.js");
}

test("independent waiting cards preserve their task ownership after reload", async () => {
  const { normalizeUiTranscript } = await load();
  const restored = normalizeUiTranscript({ version: 2, runs: [{ user: { message: "Build a page" }, events: [{ type: "subagent", child_session_id: "child", independent: true, task_id: "task:page", status: "waiting" }] }] });
  assert.equal(restored.runs[0].events[0].independent, true);
  assert.equal(restored.runs[0].events[0].task_id, "task:page");
  assert.equal(restored.runs[0].events[0].status, "waiting");
});

test("finished sub-agent rows survive transcript normalization", async () => {
  const { normalizeUiTranscript } = await load();
  const transcript = normalizeUiTranscript({
    version: 2,
    runs: [{
      user: { message: "spin up two sub-agents" },
      events: [{
        type: "subagent",
        child_invocation_id: "child-1",
        child_session_id: "session-1",
        model: "deepseek/deepseek-v4-flash",
        status: "completed",
        summary: "Finished working.",
      }],
    }],
  });
  assert.equal(transcript.runs[0].events[0].type, "subagent");
  assert.equal(transcript.runs[0].events[0].status, "completed");
  assert.equal(transcript.runs[0].events[0].model, "deepseek/deepseek-v4-flash");
});

test("thinking duration uses stored elapsed time instead of wall-clock age", async () => {
  const { thinkingElapsedMs, parseWorkedForMs } = await load();
  const startedAt = Date.parse("2026-09-12T08:00:04.200Z");
  assert.equal(thinkingElapsedMs({
    startedAt,
    durationMs: 12_000,
    endedAt: Date.now(),
  }), 12_000);
  assert.equal(thinkingElapsedMs({
    startedAt,
    endedAt: startedAt + 8_000,
  }), 8_000);
  assert.equal(thinkingElapsedMs({
    startedAt: Date.now() - (23 * 3600_000),
  }), 0);
  assert.equal(parseWorkedForMs("Worked for 1m 38s"), 98_000);
  assert.equal(parseWorkedForMs("Worked for a moment"), 0);
});

test("chat.json example is a flat two-lane Cursor-style transcript", async () => {
  const { normalizeUiTranscript, hasStructuredTranscript } = await load();
  const example = {
    version: 2,
    runs: [{
      worked_for_ms: 98_000,
      user: { message: "can you fix the problem? Idk what to do." },
      events: [
        { type: "chat", lane: "prose", text: "I'll take a look." },
        { type: "thinking", lane: "activity", duration_ms: 12_000, text: "Checking the files." },
        {
          type: "file_stack",
          lane: "activity",
          verb: "Read",
          files: [
            { target: "index.js" },
            { target: "styles.css" },
            { target: "index.html" },
          ],
        },
        { type: "chat", lane: "prose", text: "Found the bug." },
        { type: "tool", lane: "activity", verb: "Edited", name: "apply_patch", target: "index.js" },
        { type: "command", lane: "activity", command: "node --test test/dom.test.js" },
        { type: "thinking", lane: "activity", duration_ms: 1_000, text: "Verifying." },
        { type: "tool", lane: "activity", verb: "Read", name: "read_file", target: "index.js" },
        { type: "chat", lane: "prose", verdict: true, text: "Fixed." },
      ],
    }],
  };
  const transcript = normalizeUiTranscript(example);
  assert.equal(hasStructuredTranscript(transcript), true);
  assert.equal(transcript.version, 2);
  assert.equal(transcript.runs.length, 1);
  const run = transcript.runs[0];
  assert.equal(run.worked_for_ms, 98_000);
  assert.equal(run.user.message, "can you fix the problem? Idk what to do.");
  assert.deepEqual(run.events.map((event) => event.type), [
    "chat",
    "thinking",
    "file_stack",
    "chat",
    "tool",
    "command",
    "thinking",
    "tool",
    "chat",
  ]);
  assert.deepEqual(run.events.map((event) => event.lane), [
    "prose",
    "activity",
    "activity",
    "prose",
    "activity",
    "activity",
    "activity",
    "activity",
    "prose",
  ]);
  assert.equal(run.events[1].duration_ms, 12_000);
  assert.equal(run.events[2].verb, "Read");
  assert.deepEqual(run.events[2].files.map((file) => file.target), ["index.js", "styles.css", "index.html"]);
  assert.equal(run.events[4].verb, "Edited");
  assert.equal(run.events[5].command, "node --test test/dom.test.js");
  assert.equal(run.events[6].type, "thinking");
  assert.equal(run.events.at(-1).verdict, true);
  assert.equal(run.events.some((event) => event.type === "tool_group"), false);
});

test("consecutive same-verb file tools collapse to a file_stack", async () => {
  const { mergeConsecutiveFileEvents } = await load();
  const events = mergeConsecutiveFileEvents([
    { type: "chat", lane: "prose", text: "looking" },
    { type: "tool", lane: "activity", verb: "Read", name: "read_file", target: "a.js", path: "a.js", status: "ok" },
    { type: "tool", lane: "activity", verb: "Read", name: "read_file", target: "b.js", path: "b.js", status: "ok" },
    { type: "tool", lane: "activity", verb: "Read", name: "read_file", target: "c.js", path: "c.js", status: "ok" },
    { type: "tool", lane: "activity", verb: "Edited", name: "apply_patch", target: "a.js", path: "a.js", status: "ok" },
    { type: "chat", lane: "prose", verdict: true, text: "done" },
  ]);
  assert.deepEqual(events.map((event) => event.type), ["chat", "file_stack", "tool", "chat"]);
  assert.equal(events[1].verb, "Read");
  assert.equal(events[1].files.length, 3);
  assert.equal(events[2].verb, "Edited");
  assert.equal(events.at(-1).verdict, true);
});

test("steering prompts and assistant output keep their chronological order in saved transcripts", async () => {
  const { captureChatTranscript, normalizeUiTranscript } = await load();
  const dom = new JSDOM(`
    <div id="messages"><div class="chat-exchange"><div class="chat-exchange-body">
      <div class="chat-turn user" data-source-message-id="input:main" data-task-id="task:main"><div class="chat-box-content">run three sleeps</div></div>
      <div class="agent-response-host"><div class="agent-run-chunk"><div class="chat-turn assistant"><div class="assistant-reply" data-raw-md="Started the sleep commands">Started the sleep commands</div></div></div></div>
      <div class="chat-turn user" data-source-message-id="input:steer" data-task-id="task:main"><div class="chat-box-content">also run echo</div></div>
      <div class="agent-response-host"><div class="agent-run-chunk"><div class="chat-turn assistant"><div class="assistant-reply" data-raw-md="Running echo now">Running echo now</div></div></div></div>
    </div></div></div>`);
  const captured = captureChatTranscript(dom.window.document.querySelector("#messages"));
  const restored = normalizeUiTranscript(captured).runs[0].timeline;
  assert.deepEqual(restored.map((item) => item.type), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual(restored.filter((item) => item.type === "user").map((item) => item.message), ["run three sleeps", "also run echo"]);
  assert.deepEqual(restored.filter((item) => item.type === "assistant").map((item) => item.events[0].text), ["Started the sleep commands", "Running echo now"]);
});

test("browser and other action rows save their label but never a file path", async () => {
  const { captureChatTranscript, normalizeUiTranscript } = await load();
  const dom = new JSDOM(`
    <div id="messages"><div class="chat-exchange"><div class="chat-exchange-body">
      <div class="chat-turn user"><div class="chat-box-content">browse it</div></div>
      <div class="agent-response-host"><div class="agent-run-chunk"><div class="chat-turn assistant">
        <button class="agent-file-row tool-card" data-tool-action="browser_action" data-file="browser_action" data-state="success"><span class="tool-card-file">Browsed list pages</span></button>
        <button class="agent-file-row tool-card" data-tool-action="read_file" data-file="NOTES.md" data-path="docs/NOTES.md" data-state="success"><span class="tool-card-file">Read NOTES.md</span></button>
      </div></div></div>
    </div></div></div>`);
  const restored = normalizeUiTranscript(captureChatTranscript(dom.window.document.querySelector("#messages")));
  const events = restored.runs[0].timeline.find((item) => item.type === "assistant").events;
  const browser = events.find((event) => event.name === "browser_action");
  assert.equal(browser.label, "Browsed list pages");
  assert.equal(browser.path || "", "");
  assert.deepEqual(browser.args, {});
  const read = events.find((event) => event.name === "read_file");
  assert.equal(read.path, "docs/NOTES.md");
  assert.equal(read.label, "Read NOTES.md");
});
