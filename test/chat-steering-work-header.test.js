"use strict";
const { withAppState, rendererDefinitions } = require("./helpers/renderer-source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");


async function renderer(html = '<div id="messages"></div>') {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  globalThis.document = document;
  const fold = await import("../src/ui/features/chat/chat-work-fold.js");
  const skills = await import("../src/ui/features/chat/skill-activity.js");
  const context = {
    ...fold,
    ...skills,
    document,
    messages: document.querySelector("#messages"),
    activeChatRuns: new Map(),
    activeChatSessionId: "chat",
    chatInput: null,
    isChatSessionRunning: () => true,
    latestExchangeUserPromptText: () => "",
    createUserPromptBox: (text) => { const box = document.createElement("div"); box.className = "chat-box-content"; box.textContent = text; return box; },
    formatAgentWorkDuration: (_start, ms = 0) => `${Math.round(ms / 1000)}s`,
    renderMarkdown: (el, text) => { el.textContent = text; },
    restackFileRows() {},
    appendTranscriptEvent: (host, event) => {
      const node = document.createElement("div");
      node.className = event.type === "chat" ? "assistant-reply" : "agent-command-event";
      node.textContent = event.text;
      host.appendChild(node);
    },
    syncChatStickyMask() {}, syncChatEmptyState() {}, scrollMessages() {},
    updateSendBtn() {}, setAgentStatus() {}, updateContextUsage() {}, syncChatRunSession() {},
    modeLabel: () => "Agent",
    setInterval: () => 1, clearInterval() {},
    ToolParser: { cleanReplyForDisplay: text => text },
    Node: dom.window.Node,
  };
  vm.createContext(withAppState(context));
  vm.runInContext(rendererDefinitions(
    "isAgentResponseChild", "ensureAgentResponseHost", "createAgentResponseHost",
    "startAssistantSteeringSegment", "turnHasWorkVerdict", "ensureAssistantWorkFold",
    "wrapAssistantInRunChunk", "createChatExchange", "chatExchangeBody", "currentChatExchange",
    "appendChatTurn", "appendSteeringUserTurn", "createRestoredWorkFold", "replyEndsWithStopped",
    "markSteeringAnswer", "appendStoppedPlainText", "addUserMessage", "renderTranscriptRun",
    "isEmptyAssistantReply",
    "createAssistantTurn", "streamingNodeLive", "workFollowingReply",
    "markActivityNode", "appendChatStreamNode", "isChatStreamPlaceholder",
    "conciseAgentStatus", "isDurationWorkLabel", "isStubToolStatusLabel",
    "chatRunContainer", "pendingContextCheckpointNotice", "ensureContextCheckpointNotice",
    "setContextCheckpointNoticeText", "finishContextCheckpointNotice", "setContextCheckpointUi",
    "applyChatReferenceImportUi", "applyContextCheckpointUi",
    "CONTEXT_SUMMARIZING_NOTICE", "CONTEXT_SUMMARIZED_NOTICE", "CONTEXT_SUMMARIZATION_INTERRUPTED_NOTICE",
  ), context);
  return { context, document, messages: context.messages };
}

function headerTexts(root) {
  return [...root.querySelectorAll(".agent-work-header")].map((header) => header.textContent.trim());
}

test("only explicit resume uses the Resuming startup placeholder", async () => {
  for (const resuming of [false, true]) {
    const { context, messages } = await renderer();
    const assistant = context.createAssistantTurn({ sessionId: "chat", resuming });
    assert.deepEqual(headerTexts(messages), [resuming ? "Resuming…" : "Planning…"]);
    assistant.setLiveState({ kind: "working", detail: "Starting" });
    assert.deepEqual(headerTexts(messages), [resuming ? "Resuming…" : "Planning…"]);
    assistant.appendContent("First visible response");
    assert.deepEqual(headerTexts(messages), ["Working for 0s"]);
    assert.equal(messages.querySelector(".assistant-reply").textContent, "First visible response");
  }
});

test("chat import activity replaces the startup placeholder and never brings it back", async () => {
  for (const detached of [false, true]) {
    for (const status of ["completed", "failed"]) {
      const { context, document, messages } = await renderer();
      const container = detached ? document.createElement("div") : messages;
      const assistant = context.createAssistantTurn({ container, sessionId: "chat", resuming: detached });
      const run = { sessionId: "chat", session: { id: "chat" }, mode: "agent", assistant, viewHost: detached ? container : null };
      context.applyChatReferenceImportUi(run, { status: "started", titles: ["Previous investigation"] });
      assert.equal(container.querySelector(".context-checkpoint-text").textContent, "Bringing chats to this session...");
      assert.deepEqual(headerTexts(container), ["Working for 0s"]);
      context.applyChatReferenceImportUi(run, { status: "running", titles: ["Previous investigation"] });
      context.applyChatReferenceImportUi(run, { status });
      assert.equal(container.querySelectorAll(".context-checkpoint-notice").length, 1);
      assert.equal(container.querySelector(".context-checkpoint-text").textContent, status === "failed" ? "Could not bring chats" : "Brought chats");
      assistant.setLiveState({ kind: "working", detail: "Starting" });
      assert.deepEqual(headerTexts(container), ["Working for 0s"]);
      assistant.appendContent("Following the imported context");
      assert.deepEqual(headerTexts(container), ["Working for 0s"]);
      assert.equal(container.querySelector(".chat-reference-name").textContent, "Previous investigation");
    }
  }
});

test("context summarization replaces a resume placeholder before any model output", async () => {
  const { context, messages } = await renderer();
  const assistant = context.createAssistantTurn({ sessionId: "chat", resuming: true });
  const run = { sessionId: "chat", session: { id: "chat" }, mode: "agent", assistant };
  context.applyContextCheckpointUi(run, { status: "started" });
  assert.equal(messages.querySelector(".context-checkpoint-text").textContent, "Chat context being summarized...");
  assert.deepEqual(headerTexts(messages), ["Working for 0s"]);
  context.applyContextCheckpointUi(run, { status: "completed" });
  assistant.setLiveState({ kind: "working", detail: "Starting" });
  assert.equal(messages.querySelector(".context-checkpoint-text").textContent, "Chat context summarized");
  assert.deepEqual(headerTexts(messages), ["Working for 0s"]);
});

test("a steering prompt keeps the round's only Working for header live under the main prompt", async () => {
  const { context, document, messages } = await renderer();
  context.appendChatTurn(Object.assign(document.createElement("div"), { className: "chat-turn user" }), { startsExchange: true });
  const mainTurn = document.createElement("div");
  mainTurn.className = "chat-turn assistant agent-stream";
  mainTurn.setAttribute("aria-busy", "true");
  context.appendChatTurn(mainTurn);
  const mainFold = context.ensureAssistantWorkFold(mainTurn, { startedAt: 1, label: "Working for 12s" });
  const mainHeader = context.workFoldHeader(mainFold);
  const assistant = { turn: mainTurn, rootTurn: mainTurn, contentSegments: [], sealCurrentContentSegment() {}, finishThinking() {} };
  context.activeChatRuns.set("chat", { assistant, taskId: "task:main" });

  context.addUserMessage("and also run an echo command after that", "input:steer");
  assert.ok(assistant.turn === mainTurn, "the open block keeps streaming above the steering prompt");
  context.startAssistantSteeringSegment(assistant, assistant.pendingSteeringHost);

  const continuation = assistant.turn;
  assert.ok(continuation !== mainTurn);
  assert.equal(continuation.dataset.steeringSegment, "true");
  assert.equal(mainHeader.dataset.final, undefined);
  assert.equal(mainHeader.textContent.trim(), "Working for 12s");
  assert.equal(context.ensureAssistantWorkFold(continuation), null);
  assert.equal(context.ensureAssistantWorkFold(mainTurn), mainFold);
  assert.deepEqual(headerTexts(messages), ["Working for 12s"]);
  assert.deepEqual([...messages.querySelector(".chat-exchange-body").children].map((node) => node.className),
    ["chat-turn user", "agent-response-host agent-stream", "chat-turn user", "agent-response-host agent-stream"]);
});

test("a superseded streaming round cannot put the next model response above steering", async () => {
  const { context, document, messages } = await renderer();
  context.appendChatTurn(Object.assign(document.createElement("div"), { className: "chat-turn user", textContent: "main" }), { startsExchange: true });
  const assistant = context.createAssistantTurn({ sessionId: "chat" });
  context.activeChatRuns.set("chat", { assistant, taskId: "task:main" });
  assistant.appendContent("Earlier response");
  context.addUserMessage("Use the revised scope", "input:steer");
  const steering = messages.querySelector('[data-source-message-id="input:steer"]');
  assistant.appendContent(" still streaming");
  // A superseded provider response has no model_round completion event.
  assistant.beginModelBlock({ newRound: true });
  assistant.appendContent("Response using revised scope");
  const next = assistant.turn;
  assert.equal(steering.compareDocumentPosition(next) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 4);
  assert.equal(next.textContent, "Response using revised scope");
  assert.match(assistant.rootTurn.textContent, /Earlier response still streaming/);
});

test("steering hosts retain their order while the running chat is detached", async () => {
  const { context, document, messages } = await renderer();
  context.appendChatTurn(Object.assign(document.createElement("div"), { className: "chat-turn user", textContent: "main" }), { startsExchange: true });
  const assistant = context.createAssistantTurn({ sessionId: "chat" });
  context.activeChatRuns.set("chat", { assistant, taskId: "task:main" });
  assistant.appendContent("Earlier response");
  const hidden = document.createElement("div");
  while (messages.firstChild) hidden.append(messages.firstChild);
  context.appendSteeringUserTurn(Object.assign(document.createElement("div"), { className: "chat-turn user", textContent: "First steering" }), hidden.querySelector(".chat-exchange"), assistant);
  context.appendSteeringUserTurn(Object.assign(document.createElement("div"), { className: "chat-turn user", textContent: "Second steering" }), hidden.querySelector(".chat-exchange"), assistant);
  assistant.modelBlockOpen = false;
  assistant.beginModelBlock();
  assistant.appendContent("New response");
  const order = [...hidden.querySelector(".chat-exchange-body").children].map(node => node.textContent);
  assert.deepEqual(order.slice(-3), ["First steering", "Second steering", "New response"]);
});

test("steering prompts sent during one block wait in order and the next block starts under the latest", async () => {
  const { context, document, messages } = await renderer();
  context.appendChatTurn(Object.assign(document.createElement("div"), { className: "chat-turn user", textContent: "main" }), { startsExchange: true });
  const mainTurn = document.createElement("div");
  mainTurn.className = "chat-turn assistant agent-stream";
  mainTurn.textContent = "thinking about the sleeps";
  context.appendChatTurn(mainTurn);
  const assistant = { turn: mainTurn, rootTurn: mainTurn, contentSegments: [], sealCurrentContentSegment() {}, finishThinking() {} };
  context.activeChatRuns.set("chat", { assistant, taskId: "task:main" });

  context.addUserMessage("also run echo", "input:one");
  context.addUserMessage("and print the date", "input:two");

  const body = messages.querySelector(".chat-exchange-body");
  assert.deepEqual([...body.children].map((node) => node.textContent), ["main", "thinking about the sleeps", "also run echo", "and print the date", ""]);
  assert.ok(assistant.turn === mainTurn);
  assert.ok(assistant.pendingSteeringHost === body.lastElementChild);
});

test("a restored run shows one Worked for header under the main prompt", async () => {
  const { context, messages } = await renderer();
  context.renderTranscriptRun({ worked_for_ms: 48_000, timeline: [
    { type: "user", message: "run three sleeps" },
    { type: "assistant", events: [{ type: "chat", text: "Starting the sleeps" }, { type: "command", text: "sleep 30" }] },
    { type: "user", message: "also run echo" },
    { type: "assistant", events: [{ type: "command", text: "echo done" }, { type: "chat", text: "All done" }] },
  ] }, messages);
  const hosts = [...messages.querySelectorAll(".agent-response-host")];
  assert.deepEqual(headerTexts(messages), ["Worked for 48s"]);
  assert.equal(headerTexts(hosts[0]).length, 1);
  const steering = hosts[1].querySelector(".chat-turn.assistant");
  assert.equal(steering.dataset.steeringSegment, "true");
  assert.deepEqual([...steering.children].map((node) => node.textContent), ["echo done", "All done"]);
});

test("a restored run keeps the header on the main prompt when only steering used tools", async () => {
  const { context, messages } = await renderer();
  context.renderTranscriptRun({ worked_for_ms: 9_000, timeline: [
    { type: "user", message: "fix the frontend" },
    { type: "assistant", events: [{ type: "chat", text: "Looking at it" }] },
    { type: "user", message: "and the backend" },
    { type: "assistant", events: [{ type: "command", text: "node --test" }] },
  ] }, messages);
  const hosts = [...messages.querySelectorAll(".agent-response-host")];
  assert.deepEqual(headerTexts(hosts[0]), ["Worked for 9s"]);
  assert.deepEqual(headerTexts(hosts[1]), []);
});

test("Stopped follows the last command in a steering segment", async () => {
  const { context, document } = await renderer();
  const turn = document.createElement("div");
  turn.innerHTML = '<div class="assistant-reply">Checking the backend</div><div class="agent-command-event">node --test</div>';
  context.appendStoppedPlainText(turn);
  assert.deepEqual([...turn.children].map((node) => node.textContent), ["Checking the backend", "node --test", "Stopped"]);
});

test("only the final answer of a steered run stays marked to remain visible when Worked for collapses", async () => {
  const { context, messages } = await renderer();
  context.renderTranscriptRun({ worked_for_ms: 107_000, timeline: [
    { type: "user", message: "run three sleeps" },
    { type: "assistant", events: [{ type: "command", text: "sleep 30" }] },
    { type: "user", message: "also run echo" },
    { type: "assistant", events: [{ type: "chat", text: "Running echo now" }, { type: "command", text: "echo hi" }, { type: "chat", text: "Echo is queued" }, { type: "command", text: "wait" }, { type: "chat", text: "All four commands finished." }] },
  ] }, messages);
  const steering = messages.querySelector('.chat-turn.assistant[data-steering-segment="true"]');
  assert.deepEqual([...steering.querySelectorAll('.assistant-reply[data-work-verdict="true"]')].map((node) => node.textContent), ["All four commands finished."]);
  assert.deepEqual([...steering.children].map((node) => node.textContent), ["Running echo now", "echo hi", "Echo is queued", "wait", "All four commands finished."]);
  assert.equal(messages.querySelector(".agent-work-fold").dataset.expanded, "false");
});

test("every turn-ending answer under steering stays visible, interim text folds away", async () => {
  const { context, document } = await renderer('<div id="messages"><div class="chat-exchange"></div></div>');
  const exchange = document.querySelector(".chat-exchange");
  exchange.innerHTML = `<div class="chat-turn assistant" data-steering-segment="true">
    <div class="assistant-reply">Running the echo now.</div><div class="agent-command-event">echo</div>
    <div class="agent-thinking-fold">Thought briefly</div><div class="assistant-reply">Let me verify the helper job.</div>
    <div class="agent-thinking-fold">Thought briefly</div><div class="assistant-reply" data-stop-round="true">All requested work is complete.</div>
    <div class="agent-thinking-fold">Thought briefly</div><div class="assistant-reply" data-stop-round="true">The helper job also finished.</div></div>`;
  context.markSteeringAnswer(exchange);
  assert.deepEqual([...exchange.querySelectorAll('[data-work-verdict="true"]')].map((node) => node.textContent), ["All requested work is complete.", "The helper job also finished."]);
});

test("a saved steering segment loses the fold an older save gave it and keeps its order", async () => {
  const { context, document } = await renderer('<div id="messages"></div>');
  context.coalesceAdjacentReplyRuns = () => {};
  context.pruneEmptyWorkFolds = () => {};
  vm.runInContext(rendererDefinitions("normalizeAssistantTurns"), context);
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";
  turn.dataset.steeringSegment = "true";
  turn.innerHTML = '<div class="agent-work-fold" data-expanded="false"><button class="agent-work-header"><span class="agent-status-text">Worked for a moment</span></button><div class="agent-work-fold-body"><div class="agent-thinking-fold">Thought briefly</div><div class="assistant-reply">Interim</div><div class="agent-command-event">echo</div></div></div><div class="assistant-reply">Answer</div>';
  document.querySelector("#messages").appendChild(turn);
  context.normalizeAssistantTurns(turn);
  assert.equal(turn.querySelector(".agent-work-fold"), null);
  assert.deepEqual([...turn.children].map((node) => node.textContent), ["Thought briefly", "Interim", "echo", "Answer"]);
});
