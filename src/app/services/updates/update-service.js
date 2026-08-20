"use strict";

/**
 * XEKUTE update service.
 *
 * Owns update *policy and mechanics* in the main process:
 *   - persistence of operator preferences and durable deferred updates
 *   - the check → available → downloading → downloaded → quitAndInstall state machine
 *   - backend selection (real electron-updater vs. dev mock)
 *
 * The module never requires("electron") at load time so it stays unit-testable;
 * Electron objects are injected by the composition root (main.js).
 */

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const DEFAULT_CHECK_ON_LAUNCH = true;

// ── Small JSON persistence helpers ──────────────────────────────────────────

function readJsonFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    // Never let persistence failures block an update flow.
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[updates] settings write failed: ${error?.message || error}`);
    }
  }
}

// ── Operator settings store (userData/update-settings.json) ────────────────

function createUpdateSettingsStore({ file }) {
  function read() {
    const stored = readJsonFile(file);
    const ignoredVersion = typeof stored.ignoredVersion === "string" ? stored.ignoredVersion : "";
    return {
      checkOnLaunch: stored.checkOnLaunch !== false,
      ignoredVersion,
      // Backfill the durable notification from the legacy ignored-version
      // field so users upgrading from <= 0.2.8 do not lose their reminder.
      deferredVersion: typeof stored.deferredVersion === "string" ? stored.deferredVersion : ignoredVersion,
      pendingInstalledVersion: typeof stored.pendingInstalledVersion === "string" ? stored.pendingInstalledVersion : "",
      installedFromVersion: typeof stored.installedFromVersion === "string" ? stored.installedFromVersion : "",
      lastNotifiedVersion: typeof stored.lastNotifiedVersion === "string" ? stored.lastNotifiedVersion : "",
    };
  }
  function write(patch = {}) {
    const next = { ...read(), ...patch };
    writeJsonAtomic(file, next);
    return next;
  }
  return { read, write };
}

// ── Backends ────────────────────────────────────────────────────────────────

/**
 * Production backend: electron-updater (NSIS) fed by GitHub Releases or a
 * configured generic provider. Only constructed when packaged.
 */
function createElectronUpdaterBackend({ autoUpdater, feedUrl, provider = null, allowPrerelease = false }) {
  const emitter = new EventEmitter();
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    try { autoUpdater.autoDownload = false; } catch { /* optional */ }
    try { autoUpdater.allowPrerelease = Boolean(allowPrerelease); } catch { /* optional */ }
    if (provider) {
      try { autoUpdater.setFeedURL(provider); } catch { /* electron-updater may use app-update.yml */ }
    } else if (feedUrl) {
      try { autoUpdater.setFeedURL({ provider: "generic", url: feedUrl }); } catch { /* electron-updater may use app-update.yml */ }
    }
    autoUpdater.on("update-available", (info) =>
      emitter.emit("available", { version: String(info?.version || ""), mock: false }));
    autoUpdater.on("update-not-available", () => emitter.emit("none"));
    autoUpdater.on("error", (error) =>
      emitter.emit("error", { message: String(error?.message || error || "Update check failed") }));
    autoUpdater.on("download-progress", (progress) =>
      emitter.emit("progress", {
        percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
        transferred: Number(progress?.transferred) || 0,
        total: Number(progress?.total) || 0,
      }));
    autoUpdater.on("update-downloaded", (info) =>
      emitter.emit("downloaded", { version: String(info?.version || "") }));
  }

  return {
    emitter,
    check() {
      init();
      const pending = autoUpdater.checkForUpdates();
      // electron-updater also emits `error`; consume the rejection so a
      // transient GitHub/network failure never becomes unhandled.
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    },
    install() {
      init();
      return autoUpdater.downloadUpdate();
    },
    quitAndInstall() {
      init();
      try {
        // Silent + relaunch: XEKUTE's NSIS installer has extra pages
        // (directory + shortcuts). A non-silent /S-less launch looks like
        // "Install did nothing" because the running app never closes.
        autoUpdater.quitAndInstall(true, true);
      } catch { /* app may already be quitting */ }
    },
  };
}

const createSquirrelBackend = createElectronUpdaterBackend;

/**
 * Unpackaged development builds never contact or install from the production
 * release feed. The explicit mock backend remains available for end-to-end UI
 * testing through XEKUTE_UPDATE_MOCK=1.
 */
function createDisabledUpdateBackend() {
  const emitter = new EventEmitter();
  return {
    emitter,
    check() { queueMicrotask(() => emitter.emit("disabled")); },
    install() { throw new Error("Updates are disabled in development builds"); },
    quitAndInstall() {},
  };
}

/**
 * Dev/test backend: no network, no Squirrel. Simulates the same event
 * sequence so the full UI flow (popup → ignore → progress → relaunch)
 * can be exercised end-to-end before a release exists.
 * Enabled explicitly by XEKUTE_UPDATE_MOCK=1.
 */
function createMockBackend({ app, loadedVersion, targetVersion, stepMs = 300 }) {
  const emitter = new EventEmitter();
  let timers = [];

  function clearTimers() {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
  }

  return {
    emitter,
    check() {
      clearTimers();
      timers.push(setTimeout(() => emitter.emit("available", { version: targetVersion, mock: true }), 500));
    },
    install() {
      clearTimers();
      let percent = 0;
      const tick = () => {
        percent = Math.min(100, percent + 12 + Math.floor(Math.random() * 9));
        emitter.emit("progress", { percent, transferred: 0, total: 0, mock: true });
        if (percent < 100) timers.push(setTimeout(tick, stepMs));
        else timers.push(setTimeout(() => emitter.emit("downloaded", { version: targetVersion, mock: true }), stepMs));
      };
      timers.push(setTimeout(tick, 200));
    },
    quitAndInstall() {
      clearTimers();
      try {
        app.relaunch();
        app.exit(0);
      } catch { /* never leave the app stuck */ }
    },
  };
}

function nextMinorVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ""));
  if (!match) return "0.2.0";
  const major = Number(match[1]);
  const minor = Number(match[2]) + 1;
  return `${major}.${minor}.0`;
}

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || "").replace(/^v/i, ""));
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true });
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {object} deps.app            Electron `app`
 * @param {object} deps.backend        backend from createSquirrelBackend / createMockBackend
 * @param {object} deps.settingsStore  store from createUpdateSettingsStore
 * @param {(payload: object) => void} deps.sendEvent  forwards update events to the renderer
 * @param {boolean} deps.updatedLaunch true when NSIS relaunched with --updated
 */
function createUpdateService({ app, backend, settingsStore, sendEvent, updatedLaunch = false, onInstallReady = null, log = console.debug }) {
  let checking = false;
  let checkContext = { manual: false, reason: "launch" };
  let installing = false;
  let installRequested = false;
  let availableVersion = "";
  let downloadedVersion = "";
  const currentVersion = String(app?.getVersion?.() || "");

  function emit(payload) {
    try { sendEvent?.(payload); } catch { /* renderer may be gone */ }
  }

  function completedPendingUpdate(settings = settingsStore.read()) {
    return Boolean(
      settings.pendingInstalledVersion
      && currentVersion
      && currentVersion !== settings.installedFromVersion
      && compareVersions(currentVersion, settings.pendingInstalledVersion) >= 0
    );
  }

  function clearCompletedOrObsoleteState(settings = settingsStore.read(), { preservePending = false } = {}) {
    const patch = {};
    if (settings.deferredVersion && currentVersion && compareVersions(currentVersion, settings.deferredVersion) >= 0) {
      patch.ignoredVersion = "";
      patch.deferredVersion = "";
    }
    if (!preservePending && completedPendingUpdate(settings)) {
      patch.pendingInstalledVersion = "";
      patch.installedFromVersion = "";
    }
    return Object.keys(patch).length ? settingsStore.write(patch) : settings;
  }

  function resetCheck() {
    const context = checkContext;
    checking = false;
    checkContext = { manual: false, reason: "launch" };
    return context;
  }

  function startDownload() {
    if (installing) return { ok: true, skipped: true };
    if (!availableVersion) return { ok: false, queued: true };
    installing = true;
    installRequested = false;
    settingsStore.write({
      pendingInstalledVersion: availableVersion,
      installedFromVersion: currentVersion,
    });
    emit({ type: "downloading", version: availableVersion });
    try {
      const pending = backend.install();
      if (pending && typeof pending.then === "function") {
        pending.catch((error) => {
          installing = false;
          const message = error?.message || "Update download failed";
          log(`[updates] install rejected: ${message}`);
          emit({ type: "error", message, version: availableVersion, phase: "download" });
        });
      }
      return { ok: true };
    } catch (error) {
      installing = false;
      const message = error?.message || "Update install failed";
      log(`[updates] install threw: ${message}`);
      emit({ type: "error", message, version: availableVersion, phase: "download" });
      return { ok: false, error: message };
    }
  }

  // NSIS always relaunches an upgraded app with --updated. This covers the
  // first transition from legacy builds that could not persist pending state.
  const initialSettings = clearCompletedOrObsoleteState(settingsStore.read(), { preservePending: true });
  if (updatedLaunch && currentVersion && initialSettings.lastNotifiedVersion !== currentVersion && !completedPendingUpdate(initialSettings)) {
    settingsStore.write({
      pendingInstalledVersion: currentVersion,
      installedFromVersion: "__nsis_updated_launch__",
    });
  }

  backend.emitter.on("available", (info) => {
    const context = resetCheck();
    availableVersion = String(info.version || "");
    let settings = settingsStore.read();
    const installedPreviousUpdate = completedPendingUpdate(settings);
    const ignored = Boolean(availableVersion && availableVersion === settings.ignoredVersion);

    const patch = {};
    if (installedPreviousUpdate) {
      patch.pendingInstalledVersion = "";
      patch.installedFromVersion = "";
      patch.lastNotifiedVersion = currentVersion;
    }
    // A newer release supersedes the old ignored reminder. This is what lets
    // somebody skip several versions but still receive the newest update.
    if (settings.ignoredVersion && availableVersion !== settings.ignoredVersion) {
      patch.ignoredVersion = "";
      patch.deferredVersion = "";
    }
    if (Object.keys(patch).length) settings = settingsStore.write(patch);

    emit({ type: "available", version: availableVersion, mock: Boolean(info.mock), manual: context.manual, ignored });
    if (installRequested) startDownload();
  });

  backend.emitter.on("none", () => {
    const context = resetCheck();
    const settings = settingsStore.read();
    const updated = completedPendingUpdate(settings) && settings.lastNotifiedVersion !== currentVersion;
    installRequested = false;
    availableVersion = "";
    if (updated) {
      settingsStore.write({
        ignoredVersion: "",
        deferredVersion: "",
        pendingInstalledVersion: "",
        installedFromVersion: "",
        lastNotifiedVersion: currentVersion,
      });
      emit({ type: "updated", version: currentVersion, manual: context.manual });
      return;
    }
    clearCompletedOrObsoleteState(settings);
    emit({ type: "none", version: currentVersion, manual: context.manual, reason: context.reason });
  });

  backend.emitter.on("disabled", () => {
    const context = resetCheck();
    installRequested = false;
    emit({ type: "disabled", manual: context.manual, reason: context.reason });
  });

  backend.emitter.on("error", (info) => {
    const context = resetCheck();
    installRequested = false;
    // Automatic check failures stay quiet; manual/download failures are
    // surfaced by the renderer and every later launch retries normally.
    log(`[updates] check failed: ${info.message}`);
    emit({ type: "error", message: info.message, manual: context.manual, reason: context.reason });
  });

  /* c8 ignore start -- event wiring is exercised through the public service */
  backend.emitter.on("progress", (info) => {
    emit({
      type: "progress",
      percent: Math.max(0, Math.min(100, Math.round(Number(info.percent) || 0))),
      transferred: Number(info.transferred) || 0,
      total: Number(info.total) || 0,
    });
  });

  backend.emitter.on("downloaded", (info) => {
    downloadedVersion = info.version;
    settingsStore.write({ ignoredVersion: "", deferredVersion: "" });
    emit({ type: "downloaded", version: info.version });
    try { onInstallReady?.(); } catch { /* never block install */ }
    // Close the app and reopen on the new build. Give the renderer a beat to
    // paint the "Installing…" state before the process exits.
    setTimeout(() => backend.quitAndInstall(), 600);
  });
  /* c8 ignore stop */

  function beginCheck({ manual = false, reason = "launch", force = false } = {}) {
    if (checking) return { ok: true, skipped: true };
    if (!force && !manual && !settingsStore.read().checkOnLaunch) {
      log("[updates] auto-check disabled; skipping");
      return { ok: true, skipped: true };
    }
    checking = true;
    checkContext = { manual: Boolean(manual), reason: String(reason || "launch") };
    emit({ type: "checking", manual: Boolean(manual), reason: checkContext.reason });
    try {
      backend.check();
    } catch (error) {
      const context = resetCheck();
      log(`[updates] check threw: ${error?.message || error}`);
      emit({ type: "error", message: error?.message || "Update check failed", manual: context.manual, reason: context.reason });
      return { ok: false, error: error?.message || "Update check failed" };
    }
    return { ok: true };
  }

  return {
    /** @param {{manual?: boolean}} [options] */
    check(options = {}) {
      return beginCheck({ manual: Boolean(options.manual), reason: options.manual ? "manual" : "launch" });
    },

    install() {
      if (installing) return { ok: true, skipped: true };
      installRequested = true;
      if (availableVersion) return startDownload();
      if (checking) return { ok: true, queued: true };
      return beginCheck({ manual: false, reason: "install", force: true });
    },

    ignore(version) {
      const normalized = String(version || availableVersion || "");
      settingsStore.write({ ignoredVersion: normalized, deferredVersion: normalized });
    },

    setSettings(patch = {}) {
      if (typeof patch.checkOnLaunch === "boolean") {
        settingsStore.write({ checkOnLaunch: patch.checkOnLaunch });
      }
      return settingsStore.read();
    },

    getSettings: () => settingsStore.read(),
    isChecking: () => checking,
    availableVersion: () => availableVersion,
    downloadedVersion: () => downloadedVersion,
  };
}

module.exports = {
  createUpdateService,
  createUpdateSettingsStore,
  createElectronUpdaterBackend,
  createDisabledUpdateBackend,
  createSquirrelBackend,
  createMockBackend,
  nextMinorVersion,
  compareVersions,
  DEFAULT_CHECK_ON_LAUNCH,
};
