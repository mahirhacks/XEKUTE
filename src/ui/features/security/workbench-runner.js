import {
  securityRequestEditor, securityResponseEditor, securityRequestSize, securityResponseSize,
  securityInspector, securityWorkbenchStatus, securityPayloadEditor, securityToolButton,
  securityToolMenu, securityToolIcon, securityToolLabel, securityWorkbench, securityWorkbenchMode,
  securityRepeaterTabs, securityRepeaterTabList, securityRepeaterAdd, securityRepeaterHistoryNav,
  securityIntruderPanel, securityDropButton, securityInterceptToggle, securityRunLabel,
  securityToolSwitcher, securityHistoryAnalyzeButton, securityClearButton, securityRunButton,
  chatInput,
} from "../../core/dom-refs.js";
import {
  refreshSecurityInspectorContext, syncSecurityHistoryForTool, refreshSecurityHistoryIfVisible,
  hydrateSecurityHistoryRecords, closeSecurityHistoryMenu,
} from "../../bootstrap.js";
import { appState } from "../../core/app-state.js";
import {
  securityDrafts, DEFAULT_SECURITY_REQUEST, activeRepeaterTab, captureRepeaterTab,
  activateRepeaterTab, createRepeaterTab, activeIntruderTab, captureIntruderTab,
  activateIntruderTab, createIntruderTab, renderRepeaterTabs, pushRepeaterHistory,
  renderIntruderTabs, renderRepeaterHistoryNav,
} from "./workbench-tabs.js";
import { syncInterceptorToggleUi } from "../interceptor/interceptor-controls.js";
import {
  setIntruderTab, intruderPayloadLabel, renderIntruderResults, selectIntruderResult,
  syncIntruderUi,
} from "./intruder-payloads.js";
import { isRunningChatActive } from "../chat/chat-run-state.js";
import { openChatPane } from "../chat/chat-sessions.js";
import { resizeChatInput, updateSendBtn } from "../chat/composer-input.js";
import { sendMessageWithAgentRuntime } from "../chat/agent-run.js";

export const SECURITY_TOOL_KEY = "pointer:securityTool";
export const SECURITY_INSPECTOR_OPEN_KEY = "pointer:securityInspectorOpen";
export const SECURITY_INSPECTOR_TAB_KEY = "pointer:securityInspectorTab";

export const SECURITY_TOOL_META = {
  interceptor: { label: "Interceptor", icon: "codicon-debug-disconnect", action: "Forward" },
  repeater: { label: "Repeater", icon: "codicon-sync", action: "Send" },
  intruder: { label: "Intruder", icon: "codicon-symbol-event", action: "Start" },
};

export function securityExchangeSignature() {
  return `${securityRequestEditor?.value || ""}\u0000${securityResponseEditor?.value || ""}`;
}

export function securityByteLabel(value) {
  const bytes = new TextEncoder().encode(String(value || "")).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export function syncSecurityExchangeSizes() {
  if (securityRequestSize) securityRequestSize.textContent = securityByteLabel(securityRequestEditor?.value);
  if (securityResponseSize) securityResponseSize.textContent = securityByteLabel(securityResponseEditor?.value);
  if (securityInspector && !securityInspector.classList.contains("collapsed")) refreshSecurityInspectorContext();
}

export function setSecurityStatus(message, tone = "") {
  if (!securityWorkbenchStatus) return;
  securityWorkbenchStatus.textContent = message || "Ready";
  securityWorkbenchStatus.classList.toggle("error", tone === "error");
  securityWorkbenchStatus.classList.toggle("success", tone === "success");
}

export function saveSecurityDraft() {
  securityDrafts.set(appState.selectedSecurityTool, {
    request: securityRequestEditor?.value || "",
    response: securityResponseEditor?.value || "",
    payloads: securityPayloadEditor?.value || "",
    attackType: appState.securityAttackTypeValue,
  });
}

export function closeSecurityToolMenu() {
  if (!securityToolMenu || !securityToolButton) return;
  securityToolMenu.hidden = true;
  securityToolButton.setAttribute("aria-expanded", "false");
  const chevron = securityToolButton.querySelector(".security-tool-chevron");
  chevron?.classList.remove("codicon-chevron-up");
  chevron?.classList.add("codicon-chevron-down");
}

export function setSecurityTool(tool, { persist = true } = {}) {
  const next = SECURITY_TOOL_META[tool] ? tool : "interceptor";
  if (appState.selectedSecurityTool === "repeater") captureRepeaterTab();
  if (appState.selectedSecurityTool === "intruder") captureIntruderTab();
  saveSecurityDraft();
  appState.selectedSecurityTool = next;
  const meta = SECURITY_TOOL_META[next];

  securityToolLabel.textContent = meta.label;
  securityToolIcon.className = `codicon ${meta.icon}`;
  securityWorkbenchMode.textContent = meta.label;
  securityRunLabel.textContent = meta.action;
  securityInterceptToggle.hidden = next !== "interceptor";
  securityDropButton.hidden = next !== "interceptor" || !appState.currentProxyCaptureId;
  securityWorkbench.hidden = false;
  securityWorkbench.dataset.securityTool = next;
  if (securityRepeaterTabs) securityRepeaterTabs.hidden = next !== "repeater" && next !== "intruder";
  if (securityRepeaterHistoryNav) securityRepeaterHistoryNav.hidden = next !== "repeater";
  if (securityIntruderPanel) securityIntruderPanel.hidden = next !== "intruder";
  if (securityRepeaterAdd) {
    const addLabel = next === "intruder" ? "New Intruder tab" : "New Repeater tab";
    securityRepeaterAdd.title = addLabel;
    securityRepeaterAdd.setAttribute("aria-label", addLabel);
  }
  securityRepeaterTabList?.setAttribute("aria-label", next === "intruder" ? "Intruder attacks" : "Repeater requests");

  securityToolMenu?.querySelectorAll("[data-security-tool]").forEach((option) => {
    const active = option.dataset.securityTool === next;
    option.classList.toggle("active", active);
    option.setAttribute("aria-checked", String(active));
  });

  if (next === "repeater") {
    if (!appState.securityRepeaterTabState.length) createRepeaterTab({ activate: false });
    const target = activeRepeaterTab() || appState.securityRepeaterTabState[0];
    appState.securityActiveRepeaterTab = "";
    activateRepeaterTab(target.id);
  } else if (next === "intruder") {
    if (!appState.securityIntruderTabState.length) createIntruderTab({ activate: false });
    const target = activeIntruderTab() || appState.securityIntruderTabState[0];
    appState.securityActiveIntruderTab = "";
    activateIntruderTab(target.id);
  } else {
    const draft = securityDrafts.get(next) || {};
    securityRequestEditor.value = draft.request || DEFAULT_SECURITY_REQUEST;
    securityResponseEditor.value = draft.response || "";
  }
  syncSecurityHistoryForTool(next);
  setSecurityStatus(next === "interceptor" && appState.proxyListenerState.running
    ? appState.proxyListenerState.warning || `Listening on ${appState.proxyListenerState.host}:${appState.proxyListenerState.port}`
    : "Ready", appState.proxyListenerState.warning ? "error" : "");
  if (next === "interceptor") syncInterceptorToggleUi(appState.assessmentSettingsCache);
  syncSecurityExchangeSizes();
  closeSecurityToolMenu();
  if (persist) localStorage.setItem(SECURITY_TOOL_KEY, next);
}

export function syncSecurityToolsVisibility() {
  if (!securityToolSwitcher) return;
  securityToolSwitcher.hidden = false;
  const saved = localStorage.getItem(SECURITY_TOOL_KEY);
  setSecurityTool(SECURITY_TOOL_META[saved] ? saved : "interceptor", { persist: false });
}

export function setSecurityBusy(busy) {
  appState.securityBusy = Boolean(busy);
  securityRunButton.disabled = appState.securityBusy;
  securityClearButton.disabled = appState.securityBusy;
  securityHistoryAnalyzeButton.disabled = appState.securityBusy;
}

export async function runSecurityRequest(rawRequest, mode) {
  return window.api.securityHttpRequest({
    assessmentPath: appState.assessmentPath,
    rawRequest,
    mode,
  });
}

export async function runSecurityWorkbench() {
  if (appState.securityBusy) return;
  if (!appState.assessmentPath) {
    setSecurityStatus("Create or open a project first", "error");
    return;
  }
  const request = securityRequestEditor.value.trim();
  if (!request) {
    setSecurityStatus("Request is empty", "error");
    return;
  }

  setSecurityBusy(true);
  setSecurityStatus(appState.selectedSecurityTool === "intruder" ? "Preparing payload requests..." : "Sending...");
  try {
    if (appState.selectedSecurityTool !== "intruder") {
      if (appState.selectedSecurityTool === "interceptor" && appState.currentProxyCaptureId) {
        const forwarded = await window.api.proxyForward({ id: appState.currentProxyCaptureId, request });
        if (forwarded?.error) {
          setSecurityStatus(forwarded.error, "error");
        } else {
          appState.currentProxyCaptureId = "";
          securityDropButton.hidden = true;
          setSecurityStatus("Forwarded - waiting for response");
        }
        return;
      }
      const result = await runSecurityRequest(request, appState.selectedSecurityTool);
      if (result?.error) {
        setSecurityStatus(result.error, "error");
        securityResponseEditor.value = `XEKUTE blocked the request:\n${result.error}\n${result.code ? `\nCode: ${result.code}` : ""}`;
      } else {
        securityResponseEditor.value = result.response || "";
        appState.lastLoggedSecuritySignature = securityExchangeSignature();
        setSecurityStatus(`${result.status} in ${result.durationMs} ms - logged ${result.logged?.timestamp || ""}`, "success");
        if (appState.selectedSecurityTool === "repeater") {
          pushRepeaterHistory(request, result.response || "", result.status, result.durationMs);
          captureRepeaterTab();
          renderRepeaterTabs();
        }
      }
      syncSecurityExchangeSizes();
      return;
    }

    const settingsResult = await window.api.assessmentSettings({ path: appState.assessmentPath });
    if (settingsResult?.error) {
      setSecurityStatus(settingsResult.error, "error");
      return;
    }
    const intruderSettings = settingsResult.settings?.intruder || {};
    const maxRequests = Math.max(1, Math.min(Number(intruderSettings.maximumRequestsPerRun) || 25, 25));
    const delayMs = Math.max(500, Math.min(Number(intruderSettings.delayBetweenRequestsMs) || 500, 60000));
    // On the Results tab the editors show the selected row, so the stored
    // template is the only place the payload positions still exist.
    const attackRequest = appState.securityIntruderTab === "results" && appState.securityIntruderTemplate
      ? appState.securityIntruderTemplate.trim()
      : request;
    const built = await window.api.securityBuildIntruder({
      rawRequest: attackRequest,
      payloadSets: securityPayloadEditor.value,
      attackType: appState.securityAttackTypeValue,
      maxRequests,
    });
    if (built?.error) {
      setSecurityStatus(built.error, "error");
      setIntruderTab("payloads");
      return;
    }
    const attackTabId = appState.securityActiveIntruderTab;
    appState.securityIntruderTemplate = attackRequest;
    appState.securityIntruderResults = [];
    appState.securitySelectedResult = -1;
    renderIntruderResults();
    setIntruderTab("results");
    captureIntruderTab();
    let completed = 0;
    for (const generatedRequest of built.requests || []) {
      setSecurityStatus(`Intruder ${completed + 1}/${built.requests.length}`);
      const result = await runSecurityRequest(generatedRequest, "intruder");
      if (result?.error) {
        setSecurityStatus(`Stopped after ${completed} request${completed === 1 ? "" : "s"}: ${result.error}`, "error");
        break;
      }
      completed += 1;
      const row = {
        payload: intruderPayloadLabel(generatedRequest, attackRequest),
        status: result.status,
        length: securityByteLabel(result.response || ""),
        time: `${result.durationMs ?? 0} ms`,
        request: generatedRequest,
        response: result.response || "",
      };
      const attackTab = appState.securityIntruderTabState.find((tab) => tab.id === attackTabId);
      if (appState.securityActiveIntruderTab === attackTabId) {
        appState.securityIntruderResults.push(row);
        selectIntruderResult(appState.securityIntruderResults.length - 1);
        captureIntruderTab();
        renderIntruderTabs();
      } else if (attackTab) {
        attackTab.template = attackRequest;
        attackTab.panel = "results";
        attackTab.results = [...(attackTab.results || []), row];
        attackTab.selectedResult = attackTab.results.length - 1;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (completed && completed === built.requests.length) {
      appState.lastLoggedSecuritySignature = securityExchangeSignature();
      setSecurityStatus(`${completed} request${completed === 1 ? "" : "s"} completed and logged${built.capped ? ` (capped at ${built.maxRequests})` : ""}`, "success");
    }
    if (appState.securityActiveIntruderTab === attackTabId) {
      captureIntruderTab();
      renderIntruderTabs();
    }
    syncSecurityExchangeSizes();
  } catch (error) {
    setSecurityStatus(error?.message || "Security request failed", "error");
  } finally {
    setSecurityBusy(false);
    refreshSecurityHistoryIfVisible();
  }
}

export async function logSecurityExchangeIfNeeded() {
  const signature = securityExchangeSignature();
  if (!appState.assessmentPath || !signature.replace("\u0000", "").trim() || signature === appState.lastLoggedSecuritySignature) return { ok: true };
  const result = await window.api.assessmentTrafficLog({
    path: appState.assessmentPath,
    record: {
      tool: appState.selectedSecurityTool,
      requestId: `capture-${Date.now().toString(36)}`,
      request: securityRequestEditor.value,
      response: securityResponseEditor.value,
      source: "manual-capture",
    },
  });
  if (!result?.error) {
    appState.lastLoggedSecuritySignature = signature;
    refreshSecurityHistoryIfVisible();
  }
  return result;
}

export async function analyzeSecurityExchange(record) {
  if (appState.securityBusy || isRunningChatActive()) return;
  if (!record) return;
  closeSecurityHistoryMenu();
  try {
    await hydrateSecurityHistoryRecords([record]);
  } catch (error) {
    setSecurityStatus(error.message || "Could not load the captured exchange", "error");
    return;
  }
  if (appState.securityBusy || isRunningChatActive()) return;
  const request = String(record.request || "").trim();
  const response = String(record.response || "").trim();
  if (!request && !response) {
    setSecurityStatus("Nothing to analyze", "error");
    return;
  }
  openChatPane({ createIfEmpty: true });
  const clip = (value) => value.length > 14000 ? `${value.slice(0, 14000)}\n...(truncated)` : value;
  chatInput.value = [
    "Analyze this authorized HTTP exchange from the BugBounty workbench.",
    "Identify observable security issues, suspicious behavior, missing controls, and useful follow-up tests.",
    "Separate confirmed evidence from hypotheses. Do not claim a vulnerability without support.",
    "",
    `Captured exchange: ${record.requestId || "History entry"}`,
    "",
    "REQUEST",
    "```http",
    clip(request),
    "```",
    "",
    "RESPONSE",
    "```http",
    clip(response),
    "```",
  ].join("\n");
  resizeChatInput();
  updateSendBtn();
  await sendMessageWithAgentRuntime();
}

export function clearSecurityExchange() {
  if (appState.securityBusy) return;
  if (appState.currentProxyCaptureId) {
    setSecurityStatus("Forward or Drop the pending request before clearing", "error");
    return;
  }
  securityRequestEditor.value = "";
  securityResponseEditor.value = "";
  appState.lastLoggedSecuritySignature = "";
  if (appState.selectedSecurityTool === "repeater") {
    captureRepeaterTab();
    renderRepeaterTabs();
    renderRepeaterHistoryNav();
  }
  if (appState.selectedSecurityTool === "intruder") {
    appState.securityIntruderTemplate = "";
    appState.securityIntruderResults = [];
    appState.securitySelectedResult = -1;
    renderIntruderResults();
    syncIntruderUi();
    captureIntruderTab();
    renderIntruderTabs();
  }
  setSecurityStatus("Ready");
  syncSecurityExchangeSizes();
  securityRequestEditor.focus();
}

export async function dropInterceptedRequest() {
  if (!appState.currentProxyCaptureId || appState.securityBusy) return;
  const id = appState.currentProxyCaptureId;
  const result = await window.api.proxyDrop({ id });
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  appState.currentProxyCaptureId = "";
  securityDropButton.hidden = true;
  setSecurityStatus("Request dropped", "success");
}
