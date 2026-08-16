"use strict";

/**
 * Electron process lifecycle.  The composition root supplies the concrete
 * window/menu/container functions; this module owns only process-level
 * startup, single-instance behavior, and the final durable-memory flush.
 */
function registerLifecycle({
  app,
  BrowserWindow,
  session,
  container,
  createWindow,
  createApplicationMenu,
  shutdown = null,
  applicationId = "com.pointer.securityworkspace",
} = {}) {
  if (!app || !BrowserWindow || !session || !container) {
    throw new TypeError("registerLifecycle requires app, BrowserWindow, session, and container");
  }

  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
    return false;
  }

  let shuttingDown = false;
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

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault?.();
    const sessionFlush = typeof container.sessionMemoryStore === "function"
      ? container.sessionMemoryStore().flush?.()
      : null;
    const contextFlush = container.contextCompiler?.flush?.() || null;
    const runtimeShutdown = typeof shutdown === "function" ? shutdown() : null;
    const flush = Promise.all([runtimeShutdown, sessionFlush, contextFlush].map((pending) => Promise.resolve(pending)));
    Promise.resolve(flush)
      .catch((error) => console.warn("Session memory flush failed during shutdown:", error?.message || error))
      .finally(async () => {
        try { await container.dispose?.(); } finally { app.quit(); }
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow?.();
  });

  return true;
}

module.exports = { registerLifecycle };
