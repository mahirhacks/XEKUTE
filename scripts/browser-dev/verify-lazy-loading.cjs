"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyLazyLoading({ baseline = false } = {}) {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "FIXTURE.js"), "const lazyFixture = 1;\n");
  let app;
  const errors = [];
  try {
    const start = async () => {
      app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
      const page = await app.firstWindow();
      page.setDefaultTimeout(20000);
      page.on("pageerror", error => errors.push(error.message));
      await page.waitForFunction(() => window.api?.assessmentSettings && window.XekuteTerminalManager);
      return page;
    };
    let page = await start();
    await page.evaluate(async workspace => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      const current = await window.api.assessmentSettings({ path: workspace });
      const saved = await window.api.assessmentWriteSettings({ path: workspace, settings: { ...current.settings, listener: { ...current.settings.listener, port: 0 } } });
      if (!saved.ok) throw new Error(saved.error);
    }, workspace);
    await app.close();
    app = null;
    page = await start();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("FIXTURE.js"));
    const cdp = await page.context().newCDPSession(page);
    const scripts = new Set();
    cdp.on("Debugger.scriptParsed", event => { if (event.url.startsWith("file:") && /\.js(?:$|\?)/.test(event.url)) scripts.add(event.url); });
    await cdp.send("Debugger.enable");
    const snapshot = async () => ({ ...await page.evaluate(async () => {
      const lcp = [];
      const observer = new PerformanceObserver(list => lcp.push(...list.getEntries().map(entry => entry.startTime)));
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      await new Promise(resolve => setTimeout(resolve, 100));
      observer.disconnect();
      return { lcpMs: lcp.at(-1), terminalLoaded: typeof globalThis.Terminal === "function", monacoLoaderLoaded: typeof globalThis.require === "function" };
    }), scripts: [...scripts] });
    const initial = await snapshot();
    initial.scriptBytes = initial.scripts.reduce((sum, url) => sum + (url.startsWith("file:") ? fs.statSync(fileURLToPath(url)).size : 0), 0);
    if (baseline) {
      fs.writeFileSync(path.resolve("tmp/lazy-loading-baseline.json"), JSON.stringify(initial, null, 2));
      console.log(JSON.stringify(initial));
      return initial;
    }
    assert.equal(initial.terminalLoaded, false);
    assert.equal(initial.monacoLoaderLoaded, false);
    assert.equal(initial.scripts.some(url => /common-.*\.js|terminal-vendor-.*\.js/.test(url)), false, "unused syntax and terminal libraries stay unloaded");
    await page.evaluate(() => {
      const reply = document.createElement("div"); reply.className = "assistant-reply"; reply.id = "lazy-markdown-fixture";
      document.querySelector("#messages").appendChild(reply);
      globalThis.MarkdownRenderer.renderToElement(reply, "A plain answer without code.");
    });
    assert.equal((await snapshot()).scripts.some(url => /common-.*\.js/.test(url)), false);
    await page.evaluate(() => globalThis.MarkdownRenderer.renderToElement(document.querySelector("#lazy-markdown-fixture"), "```javascript\nconst lazyCode = true;\n```"));
    await page.waitForFunction(() => document.querySelector("#lazy-markdown-fixture .hljs-keyword"));
    const loaderFailure = await page.evaluate(async () => {
      const append = document.head.appendChild;
      document.head.appendChild = function (node) {
        if (node.tagName === "SCRIPT" && node.src.endsWith("/vs/loader.js")) { queueMicrotask(() => node.dispatchEvent(new Event("error"))); return node; }
        return append.call(this, node);
      };
      try { await globalThis.XekuteEditorManager.showTab("failed-loader", "failed.js", ""); return null; }
      catch (error) { return error.message; }
      finally { document.head.appendChild = append; }
    });
    assert.equal(loaderFailure, "Monaco loader is unavailable.");
    await page.locator("#file-tree").getByText("FIXTURE.js", { exact: true }).dblclick();
    await page.waitForFunction(() => globalThis.monaco?.editor.getModels().some(model => model.getValue() === "const lazyFixture = 1;\n"));
    await page.evaluate(() => {
      globalThis.lazyMonaco = globalThis.monaco;
      const model = globalThis.monaco.editor.getModels().find(model => model.getValue() === "const lazyFixture = 1;\n");
      model.setValue("const lazyFixture = 2;\n");
    });
    await page.keyboard.press("Control+s");
    for (let i = 0; i < 100 && fs.readFileSync(path.join(workspace, "FIXTURE.js"), "utf8") !== "const lazyFixture = 2;\n"; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.readFileSync(path.join(workspace, "FIXTURE.js"), "utf8"), "const lazyFixture = 2;\n");
    await page.evaluate(() => {
      globalThis.lazyTerminalProbes = [];
      let terminal;
      Object.defineProperty(globalThis, "Terminal", { configurable: true, get: () => terminal, set: Base => {
        terminal = class extends Base { constructor(...args) { super(...args); globalThis.lazyTerminalProbes.push(this); } };
      } });
      const input = { id: "lazy-agent-terminal", command: "fixture command" };
      globalThis.lazyAgentAttachments = Promise.all([globalThis.XekuteTerminalManager.attachAgentSession(input), globalThis.XekuteTerminalManager.attachAgentSession(input)]);
    });
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").webContents;
      contents.send("terminal:data", { id: "lazy-agent-terminal", data: "EARLY_LAZY_OUTPUT\r\n" });
      contents.send("terminal:exit", { id: "lazy-agent-terminal" });
    });
    assert.deepEqual(await page.evaluate(() => globalThis.lazyAgentAttachments), ["lazy-agent-terminal", "lazy-agent-terminal"]);
    await page.waitForFunction(() => {
      const buffer = globalThis.lazyTerminalProbes[0]?.buffer.active;
      if (!buffer) return false;
      const text = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString()).join("\n");
      return text.includes("EARLY_LAZY_OUTPUT") && text.includes("Agent terminal is observe only");
    });
    assert.equal(await page.locator('[data-terminal-id="lazy-agent-terminal"].terminal-instance').count(), 1);
    assert.equal(await page.evaluate(() => globalThis.lazyTerminalProbes.length), 1);
    await page.evaluate(() => globalThis.XekuteTerminalManager.attachAgentSession({ id: "lazy-agent-terminal", command: "fixture command" }));
    assert.equal(await page.evaluate(() => globalThis.lazyTerminalProbes.length), 1);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("terminal:create");
      ipcMain.handle("terminal:create", () => ({ shell: "fixture" }));
    });
    assert.equal(await page.evaluate(() => globalThis.XekuteTerminalManager.createTerminal()), "term-1");
    assert.equal(await page.evaluate(() => globalThis.lazyTerminalProbes.length), 2);
    await page.evaluate(() => globalThis.MarkdownRenderer.renderToElement(document.querySelector("#lazy-markdown-fixture"), "```mermaid\ngraph TD\n A[Start] --> B[Done]\n```"));
    await page.waitForFunction(() => document.querySelector("#lazy-markdown-fixture .md-mermaid svg"));
    const final = await snapshot();
    assert.equal(final.scripts.filter(url => /terminal-vendor-.*\.js/.test(url)).length, 1);
    assert.equal(final.scripts.filter(url => /common-.*\.js/.test(url)).length, 1);
    assert.equal(final.scripts.filter(url => /\/vs\/loader\.js/.test(url)).length, 1);
    assert.equal(await page.evaluate(() => globalThis.monaco === globalThis.lazyMonaco), true);
    assert.deepEqual(errors, []);
    const report = { passed: true, initial, firstUse: { terminal: true, earlyOutput: true, deduplicated: true, manualTerminal: true, codeHighlighting: true, editAndSave: true, editorRecovery: true, mermaid: true, retained: true } };
    fs.writeFileSync(path.resolve("tmp/lazy-loading-after.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    return report;
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyLazyLoading };
if (require.main === module) verifyLazyLoading({ baseline: process.argv.includes("--baseline") }).catch(error => { console.error(error); process.exitCode = 1; });
