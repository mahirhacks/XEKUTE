"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadCore() {
  const context = { globalThis: {}, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/app-core.js"), "utf8"), context);
  return context.globalThis.PointerCore;
}

test("renderer store owns explicit slices and publishes scoped updates", () => {
  const core = loadCore();
  const store = core.createAppStore();
  const changes = [];
  const unsubscribe = store.subscribe((_state, slice) => changes.push(slice));
  store.update("chat", { activeSessionId: "chat-1" });
  unsubscribe();
  store.update("map", { selectedNodeId: "route-1" });
  assert.deepEqual(changes, ["chat"]);
  assert.equal(store.select((state) => state.chat.activeSessionId), "chat-1");
  assert.throws(() => store.update("unknown", {}), /Unknown store slice/);
});

test("workspace epochs abort and invalidate stale async work", () => {
  const core = loadCore();
  const controller = new core.AppController(core.createAppStore());
  const first = controller.beginWorkspace("one");
  const second = controller.beginWorkspace("two");
  assert.equal(first.signal.aborted, true);
  assert.equal(controller.isCurrent(first.epoch), false);
  assert.equal(controller.isCurrent(second.epoch), true);
  controller.dispose();
  assert.equal(second.signal.aborted, true);
});
