"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

function dumpFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? dumpFiles(file) : entry.name.endsWith(".dmp") ? [file] : [];
  });
}

async function verifyNativeStartup({ captureCrash = false, noReadyToShowOnly = false } = {}) {
  const cases = [];
  const modes = noReadyToShowOnly ? ["no-ready-to-show"] : ["hardware", "hardware", "software", "software", "no-ready-to-show", ...(captureCrash ? ["renderer-crash", "main-crash"] : [])];
  for (const mode of modes) {
    const launch = createDevLaunch({ smoke: true });
    launch.args[0] = path.join(__dirname, "app-host.cjs");
    launch.args.push("--dev");
    launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
    launch.env.XEKUTE_BROWSER_DEV_HARDWARE = mode === "software" ? "0" : "1";
    if (mode === "no-ready-to-show") launch.env.XEKUTE_BROWSER_DEV_SUPPRESS_READY_TO_SHOW = "1";
    fs.writeFileSync(path.join(launch.userData, "Preferences"), JSON.stringify({ electron: { devtools: {
      bounds: { x: 368, y: 132, width: 800, height: 600 },
      preferences: { "panel-selected-tab": '"timeline"', "drawer-view-selected-tab": '"console-view"', "console.text-filter": '"app"' },
    } } }));
    let app;
    let passed = false;
    try {
      app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 20000 });
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.api?.assessmentSettings && document.querySelector("#send-btn"), null, { timeout: 15000 });
      await app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").webContents;
        if (contents.devToolsWebContents) return;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Startup DevTools did not finish opening")), 15000);
          contents.once("devtools-opened", () => { clearTimeout(timer); resolve(); });
        });
      });
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").isVisible()), true,
        "Xekute's main window must be visible even when first-paint readiness is missing; DevTools alone is not a successful startup");
      assert.equal(await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").webContents;
        const owner = BrowserWindow.fromWebContents(contents.devToolsWebContents);
        return owner?.webContents === contents.devToolsWebContents;
      }), true, "Detached DevTools must own their BrowserWindow instead of inheriting the inspected window");
      const info = await app.evaluate(({ app, crashReporter }) => ({
        uploads: crashReporter.getUploadToServer(), dumps: app.getPath("crashDumps"),
        compositing: app.getGPUFeatureStatus().gpu_compositing,
      }));
      assert.equal(info.uploads, false);
      assert.equal(info.dumps, path.join(launch.userData, "Crashpad"));
      const logfile = path.join(launch.userData, "logs", "main.log");
      assert.match(fs.readFileSync(logfile, "utf8"), /native\.startup/);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#send-btn"));
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2,
        "Reloading the app must retain one detached DevTools window");
      if (mode === "hardware" || mode === "software") {
        await app.evaluate(async ({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").webContents;
          const closed = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Closing DevTools did not detach its contents")), 10000);
            contents.once("devtools-closed", () => { clearTimeout(timer); resolve(); });
          });
          BrowserWindow.fromWebContents(contents.devToolsWebContents).close();
          await closed;
        });
        assert.equal(await app.evaluate(({ BrowserWindow }) => {
          const windows = BrowserWindow.getAllWindows();
          return windows.length === 1 && !windows[0].webContents.isDevToolsOpened();
        }), true, "Closing the detached window must detach DevTools and keep Xekute running");
      }
      if (mode === "renderer-crash") {
        const crashed = page.waitForEvent("crash", { timeout: 10000 });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "XEKUTE").webContents.forcefullyCrashRenderer());
        await crashed;
        const deadline = Date.now() + 10000;
        while (!fs.readFileSync(logfile, "utf8").includes("native.render-process-gone")) {
          if (Date.now() > deadline) throw new Error("The renderer crash was not logged");
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } else if (mode === "main-crash") {
        const exited = new Promise(resolve => app.process().once("exit", (code, signal) => resolve({ code, signal })));
        await app.evaluate(() => process.crash()).catch(() => {});
        const exit = await exited;
        assert.notEqual(exit.code, 0);
      }
      if (mode.endsWith("-crash")) {
        const deadline = Date.now() + 15000;
        let dumps;
        while (!(dumps = dumpFiles(info.dumps)).length) {
          if (Date.now() > deadline) throw new Error("No local native minidump was captured");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(fs.readFileSync(dumps[0]).subarray(0, 4).toString(), "MDMP");
      }
      cases.push({ mode, compositing: info.compositing, mainWindowVisible: true, ownedDevtools: true, reload: true, passed: true });
      passed = true;
    } finally {
      try { await app?.close(); }
      catch (error) { if (mode !== "main-crash") throw error; }
      finally {
        if (passed) removeDevUserData(launch.userData);
        else console.error(`Startup diagnostic profile retained at ${launch.userData}`);
      }
    }
  }
  console.log(JSON.stringify({ passed: true, cases }));
}

module.exports = { verifyNativeStartup };
if (require.main === module) {
  // Crash probes affect only the disposable offline profile created above.
  verifyNativeStartup({ captureCrash: process.argv.includes("--capture-crash"), noReadyToShowOnly: process.argv.includes("--no-ready-to-show") })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
