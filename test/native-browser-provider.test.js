"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createBrowserTab, validateBrowserContract } = require("../src/contracts/browser/browser-contracts.js");
const { boundObservation, createBrowserObservations, OBSERVATION_LIMIT } = require("../src/app/services/browser/browser-observation.js");
const { createNativeBrowserProvider, normalizeBrowserInput, workspaceUploadPaths } = require("../src/app/services/browser/native-browser-provider.js");

function fixture(owner = { kind: "chat", sessionId: "chat-one" }) {
  const tab = createBrowserTab({ id: "tab-one", projectId: "project-one", purpose: "research" }); tab.owner = owner;
  const actions = [];
  const page = { frames: () => [], url: () => "about:blank", title: async () => "Fixture", on() {}, off() {},
    mouse: { move: async (...args) => actions.push(["move", ...args]), click: async (...args) => actions.push(["click", ...args]), wheel: async (...args) => actions.push(["wheel", ...args]) },
    keyboard: { insertText: async text => actions.push(["text", text]), press: async key => actions.push(["key", key]) },
    goto: async url => actions.push(["goto", url]), waitForTimeout: async time => actions.push(["wait", time]) };
  let calls = 0;
  const service = { list: () => [structuredClone(tab)], status: () => ({ projectId: tab.projectId }),
    withPage: async (_id, _chat, _generation, task) => { calls++; return task(page); },
    close: async () => { actions.push(["closed"]); },
  };
  const provider = createNativeBrowserProvider({ getService: () => service });
  return { tab, page, service, actions, provider, calls: () => calls };
}
const context = { sessionId: "runtime-one", browserSessionId: "chat-one", workspace: process.cwd() };

test("native provider lists project tabs but cannot drive or close a human tab", async () => {
  const f = fixture({ kind: "human" });
  assert.equal((await f.provider.execute({ action: "list_pages" }, context)).tabs[0].id, "tab-one");
  for (const action of ["observe", "close_page"]) await assert.rejects(f.provider.execute({ action, tabId: "tab-one" }, context), { code: "BROWSER_TAB_NOT_OWNED" });
  assert.equal(f.calls(), 0); assert.deepEqual(f.actions, []);
});

test("native provider derives omitted tab only from uniquely owned chat tab", async () => {
  const f = fixture();
  await f.provider.execute({ action: "press_key", key: "Tab" }, context);
  assert.deepEqual(f.actions, [["key", "Tab"]]);
  assert.equal(f.calls(), 1);
  f.service.list = () => [f.tab, { ...f.tab, id: "tab-two" }];
  await assert.rejects(f.provider.execute({ action: "observe" }, context), { code: "BROWSER_TAB_REQUIRED" });
});

test("native provider checks canonical input before dispatching browser commands", async () => {
  const f = fixture();
  await assert.rejects(f.provider.execute({ action: "navigate", tabId: "tab-one", url: "file:///secret" }, context), { code: "BROWSER_CONTRACT_INVALID" });
  await assert.rejects(f.provider.execute({ action: "scroll", deltaX: 0, deltaY: Infinity }, context), { code: "BROWSER_CONTRACT_INVALID" });
  assert.equal(f.calls(), 0);
  await f.provider.execute({ action: "navigate", url: "https://example.test/" }, context);
  assert.deepEqual(f.actions, [["goto", "https://example.test/"]]);
});

test("screenshots fail closed without selected model vision validation", async () => {
  const f = fixture();
  await assert.rejects(f.provider.execute({ action: "screenshot" }, context), { code: "BROWSER_VISION_UNAVAILABLE" });
  assert.equal(f.calls(), 0);
  let verified = false;
  const provider = createNativeBrowserProvider({ getService: () => f.service, visual: { capture: async () => { assert.equal(verified, true); return { id: "screenshot-one" }; } } });
  const result = await provider.execute({ action: "screenshot" }, context, { assertVision: async () => { verified = true; } });
  assert.equal(result.screenshot.id, "screenshot-one"); assert.equal(result.projectId, "project-one");
});

test("legacy browser spellings normalize to element targets and select text", () => {
  const input = normalizeBrowserInput({ action: "select", pageId: "page-one", selector: "#role", option: "Admin" });
  assert.equal(input.tabId, "page-one"); assert.equal(input.text, "Admin"); assert.deepEqual(input.target, { kind: "selector", selector: "#role" });
});

test("bounded observations remain valid JSON and keep only included frame references", () => {
  const full = { id: "obs-one", tabId: "tab-one", documentVersion: 1, viewportRevision: 2, url: "https://example.test/", title: "Fixture", text: "x".repeat(100000), truncated: false,
    frames: Array.from({ length: 100 }, (_, i) => ({ id: `frame-${i}`, url: "https://example.test/" + "x".repeat(1000) })),
    elements: Array.from({ length: 300 }, (_, i) => ({ ref: `ref-${i}`, frameId: `frame-${i % 100}`, role: "button", name: "x".repeat(500) })), artifactIds: [] };
  const bounded = boundObservation(full);
  assert.ok(JSON.stringify(bounded).length <= OBSERVATION_LIMIT);
  assert.equal(validateBrowserContract("observation", bounded).ok, true);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.elements.every(element => bounded.frames.some(frame => frame.id === element.frameId)));
});

test("an old observation cannot act after document or viewport changes", async () => {
  const f = fixture(), store = createBrowserObservations();
  const observation = await store.capture(f.page, f.tab);
  await assert.rejects(store.resolve({ kind: "element", observationId: observation.id, ref: "frame-0-e1" }, f.page, { ...f.tab, documentVersion: 1 }), { code: "BROWSER_OBSERVATION_STALE" });
  await assert.rejects(store.resolve({ kind: "element", observationId: observation.id, ref: "frame-0-e1" }, f.page, { ...f.tab, viewportRevision: 1 }), { code: "BROWSER_OBSERVATION_STALE" });
});

test("workspace uploads resolve existing regular files and reject traversal", async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "xekute-upload-")); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project"); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "file.txt"), "fixture"); await fs.writeFile(path.join(temp, "outside.txt"), "outside");
  // Uploads resolve real paths. Compare against the real path too: a temp
  // folder can be reported in 8.3 short form (C:\Users\RUNNER~1 on CI).
  assert.deepEqual(await workspaceUploadPaths(root, ["file.txt"]), [await fs.realpath(path.join(root, "file.txt"))]);
  await assert.rejects(workspaceUploadPaths(root, ["../outside.txt"]), { code: "BROWSER_UPLOAD_OUTSIDE_WORKSPACE" });
  await assert.rejects(workspaceUploadPaths(root, ["."]), { code: "BROWSER_UPLOAD_OUTSIDE_WORKSPACE" });
});

test("coordinate actions use the captured screenshot mapping before mouse dispatch", async () => {
  const f = fixture(), seen = [];
  const provider = createNativeBrowserProvider({ getService: () => f.service, visual: { resolve: async (target, _page, tab) => { seen.push([target.screenshotId, tab.id]); return { x: 10, y: 20 }; }, pointer: async (_page, point) => seen.push(point) } });
  await provider.execute({ action: "click", target: { kind: "point", screenshotId: "screenshot-one", x: 20, y: 40 } }, context);
  assert.deepEqual(f.actions, [["move", 10, 20], ["click", 10, 20]]);
  assert.deepEqual(seen[0], ["screenshot-one", "tab-one"]);
});

test("stop during new-tab creation closes only that tab without handing it over", async () => {
  const f = fixture(), controller = new AbortController(), commands = [];
  f.service.open = async input => { commands.push(["open", input.url]); controller.abort(); return f.tab; };
  f.service.handoff = async () => { commands.push(["handoff"]); return f.tab; };
  f.service.close = async id => commands.push(["close", id]);
  await assert.rejects(f.provider.execute({ action: "open_page", purpose: "research", url: "https://example.test/slow" }, context, { signal: controller.signal }), { code: "BROWSER_ACTION_STOPPED" });
  assert.deepEqual(commands, [["open", "about:blank"], ["close", "tab-one"]]);
  assert.equal(f.calls(), 0);
});

test("a canceled vision metadata request reports stopped and never captures", async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(f.provider.execute({ action: "screenshot" }, context, { signal: controller.signal, assertVision: async () => {
    controller.abort(); throw Object.assign(new Error("metadata unavailable"), { code: "BROWSER_VISION_UNAVAILABLE" });
  } }), { code: "BROWSER_ACTION_STOPPED" });
  assert.equal(f.calls(), 0);
});

test("node reference resolver cannot be replaced and refresh forgets the old snapshot", async () => {
  const node = { tagName: "BUTTON", innerText: "Activate fixture", isConnected: true,
    getAttribute: () => null, closest: () => null, getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  const sandbox = vm.createContext({ document: { body: { innerText: "Fixture text" }, querySelectorAll: () => [node], getElementById: () => null }, getComputedStyle: () => ({ visibility: "visible", display: "block" }) });
  vm.runInContext("window = globalThis", sandbox);
  const evaluate = (fn, argument) => { sandbox.args = argument; return vm.runInContext(`(${fn.toString()})(args)`, sandbox); };
  const frame = { evaluate, url: () => "https://example.test/", evaluateHandle: async (fn, argument) => {
    const result = evaluate(fn, argument);
    return { asElement: () => result ? { node: result, dispose: async () => {} } : null, dispose: async () => {} };
  } };
  const f = fixture(), page = { ...f.page, frames: () => [frame], isClosed: () => false }, observations = createBrowserObservations();
  const first = await observations.capture(page, f.tab);
  assert.equal(first.elements[0].name, "Activate fixture");
  const key = vm.runInContext("Object.getOwnPropertyNames(window).find(key => key.startsWith('__xekuteRefs_'))", sandbox);
  sandbox.key = key;
  assert.equal(vm.runInContext("Reflect.set(window, key, () => null)", sandbox), false);
  assert.equal(vm.runInContext("delete window[key]", sandbox), false);
  assert.equal(vm.runInContext("window[key]('replace', 'wrong-capability', 'forged', null, new Map())", sandbox), null);
  const target = { kind: "element", observationId: first.id, ref: first.elements[0].ref };
  assert.equal((await observations.resolve(target, page, f.tab)).node, node);
  const second = await observations.capture(page, f.tab);
  await assert.rejects(observations.resolve(target, page, f.tab), { code: "BROWSER_OBSERVATION_STALE" });
  node.isConnected = false;
  await assert.rejects(observations.resolve({ ...target, observationId: second.id }, page, f.tab), { code: "BROWSER_OBSERVATION_STALE" });
});

test("a pending dialog keeps its listener until native ownership takes over", async () => {
  const f = fixture(), events = new EventEmitter();
  let pending = null;
  f.page.on = events.on.bind(events);
  f.page.off = (event, listener) => { pending = null; events.off(event, listener); };
  f.service.getDialog = () => pending;
  f.page.mouse.click = async () => { pending = { type: "confirm", message: "Continue fixture?" }; events.emit("dialog", pending); return new Promise(() => {}); };
  const provider = createNativeBrowserProvider({ getService: () => f.service, visual: { resolve: async () => ({ x: 10, y: 20 }) } });
  const result = await provider.execute({ action: "click", target: { kind: "point", screenshotId: "screenshot-one", x: 10, y: 20 } }, context);
  assert.equal(result.dialog.type, "confirm");
  assert.equal(events.listenerCount("dialog"), 1);
  assert.equal(pending.message, "Continue fixture?");
});

test("close uses the current chat and generation in the native atomic operation", async () => {
  const f = fixture();
  f.tab.controlGeneration = 7;
  f.service.closeOwned = async (...args) => f.actions.push(["closeOwned", ...args]);
  const result = await f.provider.execute({ action: "close_page", tabId: "tab-one" }, context);
  assert.equal(result.closed, true);
  assert.deepEqual(f.actions, [["closeOwned", "tab-one", "chat-one", 7, { signal: undefined }]]);
});

test("native provider refuses an approved action when the tab changed while approval was pending", async () => {
  const f = fixture();
  f.tab.url = "https://app.example.com/cart";
  const checked = { id: "tab-one", controlGeneration: f.tab.controlGeneration, url: "https://app.example.com/start" };
  await f.provider.execute({ action: "press_key", tabId: "tab-one", key: "Tab" }, context, { expectedTab: checked });
  assert.deepEqual(f.actions, [["key", "Tab"]]);
  await assert.rejects(f.provider.execute({ action: "press_key", tabId: "tab-one", key: "Tab" }, context, { expectedTab: { ...checked, url: "https://unrelated.test/" } }), { code: "BROWSER_SCOPE_CHANGED" });
  await assert.rejects(f.provider.execute({ action: "press_key", tabId: "tab-one", key: "Tab" }, context, { expectedTab: { ...checked, controlGeneration: checked.controlGeneration - 1 } }), { code: "BROWSER_SCOPE_CHANGED" });
  assert.deepEqual(f.actions, [["key", "Tab"]]);
});
