"use strict";

// Headless boot smoke test: loads the full main.js entry with a stubbed
// Electron surface and confirms startup wiring (container + window creation)
// executes without throwing. Not a substitute for `npm run dev`, but catches
// composition regressions in CI.

const Module = require("module");
const os = require("os");
const path = require("path");

const webContentsStub = () => ({
  id: 1, isDestroyed: () => false, send() {}, on() {}, once() {}, setWindowOpenHandler() {},
  setAudioMuted() {}, loadURL() {}, close() {}, getURL: () => "file:///app/ui/index.html",
  openDevTools() {}, isCrashed: () => false,
});

const windowStub = () => {
  const webContents = webContentsStub();
  return {
    webContents, isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {},
    setAppDetails() {}, getContentBounds: () => ({ width: 1200, height: 800 }), loadFile() {},
    once() {}, on() {}, close() {}, destroy() {}, setVisible() {}, setBounds() {}, contentView: { addChildView() {}, removeChildView() {} },
  };
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        on() {}, whenReady: () => Promise.resolve(), getPath: () => path.join(os.tmpdir(), "xekute-boot-test"),
        quit() {}, requestSingleInstanceLock: () => true, setAppUserModelId() {},
      },
      BrowserWindow: windowStub,
      WebContentsView: function () { return { webContents: webContentsStub(), setBackgroundColor() {}, setVisible() {}, setBounds() {} }; },
      ipcMain: { handle() {}, on() {}, removeHandler() {} },
      dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
      shell: { openExternal: async () => {} },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onHeadersReceived() {} } } },
      screen: {}, Menu: { buildFromTemplate: () => ({ popup() {} }), setApplicationMenu() {} },
      clipboard: { readText: () => "", writeText() {} },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      Tray: function () {},
      safeStorage: { isEncryptionAvailable: () => false, encryptString: () => "", decryptString: () => "" },
    };
  }
  if (request === "node-pty") {
    return { spawn: () => ({ on() {}, write() {}, kill() {}, resize() {}, pid: 1 }) };
  }
  return origLoad.apply(this, arguments);
};

try {
  require("../src/app/electron/main.js");
  console.log("BOOT SMOKE OK");
  process.exit(0);
} catch (error) {
  console.error("BOOT SMOKE FAIL:", error.message);
  process.exit(1);
}
