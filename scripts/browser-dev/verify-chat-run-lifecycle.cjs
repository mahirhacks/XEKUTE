"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyChatRunLifecycle() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# Local rendering fixture\n");
  let app;
  const passed = [];
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => typeof window.api?.assessmentSettings === "function");
    await app.evaluate(({ ipcMain }) => {
      globalThis.chatRunFixture = [];
      ipcMain.removeHandler("agent:run");
      ipcMain.handle("agent:run", (event, payload) => new Promise(resolve => {
        event.sender.send("agent:event", { type: "input_received", sessionId: payload.sessionId, messageId: payload.userMessageId });
        globalThis.chatRunFixture.push({ sender: event.sender, payload, resolve });
      }));
    });
    await page.evaluate(async workspace => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      localStorage.setItem("pointer:enabledModels", JSON.stringify(["fixture-rendering:1b"]));
      localStorage.setItem("pointer:model", "fixture-rendering:1b");
      const current = await window.api.assessmentSettings({ path: workspace });
      const saved = await window.api.assessmentWriteSettings({ path: workspace, settings: { ...current.settings, listener: { ...current.settings.listener, port: 0 } } });
      if (!saved.ok) throw new Error(saved.error);
    }, workspace);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    const send = async (text, index) => {
      await page.locator("#chat-input").fill(text);
      await page.locator("#chat-input").press("Enter");
      await app.evaluate(async (_electron, index) => {
        const deadline = Date.now() + 10000;
        while (globalThis.chatRunFixture.length <= index) {
          if (Date.now() > deadline) throw new Error("Fixture did not receive the main prompt");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }, index);
      assert.equal(await app.evaluate((_electron, index) => globalThis.chatRunFixture[index].payload.userMessage, index), text);
    };
    const emit = (index, payload) => app.evaluate((_electron, { index, payload }) => {
      const run = globalThis.chatRunFixture[index];
      run.sender.send("agent:event", { sessionId: run.payload.sessionId, ...payload });
    }, { index, payload });
    const finish = (index, result) => app.evaluate((_electron, { index, result }) => globalThis.chatRunFixture[index].resolve(result), { index, result });
    const settled = () => page.waitForFunction(() => !document.querySelector("#send-btn")?.classList.contains("stop"));

    for (const [scenario, hold] of [
      ["delegated work", { orchestrationHold: true }],
      ["background command", { commandWait: true, waitingProcessIds: [] }],
      ["operator stop", { orchestrationHold: true }],
    ]) {
      const index = passed.length * 2;
      await send(`Start ${scenario}`, index);
      if (index === 0) {
        const planning = page.locator('#messages .agent-status-line[data-state="planning"]').last();
        assert.equal(await planning.locator(".agent-status-text").textContent(), "Planning…");
        assert.equal(await planning.evaluate(node => getComputedStyle(node).fontSize), "14px");
        await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-planning-ui.png") });
        const parentSessionId = await app.evaluate((_electron, index) => globalThis.chatRunFixture[index].payload.sessionId, index);
        const child = { parentSessionId, childSessionId: "fixture-child", childInvocationId: "fixture-invocation", model: "fixture-rendering:1b", task: "Inspect the local fixture" };
        await emit(index, { type: "subagent_started", ...child });
        const pause = page.locator(".subagent-run-stop:visible");
        await pause.waitFor();
        assert.deepEqual(await pause.locator("rect").evaluateAll(nodes => nodes.map(node => ({ width: node.getAttribute("width"), height: node.getAttribute("height") }))), [{ width: "3", height: "10" }, { width: "3", height: "10" }]);
        await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-pause-ui.png") });
        await emit(index, { type: "subagent_completed", ...child });
        await pause.waitFor({ state: "hidden" });
      }
      await emit(index, { type: "model_start" });
      await emit(index, { type: "thinking", token: `Earlier reasoning for ${scenario}.` });
      await emit(index, { type: "content", delta: `Earlier answer for ${scenario}.` });
      await finish(index, { ok: true, ...hold });
      await page.waitForFunction(() => [...document.querySelectorAll("#messages > .chat-exchange")].at(-1)?.querySelector('.agent-thinking-fold[data-final="true"]'));
      if (scenario === "operator stop") {
        await page.locator("#send-btn.stop").click();
      } else {
        if (scenario === "delegated work") {
          await emit(index, { source: "parent_continuation", type: "content", delta: " Delegated result reviewed." });
          await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Delegated result reviewed."));
        }
        await emit(index, { type: "parent_run_settled", orchestrationHold: false, pendingEndTurn: false, commandWait: false });
      }
      await settled();
      const previousId = `previous-${index}`;
      await page.locator("#messages > .chat-exchange").last().evaluate((node, id) => { node.dataset.runFixture = id; }, previousId);
      const previous = page.locator(`[data-run-fixture="${previousId}"]`);
      const previousText = await previous.textContent();

      await send(`New main prompt after ${scenario}`, index + 1);
      assert.equal(await page.locator("#messages > .chat-exchange").count(), index + 2, "a new main prompt starts its own exchange");
      const newReasoning = `Fresh reasoning after ${scenario}.`;
      const newAnswer = `Fresh answer after ${scenario}.`;
      await emit(index + 1, { type: "model_start" });
      await emit(index + 1, { type: "thinking", token: newReasoning });
      await emit(index + 1, { type: "content", delta: newAnswer });
      await finish(index + 1, { ok: true });
      await settled();
      assert.equal(await previous.textContent(), previousText, `${scenario}: the finished exchange must not receive the new response`);
      const current = page.locator("#messages > .chat-exchange").last();
      assert.equal((await current.locator(".agent-thinking-content").textContent()).trim(), newReasoning);
      assert.equal((await current.locator(".assistant-reply").textContent()).trim(), newAnswer);
      const occurrences = await page.locator("#messages").evaluate((node, text) => node.textContent.split(text).length - 1, newReasoning);
      assert.equal(occurrences, 1, `${scenario}: reasoning streams in exactly one place`);
      assert.equal(await app.evaluate((_electron, { index }) => globalThis.chatRunFixture[index].payload.sessionId === globalThis.chatRunFixture[index + 1].payload.sessionId, { index }), true);
      passed.push(scenario);
      console.log(`PASS new main prompt after ${scenario}`);
    }
    await page.evaluate(() => window.api.flushChatHistory());
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Fresh answer after operator stop."));
    assert.equal(await page.locator("#messages > .chat-exchange").count(), 6);
    for (const scenario of passed) {
      assert.equal(await page.locator("#messages").evaluate((node, text) => node.textContent.split(text).length - 1, `Fresh answer after ${scenario}.`), 1, "restoring the chat preserves each response once");
    }
    const screenshot = path.resolve(__dirname, "../../tmp/chat-run-lifecycle.png");
    await page.locator("#messages").screenshot({ path: screenshot });
    return { passed, screenshot };
  } catch (error) {
    const requests = await app?.evaluate(() => globalThis.chatRunFixture?.map(run => ({ message: run.payload.userMessage, internal: run.payload.internalRuntimeInput })));
    const page = (await app?.windows())?.[0];
    if (page) {
      await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-run-lifecycle-failure.png") });
      console.error(JSON.stringify({ requests, transcript: await page.locator("#messages").textContent() }));
    }
    throw error;
  } finally {
    try { await app?.close(); } finally { removeDevUserData(launch.userData); }
  }
}

module.exports = { verifyChatRunLifecycle };
if (require.main === module) verifyChatRunLifecycle().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
