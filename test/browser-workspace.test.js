"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const load = () => import("../src/ui/features/browser/browser-workspace.js");
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeTab = (id, extra = {}) => ({ id, projectId: "project", purpose: "assessment", identityId: null, owner: { kind: "human" }, operation: { status: "idle" }, controlGeneration: 0, documentVersion: 0, viewportRevision: 0, url: "about:blank", title: "", status: "ready", ...extra });

async function setup(t, initial = []) {
  const { createBrowserWorkspace } = await load();
  const dom = new JSDOM('<main id="editor-pane"></main><div id="overlay" role="dialog" aria-modal="true" hidden></div>', { pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  let project = "G:/project", chat = "chat-a", tabs = initial, listener;
  const calls = [], layouts = [], frames = new Map(); let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const api = {
    browserHide() { calls.push(["hide"]); },
    browserList(input) { calls.push(["list", input]); return Promise.resolve({ ok: true, tabs, identities: [{ identityId: "admin", name: "Admin <script>" }] }); },
    browserOpen(input) { calls.push(["open", input]); const tab = makeTab(`tab-${tabs.length + 1}`, { purpose: input.purpose, identityId: input.identityId, url: input.url }); tabs = [...tabs, tab]; return Promise.resolve({ ok: true, tab, tabs }); },
    browserCommand(input) {
      calls.push(["command", input]);
      let tab = tabs.find(item => item.id === input.tabId);
      if (input.command === "close") tabs = tabs.filter(item => item.id !== input.tabId);
      else {
        tab = { ...tab, ...(input.command === "navigate" ? { url: input.url } : {}), ...(["handoff", "takeover"].includes(input.command) ? { owner: input.command === "takeover" ? { kind: "human" } : { kind: "chat", sessionId: input.sessionId }, controlGeneration: tab.controlGeneration + 1 } : {}) };
        tabs = tabs.map(item => item.id === tab.id ? tab : item);
      }
      return Promise.resolve({ ok: true, tab: input.command === "close" ? undefined : tab, tabs });
    },
    browserLayout(input) { layouts.push(input); return Promise.resolve({ ok: true }); },
    onBrowserEvent(callback) { listener = callback; return () => { listener = null; }; },
  };
  const controller = createBrowserWorkspace({ document, api, host: document.querySelector("main"), getAssessmentPath: () => project, getSessionId: () => chat });
  const viewport = controller.root.querySelector(".browser-viewport");
  viewport.getBoundingClientRect = () => ({ x: 120, y: 160, left: 120, top: 160, width: 700, height: 500, right: 820, bottom: 660 });
  t.after(() => { controller.dispose(); dom.window.close(); });
  const flush = async () => { await tick(); const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); await tick(); };
  return { controller, document, window, api, calls, layouts, flush, event: value => listener?.(value), setProject(value) { project = value; }, setChat(value) { chat = value; controller.chatChanged(); }, tabs: () => tabs };
}

test("addresses accept local hosts and HTTP(S), and reject non-browser protocols", async () => {
  const { normalizeBrowserAddress } = await load();
  assert.equal(normalizeBrowserAddress("example.com/path"), "https://example.com/path");
  assert.equal(normalizeBrowserAddress("localhost:8080/test"), "https://localhost:8080/test");
  assert.equal(normalizeBrowserAddress("http://127.0.0.1:8080/"), "http://127.0.0.1:8080/");
  assert.equal(normalizeBrowserAddress(""), "about:blank");
  assert.throws(() => normalizeBrowserAddress("javascript:alert(1)"), /HTTP or HTTPS/);
  assert.throws(() => normalizeBrowserAddress("file:///C:/secret"), /HTTP or HTTPS/);
});

test("the browser opens and navigates a native tab with current project and chat", async t => {
  const env = await setup(t);
  env.controller.setVisible(true); await env.flush();
  await env.controller.open({ identityId: "admin" }); await env.flush();
  assert.deepEqual(env.calls.find(([name]) => name === "open")[1], { assessmentPath: "G:/project", purpose: "assessment", identityId: "admin", url: "about:blank", sessionId: "chat-a" });
  assert.equal(env.document.querySelector('[role="tab"]').textContent, "New tab");
  assert.equal(env.document.querySelector("iframe, webview"), null);
  assert.equal(env.document.querySelector(".browser-context").getAttribute("aria-label"), "Assessment · Admin <script>");
  const address = env.document.querySelector(".browser-address"); address.value = "example.com/path";
  env.document.querySelector(".browser-navigation").dispatchEvent(new env.window.Event("submit", { bubbles: true, cancelable: true }));
  await env.flush();
  assert.equal(env.calls.find(([name, input]) => name === "command" && input.command === "navigate")[1].url, "https://example.com/path");
  assert.equal(env.tabs()[0].url, "https://example.com/path");
  assert.deepEqual(env.layouts.at(-1).bounds, { x: 120, y: 160, width: 700, height: 500 });
});

test("new research tabs discard assessment identity and existing pages retain their identity", async t => {
  const env = await setup(t, [makeTab("original", { identityId: "admin" })]);
  env.controller.setVisible(true); await env.flush();
  env.document.querySelector("[data-browser-new-toggle]").click();
  const identity = env.document.querySelector('[aria-label="New tab identity"]'); identity.value = "admin";
  const purpose = env.document.querySelector('[aria-label="New tab purpose"]'); purpose.value = "research";
  purpose.dispatchEvent(new env.window.Event("change"));
  assert.equal(identity.disabled, true);
  env.document.querySelector(".browser-new-page").dispatchEvent(new env.window.Event("submit", { bubbles: true, cancelable: true }));
  await env.flush();
  assert.equal(env.tabs()[0].identityId, "admin");
  assert.equal(env.tabs()[1].identityId, null);
  assert.equal(env.tabs()[1].purpose, "research");
  assert.equal(env.document.querySelectorAll('[role="tab"]').length, 2);
  env.document.querySelector('[data-browser-tab="original"]').click();
  assert.match(env.document.querySelector(".browser-context").getAttribute("aria-label"), /Admin/);
});

test("the control switch takes over, resumes, and binds to the current chat and latest generation", async t => {
  const env = await setup(t, [makeTab("controlled", { owner: { kind: "chat", sessionId: "chat-a" }, controlGeneration: 4 })]);
  env.controller.setVisible(true); await env.flush();
  const control = () => env.document.querySelector("[data-browser-control]");
  assert.equal(control().getAttribute("aria-pressed"), "true");
  assert.equal(control().getAttribute("aria-label"), "Take over");
  control().click(); await env.flush();
  assert.equal(control().getAttribute("aria-pressed"), "false");
  assert.equal(control().getAttribute("aria-label"), "Resume");
  assert.equal(env.calls.find(([name]) => name === "command")[1].expectedGeneration, 4);
  control().click(); await env.flush();
  assert.deepEqual(env.tabs()[0].owner, { kind: "chat", sessionId: "chat-a" });
  assert.equal(env.calls.filter(([name]) => name === "command").at(-1)[1].expectedGeneration, 5);
  env.setChat("chat-b");
  assert.match(control().title, /^Another chat controls this tab\. Take over\.$/);
  control().click(); await env.flush();
  assert.deepEqual(env.tabs()[0].owner, { kind: "human" });
  assert.equal(control().getAttribute("aria-label"), "Use in current chat");
  control().click(); await env.flush();
  assert.deepEqual(env.tabs()[0].owner, { kind: "chat", sessionId: "chat-b" });
});

test("native views hide for app dialogs and inactive workspaces, then restore on focus", async t => {
  const env = await setup(t, [makeTab("page")]);
  env.controller.setVisible(true); await env.flush();
  assert.equal(env.layouts.length, 1);
  const overlay = env.document.querySelector("#overlay"); overlay.hidden = false; await env.flush();
  assert.equal(env.calls.at(-1)[0], "hide");
  overlay.hidden = true; await env.flush();
  assert.equal(env.layouts.length, 2);
  env.window.dispatchEvent(new env.window.Event("focus")); await env.flush();
  assert.equal(env.layouts.length, 3);
  env.controller.setVisible(false); await env.flush();
  assert.equal(env.calls.at(-1)[0], "hide");
  assert.equal(env.controller.root.hidden, true);
  env.controller.setVisible(true); await env.flush();
  assert.equal(env.layouts.at(-1).tabId, "page");
});

test("closing selected pages selects the remaining page and an empty browser hides the view", async t => {
  const env = await setup(t, [makeTab("a", { title: "First" }), makeTab("b", { title: "Second" })]);
  env.controller.setVisible(true); await env.flush();
  env.document.querySelector('[data-browser-tab="b"]').click(); await env.flush();
  assert.equal(env.layouts.at(-1).tabId, "b");
  env.document.querySelector('[aria-label="Close Second"]').click(); await env.flush();
  assert.equal(env.layouts.at(-1).tabId, "a");
  assert.equal(env.document.querySelector(".browser-toolbar").hidden, false);
  env.document.querySelector('[aria-label="Close First"]').click(); await env.flush();
  assert.equal(env.document.querySelector(".browser-empty").hidden, false);
  assert.equal(env.document.querySelector(".browser-tabbar").hidden, true, "no tab strip without a page");
  assert.equal(env.document.querySelector(".browser-toolbar").hidden, true, "no address bar without a page");
  assert.equal(env.calls.at(-1)[0], "hide");
});

test("navigation events preserve address edits and reject results from the previous project", async t => {
  const env = await setup(t, [makeTab("a")]);
  env.controller.setVisible(true); await env.flush();
  const address = env.document.querySelector(".browser-address"); address.focus(); address.value = "unfinished.example";
  env.event({ type: "updated", tab: makeTab("a", { title: "New title", status: "loading", url: "https://loaded.example/" }) });
  assert.equal(address.value, "unfinished.example");
  assert.match(env.document.querySelector('[role="tab"]').textContent, /New title/);
  let finish;
  env.api.browserList = () => new Promise(resolve => { finish = resolve; });
  const refresh = env.controller.refresh();
  env.api.browserList = async () => ({ ok: true, tabs: [], identities: [] });
  env.setProject("G:/other"); env.controller.projectChanged();
  finish({ ok: true, tabs: [makeTab("old-project")], identities: [] });
  await refresh; await env.flush();
  assert.equal(env.document.querySelector('[data-browser-tab="old-project"]'), null);
});
