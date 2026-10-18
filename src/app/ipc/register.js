"use strict";

function registerIpcHandler(ipcMain, channel, handler) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain.handle is required");
  if (!channel || typeof handler !== "function") throw new TypeError("channel and handler are required");
  ipcMain.handle(channel, handler);
  return handler;
}

module.exports = { registerIpcHandler };
