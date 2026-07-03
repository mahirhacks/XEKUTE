const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  monacoVsPath: "../node_modules/monaco-editor/min/vs",

  // File system
  openFolder: () => ipcRenderer.invoke("fs:openFolder"),
  readdir: (dirPath) => ipcRenderer.invoke("fs:readdir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs:writeFile", filePath, content),
  mkdir: (dirPath) => ipcRenderer.invoke("fs:mkdir", dirPath),

  // Terminal
  terminalCreate: (opts) => ipcRenderer.invoke("terminal:create", opts),
  terminalWrite: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.invoke("terminal:kill", { id }),
  onTerminalData: (cb) => ipcRenderer.on("terminal:data", (_e, payload) => cb(payload)),
  onTerminalExit: (cb) => ipcRenderer.on("terminal:exit", (_e, payload) => cb(payload)),

  // Ollama
  listModels: () => ipcRenderer.invoke("ollama:list"),
  chat: (payload) => ipcRenderer.invoke("ollama:chat", payload),
  onToken: (cb) => ipcRenderer.on("ollama:token", (_e, token) => cb(token)),
  onThinking: (cb) => ipcRenderer.on("ollama:thinking", (_e, token) => cb(token)),
  onDone: (cb) => ipcRenderer.on("ollama:done", () => cb()),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
