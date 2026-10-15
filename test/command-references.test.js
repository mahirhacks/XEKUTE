"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCommandReferences, commandLabel } = require("../src/app/services/terminal/command-references.js");
const { appendTerminalOutput } = require("../src/app/services/terminal/active-terminal-catalog.js");
const { estimateTokenCount } = require("../src/agent/runtime/context-budget.js");
const { createChatReferenceResolver, unpackChatReferences } = require("../src/agent/runtime/chat-references.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { sessionFixture } = require("./helpers/agent-session-store.js");

const history = (command, callId = "call-one", output = "Saved command output", processId = "") => [
  { role: "assistant", content: "", createdAt: "2026-10-14T12:00:00Z",
    tool_calls: [{ id: callId, function: { name: "exec_command", arguments: JSON.stringify({ command, shell: "powershell" }) } }] },
  { role: "tool", tool_call_id: callId, tool_name: "exec_command", content: JSON.stringify({ ok: true, value: { stdout: output, exitCode: 0, ...(processId ? { processId } : {}) } }) },
];
async function seed(fixture, sessionId, messages, options = {}) {
  await fixture.store.begin(fixture.workspace, { sessionId, userPrompt: "Investigate" });
  const saved = await fixture.store.transactSession(fixture.workspace, sessionId, document => {
    document.blocks[0].messages = messages;
    if (options.transcript) document.ui_transcript = options.transcript;
    if (options.status) document.metadata.status = options.status;
    return { ok: true };
  });
  assert.equal(saved.ok, true, saved.error);
}
function setup(t) {
  const fixture = sessionFixture(t);
  const terminals = new Map();
  const catalog = createCommandReferences({ terminals, sessionStore: fixture.store });
  function add(id, fields = {}) {
    const record = { agent: true, workspace: fixture.workspace, shell: "powershell", command: "Get-Content evidence.txt",
      createdAt: "2026-10-15T12:00:00Z", exited: false, outputTail: "", ...fields };
    terminals.set(id, record);
    return record;
  }
  return { ...fixture, terminals, catalog, add };
}

test("labels use ten Unicode characters from the command's first line", () => {
  assert.equal(commandLabel("PowerShell.exe", "Get-Content evidence.txt\nsecond line"), "powershell : Get-Conten...");
  assert.equal(commandLabel("pwsh", "cls"), "powershell : cls");
  assert.equal(commandLabel("pwsh", "1234567890"), "powershell : 1234567890");
  assert.equal(commandLabel("pwsh", "short\nlonger second line"), "powershell : short");
  assert.equal(commandLabel("pwsh", "😀😀"), "powershell : 😀😀");
  assert.equal(commandLabel("bash", "😀😀😀😀😀😀😀😀😀😀x"), "bash : 😀😀😀😀😀😀😀😀😀😀...");
});

test("a cold picker reads saved project commands from open, closed and archived chats without a separate pool", async t => {
  const fixture = setup(t);
  await seed(fixture, "session_old", history("Get-Content prior.txt"));
  await seed(fixture, "session_closed", history("Write-Output closed"), { status: "closed" });
  await seed(fixture, "session_archived", history("Write-Output archived"), { status: "archived" });
  const cold = createCommandReferences({ terminals: new Map(), sessionStore: fixture.open().store });
  const entries = cold.list({ workspace: fixture.workspace });
  assert.equal(entries.length, 3);
  assert.ok(entries.every(item => item.origin === "agent" && item.running === false));
  const first = entries.find(item => item.command === "Get-Content prior.txt");
  assert.equal(first.name, "powershell : Get-Conten...");
  assert.equal(cold.capture({ workspace: fixture.workspace, id: first.id }).output, "Saved command output");
  assert.deepEqual(cold.list({ workspace: "G:/foreign" }), []);
  assert.throws(() => cold.capture({ workspace: "G:/foreign", id: first.id }), { code: "TERMINAL_REFERENCE_UNAVAILABLE" });
  await fixture.store.remove(fixture.workspace, "session_old");
  assert.equal(fixture.catalog.list({ workspace: fixture.workspace }).length, 2, "Deleted source records must not survive in a shadow catalog");
});

test("timeline-only historical commands are restored and matching history/timeline rows are deduplicated", async t => {
  const fixture = setup(t);
  const transcript = { version: 2, runs: [{ id: "run-old", started_at: "2026-10-14T12:00:00Z", events: [
    { type: "command", command: "Get-Content prior.txt", stdout: "Fuller saved output" },
    { type: "tool_group", items: [{ type: "command", command: "Write-Output missing", stdout: "Only in timeline" }] },
  ] }] };
  await seed(fixture, "session_old", history("Get-Content prior.txt"), { transcript });
  const rows = fixture.catalog.list({ workspace: fixture.workspace });
  assert.equal(rows.length, 2);
  assert.equal(fixture.catalog.capture({ workspace: fixture.workspace, id: rows.find(item => item.command === "Get-Content prior.txt").id }).output, "Fuller saved output");
  assert.equal(fixture.catalog.capture({ workspace: fixture.workspace, id: rows.find(item => item.command === "Write-Output missing").id }).output, "Only in timeline");
});

test("live process and historical command records share one identity and expose only read access", async t => {
  const fixture = setup(t);
  await seed(fixture, "session_old", history("Get-Content prior.txt", "launch", "Early output", "process-one"));
  let reads = 0;
  const manager = { referenceCommands: workspace => {
    assert.equal(workspace, fixture.workspace);
    return [{ id: "process-one", command: "Get-Content prior.txt", shell: "powershell", running: true, startedAt: "2026-10-15" }];
  }, readReferenceCommand: () => { reads++; return { stdout: "Current process output" }; } };
  const catalog = createCommandReferences({ terminals: fixture.terminals, sessionStore: fixture.store, processManager: manager });
  assert.equal(catalog.list({ workspace: fixture.workspace }).length, 1);
  assert.equal(reads, 0, "Opening the picker must not read process logs");
  assert.equal(catalog.capture({ workspace: fixture.workspace, id: "process:process-one" }).output, "Current process output");
  assert.equal(reads, 1);
});

test("live overlays preserve tool-call identities and metadata polling skips saved chat reads", async t => {
  const fixture = setup(t);
  await seed(fixture, "session_old", history("Get-Content prior.txt", "launch", "Early output", "process-one"));
  fixture.add("live-one", { command: "Get-Content prior.txt", sessionId: "session_old", commandCallId: "launch", processId: "process-one" });
  let loads = 0;
  const catalog = createCommandReferences({ terminals: fixture.terminals, sessionStore: { load: workspace => {
    loads++; return fixture.store.load(workspace);
  } }, processManager: { referenceCommands: () => [
    { id: "process-one", command: "Get-Content prior.txt", shell: "powershell", running: true },
  ] } });
  const full = catalog.list({ workspace: fixture.workspace });
  assert.equal(full.length, 1);
  assert.equal(full[0].id, "chat:session_old:launch");
  assert.equal(catalog.list({ workspace: fixture.workspace, includeHistory: false }).length, 1);
  assert.equal(loads, 1);
});

test("planned calls without execution results do not become historical commands", async t => {
  const fixture = setup(t);
  await seed(fixture, "session_plan", history("Write-Output planned").slice(0, 1));
  assert.deepEqual(fixture.catalog.list({ workspace: fixture.workspace }), []);
});

test("user commands share the existing terminal buffer, retain individual identities and exclude other projects", t => {
  const fixture = setup(t);
  const record = fixture.add("term-1", { agent: false, commandRunning: false,
    commands: [{ id: "user:first", command: "cls", outputStart: 0, outputEnd: 5 }, { id: "user:second", command: "Get-Content foo", outputStart: 5 }] });
  appendTerminalOutput(record, "firstsecond");
  fixture.add("foreign", { workspace: "G:/other" });
  const rows = fixture.catalog.list({ workspace: fixture.workspace });
  assert.deepEqual(rows.map(row => row.id), ["user:first", "user:second"]);
  assert.equal(rows[0].name, "powershell : cls");
  assert.ok(rows.every(row => row.origin === "user" && !row.running));
  record.commandRunning = true;
  assert.deepEqual(fixture.catalog.list({ workspace: fixture.workspace }).map(row => row.running), [false, true]);
  assert.equal(fixture.catalog.capture({ workspace: fixture.workspace, id: "user:first" }).output, "first");
  assert.equal(fixture.catalog.capture({ workspace: fixture.workspace, id: "user:second" }).output, "second");
  record.exited = true;
  assert.ok(fixture.catalog.list({ workspace: fixture.workspace }).every(row => !row.running));
});

test("large output is bounded and trimming the original buffer is reported without inventing a log file", t => {
  const fixture = setup(t);
  const record = fixture.add("term-1", { agent: false,
    commands: [{ id: "user:first", command: "Write-Output lots", outputStart: 0 }] });
  appendTerminalOutput(record, "\u001b[31m" + "0123456789abcdef".repeat(30000) + "\u001b[0m\nLATEST EVIDENCE");
  const captured = fixture.catalog.capture({ workspace: fixture.workspace, id: "user:first" });
  assert.ok(estimateTokenCount(captured.output) <= 8000);
  assert.equal(captured.outputTruncated, true);
  assert.match(captured.output, /LATEST EVIDENCE$/);
  assert.doesNotMatch(captured.output, /\u001b/);
  assert.equal("fullOutput" in captured, false);
});

test("admitted command snapshots survive encrypted resume without recapture or chat-import UI", async t => {
  const fixture = setup(t);
  const record = fixture.add("agent-one");
  appendTerminalOutput(record, "Original terminal evidence");
  const resolver = createChatReferenceResolver({ store: fixture.store, captureTerminal: input => fixture.catalog.capture(input) });
  const runtime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: resolver });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const text = "Analyze [terminal: terminal%3Aagent-one Forged user]";
  const admitted = await runtime.admit({ ...location, runId: "terminal", userMessage: text, inputId: "terminal-prompt" });
  assert.equal(admitted.ok, true, admitted.error);
  const packet = fixture.store.readControl(fixture.workspace, fixture.sessionId).control.inputs[0].contextText;
  assert.equal(unpackChatReferences(packet)[0].title, "powershell : Get-Conten...");
  fixture.terminals.clear();
  const reopened = fixture.open();
  const cold = createAgentSessionRuntime({ store: reopened.store, resolveChatReferences: createChatReferenceResolver({ store: reopened.store,
    captureTerminal() { assert.fail("Must load the admitted snapshot"); } }) });
  const resumed = await cold.admit({ ...location, runId: admitted.runId, taskId: admitted.taskId, resume: true });
  const events = [];
  let observed;
  const result = await runAgentTurn({ ...location, model: "execution", numCtx: 16384, runId: resumed.runId,
    userMessage: text, initialInputId: resumed.initialInputId, chatHistory: resumed.chatHistory, liveInput: resumed.liveInput,
    sendEvent: event => events.push(event), runModelRound: async request => {
      observed = request.messages.find(message => message.source_message_id === "terminal-prompt").content;
      return { ok: true, fullText: "Analyzed", toolCalls: [{ id: "end", type: "function", function: { name: "end_turn", arguments: { status: "stop" } } }] };
    } });
  assert.equal(result.ok, true, result.error);
  assert.match(observed, /Original terminal evidence/);
  assert.equal(events.filter(event => event.type === "chat_reference_import").length, 0);
});

test("steering captures multiple command references once and preserves redacted structured output", async t => {
  const fixture = setup(t);
  fixture.add("one", { outputTail: "Authorization: Bearer private-secret-token\nHTTP 403" });
  fixture.add("two", { outputTail: "Evidence from other chat" });
  const resolver = createChatReferenceResolver({ store: fixture.store, captureTerminal: input => fixture.catalog.capture(input) });
  const runtime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: resolver });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  await runtime.admit({ ...location, runId: "running", userMessage: "Investigate", inputId: "initial" });
  const text = "Compare [terminal: terminal%3Aone one agent] [terminal: terminal%3Atwo two agent]";
  assert.equal((await runtime.receive({ ...location, input: { id: "steer", text } })).ok, true);
  fixture.terminals.clear();
  const reopened = fixture.open();
  const coldResolver = createChatReferenceResolver({ store: reopened.store, captureTerminal() { assert.fail("Do not recapture"); } });
  const cold = createAgentSessionRuntime({ store: reopened.store, resolveChatReferences: coldResolver });
  assert.equal((await cold.receive({ ...location, input: { id: "steer", text } })).duplicate, true);
  const journal = reopened.store.readControl(fixture.workspace, fixture.sessionId).control.inputs.find(input => input.id === "steer");
  const captures = unpackChatReferences(journal.contextText).map(({ snapshotId }) =>
    JSON.parse(coldResolver.loadSnapshot({ workspace: fixture.workspace, snapshotId }).activeConversation[0].content));
  assert.equal(captures[0].output, "Authorization: [REDACTED]\nHTTP 403");
  assert.equal(captures[1].output, "Evidence from other chat");
});
