"use strict";
const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyBrowserControl() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app;
  const passed = [];
  const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    app.process().stderr.on("data", data => { if (/Error|Exception/.test(String(data))) console.error(String(data)); });
    await app.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Native browser host did not initialize.");
    });
    const result = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser;
      const tab = await h.initial;
      await b.navigate(tab.id, h.fixtures.origins.primary + "/form");
      const owned = await b.handoff(tab.id, "chat-a", tab.controlGeneration);
      return b.withPage(tab.id, "chat-a", owned.controlGeneration, async page => {
        await page.getByLabel("User", { exact: true }).fill("Alice");
        await page.getByLabel("Password", { exact: true }).fill("fixture-password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Signed in"));
        return { text: await page.locator("#status").textContent(), pages: page.context().pages().length };
      });
    });
    assert.equal(result.text, "Signed in as Alice (user)"); assert.equal(result.pages, 1);
    pass("restricted public Playwright transport fills and submits a native page");
    const frames = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser, tab = b.list()[0];
      return b.withPage(tab.id, "chat-a", tab.controlGeneration, async page => {
        await page.goto(h.fixtures.origins.primary + "/frames");
        await page.frameLocator('iframe[title="Cross-origin fixture"]').getByRole("button", { name: "Activate frame", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("#status").textContent === "Frame activated");
        await page.frameLocator('iframe[title="Cross-origin fixture"]').frameLocator('iframe[title="Nested fixture"]').getByRole("button", { name: "Activate nested frame" }).click();
        return page.frameLocator('iframe[title="Cross-origin fixture"]').frameLocator('iframe[title="Nested fixture"]').locator("#status").textContent();
      });
    });
    assert.equal(frames, "Nested activated"); pass("cross-origin and nested native frames route through the page lease");
    const popup = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser, tab = b.list()[0];
      return b.withPage(tab.id, "chat-a", tab.controlGeneration, async page => {
        await page.goto(h.fixtures.origins.primary + "/popups");
        const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }), page.getByRole("button", { name: "Open popup", exact: true }).click()]).catch(error => { throw new Error(error.message + JSON.stringify(b.list())); });
        await popup.getByRole("button", { name: "Complete popup" }).click();
        await page.waitForFunction(() => document.querySelector("#status").textContent === "Popup completed");
        return { text: await page.locator("#status").textContent(), tabs: b.list() };
      });
    });
    assert.equal(popup.text, "Popup completed"); assert.equal(popup.tabs.length, 2);
    assert.ok(popup.tabs.every(tab => tab.owner.sessionId === "chat-a"));
    pass("native popups become workspace tabs with working opener and inherited ownership");
    const revoked = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser;
      const tab = b.list()[0];
      globalThis.nativeWaitEntered = false;
      globalThis.nativeRunningAction = b.withPage(tab.id, "chat-a", tab.controlGeneration,
        page => { globalThis.nativeWaitEntered = true; return page.getByRole("button", { name: "Never available", exact: true }).click({ timeout: 10000 }); })
        .then(() => "completed", error => error.message);
      globalThis.nativeQueuedAction = b.withPage(tab.id, "chat-a", tab.controlGeneration,
        page => page.evaluate(() => { window.unwantedQueuedInput = true; }))
        .then(() => "completed", error => error.code);
      for (let i = 0; i < 500 && !globalThis.nativeWaitEntered; i++) await new Promise(resolve => setTimeout(resolve, 10));
      if (!globalThis.nativeWaitEntered) throw new Error("The waiting action did not start.");
      await b.takeover(tab.id, tab.controlGeneration);
      return { running: await globalThis.nativeRunningAction, queued: await globalThis.nativeQueuedAction,
        tab: b.list()[0], mutated: await b.getContents(tab.id).executeJavaScript("Boolean(window.unwantedQueuedInput)") };
    });
    assert.notEqual(revoked.running, "completed"); assert.equal(revoked.queued, "BROWSER_CONTROL_STALE");
    assert.equal(revoked.tab.owner.kind, "human"); assert.equal(revoked.tab.operation.status, "idle"); assert.equal(revoked.mutated, false);
    pass("takeover revokes waiting actions and queued retries before transferring control");
    const isolated = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser;
      const tab = b.list()[0];
      await b.open({ purpose: "research", url: h.fixtures.origins.primary + "/health" });
      const owned = await b.handoff(tab.id, "chat-b", tab.controlGeneration);
      let otherChatDenied = false;
      try { await b.withPage(tab.id, "chat-a", owned.controlGeneration, page => page.title()); } catch (error) { otherChatDenied = error.code === "BROWSER_CONTROL_STALE"; }
      return b.withPage(tab.id, "chat-b", owned.controlGeneration, async (page, { browser }) => {
        let globalDenied = false;
        try { await browser.newContext(); } catch (error) { globalDenied = error.message.includes("Unsupported browser-global"); }
        return { otherChatDenied, globalDenied, pageCount: page.context().pages().length };
      });
    });
    assert.equal(isolated.otherChatDenied, true); assert.equal(isolated.globalDenied, true); assert.equal(isolated.pageCount, 1);
    pass("lease discovery excludes other tabs and rejects global browser authority");
    const detached = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, b = h.browser, tab = b.list()[0];
      let rejected = false;
      try {
        await b.withPage(tab.id, "chat-b", tab.controlGeneration, async page => {
          b.getContents(tab.id).debugger.detach();
          await page.title();
        });
      } catch { rejected = true; }
      const uncertain = b.list()[0].operation.status;
      await b.reload(tab.id);
      return { rejected, uncertain, tab: b.list()[0] };
    });
    assert.equal(detached.rejected, true); assert.equal(detached.uncertain, "recovery_required");
    assert.equal(detached.tab.owner.kind, "human"); assert.equal(detached.tab.operation.status, "idle");
    pass("debugger loss requires explicit recovery and never replays uncertain input");
    return { passed };
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyBrowserControl };
if (require.main === module) verifyBrowserControl().then(result => console.log(`Verified ${result.passed.length} control scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
