const { app, BrowserWindow, WebContentsView, ipcMain: electronIpcMain, dialog, Menu, shell, session, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const { pathToFileURL } = require("url");
const pty = require("node-pty");
const { spawn } = require("child_process");
const { createToolHandlers } = require("../../adapters/tools/core/tool-handlers");
const ToolMap = require("../../adapters/tools/core/tool-catalog");
const { createAgentTerminalRunner } = require("../../adapters/tools/os/terminal-runner");
const { createSubagentRunner } = require("../../adapters/tools/cyber/subagent-runner");
const { resolveSecurityExecutable } = require("../../adapters/tools/cyber/executable-resolver");
const { createAssessmentWorkspace, validateCustomEntryPath, JSON_TEMPLATES } = require("../../domain/assessment/assessment-workspace");
const { createAssessmentMap } = require("../../domain/assessment/assessment-map");
const { buildIntruderRequests, createSecurityHttpWorkbench } = require("../../domain/assessment/http-workbench");
const { createProxyListenerService } = require("../../domain/assessment/proxy-listener");
const { runAgentTurn } = require("../../application/agent/controller");
const { normalizeProfile } = require("../../application/policies/operating-modes");
const { loadPolicy, evaluateAction } = require("../../application/policies/policy-engine");
const ScopeEngine = require("../../domain/assessment/scope-engine");
const AgentVerifier = require("../../application/clarification/verifier");
const { captureOllamaStream } = require("../../adapters/llm/ollama/ollama-stream");
const { captureOpenRouterStream, normalizeOpenRouterMessages, openRouterHeaders, openRouterTools } = require("../../adapters/llm/openrouter/openrouter-stream");
const { DEFAULT_OPENROUTER_BASE_URL, normalizeProvider, normalizeBaseUrl, buildChatRequest } = require("../../adapters/llm/openrouter/providers");
const ContextBudget = require("../../adapters/llm/context-budget");
const { estimateTokenCount } = ContextBudget;
const { appendAgentAction, appendHypothesis } = require("../../application/agent/memory/action-log");
const ContextMemory = require("../../application/agent/memory/context-memory");
const { createChatSessionStore } = require("../../app/services/chat-session-store");
const { createWorkspaceFiles } = require("../../app/services/workspace-files");
const { createProjectProfileStore } = require("../../domain/project/project-profile-store");
const { validateIpcRequest } = require("../../contracts/ipc/IpcContracts");
const { registerIpcHandler } = require("./ipc/register");
const { parseCommand, runCommand } = require("../../automation/commands/command-parser");
const { ingest: ingestAssessmentRecords, listDatasets, datasetExists, RESOURCE_SPECS } = require("../../automation/commands/assessment-ingest");
const { buildContext } = require("../../automation/context/parse-context");
const {
  GUIDANCE_EXTENSIONS,
  MAX_GUIDANCE_FILE_BYTES,
  formatWorkspaceGuidance,
  guidancePathInfo,
  listGuidanceEntries,
  normalizeKind: normalizeGuidanceKind,
  readGuidanceEntry,
  writeGuidanceFile,
} = require("../../application/planning/custom-guidance");
const { createContainer } = require("../../infrastructure/di/container");

const APP_ROOT = path.join(__dirname, "..", "..");
const IS_DEV = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const APP_INDEX_PATH = path.join(__dirname, "..", "..", "presentation", "ui", "index.html");
const APP_INDEX_URL = pathToFileURL(APP_INDEX_PATH).href;

let mainWindow;
// DI container owns the state maps so dispose() cleans up exactly the live
// resources. The presentation shell references the container's maps.
const container = createContainer({
  app,
  safeStorage,
  getMainWindow: () => mainWindow,
});
const terminals = container.terminals;
const toolProcesses = container.toolProcesses;
const ollamaControllers = container.ollamaControllers;
const llmControllers = ollamaControllers;
const pendingAgentApprovals = container.pendingAgentApprovals;
const pendingOperatorQuestions = container.pendingOperatorQuestions;
const webClonePreviewDocuments = container.webClonePreviewDocuments;
const webClonePreviewState = container.webClonePreviewState;
let webClonePreviewServer = webClonePreviewState.server;
let webClonePreviewServerPromise = webClonePreviewState.serverPromise;
let webClonePreviewPort = webClonePreviewState.port;
let webClonePreviewView = webClonePreviewState.view;
let webClonePreviewUrl = webClonePreviewState.url;
let toolProcessCounter = webClonePreviewState.processCounter;
let projectProfiles = null;

function syncWebClonePreviewState() {
  webClonePreviewState.server = webClonePreviewServer;
  webClonePreviewState.serverPromise = webClonePreviewServerPromise;
  webClonePreviewState.port = webClonePreviewPort;
  webClonePreviewState.view = webClonePreviewView;
  webClonePreviewState.url = webClonePreviewUrl;
  webClonePreviewState.processCounter = toolProcessCounter;
}
const workspaceSearch = container.workspaceSearch;
const {
  resolveWorkspaceTarget,
  editWorkspaceFile,
  deleteWorkspaceFile,
  transferWorkspacePath,
} = container;
const { listProjectFiles } = container;
const webResearch = container.webResearch;
const webClone = container.webClone;
const assessmentWorkspace = container.assessmentWorkspace;
const assessmentMap = container.assessmentMap;
const securityHttpWorkbench = container.securityHttpWorkbench;
const proxyListener = container.getProxyListener();
const workspaceWatchers = new Map();
const workspaceWatchTimers = new Map();

function projectProfileStore() {
  return container.projectProfileStore();
}

function readProjectProfile(root) {
  if (!root) return null;
  const result = projectProfileStore().read(root);
  return result?.error ? null : result;
}

function effectiveProjectRuntimeSettings(root, authorityOverride = null) {
  const legacy = assessmentWorkspace.readSettings(root);
  const settings = legacy?.settings
    ? JSON.parse(JSON.stringify(legacy.settings))
    : JSON.parse(JSON.stringify(JSON_TEMPLATES["settings.config"]));
  const profile = readProjectProfile(root)?.profile;
  if (authorityOverride && typeof authorityOverride === "object") settings.authority = authorityOverride;
  if (!profile) return settings;
  const rules = profile.rulesOfEngagement || {};
  const review = profile.review || {};
  const authorization = profile.authorization || {};
  settings.authorization = {
    ...settings.authorization,
    confirmed: Boolean(authorization.confirmed),
    authorizedBy: authorization.authorizedBy || "",
    authorizationReference: authorization.authorizationReference || "",
    signedAt: authorization.signedAt || "",
    expiresAt: authorization.expiresAt || "",
  };
  settings.authorizationGate = {
    ...settings.authorizationGate,
    authorizationConfirmed: Boolean(authorization.confirmed),
    scopeReviewed: Boolean(review.scopeReviewed && review.exclusionsConfirmed),
    rulesAccepted: Boolean(review.rulesAccepted),
    allowActiveRecon: Boolean(rules.allowActiveRecon),
    allowAutomatedScanning: Boolean(rules.allowAutomatedScanning),
    allowExploitValidation: Boolean(rules.allowExploitValidation),
  };
  settings.requests = {
    ...settings.requests,
    timeoutSeconds: Number(rules.requestTimeoutSeconds) || settings.requests.timeoutSeconds,
  };
  return settings;
}

function effectiveOperatorRuntimeSettings(root) {
  const settings = effectiveProjectRuntimeSettings(root);
  settings.authority = {
    ...(settings.authority || {}),
    superMode: "full",
  };
  return settings;
}

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

function llmPreferences() { return readApplicationPreferences()?.llm || {}; }
function getActiveProvider() { return normalizeProvider(llmPreferences().provider); }
function getOpenRouterBaseUrl() { try { return normalizeBaseUrl(llmPreferences().openrouter?.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL); } catch { return DEFAULT_OPENROUTER_BASE_URL; } }
function getOpenRouterApiKey() { const env = String(process.env.OPENROUTER_API_KEY || "").trim(); if (env) return env; const value = llmPreferences().openrouter?.apiKey; if (!value || !safeStorage.isEncryptionAvailable()) return ""; try { return safeStorage.decryptString(Buffer.from(value, "base64")); } catch { return ""; } }
function llmSettingsSnapshot() { const preferences = readApplicationPreferences(); const ollama = preferences.ollama || {}; const openrouter = preferences.llm?.openrouter || {}; const provider = getActiveProvider(); const key = getOpenRouterApiKey(); const source = provider === "openrouter" ? (process.env.OPENROUTER_API_KEY ? "environment" : key ? "settings" : "none") : (process.env.OLLAMA_HOST ? "environment" : ollama.host ? "settings" : "default"); return { provider, ollama: { host: ollama.host || "", activeBaseUrl: getOllamaBaseUrl(), source: process.env.OLLAMA_HOST ? "environment" : ollama.host ? "settings" : "default" }, openrouter: { baseUrl: getOpenRouterBaseUrl(), hasApiKey: Boolean(key), source: process.env.OPENROUTER_API_KEY ? "environment" : key ? "settings" : "none", model: String(openrouter.model || "") }, hasApiKey: Boolean(key), source }; }
function saveLlmSettings(payload = {}) { const preferences = readApplicationPreferences(); const provider = normalizeProvider(payload.provider || preferences.llm?.provider); const llm = { ...(preferences.llm || {}), provider, openrouter: { ...(preferences.llm?.openrouter || {}) } }; if (payload.baseUrl !== undefined) llm.openrouter.baseUrl = normalizeBaseUrl(payload.baseUrl); if (payload.model !== undefined) llm.openrouter.model = String(payload.model || "").trim(); if (payload.apiKey !== undefined) { const key = String(payload.apiKey || "").trim(); if (key) { if (!safeStorage.isEncryptionAvailable()) return { error: "Secure storage is unavailable; use OPENROUTER_API_KEY for this session.", code: "OPENROUTER_KEY_NOT_PERSISTED" }; llm.openrouter.apiKey = safeStorage.encryptString(key).toString("base64"); } else delete llm.openrouter.apiKey; } preferences.llm = llm; writeApplicationPreferences(preferences); return llmSettingsSnapshot(); }
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
  return container.config.defaultCentralCaDirectory();
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
  return container.resolveCentralCaDirectory(assessmentRoot);
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
  return container.terminateProcessTree(child);
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
    return registerIpcHandler(electronIpcMain, channel, (event, ...args) => {
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
  return container.chatSessionStore();
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

function availableTerminalShells() {
  const candidates = process.platform === "win32"
    ? [
        { id: "powershell", label: "Windows PowerShell", path: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") },
        { id: "pwsh", label: "PowerShell", path: path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe") },
        { id: "cmd", label: "Command Prompt", path: process.env.COMSPEC || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe") },
        { id: "git-bash", label: "Git Bash", path: path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe") },
      ]
    : [
        { id: "bash", label: "bash", path: "/bin/bash" },
        { id: "zsh", label: "zsh", path: "/bin/zsh" },
        { id: "fish", label: "fish", path: "/usr/bin/fish" },
        { id: "sh", label: "sh", path: "/bin/sh" },
      ];
  const seen = new Set();
  const profiles = candidates.filter((profile) => {
    const key = path.resolve(profile.path).toLowerCase();
    if (seen.has(key) || !fs.existsSync(profile.path)) return false;
    seen.add(key);
    return true;
  });
  const configured = getDefaultShell();
  if (path.isAbsolute(configured) && fs.existsSync(configured)) {
    const key = path.resolve(configured).toLowerCase();
    if (!seen.has(key)) profiles.unshift({ id: "configured", label: getShellName(configured), path: configured });
  }
  const defaultPath = path.isAbsolute(configured) ? path.resolve(configured).toLowerCase() : "";
  const defaultProfile = profiles.find((profile) => path.resolve(profile.path).toLowerCase() === defaultPath) || profiles[0];
  return profiles.map((profile) => ({ ...profile, default: profile.id === defaultProfile?.id }));
}

function resolveTerminalShell(profileId = "") {
  const profiles = availableTerminalShells();
  return profiles.find((profile) => profile.id === profileId) || profiles.find((profile) => profile.default) || profiles[0] || {
    id: "default",
    label: getShellName(getDefaultShell()),
    path: getDefaultShell(),
    default: true,
  };
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:menu", action);
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: "Project",
      submenu: [
        { label: "Create New Project...", click: () => sendMenuAction("create-project") },
        { label: "Open Existing Project...", click: () => sendMenuAction("open-project") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Search",
      submenu: [
        { label: "Open Workspace File...", accelerator: "CmdOrCtrl+P", click: () => sendMenuAction("quick-open") },
        { label: "Search Project...", accelerator: "CmdOrCtrl+Shift+F", click: () => sendMenuAction("workspace-search") },
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
    title: "XEKUTE",
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload.js"),
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
    console.error("XEKUTE renderer exited unexpectedly:", details?.reason || "unknown");
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
      syncWebClonePreviewState();
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      webClonePreviewServer = server;
      webClonePreviewPort = typeof address === "object" && address ? address.port : 0;
      webClonePreviewServerPromise = null;
      syncWebClonePreviewState();
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
  syncWebClonePreviewState();
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
  syncWebClonePreviewState();
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
  container.dispose();
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

ipcMain.handle("project-profile:get", async (_event, { path: projectPath } = {}) => {
  return projectProfileStore().read(projectPath);
});

ipcMain.handle("project-profile:save", async (_event, { path: projectPath, profile } = {}) => {
  return projectProfileStore().save(projectPath, profile);
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

ipcMain.handle("fs:copyPath", async (_event, { workspace, source, destination } = {}) => {
  return transferWorkspacePath(workspace, source, destination);
});

ipcMain.handle("fs:movePath", async (_event, { workspace, source, destination } = {}) => {
  return transferWorkspacePath(workspace, source, destination, { move: true });
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
  const profile = normalizeProfile(run?.profile || "planner");
  if (profile.family === "testing" && profile.key === "agent") {
    const policy = loadPolicy(assessmentPath, null, readProjectProfile(assessmentPath)?.profile || null);
    if (!policy.authorizationConfirmed) return { error: "Authorization must be confirmed before starting an active run.", code: "AUTHORIZATION_REQUIRED" };
    if (!policy.scopeReviewed) return { error: "Scope must be reviewed before starting an active run.", code: "SCOPE_REVIEW_REQUIRED" };
    if (!policy.rulesAccepted) return { error: "Rules of Engagement must be accepted before starting an active run.", code: "ROE_ACCEPTANCE_REQUIRED" };
    if (!policy.allowActiveTesting) return { error: "Active testing is disabled in the assessment policy.", code: "POLICY_ACTIVE_DISABLED" };
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
  return assessmentMap.read(assessmentPath, { operatorInitiated: true });
});

ipcMain.handle("assessment:buildMap", async (_event, { path: assessmentPath } = {}) => {
  return assessmentMap.build(assessmentPath, { operatorInitiated: true });
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
    syncWebClonePreviewState();
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
  const legacy = assessmentWorkspace.readSettings(assessmentPath);
  if (!legacy?.error) return legacy;
  const project = projectProfileStore().read(assessmentPath);
  if (project?.error) return legacy;
  return {
    ok: true,
    root: project.root,
    settings: effectiveProjectRuntimeSettings(project.root),
    virtual: true,
  };
});

ipcMain.handle("assessment:writeSettings", async (_event, { path: assessmentPath, settings } = {}) => {
  return assessmentWorkspace.writeSettings(assessmentPath, settings);
});

function safeAssessmentChild(root, relativePath) {
  const base = path.resolve(root || "");
  const target = path.resolve(base, String(relativePath || ""));
  return base && target !== base && target.startsWith(`${base}${path.sep}`) ? target : "";
}

function guidanceWorkspaceRoot(workspace) {
  const root = path.resolve(String(workspace || ""));
  try {
    return workspace && path.isAbsolute(root) && fs.existsSync(root) && fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function globalGuidanceRoot() {
  return app.getPath("userData");
}

function validateGuidancePath(relativePath) {
  return guidancePathInfo(relativePath);
}

function resolveGuidanceTarget(workspace, relativePath, scope = "project") {
  const selectedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const root = selectedScope === "global" ? globalGuidanceRoot() : guidanceWorkspaceRoot(workspace);
  if (!root) {
    return { error: selectedScope === "global" ? "Global guidance storage is unavailable" : "Open a project before managing guidance", code: "WORKSPACE_REQUIRED" };
  }
  const validated = validateGuidancePath(relativePath);
  if (validated.error) return validated;
  const target = path.resolve(root, ...validated.normalized.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Guidance files must stay inside the selected storage", code: "INVALID_GUIDANCE_PATH" };
  }
  if (guidancePathHasSymlink(root, target)) return { error: "Guidance paths cannot pass through symbolic links", code: "SYMLINK_NOT_ALLOWED" };
  return { ok: true, root, scope: selectedScope, target, ...validated };
}

function guidancePathHasSymlink(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return true;
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

ipcMain.handle("guidance:entries", async (_event, { workspace, scope = "all" } = {}) => {
  const selectedScope = String(scope || "all").toLowerCase();
  const root = guidanceWorkspaceRoot(workspace);
  if (selectedScope === "project" && !root) return { error: "Open a project before managing project guidance", code: "WORKSPACE_REQUIRED" };
  return { ok: true, entries: listGuidanceEntries({ workspace: root || "", globalRoot: globalGuidanceRoot(), scope: selectedScope }) };
});

ipcMain.handle("guidance:read", async (_event, { workspace, relativePath, scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isFile()) return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
  } catch {
    return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
  }
  const content = readGuidanceEntry(resolved.scope === "project" ? resolved.root : "", { relativePath: resolved.normalized, scope: resolved.scope }, { globalRoot: globalGuidanceRoot() });
  return content == null
    ? { error: "Guidance file could not be read", code: "GUIDANCE_READ_FAILED" }
    : { ok: true, content, path: resolved.target, relativePath: resolved.normalized, kind: resolved.kind, scope: resolved.scope };
});

ipcMain.handle("guidance:context", async (_event, { workspace } = {}) => {
  const root = guidanceWorkspaceRoot(workspace);
  return { ok: true, context: formatWorkspaceGuidance(root || "", undefined, { globalRoot: globalGuidanceRoot() }) };
});

ipcMain.handle("guidance:save", async (_event, { workspace, relativePath, content = "", scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  const value = String(content);
  if (Buffer.byteLength(value, "utf8") > MAX_GUIDANCE_FILE_BYTES) return { error: "Guidance files are limited to 100 KB", code: "GUIDANCE_TOO_LARGE" };
  try {
    if (fs.existsSync(resolved.target) && !fs.statSync(resolved.target).isFile()) return { error: "A folder already exists at that path", code: "GUIDANCE_PATH_CONFLICT" };
    fs.mkdirSync(path.join(resolved.root, ".xekute"), { recursive: true });
    fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
    fs.writeFileSync(resolved.target, value, "utf8");
    return { ok: true, relativePath: resolved.normalized, kind: resolved.kind, scope: resolved.scope };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_WRITE_FAILED" };
  }
});

ipcMain.handle("guidance:import", async (_event, { workspace, kind, scope = "project" } = {}) => {
  const selectedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const root = selectedScope === "global" ? globalGuidanceRoot() : guidanceWorkspaceRoot(workspace);
  if (!root) return { error: "Open a project before importing project guidance", code: "WORKSPACE_REQUIRED" };
  const selectedKind = normalizeGuidanceKind(kind);
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: `Import ${selectedKind.slice(0, -1)} guidance`,
    buttonLabel: "Import guidance",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Guidance files", extensions: ["md", "markdown", "txt", "yaml", "yml", "json"] }],
  });
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true };
  const imported = [];
  try {
    for (const source of picked.filePaths.slice(0, 20)) {
      const stat = fs.statSync(source);
      const extension = path.extname(source).toLowerCase();
      if (!stat.isFile() || stat.size > MAX_GUIDANCE_FILE_BYTES || !GUIDANCE_EXTENSIONS.has(extension)) continue;
      const original = path.basename(source).replace(/[<>:"|?*\x00-\x1f]/g, "_");
      const baseName = original || `guidance-${Date.now()}.md`;
      let candidate = path.posix.join(".xekute", selectedKind, baseName);
      let target = path.resolve(root, ...candidate.split("/"));
      let suffix = 2;
      while (fs.existsSync(target)) {
        const parsed = path.parse(baseName);
        candidate = path.posix.join(".xekute", selectedKind, `${parsed.name}-${suffix}${parsed.ext}`);
        target = path.resolve(root, ...candidate.split("/"));
        suffix += 1;
      }
      const validated = validateGuidancePath(candidate);
      if (validated.error) continue;
      if (guidancePathHasSymlink(root, target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      imported.push(validated.normalized);
    }
    return { ok: true, paths: imported, entries: listGuidanceEntries({ workspace: selectedScope === "project" ? root : "", globalRoot: globalGuidanceRoot(), scope: selectedScope }) };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_IMPORT_FAILED" };
  }
});

ipcMain.handle("guidance:delete", async (_event, { workspace, relativePath, scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target)) return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
    if (!fs.statSync(resolved.target).isFile()) return { error: "Only guidance files can be deleted here", code: "GUIDANCE_NOT_FILE" };
    fs.unlinkSync(resolved.target);
    return { ok: true, relativePath: resolved.normalized, scope: resolved.scope };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_DELETE_FAILED" };
  }
});

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
  const output = path.join(verification.root, "pen_context.md");
  const sourceRoot = path.join(verification.root, "context", "sources");
  const imported = picked.filePaths.map((source, index) => {
    const safeName = path.basename(source).replace(/[^\w.() -]/g, "_");
    let target = path.join(sourceRoot, safeName);
    if (fs.existsSync(target)) target = path.join(sourceRoot, `${path.parse(safeName).name}-${Date.now()}-${index}${path.extname(safeName)}`);
    fs.copyFileSync(source, target);
    return target;
  });
  try {
    const details = buildContext({ output, files: imported });
    return { ok: true, path: output, ...details };
  } catch (error) {
    return { error: error.message || "Context extraction failed", code: "CONTEXT_BUILD_FAILED" };
  }
});

ipcMain.handle("security:httpRequest", async (_event, payload = {}) => {
  const project = readProjectProfile(payload.assessmentPath);
  return securityHttpWorkbench.run({
    ...payload,
    projectProfile: project?.profile || null,
    runtimeSettings: effectiveOperatorRuntimeSettings(payload.assessmentPath),
  });
});

ipcMain.handle("security:buildIntruder", async (_event, payload = {}) => {
  const maxRequests = Math.max(1, Math.min(Number(payload.maxRequests) || 25, 25));
  return buildIntruderRequests(payload.rawRequest, payload.payloadSets, payload.attackType, maxRequests);
});

ipcMain.handle("proxy:configure", async (_event, { assessmentPath } = {}) => {
  const project = readProjectProfile(assessmentPath);
  return proxyListener.configure(assessmentPath, {
    settings: assessmentPath ? effectiveOperatorRuntimeSettings(assessmentPath) : null,
    targets: project?.profile?.scope?.inScopeTargets || null,
  });
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
    title: "Choose XEKUTE CA storage folder",
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
  if (assessmentPath) {
    const project = readProjectProfile(assessmentPath);
    await proxyListener.configure(assessmentPath, {
      settings: effectiveProjectRuntimeSettings(assessmentPath),
      targets: project?.profile?.scope?.inScopeTargets || null,
    });
  }
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesReset", async (_event, { assessmentPath = "" } = {}) => {
  const preferences = readApplicationPreferences();
  preferences.certificates = { ...(preferences.certificates || {}), caDirectory: "" };
  writeApplicationPreferences(preferences);
  await proxyListener.stop();
  if (assessmentPath) {
    const project = readProjectProfile(assessmentPath);
    await proxyListener.configure(assessmentPath, {
      settings: effectiveProjectRuntimeSettings(assessmentPath),
      targets: project?.profile?.scope?.inScopeTargets || null,
    });
  }
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesShow", async () => {
  const snapshot = certificateSettingsSnapshot();
  fs.mkdirSync(snapshot.directory, { recursive: true, mode: 0o700 });
  const error = await shell.openPath(snapshot.directory);
  return error ? { error, code: "CA_DIRECTORY_OPEN_FAILED" } : snapshot;
});

ipcMain.handle("settings:llmGet", async () => llmSettingsSnapshot());
ipcMain.handle("settings:llmSet", async (_event, payload = {}) => { try { return saveLlmSettings(payload); } catch (error) { return { error: error.message || "Invalid LLM settings.", code: "LLM_SETTINGS_INVALID" }; } });
ipcMain.handle("settings:llmTest", async () => {
  if (getActiveProvider() === "openrouter") {
    try { const response = await openRouterFetch("/models"); const data = await response.json(); return response.ok ? { ok: true, provider: "openrouter", modelCount: Array.isArray(data?.data) ? data.data.length : 0 } : { error: data?.error?.message || `OpenRouter error: ${response.status}`, code: "OPENROUTER_TEST_FAILED" }; }
    catch (error) { return { error: error.message, code: error.code || "OPENROUTER_TEST_FAILED" }; }
  }
  const baseUrl = getOllamaBaseUrl();
  try { const { res, data } = await fetchOllamaTags(baseUrl); return res.ok ? { ok: true, provider: "ollama", modelCount: parseOllamaTags(data).length } : { error: data?.error || `Ollama API error (${res.status})`, code: "OLLAMA_TEST_FAILED" }; }
  catch (error) { return { error: error?.message || "Cannot reach Ollama.", code: "OLLAMA_TEST_FAILED" }; }
});

ipcMain.handle("settings:ollamaGet", async () => ollamaSettingsSnapshot());

ipcMain.handle("settings:ollamaSet", async (_event, { host = "" } = {}) => {
  const preferences = readApplicationPreferences();
  const trimmed = String(host || "").trim();
  if (!trimmed) {
    preferences.ollama = { ...(preferences.ollama || {}), host: "" };
    writeApplicationPreferences(preferences);
    return ollamaSettingsSnapshot();
  }
  try {
    const normalized = normalizeOllamaHostInput(trimmed);
    preferences.ollama = { ...(preferences.ollama || {}), host: normalized };
    writeApplicationPreferences(preferences);
    return ollamaSettingsSnapshot();
  } catch (err) {
    return { error: err.message || "Invalid Ollama host URL.", code: "OLLAMA_HOST_INVALID" };
  }
});

ipcMain.handle("settings:ollamaTest", async () => {
  const baseUrl = getOllamaBaseUrl();
  try {
    const { res, data } = await fetchOllamaTags(baseUrl);
    if (!res.ok) return { error: data?.error || `Ollama API error (${res.status})`, code: "OLLAMA_TEST_FAILED" };
    const models = parseOllamaTags(data);
    return { ok: true, host: ollamaHostLabel(baseUrl), models, modelCount: models.length };
  } catch (err) {
    return {
      error: err?.name === "AbortError" ? "Ollama API timed out." : (err?.message || "Cannot reach Ollama API."),
      code: "OLLAMA_TEST_FAILED",
    };
  }
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

function takeLimited(text, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

function buildWorkspaceIndex(workspace) {
  return workspaceSearch.buildWorkspaceIndex(workspace);
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
    let settled = false;
    let timeoutFallback = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timeoutFallback) clearTimeout(timeoutFallback);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      timeoutFallback = setTimeout(() => finish({
        ok: false,
        mode: "command",
        command,
        exitCode: null,
        signal: "TIMEOUT",
        timedOut: true,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      }), 1000);
    }, Math.max(1000, Math.min(timeoutMs, 120000)));

    child.stdout?.on("data", (chunk) => {
      stdout = takeLimited(stdout + chunk.toString(), 20000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = takeLimited(stderr + chunk.toString(), 12000);
    });
    child.on("error", (err) => finish({ error: err.message, command }));
    child.on("close", (exitCode, signal) => finish({
        ok: !timedOut && exitCode === 0,
        mode: "command",
        command,
        exitCode,
        signal,
        timedOut,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      }));
  });
}

function startWorkspaceProcess(workspace, command, ownerId = "agent") {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return resolved;
  if (!command?.trim()) return { error: "Empty command" };

  const id = `proc-${++toolProcessCounter}`;
  webClonePreviewState.processCounter = toolProcessCounter;
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
  const stdout = String(record.stdout || record.buffer || "").trimEnd();
  return {
    id: record.id,
    command: record.command,
    running: record.running,
    exitCode: record.exitCode,
    signal: record.signal,
    seconds: Number(((Date.now() - record.startedAt) / 1000).toFixed(1)),
    stdout,
    stderr: String(record.stderr || "").trimEnd(),
    terminalId: record.terminalId || (record.id ? String(record.id).replace(/^proc-/, "") : ""),
  };
}

function readToolProcess(id, ownerId = "agent") {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  if (record.ownerId !== ownerId) return { error: "Process is not owned by this caller", code: "PROCESS_NOT_OWNED" };
  return { ok: true, ...processSnapshot(record) };
}

function runWorkspaceProcessArgs(workspace, executable, args = [], { timeoutMs = 20000 } = {}) {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return Promise.resolve(resolved);
  if (!/^[a-z0-9_.-]+$/i.test(String(executable || "")) || !Array.isArray(args) || args.some((value) => typeof value !== "string" || /[\u0000\r\n]/.test(value))) {
    return Promise.resolve({ error: "Typed adapter produced invalid process arguments", code: "PROCESS_ARGUMENT_INVALID" });
  }
  return new Promise((resolve) => {
    const resolvedExecutable = resolveSecurityExecutable(executable);
    const child = spawn(resolvedExecutable, args, { cwd: resolved.root, shell: false, windowsHide: true, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutFallback = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timeoutFallback) clearTimeout(timeoutFallback);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      timeoutFallback = setTimeout(() => finish({
        ok: false,
        mode: "typed-process",
        executable,
        args,
        exitCode: null,
        signal: "TIMEOUT",
        timedOut: true,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      }), 1000);
    }, Math.max(1000, Math.min(timeoutMs, 120000)));
    child.stdout?.on("data", (chunk) => { stdout = takeLimited(stdout + chunk.toString(), 50000); });
    child.stderr?.on("data", (chunk) => { stderr = takeLimited(stderr + chunk.toString(), 50000); });
    child.on("error", (error) => { clearTimeout(timer); finish({ ok: false, error: error.message, code: error.code || "PROCESS_START_FAILED", executable, args }); });
    child.on("close", (exitCode, signal) => { clearTimeout(timer); finish({ ok: !timedOut && exitCode === 0, mode: "typed-process", executable, args, exitCode, signal, timedOut, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() }); });
  });
}

function stopToolProcess(id, ownerId = "agent") {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  if (record.ownerId !== ownerId) return { error: "Process is not owned by this caller", code: "PROCESS_NOT_OWNED" };
  if (record.running) {
    if (record.child?.kill) {
      try { record.child.kill(); } catch { /* ignore */ }
    } else if (record.child) {
      terminateProcessTree(record.child);
    }
    record.running = false;
  }
  return { ok: true, ...processSnapshot(record) };
}

const agentTerminalRunner = createAgentTerminalRunner({
  terminals,
  pty,
  resolveWorkspaceTarget,
  resolveTerminalShell,
  getShellArgs,
  takeLimited,
  toolProcesses,
  terminateProcessTree,
  resolveSecurityExecutable,
});

const subagentRunner = createSubagentRunner({
  toolProcesses,
  killProcess: (processId, ownerId) => agentTerminalRunner.stopProcess(processId, ownerId || "agent"),
  onComplete(snapshot) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const type = snapshot?.type || (snapshot?.kind === "subagent" ? "subagent_complete" : "terminal_complete");
      mainWindow.webContents.send("agent:event", { ...snapshot, type });
    }
  },
});

function createAgentTerminalHost(webContents, sendAgentEvent) {
  if (!webContents) return null;
  return {
    runCommand: (workspace, command, options = {}) => agentTerminalRunner.runCommand(webContents, workspace, command, { ...options, sendAgentEvent }),
    runExecutable: (workspace, executable, args, options = {}) => agentTerminalRunner.runExecutable(webContents, workspace, executable, args, { ...options, sendAgentEvent }),
    startProcess: (workspace, command, options = {}) => agentTerminalRunner.startProcess(webContents, workspace, command, {
      ...options,
      sendAgentEvent,
      ownerId: options.ownerId || String(webContents.id),
    }),
    stopProcess: (id, ownerId) => agentTerminalRunner.stopProcess(id, ownerId || String(webContents.id)),
  };
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
  runWorkspaceProcessArgs,
  startWorkspaceProcess,
  readToolProcess,
  stopToolProcess,
  listProjectFiles,
  searchWeb: webResearch.searchWeb,
  fetchWebPage: webResearch.fetchWebPage,
  assessmentMap,
  assessmentWorkspace,
  crypto,
  verifyFindingCandidate,
  ingestAssessmentRecords: runAssessmentIngestPython,
  listDatasets: (workspace) => listDatasets(workspace?.detectedRootId ?? workspace),
  writeGuidanceFile,
  globalGuidanceRoot,
  subagentRunner,
  openRouterApiKey: getOpenRouterApiKey,
});

const assessmentIngestQueues = new Map();

function runAssessmentIngestPython(payload = {}) {
  const key = path.resolve(String(payload.workspace || APP_ROOT));
  const previous = assessmentIngestQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      const resourcePath = RESOURCE_SPECS[payload.resource]?.path;
      const provision = payload.provision || (resourcePath ? JSON_TEMPLATES[resourcePath] : null) || null;
      return ingestAssessmentRecords({ ...payload, provision });
    } catch (error) {
      return { ok: false, error: error.message || "Assessment ingestion failed", code: error.code || "INGEST_FAILED" };
    }
  });
  assessmentIngestQueues.set(key, current);
  return current.finally(() => {
    if (assessmentIngestQueues.get(key) === current) assessmentIngestQueues.delete(key);
  });
}

function dispatchSlashCommand(action, payload = {}) {
  try {
    if (action === "parse") return Promise.resolve(parseCommand(payload.command, payload.overrides));
    if (action === "run") return runCommand(payload.command, payload.assessment, payload.overrides);
    return Promise.resolve({ ok: false, error: `Unknown command action: ${action}`, code: "COMMAND_ACTION_INVALID" });
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message || "Command runner failed", code: error.code || "COMMAND_RUNNER_FAILED" });
  }
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
  const executables = ["subfinder", "amass", "theHarvester", "httpx", "nmap", "naabu", "masscan", "ffuf", "katana", "gowitness", "gobuster", "nuclei", "nikto", "testssl", "sqlmap", "wafw00f", "hping3", process.platform === "win32" ? "tracert" : "traceroute"];
  const check = (executable) => new Promise((resolve) => {
    const resolvedExecutable = resolveSecurityExecutable(executable);
    const child = spawn(resolvedExecutable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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

ipcMain.handle("commands:parse", async (_event, payload = {}) => dispatchSlashCommand("parse", payload));

function configuredSlashTarget(policy = {}) {
  for (const entry of Array.isArray(policy.targets) ? policy.targets : []) {
    if (entry?.enabled === false || entry?.inScope === false) continue;
    const raw = String(typeof entry === "string" ? entry : entry?.value || entry?.url || entry?.host || entry?.hostname || "").trim();
    if (!raw || raw.startsWith("*.") || (/^[^/]+\/\d{1,2}$/.test(raw) && !raw.includes("://"))) continue;
    const target = ScopeEngine.canonicalTarget(raw);
    if (!target || !ScopeEngine.evaluateTarget(target, policy).allowed) continue;
    const defaultPort = target.scheme === "https" ? 443 : 80;
    return `${target.scheme}://${target.hostname}${target.port === defaultPort ? "" : `:${target.port}`}${target.path || "/"}`;
  }
  return "";
}

ipcMain.handle("commands:run", async (_event, payload = {}) => {
  const parsed = await dispatchSlashCommand("parse", payload);
  if (parsed?.error || parsed?.ok === false) return parsed;
  const modeFamily = String(payload.modeFamily || "xekute").toLowerCase();
  if (parsed?.role === "static") {
    const workspace = payload.assessment || payload.workspace || payload.path;
    if (!workspace) return { ok: false, error: "An assessment workspace is required", code: "WORKSPACE_REQUIRED" };
    const profile = normalizeProfile(modeFamily, payload.mode || "agent");
    const policy = loadPolicy(workspace, payload.authority || null, readProjectProfile(workspace)?.profile || null);
    const target = String(parsed.args?.[0] || configuredSlashTarget(policy));
    if (!target) return { ok: false, error: `No concrete target was supplied and ${parsed.command} could not derive one from Scope → In-Scope.`, code: "TARGET_REQUIRED", parsed };
    const runPayload = parsed.args?.length ? payload : { ...payload, command: `${parsed.command} ${target}` };
    const slashRunId = `slash-${Date.now().toString(36)}`;
    const hypothesisId = `${slashRunId}-hypothesis`;
    appendHypothesis(workspace, {
      id: hypothesisId,
      runId: slashRunId,
      title: `${parsed.command} operator-directed assessment hypothesis`,
      question: `What authorized attack-surface evidence does ${parsed.command} produce for the selected target?`,
      target,
      expectedSignal: "The configured adapters return target-specific observations that can be preserved and reviewed.",
      rejectingSignal: "The adapters return no target-specific observations or fail to complete.",
      proposedTechnique: String(parsed.command || "").replace(/^\//, ""),
      evidencePlan: ["Preserve per-tool output", "Record exit status and output path"],
      stopConditions: ["Out-of-scope resolution or redirect", "Unexpected impact", "Policy revocation"],
      evidenceIds: [],
      status: "ready",
      source: "operator-slash-command",
      recordedAt: new Date().toISOString(),
    });
    const adapterIds = new Set(["subfinder", "amass", "theharvester", "httpx", "nmap", "naabu", "katana", "ffuf", "gobuster", "nuclei", "nikto", "testssl", "sqlmap", "wafw00f", "nmap-firewall", "hping3", "traceroute"]);
    for (const toolName of Array.isArray(parsed.tools) ? parsed.tools : []) {
      const normalized = String(toolName || "").toLowerCase();
      const tool = adapterIds.has(normalized)
        ? { toolName: "run_security_tool", callId: `slash:${parsed.command}:${normalized}:${target}`, args: { adapter_id: normalized, target, hypothesis_id: hypothesisId, technique_ids: [String(parsed.command || "").replace(/^\//, "")] } }
        : normalized === "custom_script"
          ? { toolName: "run_custom_script", callId: `slash:${parsed.command}:${normalized}:${target}`, args: { target, script: parsed.script || "" } }
        : { toolName: "run_command", callId: `slash:${parsed.command}:${normalized}:${target}`, command: `${normalized} ${target}`, args: { target } };
      const decision = evaluateAction({ tool, profile, policy, approvalGranted: payload.approvalGranted || false });
      appendAgentAction(workspace, { runId: slashRunId, type: "action_proposed", timestamp: new Date().toISOString(), profile: profile.key, tool: normalized, target, risk: decision.risk, capability: decision.capability, allowed: decision.allowed, reason: decision.reason, hypothesisId });
      if (!decision.allowed) {
        appendAgentAction(workspace, { runId: slashRunId, type: "run_terminal", timestamp: new Date().toISOString(), profile: profile.key, tool: parsed.command, target, ok: false, status: "stopped", errorCode: decision.code, output: decision.reason, hypothesisId });
        return { ok: false, error: decision.reason, code: decision.code, policyDecision: decision, approvalProposal: { actionId: tool.callId, target, capability: decision.capability, risk: decision.risk, expiresAt: new Date(Date.now() + 60_000).toISOString() }, parsed };
      }
    }
    const result = await dispatchSlashCommand("run", runPayload);
    appendAgentAction(workspace, { runId: slashRunId, type: "run_terminal", timestamp: new Date().toISOString(), profile: profile.key, tool: parsed.command, target, ok: Boolean(result?.ok), status: result?.ok ? "completed" : "failed", errorCode: result?.code || "", output: result?.output || "", hypothesisId });
    return result;
  }
  return dispatchSlashCommand("run", payload);
});
ipcMain.handle("commands:customScripts", async (_event, { path: root } = {}) => {
  if (!root || !fs.existsSync(root)) return { ok: true, scripts: [] };
  const base = path.join(root, "custom_scripts");
  try {
    if (!fs.existsSync(base)) return { ok: true, scripts: [] };
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

ipcMain.handle("terminal:shells", () => ({
  ok: true,
  profiles: availableTerminalShells().map(({ id, label, default: isDefault }) => ({ id, label, default: isDefault })),
}));

ipcMain.handle("terminal:create", (event, { id, cwd, profileId }) => {
  if (terminals.has(id)) return { error: "Terminal already exists" };

  try {
    const profile = resolveTerminalShell(String(profileId || ""));
    const shell = profile.path;
    const term = pty.spawn(shell, getShellArgs(shell), {
      name: "xterm-color",
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
      useConpty: process.platform === "win32",
    });

    const ownerId = event.sender.id;
    terminals.set(id, { pty: term, ownerId, profileId: profile.id });

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

    return { ok: true, shell: profile.label, profileId: profile.id };
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

const DEFAULT_OLLAMA_PORT = 11435;

function normalizeOllamaHostInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Ollama host must use http or https.");
  if (!url.hostname) throw new Error("Enter a valid Ollama host URL or host:port.");
  return url.toString().replace(/\/$/, "");
}

function configuredOllamaHost() {
  return String(readApplicationPreferences()?.ollama?.host || "").trim();
}

function getOllamaBaseUrl() {
  const envHost = String(process.env.OLLAMA_HOST || "").trim();
  if (envHost) return envHost.replace(/\/$/, "");
  const configured = configuredOllamaHost();
  if (configured) {
    try {
      return normalizeOllamaHostInput(configured);
    } catch {
      return `http://127.0.0.1:${DEFAULT_OLLAMA_PORT}`;
    }
  }
  return `http://127.0.0.1:${DEFAULT_OLLAMA_PORT}`;
}

function isLocalOllamaBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function ollamaHostLabel(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : String(DEFAULT_OLLAMA_PORT));
    if (isLocalOllamaBaseUrl(baseUrl)) return port;
    return `${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return String(DEFAULT_OLLAMA_PORT);
  }
}

function ollamaSettingsSnapshot() {
  const envHost = String(process.env.OLLAMA_HOST || "").trim();
  const configured = configuredOllamaHost();
  const activeBaseUrl = getOllamaBaseUrl();
  let host = "";
  try {
    host = configured ? normalizeOllamaHostInput(configured) : "";
  } catch {
    host = configured;
  }
  return {
    host,
    activeBaseUrl,
    activeHost: ollamaHostLabel(activeBaseUrl),
    usingDefault: !host && !envHost,
    usingEnvironment: Boolean(envHost),
    source: envHost ? "environment" : host ? "settings" : "default",
  };
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

async function fetchOllamaShow(baseUrl, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: controller.signal,
    });
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

function parseOllamaModelContextLength(data) {
  const parameters = String(data?.parameters || "");
  const paramMatch = parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/i);
  if (paramMatch) return Number(paramMatch[1]) || null;
  const info = data?.model_info && typeof data.model_info === "object" ? data.model_info : {};
  for (const [key, value] of Object.entries(info)) {
    if (String(key).endsWith(".context_length") && Number(value) > 0) return Number(value);
  }
  return null;
}

function serializeTokenPayload(messages = [], tools = []) {
  const safeMessages = sanitizeOllamaMessages(messages);
  return JSON.stringify({
    messages: safeMessages,
    tools: tools || [],
  });
}

async function openRouterFetch(pathname, options = {}) {
  const key = getOpenRouterApiKey();
  if (!key) throw Object.assign(new Error("OpenRouter API key is not configured."), { code: "OPENROUTER_KEY_REQUIRED" });
  return fetch(`${getOpenRouterBaseUrl()}${pathname}`, { ...options, headers: { ...openRouterHeaders(key, { referer: "https://xekute.local", title: "XEKUTE" }), ...(options.headers || {}) } });
}
let openRouterModelsCache = null;
async function listOpenRouterModels() {
  try {
    const response = await openRouterFetch("/models");
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `OpenRouter error: ${response.status}`, provider: "openrouter" };
    const preferred = String(llmPreferences().openrouter?.model || "").trim();
    const modelMeta = {};
    const models = [];
    for (const item of (data.data || [])) {
      const id = String(item?.id || "").trim();
      if (!id) continue;
      models.push(id);
      modelMeta[id] = {
        id,
        provider: "openrouter",
        contextLength: Number(item.context_length) || null,
        contextWindowTokens: Number(item.context_length) || null,
        maxCompletionTokens: Number(item.top_provider?.max_completion_tokens || item.max_output_length) || null,
        topProviderContextLength: Number(item.top_provider?.context_length) || null,
        supportedParameters: Array.isArray(item.supported_parameters) ? item.supported_parameters : [],
        name: String(item.name || id),
        source: "catalog",
        fetchedAt: new Date().toISOString(),
      };
    }
    if (preferred && !models.includes(preferred)) models.unshift(preferred);
    openRouterModelsCache = { modelMeta };
    return { models: [...new Set(models)].sort(), provider: "openrouter", host: "OpenRouter", modelMeta };
  } catch (error) {
    return { error: error.message, code: error.code || "OPENROUTER_LIST_FAILED", provider: "openrouter" };
  }
}

function parseOpenRouterModelSlug(modelId) {
  const raw = String(modelId || "").trim();
  const idx = raw.indexOf("/");
  if (idx <= 0) return null;
  return { author: raw.slice(0, idx), slug: raw.slice(idx + 1) };
}

async function fetchOpenRouterModelRecord(modelId) {
  const slug = parseOpenRouterModelSlug(modelId);
  if (!slug) return null;
  const path = `/models/${encodeURIComponent(slug.author)}/${encodeURIComponent(slug.slug)}`;
  let response = null;
  try {
    response = getOpenRouterApiKey() ? await openRouterFetch(path) : await fetch(`${getOpenRouterBaseUrl()}${path}`);
  } catch {
    try {
      response = await fetch(`${getOpenRouterBaseUrl()}${path}`);
    } catch {
      return null;
    }
  }
  try {
    const data = await response.json();
    if (!response.ok) return null;
    return data?.data && typeof data.data === "object" ? data.data : data;
  } catch {
    return null;
  }
}

async function getOpenRouterModelContexts(modelId) {
  const model = String(modelId || "").trim();
  if (!model) return { ok: false, error: "Missing model id.", provider: "openrouter" };
  const contexts = new Set();
  const endpointContexts = new Set();
  const addContext = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) contexts.add(n);
  };
  const addEndpointContext = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      endpointContexts.add(n);
      contexts.add(n);
    }
  };

  if (!openRouterModelsCache) openRouterModelsCache = { modelMeta: {} };
  if (!openRouterModelsCache.modelMeta) openRouterModelsCache.modelMeta = {};

  const meta = openRouterModelsCache.modelMeta[model];
  if (meta?.contextLength) addContext(meta.contextLength);
  if (meta?.contextWindowTokens) addContext(meta.contextWindowTokens);
  if (meta?.topProviderContextLength) addContext(meta.topProviderContextLength);

  const extendedMeta = openRouterModelsCache.modelMeta[`${model}:extended`];
  if (extendedMeta?.contextLength) addContext(extendedMeta.contextLength);

  if (!meta?.contextLength) {
    const record = await fetchOpenRouterModelRecord(model);
    if (record) {
      addContext(record.context_length);
      openRouterModelsCache.modelMeta[model] = {
        id: model,
        provider: "openrouter",
        contextLength: Number(record.context_length) || null,
        contextWindowTokens: Number(record.context_length) || null,
        maxCompletionTokens: Number(record.top_provider?.max_completion_tokens || record.max_output_length) || null,
        topProviderContextLength: Number(record.top_provider?.context_length) || null,
        supportedParameters: Array.isArray(record.supported_parameters) ? record.supported_parameters : [],
        name: String(record.name || model),
        source: "detail",
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  const slug = parseOpenRouterModelSlug(model);
  if (slug && getOpenRouterApiKey()) {
    try {
      const response = await openRouterFetch(`/models/${encodeURIComponent(slug.author)}/${encodeURIComponent(slug.slug)}/endpoints`);
      const data = await response.json();
      const endpoints = Array.isArray(data?.data?.endpoints)
        ? data.data.endpoints
        : (Array.isArray(data?.endpoints) ? data.endpoints : []);
      for (const endpoint of endpoints) addEndpointContext(endpoint?.context_length);
    } catch {
      /* Fall back to model metadata from the catalog. */
    }
  }

  const contextLengths = [...contexts].sort((a, b) => b - a);
  const catalogMeta = openRouterModelsCache.modelMeta[model] || null;
  return {
    ok: true,
    provider: "openrouter",
    model,
    contextLengths,
    endpointContextLengths: [...endpointContexts].sort((a, b) => b - a),
    modelMeta: catalogMeta ? ContextBudget.normalizeModelMetadata(catalogMeta, model) : null,
  };
}
async function runOpenRouterChat(event, { messages, model, thinking, tools, contextPlan, maxCompletionTokens }, hooks = {}) {
  const senderId = event.sender.id; const previous = llmControllers.get(senderId); if (previous) previous.abort(); const controller = new AbortController(); llmControllers.set(senderId, controller); let fullText = "", toolCalls = [];
  const send = (channel, value) => { if (!event.sender.isDestroyed()) event.sender.send(channel, value); };
  try {
    const promptEstimate = estimateTokenCount(JSON.stringify({ messages: normalizeOpenRouterMessages(messages), tools: openRouterTools(tools) }));
    if (contextPlan?.promptBudgetTokens && promptEstimate > Number(contextPlan.promptBudgetTokens)) {
      return { error: `Context payload is approximately ${promptEstimate.toLocaleString()} tokens, above the ${Number(contextPlan.promptBudgetTokens).toLocaleString()} token prompt budget. Reduce the app context budget or remove older workspace output.`, code: "CONTEXT_LENGTH_EXCEEDED", provider: "openrouter" };
    }
    const request = buildChatRequest({
      baseUrl: getOpenRouterBaseUrl(),
      apiKey: getOpenRouterApiKey(),
      model: model || llmPreferences().openrouter?.model,
      messages: normalizeOpenRouterMessages(messages),
      tools: openRouterTools(tools),
      stream: true,
      maxCompletionTokens: maxCompletionTokens || contextPlan?.responseReserveTokens,
      // Local memory management must remain the sole source of truth for
      // truncation; OpenRouter's optional middle-of-prompt transform is not
      // deterministic enough for tool/evidence workflows.
      plugins: [{ id: "context-compression", enabled: false }],
    });
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.error?.metadata?.error_type || "";
      } catch { /* preserve the status when the body is not JSON */ }
      return { error: `OpenRouter error: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`, code: /context[_ -]?length[_ -]?exceeded/i.test(detail) ? "CONTEXT_LENGTH_EXCEEDED" : "OPENROUTER_CHAT_FAILED", provider: "openrouter" };
    }
    const captured = await captureOpenRouterStream(response.body, { onEvent: (streamEvent) => hooks.onStreamEvent?.(streamEvent), onThinking: (token, streamEvent) => { hooks.onThinking?.(token, streamEvent); send("ollama:thinking", token); }, onContent: (token, streamEvent) => { fullText += token; const control = hooks.onToken?.(token, streamEvent); if (control?.abort && !controller.signal.aborted) controller.abort(control.code || "MODEL_OUTPUT_REJECTED"); send("ollama:token", token); }, onToolCalls: (calls, streamEvent) => { toolCalls = calls; hooks.onToolCalls?.(calls, streamEvent); send("ollama:toolcall", calls); } });
    fullText = captured.fullText;
    toolCalls = captured.toolCalls;
    const payload = { fullText, toolCalls, thinking: captured.thinking, usage: captured.usage, provider: "openrouter" };
    send("ollama:done", payload);
    return { ok: true, ...payload };
  } catch (error) {
    if (controller.signal.aborted) { const payload = { fullText, toolCalls, aborted: true, provider: "openrouter" }; send("ollama:done", payload); return { ok: false, ...payload }; }
    return { error: error.message, code: error.code || "OPENROUTER_CHAT_FAILED", fullText, toolCalls, provider: "openrouter" };
  } finally { if (llmControllers.get(senderId) === controller) llmControllers.delete(senderId); }
}
async function runOpenRouterAgentRound(senderId, payload, hooks = {}) {
  const event = { sender: { id: senderId, isDestroyed: () => false, send: () => {} } };
  return runOpenRouterChat(event, payload, hooks);
}
async function runOpenRouterJson({ model, messages, temperature = 0, maxCompletionTokens, contextPlan }) {
  const request = buildChatRequest({
    baseUrl: getOpenRouterBaseUrl(),
    apiKey: getOpenRouterApiKey(),
    model: model || llmPreferences().openrouter?.model,
    messages: normalizeOpenRouterMessages(messages),
    stream: false,
    temperature,
    maxCompletionTokens: maxCompletionTokens || contextPlan?.responseReserveTokens || 1200,
    responseFormat: { type: "json_object" },
    plugins: [{ id: "context-compression", enabled: false }],
  });
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json(); detail = body?.error?.message || body?.error?.metadata?.error_type || ""; } catch { /* status is sufficient */ }
    throw Object.assign(new Error(`OpenRouter error: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`), { code: /context[_ -]?length[_ -]?exceeded/i.test(detail) ? "CONTEXT_LENGTH_EXCEEDED" : "OPENROUTER_JSON_FAILED" });
  }
  const body = await response.json();
  return String(body?.choices?.[0]?.message?.content || "");
}
async function summarizeOpenRouterContext(payload) {
  try {
    const contextTokens = payload.contextBudget || payload.contextPlan?.promptBudgetTokens || 4096;
    const output = await runOpenRouterJson({
      model: payload.model,
      contextPlan: payload.contextPlan,
      messages: [{ role: "system", content: ContextMemory.SUMMARY_SYSTEM_PROMPT }, { role: "user", content: ContextMemory.buildMemoryTranscript(payload.previousSummary || "", payload.messages || [], { contextTokens }) }],
      temperature: 0,
      maxCompletionTokens: Math.min(1200, payload.contextPlan?.responseReserveTokens || 1200),
    });
    const summary = ContextMemory.normalizeSummary(output, ContextMemory.summaryCharLimit(contextTokens));
    return { ok: summary.length >= 40, summary, source: "model", provider: "openrouter", summarizedMessages: (payload.messages || []).length };
  } catch (error) { return { ok: false, error: error.message, code: error.code || "OPENROUTER_SUMMARY_FAILED", provider: "openrouter" }; }
}

/** List locally available Ollama models */
ipcMain.handle("ollama:list", async () => {
  if (getActiveProvider() === "openrouter") return listOpenRouterModels();
  const baseUrl = getOllamaBaseUrl();
  const host = ollamaHostLabel(baseUrl);
  let apiError = null;

  try {
    const { res, data } = await fetchOllamaTags(baseUrl);
    if (res.ok) {
      const models = parseOllamaTags(data);
      if (models.length) return { models, host, provider: "ollama" };
      apiError = "No models found in Ollama.";
    } else {
      apiError = data?.error || `Ollama API error (${res.status})`;
    }
  } catch (err) {
    apiError = err?.name === "AbortError"
      ? "Ollama API timed out."
      : (err?.message || "Cannot reach Ollama API.");
  }

  if (!isLocalOllamaBaseUrl(baseUrl)) {
    return { error: apiError || "Cannot reach remote Ollama API." };
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
    if (models.length) return { models, host, provider: "ollama" };
    return { error: apiError || "No models found. Run ollama pull <model>." };
  } catch (err) {
    return { error: apiError || err?.message || "Cannot reach Ollama. Is it running?" };
  }
});

ipcMain.handle("openrouter:modelContexts", async (_event, { model } = {}) => {
  if (getActiveProvider() !== "openrouter") return { ok: false, error: "OpenRouter is not the active provider.", provider: "openrouter" };
  return getOpenRouterModelContexts(model);
});

ipcMain.handle("ollama:runtime", async (_event, { model } = {}) => {
  if (getActiveProvider() === "openrouter") {
    const contexts = await getOpenRouterModelContexts(model);
    const metadata = ContextBudget.normalizeModelMetadata(contexts.modelMeta || openRouterModelsCache?.modelMeta?.[model] || {}, model);
    const contextLengths = Array.isArray(contexts.contextLengths) ? contexts.contextLengths : [];
    const contextLength = metadata.contextWindowTokens || (contextLengths.length ? Math.max(...contextLengths) : null);
    return {
      ok: true,
      loaded: Boolean(contextLength),
      model,
      contextLength,
      contextLengths,
      metadata,
      provider: "openrouter",
    };
  }
  if (!model) return { ok: false, error: "Missing model name." };

  try {
    const { res, data } = await fetchOllamaPs(getOllamaBaseUrl());
    if (!res.ok) {
      return { ok: false, error: data?.error || `Ollama API error (${res.status})` };
    }

    const models = Array.isArray(data?.models) ? data.models : [];
    const entry = models.find((item) => item?.model === model || item?.name === model);
    if (entry) {
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
        provider: "ollama",
      };
    }

    const showResult = await fetchOllamaShow(getOllamaBaseUrl(), model);
    if (showResult.res.ok) {
      const contextLength = parseOllamaModelContextLength(showResult.data);
      return {
        ok: true,
        loaded: false,
        model,
        contextLength,
        provider: "ollama",
        source: "catalog",
      };
    }

    return { ok: true, loaded: false, model, contextLength: null, provider: "ollama" };
  } catch (err) {
    return { ok: false, error: err?.message || "Cannot reach Ollama runtime." };
  }
});

ipcMain.handle("ollama:countTokens", async (_event, { model, messages = [], tools = [] } = {}) => {
  if (getActiveProvider() === "openrouter") return { ok: true, count: estimateTokenCount(JSON.stringify({ messages, tools })), source: "estimate" };
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

  if (getActiveProvider() === "openrouter") return summarizeOpenRouterContext(payload);

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
ipcMain.handle("ollama:chat", async (event, { messages, model, numCtx, thinking, mode, modeFamily, contextPlan, maxCompletionTokens }) => {
  const tools = ToolMap.toolsForProfile(mode || "ask");
  if (getActiveProvider() === "openrouter") return runOpenRouterChat(event, { messages, model, thinking, tools, contextPlan, maxCompletionTokens });
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
  let fullText = "";
  let toolCalls = [];
  let doneSent = false;
  let thinkingSignaled = false;

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
      const payload = { fullText, toolCalls, aborted: true };
      sendDone(payload);
      if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
      return { ok: false, aborted: true, fullText, toolCalls };
    }
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Cannot reach Ollama at ${url}. Is it running?\n${err.message}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Ollama error: ${res.status} ${res.statusText}${detail ? `\n${detail}` : ""}` };
  }

  try {
    const captured = await captureOllamaStream(res.body, {
      onThinking() {
        if (!thinkingSignaled && !event.sender.isDestroyed()) {
          thinkingSignaled = true;
          event.sender.send("ollama:thinking", null);
        }
      },
      onContent(token) {
        fullText += token;
        if (!event.sender.isDestroyed()) event.sender.send("ollama:token", token);
      },
      onToolCalls(calls) {
        toolCalls = calls;
        if (!event.sender.isDestroyed()) event.sender.send("ollama:toolcall", calls);
      },
    });
    fullText = captured.fullText;
    toolCalls = captured.toolCalls;
    const payload = { fullText, toolCalls, usage: captured.usage };
    sendDone(payload);
    return { ok: true, ...payload };
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      const payload = { fullText, toolCalls, aborted: true };
      sendDone(payload);
      return { ok: false, ...payload };
    }
    return {
      error: err?.message || "Ollama stream failed.",
      code: err?.code || "OLLAMA_STREAM_FAILED",
      fullText,
      toolCalls,
    };
  } finally {
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
  }

});

async function runOllamaAgentRound(senderId, payload, hooks = {}) {
  if (getActiveProvider() === "openrouter") return runOpenRouterAgentRound(senderId, payload, hooks);
  const { messages, model, numCtx, thinking, tools, temperature = 0.1 } = payload;
  const url = `${getOllamaBaseUrl()}/api/chat`;
  const mdl = model ?? "qwen2.5-coder:7b";
  const previous = ollamaControllers.get(senderId);
  if (previous) previous.abort();

  const controller = new AbortController();
  ollamaControllers.set(senderId, controller);

  const options = {};
  if (numCtx) options.num_ctx = numCtx;
  options.temperature = Math.max(0, Math.min(Number(temperature) || 0, 1));

  const body = {
    model: mdl,
    messages: sanitizeOllamaMessages(messages),
    stream: true,
    ...(Object.keys(options).length ? { options } : {}),
    ...(includeThinkOption(thinking) ? { think: thinking } : {}),
    ...(tools?.length ? { tools } : {}),
  };

  let res;
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

  try {
    const captured = await captureOllamaStream(res.body, {
      onEvent(streamEvent) {
        hooks.onStreamEvent?.(streamEvent);
      },
      onThinking(token) {
        fullThinking += token;
        hooks.onThinking?.(token);
      },
      onContent(token) {
        fullText += token;
        const control = hooks.onToken?.(token);
        if (control?.abort && !controller.signal.aborted) {
          controller.abort(control.code || "MODEL_OUTPUT_REJECTED");
        }
      },
      onToolCalls(calls) {
        toolCalls = calls;
        hooks.onToolCalls?.(calls);
      },
    });
    return {
      ok: true,
      fullText: captured.fullText,
      toolCalls: captured.toolCalls,
      thinking: captured.thinking,
      streamSequence: captured.sequence,
      usage: captured.usage,
    };
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    return {
      error: err?.message || "Ollama stream failed.",
      code: err?.code || "OLLAMA_STREAM_FAILED",
      fullText,
      toolCalls,
      thinking: fullThinking,
    };
  } finally {
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
  }

}

async function runOllamaJson(payload) {
  if (getActiveProvider() === "openrouter") return runOpenRouterJson(payload);
  const { model, messages, numCtx = 4096, temperature = 0 } = payload;
  const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: sanitizeOllamaMessages(messages),
      stream: false,
      format: "json",
      options: {
        num_ctx: Math.max(2048, Math.min(Number(numCtx) || 4096, 32768)),
        temperature,
      },
    }),
  });
  if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  const body = await response.json();
  return String(body?.message?.content || "");
}

async function qualifyOllamaModel(model) {
  try {
    const output = await runOllamaJson({
      model,
      messages: AgentVerifier.qualificationPrompt(),
      temperature: 0,
    });
    return {
      ok: true,
      model,
      qualificationVersion: AgentVerifier.QUALIFICATION_VERSION,
      ...AgentVerifier.scoreQualification(output),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      qualified: false,
      score: 0,
      model,
      qualificationVersion: AgentVerifier.QUALIFICATION_VERSION,
      error: error.message,
      checkedAt: new Date().toISOString(),
    };
  }
}

ipcMain.handle("agent:qualifyModel", async (_event, { model } = {}) => {
  if (!String(model || "").trim()) return { error: "A model is required", code: "MODEL_REQUIRED" };
  return qualifyOllamaModel(String(model));
});

async function verifyFindingCandidate(workspace, model, candidate) {
  if (!workspace || !candidate || typeof candidate !== "object") return { error: "Workspace and candidate are required", code: "INVALID_VERIFIER_REQUEST" };
  const configuredVerifier = assessmentWorkspace.readSettings(workspace)?.settings?.aiModels?.verifierModel;
  const verifierModel = String(configuredVerifier || model || "").trim();
  if (!verifierModel) return { error: "A verifier model is required", code: "VERIFIER_MODEL_REQUIRED" };
  const evidence = assessmentWorkspace.readJsonl(workspace, "evidence/index.jsonl", { limit: 2000 });
  if (evidence?.error) return evidence;
  const ids = new Set((Array.isArray(candidate.evidence) ? candidate.evidence : []).map(String));
  const traffic = assessmentWorkspace.readJsonl(workspace, "traffic/raw.jsonl", { limit: 2000 });
  const trafficByRequest = new Map((traffic.records || []).map((record) => [String(record.requestId || record.id || ""), record]));
  const selectedEvidence = (evidence.records || []).filter((record) => ids.has(String(record.id || ""))).map((record) => {
    let excerpt = "";
    let hashValid = /^[a-f0-9]{64}$/i.test(String(record.sha256 || ""));
    if (record.filePath) {
      try {
        const root = path.resolve(workspace);
        const artifact = path.resolve(root, ...String(record.filePath).replace(/\\/g, "/").split("/"));
        const relative = path.relative(root, artifact);
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
          const artifactBytes = fs.readFileSync(artifact);
          hashValid = hashValid && crypto.createHash("sha256").update(artifactBytes).digest("hex") === record.sha256;
          excerpt = artifactBytes.toString("utf8").slice(0, 4000);
        } else hashValid = false;
      } catch { excerpt = ""; hashValid = false; }
    }
    const exchange = trafficByRequest.get(String(record.requestId || record.id || ""));
    if (!excerpt && exchange) excerpt = `${String(exchange.request || "").slice(0, 2000)}\n${String(exchange.response || "").slice(0, 2000)}`;
    return { ...record, excerpt, hashValid };
  });
  const resolvedIds = new Set(selectedEvidence.map((record) => String(record.id || "")));
  const missingIds = [...ids].filter((id) => !resolvedIds.has(id));
  if (missingIds.length) return { ok: false, verdict: "inconclusive", error: `Verifier evidence IDs do not exist: ${missingIds.join(", ")}`, code: "VERIFIER_EVIDENCE_NOT_FOUND" };
  if (selectedEvidence.some((record) => record.hashValid === false)) return { ok: false, verdict: "inconclusive", error: "Verifier evidence failed SHA-256 integrity validation.", code: "VERIFIER_EVIDENCE_TAMPERED" };
  const packet = AgentVerifier.boundedEvidencePacket(candidate, selectedEvidence);
  const packetSha256 = crypto.createHash("sha256").update(JSON.stringify(packet), "utf8").digest("hex");
  try {
    const output = await runOllamaJson({ model: verifierModel, messages: AgentVerifier.verifierMessages(packet), temperature: 0 });
    const verdict = AgentVerifier.parseVerifierResponse(output);
    const verifiedAt = new Date().toISOString();
    const verifierRecord = { ...verdict, model: verifierModel, verifiedAt, packetSha256, candidateId: candidate.id || "", inputEvidenceIds: [...ids] };
    const persisted = assessmentWorkspace.appendEvidenceRecord(workspace, {
      type: "verification-verdict",
      title: `Hybrid verifier verdict for ${candidate.id || candidate.title || "finding candidate"}`,
      capturedAt: verifiedAt,
      capturedBy: verifierModel,
      source: "pointer-hybrid-verifier",
      host: candidate.asset?.host || "",
      url: candidate.asset?.url || "",
      content: JSON.stringify(verifierRecord),
      redacted: true,
      findingIds: candidate.id ? [candidate.id] : [],
      notes: `${verdict.verdict}; packet ${packetSha256}`,
    });
    if (persisted?.error) return { ok: false, verdict: "inconclusive", error: `Verifier result could not be persisted: ${persisted.error}`, model: verifierModel, verifiedAt };
    return { ok: verdict.ok, ...verdict, model: verifierModel, verifiedAt, evidenceIds: [...ids], verifierEvidenceId: persisted.record?.id || "", packetSha256, provenance: "pointer-hybrid-verifier" };
  } catch (error) {
    return { ok: false, verdict: "inconclusive", error: error.message, model: verifierModel, verifiedAt: new Date().toISOString() };
  }
}

ipcMain.handle("agent:verifyFinding", async (_event, { workspace, model, candidate } = {}) => verifyFindingCandidate(workspace, model, candidate));

ipcMain.handle("agent:resolveApproval", async (event, { actionId, approved } = {}) => {
  const pending = pendingAgentApprovals.get(String(actionId || ""));
  if (!pending || pending.ownerId !== event.sender.id) return { error: "Approval request is no longer active", code: "APPROVAL_NOT_FOUND" };
  clearTimeout(pending.timer);
  pendingAgentApprovals.delete(String(actionId));
  pending.resolve({ approved: Boolean(approved), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  return { ok: true };
});

function requestAgentActionApproval(sender, proposal) {
  const actionId = String(proposal.actionId || "");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAgentApprovals.delete(actionId);
      resolve({ approved: false, expired: true });
    }, 60_000);
    pendingAgentApprovals.set(actionId, { ownerId: sender.id, resolve, timer });
    if (!sender.isDestroyed()) sender.send("agent:event", { type: "approval_required", ...proposal, expiresInMs: 60_000 });
  });
}

ipcMain.handle("agent:resolveQuestions", async (event, { requestId, answers, skipped } = {}) => {
  const pending = pendingOperatorQuestions.get(String(requestId || ""));
  if (!pending || pending.ownerId !== event.sender.id) return { error: "Question request is no longer active", code: "QUESTIONS_NOT_FOUND" };
  clearTimeout(pending.timer);
  pendingOperatorQuestions.delete(String(requestId));
  if (pending.workspace && pending.file && Array.isArray(answers)) {
    try {
      const OperatorQuestions = require("../../application/clarification/operator-questions");
      const fullPath = path.join(path.resolve(String(pending.workspace)), String(pending.file).replace(/\\/g, "/"));
      const document = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const updated = OperatorQuestions.applyAnswers(document, answers, { skipped: Boolean(skipped) });
      fs.writeFileSync(fullPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    } catch {
      /* best-effort persistence */
    }
  }
  pending.resolve({ answers: Array.isArray(answers) ? answers : [], skipped: Boolean(skipped) });
  return { ok: true };
});

function requestOperatorQuestions(sender, proposal) {
  const requestId = String(proposal.requestId || "");
  const expiresInMs = Number(proposal.expiresInMs) > 0 ? Number(proposal.expiresInMs) : 300_000;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingOperatorQuestions.delete(requestId);
      resolve({ answers: [], skipped: true, expired: true });
    }, expiresInMs);
    pendingOperatorQuestions.set(requestId, {
      ownerId: sender.id,
      resolve,
      timer,
      workspace: proposal.workspace || "",
      file: proposal.file || "",
    });
    if (!sender.isDestroyed()) sender.send("agent:event", { type: "questions_required", ...proposal, expiresInMs });
  });
}

ipcMain.handle("agent:run", async (event, payload) => {
  const sender = event.sender;
  const sendAgentEvent = (data) => {
    if (!sender.isDestroyed()) sender.send("agent:event", data);
  };
  let assessmentRun = null;
  if (payload.workspace) {
    const agentProfile = normalizeProfile(payload.modeFamily || "xekute", payload.mode || "agent");
    const runResult = assessmentWorkspace.createRun(payload.workspace, {
      profile: agentProfile.key,
      status: "running",
      operator: "local-user",
    });
    if (runResult?.ok) assessmentRun = runResult.run;
  }
  const requestedProfile = normalizeProfile(payload.modeFamily || "xekute", payload.mode || "agent");
  if (requestedProfile.key === "agent") {
    const settingsResult = payload.workspace ? assessmentWorkspace.readSettings(payload.workspace) : null;
    const modelPolicy = settingsResult?.settings?.aiModels || {};
    if (modelPolicy.requireQualifiedModelForTestAgent !== false) {
      const cached = modelPolicy.qualification?.[payload.model];
      const cacheFresh = cached?.qualificationVersion === AgentVerifier.QUALIFICATION_VERSION && Number.isFinite(Date.parse(cached.checkedAt)) && Date.now() - Date.parse(cached.checkedAt) < 7 * 24 * 60 * 60 * 1000;
      const qualification = cacheFresh ? { ...cached, cached: true } : await qualifyOllamaModel(payload.model);
      if (!cacheFresh && settingsResult?.settings && payload.workspace) {
        assessmentWorkspace.writeSettings(payload.workspace, {
          ...settingsResult.settings,
          aiModels: { ...modelPolicy, qualification: { ...(modelPolicy.qualification || {}), [payload.model]: qualification } },
        });
      }
      sendAgentEvent({ type: "model_qualification", qualification });
      if (!qualification.qualified && !modelPolicy.allowUnqualifiedTestAgentDeveloperOverride) {
        const result = { error: "The selected model did not pass XEKUTE's JSON, failure-state, evidence-state, and prompt-injection qualification check. Use Ask mode or enable the explicit developer override.", code: "MODEL_UNQUALIFIED", qualification };
        if (assessmentRun?.id) assessmentWorkspace.updateRun(payload.workspace, assessmentRun.id, { status: "failed", completedAt: new Date().toISOString(), stopReason: result.error });
        if (payload.workspace) appendAgentAction(payload.workspace, { runId: assessmentRun?.id || "", type: "run_terminal", timestamp: new Date().toISOString(), profile: requestedProfile.key, status: "failed", ok: false, errorCode: result.code, output: result.error, model: payload.model });
        return result;
      }
    }
  }
  const result = await runAgentTurn({
    workspace: payload.workspace,
    model: payload.model,
    numCtx: payload.numCtx,
    contextBudget: payload.contextBudget,
    contextPlan: payload.contextPlan || null,
    thinking: payload.thinking,
    tools: ToolMap.TOOLS,
    mode: payload.mode || "agent",
    modeFamily: payload.modeFamily || "xekute",
    approvalGranted: payload.approvalGranted || false,
    authority: payload.authority || null,
    projectProfile: readProjectProfile(payload.workspace)?.profile || null,
    runId: assessmentRun?.id || "",
    chatHistory: payload.chatHistory || [],
    contextSummary: payload.contextSummary || "",
    failureMemory: payload.failureMemory || payload.memory?.failureRecords || [],
    dirMap: payload.dirMap || "",
    activeFile: payload.activeFile || null,
    extraFiles: payload.extraFiles || [],
    subagentModel: payload.subagentModel || "",
    userMessage: payload.userMessage || "",
    globalGuidanceRoot: globalGuidanceRoot(),
    sendEvent: sendAgentEvent,
    runModelRound: (roundPayload) => runOllamaAgentRound(event.sender.id, roundPayload, {
      onThinking: roundPayload.onThinking,
      onToken: roundPayload.onToken,
      onToolCalls: roundPayload.onToolCalls,
      onStreamEvent: roundPayload.onStreamEvent,
    }),
    executeToolCall: ({ workspace, toolCall }) => {
      const terminalHost = createAgentTerminalHost(sender, sendAgentEvent);
      return toolExecutor.executeToolCall({ workspace, toolCall, terminalHost });
    },
    requestApproval: (proposal) => requestAgentActionApproval(event.sender, proposal),
    requestQuestions: (proposal) => requestOperatorQuestions(event.sender, proposal),
    findWorkspaceFiles,
    searchWorkspaceIndex,
  });
  if (assessmentRun?.id) {
    const runtimeStatus = result?.runState?.status;
    assessmentWorkspace.updateRun(payload.workspace, assessmentRun.id, {
      status: result?.aborted ? "stopped" : ["completed", "inconclusive", "stopped", "failed"].includes(runtimeStatus) ? runtimeStatus : result?.ok ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      stopReason: result?.aborted ? "Aborted by operator" : result?.error || "",
      notes: String(result?.finalText || result?.error || "").slice(0, 2000),
    });
  }
  return result;
});
