const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // File system
  openFolder: () => ipcRenderer.invoke("fs:openFolder"),
  createProject: (payload = {}) => ipcRenderer.invoke("project:create", payload),
  openFile: () => ipcRenderer.invoke("fs:openFile"),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),
  deletePath: (payload) => ipcRenderer.invoke("fs:deletePath", payload),
  watchWorkspace: (workspace) => ipcRenderer.invoke("workspace:watch", workspace),
  unwatchWorkspace: () => ipcRenderer.invoke("workspace:unwatch"),

  // Bug bounty assessments
  assessmentCreate: (payload = {}) => ipcRenderer.invoke("assessment:create", payload),
  assessmentOpen: () => ipcRenderer.invoke("assessment:open"),
  assessmentVerify: (payload) => ipcRenderer.invoke("assessment:verify", payload),
  assessmentRepair: (payload) => ipcRenderer.invoke("assessment:repair", payload),
  assessmentTrafficLog: (payload) => ipcRenderer.invoke("assessment:trafficLog", payload),
  assessmentTrafficHistory: (payload) => ipcRenderer.invoke("assessment:trafficHistory", payload),
  assessmentSettings: (payload) => ipcRenderer.invoke("assessment:settings", payload),
  assessmentWriteSettings: (payload) => ipcRenderer.invoke("assessment:writeSettings", payload),
  securityHttpRequest: (payload) => ipcRenderer.invoke("security:httpRequest", payload),
  securityBuildIntruder: (payload) => ipcRenderer.invoke("security:buildIntruder", payload),
  proxyConfigure: (payload) => ipcRenderer.invoke("proxy:configure", payload),
  proxyStatus: () => ipcRenderer.invoke("proxy:status"),
  proxyForward: (payload) => ipcRenderer.invoke("proxy:forward", payload),
  proxyDrop: (payload) => ipcRenderer.invoke("proxy:drop", payload),
  proxyShowCa: () => ipcRenderer.invoke("proxy:showCa"),
  onProxyCapture: (cb) => ipcRenderer.on("proxy:capture", (_event, payload) => cb(payload)),
  onProxyStatus: (cb) => ipcRenderer.on("proxy:status", (_event, payload) => cb(payload)),

  // Window chrome
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  // Tools
  dirMap: (workspace) => ipcRenderer.invoke("tools:dirMap", workspace),
  executeTool: (payload) => ipcRenderer.invoke("tools:execute", payload),
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
});
