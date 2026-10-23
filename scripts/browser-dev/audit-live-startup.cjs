"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Read counters and buffered paint timings through the running development inspector.
// This never reloads the window, writes session state, or starts an agent.
async function inspectMain({ profileStore = false } = {}) {
  const mainRequire = process.mainModule.require.bind(process.mainModule);
  const { app, webContents } = mainRequire("electron");
  const fs = mainRequire("node:fs"), path = mainRequire("node:path");
  const baseDir = path.join(app.getPath("userData"), "memory-v3", "sensitive");
  const projects = [];
  for (const projectId of fs.readdirSync(path.join(baseDir, "projects"))) {
    const directory = path.join(baseDir, "projects", projectId, "sessions");
    if (!fs.existsSync(directory)) continue;
    const sessions = [];
    for (const sessionId of fs.readdirSync(directory)) {
      const file = path.join(directory, sessionId, "transcript.enc.json");
      if (fs.existsSync(file)) sessions.push({ sessionId, bytes: fs.statSync(file).size });
    }
    sessions.sort((a, b) => b.bytes - a.bytes);
    projects.push({ projectId, sessions, bytes: sessions.reduce((sum, item) => sum + item.bytes, 0) });
  }
  const contents = webContents.getAllWebContents().find(item => /\/src\/ui\/dist\/index\.html/.test(item.getURL()));
  const renderer = contents ? await contents.executeJavaScript(`(${function () {
    return new Promise(resolve => {
      const lcp = [], longTasks = [];
      const paints = new PerformanceObserver(list => { for (const entry of list.getEntries()) lcp.push({ ms: entry.startTime, element: entry.element?.className }); });
      const tasks = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration }); });
      paints.observe({ type: "largest-contentful-paint", buffered: true });
      tasks.observe({ type: "longtask", buffered: true });
      setTimeout(() => {
        paints.disconnect(); tasks.disconnect();
        const navigation = performance.getEntriesByType("navigation")[0];
        resolve({ workspace: localStorage.getItem("pointer:workspace"), lcp, longTasks,
          navigation: navigation && { domReady: navigation.domContentLoadedEventEnd, load: navigation.loadEventEnd },
          paints: performance.getEntriesByType("paint").map(item => ({ name: item.name, ms: item.startTime })),
          dom: { exchanges: document.querySelectorAll("#messages .chat-exchange").length,
            tools: document.querySelectorAll("#messages .tool-card, #messages .agent-command-event").length,
            elements: document.querySelectorAll("#messages *").length },
        });
      }, 30);
    });
  }.toString()})()`) : null;
  projects.sort((a, b) => b.bytes - a.bytes);
  const storage = profileStore ? mainRequire(path.join(process.cwd(), "scripts/browser-dev/profile-stored-history.cjs"))
    .profileStoredHistory({ safeStorage: mainRequire("electron").safeStorage, baseDir, projectId: projects[0].projectId, passCount: 1 }) : null;
  return { premise: "The remaining LCP delay is mostly renderer work", baseDir, renderer, projects, storage };
}

async function auditLiveStartup() {
  const targets = await (await fetch("http://127.0.0.1:5858/json/list")).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  try {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Startup audit timed out")), 15000);
      socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id === 1) { clearTimeout(timer); resolve(message); }
      });
    });
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(${inspectMain.toString()})(${JSON.stringify({ profileStore: process.argv.includes("--profile-store") })})`, returnByValue: true, awaitPromise: true } }));
    const result = await response;
    if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result.error || result.result.exceptionDetails));
    const report = result.result.result.value;
    const output = path.resolve(process.argv[2] || "tmp/live-startup-audit.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { socket.close(); }
}

if (require.main === module) auditLiveStartup().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { auditLiveStartup };
