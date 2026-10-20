"use strict";
const { rendererSource, withAppState, rendererDefinitions } = require("./helpers/renderer-source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const renderer = rendererSource();
const notices = rendererDefinitions("CONTEXT_SUMMARIZING_NOTICE", "CONTEXT_SUMMARIZED_NOTICE", "CONTEXT_SUMMARIZATION_INTERRUPTED_NOTICE", "pendingContextCheckpointNotice", "lastAgentRunChunk", "checkpointNoticeHost", "ensureContextCheckpointNotice", "setContextCheckpointNoticeText", "hydrateContextCheckpointNotices", "finishContextCheckpointNotice", "applyContextCheckpointUi", "applyChatReferenceImportUi");

function fixture() {
  const dom = new JSDOM('<div id="messages"><div id="destination"></div><div id="other"></div></div>');
  const labels = [];
  const context = { document: dom.window.document, messages: dom.window.document.querySelector("#messages"), contextCheckpointNotice: null,
    contextCheckpointingSessionId: "", activeChatSessionId: "destination", chatExchangeBody: node => node,
    chatRunContainer: run => run.container, workFoldBody: () => null, turnWorkFold: () => null,
    appendChatStreamNode: (host, node) => host.append(node), setContextCheckpointUi() {},
    setAgentStatus: value => labels.push(value), modeLabel: () => "Agent", scrollMessages() {}, syncChatRunSession() {}, updateContextUsage() {},
  };
  vm.createContext(withAppState(context)); vm.runInContext(notices, context);
  return { context, labels, document: dom.window.document, run: { session: { id: "destination" }, mode: "agent", container: dom.window.document.querySelector("#destination") } };
}

test("import preparation uses one expandable row and retains it in place after completion", () => {
  const { context, labels, document, run } = fixture();
  context.applyChatReferenceImportUi(run, { status: "started", titles: ["Authentication", "Recon", 'A \"quoted\" chat'] });
  const notice = document.querySelector(".context-checkpoint-notice");
  const fold = notice.querySelector("details");
  assert.equal(notice.querySelector("summary").textContent, "Bringing chats to this session...\u203a");
  assert.deepEqual([...notice.querySelectorAll(".chat-reference-name")].map(node => node.textContent), ["Authentication", "Recon", 'A \"quoted\" chat']);
  assert.equal(fold.open, false);
  fold.querySelector("summary").click();
  assert.equal(fold.open, true);
  context.applyContextCheckpointUi(run, { status: "started", reason: "chat_reference_import" });
  context.applyContextCheckpointUi(run, { status: "completed", reason: "before_model_call" });
  assert.equal(notice.querySelector(".context-checkpoint-text").textContent, "Bringing chats to this session...");
  assert.deepEqual(labels, ["Bringing chats to this session..."]);
  context.applyChatReferenceImportUi(run, { status: "completed", title: "Authentication" });
  assert.equal(notice.querySelector(".context-checkpoint-text").textContent, "Brought chats");
  assert.equal(notice.dataset.state, "complete");
  assert.equal(fold.open, true);
  fold.querySelector("summary").click();
  assert.equal(fold.open, false);
  const later = document.createElement("div");
  later.textContent = "Later assistant response";
  run.container.append(later);
  assert.equal(notice.nextElementSibling, later);
  context.applyContextCheckpointUi(run, { status: "started" });
  assert.equal(document.querySelector(".context-checkpoint-notice[data-state='pending']").textContent, "Chat context being summarized...");
  assert.equal(notice.nextElementSibling, later);
});

test("a different chat's compaction cannot replace the active chat's import notice", () => {
  const { context, labels, document, run } = fixture();
  context.applyChatReferenceImportUi(run, { status: "started", title: "Recon" });
  context.applyContextCheckpointUi({ session: { id: "other" }, container: document.querySelector("#other"), mode: "agent" }, { status: "started" });
  assert.equal(document.querySelector("#destination .context-checkpoint-text").textContent, "Bringing chats to this session...");
  assert.equal(document.querySelector("#other").textContent, "Chat context being summarized...");
  assert.deepEqual(labels, ["Bringing chats to this session..."]);
});

test("a later import completes its own row without changing an earlier imported-chat list", () => {
  const { context, document, run } = fixture();
  context.applyChatReferenceImportUi(run, { status: "started", titles: ["First"] });
  context.applyChatReferenceImportUi(run, { status: "completed" });
  const first = document.querySelector(".context-checkpoint-notice");
  context.applyChatReferenceImportUi(run, { status: "started", titles: ["Second", "Third"] });
  context.applyChatReferenceImportUi(run, { status: "completed" });
  const rows = [...document.querySelectorAll(".context-checkpoint-notice")];
  assert.equal(rows.length, 2);
  assert.equal(rows[0], first);
  assert.deepEqual(rows.map(row => row.dataset.state), ["complete", "complete"]);
  assert.equal(rows[0].querySelector(".chat-reference-names").textContent, "First");
  assert.equal(rows[1].querySelector(".chat-reference-names").textContent, "SecondThird");
});

test("saved completed imports retain the expandable chat names after sanitization and hydration", () => {
  const { context, document, run } = fixture();
  context.applyChatReferenceImportUi(run, { status: "started", titles: ["Auth <img src=x onerror=alert(1)>", "Recon"] });
  context.applyChatReferenceImportUi(run, { status: "completed" });
  run.container.querySelector("details").open = true;
  const createDOMPurify = require("dompurify");
  context.DOMPurify = createDOMPurify(document.defaultView);
  context.stripFailedToolCardStubs = () => {};
  context.pruneEmptyWorkFolds = () => {};
  context.redactThinkingDisclosures = () => {};
  vm.runInContext(rendererDefinitions("sanitizePersistedChatHtml"), context);
  const html = context.sanitizePersistedChatHtml(run.container.innerHTML);
  run.container.innerHTML = html;
  context.hydrateContextCheckpointNotices(run.container);
  const notice = run.container.querySelector(".context-checkpoint-notice");
  assert.equal(notice.querySelector(".context-checkpoint-text").textContent, "Brought chats");
  assert.equal(notice.querySelector("details").open, true);
  assert.equal(notice.querySelectorAll(".chat-reference-name").length, 2);
  assert.equal(notice.querySelector("img"), null);
  notice.querySelector("summary").click();
  assert.equal(notice.querySelector("details").open, false);
});

test("failed imports retain an expandable error row and ordinary compaction still completes in place", () => {
  const { context, document, run } = fixture();
  context.applyChatReferenceImportUi(run, { status: "started", titles: ["Unavailable"] });
  context.applyChatReferenceImportUi(run, { status: "failed" });
  const notice = run.container.querySelector(".context-checkpoint-notice");
  assert.equal(notice.dataset.state, "error");
  assert.equal(notice.querySelector(".context-checkpoint-text").textContent, "Could not bring chats");
  assert.equal(notice.querySelector(".chat-reference-name").textContent, "Unavailable");
  context.applyContextCheckpointUi(run, { status: "started" });
  const checkpoint = run.container.querySelector(".context-checkpoint-notice[data-state='pending']");
  context.applyContextCheckpointUi(run, { status: "completed" });
  assert.equal(checkpoint.dataset.state, "complete");
  assert.equal(checkpoint.textContent, "Chat context summarized");
});
