"use strict";
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

async function verifyBrowserAgent() {
  const launch = createDevLaunch({ native: true, smoke: true });
  let app, hostPid;
  const passed = [];
  const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    // The verifier's independent observer must not dismiss the dialogs owned
    // by the application-side browser adapter.
    app.context().on("dialog", () => {});
    app.process().stderr.on("data", data => { if (/Error|Exception/.test(String(data))) console.error(String(data)); });
    app.process().stdout.on("data", data => process.stdout.write(data));
    console.log("Browser agent host launched.");
    // An evaluation that settles while the host is still starting can lose its
    // promise, so the first call waits for the host to finish initializing.
    await app.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Native browser host did not initialize.");
    });
    hostPid = await app.evaluate(({ app }) => app.getAppMetrics().find(item => item.type === "Browser")?.pid);
    console.log("Browser agent host initialized.");
    await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const { createNativeBrowserVisual, createNativeBrowserProvider, createBrowserActionTool, createExecutionContext, projectExecutionContext } = h.modules;
      const service = h.browser;
      globalThis.browserVisual = createNativeBrowserVisual({ service, artifactStore: h.artifactStore });
      globalThis.browserProvider = createNativeBrowserProvider({ getService: () => service, artifactStore: h.artifactStore, visual: globalThis.browserVisual });
      globalThis.browserTool = createBrowserActionTool({ browserProvider: globalThis.browserProvider });
      globalThis.browserContext = projectExecutionContext(createExecutionContext({ invocationId: "fixture-invocation", toolName: "browser_action", role: "agent", authority: "full", workspace: h.projectA.workspace, sessionId: "runtime-chat-a", browserSessionId: "chat-a" }));
      const tab = service.list()[0];
      await service.handoff(tab.id, "chat-a", tab.controlGeneration);
      globalThis.browserTabId = tab.id;
      globalThis.browserRun = async input => { console.log("Browser tool starting", input.action); const result = await globalThis.browserTool.execute({ ...input, tabId: input.tabId || tab.id }, globalThis.browserContext, { assertVision: async () => true }); console.log("Browser tool finished", input.action, result.ok, result.error?.message || ""); return result; };
    });
    const structural = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      let result = await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/form" });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const ref = name => { const observation = result.value.evidence.observation; const element = observation.elements.find(item => item.name === name); if (!element) throw new Error("Missing " + name + JSON.stringify(observation)); return { kind: "element", observationId: observation.id, ref: element.ref }; };
      result = await browserRun({ action: "type", target: ref("User"), text: "Alice" });
      result = await browserRun({ action: "type", target: ref("Password"), text: "fixture-secret-password" });
      if (JSON.stringify(result).includes("fixture-secret-password")) throw new Error("Password leaked into observation");
      result = await browserRun({ action: "click", target: ref("Sign in") });
      await browserRun({ action: "wait", waitMs: 100 });
      return { result: await browserRun({ action: "observe" }), text: await h.browser.getContents(browserTabId).executeJavaScript("document.querySelector('#status').textContent") };
    });
    assert.equal(structural.text, "Signed in as Alice (user)"); assert.equal(structural.result.ok, true);
    pass("model-facing function tool completes a native structural form with exact references and no secret values");
    const visual = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
      const captured = await browserRun({ action: "screenshot" });
      if (!captured.ok) throw new Error(JSON.stringify(captured));
      const screenshot = captured.value.evidence.screenshot;
      const box = await service.getContents(browserTabId).executeJavaScript("(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()");
      const target = { kind: "point", screenshotId: screenshot.id, x: Math.floor(box.x * screenshot.pixelWidth / screenshot.viewportWidth), y: Math.floor(box.y * screenshot.pixelHeight / screenshot.viewportHeight) };
      const clicked = await browserRun({ action: "click", target });
      const pointer = await service.getContents(browserTabId).executeJavaScriptInIsolatedWorld(1007, [{ code: "({visible:__xekutePointer.host.style.visibility,x:parseFloat(__xekutePointer.cursor.style.left),y:parseFloat(__xekutePointer.cursor.style.top),intercepts:getComputedStyle(__xekutePointer.host).pointerEvents})" }]);
      const text = await service.getContents(browserTabId).executeJavaScript("document.querySelector('#status').textContent");
      const stale = await browserRun({ action: "click", target });
      return { screenshot, clicked, pointer, text, stale, captured };
    });
    assert.equal(visual.clicked.ok, true); assert.equal(visual.text, "Canvas activated");
    assert.equal(visual.pointer.visible, "visible"); assert.equal(visual.pointer.intercepts, "none");
    assert.equal(visual.stale.ok, false); assert.equal(visual.stale.error.code, "BROWSER_OBSERVATION_STALE");
    pass("screenshot-bound canvas input paints an independent pointer and rejects changed-page reuse");
    const scaled = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      const results = [];
      for (const zoom of [0.8, 1.5]) {
        service.getContents(browserTabId).setZoomFactor(zoom);
        await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
        const capture = await browserRun({ action: "screenshot" });
        if (!capture.ok) throw new Error(JSON.stringify(capture));
        const s = capture.value.evidence.screenshot;
        const p = await service.getContents(browserTabId).executeJavaScript("(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()");
        const clicked = await browserRun({ action: "click", target: { kind: "point", screenshotId: s.id, x: Math.floor(p.x*s.pixelWidth/s.viewportWidth), y: Math.floor(p.y*s.pixelHeight/s.viewportHeight) } });
        results.push({ ok: clicked.ok, text: await service.getContents(browserTabId).executeJavaScript("document.querySelector('#status').textContent"), zoom: s.zoomFactor });
      }
      service.getContents(browserTabId).setZoomFactor(1);
      return results;
    });
    for (const result of scaled) { assert.equal(result.ok, true); assert.equal(result.text, "Canvas activated"); }
    pass("visual coordinates hit the real canvas at 80% and 150% page zoom");
    const drag = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
      await h.window.webContents.executeJavaScript("document.body.innerHTML='<textarea id=steering></textarea>';document.querySelector('textarea').focus()");
      const captured = await browserRun({ action: "screenshot" });
      const shot = captured.value.evidence.screenshot;
      const boxes = await service.getContents(browserTabId).executeJavaScript("['#drag-source','#drop-target'].map(s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})");
      const targets = boxes.map(p => ({ kind: "point", screenshotId: shot.id, x: Math.floor(p.x*shot.pixelWidth/shot.viewportWidth), y: Math.floor(p.y*shot.pixelHeight/shot.viewportHeight) }));
      const result = await browserRun({ action: "drag", from: targets[0], to: targets[1] });
      const text = await service.getContents(browserTabId).executeJavaScript("document.querySelector('#drag-status').textContent");
      const focus = await h.window.webContents.executeJavaScript("document.activeElement.id");
      await h.modules.fs.mkdir(h.modules.path.join(process.cwd(), "tmp"), { recursive: true });
      await h.modules.fs.writeFile(h.modules.path.join(process.cwd(), "tmp/browser-pointer.png"), (await service.getContents(browserTabId).capturePage(undefined, { stayHidden: true })).toPNG());
      const fresh = await browserRun({ action: "screenshot" });
      const a = await h.artifactStore.read({ projectId: h.projectA.id, artifactId: fresh.value.evidence.screenshot.artifactId });
      const moved = await browserRun({ action: "move", target: { kind: "point", screenshotId: fresh.value.evidence.screenshot.id, x: 20, y: 20 } });
      const second = await browserRun({ action: "screenshot" });
      const b = await h.artifactStore.read({ projectId: h.projectA.id, artifactId: second.value.evidence.screenshot.artifactId });
      return { result, text, focus, clean: a.data.equals(b.data), moved };
    });
    assert.equal(drag.result.ok, true); assert.equal(drag.text, "Item dropped"); assert.equal(drag.focus, "steering"); assert.equal(drag.clean, true);
    pass("coordinate drag changes the real page without stealing chat focus, and screenshots exclude the pointer");
    const invalid = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
      const capture = await browserRun({ action: "screenshot" }), s = capture.value.evidence.screenshot;
      const outside = await browserRun({ action: "click", target: { kind: "point", screenshotId: s.id, x: s.pixelWidth, y: 0 } });
      await service.getContents(browserTabId).executeJavaScript("document.body.style.minHeight='2200px';scrollTo(0,200)");
      const scrolled = await browserRun({ action: "click", target: { kind: "point", screenshotId: s.id, x: 10, y: 10 } });
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/canvas" });
      h.window.setContentSize(1800, 1100); service.layout(browserTabId, { x: 0, y: 0, width: 1800, height: 1050 });
      const large = await browserRun({ action: "screenshot" });
      const resized = large.value?.evidence?.screenshot;
      h.window.setContentSize(1150, 850); service.layout(browserTabId, { x: 0, y: 0, width: 1150, height: 800 });
      const staleResize = resized && await browserRun({ action: "move", target: { kind: "point", screenshotId: resized.id, x: 10, y: 10 } });
      return { outside, scrolled, large, resized, staleResize };
    });
    assert.equal(invalid.outside.ok, false); assert.equal(invalid.scrolled.error.code, "BROWSER_OBSERVATION_STALE");
    assert.equal(invalid.large.ok, true); assert.ok(Math.max(invalid.resized.pixelWidth, invalid.resized.pixelHeight) <= 1600);
    assert.equal(invalid.staleResize.error.code, "BROWSER_OBSERVATION_STALE");
    pass("coordinate bounds, changed scroll, resized screenshots, and stale viewport mappings are enforced");
    const transfers = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const { fs, path } = h.modules;
      await fs.writeFile(path.join(h.projectA.workspace, "upload.txt"), "fixture upload");
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/files" });
      const upload = await browserRun({ action: "upload", selector: "#file", paths: ["upload.txt"] });
      await browserRun({ action: "click", selector: "#upload button" });
      await browserRun({ action: "wait", waitMs: 100 });
      const text = await h.browser.getContents(browserTabId).executeJavaScript("document.querySelector('#status').textContent");
      await browserRun({ action: "click", selector: "#download" });
      for (let i = 0; i < 100 && !h.browser.listDownloads(browserTabId).some(item => item.status === "completed"); i++) await new Promise(resolve => setTimeout(resolve, 20));
      const download = h.browser.listDownloads(browserTabId)[0];
      const refused = [];
      for (const rule of [{ blocked: true }, { maxBytes: 10 }]) {
        h.downloadRule = rule;
        const before = h.browser.listDownloads(browserTabId).length;
        await browserRun({ action: "click", selector: "#download" });
        for (let i = 0; i < 100 && !(h.browser.listDownloads(browserTabId).length > before && h.browser.listDownloads(browserTabId).at(-1).status !== "running"); i++) await new Promise(resolve => setTimeout(resolve, 20));
        refused.push(h.browser.listDownloads(browserTabId).at(-1));
      }
      h.downloadRule = null;
      return { upload, text, download, refused, data: download?.artifactId ? (await h.artifactStore.read({ projectId: h.projectA.id, artifactId: download.artifactId })).data.toString() : null };
    });
    assert.equal(transfers.upload.ok, true); assert.match(transfers.text, /^Uploaded upload.txt/);
    assert.equal(transfers.download.status, "completed"); assert.equal(transfers.data, "Xekute browser fixture download.\n");
    assert.deepEqual(transfers.refused.map(item => [item.status, item.artifactId]), [["failed", null], ["failed", null]]);
    assert.equal(transfers.refused[0].error.code, "BROWSER_DOWNLOAD_BLOCKED");
    pass("project file upload and native download produce real contents and protected artifacts; blocked and oversized downloads store nothing");
    const dialogs = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      await browserRun({ action: "navigate", url: h.fixtures.origins.primary + "/dialogs" });
      const opened = await browserRun({ action: "click", selector: "#confirm" });
      console.log("Dialog after click", JSON.stringify(opened), JSON.stringify(h.browser.getDialog(browserTabId)));
      const handled = await browserRun({ action: "handle_dialog", accept: true });
      const observed = await browserRun({ action: "observe" });
      return { opened, handled, observed, text: await h.browser.getContents(browserTabId).executeJavaScript("document.querySelector('#status').textContent") };
    });
    assert.equal(dialogs.opened.ok, true); assert.equal(dialogs.opened.value.evidence.dialog.type, "confirm");
    assert.equal(dialogs.handled.ok, true); assert.equal(dialogs.text, "Confirmed");
    pass("managed confirmation survives tool leases and resolves on an explicit dialog action");
    const stopped = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      const tab = service.list().find(item => item.id === browserTabId);
      const pending = browserRun({ action: "wait", waitMs: 10000 });
      for (let i = 0; i < 100 && service.list().find(item => item.id === tab.id).operation.status !== "running"; i++) await new Promise(resolve => setTimeout(resolve, 10));
      await service.takeover(tab.id, tab.controlGeneration);
      const result = await pending;
      const human = service.list().find(item => item.id === tab.id);
      const resumed = await service.handoff(tab.id, "chat-a", human.controlGeneration);
      return { result, human, resumed, observed: await browserRun({ action: "observe" }) };
    });
    assert.equal(stopped.result.ok, false); assert.equal(stopped.human.owner.kind, "human"); assert.equal(stopped.observed.ok, true);
    pass("takeover stops a tool wait and resume retains the same native page");
    const loop = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      return h.modules.runBrowserLoopFixture({ service: h.browser, provider: browserProvider, fixtures: h.fixtures, workspace: h.projectA.workspace, tabId: browserTabId });
    });
    assert.equal(loop.completed.ok, true); assert.equal(loop.steering.applied, true); assert.equal(loop.steering.role, "admin");
    assert.equal(loop.stopped.modelCalls, 1); assert.ok(loop.stopped.elapsedMs < 5000);
    pass("the actual agent loop consumes observations, applies steering, and stops native work without another model round");
    return { passed };
  } catch (error) { console.error("Browser agent verification failed:", error); throw error;
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
module.exports = { verifyBrowserAgent };
if (require.main === module) verifyBrowserAgent().then(result => console.log(`Verified ${result.passed.length} agent browser scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
