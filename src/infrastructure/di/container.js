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
const { getDefaultMemorySchemaRegistry } = require("../../contracts/memory/schema-registry.js");
const { createMcpRuntime } = require("../../app/services/assessment/knowledge/mcp-runtime.js");
const { createWorkspaceFiles } = require("../../app/services/workspace/workspace-files.js");
const { createProjectProfileStore } = require("../../app/storage/project-profile-store.js");
const { createAppConfig } = require("../config/app-config");
const { createAuthorityComposition } = require("../../agent/authority/composition.js");
const { createInvocationPipeline } = require("../../agent/authority/invocation-pipeline.js");
const { createToolAuditStore } = require("../../app/storage/tool-audit-store.js");
const { createLongHorizonRunStore } = require("../../app/storage/long-horizon-run-store.js");
const { createDurableProcessManager, createEncryptedProcessHandleStore } = require("../../app/services/terminal/durable-process-manager.js");
const { terminateProcessTree } = require("../../app/services/terminal/terminate-process-tree.js");
const { createActiveTerminalCatalog } = require("../../app/services/terminal/active-terminal-catalog.js");
const ContextBudget = require("../../agent/runtime/context-budget.js");

// Tool registry + raw adapters (the canonical tools).
const { createToolRegistry, registerAskQuestions, registerEndTurn, registerExecCommand, registerViewActiveTerminal, registerReadFile, registerSearchWorkspace, registerApplyPatch, registerManageIdentity, registerReplayRequest, registerBrowserAction, registerDelegateAgent, registerWebResearch, registerReleaseBlocks, registerRecallBlock } = require("../../agent/tools/config/tool-registry.js");
const { createReleaseBlocksTool, createRecallBlockTool } = require("../../agent/tools/process/context-blocks.js");
const { createAskQuestionsTool } = require("../../agent/tools/process/ask-questions.js");
const { createEndTurnTool } = require("../../agent/tools/process/end-turn.js");
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
  browserRuntimeSettings = null,
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
  const memorySchemaRegistry = getDefaultMemorySchemaRegistry();
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
  let nativeBrowserInstance = null;
  let browserArtifactsInstance = null;
  let nativeBrowserProviderInstance = null;
  function browserArtifacts() {
    if (!browserArtifactsInstance) {
      const { createBrowserArtifactStore } = require("../../app/services/browser/browser-artifact-store.js");
      browserArtifactsInstance = createBrowserArtifactStore({ directory: path.join(config.memoryV3SensitiveDirectory(), "browser-artifacts"), protector: memoryProtector });
    }
    return browserArtifactsInstance;
  }
  const researchDnsVerdicts = new Map();
  // Page and frame loads arrive in bursts; read the profile at most every
  // two seconds per workspace instead of from disk on each request.
  const requestPolicyProfiles = new Map();
  function requestPolicyProfile(workspace) {
    const cached = requestPolicyProfiles.get(workspace);
    if (cached && cached.at > Date.now() - 2_000) return cached.profile;
    const profile = projectProfileStore().read(workspace)?.profile || null;
    requestPolicyProfiles.set(workspace, { profile, at: Date.now() });
    return profile;
  }
  // Page and frame loads in agent-owned tabs: excluded or private targets
  // never load, and research tabs never resolve into a private network.
  async function agentBrowserRequestPolicy({ tab, url, workspace }) {
    if (!/^https?:/i.test(url)) return false;
    const { browserScopeStanding } = require("../../agent/authority/scope/browser-scope.js");
    const projectProfile = requestPolicyProfile(workspace);
    if (browserScopeStanding(url, { workspace, projectProfile, purpose: tab.purpose }).standing === "denied") return true;
    if (tab.purpose !== "research") return false;
    const host = new URL(url).hostname;
    const cached = researchDnsVerdicts.get(host);
    if (cached && cached.at > Date.now() - 60_000) return cached.block;
    const { resolveTargetAddresses } = require("../../domain/scope/scope-engine.js");
    const block = (await resolveTargetAddresses(url).catch(() => ({ ok: true }))).code === "DNS_PRIVATE_OR_RESERVED";
    researchDnsVerdicts.set(host, { block, at: Date.now() });
    return block;
  }
  function nativeBrowser() {
    if (!nativeBrowserInstance) {
      const { createNativeBrowserService } = require("../../app/services/browser/native-browser-service.js");
      const { createBrowserTabStore } = require("../../app/storage/browser-tab-store.js");
      nativeBrowserInstance = createNativeBrowserService({
        electron: require("electron"),
        getWindow: getMainWindow,
        identityVault: identityVault(),
        proxyListener: getProxyListener(),
        artifactStore: browserArtifacts(),
        tabStore: createBrowserTabStore({ directory: path.join(config.memoryV3SensitiveDirectory(), "browser-tabs"), protector: memoryProtector }),
        requestPolicy: agentBrowserRequestPolicy,
        downloadPolicy: ({ workspace }) => {
          const rule = requestPolicyProfile(workspace)?.browser || {};
          return { blocked: rule.downloads === "blocked", maxBytes: (Number(rule.maxDownloadMiB) || 12) * 1048576 };
        },
        onEvent: event => {
          const window = getMainWindow();
          if (window && !window.isDestroyed()) window.webContents.send("browser:event", event);
        },
      });
    }
    return nativeBrowserInstance;
  }
  async function prepareNativeBrowserProxy(workspace) {
    const listener = getProxyListener();
    let status = listener.getStatus();
    if (status.running && status.assessmentPath && path.resolve(status.assessmentPath) === path.resolve(workspace)) {
      if (status.error) status = listener.clearError();
    } else {
      const profile = projectProfileStore().read(workspace)?.profile || {};
      const settings = structuredClone(browserRuntimeSettings ? browserRuntimeSettings(workspace) : profile.runtime || {});
      settings.listener = { ...(settings.listener || {}), enabled: true };
      const external = proxyBrowser.status();
      if (external?.running) await proxyBrowser.close(external.workspace);
      status = await listener.configure(workspace, { settings, targets: profile.scope?.inScopeTargets || null });
    }
    if (!status?.running) throw Object.assign(new Error(status?.error || "The browser capture proxy could not be started."), { code: status?.code || "BROWSER_PROXY_UNAVAILABLE" });
  }
  let browserAdmission = Promise.resolve();
  function activateNativeBrowser(workspace, purpose = "assessment") {
    const pending = browserAdmission.then(async () => {
      const service = nativeBrowser(), previous = service.status().projectId;
      await service.activateProject({ id: identityVault().projectIdFor(workspace), workspace }, purpose === "assessment" ? () => prepareNativeBrowserProxy(workspace) : null);
      if (previous !== service.status().projectId) await service.restore({ wait: false, prepareProxy: () => prepareNativeBrowserProxy(workspace) });
      if (purpose === "assessment") await prepareNativeBrowserProxy(workspace);
      return service;
    });
    browserAdmission = pending.catch(() => {});
    return pending;
  }
  function nativeBrowserProvider() {
    if (!nativeBrowserProviderInstance) {
      const { createNativeBrowserProvider } = require("../../app/services/browser/native-browser-provider.js");
      const { createNativeBrowserVisual } = require("../../app/services/browser/native-browser-visual.js");
      const service = nativeBrowser();
      nativeBrowserProviderInstance = createNativeBrowserProvider({ getService: () => service,
        activate: (context, input) => activateNativeBrowser(context.workspace?.root || context.workspace, input.action === "open_page" ? input.purpose || "assessment" : "research"), artifactStore: browserArtifacts(),
        visual: createNativeBrowserVisual({ service, artifactStore: browserArtifacts() }) });
    }
    return nativeBrowserProviderInstance;
  }
  function closeNativeBrowserProject() { return nativeBrowserInstance?.closeProject(); }
  function nativeBrowserTabs(workspace, sessionId) {
    if (!nativeBrowserInstance || nativeBrowserInstance.status().projectId !== identityVault().projectIdFor(workspace)) return [];
    return nativeBrowserInstance.list().filter(tab => tab.owner.kind === "chat" && tab.owner.sessionId === sessionId);
  }
  function nativeBrowserTab(workspace, tabId) {
    if (!nativeBrowserInstance || nativeBrowserInstance.status().projectId !== identityVault().projectIdFor(workspace)) return null;
    return nativeBrowserInstance.list().find(tab => tab.id === tabId) || null;
  }
  function describeBrowserTarget(tabId, target) { return nativeBrowserProviderInstance?.describe(tabId, target) || null; }
  function closeNativeBrowserIdentity(workspace, identityId) { return nativeBrowserInstance?.closeIdentity(workspace, identityId); }
  function cancelNativeBrowserChat(sessionId) { return nativeBrowserInstance?.cancelChat(sessionId); }
  function hideNativeBrowser() { nativeBrowserInstance?.hide(); }
  async function shutdownNativeBrowser() { return nativeBrowserInstance?.shutdown(); }
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
    handleStore: createEncryptedProcessHandleStore({ baseDir: path.join(config.memoryV3SensitiveDirectory(), "process-handles"), protector: memoryProtector }),
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
  registerEndTurn(toolRegistry, createEndTurnTool());
  registerReleaseBlocks(toolRegistry, createReleaseBlocksTool());
  registerRecallBlock(toolRegistry, createRecallBlockTool());
  registerExecCommand(toolRegistry, createExecCommandTool({ processManager: durableProcessManager }));
  registerViewActiveTerminal(toolRegistry, createViewActiveTerminalTool({ catalog: activeTerminalCatalog }));
  registerReadFile(toolRegistry, createReadFileTool());
  registerSearchWorkspace(toolRegistry, createSearchWorkspaceTool());
  registerApplyPatch(toolRegistry, createApplyPatchTool());
  registerManageIdentity(toolRegistry, createManageIdentityTool({
    identityVault: identityVault(),
    onDelete: async (workspace, identityId) => {
      await closeNativeBrowserIdentity(workspace, identityId);
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

  // Retained for the manual identity-login surface until its final migration.
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
        return nativeBrowserProvider().execute(input, context, runtime);
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
      try { await nativeBrowserInstance?.shutdown(); } catch { /* Native session persistence reports its own warnings. */ }
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
    nativeBrowser,
    nativeBrowserProvider,
    nativeBrowserTabs,
    nativeBrowserTab,
    describeBrowserTarget,
    nativeBrowserProjectId: () => nativeBrowserInstance?.status().projectId || "",
    browserArtifacts,
    activateNativeBrowser,
    closeNativeBrowserProject,
    closeNativeBrowserIdentity,
    cancelNativeBrowserChat,
    hideNativeBrowser,
    shutdownNativeBrowser,
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
