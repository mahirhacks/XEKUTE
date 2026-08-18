"use strict";

/**
 * XEKUTE installer interface service.
 *
 * Owns the *mechanics* of the in-app installer wizard in the main process:
 *   - resolving the default install directory and browsing for a new one
 *   - running the install steps (directory, shortcuts, uninstall exe) and
 *     emitting log events
 *   - relaunching the app on "Launch on finish"
 *
 * The module never requires("electron") at load time so it stays unit-testable;
 * Electron objects are injected by the composition root (main.js), mirroring
 * the update service (src/app/services/updates/update-service.js).
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const DEFAULT_INSTALL_DIR_NAME = "XEKUTE";
const SHORTCUT_NAME = "XEKUTE.lnk";
const UNINSTALL_EXE_NAME = "uninstall.exe";
const START_MENU_DIR = path.join(
  process.env.APPDATA || "",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
);

// ── Small helpers ────────────────────────────────────────────────────────────

function isValidAbsolutePath(value) {
  return typeof value === "string" && value.trim().length > 0 && path.isAbsolute(value.trim());
}

function isWritableDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a Windows .lnk shortcut via PowerShell's WScript.Shell COM object.
 * No new dependency; synchronous so the install step completes deterministically.
 */
function createWindowsShortcut(target, linkPath) {
  return new Promise((resolve, reject) => {
    const ps = [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${linkPath}'); $s.TargetPath = '${target}'; $s.WorkingDirectory = '${path.dirname(target)}'; $s.Save()`,
    ];
    const child = spawn("powershell.exe", ps, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

/**
 * Compile a tiny native uninstall.exe via PowerShell Add-Type (C#), with no
 * toolchain required on the target machine and no binary in the repo. The exe
 * launches Squirrel's Update.exe --uninstall, which removes shortcuts, the
 * Start-menu entry, the registry key, kills the running app, and deletes the
 * install directory (including this uninstall.exe itself).
 */
function createUninstallExecutable(updateExe, uninstallPath) {
  return new Promise((resolve, reject) => {
    const cs = String.raw`
using System;
using System.Diagnostics;
using System.IO;
class Uninstaller {
  static int Main() {
    string dir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
    string updateExe = Path.Combine(dir, "Update.exe");
    if (!File.Exists(updateExe)) { Console.Error.WriteLine("Update.exe not found next to uninstall.exe"); return 1; }
    try {
      Process.Start(new ProcessStartInfo { FileName = updateExe, Arguments = "--uninstall", UseShellExecute = false });
      return 0;
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.Message);
      return 1;
    }
  }
}
`;
    const escapedUpdate = updateExe.replace(/'/g, "''");
    const escapedCs = cs.replace(/'/g, "''");
    const ps = [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Add-Type -TypeDefinition '${escapedCs}' -OutputAssembly '${uninstallPath.replace(/'/g, "''")}' -OutputType ConsoleApplication`,
    ];
    const child = spawn("powershell.exe", ps, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {object} deps.app              Electron `app`
 * @param {object} deps.dialog           Electron `dialog`
 * @param {object} deps.shell            Electron `shell`
 * @param {object} deps.getMainWindow    () => BrowserWindow | null
 * @param {string} [deps.defaultDir]     install dir shown when the wizard opens
 * @param {(message: string) => void} [deps.log]  main-process logger
 */
function createInstallerService({ app, dialog, shell, getMainWindow, defaultDir, log = console.debug }) {
  if (!app || !getMainWindow) {
    throw new TypeError("createInstallerService requires app and getMainWindow");
  }

  const emitter = new EventEmitter();
  let running = false;

  function emit(payload) {
    try {
      emitter.emit("event", payload);
      getMainWindow()?.webContents.send("installer:event", payload);
    } catch { /* window gone */ }
  }

  function emitLog(level, message) {
    log(`[installer] ${message}`);
    emit({ type: "log", level, message });
  }

  /** Where the actual XEKUTE app lives (the exe to shortcut and launch). */
  function resolveAppExecutable() {
    if (app.isPackaged) return process.execPath;
    return path.join(path.dirname(process.execPath), "XEKUTE.exe");
  }

  /** Where the Squirrel setup exe lives, when installed. */
  function resolveSetupExecutable() {
    try {
      const setup = path.join(process.resourcesPath, "XEKUTESetup.exe");
      if (fs.existsSync(setup)) return setup;
    } catch { /* resourcesPath may be unavailable */ }
    return "";
  }

  function getDefault() {
    return {
      dir: String(defaultDir || path.join(app.getPath("appData"), DEFAULT_INSTALL_DIR_NAME)),
      desktopShortcut: true,
      taskbarShortcut: false,
    };
  }

  async function browseDirectory() {
    if (!dialog?.showOpenDialog) return { ok: false, error: { message: "Directory picker is unavailable" } };
    const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
      title: "Select XEKUTE install directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.length) return { ok: true, value: null };
    return { ok: true, value: result.filePaths[0] };
  }

  async function install(options = {}) {
    if (running) return { ok: false, error: { message: "An install is already in progress" } };
    running = true;
    try {
      const dir = String(options.dir || "").trim();
      const desktopShortcut = Boolean(options.desktopShortcut);
      const taskbarShortcut = Boolean(options.taskbarShortcut);
      if (!isValidAbsolutePath(dir)) throw new Error("Install directory must be an absolute path");
      if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
        throw new Error(`Install directory is not a folder: ${dir}`);
      }

      emitLog("info", `Installing XEKUTE to ${dir}`);
      await fs.promises.mkdir(dir, { recursive: true });
      if (!isWritableDir(dir)) throw new Error(`Install directory is not writable: ${dir}`);
      emitLog("success", `Created install directory: ${dir}`);

      const setupExe = resolveSetupExecutable(app);
      if (setupExe) {
        emitLog("success", `Installer found: ${setupExe}`);
      } else {
        emitLog("warn", "Setup executable not found; app files are already present. Skipping installer step.");
      }

      const appExe = resolveAppExecutable();
      if (desktopShortcut) {
        emitLog("info", "Creating desktop shortcut…");
        const desktopDir = app.getPath("desktop");
        const linkPath = path.join(desktopDir, SHORTCUT_NAME);
        await createWindowsShortcut(appExe, linkPath);
        emitLog("success", `Desktop shortcut created: ${linkPath}`);
      }

      if (taskbarShortcut) {
        if (process.platform === "win32") {
          emitLog("info", "Creating taskbar shortcut…");
          const linkPath = path.join(START_MENU_DIR, SHORTCUT_NAME);
          await createWindowsShortcut(appExe, linkPath);
          try { app.setUserTasks?.([{ program: appExe, arguments: "", title: "XEKUTE", iconPath: appExe }]); } catch { /* optional */ }
          emitLog("success", `Taskbar shortcut created: ${linkPath}`);
          emitLog("warn", "Pin the app to the taskbar from the shortcut's context menu (Windows requires a user gesture to pin).");
        } else {
          emitLog("warn", `Skipping taskbar shortcut: not supported on ${process.platform}`);
        }
      }

      // Generate uninstall.exe next to Squirrel's Update.exe so the install
      // root always has a double-clickable uninstaller. Squirrel's
      // --uninstall removes shortcuts, registry entry, and the install dir.
      if (process.platform === "win32") {
        const updateExe = path.join(dir, "Update.exe");
        const uninstallPath = path.join(dir, UNINSTALL_EXE_NAME);
        if (fs.existsSync(updateExe)) {
          emitLog("info", "Creating uninstall executable…");
          await createUninstallExecutable(updateExe, uninstallPath);
          emitLog("success", `Uninstall executable created: ${uninstallPath}`);
        } else {
          emitLog("warn", "Update.exe not found in install directory; skipping uninstall executable.");
        }
      } else {
        emitLog("warn", `Skipping uninstall executable: not supported on ${process.platform}`);
      }

      emit({ type: "done", ok: true });
      return { ok: true };
    } catch (error) {
      const message = error?.message || String(error || "Install failed");
      emitLog("error", `Install failed: ${message}`);
      emit({ type: "done", ok: false, error: message });
      return { ok: false, error: { message } };
    } finally {
      running = false;
    }
  }

  async function launch() {
    try {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: { message: error?.message || "Failed to relaunch XEKUTE" } };
    }
  }

  return { emitter, getDefault, browseDirectory, install, launch };
}

/** Where the Squirrel setup exe lives, when installed (module-level helper). */
function resolveSetupExecutable(app) {
  try {
    const setup = path.join(process.resourcesPath, "XEKUTESetup.exe");
    if (fs.existsSync(setup)) return setup;
  } catch { /* resourcesPath may be unavailable */ }
  if (app?.isPackaged) return "";
  const candidate = path.join(__dirname, "..", "..", "..", "..", "out", "make", "squirrel.windows", "x64", "XEKUTESetup.exe");
  try { if (fs.existsSync(candidate)) return candidate; } catch { /* not built yet */ }
  return "";
}

module.exports = {
  createInstallerService,
  DEFAULT_INSTALL_DIR_NAME,
  SHORTCUT_NAME,
  UNINSTALL_EXE_NAME,
  createWindowsShortcut,
  createUninstallExecutable,
  resolveSetupExecutable,
  isWritableDir,
};
