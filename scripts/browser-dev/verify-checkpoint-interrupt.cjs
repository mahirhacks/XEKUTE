"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { startFakeOllama } = require("./fake-ollama.cjs");

// Stopping a run while the chat is being summarized: the app says the
// summarization was interrupted, the summarizer request is cancelled, nothing
// is kept, and the next message summarizes again from the start.
const MODEL = "fixture-checkpoint:1b";

async function verifyCheckpointInterrupt() {
  // The first summarizer request is held open until the app cancels it.
  let holdSummaries = true;
  const ollama = await startFakeOllama({
    model: MODEL,
    summarize: (entry) => (holdSummaries ? new Promise(() => {}) : Promise.resolve({ grounded_facts: [] })),
  });
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

    const notices = page.locator("#messages .context-checkpoint-notice:not([data-context-release='true'])");
    const lastNotice = () => notices.last().innerText().then((text) => text.trim()).catch(() => "");
    const type = async (text) => {
      await page.locator("#chat-input").click();
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
    };
    const settle = () => page.waitForFunction(() => !document.querySelector("#send-btn")?.classList.contains("stop"), null, { timeout: 90000 });

    // Pinned turns cannot be released, so pinning every turn so far makes a
    // summary the only way to fit the next one.
    const pinAll = async () => {
      await page.locator("#context-usage-btn").click();
      await page.locator("#context-blocks-trigger").click();
      const unpinned = await page.locator("#context-blocks-panel [data-block-pin][aria-pressed='false']").evaluateAll((pins) => pins.map((pin) => pin.dataset.blockPin));
      for (const index of unpinned) {
        await page.locator(`[data-block-pin="${index}"]`).click();
        await page.waitForFunction((index) => document.querySelector(`[data-block-pin="${index}"]`)?.getAttribute("aria-pressed") === "true", index);
      }
      await page.locator("#context-usage-btn").click();
      return unpinned;
    };

    // Two long replies plus a third push the chat past the summary line.
    await type("BIG one");
    await settle();
    await type("BIG two");
    await settle();
    assert.equal(ollama.summaries.length, 0, "no summary yet");
    assert.ok((await pinAll()).length >= 2, "the earlier turns are pinned");
    await type("BIG three");
    await page.waitForFunction(() => /being summarized/i.test([...document.querySelectorAll("#messages .context-checkpoint-notice")].at(-1)?.innerText || ""), null, { timeout: 60000 });
    for (let i = 0; i < 100 && !ollama.summaries.length; i += 1) await page.waitForTimeout(50);
    assert.equal(ollama.summaries.length, 1, "the summarizer was called");
    pass("a long chat starts summarizing and shows the in-progress notice");

    await page.locator("#send-btn.stop").click();
    await settle();
    await page.waitForFunction(() => /Chat summarization interrupted/.test([...document.querySelectorAll("#messages .context-checkpoint-notice")].at(-1)?.innerText || ""), null, { timeout: 15000 });
    for (let i = 0; i < 100 && !ollama.summaries[0].aborted; i += 1) await page.waitForTimeout(50);
    assert.equal(ollama.summaries[0].aborted, true, "the summarizer request was cancelled");
    assert.equal(ollama.summaries[0].answered, false);
    assert.equal(await page.locator("#chat-error-toast:not([hidden])").count(), 0, "a stop is not reported as an error");
    pass("Stop during summarization says it was interrupted and cancels the summarizer");

    // Pin the stopped turn too, so the next message still needs a summary.
    await pinAll();
    holdSummaries = false;
    await type("continue");
    await page.waitForFunction(() => /Chat context summarized/.test([...document.querySelectorAll("#messages .context-checkpoint-notice")].at(-1)?.innerText || ""), null, { timeout: 60000 });
    await settle();
    assert.equal(ollama.summaries.length, 2, "summarization ran again");
    assert.equal(ollama.summaries[1].answered, true);
    const second = JSON.stringify(ollama.summaries[1].body.messages);
    assert.match(second, /BIG one/, "the second summary starts from the beginning of the chat");
    assert.match(await lastNotice(), /Chat context summarized/);
    pass("the next message summarizes again from the start");

    const imagePath = path.resolve(__dirname, "../../tmp/checkpoint-interrupt.png");
    await page.locator("#messages").screenshot({ path: imagePath });
    return { passed, screenshot: imagePath };
  } finally {
    try { await app?.close(); } finally { ollama.server.close(); removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyCheckpointInterrupt };
if (require.main === module) verifyCheckpointInterrupt().then(result => console.log(`Verified ${result.passed.length} checkpoint interruption scenarios. Screenshot: ${result.screenshot}`)).catch(error => { console.error(error); process.exitCode = 1; });
