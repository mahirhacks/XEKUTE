"use strict";

/**
 * Electron process lifecycle.  The composition root supplies the concrete
 * window/menu/container functions; this module owns only process-level
 * startup, single-instance behavior, and the final durable-memory flush.
 */

// Must equal electron-builder's appId: the NSIS shortcuts carry this AUMID,
// and Windows groups taskbar windows and toasts by it.
const APP_USER_MODEL_ID = "com.xekute.securityworkspace";

let allowImmediateQuit = false;
let activeShutdown = null;

function setAllowImmediateQuit(value) {
  allowImmediateQuit = Boolean(value);
}

/** Flushes and disposes durable state before an installer replaces app files. */
function prepareForUpdateInstall() {
  return activeShutdown ? activeShutdown() : Promise.resolve();
}

function registerLifecycle({
  app,
  BrowserWindow,
  session,
  container,
  createWindow,
  createApplicationMenu,
  shutdown = null,
  applicationId = APP_USER_MODEL_ID,
} = {}) {
  if (!app || !BrowserWindow || !session || !container) {
    throw new TypeError("registerLifecycle requires app, BrowserWindow, session, and container");
  }

  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", () => {
    const window = typeof createWindow === "function" ? createWindow() : null;
    if (!window || window.isDestroyed?.()) return;
    if (window.isMinimized?.()) window.restore();
    window.show?.();
    window.focus?.();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId?.(applicationId);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    createApplicationMenu?.();
    createWindow?.();
  });

  async function flushDurableState() {
    try { if (typeof shutdown === "function") await shutdown(); }
    finally {
      await container.v3SessionStore?.flush?.();
      await container.tier1SensitiveStore?.flush?.();
    }
  }

  // One graceful shutdown per process, shared by a normal quit and an update
  // install, so the installer never races half-closed stores or live ptys.
  let shutdownPromise = null;
  let shutdownDone = false;
  function shutdownOnce() {
    if (!shutdownPromise) {
      shutdownPromise = flushDurableState()
        .catch((error) => console.warn("Chat history flush failed during shutdown:", error?.message || error))
        .then(() => container.dispose?.())
        .catch((error) => console.warn("Shutdown dispose failed:", error?.message || error))
        .finally(() => { shutdownDone = true; });
    }
    return shutdownPromise;
  }
  activeShutdown = shutdownOnce;

  app.on("before-quit", (event) => {
    if (shutdownDone) return;
    if (allowImmediateQuit) {
      // The update installer is already waiting on this process; never hold it.
      shutdownOnce();
      return;
    }
    event.preventDefault?.();
    shutdownOnce().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow?.();
  });

  return true;
}

module.exports = { registerLifecycle, setAllowImmediateQuit, prepareForUpdateInstall, APP_USER_MODEL_ID };
