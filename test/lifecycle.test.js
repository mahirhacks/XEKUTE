"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerLifecycle, setAllowImmediateQuit, prepareForUpdateInstall, APP_USER_MODEL_ID } = require("../src/app/electron/lifecycle.js");

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

function register(app, container = {}) {
  return registerLifecycle({
    app,
    BrowserWindow: {},
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    container: {
      sessionMemoryStore: () => ({ flush: async () => {} }),
      contextCompiler: { flush: async () => {} },
      ...container,
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

test("update install shuts down once before the installer, then quits without blocking", async () => {
  setAllowImmediateQuit(false);
  const { app, handlers } = createAppHarness();
  const calls = [];
  register(app, {
    v3SessionStore: { flush: async () => { calls.push("chat.flush"); } },
    dispose: async () => { calls.push("dispose"); },
  });
  await prepareForUpdateInstall();
  await prepareForUpdateInstall();
  assert.deepEqual(calls, ["chat.flush", "dispose"]);
  setAllowImmediateQuit(true);
  const event = { preventDefault() { this.prevented = true; } };
  handlers["before-quit"](event);
  assert.equal(event.prevented, undefined);
  assert.deepEqual(calls, ["chat.flush", "dispose"]);
  setAllowImmediateQuit(false);
});

test("a quit during an in-flight update shutdown waits for it instead of exiting mid-flush", async () => {
  setAllowImmediateQuit(false);
  const { app, handlers } = createAppHarness();
  let release;
  register(app, { dispose: () => new Promise((resolve) => { release = resolve; }) });
  const preparing = prepareForUpdateInstall();
  const event = { preventDefault() { this.prevented = true; } };
  handlers["before-quit"](event);
  assert.equal(event.prevented, true);
  assert.equal(app.quitCalls, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await preparing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.quitCalls, 1);
});

test("the runtime AppUserModelID matches the installer appId", () => {
  assert.equal(APP_USER_MODEL_ID, require("../electron-builder.config.js").appId);
});

