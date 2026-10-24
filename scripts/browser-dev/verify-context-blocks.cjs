"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { startFakeOllama } = require("./fake-ollama.cjs");

// Runs the real app (main process, agent controller, renderer) against a
// scripted Ollama, so context-block behavior is checked end to end without a GPU.
const MODEL = "fixture-blocks:1b";

async function verifyContextBlocks() {
  const ollama = await startFakeOllama({ model: MODEL });
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.OLLAMA_HOST = ollama.url;
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# notes\n");
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    let page = await app.firstWindow();
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

    const send = async (text) => {
      const before = ollama.requests.length;
      await page.locator("#chat-input").click();
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 60000 });
      const toast = await page.locator("#chat-error-toast:not([hidden])").innerText().catch(() => "");
      assert.equal(toast, "", `no error after "${text}"`);
      assert.ok(ollama.requests.length > before, `the model was called for "${text}"`);
    };
    // The ring opens a two-row menu; "Conversation blocks" opens the block list.
    const meterRows = async () => {
      if (await page.locator("#context-usage-menu").isHidden()) await page.locator("#context-usage-btn").click();
      if (await page.locator("#context-blocks-panel").isHidden()) await page.locator("#context-blocks-trigger").click();
      await page.locator("#context-blocks-panel").waitFor();
      await page.waitForTimeout(300);
      return page.evaluate(() => [...document.querySelectorAll("#context-blocks-panel .context-block-row")].map((row) => ({
        index: Number(row.dataset.blockIndex), released: row.classList.contains("released"), pinned: row.classList.contains("pinned"), text: row.innerText.replace(/\s+/g, " "),
      })));
    };
    const closeMeter = async () => {
      if (await page.locator("#context-usage-menu").isVisible()) await page.locator("#context-usage-btn").click();
      await page.locator("#context-usage-menu").waitFor({ state: "hidden" });
    };
    const visible = (selector) => page.locator(selector).isVisible();

    await send("First question about 10.0.0.1");
    await send("Second question about 10.0.0.2");
    await send("Third question about 10.0.0.3");
    const liveHeaders = await page.evaluate(() => [...document.querySelectorAll("#messages .agent-work-header .agent-status-text")]
      .filter((text) => getComputedStyle(text).animationName !== "none").map((text) => text.textContent));
    assert.deepEqual(liveHeaders, [], "finished turns' Worked for headers do not keep the live shimmer");

    await page.locator("#context-usage-btn").click();
    await page.locator("#context-usage-menu").waitFor();
    assert.deepEqual([await visible("#context-usage-popover"), await visible("#context-blocks-panel")], [false, false], "the menu opens without a panel");
    assert.match(await page.locator("#context-window-trigger").innerText(), /Context window\s+[\d.]+K \/ 32K/);
    assert.match(await page.locator("#context-blocks-trigger").innerText(), /Conversation blocks\s+3/);
    await page.locator("#context-window-trigger").click();
    await page.locator("#context-usage-popover").waitFor();
    assert.match(await page.locator("#context-usage-breakdown").innerText(), /Active Conversation/);
    assert.equal(await page.locator("#context-usage-breakdown .context-block-row").count(), 0, "blocks are not in the window panel");
    await page.locator("#context-blocks-trigger").click();
    await page.locator("#context-blocks-panel").waitFor();
    assert.equal(await visible("#context-usage-popover"), false, "opening one panel closes the other");
    const [menuBox, panelBox] = [await page.locator("#context-usage-menu").boundingBox(), await page.locator("#context-blocks-panel").boundingBox()];
    assert.ok(panelBox.x + panelBox.width <= menuBox.x || panelBox.x >= menuBox.x + menuBox.width, "the panel opens beside the menu");
    await page.locator("#context-blocks-trigger").focus();
    await page.keyboard.press("Escape");
    await page.locator("#context-usage-menu").waitFor({ state: "hidden" });
    assert.equal(await visible("#context-blocks-panel"), false, "Escape closes the menu and its panel");
    pass("the context ring opens a two-stage menu like the model picker");

    let rows = await meterRows();
    assert.deepEqual(rows.map((row) => [row.index, row.released]), [[0, false], [1, false], [2, false]], JSON.stringify(rows));
    assert.match(rows[0].text, /First question/);
    pass("each turn becomes a numbered block in the context meter");

    await page.locator('[data-block-pin="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-block-pin="1"]')?.getAttribute("aria-pressed") === "true");
    await closeMeter();
    pass("pinning a block in the meter is stored");

    await send("RELEASE 0");
    const notice = page.locator("[data-context-release='true']");
    await notice.first().waitFor();
    assert.match(await notice.first().innerText(), /Released 1 earlier turn from context/);
    assert.equal(await notice.first().isVisible(), true, "the release notice stays visible after the turn ends");
    const noticeBeforeReply = await page.evaluate(() => {
      const exchange = [...document.querySelectorAll("#messages .chat-exchange")].at(-1);
      const releaseNotice = exchange.querySelector("[data-context-release='true']");
      const reply = [...exchange.querySelectorAll(".assistant-reply")].find((node) => node.textContent.trim().startsWith("OK"));
      return Boolean(releaseNotice && reply && (releaseNotice.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(noticeBeforeReply, true, "the release notice sits where the release happened, before the reply");
    const sawTombstone = ollama.requests.at(-1).some((message) => /^\[Block 0 released from context/.test(String(message.content)));
    assert.equal(sawTombstone, true, "the model's next request carries the tombstone");
    assert.equal(ollama.requests.at(-1).some((message) => message.content === "First question about 10.0.0.1"), false, "the released turn left the request");
    rows = await meterRows();
    assert.deepEqual(rows.filter((row) => row.released).map((row) => row.index), [0], JSON.stringify(rows));
    assert.equal(rows.find((row) => row.index === 1).pinned, true);
    await closeMeter();
    pass("a release the model asks for shows a chat notice, greys the block and shrinks the request");

    await send("RELEASE 1");
    assert.equal(await notice.count(), 1, "a pinned block is not released and no notice is added");
    const refusal = ollama.requests.at(-1).filter((message) => message.role === "tool").at(-1)?.content || "";
    assert.match(refusal, /BLOCK_PINNED/);
    rows = await meterRows();
    assert.equal(rows.find((row) => row.index === 1).released, false);
    await closeMeter();
    pass("the model cannot release a pinned block");

    await send("RECALL 0");
    const recalled = ollama.requests.at(-1).filter((message) => message.role === "tool").at(-1)?.content || "";
    assert.match(recalled, /First question about 10\.0\.0\.1/);
    pass("recall_block returns the released turn to the model");

    await page.reload();
    page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    await page.waitForFunction(() => /32K/.test(document.querySelector("#context-usage-heading-value")?.textContent || ""), null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll("#messages .chat-turn.user").length >= 6, null, { timeout: 20000 });
    const restoredNotice = page.locator("[data-context-release='true']");
    assert.equal(await restoredNotice.count(), 1, "the release notice survives structured transcript replay");
    assert.match(await restoredNotice.first().textContent(), /Released 1 earlier turn from context/);
    rows = await meterRows();
    assert.equal(rows.find((row) => row.index === 0)?.released, true, JSON.stringify(rows));
    assert.equal(rows.find((row) => row.index === 1)?.pinned, true, JSON.stringify(rows));
    pass("released and pinned state and the chat release notice survive a reload");

    const imagePath = path.resolve(__dirname, "../../tmp/context-blocks.png");
    const boxes = [await page.locator("#context-usage-menu").boundingBox(), await page.locator("#context-blocks-panel").boundingBox()];
    const x = Math.min(...boxes.map((box) => box.x)) - 8, y = Math.min(...boxes.map((box) => box.y)) - 8;
    await page.screenshot({ path: imagePath, clip: { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x + 8, height: Math.max(...boxes.map((box) => box.y + box.height)) - y + 8 } });
    await page.locator("#context-window-trigger").click();
    await page.locator("#context-usage-popover").waitFor();
    const windowBoxes = [await page.locator("#context-usage-menu").boundingBox(), await page.locator("#context-usage-popover").boundingBox()];
    const wx = Math.min(...windowBoxes.map((box) => box.x)) - 8, wy = Math.min(...windowBoxes.map((box) => box.y)) - 8;
    await page.screenshot({ path: path.resolve(__dirname, "../../tmp/context-window.png"), clip: { x: wx, y: wy, width: Math.max(...windowBoxes.map((box) => box.x + box.width)) - wx + 8, height: Math.max(...windowBoxes.map((box) => box.y + box.height)) - wy + 8 } });
    return { passed, screenshot: imagePath };
  } finally {
    try { await app?.close(); } finally { ollama.server.close(); removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyContextBlocks };
if (require.main === module) verifyContextBlocks().then(result => console.log(`Verified ${result.passed.length} context block scenarios. Screenshot: ${result.screenshot}`)).catch(error => { console.error(error); process.exitCode = 1; });
