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

    // A reply larger than the window cannot be released (it is the live turn),
    // so the turn ends in a summary.
    await type("HUGE one");
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
    const stoppedLabels = await page.evaluate(() => {
      const exchange = [...document.querySelectorAll("#messages .chat-exchange")].at(-1);
      return [...exchange.querySelectorAll(".assistant-reply")].map((reply) => (reply.textContent.match(/\bStopped\b/g) || []).length).reduce((sum, count) => sum + count, 0);
    });
    assert.equal(stoppedLabels, 1, "a stopped reply says Stopped once");
    pass("Stop during summarization says it was interrupted and cancels the summarizer");

    holdSummaries = false;
    await type("HUGE two");
    await page.waitForFunction(() => /Chat context summarized/.test([...document.querySelectorAll("#messages .context-checkpoint-notice")].at(-1)?.innerText || ""), null, { timeout: 60000 });
    await settle();
    assert.equal(ollama.summaries.length, 2, "summarization ran again");
    assert.equal(ollama.summaries[1].answered, true);
    const second = JSON.stringify(ollama.summaries[1].body.messages);
    assert.match(second, /HUGE one/, "the second summary covers the chat from its beginning");
    assert.match(await lastNotice(), /Chat context summarized/);
    pass("the next message summarizes again from the start");

    // Forking while a run is going copies the chat up to its last finished turn.
    holdSummaries = true;
    await type("HUGE three");
    await page.waitForFunction(() => /being summarized/i.test([...document.querySelectorAll("#messages .context-checkpoint-notice")].at(-1)?.innerText || ""), null, { timeout: 60000 });
    await page.locator('[aria-label="Fork chat"]').first().click({ force: true });
    await page.waitForFunction(() => {
      const prompts = [...document.querySelectorAll("#messages .chat-turn.user")].map((node) => node.innerText);
      return prompts.some((text) => text.includes("HUGE two")) && !prompts.some((text) => text.includes("HUGE three"));
    }, null, { timeout: 15000 });
    pass("a fork during a run ends at the last finished turn");

    const imagePath = path.resolve(__dirname, "../../tmp/checkpoint-interrupt.png");
    await page.locator("#messages").screenshot({ path: imagePath });
    return { passed, screenshot: imagePath };
  } finally {
    try { await app?.close(); } finally { ollama.server.close(); removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyCheckpointInterrupt };
if (require.main === module) verifyCheckpointInterrupt().then(result => console.log(`Verified ${result.passed.length} checkpoint interruption scenarios. Screenshot: ${result.screenshot}`)).catch(error => { console.error(error); process.exitCode = 1; });
