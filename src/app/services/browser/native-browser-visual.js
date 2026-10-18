"use strict";

const { randomUUID } = require("node:crypto");
const { validateBrowserContract } = require("../../../contracts/browser/browser-contracts.js");
const WORLD = 1007;
const fail = (code, message) => Object.assign(new Error(message), { code });

// This world has no application preload. Its closed shadow root keeps page CSS
// out of the pointer, and pointer-events:none leaves all input with the page.
// Hiding resolves after a frame is painted without the pointer when the view
// is rendering, and after a short wait when it is hidden and paints nothing.
function pointerScript(point, phase) {
  return `(() => {
    let state = globalThis.__xekutePointer;
    if (!state || !state.host.isConnected) {
      const host = document.createElement('div');
      host.setAttribute('data-xekute-pointer','');
      host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
      const shadow = host.attachShadow({mode:'closed'});
      shadow.innerHTML='<style>:host{pointer-events:none!important}i{position:absolute;display:block;width:16px;height:19px;background:#b79aff;filter:drop-shadow(0 1px 2px #000);transition:left 90ms linear,top 90ms linear;pointer-events:none}b{position:absolute;width:22px;height:22px;border:2px solid #b79aff;border-radius:50%;transform:translate(-50%,-50%);opacity:0;pointer-events:none}</style><i></i><b></b>';
      document.documentElement.append(host);
      const cursor=shadow.querySelector('i');
      const d='M2.15721 0.232741C1.24021 -0.379259 -0.0937915 0.278741 0.00520855 1.47074L0.0342083 1.81774C0.476406 7.12383 1.41042 12.3774 2.82421 17.5107C3.16121 18.7347 4.85421 18.8407 5.36821 17.7057L7.49721 13.0087C7.70021 12.5597 8.19421 12.2717 8.73121 12.3287L13.9972 12.8927C15.2062 13.0227 16.0602 11.5467 15.0912 10.6117C11.1902 6.84846 6.96068 3.44125 2.45321 0.430741L2.15721 0.232741Z';
      const svg="<svg xmlns='http://www.w3.org/2000/svg' width='16' height='19' viewBox='0 0 16 19'><path d='"+d+"' fill='black'/></svg>";
      const mask='url("data:image/svg+xml,'+encodeURIComponent(svg)+'") no-repeat center / contain';
      cursor.style.webkitMask=mask; cursor.style.mask=mask;
      state=globalThis.__xekutePointer={host,cursor,ring:shadow.querySelector('b')};
    }
    const point=${JSON.stringify(point)}, phase=${JSON.stringify(phase)};
    if(phase==='hide'){
      state.host.style.setProperty('visibility','hidden','important');
      return new Promise(done=>{const late=setTimeout(done,150);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(late);done();}));});
    }
    state.host.style.setProperty('visibility','visible','important');
    if(point){state.cursor.style.left=point.x+'px';state.cursor.style.top=point.y+'px';state.ring.style.left=point.x+'px';state.ring.style.top=point.y+'px';}
    if(['down','click'].includes(phase))state.ring.animate([{opacity:1,scale:'.5'},{opacity:0,scale:'1.8'}],{duration:420});
  })()`;
}
async function renderBrowserPointer(contents, point, phase = "move") {
  if (!contents || contents.isDestroyed()) return;
  await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: pointerScript(point, phase) }]);
}
function createNativeBrowserVisual({ service, artifactStore, resizeImage = null }) {
  const screenshots = new Map();
  service.setPointerRenderer?.(renderBrowserPointer);
  const contentsFor = tab => service.getContents(tab.id);
  async function state(tab) {
    const contents = contentsFor(tab);
    const metrics = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => {
      let state=globalThis.__xekuteVisualRevision;
      if(!state){state=globalThis.__xekuteVisualRevision={revision:0};new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('[data-xekute-pointer]')&&!(r.type==='childList'&&Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).every(n=>n.nodeType===1&&n.hasAttribute('data-xekute-pointer')))))state.revision++}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}
      return {width:innerWidth,height:innerHeight,scrollX,scrollY,dpr:devicePixelRatio,revision:state.revision};
    })()` }]);
    return { ...metrics, zoom: contents.getZoomFactor() };
  }
  async function pointer(_page, point, phase) {
    // The transport paints the pointer at dispatch time for structural and
    // visual actions alike. Explicit calls can provide an anticipatory move.
    const tab = service.list().find(item => item.id === point?.tabId);
    if (tab) await renderBrowserPointer(contentsFor(tab), point, phase);
  }
  return Object.freeze({
    pointer,
    async capture(_page, tab) {
      const before = await state(tab), contents = contentsFor(tab);
      if (before.width < 1 || before.height < 1) throw fail("BROWSER_SCREENSHOT_UNAVAILABLE", "The browser viewport is empty.");
      await renderBrowserPointer(contents, null, "hide");
      let data;
      try {
        // A hidden view renders only while being captured, and its first capture
        // can return the frame from before the pointer was hidden. The second
        // capture reflects the current page.
        await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        if (image.isEmpty()) throw fail("BROWSER_SCREENSHOT_UNAVAILABLE", "The browser has no rendered viewport to capture.");
        data = image.toPNG();
      }
      finally { if (service.list().some(item => item.id === tab.id && item.owner.kind === "chat" && item.controlGeneration === tab.controlGeneration)) await renderBrowserPointer(contents, null, "show").catch(() => {}); }
      let pixelWidth = data.readUInt32BE(16), pixelHeight = data.readUInt32BE(20);
      if (Math.max(pixelWidth, pixelHeight) > 1600) {
        const resize = resizeImage || ((buffer, size) => require("electron").nativeImage.createFromBuffer(buffer).resize(size).toPNG());
        const ratio = 1600 / Math.max(pixelWidth, pixelHeight);
        data = resize(data, { width: Math.max(1, Math.round(pixelWidth * ratio)), height: Math.max(1, Math.round(pixelHeight * ratio)) });
        pixelWidth = data.readUInt32BE(16); pixelHeight = data.readUInt32BE(20);
      }
      const current = service.list().find(item => item.id === tab.id), after = await state(tab);
      if (!current || current.controlGeneration !== tab.controlGeneration || current.documentVersion !== tab.documentVersion || current.viewportRevision !== tab.viewportRevision || before.scrollX !== after.scrollX || before.scrollY !== after.scrollY || before.revision !== after.revision) throw fail("BROWSER_OBSERVATION_STALE", "The page changed during screenshot capture. Capture it again.");
      const metadata = { id: randomUUID(), tabId: tab.id, documentVersion: tab.documentVersion, viewportRevision: tab.viewportRevision, mimeType: "image/png", pixelWidth, pixelHeight,
        viewportWidth: before.width, viewportHeight: before.height, scrollX: before.scrollX, scrollY: before.scrollY, deviceScaleFactor: before.dpr, zoomFactor: before.zoom };
      const artifact = await artifactStore.put({ projectId: tab.projectId, kind: "screenshot", mimeType: "image/png", data, metadata });
      const screenshot = { ...metadata, artifactId: artifact.id };
      const checked = validateBrowserContract("screenshot", screenshot);
      if (!checked.ok) throw fail(checked.error.code, checked.error.message);
      screenshots.set(screenshot.id, { screenshot, projectId: tab.projectId, revision: before.revision });
      while (screenshots.size > 40) screenshots.delete(screenshots.keys().next().value);
      return screenshot;
    },
    async resolve(target, _page, tab) {
      const saved = screenshots.get(target.screenshotId), screenshot = saved?.screenshot;
      if (!screenshot || saved.projectId !== tab.projectId || screenshot.tabId !== tab.id || screenshot.documentVersion !== tab.documentVersion || screenshot.viewportRevision !== tab.viewportRevision) throw fail("BROWSER_OBSERVATION_STALE", "The screenshot is no longer current. Capture this tab again.");
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.y < 0 || target.x >= screenshot.pixelWidth || target.y >= screenshot.pixelHeight) throw fail("BROWSER_CONTRACT_INVALID", "The point is outside the screenshot.");
      const current = await state(tab);
      if (current.width !== screenshot.viewportWidth || current.height !== screenshot.viewportHeight || current.scrollX !== screenshot.scrollX || current.scrollY !== screenshot.scrollY || current.zoom !== screenshot.zoomFactor || current.revision !== saved.revision) throw fail("BROWSER_OBSERVATION_STALE", "The page moved or changed after the screenshot. Capture it again.");
      return { x: target.x * screenshot.viewportWidth / screenshot.pixelWidth, y: target.y * screenshot.viewportHeight / screenshot.pixelHeight };
    },
  });
}

module.exports = { createNativeBrowserVisual, renderBrowserPointer };
