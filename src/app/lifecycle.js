"use strict";

function registerAppLifecycle({ app, onReady, onActivate, onWindowAllClosed } = {}) {
  if (!app?.on) throw new TypeError("Electron app is required");
  if (onReady) app.whenReady().then(onReady);
  if (onActivate) app.on("activate", onActivate);
  if (onWindowAllClosed) app.on("window-all-closed", onWindowAllClosed);
}

module.exports = { registerAppLifecycle };
