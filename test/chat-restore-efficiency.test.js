"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("structured chat restoration does not parse its unused HTML backup", async () => {
  const { normalizeUiTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
  let sanitizations = 0;
  const scope = {
    MessageIdentity: { ensureMessageIdentity: messages => messages }, normalizeUiTranscript,
    normalizeContextUsageSnapshot: value => value, normalizeLiveInputs: () => [], canonicalChatMode: mode => mode,
    sanitizePersistedChatHtml: () => { sanitizations++; return "sanitized backup"; },
  };
  vm.runInNewContext(rendererDefinitions("normalizePersistedChatSession"), scope);
  const restored = scope.normalizePersistedChatSession({ id: "chat-1", history: [{ role: "user", content: "Inspect the fixture" }],
    messagesHtml: "unused backup", transcript: { version: 1, runs: [{ user: { message: "Inspect the fixture" }, events: [{ type: "chat", text: "Complete" }] }] } });
  assert.equal(restored.history[0].content, "Inspect the fixture");
  assert.equal(restored.transcript.runs[0].events[0].text, "Complete");
  assert.equal(restored.messagesHtml, "unused backup", "inactive continuation keeps its fallback view");
  assert.equal(sanitizations, 0);
});

test("an inactive agent's fallback view is sanitized when it is mounted", () => {
  const dom = new JSDOM('<div id="messages"></div>');
  try {
    const purify = require("dompurify")(dom.window);
    const scope = { document: dom.window.document, messages: dom.window.document.querySelector("#messages"),
      appState: { activeChatSessionId: "foreground" }, sanitizePersistedChatHtml: html => purify.sanitize(html),
    };
    vm.runInNewContext(rendererDefinitions("chatRunContainer"), scope);
    const run = { sessionId: "background", session: { messagesHtml: '<div class="chat-turn user">Earlier task<img src="x" onerror="bad()"></div>' } };
    const host = scope.chatRunContainer(run);
    assert.equal(host.textContent, "Earlier task");
    assert.equal(host.querySelector("img").hasAttribute("onerror"), false);
    assert.equal(scope.chatRunContainer(run), host, "continuation reuses its existing view");
  } finally { dom.window.close(); }
});

test("legacy HTML is sanitized when no usable structured transcript exists", async () => {
  const { normalizeUiTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
  const dom = new JSDOM("");
  try {
    const purify = require("dompurify")(dom.window);
    const scope = {
      MessageIdentity: { ensureMessageIdentity: messages => messages }, normalizeUiTranscript,
      normalizeContextUsageSnapshot: value => value, normalizeLiveInputs: () => [], canonicalChatMode: mode => mode,
      sanitizePersistedChatHtml: html => purify.sanitize(html),
    };
    vm.runInNewContext(rendererDefinitions("normalizePersistedChatSession"), scope);
    const restored = scope.normalizePersistedChatSession({ id: "legacy", messagesHtml: '<div>Saved message<img src="x" onerror="bad()"></div>',
      transcript: { runs: [{}, { user: {} }] } });
    assert.match(restored.messagesHtml, /Saved message/);
    assert.equal(restored.messagesHtml.includes("onerror"), false);
    assert.equal(restored.transcript.runs.length, 0);
  } finally { dom.window.close(); }
});

test("restoration renders the private reasoning notice without parsing its discarded body", () => {
  const dom = new JSDOM('<div id="fold"><div class="agent-thinking-content streaming"></div></div>');
  try {
    const fold = dom.window.document.querySelector("#fold"), content = fold.firstElementChild;
    let renders = 0;
    const scope = { thinkingElapsedMs: () => 1200, thinkingContentOf: () => content,
      setThinkingFoldLabel: () => {}, setCollapsibleFoldExpanded: () => {},
      renderMarkdown: () => { renders++; },
    };
    vm.runInNewContext(rendererDefinitions("applyThinkingRecord"), scope);
    scope.applyThinkingRecord(fold, { text: "Private saved reasoning", duration_ms: 1200 });
    assert.equal(content.textContent, "Reasoning completed privately. Raw chain-of-thought and system instructions were not displayed.");
    assert.equal(content.hasAttribute("data-raw-md"), false);
    assert.equal(fold.dataset.durationMs, "1200");
    assert.equal(renders, 0);
  } finally { dom.window.close(); }
});
