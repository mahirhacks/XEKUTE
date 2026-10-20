import {
  openTabs, showCodeEditorWorkspace, SECURITY_TOOL_META, renderTabs, commitActiveTab,
  renderEditor, setTerminalMaximized, setSecurityStatus, openBrowserTab, securityDrafts,
  securityExchangeSignature, syncSecurityExchangeSizes, setSecurityTool,
  ingestLiveSecurityHistory, refreshSecurityHistoryIfVisible,
} from "../../bootstrap.js";
import { appState } from "../../core/app-state.js";
import {
  securityInterceptToggle, securityInterceptToggleIcon, securityInterceptToggleLabel,
  proxyListenerStatus, proxyCaPath, securityProxyBrowser, securityProxyBrowserMenu,
  securityDropButton, securityRequestEditor, securityResponseEditor,
} from "../../core/dom-refs.js";
import {
  refreshAssessmentSettingsCache, saveAssessmentSettings,
} from "../settings/settings-tab-editor.js";
import { escapeHtml } from "../../core/text-format.js";
import { identityRecordList } from "../settings/identity-settings.js";

export const INTERCEPTOR_TAB_PATH = "xekute:interceptor";

export function openInterceptorTab(tool = "") {
  showCodeEditorWorkspace();
  const requestedTool = SECURITY_TOOL_META[tool] ? tool : "";
  const existingTab = openTabs.get(INTERCEPTOR_TAB_PATH);
  if (existingTab) {
    if (requestedTool) existingTab.securityTool = requestedTool;
    switchToInterceptorTab();
    return;
  }
  openTabs.set(INTERCEPTOR_TAB_PATH, {
    path: INTERCEPTOR_TAB_PATH,
    diskPath: INTERCEPTOR_TAB_PATH,
    name: "Interceptor",
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
    special: "interceptor",
    securityTool: requestedTool,
  });
  renderTabs();
  switchToInterceptorTab();
}

export function switchToInterceptorTab() {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  commitActiveTab();
  appState.activeTabPath = INTERCEPTOR_TAB_PATH;
  appState.editorLoadedPath = null;
  renderTabs();
  renderEditor({ focusEditor: false });
}

export function isInterceptorTab(tab) {
  return tab?.path === INTERCEPTOR_TAB_PATH || tab?.special === "interceptor";
}

export function isInterceptionActive(settings = appState.assessmentSettingsCache) {
  return Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
}

export function syncInterceptorToggleUi(settings = appState.assessmentSettingsCache) {
  if (!securityInterceptToggle) return;
  const active = isInterceptionActive(settings);
  securityInterceptToggle.classList.toggle("active", active);
  securityInterceptToggle.setAttribute("aria-pressed", String(active));
  securityInterceptToggle.disabled = !appState.assessmentPath;
  if (securityInterceptToggleLabel) {
    securityInterceptToggleLabel.textContent = active ? "Intercept On" : "Intercept Off";
  }
  if (securityInterceptToggleIcon) {
    securityInterceptToggleIcon.classList.toggle("codicon-debug-pause", active);
    securityInterceptToggleIcon.classList.toggle("codicon-debug-start", !active);
  }
}

export async function toggleInterceptorCapture() {
  if (!appState.assessmentPath) {
    setSecurityStatus("Create or open a project first", "error");
    return;
  }
  const requestedAssessment = appState.assessmentPath;
  const requestedWorkspace = appState.rootPath;
  const current = appState.assessmentSettingsCache || (await refreshAssessmentSettingsCache())?.settings;
  if (appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace) return;
  if (!current) {
    setSecurityStatus("Could not read project runtime settings", "error");
    return;
  }
  const nextSettings = JSON.parse(JSON.stringify(current));
  if (!nextSettings.interception || typeof nextSettings.interception !== "object") nextSettings.interception = {};
  const turningOn = !isInterceptionActive(nextSettings);
  nextSettings.interception.enabled = turningOn;
  nextSettings.interception.interceptRequests = turningOn;
  if (turningOn) {
    if (!nextSettings.listener || typeof nextSettings.listener !== "object") nextSettings.listener = {};
    nextSettings.listener.enabled = true;
  }
  const result = await saveAssessmentSettings(nextSettings);
  if (appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace) return;
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  setSecurityStatus(turningOn ? "Request interception enabled" : "Request interception disabled — traffic passes through");
}

export function syncProxyListenerUi(nextState = {}) {
  appState.proxyListenerState = { ...appState.proxyListenerState, ...nextState };
  if (proxyListenerStatus) {
    proxyListenerStatus.classList.toggle("running", Boolean(appState.proxyListenerState.running && !appState.proxyListenerState.warning));
    proxyListenerStatus.classList.toggle("error", Boolean(appState.proxyListenerState.error || appState.proxyListenerState.warning));
    proxyListenerStatus.textContent = appState.proxyListenerState.error
      ? appState.proxyListenerState.error
      : appState.proxyListenerState.running
        ? appState.proxyListenerState.warning || `Listening on ${appState.proxyListenerState.host}:${appState.proxyListenerState.port} - ${appState.proxyListenerState.targetCount ?? 0} scoped target${appState.proxyListenerState.targetCount === 1 ? "" : "s"}`
        : "Stopped";
  }
  if (proxyCaPath) proxyCaPath.value = appState.proxyListenerState.caCertPath || "Generated when the listener starts";
  if (appState.selectedSecurityTool === "interceptor" && appState.proxyListenerState.running && !appState.currentProxyCaptureId) {
    setSecurityStatus(appState.proxyListenerState.warning || `Listening on ${appState.proxyListenerState.host}:${appState.proxyListenerState.port}`,
      appState.proxyListenerState.warning ? "error" : "");
  }
}

export async function configureProxyListener() {
  const requestGeneration = ++appState.proxyConfigurationGeneration;
  const requestedAssessment = appState.assessmentPath;
  const requestedWorkspace = appState.rootPath;
  try {
    const result = await window.api.proxyConfigure({
      assessmentPath: requestedAssessment,
    });
    if (requestGeneration !== appState.proxyConfigurationGeneration || appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace) return result;
    syncProxyListenerUi(result || {});
    return result;
  } catch (error) {
    const result = { error: error?.message || "Proxy listener configuration failed", running: false };
    if (requestGeneration !== appState.proxyConfigurationGeneration || appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace) return result;
    syncProxyListenerUi(result);
    return result;
  }
}

export function syncProxyBrowserUi(status = {}) {
  const button = document.getElementById("security-proxy-browser") || securityProxyBrowser;
  if (!button) return;
  const running = Boolean(status.running);
  button.classList.toggle("active", running);
  button.setAttribute("aria-pressed", String(running));
  button.title = running
    ? `${status.browser === "edge" ? "Edge" : "Chrome"} is open through ${status.proxyHost || "127.0.0.1"}:${status.proxyPort || "proxy"}${status.agentShareAvailable ? "; matching agent browser actions can share it" : ""}`
    : "Open browser. Right-click to open a tab with an identity.";
}

export function closeProxyBrowserMenu() {
  const menu = document.getElementById("security-proxy-browser-menu") || securityProxyBrowserMenu;
  const button = document.getElementById("security-proxy-browser") || securityProxyBrowser;
  if (menu) {
    menu.hidden = true;
    menu.style.position = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.left = "";
    menu.style.zIndex = "";
    if (appState.proxyBrowserMenuHome && menu.parentElement !== appState.proxyBrowserMenuHome) appState.proxyBrowserMenuHome.appendChild(menu);
  }
  button?.setAttribute("aria-expanded", "false");
}

export function positionProxyBrowserMenu() {
  const menu = document.getElementById("security-proxy-browser-menu") || securityProxyBrowserMenu;
  const button = document.getElementById("security-proxy-browser") || securityProxyBrowser;
  if (!menu || !button) return;
  if (!appState.proxyBrowserMenuHome) appState.proxyBrowserMenuHome = menu.parentElement;
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.round(rect.bottom + 4)}px`;
  menu.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`;
  menu.style.left = "auto";
  menu.style.zIndex = "12000";
}

export async function chooseProxyBrowserIdentity() {
  if (!appState.assessmentPath) return launchProxyBrowser("");
  let identities = [];
  try {
    const snapshot = await window.api.identitiesGet?.({ workspace: appState.assessmentPath });
    identities = identityRecordList(snapshot);
  } catch { identities = []; }
  if (!identities.length) return launchProxyBrowser("");
  const menu = document.getElementById("security-proxy-browser-menu") || securityProxyBrowserMenu;
  const button = document.getElementById("security-proxy-browser") || securityProxyBrowser;
  if (!menu || !button) return launchProxyBrowser("");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-proxy-identity=""><span class="codicon codicon-globe"></span><strong>Anonymous browser</strong><small>Separate unlabeled capture profile</small></button>
    ${identities.map((identity) => `<button type="button" role="menuitem" data-proxy-identity="${escapeHtml(identity.identityId)}"><span class="codicon codicon-account"></span><strong>${escapeHtml(identity.name || identity.identityId)}</strong><small>${escapeHtml(identity.role || "user")} · ${escapeHtml(identity.authStatus || "manual browser session")}</small></button>`).join("")}`;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  positionProxyBrowserMenu();
  setSecurityStatus("Choose Anonymous or an identity for the proxied browser.");
  menu.querySelector("button")?.focus();
}

export async function launchProxyBrowser(identityId = "") {
  if (!appState.assessmentPath) {
    setSecurityStatus("Create or open a project first", "error");
    return;
  }
  const button = document.getElementById("security-proxy-browser") || securityProxyBrowser;
  if (!window.api.browserOpen || button?.disabled) return;
  const icon = button?.querySelector(".codicon");
  if (button) button.disabled = true;
  if (icon) icon.className = "codicon codicon-loading codicon-modifier-spin";
  setSecurityStatus("Opening browser workspace…");
  try {
    closeProxyBrowserMenu();
    openBrowserTab();
    await appState.browserWorkspace?.open({ identityId: String(identityId || ""), purpose: "assessment" });
  } catch (error) {
    setSecurityStatus(error?.message || "The browser could not be opened.", "error");
  } finally {
    if (icon) icon.className = "codicon codicon-globe";
    if (button) button.disabled = false;
  }
}

export function handleProxyCapture(payload = {}) {
  const phase = payload.phase;
  if (phase === "error") {
    if (payload.id === appState.currentProxyCaptureId) setSecurityStatus(payload.error || "Proxy capture failed", "error");
    return;
  }
  if (phase === "status") {
    if (payload.id === appState.currentProxyCaptureId) setSecurityStatus(payload.status || "Updated");
    return;
  }

  const intercepting = Boolean(payload.paused) || Boolean(appState.currentProxyCaptureId) || isInterceptionActive();
  if (intercepting) {
    const draft = securityDrafts.get("interceptor") || {};
    if (payload.request != null) draft.request = String(payload.request);
    if (payload.response != null) draft.response = String(payload.response);
    securityDrafts.set("interceptor", draft);

    if (appState.currentSidebarView === "project") {
      if (appState.selectedSecurityTool !== "interceptor") setSecurityTool("interceptor");
      if (payload.request != null) securityRequestEditor.value = String(payload.request);
      if (payload.response != null) securityResponseEditor.value = String(payload.response);
      syncSecurityExchangeSizes();
    }
  }

  if (phase === "request") {
    appState.currentProxyCaptureId = payload.paused ? String(payload.id || "") : "";
    securityDropButton.hidden = !payload.paused;
    setSecurityStatus(payload.paused ? `Intercepted ${payload.url} - waiting for Forward or Drop` : `Captured ${payload.url}`);
  } else if (phase === "request-complete") {
    setSecurityStatus(`Request body captured for ${payload.url}`);
  } else if (phase === "response-headers") {
    setSecurityStatus(`Receiving ${payload.url}`);
  } else if (phase === "response") {
    appState.currentProxyCaptureId = "";
    securityDropButton.hidden = true;
    appState.lastLoggedSecuritySignature = securityExchangeSignature();
    setSecurityStatus(`Captured and logged ${payload.logged?.timestamp || ""}`, payload.logged?.error ? "error" : "success");
    if (payload.history) ingestLiveSecurityHistory(payload.history);
    else refreshSecurityHistoryIfVisible();
  }
}
