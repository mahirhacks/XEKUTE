"use strict";
const { app } = require("electron");
const { assertDevEntry } = require("./runtime.cjs");
assertDevEntry({ isPackaged: app.isPackaged, defaultApp: process.defaultApp, argv: process.argv, userData: process.env.XEKUTE_BROWSER_DEV_USER_DATA });
app.setPath("userData", process.env.XEKUTE_BROWSER_DEV_USER_DATA);
if (process.env.XEKUTE_BROWSER_DEV_HARDWARE !== "1") app.disableHardwareAcceleration();
require("../../src/app/electron/main.js");
if (process.env.XEKUTE_BROWSER_DEV_OFFLINE === "1") {
  const { ipcMain, session } = require("electron");
  for (const channel of ["agent:run", "agent:submitInput", "ollama:chat", "tools:execute", "tools:runCommand", "tools:startProcess"]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ ok: false, error: "Execution is disabled in the saved-history startup profiler." }));
  }
  for (const channel of ["agent:pendingParentContinuations", "agent:pendingSubagentResults"]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ ok: true, results: [], resumed: [] }));
  }
  app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true })));
}
