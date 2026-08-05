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
const { createUnifiedToolRouter } = require("../../application/tools/unified-tool-router");
const { appendToolAudit, appendOperationState } = require("../../application/agent/memory/action-log");
const { createCommandPort } = require("../../application/tools/ports/command-port");
const { createWorkspacePort } = require("../../application/tools/ports/workspace-port");
const { createPlanPort } = require("../../application/tools/ports/plan-port");
const { createStatePort } = require("../../application/tools/ports/state-port");
const { createScopePort } = require("../../application/tools/ports/scope-port");
const { createTrafficPort } = require("../../application/tools/ports/traffic-port");
const { createIdentityPort } = require("../../application/tools/ports/identity-port");
const { createReplayPort } = require("../../application/tools/ports/replay-port");
const { createTestingPort } = require("../../application/tools/ports/testing-port");
const { createResponsePort } = require("../../application/tools/ports/response-port");
const { createFindingPort } = require("../../application/tools/ports/finding-port");
const { createGraphPort } = require("../../application/tools/ports/graph-port");
const { createBrowserPort } = require("../../application/tools/ports/browser-port");
const { createDelegationPort } = require("../../application/tools/ports/delegation-port");
const { buildAction } = require("../../adapters/tools/cyber/security-tool-adapters");
const { validateFindingCandidate } = require("../../domain/assessment/finding-gate");
const AgentVerifier = require("../../application/clarification/verifier");
const { loadPolicy } = require("../../application/policies/policy-engine");

function createUnavailablePort() {
  return { async execute() { return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", summary: "Capability is not available in this migration stage." }; } };
}

/**
 * DI composition root.
 *
 * Constructs every long-lived service and owns the process/terminal/approval/
 * webclone state maps. `main.js` (the presentation shell) receives these
 * services and the `dispose()` path; no production module outside this file
 * constructs concrete adapters.
 */
function createContainer({ app, safeStorage, sendToWindow = () => {}, getMainWindow = () => null, verifyFindingCandidate = null } = {}) {
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

  function writeUnifiedArtifact(workspace, content, metadata = {}) {
    if (!workspace) return "";
    const artifactDir = path.join(path.resolve(workspace), ".xekute", "artifacts");
    fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const target = path.join(artifactDir, `${artifactId}.json`);
    fs.writeFileSync(target, `${JSON.stringify({ ...metadata, content: String(content || "") }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return artifactId;
  }

  const unifiedCommandPort = createCommandPort({ fs, path, artifactStore: writeUnifiedArtifact, terminateProcessTree });
  const unifiedWorkspacePort = createWorkspacePort({ fs, path, workspaceSearch, resolveWorkspaceTarget, editWorkspaceFile });
  const unifiedPlanPort = createPlanPort({ fs, path });
  const unifiedStatePort = createStatePort({ fs, path });
  const unifiedScopePort = createScopePort({ fs, path });
  const unifiedTrafficPort = createTrafficPort({ assessmentWorkspace });
  const unifiedIdentityPort = createIdentityPort({
    fs,
    path,
    assessmentWorkspace,
    protector: {
      available: () => safeStorage?.isEncryptionAvailable?.() || false,
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  });
  const unifiedReplayPort = createReplayPort({ securityHttpWorkbench, identityPort: unifiedIdentityPort, scopePort: unifiedScopePort });
  function appendManagedDescriptor(descriptor) {
    if (!descriptor?.managedOperationId) return;
    try {
      const target = path.join(path.resolve(descriptor.cwd || "."), ".xekute", "logs", "managed-processes.jsonl");
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.appendFileSync(target, `${JSON.stringify(descriptor)}\n`, "utf8");
    } catch { /* best-effort persistence */ }
  }
  function loadManagedDescriptor(managedOperationId) {
    try {
      const root = path.resolve(".");
      const target = path.join(root, ".xekute", "logs", "managed-processes.jsonl");
      if (!fs.existsSync(target)) return null;
      return fs.readFileSync(target, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
        .reverse().find((entry) => entry.managedOperationId === managedOperationId) || null;
    } catch { return null; }
  }
  const unifiedTestingPort = createTestingPort({
    buildAction,
    assessmentWorkspace,
    persistArtifact: writeUnifiedArtifact,
    persistDescriptor: appendManagedDescriptor,
    loadDescriptor: loadManagedDescriptor,
    terminateProcessTree,
  });
  const unifiedResponsePort = createResponsePort({
    evidenceStore: {
      get: (workspace, evidenceId) => {
        const result = assessmentWorkspace.readJsonl(workspace, "evidence/index.jsonl", { limit: 2000 });
        return result?.records?.find((record) => String(record.id || record.requestId) === String(evidenceId)) || null;
      },
    },
  });
  const unifiedFindingPort = createFindingPort({
    assessmentWorkspace,
    fs,
    path,
    verifier: verifyFindingCandidate
      ? ({ finding, context }) => verifyFindingCandidate(context.workspace, context.model, finding)
      : null,
  });
  const unifiedGraphPort = createGraphPort({ assessmentMap });
  const unifiedBrowserPort = createBrowserPort();
  const unifiedDelegationPort = createDelegationPort();

  const unifiedToolRouter = createUnifiedToolRouter({
    scopeDecisionResolver: (decisionId, context) => unifiedScopePort.resolve(context, decisionId),
    ports: {
      exec_command: unifiedCommandPort,
      read_file: unifiedWorkspacePort,
      search_workspace: unifiedWorkspacePort,
      apply_patch: unifiedWorkspacePort,
      manage_plan: unifiedPlanPort,
      manage_state: unifiedStatePort,
      check_scope: unifiedScopePort,
      ingest_traffic: unifiedTrafficPort,
      manage_identity: unifiedIdentityPort,
      replay_request: unifiedReplayPort,
      run_test_case: unifiedTestingPort,
      browser_action: unifiedBrowserPort,
      compare_responses: unifiedResponsePort,
      verify_finding: createUnavailablePort(),
      store_finding: unifiedFindingPort,
      attack_graph: unifiedGraphPort,
      delegate_agent: unifiedDelegationPort,
    },
    policy: ({ toolName, input, profile, context }) => {
      const decision = loadPolicy(context.workspace || ".", null, null);
      if (toolName === "exec_command") return { allowed: true, code: "OK", reason: "Bounded workspace/development command capability." };
      if (profile !== "agent" && ["apply_patch", "manage_plan", "manage_state"].includes(toolName)) return { allowed: false, code: "PROFILE_DENIED", reason: `${toolName} is not available in ${profile} profile.` };
      return { allowed: true, policy: decision };
    },
    auditSink: (entry) => appendToolAudit(entry.workspace || "", entry),
    stateStore: {
      save: (state) => appendOperationState(state.workspace || "", state),
      load: (operationId, workspace) => {
        if (!workspace) return null;
        try {
          const target = path.join(path.resolve(workspace), ".xekute", "logs", "tool-operations.jsonl");
          const lines = fs.readFileSync(target, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
          return lines.reverse().find((entry) => entry.operationId === operationId || entry.operation_id === operationId) || null;
        } catch { return null; }
      },
    },
  });

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
    try { unifiedTestingPort.managed?.dispose?.(); } catch { /* ignore */ }
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
    unifiedToolRouter,
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
