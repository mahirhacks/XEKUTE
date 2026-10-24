"use strict";
const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyBrowserDeadlines() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    await app.evaluate(async () => {
      while (!globalThis.xekuteNativeBrowserDevelopment) await new Promise(resolve => setTimeout(resolve, 10));
      await globalThis.xekuteNativeBrowserDevelopment.initial;
    });
    const report = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser;
      const tab = await h.initial;
      let owned = await b.handoff(tab.id, "deadline-chat", tab.controlGeneration);
      const contents = b.getContents(tab.id), debug = contents.debugger, send = debug.sendCommand.bind(debug);
      const outcomes = [];
      const run = (task, timeoutMs = 800) => b.withPage(tab.id, "deadline-chat", owned.controlGeneration, task, { timeoutMs });
      const idle = async () => {
        const until = Date.now() + 4000;
        while (b.list().find(item => item.id === tab.id).operation.status === "running") {
          if (Date.now() > until) throw new Error("Timed out operation retained its queue lock");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      const expectTimeout = async (name, work) => {
        const start = Date.now();
        let code;
        try { await work(); } catch (error) { code = error.code; }
        outcomes.push({ name, code, ms: Date.now() - start });
        await idle();
      };
      const recoverFixture = async () => {
        if (b.list().find(item => item.id === tab.id).operation.status === "recovery_required") {
          await b.reload(tab.id);
          owned = await b.handoff(tab.id, "deadline-chat", b.list().find(item => item.id === tab.id).controlGeneration);
        }
      };
      await run(page => page.title(), 5000);
      // Navigation can finish while an evaluation in the observation never resolves.
      await expectTimeout("unresponsive evaluation", () => run(page => page.evaluate(() => new Promise(() => {}))));
      const other = await b.open({ purpose: "research", url: h.fixtures.origins.primary + "/health" });
      const otherOwned = await b.handoff(other.id, "deadline-chat", other.controlGeneration);
      outcomes.push({ name: "another page after timeout", title: await b.withPage(other.id, "deadline-chat", otherOwned.controlGeneration, page => page.title()) });
      await recoverFixture();
      outcomes.push({ name: "next action", title: await run(page => page.title(), 5000) });
      for (const [name, method] of [["dialog setup", "Page.getFrameTree"], ["dialog cleanup", "Page.removeScriptToEvaluateOnNewDocument"]]) {
        debug.sendCommand = (command, ...args) => command === method ? new Promise(() => {}) : send(command, ...args);
        try { await expectTimeout(name, () => run(page => page.title())); }
        finally { debug.sendCommand = send; }
        await recoverFixture();
        outcomes.push({ name: `after ${name}`, title: await run(page => page.title(), 5000) });
      }
      let queuedRan = false;
      const first = run(page => page.waitForTimeout(10000), 1000).catch(error => error.code);
      const queued = run(() => { queuedRan = true; }, 100).catch(error => error.code);
      outcomes.push({ name: "queued expiry", code: await queued, previousCode: await first });
      await idle();
      outcomes.push({ name: "queued action fenced", queuedRan });
      const provider = h.modules.createNativeBrowserProvider({ getService: () => b });
      debug.sendCommand = (method, ...args) => method === "Page.getFrameTree" ? new Promise(() => {}) : send(method, ...args);
      try {
        await expectTimeout("provider total deadline", () => provider.execute({ action: "observe", tabId: tab.id, timeoutMs: 800 }, { sessionId: "deadline-chat" }));
      } finally { debug.sendCommand = send; }
      await recoverFixture();
      // An unresolved input reply must never become an automatic retry.
      let inputs = 0;
      debug.sendCommand = (method, ...args) => {
        if (method !== "Input.dispatchKeyEvent") return send(method, ...args);
        inputs++;
        return new Promise(() => {});
      };
      try { await expectTimeout("uncertain input", () => run(page => page.keyboard.press("Tab"))); }
      finally { debug.sendCommand = send; }
      outcomes.push({ name: "uncertain input fenced", inputs, status: b.list().find(item => item.id === tab.id).operation.status });
      return outcomes;
    });
    for (const outcome of report) {
      if (outcome.code) { assert.equal(outcome.code, "BROWSER_ACTION_TIMEOUT", outcome.name); if (outcome.ms) assert.ok(outcome.ms < 3500, outcome.name); }
      if (outcome.name === "queued expiry") assert.equal(outcome.previousCode, "BROWSER_ACTION_TIMEOUT");
      if (outcome.name === "provider total deadline") assert.ok(outcome.ms < 1800, "provider returns by its overall deadline even while the native lease finishes bounded cleanup");
      if (outcome.name === "queued action fenced") assert.equal(outcome.queuedRan, false);
      if (outcome.name === "uncertain input fenced") { assert.equal(outcome.inputs, 1); assert.equal(outcome.status, "recovery_required"); }
    }
    console.log(JSON.stringify({ passed: true, report }));
    return report;
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyBrowserDeadlines };
if (require.main === module) verifyBrowserDeadlines().catch(error => { console.error(error); process.exitCode = 1; });
