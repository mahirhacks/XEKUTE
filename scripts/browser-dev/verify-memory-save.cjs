"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { startFakeOllama } = require("./fake-ollama.cjs");

// When the chat's memory folder cannot be written, a closeable gray banner says
// so above the composer; once saving works again it goes away by itself.
const MODEL = "fixture-save:1b";

function sessionDirs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (path.basename(dir) === "sessions" && entry.name.startsWith("session_")) found.push(full);
      else walk(full);
    }
  };
  walk(root);
  return found;
}

async function verifyMemorySave() {
  const ollama = await startFakeOllama({ model: MODEL });
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.OLLAMA_HOST = ollama.url;
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# notes\n");
  let app;
  const blocked = [];
  const blockedDirs = [];
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => console.error("Renderer:", error.message));
    await page.waitForFunction(() => typeof window.api?.browserOpen === "function");
    await page.evaluate(([workspace, model]) => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      localStorage.setItem("pointer:enabledModels", JSON.stringify([model]));
      localStorage.setItem("pointer:model", model);
    }, [workspace, MODEL]);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    await page.waitForFunction(() => /32K/.test(document.querySelector("#context-usage-heading-value")?.textContent || ""), null, { timeout: 20000 });
    const banner = page.locator("#memory-save-banner");
    const send = async (text) => {
      await page.locator("#chat-input").click();
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 60000 });
    };

    await send("First question");
    assert.equal(await banner.isVisible(), false, "no banner while memory saves");
    const dirs = sessionDirs(launch.userData);
    assert.ok(dirs.length > 0, "the chat's memory folder exists");
    // A folder where the saved ledger file should be makes every ledger save
    // fail, while the chat transcript and the input queue beside it still save.
    for (const dir of dirs) {
      const ledger = path.join(dir, "active.enc.json");
      fs.renameSync(ledger, `${ledger}.moved`);
      fs.mkdirSync(path.join(ledger, "blocked"), { recursive: true });
      blocked.push(ledger);
    }
    await send("Second question");
    await banner.waitFor();
    assert.match(await banner.innerText(), /^Memory can't be saved because .+\. This chat will lose its earlier context if you restart the app\.$/);
    const colors = await banner.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
    assert.deepEqual(colors, { background: "rgb(31, 31, 31)", color: "rgb(212, 212, 212)" }, "a neutral gray banner");
    await page.locator("#input-bar").screenshot({ path: path.resolve(__dirname, "../../tmp/memory-save.png") });
    pass("a failed save shows the gray banner above the composer");

    await page.locator(".memory-save-banner-close").click();
    assert.equal(await banner.isVisible(), false);
    await send("Third question");
    assert.equal(await banner.isVisible(), false, "a closed banner stays closed for the same failure");
    pass("the banner can be closed");

    for (const ledger of blocked.splice(0)) {
      fs.rmSync(ledger, { recursive: true, force: true });
      fs.renameSync(`${ledger}.moved`, ledger);
    }
    await send("Fourth question");
    assert.equal(await banner.isVisible(), false);
    const recovered = await page.evaluate(() => document.querySelector("#memory-save-banner")?.hidden);
    assert.equal(recovered, true, "saving works again and the banner is gone");
    pass("the banner clears once memory saves again");

    // A chat folder that cannot be written at all refuses the message with a
    // plain reason, never a file path, and raises the same banner.
    for (const dir of dirs) {
      fs.renameSync(dir, `${dir}.moved`);
      fs.writeFileSync(dir, "blocked");
      blockedDirs.push(dir);
    }
    await page.locator("#chat-input").click();
    await page.keyboard.type("Fifth question");
    await page.keyboard.press("Enter");
    const toast = page.locator("#chat-error-toast:not([hidden])");
    await toast.waitFor();
    const refusal = await toast.innerText();
    assert.match(refusal, /^This message could not be saved because .+, then try again\.$/);
    assert.equal(/[A-Za-z]:\\|xekute-browser-dev|enc\.json/.test(refusal), false, `no file path in "${refusal}"`);
    await banner.waitFor();
    for (const dir of blockedDirs.splice(0)) {
      fs.rmSync(dir, { force: true });
      fs.renameSync(`${dir}.moved`, dir);
    }
    await page.waitForFunction(() => !document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 30000 });
    await send("Sixth question");
    assert.equal(await banner.isVisible(), false, "once the folder is writable the banner clears");
    pass("an unwritable chat folder refuses the message plainly and shows the banner");

    const imagePath = path.resolve(__dirname, "../../tmp/memory-save.png");
    return { passed, screenshot: imagePath };
  } finally {
    for (const ledger of blocked) { try { fs.rmSync(ledger, { recursive: true, force: true }); fs.renameSync(`${ledger}.moved`, ledger); } catch { /* best effort */ } }
    for (const dir of blockedDirs) { try { fs.rmSync(dir, { force: true }); fs.renameSync(`${dir}.moved`, dir); } catch { /* best effort */ } }
    try { await app?.close(); } finally { ollama.server.close(); removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyMemorySave };
if (require.main === module) verifyMemorySave().then(result => console.log(`Verified ${result.passed.length} memory save scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
