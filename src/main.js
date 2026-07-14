const { app, BrowserWindow, WebContentsView, ipcMain: electronIpcMain, dialog, Menu, shell, session, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const { pathToFileURL } = require("url");
const pty = require("node-pty");
const { spawn } = require("child_process");
const { createToolHandlers } = require("./tools/tool-handlers");
const { createWorkspaceSearch } = require("./tools/workspace-search");
const { createWebResearch } = require("./tools/web-research");
const { createWebCloneService } = require("./tools/webclone");
const { createAssessmentWorkspace, validateCustomEntryPath } = require("./bugbounty/assessment-workspace");
const { createAssessmentMap } = require("./bugbounty/assessment-map");
const { buildIntruderRequests, createSecurityHttpWorkbench } = require("./bugbounty/security-http-workbench");
const { createProxyListenerService } = require("./bugbounty/proxy-listener");
const { runAgentTurn } = require("./agent/agent-controller");
const { normalizeProfile } = require("./agent/operating-modes");
const { loadPolicy } = require("./agent/policy-engine");
const ContextMemory = require("./agent/context-memory");
const { createChatSessionStore } = require("./chat-session-store");
const { validateIpcRequest } = require("./shared/ipc-contracts");

const APP_ROOT = path.join(__dirname, "..");
const IS_DEV = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const APP_INDEX_PATH = path.join(__dirname, "index.html");
const APP_INDEX_URL = pathToFileURL(APP_INDEX_PATH).href;

let mainWindow;
/** @type {Map<string, {pty: import('node-pty').IPty, ownerId: number}>} */
const terminals = new Map();
const toolProcesses = new Map();
const ollamaControllers = new Map();
const webClonePreviewDocuments = new Map();
let webClonePreviewServer = null;
let webClonePreviewServerPromise = null;
let webClonePreviewPort = 0;
let webClonePreviewView = null;
let webClonePreviewUrl = "";
let toolProcessCounter = 0;
let workspaceIndexCache = null;
const workspaceSearch = createWorkspaceSearch({ fs, path });
const webResearch = createWebResearch();
const webClone = createWebCloneService({ fs, path, webResearch });
const assessmentWorkspace = createAssessmentWorkspace({ fs, path });
const assessmentMap = createAssessmentMap({ fs, path, crypto, assessmentWorkspace });
const securityHttpWorkbench = createSecurityHttpWorkbench({ fs, path, assessmentWorkspace });
const proxyListener = createProxyListenerService({
  fs,
  path,
  assessmentWorkspace,
  getCaDirectory(assessmentRoot) {
    return resolveCentralCaDirectory(assessmentRoot);
  },
  sendEvent(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  },
});
const workspaceWatchers = new Map();
const workspaceWatchTimers = new Map();

function applicationPreferencesPath() {
  return path.join(app.getPath("userData"), "pointer-preferences.json");
}

function readApplicationPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(applicationPreferencesPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeApplicationPreferences(preferences) {
  const target = applicationPreferencesPath();
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(preferences, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.copyFileSync(target, `${target}.bak`); } catch { /* First application settings write. */ }
  try { fs.renameSync(temporary, target); }
  catch {
    fs.copyFileSync(temporary, target);
    fs.rmSync(temporary, { force: true });
  }
}

function defaultCentralCaDirectory() {
  return path.join(app.getPath("userData"), "certificates", "proxy-ca");
}

function configuredCentralCaDirectory() {
  const configured = String(readApplicationPreferences()?.certificates?.caDirectory || "").trim();
  return configured && path.isAbsolute(configured) ? path.resolve(configured) : defaultCentralCaDirectory();
}

function legacyProtectedCaDirectory(assessmentRoot) {
  if (!assessmentRoot) return "";
  const identity = crypto.createHash("sha256").update(path.resolve(assessmentRoot).toLowerCase()).digest("hex").slice(0, 24);
  return path.join(app.getPath("userData"), "proxy-ca", identity);
}

function resolveCentralCaDirectory(assessmentRoot = "") {
  const target = configuredCentralCaDirectory();
  const targetCert = path.join(target, "certs", "ca.pem");
  const previous = legacyProtectedCaDirectory(assessmentRoot);
  const previousCert = previous ? path.join(previous, "certs", "ca.pem") : "";
  if (!fs.existsSync(targetCert) && previousCert && fs.existsSync(previousCert)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(previous, target, { recursive: true, errorOnExist: false });
    if (fs.existsSync(targetCert)) {
      try { fs.rmSync(previous, { recursive: true, force: true }); } catch { /* Verified copy remains authoritative. */ }
    }
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(target, 0o700); } catch { /* Windows user-data ACLs protect the default store. */ }
  return target;
}

function certificateSettingsSnapshot() {
  const preferences = readApplicationPreferences();
  const configured = String(preferences?.certificates?.caDirectory || "").trim();
  const directory = configuredCentralCaDirectory();
  const certificatePath = path.join(directory, "certs", "ca.pem");
  return {
    ok: true,
    configuredDirectory: configured,
    directory,
    certificatePath,
    certificateExists: fs.existsSync(certificatePath),
    usingDefault: !configured,
  };
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.unref();
      return;
    } catch { /* Fall back to the direct child below. */ }
  }
  try { child.kill("SIGTERM"); } catch { /* Process already exited. */ }
}

function isTrustedRendererEvent(event) {
  if (!event?.sender || event.sender.isDestroyed()) return false;
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return false;
  const frameUrl = event.senderFrame?.url || event.sender.getURL?.() || "";
  return frameUrl === APP_INDEX_URL;
}

function rejectedIpcResult() {
  return { error: "Untrusted renderer request", code: "UNTRUSTED_RENDERER" };
}

const ipcMain = Object.freeze({
  handle(channel, listener) {
    return electronIpcMain.handle(channel, (event, ...args) => {
      if (!isTrustedRendererEvent(event)) return rejectedIpcResult();
      const validation = validateIpcRequest(channel, args);
      if (validation) return { error: validation.message, code: validation.code };
      return listener(event, ...args);
    });
  },
  on(channel, listener) {
    return electronIpcMain.on(channel, (event, ...args) => {
      if (!isTrustedRendererEvent(event)) {
        event.returnValue = rejectedIpcResult();
        return;
      }
      const validation = validateIpcRequest(channel, args);
      if (validation) {
        event.returnValue = { error: validation.message, code: validation.code };
        return;
      }
      return listener(event, ...args);
    });
  },
  removeHandler(channel) {
    return electronIpcMain.removeHandler(channel);
  },
});

function chatSessionStore() {
  return createChatSessionStore({
    fs,
    path,
    crypto,
    baseDir: app.getPath("userData"),
    protector: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
      decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, "base64")),
    },
  });
}

function getDefaultShell() {
  if (process.env.POINTER_SHELL) return process.env.POINTER_SHELL;

  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      process.env.COMSPEC,
      "powershell.exe",
      "cmd.exe",
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellName(shellPath) {
  const name = path.basename(shellPath || "").replace(/\.(exe|cmd|bat)$/i, "");
  if (!name) return "terminal";
  if (/powershell/i.test(name)) return "powershell";
  return name;
}

function getShellArgs(shellPath) {
  const name = path.basename(shellPath || "").toLowerCase();
  if (name === "powershell.exe" || name === "pwsh.exe") {
    return ["-NoLogo"];
  }
  return [];
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:menu", action);
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: "Target",
      submenu: [
        { label: "Create New Project...", click: () => sendMenuAction("create-project") },
        { type: "separator" },
        { label: "Create Assessment...", click: () => sendMenuAction("create-assessment") },
        { label: "Open Assessment...", click: () => sendMenuAction("open-assessment") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Search",
      submenu: [
        { label: "Open Workspace File...", accelerator: "CmdOrCtrl+P", click: () => sendMenuAction("quick-open") },
        { label: "Search Target Workspace...", accelerator: "CmdOrCtrl+Shift+F", click: () => sendMenuAction("workspace-search") },
      ],
    },
    {
      label: "Terminal",
      submenu: [
        { label: "New Terminal", accelerator: "Ctrl+Shift+`", click: () => sendMenuAction("new-terminal") },
        { label: "Clear Terminal", accelerator: "CmdOrCtrl+K", click: () => sendMenuAction("clear-terminal") },
        { label: "Kill Terminal", click: () => sendMenuAction("kill-terminal") },
      ],
    },
    {
      label: "Chat",
      submenu: [
        { label: "New Chat", click: () => sendMenuAction("new-chat") },
        { label: "Toggle Chat", click: () => sendMenuAction("toggle-chat") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#181818",
    title: "Pointer",
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
    },
  });

  mainWindow.setAppDetails?.({ appId: "com.pointer.securityworkspace", appIconPath: process.execPath });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== APP_INDEX_URL) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Pointer renderer exited unexpectedly:", details?.reason || "unknown");
  });
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow?.isDestroyed()) mainWindow.show();
  });
  mainWindow.loadFile(APP_INDEX_PATH);
  if (IS_DEV) {
    mainWindow.webContents.once("did-finish-load", () => {
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.openDevTools({ mode: "detach" });
    });
  }
  const senderId = mainWindow.webContents.id;
  mainWindow.webContents.on("destroyed", () => {
    stopWorkspaceWatch(senderId);
  });
}

function stopWorkspaceWatch(senderId) {
  const timer = workspaceWatchTimers.get(senderId);
  if (timer) {
    clearTimeout(timer);
    workspaceWatchTimers.delete(senderId);
  }
  const watcher = workspaceWatchers.get(senderId);
  if (watcher) {
    try { watcher.close(); } catch { /* ignore */ }
    workspaceWatchers.delete(senderId);
  }
}

function startWorkspaceWatch(sender, workspace) {
  const senderId = sender.id;
  stopWorkspaceWatch(senderId);
  if (!workspace) return { ok: true };

  const root = path.resolve(workspace);
  try {
    const watcher = fs.watch(root, { recursive: process.platform === "win32" }, (_eventType, filename) => {
      if (sender.isDestroyed()) {
        stopWorkspaceWatch(senderId);
        return;
      }
      const relPath = filename ? String(filename).replace(/\\/g, "/") : "";
      const pending = workspaceWatchTimers.get(senderId);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        workspaceWatchTimers.delete(senderId);
        if (!sender.isDestroyed()) {
          sender.send("workspace:changed", { workspace: root, path: relPath });
        }
      }, 120);
      workspaceWatchTimers.set(senderId, timer);
    });
    watcher.on("error", () => stopWorkspaceWatch(senderId));
    workspaceWatchers.set(senderId, watcher);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

function ensureWebClonePreviewServer() {
  if (webClonePreviewServer && webClonePreviewPort) return Promise.resolve(webClonePreviewPort);
  if (webClonePreviewServerPromise) return webClonePreviewServerPromise;
  webClonePreviewServerPromise = new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        if (request.method !== "GET") {
          response.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
          response.end("Method not allowed.");
          return;
        }
        const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
        const parts = requestUrl.pathname.split("/").filter(Boolean);
        const token = parts[0] === "preview" ? parts[1] || "" : "";
        const record = webClonePreviewDocuments.get(token);
        if (!record || Date.now() - record.createdAt > 10 * 60 * 1000) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          response.end("WebClone preview expired.");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src data: blob:; img-src data: blob:; style-src data: blob: 'unsafe-inline'; script-src data: blob: 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
        });
        response.end(record.html);
      } catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("Invalid WebClone preview.");
      }
    });
    server.once("error", (error) => {
      webClonePreviewServerPromise = null;
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      webClonePreviewServer = server;
      webClonePreviewPort = typeof address === "object" && address ? address.port : 0;
      webClonePreviewServerPromise = null;
      server.unref();
      resolve(webClonePreviewPort);
    });
  });
  return webClonePreviewServerPromise;
}

function normalizeWebClonePreviewBounds(bounds = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const content = mainWindow.getContentBounds();
  const x = Math.max(0, Math.round(Number(bounds.x) || 0));
  const y = Math.max(0, Math.round(Number(bounds.y) || 0));
  const width = Math.max(1, Math.min(Math.round(Number(bounds.width) || 1), Math.max(1, content.width - x)));
  const height = Math.max(1, Math.min(Math.round(Number(bounds.height) || 1), Math.max(1, content.height - y)));
  return { x, y, width, height };
}

function ensureWebClonePreviewView() {
  if (webClonePreviewView && !webClonePreviewView.webContents.isDestroyed()) return webClonePreviewView;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: false,
    },
  });
  view.setBackgroundColor("#ffffff");
  view.webContents.setAudioMuted(true);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== webClonePreviewUrl) event.preventDefault();
  });
  mainWindow.contentView.addChildView(view);
  webClonePreviewView = view;
  return view;
}

function hideWebClonePreviewView() {
  if (!webClonePreviewView) return;
  webClonePreviewView.setVisible(false);
}

function destroyWebClonePreviewView() {
  if (!webClonePreviewView) return;
  try { mainWindow?.contentView?.removeChildView(webClonePreviewView); } catch { /* Window may already be closing. */ }
  try { webClonePreviewView.webContents.close(); } catch { /* View may already be closed. */ }
  webClonePreviewView = null;
  webClonePreviewUrl = "";
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.pointer.securityworkspace");
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    createApplicationMenu();
    createWindow();
  });
}

app.on("window-all-closed", () => {
  proxyListener.stop();
  for (const record of terminals.values()) {
    try { record.pty.kill(); } catch { /* ignore */ }
  }
  terminals.clear();
  for (const record of toolProcesses.values()) {
    terminateProcessTree(record.child);
  }
  toolProcesses.clear();
  destroyWebClonePreviewView();
  webClonePreviewServer?.close();
  webClonePreviewServer = null;
  webClonePreviewPort = 0;
  webClonePreviewDocuments.clear();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (hasSingleInstanceLock && BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── File System IPC ────────────────────────────────────────────────────────────

/** Open a folder picker, return the chosen path */
ipcMain.handle("fs:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Project",
    buttonLabel: "Open Project",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("project:create", async (_event, { defaultParent } = {}) => {
  const parent = defaultParent && path.isAbsolute(defaultParent) && fs.existsSync(defaultParent)
    ? path.dirname(defaultParent)
    : app.getPath("documents");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Create New Project",
    buttonLabel: "Create Project",
    defaultPath: path.join(parent, "new-project"),
    properties: ["createDirectory", "showOverwriteConfirmation", "dontAddToRecent"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const projectPath = path.resolve(result.filePath);
  try {
    if (fs.existsSync(projectPath)) {
      const stat = fs.statSync(projectPath);
      if (!stat.isDirectory()) return { error: "A file already exists at that location." };
      if (fs.readdirSync(projectPath).length) return { error: "Choose a new or empty folder for the project." };
    } else {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    return { ok: true, path: projectPath };
  } catch (error) {
    return { error: error?.message || "Could not create the project folder." };
  }
});

/** Open a file picker, return the chosen path */
ipcMain.handle("fs:openFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

/** List directory entries (one level) */
ipcMain.handle("fs:readdir", async (_event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name),
    })).sort((a, b) => {
      // dirs first, then alphabetical
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    return { error: err.message };
  }
});

/** Read a file as text */
ipcMain.handle("fs:readFile", async (_event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500_000) {
      return { error: "File too large to edit (> 500 KB)" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

/** Write text to a file */
ipcMain.handle("fs:writeFile", async (_event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

/** Create a new folder */
ipcMain.handle("fs:mkdir", async (_event, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("fs:deletePath", async (_event, { workspace, path: relPath }) => {
  return deleteWorkspaceFile(workspace, relPath);
});

ipcMain.handle("assessment:create", async (_event, { defaultParent } = {}) => {
  const parent = defaultParent && path.isAbsolute(defaultParent) && fs.existsSync(defaultParent)
    ? defaultParent
    : app.getPath("documents");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Create Assessment Folder",
    buttonLabel: "Create Assessment",
    defaultPath: path.join(parent, "bug-bounty-assessment"),
    properties: ["createDirectory", "showOverwriteConfirmation", "dontAddToRecent"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const repaired = assessmentWorkspace.repair(result.filePath, { createRoot: true });
  return repaired.error ? repaired : { ...repaired, path: repaired.root };
});

ipcMain.handle("assessment:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Assessment Folder",
    buttonLabel: "Open Assessment",
    properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
  });
  return result.canceled ? { canceled: true } : { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("assessment:verify", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.verify(assessmentPath);
});

ipcMain.handle("assessment:repair", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.repair(assessmentPath);
});

ipcMain.handle("assessment:trafficLog", async (_event, { path: assessmentPath, record, filtered = false } = {}) => {
  return assessmentWorkspace.appendTrafficRecord(assessmentPath, record || {}, { filtered: Boolean(filtered) });
});

ipcMain.handle("assessment:trafficHistory", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  return assessmentWorkspace.readTrafficHistory(assessmentPath, { limit });
});

ipcMain.handle("chat-sessions:load", async (_event, { scope } = {}) => {
  return chatSessionStore().load(scope);
});

ipcMain.handle("chat-sessions:save", async (_event, { scope, state } = {}) => {
  return chatSessionStore().save(scope, state);
});

ipcMain.on("chat-sessions:save-before-close", (event, { scope, state } = {}) => {
  try {
    event.returnValue = chatSessionStore().save(scope, state);
  } catch (error) {
    event.returnValue = { error: error.message };
  }
});

ipcMain.handle("assessment:evidence", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  return assessmentWorkspace.readJsonl(assessmentPath, "evidence/index.jsonl", { limit });
});
ipcMain.handle("assessment:appendEvidence", async (_event, { path: assessmentPath, record } = {}) => {
  return assessmentWorkspace.appendEvidenceRecord(assessmentPath, record || {});
});
ipcMain.handle("assessment:appendFinding", async (_event, { path: assessmentPath, finding } = {}) => {
  return assessmentWorkspace.appendFinding(assessmentPath, finding || {});
});
ipcMain.handle("assessment:createRun", async (_event, { path: assessmentPath, run } = {}) => {
  const profile = normalizeProfile(run?.profile || "testing:analyze");
  if (profile.family === "testing" && ["agent", "execution", "exploit"].includes(profile.key)) {
    const policy = loadPolicy(assessmentPath);
    if (!policy.authorizationConfirmed) return { error: "Authorization must be confirmed before starting an active run.", code: "AUTHORIZATION_REQUIRED" };
    if (!policy.scopeReviewed) return { error: "Scope must be reviewed before starting an active run.", code: "SCOPE_REVIEW_REQUIRED" };
    if (!policy.rulesAccepted) return { error: "Rules of Engagement must be accepted before starting an active run.", code: "ROE_ACCEPTANCE_REQUIRED" };
    if (!policy.allowActiveTesting) return { error: "Active testing is disabled in the assessment policy.", code: "POLICY_ACTIVE_DISABLED" };
    if (profile.key === "exploit" && !policy.allowExploitValidation) return { error: "Exploit validation is disabled in the assessment policy.", code: "POLICY_EXPLOIT_DISABLED" };
  }
  return assessmentWorkspace.createRun(assessmentPath, run || {});
});
ipcMain.handle("assessment:updateRun", async (_event, { path: assessmentPath, id, patch } = {}) => {
  return assessmentWorkspace.updateRun(assessmentPath, id, patch || {});
});
ipcMain.handle("assessment:generateReport", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.generateReport(assessmentPath);
});
ipcMain.handle("assessment:runHistory", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  const result = assessmentWorkspace.readJsonl(assessmentPath, "logs/agent-runs.jsonl", { limit });
  return result;
});

ipcMain.handle("assessment:deleteTrafficRecords", async (_event, { path: assessmentPath, requestIds = [] } = {}) => {
  return assessmentWorkspace.deleteTrafficRecords(assessmentPath, { requestIds });
});

ipcMain.handle("assessment:map", async (_event, { path: assessmentPath } = {}) => {
  return assessmentMap.read(assessmentPath);
});

ipcMain.handle("assessment:buildMap", async (_event, { path: assessmentPath } = {}) => {
  return assessmentMap.build(assessmentPath);
});
ipcMain.handle("assessment:mapOverview", async (_event, { path: assessmentPath } = {}) => assessmentMap.getOverview(assessmentPath));
ipcMain.handle("assessment:mapNode", async (_event, { path: assessmentPath, id } = {}) => assessmentMap.getNode(assessmentPath, id));
ipcMain.handle("assessment:mapNeighbors", async (_event, { path: assessmentPath, id, edgeTypes, minConfidence } = {}) => assessmentMap.getNeighbors(assessmentPath, id, { edgeTypes, minConfidence }));
ipcMain.handle("assessment:mapPaths", async (_event, { path: assessmentPath, from, to, maxHops, minConfidence } = {}) => assessmentMap.findPaths(assessmentPath, from, to, { maxHops, minConfidence }));
ipcMain.handle("assessment:mapRoutes", async (_event, { path: assessmentPath, pattern, tags } = {}) => assessmentMap.searchRoutes(assessmentPath, pattern, { tags }));
ipcMain.handle("assessment:mapSharedObjects", async (_event, { path: assessmentPath, id } = {}) => assessmentMap.getSharedObjects(assessmentPath, id));
ipcMain.handle("assessment:mapEvidence", async (_event, { path: assessmentPath, evidenceIds } = {}) => assessmentMap.getEvidence(assessmentPath, evidenceIds));
ipcMain.handle("assessment:mapHypotheses", async (_event, { path: assessmentPath, status } = {}) => assessmentMap.getHypotheses(assessmentPath, { status }));
ipcMain.handle("assessment:mapAnnotateFinding", async (_event, { path: assessmentPath, ...input } = {}) => assessmentMap.annotateFinding(assessmentPath, input));
ipcMain.handle("webclone:build", async (_event, { path: assessmentPath, target, maxAssets } = {}) => {
  return webClone.build({ root: assessmentPath, target, maxAssets });
});
ipcMain.handle("webclone:manifest", async (_event, { path: assessmentPath } = {}) => webClone.readManifest(assessmentPath));
ipcMain.handle("webclone:readFile", async (_event, { path: assessmentPath, relativePath } = {}) => webClone.readFile(assessmentPath, relativePath));
ipcMain.handle("webclone:previewDocument", async (_event, { html, bounds } = {}) => {
  const documentHtml = String(html || "");
  if (!documentHtml || Buffer.byteLength(documentHtml, "utf8") > 6_000_000) return { error: "WebClone preview document is empty or exceeds the 6 MB limit." };
  const token = crypto.randomUUID();
  const now = Date.now();
  webClonePreviewDocuments.set(token, { html: documentHtml, createdAt: now, ownerId: _event.sender.id });
  for (const [id, record] of webClonePreviewDocuments) {
    if (now - record.createdAt > 10 * 60 * 1000 || webClonePreviewDocuments.size > 12) webClonePreviewDocuments.delete(id);
  }
  try {
    const port = await ensureWebClonePreviewServer();
    if (!port) return { error: "WebClone preview server could not start." };
    const normalizedBounds = normalizeWebClonePreviewBounds(bounds);
    if (!normalizedBounds) return { error: "WebClone preview window is unavailable." };
    webClonePreviewUrl = `http://127.0.0.1:${port}/preview/${token}/index.html`;
    const view = ensureWebClonePreviewView();
    view.setVisible(false);
    view.setBounds(normalizedBounds);
    await view.webContents.loadURL(webClonePreviewUrl);
    view.setVisible(true);
    return { ok: true };
  } catch (error) {
    webClonePreviewDocuments.delete(token);
    return { error: `WebClone preview server could not start: ${error.message}` };
  }
});
ipcMain.handle("webclone:previewBounds", async (_event, { bounds } = {}) => {
  const normalizedBounds = normalizeWebClonePreviewBounds(bounds);
  if (!normalizedBounds || !webClonePreviewView) return { ok: false };
  webClonePreviewView.setBounds(normalizedBounds);
  return { ok: true };
});
ipcMain.handle("webclone:hidePreview", async () => {
  hideWebClonePreviewView();
  return { ok: true };
});

ipcMain.handle("assessment:settings", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.readSettings(assessmentPath);
});

ipcMain.handle("assessment:writeSettings", async (_event, { path: assessmentPath, settings } = {}) => {
  return assessmentWorkspace.writeSettings(assessmentPath, settings);
});

function safeAssessmentChild(root, relativePath) {
  const base = path.resolve(root || "");
  const target = path.resolve(base, String(relativePath || ""));
  return base && target !== base && target.startsWith(`${base}${path.sep}`) ? target : "";
}

ipcMain.handle("assessment:customEntries", async (_event, { path: assessmentPath } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const walk = (folder, prefix = "", source = "custom") => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return [{ name: entry.name, relativePath, type: "directory", source }, ...walk(path.join(folder, entry.name), relativePath, source)];
    return [{ name: entry.name, relativePath, type: "file", source }];
  });
  try {
    const custom = walk(path.join(verification.root, "custom"));
    const tools = walk(path.join(verification.root, "tools"), "", "tools");
    return { ok: true, entries: [...custom, ...tools].slice(0, 500) };
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle("assessment:createEntry", async (_event, { path: assessmentPath, relativePath, type = "file", content = "" } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const validated = validateCustomEntryPath(relativePath);
  if (validated.error) return validated;
  if (!['file', 'directory'].includes(type)) return { error: "Unsupported custom entry type", code: "INVALID_ENTRY_TYPE" };
  const target = safeAssessmentChild(verification.root, validated.normalized);
  if (!target || !path.relative(verification.root, target).replace(/\\/g, "/").startsWith("custom/")) return { error: "Custom entries must stay inside Custom" };
  try {
    if (fs.existsSync(target)) return { error: "That name already exists" };
    if (type === "directory") fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, String(content), "utf8"); }
    return { ok: true, path: target };
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle("assessment:deleteEntries", async (_event, { path: assessmentPath, relativePaths = [] } = {}) => {
  return assessmentWorkspace.deleteCustomEntries(assessmentPath, relativePaths);
});

ipcMain.handle("assessment:buildContext", async (_event, { path: assessmentPath } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Add Context Files", buttonLabel: "Build pen_context.md", properties: ["openFile", "multiSelections"] });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };
  const script = path.join(__dirname, "context", "parse_context.py");
  const output = path.join(verification.root, "pen_context.md");
  const sourceRoot = path.join(verification.root, "context", "sources");
  const imported = picked.filePaths.map((source, index) => {
    const safeName = path.basename(source).replace(/[^\w.() -]/g, "_");
    let target = path.join(sourceRoot, safeName);
    if (fs.existsSync(target)) target = path.join(sourceRoot, `${path.parse(safeName).name}-${Date.now()}-${index}${path.extname(safeName)}`);
    fs.copyFileSync(source, target);
    return target;
  });
  const candidates = process.platform === "win32" ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [binary, prefix] of candidates) {
    const result = await new Promise((resolve) => {
      const child = spawn(binary, [...prefix, script, "--output", output, ...imported], { windowsHide: true });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => resolve({ unavailable: error.code === "ENOENT", error: error.message }));
      child.on("close", (code) => resolve(code === 0 ? { ok: true, stdout } : { error: stderr || `Parser exited with code ${code}` }));
    });
    if (result.ok) {
      let details = {}; try { details = JSON.parse(result.stdout.trim().split(/\r?\n/).pop()); } catch { /* optional */ }
      return { ok: true, path: output, ...details };
    }
    if (!result.unavailable) return result;
  }
  return { error: "Python 3 is required to build pen_context.md" };
});

ipcMain.handle("security:httpRequest", async (_event, payload = {}) => {
  return securityHttpWorkbench.run(payload);
});

ipcMain.handle("security:buildIntruder", async (_event, payload = {}) => {
  const maxRequests = Math.max(1, Math.min(Number(payload.maxRequests) || 25, 25));
  return buildIntruderRequests(payload.rawRequest, payload.payloadSets, payload.attackType, maxRequests);
});

ipcMain.handle("proxy:configure", async (_event, { assessmentPath } = {}) => {
  return proxyListener.configure(assessmentPath);
});

ipcMain.handle("proxy:status", async () => proxyListener.getStatus());

ipcMain.handle("proxy:forward", async (_event, { id, request } = {}) => {
  return proxyListener.forward(id, request);
});

ipcMain.handle("proxy:drop", async (_event, { id } = {}) => proxyListener.drop(id));

ipcMain.handle("proxy:showCa", async () => {
  const caCertPath = proxyListener.getStatus().caCertPath;
  if (!caCertPath || !fs.existsSync(caCertPath)) return { error: "Proxy CA certificate has not been generated yet" };
  shell.showItemInFolder(caCertPath);
  return { ok: true, path: caCertPath };
});

ipcMain.handle("settings:certificatesGet", async () => certificateSettingsSnapshot());

ipcMain.handle("settings:certificatesChoose", async (_event, { assessmentPath = "" } = {}) => {
  const current = configuredCentralCaDirectory();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Pointer CA storage folder",
    defaultPath: current,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true, ...certificateSettingsSnapshot() };
  const selected = path.resolve(result.filePaths[0]);
  fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
  const preferences = readApplicationPreferences();
  preferences.certificates = { ...(preferences.certificates || {}), caDirectory: selected };
  writeApplicationPreferences(preferences);
  await proxyListener.stop();
  if (assessmentPath) await proxyListener.configure(assessmentPath);
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesReset", async (_event, { assessmentPath = "" } = {}) => {
  const preferences = readApplicationPreferences();
  preferences.certificates = { ...(preferences.certificates || {}), caDirectory: "" };
  writeApplicationPreferences(preferences);
  await proxyListener.stop();
  if (assessmentPath) await proxyListener.configure(assessmentPath);
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesShow", async () => {
  const snapshot = certificateSettingsSnapshot();
  fs.mkdirSync(snapshot.directory, { recursive: true, mode: 0o700 });
  const error = await shell.openPath(snapshot.directory);
  return error ? { error, code: "CA_DIRECTORY_OPEN_FAILED" } : snapshot;
});

ipcMain.handle("workspace:watch", async (event, workspace) => {
  return startWorkspaceWatch(event.sender, workspace);
});

ipcMain.handle("workspace:unwatch", async (event) => {
  stopWorkspaceWatch(event.sender.id);
  return { ok: true };
});

// ── Tools IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:toggleMaximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

function applyPatchesToContent(content, patches) {
  for (let i = 0; i < patches.length; i += 1) {
    const search = patches[i].search ?? "";
    const replace = patches[i].replace ?? "";
    if (!search) return { error: `Patch ${i + 1}: empty search block` };

    const count = content.split(search).length - 1;
    if (count === 0) return { error: `Patch ${i + 1}: search text not found in file` };
    if (count > 1) {
      return { error: `Patch ${i + 1}: search text matched ${count} times (must be unique)` };
    }

    content = content.replace(search, replace);
  }

  return { content, patches_applied: patches.length };
}

function editFileInWorkspace(workspace, file, code) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, "utf8");
  return { ok: true, file, path: target, mode: "full", content: code };
}

function patchFileInWorkspace(workspace, file, patches) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }
  if (!fs.existsSync(target)) {
    return { error: `File not found: ${file}` };
  }

  const existing = fs.readFileSync(target, "utf8");
  const result = applyPatchesToContent(existing, patches);
  if (result.error) return result;

  fs.writeFileSync(target, result.content, "utf8");
  return {
    ok: true,
    file,
    path: target,
    mode: "patch",
    content: result.content,
    patches_applied: result.patches_applied,
  };
}

function resolveWorkspaceTarget(workspace, relPath = "") {
  return workspaceSearch.resolveWorkspaceTarget(workspace, relPath);
}

const INDEX_SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".next", "dist", "build", "out", "coverage", ".venv", "venv",
]);

const INDEX_TEXT_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".md", ".txt",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".yml", ".yaml",
  ".toml", ".xml", ".sh", ".ps1", ".bat", ".sql", ".env", ".gitignore",
]);

function isIndexableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext && path.basename(filePath).startsWith(".")) return true;
  return INDEX_TEXT_EXTS.has(ext);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z_][a-z0-9_]{1,}|[0-9]+/g) || [];
}

function takeLimited(text, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

function collectWorkspaceFiles(root, { maxFiles = 700 } = {}) {
  const files = [];

  function walk(dir) {
    if (files.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") {
        if (entry.isDirectory()) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!INDEX_SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || !isIndexableFile(full)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 350_000) continue;
        files.push({ full, rel: path.relative(root, full).replace(/\\/g, "/"), size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  walk(root);
  return files;
}

function extractGraphFacts(rel, content) {
  const imports = [];
  const symbols = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines.slice(0, 500)) {
    const importMatch = line.match(/^\s*(?:import\s+.*?\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|from\s+([\w.]+)\s+import\s+|require\(["']([^"']+)["']\))/);
    const target = importMatch?.[1] || importMatch?.[2] || importMatch?.[3] || importMatch?.[4];
    if (target) imports.push(target);

    const symbolMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)/);
    const symbol = symbolMatch?.[1] || symbolMatch?.[2];
    if (symbol) symbols.push(symbol);
  }

  return { file: rel, imports: [...new Set(imports)].slice(0, 20), symbols: [...new Set(symbols)].slice(0, 30) };
}

function buildWorkspaceIndex(workspace) {
  const index = workspaceSearch.buildWorkspaceIndex(workspace);
  workspaceIndexCache = index?.error ? null : index;
  return index;
}

function getWorkspaceIndex(workspace) {
  const root = path.resolve(workspace || ".");
  if (workspaceIndexCache?.workspace === root) return workspaceIndexCache;
  return buildWorkspaceIndex(root);
}

function searchWorkspaceIndex(workspace, query, { limit = 8 } = {}) {
  return workspaceSearch.searchWorkspaceIndex(workspace, query, { limit });
}

function findWorkspaceFiles(workspace, query, { limit = 8 } = {}) {
  return workspaceSearch.findWorkspaceFiles(workspace, query, { limit });
}

function runWorkspaceCommand(workspace, command, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) {
      resolve(resolved);
      return;
    }
    if (!command?.trim()) {
      resolve({ error: "Empty command" });
      return;
    }

    const child = spawn(command, {
      cwd: resolved.root,
      shell: true,
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, Math.max(1000, Math.min(timeoutMs, 120000)));

    child.stdout?.on("data", (chunk) => {
      stdout = takeLimited(stdout + chunk.toString(), 20000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = takeLimited(stderr + chunk.toString(), 12000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: err.message, command });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        mode: "command",
        command,
        exitCode,
        signal,
        timedOut,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      });
    });
  });
}

function startWorkspaceProcess(workspace, command, ownerId = "agent") {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return resolved;
  if (!command?.trim()) return { error: "Empty command" };

  const id = `proc-${++toolProcessCounter}`;
  const child = spawn(command, {
    cwd: resolved.root,
    shell: true,
    windowsHide: true,
    env: { ...process.env },
  });

  const record = {
    id,
    command,
    startedAt: Date.now(),
    running: true,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    child,
    ownerId,
  };

  child.stdout?.on("data", (chunk) => {
    record.stdout = takeLimited(record.stdout + chunk.toString(), 24000);
  });
  child.stderr?.on("data", (chunk) => {
    record.stderr = takeLimited(record.stderr + chunk.toString(), 16000);
  });
  child.on("error", (err) => {
    record.running = false;
    record.stderr = takeLimited(`${record.stderr}\n${err.message}`, 16000);
  });
  child.on("close", (exitCode, signal) => {
    record.running = false;
    record.exitCode = exitCode;
    record.signal = signal;
    const eviction = setTimeout(() => {
      if (toolProcesses.get(id) === record && !record.running) toolProcesses.delete(id);
    }, 10 * 60 * 1000);
    eviction.unref?.();
  });

  toolProcesses.set(id, record);
  return { ok: true, mode: "process_start", id, command };
}

function processSnapshot(record) {
  return {
    id: record.id,
    command: record.command,
    running: record.running,
    exitCode: record.exitCode,
    signal: record.signal,
    seconds: Number(((Date.now() - record.startedAt) / 1000).toFixed(1)),
    stdout: record.stdout.trimEnd(),
    stderr: record.stderr.trimEnd(),
  };
}

function listProjectFiles(workspace) {
  return workspaceSearch.listProjectFiles(workspace);
}

async function editWorkspaceFile(workspace, file, { code, patches } = {}) {
  if (!workspace) return { error: "No workspace open" };
  workspaceIndexCache = null;
  workspaceSearch.invalidate(workspace);

  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }

  if (patches?.length) {
    return patchFileInWorkspace(workspace, file, patches);
  }

  if (code === undefined) return { error: "No content or patches provided" };

  try {
    return editFileInWorkspace(workspace, file, code);
  } catch (err) {
    return { error: err.message };
  }
}

function deleteWorkspaceFile(workspace, file) {
  const resolved = resolveWorkspaceTarget(workspace, file);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };
    const stat = fs.statSync(resolved.target);
    const targetType = stat.isDirectory() ? "directory" : "file";
    if (stat.isDirectory()) {
      fs.rmSync(resolved.target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved.target);
    }
    workspaceIndexCache = null;
    workspaceSearch.invalidate(workspace);
    return { ok: true, mode: "delete", file, targetType };
  } catch (err) {
    return { error: err.message };
  }
}

function readToolProcess(id, ownerId = "agent") {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  if (record.ownerId !== ownerId) return { error: "Process is not owned by this caller", code: "PROCESS_NOT_OWNED" };
  return { ok: true, ...processSnapshot(record) };
}

function stopToolProcess(id, ownerId = "agent") {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  if (record.ownerId !== ownerId) return { error: "Process is not owned by this caller", code: "PROCESS_NOT_OWNED" };
  if (record.running) {
    terminateProcessTree(record.child);
    record.running = false;
  }
  return { ok: true, ...processSnapshot(record) };
}

const toolExecutor = createToolHandlers({
  fs,
  path,
  resolveWorkspaceTarget,
  editWorkspaceFile,
  deleteWorkspaceFile,
  buildWorkspaceIndex,
  searchWorkspaceIndex,
  findWorkspaceFiles,
  runWorkspaceCommand,
  startWorkspaceProcess,
  readToolProcess,
  stopToolProcess,
  listProjectFiles,
  searchWeb: webResearch.searchWeb,
  fetchWebPage: webResearch.fetchWebPage,
  assessmentMap,
});

function runSlashCommandPython(action, payload = {}) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, "commands", "command_parser.py");
    const executable = process.env.POINTER_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(executable, [script, "--action", action, "--payload", JSON.stringify(payload)], {
      cwd: APP_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ ok: false, error: `Python command runner unavailable: ${error.message}`, code: "PYTHON_UNAVAILABLE" }));
    child.on("close", (code) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      try {
        const parsed = JSON.parse(lines.at(-1) || "{}");
        resolve(code === 0 ? parsed : { ...parsed, ok: false, error: parsed.error || stderr.trim() || `Python command runner exited with code ${code}`, code: parsed.code || "COMMAND_RUNNER_FAILED" });
      } catch {
        resolve({ ok: false, error: stderr.trim() || stdout.trim() || "Python command runner returned no JSON result", code: "COMMAND_RUNNER_FAILED" });
      }
    });
  });
}

function buildDirMap(workspace) {
  const lines = [path.resolve(workspace)];
  const walk = (dir, prefix = "", depth = 0) => {
    if (depth > 5) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => ![".git", "node_modules", "__pycache__"].includes(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(full, `${prefix}  `, depth + 1);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(workspace);
  return lines.join("\n");
}

ipcMain.handle("tools:dirMap", async (_event, workspace) => {
  if (!workspace || !fs.existsSync(workspace)) {
    return { error: "No workspace" };
  }

  try {
    return { map: buildDirMap(workspace) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("tools:editFile", async (_event, { workspace, file, code, patches }) => {
  return editWorkspaceFile(workspace, file, { code, patches });
});

ipcMain.handle("tools:deleteFile", async (_event, { workspace, file }) => {
  return deleteWorkspaceFile(workspace, file);
});

ipcMain.handle("tools:indexWorkspace", async (_event, { workspace }) => {
  const index = buildWorkspaceIndex(workspace);
  if (index.error) return index;
  return {
    ok: true,
    mode: "index",
    files: index.docs.length,
    builtAt: index.builtAt,
    graph: index.graph.slice(0, 80),
  };
});

ipcMain.handle("tools:searchWorkspace", async (_event, { workspace, query, limit }) => {
  return searchWorkspaceIndex(workspace, query, { limit });
});

ipcMain.handle("tools:findFiles", async (_event, { workspace, query, limit }) => {
  return findWorkspaceFiles(workspace, query, { limit });
});

ipcMain.handle("tools:runCommand", async (_event, { workspace, command, timeoutMs }) => {
  return runWorkspaceCommand(workspace, command, { timeoutMs });
});

ipcMain.handle("tools:startProcess", async (_event, { workspace, command }) => {
  return startWorkspaceProcess(workspace, command, _event.sender.id);
});

ipcMain.handle("tools:readProcess", async (_event, { id }) => {
  return { mode: "process_read", ...readToolProcess(id, _event.sender.id) };
});

ipcMain.handle("tools:stopProcess", async (_event, { id }) => {
  return { mode: "process_stop", ...stopToolProcess(id, _event.sender.id) };
});

ipcMain.handle("tools:execute", async (_event, { workspace, toolCall }) => {
  return toolExecutor.executeToolCall({ workspace, toolCall });
});

ipcMain.handle("tools:health", async (_event, { customTools = [] } = {}) => {
  const executables = ["subfinder", "amass", "theHarvester", "httpx", "nmap", "ffuf", "katana", "gowitness", "gobuster", "nuclei", "nikto", "testssl", "sqlmap"];
  const check = (executable) => new Promise((resolve) => {
    const child = spawn(executable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve({ executable, installed: true, version: "version check timed out" }); }, 2500);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ executable, installed: false, error: error.code === "ENOENT" ? "Not found on PATH" : error.message }); });
    child.on("close", () => { clearTimeout(timer); resolve({ executable, installed: true, version: output.trim().split(/\r?\n/)[0].slice(0, 160) || "Installed" }); });
  });
  const custom = Array.isArray(customTools) ? customTools.filter((tool) => tool && /^[a-z0-9][a-z0-9_-]{1,40}$/.test(String(tool.id || "")) && String(tool.executable || "").trim()).slice(0, 100) : [];
  const customResults = await Promise.all(custom.map(async (tool) => ({ ...(await check(String(tool.executable).trim())), id: String(tool.id), custom: true })));
  return { ok: true, tools: [...await Promise.all(executables.map(check)), ...customResults] };
});

ipcMain.handle("commands:parse", async (_event, payload = {}) => runSlashCommandPython("parse", payload));
ipcMain.handle("commands:run", async (_event, payload = {}) => {
  const modeFamily = String(payload.modeFamily || "assist").toLowerCase();
  if (modeFamily === "assist") {
    const parsed = await runSlashCommandPython("parse", payload);
    const sensitiveTools = new Set(["httpx", "nmap", "ffuf", "gobuster", "dirb", "katana", "nikto", "sqlmap", "testssl", "gowitness", "custom_script"]);
    const tools = Array.isArray(parsed?.tools) ? parsed.tools.map((tool) => String(tool).toLowerCase()) : [];
    const command = String(parsed?.command || "").toLowerCase();
    const sensitive = parsed?.role === "static" && (command !== "/passive" || tools.some((tool) => sensitiveTools.has(tool)));
    if (sensitive) {
      return { ok: false, error: "Safe mode blocks sensitive static commands. Switch to Testing mode before running active recon or custom scripts.", code: "SAFE_MODE_ACTIVE_BLOCK", parsed };
    }
  }
  return runSlashCommandPython("run", payload);
});
ipcMain.handle("commands:customScripts", async (_event, { path: root } = {}) => {
  if (!root || !fs.existsSync(root)) return { ok: true, scripts: [] };
  const base = path.join(root, "custom_scripts");
  try {
    fs.mkdirSync(base, { recursive: true });
    const scripts = [];
    const walk = (folder, prefix = "") => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name);
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full, relativePath);
        else if (/\.(?:py|ps1|sh|js|mjs|cmd|bat)$/i.test(entry.name)) scripts.push({ name: entry.name, relativePath, path: relativePath, extension: path.extname(entry.name).slice(1).toLowerCase() });
      }
    };
    walk(base);
    return { ok: true, scripts: scripts.sort((a, b) => a.relativePath.localeCompare(b.relativePath)) };
  } catch (error) { return { ok: false, error: error.message, scripts: [] }; }
});

// ── Terminal IPC ─────────────────────────────────────────────────────────────

ipcMain.handle("terminal:create", (event, { id, cwd }) => {
  if (terminals.has(id)) return { error: "Terminal already exists" };

  try {
    const shell = getDefaultShell();
    const term = pty.spawn(shell, getShellArgs(shell), {
      name: "xterm-color",
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
      useConpty: process.platform === "win32",
    });

    const ownerId = event.sender.id;
    terminals.set(id, { pty: term, ownerId });

    term.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("terminal:data", { id, data });
      }
    });

    term.onExit(({ exitCode, signal }) => {
      terminals.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send("terminal:exit", { id, exitCode, signal });
      }
    });

    return { ok: true, shell: getShellName(shell) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("terminal:write", (_event, { id, data }) => {
  const record = terminals.get(id);
  if (!record || record.ownerId !== _event.sender.id) return { error: "Terminal is not owned by this window", code: "TERMINAL_NOT_OWNED" };
  record.pty.write(data);
  return { ok: true };
});

ipcMain.handle("terminal:resize", (_event, { id, cols, rows }) => {
  const record = terminals.get(id);
  if (!record || record.ownerId !== _event.sender.id) return { error: "Terminal is not owned by this window", code: "TERMINAL_NOT_OWNED" };
  try { record.pty.resize(cols, rows); } catch { /* ignore */ }
  return { ok: true };
});

ipcMain.handle("terminal:kill", (_event, { id }) => {
  const record = terminals.get(id);
  if (!record || record.ownerId !== _event.sender.id) return { error: "Terminal is not owned by this window", code: "TERMINAL_NOT_OWNED" };
  if (record) {
    try { record.pty.kill(); } catch { /* ignore */ }
    terminals.delete(id);
  }
  return { ok: true };
});

// ── Ollama Chat IPC ────────────────────────────────────────────────────────────

function parseToolArguments(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function includeThinkOption(thinking) {
  return typeof thinking === "boolean" || typeof thinking === "string";
}

/** Ollama expects tool_calls[].function.arguments as objects, not JSON strings. */
function sanitizeOllamaMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.map((msg) => {
    if (msg.role === "tool") {
      const out = { role: "tool", content: String(msg.content ?? "") };
      if (msg.tool_name) out.tool_name = msg.tool_name;
      if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
      return out;
    }

    if (!msg.tool_calls?.length) return msg;

    const tool_calls = msg.tool_calls
      .map((call) => {
        const fn = call?.function;
        if (!fn?.name) return null;

        const args = parseToolArguments(fn.arguments);
        if (!args) return null;

        return {
          id: call.id,
          type: call.type || "function",
          function: {
            ...(Number.isInteger(fn.index) ? { index: fn.index } : {}),
            name: fn.name,
            arguments: args,
          },
        };
      })
      .filter(Boolean);

    if (!tool_calls.length) {
      const { tool_calls: _removed, ...rest } = msg;
      return rest;
    }

    return { ...msg, tool_calls };
  });
}

function getOllamaBaseUrl() {
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  return host.replace(/\/$/, "");
}

function ollamaHostLabel(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.port || (url.protocol === "https:" ? "443" : "11434");
  } catch {
    return "11434";
  }
}

function parseOllamaTags(data) {
  const models = (data?.models ?? [])
    .map((m) => m.name || m.model)
    .filter(Boolean);
  return [...new Set(models)].sort();
}

function parseOllamaListStdout(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && /^[a-f0-9]{12,}$/i.test(parts[1])) {
        return parts[0];
      }
      return parts[0];
    })
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .sort();
}

async function fetchOllamaTags(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOllamaPs(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function estimateTokenCount(text) {
  if (!text) return 0;
  const value = String(text);
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const pieces = value.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || [];
  const symbolWeight = (value.match(/[{}()[\].,;:+\-*/=<>"'`|&!?]/g) || []).length * 0.15;
  const structuralOverhead = (value.match(/\n/g) || []).length * 0.35;
  return Math.max(1, Math.ceil(cjk + (pieces.length - cjk) * 1.05 + symbolWeight + structuralOverhead));
}

function serializeTokenPayload(messages = [], tools = []) {
  const safeMessages = sanitizeOllamaMessages(messages);
  return JSON.stringify({
    messages: safeMessages,
    tools: tools || [],
  });
}

/** List locally available Ollama models */
ipcMain.handle("ollama:list", async () => {
  const baseUrl = getOllamaBaseUrl();
  const host = ollamaHostLabel(baseUrl);
  let apiError = null;

  try {
    const { res, data } = await fetchOllamaTags(baseUrl);
    if (res.ok) {
      const models = parseOllamaTags(data);
      if (models.length) return { models, host };
      apiError = "No models found in Ollama.";
    } else {
      apiError = data?.error || `Ollama API error (${res.status})`;
    }
  } catch (err) {
    apiError = err?.name === "AbortError"
      ? "Ollama API timed out."
      : (err?.message || "Cannot reach Ollama API.");
  }

  try {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync("ollama list", {
      windowsHide: true,
      timeout: 8000,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    const models = parseOllamaListStdout(stdout);
    if (models.length) return { models, host };
    return { error: apiError || "No models found. Run ollama pull <model>." };
  } catch (err) {
    return { error: apiError || err?.message || "Cannot reach Ollama. Is it running?" };
  }
});

ipcMain.handle("ollama:runtime", async (_event, { model } = {}) => {
  if (!model) return { ok: false, error: "Missing model name." };

  try {
    const { res, data } = await fetchOllamaPs(getOllamaBaseUrl());
    if (!res.ok) {
      return { ok: false, error: data?.error || `Ollama API error (${res.status})` };
    }

    const models = Array.isArray(data?.models) ? data.models : [];
    const entry = models.find((item) => item?.model === model || item?.name === model);
    if (!entry) return { ok: true, loaded: false };

    const size = Number(entry.size);
    const sizeVram = Number(entry.size_vram);
    const gpuRatio = size > 0 && Number.isFinite(sizeVram)
      ? Math.max(0, Math.min(sizeVram / size, 1))
      : null;

    return {
      ok: true,
      loaded: true,
      model: entry.model || entry.name || model,
      contextLength: Number(entry.context_length) || null,
      size,
      sizeVram,
      gpuRatio,
      fullyGpu: Number.isFinite(gpuRatio) ? gpuRatio >= 0.98 : null,
      details: entry.details || {},
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Cannot reach Ollama runtime." };
  }
});

ipcMain.handle("ollama:countTokens", async (_event, { model, messages = [], tools = [] } = {}) => {
  const prompt = serializeTokenPayload(messages, tools);
  const fallback = estimateTokenCount(prompt) + (Array.isArray(messages) ? messages.length * 4 : 0);

  if (!model) return { ok: true, count: fallback, source: "estimate" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${getOllamaBaseUrl()}/api/tokenize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const count = Array.isArray(data?.tokens)
        ? data.tokens.length
        : Number(data?.count ?? data?.token_count);
      if (Number.isFinite(count) && count > 0) {
        return { ok: true, count, source: "ollama" };
      }
    }
  } catch {
    /* older Ollama builds may not expose tokenization */
  }

  return { ok: true, count: fallback, source: "estimate" };
});

ipcMain.handle("ollama:summarizeContext", async (_event, payload = {}) => {
  const model = String(payload.model || "").trim();
  if (!model) return { ok: false, error: "Select a model before summarizing context." };

  const contextTokens = Math.max(2048, Math.min(Number(payload.contextBudget) || 4096, 16384));
  const maxChars = ContextMemory.summaryCharLimit(contextTokens);
  const transcript = ContextMemory.buildMemoryTranscript(
    payload.previousSummary || "",
    payload.messages || [],
    { contextTokens },
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: ContextMemory.SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
        options: {
          num_ctx: contextTokens,
          num_predict: Math.max(420, Math.min(1200, Math.ceil(maxChars / 3))),
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Context summarization failed (${res.status})${detail ? `: ${detail}` : ""}` };
    }

    const data = await res.json();
    const rawSummary = data?.message?.content || data?.response || "";
    const summary = ContextMemory.normalizeSummary(rawSummary, maxChars);
    if (summary.length < 40) {
      return { ok: false, error: "The model returned an empty or unusable context summary." };
    }

    return {
      ok: true,
      summary,
      source: "model",
      summarizedMessages: Array.isArray(payload.messages) ? payload.messages.length : 0,
    };
  } catch (err) {
    const message = err?.name === "AbortError"
      ? "Context summarization timed out."
      : err?.message || "Context summarization failed.";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("ollama:abort", async (event) => {
  const controller = ollamaControllers.get(event.sender.id);
  if (controller) controller.abort();
  return { ok: true };
});

/** Stream chat tokens from Ollama back to the renderer. */
ipcMain.handle("ollama:chat", async (event, { messages, model, numCtx, thinking, tools }) => {
  const url = `${getOllamaBaseUrl()}/api/chat`;
  const mdl = model ?? "qwen2.5-coder:7b";
  const senderId = event.sender.id;
  const previous = ollamaControllers.get(senderId);
  if (previous) previous.abort();

  const controller = new AbortController();
  ollamaControllers.set(senderId, controller);

  const options = {};
  if (numCtx) options.num_ctx = numCtx;

  const body = {
    model: mdl,
    messages: sanitizeOllamaMessages(messages),
    stream: true,
    ...(Object.keys(options).length ? { options } : {}),
    ...(includeThinkOption(thinking) ? { think: thinking } : {}),
    ...(tools?.length ? { tools } : {}),
  };

  let res;
  let buffer = "";
  let fullText = "";
  let fullThinking = "";
  let toolCalls = [];
  let doneSent = false;

  const sendDone = (payload) => {
    if (doneSent || event.sender.isDestroyed()) return;
    doneSent = true;
    event.sender.send("ollama:done", payload);
  };

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      const payload = { fullText, toolCalls, thinking: fullThinking, aborted: true };
      sendDone(payload);
      if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Cannot reach Ollama at ${url}. Is it running?\n${err.message}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Ollama error: ${res.status} ${res.statusText}${detail ? `\n${detail}` : ""}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  function mergeToolCalls(existing, incoming) {
    if (!incoming?.length) return existing;
    const merged = existing.slice();

    for (const call of incoming) {
      const fn = call.function || {};
      const args = fn.arguments ?? {};
      const index = Number.isInteger(call.index)
        ? call.index
        : Number.isInteger(fn.index) ? fn.index : null;
      let targetIndex = index;

      if (targetIndex == null) {
        targetIndex = merged.findIndex((item) => {
          if (call.id && item.id === call.id) return true;
          return item.function?.name && fn.name && item.function.name === fn.name
            && JSON.stringify(item.function.arguments ?? {}) === JSON.stringify(args ?? {});
        });
        if (targetIndex < 0) targetIndex = merged.length;
      }

      const normalizedArgs = typeof args === "string" ? args : { ...(args || {}) };

      while (merged.length <= targetIndex) {
        merged.push({
          type: "function",
          function: { name: "", arguments: {} },
        });
      }

      const target = merged[targetIndex];
      if (call.id) target.id = call.id;
      if (call.type) target.type = call.type;
      if (fn.name) {
        target.function.name = fn.name;
      }
      if (index != null) {
        target.function.index = index;
      }

      if (typeof normalizedArgs === "string") {
        const prev = typeof target.function.arguments === "string" ? target.function.arguments : "";
        target.function.arguments = `${prev}${normalizedArgs}`;
      } else {
        const prev = typeof target.function.arguments === "object" && target.function.arguments
          ? target.function.arguments
          : {};
        target.function.arguments = { ...prev, ...normalizedArgs };
      }
    }

    return merged.filter((call) => call.function?.name);
  }

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        const msg = parsed.message ?? {};

        const thinkingToken = msg.thinking ?? "";
        if (thinkingToken) {
          fullThinking += thinkingToken;
          event.sender.send("ollama:thinking", thinkingToken);
        }

        const token = msg.content ?? "";
        if (token) {
          fullText += token;
          event.sender.send("ollama:token", token);
        }

        if (msg.tool_calls?.length) {
          toolCalls = mergeToolCalls(toolCalls, msg.tool_calls);
          event.sender.send("ollama:toolcall", toolCalls);
        }

        if (parsed.done) {
          const payload = { fullText, toolCalls, thinking: fullThinking };
          sendDone(payload);
          return { ok: true, fullText, toolCalls, thinking: fullThinking };
        }
      } catch {
        // partial line – wait for next chunk
      }
    }
  }

  const payload = { fullText, toolCalls, thinking: fullThinking };
  sendDone(payload);
  return { ok: true, fullText, toolCalls, thinking: fullThinking };
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      const payload = { fullText, toolCalls, thinking: fullThinking, aborted: true };
      sendDone(payload);
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    return { error: err?.message || "Ollama stream failed." };
  } finally {
    if (ollamaControllers.get(senderId) === controller) {
      ollamaControllers.delete(senderId);
    }
  }
});

function mergeAgentToolCalls(existing, incoming) {
  if (!incoming?.length) return existing;
  const merged = existing.slice();

  for (const call of incoming) {
    const fn = call.function || {};
    const args = fn.arguments ?? {};
    const index = Number.isInteger(call.index)
      ? call.index
      : Number.isInteger(fn.index) ? fn.index : null;
    let targetIndex = index;

    if (targetIndex == null) {
      targetIndex = merged.findIndex((item) => {
        if (call.id && item.id === call.id) return true;
        return item.function?.name && fn.name && item.function.name === fn.name
          && JSON.stringify(item.function.arguments ?? {}) === JSON.stringify(args ?? {});
      });
      if (targetIndex < 0) targetIndex = merged.length;
    }

    const normalizedArgs = typeof args === "string" ? args : { ...(args || {}) };

    while (merged.length <= targetIndex) {
      merged.push({
        type: "function",
        function: { name: "", arguments: {} },
      });
    }

    const target = merged[targetIndex];
    if (call.id) target.id = call.id;
    if (call.type) target.type = call.type;
    if (fn.name) target.function.name = fn.name;
    if (index != null) target.function.index = index;

    if (typeof normalizedArgs === "string") {
      const prev = typeof target.function.arguments === "string" ? target.function.arguments : "";
      target.function.arguments = `${prev}${normalizedArgs}`;
    } else {
      const prev = typeof target.function.arguments === "object" && target.function.arguments
        ? target.function.arguments
        : {};
      target.function.arguments = { ...prev, ...normalizedArgs };
    }
  }

  return merged.filter((call) => call.function?.name);
}

async function runOllamaAgentRound(senderId, { messages, model, numCtx, thinking, tools }, hooks = {}) {
  const url = `${getOllamaBaseUrl()}/api/chat`;
  const mdl = model ?? "qwen2.5-coder:7b";
  const previous = ollamaControllers.get(senderId);
  if (previous) previous.abort();

  const controller = new AbortController();
  ollamaControllers.set(senderId, controller);

  const options = {};
  if (numCtx) options.num_ctx = numCtx;

  const body = {
    model: mdl,
    messages: sanitizeOllamaMessages(messages),
    stream: true,
    ...(Object.keys(options).length ? { options } : {}),
    ...(includeThinkOption(thinking) ? { think: thinking } : {}),
    ...(tools?.length ? { tools } : {}),
  };

  let res;
  let buffer = "";
  let fullText = "";
  let fullThinking = "";
  let toolCalls = [];

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    return { error: `Cannot reach Ollama at ${url}. Is it running?\n${err.message}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Ollama error: ${res.status} ${res.statusText}${detail ? `\n${detail}` : ""}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const msg = parsed.message ?? {};

          const thinkingToken = msg.thinking ?? "";
          if (thinkingToken) {
            fullThinking += thinkingToken;
            hooks.onThinking?.(thinkingToken);
          }

          const token = msg.content ?? "";
          if (token) {
            fullText += token;
            hooks.onToken?.(token);
          }

          if (msg.tool_calls?.length) {
            toolCalls = mergeAgentToolCalls(toolCalls, msg.tool_calls);
            hooks.onToolCalls?.(toolCalls);
          }

          if (parsed.done) {
            return { ok: true, fullText, toolCalls, thinking: fullThinking };
          }
        } catch {
          // partial line, wait for next chunk
        }
      }
    }

    return { ok: true, fullText, toolCalls, thinking: fullThinking };
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    return { error: err?.message || "Ollama stream failed." };
  } finally {
    if (ollamaControllers.get(senderId) === controller) {
      ollamaControllers.delete(senderId);
    }
  }
}

ipcMain.handle("agent:run", async (event, payload) => {
  const sender = event.sender;
  const sendAgentEvent = (data) => {
    if (!sender.isDestroyed()) sender.send("agent:event", data);
  };
  let assessmentRun = null;
  if (payload.workspace) {
    const agentProfile = normalizeProfile(payload.modeFamily || "assist", payload.mode || "executor");
    const runResult = assessmentWorkspace.createRun(payload.workspace, {
      profile: `${agentProfile.family}:${agentProfile.key}`,
      status: "running",
      operator: "local-user",
    });
    if (runResult?.ok) assessmentRun = runResult.run;
  }
  const result = await runAgentTurn({
    workspace: payload.workspace,
    model: payload.model,
    numCtx: payload.numCtx,
    contextBudget: payload.contextBudget,
    thinking: payload.thinking,
    tools: payload.tools || [],
    mode: payload.mode || "agent",
    modeFamily: payload.modeFamily || "assist",
    approvalGranted: Boolean(payload.approvalGranted),
    authority: payload.authority || null,
    runId: assessmentRun?.id || "",
    chatHistory: payload.chatHistory || [],
    contextSummary: payload.contextSummary || "",
    dirMap: payload.dirMap || "",
    activeFile: payload.activeFile || null,
    extraFiles: payload.extraFiles || [],
    userMessage: payload.userMessage || "",
    sendEvent: sendAgentEvent,
    runModelRound: (roundPayload) => runOllamaAgentRound(event.sender.id, roundPayload),
    executeToolCall: ({ workspace, toolCall }) => toolExecutor.executeToolCall({ workspace, toolCall }),
    findWorkspaceFiles,
    searchWorkspaceIndex,
  });
  if (assessmentRun?.id) {
    assessmentWorkspace.updateRun(payload.workspace, assessmentRun.id, {
      status: result?.aborted ? "stopped" : result?.ok ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      stopReason: result?.aborted ? "Aborted by operator" : result?.error || "",
      notes: String(result?.finalText || result?.error || "").slice(0, 2000),
    });
  }
  return result;
});
