"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("a resumed parent waiting for a detached tool stays live when its child scheduler settles", async () => {
  let settled = 0;
  const run = {
    sessionId: "parent", session: { id: "parent" }, history: [],
    assistant: { rawContent: "Checked the page.", finalizeContent() {}, turn: { setAttribute() {} } },
  };
  const activeChatRuns = new Map([["parent", run]]);
  const context = {
    ensureParentContinuationRun: () => run, activeChatRuns,
    appState: { activeChatSessionId: "another-chat" },
    syncChatRunSession() {}, syncSubagentOrchestrationWaitStatus() {}, updateSendBtn() {},
    window: { api: {} }, chatSessionIdForRuntimeId: id => id,
    rootHasLiveProcesses: () => false, runWorkRoot: () => null,
    settleVisibleParentRun: () => { settled++; }, queueMicrotask() {}, drainPendingBackgroundWaitEvents() {},
  };
  vm.runInNewContext(rendererDefinitions("renderParentContinuationEvent", "noteParentRunSettled", "parentRunStillWorking"), context);
  await context.renderParentContinuationEvent({ type: "parent_continuation_complete", result: { ok: true, commandWait: true, runState: { status: "running" } } });
  context.noteParentRunSettled({ sessionId: "parent", orchestrationHold: false, pendingEndTurn: false });
  assert.equal(run.commandWait, true);
  assert.equal(run.state, "running");
  assert.equal(activeChatRuns.has("parent"), true);
  assert.equal(settled, 0);
  await context.renderParentContinuationEvent({ type: "parent_continuation_complete", result: { ok: true, runState: { status: "completed" } } });
  context.noteParentRunSettled({ sessionId: "parent", orchestrationHold: false, pendingEndTurn: false });
  assert.equal(run.commandWait, false);
  assert.equal(settled, 1);
});

test("automatic parent continuations display block-release events", async () => {
  const releases = [];
  const run = { sessionId: "parent", session: {}, assistant: {} };
  const context = {
    appState: { activeChatSessionId: "other" }, ensureParentContinuationRun: () => run,
    applyContextReleaseUi: (owner, event) => releases.push({ owner, event }),
    scheduleLiveChatSnapshot() {},
  };
  vm.runInNewContext(rendererDefinitions("renderParentContinuationEvent"), context);
  const event = { type: "context_release", status: "completed", indices: [6, 7], tokensFreed: 41000 };
  await context.renderParentContinuationEvent(event);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].owner, run);
  assert.equal(releases[0].event, event);
});

for (const child of [false, true]) test(`${child ? "child" : "resumed parent"} checklist events update only the owning agent's widget`, async () => {
  const dom = new JSDOM('<div id="input-bar"><div id="tasks" hidden></div></div>');
  try {
    let activityCount = 0;
    const run = { sessionId: "owner", session: {}, assistant: { noteActivity() { activityCount++; } } };
    const context = {
      appState: { activeChatSessionId: "owner" },
      ensureParentContinuationRun: () => run, ensureDelegatedChildRun: () => run, childAssistant: () => run.assistant,
      enqueueDelegatedChildEvent: (_id, action) => action(), runIsChildVisible: () => context.appState.activeChatSessionId === "owner",
      composerTaskListEl: dom.window.document.querySelector("#tasks"), inputBar: dom.window.document.querySelector("#input-bar"),
      scheduleLiveChatSnapshot() {}, scheduleDelegatedLiveSnapshot() {}, scrollMessages() {},
    };
    vm.runInNewContext(rendererDefinitions("escapeHtml", "clearComposerTaskList", "renderComposerTaskList", "renderParentContinuationEvent", "handleDelegatedChildRuntimeEvent"), context);
    const send = payload => child ? context.handleDelegatedChildRuntimeEvent({ ...payload, sessionId: "owner", childSessionId: "owner" }) : context.renderParentContinuationEvent(payload);
    const tasks = Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: `Step ${index + 1}`, status: index ? "pending" : "in_progress" }));
    await send({ type: "task_list", source: child ? "subagent" : "parent_continuation", tasks });
    assert.equal(context.composerTaskListEl.hidden, false);
    assert.equal(context.composerTaskListEl.querySelector(".composer-task-list-row:not([hidden]) .composer-task-list-title").textContent, "Step 1");
    const positions = [...context.composerTaskListEl.querySelectorAll(".composer-task-list-position")];
    assert.deepEqual(positions.map((el) => [el.closest(".composer-task-list-row").dataset.taskIndex, el.textContent]), [["0", "1 of 10"]], "only the active row shows its position");
    assert.equal(run.taskList.tasks.length, 10);
    assert.equal(run.taskList.source, "agent", "transport provenance does not change checklist ownership");
    assert.equal(activityCount, 1);
    context.appState.activeChatSessionId = "another-agent";
    await send({ type: "task_list", source: "agent", tasks: [{ id: "new", title: "Changed background task", status: "pending" }] });
    assert.equal(run.taskList.tasks[0].title, "Changed background task");
    assert.equal(context.composerTaskListEl.querySelector(".composer-task-list-row:not([hidden]) .composer-task-list-title").textContent, "Step 1");
    context.appState.activeChatSessionId = "owner";
    await send({ type: "task_list", clear: true });
    assert.equal(context.composerTaskListEl.hidden, true);
    assert.equal(run.taskList, null);
    assert.equal(activityCount, 2, "clearing a checklist does not start visible activity");
  } finally { dom.window.close(); }
});

test("the checklist position follows the active item and stays on it when expanded", () => {
  const dom = new JSDOM('<div id="tasks" hidden></div><div id="input-bar"></div>');
  const context = {
    document: dom.window.document, appState: { activeChatSessionId: "owner" },
    composerTaskListEl: dom.window.document.querySelector("#tasks"), inputBar: dom.window.document.querySelector("#input-bar"),
  };
  vm.runInNewContext(rendererDefinitions("escapeHtml", "clearComposerTaskList", "renderComposerTaskList"), context);
  const statuses = (...list) => list.map((status, index) => ({ id: String(index), title: `Step ${index + 1}`, status }));
  const position = () => [...context.composerTaskListEl.querySelectorAll(".composer-task-list-position")]
    .map((el) => [el.closest(".composer-task-list-row").dataset.taskIndex, el.textContent]);
  context.renderComposerTaskList({ tasks: statuses("completed", "in_progress", "pending") });
  assert.deepEqual(position(), [["1", "2 of 3"]]);
  context.appState.activeComposerTaskList.expanded = true;
  context.renderComposerTaskList(context.appState.activeComposerTaskList);
  assert.equal(context.composerTaskListEl.querySelectorAll(".composer-task-list-row:not([hidden])").length, 3);
  assert.deepEqual(position(), [["1", "2 of 3"]], "expanding keeps the position beside the active item only");
  context.renderComposerTaskList({ tasks: statuses("completed", "completed", "completed") });
  assert.deepEqual(position(), [["2", "3 of 3"]], "a finished list ends on its last item");
});
