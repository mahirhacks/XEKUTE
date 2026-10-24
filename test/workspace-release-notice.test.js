"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

async function setup(t, releaseResult) {
  const dom = new JSDOM('<div class="chat-turn"><div class="assistant-reply"></div></div>');
  const calls = [];
  globalThis.document = dom.window.document;
  globalThis.window = { api: { releaseUnreconciledProcesses: async (payload) => { calls.push(payload); return releaseResult; } } };
  t.after(() => { delete globalThis.document; delete globalThis.window; dom.window.close(); });
  const { appState } = await import("../src/ui/core/app-state.js");
  appState.rootPath = "G:/NASA";
  const notice = await import("../src/ui/features/chat/workspace-release-notice.js");
  return { dom, calls, notice, anchor: dom.window.document.querySelector(".assistant-reply") };
}

test("only stuck-handle failures ask for a workspace release", async (t) => {
  const { notice } = await setup(t, { ok: true, value: { released: [] } });
  assert.equal(notice.needsWorkspaceRelease({ errorCode: "RESOURCE_RECONCILIATION_REQUIRED" }), true);
  assert.equal(notice.needsWorkspaceRelease({ error: { code: "PROCESS_IDENTITY_UNPROVEN" } }), true);
  assert.equal(notice.needsWorkspaceRelease({ errorCode: "TOOL_EXECUTION_FAILED" }), false);
});

test("the notice appears once per turn and releases the open workspace", async (t) => {
  const { calls, notice, anchor, dom } = await setup(t, { ok: true, value: { released: [{ processId: "process-a", pid: 4242, stillRunning: true }] } });
  const shown = notice.showWorkspaceReleaseNotice(anchor);
  assert.equal(notice.showWorkspaceReleaseNotice(anchor), null, "a second failure in the same turn reuses the notice");
  assert.equal(dom.window.document.querySelectorAll(".workspace-release-notice").length, 1);
  shown.querySelector("button").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [{ workspace: "G:/NASA" }]);
  assert.match(shown.textContent, /Released\..*PID 4242 is still running/);
  assert.equal(shown.querySelector("button"), null);
});

test("a failed release keeps the button for another try", async (t) => {
  const { notice, anchor } = await setup(t, { ok: false, error: "A workspace is required." });
  const shown = notice.showWorkspaceReleaseNotice(anchor);
  shown.querySelector("button").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(shown.textContent, /could not be released: A workspace is required\./);
  assert.equal(shown.querySelector("button").disabled, false);
});
