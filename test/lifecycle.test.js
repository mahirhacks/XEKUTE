"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerLifecycle, setAllowImmediateQuit } = require("../src/app/electron/lifecycle.js");

function createAppHarness() {
  const handlers = {};
  const app = {
    quitCalls: 0,
    requestSingleInstanceLock() { return true; },
    setAppUserModelId() {},
    whenReady() {
      return { then(fn) { fn(); return this; } };
    },
    on(event, handler) { handlers[event] = handler; },
    quit() { this.quitCalls += 1; },
  };
  return { app, handlers };
}

function register(app) {
  return registerLifecycle({
    app,
    BrowserWindow: {},
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    container: {
      sessionMemoryStore: () => ({ flush: async () => {} }),
      contextCompiler: { flush: async () => {} },
    },
    createWindow() { return { isDestroyed: () => false, show() {}, focus() {} }; },
    createApplicationMenu() {},
  });
}

test("normal quit flushes durable state then quits once", async () => {
  setAllowImmediateQuit(false);
  const { app, handlers } = createAppHarness();
  register(app);
  const event = { preventDefault() { this.prevented = true; } };
  handlers["before-quit"](event);
  assert.equal(event.prevented, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.quitCalls, 1);
});

test("update install quit is not cancelled by the shutdown flush", async () => {
  setAllowImmediateQuit(true);
  const { app, handlers } = createAppHarness();
  register(app);
  const event = { preventDefault() { this.prevented = true; } };
  handlers["before-quit"](event);
  assert.equal(event.prevented, undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.quitCalls, 0);
});
