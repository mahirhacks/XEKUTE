import { appState } from "../../core/app-state.js";
import {
  securityRequestEditor, securityResponseEditor, securityRepeaterTabList, securityRepeaterPrev,
  securityRepeaterNext, securityRepeaterPosition, securityPayloadEditor,
} from "../../core/dom-refs.js";
import {
  syncSecurityExchangeSizes, setSecurityStatus, intruderSlots, syncIntruderUi, setAttackType,
  setIntruderTab, renderIntruderResults,
} from "../../bootstrap.js";

export const securityDrafts = new Map();
export const DEFAULT_SECURITY_REQUEST = "GET / HTTP/1.1\nHost: authorized.example\nAccept: */*";
export const INTRUDER_ATTACK_TYPES = ["sniper", "battering-ram", "pitchfork", "cluster-bomb"];
export const DEFAULT_INTRUDER_PAYLOADS = '{"value":["test"]}';

export function repeaterTabLabel(request) {
  const line = String(request || "").split("\n")[0].trim();
  const match = line.match(/^([A-Z]+)\s+(\S+)/);
  if (!match) return "New request";
  const path = match[2].replace(/^https?:\/\/[^/]+/i, "") || "/";
  return `${match[1]} ${path.length > 20 ? `${path.slice(0, 19)}…` : path}`;
}

export function activeRepeaterTab() {
  return appState.securityRepeaterTabState.find((tab) => tab.id === appState.securityActiveRepeaterTab) || null;
}

export function captureRepeaterTab() {
  const tab = activeRepeaterTab();
  if (!tab) return;
  tab.request = securityRequestEditor?.value || "";
  tab.response = securityResponseEditor?.value || "";
  tab.name = repeaterTabLabel(tab.request);
}

export function renderRepeaterTabs() {
  if (!securityRepeaterTabList || appState.selectedSecurityTool !== "repeater") return;
  securityRepeaterTabList.innerHTML = "";
  appState.securityRepeaterTabState.forEach((tab, index) => {
    const active = tab.id === appState.securityActiveRepeaterTab;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `security-repeater-tab${active ? " active" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.title = tab.name;
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${tab.name}`;
    const close = document.createElement("span");
    close.className = "security-repeater-tab-close";
    close.title = "Close tab";
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeRepeaterTab(tab.id);
    });
    button.append(label, close);
    button.addEventListener("click", () => activateRepeaterTab(tab.id));
    securityRepeaterTabList.appendChild(button);
  });
}

export function renderRepeaterHistoryNav() {
  const tab = activeRepeaterTab();
  const total = tab?.history.length || 0;
  const position = total ? tab.historyIndex + 1 : 0;
  if (securityRepeaterPosition) securityRepeaterPosition.textContent = `${position} / ${total}`;
  if (securityRepeaterPrev) securityRepeaterPrev.disabled = !tab || tab.historyIndex <= 0;
  if (securityRepeaterNext) securityRepeaterNext.disabled = !tab || tab.historyIndex >= total - 1;
}

export function activateRepeaterTab(id) {
  if (appState.securityActiveRepeaterTab && appState.securityActiveRepeaterTab !== id) captureRepeaterTab();
  const tab = appState.securityRepeaterTabState.find((item) => item.id === id);
  if (!tab) return;
  appState.securityActiveRepeaterTab = tab.id;
  securityRequestEditor.value = tab.request;
  securityResponseEditor.value = tab.response;
  syncSecurityExchangeSizes();
  renderRepeaterTabs();
  renderRepeaterHistoryNav();
}

export function createRepeaterTab({ activate = true, request = "", response = "" } = {}) {
  appState.securityRepeaterSeq += 1;
  const tab = {
    id: `repeater-${appState.securityRepeaterSeq}`,
    request: request || DEFAULT_SECURITY_REQUEST,
    response: response || "",
    history: [],
    historyIndex: -1,
  };
  tab.name = repeaterTabLabel(tab.request);
  appState.securityRepeaterTabState.push(tab);
  if (activate) activateRepeaterTab(tab.id);
  else renderRepeaterTabs();
  return tab;
}

export function closeRepeaterTab(id) {
  const index = appState.securityRepeaterTabState.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = appState.securityActiveRepeaterTab === id;
  appState.securityRepeaterTabState.splice(index, 1);
  if (!appState.securityRepeaterTabState.length) {
    appState.securityActiveRepeaterTab = "";
    createRepeaterTab();
    return;
  }
  if (!wasActive) {
    renderRepeaterTabs();
    return;
  }
  appState.securityActiveRepeaterTab = "";
  activateRepeaterTab(appState.securityRepeaterTabState[Math.max(0, index - 1)].id);
}

export function pushRepeaterHistory(request, response, status, durationMs) {
  const tab = activeRepeaterTab();
  if (!tab) return;
  tab.history.push({ request, response, status, durationMs });
  if (tab.history.length > 50) tab.history.shift();
  tab.historyIndex = tab.history.length - 1;
  renderRepeaterHistoryNav();
}

export function stepRepeaterHistory(delta) {
  const tab = activeRepeaterTab();
  if (!tab?.history.length) return;
  const next = Math.max(0, Math.min(tab.history.length - 1, tab.historyIndex + delta));
  if (next === tab.historyIndex) return;
  tab.historyIndex = next;
  const entry = tab.history[next];
  securityRequestEditor.value = entry.request;
  securityResponseEditor.value = entry.response;
  tab.request = entry.request;
  tab.response = entry.response;
  syncSecurityExchangeSizes();
  renderRepeaterHistoryNav();
  setSecurityStatus(`Send ${next + 1} of ${tab.history.length} · ${entry.status || "no status"}${entry.durationMs ? ` in ${entry.durationMs} ms` : ""}`);
}

export function emptyIntruderTabState(request = "", response = "", payloads = "") {
  return {
    request: request || DEFAULT_SECURITY_REQUEST,
    response: response || "",
    payloads: payloads || DEFAULT_INTRUDER_PAYLOADS,
    attackType: "sniper",
    panel: "positions",
    template: "",
    results: [],
    selectedResult: -1,
  };
}

export function activeIntruderTab() {
  return appState.securityIntruderTabState.find((tab) => tab.id === appState.securityActiveIntruderTab) || null;
}

export function isUnusedIntruderTab(tab) {
  return Boolean(tab)
    && !(tab.results || []).length
    && (!String(tab.request || "").trim() || tab.request === DEFAULT_SECURITY_REQUEST)
    && !intruderSlots(tab.request).length;
}

export function captureIntruderTab() {
  const tab = activeIntruderTab();
  if (!tab) return;
  const onResults = appState.securityIntruderTab === "results";
  tab.payloads = securityPayloadEditor?.value || "";
  tab.attackType = appState.securityAttackTypeValue;
  tab.panel = appState.securityIntruderTab;
  tab.template = appState.securityIntruderTemplate;
  tab.results = appState.securityIntruderResults;
  tab.selectedResult = appState.securitySelectedResult;
  if (onResults && appState.securityIntruderTemplate) tab.request = appState.securityIntruderTemplate;
  else tab.request = securityRequestEditor?.value || tab.request || "";
  tab.response = securityResponseEditor?.value || "";
  tab.name = repeaterTabLabel(tab.request);
}

export function renderIntruderTabs() {
  if (!securityRepeaterTabList || appState.selectedSecurityTool !== "intruder") return;
  securityRepeaterTabList.innerHTML = "";
  appState.securityIntruderTabState.forEach((tab, index) => {
    const active = tab.id === appState.securityActiveIntruderTab;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `security-repeater-tab${active ? " active" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.title = tab.name;
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${tab.name}`;
    const close = document.createElement("span");
    close.className = "security-repeater-tab-close";
    close.title = "Close tab";
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeIntruderTab(tab.id);
    });
    button.append(label, close);
    button.addEventListener("click", () => activateIntruderTab(tab.id));
    securityRepeaterTabList.appendChild(button);
  });
}

export function activateIntruderTab(id) {
  if (appState.securityActiveIntruderTab && appState.securityActiveIntruderTab !== id) captureIntruderTab();
  const tab = appState.securityIntruderTabState.find((item) => item.id === id);
  if (!tab) return;
  appState.securityActiveIntruderTab = tab.id;
  appState.securityIntruderTemplate = tab.template || "";
  appState.securityIntruderResults = Array.isArray(tab.results) ? tab.results : [];
  appState.securitySelectedResult = Number.isInteger(tab.selectedResult) ? tab.selectedResult : -1;
  if (securityPayloadEditor) securityPayloadEditor.value = tab.payloads || DEFAULT_INTRUDER_PAYLOADS;
  setAttackType(tab.attackType || "sniper", { silent: true });
  const panel = tab.panel || "positions";
  appState.securityIntruderTab = panel;
  setIntruderTab(panel);
  if (panel === "results" && appState.securityIntruderResults[appState.securitySelectedResult]) {
    const selected = appState.securityIntruderResults[appState.securitySelectedResult];
    securityRequestEditor.value = selected.request || tab.request;
    securityResponseEditor.value = selected.response || "";
  } else {
    securityRequestEditor.value = tab.request || DEFAULT_SECURITY_REQUEST;
    securityResponseEditor.value = tab.response || "";
  }
  syncSecurityExchangeSizes();
  renderIntruderResults();
  syncIntruderUi();
  renderIntruderTabs();
}

export function createIntruderTab({ activate = true, request = "", response = "", payloads = "" } = {}) {
  appState.securityIntruderSeq += 1;
  const tab = {
    id: `intruder-${appState.securityIntruderSeq}`,
    ...emptyIntruderTabState(request, response, payloads),
  };
  tab.name = repeaterTabLabel(tab.request);
  appState.securityIntruderTabState.push(tab);
  if (activate) activateIntruderTab(tab.id);
  else renderIntruderTabs();
  return tab;
}

export function closeIntruderTab(id) {
  const index = appState.securityIntruderTabState.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = appState.securityActiveIntruderTab === id;
  appState.securityIntruderTabState.splice(index, 1);
  if (!appState.securityIntruderTabState.length) {
    appState.securityActiveIntruderTab = "";
    createIntruderTab();
    return;
  }
  if (!wasActive) {
    renderIntruderTabs();
    return;
  }
  appState.securityActiveIntruderTab = "";
  activateIntruderTab(appState.securityIntruderTabState[Math.max(0, index - 1)].id);
}

export function createWorkbenchTab() {
  if (appState.selectedSecurityTool === "intruder") createIntruderTab();
  else createRepeaterTab();
}
