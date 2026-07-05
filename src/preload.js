const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  monacoVsPath: "../node_modules/monaco-editor/min/vs",

  // File system
  openFolder: () => ipcRenderer.invoke("fs:openFolder"),
  openFile: () => ipcRenderer.invoke("fs:openFile"),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),

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

  // Ollama
  listModels: () => ipcRenderer.invoke("ollama:list"),
  chat: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  abortChat: () => ipcRenderer.invoke("ollama:abort"),
  onToken: (cb) => ipcRenderer.on("ollama:token", (_e, token) => cb(token)),
  onThinking: (cb) => ipcRenderer.on("ollama:thinking", (_e, token) => cb(token)),
  onToolCall: (cb) => ipcRenderer.on("ollama:toolcall", (_e, calls) => cb(calls)),
  onDone: (cb) => ipcRenderer.on("ollama:done", (_e, payload) => cb(payload ?? {})),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
