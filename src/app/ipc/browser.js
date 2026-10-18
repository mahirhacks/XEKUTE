"use strict";

const path = require("node:path");
const { channels, validateBrowserIpcRequest } = require("../../contracts/browser/browser-ipc.js");

function registerBrowserIpc({ ipcMain, container, getMainWindow }) {
  const fail = (code, message) => ({ ok: false, error: { code, message, retryable: false } });
  let admission = Promise.resolve();
  function admit(task) {
    const pending = admission.then(task);
    admission = pending.catch(() => {});
    return pending;
  }
  function trusted(event) {
    const window = getMainWindow();
    return window && !window.isDestroyed() && event?.sender === window.webContents
      && !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame;
  }
  function workspaceOf(payload) { return path.resolve(payload.assessmentPath); }
  function identities(workspace) {
    const result = container.identityVault().list(workspace);
    if (result?.ok === false) throw Object.assign(new Error(result.error?.message || result.error || "Browser identities are unavailable."), { code: result.code || result.error?.code });
    return result?.value?.identities || [];
  }
  function requireProject(service, workspace) {
    if (service.status().projectId !== container.identityVault().projectIdFor(workspace)) throw Object.assign(new Error("This browser tab belongs to another project."), { code: "BROWSER_PROJECT_MISMATCH" });
  }
  const handlers = {
    "browser:open": async payload => {
      const started = await admit(async () => {
        const workspace = workspaceOf(payload), service = container.nativeBrowser();
        await container.activateNativeBrowser(workspace, payload.purpose);
        const metadata = identities(workspace);
        if (payload.identityId && !metadata.some(identity => identity.identityId === payload.identityId)) throw Object.assign(new Error("The browser identity no longer exists."), { code: "BROWSER_IDENTITY_UNAVAILABLE" });
        return { service, metadata, opening: service.open({ purpose: payload.purpose, identityId: payload.identityId || null, url: payload.url || "about:blank" }) };
      });
      const tab = await started.opening;
      return { ok: true, tab, tabs: started.service.list(), identities: started.metadata };
    },
    "browser:list": payload => admit(async () => {
      const workspace = workspaceOf(payload), service = container.nativeBrowser();
      await container.activateNativeBrowser(workspace, "research");
      return { ok: true, tabs: service.list(), identities: identities(workspace) };
    }),
    "browser:command": async payload => {
      const started = await admit(() => {
        const service = container.nativeBrowser();
        requireProject(service, workspaceOf(payload));
        if (!service.list().some(tab => tab.id === payload.tabId)) throw Object.assign(new Error("The browser tab is no longer available."), { code: "BROWSER_TAB_UNAVAILABLE" });
        let command;
        switch (payload.command) {
          case "navigate": command = service.navigate(payload.tabId, payload.url); break;
          case "back": command = service.back(payload.tabId); break;
          case "forward": command = service.forward(payload.tabId); break;
          case "reload": command = service.reload(payload.tabId); break;
          case "close": command = service.close(payload.tabId); break;
          case "handoff": command = service.handoff(payload.tabId, payload.sessionId, payload.expectedGeneration); break;
          case "takeover": command = service.takeover(payload.tabId, payload.expectedGeneration); break;
        }
        return { service, command };
      });
      await started.command;
      requireProject(started.service, workspaceOf(payload));
      return { ok: true, tabs: started.service.list(), tab: started.service.list().find(tab => tab.id === payload.tabId) || null };
    },
    "browser:layout": payload => admit(() => {
      const service = container.nativeBrowser();
      requireProject(service, workspaceOf(payload));
      const tab = service.layout(payload.tabId, payload.bounds);
      if (payload.visible) service.select(payload.tabId); else service.hide();
      return { ok: true, tab };
    }),
    "browser:hide": () => admit(() => { container.hideNativeBrowser?.(); return { ok: true }; }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (event, payload) => {
    if (!trusted(event)) return fail("UNTRUSTED_RENDERER", "Only the application window can control browser tabs.");
    const issue = validateBrowserIpcRequest(channel, [payload]);
    if (issue) return fail(issue.code, issue.message);
    try { return await handler(payload); }
    catch (error) { return fail(error.code || "BROWSER_OPERATION_FAILED", error.message); }
  });
}

module.exports = { channels, registerBrowserIpc };
