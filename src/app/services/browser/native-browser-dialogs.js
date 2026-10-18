"use strict";

const { randomUUID } = require("node:crypto");
const eventNames = new WeakMap();

function receiver(eventName) {
  const current = window.prompt;
  if (typeof current !== "function" || current.name !== ""
    || !Function.prototype.toString.call(current).includes("[native code]")) return;
  window.prompt = function xekutePrompt(message = "", defaultValue = "") {
    const request = document.createElement("xekute-prompt-request");
    request.hidden = true;
    request.setAttribute("message", String(message));
    request.setAttribute("default-value", String(defaultValue));
    try {
      document.documentElement.appendChild(request);
      request.dispatchEvent(new Event(eventName, { bubbles: true }));
      return request.hasAttribute("accepted") ? request.getAttribute("result") : null;
    } finally { request.remove(); }
  };
}

function nativeHandler(eventName) {
  if (globalThis.__xekutePromptHandler === eventName) return;
  const prompt = window.prompt.bind(window);
  document.addEventListener(eventName, event => {
    const request = event.target;
    if (request.localName !== "xekute-prompt-request" || !request.isConnected || request.hasAttribute("handled")) return;
    request.setAttribute("handled", "");
    const result = prompt(request.getAttribute("message"), request.getAttribute("default-value"));
    if (result !== null) {
      request.setAttribute("result", result);
      request.setAttribute("accepted", "");
    }
  });
  globalThis.__xekutePromptHandler = eventName;
}

async function prepareBrowserDialogs(contents, page) {
  // Electron replaces prompt in the main world. The isolated world still has
  // Chromium's native function. A synchronous DOM event carries only prompt
  // strings to that world. No function, preload, or application API is exposed.
  const eventName = eventNames.get(contents) || `xekute-prompt-${randomUUID()}`;
  eventNames.set(contents, eventName);
  const receive = `(${receiver.toString()})(${JSON.stringify(eventName)})`;
  const send = `(${nativeHandler.toString()})(${JSON.stringify(eventName)})`;
  const ids = [];
  const cleanup = async () => {
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    await Promise.allSettled(ids.map(identifier => contents.debugger.sendCommand("Page.removeScriptToEvaluateOnNewDocument", { identifier })));
  };
  try {
    ids.push((await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: receive })).identifier);
    ids.push((await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: send, worldName: "xekute-native-dialogs" })).identifier);
    await page.evaluate(receiver, eventName);
    const { frameTree } = await contents.debugger.sendCommand("Page.getFrameTree");
    const { executionContextId } = await contents.debugger.sendCommand("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "xekute-native-dialogs" });
    const evaluated = await contents.debugger.sendCommand("Runtime.evaluate", { expression: send, contextId: executionContextId });
    if (evaluated.exceptionDetails) throw new Error("The native browser prompt adapter could not initialize.");
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

module.exports = { prepareBrowserDialogs };
