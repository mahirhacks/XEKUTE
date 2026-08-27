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
const { createSessionMemoryStore } = require("../../app/storage/session-memory-store.js");
const { createIdentityVault } = require("../../app/storage/identity-vault-store.js");
const { createBrowserSessionManager } = require("../../agent/tools/assessment/browser-session-manager.js");
const { createAssessmentIntelligenceService } = require("../../app/services/assessment/intelligence/assessment-intelligence-service.js");
const { createAssessmentModeWorkflow } = require("../../app/services/assessment/mode-workflow.js");
const { createProjectMemoryStore } = require("../../app/storage/project-memory-store.js");
const { createProjectIdentityStore } = require("../../app/storage/memory/project-identity-store.js");
const { createMemoryManifestStore } = require("../../app/storage/memory/memory-manifest-store.js");
const { createMemoryEventStore } = require("../../app/storage/memory/event-store.js");
const { createMemorySnapshotStore } = require("../../app/storage/memory/snapshot-store.js");
const { createArtifactRegistry } = require("../../app/storage/memory/artifact-registry.js");
const { createDerivedMemoryIndex } = require("../../app/storage/memory/derived-memory-index.js");
const { createMemoryGraphStore } = require("../../app/storage/memory/memory-graph-store.js");
const { createMemoryFinalizationStore } = require("../../app/storage/memory/finalization-store.js");
const { createMemoryOutboxStore } = require("../../app/storage/memory/outbox-store.js");
const { createMemoryWatermarkStore } = require("../../app/storage/memory/watermark-store.js");
const { createProjectMemoryRepository } = require("../../app/storage/memory/project-memory-store.js");
const { createInvestigationMemoryRepository } = require("../../app/storage/memory/investigation-memory-store.js");
const { createEvidenceMemoryRepository } = require("../../app/storage/memory/evidence-memory-store.js");
const { createProjectMemoryV1Adapter } = require("../../app/storage/memory/project-memory-v1-adapter.js");
const { createExecutionCapture } = require("../../app/services/memory/execution-capture.js");
const { createBlockFinalizer } = require("../../app/services/memory/block-finalizer.js");
const { createBlockMemoryUpdater } = require("../../app/services/memory/block-memory-updater.js");
const { createMemoryRetrievalService } = require("../../app/services/memory/memory-retrieval-service.js");
const { createKnowledgeSelectionService } = require("../../app/services/memory/knowledge-selection-service.js");
const { createInvestigationMemoryService } = require("../../app/services/memory/investigation-memory-service.js");
const { createEvidenceMemoryService } = require("../../app/services/memory/evidence-memory-service.js");
const { createSensitiveWorkingMemory } = require("../../app/services/memory/sensitive-working-memory.js");
const { createMemoryStatus } = require("../../app/services/memory/memory-status.js");
const { createKnowledgeReleaseStore } = require("../../app/storage/memory/knowledge-release-store.js");
const { createKnowledgeReleaseIngestor } = require("../../app/services/assessment/knowledge/knowledge-release-ingestor.js");
const { createContextCompiler } = require("../../agent/memory/context/context-compiler.js");
const { createTranscriptBoundaryService } = require("../../app/services/memory/transcript-boundary.js");
const { createOperationalContextStore } = require("../../app/storage/memory/operational-context-store.js");
const { createContextSummarizer } = require("../../app/services/memory/context-summarizer.js");
const { createContextCheckpointService } = require("../../app/services/memory/context-checkpoint-service.js");
const { reduceToolEvents } = require("../../app/services/memory/tool-event-ledger.js");
const { createContextAssemblyService } = require("../../app/services/memory/context-assembly-service.js");
const { createDerivedMemoryProjectionService } = require("../../app/services/memory/derived-memory-projection-service.js");
const { createMemoryGraphView } = require("../../app/services/memory/memory-graph-view.js");
const { createInvestigationAssignmentLeaseService } = require("../../app/services/memory/investigation-assignment-leases.js");
const { createSpecialistDispatchService } = require("../../app/services/memory/specialist-dispatch-service.js");
const { createSpecialistReturnService } = require("../../app/services/memory/specialist-return-service.js");
const { createAgentMemoryHandoffService } = require("../../app/services/memory/agent-memory-handoff-service.js");
const { createMemoryIpcService } = require("../../app/services/memory/memory-ipc-service.js");
const { createMemoryAuditStore } = require("../../app/storage/memory/memory-audit-store.js");
const { createMigrationStore } = require("../../app/storage/memory/migration-store.js");
const { createLegacyMemoryMigration } = require("../../app/services/memory/legacy-memory-migration.js");
const { createMemorySecurityAudit } = require("../../app/services/memory/memory-security-audit.js");
const { createMemoryMaintenanceService } = require("../../app/services/memory/memory-maintenance-service.js");
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
const { createToolRegistry, registerAskQuestions, registerUpdateTaskList, registerExecCommand, registerReadFile, registerSearchWorkspace, registerApplyPatch, registerInspectEnvironment, registerManagePlan, registerManageState, registerIngestTraffic, registerManageIdentity, registerReplayRequest, registerRunTestCase, registerBrowserAction, registerCompareResponses, registerVerifyFinding, registerStoreFinding, registerAttackGraph, registerDelegateAgent, registerQueryAssessment, registerExpandEvidence, registerQueryKnowledge, registerWebResearch } = require("../../agent/tools/config/tool-registry.js");
const { createAskQuestionsTool } = require("../../agent/tools/process/ask-questions.js");
const { createUpdateTaskListTool } = require("../../agent/tools/process/update-task-list.js");
const { createExecCommandTool } = require("../../agent/tools/process/exec-command.js");
const { createReadFileTool } = require("../../agent/tools/workspace/read-file.js");
const { createSearchWorkspaceTool } = require("../../agent/tools/workspace/search-workspace.js");
const { createApplyPatchTool } = require("../../agent/tools/workspace/apply-patch.js");
const { createInspectEnvironmentTool } = require("../../agent/tools/workspace/inspect-environment.js");
const { createManagePlanTool } = require("../../agent/tools/workspace/manage-plan.js");
const { createManageStateTool } = require("../../agent/tools/workspace/manage-state.js");
const { createIngestTrafficTool } = require("../../agent/tools/assessment/ingest-traffic.js");
const { createManageIdentityTool } = require("../../agent/tools/assessment/manage-identity.js");
const { createReplayRequestTool } = require("../../agent/tools/assessment/replay-request.js");
const { createRunTestCaseTool } = require("../../agent/tools/assessment/run-test-case.js");
const { createBrowserActionTool } = require("../../agent/tools/assessment/browser-action.js");
const { createCompareResponsesTool } = require("../../agent/tools/assessment/compare-responses.js");
const { createVerifyFindingTool } = require("../../agent/tools/assessment/verify-finding.js");
const { createStoreFindingTool } = require("../../agent/tools/assessment/store-finding.js");
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
function createContainer({ app, safeStorage, sendToWindow = () => {}, getMainWindow = () => null } = {}) {
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
  const modeWorkflow = createAssessmentModeWorkflow();
  const memoryFeatureFlags = config.memoryFeatures();
  const memoryKnowledgeReleaseStore = createKnowledgeReleaseStore({
    fs,
    path,
    crypto,
    baseDir: path.join(config.sessionMemoryDirectory(), "memory"),
  });
  const memoryKnowledgeReleaseIngestor = createKnowledgeReleaseIngestor({
    graph: assessmentIntelligence.knowledge?.graph,
    releaseStore: memoryKnowledgeReleaseStore,
    crypto,
  });
  const memoryProjectIdentityStore = createProjectIdentityStore({
    fs,
    path,
    crypto,
    baseDir: config.sessionMemoryDirectory(),
  });
  const memoryManifestStore = createMemoryManifestStore({ fs, path, crypto });
  const memoryEventStore = createMemoryEventStore({ fs, path, crypto, manifestStore: memoryManifestStore });
  const memorySnapshotStore = createMemorySnapshotStore({ fs, path, crypto, manifestStore: memoryManifestStore });
  const memoryArtifactRegistry = createArtifactRegistry({ fs, path, crypto });
  const memoryExecutionCapture = createExecutionCapture({
    fs,
    path,
    crypto,
    eventStore: memoryEventStore,
    artifactRegistry: memoryArtifactRegistry,
  });
  const memoryFinalizationStore = createMemoryFinalizationStore({
    fs,
    path,
    crypto,
    baseDir: path.join(config.sessionMemoryDirectory(), "memory", "recovery", "context-finalization"),
    protector: memoryProtector,
  });
  const memoryOutboxStore = createMemoryOutboxStore({ fs, path, crypto, manifestStore: memoryManifestStore });
  const memoryWatermarkStore = createMemoryWatermarkStore({ fs, path, crypto, manifestStore: memoryManifestStore });
  const memoryMigrationStore = createMigrationStore({ fs, path, crypto });
  const memoryProjectMemoryRepository = createProjectMemoryRepository({
    fs,
    path,
    crypto,
    manifestStore: memoryManifestStore,
    eventStore: memoryEventStore,
    snapshotStore: memorySnapshotStore,
  });
  const memoryInvestigationMemoryRepository = createInvestigationMemoryRepository({
    fs,
    path,
    crypto,
    manifestStore: memoryManifestStore,
    eventStore: memoryEventStore,
    snapshotStore: memorySnapshotStore,
  });
  const memoryEvidenceMemoryRepository = createEvidenceMemoryRepository({
    fs,
    path,
    crypto,
    manifestStore: memoryManifestStore,
    eventStore: memoryEventStore,
    snapshotStore: memorySnapshotStore,
  });
  const memoryDerivedMemoryIndex = createDerivedMemoryIndex({ fs, path, crypto });
  const memoryGraphStore = createMemoryGraphStore({ fs, path, crypto });
  const memoryDerivedProjection = createDerivedMemoryProjectionService({
    index: memoryDerivedMemoryIndex,
    projectRepository: memoryProjectMemoryRepository,
    investigationRepository: memoryInvestigationMemoryRepository,
    evidenceRepository: memoryEvidenceMemoryRepository,
    artifactRegistry: memoryArtifactRegistry,
    manifestStore: memoryManifestStore,
    watermarkStore: memoryWatermarkStore,
    featureFlags: memoryFeatureFlags,
    crypto,
  });
  const memoryStatus = createMemoryStatus();
  const memoryAuditStore = createMemoryAuditStore({ fs, path, crypto });
  let memoryGraphView = null;
  const memoryIpcContainer = {
    memoryFeatureFlags,
    memoryProjectIdentityStore,
    memoryStatus,
    memoryAuditStore,
    memoryProjectMemoryRepository,
    memoryInvestigationMemoryRepository,
    memoryEvidenceMemoryRepository,
    memoryWatermarkStore,
    memoryOutboxStore,
    memoryMigrationStore,
    memoryMigration: null,
    memorySecurityAudit: null,
    memoryMaintenance: null,
    memoryDerivedMemoryIndex,
    memoryGraphView: null,
    memoryContextCheckpoint: null,
    memoryArtifactRegistry,
    memoryDerivedProjection,
  };
  const memoryProjectMemoryV1Adapter = createProjectMemoryV1Adapter({
    fs,
    path,
    crypto,
    repository: memoryProjectMemoryRepository,
    artifactRegistry: memoryArtifactRegistry,
  });
  // These providers are assigned after the checkpoint coordinator is built;
  // the retrieval service remains a singleton and never owns checkpoint data.
  let memoryContextCheckpoint = null;
  const memoryRetrievalService = createMemoryRetrievalService({
    projectRepository: memoryProjectMemoryRepository,
    investigationRepository: memoryInvestigationMemoryRepository,
    evidenceRepository: memoryEvidenceMemoryRepository,
    knowledgeStore: memoryKnowledgeReleaseStore,
    artifactRegistry: memoryArtifactRegistry,
    checkpointProvider: (input) => memoryContextCheckpoint?.read?.({
      workspace: input.workspace,
      projectId: input.project_id || input.projectId,
      sessionId: input.sessionId || input.session_id,
    }) || { ok: true, initialized: false, records: [], recentTail: [] },
    recentTailProvider: (input) => {
      const current = memoryContextCheckpoint?.read?.({
        workspace: input.workspace,
        projectId: input.project_id || input.projectId,
        sessionId: input.sessionId || input.session_id,
      });
      return current?.ok === false ? current : { ok: true, records: (current?.recentTail || []).map((message) => ({ record_id: message.id, record_type: "transcript_message", record: message })) };
    },
    graphProvider: async ({ workspace, projectId, request }) => {
      if (memoryFeatureFlags.derivedMemoryViews === true && memoryGraphView?.query) return memoryGraphView.query(workspace, projectId, {
        operation: request.filters?.operation || "search",
        node_id: request.filters?.node_id || request.filters?.nodeId || "",
        from: request.filters?.from || "",
        to: request.filters?.to || "",
        query: request.objective || request.filters?.query || "",
        limit: request.limit,
        depth: request.graph_depth,
        edge_type: request.filters?.edge_type || request.filters?.edgeType || "",
      });
      return assessmentIntelligence.knowledge?.query?.({ query: request.objective || "knowledge", limit: request.limit }, { activateMcp: false }) || { ok: true, items: [] };
    },
  });
  const memoryKnowledgeSelectionService = createKnowledgeSelectionService({
    fs,
    path,
    crypto,
    releaseStore: memoryKnowledgeReleaseStore,
    projectRepository: memoryProjectMemoryRepository,
    manifestStore: memoryManifestStore,
  });
  const memoryInvestigationMemoryService = createInvestigationMemoryService({
    repository: memoryInvestigationMemoryRepository,
    projectRepository: memoryProjectMemoryRepository,
    knowledgeSelectionService: memoryKnowledgeSelectionService,
    crypto,
  });
  const memoryEvidenceMemoryService = createEvidenceMemoryService({
    repository: memoryEvidenceMemoryRepository,
    investigationRepository: memoryInvestigationMemoryRepository,
    artifactRegistry: memoryArtifactRegistry,
    outboxStore: memoryOutboxStore,
    crypto,
  });
  const memorySensitiveWorkingMemory = createSensitiveWorkingMemory({
    fs,
    path,
    crypto,
    baseDir: path.join(config.sessionMemoryDirectory(), "sensitive"),
    protector: memoryProtector,
    projectResolver: (workspace, options) => sessionMemoryStore().resolveProject(workspace, options),
  });
  const memoryBlockFinalizer = createBlockFinalizer({
    eventStore: memoryEventStore,
    projectRepository: memoryProjectMemoryRepository,
    investigationMemoryService: memoryInvestigationMemoryService,
    derivedProjection: memoryDerivedProjection,
    derivedGraph: { scheduleRebuild: (input) => memoryGraphView?.scheduleRebuild?.(input) || Promise.resolve({ ok: true, skipped: true }) },
    watermarkStore: memoryWatermarkStore,
    finalizationStore: memoryFinalizationStore,
    featureFlags: memoryFeatureFlags,
    crypto,
  });
  const memoryBlockUpdater = createBlockMemoryUpdater({
    executionCapture: memoryExecutionCapture,
    blockFinalizer: memoryBlockFinalizer,
    projectIdentityStore: memoryProjectIdentityStore,
    memoryStatus,
    memoryAuditStore,
    featureFlags: memoryFeatureFlags,
    path,
    crypto,
  });
  const projectMemoryStore = createProjectMemoryStore({ fs, path, crypto, featureFlags: memoryFeatureFlags });
  const contextCompiler = createContextCompiler({
    projectMemoryStore,
    intelligence: assessmentIntelligence,
    modeWorkflow,
    finalizationDirectory: path.join(config.sessionMemoryDirectory(), "context-finalization"),
    protector: memoryProtector,
    fs,
    path,
    crypto,
  });
  contextCompiler.drainFinalizationJobs().catch(() => {});

  let identityVaultInstance = null;
  function identityVault() {
    if (!identityVaultInstance) {
      identityVaultInstance = createIdentityVault({
        fs,
        path,
        crypto,
        baseDir: config.sessionMemoryDirectory(),
        protector: memoryProtector,
        projectResolver: (workspace, options) => sessionMemoryStore().resolveProject(workspace, options),
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
  registerManagePlan(toolRegistry, createManagePlanTool());
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
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    sensitiveWorkingMemoryEnabled: Boolean(memoryFeatureFlags.sensitiveWorkingMemory),
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
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    sensitiveWorkingMemoryEnabled: Boolean(memoryFeatureFlags.sensitiveWorkingMemory),
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
  registerStoreFinding(toolRegistry, createStoreFindingTool());
  registerAttackGraph(toolRegistry, createAttackGraphTool());
  registerDelegateAgent(toolRegistry, createDelegateAgentTool({
    projectMemoryProvider: (workspace) => projectMemoryStore.projectMemoryProjection(projectMemoryStore.load(workspace).memory, workspace),
  }));
  registerQueryAssessment(toolRegistry, createQueryAssessmentTool({
    intelligence: assessmentIntelligence,
    memoryRetrieval: memoryRetrievalService,
    projectIdentityStore: memoryProjectIdentityStore,
    memoryFeatureFlags,
  }));
  registerExpandEvidence(toolRegistry, createExpandEvidenceTool({ intelligence: assessmentIntelligence }));
  registerQueryKnowledge(toolRegistry, createQueryKnowledgeTool({
    knowledge: assessmentIntelligence.knowledge,
    memoryRetrieval: memoryRetrievalService,
    projectIdentityStore: memoryProjectIdentityStore,
    memoryFeatureFlags,
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
  const webClone = createWebCloneService({ fs, path, webResearch });
  const assessmentWorkspace = createAssessmentWorkspace({
    fs,
    path,
    promptDefaults: () => require("../../agent/runtime/prompt-compiler.js").defaults(),
  });
  const javascriptArtifacts = createJavascriptArtifactStore({ fs, path, crypto });
  const webArtifacts = createWebArtifactStore({ fs, path, crypto });
  const assessmentMap = createAssessmentMap({ fs, path, crypto, assessmentWorkspace, intelligence: assessmentIntelligence, javascriptArtifacts, webArtifacts });
  memoryGraphView = createMemoryGraphView({
    store: memoryGraphStore,
    derivedProjection: memoryDerivedProjection,
    knowledgeStore: memoryKnowledgeReleaseStore,
    mapProvider: (workspace) => assessmentMap.read?.(workspace),
    manifestStore: memoryManifestStore,
    featureFlags: memoryFeatureFlags,
    crypto,
    featureFlags: memoryFeatureFlags,
  });
  memoryIpcContainer.memoryGraphView = memoryGraphView;
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

  let sessionMemoryStoreInstance = null;
  function sessionMemoryStore() {
    if (!sessionMemoryStoreInstance) {
      sessionMemoryStoreInstance = createSessionMemoryStore({
        fs,
        path,
        crypto,
        baseDir: config.sessionMemoryDirectory(),
        protector: memoryProtector,
      });
    }
    return sessionMemoryStoreInstance;
  }

  // Phase I Operational Context services are constructed in the composition
  // root, but remain inert until their feature flag is enabled.  The legacy
  // session store remains the owner of the exact transcript; these services
  // only read transcript boundaries and persist resumable checkpoint state.
  const memoryTranscriptBoundary = createTranscriptBoundaryService({
    sessionMemoryStore: sessionMemoryStore(),
    projectIdentityStore: memoryProjectIdentityStore,
    crypto,
  });
  const memoryOperationalContextStore = createOperationalContextStore({
    fs,
    path,
    crypto,
    baseDir: config.sessionMemoryDirectory(),
    protector: memoryProtector,
    projectIdentityStore: memoryProjectIdentityStore,
  });
  const memoryContextSummarizer = createContextSummarizer();
  memoryContextCheckpoint = createContextCheckpointService({
    boundaryService: memoryTranscriptBoundary,
    contextStore: memoryOperationalContextStore,
    ledgerService: { reduceToolEvents },
    summarizer: memoryContextSummarizer,
    watermarkStore: memoryWatermarkStore,
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    crypto,
  });
  memoryIpcContainer.memoryContextCheckpoint = memoryContextCheckpoint;
  const memoryContextAssembly = createContextAssemblyService({
    retrievalService: memoryRetrievalService,
    checkpointProvider: memoryContextCheckpoint,
    watermarkStore: memoryWatermarkStore,
    projectIdentityStore: memoryProjectIdentityStore,
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    crypto,
  });
  const memorySecurityAudit = createMemorySecurityAudit({
    fs,
    path,
    crypto,
    projectIdentityStore: memoryProjectIdentityStore,
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
  });
  const memoryMaintenance = createMemoryMaintenanceService({
    path,
    crypto,
    projectIdentityStore: memoryProjectIdentityStore,
    projectProfileStore: (workspace) => projectProfileStore().read(workspace),
    manifestStore: memoryManifestStore,
    eventStore: memoryEventStore,
    watermarkStore: memoryWatermarkStore,
    retrievalService: memoryRetrievalService,
    contextCheckpoint: memoryContextCheckpoint,
    derivedProjection: memoryDerivedProjection,
    graphView: () => memoryGraphView,
    artifactRegistry: memoryArtifactRegistry,
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    operationalContextStore: memoryOperationalContextStore,
    sessionMemoryStore,
    auditStore: memoryAuditStore,
    memoryStatus,
  });
  memoryIpcContainer.memorySecurityAudit = memorySecurityAudit;
  memoryIpcContainer.memoryMaintenance = memoryMaintenance;
  const memoryAssignmentLeases = createInvestigationAssignmentLeaseService({
    fs,
    path,
    crypto,
    baseDir: config.sessionMemoryDirectory(),
    now: () => new Date(),
    enabled: memoryFeatureFlags.multiAgentMemoryV2,
  });
  const memorySpecialistDispatch = createSpecialistDispatchService({
    contextAssembly: memoryContextAssembly,
    projectIdentityStore: memoryProjectIdentityStore,
    featureFlags: memoryFeatureFlags,
    crypto,
  });
  const memorySpecialistReturn = createSpecialistReturnService({
    featureFlags: memoryFeatureFlags,
    crypto,
  });
  const memoryAgentHandoff = createAgentMemoryHandoffService({
    specialistDispatch: memorySpecialistDispatch,
    sensitiveWorkingMemory: memorySensitiveWorkingMemory,
    featureFlags: memoryFeatureFlags,
  });
  const memoryMigration = createLegacyMemoryMigration({
    fs,
    path,
    crypto,
    featureFlags: memoryFeatureFlags,
    projectIdentityStore: memoryProjectIdentityStore,
    projectMemoryV1Adapter: memoryProjectMemoryV1Adapter,
    projectRepository: memoryProjectMemoryRepository,
    investigationRepository: memoryInvestigationMemoryRepository,
    investigationMemoryService: memoryInvestigationMemoryService,
    evidenceRepository: memoryEvidenceMemoryRepository,
    artifactRegistry: memoryArtifactRegistry,
    knowledgeReleaseStore: memoryKnowledgeReleaseStore,
    migrationStore: memoryMigrationStore,
    sessionMemoryStore,
    legacyChatDirectory: path.join(config.userData(), "xekute-app"),
    outboxStore: memoryOutboxStore,
  });
  memoryIpcContainer.memoryMigration = memoryMigration;
  const memoryIpc = createMemoryIpcService({
    container: memoryIpcContainer,
    featureFlags: memoryFeatureFlags,
    crypto,
  });

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
      contextCompiler.dispose();
      try { await memoryOperationalContextStore.flush?.(); } catch { /* Checkpoint writes are queued and best effort during shutdown. */ }
      try { await memoryDerivedProjection.whenIdle?.(); } catch { /* Derived views are rebuildable and never block shutdown. */ }
      try { await memoryGraphView?.whenIdle?.(); } catch { /* Derived graphs are rebuildable and never block shutdown. */ }
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
    modeWorkflow,
    memoryFeatureFlags,
    memoryProjectIdentityStore,
    memoryManifestStore,
    memoryEventStore,
    memorySnapshotStore,
    memoryArtifactRegistry,
    memoryDerivedMemoryIndex,
    memoryDerivedProjection,
    memoryGraphStore,
    memoryGraphView,
    memoryExecutionCapture,
    memoryFinalizationStore,
    memoryOutboxStore,
    memoryMigrationStore,
    memoryMigration,
    memorySecurityAudit,
    memoryMaintenance,
    memoryWatermarkStore,
    memoryProjectMemoryRepository,
    memoryInvestigationMemoryRepository,
    memoryEvidenceMemoryRepository,
    memoryProjectMemoryV1Adapter,
    memoryBlockFinalizer,
    memoryBlockUpdater,
    memoryStatus,
    memoryAuditStore,
    memoryKnowledgeReleaseStore,
    memoryKnowledgeReleaseIngestor,
    memoryRetrievalService,
    memoryKnowledgeSelectionService,
    memoryInvestigationMemoryService,
    memoryEvidenceMemoryService,
    memorySensitiveWorkingMemory,
    memoryTranscriptBoundary,
    memoryOperationalContextStore,
    memoryContextSummarizer,
    memoryContextCheckpoint,
    memoryContextAssembly,
    memoryAssignmentLeases,
    memorySpecialistDispatch,
    memorySpecialistReturn,
    memoryAgentHandoff,
    memoryIpc,
    projectMemoryStore,
    contextCompiler,
    mcpRuntime,
    securityHttpWorkbench,
    buildIntruderRequests,
    getProxyListener,
    proxyBrowser,
    projectProfileStore,
    identityVault,
    browserSessionManager,
    sessionMemoryStore,
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
