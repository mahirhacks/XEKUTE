"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const { createContainer } = require("../src/infrastructure/di/container");

function fakeApp() {
  return {
    getPath: () => path.join(os.tmpdir(), "xekute-container-test"),
  };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(String(text), "utf8").toString("base64"),
    decryptString: (payload) => Buffer.from(String(payload), "base64").toString("utf8"),
  };
}

test("container constructs the full service graph with fake Electron deps", () => {
  const container = createContainer({ app: fakeApp(), safeStorage: fakeSafeStorage(), getMainWindow: () => null });

  assert.equal(typeof container.config, "object");
  assert.equal(typeof container.config.userData, "function");
  assert.equal(typeof container.workspaceSearch, "object");
  assert.equal(typeof container.listProjectFiles, "function");
  assert.equal(typeof container.resolveWorkspaceTarget, "function");
  assert.equal(typeof container.editWorkspaceFile, "function");
  assert.equal(typeof container.deleteWorkspaceFile, "function");
  assert.equal(typeof container.transferWorkspacePath, "function");
  assert.equal(typeof container.webResearch, "object");
  assert.equal(typeof container.webClone, "object");
  assert.equal(typeof container.assessmentWorkspace, "object");
  assert.equal(typeof container.assessmentMap, "object");
  assert.equal(typeof container.securityHttpWorkbench, "object");
  assert.equal(typeof container.buildIntruderRequests, "function");
  assert.equal(typeof container.getProxyListener, "function");
  assert.equal(typeof container.projectProfileStore, "function");
  assert.equal(typeof container.sessionMemoryStore, "function");
  assert.equal(container.memoryFeatureFlags.projectMemoryV2, false);
  assert.equal(typeof container.memoryProjectIdentityStore, "object");
  assert.equal(typeof container.memoryManifestStore, "object");
  assert.equal(typeof container.memoryEventStore, "object");
  assert.equal(typeof container.memorySnapshotStore, "object");
  assert.equal(typeof container.memoryArtifactRegistry, "object");
  assert.equal(typeof container.memoryDerivedMemoryIndex, "object");
  assert.equal(typeof container.memoryDerivedProjection, "object");
  assert.equal(typeof container.memoryGraphStore, "object");
  assert.equal(typeof container.memoryGraphView, "object");
  assert.equal(typeof container.memoryExecutionCapture, "object");
  assert.equal(typeof container.memoryFinalizationStore, "object");
  assert.equal(typeof container.memoryOutboxStore, "object");
  assert.equal(typeof container.memoryWatermarkStore, "object");
  assert.equal(typeof container.memoryProjectMemoryRepository, "object");
  assert.equal(typeof container.memoryInvestigationMemoryRepository, "object");
  assert.equal(typeof container.memoryEvidenceMemoryRepository, "object");
  assert.equal(typeof container.memoryProjectMemoryV1Adapter, "object");
  assert.equal(typeof container.memoryBlockFinalizer, "object");
  assert.equal(typeof container.memoryBlockUpdater, "object");
  assert.equal(typeof container.memoryStatus, "object");
  assert.equal(typeof container.memoryKnowledgeReleaseStore, "object");
  assert.equal(typeof container.memoryKnowledgeReleaseIngestor, "object");
  assert.equal(typeof container.memoryRetrievalService, "object");
  assert.equal(typeof container.memoryKnowledgeSelectionService, "object");
  assert.equal(typeof container.memoryInvestigationMemoryService, "object");
  assert.equal(typeof container.memoryEvidenceMemoryService, "object");
  assert.equal(typeof container.memorySensitiveWorkingMemory, "object");
  assert.equal(typeof container.memoryTranscriptBoundary, "object");
  assert.equal(typeof container.memoryOperationalContextStore, "object");
  assert.equal(typeof container.memoryContextSummarizer, "object");
  assert.equal(typeof container.memoryContextCheckpoint, "object");
  assert.equal(typeof container.memoryContextAssembly, "object");
  assert.equal(typeof container.memoryAssignmentLeases, "object");
  assert.equal(typeof container.memorySpecialistDispatch, "object");
  assert.equal(typeof container.memorySpecialistReturn, "object");
  assert.equal(typeof container.memoryAgentHandoff, "object");
  assert.equal(typeof container.memoryIpc, "object");
  assert.equal(typeof container.resolveCentralCaDirectory, "function");
  assert.equal(typeof container.readApplicationPreferences, "function");
  assert.equal(typeof container.terminateProcessTree, "function");
  assert.equal(typeof container.dispose, "function");
});

test("container exposes singleton state maps and a dispose path", () => {
  const container = createContainer({ app: fakeApp(), safeStorage: fakeSafeStorage(), getMainWindow: () => null });

  assert.ok(container.terminals instanceof Map);
  assert.ok(container.toolProcesses instanceof Map);
  assert.ok(container.ollamaControllers instanceof Map);
  assert.ok(container.pendingOperatorQuestions instanceof Map);
  assert.ok(container.webClonePreviewDocuments instanceof Map);
  assert.ok(container.webClonePreviewState);

  // dispose must not throw and must be idempotent.
  container.dispose();
  container.dispose();
});

test("container lazy stores are singletons", () => {
  const container = createContainer({ app: fakeApp(), safeStorage: fakeSafeStorage(), getMainWindow: () => null });
  assert.equal(container.projectProfileStore(), container.projectProfileStore());
  assert.equal(container.sessionMemoryStore(), container.sessionMemoryStore());
  assert.equal(container.getProxyListener(), container.getProxyListener());
});

test("webClonePreviewState keeps the container in sync with shell mutations", () => {
  const container = createContainer({ app: fakeApp(), safeStorage: fakeSafeStorage(), getMainWindow: () => null });
  const state = container.webClonePreviewState;
  state.server = "server-1";
  state.port = 4321;
  state.view = "view-1";
  state.url = "http://127.0.0.1:4321/preview/token/index.html";
  state.processCounter = 7;
  assert.equal(state.server, "server-1");
  assert.equal(state.port, 4321);
  assert.equal(state.view, "view-1");
  assert.equal(state.processCounter, 7);
});
