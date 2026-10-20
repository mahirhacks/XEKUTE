"use strict";
const { rendererSource, withAppState, rendererDefinitions } = require("./helpers/renderer-source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { readUiShell } = require("./helpers/ui-shell.js");
const source = rendererSource();
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const shell = fs.readFileSync(path.join(__dirname, "../src/ui/index.legacy.html"), "utf8");
const menu = shell.slice(shell.indexOf('  <div id="security-history-menu"'), shell.indexOf('  <div id="chat-mode-menu"'));

function fixture() {
  const dom = new JSDOM('<table><tbody><tr id="old"><td>Old capture</td></tr><tr id="target"><td>Target capture</td></tr></tbody></table>' + menu);
  const sent = [], statuses = [], lookups = [];
  const context = { document: dom.window.document, window: dom.window, assessmentPath: "G:/workspace", securityBusy: false, running: false,
    selectedSecurityHistoryIndices: new Set(), securityHistoryMenuIndex: -1,
    securityHistoryRecords: [{ requestId: "old", request: "GET /old HTTP/1.1", response: "HTTP/1.1 200 Old" },
      { requestId: "target", request: null, response: null }],
    securityRequestEditor: { value: "OLD_EDITOR_REQUEST" }, securityResponseEditor: { value: "OLD_EDITOR_RESPONSE" }, chatInput: { value: "" },
    securityHistoryMenu: dom.window.document.querySelector("#security-history-menu"),
    securityHistoryAnalyzeButton: dom.window.document.querySelector("#security-history-analyze"),
    securityHistoryRepeaterLabel: null, securityHistoryIntruderLabel: null, securityHistoryDeleteLabel: null,
    openChatPane() {}, resizeChatInput() {}, updateSendBtn() {},
    sendMessageWithAgentRuntime: async () => sent.push(context.chatInput.value),
    setSecurityStatus: (text, state) => statuses.push({ text, state }), isRunningChatActive: () => context.running,
    securityHistoryIndexForRequestId: id => context.securityHistoryRecords.findIndex(record => record.requestId === id),
    setSecurityHistorySelection: indices => { context.selectedSecurityHistoryIndices = new Set(indices); },
    selectSecurityHistoryRecord() {},
  };
  dom.window.api = { assessmentTrafficRecords: async input => {
    lookups.push(input);
    return { records: [{ requestId: "target", request: "GET /target HTTP/1.1\r\nHost: example.test", response: "HTTP/1.1 200 OK\r\n\r\nTarget response" }] };
  } };
  vm.createContext(withAppState(context));
  vm.runInContext([
    rendererDefinitions("closeSecurityHistoryMenu"),
    rendererDefinitions("hydrateSecurityHistoryRecords"),
    rendererDefinitions("openSecurityHistoryMenu"),
    rendererDefinitions("bindSecurityHistoryRow"),
    rendererDefinitions("analyzeSecurityExchange"),
    slice('securityHistoryMenu?.addEventListener("click"', 'document.addEventListener("click"'),
  ].join("\n"), context);
  for (const record of context.securityHistoryRecords) context.bindSecurityHistoryRow(dom.window.document.getElementById(record.requestId === "old" ? "old" : "target"), record);
  return { context, sent, statuses, lookups, document: dom.window.document, tick: () => new Promise(resolve => setImmediate(resolve)),
    open: () => dom.window.document.querySelector("#target").dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 40 })) };
}

test("the agent toolbar button is replaced by an icon and Analyze with agent in the history menu", () => {
  assert.doesNotMatch(readUiShell(), /id="security-analyze-button"/);
  const { document } = fixture();
  const action = document.querySelector('[data-action="analyze-agent"]');
  assert.equal(action.textContent.trim(), "Analyze with agent");
  assert.ok(action.querySelector(".codicon-copilot"));
});

test("right-click analysis hydrates the clicked capture and sends its request and response instead of stale editors", async () => {
  const { context, document, open, tick, sent, lookups } = fixture();
  open();
  assert.equal(context.securityHistoryMenu.hidden, false);
  document.querySelector('[data-action="analyze-agent"]').click();
  await tick();
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].requestIds[0], "target");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Captured exchange: target/);
  assert.match(sent[0], /GET \/target HTTP\/1\.1/);
  assert.match(sent[0], /Target response/);
  assert.doesNotMatch(sent[0], /OLD_EDITOR|GET \/old/);
  assert.equal(context.securityHistoryMenu.hidden, true);
});

test("changing the history selection while loading does not retarget the analysis", async () => {
  const { context, document, open, tick, sent } = fixture();
  let finish;
  context.window.api.assessmentTrafficRecords = () => new Promise(resolve => { finish = resolve; });
  open(); document.querySelector('[data-action="analyze-agent"]').click();
  context.securityHistoryMenuIndex = 0;
  context.selectedSecurityHistoryIndices = new Set([0]);
  finish({ records: [{ requestId: "target", request: "GET /target HTTP/1.1", response: "Target response" }] });
  await tick();
  assert.match(sent[0], /GET \/target/);
  assert.doesNotMatch(sent[0], /GET \/old/);
});

test("busy chats disable the menu action and a chat becoming busy during hydration prevents submission", async () => {
  const { context, document, open, tick, sent } = fixture();
  context.running = true; open();
  assert.equal(document.querySelector('[data-action="analyze-agent"]').disabled, true);
  context.running = false;
  let finish;
  context.window.api.assessmentTrafficRecords = () => new Promise(resolve => { finish = resolve; });
  open(); document.querySelector('[data-action="analyze-agent"]').click();
  context.running = true;
  finish({ records: [{ requestId: "target", request: "GET /target HTTP/1.1", response: "Target response" }] });
  await tick();
  assert.equal(sent.length, 0);
});

test("failed capture loading reports the failure without sending any editor content", async () => {
  const { context, document, open, tick, sent, statuses } = fixture();
  context.window.api.assessmentTrafficRecords = async () => { throw new Error("Capture unavailable"); };
  open(); document.querySelector('[data-action="analyze-agent"]').click(); await tick();
  assert.equal(sent.length, 0);
  assert.equal(statuses[0].text, "Capture unavailable");
});
