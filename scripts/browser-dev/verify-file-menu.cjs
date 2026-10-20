"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Drives the File menu with native dialogs stubbed in the main process. Items
// that need a project or an open editor are disabled until one exists, and
// every enabled item does its job on disk or in the editor.
async function verifyFileMenu() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const projects = path.join(launch.userData, "projects");
  const created = path.join(projects, "created");
  fs.mkdirSync(projects);
  const shots = path.resolve(__dirname, "../../tmp/file-menu");
  fs.mkdirSync(shots, { recursive: true });
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Renderer:", error.message); });
    await page.waitForFunction(() => typeof window.api?.createProject === "function");
    await page.locator("#project-setup").waitFor({ state: "visible" });

    const openFiles = async () => {
      await page.locator('.app-menu-button[data-menu="files"]').click();
      await page.locator('[data-menu-panel="files"]').waitFor({ state: "visible" });
    };
    const enabledItems = () => page.locator('[data-menu-panel="files"] [data-action]').evaluateAll(items => Object.fromEntries(items.map(item => [item.dataset.action, !item.disabled])));
    const choose = async action => {
      await openFiles();
      await page.locator(`[data-menu-panel="files"] [data-action="${action}"]`).click();
    };

    const setup = page.locator("#project-setup");
    assert.equal(await page.locator(".project-setup-icon").evaluate(icon => getComputedStyle(icon).color), "rgb(133, 133, 133)");
    assert.equal(await page.locator("#btn-create-project-sidebar").evaluate(button => getComputedStyle(button).backgroundColor), "rgb(212, 212, 212)");
    const gap = await page.locator("#btn-create-project-sidebar").evaluate(button => {
      const [icon, label] = button.children;
      return label.getBoundingClientRect().left - icon.getBoundingClientRect().right;
    });
    assert.ok(gap >= 7, `icon and label are spaced apart (${gap}px)`);
    await setup.screenshot({ path: path.join(shots, "no-project.png") });
    pass("the empty project panel uses gray buttons with spaced icons");

    await openFiles();
    assert.deepEqual(await enabledItems(), {
      "create-project": true, "open-project": true, "new-file": false, "new-folder": false,
      "open-file": true, "save-file": false, "close-editor": false,
    });
    await page.locator('[data-menu-panel="files"]').screenshot({ path: path.join(shots, "menu-no-project.png") });
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    pass("without a project only create, open and open file are enabled");

    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, created);
    await choose("create-project");
    await setup.waitFor({ state: "hidden" });
    assert.equal(fs.existsSync(created), true);
    await openFiles();
    const withProject = await enabledItems();
    assert.equal(withProject["new-file"], true);
    assert.equal(withProject["new-folder"], true);
    assert.equal(withProject["save-file"], false);
    assert.equal(withProject["close-editor"], false);
    await page.locator('[data-menu-panel="files"] [data-action="new-file"]').click();
    await page.locator("#file-tree input").waitFor({ state: "visible" });
    await page.keyboard.type("made.txt");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => [...document.querySelectorAll("#editor-tab-bar .editor-tab")].some(tab => tab.textContent.includes("made.txt")));
    assert.equal(fs.existsSync(path.join(created, "made.txt")), true);
    pass("a project enables new file, which writes the file and opens it");

    // Typing starts right away, without clicking the editor, and keeps going
    // across the file watcher's refresh of the tree.
    await page.waitForFunction(() => document.activeElement?.closest?.(".monaco-editor"));
    await page.keyboard.type("saved ");
    await page.waitForTimeout(1500);
    await page.keyboard.type("through the menu");
    const editorText = await page.locator(".monaco-editor .view-lines").first().innerText();
    assert.equal(editorText.replace(/ /g, " ").trim(), "saved through the menu");
    pass("a new file keeps keyboard focus while the explorer refreshes");

    await openFiles();
    const withEditor = await enabledItems();
    assert.equal(withEditor["save-file"], true);
    assert.equal(withEditor["close-editor"], true);
    await page.locator('[data-menu-panel="files"] [data-action="save-file"]').click();
    for (let attempt = 0; attempt < 40 && !fs.readFileSync(path.join(created, "made.txt"), "utf8").includes("saved through the menu"); attempt++) await page.waitForTimeout(100);
    assert.match(fs.readFileSync(path.join(created, "made.txt"), "utf8"), /saved through the menu/);
    await choose("close-editor");
    await page.waitForFunction(() => ![...document.querySelectorAll("#editor-tab-bar .editor-tab")].some(tab => tab.textContent.includes("made.txt")));
    await openFiles();
    const closed = await enabledItems();
    assert.equal(closed["save-file"], false);
    assert.equal(closed["close-editor"], false);
    pass("an open editor enables save and close, and both work");

    assert.deepEqual(errors, []);
    return { passed, shots };
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyFileMenu };
if (require.main === module) verifyFileMenu().then(result => console.log(`Verified ${result.passed.length} File menu scenarios. Screenshots: ${result.shots}`)).catch(error => { console.error(error); process.exitCode = 1; });
