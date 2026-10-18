"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron, chromium } = require("playwright-core");
const { findInstalledBrowser } = require("../../src/agent/tools/assessment/browser-session-manager.js");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyBrowserDevHost() {
  const launch = createDevLaunch({ smoke: true });
  let application;
  const passed = [];
  const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    application = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    const page = await application.firstWindow();
    page.setDefaultTimeout(10000);
    const origins = await application.evaluate(async () => {
      await globalThis.xekuteBrowserDevelopment.ready;
      return globalThis.xekuteBrowserDevelopment.origins;
    });
    const goto = route => page.goto(origins.primary + route);
    await goto("/form");
    assert.equal(await page.evaluate(() => typeof window.api), "undefined");
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    pass("isolated Electron fixture host");
    await page.getByLabel("User", { exact: true }).fill("Alice");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByLabel("Role", { exact: true }).selectOption("admin");
    await page.getByLabel("Remember fixture session").check();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Signed in as Alice (admin)");
    await page.getByRole("button", { name: "Check session" }).click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Session: Alice");
    assert.equal(await page.evaluate(() => localStorage.getItem("fixture-user")), "Alice");
    pass("forms, cookies and local storage");
    await goto("/spa");
    const original = await page.getByRole("button", { name: "Alpha", exact: true }).elementHandle();
    await page.getByRole("button", { name: "Replace results" }).click();
    assert.equal(await original.evaluate(element => element.isConnected), false);
    await original.dispose();
    await page.getByLabel("Filter").fill("Beta");
    await page.getByRole("button", { name: "Beta", exact: true }).click();
    assert.equal(await page.locator("#status").textContent(), "Beta selected at revision 1");
    pass("SPA replacement and stale DOM nodes");
    await goto("/frames");
    const frame = page.frameLocator('iframe[title="Cross-origin fixture"]');
    await frame.getByRole("button", { name: "Activate frame", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Frame activated");
    await frame.frameLocator('iframe[title="Nested fixture"]').getByRole("button", { name: "Activate nested frame" }).click();
    assert.equal(await frame.frameLocator('iframe[title="Nested fixture"]').locator("#status").textContent(), "Nested activated");
    pass("cross-origin and nested frames");
    await goto("/popups");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open popup" }).click()]);
    await popup.getByRole("button", { name: "Complete popup" }).click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Popup completed");
    await popup.close();
    pass("popup creation and opener messaging");
    await goto("/dialogs");
    for (const [button, response, expected] of [["Alert", undefined, "Alert closed"], ["Confirm", undefined, "Confirmed"]]) {
      page.once("dialog", dialog => dialog.accept(response));
      await page.getByRole("button", { name: button, exact: true }).click();
      await page.waitForFunction(expected => document.querySelector("#status").textContent === expected, expected);
      assert.equal(await page.locator("#status").textContent(), expected);
    }
    await page.getByRole("button", { name: "Prompt", exact: true }).click();
    assert.equal(await page.locator("#status").textContent(), "Prompt unavailable: prompt() is not supported.");
    pass("native alert/confirm and explicit Electron prompt limitation");
    const installed = findInstalledBrowser();
    assert.ok(installed, "Install Chrome or Edge to verify the native prompt fixture.");
    const browser = await chromium.launch({ executablePath: installed.executablePath, headless: true });
    try {
      const promptPage = await browser.newPage();
      await promptPage.goto(origins.primary + "/dialogs");
      promptPage.once("dialog", dialog => dialog.accept("fixture reply"));
      await promptPage.getByRole("button", { name: "Prompt", exact: true }).click();
      await promptPage.waitForFunction(() => document.querySelector("#status").textContent === "Prompt: fixture reply");
      pass("native prompt fixture in installed Chromium");
    } finally { await browser.close(); }
    await goto("/canvas");
    const canvas = await page.locator("#target").boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    assert.equal(await page.locator("#status").textContent(), "Canvas activated");
    await page.locator("#drag-source").dragTo(page.locator("#drop-target"));
    assert.equal(await page.locator("#drag-status").textContent(), "Item dropped");
    const imagePath = path.resolve(__dirname, "../../tmp/browser-phase1.png");
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    const image = await page.screenshot({ path: imagePath });
    assert.equal(image.subarray(1, 4).toString(), "PNG");
    pass("native pointer, canvas, drag and screenshot fixture");
    await goto("/files");
    await page.getByLabel("Fixture file").setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("fixture upload") });
    await page.getByRole("button", { name: "Upload file" }).click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Uploaded evidence.txt (14 bytes)");
    await page.getByRole("link", { name: "Download fixture report" }).click();
    const deadline = Date.now() + 10000;
    let downloads;
    do {
      downloads = await application.evaluate(() => globalThis.xekuteBrowserDevelopment.downloads());
      if (downloads.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(downloads.length, 1, "Electron must complete the native download.");
    assert.equal(downloads[0].state, "completed");
    assert.equal(downloads[0].filename, "fixture-report.txt");
    assert.equal(fs.readFileSync(downloads[0].path, "utf8"), "Xekute browser fixture download.\n");
    pass("file upload and download bytes");
    const captures = await application.evaluate(() => globalThis.xekuteBrowserDevelopment.captures());
    assert.ok(captures.some(capture => capture.url === origins.primary + "/api/login" && capture.method === "POST" && capture.status === 200));
    assert.ok(captures.some(capture => capture.url === origins.secondary + "/frame-content" && capture.status === 200));
    assert.ok(captures.some(capture => capture.url === origins.primary + "/download" && capture.responseBody === "Xekute browser fixture download.\n"));
    pass("real browser traffic through the local capture proxy");
    await assert.rejects(page.goto("https://example.invalid/"), /ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/);
    pass("fixture-only host networking");
    return { ok: true, passed, screenshot: imagePath, limitations: ["Electron window.prompt() is unsupported; managed prompt handling is required in the later browser runtime."] };
  } finally {
    try { await application?.close(); } finally { removeDevUserData(launch.userData); }
  }
}

module.exports = { verifyBrowserDevHost };
