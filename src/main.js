const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const pty = require("node-pty");

let mainWindow;
/** @type {Map<string, import('node-pty').IPty>} */
const terminals = new Map();

function getDefaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#181818",
    title: "Pointer",
    autoHideMenuBar: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  for (const term of terminals.values()) {
    try { term.kill(); } catch { /* ignore */ }
  }
  terminals.clear();
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

// ── Terminal IPC ─────────────────────────────────────────────────────────────

ipcMain.handle("terminal:create", (event, { id, cwd }) => {
  if (terminals.has(id)) return { error: "Terminal already exists" };

  try {
    const shell = getDefaultShell();
    const term = pty.spawn(shell, [], {
      name: "xterm-color",
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.env.USERPROFILE || process.cwd(),
      env: process.env,
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

    term.onExit(() => {
      terminals.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send("terminal:exit", { id });
      }
    });

    return { ok: true };
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

/** List locally available Ollama models */
ipcMain.handle("ollama:list", async () => {
  const baseUrl = "http://localhost:11434";

  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models ?? []).map((m) => m.name).filter(Boolean).sort();
      if (models.length) return { models };
    }
  } catch {
    // fall through to CLI
  }

  try {
    const { execFile } = require("child_process");
    const { promisify } = require("util");
    const exec = promisify(execFile);
    const { stdout } = await exec("ollama", ["list"]);
    const models = stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean)
      .sort();
    return models.length ? { models } : { error: "No models found. Run ollama pull <model>." };
  } catch (err) {
    return { error: "Cannot reach Ollama. Is it running?" };
  }
});

/** Stream chat tokens from Ollama back to the renderer. */
ipcMain.handle("ollama:chat", async (event, { messages, model, numCtx, thinking }) => {
  const url = "http://localhost:11434/api/chat";
  const mdl = model ?? "qwen2.5-coder:7b";

  const options = {};
  if (numCtx) options.num_ctx = numCtx;
  if (thinking) options.thinking = true;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: mdl,
        messages,
        stream: true,
        ...(Object.keys(options).length ? { options } : {}),
      }),
    });
  } catch (err) {
    return { error: `Cannot reach Ollama at ${url}. Is it running?\n${err.message}` };
  }

  if (!res.ok) {
    return { error: `Ollama error: ${res.status} ${res.statusText}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

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
        const thinkingToken = parsed.message?.thinking ?? "";
        if (thinkingToken) {
          event.sender.send("ollama:thinking", thinkingToken);
        }

        const token = parsed.message?.content ?? "";
        if (token) {
          fullText += token;
          event.sender.send("ollama:token", token);
        }
        if (parsed.done) {
          event.sender.send("ollama:done");
          return { ok: true, fullText };
        }
      } catch {
        // partial line – wait for next chunk
      }
    }
  }

  event.sender.send("ollama:done");
  return { ok: true, fullText };
});
