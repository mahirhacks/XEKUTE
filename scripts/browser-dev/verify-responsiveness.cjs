"use strict";

const assert = require("node:assert/strict");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyResponsiveness() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    app.process().stderr.on("data", data => { if (/Error|Exception/.test(String(data))) console.error(String(data)); });
    await app.evaluate(async () => {
      for (let index = 0; index < 500; index++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Browser fixture did not initialize");
    });
    await app.evaluate(({ app, safeStorage }) => globalThis.xekuteNativeBrowserDevelopment.modules.startResponsivenessFixture({ app, safeStorage }));
    const result = await app.evaluate(async () => {
      const state = globalThis.xekuteResponsiveness, h = globalThis.xekuteNativeBrowserDevelopment;
      const value = await state.pending;
      return { ...value, input: await h.browser.getContents(state.tabId).executeJavaScript("document.querySelector('#username').value"), owner: h.browser.list().find(tab => tab.id === state.tabId).owner.kind };
    });
    assert.equal(result.input, "responsive");
    assert.equal(result.owner, "human");
    assert.equal(result.saves, 30);
    assert.ok(result.outputBytes > 1_000_000);
    assert.ok(Number.isFinite(result.maxInputDeliveryMs));
    console.log(JSON.stringify(result, null, 2));
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}

if (require.main === module) verifyResponsiveness().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verifyResponsiveness };
