"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { validateBrowserContract } = require("../../../contracts/browser/browser-contracts.js");
const { createBrowserObservations } = require("./browser-observation.js");

const fail = (code, message) => Object.assign(new Error(message), { code });
const { originOf } = require("../../../agent/authority/scope/browser-scope.js");
const ACTIONS = new Set(["observe", "screenshot", "navigate", "click", "double_click", "type", "select", "move", "hover", "insert_text", "press_key", "scroll", "drag", "wait", "extract", "back", "forward", "reload", "handle_dialog", "upload", "download", "close_page", "open_page", "list_pages"]);

function normalizeBrowserInput(input) {
  const action = { ...input, tabId: input.tabId || input.pageId };
  if (!action.target && input.selector && ["click", "double_click", "type", "select", "hover", "move", "upload", "scroll"].includes(input.action)) action.target = { kind: "selector", selector: input.selector };
  if (input.action === "select") action.text = input.text ?? input.option ?? input.value;
  if (input.action === "extract") { action.type = input.extract?.type || input.type || "text"; action.attribute = input.extract?.attribute || input.attribute; action.selector = input.extract?.selector || input.selector; }
  if (input.action === "open_page") { action.purpose ||= "assessment"; action.identityId ??= null; }
  if (input.action === "wait") action.waitMs ??= 0;
  return action;
}

function checkAction(input, tabId) {
  const action = normalizeBrowserInput(input);
  const fields = {
    navigate: ["url"], click: ["target"], double_click: ["target"], move: ["target"], hover: ["target"], type: ["target", "text"], select: ["target", "text"],
    insert_text: ["text"], press_key: ["key"], scroll: ["target", "deltaX", "deltaY"], drag: ["from", "to"], wait: ["waitMs"], extract: ["selector", "type", "attribute"],
    handle_dialog: ["accept", "text"], upload: ["target", "paths"], download: ["downloadId"], open_page: ["purpose", "identityId", "url"],
  }[action.action] || [];
  const canonical = { action: action.action, ...(!["open_page", "list_pages"].includes(action.action) ? { tabId } : {}) };
  for (const key of fields) if (action[key] !== undefined) canonical[key] = action[key];
  // Aggregate extraction is a legacy spelling of a bounded document extract.
  if (canonical.type === "all") canonical.type = "text";
  const checked = validateBrowserContract("action", canonical);
  if (!checked.ok) throw fail(checked.error.code, checked.error.message);
  return { ...action, ...canonical };
}

async function workspaceUploadPaths(workspace, paths) {
  const root = await fs.realpath(workspace);
  return Promise.all(paths.map(async input => {
    const resolved = await fs.realpath(path.resolve(root, input));
    const relative = path.relative(root, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw fail("BROWSER_UPLOAD_OUTSIDE_WORKSPACE", "Browser uploads must be files inside this project workspace.");
    if (!(await fs.stat(resolved)).isFile()) throw fail("BROWSER_UPLOAD_INVALID", "Browser upload paths must refer to regular files.");
    return resolved;
  }));
}

function createNativeBrowserProvider({ getService, activate, artifactStore = null, visual = null, assertVision = null } = {}) {
  if (typeof getService !== "function") throw new TypeError("A native browser service factory is required.");
  const observations = createBrowserObservations({ artifactStore });
  const live = (service, id) => {
    const tab = service.list().find(item => item.id === id);
    if (!tab) throw fail("BROWSER_TAB_UNAVAILABLE", "The browser tab is no longer available.");
    return tab;
  };
  const own = (tab, sessionId) => {
    if (tab.owner.kind !== "chat" || tab.owner.sessionId !== sessionId) throw fail("BROWSER_TAB_NOT_OWNED", "This chat does not control this browser tab. Ask the user to hand it over from the browser workspace.");
  };
  async function targetFor(target, page, tab) {
    if (target.kind === "element") return { element: await observations.resolve(target, page, tab), owned: true };
    if (target.kind === "selector") {
      const element = page.locator(target.selector);
      if (await element.count() !== 1) throw fail("BROWSER_TARGET_AMBIGUOUS", "The selector must identify exactly one element. Observe the page and use an element reference.");
      return { element, owned: false };
    }
    if (!visual?.resolve) throw fail("BROWSER_VISUAL_UNAVAILABLE", "Screenshot coordinates are unavailable.");
    return { point: await visual.resolve(target, page, tab) };
  }
  async function pointFor(target, page, tab) {
    const resolved = await targetFor(target, page, tab);
    try {
      if (resolved.point) return resolved.point;
      const box = await resolved.element.boundingBox();
      if (!box) throw fail("BROWSER_TARGET_HIDDEN", "The referenced browser element is not visible.");
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    } finally { if (resolved.owned) await resolved.element.dispose(); }
  }
  async function pointer(page, point, phase = "move") { await visual?.pointer?.(page, point, phase); }
  async function execute(raw, context, runtime = {}) {
    const checkStopped = () => { if (runtime.signal?.aborted) throw fail("BROWSER_ACTION_STOPPED", "Browser action stopped."); };
    checkStopped();
    if (!ACTIONS.has(raw.action)) throw fail("INVALID_BROWSER_ACTION_INPUT", "Unknown browser action.");
    checkAction(raw, raw.tabId || raw.pageId || "browser-pending");
    const service = getService();
    await activate?.(context, { ...raw, purpose: raw.purpose || (raw.action === "open_page" ? "assessment" : "research") });
    checkStopped();
    const sessionId = context.browserSessionId || context.sessionId;
    if (!sessionId) throw fail("BROWSER_CHAT_REQUIRED", "Browser actions require the current chat identity.");
    if (raw.action === "list_pages") return { backend: "native-workspace", projectId: service.status().projectId, tabs: service.list() };
    if (raw.action === "open_page") {
      const input = checkAction(raw);
      let tab = await service.open({ purpose: input.purpose, identityId: input.identityId, url: "about:blank" });
      let handedOff = false;
      try {
        checkStopped();
        tab = await service.handoff(tab.id, sessionId, tab.controlGeneration);
        handedOff = true;
        checkStopped();
        service.select(tab.id);
        return await service.withPage(tab.id, sessionId, tab.controlGeneration, async page => {
          if (input.url && input.url !== "about:blank") await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: Math.min(120000, Math.max(100, Number(input.timeoutMs) || 15000)) });
          return { backend: "native-workspace", projectId: tab.projectId, tab: live(service, tab.id), observation: await observations.capture(page, live(service, tab.id)) };
        }, { signal: runtime.signal, deadline: runtime.deadline });
      } catch (error) {
        if (runtime.signal?.aborted) {
          observations.forget(tab.id);
          const current = service.list().find(item => item.id === tab.id);
          if (!handedOff && current?.controlGeneration === tab.controlGeneration) await service.close(tab.id).catch(() => {});
          else if (current?.owner.kind === "chat" && current.owner.sessionId === sessionId) {
            await service.closeOwned(tab.id, sessionId, current.controlGeneration).catch(() => {});
          }
        }
        throw error;
      }
    }
    const input = normalizeBrowserInput(raw);
    const owned = service.list().filter(tab => tab.owner.kind === "chat" && tab.owner.sessionId === sessionId);
    const tabId = input.tabId || (owned.length === 1 ? owned[0].id : null);
    if (!tabId) throw fail("BROWSER_TAB_REQUIRED", "Specify tabId from list_pages, or open a browser tab. Only a uniquely owned tab can be selected automatically.");
    let tab = live(service, tabId); own(tab, sessionId);
    // The authority decision was made against this tab as it was then. A
    // takeover or a navigation while approval was pending voids it.
    const expected = runtime.expectedTab;
    if (expected?.id === tabId && (tab.controlGeneration !== expected.controlGeneration || originOf(tab.url) !== originOf(expected.url))) {
      throw fail("BROWSER_SCOPE_CHANGED", "The page changed after this action was checked. Observe again before acting.");
    }
    checkAction(input, tabId);
    const evidence = result => ({ backend: "native-workspace", projectId: tab.projectId, tab: live(service, tabId), ...result });
    if (input.action === "close_page") {
      if (!service.closeOwned) throw fail("BROWSER_PROVIDER_UNAVAILABLE", "The browser service cannot safely close an agent-owned tab.");
      await service.closeOwned(tabId, sessionId, tab.controlGeneration, { signal: runtime.signal }); observations.forget(tabId);
      return { backend: "native-workspace", projectId: tab.projectId, tabId, closed: true };
    }
    if (input.action === "handle_dialog") {
      if (!service.handleDialog) throw fail("BROWSER_DIALOG_UNAVAILABLE", "There is no managed browser dialog.");
      const result = await service.handleDialog(tabId, { accept: input.accept, text: input.text, sessionId, generation: tab.controlGeneration });
      return evidence({ result });
    }
    if (input.action === "download") {
      if (!service.download) throw fail("BROWSER_DOWNLOAD_UNAVAILABLE", "This browser download is unavailable.");
      return evidence({ result: await service.download(tabId, input.downloadId) });
    }
    if (input.action === "screenshot") {
      const guard = runtime.assertVision || assertVision;
      if (!guard) throw fail("BROWSER_VISION_UNAVAILABLE", "The selected model's image capability has not been verified.");
      await guard(context, runtime);
      checkStopped();
      if (!visual?.capture) throw fail("BROWSER_VISUAL_UNAVAILABLE", "Browser screenshot capture is unavailable.");
    }
    const pending = service.getDialog?.(tabId);
    if (pending) return evidence({ dialog: pending, message: "Handle the pending dialog before continuing." });
    return service.withPage(tabId, sessionId, tab.controlGeneration, async page => {
      const timeout = Math.min(120000, Math.max(100, Number(input.timeoutMs) || 15000));
      const options = { timeout };
      const perform = async () => {
        tab = live(service, tabId);
        if (input.action === "screenshot") return { screenshot: await visual.capture(page, tab) };
        if (["navigate", "reload", "back", "forward"].includes(input.action)) {
          if (input.action === "navigate") await page.goto(input.url, { ...options, waitUntil: "domcontentloaded" });
          else if (input.action === "reload") await page.reload({ ...options, waitUntil: "domcontentloaded" });
          else await page[input.action === "back" ? "goBack" : "goForward"]({ ...options, waitUntil: "domcontentloaded" });
        } else if (["click", "double_click", "move", "hover", "type", "select", "upload"].includes(input.action)) {
          const resolved = await targetFor(input.target, page, tab);
          try {
            const point = resolved.point || await resolved.element.boundingBox().then(box => box && ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
            if (point) await pointer(page, point, input.action === "click" || input.action === "double_click" ? "click" : "move");
            if (resolved.point) {
              await page.mouse.move(point.x, point.y);
              if (input.action === "click") await page.mouse.click(point.x, point.y);
              else if (input.action === "double_click") await page.mouse.dblclick(point.x, point.y);
              else if (input.action === "type") { await page.mouse.click(point.x, point.y); await page.keyboard.insertText(input.text); }
              else if (!["move", "hover"].includes(input.action)) throw fail("BROWSER_TARGET_INVALID", "This action requires an element reference or selector.");
            } else if (input.action === "type") await resolved.element.fill(input.text, options);
            else if (input.action === "select") {
              const option = await resolved.element.evaluate((node, text) => {
                const choices = Array.from(node.options || []);
                return choices.find(option => option.value === text)?.value ?? choices.find(option => option.label === text)?.value ?? null;
              }, input.text);
              if (option === null) throw fail("BROWSER_OPTION_UNAVAILABLE", "The select element has no matching option value or label.");
              await resolved.element.selectOption(option, options);
            }
            else if (input.action === "upload") await resolved.element.setInputFiles(await workspaceUploadPaths(context.workspace?.root || context.workspace, input.paths), options);
            else await resolved.element[input.action === "double_click" ? "dblclick" : input.action === "move" ? "hover" : input.action](options);
          } finally { if (resolved.owned) await resolved.element.dispose().catch(() => {}); }
        } else if (input.action === "insert_text") await page.keyboard.insertText(input.text);
        else if (input.action === "press_key") await page.keyboard.press(input.key);
        else if (input.action === "scroll") {
          if (input.target) { const point = await pointFor(input.target, page, tab); await pointer(page, point); await page.mouse.move(point.x, point.y); }
          await page.mouse.wheel(input.deltaX, input.deltaY);
        } else if (input.action === "drag") {
          const from = await pointFor(input.from, page, tab), to = await pointFor(input.to, page, tab);
          await pointer(page, from, "down"); await page.mouse.move(from.x, from.y); await page.mouse.down();
          try { await pointer(page, to); await page.mouse.move(to.x, to.y, { steps: 12 }); }
          finally { await page.mouse.up(); await pointer(page, to, "up"); }
        } else if (input.action === "wait") await page.waitForTimeout(input.waitMs);
        else if (input.action === "extract") {
          const type = input.type, selector = input.selector || "body";
          let result;
          if (type === "url") result = page.url();
          else if (type === "title") result = await page.title();
          else if (type === "html") result = await page.locator(selector).evaluate(node => { const clone = node.cloneNode(true); for (const pointer of clone.querySelectorAll("[data-xekute-pointer]")) pointer.remove(); for (const input of clone.querySelectorAll("input[type=password]")) input.removeAttribute("value"); if (clone.matches?.("input[type=password]")) clone.removeAttribute("value"); return clone.outerHTML.slice(0, 64000); });
          else if (type === "attribute") {
            const element = page.locator(selector);
            result = await element.evaluate((node, attribute) => node.matches("input[type=password]") && attribute.toLowerCase() === "value" ? "[redacted]" : node.getAttribute(attribute), input.attribute);
          } else result = await page.locator(selector).evaluate(node => (node.innerText || node.textContent || "").slice(0, 256001));
          const text = String(result ?? ""), bounded = text.slice(0, 12000);
          let artifactId;
          if (text.length > bounded.length && artifactStore) { const artifact = await artifactStore.put({ projectId: tab.projectId, kind: "observation", mimeType: "text/plain", data: Buffer.from(text.slice(0, 256000)), metadata: { tabId, truncated: text.length > 256000 } }); artifactId = artifact.id || artifact.artifactId; }
          return { result: { type, text: bounded, truncated: text.length > bounded.length, ...(artifactId ? { artifactId } : {}) } };
        }
        return {};
      };
      let notifyDialog, hasPendingDialog = false;
      const dialogOpened = new Promise(resolve => { notifyDialog = resolve; });
      const onDialog = () => { hasPendingDialog = true; notifyDialog({ pendingDialog: true }); };
      page.on("dialog", onDialog);
      try {
        const result = await Promise.race([perform(), dialogOpened]);
        const dialog = service.getDialog?.(tabId);
        if (dialog || result.pendingDialog) return evidence({ ...result, ...(dialog ? { dialog } : {}), message: "Handle the pending dialog before continuing." });
        return evidence({ ...result, observation: await observations.capture(page, live(service, tabId)), ...(service.listDownloads ? { downloads: service.listDownloads(tabId) } : {}) });
      } catch (error) {
        if (error.code !== "BROWSER_OBSERVATION_STALE" && !(/element.*(?:not attached|detached)|frame was detached/i.test(error.message) && [input.target, input.from, input.to].some(target => target?.kind === "element"))) throw error;
        return { ok: false, error: { code: "BROWSER_OBSERVATION_STALE", message: error.message, retryable: false }, value: { observation: await observations.capture(page, live(service, tabId)) } };
      } finally {
        // Playwright dismisses outstanding dialogs when its last listener is
        // removed. Keep it until the lease transport closes and the native
        // service takes responsibility for the pending dialog.
        if (!hasPendingDialog) page.off("dialog", onDialog);
      }
    }, { signal: runtime.signal, deadline: runtime.deadline });
  }
  return Object.freeze({ async execute(input, context, runtime = {}) {
    const controller = new AbortController();
    const timeout = Math.min(120000, Math.max(100, Number(input.timeoutMs) || 15000, input.action === "wait" ? Number(input.waitMs || 0) + 1000 : 0));
    const deadline = Date.now() + timeout;
    const abort = () => controller.abort(fail("BROWSER_ACTION_STOPPED", "Browser action stopped."));
    const stopped = new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    const timer = setTimeout(() => controller.abort(fail("BROWSER_ACTION_TIMEOUT", `Browser action exceeded ${timeout}ms, including setup and observation. Continue with another page; observe before retrying an action that may have completed.`)), timeout);
    runtime.signal?.addEventListener("abort", abort, { once: true });
    if (runtime.signal?.aborted) abort();
    try { return await Promise.race([execute(input, context, { ...runtime, signal: controller.signal, deadline }), stopped]); }
    catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error.name === "TimeoutError") throw fail("BROWSER_ACTION_TIMEOUT", `${error.message} Continue with another page; observe before retrying an action that may have completed.`);
      throw error;
    } finally {
      clearTimeout(timer);
      runtime.signal?.removeEventListener("abort", abort);
    }
  }, describe: (tabId, target) => observations.describe(tabId, target), close() { observations.clear(); } });
}

module.exports = { createNativeBrowserProvider, normalizeBrowserInput, workspaceUploadPaths };
