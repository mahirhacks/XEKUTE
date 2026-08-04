"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createToolHandlers } = require("../../adapters/tools/core/tool-handlers");
const ToolMap = require("../../adapters/tools/core/tool-catalog");
const { createWorkspaceSearch } = require("../../adapters/tools/os/workspace-search");
const { createAgentTerminalRunner } = require("../../adapters/tools/os/terminal-runner");
const { createSubagentRunner } = require("../../adapters/tools/cyber/subagent-runner");
const { createWebResearch } = require("../../adapters/tools/cyber/web-research");
const { resolveSecurityExecutable } = require("../../adapters/tools/cyber/executable-resolver");
const { createWebCloneService } = require("../../adapters/tools/cyber/webclone");
const { createAssessmentWorkspace, JSON_TEMPLATES } = require("../../domain/assessment/assessment-workspace");
const { createAssessmentMap } = require("../../domain/assessment/assessment-map");
const { buildIntruderRequests, createSecurityHttpWorkbench } = require("../../domain/assessment/http-workbench");
const { createProxyListenerService } = require("../../domain/assessment/proxy-listener");
const { createChatSessionStore } = require("../../app/services/chat-session-store");
const { createWorkspaceFiles } = require("../../app/services/workspace-files");
const { createProjectProfileStore } = require("../../domain/project/project-profile-store");
const { createAppConfig } = require("../config/app-config");

/**
 * DI composition root.
 *
 * Constructs every long-lived service and owns the process/terminal/approval/
 * webclone state maps. `main.js` (the presentation shell) receives these
 * services and the `dispose()` path; no production module outside this file
 * constructs concrete adapters.
 */
function createContainer({ app, safeStorage, sendToWindow = () => {}, getMainWindow = () => null } = {}) {
  if (!app?.getPath) throw new TypeError("DI container requires an Electron app instance");

  const config = createAppConfig({ app });

  // ── Long-lived services (constructed once) ────────────────────────────────
  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const {
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    transferWorkspacePath,
  } = createWorkspaceFiles({ fs, path, workspaceSearch });
  const { listProjectFiles } = workspaceSearch;
  const webResearch = createWebResearch();
  const webClone = createWebCloneService({ fs, path, webResearch });
  const assessmentWorkspace = createAssessmentWorkspace({
    fs,
    path,
    promptDefaults: () => require("../../application/prompt/prompt-compiler").defaults(),
  });
  const assessmentMap = createAssessmentMap({ fs, path, crypto, assessmentWorkspace });
  const securityHttpWorkbench = createSecurityHttpWorkbench({ fs, path, assessmentWorkspace });

  // Proxy needs CA directory + event delivery, resolved lazily.
  let proxyListener = null;
  function getProxyListener() {
    if (!proxyListener) {
      proxyListener = createProxyListenerService({
        fs,
        path,
        assessmentWorkspace,
        getCaDirectory: (assessmentRoot) => resolveCentralCaDirectory(assessmentRoot),
        sendEvent: (channel, payload) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
        },
      });
    }
    return proxyListener;
  }

  // Project profile store is lazy.
  let projectProfiles = null;
  function projectProfileStore() {
    if (!projectProfiles) {
      projectProfiles = createProjectProfileStore({
        fs,
        path,
        crypto,
        baseDirectory: config.projectProfilesDirectory(),
      });
    }
    return projectProfiles;
  }

  // Chat session store is lazy.
  let chatSessionStoreInstance = null;
  function chatSessionStore() {
    if (!chatSessionStoreInstance) {
      chatSessionStoreInstance = createChatSessionStore({
        fs,
        path,
        crypto,
        baseDir: config.chatSessionsDirectory(),
        protector: {
          available: () => safeStorage?.isEncryptionAvailable?.() || false,
          encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
          decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, "base64")),
        },
      });
    }
    return chatSessionStoreInstance;
  }

  // ── State maps (owned here; disposed by dispose()) ────────────────────────
  const terminals = new Map();
  const toolProcesses = new Map();
  const ollamaControllers = new Map();
  const pendingAgentApprovals = new Map();
  const pendingOperatorQuestions = new Map();
  const webClonePreviewDocuments = new Map();
  let webClonePreviewServer = null;
  let webClonePreviewServerPromise = null;
  let webClonePreviewPort = 0;
  let webClonePreviewView = null;
  let webClonePreviewUrl = "";
  let toolProcessCounter = 0;

  // Mutable preview state the presentation shell reads/writes so dispose()
  // always sees the live values.
  const webClonePreviewState = {
    get server() { return webClonePreviewServer; },
    set server(value) { webClonePreviewServer = value; },
    get serverPromise() { return webClonePreviewServerPromise; },
    set serverPromise(value) { webClonePreviewServerPromise = value; },
    get port() { return webClonePreviewPort; },
    set port(value) { webClonePreviewPort = value; },
    get view() { return webClonePreviewView; },
    set view(value) { webClonePreviewView = value; },
    get url() { return webClonePreviewUrl; },
    set url(value) { webClonePreviewUrl = value; },
    get processCounter() { return toolProcessCounter; },
    set processCounter(value) { toolProcessCounter = value; },
  };

  // CA directory resolution (pure, uses config).
  function resolveCentralCaDirectory(assessmentRoot = "") {
    const configured = String(readApplicationPreferences()?.certificates?.caDirectory || "").trim();
    const target = configured && path.isAbsolute(configured) ? path.resolve(configured) : config.defaultCentralCaDirectory();
    const targetCert = path.join(target, "certs", "ca.pem");
    const previous = assessmentRoot
      ? path.join(config.userData(), "proxy-ca", crypto.createHash("sha256").update(path.resolve(assessmentRoot).toLowerCase()).digest("hex").slice(0, 24))
      : "";
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

  function readApplicationPreferences() {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.preferencesPath(), "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function dispose() {
    if (proxyListener) {
      try { proxyListener.stop(); } catch { /* ignore */ }
      proxyListener = null;
    }
    for (const record of terminals.values()) {
      try { record.pty.kill(); } catch { /* ignore */ }
    }
    terminals.clear();
    for (const record of toolProcesses.values()) {
      terminateProcessTree(record.child);
    }
    toolProcesses.clear();
    for (const pending of pendingAgentApprovals.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ approved: false, expired: true, reason: "Application shutdown" });
    }
    pendingAgentApprovals.clear();
    for (const pending of pendingOperatorQuestions.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ answers: [], skipped: true, expired: true, reason: "Application shutdown" });
    }
    pendingOperatorQuestions.clear();
    if (webClonePreviewView) {
      try { webClonePreviewView.destroy(); } catch { /* ignore */ }
      webClonePreviewView = null;
    }
    if (webClonePreviewServer) {
      try { webClonePreviewServer.close(); } catch { /* ignore */ }
      webClonePreviewServer = null;
    }
    webClonePreviewPort = 0;
    webClonePreviewDocuments.clear();
  }

  function terminateProcessTree(child) {
    if (!child?.pid) return;
    if (process.platform === "win32") {
      try {
        const { spawn } = require("child_process");
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.unref();
        return;
      } catch { /* Fall back to the direct child below. */ }
    }
    try { child.kill("SIGTERM"); } catch { /* Process already exited. */ }
  }

  return {
    config,
    ToolMap,
    workspaceSearch,
    listProjectFiles,
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    transferWorkspacePath,
    webResearch,
    webClone,
    assessmentWorkspace,
    assessmentMap,
    securityHttpWorkbench,
    buildIntruderRequests,
    getProxyListener,
    projectProfileStore,
    chatSessionStore,
    resolveCentralCaDirectory,
    readApplicationPreferences,
    terminateProcessTree,
    // State maps exposed for the presentation shell.
    terminals,
    toolProcesses,
    ollamaControllers,
    pendingAgentApprovals,
    pendingOperatorQuestions,
    webClonePreviewDocuments,
    webClonePreviewState,
    dispose,
  };
}

module.exports = { createContainer };
