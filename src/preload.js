const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed Electron preload scripts may only require a small allowlist of
// built-in modules. Keep the result envelope helpers self-contained so a
// failed local import can never prevent the entire renderer bridge loading.
function fail(input, fallbackCode = "POINTER_OPERATION_FAILED") {
  const source = input && typeof input === "object" ? input : {};
  return {
    ok: false,
    error: {
      code: String(source.code || fallbackCode),
      message: String(source.error || source.message || input || "Pointer operation failed"),
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

const legacyApi = {
  // File system
  openFolder: () => ipcRenderer.invoke("fs:openFolder"),
  createProject: (payload = {}) => ipcRenderer.invoke("project:create", payload),
  openFile: () => ipcRenderer.invoke("fs:openFile"),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),
  deletePath: (payload) => ipcRenderer.invoke("fs:deletePath", payload),
  loadChatSessions: (payload) => ipcRenderer.invoke("chat-sessions:load", payload),
  saveChatSessions: (payload) => ipcRenderer.invoke("chat-sessions:save", payload),
  saveChatSessionsBeforeClose: (payload) => ipcRenderer.sendSync("chat-sessions:save-before-close", payload),
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
  assessmentMapOverview: (payload) => ipcRenderer.invoke("assessment:mapOverview", payload),
  assessmentMapNode: (payload) => ipcRenderer.invoke("assessment:mapNode", payload),
  assessmentMapNeighbors: (payload) => ipcRenderer.invoke("assessment:mapNeighbors", payload),
  assessmentMapPaths: (payload) => ipcRenderer.invoke("assessment:mapPaths", payload),
  assessmentMapRoutes: (payload) => ipcRenderer.invoke("assessment:mapRoutes", payload),
  assessmentMapSharedObjects: (payload) => ipcRenderer.invoke("assessment:mapSharedObjects", payload),
  assessmentMapEvidence: (payload) => ipcRenderer.invoke("assessment:mapEvidence", payload),
  assessmentMapHypotheses: (payload) => ipcRenderer.invoke("assessment:mapHypotheses", payload),
  assessmentMapAnnotateFinding: (payload) => ipcRenderer.invoke("assessment:mapAnnotateFinding", payload),
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
  securityHttpRequest: (payload) => ipcRenderer.invoke("security:httpRequest", payload),
  securityBuildIntruder: (payload) => ipcRenderer.invoke("security:buildIntruder", payload),
  proxyConfigure: (payload) => ipcRenderer.invoke("proxy:configure", payload),
  proxyStatus: () => ipcRenderer.invoke("proxy:status"),
  proxyForward: (payload) => ipcRenderer.invoke("proxy:forward", payload),
  proxyDrop: (payload) => ipcRenderer.invoke("proxy:drop", payload),
  proxyShowCa: () => ipcRenderer.invoke("proxy:showCa"),
  certificateSettings: () => ipcRenderer.invoke("settings:certificatesGet"),
  chooseCertificateDirectory: (payload = {}) => ipcRenderer.invoke("settings:certificatesChoose", payload),
  resetCertificateDirectory: (payload = {}) => ipcRenderer.invoke("settings:certificatesReset", payload),
  showCertificateDirectory: () => ipcRenderer.invoke("settings:certificatesShow"),
  onProxyCapture: (cb) => ipcRenderer.on("proxy:capture", (_event, payload) => cb(payload)),
  onProxyStatus: (cb) => ipcRenderer.on("proxy:status", (_event, payload) => cb(payload)),

  // Window chrome
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  // Tools
  dirMap: (workspace) => ipcRenderer.invoke("tools:dirMap", workspace),
  executeTool: (payload) => ipcRenderer.invoke("tools:execute", payload),
  toolHealth: (payload = {}) => ipcRenderer.invoke("tools:health", payload),
  editFile: (payload) => ipcRenderer.invoke("tools:editFile", payload),
  deleteFile: (payload) => ipcRenderer.invoke("tools:deleteFile", payload),
  indexWorkspace: (payload) => ipcRenderer.invoke("tools:indexWorkspace", payload),
  searchWorkspace: (payload) => ipcRenderer.invoke("tools:searchWorkspace", payload),
  findFiles: (payload) => ipcRenderer.invoke("tools:findFiles", payload),
  runCommand: (payload) => ipcRenderer.invoke("tools:runCommand", payload),
  startProcess: (payload) => ipcRenderer.invoke("tools:startProcess", payload),
  readProcess: (payload) => ipcRenderer.invoke("tools:readProcess", payload),
  stopProcess: (payload) => ipcRenderer.invoke("tools:stopProcess", payload),

  // Terminal
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
  runtimeModel: (payload) => ipcRenderer.invoke("ollama:runtime", payload),
  countTokens: (payload) => ipcRenderer.invoke("ollama:countTokens", payload),
  summarizeContext: (payload) => ipcRenderer.invoke("ollama:summarizeContext", payload),
  chat: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  agentRun: (payload) => ipcRenderer.invoke("agent:run", payload),
  abortChat: () => ipcRenderer.invoke("ollama:abort"),
  onToken: (cb) => ipcRenderer.on("ollama:token", (_e, token) => cb(token)),
  onThinking: (cb) => ipcRenderer.on("ollama:thinking", (_e, token) => cb(token)),
  onToolCall: (cb) => ipcRenderer.on("ollama:toolcall", (_e, calls) => cb(calls)),
  onDone: (cb) => ipcRenderer.on("ollama:done", (_e, payload) => cb(payload ?? {})),
  onAgentEvent: (cb) => ipcRenderer.on("agent:event", (_e, payload) => cb(payload ?? {})),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
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

function subscribe(channel, callback, fallback = {}) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload ?? fallback);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const pointerApi = Object.freeze({
  workspace: Object.freeze({
    open: resultCall(legacyApi.openFolder),
    create: resultCall(legacyApi.createProject),
    openFile: resultCall(legacyApi.openFile),
    readDirectory: resultCall(legacyApi.readdir),
    readFile: resultCall(legacyApi.readFile),
    writeFile: resultCall(legacyApi.writeFile),
    createDirectory: resultCall(legacyApi.mkdir),
    deletePath: resultCall(legacyApi.deletePath),
    watch: resultCall(legacyApi.watchWorkspace),
    unwatch: resultCall(legacyApi.unwatchWorkspace),
    directoryMap: resultCall(legacyApi.dirMap),
    index: resultCall(legacyApi.indexWorkspace),
    search: resultCall(legacyApi.searchWorkspace),
    findFiles: resultCall(legacyApi.findFiles),
    editFile: resultCall(legacyApi.editFile),
    deleteFile: resultCall(legacyApi.deleteFile),
    onChanged: (callback) => subscribe("workspace:changed", callback),
  }),
  assessment: Object.freeze({
    create: resultCall(legacyApi.assessmentCreate),
    open: resultCall(legacyApi.assessmentOpen),
    verify: resultCall(legacyApi.assessmentVerify),
    repair: resultCall(legacyApi.assessmentRepair),
    settings: resultCall(legacyApi.assessmentSettings),
    writeSettings: resultCall(legacyApi.assessmentWriteSettings),
    buildContext: resultCall(legacyApi.assessmentBuildContext),
    customEntries: resultCall(legacyApi.assessmentCustomEntries),
    createEntry: resultCall(legacyApi.assessmentCreateEntry),
    deleteEntries: resultCall(legacyApi.assessmentDeleteEntries),
    trafficLog: resultCall(legacyApi.assessmentTrafficLog),
    trafficHistory: resultCall(legacyApi.assessmentTrafficHistory),
    deleteTrafficRecords: resultCall(legacyApi.assessmentDeleteTrafficRecords),
    evidence: resultCall(legacyApi.assessmentEvidence),
    appendEvidence: resultCall(legacyApi.assessmentAppendEvidence),
    appendFinding: resultCall(legacyApi.assessmentAppendFinding),
    createRun: resultCall(legacyApi.assessmentCreateRun),
    updateRun: resultCall(legacyApi.assessmentUpdateRun),
    runHistory: resultCall(legacyApi.assessmentRunHistory),
    generateReport: resultCall(legacyApi.assessmentGenerateReport),
    map: resultCall(legacyApi.assessmentMap),
    buildMap: resultCall(legacyApi.assessmentBuildMap),
    mapOverview: resultCall(legacyApi.assessmentMapOverview),
    mapNode: resultCall(legacyApi.assessmentMapNode),
    mapNeighbors: resultCall(legacyApi.assessmentMapNeighbors),
    mapPaths: resultCall(legacyApi.assessmentMapPaths),
    mapRoutes: resultCall(legacyApi.assessmentMapRoutes),
    mapSharedObjects: resultCall(legacyApi.assessmentMapSharedObjects),
    mapEvidence: resultCall(legacyApi.assessmentMapEvidence),
    mapHypotheses: resultCall(legacyApi.assessmentMapHypotheses),
    annotateMapFinding: resultCall(legacyApi.assessmentMapAnnotateFinding),
  }),
  webclone: Object.freeze({
    build: resultCall(legacyApi.webCloneBuild),
    manifest: resultCall(legacyApi.webCloneManifest),
    readFile: resultCall(legacyApi.webCloneReadFile),
    previewDocument: resultCall(legacyApi.webClonePreviewDocument),
    previewBounds: resultCall(legacyApi.webClonePreviewBounds),
    hidePreview: resultCall(legacyApi.webCloneHidePreview),
  }),
  security: Object.freeze({
    request: resultCall(legacyApi.securityHttpRequest),
    buildIntruder: resultCall(legacyApi.securityBuildIntruder),
    configureProxy: resultCall(legacyApi.proxyConfigure),
    proxyStatus: resultCall(legacyApi.proxyStatus),
    forward: resultCall(legacyApi.proxyForward),
    drop: resultCall(legacyApi.proxyDrop),
    showCa: resultCall(legacyApi.proxyShowCa),
    onCapture: (callback) => subscribe("proxy:capture", callback),
    onStatus: (callback) => subscribe("proxy:status", callback),
  }),
  terminal: Object.freeze({
    create: resultCall(legacyApi.terminalCreate),
    write: resultCall(legacyApi.terminalWrite),
    resize: resultCall(legacyApi.terminalResize),
    kill: resultCall(legacyApi.terminalKill),
    onData: (callback) => subscribe("terminal:data", callback),
    onExit: (callback) => subscribe("terminal:exit", callback),
  }),
  processes: Object.freeze({
    run: resultCall(legacyApi.runCommand),
    start: resultCall(legacyApi.startProcess),
    read: resultCall(legacyApi.readProcess),
    stop: resultCall(legacyApi.stopProcess),
    executeTool: resultCall(legacyApi.executeTool),
    toolHealth: resultCall(legacyApi.toolHealth),
    parseCommand: resultCall(legacyApi.parseSlashCommand),
    runCommand: resultCall(legacyApi.runSlashCommand),
    customScripts: resultCall(legacyApi.listCustomScripts),
  }),
  models: Object.freeze({
    list: resultCall(legacyApi.listModels),
    runtime: resultCall(legacyApi.runtimeModel),
    countTokens: resultCall(legacyApi.countTokens),
    summarizeContext: resultCall(legacyApi.summarizeContext),
    chat: resultCall(legacyApi.chat),
    abort: resultCall(legacyApi.abortChat),
    onToken: (callback) => subscribe("ollama:token", callback, ""),
    onThinking: (callback) => subscribe("ollama:thinking", callback, ""),
    onToolCall: (callback) => subscribe("ollama:toolcall", callback, []),
    onDone: (callback) => subscribe("ollama:done", callback),
  }),
  agent: Object.freeze({
    run: resultCall(legacyApi.agentRun),
    onEvent: (callback) => subscribe("agent:event", callback),
  }),
  settings: Object.freeze({
    certificates: resultCall(legacyApi.certificateSettings),
    chooseCertificateDirectory: resultCall(legacyApi.chooseCertificateDirectory),
    resetCertificateDirectory: resultCall(legacyApi.resetCertificateDirectory),
    showCertificateDirectory: resultCall(legacyApi.showCertificateDirectory),
    loadChatSessions: resultCall(legacyApi.loadChatSessions),
    saveChatSessions: resultCall(legacyApi.saveChatSessions),
  }),
  appWindow: Object.freeze({
    minimize: resultCall(legacyApi.windowMinimize),
    toggleMaximize: resultCall(legacyApi.windowToggleMaximize),
    close: resultCall(legacyApi.windowClose),
    onMenuAction: (callback) => subscribe("app:menu", callback, ""),
  }),
});

// Compatibility facade used while feature controllers migrate to window.pointer.
contextBridge.exposeInMainWorld("api", legacyApi);
contextBridge.exposeInMainWorld("pointer", pointerApi);
