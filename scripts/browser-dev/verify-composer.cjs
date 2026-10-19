"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Drives the chat composer with real key presses: its height must follow the
// rendered lines, and file chips must sit inside the line box of their text.
async function verifyComposer() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# notes\n");
  fs.writeFileSync(path.join(workspace, "NOTES_CONTINUATION.md"), "# more\n");
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => console.error("Renderer:", error.message));
    await page.waitForFunction(() => typeof window.api?.browserOpen === "function");
    await page.evaluate(workspace => { localStorage.setItem("pointer:workspace", workspace); localStorage.setItem("pointer:bugBountyPath", workspace); }, workspace);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    const input = page.locator("#chat-input");
    const height = () => input.evaluate(element => element.getBoundingClientRect().height);
    await input.click();
    await page.keyboard.type("hello world");
    const oneLine = await height();
    await page.keyboard.press("Shift+Enter");
    const twoLines = await height();
    assert.ok(twoLines > oneLine, `Shift+Enter grows the composer (${oneLine} -> ${twoLines})`);
    await page.keyboard.press("Backspace");
    assert.equal(await height(), oneLine);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+Enter");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    assert.equal(await height(), oneLine);
    pass("deleting new lines returns the composer to one line");
    for (let i = 0; i < 14; i++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type(`line ${i}`); }
    assert.equal(await input.evaluate(element => element.classList.contains("at-scroll-cap")), true);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    assert.equal(await height(), oneLine);
    pass("long prompts scroll at the cap and clearing restores one line");
    await page.keyboard.type("gather ");
    for (const name of ["NOTES.md", "NOTES_CONTINUATION.md"]) {
      await page.keyboard.type(`@${name.slice(0, -3)}`);
      await page.locator(".file-tag-suggestions:not([hidden])").waitFor();
      await page.keyboard.press("Enter");
      await page.keyboard.type("and ");
    }
    const boxes = await input.evaluate(element => {
      const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.data.includes("and"));
      const range = document.createRange(); range.selectNodeContents(text);
      return { text: range.getClientRects()[0].toJSON(), chips: [...element.querySelectorAll(".file-tag-chip")].map(chip => chip.getBoundingClientRect().toJSON()) };
    });
    assert.equal(boxes.chips.length, 2);
    for (const chip of boxes.chips) {
      assert.ok(Math.abs(chip.bottom - boxes.text.bottom) <= 1, `chip bottom ${chip.bottom} matches text bottom ${boxes.text.bottom}`);
      assert.ok(chip.height <= boxes.text.height + 1, `chip height ${chip.height} fits the text height ${boxes.text.height}`);
    }
    assert.equal(await height(), oneLine);
    pass("file chips align with their text and keep the line height");
    const imagePath = path.resolve(__dirname, "../../tmp/composer.png");
    await page.locator(".composer").screenshot({ path: imagePath });
    return { passed, screenshot: imagePath };
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyComposer };
if (require.main === module) verifyComposer().then(result => console.log(`Verified ${result.passed.length} composer scenarios. Screenshot: ${result.screenshot}`)).catch(error => { console.error(error); process.exitCode = 1; });
