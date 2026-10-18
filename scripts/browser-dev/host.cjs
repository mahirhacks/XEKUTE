"use strict";

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { startBrowserFixtures } = require("../../test/fixtures/browser/server.js");
const { assertDevEntry } = require("./runtime.cjs");

assertDevEntry({ isPackaged: app.isPackaged, defaultApp: process.defaultApp, argv: process.argv, userData: process.env.XEKUTE_BROWSER_DEV_USER_DATA });
app.setPath("userData", process.env.XEKUTE_BROWSER_DEV_USER_DATA);
app.setName("Xekute Browser Development");
app.commandLine.appendSwitch("disable-background-networking");
if (process.argv.includes("--smoke")) app.disableHardwareAcceleration();
let fixtures, closing = false;
const downloads = [];

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => ({ action: fixtures?.allows(url) ? "allow" : "deny",
    overrideBrowserWindowOptions: { show: !process.argv.includes("--smoke"), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } } }));
  contents.on("will-navigate", (event, url) => { if (!fixtures?.allows(url)) event.preventDefault(); });
  contents.on("will-redirect", (event, url) => { if (!fixtures?.allows(url)) event.preventDefault(); });
  contents.on("will-attach-webview", event => event.preventDefault());
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (closing) return;
  event.preventDefault(); closing = true;
  Promise.resolve(fixtures?.close()).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
});
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());

app.whenReady().then(async () => {
  fixtures = await startBrowserFixtures();
  const browserSession = session.defaultSession;
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on("will-download", (_event, item) => {
    const directory = path.join(app.getPath("userData"), "fixture-downloads");
    fs.mkdirSync(directory, { recursive: true });
    item.setSavePath(path.join(directory, path.basename(item.getFilename())));
    item.once("done", (_event, state) => downloads.push({ state, filename: item.getFilename(), path: item.getSavePath(), bytes: item.getReceivedBytes() }));
  });
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const internal = ["about:", "blob:", "data:"].includes(new URL(details.url).protocol);
    callback({ cancel: !internal && !fixtures.allows(details.url) });
  });
  await browserSession.setProxy({ proxyRules: fixtures.origins.proxy, proxyBypassRules: "<-loopback>" });
  const window = new BrowserWindow({ title: "Xekute Browser Development", width: 1150, height: 850, show: !process.argv.includes("--smoke"),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
      offscreen: process.argv.includes("--smoke"), backgroundThrottling: false } });
  window.removeMenu();
  // Available to main-process test automation only; target pages have no preload or IPC.
  globalThis.xekuteBrowserDevelopment = {
    origins: fixtures.origins,
    captures: () => fixtures.captures.map(capture => ({ ...capture })),
    uploads: () => fixtures.uploads.map(upload => ({ ...upload })),
    downloads: () => downloads.map(download => ({ ...download })),
  };
  globalThis.xekuteBrowserDevelopment.ready = window.loadURL(fixtures.origins.primary);
  await globalThis.xekuteBrowserDevelopment.ready;
  console.log("Browser development fixtures:", fixtures.origins);
}).catch(async error => { console.error(error); await fixtures?.close(); app.exit(1); });
