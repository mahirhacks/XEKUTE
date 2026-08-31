"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createProxyBrowserService, findInstalledProxyBrowser, proxyConnectHost } = require("../src/interceptor/proxy-browser.js");

test("installed browser selection prefers Chrome over Edge", () => {
  const selected = findInstalledProxyBrowser({
    env: {
      LOCALAPPDATA: "C:\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    fs: { existsSync: () => true },
  });
  assert.equal(selected.name, "chrome");
  assert.match(selected.executablePath, /Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/i);
});

function fakeContext() {
  const listeners = new Map();
  const page = {
    broughtForward: 0,
    currentUrl: "about:blank",
    async bringToFront() { this.broughtForward += 1; },
    async goto(url) { this.currentUrl = String(url); },
    url() { return this.currentUrl; },
    isClosed() { return false; },
  };
  return {
    page,
    closed: false,
    pages: () => [page],
    async newPage() { return page; },
    on(name, listener) { listeners.set(name, listener); },
    async close() {
      this.closed = true;
      listeners.get("close")?.();
    },
  };
}

test("proxied browser uses a dedicated profile and routes Chrome through XEKUTE", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project-a");
  const caCertPath = path.join(root, "ca.pem");
  fs.mkdirSync(workspace);
  fs.writeFileSync(caCertPath, "test-ca");
  const calls = [];
  const context = fakeContext();
  const service = createProxyBrowserService({
    fs,
    path,
    crypto,
    profilesDirectory: path.join(root, "profiles"),
    findBrowser: () => ({ name: "chrome", executablePath: "C:\\Chrome\\chrome.exe" }),
    chromium: { async launchPersistentContext(profile, options) { calls.push({ profile, options }); return context; } },
  });

  const launched = await service.launch({ workspace, proxy: { running: true, host: "0.0.0.0", port: 8080 }, caCertPath });
  assert.equal(launched.ok, true);
  assert.equal(launched.browser, "chrome");
  assert.equal(launched.proxyHost, "127.0.0.1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].profile, /profiles/);
  assert.equal(calls[0].options.proxy.server, "http://127.0.0.1:8080");
  assert.equal(calls[0].options.proxy.bypass, "<-loopback>");
  assert.equal(calls[0].options.ignoreHTTPSErrors, true);
  assert.equal(calls[0].options.chromiumSandbox, true);
  assert.ok(calls[0].options.args.includes("--disable-quic"));
  assert.equal(calls[0].options.args.includes("--no-sandbox"), false);
  assert.equal(calls[0].options.args.includes("--disable-background-networking"), false);

  const reopened = await service.launch({ workspace, proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath });
  assert.equal(reopened.alreadyOpen, true);
  assert.equal(calls.length, 1);
  assert.equal(context.page.broughtForward, 2);
  await service.close();
  assert.equal(context.closed, true);
});

test("switching projects closes the old proxied browser context", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-browser-switch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caCertPath = path.join(root, "ca.pem");
  fs.writeFileSync(caCertPath, "test-ca");
  const contexts = [];
  const service = createProxyBrowserService({
    fs,
    path,
    crypto,
    profilesDirectory: path.join(root, "profiles"),
    findBrowser: () => ({ name: "chrome", executablePath: "chrome.exe" }),
    chromium: { async launchPersistentContext() { const context = fakeContext(); contexts.push(context); return context; } },
  });

  await service.launch({ workspace: path.join(root, "a"), proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath });
  await service.launch({ workspace: path.join(root, "b"), proxy: { running: true, host: "127.0.0.1", port: 8081 }, caCertPath });
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].closed, true);
  assert.equal(contexts[1].closed, false);
});

test("one project can keep isolated identity browser profiles active concurrently", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-browser-identities-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "assessment");
  const caCertPath = path.join(root, "ca.pem");
  fs.mkdirSync(workspace);
  fs.writeFileSync(caCertPath, "test-ca");
  const calls = [];
  const service = createProxyBrowserService({
    fs,
    path,
    crypto,
    profilesDirectory: path.join(root, "profiles"),
    findBrowser: () => ({ name: "edge", executablePath: "msedge.exe" }),
    chromium: { async launchPersistentContext(profile, options) { const context = fakeContext(); calls.push({ profile, options, context }); return context; } },
  });

  const accountA = await service.launch({ workspace, proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath, identity: { id: "account-a", label: "Account A", role: "user" }, captureToken: "aaaaaaaaaaaaaaaa" });
  const accountB = await service.launch({ workspace, proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath, identity: { id: "account-b", label: "Account B", role: "admin" }, captureToken: "bbbbbbbbbbbbbbbb" });
  assert.equal(accountA.identityId, "account-a");
  assert.equal(accountB.identityId, "account-b");
  assert.equal(accountB.activeContexts, 2);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].profile, calls[1].profile);
  assert.equal(calls[0].options.extraHTTPHeaders["X-Xekute-Capture-Context"], "aaaaaaaaaaaaaaaa");
  assert.equal(calls[1].options.extraHTTPHeaders["X-Xekute-Capture-Context"], "bbbbbbbbbbbbbbbb");
  await service.close(workspace, "account-a");
  assert.equal(calls[0].context.closed, true);
  assert.equal(calls[1].context.closed, false);
  assert.equal(service.status(workspace, "account-b").running, true);
  await service.close();
});

test("a live proxied browser exposes only its matching context to the agent runtime", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-browser-share-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "assessment");
  const caCertPath = path.join(root, "ca.pem");
  fs.mkdirSync(workspace);
  fs.writeFileSync(caCertPath, "test-ca");
  const service = createProxyBrowserService({
    fs,
    path,
    crypto,
    profilesDirectory: path.join(root, "profiles"),
    findBrowser: () => ({ name: "edge", executablePath: "msedge.exe" }),
    chromium: { async launchPersistentContext() { return fakeContext(); } },
  });

  await service.launch({ workspace, proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath, identity: { id: "account-a", label: "Account A" } });
  const shared = service.getAgentContext(workspace, "account-a");
  assert.ok(shared?.context);
  assert.equal(shared.identityId, "account-a");
  await shared.mainPage.goto("https://allowed.example/account");
  assert.equal(service.getAgentPageTarget(workspace, "account-a"), "https://allowed.example/account");
  assert.equal(service.getAgentContext(workspace, "account-b"), null);
  assert.equal(service.getAgentContext(workspace, ""), null);
  await service.close();
});

test("proxied browser fails closed without a running listener or CA", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-browser-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createProxyBrowserService({ fs, path, crypto, profilesDirectory: path.join(root, "profiles"), chromium: {}, findBrowser: () => null });
  assert.equal((await service.launch({ workspace: root, proxy: { running: false } })).error.code, "PROXY_BROWSER_PROXY_NOT_RUNNING");
  assert.equal((await service.launch({ workspace: root, proxy: { running: true, host: "127.0.0.1", port: 8080 }, caCertPath: path.join(root, "missing.pem") })).error.code, "PROXY_BROWSER_CA_UNAVAILABLE");
  assert.equal(proxyConnectHost("::"), "127.0.0.1");
});
