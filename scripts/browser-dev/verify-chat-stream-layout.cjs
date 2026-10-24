"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyChatStreamLayout({ storedSession = null } = {}) {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "Local rendering fixture\n");
  let app;
  try {
    if (storedSession) {
      const directory = path.dirname(path.resolve(storedSession));
      const projectId = path.basename(path.resolve(directory, "../.."));
      const sessionId = path.basename(directory);
      const target = path.join(launch.userData, "memory-v3", "sensitive", "projects", projectId, "sessions", sessionId);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(storedSession, path.join(target, "transcript.enc.json"));
      const state = JSON.parse(fs.readFileSync(path.resolve(directory, "../../../../../../Local State"), "utf8"));
      fs.writeFileSync(path.join(launch.userData, "Local State"), JSON.stringify({ os_crypt: state.os_crypt }));
      const { createProjectIdentityStore } = require("../../src/app/storage/memory/project-identity-store.js");
      const bound = createProjectIdentityStore({ baseDir: path.join(launch.userData, "memory-v3", "identity") }).bindWorkspace(workspace, projectId);
      if (!bound.ok) throw new Error(bound.code);
    }
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => typeof window.api?.assessmentSettings === "function");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("agent:run");
      ipcMain.handle("agent:run", (event, payload) => {
        if (payload.userMessage !== "Inspect the local browser fixture and summarize the result.") return { ok: false, error: "Background execution is disabled in this layout fixture." };
        return new Promise(resolve => {
        globalThis.layoutFixture = { sender: event.sender, payload, resolve };
        event.sender.send("agent:event", { type: "input_received", sessionId: payload.sessionId, messageId: payload.userMessageId });
        });
      });
    });
    await page.evaluate(async workspace => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      localStorage.setItem("pointer:enabledModels", JSON.stringify(["fixture-rendering:1b"]));
      localStorage.setItem("pointer:model", "fixture-rendering:1b");
      const current = await window.api.assessmentSettings({ path: workspace });
      await window.api.assessmentWriteSettings({ path: workspace, settings: { ...current.settings, listener: { ...current.settings.listener, port: 0 } } });
    }, workspace);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    await page.locator("#chat-input").fill("Inspect the local browser fixture and summarize the result.");
    await page.locator("#chat-input").press("Enter");
    await app.evaluate(async () => { while (!globalThis.layoutFixture) await new Promise(resolve => setTimeout(resolve, 10)); });
    await page.evaluate(() => {
      window.layoutFrames = { count: 0, overlaps: [] };
      const inspect = () => {
        window.layoutFrames.count++;
        const current = [...document.querySelectorAll("#messages > .chat-exchange")].at(-1);
        const nodes = [...(current?.querySelectorAll(".assistant-reply p, .agent-file-row, .agent-file-stack-toggle, .agent-thinking-toggle") || [])];
        let previous = null;
        for (const node of nodes) {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          if (!rect.height || !rect.width || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
          if (previous && rect.top < previous.bottom - 1 && !previous.node.contains(node) && !node.contains(previous.node)) {
            if (window.layoutFrames.overlaps.length < 10) window.layoutFrames.overlaps.push({ a: previous.node.className, b: node.className, top: rect.top, previousBottom: previous.bottom });
          }
          previous = { node, bottom: rect.bottom };
        }
        if (!window.stopLayoutFrames) requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    });
    const emit = event => app.evaluate((_electron, event) => {
      const f = globalThis.layoutFixture;
      f.sender.send("agent:event", { sessionId: f.payload.sessionId, ...event });
    }, event);
    for (let batch = 0; batch < 10; batch++) {
      await emit({ type: "model_start" });
      await emit({ type: "thinking", token: `Reviewing batch ${batch}.` });
      await emit({ type: "content", delta: `Let me inspect browser batch ${batch}. The observation will determine the next local step.\n\n` });
      for (let i = 0; i < 4; i++) {
        const tool = { toolName: "browser_action", callId: `layout-${batch}-${i}`, args: { action: "open_page", url: `https://fixture.test/very/long/path/${batch}/${i}` } };
        await emit({ type: "tool_start", tool });
        await emit({ type: "tool_result", tool, result: { ok: true, value: { title: "Local fixture" } } });
      }
      const stack = page.locator("#messages .agent-file-stack").filter({ has: page.locator(`[data-call-id="layout-${batch}-3"]`) }).locator(":scope > .agent-file-stack-toggle");
      await stack.click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await stack.click();
      // Leave intermediate streamed frames on screen while the next batch arrives.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1400)));
    await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-stream-layout.png") });
    const report = await page.evaluate(() => { window.stopLayoutFrames = true; return { ...window.layoutFrames, rows: [...document.querySelectorAll("#messages > .chat-exchange")].at(-1).querySelectorAll(".agent-file-row").length }; });
    console.log(JSON.stringify(report));
    assert.equal(report.rows, 40);
    assert.deepEqual(report.overlaps, [], "streamed prose and activity rows must never paint over each other");
    await app.evaluate(() => globalThis.layoutFixture.resolve({ ok: true }));
    return report;
  } catch (error) {
    const page = app && await app.firstWindow().catch(() => null);
    if (page) console.error(JSON.stringify(await page.evaluate(() => ({
      uiModel: document.querySelector("#model-picker")?.textContent,
      exchanges: document.querySelectorAll("#messages > .chat-exchange").length,
      fixtureRows: document.querySelectorAll('[data-call-id^="layout-"]').length,
      visibleRows: [...document.querySelectorAll('[data-call-id^="layout-"]')].filter(node => node.getBoundingClientRect().height > 0).length,
      running: document.querySelector("#send-btn")?.classList.contains("stop"),
    })).catch(() => ({ pageUnavailable: true }))));
    throw error;
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyChatStreamLayout };
if (require.main === module) verifyChatStreamLayout({ storedSession: process.argv[2] }).catch(error => { console.error(error); process.exitCode = 1; });
