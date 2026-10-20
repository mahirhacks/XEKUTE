import { appState } from "../../core/app-state.js";
import { TerminalManager, EditorManager } from "../../core/runtime-globals.js";
import { setChatCollapsed, openChatPane, newChatSession } from "../chat/chat-sessions.js";
import { createProject, projectName, openProject } from "../project/project-activation.js";
import { showSecurityWorkspace } from "../layout/workspace-switcher.js";
import { setTerminalCollapsed } from "../terminal/terminal-panel.js";
import { basenameOf, joinWorkspacePath } from "../../core/workspace-paths.js";
import { showResourcePreview } from "../assessment/resource-viewer.js";
import {
  quickPanel, quickIcon, quickInput, quickSearchHelp, quickSearchSuggestions, quickSearchChips,
  quickMeta, quickResults, quickOverlay, chatInput,
} from "../../core/dom-refs.js";
import {
  setQuickSearchAssistVisible, initializeAdvancedSearchHelp, QUICK_SEARCH_ROW_HEIGHT,
  QUICK_SEARCH_OVERSCAN, renderWorkspaceSearch, cancelActiveWorkspaceSearch,
} from "./workspace-search.js";
import { escapeHtml } from "../../core/text-format.js";
import { refreshDirMap } from "../chat/prompt-context.js";

export function quickShortcutLabel(keys) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return keys.replace(/Ctrl/g, isMac ? "Cmd" : "Ctrl");
}

export function scoreQuickMatch(text, query) {
  const hay = String(text || "").toLowerCase();
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return 1;
  if (hay === clean) return 1000;
  if (hay.startsWith(clean)) return 700;
  if (hay.includes(clean)) return 500 - hay.indexOf(clean);

  let pos = -1;
  let score = 0;
  for (const char of clean) {
    pos = hay.indexOf(char, pos + 1);
    if (pos < 0) return 0;
    score += Math.max(1, 40 - pos);
  }
  return score;
}

export function buildCommandItems() {
  return [
    {
      title: "Search: Open Workspace File",
      detail: appState.rootPath ? "Open a file by name" : "Create or open a project first",
      icon: "codicon-go-to-file",
      key: quickShortcutLabel("Ctrl+P"),
      disabled: !appState.rootPath,
      run: () => openQuickPalette("file"),
    },
    {
      title: "Search: Project",
      detail: appState.rootPath ? `Search ${projectName(appState.rootPath)}` : "Open a project first",
      icon: "codicon-search",
      key: quickShortcutLabel("Ctrl+F"),
      disabled: !appState.rootPath,
      run: () => openQuickPalette("search"),
    },
    {
      title: "Project: Create New Project",
      detail: "Create a blank project folder without scaffolding files",
      icon: "codicon-folder-library",
      run: () => createProject(),
    },
    {
      title: "Project: Open Existing Project",
      detail: appState.rootPath || "Choose an existing folder",
      icon: "codicon-folder-library",
      run: () => openProject(),
    },
    {
      title: "Security: Open Workbench",
      detail: "Show Interceptor, Repeater, and Intruder in the workspace",
      icon: "codicon-shield",
      run: () => showSecurityWorkspace(),
    },
    {
      title: "Terminal: Toggle",
      detail: appState.terminalCollapsed ? "Show terminal" : "Hide terminal",
      icon: "codicon-terminal",
      key: "Ctrl+`",
      run: () => setTerminalCollapsed(!appState.terminalCollapsed),
    },
    {
      title: "Terminal: New Session",
      detail: "Create a new shell session",
      icon: "codicon-add",
      key: "Ctrl+Shift+`",
      run: () => TerminalManager.createTerminalAndShow(),
    },
    {
      title: "Terminal: Clear",
      detail: "Clear the active shell",
      icon: "codicon-clear-all",
      run: () => TerminalManager.clearActive(),
    },
    {
      title: "Chat: Toggle",
      detail: appState.chatCollapsed ? "Show chat" : "Hide chat",
      icon: "codicon-comment-discussion",
      run: () => appState.chatCollapsed ? openChatPane({ createIfEmpty: true }) : setChatCollapsed(true),
    },
    {
      title: "Chat: New Session",
      detail: "Start a fresh chat",
      icon: "codicon-add",
      disabled: false,
      run: () => newChatSession(),
    },
  ];
}

export function quickFileItems(query) {
  const files = ToolParser.parseProjectFiles(appState.dirMapCache || "");
  return files
    .map((file) => {
      const name = basenameOf(file);
      const score = Math.max(
        scoreQuickMatch(name, query) + 40,
        scoreQuickMatch(file, query),
      );
      return {
        title: name,
        detail: file,
        icon: "codicon-file",
        score,
        run: () => showResourcePreview(joinWorkspacePath(file), name, file, { icon: "codicon-file" }),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.detail.localeCompare(b.detail))
    .slice(0, 80);
}

export function setQuickModeUi(mode) {
  const labels = {
    command: ["codicon-chevron-right", "Type a command", "Command Palette"],
    file: ["codicon-go-to-file", "Search files by name", "Quick Open"],
    search: ["codicon-search", "Search workspace text", "Workspace Search"],
  };
  const [icon, placeholder, title] = labels[mode] || labels.command;
  quickPanel?.setAttribute("aria-label", title);
  quickPanel?.classList.toggle("quick-panel-search", mode === "search");
  if (mode === "search") initializeAdvancedSearchHelp();
  else setQuickSearchAssistVisible(false);
  if (quickSearchHelp) quickSearchHelp.hidden = mode !== "search";
  if (quickSearchChips && mode !== "search") quickSearchChips.hidden = true;
  if (quickSearchSuggestions && mode !== "search") quickSearchSuggestions.hidden = true;
  if (quickInput) quickInput.placeholder = placeholder;
  if (quickIcon) quickIcon.className = `codicon ${icon}`;
}

export function renderQuickList(items, metaText = "", { quietEmpty = false } = {}) {
  appState.quickItems = items;
  appState.quickSelection = Math.max(0, Math.min(appState.quickSelection, appState.quickItems.length - 1));
  quickPanel?.classList.toggle("quick-panel-minimal", quietEmpty);
  if (quickMeta) {
    quickMeta.textContent = metaText;
    quickMeta.hidden = quietEmpty;
    quickMeta.classList.remove("quick-meta-error");
  }
  if (!quickResults) return;
  quickResults.classList.remove("is-virtualized");
  quickResults.innerHTML = "";
  quickResults.hidden = quietEmpty;
  if (quietEmpty) return;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "quick-empty";
    empty.textContent = metaText || "No results";
    quickResults.appendChild(empty);
    return;
  }

  items.forEach((item, index) => quickResults.appendChild(createQuickResultRow(item, index)));
}

export function createQuickResultRow(item, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.dataset.quickIndex = String(index);
  row.className = `quick-result${index === appState.quickSelection ? " active" : ""}`;
  row.innerHTML = `
    <span class="codicon ${escapeHtml(item.icon || "codicon-chevron-right")} quick-result-icon"></span>
    <span class="quick-result-main">
      <span class="quick-result-title">${escapeHtml(item.title || "")}</span>
      <span class="quick-result-detail">${item.detailHtml || escapeHtml(item.detail || "")}</span>
    </span>
    <span class="quick-result-key">${escapeHtml(item.key || "")}</span>
  `;
  row.addEventListener("mouseenter", () => {
    appState.quickSelection = index;
    if (quickResults?.classList.contains("is-virtualized")) {
      [...quickResults.querySelectorAll(".quick-result")].forEach((candidate) => {
        candidate.classList.toggle("active", Number(candidate.dataset.quickIndex) === appState.quickSelection);
      });
      return;
    }
    syncQuickSelection();
  });
  row.addEventListener("click", () => runSelectedQuickItem(index));
  return row;
}

export function renderVirtualizedSearchResults(metaText = quickMeta?.textContent || "") {
  quickPanel?.classList.remove("quick-panel-minimal");
  if (quickMeta) {
    quickMeta.hidden = false;
    quickMeta.textContent = metaText;
    quickMeta.classList.remove("quick-meta-error");
  }
  if (!quickResults) return;
  quickResults.hidden = false;
  quickResults.classList.add("is-virtualized");
  if (!appState.quickItems.length) {
    quickResults.replaceChildren();
    if (String(metaText).startsWith("Searching")) return;
    const empty = document.createElement("div");
    empty.className = "quick-empty";
    empty.textContent = metaText || "No exact matches";
    quickResults.appendChild(empty);
    return;
  }

  const viewportHeight = quickResults.clientHeight || 480;
  const start = Math.max(0, Math.floor(quickResults.scrollTop / QUICK_SEARCH_ROW_HEIGHT) - QUICK_SEARCH_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / QUICK_SEARCH_ROW_HEIGHT) + (QUICK_SEARCH_OVERSCAN * 2);
  const end = Math.min(appState.quickItems.length, start + visibleCount);
  let space = quickResults.querySelector(":scope > .quick-results-virtual-space");
  if (!space) {
    space = document.createElement("div");
    space.className = "quick-results-virtual-space";
    quickResults.replaceChildren(space);
  }
  space.style.height = `${appState.quickItems.length * QUICK_SEARCH_ROW_HEIGHT}px`;
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    const row = createQuickResultRow(appState.quickItems[index], index);
    row.style.top = `${index * QUICK_SEARCH_ROW_HEIGHT}px`;
    fragment.appendChild(row);
  }
  space.replaceChildren(fragment);
}

export function syncQuickSelection() {
  if (!quickResults) return;
  if (quickResults.classList.contains("is-virtualized")) {
    const rowTop = appState.quickSelection * QUICK_SEARCH_ROW_HEIGHT;
    const rowBottom = rowTop + QUICK_SEARCH_ROW_HEIGHT;
    let movedViewport = false;
    if (rowTop < quickResults.scrollTop) {
      quickResults.scrollTop = rowTop;
      movedViewport = true;
    }
    else if (rowBottom > quickResults.scrollTop + quickResults.clientHeight) {
      quickResults.scrollTop = Math.max(0, rowBottom - quickResults.clientHeight);
      movedViewport = true;
    }
    if (movedViewport) {
      renderVirtualizedSearchResults();
      return;
    }
    [...quickResults.querySelectorAll(".quick-result")].forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.quickIndex) === appState.quickSelection);
    });
    return;
  }
  [...quickResults.querySelectorAll(".quick-result")].forEach((row) => {
    const index = Number(row.dataset.quickIndex);
    row.classList.toggle("active", index === appState.quickSelection);
    if (index === appState.quickSelection) row.scrollIntoView({ block: "nearest" });
  });
}

export function renderCommandPalette() {
  const query = quickInput?.value || "";
  const items = buildCommandItems()
    .filter((item) => !item.disabled)
    .map((item) => ({
      ...item,
      score: Math.max(
        scoreQuickMatch(item.title, query),
        scoreQuickMatch(item.detail, query) * 0.6,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  renderQuickList(items, `${items.length} command${items.length === 1 ? "" : "s"}`);
}

export function renderQuickFiles() {
  const query = quickInput?.value || "";
  if (!appState.rootPath) {
    renderQuickList([], "Open a folder to use Quick Open");
    return;
  }
  const items = quickFileItems(query);
  renderQuickList(items, `${items.length} file${items.length === 1 ? "" : "s"}`);
}

export function renderQuickPalette() {
  if (appState.quickMode === "file") renderQuickFiles();
  else if (appState.quickMode === "search") renderWorkspaceSearch();
  else renderCommandPalette();
}

export async function openQuickPalette(mode = "command", initialValue = "") {
  if (!quickOverlay || !quickInput) return;
  appState.quickMode = mode;
  appState.quickSelection = 0;
  setQuickModeUi(mode);
  if (mode === "file" && appState.rootPath && !appState.dirMapCache) await refreshDirMap();
  quickInput.value = initialValue;
  quickOverlay.hidden = false;
  renderQuickPalette();
  requestAnimationFrame(() => {
    quickInput.focus();
    quickInput.select();
  });
}

export function closeQuickPalette() {
  if (quickOverlay) quickOverlay.hidden = true;
  if (appState.quickSearchTimer) clearTimeout(appState.quickSearchTimer);
  cancelActiveWorkspaceSearch();
  appState.quickSearchSeq += 1;
  appState.quickItems = [];
  setQuickSearchAssistVisible(false);
  if (quickSearchSuggestions) quickSearchSuggestions.hidden = true;
  if (appState.activeTabPath) EditorManager.focus();
  else chatInput?.focus();
}

export async function runSelectedQuickItem(index = appState.quickSelection) {
  const item = appState.quickItems[index];
  if (!item) return;
  closeQuickPalette();
  await item.run?.();
}
