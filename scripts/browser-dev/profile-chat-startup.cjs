"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Build the UI first. Example: node scripts/browser-dev/profile-chat-startup.cjs tmp/startup 20 200 --cold
// --cold measures buffered LCP in a fresh process; the default profiles a reload from navigation start.
// --stored replays an encrypted disposable copy selected by audit-live-startup.cjs.
// The copied profile has no credentials, and execution/recovery handlers are disabled.
async function profileChatStartup() {
  const stored = process.argv.includes("--stored");
  const sessions = Number(process.argv[3] || 6), runCount = Number(process.argv[4] || 40);
  assert.ok(Number.isInteger(sessions) && sessions > 0 && sessions <= 30);
  assert.ok(Number.isInteger(runCount) && runCount > 0 && runCount <= 200);
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# Synthetic startup fixture\n");
  fs.writeFileSync(path.join(workspace, "FIXTURE.js"), "const startupFixture = 1;\n");
  let storedSessions = 0;
  if (stored) {
    const audit = JSON.parse(fs.readFileSync(path.resolve("tmp/live-startup-audit.json"), "utf8"));
    storedSessions = require("./profile-stored-history.cjs").copyStoredHistory({ audit, userData: launch.userData, workspace });
    launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  }
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    let page = await app.firstWindow();
    page.on("pageerror", error => console.error("Renderer:", error.message));
    await page.waitForFunction(() => typeof window.api?.recordChatEvent === "function");
    await page.evaluate(async ({ workspace, sessions, runCount, stored }) => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      if (stored) return;
      const message = "Inspect this local fixture and report the result. ".repeat(25);
      const reply = "## Observations\n\n" + "The local fixture returned the expected response. ".repeat(30) + "\n\n```javascript\nconst response = { status: 200 };\n```";
      const runs = Array.from({ length: runCount }, (_, index) => ({
        id: `run-${index}`, user: { message: `${message} ${index}` }, events: [{ type: "chat", text: reply }],
      }));
      const history = runs.flatMap(run => [{ role: "user", content: run.user.message }, { role: "assistant", content: reply }]);
      const html = runs.map(run => `<div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box-content user-prompt-preview">${run.user.message}</div></div><div class="chat-turn assistant"><div class="assistant-reply" data-raw-md="${reply}">${reply}</div></div></div></div>`).join("");
      for (let index = 0; index < sessions; index++) {
        const opened = await window.api.beginChatBlock({ workspace, title: `Startup fixture ${index}`, userPrompt: message });
        if (!opened.ok) throw new Error(opened.error || "Fixture session could not start");
        const saved = await window.api.recordChatEvent({ workspace, sessionId: opened.sessionId, blockId: opened.blockId,
          type: "snapshot", transcript: history, uiTranscript: { version: 1, runs }, displayHtml: html });
        if (!saved.ok) throw new Error(saved.error || "Fixture session could not save");
      }
      await window.api.flushChatHistory();
    }, { workspace, sessions, runCount, stored });
    if (process.argv.includes("--cold")) {
      await app.close();
      app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args,
        env: launch.env, timeout: 45000 });
      page = await app.firstWindow();
      page.on("pageerror", error => console.error("Renderer:", error.message));
    }
    const observeStartup = () => {
      const metrics = globalThis.fixtureStartup = { lcp: [], longTasks: [], sanitizations: [], markdownByClass: {}, previewReadyMs: null, markdownRenders: 0 };
      let markdown = globalThis.MarkdownRenderer;
      Object.defineProperty(globalThis, "MarkdownRenderer", { configurable: true,
        get: () => markdown,
        set(value) {
          const render = value.renderToElement;
          value.renderToElement = function (...args) {
            metrics.markdownRenders++;
            const key = args[0].className;
            const count = metrics.markdownByClass[key] ||= { count: 0, bytes: 0, ms: 0 };
            const started = performance.now();
            count.count++; count.bytes += String(args[1] || "").length;
            try { return render.apply(this, args); }
            finally { count.ms += performance.now() - started; }
          };
          markdown = value;
        },
      });
      if (markdown) globalThis.MarkdownRenderer = markdown;
      let purify = globalThis.DOMPurify;
      Object.defineProperty(globalThis, "DOMPurify", { configurable: true,
        get: () => purify,
        set(value) {
          const sanitize = value.sanitize;
          value.sanitize = function (...args) {
            const start = performance.now();
            try { return sanitize.apply(this, args); }
            finally { metrics.sanitizations.push({ bytes: String(args[0]).length, ms: performance.now() - start }); }
          };
          purify = value;
        },
      });
      if (purify) globalThis.DOMPurify = purify;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) metrics.lcp.push({ ms: entry.startTime, element: entry.element?.className });
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) metrics.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
      const observer = new MutationObserver(() => {
        if (metrics.previewReadyMs !== null || !document.querySelector(".user-prompt-preview")) return;
        metrics.previewReadyMs = performance.now();
      });
      observer.observe(document, { childList: true, subtree: true });
    };
    await page.addInitScript(observeStartup);
    const cdp = await page.context().newCDPSession(page);
    if (process.argv.includes("--main-profile")) await app.evaluate(async () => {
      const { Session } = process.mainModule.require("node:inspector");
      const profiler = globalThis.startupMainProfiler = new Session();
      profiler.connect();
      await new Promise((resolve, reject) => profiler.post("Profiler.enable", error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => profiler.post("Profiler.start", error => error ? reject(error) : resolve()));
    });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    if (process.argv.includes("--cold")) await page.evaluate(observeStartup);
    else await page.reload();
    await page.waitForFunction(({ stored, count }) => stored
      ? document.querySelectorAll("#messages .chat-exchange").length > 0
      : document.querySelectorAll("#messages .chat-exchange").length === count, { stored, count: runCount }, { timeout: 45000 });
    await page.waitForFunction(() => globalThis.fixtureStartup?.lcp.length, null, { timeout: 15000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => ({ ...globalThis.fixtureStartup,
      elapsedMs: performance.now(), paints: performance.getEntriesByType("paint").map(entry => ({ name: entry.name, ms: entry.startTime })),
      exchanges: document.querySelectorAll("#messages .chat-exchange").length,
      tabs: document.querySelectorAll("#chat-session-select [data-session-id]").length,
      resources: performance.getEntriesByType("resource").filter(entry => /\.js/.test(entry.name)).map(entry => ({ name: entry.name.split("/").at(-1), start: entry.startTime, duration: entry.duration })),
    }));
    const { profile } = await cdp.send("Profiler.stop");
    const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
    const samples = new Map();
    for (let index = 0; index < profile.samples.length; index++) {
      const frame = nodes.get(profile.samples[index]);
      const key = `${frame.functionName || "anonymous"} ${frame.url.split("/").at(-1)}:${frame.lineNumber + 1}`;
      samples.set(key, (samples.get(key) || 0) + profile.timeDeltas[index] / 1000);
    }
    const report = { sessions: stored ? storedSessions : sessions, fixture: stored ? "saved encrypted history; offline disposable copy" : "synthetic history", runCount, mode: process.argv.includes("--cold") ? "new process; buffered LCP" : "reload; full renderer CPU profile", ...metrics, sanitizations: { count: metrics.sanitizations.length,
      bytes: metrics.sanitizations.reduce((sum, item) => sum + item.bytes, 0), ms: metrics.sanitizations.reduce((sum, item) => sum + item.ms, 0),
      largeBackups: metrics.sanitizations.filter(item => item.bytes > 100_000).length },
      topSamples: [...samples].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([name, ms]) => ({ name, ms: Math.round(ms) })) };
    const output = path.resolve(process.argv[2] || "tmp/chat-startup-profile");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile));
    if (process.argv.includes("--main-profile")) {
      const main = await app.evaluate(() => new Promise((resolve, reject) => globalThis.startupMainProfiler.post("Profiler.stop", (error, result) => {
        globalThis.startupMainProfiler.disconnect();
        error ? reject(error) : resolve(result.profile);
      })));
      fs.writeFileSync(`${output}.main.cpuprofile`, JSON.stringify(main));
    }
    fs.writeFileSync(`${output}.json`, JSON.stringify(report, null, 2));
    assert.ok(metrics.lcp.at(-1)?.ms > 0);
    if (!process.argv.includes("--cold")) {
      assert.ok(metrics.previewReadyMs > 0);
      if (!stored) assert.equal(metrics.markdownRenders, runCount, "structured replies render once");
    }
    if (!stored) assert.equal(await page.locator("#messages .assistant-reply-footer").count(), runCount);
    console.log(JSON.stringify(report, null, 2));
    await page.locator("#file-tree").getByText("FIXTURE.js", { exact: true }).dblclick();
    await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.getValue() === "const startupFixture = 1;\n"));
    await page.evaluate(() => {
      const model = globalThis.monaco.editor.getModels().find(model => model.getValue() === "const startupFixture = 1;\n");
      model.setValue("const startupFixture = 2;\n");
    });
    await page.keyboard.press("Control+s");
    for (let index = 0; index < 200 && fs.readFileSync(path.join(workspace, "FIXTURE.js"), "utf8") !== "const startupFixture = 2;\n"; index++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.readFileSync(path.join(workspace, "FIXTURE.js"), "utf8"), "const startupFixture = 2;\n");
    console.log("PASS opening, editing, and saving the first code file after startup");
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}

if (require.main === module) profileChatStartup().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { profileChatStartup };
