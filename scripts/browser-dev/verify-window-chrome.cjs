"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyWindowChrome() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => globalThis.XekuteTerminalManager && window.api?.windowToggleMaximize);
    const expect = async maximized => {
      await page.waitForFunction(maximized => {
        const button = document.querySelector("#btn-window-maximize");
        return button?.title === (maximized ? "Restore" : "Maximize")
          && button.querySelector(".codicon").classList.contains(maximized ? "codicon-chrome-restore" : "codicon-chrome-maximize")
          && !button.querySelector(".codicon").classList.contains(maximized ? "codicon-chrome-maximize" : "codicon-chrome-restore");
      }, maximized, { timeout: 5000 });
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").isMaximized()), maximized);
    };
    await expect(false);
    await page.locator("#btn-window-maximize").click();
    await expect(true);
    // Dragging a maximized Windows window restores it through this native event,
    // without invoking the custom title-bar button's click handler.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").unmaximize());
    await expect(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").maximize());
    await expect(true);
    await page.reload();
    await expect(true);
    await page.locator("#btn-window-maximize").click();
    await expect(false);
    console.log(JSON.stringify({ passed: true, button: true, nativeRestore: true, nativeMaximize: true, reloadWhileMaximized: true }));
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyWindowChrome };
if (require.main === module) verifyWindowChrome().catch(error => { console.error(error); process.exitCode = 1; });
