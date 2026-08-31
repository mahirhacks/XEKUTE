"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createWorkspaceSearch } = require("../../agent/tools/workspace/workspace-search.js");
const { createWebResearch } = require("../../app/services/research/web-research.js");
const { createWebCloneService } = require("../../app/services/research/webclone.js");
const { createAssessmentWorkspace } = require("../../domain/assessment/assessment-workspace");
const { createAssessmentMap } = require("../../domain/assessment/assessment-map");
const { createJavascriptArtifactStore } = require("../../domain/assessment/javascript-artifact-store.js");
const { createWebArtifactStore } = require("../../domain/assessment/web-artifact-store.js");
const { createGraphBuildService } = require("../../app/services/assessment/traffic-graph/graph-build-service.js");
const { createJavascriptCollector } = require("../../app/services/assessment/traffic-graph/javascript-collector.js");
const { buildIntruderRequests, createSecurityHttpWorkbench } = require("../../interceptor/http-workbench.js");
const { createProxyListenerService } = require("../../interceptor/proxy-listener.js");
const { createProxyBrowserService } = require("../../interceptor/proxy-browser.js");
const { createV3SessionStore } = require("../../app/storage/memory/v3-session-store.js");
const { createIdentityVault } = require("../../app/storage/identity-vault-store.js");
const { createBrowserSessionManager } = require("../../agent/tools/assessment/browser-session-manager.js");
const { createAssessmentIntelligenceService } = require("../../app/services/assessment/intelligence/assessment-intelligence-service.js");
const { createProjectIdentityStore } = require("../../app/storage/memory/project-identity-store.js");
const { createProjectArtifactService } = require("../../app/services/artifacts/project-artifact-service.js");
const { createKnowledgeLibraryService } = require("../../app/services/knowledge/knowledge-library-service.js");
const { createTier1SensitiveStore } = require("../../app/storage/memory/tier1-sensitive-store.js");
const { createTier1ContextCoordinator } = require("../../app/services/memory/tier1-context-coordinator.js");
const { createKnowledgeProcedureStore } = require("../../app/services/memory/knowledge-procedure-store.js");
const { createNativeKagService } = require("../../app/services/memory/native-kag-service.js");
const { createLocalEmbeddingService } = require("../../app/services/memory/local-embedding-service.js");
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

// Tool registry + raw adapters (the 23 canonical tools).
const { createToolRegistry, registerAskQuestions, registerUpdateTaskList, registerExecCommand, registerReadFile, registerSearchWorkspace, registerApplyPatch, registerInspectEnvironment, registerUpdateProjectArtifacts, registerManageState, registerIngestTraffic, registerManageIdentity, registerReplayRequest, registerRunTestCase, registerBrowserAction, registerCompareResponses, registerVerifyFinding, registerAttackGraph, registerDelegateAgent, registerQueryAssessment, registerExpandEvidence, registerQueryKnowledge, registerWebResearch } = require("../../agent/tools/config/tool-registry.js");
const { createAskQuestionsTool } = require("../../agent/tools/process/ask-questions.js");
const { createUpdateTaskListTool } = require("../../agent/tools/process/update-task-list.js");
const { createExecCommandTool } = require("../../agent/tools/process/exec-command.js");
const { createReadFileTool } = require("../../agent/tools/workspace/read-file.js");
const { createSearchWorkspaceTool } = require("../../agent/tools/workspace/search-workspace.js");
const { createApplyPatchTool } = require("../../agent/tools/workspace/apply-patch.js");
const { createInspectEnvironmentTool } = require("../../agent/tools/workspace/inspect-environment.js");
const { createUpdateProjectArtifactsTool } = require("../../agent/tools/workspace/update-project-artifacts.js");
const { createManageStateTool } = require("../../agent/tools/workspace/manage-state.js");
const { createIngestTrafficTool } = require("../../agent/tools/assessment/ingest-traffic.js");
const { createManageIdentityTool } = require("../../agent/tools/assessment/manage-identity.js");
const { createReplayRequestTool } = require("../../agent/tools/assessment/replay-request.js");
const { createRunTestCaseTool } = require("../../agent/tools/assessment/run-test-case.js");
const { createBrowserActionTool } = require("../../agent/tools/assessment/browser-action.js");
const { createCompareResponsesTool } = require("../../agent/tools/assessment/compare-responses.js");
const { createVerifyFindingTool } = require("../../agent/tools/assessment/verify-finding.js");
const { createAttackGraphTool } = require("../../agent/tools/assessment/attack-graph.js");
const { createDelegateAgentTool } = require("../../agent/tools/process/delegate-agent.js");
const { createQueryAssessmentTool } = require("../../agent/tools/assessment/query-assessment.js");
const { createExpandEvidenceTool } = require("../../agent/tools/assessment/expand-evidence.js");
const { createQueryKnowledgeTool } = require("../../agent/tools/assessment/query-knowledge.js");
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
  const memoryTier1Coordinator = createTier1ContextCoordinator({ sensitiveStore: tier1SensitiveStore, schemaRegistry: memorySchemaRegistry, crypto });
  const projectArtifacts = createProjectArtifactService({ fs, path, crypto });
  // In a packaged Electron app the model is deliberately unpacked beside
  // app.asar because ONNX requires a real filesystem path.  Knowledge JSON
  // remains readable from ASAR, but prefer the unpacked resource directory
  // when a packager provides one so both assets follow the same resolution
  // rules.  Development and test runs use the source-tree bundle.
  const memoryModelRelativePath = path.join("resources", "memory-v3", "models", "bge-base-en-v1.5");
  const packagedResourceRoot = typeof process?.resourcesPath === "string" ? process.resourcesPath : "";
  const memoryKnowledgeRelativePath = path.join("resources", "memory-v3", "knowledge");
  const memoryKnowledgeCandidates = [
    packagedResourceRoot ? path.join(packagedResourceRoot, "app.asar.unpacked", memoryKnowledgeRelativePath) : "",
    packagedResourceRoot ? path.join(packagedResourceRoot, memoryKnowledgeRelativePath) : "",
    path.join(config.appRoot, memoryKnowledgeRelativePath),
  ].filter(Boolean);
  const memoryKnowledgePath = memoryKnowledgeCandidates.find((candidate) => fs.existsSync(candidate)) || memoryKnowledgeCandidates[memoryKnowledgeCandidates.length - 1];
  const knowledgeStore = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: config.memoryV3KnowledgeDirectory(), bundledDir: memoryKnowledgePath, schemaRegistry: memorySchemaRegistry });
  const memoryModelCandidates = [
    packagedResourceRoot ? path.join(packagedResourceRoot, "app.asar.unpacked", memoryModelRelativePath) : "",
    packagedResourceRoot ? path.join(packagedResourceRoot, memoryModelRelativePath) : "",
    path.join(config.appRoot, memoryModelRelativePath),
  ].filter(Boolean);
  const memoryModelPath = memoryModelCandidates.find((candidate) => fs.existsSync(path.join(candidate, "manifest.json"))) || memoryModelCandidates[memoryModelCandidates.length - 1];
  const knowledgeEmbeddingService = createLocalEmbeddingService({ modelPath: memoryModelPath });
  const knowledgeKag = createNativeKagService({ knowledgeStore, cacheDirectory: config.memoryV3CacheDirectory(), embeddingProvider: knowledgeEmbeddingService, schemaRegistry: memorySchemaRegistry, fs, path, crypto });
  const knowledgeLibrary = createKnowledgeLibraryService({ store: knowledgeStore, kag: knowledgeKag, artifacts: projectArtifacts, projectIdentityStore: memoryProjectIdentityStore });

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

  // The canonical tool registry includes the two read-only intelligence tools.
  // Provider-optional adapters degrade to structured "unavailable" responses
  // when no provider is injected (see each adapter's contract).
  const toolRegistry = createToolRegistry();
  registerAskQuestions(toolRegistry, createAskQuestionsTool());
  registerUpdateTaskList(toolRegistry, createUpdateTaskListTool());
  registerExecCommand(toolRegistry, createExecCommandTool());
  registerReadFile(toolRegistry, createReadFileTool());
  registerSearchWorkspace(toolRegistry, createSearchWorkspaceTool());
  registerApplyPatch(toolRegistry, createApplyPatchTool());
  registerInspectEnvironment(toolRegistry, createInspectEnvironmentTool());
  registerUpdateProjectArtifacts(toolRegistry, createUpdateProjectArtifactsTool({ artifacts: projectArtifacts }));
  registerManageState(toolRegistry, createManageStateTool());
  registerIngestTraffic(toolRegistry, createIngestTrafficTool());
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
  registerRunTestCase(toolRegistry, createRunTestCaseTool());

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

  registerCompareResponses(toolRegistry, createCompareResponsesTool());
  registerVerifyFinding(toolRegistry, createVerifyFindingTool());
  registerAttackGraph(toolRegistry, createAttackGraphTool());
  registerDelegateAgent(toolRegistry, createDelegateAgentTool());
  registerQueryAssessment(toolRegistry, createQueryAssessmentTool({
    intelligence: assessmentIntelligence,
    artifacts: projectArtifacts,
  }));
  registerExpandEvidence(toolRegistry, createExpandEvidenceTool({
    intelligence: assessmentIntelligence,
    artifacts: projectArtifacts,
  }));
  registerQueryKnowledge(toolRegistry, createQueryKnowledgeTool({
    knowledge: knowledgeLibrary,
  }));
  registerWebResearch(toolRegistry, createWebResearchTool({ webResearch }));
  const toolAuditStore = createToolAuditStore({ fsImpl: fs, pathImpl: path });
  const longHorizonRunStore = createLongHorizonRunStore({ fsImpl: fs, pathImpl: path });
  const authorityComposition = createAuthorityComposition({ evaluateScope: evaluateToolScopeAsync, fsImpl: fs });
  const invocationPipeline = createInvocationPipeline({ authorityRegistry: authorityComposition.registry, concurrency: authorityComposition.concurrency });
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
  const webClone = createWebCloneService({ fs, path, webResearch, projectProfileProvider: (workspace) => projectProfileStore().read(workspace)?.profile || null });
  const assessmentWorkspace = createAssessmentWorkspace({
    fs,
    path,
    projectArtifacts,
    projectProfileProvider: (workspace) => projectProfileStore().read(workspace)?.profile || null,
  });
  const javascriptArtifacts = createJavascriptArtifactStore({ fs, path, crypto });
  const webArtifacts = createWebArtifactStore({ fs, path, crypto });
  const assessmentMap = createAssessmentMap({ fs, path, crypto, assessmentWorkspace, projectProfileProvider: (workspace) => projectProfileStore().read(workspace)?.profile || null, intelligence: assessmentIntelligence, javascriptArtifacts, webArtifacts });
  assessmentIntelligence.setGraphProvider?.(assessmentMap);
  const graphBuildService = createGraphBuildService({
    assessmentMap,
    javascriptArtifacts,
    webArtifacts,
    onEvent: (event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("assessment:graphStatus", event);
    },
  });
  const javascriptCollector = createJavascriptCollector({
    artifacts: javascriptArtifacts,
    webArtifacts,
    assessmentMap,
    authorizeUrl: (target, { workspace, initialUrl, redirect } = {}) => {
      const projectProfile = projectProfileStore().read(workspace)?.profile || null;
      if (redirect > 0) return evaluateRedirectScopeAsync(initialUrl, target, { workspace, projectProfile });
      return evaluateToolScopeAsync({ workspace, toolName: "browser_action", args: { action: "navigate", url: target }, projectProfile });
    },
    onEvent: (event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("assessment:graphStatus", event);
    },
  });
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

  const terminals = new Map();
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
      await graphBuildService.flush();
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
      for (const record of toolProcesses.values()) {
        terminateProcessTree(record.child);
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
      // explicitly during shutdown.  The embedding worker is likewise
      // disposable and must not keep model state alive after app exit.
      try { tier1SensitiveStore.clearEphemeral?.(); } catch { /* best effort */ }
      try { knowledgeEmbeddingService.dispose?.(); } catch { /* best effort */ }
    })();
    return disposePromise;
  }

  function terminateProcessTree(child, tree = null) {
    if (!child?.pid) return;
    if (process.platform === "win32") {
      try {
        const { spawn } = require("child_process");
        const pids = [...new Set([child.pid, ...(Array.isArray(tree?.pids) ? tree.pids : [])]
          .map((pid) => Number(pid))
          .filter((pid) => Number.isInteger(pid) && pid > 0))];
        for (const pid of pids) {
          const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.unref();
        }
        return;
      } catch { /* Fall back to the direct child below. */ }
    }
    // POSIX supervised commands are started detached, making the root PID the
    // process-group ID. Signal the whole group so descendants do not survive
    // a user stop or agent cancellation. Windows commands stay attached to
    // avoid a PowerShell detached-launch bug and are terminated by taskkill
    // using the sampled process-tree PIDs above.
    try {
      const pid = Number(child.pid);
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(-pid, "SIGTERM");
        return;
      }
    } catch { /* No detached process group; fall back to the direct child. */ }
    try { child.kill("SIGTERM"); } catch { /* Process already exited. */ }
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
    assessmentMap,
    javascriptArtifacts,
    webArtifacts,
    javascriptCollector,
    graphBuildService,
    assessmentIntelligence,
    projectArtifacts,
    knowledgeLibrary,
    memoryProjectIdentityStore,
    memorySchemaRegistry,
    tier1SensitiveStore,
    memoryTier1Coordinator,
    knowledgeStore,
    knowledgeEmbeddingService,
    knowledgeKag,
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
