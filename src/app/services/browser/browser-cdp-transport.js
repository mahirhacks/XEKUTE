"use strict";

const { randomUUID } = require("node:crypto");
const { validateBrowserContract } = require("../../../contracts/browser/browser-contracts.js");

// A page-only CDP facade. It owns no sockets and never discovers Electron's
// application shell, storage helpers, or browser targets outside this lease.
function createBrowserCdpTransport({ records, current, subscribe, onDetached = () => {}, log = () => {} }) {
  const roots = new Map(), sessions = new Map(), pending = new Set();
  // Buttons still pressed per tab when control ended. The service releases them
  // after this transport and Playwright have fully torn down, so the release
  // never races their teardown on the same debugger.
  const heldAtClose = new Map();
  let closed = false, autoAttach = false;
  const output = message => { if (!closed) queueMicrotask(() => { if (!closed) transport.onmessage?.(message); }); };
  const info = record => ({ targetId: record.targetId, type: "page", title: record.source.tab.title, url: record.source.tab.url,
    attached: true, browserContextId: "xekute-authorized", ...(record.openerTargetId ? { openerId: record.openerTargetId } : {}) });
  async function attach(source) {
    if (roots.has(source.tab.id) || closed || !current()) return;
    const contents = source.view.webContents;
    if (contents.isDestroyed()) return;
    if (contents.debugger.isAttached() && !source.managedDialogDebugger) throw new Error("The browser tab debugger is already in use.");
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    source.managedDialogDebugger = false;
    const root = { source, contents, sessionId: `xekute-${randomUUID()}`, targetId: "", children: new Set(), pressed: new Map() };
    roots.set(source.tab.id, root); sessions.set(root.sessionId, { root, nativeSessionId: undefined });
    root.message = (_event, method, params, nativeSessionId) => {
      if (method === "Target.attachedToTarget") {
        if (params.targetInfo.type === "page") {
          contents.debugger.sendCommand("Runtime.runIfWaitingForDebugger", {}, params.sessionId)
            .then(() => contents.debugger.sendCommand("Target.detachFromTarget", { sessionId: params.sessionId })).catch(() => {});
          return;
        }
        // Native auto-attach only covers descendants of this approved contents.
        root.children.add(params.sessionId); sessions.set(params.sessionId, { root, nativeSessionId: params.sessionId });
      } else if (method === "Target.detachedFromTarget") {
        root.children.delete(params.sessionId); sessions.delete(params.sessionId);
      }
      output({ method, params, sessionId: nativeSessionId || root.sessionId });
    };
    root.detached = () => {
      if (closed) return;
      remove(root); onDetached(source.tab.id);
    };
    contents.debugger.on("message", root.message); contents.debugger.on("detach", root.detached);
    const result = await contents.debugger.sendCommand("Target.getTargetInfo");
    root.targetId = result.targetInfo.targetId;
    root.openerTargetId = [...roots.values()].find(item => item.source.tab.id === source.openerId)?.targetId;
    output({ method: "Target.attachedToTarget", params: { sessionId: root.sessionId, targetInfo: info(root), waitingForDebugger: false } });
  }
  function remove(root) {
    roots.delete(root.source.tab.id); sessions.delete(root.sessionId);
    for (const child of root.children) sessions.delete(child);
    root.contents.debugger.removeListener("message", root.message); root.contents.debugger.removeListener("detach", root.detached);
    output({ method: "Target.detachedFromTarget", params: { sessionId: root.sessionId, targetId: root.targetId } });
  }
  async function command({ method, params = {}, sessionId }) {
    if (!current()) throw new Error("Browser ownership was revoked.");
    if (!sessionId) {
      if (method === "Browser.getVersion") return { protocolVersion: "1.3", product: `Chrome/${process.versions.chrome || "0"}`, revision: "xekute-native", userAgent: `Xekute Windows Chrome/${process.versions.chrome || "0"}`, jsVersion: process.versions.v8 };
      if (method === "Target.setAutoAttach") {
        autoAttach = params.autoAttach;
        if (autoAttach) for (const source of records()) await attach(source);
        return {};
      }
      if (method === "Target.setDiscoverTargets") return {};
      if (method === "Target.getTargetInfo") {
        const root = [...roots.values()].find(item => !params.targetId || item.targetId === params.targetId);
        if (!root) throw new Error("Browser target is outside this lease.");
        return { targetInfo: info(root) };
      }
      if (method === "Target.getTargets") return { targetInfos: [...roots.values()].map(info) };
      if (method === "Browser.getWindowForTarget") {
        const root = [...roots.values()].find(item => item.targetId === params.targetId);
        if (!root) throw new Error("Browser target is outside this lease.");
        const { x: left, y: top, width, height } = root.source.view.getBounds();
        return { windowId: 1, bounds: { left, top, width, height, windowState: "normal" } };
      }
      throw new Error(`Unsupported browser-global CDP command: ${method}`);
    }
    const entry = sessions.get(sessionId);
    if (!entry || entry.root.contents.isDestroyed()) throw new Error("The browser target is no longer available.");
    if (!records().includes(entry.root.source)) throw new Error("The browser target is outside this lease.");
    if (method === "Page.navigate" && !validateBrowserContract("action", { action: "navigate", tabId: entry.root.source.tab.id, url: params.url }).ok) throw new Error("Browser navigation requires an HTTP or HTTPS URL.");
    if (method.startsWith("Browser.") || (method.startsWith("Target.") && !["Target.setAutoAttach", "Target.getTargetInfo", "Target.detachFromTarget"].includes(method))) {
      throw new Error(`Unsupported page CDP command: ${method}`);
    }
    if (method === "Target.setAutoAttach") params = { ...params, filter: [{ type: "page", exclude: true }, {}] };
    const source = entry.root.source;
    if (method === "Input.dispatchMouseEvent" && !source.dialog) await source.paintPointer?.({ x: params.x, y: params.y }, params.type === "mousePressed" ? "down" : params.type === "mouseReleased" ? "up" : "move");
    if (closed || !current()) throw new Error("Browser ownership was revoked.");
    if (method.startsWith("Input.")) source.protocolInput = (source.protocolInput || 0) + 1;
    try {
      const response = await entry.root.contents.debugger.sendCommand(method, params, entry.nativeSessionId);
      if (method === "Input.dispatchMouseEvent" && params.button && params.button !== "none") {
        if (params.type === "mousePressed") entry.root.pressed.set(params.button, { x: params.x, y: params.y, nativeSessionId: entry.nativeSessionId });
        else if (params.type === "mouseReleased") entry.root.pressed.delete(params.button);
      }
      return response;
    }
    finally { if (method.startsWith("Input.")) source.protocolInput--; }
  }
  const unsubscribe = subscribe(event => {
    if (!autoAttach || closed) return;
    if (event.type === "opened") for (const source of records()) {
      const contents = source.view.webContents;
      const ready = source.openerId && !contents.getURL()
        ? new Promise(resolve => { contents.once("dom-ready", resolve); contents.once("destroyed", resolve); })
        : new Promise(resolve => setImmediate(resolve));
      const work = ready.then(() => attach(source)).catch(error => { transport.close(); onDetached(source.tab.id, error); });
      pending.add(work); work.finally(() => pending.delete(work));
    }
    if (event.type === "closed") { const root = roots.get(event.tab.id); if (root) remove(root); }
  });
  const transport = {
    send(message) {
      if (closed) return;
      log(message);
      const work = command(message).then(result => output({ id: message.id, sessionId: message.sessionId, result }),
        error => output({ id: message.id, sessionId: message.sessionId, error: { code: -32000, message: error.message } }));
      pending.add(work); work.finally(() => pending.delete(work));
    },
    close() {
      if (closed) return;
      closed = true; unsubscribe();
      for (const root of [...roots.values()]) {
        if (root.pressed.size) heldAtClose.set(root.source.tab.id, [...root.pressed].map(([button, { x, y }]) => ({ button, x, y })));
        remove(root);
        if (!root.contents.isDestroyed() && root.contents.debugger.isAttached()) {
          if (root.source.dialog && !root.source.dialogCallback) root.source.managedDialogDebugger = true;
          else root.contents.debugger.detach();
        }
      }
      queueMicrotask(() => transport.onclose?.("Browser control ended."));
    },
    heldPointers: () => heldAtClose,
    async settled(timeoutMs = 2000) {
      let timer;
      try { return await Promise.race([Promise.allSettled([...pending]).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    },
  };
  let closeHandler;
  Object.defineProperty(transport, "onclose", {
    get: () => closeHandler,
    set(handler) { closeHandler = handler; if (closed && handler) queueMicrotask(() => handler("Browser control ended.")); },
    configurable: true,
  });
  return transport;
}

module.exports = { createBrowserCdpTransport };
