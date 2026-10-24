"use strict";

const electron = require("electron");
const { app, BrowserWindow, safeStorage } = electron;
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertDevEntry } = require("./runtime.cjs");
const { startBrowserFixtures } = require("../../test/fixtures/browser/server.js");
const { startTlsFixture } = require("../../test/fixtures/browser/tls-server.js");
const { createNativeBrowserService } = require("../../src/app/services/browser/native-browser-service.js");
const { createBrowserTabStore } = require("../../src/app/storage/browser-tab-store.js");
const { createBrowserArtifactStore } = require("../../src/app/services/browser/browser-artifact-store.js");
const { createIdentityVault } = require("../../src/app/storage/identity-vault-store.js");
const { createProxyListenerService } = require("../../src/interceptor/proxy-listener.js");

assertDevEntry({ isPackaged: app.isPackaged, defaultApp: process.defaultApp, argv: process.argv, userData: process.env.XEKUTE_BROWSER_DEV_USER_DATA });
app.setPath("userData", process.env.XEKUTE_BROWSER_DEV_USER_DATA);
app.setName("Xekute Native Browser Development");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-quic");
if (process.argv.includes("--smoke")) app.disableHardwareAcceleration();
let fixtures, tls, proxy, browser, closing = false;

app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (closing) return;
  event.preventDefault(); closing = true;
  (async () => {
    try { await browser?.shutdown(); }
    finally { await proxy?.stop(); await tls?.close(); await fixtures?.close(); }
  })().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
});
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());

app.whenReady().then(async () => {
  fixtures = process.env.XEKUTE_BROWSER_DEV_FIXTURE_ORIGINS
    ? { origins: JSON.parse(process.env.XEKUTE_BROWSER_DEV_FIXTURE_ORIGINS), close: async () => {} }
    : await startBrowserFixtures();
  tls = process.env.XEKUTE_BROWSER_DEV_TLS_ORIGIN
    ? { origin: process.env.XEKUTE_BROWSER_DEV_TLS_ORIGIN, close: async () => {} }
    : await startTlsFixture();
  const directory = app.getPath("userData");
  const projectA = { id: "fixture-project-a", workspace: path.join(directory, "project-a") };
  const projectB = { id: "fixture-project-b", workspace: path.join(directory, "project-b") };
  for (const project of [projectA, projectB]) fs.mkdirSync(project.workspace, { recursive: true });
  const protector = { available: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text).toString("base64"),
    decrypt: payload => safeStorage.decryptString(Buffer.from(payload, "base64")) };
  const vault = createIdentityVault({ fs, path, crypto, baseDir: path.join(directory, "vault"), protector });
  for (const project of [projectA, projectB]) for (const identityId of ["alice", "bob"]) {
    if (vault.metadataFor(project.workspace, identityId)) continue;
    const result = vault.create(project.workspace, { identityId, name: identityId });
    if (!result.ok) throw new Error(JSON.stringify(result));
  }
  const captures = [], events = [];
  proxy = createProxyListenerService({ fs, path, getCaDirectory: workspace => path.join(directory, "ca", path.basename(workspace)),
    assessmentWorkspace: { appendTrafficRecord(workspace, record) { captures.push({ workspace, ...record }); return { ok: true }; } },
    sendEvent: (channel, payload) => events.push({ channel, payload }) });
  const configureProxy = project => proxy.configure(project.workspace, { settings: {
    listener: { enabled: true, bindAddress: "127.0.0.1", port: 0 },
    interception: { enabled: true, interceptRequests: false, onlyInScope: false }, logging: { logRawTraffic: true },
  }, targets: [] });
  const tabStore = createBrowserTabStore({ directory: path.join(directory, "tabs"), protector });
  const artifactStore = createBrowserArtifactStore({ directory: path.join(directory, "artifacts"), protector });
  const window = new BrowserWindow({ width: 1150, height: 850, show: !process.argv.includes("--smoke"),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.removeMenu();
  await window.loadURL("data:text/html,<title>Xekute native browser development</title>");
  window.on("close", event => { if (!closing) { event.preventDefault(); app.quit(); } });
  const createService = (overrides = {}) => createNativeBrowserService({ electron, getWindow: () => window, identityVault: vault, proxyListener: proxy, tabStore, artifactStore, onEvent: event => events.push(event), downloadPolicy: () => globalThis.xekuteNativeBrowserDevelopment?.downloadRule || null, ...overrides });
  browser = createService();
  const initial = (async () => {
    await browser.activateProject(projectA, () => configureProxy(projectA));
    const restored = await browser.restore();
    const tab = restored[0] || await browser.open({ purpose: "assessment", url: fixtures.origins.primary });
    browser.select(tab.id, { x: 0, y: 0, width: 1150, height: 800 });
    return tab;
  })();
  globalThis.xekuteNativeBrowserDevelopment = {
    modules: { path, fs: fs.promises,
      createNativeBrowserVisual: require("../../src/app/services/browser/native-browser-visual.js").createNativeBrowserVisual,
      renderBrowserPointer: require("../../src/app/services/browser/native-browser-visual.js").renderBrowserPointer,
      createNativeBrowserProvider: require("../../src/app/services/browser/native-browser-provider.js").createNativeBrowserProvider,
      createBrowserActionTool: require("../../src/agent/tools/assessment/browser-action.js").createBrowserActionTool,
      startResponsivenessFixture: require("./responsiveness-fixture.cjs").startResponsivenessFixture,
      ...require("./agent-loop-fixture.cjs"),
      ...require("../../src/contracts/tool/execution-context.js") },
    get browser() { return browser; }, window, vault, proxy, tabStore, artifactStore, fixtures, tls, captures, events, projectA, projectB, initial, configureProxy, createService,
    async restart() { await browser.shutdown(); browser = createService(); },
  };
  await initial;
  console.log("Native browser fixture host ready.");
}).catch(error => { console.error(error); app.quit(); });
