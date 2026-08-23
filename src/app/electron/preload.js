const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed Electron preload scripts may only require a small allowlist of
// built-in modules. Keep the result envelope helpers self-contained so a
// failed local import can never prevent the entire renderer bridge loading.
function fail(input, fallbackCode = "XEKUTE_OPERATION_FAILED") {
  const source = input && typeof input === "object" ? input : {};
  return {
    ok: false,
    error: {
      code: String(source.code || fallbackCode),
      message: String(source.error || source.message || input || "XEKUTE operation failed"),
      retryable: Boolean(source.retryable),
      ...(source.details === undefined ? {} : { details: source.details }),
    },
  };
}

function normalizeResult(value) {
  if (value && typeof value === "object" && value.ok === false && value.error?.message) return value;
  if (value && typeof value === "object" && value.error) return fail(value);
  return { ok: true, value };
}

const api = {
  // File system
  openFolder: () => ipcRenderer.invoke("fs:openFolder"),
  createProject: (payload = {}) => ipcRenderer.invoke("project:create", payload),
  projectProfileGet: (payload) => ipcRenderer.invoke("project-profile:get", payload),
  projectProfileSave: (payload) => ipcRenderer.invoke("project-profile:save", payload),
  openFile: () => ipcRenderer.invoke("fs:openFile"),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),
  deletePath: (payload) => ipcRenderer.invoke("fs:deletePath", payload),
  copyPath: (payload) => ipcRenderer.invoke("fs:copyPath", payload),
  movePath: (payload) => ipcRenderer.invoke("fs:movePath", payload),
  loadSessionMemory: (payload) => ipcRenderer.invoke("session-memory:load", payload),
  beginSessionMemory: (payload) => ipcRenderer.invoke("session-memory:begin", payload),
  recordSessionMemoryEvent: (payload) => ipcRenderer.invoke("session-memory:event", payload),
  updateSessionMemory: (payload) => ipcRenderer.invoke("session-memory:update", payload),
  closeSessionMemory: (payload) => ipcRenderer.invoke("session-memory:close", payload),
  reopenSessionMemory: (payload) => ipcRenderer.invoke("session-memory:reopen", payload),
  archiveSessionMemory: (payload) => ipcRenderer.invoke("session-memory:archive", payload),
  unarchiveSessionMemory: (payload) => ipcRenderer.invoke("session-memory:unarchive", payload),
  flushSessionMemory: () => ipcRenderer.invoke("session-memory:flush"),
  saveSessionMemoryBeforeClose: (payload) => ipcRenderer.sendSync("session-memory:save-before-close", payload),
  deleteSessionMemory: (payload) => ipcRenderer.invoke("session-memory:delete", payload),
  projectMemory: (payload) => ipcRenderer.invoke("context:projectMemory", payload),
  consolidateContext: (payload) => ipcRenderer.invoke("context:consolidate", payload),
  recordContextEvent: (payload) => ipcRenderer.invoke("context:event", payload),
  flushContextCompiler: () => ipcRenderer.invoke("context:flush"),
  watchWorkspace: (workspace) => ipcRenderer.invoke("workspace:watch", workspace),
  unwatchWorkspace: () => ipcRenderer.invoke("workspace:unwatch"),

  // Bug bounty assessments
  assessmentCreate: (payload = {}) => ipcRenderer.invoke("assessment:create", payload),
  assessmentOpen: () => ipcRenderer.invoke("assessment:open"),
  assessmentVerify: (payload) => ipcRenderer.invoke("assessment:verify", payload),
  assessmentRepair: (payload) => ipcRenderer.invoke("assessment:repair", payload),
  assessmentTrafficLog: (payload) => ipcRenderer.invoke("assessment:trafficLog", payload),
  assessmentTrafficHistory: (payload) => ipcRenderer.invoke("assessment:trafficHistory", payload),
  assessmentEvidence: (payload) => ipcRenderer.invoke("assessment:evidence", payload),
  assessmentAppendEvidence: (payload) => ipcRenderer.invoke("assessment:appendEvidence", payload),
  assessmentAppendFinding: (payload) => ipcRenderer.invoke("assessment:appendFinding", payload),
  assessmentCreateRun: (payload) => ipcRenderer.invoke("assessment:createRun", payload),
  assessmentUpdateRun: (payload) => ipcRenderer.invoke("assessment:updateRun", payload),
  assessmentGenerateReport: (payload) => ipcRenderer.invoke("assessment:generateReport", payload),
  assessmentRunHistory: (payload) => ipcRenderer.invoke("assessment:runHistory", payload),
  assessmentDeleteTrafficRecords: (payload) => ipcRenderer.invoke("assessment:deleteTrafficRecords", payload),
  assessmentMap: (payload) => ipcRenderer.invoke("assessment:map", payload),
  assessmentBuildMap: (payload) => ipcRenderer.invoke("assessment:buildMap", payload),
  assessmentDeepCollectGraph: (payload) => ipcRenderer.invoke("assessment:deepCollectGraph", payload),
  assessmentMapOverview: (payload) => ipcRenderer.invoke("assessment:mapOverview", payload),
  assessmentMapNode: (payload) => ipcRenderer.invoke("assessment:mapNode", payload),
  assessmentMapNeighbors: (payload) => ipcRenderer.invoke("assessment:mapNeighbors", payload),
  assessmentMapPaths: (payload) => ipcRenderer.invoke("assessment:mapPaths", payload),
  assessmentMapRoutes: (payload) => ipcRenderer.invoke("assessment:mapRoutes", payload),
  assessmentMapSharedObjects: (payload) => ipcRenderer.invoke("assessment:mapSharedObjects", payload),
  assessmentMapEvidence: (payload) => ipcRenderer.invoke("assessment:mapEvidence", payload),
  assessmentMapHypotheses: (payload) => ipcRenderer.invoke("assessment:mapHypotheses", payload),
  assessmentMapAnnotateFinding: (payload) => ipcRenderer.invoke("assessment:mapAnnotateFinding", payload),
  assessmentIntelligenceStatus: (payload) => ipcRenderer.invoke("assessment:intelligenceStatus", payload),
  assessmentIntelligenceStart: (payload) => ipcRenderer.invoke("assessment:intelligenceStart", payload),
  assessmentIntelligencePause: (payload) => ipcRenderer.invoke("assessment:intelligencePause", payload),
  assessmentIntelligenceResume: (payload) => ipcRenderer.invoke("assessment:intelligenceResume", payload),
  assessmentIntelligenceRebuild: (payload) => ipcRenderer.invoke("assessment:intelligenceRebuild", payload),
  assessmentIntelligenceQuery: (payload) => ipcRenderer.invoke("assessment:intelligenceQuery", payload),
  assessmentIntelligenceExpand: (payload) => ipcRenderer.invoke("assessment:intelligenceExpand", payload),
  webCloneBuild: (payload) => ipcRenderer.invoke("webclone:build", payload),
  webCloneManifest: (payload) => ipcRenderer.invoke("webclone:manifest", payload),
  webCloneReadFile: (payload) => ipcRenderer.invoke("webclone:readFile", payload),
  webClonePreviewDocument: (payload) => ipcRenderer.invoke("webclone:previewDocument", payload),
  webClonePreviewBounds: (payload) => ipcRenderer.invoke("webclone:previewBounds", payload),
  webCloneHidePreview: () => ipcRenderer.invoke("webclone:hidePreview"),
  parseSlashCommand: (payload) => ipcRenderer.invoke("commands:parse", payload),
  runSlashCommand: (payload) => ipcRenderer.invoke("commands:run", payload),
  listCustomScripts: (payload) => ipcRenderer.invoke("commands:customScripts", payload),
  assessmentSettings: (payload) => ipcRenderer.invoke("assessment:settings", payload),
  assessmentWriteSettings: (payload) => ipcRenderer.invoke("assessment:writeSettings", payload),
  assessmentBuildContext: (payload) => ipcRenderer.invoke("assessment:buildContext", payload),
  assessmentCustomEntries: (payload) => ipcRenderer.invoke("assessment:customEntries", payload),
  assessmentCreateEntry: (payload) => ipcRenderer.invoke("assessment:createEntry", payload),
  assessmentDeleteEntries: (payload) => ipcRenderer.invoke("assessment:deleteEntries", payload),
  guidanceEntries: (payload) => ipcRenderer.invoke("guidance:entries", payload),
  guidanceRead: (payload) => ipcRenderer.invoke("guidance:read", payload),
  guidanceContext: (payload) => ipcRenderer.invoke("guidance:context", payload),
  guidanceSave: (payload) => ipcRenderer.invoke("guidance:save", payload),
  guidanceImport: (payload) => ipcRenderer.invoke("guidance:import", payload),
  guidanceDelete: (payload) => ipcRenderer.invoke("guidance:delete", payload),
  mcpRead: (payload) => ipcRenderer.invoke("mcp:read", payload),
  mcpEnsure: (payload) => ipcRenderer.invoke("mcp:ensure", payload),
  kaliAccessGet: () => ipcRenderer.invoke("kali-access:get"),
  kaliAccessSave: (payload) => ipcRenderer.invoke("kali-access:save", payload),
  kaliAccessTest: (payload) => ipcRenderer.invoke("kali-access:test", payload),
  kaliAccessPickIdentity: () => ipcRenderer.invoke("kali-access:pickIdentity"),
  securityHttpRequest: (payload) => ipcRenderer.invoke("security:httpRequest", payload),
  securityBuildIntruder: (payload) => ipcRenderer.invoke("security:buildIntruder", payload),
  proxyConfigure: (payload) => ipcRenderer.invoke("proxy:configure", payload),
  proxyStatus: () => ipcRenderer.invoke("proxy:status"),
  proxyForward: (payload) => ipcRenderer.invoke("proxy:forward", payload),
  proxyDrop: (payload) => ipcRenderer.invoke("proxy:drop", payload),
  proxyShowCa: () => ipcRenderer.invoke("proxy:showCa"),
  proxyBrowserLaunch: (payload = {}) => ipcRenderer.invoke("proxy:browserLaunch", payload),
  proxyBrowserStatus: (payload = {}) => ipcRenderer.invoke("proxy:browserStatus", payload),
  certificateSettings: () => ipcRenderer.invoke("settings:certificatesGet"),
  chooseCertificateDirectory: (payload = {}) => ipcRenderer.invoke("settings:certificatesChoose", payload),
  resetCertificateDirectory: (payload = {}) => ipcRenderer.invoke("settings:certificatesReset", payload),
  showCertificateDirectory: () => ipcRenderer.invoke("settings:certificatesShow"),
  identitiesGet: (payload = {}) => ipcRenderer.invoke("settings:identitiesGet", payload),
  identityStatus: (payload = {}) => ipcRenderer.invoke("settings:identityStatus", payload),
  identityRuntime: () => ipcRenderer.invoke("settings:identityRuntime"),
  identityCreate: (payload = {}) => ipcRenderer.invoke("settings:identityCreate", payload),
  identityUpdate: (payload = {}) => ipcRenderer.invoke("settings:identityUpdate", payload),
  identityDelete: (payload = {}) => ipcRenderer.invoke("settings:identityDelete", payload),
  identityLoginStart: (payload = {}) => ipcRenderer.invoke("settings:identityLoginStart", payload),
  identityLoginSave: (payload = {}) => ipcRenderer.invoke("settings:identityLoginSave", payload),
  identityLoginCancel: (payload = {}) => ipcRenderer.invoke("settings:identityLoginCancel", payload),
  identityImport: (payload = {}) => ipcRenderer.invoke("settings:identityImport", payload),
  credentialsGet: (payload = {}) => ipcRenderer.invoke("settings:credentialsGet", payload),
  credentialCreate: (payload = {}) => ipcRenderer.invoke("settings:credentialCreate", payload),
  credentialSave: (payload = {}) => ipcRenderer.invoke("settings:credentialSave", payload),
  credentialDelete: (payload = {}) => ipcRenderer.invoke("settings:credentialDelete", payload),
  ollamaSettings: () => ipcRenderer.invoke("settings:ollamaGet"),
  setOllamaHost: (payload = {}) => ipcRenderer.invoke("settings:ollamaSet", payload),
  testOllamaConnection: () => ipcRenderer.invoke("settings:ollamaTest"),
  llmSettings: () => ipcRenderer.invoke("settings:llmGet"),
  setLlmSettings: (payload = {}) => ipcRenderer.invoke("settings:llmSet", payload),
  testLlmConnection: () => ipcRenderer.invoke("settings:llmTest"),
  onProxyCapture: (cb) => ipcRenderer.on("proxy:capture", (_event, payload) => cb(payload)),
  onProxyStatus: (cb) => ipcRenderer.on("proxy:status", (_event, payload) => cb(payload)),
  onProxyBrowserStatus: (cb) => ipcRenderer.on("proxy:browserStatus", (_event, payload) => cb(payload)),
  onAssessmentGraphStatus: (cb) => ipcRenderer.on("assessment:graphStatus", (_event, payload) => cb(payload)),

  // Window chrome
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  // Clipboard (native, reliable in Electron renderers)
  copyText: (text) => ipcRenderer.invoke("clipboard:writeText", text),

  // Tools
  dirMap: (workspace) => ipcRenderer.invoke("tools:dirMap", workspace),
  executeTool: (payload) => ipcRenderer.invoke("tools:execute", payload),
  toolCatalog: () => ipcRenderer.invoke("tools:catalog"),
  editFile: (payload) => ipcRenderer.invoke("tools:editFile", payload),
  deleteFile: (payload) => ipcRenderer.invoke("tools:deleteFile", payload),
  indexWorkspace: (payload) => ipcRenderer.invoke("tools:indexWorkspace", payload),
  searchWorkspace: (payload) => ipcRenderer.invoke("tools:searchWorkspace", payload),
  cancelWorkspaceSearch: (payload) => ipcRenderer.invoke("tools:cancelWorkspaceSearch", payload),
  onWorkspaceSearchBatch: (cb) => {
    const listener = (_event, payload) => cb(payload ?? {});
    ipcRenderer.on("tools:workspaceSearchBatch", listener);
    return () => ipcRenderer.removeListener("tools:workspaceSearchBatch", listener);
  },
  findFiles: (payload) => ipcRenderer.invoke("tools:findFiles", payload),
  runCommand: (payload) => ipcRenderer.invoke("tools:runCommand", payload),
  startProcess: (payload) => ipcRenderer.invoke("tools:startProcess", payload),
  readProcess: (payload) => ipcRenderer.invoke("tools:readProcess", payload),
  stopProcess: (payload) => ipcRenderer.invoke("tools:stopProcess", payload),

  // Terminal
  terminalShells: () => ipcRenderer.invoke("terminal:shells"),
  terminalCreate: (opts) => ipcRenderer.invoke("terminal:create", opts),
  terminalWrite: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.invoke("terminal:kill", { id }),
  onTerminalData: (cb) => ipcRenderer.on("terminal:data", (_e, payload) => cb(payload)),
  onTerminalExit: (cb) => ipcRenderer.on("terminal:exit", (_e, payload) => cb(payload)),
  onMenuAction: (cb) => ipcRenderer.on("app:menu", (_e, action) => cb(action)),
  onWorkspaceChanged: (cb) => ipcRenderer.on("workspace:changed", (_e, payload) => cb(payload)),

  // Ollama
  listModels: () => ipcRenderer.invoke("ollama:list"),
  openRouterModelContexts: (payload) => ipcRenderer.invoke("openrouter:modelContexts", payload),
  runtimeModel: (payload) => ipcRenderer.invoke("ollama:runtime", payload),
  countTokens: (payload) => ipcRenderer.invoke("ollama:countTokens", payload),
  summarizeContext: (payload) => ipcRenderer.invoke("ollama:summarizeContext", payload),
  compactContext: (payload) => ipcRenderer.invoke("context:compact", payload),
  chat: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  agentRun: (payload) => ipcRenderer.invoke("agent:run", payload),
  pendingSubagentResults: (payload = {}) => ipcRenderer.invoke("agent:pendingSubagentResults", payload),
  pendingParentContinuations: (payload = {}) => ipcRenderer.invoke("agent:pendingParentContinuations", payload),
  ackParentContinuation: (payload = {}) => ipcRenderer.invoke("agent:ackParentContinuation", payload),
  agentVerifyFinding: (payload) => ipcRenderer.invoke("agent:verifyFinding", payload),
  agentResolveQuestions: (payload) => ipcRenderer.invoke("agent:resolveQuestions", payload),
  abortChat: (payload = {}) => ipcRenderer.invoke("ollama:abort", payload),
  onToken: (cb) => ipcRenderer.on("ollama:token", (_e, token) => cb(token)),
  onThinking: (cb) => ipcRenderer.on("ollama:thinking", (_e, token) => cb(token)),
  onToolCall: (cb) => ipcRenderer.on("ollama:toolcall", (_e, calls) => cb(calls)),
  onDone: (cb) => ipcRenderer.on("ollama:done", (_e, payload) => cb(payload ?? {})),
  onAgentEvent: (cb) => {
    const listener = (_event, payload) => cb(payload ?? {});
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onAssessmentIntelligence: (cb) => {
    const listener = (_event, payload) => cb(payload ?? {});
    ipcRenderer.on("assessment:intelligence", listener);
    return () => ipcRenderer.removeListener("assessment:intelligence", listener);
  },
  onIdentityStatus: (cb) => {
    const listener = (_event, payload) => cb(payload ?? {});
    ipcRenderer.on("identity:status", listener);
    return () => ipcRenderer.removeListener("identity:status", listener);
  },
  onIdentityPersistence: (cb) => {
      const listener = (_event, payload) => cb(payload ?? {});
      ipcRenderer.on("identity:persistence", listener);
      return () => ipcRenderer.removeListener("identity:persistence", listener);
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    // In-app updates
    updatesCheck: (payload = {}) => ipcRenderer.invoke("updates:check", payload),
    updatesInstall: () => ipcRenderer.invoke("updates:install"),
    updatesIgnore: (payload = {}) => ipcRenderer.invoke("updates:ignore", payload),
    updatesSettingsGet: () => ipcRenderer.invoke("updates:settingsGet"),
    updatesSettingsSet: (payload = {}) => ipcRenderer.invoke("updates:settingsSet", payload),
    onUpdateEvent: (cb) => {
      const listener = (_event, payload) => cb(payload ?? {});
      ipcRenderer.on("updates:event", listener);
      return () => ipcRenderer.removeListener("updates:event", listener);
    },
  };

function resultCall(fn) {
  return async (...args) => {
    try {
      return normalizeResult(await fn(...args));
    } catch (error) {
      return fail(error, "IPC_INVOKE_FAILED");
    }
  };
}

contextBridge.exposeInMainWorld("api", api);
