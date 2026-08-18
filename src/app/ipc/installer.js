"use strict";

/**
 * Installer interface IPC surface. Handlers are registered against the
 * main-process `ipcMain` wrapper (which enforces trusted-renderer + payload
 * limits), matching the pattern used by every other XEKUTE feature.
 */

const CHANNELS = Object.freeze([
  "installer:getDefault",
  "installer:browseDirectory",
  "installer:install",
  "installer:launch",
]);

function registerInstallerIpc(ipcMain, { service }) {
  if (!ipcMain || !ipcMain.handle || typeof ipcMain.handle !== "function") {
    throw new TypeError("ipcMain.handle is required");
  }
  if (!service) throw new TypeError("installer service is required");

  // Wizard opens → pre-fill the install directory and shortcut defaults.
  ipcMain.handle("installer:getDefault", () => ({ ok: true, value: service.getDefault() }));

  // Browse… button → native directory picker (null when canceled).
  ipcMain.handle("installer:browseDirectory", () => service.browseDirectory());

  // Next → run the install steps; progress/errors arrive via installer:event.
  ipcMain.handle("installer:install", (_event, payload = {}) => service.install(payload));

  // Finish with "Launch on finish" checked → relaunch the app.
  ipcMain.handle("installer:launch", () => service.launch());
}

module.exports = { registerInstallerIpc, INSTALLER_CHANNELS: CHANNELS };
