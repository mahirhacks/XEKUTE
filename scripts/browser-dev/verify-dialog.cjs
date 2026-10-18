"use strict";

const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyBrowserDialogs() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app, process;
  const passed = [];
  const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    process = app.process();
    // The outer test driver must leave native page dialogs to the app. Its
    // default handler would otherwise dismiss them from another connection.
    app.context().on("dialog", () => {});
    await app.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("The native browser host did not initialize.");
    });
    await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      const tab = service.list()[0];
      await service.navigate(tab.id, h.fixtures.origins.primary + "/dialogs");
      await service.handoff(tab.id, "dialog-chat", tab.controlGeneration);
      const visual = h.modules.createNativeBrowserVisual({ service, artifactStore: h.artifactStore });
      globalThis.dialogProvider = h.modules.createNativeBrowserProvider({ getService: () => service, visual });
      globalThis.dialogTabId = tab.id;
      globalThis.dialogContext = { browserSessionId: "dialog-chat", sessionId: "runtime-dialog-chat", workspace: h.projectA.workspace };
    });
    for (const [kind, expected] of [["alert", "Alert closed"], ["confirm", "Confirmed"], ["prompt", "Prompt: fixture response"]]) {
      const result = await app.evaluate(async (_electronApi, { kind }) => {
        const h = globalThis.xekuteNativeBrowserDevelopment;
        const opened = await dialogProvider.execute({ action: "click", tabId: dialogTabId, selector: `#${kind}` }, dialogContext);
        const pending = h.browser.getDialog(dialogTabId), state = h.browser.list().find(tab => tab.id === dialogTabId);
        const handled = await dialogProvider.execute({ action: "handle_dialog", tabId: dialogTabId, accept: true, text: "fixture response" }, dialogContext);
        const observed = await dialogProvider.execute({ action: "observe", tabId: dialogTabId }, dialogContext);
        const text = await h.browser.getContents(dialogTabId).executeJavaScript("document.querySelector('#status').textContent");
        return { opened, pending, state, handled, observed, text, debuggerAttached: h.browser.getContents(dialogTabId).debugger.isAttached() };
      }, { kind });
      assert.equal(result.opened.dialog.type, kind); assert.equal(result.pending.type, kind);
      assert.equal(result.state.operation.status, "idle"); assert.equal(result.handled.result.handled, true);
      assert.equal(result.text, expected); assert.ok(result.observed.observation); assert.equal(result.debuggerAttached, false);
      pass(`native ${kind} survives between tool leases and resumes after an explicit response`);
    }
    const navigated = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const results = [];
      for (let i = 0; i < 2; i++) {
        const opened = await dialogProvider.execute({ action: "navigate", tabId: dialogTabId, url: h.fixtures.origins.primary + "/prompt-on-load?attempt=" + i }, dialogContext);
        const pending = h.browser.getDialog(dialogTabId);
        await dialogProvider.execute({ action: "handle_dialog", tabId: dialogTabId, accept: true, text: "navigation " + i }, dialogContext);
        const observed = await dialogProvider.execute({ action: "observe", tabId: dialogTabId }, dialogContext);
        results.push({ type: opened.dialog?.type, pending: pending?.type, observation: observed.observation?.text, remaining: h.browser.getDialog(dialogTabId) });
      }
      await dialogProvider.execute({ action: "navigate", tabId: dialogTabId, url: h.fixtures.origins.primary + "/dialogs" }, dialogContext);
      await h.browser.getContents(dialogTabId).executeJavaScript("window.prompt=()=> 'site custom prompt';void 0");
      await dialogProvider.execute({ action: "click", tabId: dialogTabId, selector: "#prompt" }, dialogContext);
      const custom = await h.browser.getContents(dialogTabId).executeJavaScript("document.querySelector('#status').textContent");
      await dialogProvider.execute({ action: "navigate", tabId: dialogTabId, url: h.fixtures.origins.primary + "/dialogs" }, dialogContext);
      return { results, custom };
    });
    navigated.results.forEach((result, i) => {
      assert.equal(result.type, "prompt"); assert.equal(result.pending, "prompt");
      assert.match(result.observation, new RegExp("Accepted: navigation " + i)); assert.equal(result.remaining, null);
    });
    assert.equal(navigated.custom, "Prompt: site custom prompt");
    pass("navigation prompts initialize before page scripts, resume once, and preserve custom page prompts");
    const taken = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      await dialogProvider.execute({ action: "click", tabId: dialogTabId, selector: "#confirm" }, dialogContext);
      const tab = service.list().find(tab => tab.id === dialogTabId);
      const human = await service.takeover(dialogTabId, tab.controlGeneration);
      const pending = service.getDialog(dialogTabId);
      const text = await service.getContents(dialogTabId).executeJavaScript("document.querySelector('#status').textContent");
      const resumed = await service.handoff(dialogTabId, "dialog-chat", human.controlGeneration);
      return { human, pending, text, resumed };
    });
    assert.equal(taken.human.owner.kind, "human"); assert.equal(taken.pending, null); assert.equal(taken.text, "Cancelled");
    assert.equal(taken.resumed.owner.sessionId, "dialog-chat");
    pass("takeover dismisses a pending dialog before pointer cleanup and can resume the same tab");
    const canceled = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      await dialogProvider.execute({ action: "click", tabId: dialogTabId, selector: "#prompt" }, dialogContext);
      await service.cancelChat("dialog-chat");
      return { tab: service.list().find(tab => tab.id === dialogTabId), pending: service.getDialog(dialogTabId), text: await service.getContents(dialogTabId).executeJavaScript("document.querySelector('#status').textContent") };
    });
    assert.equal(canceled.tab.owner.kind, "human"); assert.equal(canceled.pending, null); assert.equal(canceled.text, "Prompt cancelled");
    pass("chat cancellation dismisses a pending native prompt and leaves the browser usable");
    return { passed };
  } finally {
    let timer;
    try { if (app) await Promise.race([app.close(), new Promise(resolve => { timer = setTimeout(() => { process?.kill(); resolve(); }, 5000); })]); }
    finally { clearTimeout(timer); removeDevUserData(launch.userData); }
  }
}

module.exports = { verifyBrowserDialogs };
if (require.main === module) verifyBrowserDialogs().then(result => console.log(`Verified ${result.passed.length} native dialog scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
