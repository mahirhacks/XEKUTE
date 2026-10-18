"use strict";
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Phase 5 checks on real native tabs: what the model observes, which references
// it may use, and which tabs and sessions its actions can reach.
async function verifyBrowserObservations() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app, hostPid;
  const passed = [];
  const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    app.process().stderr.on("data", data => { if (/Error|Exception/.test(String(data))) console.error(String(data)); });
    await app.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Native browser host did not initialize.");
    });
    hostPid = await app.evaluate(({ app }) => app.getAppMetrics().find(item => item.type === "Browser")?.pid);
    await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const { createNativeBrowserVisual, createNativeBrowserProvider, createBrowserActionTool, createExecutionContext, projectExecutionContext } = h.modules;
      const service = h.browser;
      const visual = createNativeBrowserVisual({ service, artifactStore: h.artifactStore });
      const provider = createNativeBrowserProvider({ getService: () => service, artifactStore: h.artifactStore, visual });
      const tool = createBrowserActionTool({ browserProvider: provider });
      const context = projectExecutionContext(createExecutionContext({ invocationId: "observe-invocation", toolName: "browser_action", role: "agent", authority: "full", workspace: h.projectA.workspace, sessionId: "runtime-chat-a", browserSessionId: "chat-a" }));
      const tab = service.list()[0];
      await service.handoff(tab.id, "chat-a", tab.controlGeneration);
      globalThis.observeTabId = tab.id;
      globalThis.observeRun = (input, tabId = tab.id) => tool.execute({ ...input, ...(input.action === "open_page" ? {} : { tabId: input.tabId || tabId }) }, context, { assertVision: async () => true });
      globalThis.observationOf = result => result.value?.evidence?.observation || result.value?.observation;
      globalThis.refFor = (observation, predicate) => {
        const element = observation.elements.find(predicate);
        if (!element) throw new Error("Missing element in " + JSON.stringify(observation.elements));
        return { kind: "element", observationId: observation.id, ref: element.ref };
      };
    });

    const rows = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const opened = await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/observe" });
      const observation = observationOf(opened);
      const deletes = observation.elements.filter(item => item.name === "Delete");
      const clicked = await observeRun({ action: "click", target: refFor(observation, item => item.name === "Delete" && /Beta/.test(item.context || "")) });
      const status = await h.browser.getContents(observeTabId).executeJavaScript("document.querySelector('#status').textContent");
      return { serialized: JSON.stringify(observation), deletes, clicked: clicked.ok, status };
    });
    assert.equal(rows.serialized.includes("fixture-hidden-token"), false, "hidden field values stay out of observations");
    assert.equal(rows.serialized.includes("Ghost action"), false, "undisplayed controls are not offered as targets");
    assert.equal(rows.deletes.length, 2);
    assert.notEqual(rows.deletes[0].ref, rows.deletes[1].ref);
    assert.match(rows.deletes[0].context, /Alpha report/); assert.match(rows.deletes[1].context, /Beta report/);
    assert.equal(rows.clicked, true); assert.equal(rows.status, "Deleted beta");
    pass("repeated labels carry their row context and the chosen reference acts on the exact row; hidden values stay out");

    const spa = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const first = observationOf(await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/spa" }));
      const alpha = refFor(first, item => item.name === "Alpha");
      const replaced = observationOf(await observeRun({ action: "click", target: refFor(first, item => item.name === "Replace results") }));
      const stale = await observeRun({ action: "click", target: alpha });
      const fresh = observationOf(stale) || observationOf(await observeRun({ action: "observe" }));
      const retried = await observeRun({ action: "click", target: refFor(fresh, item => item.name === "Alpha") });
      const status = await h.browser.getContents(observeTabId).executeJavaScript("document.querySelector('#status').textContent");
      return { replaced: Boolean(replaced), stale, freshAttached: Boolean(observationOf(stale)), retried: retried.ok, status };
    });
    assert.equal(spa.stale.ok, false); assert.equal(spa.stale.error.code, "BROWSER_OBSERVATION_STALE");
    assert.equal(spa.freshAttached, true, "a stale reference returns a fresh observation");
    assert.equal(spa.retried, true); assert.equal(spa.status, "Alpha selected at revision 1");
    pass("a single-page re-render invalidates replaced nodes and the fresh observation acts on the new node");

    const frames = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/frames" });
      let observation;
      for (let i = 0; i < 50; i++) {
        observation = observationOf(await observeRun({ action: "observe" }));
        if (observation.elements.some(item => item.name === "Activate nested frame")) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const frameButton = observation.elements.find(item => item.name === "Activate frame");
      let clicked = await observeRun({ action: "click", target: refFor(observation, item => item.name === "Activate frame") });
      // Frames can still be attaching. A shifted frame list fails closed as
      // stale, and the agent refreshes once, as the plan specifies.
      if (clicked.error?.code === "BROWSER_OBSERVATION_STALE") clicked = await observeRun({ action: "click", target: refFor(observationOf(clicked), item => item.name === "Activate frame") });
      await observeRun({ action: "wait", waitMs: 100 });
      const status = await h.browser.getContents(observeTabId).executeJavaScript("document.querySelector('#status').textContent");
      return { frames: observation.frames.length, frameId: frameButton?.frameId, nested: observation.elements.some(item => item.name === "Activate nested frame"), clicked: clicked.ok, status };
    });
    assert.ok(frames.frames >= 3); assert.notEqual(frames.frameId, "frame-0"); assert.equal(frames.nested, true);
    assert.equal(frames.clicked, true); assert.equal(frames.status, "Frame activated");
    pass("cross-origin and nested frames are observed with frame-scoped references that act inside the frame");

    const large = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const observation = observationOf(await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/large" }));
      return { truncated: observation.truncated, size: JSON.stringify(observation).length, elements: observation.elements.length, artifacts: observation.artifactIds.length };
    });
    assert.equal(large.truncated, true); assert.ok(large.size <= 16000); assert.ok(large.elements <= 80); assert.equal(large.artifacts, 1);
    pass("a large page is truncated explicitly within the observation limit and keeps the full observation as an artifact");

    const tabs = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const firstObservation = observationOf(await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/form" }));
      const opened = await observeRun({ action: "open_page", url: h.fixtures.origins.primary + "/spa" });
      const second = opened.value.evidence.tab.id;
      const crossTab = await observeRun({ action: "click", tabId: second, target: refFor(firstObservation, item => item.name === "Sign in") }, second);
      const started = Date.now();
      const waiting = observeRun({ action: "wait", waitMs: 1500 }, second);
      const navigated = await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
      const navigatedAfter = Date.now() - started;
      await waiting;
      const login = await observeRun({ action: "open_page", purpose: "assessment", identityId: "alice", url: h.fixtures.origins.primary + "/form" });
      const aliceTab = login.value.evidence.tab.id;
      let form = observationOf(await observeRun({ action: "observe" }, aliceTab));
      form = observationOf(await observeRun({ action: "type", target: refFor(form, item => item.name === "User"), text: "alice" }, aliceTab));
      form = observationOf(await observeRun({ action: "type", target: refFor(form, item => item.name === "Password"), text: "fixture-password" }, aliceTab));
      await observeRun({ action: "click", target: refFor(form, item => item.name === "Sign in") }, aliceTab);
      await observeRun({ action: "wait", waitMs: 200 }, aliceTab);
      await observeRun({ action: "navigate", url: h.fixtures.origins.primary + "/api/me" }, aliceTab);
      const research = await observeRun({ action: "open_page", purpose: "research", url: h.fixtures.origins.primary + "/api/me" });
      const forged = await observeRun({ action: "open_page", purpose: "research", identityId: "alice", url: h.fixtures.origins.primary + "/api/me" });
      const textOf = async id => h.browser.getContents(id).executeJavaScript("document.body.innerText");
      return { crossTab, navigated: navigated.ok, navigatedAfter, researchText: await textOf(research.value.evidence.tab.id), assessmentText: await textOf(aliceTab), forged };
    });
    assert.equal(tabs.crossTab.ok, false); assert.equal(tabs.crossTab.error.code, "BROWSER_OBSERVATION_STALE");
    assert.equal(tabs.navigated, true); assert.ok(tabs.navigatedAfter < 1500, `navigation waited ${tabs.navigatedAfter} ms behind another tab's wait`);
    assert.doesNotMatch(tabs.researchText, /alice/i); assert.match(tabs.assessmentText, /alice/i);
    assert.equal(tabs.forged.ok, false);
    pass("references cannot cross tabs, separate tabs progress independently, and research tabs never carry assessment identities");
    return { passed };
  } catch (error) { console.error("Browser observation verification failed:", error); throw error;
  } finally {
    try {
      if (app) {
        let timeout;
        const closed = await Promise.race([app.close().then(() => true), new Promise(resolve => { timeout = setTimeout(() => resolve(false), 5000); })]);
        clearTimeout(timeout);
        if (!closed && hostPid) await new Promise(resolve => execFile("taskkill", ["/PID", String(hostPid), "/T", "/F"], { windowsHide: true }, resolve));
      }
    }
    finally { removeDevUserData(launch.userData); }
  }
}
module.exports = { verifyBrowserObservations };
if (require.main === module) verifyBrowserObservations().then(result => console.log(`Verified ${result.passed.length} observation scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
