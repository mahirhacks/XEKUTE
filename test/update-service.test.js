const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  createUpdateService,
  createUpdateSettingsStore,
  createSquirrelBackend,
  createMockBackend,
  nextMinorVersion,
  DEFAULT_CHECK_ON_LAUNCH,
} = require("../src/app/services/updates/update-service.js");

function tempSettings() {
  return createUpdateSettingsStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xekute-updates-")), "update-settings.json") });
}

function createScriptedBackend() {
  const emitter = new EventEmitter();
  let checked = 0;
  let installed = 0;
  let quit = 0;
  return {
    emitter,
    counts: () => ({ checked, installed, quit }),
    check() { checked += 1; },
    install() { installed += 1; },
    quitAndInstall() { quit += 1; },
  };
}

function createHarness(overrides = {}) {
  const events = [];
  const backend = overrides.backend || createScriptedBackend();
  const service = createUpdateService({
    app: { relaunch() {}, exit() {} },
    backend,
    settingsStore: overrides.settings || tempSettings(),
    sendEvent: (payload) => events.push(payload),
  });
  return { service, backend, events };
}

test("settings store defaults to auto-check on and no ignored version", () => {
  const store = tempSettings();
  const settings = store.read();
  assert.equal(settings.checkOnLaunch, DEFAULT_CHECK_ON_LAUNCH);
  assert.equal(settings.ignoredVersion, "");
});

test("settings store persists patches", () => {
  const store = tempSettings();
  store.write({ checkOnLaunch: false });
  store.write({ ignoredVersion: "0.2.0" });
  const settings = store.read();
  assert.equal(settings.checkOnLaunch, false);
  assert.equal(settings.ignoredVersion, "0.2.0");
});

test("auto check is skipped when disabled; manual check ignores the pref", () => {
  const { service, backend } = createHarness();
  service.setSettings({ checkOnLaunch: false });
  assert.equal(service.check().skipped, true);
  assert.equal(service.check({ manual: true }).skipped, undefined);
  assert.equal(backend.counts().checked, 1);
});

test("ignoring a version persists it and later availability is still announced", () => {
  const { service, backend, events } = createHarness();
  service.setSettings({ checkOnLaunch: true });
  service.check();
  backend.emitter.emit("available", { version: "0.2.0", mock: false });
  assert.equal(events.at(-1).type, "available");
  service.ignore("0.2.0");
  assert.equal(service.getSettings().ignoredVersion, "0.2.0");
  // Renderer owns toast-vs-bell suppression: main still announces availability.
  service.check();
  backend.emitter.emit("available", { version: "0.2.0", mock: false });
  assert.equal(events.at(-1).type, "available");
});

test("full lifecycle: check → available → progress → downloaded → quitAndInstall", () => {
  const { service, backend, events } = createHarness();
  service.check({ manual: true });
  backend.emitter.emit("available", { version: "0.2.0" });
  service.install();
  assert.equal(backend.counts().installed, 1);
  backend.emitter.emit("progress", { percent: 42.7 });
  backend.emitter.emit("downloaded", { version: "0.2.0" });
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ["checking", "available", "progress", "downloaded"]);
  const progress = events.find((event) => event.type === "progress");
  assert.equal(progress.percent, 43);
  assert.equal(service.downloadedVersion(), "0.2.0");
});

test("quitAndInstall fires after downloaded (600ms later)", async () => {
  const { service, backend } = createHarness();
  service.check({ manual: true });
  backend.emitter.emit("downloaded", { version: "0.2.0" });
  assert.equal(backend.counts().quit, 0);
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(backend.counts().quit, 1);
});

test("error events are forwarded but never throw", () => {
  const { service, backend, events } = createHarness();
  service.check({ manual: true });
  backend.emitter.emit("error", { message: "network down" });
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).message, "network down");
});

test("mock backend emits available with the target version", async () => {
  const events = [];
  const backend = createMockBackend({ app: {}, loadedVersion: "0.1.1", targetVersion: "0.2.0", stepMs: 10 });
  backend.emitter.on("available", (info) => events.push(info));
  backend.check();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(events.length, 1);
  assert.equal(events[0].version, "0.2.0");
  assert.equal(events[0].mock, true);
});

test("mock backend progresses to 100% then reports downloaded", async () => {
  const progress = [];
  const downloaded = [];
  const app = { relaunch() {}, exit() {} };
  const backend = createMockBackend({ app, loadedVersion: "0.1.1", targetVersion: "0.2.0", stepMs: 10 });
  backend.emitter.on("progress", (info) => progress.push(info.percent));
  backend.emitter.on("downloaded", (info) => downloaded.push(info.version));
  backend.install();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(downloaded, ["0.2.0"]);
});

test("squirrel backend wires electron autoUpdater events", () => {
  const handler = {};
  const autoUpdater = {
    autoDownload: true,
    on(event, fn) { handler[event] = fn; },
    setFeedURL() {},
    checkForUpdates() {},
    downloadUpdate() {},
    quitAndInstall() {},
  };
  const events = [];
  const backend = createSquirrelBackend({ autoUpdater, feedUrl: "https://update.electronjs.org/mahirhacks/XEKUTE/win32-x64/0.1.1" });
  backend.emitter.on("available", (info) => events.push(["available", info.version]));
  backend.emitter.on("progress", (info) => events.push(["progress", info.percent]));
  backend.emitter.on("downloaded", (info) => events.push(["downloaded", info.version]));
  backend.check();
  assert.equal(autoUpdater.autoDownload, false);
  handler["update-available"]({ version: "0.2.0" });
  handler["download-progress"]({ percent: 12.34 });
  handler["update-downloaded"]({ version: "0.2.0" });
  assert.deepEqual(events, [
    ["available", "0.2.0"],
    ["progress", 12],
    ["downloaded", "0.2.0"],
  ]);
});

test("nextMinorVersion bumps the minor and resets patch", () => {
  assert.equal(nextMinorVersion("0.1.1"), "0.2.0");
  assert.equal(nextMinorVersion("1.9.4"), "1.10.0");
  assert.equal(nextMinorVersion("not-a-version"), "0.2.0");
});