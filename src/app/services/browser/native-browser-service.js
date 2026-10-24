"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createBrowserTab, validateBrowserContract, transitionBrowserTab } = require("../../../contracts/browser/browser-contracts.js");
const { createNativeBrowserSessions } = require("./native-browser-sessions.js");
const { createBrowserCdpTransport } = require("./browser-cdp-transport.js");
const { prepareBrowserDialogs } = require("./native-browser-dialogs.js");

function createNativeBrowserService({ electron, getWindow, identityVault, proxyListener, tabStore = null, artifactStore = null, requestPolicy = null, downloadPolicy = null, onEvent = () => {} }) {
  const tabs = new Map();
  const subscribers = new Set();
  const publish = event => { onEvent(event); for (const listener of subscribers) listener(event); };
  // Scope applies to the agent only, so only agent-owned tabs reach the policy.
  const agentRequestPolicy = requestPolicy && (details => {
    const record = [...tabs.values()].find(item => !item.view.webContents.isDestroyed() && item.view.webContents.id === details.webContentsId);
    if (!record || record.tab.owner.kind !== "chat" || !project) return false;
    return requestPolicy({ ...details, tab: copy(record.tab), workspace: project.workspace });
  });
  const sessions = createNativeBrowserSessions({ electron, identityVault, proxyListener, requestPolicy: agentRequestPolicy, onWarning: warning => onEvent({ type: "warning", ...warning }) });
  let project = null, selectedId = null, disposed = false, tail = Promise.resolve();
  let inputShield = null;
  let pointerRenderer = null;
  // Size of the most recent workspace layout. Tabs opened in the background
  // take it, so their pages have a real viewport the agent can act in.
  let workspaceBounds = null;
  let workspaceVisible = false;
  const copy = value => structuredClone(value);
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const queue = task => {
    const result = tail.then(() => { if (disposed) throw fail("BROWSER_SERVICE_CLOSED", "The browser service is closed."); return task(); });
    tail = result.catch(() => {});
    return result;
  };
  function recordFor(id) {
    const record = tabs.get(id);
    if (!record || record.view.webContents.isDestroyed()) throw fail("BROWSER_TAB_UNAVAILABLE", "The browser tab is no longer available.");
    return record;
  }
  const emit = (type, record, extra = {}) => { publish({ type, tab: copy(record.tab), ...extra }); syncInputShield(); };
  function syncInputShield() {
    const selected = tabs.get(selectedId), window = getWindow();
    const needed = selected && selected.view.getVisible() && selected.tab.owner.kind === "chat";
    if (!needed || !window || window.isDestroyed()) { inputShield?.setVisible(false); return; }
    if (!inputShield) {
      inputShield = new electron.WebContentsView({ webPreferences: { session: electron.session.fromPartition(`xekute-browser-shield-${randomUUID()}`),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false } });
      inputShield.setBackgroundColor("#00000000");
      inputShield.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      inputShield.webContents.loadURL("data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:transparent;cursor:default}</style>").catch(() => {});
    }
    window.contentView.addChildView(inputShield);
    inputShield.setBounds(selected.view.getBounds()); inputShield.setVisible(true);
  }
  function transition(record, event) {
    const result = transitionBrowserTab(record.tab, event);
    if (!result.ok) throw fail(result.error.code, result.error.message);
    record.tab = result.value;
  }
  function rememberOrigin(record, url) {
    try { const value = new URL(url); if (["http:", "https:"].includes(value.protocol)) record.session.origins.add(value.origin); } catch { /* Non-web frames have no supported storage. */ }
  }
  function wire(record) {
    const contents = record.view.webContents;
    // Electron owns alert/confirm/prompt callbacks independently of CDP. Keep
    // that callback while the chat owns this contents, and retain Electron's
    // normal native handling when the human owns it.
    const nativeDialogHandlers = contents.listeners("-run-dialog");
    record.dialogAdapterAvailable = nativeDialogHandlers.length > 0;
    for (const handler of nativeDialogHandlers) contents.removeListener("-run-dialog", handler);
    contents.on("-run-dialog", (info, callback) => {
      if (record.tab.owner.kind !== "chat") {
        if (!nativeDialogHandlers.length) callback(false, "");
        else for (const handler of nativeDialogHandlers) handler.call(contents, info, callback);
        return;
      }
      if (record.dialogCallback) { callback(false, ""); return; }
      record.dialogCallback = callback;
      record.dialog = { type: info.dialogType, message: String(info.messageText).slice(0, 2000), defaultPrompt: String(info.defaultPromptText || "").slice(0, 2000) };
      emit("updated", record);
    });
    contents.debugger.on("message", (_event, method, params) => {
      if (method === "Page.javascriptDialogOpening") {
        record.dialog = { type: params.type, message: String(params.message).slice(0, 2000), defaultPrompt: String(params.defaultPrompt || "").slice(0, 2000) };
        emit("updated", record);
      } else if (method === "Page.javascriptDialogClosed") { record.dialog = null; record.dialogCallback = null; }
    });
    const downloadListener = (_event, item, source) => {
      if (source?.id !== contents.id) return;
      if (!artifactStore) { _event.preventDefault(); return; }
      const fs = require("node:fs/promises"), os = require("node:os");
      const id = randomUUID(), file = path.join(os.tmpdir(), `xekute-download-${id}`);
      const download = { id, name: item.getFilename().slice(0, 240), status: "running", artifactId: null };
      record.downloads.set(id, download);
      const rule = record.tab.owner.kind === "chat" && project ? downloadPolicy?.({ tab: copy(record.tab), workspace: project.workspace }) : null;
      const maxBytes = Math.min(12 * 1024 * 1024, rule?.maxBytes || Infinity);
      const refuse = (code, message) => { Object.assign(download, { status: "failed", error: { code, message } }); emit("updated", record); };
      if (rule?.blocked) { _event.preventDefault(); return refuse("BROWSER_DOWNLOAD_BLOCKED", "This project blocks downloads in agent browser tabs."); }
      if (item.getTotalBytes() > maxBytes) { _event.preventDefault(); return refuse("BROWSER_DOWNLOAD_TOO_LARGE", `The download exceeds the ${Math.round(maxBytes / 1048576)} MiB project limit.`); }
      record.downloadItems.add(item);
      item.setSavePath(file);
      item.on("updated", () => { if (item.getReceivedBytes() > maxBytes) item.cancel(); });
      item.once("done", async (_event, status) => {
        record.downloadItems.delete(item);
        try {
          if (status !== "completed") throw fail("BROWSER_DOWNLOAD_FAILED", `The download ${status}.`);
          const data = await fs.readFile(file);
          const artifact = await artifactStore.put({ projectId: record.tab.projectId, kind: "download", mimeType: item.getMimeType() || "application/octet-stream", data, metadata: { name: download.name, tabId: record.tab.id } });
          Object.assign(download, { status: "completed", artifactId: artifact.id, byteLength: artifact.byteLength });
        } catch (error) { Object.assign(download, { status: "failed", error: { code: error.code || "BROWSER_DOWNLOAD_FAILED", message: error.message } }); }
        finally { await fs.rm(file, { force: true }).catch(() => {}); if (tabs.has(record.tab.id)) emit("updated", record); }
      });
    };
    const nativeSession = contents.session;
    nativeSession.on("will-download", downloadListener);
    contents.once("destroyed", () => nativeSession.removeListener("will-download", downloadListener));
    const listen = (event, handler) => contents.on(event, (...args) => { if (tabs.get(record.tab.id) === record) handler(...args); });
    const persistMetadata = () => queue(saveTabs).catch(error => onEvent({ type: "warning", code: "BROWSER_TABS_SAVE_FAILED", message: error.message }));
    contents.setWindowOpenHandler(({ url }) => {
      if (!validateBrowserContract("action", { action: "navigate", tabId: record.tab.id, url }).ok) return { action: "deny" };
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, preload: undefined, session: record.session.session } }, createWindow: options => {
        const tab = createBrowserTab({ id: randomUUID(), projectId: record.tab.projectId, purpose: record.tab.purpose, identityId: record.tab.identityId, url });
        tab.owner = copy(record.tab.owner); tab.controlGeneration = record.tab.controlGeneration;
        const child = makeView(tab, record.session, record.tab.id, options);
        child.view.setBounds(workspaceBounds || record.view.getBounds());
        for (const item of tabs.values()) item.view.setVisible(item === child && workspaceVisible && Boolean(workspaceBounds));
        selectedId = child.tab.id; syncInputShield();
        if (!options.webContents) child.view.webContents.loadURL(url).catch(error => emit("navigation-error", child, { error: { message: error.message } }));
        persistMetadata(); return child.view.webContents;
      } };
    });
    contents.on("will-attach-webview", event => event.preventDefault());
    for (const eventName of ["before-input-event", "before-mouse-event"]) contents.on(eventName, event => {
      if (record.tab.owner.kind === "chat" && !record.protocolInput) event.preventDefault();
    });
    contents.on("will-navigate", (event, url) => { if (!validateBrowserContract("action", { action: "navigate", tabId: record.tab.id, url }).ok) event.preventDefault(); });
    contents.on("will-redirect", (event, url) => { if (!validateBrowserContract("action", { action: "navigate", tabId: record.tab.id, url }).ok) event.preventDefault(); });
    listen("did-start-loading", () => { record.tab.status = "loading"; emit("updated", record); });
    listen("did-stop-loading", () => { if (record.tab.status !== "crashed") record.tab.status = "ready"; emit("updated", record); });
    listen("did-navigate", (_event, url) => { transition(record, { type: "document_changed", url }); rememberOrigin(record, url); emit("updated", record); persistMetadata(); });
    listen("did-frame-navigate", (_event, url, _code, _text, isMainFrame) => {
      rememberOrigin(record, url);
      if (!isMainFrame) { transition(record, { type: "document_changed" }); emit("updated", record); }
    });
    listen("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) { transition(record, { type: "document_changed", url }); emit("updated", record); }
      else { transition(record, { type: "document_changed" }); emit("updated", record); }
      persistMetadata();
    });
    listen("page-title-updated", (_event, title) => { record.tab.title = title.slice(0, 2000); emit("updated", record); });
    listen("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) emit("navigation-error", record, { error: { code: "BROWSER_NAVIGATION_FAILED", message: description, url } });
    });
    listen("render-process-gone", (_event, details) => { record.active?.stop(); transition(record, { type: "crashed" }); emit("crashed", record, { reason: details.reason }); });
    contents.once("destroyed", () => {
      if (!tabs.has(record.tab.id)) return;
      tabs.delete(record.tab.id);
      const window = getWindow();
      if (window && !window.isDestroyed()) window.contentView.removeChildView(record.view);
      if (selectedId === record.tab.id) selectedId = null;
      transition(record, { type: "closed" }); emit("closed", record);
    });
  }
  async function saveTabs() {
    if (!project || !tabStore) return;
    await tabStore.save(project.id, [...tabs.values()].map(({ tab }) => ({ id: tab.id, purpose: tab.purpose, identityId: tab.identityId, url: tab.url, title: tab.title })));
  }
  function destroy(record) {
    record.active?.stop();
    if (record.dialogCallback) {
      const callback = record.dialogCallback; record.dialogCallback = null; record.dialog = null;
      try { callback(false, ""); } catch { /* The native dialog may already have closed. */ }
    }
    for (const item of record.downloadItems) item.cancel();
    tabs.delete(record.tab.id);
    const contents = record.view.webContents;
    if (!contents.isDestroyed()) {
      contents.stop();
      const window = getWindow();
      if (window && !window.isDestroyed()) window.contentView.removeChildView(record.view);
      contents.close();
    }
    transition(record, { type: "closed" }); emit("closed", record);
    if (selectedId === record.tab.id) selectedId = null;
  }
  async function closeProject() {
    workspaceVisible = false;
    workspaceBounds = null;
    let saveError;
    try { await saveTabs(); } catch (error) { saveError = error; onEvent({ type: "warning", code: "BROWSER_TABS_SAVE_FAILED", message: error.message }); }
    for (const record of [...tabs.values()]) destroy(record);
    if (inputShield) {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.contentView.removeChildView(inputShield);
      if (!inputShield.webContents.isDestroyed()) inputShield.webContents.close();
      inputShield = null;
    }
    try { await sessions.closeAll(); } finally { project = null; selectedId = null; }
    if (saveError) throw saveError;
  }
  async function openTab(input) {
    if (!project) throw fail("BROWSER_PROJECT_REQUIRED", "Activate a browser project first.");
    const checked = validateBrowserContract("operatorCommand", { command: "open", projectId: project.id, purpose: input.purpose, identityId: input.identityId ?? null, url: input.url || "about:blank" });
    if (!checked.ok) throw fail(checked.error.code, checked.error.message);
    const tab = createBrowserTab({ id: input.id || randomUUID(), projectId: project.id, purpose: input.purpose, identityId: input.identityId ?? null, url: input.url || "about:blank" });
    if (tabs.has(tab.id)) throw fail("BROWSER_TAB_EXISTS", "A browser tab already has this identity.");
    const session = await sessions.get(project, tab.purpose, tab.identityId);
    const record = makeView(tab, session);
    return startNavigation(record, tab.url);
  }
  function makeView(tab, session, openerId = null, options = {}) {
    const view = new electron.WebContentsView({ ...(options.webContents ? { webContents: options.webContents } : {}), webPreferences: { ...options.webPreferences, preload: undefined, session: session.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, devTools: false } });
    view.setVisible(false);
    const record = { tab, view, session, openerId, operationTail: Promise.resolve(), active: null, dialog: null, downloads: new Map(), downloadItems: new Set() };
    record.paintPointer = (point, phase) => pointerRenderer?.(view.webContents, point, phase);
    tabs.set(tab.id, record); wire(record);
    getWindow()?.contentView.addChildView(view);
    // Size only after the view joins the window: sizing a detached view
    // stalled its first navigation in the full application.
    view.setBounds(workspaceBounds || (() => { const size = getWindow()?.getContentBounds?.() || { width: 1280, height: 800 }; return { x: 0, y: 0, width: size.width, height: size.height }; })());
    emit("opened", record);
    return record;
  }

  function startNavigation(record, url) {
    const navigation = record.view.webContents.loadURL(url);
    // Keep lifecycle work independent from a server that never finishes loading.
    // The caller still receives the actual navigation result.
    navigation.catch(error => {
      if (tabs.has(record.tab.id)) emit("navigation-error", record, { error: { code: error.code || "BROWSER_NAVIGATION_FAILED", message: error.message } });
    });
    return { record, navigation };
  }
  async function settled({ record, navigation }) {
    await navigation;
    if (!tabs.has(record.tab.id)) throw fail("BROWSER_TAB_UNAVAILABLE", "The browser tab closed during navigation.");
    return copy(record.tab);
  }

  const subscribe = listener => { subscribers.add(listener); return () => subscribers.delete(listener); };
  function layout(id, bounds) {
    const record = recordFor(id), window = getWindow();
    if (!window || window.isDestroyed()) throw fail("BROWSER_WINDOW_UNAVAILABLE", "The workspace window is unavailable.");
    const size = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
    const x = Math.min(size.width, Math.max(0, Math.round(bounds.x * zoom)));
    const y = Math.min(size.height, Math.max(0, Math.round(bounds.y * zoom)));
    const width = Math.min(size.width - x, Math.max(0, Math.round(bounds.width * zoom)));
    const height = Math.min(size.height - y, Math.max(0, Math.round(bounds.height * zoom)));
    const next = { x, y, width, height }, previous = record.view.getBounds();
    if (Object.keys(next).some(key => next[key] !== previous[key])) { record.view.setBounds(next); transition(record, { type: "viewport_changed" }); }
    if (width > 0 && height > 0) workspaceBounds = next;
    workspaceVisible = width > 0 && height > 0;
    for (const item of tabs.values()) item.view.setVisible(item === record && workspaceVisible);
    selectedId = id;
    syncInputShield();
    return copy(record.tab);
  }
  async function transfer(id, event) {
    const record = recordFor(id);
    if (event.type === "handoff" && !record.dialogAdapterAvailable) throw fail("BROWSER_DIALOG_ADAPTER_UNAVAILABLE", "This Electron build does not expose the managed browser dialog adapter. Browser control requires the verified Electron build.");
    transition(record, event); emit("updated", record);
    if (record.tab.owner.kind === "chat") getWindow()?.webContents.focus();
    if (record.active) {
      const active = record.active; active.stop();
      let timer;
      const finished = await Promise.race([active.done.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
      clearTimeout(timer);
      if (!finished && record.tab.operation.status === "stopping") {
        transition(record, { type: "operation_uncertain", operationId: active.id }); emit("updated", record);
        throw fail("BROWSER_OPERATION_UNCERTAIN", "The browser action has not settled. Recover the tab before transferring control.");
      }
      if (record.tab.operation.status === "recovery_required") throw fail("BROWSER_OPERATION_UNCERTAIN", "The browser action may have completed. Reload the tab to recover before transferring control.");
    }
    if (record.dialogCallback) {
      const callback = record.dialogCallback; record.dialogCallback = null;
      callback(false, ""); record.dialog = null;
    } else if (record.dialog && record.managedDialogDebugger) {
      await record.view.webContents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
      record.dialog = null;
    }
    record.managedDialogDebugger = false;
    if (!record.active && record.view.webContents.debugger.isAttached()) record.view.webContents.debugger.detach();
    await releaseHeldPointers(record);
    if (event.type === "takeover") await pointerRenderer?.(record.view.webContents, null, "hide");
    return copy(record.tab);
  }
  // A button pressed by the ending operation is lifted here, after the page's
  // own transport and Playwright have detached, on a clean debugger. The page
  // sees the release instead of a button stuck down under the new owner.
  async function releaseHeldPointers(record) {
    const held = record.pendingRelease; record.pendingRelease = null;
    const contents = record.view.webContents;
    if (!held?.length || contents.isDestroyed()) return;
    const attachedHere = !contents.debugger.isAttached();
    try {
      if (attachedHere) contents.debugger.attach("1.3");
      await contents.debugger.sendCommand("Input.setInterceptDrags", { enabled: false }).catch(() => {});
      for (const { button, x, y } of held) await contents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", button, x, y, clickCount: 1 }).catch(() => {});
    } catch { /* The page may be gone; the stuck button goes with it. */ }
    finally { if (attachedHere && !contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach(); }
  }
  function withPage(id, sessionId, expectedGeneration, task, { signal, timeoutMs = 15000, deadline = Date.now() + timeoutMs } = {}) {
    const record = recordFor(id);
    let transport, cancelled = false, stopError, rejectStop, active = false;
    const stopped = new Promise((_resolve, reject) => { rejectStop = reject; });
    stopped.catch(() => {});
    const stop = (error = fail("BROWSER_ACTION_STOPPED", "Browser action stopped.")) => {
      if (cancelled) return;
      cancelled = true; stopError = error;
      transport?.close();
      if (active && !record.view.webContents.isDestroyed()) record.view.webContents.stop();
      rejectStop(error);
    };
    const abort = () => stop(signal.reason?.code === "BROWSER_ACTION_TIMEOUT" ? signal.reason : undefined);
    const timer = setTimeout(() => stop(fail("BROWSER_ACTION_TIMEOUT", "Browser action exceeded its time budget. Observe before retrying an action that may have completed, or continue with another page.")), Math.max(1, deadline - Date.now()));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const result = record.operationTail.catch(() => {}).then(async () => {
      if (cancelled) throw stopError;
      recordFor(id);
      if (record.tab.owner.kind !== "chat" || record.tab.owner.sessionId !== sessionId || record.tab.controlGeneration !== expectedGeneration) throw fail("BROWSER_CONTROL_STALE", "This chat no longer controls the browser tab.");
      const operationId = randomUUID();
      transition(record, { type: "operation_started", expectedGeneration, operationId }); emit("updated", record);
      let browser, finish, cleanupDialogs, uncertain = false;
      const done = new Promise(resolve => { finish = resolve; });
      const leased = new Set([record]);
      const current = () => !cancelled && tabs.get(id) === record && record.tab.controlGeneration === expectedGeneration && record.tab.owner.kind === "chat" && record.tab.owner.sessionId === sessionId;
      active = true;
      record.active = { id: operationId, done, stop: () => stop() };
      try {
        transport = createBrowserCdpTransport({
          records: () => {
            const allowed = new Set([id]);
            for (const item of tabs.values()) if (allowed.has(item.openerId) && item.tab.owner.kind === "chat" && item.tab.owner.sessionId === sessionId && item.tab.controlGeneration === expectedGeneration) allowed.add(item.tab.id);
            const targets = [...tabs.values()].filter(item => allowed.has(item.tab.id));
            for (const item of targets) if (!leased.has(item)) {
              transition(item, { type: "operation_started", expectedGeneration, operationId });
              item.active = record.active; item.operationTail = result.catch(() => {}); leased.add(item); emit("updated", item);
            }
            return targets;
          }, current, subscribe, onDetached: () => { uncertain = true; stop(); },
        });
        browser = await Promise.race([require("playwright-core").chromium.connectOverCDP(transport, { noDefaults: true, timeout: 10000 }), stopped]);
        const pages = browser.contexts()[0]?.pages() || [];
        const page = pages[0];
        if (!page || !current()) throw fail("BROWSER_CONTROL_STALE", "Browser control changed while connecting.");
        page.setDefaultTimeout(15000);
        cleanupDialogs = await Promise.race([prepareBrowserDialogs(record.view.webContents, page, current), stopped]);
        const value = await Promise.race([Promise.resolve().then(() => task(page, { browser, signal })), stopped]);
        if (!current()) throw fail("BROWSER_ACTION_STOPPED", "Browser action stopped.");
        return value;
      } finally {
        try {
          // Dialog setup and teardown are CDP calls too, and can stall while
          // the renderer is unresponsive. They share the operation deadline.
          if (current() && ![...leased].some(item => item.dialog)) await Promise.race([Promise.resolve().then(() => cleanupDialogs?.()), stopped]);
        } finally {
          transport?.close();
          // A synchronous page handler can keep the original input RPC pending
          // until its dialog callback is answered by the next tool call. The
          // native callback is an explicit continuation, not an uncertain input.
          const settled = [...leased].some(item => item.dialogCallback) ? true : await transport?.settled();
          const held = transport?.heldPointers?.();
          for (const item of leased) if (held?.get(item.tab.id)?.length) item.pendingRelease = held.get(item.tab.id);
          for (const item of leased) {
            if (tabs.get(item.tab.id) === item && ["running", "stopping"].includes(item.tab.operation.status) && item.tab.operation.operationId === operationId) {
              transition(item, { type: uncertain || settled === false ? "operation_uncertain" : "operation_settled", operationId }); emit("updated", item);
            }
            if (item.active?.id === operationId) item.active = null;
          }
          active = false;
          finish();
        }
      }
    });
    record.operationTail = result.catch(() => {});
    const queuedStop = stopped.catch(error => {
      // A queued call can expire immediately. Once started, finalize its
      // ownership state before callers attempt recovery or takeover.
      if (active) return result;
      throw error;
    });
    return Promise.race([result, queuedStop]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
  }

  return Object.freeze({
    activateProject(input, prepareProxy = null) {
      return queue(async () => {
        createBrowserTab({ id: "project-validation", projectId: input.id, purpose: "research" });
        if (!path.isAbsolute(input.workspace)) throw fail("BROWSER_PROJECT_INVALID", "Browser project workspace must be absolute.");
        if (project?.id === input.id && path.resolve(project.workspace) === path.resolve(input.workspace)) return { projectId: project.id };
        await closeProject();
        if (prepareProxy) await prepareProxy();
        project = { id: input.id, workspace: path.resolve(input.workspace) };
        return { projectId: project.id };
      });
    },
    open: input => queue(async () => { const started = await openTab(input); await saveTabs(); return started; }).then(settled),
    navigate: (id, url) => queue(async () => {
      const checked = validateBrowserContract("action", { action: "navigate", tabId: id, url });
      if (!checked.ok) throw fail(checked.error.code, checked.error.message);
      const record = recordFor(id);
      if (record.tab.owner.kind !== "human") throw fail("BROWSER_TAB_BUSY", "Take over the browser tab before navigating manually.");
      return startNavigation(record, url);
    }).then(settled),
    reload: id => queue(async () => {
      const record = recordFor(id);
      if (record.tab.status === "crashed" || record.tab.operation.status === "recovery_required") {
        record.active?.stop(); record.active = null; record.operationTail = Promise.resolve(); transition(record, { type: "recovered" });
      }
      if (record.tab.owner.kind !== "human") throw fail("BROWSER_TAB_BUSY", "Take over the browser tab before reloading manually.");
      return startNavigation(record, record.tab.url);
    }).then(settled),
    back: id => queue(() => { const record = recordFor(id); if (record.tab.owner.kind !== "human") throw fail("BROWSER_TAB_BUSY", "Take over the browser tab before navigating manually."); return record.view.webContents.navigationHistory.goBack(); }),
    forward: id => queue(() => { const record = recordFor(id); if (record.tab.owner.kind !== "human") throw fail("BROWSER_TAB_BUSY", "Take over the browser tab before navigating manually."); return record.view.webContents.navigationHistory.goForward(); }),
    handoff: (id, sessionId, expectedGeneration) => queue(() => transfer(id, { type: "handoff", sessionId, expectedGeneration })),
    takeover: (id, expectedGeneration) => queue(() => transfer(id, { type: "takeover", expectedGeneration })),
    withPage,
    setPointerRenderer(renderer) { pointerRenderer = renderer; },
    getDialog: id => copy(recordFor(id).dialog),
    async handleDialog(id, { accept, text, sessionId, generation }) {
      const record = recordFor(id);
      if (record.tab.owner.kind !== "chat" || record.tab.owner.sessionId !== sessionId || record.tab.controlGeneration !== generation) throw fail("BROWSER_CONTROL_STALE", "This chat no longer controls the browser tab.");
      if (!record.dialog || (!record.dialogCallback && !record.managedDialogDebugger)) throw fail("BROWSER_DIALOG_UNAVAILABLE", "The browser tab has no pending dialog.");
      if (record.dialogCallback) {
        const callback = record.dialogCallback; record.dialogCallback = null;
        callback(accept, text || "");
      } else await record.view.webContents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept, ...(text !== undefined ? { promptText: text } : {}) });
      record.dialog = null; record.managedDialogDebugger = false;
      if (record.view.webContents.debugger.isAttached()) record.view.webContents.debugger.detach();
      return { handled: true };
    },
    listDownloads: id => [...recordFor(id).downloads.values()].map(copy),
    download(id, downloadId) {
      const download = recordFor(id).downloads.get(downloadId);
      if (!download) throw fail("BROWSER_DOWNLOAD_UNAVAILABLE", "This tab has no matching download.");
      return copy(download);
    },
    subscribe,
    cancelChat(sessionId) {
      return Promise.all([...tabs.values()].filter(record => record.tab.owner.kind === "chat" && record.tab.owner.sessionId === sessionId)
        .map(record => transfer(record.tab.id, { type: "takeover", expectedGeneration: record.tab.controlGeneration })));
    },
    closeIdentity: (workspace, identityId, options) => queue(async () => {
      if (!project || path.resolve(workspace) !== project.workspace) return;
      for (const record of [...tabs.values()]) if (record.tab.identityId === identityId) destroy(record);
      await sessions.closeIdentity(identityId, options); await saveTabs();
    }),
    close: id => queue(async () => {
      const record = tabs.get(id);
      if (!record) return;
      destroy(record);
      try { await sessions.persist(record.session); }
      finally { await saveTabs(); }
    }),
    closeOwned: (id, sessionId, generation, { signal } = {}) => queue(async () => {
      if (signal?.aborted) throw fail("BROWSER_ACTION_STOPPED", "Browser action stopped.");
      const record = recordFor(id);
      if (record.tab.owner.kind !== "chat" || record.tab.owner.sessionId !== sessionId || record.tab.controlGeneration !== generation) throw fail("BROWSER_CONTROL_STALE", "This chat no longer controls the browser tab.");
      destroy(record);
      try { await sessions.persist(record.session); }
      finally { await saveTabs(); }
    }),
    restore: ({ wait = true, prepareProxy = null } = {}) => queue(async () => {
      if (!project) throw fail("BROWSER_PROJECT_REQUIRED", "Activate a browser project first.");
      const saved = await tabStore?.load(project.id) || [];
      if (saved.some(input => input.purpose === "assessment") && prepareProxy) await prepareProxy();
      const started = [];
      for (const input of saved) {
        if (tabs.has(input.id)) continue;
        started.push(await openTab(input));
      }
      return started;
    }).then(async started => {
      // A dead saved URL must not prevent other tabs from being restored.
      const loading = Promise.allSettled(started.map(settled));
      if (wait) await loading;
      return [...tabs.values()].map(record => copy(record.tab));
    }),
    select(id, bounds) {
      if (bounds) return layout(id, bounds);
      const record = recordFor(id);
      // Agent selection changes tabs, but only a renderer layout can expose
      // a native page. Background pages still keep a viewport for automation.
      if (workspaceVisible && workspaceBounds) record.view.setBounds(workspaceBounds);
      for (const item of tabs.values()) item.view.setVisible(item === record && workspaceVisible && Boolean(workspaceBounds));
      selectedId = id; syncInputShield(); return copy(record.tab);
    },
    layout,
    async snapshot(id) {
      const contents = recordFor(id).view.webContents;
      if (contents.isDestroyed()) throw fail("BROWSER_TAB_UNAVAILABLE", "The browser tab is no longer available.");
      const image = await contents.capturePage();
      return image.isEmpty() ? null : image.toDataURL();
    },
    hide() { workspaceVisible = false; for (const record of tabs.values()) record.view.setVisible(false); inputShield?.setVisible(false); },
    list: () => [...tabs.values()].map(record => copy(record.tab)),
    getContents: id => recordFor(id).view.webContents,
    status: () => ({ projectId: project?.id || null, selectedId, tabs: tabs.size, sessions: sessions.count(), disposed }),
    closeProject: () => queue(closeProject),
    shutdown: () => {
      const result = tail.then(async () => { if (disposed) return; disposed = true; await closeProject(); });
      tail = result.catch(() => {}); return result;
    },
  });
}

module.exports = { createNativeBrowserService };
