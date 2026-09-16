"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createWorkspaceSearch } = require("../../agent/tools/workspace/workspace-search.js");
const { createWebResearch } = require("../../app/services/research/web-research.js");
const { createWebCloneService } = require("../../app/services/research/webclone.js");
const { createAssessmentWorkspace } = require("../../domain/assessment/assessment-workspace");
const { createJavascriptArtifactStore } = require("../../domain/assessment/javascript-artifact-store.js");
const { createWebArtifactStore } = require("../../domain/assessment/web-artifact-store.js");
const { buildIntruderRequests, createSecurityHttpWorkbench } = require("../../interceptor/http-workbench.js");
const { createProxyListenerService } = require("../../interceptor/proxy-listener.js");
const { createProxyBrowserService } = require("../../interceptor/proxy-browser.js");
const { createV3SessionStore } = require("../../app/storage/memory/v3-session-store.js");
const { createIdentityVault } = require("../../app/storage/identity-vault-store.js");
const { createBrowserSessionManager } = require("../../agent/tools/assessment/browser-session-manager.js");
const { createAssessmentIntelligenceService } = require("../../app/services/assessment/intelligence/assessment-intelligence-service.js");
const { createProjectIdentityStore } = require("../../app/storage/memory/project-identity-store.js");
const { createProjectArtifactService } = require("../../app/services/artifacts/project-artifact-service.js");
const { createTier1SensitiveStore } = require("../../app/storage/memory/tier1-sensitive-store.js");
const { createTier1ContextCoordinator } = require("../../app/services/memory/tier1-context-coordinator.js");
const { createMemorySchemaRegistry } = require("../../contracts/memory/schema-registry.js");
const { createMcpRuntime } = require("../../app/services/assessment/knowledge/mcp-runtime.js");
const { createWorkspaceFiles } = require("../../app/services/workspace/workspace-files.js");
const { createProjectProfileStore } = require("../../app/storage/project-profile-store.js");
const { createAppConfig } = require("../config/app-config");
const { createAuthorityComposition } = require("../../agent/authority/composition.js");
const { createInvocationPipeline } = require("../../agent/authority/invocation-pipeline.js");
const { createToolAuditStore } = require("../../app/storage/tool-audit-store.js");
const { createLongHorizonRunStore } = require("../../app/storage/long-horizon-run-store.js");
const { createDurableProcessManager } = require("../../app/services/terminal/durable-process-manager.js");
const { terminateProcessTree } = require("../../app/services/terminal/terminate-process-tree.js");
const { createActiveTerminalCatalog } = require("../../app/services/terminal/active-terminal-catalog.js");
const ContextBudget = require("../../agent/runtime/context-budget.js");

// Tool registry + raw adapters (the canonical tools).
const { createToolRegistry, registerAskQuestions, registerExecCommand, registerViewActiveTerminal, registerReadFile, registerSearchWorkspace, registerApplyPatch, registerManageIdentity, registerReplayRequest, registerBrowserAction, registerDelegateAgent, registerWebResearch } = require("../../agent/tools/config/tool-registry.js");
const { createAskQuestionsTool } = require("../../agent/tools/process/ask-questions.js");
const { createExecCommandTool } = require("../../agent/tools/process/exec-command.js");
const { createViewActiveTerminalTool } = require("../../agent/tools/process/view-active-terminal.js");
const { createReadFileTool } = require("../../agent/tools/workspace/read-file.js");
const { createSearchWorkspaceTool } = require("../../agent/tools/workspace/search-workspace.js");
const { createApplyPatchTool } = require("../../agent/tools/workspace/apply-patch.js");
const { createManageIdentityTool } = require("../../agent/tools/assessment/manage-identity.js");
const { createReplayRequestTool } = require("../../agent/tools/assessment/replay-request.js");
const { createBrowserActionTool } = require("../../agent/tools/assessment/browser-action.js");
const { createDelegateAgentTool } = require("../../agent/tools/process/delegate-agent.js");
const { createWebResearchTool } = require("../../agent/tools/assessment/web-research.js");
const { evaluateToolScopeAsync, evaluateRedirectScopeAsync, evaluateLoginNavigation } = require("../../agent/authority/scope/scope-policy.js");

/**
 * DI composition root.
 *
 * Constructs every long-lived service and owns the process/terminal/
 * webclone state maps. `main.js` (the presentation shell) receives these
 * services and the `dispose()` path; no production module outside this file
 * constructs concrete adapters.
 */
function createContainer({
  app,
  safeStorage,
  sendToWindow = () => {},
  getMainWindow = () => null,
} = {}) {
  if (!app?.getPath) throw new TypeError("DI container requires an Electron app instance");

  const config = createAppConfig({ app });
  const memoryProtector = {
    available: () => safeStorage?.isEncryptionAvailable?.() || false,
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, "base64")),
  };

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const webResearch = createWebResearch();

  const mcpRuntime = createMcpRuntime({ fs, path, home: () => app.getPath("home") });
  const assessmentIntelligence = createAssessmentIntelligenceService({
    mcpRuntime,
    onEvent: (event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("assessment:intelligence", event);
    },
  });
  const memoryProjectIdentityStore = createProjectIdentityStore({
    fs,
    path,
    crypto,
    baseDir: config.memoryV3IdentityDirectory(),
  });
  const identityVaultProjectIdentityStore = createProjectIdentityStore({
    fs,
    path,
    crypto,
    baseDir: config.identityVaultDirectory(),
  });
  const memorySchemaRegistry = createMemorySchemaRegistry();
  const tier1SensitiveStore = createTier1SensitiveStore({ fs, path, crypto, baseDir: config.memoryV3SensitiveDirectory(), protector: memoryProtector, schemaRegistry: memorySchemaRegistry });
  const v3SessionStore = createV3SessionStore({ sensitiveStore: tier1SensitiveStore, projectIdentityStore: memoryProjectIdentityStore, crypto });
  const memoryTier1Coordinator = createTier1ContextCoordinator({
    sensitiveStore: tier1SensitiveStore,
    schemaRegistry: memorySchemaRegistry,
    crypto,
    // Section attribution uses the same local lexical counter as the provider
    // payload preflight. The context meter displays these Tier 1 row tokens
    // and does not scale them to provider-measured prompt totals.
    tokenCounter: (value) => ({
      tokens: ContextBudget.estimateTokenCount(typeof value === "string" ? value : JSON.stringify(value == null ? "" : value)),
      exact: false,
    }),
  });
  const projectArtifacts = createProjectArtifactService({ fs, path, crypto });

  let identityVaultInstance = null;
  function identityVault() {
    if (!identityVaultInstance) {
      identityVaultInstance = createIdentityVault({
        fs,
        path,
        crypto,
        baseDir: config.identityVaultDirectory(),
        protector: memoryProtector,
        projectResolver: (workspace, options) => identityVaultProjectIdentityStore.resolveProject(workspace, options),
      });
    }
    return identityVaultInstance;
  }

  // Declared before tool registration so model-facing identity deletion can
  // close every live browser context before removing the encrypted record.
  let browserSessionManager = null;
  const proxyBrowser = createProxyBrowserService({
    fs,
    path,
    crypto,
    profilesDirectory: config.proxyBrowserProfilesDirectory(),
    onStatus: (event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("proxy:browserStatus", event);
    },
  });

  // Provider-optional adapters degrade to structured "unavailable" responses
  // when no provider is injected (see each adapter's contract).
  const {
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    transferWorkspacePath,
  } = createWorkspaceFiles({ fs, path, workspaceSearch });
  const { listProjectFiles } = workspaceSearch;
  const durableProcessManager = createDurableProcessManager({
    fsImpl: fs,
    pathImpl: path,
    resolveWorkspaceTarget,
    resolveExecutable: require("../../agent/tools/process/executable-resolver.js").resolveSecurityExecutable,
    terminateProcessTree,
  });
  const terminals = new Map();
  const activeTerminalCatalog = createActiveTerminalCatalog({
    terminals,
    durableProcessManager,
  });
  const toolRegistry = createToolRegistry();
  registerAskQuestions(toolRegistry, createAskQuestionsTool());
  registerExecCommand(toolRegistry, createExecCommandTool({ processManager: durableProcessManager }));
  registerViewActiveTerminal(toolRegistry, createViewActiveTerminalTool({ catalog: activeTerminalCatalog }));
  registerReadFile(toolRegistry, createReadFileTool());
  registerSearchWorkspace(toolRegistry, createSearchWorkspaceTool());
  registerApplyPatch(toolRegistry, createApplyPatchTool());
  registerManageIdentity(toolRegistry, createManageIdentityTool({
    identityVault: identityVault(),
    onDelete: async (workspace, identityId) => {
      await browserSessionManager?.closeIdentity?.(workspace, identityId);
      await proxyBrowser.close(workspace, identityId);
    },
  }));
  registerReplayRequest(toolRegistry, createReplayRequestTool({
    identityProvider: {
      load: (identityId, executionContext) => {
        const workspace = executionContext?.workspace?.root || "";
        const loaded = identityVault().readSecret(workspace, identityId);
        if (!loaded?.ok) return null;
        const metadata = identityVault().metadataFor(workspace, identityId) || {};
        return { ...loaded.secret, account: metadata.account || {}, role: metadata.role || "default" };
      },
    },
    redirectGuard: (target, executionContext, { initialUrl } = {}) => evaluateRedirectScopeAsync(
      initialUrl || target,
      target,
      {
        workspace: executionContext?.workspace?.root || "",
        projectProfile: projectProfileStore().read(executionContext?.workspace?.root || "")?.profile || null,
      },
    ),
    identityVault: identityVault(),
  }));

  // browser_action reuses a matching operator-opened proxied context when one
  // exists; otherwise it uses an isolated installed Edge/Chrome context. The
  // fake provider remains available only when explicitly injected into tests.
  browserSessionManager = createBrowserSessionManager({
    identityVault: identityVault(),
    onStatus: (event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("identity:persistence", event);
    },
    beforeNavigation: (url, executionContext) => evaluateToolScopeAsync({
      workspace: executionContext?.workspace?.root || "",
      toolName: "browser_action",
      args: { action: "navigate", url },
      projectProfile: projectProfileStore().read(executionContext?.workspace?.root || "")?.profile || null,
    }),
    loginNavigation: (url, executionContext) => evaluateLoginNavigation(
      url,
      projectProfileStore().read(executionContext?.workspace?.root || "")?.profile || null,
      executionContext?.workspace?.root || "",
    ),
    sharedContextProvider: ({ workspace, identityId }) => proxyBrowser.getAgentContext(workspace, identityId),
  });
  registerBrowserAction(toolRegistry, createBrowserActionTool({
    browserProvider: {
      async execute(input, context, runtime = {}) {
        const evidence = await browserSessionManager.execute(input, context, runtime);
        return { ...(evidence && typeof evidence === "object" ? evidence : { evidence }), backend: browserSessionManager.runtime().name };
      },
      async close() {
        await browserSessionManager.close();
      },
    },
  }));

  registerDelegateAgent(toolRegistry, createDelegateAgentTool());
  registerWebResearch(toolRegistry, createWebResearchTool({ webResearch }));
  const toolAuditStore = createToolAuditStore({ fsImpl: fs, pathImpl: path });
  const longHorizonRunStore = createLongHorizonRunStore({ fsImpl: fs, pathImpl: path });
  const authorityComposition = createAuthorityComposition({ evaluateScope: evaluateToolScopeAsync, fsImpl: fs });
  const invocationPipeline = createInvocationPipeline({ authorityRegistry: authorityComposition.registry, concurrency: authorityComposition.concurrency });
  const webClone = createWebCloneService({ fs, path, webResearch, projectProfileProvider: (workspace) => projectProfileStore().read(workspace)?.profile || null });
  const assessmentWorkspace = createAssessmentWorkspace({
    fs,
    path,
    projectArtifacts,
    projectProfileProvider: (workspace) => projectProfileStore().read(workspace)?.profile || null,
  });
  const javascriptArtifacts = createJavascriptArtifactStore({ fs, path, crypto });
  const webArtifacts = createWebArtifactStore({ fs, path, crypto });
  const securityHttpWorkbench = createSecurityHttpWorkbench({ fs, path, assessmentWorkspace });

  let proxyListener = null;
  function getProxyListener() {
    if (!proxyListener) {
      proxyListener = createProxyListenerService({
        fs,
        path,
        assessmentWorkspace,
        javascriptArtifacts,
        getCaDirectory: (assessmentRoot) => resolveCentralCaDirectory(assessmentRoot),
        sendEvent: (channel, payload) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
        },
      });
    }
    return proxyListener;
  }

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

  const toolProcesses = new Map();
  const ollamaControllers = new Map();
  const pendingOperatorQuestions = new Map();
  const webClonePreviewDocuments = new Map();
  let webClonePreviewServer = null;
  let webClonePreviewServerPromise = null;
  let webClonePreviewPort = 0;
  let webClonePreviewView = null;
  let webClonePreviewUrl = "";
  let toolProcessCounter = 0;

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

  function readApplicationPreferences() {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.preferencesPath(), "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

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

  let disposePromise = null;
  function dispose() {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      await assessmentIntelligence.dispose();
      await javascriptArtifacts.flush();
      try { await tier1SensitiveStore.flush?.(); } catch { /* Exact Tier 1 writes are queued and best effort during shutdown. */ }
      mcpRuntime.clearAll();
      if (proxyListener) {
        try { await proxyListener.stop(); } catch { /* ignore */ }
        proxyListener = null;
      }
      for (const record of terminals.values()) {
        try { record.pty.kill(); } catch { /* ignore */ }
      }
      terminals.clear();
      activeTerminalCatalog.clearAll();
      for (const record of toolProcesses.values()) {
        void terminateProcessTree(record.child);
      }
      toolProcesses.clear();
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
      try { await browserSessionManager.close(); } catch { /* Best effort after identity state flush. */ }
      try { await proxyBrowser.close(); } catch { /* The operator may already have closed the browser. */ }
      try { await identityVaultInstance?.flush?.(); } catch { /* Encrypted persistence warnings were already surfaced. */ }
      try { await longHorizonRunStore.flush(); } catch { /* Durable checkpoints are best effort during shutdown. */ }
      // Tier 1 exact buffers are encrypted when secure storage is available;
      // in degraded mode they live only in this process and must be cleared
      // explicitly during shutdown.
      try { tier1SensitiveStore.clearEphemeral?.(); } catch { /* best effort */ }
    })();
    return disposePromise;
  }

  return {
    config,
    toolRegistry,
    workspaceSearch,
    listProjectFiles,
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    transferWorkspacePath,
    webResearch,
    webClone,
    assessmentWorkspace,
    javascriptArtifacts,
    webArtifacts,
    assessmentIntelligence,
    projectArtifacts,
    memoryProjectIdentityStore,
    memorySchemaRegistry,
    tier1SensitiveStore,
    memoryTier1Coordinator,
    mcpRuntime,
    securityHttpWorkbench,
    buildIntruderRequests,
    getProxyListener,
    proxyBrowser,
    projectProfileStore,
    identityVault,
    browserSessionManager,
    v3SessionStore,
    authorityRegistry: authorityComposition.registry,
    invocationPipeline,
    toolAuditStore,
    longHorizonRunStore,
    durableProcessManager,
    activeTerminalCatalog,
    resolveCentralCaDirectory,
    readApplicationPreferences,
    terminateProcessTree,
    terminals,
    toolProcesses,
    ollamaControllers,
    pendingOperatorQuestions,
    webClonePreviewDocuments,
    webClonePreviewState,
    dispose,
  };
}

module.exports = { createContainer };
