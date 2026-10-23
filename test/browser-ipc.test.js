"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerBrowserIpc } = require("../src/app/ipc/browser.js");
const { validateIpcRequest } = require("../src/contracts/ipc/IpcContracts.js");
const { registerProjectIpc } = require("../src/app/ipc/project.js");

function setup() {
  const handlers = new Map(), calls = [], tabs = [];
  let projectId = null, proxyStatus = { running: false };
  const workspace = path.resolve("test-browser-project"), other = path.resolve("other-browser-project");
  const shell = { isDestroyed: () => false, mainFrame: {} };
  const window = { isDestroyed: () => false, webContents: shell };
  const event = { sender: shell, senderFrame: shell.mainFrame };
  const listener = {
    getStatus: () => proxyStatus,
    clearError: () => (proxyStatus = { ...proxyStatus, error: "" }),
    configure: async (workspace, input) => { calls.push(["configure", workspace, input]); proxyStatus = { running: true, assessmentPath: workspace }; return proxyStatus; },
  };
  const service = {
    activateProject: async (input, prepare) => {
      if (projectId === input.id) return;
      calls.push(["closePrevious", projectId]); tabs.length = 0;
      if (prepare) await prepare();
      projectId = input.id;
    },
    open: async input => { const tab = { id: `tab-${tabs.length + 1}`, projectId, generation: 0, ...input }; tabs.push(tab); return tab; },
    status: () => ({ projectId }), list: () => structuredClone(tabs),
    navigate: async (id, url) => { tabs.find(tab => tab.id === id).url = url; },
    back: async id => calls.push(["back", id]), forward: async id => calls.push(["forward", id]), reload: async id => calls.push(["reload", id]),
    handoff: async (...args) => calls.push(["handoff", ...args]), takeover: async (...args) => calls.push(["takeover", ...args]),
    close: async id => tabs.splice(tabs.findIndex(tab => tab.id === id), 1),
    layout: (id, bounds) => { calls.push(["layout", id, bounds]); return tabs.find(tab => tab.id === id); },
    select: id => calls.push(["select", id]), hide: () => calls.push(["hide"]),
    snapshot: async id => { calls.push(["snapshot", id]); return tabs.some(tab => tab.id === id) ? "data:image/png;base64,ZnJvemVu" : null; },
  };
  const container = {
    activateNativeBrowser: async (workspace, purpose) => {
      const prepare = async () => { if (proxyStatus.running && proxyStatus.assessmentPath === workspace) return; await listener.configure(workspace, { settings: { listener: { enabled: true } }, targets: ["example.test"] }); };
      await service.activateProject({ id: workspace, workspace }, purpose === "assessment" ? prepare : null);
      if (purpose === "assessment") await prepare();
      return service;
    },
    nativeBrowser: () => service, hideNativeBrowser: () => service.hide(), getProxyListener: () => listener,
    proxyBrowser: { status: () => ({ running: false }) },
    identityVault: () => ({ projectIdFor: workspace => workspace, list: () => ({ ok: true, value: { identities: [{ identityId: "user-a", displayName: "User A" }] } }) }),
  };
  registerBrowserIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, container, getMainWindow: () => window });
  return { workspace, other, calls, service, handlers, event, request: (channel, payload) => handlers.get(channel)(event, payload) };
}

test("browser IPC opens assessment tabs only after old views close and capture is prepared", async () => {
  const host = setup();
  const result = await host.request("browser:open", { assessmentPath: host.workspace, purpose: "assessment", identityId: "user-a", url: "https://example.test" });
  assert.equal(result.ok, true);
  assert.equal(result.tab.identityId, "user-a");
  assert.deepEqual(result.identities, [{ identityId: "user-a", displayName: "User A" }]);
  assert.equal(host.calls[0][0], "closePrevious");
  assert.equal(host.calls[1][0], "configure");
  assert.equal(host.calls[1][2].settings.listener.enabled, true);
  assert.deepEqual(host.calls[1][2].targets, ["example.test"]);
  const research = await host.request("browser:open", { assessmentPath: host.other, purpose: "research" });
  assert.equal(research.ok, true);
  assert.equal(research.tabs.length, 1);
  assert.equal(host.calls.filter(call => call[0] === "configure").length, 1);
});

test("browser IPC rejects target pages, shell subframes, forged fields, and invalid URLs before creating tabs", async () => {
  const host = setup();
  const payload = { assessmentPath: host.workspace, purpose: "research" };
  const handler = host.handlers.get("browser:open");
  assert.equal((await handler({ sender: { ...host.event.sender }, senderFrame: host.event.senderFrame }, payload)).error.code, "UNTRUSTED_RENDERER");
  assert.equal((await handler({ ...host.event, senderFrame: {} }, payload)).error.code, "UNTRUSTED_RENDERER");
  for (const extra of [{ identityId: "user-a" }, { url: "file:///C:/secret" }, { ownerId: "forged" }]) {
    assert.equal((await host.request("browser:open", { ...payload, ...extra })).error.code, "INVALID_IPC_PAYLOAD");
  }
  assert.equal(host.calls.length, 0);
  assert.equal(validateIpcRequest("browser:layout", [{ assessmentPath: host.workspace, tabId: "tab", bounds: { x: 0, y: 0, width: NaN, height: 1 }, visible: true }]).code, "INVALID_IPC_PAYLOAD");
});

test("browser IPC routes bounded layout, explicit ownership, history and project-safe navigation", async () => {
  const host = setup();
  await host.request("browser:open", { assessmentPath: host.workspace, purpose: "research" });
  const common = { assessmentPath: host.workspace, tabId: "tab-1" };
  assert.equal((await host.request("browser:command", { ...common, command: "navigate", url: "https://example.test/next" })).tab.url, "https://example.test/next");
  for (const command of ["back", "forward", "reload"]) assert.equal((await host.request("browser:command", { ...common, command })).ok, true);
  assert.equal((await host.request("browser:command", { ...common, command: "handoff", sessionId: "chat-1", expectedGeneration: 0 })).ok, true);
  assert.deepEqual(host.calls.find(call => call[0] === "handoff"), ["handoff", "tab-1", "chat-1", 0]);
  assert.equal((await host.request("browser:command", { ...common, command: "takeover", expectedGeneration: 0 })).ok, true);
  const bounds = { x: 10, y: 100, width: 640, height: 480 };
  assert.equal((await host.request("browser:layout", { ...common, bounds, visible: true })).ok, true);
  assert.deepEqual(host.calls.find(call => call[0] === "layout"), ["layout", "tab-1", bounds]);
  assert.equal((await host.request("browser:command", { ...common, assessmentPath: host.other, command: "reload" })).error.code, "BROWSER_PROJECT_MISMATCH");
  assert.equal((await host.request("browser:hide", {})).ok, true);
  const snap = await host.request("browser:capture", { ...common });
  assert.equal(snap.ok, true);
  assert.match(snap.dataUrl, /^data:image\/png/);
  assert.deepEqual(host.calls.find(call => call[0] === "snapshot"), ["snapshot", "tab-1"]);
  assert.equal((await host.request("browser:capture", { assessmentPath: host.other, tabId: "tab-1" })).error.code, "BROWSER_PROJECT_MISMATCH");
  assert.equal((await host.request("browser:capture", { ...common, tabId: "ghost" })).error.code, "BROWSER_TAB_UNAVAILABLE");
  assert.equal((await host.request("browser:command", { ...common, command: "close" })).tabs.length, 0);
});

test("a pending navigation does not prevent a browser tab from closing", async () => {
  const host = setup();
  await host.request("browser:open", { assessmentPath: host.workspace, purpose: "research" });
  let release;
  host.service.navigate = () => new Promise(resolve => { release = resolve; });
  const common = { assessmentPath: host.workspace, tabId: "tab-1" };
  const pending = host.request("browser:command", { ...common, command: "navigate", url: "https://example.test" });
  await new Promise(resolve => setImmediate(resolve));
  const result = await host.request("browser:command", { ...common, command: "close" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tabs, []);
  release(); await pending;
});

test("existing proxy configuration closes native views before moving the shared listener", async () => {
  const handlers = new Map(), calls = [];
  let configuredScope;
  const oldProject = path.resolve("old-browser-project"), nextProject = path.resolve("next-browser-project");
  registerProjectIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: () => {} },
    app: { getPath: () => path.resolve("unused-test-home") }, getMainWindow: () => null,
    container: { closeNativeBrowserProject: async () => calls.push("closeNative"), proxyBrowser: { status: () => ({ running: false }) } },
    proxyListener: { getStatus: () => ({ running: true, assessmentPath: oldProject, host: "127.0.0.1", port: 8080 }), configure: async (_workspace, options) => { calls.push("configure"); configuredScope = options; return { running: true }; } },
    readProjectProfile: () => ({ profile: { scope: { inScopeTargets: [], wildcardRules: ["*.example.test"], outOfScopeTargets: ["blocked.example.test"] } } }),
    effectiveOperatorRuntimeSettings: () => ({ listener: { enabled: true, bindAddress: "127.0.0.1", port: 8080 } }),
  });
  await handlers.get("proxy:configure")({}, { assessmentPath: nextProject });
  assert.deepEqual(calls, ["closeNative", "configure"]);
  assert.deepEqual(configuredScope.targets, []);
  assert.deepEqual(configuredScope.wildcardRules, ["*.example.test"]);
  assert.deepEqual(configuredScope.excludedTargets, ["blocked.example.test"]);
});

test("a newer proxy configuration supersedes a request waiting for browser cleanup", async () => {
  const handlers = new Map(), configureCalls = [];
  const projectA = path.resolve("proxy-project-A"), projectB = path.resolve("proxy-project-B");
  let activeProject = projectB;
  let releaseClose, startedClose;
  const closeGate = new Promise(resolve => { releaseClose = resolve; });
  const closeStarted = new Promise(resolve => { startedClose = resolve; });
  const proxyStatus = () => ({ running: true, assessmentPath: activeProject, host: "127.0.0.1", port: 8080 });
  registerProjectIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: () => {} },
    app: { getPath: () => path.resolve("unused-test-home") }, getMainWindow: () => null,
    container: {
      closeNativeBrowserProject: async () => { startedClose(); await closeGate; },
      proxyBrowser: { status: () => ({ running: false }) },
    },
    proxyListener: {
      getStatus: proxyStatus,
      configure: async workspace => {
        configureCalls.push(workspace);
        activeProject = workspace;
        return proxyStatus();
      },
    },
    readProjectProfile: () => ({}),
    effectiveOperatorRuntimeSettings: () => ({ listener: { enabled: true, bindAddress: "127.0.0.1", port: 8080 } }),
  });

  const configureA = handlers.get("proxy:configure")({}, { assessmentPath: projectA });
  await closeStarted;
  const configureB = handlers.get("proxy:configure")({}, { assessmentPath: projectB });
  releaseClose();
  await Promise.all([configureA, configureB]);

  assert.deepEqual(configureCalls, [projectB]);
  assert.equal(activeProject, projectB);
});

test("identity deletion closes native authenticated sessions before removing their vault record", async () => {
  const handlers = new Map(), calls = [];
  registerProjectIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: () => {} },
    app: { getPath: () => path.resolve("unused-test-home") }, getMainWindow: () => null,
    container: {
      closeNativeBrowserIdentity: async (...args) => calls.push(["closeNative", ...args]),
      browserSessionManager: { closeIdentity: async () => calls.push(["closeLegacy"]) },
      proxyBrowser: { close: async () => calls.push(["closeExternal"]) },
      identityVault: () => ({ remove: () => { calls.push(["remove"]); return { ok: false, error: "Synthetic deletion rejected" }; } }),
    },
  });
  const workspace = path.resolve("browser-project");
  const result = await handlers.get("settings:identityDelete")({}, { workspace, identityId: "user-a" });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [["closeNative", workspace, "user-a"], ["closeLegacy"], ["closeExternal"], ["remove"]]);
});
