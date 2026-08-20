"use strict";

/**
 * Update IPC surface. Handlers are registered against the main-process
 * `ipcMain` wrapper (which enforces trusted-renderer + payload limits),
 * matching the pattern used by every other XEKUTE feature.
 */

const CHANNELS = Object.freeze([
  "updates:check",
  "updates:install",
  "updates:ignore",
  "updates:settingsGet",
  "updates:settingsSet",
]);

function registerUpdateIpc(ipcMain, { service }) {
  if (!ipcMain || !ipcMain.handle || typeof ipcMain.handle !== "function") {
    throw new TypeError("ipcMain.handle is required");
  }
  if (!service) throw new TypeError("update service is required");

  // Renderer-triggered check. `{ manual: true }` bypasses the
  // "check on launch" preference (Help → Check for Updates).
  ipcMain.handle("updates:check", (_event, payload = {}) =>
    service.check({ manual: payload?.manual === true }));

  // User clicked Install (toast or notification action).
  ipcMain.handle("updates:install", () => service.install());

  // User clicked Ignore — suppress that version's popup while preserving a
  // notification-center action until it is installed or superseded.
  ipcMain.handle("updates:ignore", (_event, payload = {}) => {
    service.ignore(payload?.version);
    return { ok: true };
  });

  ipcMain.handle("updates:settingsGet", () => ({ ok: true, value: service.getSettings() }));

  ipcMain.handle("updates:settingsSet", (_event, payload = {}) => {
    service.setSettings(payload);
    return { ok: true };
  });
}

module.exports = { registerUpdateIpc, UPDATE_CHANNELS: CHANNELS };
