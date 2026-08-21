const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  createUpdateService,
  createUpdateSettingsStore,
  createElectronUpdaterBackend,
  createDisabledUpdateBackend,
  createMockBackend,
  nextMinorVersion,
  compareVersions,
  normalizeUpdaterFailure,
  DEFAULT_CHECK_ON_LAUNCH,
} = require("../src/app/services/updates/update-service.js");
const {
  buildUpdateConfig,
  prepareUpdateConfig,
  resolvePublishConfig,
} = require("../scripts/prepare-update-config.js");
const { registerUpdateIpc } = require("../src/app/ipc/updates.js");

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
    app: overrides.app || { getVersion: () => "0.1.0", relaunch() {}, exit() {} },
    backend,
    settingsStore: overrides.settings || tempSettings(),
    sendEvent: (payload) => events.push(payload),
    updatedLaunch: Boolean(overrides.updatedLaunch),
    log: () => {},
  });
  return { service, backend, events };
}

test("settings store defaults to auto-check on and empty durable update state", () => {
  const store = tempSettings();
  const settings = store.read();
  assert.equal(settings.checkOnLaunch, DEFAULT_CHECK_ON_LAUNCH);
  assert.equal(settings.ignoredVersion, "");
  assert.equal(settings.deferredVersion, "");
  assert.equal(settings.pendingInstalledVersion, "");
  assert.equal(settings.installedFromVersion, "");
  assert.equal(settings.lastNotifiedVersion, "");
});

test("settings store persists patches", () => {
  const store = tempSettings();
  store.write({ checkOnLaunch: false });
  store.write({ ignoredVersion: "0.2.0" });
  const settings = store.read();
  assert.equal(settings.checkOnLaunch, false);
  assert.equal(settings.ignoredVersion, "0.2.0");
  assert.equal(settings.deferredVersion, "");
});

test("legacy ignored versions migrate into a durable deferred notification", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-updates-legacy-"));
  const file = path.join(directory, "update-settings.json");
  fs.writeFileSync(file, JSON.stringify({ ignoredVersion: "0.2.8" }));
  const settings = createUpdateSettingsStore({ file }).read();
  assert.equal(settings.ignoredVersion, "0.2.8");
  assert.equal(settings.deferredVersion, "0.2.8");
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
  assert.equal(service.getSettings().deferredVersion, "0.2.0");
  // Main still announces availability, marking it ignored for the renderer.
  service.check();
  backend.emitter.emit("available", { version: "0.2.0", mock: false });
  assert.equal(events.at(-1).type, "available");
  assert.equal(events.at(-1).ignored, true);
});

test("automatic no-update checks are silent-capable while manual checks are identified", () => {
  const { service, backend, events } = createHarness();
  service.check();
  backend.emitter.emit("none");
  assert.deepEqual(events.at(-1), { type: "none", version: "0.1.0", manual: false, reason: "launch" });
  service.check({ manual: true });
  backend.emitter.emit("none");
  assert.deepEqual(events.at(-1), { type: "none", version: "0.1.0", manual: true, reason: "manual" });
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
  assert.deepEqual(types, ["checking", "available", "downloading", "progress", "downloaded"]);
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

test("electron-updater backend wires NSIS updater events", () => {
  const handler = {};
  const feedCalls = [];
  const quitCalls = [];
  const autoUpdater = {
    autoDownload: true,
    on(event, fn) { handler[event] = fn; },
    setFeedURL(value) { feedCalls.push(value); },
    checkForUpdates() {},
    downloadUpdate() {},
    quitAndInstall() { quitCalls.push([...arguments]); },
  };
  const events = [];
  const backend = createElectronUpdaterBackend({
    autoUpdater,
    provider: { provider: "github", owner: "mahirhacks", repo: "XEKUTE", releaseType: "release" },
  });
  backend.emitter.on("available", (info) => events.push(["available", info.version]));
  backend.emitter.on("progress", (info) => events.push(["progress", info.percent]));
  backend.emitter.on("downloaded", (info) => events.push(["downloaded", info.version]));
  backend.check();
  assert.equal(autoUpdater.autoDownload, false);
  assert.deepEqual(feedCalls, [{ provider: "github", owner: "mahirhacks", repo: "XEKUTE", releaseType: "release" }]);
  handler["update-available"]({ version: "0.2.0" });
  handler["download-progress"]({ percent: 12.34 });
  handler["update-downloaded"]({ version: "0.2.0" });
  assert.deepEqual(events, [
    ["available", "0.2.0"],
    ["progress", 12],
    ["downloaded", "0.2.0"],
  ]);
  backend.quitAndInstall();
  assert.deepEqual(quitCalls, [[true, true]]);
});

test("update service exposes the installed app version without persisting it as a preference", () => {
  const { service } = createHarness({ app: { getVersion: () => "0.3.1" } });
  assert.equal(service.currentVersion(), "0.3.1");
  assert.equal(Object.hasOwn(service.getSettings(), "currentVersion"), false);
});

test("update settings IPC includes the running version with the persisted update preferences", () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  registerUpdateIpc(ipcMain, {
    service: {
      getSettings: () => ({ checkOnLaunch: true, ignoredVersion: "" }),
      currentVersion: () => "0.3.1",
      check() {}, install() {}, ignore() {}, setSettings() {},
    },
  });

  assert.deepEqual(handlers.get("updates:settingsGet")(), {
    ok: true,
    value: { checkOnLaunch: true, ignoredVersion: "", currentVersion: "0.3.1" },
  });
});

test("electron-updater classifies a missing packaged update config during download", () => {
  const handler = {};
  const autoUpdater = {
    on(event, fn) { handler[event] = fn; },
    setFeedURL() {},
    checkForUpdates() {},
    downloadUpdate() {},
  };
  const backend = createElectronUpdaterBackend({
    autoUpdater,
    provider: { provider: "github", owner: "mahirhacks", repo: "XEKUTE" },
  });
  const errors = [];
  backend.emitter.on("error", (failure) => errors.push(failure));
  backend.install();
  handler.error(Object.assign(new Error("ENOENT: no such file or directory, open 'resources/app-update.yml'"), { code: "ENOENT" }));
  assert.equal(errors[0].phase, "download");
  assert.equal(errors[0].code, "UPDATE_CONFIG_MISSING");
  assert.match(errors[0].userMessage, /latest XEKUTESetup\.exe once/);
});

test("install promise rejection is forwarded as an error event", async () => {
  const backend = createScriptedBackend();
  backend.install = () => Promise.reject(new Error("Please check update first"));
  const { service, events } = createHarness({ backend });
  service.check({ manual: true });
  backend.emitter.emit("available", { version: "0.2.0" });
  const result = service.install();
  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /Please check update first/);
});

test("a backend download error clears the in-progress guard so install can retry", () => {
  const { service, backend, events } = createHarness();
  service.check();
  backend.emitter.emit("available", { version: "0.3.0" });
  service.install();
  backend.emitter.emit("error", normalizeUpdaterFailure(new Error("network down"), "download"));
  service.install();
  assert.equal(backend.counts().installed, 2);
  assert.equal(events.at(-2).phase, "download");
  assert.equal(events.at(-2).code, "UPDATE_FAILED");
  assert.equal(events.at(-1).type, "downloading");
});

test("install requested from a durable notification waits for the update check", () => {
  const { service, backend, events } = createHarness();
  const result = service.install();
  assert.equal(result.ok, true);
  assert.equal(backend.counts().checked, 1);
  assert.equal(backend.counts().installed, 0);
  backend.emitter.emit("available", { version: "0.2.4" });
  assert.equal(backend.counts().installed, 1);
  assert.deepEqual(events.slice(-2).map((event) => event.type), ["available", "downloading"]);
});

test("a completed update announces success exactly once after a successful check", () => {
  const settings = tempSettings();
  settings.write({ pendingInstalledVersion: "0.2.9", installedFromVersion: "0.2.8" });

  const first = createHarness({ settings, app: { getVersion: () => "0.2.9" } });
  first.service.check();
  first.backend.emitter.emit("none");
  assert.deepEqual(first.events.at(-1), { type: "updated", version: "0.2.9", manual: false });
  assert.equal(settings.read().lastNotifiedVersion, "0.2.9");
  assert.equal(settings.read().pendingInstalledVersion, "");

  const second = createHarness({ settings, app: { getVersion: () => "0.2.9" } });
  second.service.check();
  second.backend.emitter.emit("none");
  assert.equal(second.events.at(-1).type, "none");
});

test("an NSIS --updated launch covers upgrades from legacy versions without pending state", () => {
  const settings = tempSettings();
  const { service, backend, events } = createHarness({
    settings,
    updatedLaunch: true,
    app: { getVersion: () => "0.2.9" },
  });
  service.check();
  backend.emitter.emit("none");
  assert.deepEqual(events.at(-1), { type: "updated", version: "0.2.9", manual: false });
  assert.equal(settings.read().lastNotifiedVersion, "0.2.9");
});

test("a newer release supersedes an ignored version and supports skipping several versions", () => {
  const settings = tempSettings();
  settings.write({ ignoredVersion: "0.2.9", deferredVersion: "0.2.9" });
  const { service, backend, events } = createHarness({ settings, app: { getVersion: () => "0.2.8" } });
  service.check();
  backend.emitter.emit("available", { version: "0.2.12" });
  assert.equal(events.at(-1).ignored, false);
  assert.equal(settings.read().ignoredVersion, "");
  assert.equal(settings.read().deferredVersion, "");

  service.install();
  assert.equal(settings.read().pendingInstalledVersion, "0.2.12");
  assert.equal(settings.read().installedFromVersion, "0.2.8");
});

test("development backend never invokes an updater and reports disabled", async () => {
  const backend = createDisabledUpdateBackend();
  const events = [];
  backend.emitter.on("disabled", () => events.push("disabled"));
  backend.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["disabled"]);
  assert.throws(() => backend.install(), /disabled in development/i);
});

test("downloaded update marks the process ready for an immediate quit", async () => {
  let ready = 0;
  const events = [];
  const backend = createScriptedBackend();
  const service = createUpdateService({
    app: { relaunch() {}, exit() {} },
    backend,
    settingsStore: tempSettings(),
    sendEvent: (payload) => events.push(payload),
    onInstallReady: () => { ready += 1; },
  });
  service.check({ manual: true });
  backend.emitter.emit("downloaded", { version: "0.2.8" });
  assert.equal(ready, 1);
  assert.equal(events.at(-1).type, "downloaded");
});

test("nextMinorVersion bumps the minor and resets patch", () => {
  assert.equal(nextMinorVersion("0.1.1"), "0.2.0");
  assert.equal(nextMinorVersion("1.9.4"), "1.10.0");
  assert.equal(nextMinorVersion("not-a-version"), "0.2.0");
});

test("stable version comparison handles skipped patch and minor releases", () => {
  assert.equal(compareVersions("0.2.12", "0.2.9"), 1);
  assert.equal(compareVersions("v1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.2.9", "0.2.9"), 0);
});

test("packaged updater config contains the GitHub provider and stable cache name", () => {
  const config = buildUpdateConfig({
    packageName: "xekute-app",
    publish: { provider: "github", owner: "mahirhacks", repo: "XEKUTE" },
  });
  assert.match(config, /^provider: "github"$/m);
  assert.match(config, /^owner: "mahirhacks"$/m);
  assert.match(config, /^repo: "XEKUTE"$/m);
  assert.match(config, /^updaterCacheDirName: "xekute-app-updater"$/m);
});

test("prepareUpdateConfig writes app-update.yml into prepackaged resources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-update-config-"));
  const resourcesDir = path.join(directory, "resources");
  fs.mkdirSync(resourcesDir);
  const destination = prepareUpdateConfig({ projectRoot: path.resolve(__dirname, ".."), resourcesDir });
  assert.equal(destination, path.join(resourcesDir, "app-update.yml"));
  assert.match(fs.readFileSync(destination, "utf8"), /updaterCacheDirName: "xekute-app-updater"/);
});

test("updater config rejects incomplete or non-GitHub publish settings", () => {
  assert.throws(() => resolvePublishConfig({ publish: null }), /GitHub publish configuration/);
  assert.throws(() => resolvePublishConfig({ publish: { provider: "generic", url: "https://example.test" } }), /GitHub publish configuration/);
  assert.throws(() => resolvePublishConfig({ publish: { provider: "github", owner: "mahirhacks" } }), /owner and repository/);
});
