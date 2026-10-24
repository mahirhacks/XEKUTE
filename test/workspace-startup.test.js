"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

function fixture() {
  let current = true, releaseTerminal;
  const terminal = new Promise(resolve => { releaseTerminal = resolve; });
  const calls = [];
  const scope = {
    appState: { browserWorkspace: { projectChanged() {} } },
    appController: { beginWorkspace: () => ({ epoch: 1 }), isCurrent: () => current },
    window: { api: { readdir: async () => [], watchWorkspace: async () => calls.push("watch") } },
    localStorage: { setItem() {}, removeItem() {} },
    BUG_BOUNTY_PATH_KEY: "target", WORKSPACE_KEY: "workspace", fileTree: {},
    selectedExplorerPaths: new Set(), expandedTreePaths: new Set(),
    setProjectFolder() {}, setExplorerActionsEnabled() {},
    TerminalManager: { setCwd() {}, openWithProject: () => terminal },
    renderTree: async () => calls.push("tree"), refreshDirMap: async () => calls.push("index"),
    restoreChatSessionsForCurrentWorkspace: async () => calls.push("chat"),
    loadGuidanceSettings: async () => calls.push("guidance"),
    updateContextUsage() {}, setAssessmentUiState() {}, projectName: () => "Fixture",
  };
  vm.runInNewContext(rendererDefinitions("loadWorkspace"), scope);
  return { scope, calls, releaseTerminal, cancel: () => { current = false; } };
}

test("saved chat restoration does not wait for terminal startup", async () => {
  const f = fixture();
  const loading = f.scope.loadWorkspace("fixture-workspace");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.includes("chat"), "chat can restore while the shell starts");
  assert.equal(f.calls.includes("watch"), false);
  f.releaseTerminal();
  assert.equal(await loading, true);
  assert.deepEqual(f.calls.filter(call => call !== "chat"), ["tree", "index", "watch", "guidance"]);
});

test("a superseded startup stops before watching or finishing the old workspace", async () => {
  const f = fixture();
  const loading = f.scope.loadWorkspace("fixture-workspace");
  await new Promise(resolve => setImmediate(resolve));
  f.cancel();
  f.releaseTerminal();
  assert.equal(await loading, false);
  assert.equal(f.calls.includes("watch"), false);
  assert.equal(f.calls.includes("guidance"), false);
});
