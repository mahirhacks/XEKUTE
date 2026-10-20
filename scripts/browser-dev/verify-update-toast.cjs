"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Sends the updater's own events from the main process and checks what each
// update toast state shows, saving a screenshot of every state.
async function verifyUpdateToast() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const shots = path.resolve(__dirname, "../../tmp/update-toast");
  fs.mkdirSync(shots, { recursive: true });
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Renderer:", error.message); });
    await page.waitForFunction(() => typeof window.api?.onUpdateEvent === "function" && document.getElementById("update-toast"));
    const send = payload => app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send("updates:event", payload), payload);
    const toast = page.locator("#update-toast");
    const visible = selector => page.locator(selector).isVisible();
    const radius = selector => page.locator(selector).evaluate(element => getComputedStyle(element).borderRadius);

    // The renderer subscribes at the end of startup; resend until it listens.
    for (let attempt = 0; attempt < 60 && !(await toast.isVisible()); attempt++) {
      await send({ type: "available", version: "9.9.9" });
      await page.waitForTimeout(250);
    }
    await toast.waitFor({ state: "visible" });
    assert.equal(await page.locator(".update-toast-title").textContent(), "Update available");
    assert.equal(await page.locator(".update-toast-version").textContent(), "XEKUTE 9.9.9 is ready to install.");
    assert.equal(await visible("#update-toast-install"), true);
    assert.equal(await visible("#update-toast-ignore"), true);
    assert.equal(await visible("#update-toast-close"), false);
    assert.equal(await radius("#update-toast"), "6px");
    assert.equal(await radius("#update-toast-install"), "4px");
    await toast.screenshot({ path: path.join(shots, "1-available.png") });
    pass("available shows the version with Ignore and Install");

    await send({ type: "downloading", version: "9.9.9" });
    await send({ type: "progress", percent: 42 });
    await page.waitForFunction(() => document.querySelector(".update-toast-progress-label")?.textContent === "42%");
    assert.equal(await page.locator(".update-toast-title").textContent(), "Downloading update");
    assert.equal(await visible("#update-toast-install"), false);
    assert.equal(await visible("#update-toast-close"), true);
    const fill = await page.locator(".update-toast-progress > i").evaluate(element => element.style.width);
    assert.equal(fill, "42%");
    assert.equal(await page.locator(".update-toast-progress-row").count(), 1);
    await toast.screenshot({ path: path.join(shots, "2-downloading.png") });
    pass("downloading shows one progress bar under the title and a close button");

    await send({ type: "updated", version: "9.9.9" });
    await page.waitForFunction(() => document.querySelector(".update-toast-title")?.textContent === "XEKUTE is up to date");
    assert.equal(await page.locator(".update-toast-version").textContent(), "Updated to version 9.9.9.");
    assert.equal(await page.locator(".update-toast-progress-row").count(), 0);
    assert.equal(await visible(".update-toast-check"), true);
    assert.equal(await visible(".update-toast-gift"), false);
    await toast.screenshot({ path: path.join(shots, "3-updated.png") });
    pass("updated shows a check icon and no leftover progress");

    await page.locator("#update-toast-close").click();
    await toast.waitFor({ state: "hidden" });
    await send({ type: "available", version: "9.9.10" });
    await toast.waitFor({ state: "visible" });
    assert.equal(await visible(".update-toast-gift"), true);
    assert.equal(await visible("#update-toast-close"), false);
    pass("dismiss hides the notice and the next prompt starts clean");

    assert.deepEqual(errors, []);
    return { passed, shots };
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyUpdateToast };
if (require.main === module) verifyUpdateToast().then(result => console.log(`Verified ${result.passed.length} update toast states. Screenshots: ${result.shots}`)).catch(error => { console.error(error); process.exitCode = 1; });
