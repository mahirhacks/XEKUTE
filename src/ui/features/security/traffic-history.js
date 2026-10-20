import { appState } from "../../core/app-state.js";
import {
  securityHistorySortHeaders, securityHistoryRows, securityHistorySummary, securityRequestEditor,
  securityResponseEditor, securityHistoryMenu, securityHistoryAnalyzeButton,
  securityHistoryDeleteLabel, securityHistoryRepeaterLabel, securityHistoryIntruderLabel,
  securityHistoryEmpty, securityHistoryPanel, securityHistoryRefresh, securityHistoryToggle,
} from "../../core/dom-refs.js";
import {
  syncSecurityExchangeSizes, setSecurityStatus, setSecurityTool,
} from "./workbench-runner.js";
import {
  DEFAULT_SECURITY_REQUEST, repeaterTabLabel, activeRepeaterTab, activateRepeaterTab,
  createRepeaterTab, emptyIntruderTabState, activeIntruderTab, isUnusedIntruderTab,
  activateIntruderTab, createIntruderTab,
} from "./workbench-tabs.js";
import { isRunningChatActive } from "../chat/chat-run-state.js";

export const SECURITY_HISTORY_LIMIT = 500;
export const SECURITY_HISTORY_REFRESH_MS = 350;
export const SECURITY_HISTORY_REFRESH_MAX_MS = 1000;

export function trafficHeaderValue(rawMessage, headerName) {
  const wanted = String(headerName || "").toLowerCase();
  for (const line of String(rawMessage || "").split(/\r?\n/).slice(1)) {
    if (!line.trim()) break;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toLowerCase() === wanted) return line.slice(separator + 1).trim();
  }
  return "";
}

export function trafficMessageBody(rawMessage) {
  const message = String(rawMessage || "");
  const match = message.match(/\r?\n\r?\n/);
  return match ? message.slice(match.index + match[0].length) : "";
}

export function trafficBodyParameterCount(record) {
  const request = String(record?.request || "");
  const body = trafficMessageBody(request).trim();
  if (!body) return 0;
  const contentType = trafficHeaderValue(request, "content-type").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try { return [...new URLSearchParams(body).keys()].length || 1; } catch { return 1; }
  }
  if (contentType.includes("json")) {
    try { const parsed = JSON.parse(body); return parsed && typeof parsed === "object" ? Math.max(1, Object.keys(parsed).length) : 1; } catch { return 1; }
  }
  if (contentType.includes("multipart/")) return Math.max(1, [...body.matchAll(/content-disposition:\s*form-data;[^\r\n]*\bname=/gi)].length);
  return 1;
}

export function trafficHistoryMeta(record, index, count) {
  let host = String(record?.host || "");
  let requestPath = String(record?.path || record?.url || "");
  let hasParams = Boolean(record?.hasParams);
  if (!host || !record?.path) {
    try {
      const url = new URL(record.url);
      host = host || url.origin;
      requestPath = record?.path || `${url.pathname || "/"}${url.search || ""}`;
      hasParams = hasParams || Boolean(url.search);
    } catch {
      host = host || trafficHeaderValue(record?.request, "host");
    }
  }
  if (record?.request) hasParams = hasParams || trafficBodyParameterCount(record) > 0;
  const statusMatch = String(record?.response || "").match(/^HTTP\/\S+\s+(\d{3})/i);
  const status = Number(record?.statusCode) || Number(statusMatch?.[1]) || "";
  const response = String(record?.response || "");
  const contentType = String(record?.contentType || record?.mime || trafficHeaderValue(response, "content-type") || "")
    .split(";", 1)[0]
    .toLowerCase();
  const subtype = contentType.split("/").at(-1) || "";
  const mime = record?.mime || (subtype === "html" ? "HTML"
    : subtype === "json" ? "JSON"
      : subtype.includes("javascript") ? "script"
        : subtype === "plain" ? "text"
          : subtype);
  const storedLength = Number(record?.responseLength);
  return {
    number: Number(record?.__pointerHistoryNumber) || count - index,
    host,
    method: String(record?.method || ""),
    path: requestPath,
    params: hasParams ? "✓" : "",
    status,
    length: Number.isFinite(storedLength) && storedLength >= 0
      ? storedLength
      : (response ? new TextEncoder().encode(response).length : ""),
    mime,
    tool: String(record?.tool || ""),
    time: String(record?.timestamp || record?.isoTimestamp || ""),
  };
}

export function appendSecurityHistoryCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value == null ? "" : String(value);
  row.appendChild(cell);
}

export function securityHistoryTimeValue(record) {
  const iso = Date.parse(String(record?.isoTimestamp || ""));
  if (Number.isFinite(iso)) return iso;
  const raw = String(record?.timestamp || "");
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})-(\d{2}):(\d{2}):(\d{2})(?::(\d{1,3}))?$/);
  if (!match) return Date.parse(raw) || 0;
  const [, day, month, year, hour, minute, second, millisecond = "0"] = match;
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  return Date.UTC(fullYear, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond.padEnd(3, "0")));
}

export function securityHistorySortValue(record, key) {
  const meta = trafficHistoryMeta(record, 0, appState.securityHistoryRecords.length || 1);
  if (key === "number") return Number(record?.__pointerHistoryNumber) || 0;
  if (key === "params") {
    if (typeof record?.hasParams === "boolean") return record.hasParams ? 1 : 0;
    let queryCount = 0;
    try { queryCount = [...new URL(record?.url || "").searchParams.keys()].length; } catch { /* keep zero */ }
    return queryCount + trafficBodyParameterCount(record);
  }
  if (key === "status") return Number(meta.status) || 0;
  if (key === "length") return Number(record?.responseLength) || Number(meta.length) || 0;
  if (key === "time") return securityHistoryTimeValue(record);
  return String(meta[key] || "").toLocaleLowerCase();
}

export function sortedSecurityHistoryRecords(records) {
  const direction = appState.securityHistorySort.direction === "desc" ? -1 : 1;
  const key = appState.securityHistorySort.key;
  return [...records].sort((left, right) => {
    const leftValue = securityHistorySortValue(left, key);
    const rightValue = securityHistorySortValue(right, key);
    const compared = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    if (compared) return compared * direction;
    return ((Number(left?.__pointerHistoryNumber) || 0) - (Number(right?.__pointerHistoryNumber) || 0)) * -1;
  });
}

export function updateSecurityHistorySortHeaders() {
  securityHistorySortHeaders.forEach((header) => {
    const active = header.dataset.historySort === appState.securityHistorySort.key;
    const direction = active ? appState.securityHistorySort.direction : "none";
    header.classList.toggle("sorted", active);
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    const icon = header.querySelector(".codicon");
    icon?.classList.toggle("codicon-chevron-up", active && direction === "asc");
    icon?.classList.toggle("codicon-chevron-down", !active || direction === "desc");
    const label = header.querySelector("span")?.textContent || header.dataset.historySort;
    header.querySelector("button")?.setAttribute("title", active
      ? `${label}: ${direction === "asc" ? "ascending" : "descending"}. Click to reverse.`
      : `Sort by ${label}`);
  });
}

export function setSecurityHistorySort(key) {
  if (!key) return;
  if (appState.securityHistorySort.key === key) appState.securityHistorySort.direction = appState.securityHistorySort.direction === "asc" ? "desc" : "asc";
  else appState.securityHistorySort = { key, direction: key === "time" ? "desc" : "asc" };
  renderSecurityHistory(appState.securityHistoryRecords);
}

export function syncSecurityHistorySelectionUi() {
  securityHistoryRows?.querySelectorAll("tr").forEach((row, rowIndex) => {
    const selected = appState.selectedSecurityHistoryIndices.has(rowIndex);
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  });
}

export function securityHistoryIndexForRequestId(requestId) {
  return appState.securityHistoryRecords.findIndex((record) => String(record.requestId) === String(requestId));
}

export function restoreSecurityHistorySelectionFromIds() {
  const restoredIndices = appState.securityHistoryRecords
    .map((record, index) => appState.selectedSecurityHistoryRequestIds.has(String(record.requestId)) ? index : -1)
    .filter((index) => index >= 0);
  appState.selectedSecurityHistoryIndices = new Set(restoredIndices);
  if (restoredIndices.length && !restoredIndices.includes(appState.securityHistoryAnchorIndex)) {
    appState.securityHistoryAnchorIndex = restoredIndices[0];
  } else if (!restoredIndices.length) {
    appState.securityHistoryAnchorIndex = -1;
  }
}

export function updateSecurityHistorySummary(truncated = false) {
  if (!securityHistorySummary) return;
  const count = appState.securityHistoryRecords.length;
  const suffix = truncated || count >= SECURITY_HISTORY_LIMIT ? " · latest 500" : "";
  securityHistorySummary.textContent = `${count} exchange${count === 1 ? "" : "s"}${suffix}`;
}

export async function hydrateSecurityHistoryRecords(records) {
  const payload = (Array.isArray(records) ? records : []).filter(Boolean);
  const missing = payload.filter((record) => record.request == null || record.response == null);
  if (!missing.length || !appState.assessmentPath) return payload;
  const result = await window.api.assessmentTrafficRecords({
    path: appState.assessmentPath,
    requestIds: missing.map((record) => record.requestId).filter(Boolean),
  });
  const byId = new Map((result?.records || []).map((record) => [String(record.requestId), record]));
  for (const record of missing) {
    const full = byId.get(String(record.requestId));
    if (!full) continue;
    record.request = full.request;
    record.response = full.response;
  }
  return payload;
}

export async function loadSecurityHistoryRecord(index) {
  const record = appState.securityHistoryRecords[index];
  if (!record) return;
  const token = ++appState.securityHistoryLoadToken;
  if (record.request == null || record.response == null) {
    await hydrateSecurityHistoryRecords([record]);
    if (token !== appState.securityHistoryLoadToken) return;
  }
  securityRequestEditor.value = String(record.request || "");
  securityResponseEditor.value = String(record.response || "");
  syncSecurityExchangeSizes();
  const label = record.requestId || `entry ${appState.securityHistoryRecords.length - index}`;
  setSecurityStatus(`History · ${label} · ${record.timestamp || record.isoTimestamp || ""}`, "success");
}

export function setSecurityHistorySelection(indices, { loadRecordIndex = null, anchorIndex = null } = {}) {
  appState.selectedSecurityHistoryIndices = new Set(indices);
  appState.selectedSecurityHistoryRequestIds = new Set([...appState.selectedSecurityHistoryIndices]
    .map((index) => appState.securityHistoryRecords[index]?.requestId)
    .filter(Boolean)
    .map(String));
  if (anchorIndex != null) appState.securityHistoryAnchorIndex = anchorIndex;
  syncSecurityHistorySelectionUi();
  if (loadRecordIndex != null && loadRecordIndex >= 0) loadSecurityHistoryRecord(loadRecordIndex);
}

export function selectSecurityHistoryRecord(index, event = null) {
  const record = appState.securityHistoryRecords[index];
  if (!record) return;

  if (event?.shiftKey && appState.securityHistoryAnchorIndex >= 0) {
    const start = Math.min(appState.securityHistoryAnchorIndex, index);
    const end = Math.max(appState.securityHistoryAnchorIndex, index);
    const indices = [];
    for (let i = start; i <= end; i += 1) indices.push(i);
    setSecurityHistorySelection(indices, { loadRecordIndex: index, anchorIndex: appState.securityHistoryAnchorIndex });
    return;
  }

  if (event && (event.ctrlKey || event.metaKey)) {
    const next = new Set(appState.selectedSecurityHistoryIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSecurityHistorySelection([...next], { loadRecordIndex: index, anchorIndex: index });
    return;
  }

  setSecurityHistorySelection([index], { loadRecordIndex: index, anchorIndex: index });
}

export function closeSecurityHistoryMenu() {
  if (!securityHistoryMenu) return;
  securityHistoryMenu.hidden = true;
}

export function selectedSecurityHistoryRecords() {
  return [...appState.selectedSecurityHistoryIndices]
    .sort((a, b) => a - b)
    .map((index) => appState.securityHistoryRecords[index])
    .filter(Boolean);
}

export function isUnusedRepeaterTab(tab) {
  return Boolean(tab)
    && !tab.history.length
    && (!String(tab.request || "").trim() || tab.request === DEFAULT_SECURITY_REQUEST)
    && !String(tab.response || "").trim();
}

export async function sendHistoryRecordsToRepeater(records) {
  const payload = (await hydrateSecurityHistoryRecords(records)).filter((record) => String(record.request || "").trim());
  if (!payload.length) {
    setSecurityStatus("No request to send to Repeater", "error");
    return;
  }
  closeSecurityHistoryMenu();
  setSecurityTool("repeater");
  const firstUnused = appState.securityRepeaterTabState.length === 1 && isUnusedRepeaterTab(activeRepeaterTab() || appState.securityRepeaterTabState[0]);
  payload.forEach((record, index) => {
    const request = String(record.request || "");
    const response = String(record.response || "");
    const activate = index === payload.length - 1;
    if (index === 0 && firstUnused) {
      const tab = activeRepeaterTab() || appState.securityRepeaterTabState[0];
      tab.request = request;
      tab.response = response;
      tab.name = repeaterTabLabel(tab.request);
      appState.securityActiveRepeaterTab = "";
      activateRepeaterTab(tab.id);
      return;
    }
    createRepeaterTab({ activate, request, response });
  });
  setSecurityStatus(payload.length === 1 ? "Sent to Repeater" : `Sent ${payload.length} requests to Repeater`, "success");
}

export function sendHistoryRecordToIntruder(record) {
  return sendHistoryRecordsToIntruder(record ? [record] : []);
}

export async function sendHistoryRecordsToIntruder(records) {
  const payload = (await hydrateSecurityHistoryRecords(records)).filter((record) => String(record.request || "").trim());
  if (!payload.length) {
    setSecurityStatus("No request to send to Intruder", "error");
    return;
  }
  closeSecurityHistoryMenu();
  setSecurityTool("intruder");
  const firstUnused = appState.securityIntruderTabState.length === 1 && isUnusedIntruderTab(activeIntruderTab() || appState.securityIntruderTabState[0]);
  payload.forEach((record, index) => {
    const request = String(record.request || "");
    const response = String(record.response || "");
    const activate = index === payload.length - 1;
    if (index === 0 && firstUnused) {
      const tab = activeIntruderTab() || appState.securityIntruderTabState[0];
      Object.assign(tab, emptyIntruderTabState(request, response));
      tab.name = repeaterTabLabel(tab.request);
      appState.securityActiveIntruderTab = "";
      activateIntruderTab(tab.id);
      return;
    }
    createIntruderTab({ activate, request, response });
  });
  setSecurityStatus(payload.length === 1 ? "Sent to Intruder" : `Sent ${payload.length} requests to Intruder`, "success");
}

export function openSecurityHistoryMenu(clientX, clientY) {
  if (!securityHistoryMenu || appState.selectedSecurityHistoryIndices.size === 0) return;
  securityHistoryAnalyzeButton.disabled = appState.securityBusy || isRunningChatActive();
  const count = appState.selectedSecurityHistoryIndices.size;
  if (securityHistoryRepeaterLabel) {
    securityHistoryRepeaterLabel.textContent = count === 1 ? "Send to Repeater" : `Send ${count} to Repeater`;
  }
  if (securityHistoryIntruderLabel) {
    securityHistoryIntruderLabel.textContent = count === 1 ? "Send to Intruder" : `Send ${count} to Intruder`;
  }
  if (securityHistoryDeleteLabel) {
    securityHistoryDeleteLabel.textContent = count === 1 ? "Delete" : `Delete ${count} entries`;
  }

  securityHistoryMenu.hidden = false;
  securityHistoryMenu.style.visibility = "hidden";
  securityHistoryMenu.style.left = "0px";
  securityHistoryMenu.style.top = "0px";

  const { width, height } = securityHistoryMenu.getBoundingClientRect();
  const pad = 4;
  let left = clientX;
  let top = clientY;
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
  if (top + height > window.innerHeight - pad) top = window.innerHeight - height - pad;
  securityHistoryMenu.style.left = `${Math.max(pad, left)}px`;
  securityHistoryMenu.style.top = `${Math.max(pad, top)}px`;
  securityHistoryMenu.style.visibility = "";
}

export async function deleteSelectedSecurityHistoryRecords() {
  if (!appState.assessmentPath || appState.selectedSecurityHistoryIndices.size === 0) return;
  const requestIds = [...appState.selectedSecurityHistoryIndices]
    .map((index) => appState.securityHistoryRecords[index]?.requestId)
    .filter(Boolean);
  if (!requestIds.length) return;

  closeSecurityHistoryMenu();
  setSecurityStatus(`Deleting ${requestIds.length} exchange${requestIds.length === 1 ? "" : "s"}...`);
  const result = await window.api.assessmentDeleteTrafficRecords({ path: appState.assessmentPath, requestIds });
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  appState.selectedSecurityHistoryIndices = new Set();
  appState.selectedSecurityHistoryRequestIds = new Set();
  appState.securityHistoryAnchorIndex = -1;
  securityRequestEditor.value = "";
  securityResponseEditor.value = "";
  syncSecurityExchangeSizes();
  await loadSecurityHistory();
  setSecurityStatus(`Deleted ${result.deleted || 0} exchange${result.deleted === 1 ? "" : "s"}`, "success");
}

export function bindSecurityHistoryRow(row, record) {
  row.dataset.requestId = String(record?.requestId || "");
  row.addEventListener("click", (event) => {
    selectSecurityHistoryRecord(securityHistoryIndexForRequestId(row.dataset.requestId), event);
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const index = securityHistoryIndexForRequestId(row.dataset.requestId);
    appState.securityHistoryMenuIndex = index;
    if (!appState.selectedSecurityHistoryIndices.has(index)) {
      setSecurityHistorySelection([index], { loadRecordIndex: index, anchorIndex: index });
    }
    openSecurityHistoryMenu(event.clientX, event.clientY);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectSecurityHistoryRecord(securityHistoryIndexForRequestId(row.dataset.requestId), event);
  });
}

export function createSecurityHistoryRow(record, index) {
  const meta = trafficHistoryMeta(record, index, appState.securityHistoryRecords.length);
  const row = document.createElement("tr");
  row.tabIndex = 0;
  row.setAttribute("aria-selected", String(appState.selectedSecurityHistoryIndices.has(index)));
  row.classList.toggle("selected", appState.selectedSecurityHistoryIndices.has(index));
  row.title = `${meta.method} ${record.url || meta.path}`.trim();
  appendSecurityHistoryCell(row, meta.number, "history-number");
  appendSecurityHistoryCell(row, meta.host, "history-host");
  appendSecurityHistoryCell(row, meta.method, `history-method method-${meta.method.toLowerCase()}`);
  appendSecurityHistoryCell(row, meta.path, "history-url");
  appendSecurityHistoryCell(row, meta.params, "history-params");
  appendSecurityHistoryCell(row, meta.status, `history-status status-${String(meta.status).charAt(0)}`);
  appendSecurityHistoryCell(row, meta.length, "history-length");
  appendSecurityHistoryCell(row, meta.mime, "history-mime");
  appendSecurityHistoryCell(row, meta.tool, "history-tool");
  appendSecurityHistoryCell(row, meta.time, "history-time");
  bindSecurityHistoryRow(row, record);
  return row;
}

export function renderSecurityHistory(records, { loadSelection = false } = {}) {
  const preservedRequestIds = new Set(appState.selectedSecurityHistoryRequestIds);
  if (!preservedRequestIds.size) {
    [...appState.selectedSecurityHistoryIndices].forEach((index) => {
      const requestId = appState.securityHistoryRecords[index]?.requestId;
      if (requestId) preservedRequestIds.add(String(requestId));
    });
  }
  const sourceRecords = Array.isArray(records) ? records : [];
  sourceRecords.forEach((record, index) => {
    if (!record || Object.prototype.hasOwnProperty.call(record, "__pointerHistoryNumber")) return;
    Object.defineProperty(record, "__pointerHistoryNumber", { value: sourceRecords.length - index, enumerable: false, configurable: true });
  });
  appState.securityHistoryRecords = sortedSecurityHistoryRecords(sourceRecords);
  updateSecurityHistorySortHeaders();
  appState.selectedSecurityHistoryRequestIds = preservedRequestIds;
  restoreSecurityHistorySelectionFromIds();
  closeSecurityHistoryMenu();
  if (!securityHistoryRows || !securityHistoryEmpty) return;
  const fragment = document.createDocumentFragment();
  appState.securityHistoryRecords.forEach((record, index) => {
    fragment.appendChild(createSecurityHistoryRow(record, index));
  });
  securityHistoryRows.replaceChildren(fragment);
  securityHistoryEmpty.hidden = appState.securityHistoryRecords.length > 0;
  if (loadSelection && appState.selectedSecurityHistoryIndices.size) {
    loadSecurityHistoryRecord([...appState.selectedSecurityHistoryIndices][0]);
  }
}

export function ingestLiveSecurityHistory(summary) {
  if (!summary?.requestId || securityHistoryPanel?.hidden) return;
  if (appState.securityHistoryRecords.some((record) => String(record.requestId) === String(summary.requestId))) return;
  const maxNum = appState.securityHistoryRecords.reduce((max, record) => Math.max(max, Number(record.__pointerHistoryNumber) || 0), 0);
  Object.defineProperty(summary, "__pointerHistoryNumber", { value: maxNum + 1, enumerable: false, configurable: true });
  const liveDefaultSort = appState.securityHistorySort.key === "time" && appState.securityHistorySort.direction === "desc";
  if (liveDefaultSort) {
    appState.securityHistoryRecords.unshift(summary);
    if (appState.securityHistoryRecords.length > SECURITY_HISTORY_LIMIT) appState.securityHistoryRecords.length = SECURITY_HISTORY_LIMIT;
    restoreSecurityHistorySelectionFromIds();
    if (securityHistoryRows && securityHistoryEmpty) {
      securityHistoryEmpty.hidden = true;
      securityHistoryRows.insertBefore(createSecurityHistoryRow(summary, 0), securityHistoryRows.firstChild);
      while (securityHistoryRows.children.length > SECURITY_HISTORY_LIMIT) securityHistoryRows.lastChild.remove();
      syncSecurityHistorySelectionUi();
    }
  } else {
    renderSecurityHistory([summary, ...appState.securityHistoryRecords], { loadSelection: false });
    if (appState.securityHistoryRecords.length > SECURITY_HISTORY_LIMIT) {
      renderSecurityHistory(appState.securityHistoryRecords.slice(0, SECURITY_HISTORY_LIMIT), { loadSelection: false });
    }
  }
  updateSecurityHistorySummary(appState.securityHistoryRecords.length >= SECURITY_HISTORY_LIMIT);
}

export async function loadSecurityHistory() {
  if (appState.securityHistoryLoading || !securityHistoryPanel || securityHistoryPanel.hidden) return;
  if (!appState.assessmentPath) {
    renderSecurityHistory([]);
    securityHistoryEmpty.textContent = "Create or open an assessment to load Traffic/Raw history.";
    securityHistorySummary.textContent = "No assessment";
    return;
  }
  appState.securityHistoryLoading = true;
  securityHistoryRefresh?.classList.add("loading");
  securityHistorySummary.textContent = "Loading Traffic/Raw...";
  try {
    const result = await window.api.assessmentTrafficHistory({ path: appState.assessmentPath, limit: SECURITY_HISTORY_LIMIT, includeBodies: false });
    if (result?.error) {
      renderSecurityHistory([]);
      securityHistoryEmpty.textContent = result.error;
      securityHistorySummary.textContent = "History unavailable";
      return;
    }
    renderSecurityHistory(result.records || []);
    securityHistoryEmpty.textContent = "Traffic/Raw has no captured HTTP exchanges yet.";
    updateSecurityHistorySummary(Boolean(result.truncated));
  } finally {
    appState.securityHistoryLoading = false;
    securityHistoryRefresh?.classList.remove("loading");
    if (appState.securityHistoryReloadQueued) {
      appState.securityHistoryReloadQueued = false;
      refreshSecurityHistoryIfVisible();
    }
  }
}

export function setSecurityHistoryVisible(visible) {
  if (!securityHistoryPanel || !securityHistoryToggle) return;
  if (visible && appState.selectedSecurityTool !== "interceptor") visible = false;
  securityHistoryPanel.hidden = !visible;
  securityHistoryToggle.classList.toggle("active", Boolean(visible));
  securityHistoryToggle.setAttribute("aria-pressed", String(Boolean(visible)));
  if (appState.selectedSecurityTool === "interceptor") appState.interceptorHistoryWanted = Boolean(visible);
  if (visible) loadSecurityHistory();
  else closeSecurityHistoryMenu();
}

export function syncSecurityHistoryForTool(tool) {
  const interceptor = tool === "interceptor";
  if (securityHistoryToggle) securityHistoryToggle.hidden = !interceptor;
  if (!interceptor) {
    closeSecurityHistoryMenu();
    if (securityHistoryPanel) securityHistoryPanel.hidden = true;
    securityHistoryToggle?.classList.remove("active");
    securityHistoryToggle?.setAttribute("aria-pressed", "false");
    return;
  }
  setSecurityHistoryVisible(appState.interceptorHistoryWanted);
}

export function refreshSecurityHistoryIfVisible() {
  if (securityHistoryPanel?.hidden) return;
  const now = Date.now();
  if (!appState.securityHistoryRefreshFirstAt) appState.securityHistoryRefreshFirstAt = now;
  const wait = now - appState.securityHistoryRefreshFirstAt >= SECURITY_HISTORY_REFRESH_MAX_MS ? 0 : SECURITY_HISTORY_REFRESH_MS;
  clearTimeout(appState.securityHistoryRefreshTimer);
  appState.securityHistoryRefreshTimer = setTimeout(() => {
    appState.securityHistoryRefreshTimer = null;
    appState.securityHistoryRefreshFirstAt = 0;
    if (appState.securityHistoryLoading) {
      appState.securityHistoryReloadQueued = true;
      return;
    }
    loadSecurityHistory();
  }, wait);
}
