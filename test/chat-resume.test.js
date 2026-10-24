"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("the composer offers Resume only for an empty stopped chat and sends typed input as fresh work", () => {
  const dom = new JSDOM('<button id="send"><span class="codicon"></span></button>');
  try {
    const session = { id: "main", stoppedRun: { taskId: "task:stopped", model: "original-model" } };
    const requests = [];
    let text = "";
    let running = false;
    let stopped = 0;
    const context = { sendBtn: dom.window.document.querySelector("#send"), appState: { composerImages: [] },
      chatSendInFlight: new Set(), activeChatSession: () => session, effectiveChatInputValue: () => text,
      isRunningChatActive: () => running, sendMessageWithAgentRuntime: options => requests.push(options), stopGeneration: () => stopped++ };
    vm.runInNewContext(rendererDefinitions("updateSendBtn", "submitChatComposer", "submitChatComposerFromInput"), context);
    const button = context.sendBtn;
    context.updateSendBtn();
    assert.equal(button.classList.contains("resume"), true);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-label"), "Resume the stopped run");
    context.submitChatComposer();
    assert.equal(requests[0].resume, true);

    text = "A different request";
    context.updateSendBtn(); context.submitChatComposerFromInput();
    assert.equal(button.classList.contains("resume"), false);
    assert.equal(button.title, "Send message");
    assert.equal(requests[1], undefined, "typed input uses the normal fresh-send path");
    text = "";
    session.stopPending = Promise.resolve(); context.updateSendBtn();
    assert.equal(button.classList.contains("resume"), true);
    assert.equal(button.disabled, true, "Resume waits for the old invocation to finish stopping");
    context.submitChatComposer(); assert.equal(requests.length, 2);
    delete session.stopPending;
    context.appState.composerImages = [{}]; context.updateSendBtn();
    assert.equal(button.classList.contains("resume"), false, "attachments start fresh work");
    context.appState.composerImages = [];
    running = true; context.updateSendBtn(); context.submitChatComposer();
    assert.equal(stopped, 1);
    session.stoppedRun = null; running = false; context.updateSendBtn();
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains("resume"), false);
  } finally { dom.window.close(); }
});

test("stopping retains only a task reference and frozen display settings for resume", () => {
  const context = {};
  vm.runInNewContext(rendererDefinitions("rememberStoppedRun"), context);
  const session = { taskId: "task:original" };
  context.rememberStoppedRun({ session, model: "frozen-model", mode: "agent", family: "xekute" });
  assert.deepEqual(JSON.parse(JSON.stringify(session.stoppedRun)), { taskId: "task:original", model: "frozen-model", mode: "agent", family: "xekute" });
});
