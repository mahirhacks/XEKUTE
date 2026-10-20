import { escapeHtml } from "../../core/text-format.js";
import {
  quickResults, quickSearchHelp, quickSearchAssist, quickInput, quickSearchSuggestions,
  quickSearchChips, quickMeta,
} from "../../core/dom-refs.js";
import { renderVirtualizedSearchResults, renderQuickList } from "./quick-palette.js";
import { appState } from "../../core/app-state.js";
import { ADVANCED_SEARCH_OPERATORS } from "../../bootstrap.js";
import { basenameOf, joinWorkspacePath } from "../../core/workspace-paths.js";
import { openFile } from "../editor/editor-tabs.js";

export const QUICK_SEARCH_DEBOUNCE_MS = 225;
export const QUICK_SEARCH_ROW_HEIGHT = 53;
export const QUICK_SEARCH_OVERSCAN = 8;
export const QUICK_SEARCH_RESULT_LIMIT = 10000;

export const ADVANCED_SEARCH_PRESETS = [
  { label: "IDOR candidates", query: "risk:idor same:endpoint compare:identity" },
  { label: "BOLA candidates", query: "risk:bola same:endpoint same:param different:value compare:identity" },
  { label: "Auth bypass", query: "risk:auth-bypass same:endpoint compare:identity" },
  { label: "JavaScript secrets", query: "source:javascript secret:true" },
  { label: "Source maps", query: "source:javascript source-map:true" },
  { label: "Server errors", query: "source:traffic status:5xx" },
  { label: "High-confidence evidence", query: "source:evidence severity:(critical,high) confidence:>=0.8" },
  { label: "Auth headers", query: "source:traffic (header:authorization OR cookie:session)" },
];

export function parseSnippetLine(snippet) {
  const match = String(snippet || "").match(/^\s*(\d+):/m);
  return match ? Number(match[1]) : 1;
}

export function firstSnippetLine(snippet) {
  return String(snippet || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+:\s?/, "").trim())
    .find(Boolean) || "";
}

export function highlightExactText(text, query, highlights = []) {
  const value = String(text || "");
  const needles = [...new Set((highlights.length ? highlights : [query]).map(String).filter(Boolean))]
    .filter((needle) => needle.length <= 200)
    .sort((a, b) => b.length - a.length);
  if (!needles.length) return escapeHtml(value);
  const comparable = value.toLowerCase();
  let cursor = 0;
  let html = "";
  while (cursor < value.length) {
    let foundIndex = -1;
    let foundNeedle = "";
    for (const needle of needles) {
      const index = comparable.indexOf(needle.toLowerCase(), cursor);
      if (index !== -1 && (foundIndex === -1 || index < foundIndex || index === foundIndex && needle.length > foundNeedle.length)) {
        foundIndex = index;
        foundNeedle = needle;
      }
    }
    if (foundIndex === -1) {
      html += escapeHtml(value.slice(cursor));
      break;
    }
    html += escapeHtml(value.slice(cursor, foundIndex));
    html += `<mark class="quick-match">${escapeHtml(value.slice(foundIndex, foundIndex + foundNeedle.length))}</mark>`;
    cursor = foundIndex + foundNeedle.length;
  }
  return html;
}

export function setQuickSearchAssistVisible(_visible) {
  if (quickSearchAssist) quickSearchAssist.hidden = true;
  if (quickSearchHelp) quickSearchHelp.setAttribute("aria-expanded", "false");
  if (quickResults?.classList.contains("is-virtualized")) requestAnimationFrame(() => renderVirtualizedSearchResults());
}

export function initializeAdvancedSearchHelp() {
  setQuickSearchAssistVisible(false);
}

export function advancedSearchTokenRange() {
  if (!quickInput) return null;
  const cursor = quickInput.selectionStart ?? quickInput.value.length;
  let start = cursor;
  while (start > 0 && !/[\s(),]/.test(quickInput.value[start - 1])) start -= 1;
  return { start, end: cursor, value: quickInput.value.slice(start, cursor) };
}

export function applyQuickSearchSuggestion(index = appState.quickSearchSuggestionSelection) {
  const suggestion = appState.quickSearchSuggestionItems[index];
  const range = appState.quickSearchSuggestionRange;
  if (!suggestion || !range || !quickInput) return false;
  quickInput.setRangeText(suggestion.insert, range.start, range.end, "end");
  quickSearchSuggestions.hidden = true;
  appState.quickSearchSuggestionItems = [];
  appState.quickSearchSuggestionRange = null;
  appState.quickSelection = 0;
  renderWorkspaceSearch();
  quickInput.focus();
  return true;
}

export function renderQuickSearchSuggestions({ force = false } = {}) {
  if (!quickSearchSuggestions || appState.quickMode !== "search" || !quickSearchAssist?.hidden) {
    if (quickSearchSuggestions) quickSearchSuggestions.hidden = true;
    return;
  }
  const tokenRange = advancedSearchTokenRange();
  const rawToken = tokenRange?.value || "";
  const token = rawToken.replace(/^-/, "");
  const colon = token.indexOf(":");
  let items = [];
  let range = tokenRange;
  if (colon >= 0) {
    const name = token.slice(0, colon).toLowerCase();
    const typed = token.slice(colon + 1).toLowerCase();
    const operator = ADVANCED_SEARCH_OPERATORS.find((entry) => entry.name === name);
    if (operator?.values?.length) {
      const complete = operator.values.some((value) => value.toLowerCase() === typed);
      items = complete && !force ? [] : operator.values.filter((value) => !typed || value.toLowerCase().startsWith(typed)).slice(0, 8)
        .map((value) => ({ label: value, description: `${name}: value`, insert: value }));
      range = { start: tokenRange.start + rawToken.indexOf(":") + 1, end: tokenRange.end };
    }
  } else if (force || token.length >= 2) {
    items = ADVANCED_SEARCH_OPERATORS.filter((entry) => !token || entry.name.startsWith(token.toLowerCase())).slice(0, 8)
      .map((entry) => ({ label: `${entry.name}:`, description: entry.description, insert: `${rawToken.startsWith("-") ? "-" : ""}${entry.name}:` }));
  }
  appState.quickSearchSuggestionItems = items;
  appState.quickSearchSuggestionSelection = 0;
  appState.quickSearchSuggestionRange = range;
  quickSearchSuggestions.replaceChildren();
  if (!items.length) {
    quickSearchSuggestions.hidden = true;
    return;
  }
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-search-suggestion${index === 0 ? " active" : ""}`;
    button.innerHTML = `<code>${escapeHtml(item.label)}</code><span>${escapeHtml(item.description)}</span>`;
    button.addEventListener("mouseenter", () => {
      appState.quickSearchSuggestionSelection = index;
      [...quickSearchSuggestions.children].forEach((child, childIndex) => child.classList.toggle("active", childIndex === index));
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyQuickSearchSuggestion(index));
    quickSearchSuggestions.appendChild(button);
  });
  quickSearchSuggestions.hidden = false;
}

export function extractAdvancedSearchChips(query) {
  const names = ADVANCED_SEARCH_OPERATORS.map((entry) => entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(`(^|[\\s(])(-?(?:${names})):(\\([^)]*\\)|"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s)]+)`, "gi");
  const chips = [];
  for (const match of String(query || "").matchAll(pattern)) {
    const leading = match[1]?.length || 0;
    chips.push({ label: `${match[2]}:${match[3]}`, start: match.index + leading, end: match.index + match[0].length });
  }
  return chips;
}

export function renderAdvancedSearchChips() {
  if (!quickSearchChips) return;
  quickSearchChips.replaceChildren();
  const chips = appState.quickMode === "search" ? extractAdvancedSearchChips(quickInput?.value || "") : [];
  quickSearchChips.hidden = !chips.length;
  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-search-chip";
    button.title = "Remove this filter";
    button.innerHTML = `<span>${escapeHtml(chip.label)}</span><span class="codicon codicon-close"></span>`;
    button.addEventListener("click", () => {
      if (!quickInput) return;
      let start = chip.start;
      let end = chip.end;
      if (quickInput.value[start - 1] === "(" && quickInput.value[end] === ")") {
        start -= 1;
        end += 1;
      }
      const precedingConnector = quickInput.value.slice(0, start).match(/\s+(?:AND|OR)\s*$/);
      const followingConnector = quickInput.value.slice(end).match(/^\s*(?:AND|OR)\s+/);
      if (precedingConnector) start -= precedingConnector[0].length;
      else if (followingConnector) end += followingConnector[0].length;
      else if (start > 0 && /\s/.test(quickInput.value[start - 1])) start -= 1;
      else if (/\s/.test(quickInput.value[end] || "")) end += 1;
      quickInput.setRangeText("", start, end, "end");
      renderWorkspaceSearch();
      quickInput.focus();
    });
    quickSearchChips.appendChild(button);
  }
}

export function formattedSearchSources(counts = {}) {
  const labels = { correlation: "Authorization", traffic: "Traffic", javascript: "JavaScript", evidence: "Evidence", tool: "Tools", asset: "Assets", code: "Code", workspace: "Files" };
  return Object.entries(counts).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5).map(([source, count]) => `${labels[source] || source} ${Number(count).toLocaleString()}`).join(" · ");
}

export function setQuickSearchMeta(text, { error = false } = {}) {
  if (!quickMeta) return;
  quickMeta.hidden = false;
  quickMeta.textContent = text;
  quickMeta.classList.toggle("quick-meta-error", error);
}

export function workspaceSearchResultItem(row, query) {
  const name = basenameOf(row.path);
  const sourceIcons = { correlation: "codicon-shield", traffic: "codicon-globe", finding: "codicon-warning", evidence: "codicon-archive", asset: "codicon-server", tool: "codicon-tools" };
  const line = Number(row.line) || parseSnippetLine(row.snippet);
  const column = Number(row.column) || 1;
  const matchDetail = row.lineText || firstSnippetLine(row.snippet);
  const detail = row.title && row.title !== row.path ? `${row.path} · ${matchDetail}` : matchDetail;
  const sourceLabel = row.source && !["workspace", "code"].includes(row.source)
    ? `${String(row.source).replace(/^./, (char) => char.toUpperCase())} · `
    : "";
  const item = {
    title: row.title || row.path,
    detail,
    detailHtml: highlightExactText(detail, query),
    icon: sourceIcons[row.source] || "codicon-file",
    key: row.key || `${sourceLabel}L${line}:C${column}`,
    run: async () => {
      await openFile(joinWorkspacePath(row.path), name, {
        focusEditor: true,
        line,
        column,
      });
    },
  };
  if (Array.isArray(row.highlights) && row.highlights.length || row.match) {
    item.detailHtml = highlightExactText(detail, query, Array.isArray(row.highlights) ? row.highlights : [row.match]);
  }
  return item;
}

export function cancelActiveWorkspaceSearch() {
  const requestId = appState.quickSearchRequestId;
  appState.quickSearchRequestId = "";
  if (appState.quickSearchRenderFrame) cancelAnimationFrame(appState.quickSearchRenderFrame);
  if (appState.quickSearchScrollFrame) cancelAnimationFrame(appState.quickSearchScrollFrame);
  appState.quickSearchRenderFrame = 0;
  appState.quickSearchScrollFrame = 0;
  appState.quickSearchPendingRows = [];
  appState.quickSearchPendingTotal = 0;
  appState.quickSearchSourceCounts = {};
  if (requestId) void window.api.cancelWorkspaceSearch?.({ requestId });
}

export function flushWorkspaceSearchRows(metaText = "") {
  if (appState.quickSearchRenderFrame) cancelAnimationFrame(appState.quickSearchRenderFrame);
  appState.quickSearchRenderFrame = 0;
  const query = (quickInput?.value || "").trim();
  const rows = appState.quickSearchPendingRows;
  appState.quickSearchPendingRows = [];
  appState.quickItems.push(...rows.map((row) => workspaceSearchResultItem(row, query)));
  const total = appState.quickSearchPendingTotal || appState.quickItems.length;
  const sources = formattedSearchSources(appState.quickSearchSourceCounts);
  const exactMatchLabel = `exact match${total === 1 ? "" : "es"}`;
  renderVirtualizedSearchResults(metaText || `Searching… ${total.toLocaleString()} ${sources ? `matches · ${sources}` : exactMatchLabel}`);
}

export function renderWorkspaceSearch() {
  const query = (quickInput?.value || "").trim();
  if (appState.quickSearchTimer) clearTimeout(appState.quickSearchTimer);
  cancelActiveWorkspaceSearch();
  renderAdvancedSearchChips();
  renderQuickSearchSuggestions();
  if (query.length < 2) {
    renderQuickList([], "", { quietEmpty: true });
    return;
  }
  if (!appState.rootPath) {
    renderQuickList([], "Create or open a Target to search its workspace");
    return;
  }

  const seq = ++appState.quickSearchSeq;
  const requestId = `workspace-search-${Date.now()}-${seq}`;
  appState.quickSearchRequestId = requestId;
  appState.quickItems = [];
  appState.quickSelection = 0;
  if (quickResults) quickResults.scrollTop = 0;
  appState.quickSearchSourceCounts = {};
  renderVirtualizedSearchResults("Searching workspace…");
  appState.quickSearchTimer = setTimeout(async () => {
    const result = await window.api.searchWorkspace({ workspace: appState.rootPath, query, limit: QUICK_SEARCH_RESULT_LIMIT, requestId });
    if (seq !== appState.quickSearchSeq || appState.quickMode !== "search" || requestId !== appState.quickSearchRequestId) return;
    if (result?.error) {
      appState.quickSearchRequestId = "";
      appState.quickSearchPendingRows = [];
      appState.quickSearchPendingTotal = 0;
      if (quickResults) {
        quickResults.replaceChildren();
        quickResults.hidden = true;
      }
      const column = Number(result.position) >= 0 ? ` at column ${Number(result.position) + 1}` : "";
      setQuickSearchMeta(`Query error${column}: ${result.error}`, { error: true });
    }
  }, QUICK_SEARCH_DEBOUNCE_MS);
}
