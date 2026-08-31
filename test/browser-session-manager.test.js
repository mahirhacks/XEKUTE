"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowserSessionManager } = require("../src/agent/tools/assessment/browser-session-manager.js");

class FakePage {
  constructor() { this.currentUrl = "about:blank"; this.html = ""; this.closed = false; }
  isClosed() { return this.closed; }
  url() { return this.currentUrl; }
  async goto(url) { this.currentUrl = String(url); }
  async title() { return "Fixture"; }
  async content() { return this.html; }
  async close() { this.closed = true; }
}

class FakeContext {
  constructor(storageState) { this.storage = storageState || { cookies: [], origins: [] }; this.pages = []; this.closed = false; }
  async route(_pattern, handler) { this.routeHandler = handler; }
  async newPage() { const page = new FakePage(); this.pages.push(page); return page; }
  async storageState() { return this.storage; }
  async close() { this.closed = true; for (const page of this.pages) await page.close(); }
}

class FakeBrowser {
  constructor(contextClass = FakeContext) { this.contexts = []; this.contextClass = contextClass; this.closed = false; }
  async newContext(options = {}) { const context = new this.contextClass(options.storageState); this.contexts.push(context); return context; }
  async close() { this.closed = true; for (const context of this.contexts) await context.close(); }
}

function setup() {
  const browsers = [];
  const chromium = { launch: async () => { const browser = new FakeBrowser(); browsers.push(browser); return browser; } };
  const env = { LOCALAPPDATA: "C:\\Local", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };
  const fs = { existsSync: (file) => /msedge\.exe$/i.test(file) };
  const identities = {
    readSecret: (_workspace, identityId) => ({ ok: true, secret: { storageState: { cookies: [{ name: "session", value: identityId, domain: "fixture.test", path: "/" }], origins: [] }, headerBindings: [] } }),
    saveSecret: () => ({ ok: true }),
  };
  const manager = createBrowserSessionManager({ chromium, fs, env, identityVault: identities, beforeNavigation: async () => ({ ok: true }) });
  return { manager, browsers };
}

function context(workspace, sessionId, identityId = "", pageId = "main") {
  return { workspace: { root: workspace }, sessionId, identityContext: { identityId, pageId } };
}

test("browser manager isolates chat pages while sharing one identity context", async () => {
  const { manager, browsers } = setup();
  try {
    const workspace = "C:\\project";
    await manager.execute({ action: "navigate", identityId: "account-a", pageId: "main", url: "https://fixture.test/a" }, context(workspace, "chat-a"));
    await manager.execute({ action: "navigate", identityId: "account-a", pageId: "main", url: "https://fixture.test/b" }, context(workspace, "chat-b"));
    await manager.execute({ action: "navigate", identityId: "account-a", pageId: "secondary", url: "https://fixture.test/c" }, context(workspace, "chat-a"));
    const listedA = await manager.execute({ action: "list_pages", identityId: "account-a" }, context(workspace, "chat-a"));
    const listedB = await manager.execute({ action: "list_pages", identityId: "account-a" }, context(workspace, "chat-b"));
    assert.deepEqual(listedA.pages.map((page) => page.pageId).sort(), ["main", "secondary"]);
    assert.deepEqual(listedB.pages.map((page) => page.pageId), ["main"]);
    assert.equal(browsers[0].contexts.length, 1);
    assert.equal(manager.activePages(workspace, "account-a"), 3);
    await manager.execute({ action: "navigate", url: "https://fixture.test/anonymous" }, context(workspace, "chat-a"));
    assert.equal(browsers[0].contexts.length, 2);
    await manager.closeSession(workspace, "chat-a");
    assert.equal(manager.activePages(workspace, "account-a"), 1);
  } finally { await manager.close(); }
});

test("browser actions reuse the operator's visible proxied page without closing it", async () => {
  const sharedContext = new FakeContext();
  const operatorPage = await sharedContext.newPage();
  let launched = 0;
  const manager = createBrowserSessionManager({
    chromium: { launch: async () => { launched += 1; return new FakeBrowser(); } },
    fs: { existsSync: (file) => /msedge\.exe$/i.test(file) },
    env: { LOCALAPPDATA: "C:\\Local" },
    beforeNavigation: async () => ({ ok: true }),
    sharedContextProvider: ({ workspace, identityId }) => (
      workspace === "C:\\project" && identityId === "account-a"
        ? { key: "project::account-a", context: sharedContext, mainPage: operatorPage, proxied: true }
        : null
    ),
  });
  try {
    const result = await manager.execute(
      { action: "navigate", identityId: "account-a", pageId: "main", url: "https://fixture.test/after-human-login" },
      context("C:\\project", "chat-a"),
    );
    assert.equal(result.ok, true);
    assert.equal(result.sharedBrowser, true);
    assert.equal(operatorPage.url(), "https://fixture.test/after-human-login");
    assert.equal(launched, 0);

    const protectedClose = await manager.execute(
      { action: "close_page", identityId: "account-a", pageId: "main" },
      context("C:\\project", "chat-a"),
    );
    assert.equal(protectedClose.ok, false);
    assert.equal(protectedClose.error.code, "SHARED_BROWSER_PAGE_PROTECTED");
    await manager.closeSession("C:\\project", "chat-a");
    assert.equal(operatorPage.isClosed(), false);
  } finally { await manager.close(); }
});

test("browser manager reports a clear missing-runtime error", async () => {
  const manager = createBrowserSessionManager({ chromium: { launch: async () => { throw new Error("should not launch"); } }, fs: { existsSync: () => false }, env: {} });
  await assert.rejects(
    () => manager.execute({ action: "open_page", pageId: "main" }, context("C:\\project", "chat-a")),
    (error) => error.code === "BROWSER_RUNTIME_NOT_FOUND",
  );
  await manager.close();
});

test("browser manager keeps canonical projects isolated even when display keys would collide", async () => {
  const { manager, browsers } = setup();
  try {
    await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/a" }, context("C:\\foo bar", "chat-a"));
    await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/b" }, context("C:\\foo_bar", "chat-b"));
    assert.equal(browsers[0].contexts.length, 2);
  } finally { await manager.close(); }
});

test("browser manager surfaces background identity persistence failures", async () => {
  const statuses = [];
  const chromium = { launch: async () => new FakeBrowser() };
  const manager = createBrowserSessionManager({
    chromium,
    fs: { existsSync: (file) => /msedge\.exe$/i.test(file) },
    env: { LOCALAPPDATA: "C:\\Local" },
    beforeNavigation: async () => ({ ok: true }),
    onStatus: (status) => statuses.push(status),
    identityVault: {
      readSecret: () => ({ ok: true, secret: { storageState: { cookies: [{ name: "s", value: "v", domain: "fixture.test", path: "/" }], origins: [] }, headerBindings: [] } }),
      saveSecretAsync: async () => ({ ok: false, error: { code: "IDENTITY_VAULT_WRITE_FAILED", message: "disk unavailable" } }),
    },
  });
  await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/" }, context("C:\\project", "chat-a"));
  await manager.close();
  assert.equal(statuses.some((status) => status.code === "IDENTITY_VAULT_WRITE_FAILED"), true);
  assert.equal(manager.persistenceStatus("C:\\project").ok, false);
});

test("browser manager strips identity headers on a cross-origin request", async () => {
  const browsers = [];
  const chromium = { launch: async () => { const browser = new FakeBrowser(); browsers.push(browser); return browser; } };
  const env = { LOCALAPPDATA: "C:\\Local" };
  const fs = { existsSync: (file) => /msedge\.exe$/i.test(file) };
  const identities = {
    readSecret: () => ({ ok: true, secret: { storageState: { cookies: [], origins: [] }, headerBindings: [{ origin: "https://fixture.test", headers: { Authorization: "Bearer identity-secret" } }] } }),
    saveSecret: () => ({ ok: true }),
  };
  const manager = createBrowserSessionManager({ chromium, fs, env, identityVault: identities, beforeNavigation: async () => ({ ok: true }) });
  try {
    await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/a" }, context("C:\\project", "chat-a"));
    const routeContext = browsers[0].contexts[0];
    let continued;
    await routeContext.routeHandler({
      request: () => ({ url: () => "https://other.test/redirect", headers: () => ({ authorization: "Bearer identity-secret", "x-test": "1" }), isNavigationRequest: () => false }),
      continue: async (options) => { continued = options; },
      abort: async () => {},
    });
    assert.equal(continued.headers.authorization, undefined);
    assert.equal(continued.headers["x-test"], "1");
  } finally { await manager.close(); }
});

test("browser manager redacts identity material from extracted evidence", async () => {
  const { manager, browsers } = setup();
  try {
    await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/a" }, context("C:\\project", "chat-a"));
    const fakeContext = browsers[0].contexts[0];
    fakeContext.storage = { cookies: [{ name: "session", value: "rotated-secret", domain: "fixture.test", path: "/" }], origins: [] };
    fakeContext.pages[0].html = "rotated-secret";
    const result = await manager.execute({ action: "extract", identityId: "account-a", selector: "body", extract: { type: "html" } }, context("C:\\project", "chat-a"));
    assert.equal(result.html.includes("rotated-secret"), false);
    assert.equal(result.html.includes("[REDACTED]"), true);
  } finally { await manager.close(); }
});

test("saving manual login state cannot be overwritten by a stale headless context", async () => {
  const browsers = [];
  const saved = [];
  const chromium = { launch: async () => { const browser = new FakeBrowser(); browsers.push(browser); return browser; } };
  const identities = {
    metadataFor: () => ({ identityId: "account-a" }),
    readSecret: () => ({ ok: true, secret: { storageState: { cookies: [{ name: "session", value: "old-secret", domain: "fixture.test", path: "/" }], origins: [] }, headerBindings: [] } }),
    saveSecret: (_workspace, _identityId, input) => { saved.push(input); return { ok: true }; },
  };
  const manager = createBrowserSessionManager({ chromium, fs: { existsSync: (file) => /msedge\.exe$/i.test(file) }, env: { LOCALAPPDATA: "C:\\Local" }, identityVault: identities, beforeNavigation: async () => ({ ok: true }) });
  try {
    const workspace = "C:\\project";
    await manager.execute({ action: "navigate", identityId: "account-a", url: "https://fixture.test/old" }, context(workspace, "chat-a"));
    await manager.startLogin({ workspace, identityId: "account-a" });
    browsers[1].contexts[0].storage = { cookies: [{ name: "session", value: "new-login-secret", domain: "fixture.test", path: "/" }], origins: [] };
    const writesBeforeSave = saved.length;
    const result = await manager.saveLogin({ workspace, identityId: "account-a" });
    assert.equal(result.ok, true);
    assert.equal(saved.at(-1).storageState.cookies[0].value, "new-login-secret");
    assert.equal(saved.slice(writesBeforeSave).some((entry) => entry.storageState?.cookies?.some((cookie) => cookie.value === "old-secret")), false);
  } finally { await manager.close(); }
});
