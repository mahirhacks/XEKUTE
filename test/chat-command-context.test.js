"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8").replace(/\r\n/g, "\n");

function setup() {
  const dom = new JSDOM('<div id="messages"><div class="chat-exchange"><div class="chat-exchange-body"><div class="agent-response-host"><div class="chat-turn assistant"></div></div></div></div></div>');
  const document = dom.window.document;
  const context = vm.createContext({
    document, Date, ToolMap: {}, activeChatRuns: new Map(), activeChatSessionId: "",
    commandTimelineTickers: new Map(), clearInterval,
    TOOL_STATUS_VERBS: ["Running Command", "Ran Command", "Command failed"],
    toolCardKey: (tool) => tool.args.command,
    markActivityNode: () => {}, persistCommandTimelineRowState: () => {},
  });
  for (const name of [
    "isStubToolStatusLabel", "splitToolStatusLabel", "renderToolStatusLabel", "renderToolStatusLabelFromText", "toolFromTranscriptItem",
    "agentCommandContextForTool", "agentTerminalCommandForTool", "commandToolFromHistoryCall",
    "commandTimelineKey", "commandLifecycleIds", "bindCommandTimelineIdentity",
    "commandTimelineRowIds", "commandTimelineRows", "commandTimelineIdentityMatches",
    "commandTimelineStateLabel", "renderCommandTimelineLabel", "createCommandTimelineRow",
    "createCommandFromRecord", "updateCommandTimelineLabel", "restoreHistoryCommandContexts",
    "stopCommandTimelineTicker", "updateCommandTimelineRow",
  ]) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    vm.runInContext(source.slice(start, source.indexOf("\n}\n", start) + 3), context);
  }
  return { context, document, turn: document.querySelector(".chat-turn.assistant") };
}

for (const [state, verb] of [["running", "Running Command"], ["success", "Ran Command"], ["error", "Command failed"]]) {
  test(`${state} commands display the model's context as plain text`, () => {
    const { context } = setup();
    const row = context.createCommandTimelineRow({ args: { command: "node --test", context: "Verify <changes>" } }, { state });
    assert.equal(row.querySelector(".agent-command-label").textContent, `${verb} Verify <changes>`);
    assert.equal(row.querySelector(".agent-tool-detail").children.length, 0);
  });
}

test("command context survives capture, JSON persistence, and saved chat rendering", async () => {
  const { captureChatTranscript, normalizeUiTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
  const { context, document, turn } = setup();
  for (const state of ["success", "error"]) {
    const row = context.createCommandTimelineRow({ args: { command: "node --test", context: "Verify changes" } }, { state });
    turn.replaceChildren(row);
    const transcript = normalizeUiTranscript(JSON.parse(JSON.stringify(captureChatTranscript(document.getElementById("messages")))));
    const record = transcript.runs[0].events[0];
    assert.equal(record.context, "Verify changes");
    const restored = context.createCommandFromRecord(record);
    assert.equal(restored.querySelector(".agent-command-label").textContent, `${state === "error" ? "Command failed" : "Ran Command"} Verify changes`);
  }
});

test("waiting updates retain command context until completion", () => {
  const { context, turn } = setup();
  const row = context.createCommandTimelineRow({ callId: "call-1", args: { command: "node --test", context: "Verify changes" } });
  row.dataset.waiting = "true";
  turn.append(row);
  context.updateCommandTimelineLabel("call-1", "Running command · 12s");
  assert.equal(row.querySelector(".agent-command-label").textContent, "Running Command Verify changes");
  context.updateCommandTimelineRow(row, "success");
  assert.equal(row.querySelector(".agent-command-label").textContent, "Ran Command Verify changes");
  assert.equal(row.dataset.waiting, undefined);
});

test("direct executable labels escape Windows quotes without corrupting paths", () => {
  const { context } = setup();
  const label = context.agentTerminalCommandForTool({ args: {
    executable: "C:\\Program Files\\tool.exe",
    args: ['say "hi"', "C:\\Folder with spaces\\", ""],
  } });
  assert.equal(label, '"C:\\Program Files\\tool.exe" "say \\"hi\\"" "C:\\Folder with spaces\\\\" ""');
});

test("old saved command rows recover available context from canonical tool calls", () => {
  const { context, document, turn } = setup();
  const row = context.createCommandFromRecord({ command: "node --test", status: "error" });
  turn.append(row);
  assert.equal(typeof context.restoreHistoryCommandContexts, "function");
  context.restoreHistoryCommandContexts(document.getElementById("messages"), [{ role: "assistant", tool_calls: [{ id: "call-1", function: { name: "exec_command", arguments: JSON.stringify({ command: "node --test", context: "Verify changes" }) } }] }]);
  assert.equal(row.querySelector(".agent-command-label").textContent, "Command failed Verify changes");
});

test("legacy recovery avoids guessing between different purposes for the same command", () => {
  const { context, document, turn } = setup();
  const row = context.createCommandFromRecord({ command: "ls", status: "ok" });
  turn.append(row);
  assert.equal(typeof context.restoreHistoryCommandContexts, "function");
  context.restoreHistoryCommandContexts(document.getElementById("messages"), [{ role: "assistant", tool_calls: ["Inspect source", "Inspect tests"].map((context) => ({ function: { name: "exec_command", arguments: JSON.stringify({ command: "ls", context }) } })) }]);
  assert.equal(row.querySelector(".agent-command-label").textContent, "Ran Command");
});

test("an exact tool call identity recovers the right purpose for repeated commands", () => {
  const { context, document, turn } = setup();
  const row = context.createCommandFromRecord({ command: "ls", status: "ok" });
  row.dataset.callId = "call-2";
  turn.append(row);
  context.restoreHistoryCommandContexts(document.getElementById("messages"), [{ role: "assistant", tool_calls: ["Inspect source", "Inspect tests"].map((context, index) => ({ id: `call-${index + 1}`, function: { name: "exec_command", arguments: JSON.stringify({ command: "ls", context }) } })) }]);
  assert.equal(row.querySelector(".agent-command-label").textContent, "Ran Command Inspect tests");
});

test("terminal results can supply context missing from the initial command event", () => {
  const { context } = setup();
  const row = context.createCommandTimelineRow({ callId: "call-1", args: { command: "node --test" } });
  context.bindCommandTimelineIdentity(row, { value: { context: "Verify changes", processId: "process-1" } });
  context.updateCommandTimelineRow(row, "error");
  assert.equal(row.querySelector(".agent-command-label").textContent, "Command failed Verify changes");
});
