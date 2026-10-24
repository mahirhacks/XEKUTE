"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyChatResume() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  launch.env.XEKUTE_BROWSER_DEV_OFFLINE = "1";
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "NOTES.md"), "# Resume fixture\n");
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => typeof window.api?.assessmentSettings === "function");
    await app.evaluate(({ ipcMain }) => {
      const fixture = globalThis.resumeFixture = { requests: [], active: null };
      ipcMain.removeHandler("agent:run");
      ipcMain.handle("agent:run", (event, payload) => new Promise(resolve => {
        if (fixture.active) throw new Error("An invocation overlapped the stopped writer");
        const taskId = payload.resumeTaskId || `task:fixture-${fixture.requests.length}`;
        const request = { payload, taskId, sender: event.sender, resolve: result => {
          event.sender.send("agent:event", { sessionId: payload.sessionId, type: "task_list", clear: true, source: "agent" });
          fixture.active = null;
          resolve({ ...result, taskId, runId: `run:${taskId}`, blockId: payload.blockId, memorySessionId: payload.sessionId });
        } };
        fixture.active = request;
        fixture.requests.push(request);
        if (payload.userMessageId) event.sender.send("agent:event", { type: "input_received", sessionId: payload.sessionId, messageId: payload.userMessageId });
        event.sender.send("agent:event", { type: "task_started", sessionId: payload.sessionId, taskId, runId: `run:${taskId}`, blockId: payload.blockId, memorySessionId: payload.sessionId });
      }));
      ipcMain.removeHandler("agent:cancelTask");
      ipcMain.handle("agent:cancelTask", async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        const current = fixture.active;
        current?.resolve({ ok: false, aborted: true, runState: { status: "stopped" } });
        return { ok: true, value: { taskIds: current ? [current.taskId] : [] } };
      });
    });
    await page.evaluate(async workspace => {
      localStorage.setItem("pointer:workspace", workspace);
      localStorage.setItem("pointer:bugBountyPath", workspace);
      localStorage.setItem("pointer:enabledModels", JSON.stringify(["fixture-resume:1b"]));
      localStorage.setItem("pointer:model", "fixture-resume:1b");
      const current = await window.api.assessmentSettings({ path: workspace });
      const saved = await window.api.assessmentWriteSettings({ path: workspace, settings: { ...current.settings, listener: { ...current.settings.listener, port: 0 } } });
      if (!saved.ok) throw new Error(saved.error);
    }, workspace);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#file-tree")?.textContent.includes("NOTES.md"));
    const waitRequest = index => app.evaluate(async (_electron, index) => {
      const deadline = Date.now() + 10000;
      while (globalThis.resumeFixture.requests.length <= index) {
        if (Date.now() > deadline) throw new Error("No invocation received");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const { payload, taskId } = globalThis.resumeFixture.requests[index];
      return { payload, taskId };
    }, index);
    const send = async (text, index) => {
      await page.locator("#chat-input").fill(text);
      await page.locator("#chat-input").press("Enter");
      return waitRequest(index);
    };
    const emit = (index, event) => app.evaluate((_electron, { index, event }) => {
      const request = globalThis.resumeFixture.requests[index];
      request.sender.send("agent:event", { sessionId: request.payload.sessionId, ...event });
    }, { index, event });
    const tasks = [
      { id: "inspect", title: "Inspect application", status: "completed" },
      { id: "verify", title: "Verify behavior", status: "in_progress" },
      { id: "report", title: "Report results", status: "pending" },
    ];
    const first = await send("Inspect, verify, and report the application behavior", 0);
    const startup = page.locator('#messages .agent-work-header[data-final="false"]').last();
    assert.equal(await startup.locator(".agent-status-text").textContent(), "Planning…");
    await emit(0, { type: "chat_reference_import", status: "started", titles: ["Prior investigation"] });
    await page.getByText("Bringing chats to this session...", { exact: true }).waitFor();
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await emit(0, { type: "chat_reference_import", status: "completed" });
    await page.getByText("Brought chats", { exact: true }).waitFor();
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-import-startup-ui.png") });
    await emit(0, { type: "task_list", source: "agent", tasks });
    await page.locator("#composer-task-list").waitFor({ state: "visible" });
    await page.locator("#send-btn.stop").click();
    await page.locator("#send-btn.resume").waitFor();
    await page.waitForFunction(() => !document.querySelector("#send-btn").disabled);
    await page.locator("#composer-task-list").waitFor({ state: "hidden" });
    await page.evaluate(() => window.api.flushChatHistory());
    await page.reload();
    await page.getByRole("button", { name: "Resume the stopped run", exact: true }).waitFor();
    const screenshot = path.resolve(__dirname, "../../tmp/chat-resume-button.png");
    await page.locator("#input-bar").screenshot({ path: screenshot });
    await page.getByRole("button", { name: "Resume the stopped run", exact: true }).click();
    const resumed = await waitRequest(1);
    await page.locator('#messages .agent-status-line[data-state="resuming"]').waitFor();
    assert.equal(await startup.locator(".agent-status-text").textContent(), "Resuming…");
    assert.equal(await startup.evaluate(node => getComputedStyle(node).fontSize), "14px");
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await page.locator("#messages").screenshot({ path: path.resolve(__dirname, "../../tmp/chat-resuming-ui.png") });
    assert.equal(resumed.payload.resumeTaskId, first.taskId);
    assert.equal(resumed.payload.userMessage, "");
    assert.equal(resumed.payload.userMessageId, undefined);
    assert.equal(resumed.payload.blockId, first.payload.blockId);
    assert.equal(await page.locator("#messages .chat-turn.user").count(), 1, "Resume adds no synthetic user prompt");
    await emit(1, { type: "skills_loaded", skills: ["Browser Testing"] });
    await page.locator(".agent-skill-event").waitFor();
    assert.equal(await page.locator('#messages .agent-status-line[data-state="resuming"]:visible').count(), 0);
    await emit(1, { type: "task_list", source: "agent", tasks });
    await page.locator("#composer-task-list").waitFor({ state: "visible" });
    const resumedChecklistItem = page.locator(".composer-task-list-row:visible");
    assert.equal(await resumedChecklistItem.locator(".composer-task-list-position").textContent(), "2 of 3");
    assert.equal(await resumedChecklistItem.locator(".composer-task-list-title").textContent(), tasks[1].title);
    assert.equal(await resumedChecklistItem.getAttribute("data-task-status"), "in_progress");
    await emit(1, { type: "content", delta: "Resumed verification finished." });
    await app.evaluate(() => globalThis.resumeFixture.active.resolve({ ok: true, runState: { status: "completed" } }));
    await page.waitForFunction(() => document.querySelector("#send-btn").disabled);
    assert.equal(await page.locator("#send-btn.resume").count(), 0);

    const stopped = await send("Start another investigation", 2);
    await emit(2, { type: "task_list", source: "agent", tasks });
    await page.locator("#composer-task-list").waitFor({ state: "visible" });
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await page.locator("#send-btn.stop").click();
    await page.locator("#chat-input").fill("A fresh independent request");
    assert.equal(await page.locator("#send-btn.resume").count(), 0);
    await page.locator("#chat-input").press("Enter");
    const fresh = await waitRequest(3);
    assert.equal(await startup.locator(".agent-status-text").textContent(), "Planning…");
    assert.equal(fresh.payload.resumeTaskId, undefined);
    assert.notEqual(fresh.taskId, stopped.taskId);
    assert.notEqual(fresh.payload.blockId, stopped.payload.blockId);
    assert.equal(await page.locator("#composer-task-list").isVisible(), false, "fresh work does not revive the old checklist");
    await emit(3, { type: "context_checkpoint", status: "started" });
    await page.getByText("Chat context being summarized...", { exact: true }).waitFor();
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await emit(3, { type: "context_checkpoint", status: "completed" });
    await page.getByText("Chat context summarized", { exact: true }).waitFor();
    assert.equal(await page.locator('#messages .agent-status-line[data-state="planning"]:visible').count(), 0);
    await emit(3, { type: "content", delta: "Fresh work complete." });
    await app.evaluate(() => globalThis.resumeFixture.active.resolve({ ok: true, runState: { status: "completed" } }));
    await page.waitForFunction(() => document.querySelector("#send-btn").disabled);
    await page.evaluate(() => window.api.flushChatHistory());
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Fresh work complete."));
    assert.equal(await page.locator("#send-btn.resume").count(), 0, "fresh work supersedes the stopped-run reference durably");
    console.log(JSON.stringify({ passed: true, cases: ["resume after reload", "Resuming only on explicit resume", "imports and summaries replace startup placeholders", "skills and checklist replace startup placeholders", "restore checklist", "no synthetic prompt", "fresh send while stopping"], screenshot }));
  } finally {
    try { await app?.close(); } finally { removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyChatResume };
if (require.main === module) verifyChatResume().catch(error => { console.error(error); process.exitCode = 1; });
