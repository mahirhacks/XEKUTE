const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const pty = require("node-pty");
const { spawn } = require("child_process");
const { createToolHandlers } = require("./tools/tool-handlers");

const APP_ROOT = path.join(__dirname, "..");

let mainWindow;
/** @type {Map<string, import('node-pty').IPty>} */
const terminals = new Map();
const toolProcesses = new Map();
const ollamaControllers = new Map();
let toolProcessCounter = 0;
let workspaceIndexCache = null;

function getDefaultShell() {
  if (process.env.POINTER_SHELL) return process.env.POINTER_SHELL;

  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      process.env.COMSPEC,
      "powershell.exe",
      "cmd.exe",
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function getShellName(shellPath) {
  const name = path.basename(shellPath || "").replace(/\.(exe|cmd|bat)$/i, "");
  if (!name) return "terminal";
  if (/powershell/i.test(name)) return "powershell";
  return name;
}

function getShellArgs(shellPath) {
  const name = path.basename(shellPath || "").toLowerCase();
  if (name === "powershell.exe" || name === "pwsh.exe") {
    return ["-NoLogo"];
  }
  return [];
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:menu", action);
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New File", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-file") },
        { label: "New Folder", click: () => sendMenuAction("new-folder") },
        { type: "separator" },
        { label: "Open File...", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("open-file") },
        { label: "Open Folder...", accelerator: "CmdOrCtrl+Shift+O", click: () => sendMenuAction("open-folder") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Terminal",
      submenu: [
        { label: "New Terminal", accelerator: "Ctrl+Shift+`", click: () => sendMenuAction("new-terminal") },
        { label: "Clear Terminal", accelerator: "CmdOrCtrl+K", click: () => sendMenuAction("clear-terminal") },
        { label: "Kill Terminal", click: () => sendMenuAction("kill-terminal") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#181818",
    title: "Pointer",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createApplicationMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  for (const term of terminals.values()) {
    try { term.kill(); } catch { /* ignore */ }
  }
  terminals.clear();
  for (const record of toolProcesses.values()) {
    try { record.child.kill(); } catch { /* ignore */ }
  }
  toolProcesses.clear();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── File System IPC ────────────────────────────────────────────────────────────

/** Open a folder picker, return the chosen path */
ipcMain.handle("fs:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

/** Open a file picker, return the chosen path */
ipcMain.handle("fs:openFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

/** List directory entries (one level) */
ipcMain.handle("fs:readdir", async (_event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name),
    })).sort((a, b) => {
      // dirs first, then alphabetical
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    return { error: err.message };
  }
});

/** Read a file as text */
ipcMain.handle("fs:readFile", async (_event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 500_000) {
      return { error: "File too large to edit (> 500 KB)" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

/** Write text to a file */
ipcMain.handle("fs:writeFile", async (_event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

/** Create a new folder */
ipcMain.handle("fs:mkdir", async (_event, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Tools IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:toggleMaximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

function applyPatchesToContent(content, patches) {
  for (let i = 0; i < patches.length; i += 1) {
    const search = patches[i].search ?? "";
    const replace = patches[i].replace ?? "";
    if (!search) return { error: `Patch ${i + 1}: empty search block` };

    const count = content.split(search).length - 1;
    if (count === 0) return { error: `Patch ${i + 1}: search text not found in file` };
    if (count > 1) {
      return { error: `Patch ${i + 1}: search text matched ${count} times (must be unique)` };
    }

    content = content.replace(search, replace);
  }

  return { content, patches_applied: patches.length };
}

function editFileInWorkspace(workspace, file, code) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, "utf8");
  return { ok: true, file, path: target, mode: "full", content: code };
}

function patchFileInWorkspace(workspace, file, patches) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }
  if (!fs.existsSync(target)) {
    return { error: `File not found: ${file}` };
  }

  const existing = fs.readFileSync(target, "utf8");
  const result = applyPatchesToContent(existing, patches);
  if (result.error) return result;

  fs.writeFileSync(target, result.content, "utf8");
  return {
    ok: true,
    file,
    path: target,
    mode: "patch",
    content: result.content,
    patches_applied: result.patches_applied,
  };
}

function resolveWorkspaceTarget(workspace, relPath = "") {
  if (!workspace) return { error: "No workspace open" };
  const root = path.resolve(workspace);
  const target = path.resolve(root, relPath || ".");
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }
  return { root, target, relative: relative || "" };
}

const INDEX_SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".next", "dist", "build", "out", "coverage", ".venv", "venv",
]);

const INDEX_TEXT_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".md", ".txt",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".yml", ".yaml",
  ".toml", ".xml", ".sh", ".ps1", ".bat", ".sql", ".env", ".gitignore",
]);

function isIndexableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext && path.basename(filePath).startsWith(".")) return true;
  return INDEX_TEXT_EXTS.has(ext);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z_][a-z0-9_]{1,}|[0-9]+/g) || [];
}

function takeLimited(text, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

function collectWorkspaceFiles(root, { maxFiles = 700 } = {}) {
  const files = [];

  function walk(dir) {
    if (files.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") {
        if (entry.isDirectory()) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!INDEX_SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || !isIndexableFile(full)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 350_000) continue;
        files.push({ full, rel: path.relative(root, full).replace(/\\/g, "/"), size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  walk(root);
  return files;
}

function extractGraphFacts(rel, content) {
  const imports = [];
  const symbols = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines.slice(0, 500)) {
    const importMatch = line.match(/^\s*(?:import\s+.*?\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|from\s+([\w.]+)\s+import\s+|require\(["']([^"']+)["']\))/);
    const target = importMatch?.[1] || importMatch?.[2] || importMatch?.[3] || importMatch?.[4];
    if (target) imports.push(target);

    const symbolMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)/);
    const symbol = symbolMatch?.[1] || symbolMatch?.[2];
    if (symbol) symbols.push(symbol);
  }

  return { file: rel, imports: [...new Set(imports)].slice(0, 20), symbols: [...new Set(symbols)].slice(0, 30) };
}

function buildWorkspaceIndex(workspace) {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return resolved;

  const root = resolved.root;
  const files = collectWorkspaceFiles(root);
  const docs = [];
  const graph = [];
  const df = new Map();

  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(file.full, "utf8");
    } catch {
      continue;
    }

    const tokens = tokenize(`${file.rel}\n${content}`);
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    for (const token of counts.keys()) df.set(token, (df.get(token) || 0) + 1);

    docs.push({
      path: file.rel,
      size: file.size,
      mtimeMs: file.mtimeMs,
      content,
      counts,
      tokenCount: tokens.length || 1,
    });
    graph.push(extractGraphFacts(file.rel, content));
  }

  const index = {
    workspace: root,
    builtAt: Date.now(),
    docs,
    df,
    graph,
  };
  workspaceIndexCache = index;
  return index;
}

function getWorkspaceIndex(workspace) {
  const root = path.resolve(workspace || ".");
  if (workspaceIndexCache?.workspace === root) return workspaceIndexCache;
  return buildWorkspaceIndex(root);
}

function searchWorkspaceIndex(workspace, query, { limit = 8 } = {}) {
  if (!query?.trim()) return { error: "Empty search query" };
  const index = getWorkspaceIndex(workspace);
  if (index.error) return index;

  const qTokens = tokenize(query);
  const qSet = new Set(qTokens);
  const totalDocs = Math.max(index.docs.length, 1);

  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const token of qSet) {
      const tf = doc.counts.get(token) || 0;
      if (!tf) continue;
      const idf = Math.log(1 + totalDocs / (1 + (index.df.get(token) || 0)));
      score += (tf / doc.tokenCount) * idf * 1000;
      if (doc.path.toLowerCase().includes(token)) score += 2;
    }

    const lower = doc.content.toLowerCase();
    const phrase = query.toLowerCase();
    if (lower.includes(phrase)) score += 8;

    return { doc, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 20)));

  const results = scored.map(({ doc, score }) => {
    const lower = doc.content.toLowerCase();
    let pos = lower.indexOf(query.toLowerCase());
    if (pos < 0) {
      const token = qTokens.find((t) => lower.includes(t));
      pos = token ? lower.indexOf(token) : 0;
    }
    const start = Math.max(0, pos - 300);
    const end = Math.min(doc.content.length, pos + 700);
    return {
      path: doc.path,
      score: Number(score.toFixed(3)),
      snippet: takeLimited(doc.content.slice(start, end), 1000),
    };
  });

  return {
    ok: true,
    mode: "search",
    query,
    count: results.length,
    results,
  };
}

function runWorkspaceCommand(workspace, command, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) {
      resolve(resolved);
      return;
    }
    if (!command?.trim()) {
      resolve({ error: "Empty command" });
      return;
    }

    const child = spawn(command, {
      cwd: resolved.root,
      shell: true,
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, Math.max(1000, Math.min(timeoutMs, 120000)));

    child.stdout?.on("data", (chunk) => {
      stdout = takeLimited(stdout + chunk.toString(), 20000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = takeLimited(stderr + chunk.toString(), 12000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ error: err.message, command });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        mode: "command",
        command,
        exitCode,
        signal,
        timedOut,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      });
    });
  });
}

function startWorkspaceProcess(workspace, command) {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return resolved;
  if (!command?.trim()) return { error: "Empty command" };

  const id = `proc-${++toolProcessCounter}`;
  const child = spawn(command, {
    cwd: resolved.root,
    shell: true,
    windowsHide: true,
    env: { ...process.env },
  });

  const record = {
    id,
    command,
    startedAt: Date.now(),
    running: true,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    child,
  };

  child.stdout?.on("data", (chunk) => {
    record.stdout = takeLimited(record.stdout + chunk.toString(), 24000);
  });
  child.stderr?.on("data", (chunk) => {
    record.stderr = takeLimited(record.stderr + chunk.toString(), 16000);
  });
  child.on("error", (err) => {
    record.running = false;
    record.stderr = takeLimited(`${record.stderr}\n${err.message}`, 16000);
  });
  child.on("close", (exitCode, signal) => {
    record.running = false;
    record.exitCode = exitCode;
    record.signal = signal;
  });

  toolProcesses.set(id, record);
  return { ok: true, mode: "process_start", id, command };
}

function processSnapshot(record) {
  return {
    id: record.id,
    command: record.command,
    running: record.running,
    exitCode: record.exitCode,
    signal: record.signal,
    seconds: Number(((Date.now() - record.startedAt) / 1000).toFixed(1)),
    stdout: record.stdout.trimEnd(),
    stderr: record.stderr.trimEnd(),
  };
}

function listProjectFiles(workspace) {
  const resolved = resolveWorkspaceTarget(workspace);
  if (resolved.error) return resolved;
  const files = [];

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if ([".git", "node_modules", "__pycache__"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(path.relative(resolved.root, full).replace(/\\/g, "/"));
      }
    }
  }

  walk(resolved.root);
  return { ok: true, files };
}

async function editWorkspaceFile(workspace, file, { code, patches } = {}) {
  if (!workspace) return { error: "No workspace open" };
  workspaceIndexCache = null;

  const root = path.resolve(workspace);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Path escapes workspace" };
  }

  if (patches?.length) {
    return patchFileInWorkspace(workspace, file, patches);
  }

  if (code === undefined) return { error: "No content or patches provided" };

  try {
    return editFileInWorkspace(workspace, file, code);
  } catch (err) {
    return { error: err.message };
  }
}

function deleteWorkspaceFile(workspace, file) {
  const resolved = resolveWorkspaceTarget(workspace, file);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };
    const stat = fs.statSync(resolved.target);
    if (!stat.isFile()) return { error: `Not a file: ${file}` };
    fs.unlinkSync(resolved.target);
    workspaceIndexCache = null;
    return { ok: true, mode: "delete", file };
  } catch (err) {
    return { error: err.message };
  }
}

function readToolProcess(id) {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  return { ok: true, ...processSnapshot(record) };
}

function stopToolProcess(id) {
  const record = toolProcesses.get(id);
  if (!record) return { error: `Unknown process: ${id}` };
  if (record.running) {
    try { record.child.kill(); } catch { /* ignore */ }
    record.running = false;
  }
  return { ok: true, ...processSnapshot(record) };
}

const toolExecutor = createToolHandlers({
  fs,
  path,
  resolveWorkspaceTarget,
  editWorkspaceFile,
  deleteWorkspaceFile,
  buildWorkspaceIndex,
  searchWorkspaceIndex,
  runWorkspaceCommand,
  startWorkspaceProcess,
  readToolProcess,
  stopToolProcess,
  listProjectFiles,
});

function buildDirMap(workspace) {
  const lines = [path.resolve(workspace)];
  const walk = (dir, prefix = "", depth = 0) => {
    if (depth > 5) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => ![".git", "node_modules", "__pycache__"].includes(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(full, `${prefix}  `, depth + 1);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(workspace);
  return lines.join("\n");
}

ipcMain.handle("tools:dirMap", async (_event, workspace) => {
  if (!workspace || !fs.existsSync(workspace)) {
    return { error: "No workspace" };
  }

  try {
    return { map: buildDirMap(workspace) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("tools:editFile", async (_event, { workspace, file, code, patches }) => {
  return editWorkspaceFile(workspace, file, { code, patches });
});

ipcMain.handle("tools:deleteFile", async (_event, { workspace, file }) => {
  return deleteWorkspaceFile(workspace, file);
});

ipcMain.handle("tools:indexWorkspace", async (_event, { workspace }) => {
  const index = buildWorkspaceIndex(workspace);
  if (index.error) return index;
  return {
    ok: true,
    mode: "index",
    files: index.docs.length,
    builtAt: index.builtAt,
    graph: index.graph.slice(0, 80),
  };
});

ipcMain.handle("tools:searchWorkspace", async (_event, { workspace, query, limit }) => {
  return searchWorkspaceIndex(workspace, query, { limit });
});

ipcMain.handle("tools:runCommand", async (_event, { workspace, command, timeoutMs }) => {
  return runWorkspaceCommand(workspace, command, { timeoutMs });
});

ipcMain.handle("tools:startProcess", async (_event, { workspace, command }) => {
  return startWorkspaceProcess(workspace, command);
});

ipcMain.handle("tools:readProcess", async (_event, { id }) => {
  return { mode: "process_read", ...readToolProcess(id) };
});

ipcMain.handle("tools:stopProcess", async (_event, { id }) => {
  return { mode: "process_stop", ...stopToolProcess(id) };
});

ipcMain.handle("tools:execute", async (_event, { workspace, toolCall }) => {
  return toolExecutor.executeToolCall({ workspace, toolCall });
});

// ── Terminal IPC ─────────────────────────────────────────────────────────────

ipcMain.handle("terminal:create", (event, { id, cwd }) => {
  if (terminals.has(id)) return { error: "Terminal already exists" };

  try {
    const shell = getDefaultShell();
    const term = pty.spawn(shell, getShellArgs(shell), {
      name: "xterm-color",
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" },
      cols: 80,
      rows: 24,
      useConpty: process.platform === "win32",
    });

    terminals.set(id, term);

    term.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("terminal:data", { id, data });
      }
    });

    term.onExit(({ exitCode, signal }) => {
      terminals.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send("terminal:exit", { id, exitCode, signal });
      }
    });

    return { ok: true, shell: getShellName(shell) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("terminal:write", (_event, { id, data }) => {
  terminals.get(id)?.write(data);
});

ipcMain.handle("terminal:resize", (_event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term) {
    try { term.resize(cols, rows); } catch { /* ignore */ }
  }
});

ipcMain.handle("terminal:kill", (_event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    try { term.kill(); } catch { /* ignore */ }
    terminals.delete(id);
  }
  return { ok: true };
});

// ── Ollama Chat IPC ────────────────────────────────────────────────────────────

function parseToolArguments(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Ollama expects tool_calls[].function.arguments as objects, not JSON strings. */
function sanitizeOllamaMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.map((msg) => {
    if (msg.role === "tool") {
      const out = { role: "tool", content: String(msg.content ?? "") };
      if (msg.tool_name) out.tool_name = msg.tool_name;
      if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
      return out;
    }

    if (!msg.tool_calls?.length) return msg;

    const tool_calls = msg.tool_calls
      .map((call) => {
        const fn = call?.function;
        if (!fn?.name) return null;

        const args = parseToolArguments(fn.arguments);
        if (!args) return null;

        return {
          id: call.id,
          type: call.type || "function",
          function: {
            ...(Number.isInteger(fn.index) ? { index: fn.index } : {}),
            name: fn.name,
            arguments: args,
          },
        };
      })
      .filter(Boolean);

    if (!tool_calls.length) {
      const { tool_calls: _removed, ...rest } = msg;
      return rest;
    }

    return { ...msg, tool_calls };
  });
}

function getOllamaBaseUrl() {
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  return host.replace(/\/$/, "");
}

function ollamaHostLabel(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.port || (url.protocol === "https:" ? "443" : "11434");
  } catch {
    return "11434";
  }
}

function parseOllamaTags(data) {
  const models = (data?.models ?? [])
    .map((m) => m.name || m.model)
    .filter(Boolean);
  return [...new Set(models)].sort();
}

function parseOllamaListStdout(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && /^[a-f0-9]{12,}$/i.test(parts[1])) {
        return parts[0];
      }
      return parts[0];
    })
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .sort();
}

async function fetchOllamaTags(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function estimateTokenCount(text) {
  if (!text) return 0;
  const value = String(text);
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const pieces = value.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || [];
  const symbolWeight = (value.match(/[{}()[\].,;:+\-*/=<>"'`|&!?]/g) || []).length * 0.15;
  const structuralOverhead = (value.match(/\n/g) || []).length * 0.35;
  return Math.max(1, Math.ceil(cjk + (pieces.length - cjk) * 1.05 + symbolWeight + structuralOverhead));
}

function serializeTokenPayload(messages = [], tools = []) {
  const safeMessages = sanitizeOllamaMessages(messages);
  return JSON.stringify({
    messages: safeMessages,
    tools: tools || [],
  });
}

/** List locally available Ollama models */
ipcMain.handle("ollama:list", async () => {
  const baseUrl = getOllamaBaseUrl();
  const host = ollamaHostLabel(baseUrl);
  let apiError = null;

  try {
    const { res, data } = await fetchOllamaTags(baseUrl);
    if (res.ok) {
      const models = parseOllamaTags(data);
      if (models.length) return { models, host };
      apiError = "No models found in Ollama.";
    } else {
      apiError = data?.error || `Ollama API error (${res.status})`;
    }
  } catch (err) {
    apiError = err?.name === "AbortError"
      ? "Ollama API timed out."
      : (err?.message || "Cannot reach Ollama API.");
  }

  try {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync("ollama list", {
      windowsHide: true,
      timeout: 8000,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    const models = parseOllamaListStdout(stdout);
    if (models.length) return { models, host };
    return { error: apiError || "No models found. Run ollama pull <model>." };
  } catch (err) {
    return { error: apiError || err?.message || "Cannot reach Ollama. Is it running?" };
  }
});

ipcMain.handle("ollama:countTokens", async (_event, { model, messages = [], tools = [] } = {}) => {
  const prompt = serializeTokenPayload(messages, tools);
  const fallback = estimateTokenCount(prompt) + (Array.isArray(messages) ? messages.length * 4 : 0);

  if (!model) return { ok: true, count: fallback, source: "estimate" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${getOllamaBaseUrl()}/api/tokenize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const count = Array.isArray(data?.tokens)
        ? data.tokens.length
        : Number(data?.count ?? data?.token_count);
      if (Number.isFinite(count) && count > 0) {
        return { ok: true, count, source: "ollama" };
      }
    }
  } catch {
    /* older Ollama builds may not expose tokenization */
  }

  return { ok: true, count: fallback, source: "estimate" };
});

ipcMain.handle("ollama:abort", async (event) => {
  const controller = ollamaControllers.get(event.sender.id);
  if (controller) controller.abort();
  return { ok: true };
});

/** Stream chat tokens from Ollama back to the renderer. */
ipcMain.handle("ollama:chat", async (event, { messages, model, numCtx, thinking, tools }) => {
  const url = `${getOllamaBaseUrl()}/api/chat`;
  const mdl = model ?? "qwen2.5-coder:7b";
  const senderId = event.sender.id;
  const previous = ollamaControllers.get(senderId);
  if (previous) previous.abort();

  const controller = new AbortController();
  ollamaControllers.set(senderId, controller);

  const options = {};
  if (numCtx) options.num_ctx = numCtx;

  const body = {
    model: mdl,
    messages: sanitizeOllamaMessages(messages),
    stream: true,
    ...(Object.keys(options).length ? { options } : {}),
    ...(thinking ? { think: true } : {}),
    ...(tools?.length ? { tools } : {}),
  };

  let res;
  let buffer = "";
  let fullText = "";
  let fullThinking = "";
  let toolCalls = [];
  let doneSent = false;

  const sendDone = (payload) => {
    if (doneSent || event.sender.isDestroyed()) return;
    doneSent = true;
    event.sender.send("ollama:done", payload);
  };

  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      const payload = { fullText, toolCalls, thinking: fullThinking, aborted: true };
      sendDone(payload);
      if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Cannot reach Ollama at ${url}. Is it running?\n${err.message}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (ollamaControllers.get(senderId) === controller) ollamaControllers.delete(senderId);
    return { error: `Ollama error: ${res.status} ${res.statusText}${detail ? `\n${detail}` : ""}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  function mergeToolCalls(existing, incoming) {
    if (!incoming?.length) return existing;
    const merged = existing.slice();

    for (const call of incoming) {
      const fn = call.function || {};
      const args = fn.arguments ?? {};
      const index = Number.isInteger(call.index)
        ? call.index
        : Number.isInteger(fn.index) ? fn.index : null;
      let targetIndex = index;

      if (targetIndex == null) {
        targetIndex = merged.findIndex((item) => {
          if (call.id && item.id === call.id) return true;
          return item.function?.name && fn.name && item.function.name === fn.name
            && JSON.stringify(item.function.arguments ?? {}) === JSON.stringify(args ?? {});
        });
        if (targetIndex < 0) targetIndex = merged.length;
      }

      const normalizedArgs = typeof args === "string" ? args : { ...(args || {}) };

      while (merged.length <= targetIndex) {
        merged.push({
          type: "function",
          function: { name: "", arguments: {} },
        });
      }

      const target = merged[targetIndex];
      if (call.id) target.id = call.id;
      if (call.type) target.type = call.type;
      if (fn.name) {
        target.function.name = fn.name;
      }
      if (index != null) {
        target.function.index = index;
      }

      if (typeof normalizedArgs === "string") {
        const prev = typeof target.function.arguments === "string" ? target.function.arguments : "";
        target.function.arguments = `${prev}${normalizedArgs}`;
      } else {
        const prev = typeof target.function.arguments === "object" && target.function.arguments
          ? target.function.arguments
          : {};
        target.function.arguments = { ...prev, ...normalizedArgs };
      }
    }

    return merged.filter((call) => call.function?.name);
  }

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        const msg = parsed.message ?? {};

        const thinkingToken = msg.thinking ?? "";
        if (thinkingToken) {
          fullThinking += thinkingToken;
          event.sender.send("ollama:thinking", thinkingToken);
        }

        const token = msg.content ?? "";
        if (token) {
          fullText += token;
          event.sender.send("ollama:token", token);
        }

        if (msg.tool_calls?.length) {
          toolCalls = mergeToolCalls(toolCalls, msg.tool_calls);
          event.sender.send("ollama:toolcall", toolCalls);
        }

        if (parsed.done) {
          const payload = { fullText, toolCalls, thinking: fullThinking };
          sendDone(payload);
          return { ok: true, fullText, toolCalls, thinking: fullThinking };
        }
      } catch {
        // partial line – wait for next chunk
      }
    }
  }

  const payload = { fullText, toolCalls, thinking: fullThinking };
  sendDone(payload);
  return { ok: true, fullText, toolCalls, thinking: fullThinking };
  } catch (err) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      const payload = { fullText, toolCalls, thinking: fullThinking, aborted: true };
      sendDone(payload);
      return { ok: false, aborted: true, fullText, toolCalls, thinking: fullThinking };
    }
    return { error: err?.message || "Ollama stream failed." };
  } finally {
    if (ollamaControllers.get(senderId) === controller) {
      ollamaControllers.delete(senderId);
    }
  }
});
