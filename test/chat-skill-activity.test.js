"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("Skill loaded lists the admitted names as text below its label", async () => {
  const { createSkillLoadRow, readSkillLoadRow } = await import("../src/ui/features/chat/skill-activity.js");
  const dom = new JSDOM("<!doctype html><body></body>");
  try {
    const row = createSkillLoadRow([" Evidence Review ", "Browser Testing", "Evidence Review", "<img src=x onerror=alert(1)>"], dom.window.document);
    assert.equal(row.querySelector(".agent-skill-label").textContent, "Skill loaded");
    assert.equal(row.querySelector(".agent-tool-verb").textContent, "Skill");
    assert.deepEqual([...row.querySelectorAll("li")].map(item => item.textContent), ["Evidence Review", "Browser Testing", "<img src=x onerror=alert(1)>"]);
    assert.equal(row.querySelector("img"), null);
    assert.deepEqual(readSkillLoadRow(row), ["Evidence Review", "Browser Testing", "<img src=x onerror=alert(1)>"]);
    assert.equal(createSkillLoadRow([], dom.window.document), null);
  } finally { dom.window.close(); }
});

test("skill load activity survives capture and replay and fits the existing IPC depth", async () => {
  const { createSkillLoadRow } = await import("../src/ui/features/chat/skill-activity.js");
  const { captureChatTranscript, normalizeUiTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
  const { validateIpcRequest } = require("../src/contracts/ipc/IpcContracts.js");
  const dom = new JSDOM('<div id="messages"><div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box-content">Review this app</div></div><div class="agent-response-host"><div class="chat-turn assistant"><div class="agent-work-fold"><div class="agent-work-fold-body"></div></div></div></div></div></div></div>');
  try {
    const doc = dom.window.document;
    doc.querySelector(".agent-work-fold-body").append(createSkillLoadRow(["Evidence Review", "Browser Testing"], doc));
    const transcript = normalizeUiTranscript(captureChatTranscript(doc.querySelector("#messages")));
    const events = transcript.runs[0].events;
    assert.deepEqual(events, [{ type: "skills_loaded", lane: "activity", skills: ["Evidence Review", "Browser Testing"] }]);
    assert.equal(validateIpcRequest("chat-history:save-before-close", [{ uiTranscript: transcript }]), null);
    const host = doc.createElement("div");
    const context = { createSkillLoadRow: skills => createSkillLoadRow(skills, doc) };
    vm.runInNewContext(rendererDefinitions("appendTranscriptEvent"), context);
    context.appendTranscriptEvent(host, events[0]);
    assert.deepEqual([...host.querySelectorAll("li")].map(item => item.textContent), ["Evidence Review", "Browser Testing"]);
    const { isWorkNode } = await import("../src/ui/features/chat/chat-work-fold.js");
    assert.equal(isWorkNode(host.firstChild), true);
  } finally { dom.window.close(); }
});
