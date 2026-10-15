"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const modulePromise = import("../src/ui/features/chat/live-input.js");
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8");
function definition(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const receipt = (id, extra = {}) => ({ ok: true, encrypted: true, durable: true, messageId: id, status: "received", ...extra });

test("compound receipt stays accepted until every destination checkpoint completes", async () => {
 const { session, controller } = await fixture({ agentSubmitInput: async ({ messageId }) => receipt(messageId) });
 await controller.send({ session, text: "Use Arial and build a page" });
 controller.acceptEvent(session, { type: "input_accepted", messageId: "input:1", taskId: "main", taskIds: ["main", "page"] });
 controller.acceptEvent(session, { type: "input_applied", messageId: "input:1", taskId: "main" });
 assert.equal(session.liveInputs[0].status, "accepted");
 controller.acceptEvent(session, { type: "input_applied", messageId: "input:1", taskId: "page" });
 assert.equal(session.liveInputs[0].status, "applied");
 assert.deepEqual(session.liveInputs[0].targets, { main: "applied", page: "applied" });
});
async function fixture(api, changes = []) {
 const { createLiveInputController } = await modulePromise;
 let id = 0;
 return { session: { id: "chat", memorySessionId: "mem-chat", history: [], draftText: "" }, controller: createLiveInputController({ api, makeId: () => `input:${++id}`, onChange: (_session, record) => changes.push({ ...record }) }) };
}
test("Send delivers concurrent receipts while an earlier request remains in flight", async () => {
 const calls = []; const a = deferred(); const b = deferred();
 const { session, controller } = await fixture({ agentSubmitInput: (payload) => { calls.push(payload); return calls.length === 1 ? a.promise : b.promise; } });
 const one = controller.send({ session, text: "Write report" });
 const two = controller.send({ session, text: "  use Arial\nplease  " });
 await Promise.resolve();
 assert.deepEqual(calls.map((call) => call.text), ["Write report", "  use Arial\nplease  "]);
 assert.deepEqual(calls.map((call) => call.messageId), ["input:1", "input:2"]);
 b.resolve(receipt("input:2")); a.resolve(receipt("input:1"));
 await Promise.all([one, two]);
 assert.deepEqual(session.liveInputs.map((item) => item.status), ["received", "received"]);
});
test("duplicate click shares an in-flight input while a failed retry preserves its ID", async () => {
 let calls = 0; const gate = deferred();
 const { session, controller } = await fixture({ agentSubmitInput: () => { calls += 1; return calls === 1 ? gate.promise : receipt("input:1"); } });
 const one = controller.send({ session, text: "Arial" }); const two = controller.send({ session, text: "Arial" });
 assert.equal(one, two); gate.resolve({ ok: false, error: "disk" });
 assert.equal((await one).ok, false); assert.equal(session.liveInputs[0].status, "failed");
 assert.equal((await controller.send({ session, text: "Arial" })).messageId, "input:1");
 assert.equal(calls, 2); assert.equal(session.liveInputs.length, 1);
});
test("receipt must be encrypted, durable and match the submitted ID", async () => {
 for (const broken of [{ durable: false }, { encrypted: false }, { messageId: "wrong" }, { ok: false }]) {
   const { session, controller } = await fixture({ agentSubmitInput: () => receipt("input:1", broken) });
   session.draftText = "Arial";
   assert.equal((await controller.send({ session, text: session.draftText })).ok, false);
   assert.equal(session.draftText, "Arial"); assert.equal(session.liveInputs[0].status, "failed");
 }
});
test("event before ack stays applied and concurrent preparation retains record identity", async () => {
 const gate = deferred(); const { session, controller } = await fixture({ agentSubmitInput: () => gate.promise });
 const pending = controller.send({ session, text: "Arial" });
 controller.prepare(session, "another message");
 assert.equal(controller.acceptEvent(session, { type: "input_applied", messageId: "input:1", taskId: "primary", revision: 1 }), true);
 gate.resolve(receipt("input:1")); await pending;
 assert.equal(session.liveInputs[0].status, "applied"); assert.equal(session.liveInputs[0].taskId, "primary");
 controller.acceptEvent(session, { type: "input_received", messageId: "input:1" });
 assert.equal(session.liveInputs[0].status, "applied");
});
test("completed inputs may be intentionally repeated with a fresh ID", async () => {
 const { session, controller } = await fixture({ agentSubmitInput: (payload) => receipt(payload.messageId) });
 await controller.send({ session, text: "Arial" }); await controller.send({ session, text: "Arial" });
 assert.deepEqual(session.liveInputs.map((item) => item.id), ["input:1", "input:2"]);
});
test("child steering targets its task through the parent journal", async () => {
 let sent; const { session, controller } = await fixture({ agentSubmitInput: (payload) => { sent = payload; return receipt(payload.messageId); } });
 await controller.send({ session, sessionId: "parent", workspace: "G:/Xekute", text: "Arial", targetTaskId: "child-task" });
 assert.equal(sent.sessionId, "parent"); assert.equal(sent.targetTaskId, "child-task"); assert.equal(sent.workspace, "G:/Xekute");
});
test("legacy migration preserves original order and removes only encrypted durable acknowledgments", async () => {
 const calls = []; let fail = true;
 const { session, controller } = await fixture({ agentSubmitInput: (payload) => { calls.push(payload); return fail && payload.text === "second" ? { ok: true, durable: false, encrypted: true, messageId: payload.messageId } : receipt(payload.messageId); } });
 session.promptQueue = { 10: { user_prompt: "third" }, 2: { user_prompt: "second" }, 1: { user_prompt: "first" } }; session.draftText = "still typing";
 assert.deepEqual(await controller.migrateQueue({ session }), { ok: false, migrated: 1, error: "INPUT_NOT_DURABLE" });
 assert.deepEqual(Object.keys(session.promptQueue), ["2", "10"]); assert.equal(session.promptQueue[2].messageId, "legacy:chat:2");
 const reloaded = JSON.parse(JSON.stringify(session)); fail = false;
 assert.deepEqual(await controller.migrateQueue({ session: reloaded }), { ok: true, migrated: 2 });
 assert.equal(reloaded.promptQueue, undefined); assert.equal(reloaded.draftText, "still typing");
 assert.deepEqual(calls.map((call) => call.text), ["first", "second", "second", "third"]);
 assert.equal(calls[1].messageId, calls[2].messageId);
});
test("transport rejection retains migration entry and retry identity", async () => {
 const { session, controller } = await fixture({ agentSubmitInput: () => { throw new Error("offline"); } });
 session.promptQueue = { 1: { user_prompt: "original" } };
 assert.equal((await controller.migrateQueue({ session })).ok, false);
 assert.equal(session.promptQueue[1].user_prompt, "original"); assert.equal(session.promptQueue[1].messageId, "legacy:chat:1");
});
test("Send binding detaches cleanly", async () => {
 const { bindLiveInputComposer } = await modulePromise;
 const dom = new JSDOM('<button id="send">Send</button>');
 let sent = 0;
 const send = dom.window.document.getElementById("send");
 const dispose = bindLiveInputComposer({ sendButton: send, onSend: () => sent++ });
 send.click(); assert.equal(sent, 1);
 dispose(); send.click(); assert.equal(sent, 1);
});
test("live input updates remove any legacy receipt label without interrupting the prompt", () => {
 const dom = new JSDOM('<div id="messages"><div class="chat-turn user" data-source-message-id="input:arial"><span class="chat-input-status">Received · waiting for checkpoint</span></div></div>');
 const context = { activeChatRuns: new Map(), activeChatSessionId: "chat", messages: dom.window.document.querySelector("#messages") };
 vm.createContext(context);
 vm.runInContext(definition("function paintLiveInputRecord(", "\nconst liveInputController"), context);
 const session = { id: "chat", history: [{ role: "user", source_message_id: "input:arial" }] };
 context.paintLiveInputRecord(session, { id: "input:arial", taskId: "task:report" });
 const turn = dom.window.document.querySelector(".chat-turn.user");
 assert.equal(turn.querySelector(".chat-input-status"), null);
 assert.equal(turn.dataset.taskId, "task:report");
 assert.equal(session.history[0].task_id, "task:report");
});
test("steering appears after prior assistant output and before the continuation segment", () => {
 const dom = new JSDOM('<div id="messages"><div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user" data-source-message-id="input:main">main prompt</div><div class="agent-response-host"><div class="agent-run-chunk"><div class="chat-turn assistant">earlier output</div></div></div></div></div></div>');
 const messages = dom.window.document.querySelector("#messages");
 const exchange = messages.querySelector(".chat-exchange");
 const body = exchange.querySelector(".chat-exchange-body");
 const assistantTurn = exchange.querySelector(".chat-turn.assistant");
 const assistant = {
  turn: assistantTurn, rootTurn: assistantTurn, startedAt: Date.now(), contentSegments: [],
  sealCurrentContentSegment() {}, finishThinking() {}, stopWorkTimer() {},
 };
 const context = {
  document: dom.window.document, messages, activeChatRuns: new Map([["chat", { taskId: "task:main", initialInputId: "input:main", assistant }]]), activeChatSessionId: "chat",
  isChatSessionRunning: () => true,
  createUserPromptBox: (text) => { const box = dom.window.document.createElement("div"); box.textContent = text; return box; },
  chatExchangeBody: (root) => root.querySelector(":scope > .chat-exchange-body"),
  isAgentResponseChild: (node) => node.classList.contains("agent-run-chunk") || node.classList.contains("chat-turn"),
  turnWorkFold: () => null, workFoldHeader: () => null, formatAgentWorkDuration: () => "5s", syncWorkHeaderAffordance() {},
  wrapAssistantInRunChunk: (turn) => {
   const chunk = dom.window.document.createElement("div"); chunk.className = "agent-run-chunk"; turn.before(chunk); chunk.appendChild(turn); return chunk;
  },
  appendChatTurn: () => { throw new Error("steering input should reuse the active exchange"); },
  syncChatStickyMask: () => {}, syncChatEmptyState: () => {}, scrollMessages: () => {},
 };
 vm.createContext(context);
 vm.runInContext(definition("function ensureAgentResponseHost(", "\nfunction markActivityNode("), context);
 vm.runInContext(definition("function createChatExchange(", "\nfunction currentChatExchange("), context);
 vm.runInContext(definition("function appendChatTurn(", "\n// Older saved chats stored every turn directly under #messages."), context);
 vm.runInContext(definition("function addUserMessage(", "\nconst CHAT_ERROR_TOAST_MS"), context);
 context.addUserMessage("also run an echo command", "input:steering");
 const children = [...body.children];
 assert.deepEqual(children.map((node) => node.className), ["chat-turn user", "agent-response-host", "chat-turn user", "agent-response-host agent-stream"]);
 assert.equal(children[1].querySelector(".chat-turn.assistant"), assistantTurn);
 assert.equal(children[2].textContent, "also run an echo command");
 assert.ok(assistant.turn === assistantTurn, "the open block keeps streaming above the steering prompt");
 assert.ok(assistant.pendingSteeringHost === children[3]);
 assert.equal(children[3].children.length, 0);
});
test("restored transcripts keep steering between earlier and later assistant output", () => {
 const dom = new JSDOM('<div id="messages"></div>');
 const messages = dom.window.document.querySelector("#messages");
 const context = {
  document: dom.window.document, messages,
  chatExchangeBody: (root) => root.querySelector(":scope > .chat-exchange-body"),
  isAgentResponseChild: (node) => node.classList.contains("agent-run-chunk") || (node.classList.contains("chat-turn") && node.classList.contains("assistant")),
  createUserPromptBox: (text) => { const box = dom.window.document.createElement("div"); box.textContent = text; return box; },
  appendTranscriptEvent: (host, event) => { const reply = dom.window.document.createElement("div"); reply.className = "assistant-reply"; reply.textContent = event.text; host.appendChild(reply); },
  wrapAssistantInRunChunk: (turn) => { const chunk = dom.window.document.createElement("div"); chunk.className = "agent-run-chunk"; turn.before(chunk); chunk.appendChild(turn); return chunk; },
  markSteeringAnswer: () => [],
 };
 vm.createContext(context);
 vm.runInContext(definition("function ensureAgentResponseHost(", "\nfunction markActivityNode("), context);
 vm.runInContext(definition("function createChatExchange(", "\nfunction chatExchangeBody("), context);
 vm.runInContext(definition("function currentChatExchange(", "\nfunction appendChatTurn("), context);
 vm.runInContext(definition("function appendChatTurn(", "\n// Older saved chats stored every turn directly under #messages."), context);
 vm.runInContext(definition("function renderTranscriptRun(", "\nfunction renderStructuredChatTranscript("), context);
 context.renderTranscriptRun({ timeline: [
  { type: "user", message: "run three sleeps", task_id: "task:main" },
  { type: "assistant", events: [{ type: "chat", text: "Started the sleep commands" }] },
  { type: "user", message: "also run echo", task_id: "task:main" },
  { type: "assistant", events: [{ type: "chat", text: "Running echo now" }] },
 ] }, messages);
 const body = messages.querySelector(".chat-exchange-body");
 assert.deepEqual([...body.children].map((node) => node.className), ["chat-turn user", "agent-response-host agent-stream", "chat-turn user", "agent-response-host agent-stream"]);
 assert.deepEqual([...body.querySelectorAll(".assistant-reply")].map((node) => node.textContent), ["Started the sleep commands", "Running echo now"]);
});
test("command wait status leaves its original segment after steering, and the parked run sends nothing itself", () => {
 const dom = new JSDOM('<div id="messages"></div>');
 const document = dom.window.document;
 const oldHost = document.createElement("div");
 const currentHost = document.createElement("div");
 document.body.append(oldHost, currentHost);
 const assistant = { toolWorkMount: () => oldHost };
 const run = { sessionId: "chat", assistant };
 const sent = [];
 const context = {
  document, activeChatRuns: new Map([["chat", run]]),
  completedAgentProcessIds: new Set(), formatCommandWaitClock: () => "0s",
  setInterval: () => 1, clearInterval() {}, isChatSessionRunning: () => false,
  sendMessageWithAgentRuntime: (input) => sent.push(input),
 };
 vm.createContext(context);
 vm.runInContext(definition("function beginModelRunCommandWait(", "\nfunction commandWaitRunForProcess("), context);
 vm.runInContext(definition("function commandWaitRunForProcess(", "\nfunction absorbModelRunCommandResult("), context);
 vm.runInContext(definition("function absorbModelRunCommandResult(", "\nasync function handleBackgroundWaitEvent("), context);
 context.beginModelRunCommandWait(run, assistant, { commands: [{ processId: "process:1" }] });
 const originalLine = run.commandWaitLine;
 assert.equal(originalLine.parentElement, oldHost);
 assistant.toolWorkMount = () => currentHost;
 context.absorbModelRunCommandResult({ processId: "process:1", command: "sleep 15", status: "complete", exitCode: 0 });
 assert.equal(originalLine.parentElement, null);
 assert.equal(currentHost.querySelector(".command-run-wait"), null);
 assert.equal(sent.length, 0);
 assert.equal(run.commandWait, true);
});
test("history keeps repeated steering prompts in the same task exchange", () => {
 const dom = new JSDOM('<div id="messages"></div>');
 const messages = dom.window.document.querySelector("#messages");
 const context = {
  document: dom.window.document, messages,
  MessageIdentity: { ensureMessageIdentity: (history) => history },
  activeChatSession: () => ({ id: "chat" }),
  isInternalRuntimeInputMessage: () => false,
  createUserPromptBox: (text) => { const box = dom.window.document.createElement("div"); box.textContent = text; return box; },
  appendChatTurn: (turn, { startsExchange, container }) => {
   let exchange = container.querySelector(":scope > .chat-exchange:last-child");
   if (startsExchange || !exchange) {
    exchange = dom.window.document.createElement("div"); exchange.className = "chat-exchange";
    const body = dom.window.document.createElement("div"); body.className = "chat-exchange-body";
    exchange.appendChild(body); container.appendChild(exchange);
   }
   exchange.querySelector(".chat-exchange-body").appendChild(turn);
  },
  currentChatExchange: (container) => container.lastElementChild,
  appendSteeringUserTurn: (turn, exchange) => exchange.querySelector(".chat-exchange-body").appendChild(turn),
  ensureAgentResponseHost: (exchange) => exchange.querySelector(".chat-exchange-body"),
  syncChatStickyMask: () => {}, syncChatEmptyState: () => {},
 };
 vm.createContext(context);
 vm.runInContext(definition("function renderCanonicalChatHistory(", "\nfunction captureSessionTranscript"), context);
 context.renderCanonicalChatHistory([
  { role: "user", id: "input:1", source_message_id: "input:1", task_id: "task:main", content: "also run echo" },
  { role: "user", id: "input:2", source_message_id: "input:2", task_id: "task:main", content: "also run echo" },
 ]);
 assert.equal(messages.querySelectorAll(".chat-exchange").length, 1);
 assert.deepEqual([...messages.querySelectorAll(".chat-turn.user")].map((turn) => turn.textContent), ["also run echo", "also run echo"]);
});
function uiFixture(controller, session) {
 const dom = new JSDOM('<div id="messages"></div><textarea></textarea>'); const input = dom.window.document.querySelector("textarea");
 const errors = []; const context = { liveInputController: controller, activeChatSessionId: session.id, rootPath: "G:/Xekute", chatInput: input, chatSendInFlight: new Set(),
  effectiveChatInputValue: () => input.value, addUserMessage: () => {}, addErrorMessage: (error) => errors.push(error), resetChatInput: () => {}, schedulePersistChatSessions: () => {}, updateSendBtn: () => {} };
 vm.createContext(context); vm.runInContext(definition('async function submitLiveChatInput(', '\nfunction submitChatComposer()'), context);
 return { submit: context.submitLiveChatInput, input, errors };
}
test("actual UI submission retains a failed composer draft and retries the same input", async () => {
 let calls = 0; const { session, controller } = await fixture({ agentSubmitInput: (payload) => ++calls === 1 ? { ok: false } : receipt(payload.messageId) });
 const ui = uiFixture(controller, session); ui.input.value = "Arial"; session.draftText = "Arial";
 await ui.submit(session, ui.input.value); assert.equal(ui.input.value, "Arial"); assert.equal(session.history.length, 0); assert.equal(ui.errors.length, 1);
 await ui.submit(session, ui.input.value); assert.equal(ui.input.value, ""); assert.equal(session.history[0].source_message_id, "input:1"); assert.equal(session.liveInputs.length, 1);
});
test("actual UI does not clear a new draft when an earlier receipt arrives", async () => {
 const gate = deferred(); const { session, controller } = await fixture({ agentSubmitInput: () => gate.promise }); const ui = uiFixture(controller, session);
 ui.input.value = "Arial"; const operation = ui.submit(session, ui.input.value); ui.input.value = "new draft"; session.draftText = "new draft";
 gate.resolve(receipt("input:1")); await operation;
 assert.equal(ui.input.value, "new draft"); assert.equal(session.draftText, "new draft");
});
test("actual composer Send/Enter callbacks never invoke Stop", () => {
 let sent = 0; let stopped = 0; const context = { sendMessageWithAgentRuntime: () => sent++, stopGeneration: () => stopped++ };
 vm.createContext(context); vm.runInContext(definition('function submitChatComposer()', '\nfunction updateSendBtn()'), context);
 context.submitChatComposer(); context.submitChatComposerFromInput(); assert.equal(sent, 2); assert.equal(stopped, 0);
});
test("shells keep one Send action without decision settings, Stop or queue UI", () => {
 for (const file of ["src/ui/index.legacy.html", "src/ui/react/AppShell.jsx"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replaceAll("className=", "class=");
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll("#stop-btn").length, 0);
  assert.equal(dom.window.document.querySelectorAll("#send-btn").length, 1);
  assert.equal(dom.window.document.querySelectorAll("#decision-model-select").length, 0);
  assert.equal(dom.window.document.querySelector("#prompt-queue"), null);
 }
});
test("timeline normalization retains source input and task IDs across reload", async () => {
 const { normalizeUiTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
 const value = normalizeUiTranscript({ runs: [{ user: { message: "Arial", source_message_id: "input:font", task_id: "report", input_status: "applied" }, events: [] }] });
 assert.equal(value.runs[0].user.source_message_id, "input:font"); assert.equal(value.runs[0].user.task_id, "report"); assert.equal(value.runs[0].user.input_status, undefined);
});

test("actual Stop requests only the selected task in its owning journal", () => {
 const cancellations = []; const aborts = []; const context = { rootPath: "G:/Xekute", window: { api: { agentCancelTask: (payload) => { cancellations.push(payload); return Promise.resolve({ ok: true }); }, abortChat: (payload) => aborts.push(payload) } }, reportChatHistoryWarning: () => {} };
 vm.createContext(context); vm.runInContext(definition('function abortActiveChatRun(', '\nfunction dismissComposerQuestionsForStop('), context);
 context.abortActiveChatRun({ taskId: "child-task", session: { parentMemorySessionId: "parent-journal", memorySessionId: "child-journal" } });
 assert.equal(cancellations.length, 1); assert.equal(cancellations[0].sessionId, "parent-journal"); assert.equal(cancellations[0].taskId, "child-task"); assert.equal(cancellations[0].scope, "task"); assert.equal(aborts.length, 0);
});
test("stopping the parent settles every delegated child UI of that parent only", () => {
 const dependent = { sessionId: "dependent", delegated: true, session: { parentSessionId: "parent" } };
 const other = { sessionId: "other", delegated: true, session: { parentSessionId: "another-parent" } };
 const runs = new Map([["dependent", dependent], ["other", other]]); const settled = [];
 const context = { activeChatRuns: runs, chatStopIdsForRun: () => ["parent"], chatSessionIdForRuntimeId: (id) => id, settleStoppedRun: (run) => settled.push(run.sessionId) };
 vm.createContext(context); vm.runInContext(definition('function settleDelegatedChildrenOf(', '\nfunction stopGeneration()'), context);
 context.settleDelegatedChildrenOf({ sessionId: "parent" }); assert.deepEqual(settled, ["dependent"]); assert.equal(runs.has("other"), true);
});
test("durable received event settles a lost IPC acknowledgment without a duplicate retry", async () => {
 const gate = deferred(); const { session, controller } = await fixture({ agentSubmitInput: () => gate.promise });
 const operation = controller.send({ session, text: "Arial" }); controller.acceptEvent(session, { type: "input_received", messageId: "input:1" });
 gate.resolve({ ok: false, error: "lost reply" }); const result = await operation;
 assert.equal(result.ok, true); assert.equal(result.messageId, "input:1"); assert.equal(result.encrypted, true); assert.equal(result.durable, true);
});
