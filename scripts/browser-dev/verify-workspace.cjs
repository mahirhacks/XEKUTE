"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { startBrowserFixtures } = require("../../test/fixtures/browser/server.js");

async function verifyBrowserWorkspace() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, "NOTES.md"), "# Browser workspace fixture\n");
  const fixtures = await startBrowserFixtures();
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => console.error("Renderer:", error.message));
    app.process().stderr.on("data", data => { if (/Exception|TypeError|Error invoking/.test(String(data))) console.error(String(data)); });
    await page.waitForFunction(() => typeof window.api?.browserOpen === "function");
    await page.evaluate(workspace => { localStorage.setItem("pointer:workspace", workspace); localStorage.setItem("pointer:bugBountyPath", workspace); }, workspace);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    console.log("Workspace loaded");
    // A running user's app can already own 8080. Keep this fixture's listener
    // independent so the UI check neither conflicts with it nor changes it.
    await page.evaluate(async workspace => {
      const current = await window.api.assessmentSettings({ path: workspace });
      if (!current.ok) throw new Error(current.error || "Cannot read fixture runtime settings.");
      const saved = await window.api.assessmentWriteSettings({ path: workspace, settings: { ...current.settings, listener: { ...current.settings.listener, port: 0 } } });
      if (!saved.ok) throw new Error(saved.error || "Cannot configure the fixture proxy.");
    }, workspace);
    // Open Interceptor through the same navigation used by the application.
    await page.locator("#activity-security").click();
    await page.locator("#security-proxy-browser").click();
    await page.locator("#browser-workspace").waitFor({ state: "visible" });
    assert.ok(await page.locator(".editor-tab.active").textContent().then(text => text.includes("Browser")));
    await page.getByText("No page open", { exact: true }).waitFor();
    assert.equal(await page.locator(".browser-web-tab").count(), 0);
    assert.equal(await page.locator(".browser-toolbar").isVisible(), false);
    pass("Browser button opens the Browser workspace without creating a page");
    await page.locator("[data-browser-empty-open]").click();
    await page.getByRole("button", { name: "Open tab", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".browser-web-tab").length > 0);
    await page.getByRole("textbox", { name: "Browser address" }).fill(fixtures.origins.primary + "/form");
    await page.getByRole("textbox", { name: "Browser address" }).press("Enter");
    await page.waitForFunction(url => document.querySelector(".browser-address").value === url, fixtures.origins.primary + "/form");
    const native = async code => app.evaluate(({ webContents }, { prefix, code }) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith(prefix));
      if (!contents) return null;
      return contents.executeJavaScript(code);
    }, { prefix: fixtures.origins.primary, code });
    for (let i = 0; i < 100 && !await native("Boolean(document.querySelector('#username'))"); i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await native("Boolean(document.querySelector('#username'))"), true);
    await native("localStorage.setItem('workspace-state','kept')");
    assert.equal(await native("typeof window.api + ':' + typeof require"), "undefined:undefined");
    pass("workspace address navigates the isolated native page");
    const nativeState = () => app.evaluate(({ webContents }, prefix) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith(prefix));
      const view = contents?.getOwnerBrowserWindow()?.contentView.children.find(view => view.webContents?.id === contents.id);
      return view ? { visible: view.getVisible(), bounds: view.getBounds() } : null;
    }, fixtures.origins.primary);
    await page.locator("#file-tree").getByText("NOTES.md", { exact: true }).dblclick();
    await page.locator("#browser-workspace").waitFor({ state: "hidden" });
    assert.equal((await nativeState()).visible, false);
    await page.locator(".editor-tab").filter({ hasText: "Browser" }).click();
    await page.locator("#browser-workspace").waitFor({ state: "visible" });
    for (let i = 0; i < 100 && !(await nativeState())?.visible; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await nativeState()).visible, true);
    assert.equal(await native("localStorage.getItem('workspace-state')"), "kept");
    pass("file switching hides the native view and preserves its page state");
    await page.evaluate(() => {
      const overlay = document.createElement("div"); overlay.id = "native-overlay-check"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
      overlay.style.cssText = "position:fixed;inset:200px;background:#222;z-index:99999"; document.body.append(overlay);
    });
    for (let i = 0; i < 100 && (await nativeState())?.visible; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await nativeState()).visible, false);
    await page.evaluate(() => document.querySelector("#native-overlay-check").remove());
    for (let i = 0; i < 100 && !(await nativeState())?.visible; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await nativeState()).visible, true);
    pass("application overlays hide the native view without discarding it");
    await page.getByRole("button", { name: "Use in current chat", exact: true }).click();
    await page.getByRole("button", { name: "Take over", exact: true, pressed: true }).waitFor();
    await page.getByRole("button", { name: "Take over", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true, pressed: false }).waitFor();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Take over", exact: true, pressed: true }).waitFor();
    await page.getByRole("button", { name: "Take over", exact: true }).click();
    assert.equal(await native("localStorage.getItem('workspace-state')"), "kept");
    pass("handoff, takeover, and resume preserve the same live page");
    for (let index = 0; index < 7; index++) {
      if (!await page.locator(".browser-new-page").isVisible()) await page.locator("[data-browser-new-toggle]").click();
      await page.getByRole("button", { name: "Open tab", exact: true }).click();
      await page.waitForFunction(count => document.querySelectorAll(".browser-web-tab").length === count, index + 2);
      await page.locator(".browser-new-page").waitFor({ state: "hidden" });
    }
    const strip = page.locator(".browser-web-tabs");
    assert.equal(await strip.evaluate(element => element.scrollWidth > element.clientWidth), true);
    assert.equal(await strip.evaluate(element => {
      const selected = element.querySelector(".is-active").getBoundingClientRect(), bounds = element.getBoundingClientRect();
      return selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1;
    }), true);
    await strip.hover();
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => document.querySelector(".browser-web-tabs").scrollLeft === 0);
    await page.mouse.wheel(0, 250);
    await page.waitForFunction(() => document.querySelector(".browser-web-tabs").scrollLeft > 0);
    await page.mouse.wheel(-10000, 0);
    await page.waitForFunction(() => document.querySelector(".browser-web-tabs").scrollLeft === 0);
    await page.locator('[role="tab"][data-browser-tab]').first().click();
    pass("overflowed browser tabs reveal selections and scroll both ways with mouse and trackpad wheels");
    const chatId = await page.locator(".chat-session-tab.active").getAttribute("data-session-id");
    assert.ok(chatId);
    const emitChecklist = payload => app.evaluate(({ BrowserWindow }, event) => BrowserWindow.getAllWindows()[0].webContents.send("agent:event", event), { sessionId: chatId, source: "parent_continuation", ...payload });
    await emitChecklist({ type: "task_list", tasks: Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: `Checklist step ${index + 1}`, status: index ? "pending" : "in_progress" })) });
    await page.locator("#composer-task-list").waitFor({ state: "visible" });
    assert.equal(await page.locator("#composer-task-list .composer-task-list-row:not([hidden]) .composer-task-list-count").textContent(), "1/10");
    await emitChecklist({ type: "task_list", clear: true });
    await page.locator("#composer-task-list").waitFor({ state: "hidden" });
    await emitChecklist({ type: "parent_run_settled", orchestrationHold: false, pendingEndTurn: false });
    pass("resumed parent checklist events reach the composer widget and clear on completion");
    const imagePath = path.resolve(__dirname, "../../tmp/browser-workspace.png");
    if (process.platform === "win32") {
      const handle = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus();
        return window.getNativeWindowHandle().readBigUInt64LE().toString();
      });
      execFileSync("powershell.exe", ["-NoProfile", "-File", path.join(__dirname, "capture-window.ps1"), "-Handle", handle, "-Path", imagePath], { windowsHide: true });
    } else await page.screenshot({ path: imagePath });
    pass("workspace browser renders alongside chat");
    return { passed, screenshot: imagePath };
  } finally { try { await app?.close(); } finally { await fixtures.close(); removeDevUserData(launch.userData); } }
}
module.exports = { verifyBrowserWorkspace };
if (require.main === module) verifyBrowserWorkspace().then(result => console.log(`Verified ${result.passed.length} workspace scenarios. Screenshot: ${result.screenshot}`)).catch(error => { console.error(error); process.exitCode = 1; });
