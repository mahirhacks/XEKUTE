"use strict";
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Phase 7 checks on real native tabs: one agent run that moves between
// structural and visual control, and a human taking over mid-drag.
async function verifyHybridBrowsing() {
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
      const { createNativeBrowserVisual, createNativeBrowserProvider, createBrowserActionTool, createExecutionContext, projectExecutionContext, renderBrowserPointer } = h.modules;
      const service = h.browser;
      globalThis.hybridVisual = createNativeBrowserVisual({ service, artifactStore: h.artifactStore });
      globalThis.hybridProvider = createNativeBrowserProvider({ getService: () => service, artifactStore: h.artifactStore, visual: hybridVisual });
      const tool = createBrowserActionTool({ browserProvider: hybridProvider });
      const context = projectExecutionContext(createExecutionContext({ invocationId: "hybrid-invocation", toolName: "browser_action", role: "agent", authority: "full", workspace: h.projectA.workspace, sessionId: "runtime-chat-a", browserSessionId: "chat-a" }));
      const tab = service.list()[0];
      globalThis.hybridTabId = tab.id;
      globalThis.hybridRun = input => tool.execute({ ...input, tabId: tab.id }, context, { assertVision: async () => true });
      // Input painting runs just before each protocol mouse event. The hook lets
      // the verifier act at an exact point inside a drag.
      globalThis.pointerHook = null;
      service.setPointerRenderer(async (contents, point, phase) => { await renderBrowserPointer(contents, point, phase); await globalThis.pointerHook?.(phase); });
    });

    const hybrid = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      return h.modules.runHybridBrowserLoopFixture({ service: h.browser, provider: hybridProvider, fixtures: h.fixtures, workspace: h.projectA.workspace, tabId: hybridTabId });
    });
    console.log("Hybrid sequence:", hybrid.sequence.join(" > "));
    assert.deepEqual(hybrid.sequence.filter(step => step !== "observe:"), ["navigate:", "type:element", "click:element", "screenshot:", "click:point", "type:element", "click:element"]);
    assert.equal(hybrid.status, "Order Hybrid-42 confirmed with note leave at the side door");
    pass("one agent run moves from structure to a screenshot-bound canvas click and back to structure, with steering sent during the visual action");

    const takeover = await app.evaluate(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.browser;
      const tab = service.list().find(item => item.id === hybridTabId);
      await service.handoff(tab.id, "chat-a", tab.controlGeneration);
      await hybridRun({ action: "navigate", url: h.fixtures.origins.primary + "/hybrid" });
      await service.getContents(hybridTabId).executeJavaScript("document.querySelector('#order').value='kept-across-takeover'");
      const shot = (await hybridRun({ action: "screenshot" })).value.evidence.screenshot;
      const centers = await service.getContents(hybridTabId).executeJavaScript("['#handle','#dock'].map(s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})");
      const point = p => ({ kind: "point", screenshotId: shot.id, x: Math.floor(p.x * shot.pixelWidth / shot.viewportWidth), y: Math.floor(p.y * shot.pixelHeight / shot.viewportHeight) });
      let pressed = false, moves = 0, takeoverDone = null;
      globalThis.pointerHook = phase => {
        if (phase === "down") pressed = true;
        else if (phase === "move" && pressed && ++moves === 3 && !takeoverDone) {
          const live = service.list().find(item => item.id === hybridTabId);
          takeoverDone = service.takeover(hybridTabId, live.controlGeneration);
        }
      };
      const dragged = await hybridRun({ action: "drag", from: point(centers[0]), to: point(centers[1]) });
      globalThis.pointerHook = null;
      const human = await takeoverDone;
      const read = selector => service.getContents(hybridTabId).executeJavaScript(`document.querySelector('${selector}').${selector === "#order" ? "value" : "textContent"}`);
      const afterTakeover = { pointer: await read("#pointer"), docked: await read("#docked"), order: await read("#order") };
      const resumed = await service.handoff(hybridTabId, "chat-a", human.controlGeneration);
      const fresh = (await hybridRun({ action: "screenshot" })).value.evidence.screenshot;
      const again = await service.getContents(hybridTabId).executeJavaScript("['#handle','#dock'].map(s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})");
      const freshPoint = p => ({ kind: "point", screenshotId: fresh.id, x: Math.floor(p.x * fresh.pixelWidth / fresh.viewportWidth), y: Math.floor(p.y * fresh.pixelHeight / fresh.viewportHeight) });
      const completed = await hybridRun({ action: "drag", from: freshPoint(again[0]), to: freshPoint(again[1]) });
      return { dragged, humanOwner: human.owner.kind, afterTakeover, resumedOwner: resumed.owner.kind, completed: completed.ok, final: { pointer: await read("#pointer"), docked: await read("#docked") } };
    });
    assert.equal(takeover.dragged.ok, false, "the interrupted drag reports failure instead of success");
    assert.equal(takeover.humanOwner, "human");
    assert.equal(takeover.afterTakeover.pointer, "Released", "takeover releases the agent's pressed mouse button");
    assert.equal(takeover.afterTakeover.docked, "Docked: 0", "the interrupted drag did not drop");
    assert.equal(takeover.afterTakeover.order, "kept-across-takeover", "page state survives takeover");
    assert.equal(takeover.resumedOwner, "chat");
    assert.equal(takeover.completed, true);
    assert.deepEqual(takeover.final, { pointer: "Released", docked: "Docked: 1" }, "resume performs exactly one drop, with no replay of the interrupted one");
    pass("takeover mid-drag releases the held button, keeps the page, and resume completes exactly one drop");
    return { passed };
  } catch (error) { console.error("Hybrid browser verification failed:", error); throw error;
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
module.exports = { verifyHybridBrowsing };
if (require.main === module) verifyHybridBrowsing().then(result => console.log(`Verified ${result.passed.length} hybrid scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
