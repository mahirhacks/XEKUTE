"use strict";

/**
 * XEKUTE update service.
 *
 * Owns update *policy and mechanics* in the main process:
 *   - persistence of operator preferences (auto-check on launch, ignored version)
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
    return {
      checkOnLaunch: stored.checkOnLaunch !== false,
      ignoredVersion: typeof stored.ignoredVersion === "string" ? stored.ignoredVersion : "",
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
      autoUpdater.checkForUpdates();
    },
    install() {
      init();
      autoUpdater.downloadUpdate();
    },
    quitAndInstall() {
      init();
      try { autoUpdater.quitAndInstall(); } catch { /* app may already be quitting */ }
    },
  };
}

const createSquirrelBackend = createElectronUpdaterBackend;

/**
 * Dev/test backend: no network, no Squirrel. Simulates the same event
 * sequence so the full UI flow (popup → ignore → progress → relaunch)
 * can be exercised end-to-end before a release exists.
 * Enabled by XEKUTE_UPDATE_MOCK=1 or by running unpackaged.
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

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {object} deps.app            Electron `app`
 * @param {object} deps.backend        backend from createSquirrelBackend / createMockBackend
 * @param {object} deps.settingsStore  store from createUpdateSettingsStore
 * @param {(payload: object) => void} deps.sendEvent  forwards update events to the renderer
 */
function createUpdateService({ app, backend, settingsStore, sendEvent, log = console.debug }) {
  let checking = false;
  let downloadedVersion = "";

  function emit(payload) {
    try { sendEvent?.(payload); } catch { /* renderer may be gone */ }
  }

  backend.emitter.on("available", (info) => {
    checking = false;
    const settings = settingsStore.read();
    emit({ type: "available", version: info.version, mock: Boolean(info.mock) });
  });

  backend.emitter.on("none", () => {
    checking = false;
    emit({ type: "none" });
  });

  backend.emitter.on("error", (info) => {
    checking = false;
    // Fail silently (Q8): the renderer shows nothing; the next launch retries.
    log(`[updates] check failed: ${info.message}`);
    emit({ type: "error", message: info.message });
  });

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
    emit({ type: "downloaded", version: info.version });
    // Close the app and reopen on the new build (Q4). Give the renderer
    // a beat to paint the "Installing…" state before the process exits.
    setTimeout(() => backend.quitAndInstall(), 600);
  });

  return {
    /** @param {{manual?: boolean}} [options] */
    check(options = {}) {
      const manual = Boolean(options.manual);
      if (checking) return { ok: true, skipped: true };
      if (!manual && !settingsStore.read().checkOnLaunch) {
        log("[updates] auto-check disabled; skipping");
        return { ok: true, skipped: true };
      }
      checking = true;
      emit({ type: "checking" });
      try {
        backend.check();
      } catch (error) {
        log(`[updates] check threw: ${error?.message || error}`);
        emit({ type: "error", message: error?.message || "Update check failed" });
        return { ok: false, error: error?.message || "Update check failed" };
      }
      return { ok: true };
    },

    install() {
      try {
        backend.install();
        return { ok: true };
      } catch (error) {
        log(`[updates] install threw: ${error?.message || error}`);
        return { ok: false, error: error?.message || "Update install failed" };
      }
    },

    ignore(version) {
      settingsStore.write({ ignoredVersion: String(version || "") });
    },

    setSettings(patch = {}) {
      if (typeof patch.checkOnLaunch === "boolean") {
        settingsStore.write({ checkOnLaunch: patch.checkOnLaunch });
      }
      return settingsStore.read();
    },

    getSettings: () => settingsStore.read(),
    isChecking: () => checking,
    downloadedVersion: () => downloadedVersion,
  };
}

module.exports = {
  createUpdateService,
  createUpdateSettingsStore,
  createElectronUpdaterBackend,
  createSquirrelBackend,
  createMockBackend,
  nextMinorVersion,
  DEFAULT_CHECK_ON_LAUNCH,
};