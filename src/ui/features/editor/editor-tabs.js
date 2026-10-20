import { appState } from "../../core/app-state.js";
import { EditorManager } from "../../core/runtime-globals.js";
import {
  normPath, basenameOf, remapWorkspacePath, relativePathFromRoot, joinWorkspacePath,
} from "../../core/workspace-paths.js";
import {
  showCodeEditorWorkspace, isBrowserTab, switchToBrowserTab, setSidebarCollapsed, setSidebarView,
} from "../../bootstrap.js";
import {
  renderTabs, renderEditor, MARKDOWN_VIEW_MODE_KEY, isMarkdownFileName,
} from "./editor-render.js";
import {
  editorTabBar, editorError, editorTabContextMenu, appSettingsWorkspace,
} from "../../core/dom-refs.js";
import {
  SETTINGS_EDITOR_MODE_KEY, syncSettingsEditorButtons, isAssessmentSettingsTab, isSettingsTab,
} from "../settings/settings-tab-editor.js";
import { switchToSettingsTab } from "../settings/app-settings-shell.js";
import {
  switchToInterceptorTab, isInterceptorTab, configureProxyListener,
} from "../interceptor/interceptor-controls.js";
import { loadMcpSettings } from "../settings/mcp-settings.js";
import { setExplorerRootExpanded } from "../project/project-activation.js";
import { writeChatClipboardText } from "../chat/chat-messages.js";
import { closeWorkspaceContextMenu } from "../project/explorer-context-menu.js";
import { closeCustomContextMenu } from "../assessment/custom-entries.js";
import { closeSecurityHistoryMenu } from "../security/traffic-history.js";
import { restoreChatComposerAfterUiAction } from "../project/explorer-tree.js";

/** @type {Map<string, { path: string, diskPath: string, name: string, content: string | null, savedContent: string, dirty: boolean, error: string | null, preview?: boolean, special?: string, securityTool?: string }>} */
export const openTabs      = new Map();

export function remapOpenTabsUnderWorkspacePath(sourceAbsolute, destinationAbsolute) {
  commitActiveTab();
  const entries = [...openTabs.entries()];
  let changed = false;
  openTabs.clear();
  for (const [tabPath, tab] of entries) {
    const nextPath = remapWorkspacePath(tabPath, sourceAbsolute, destinationAbsolute);
    if (nextPath !== normPath(tabPath)) {
      changed = true;
      EditorManager.disposeModel(tabPath);
      tab.path = nextPath;
      tab.diskPath = nextPath;
      tab.name = basenameOf(nextPath);
    }
    openTabs.set(nextPath, tab);
  }
  if (!changed) return;
  appState.activeTabPath = remapWorkspacePath(appState.activeTabPath, sourceAbsolute, destinationAbsolute);
  appState.editorLoadedPath = null;
  renderTabs();
  renderEditor({ focusEditor: false });
}

export function closeTabsUnderWorkspacePath(absPath, { force = false } = {}) {
  const target = normPath(absPath);
  for (const tabPath of [...openTabs.keys()]) {
    if (tabPath === target || tabPath.startsWith(`${target}/`)) {
      closeTab(tabPath, null, { force });
    }
  }
}

export function clearEditorTabDropIndicators() {
  editorTabBar?.querySelectorAll(".tab-drop-before, .tab-drop-after")
    .forEach((tab) => tab.classList.remove("tab-drop-before", "tab-drop-after"));
}

export function setEditorTabDropIndicator(tabElement, event) {
  clearEditorTabDropIndicators();
  const bounds = tabElement.getBoundingClientRect();
  const after = event.clientX >= bounds.left + (bounds.width / 2);
  tabElement.classList.add(after ? "tab-drop-after" : "tab-drop-before");
  return after;
}

export function reorderOpenTabs(draggedPath, targetPath, { after = false } = {}) {
  if (!draggedPath || !targetPath || draggedPath === targetPath) return false;
  const entries = [...openTabs.entries()];
  const draggedIndex = entries.findIndex(([path]) => path === draggedPath);
  if (draggedIndex < 0 || !openTabs.has(targetPath)) return false;

  const [draggedEntry] = entries.splice(draggedIndex, 1);
  let targetIndex = entries.findIndex(([path]) => path === targetPath);
  if (targetIndex < 0) return false;
  if (after) targetIndex += 1;
  entries.splice(targetIndex, 0, draggedEntry);

  openTabs.clear();
  entries.forEach(([path, tab]) => openTabs.set(path, tab));
  normalizeEditorTabOrder();
  renderTabs();
  return true;
}

export function normalizeEditorTabOrder() {
  const entries = [...openTabs.entries()];
  if (!entries.some(([, tab]) => tab.pinned)) return;

  const pinned = entries
    .filter(([, tab]) => tab.pinned)
    .sort((a, b) => (b[1].pinnedAt ?? 0) - (a[1].pinnedAt ?? 0));
  const unpinned = entries.filter(([, tab]) => !tab.pinned);

  openTabs.clear();
  [...pinned, ...unpinned].forEach(([path, tab]) => openTabs.set(path, tab));
}

export function pinEditorTab(tabPath) {
  const tab = openTabs.get(tabPath);
  if (!tab) return;
  tab.pinned = true;
  tab.pinnedAt = Date.now();
  normalizeEditorTabOrder();
  renderTabs();
}

export function unpinEditorTab(tabPath) {
  const tab = openTabs.get(tabPath);
  if (!tab?.pinned) return;
  tab.pinned = false;
  delete tab.pinnedAt;
  normalizeEditorTabOrder();
  renderTabs();
}

export async function openFile(filePath, fileName, {
  focusEditor = true,
  line = 0,
  column = 1,
} = {}) {
  const path = normPath(filePath);
  if (line > 0 && isMarkdownFileName(fileName) && appState.markdownViewMode === "md") {
    appState.markdownViewMode = "text";
    localStorage.setItem(MARKDOWN_VIEW_MODE_KEY, appState.markdownViewMode);
  }
  if (line > 0 && fileName === "Project Runtime Settings" && appState.settingsEditorMode === "ui") {
    appState.settingsEditorMode = "json";
    localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, appState.settingsEditorMode);
    syncSettingsEditorButtons();
  }
  showCodeEditorWorkspace();

  const existingTab = openTabs.get(path);
  if (existingTab) {
    switchToTab(path, { focusEditor });
    if (line > 0) {
      await renderEditor({ focusEditor });
      await EditorManager.revealLocation?.(path, line, column);
    }
    return;
  }

  openTabs.set(path, {
    path,
    diskPath: filePath,
    name: fileName,
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
  });
  renderTabs();
  switchToTab(path, { focusEditor });

  const result = await window.api.readFile(filePath);
  const tab = openTabs.get(path);
  if (!tab) return;

  if (result.error) {
    tab.error = result.error;
    tab.content = null;
  } else {
    const text = result.content ?? "";
    tab.content = text;
    tab.savedContent = text;
    tab.dirty = false;
    tab.error = null;
  }

  if (appState.activeTabPath === path) {
    await renderEditor({ focusEditor });
    if (line > 0) await EditorManager.revealLocation?.(path, line, column);
  }
}

export function commitActiveTab() {
  if (!appState.activeTabPath || !openTabs.has(appState.activeTabPath)) return;
  const tab = openTabs.get(appState.activeTabPath);
  if (isBrowserTab(tab)) return;
  if (tab.error || tab.content === null) return;
  if (isAssessmentSettingsTab(tab) && appState.settingsEditorMode === "ui") {
    tab.dirty = tab.content !== tab.savedContent;
    return;
  }
  // Markdown preview intentionally does not attach its source to Monaco. Do
  // not replace the loaded Markdown with an empty loading model on tab changes.
  if (isMarkdownFileName(tab.name) && appState.markdownViewMode === "md") return;
  tab.content = EditorManager.getValue(appState.activeTabPath);
  tab.dirty = tab.content !== tab.savedContent;
}

export function switchToTab(filePath, { focusEditor = true } = {}) {
  if (!openTabs.has(filePath)) return;
  if (isBrowserTab(openTabs.get(filePath))) {
    switchToBrowserTab();
    return;
  }
  if (isSettingsTab(openTabs.get(filePath))) {
    switchToSettingsTab();
    return;
  }
  if (isInterceptorTab(openTabs.get(filePath))) {
    switchToInterceptorTab();
    return;
  }
  showCodeEditorWorkspace();
  commitActiveTab();
  appState.activeTabPath = filePath;
  appState.editorLoadedPath = null;
  renderTabs();
  renderEditor({ focusEditor });
}

export async function saveActiveTab() {
  commitActiveTab();
  if (!appState.activeTabPath) return;
  const tab = openTabs.get(appState.activeTabPath);
  if (!tab || tab.error || isBrowserTab(tab)) return;
  if (!tab.dirty) {
    EditorManager.clearChangeDecorations(appState.activeTabPath);
    if (isAssessmentSettingsTab(tab)) await configureProxyListener();
    return;
  }

  const result = await window.api.writeFile(tab.diskPath, tab.content);
  if (result.error) {
    editorError.textContent = result.error;
    editorError.hidden = false;
    EditorManager.clear();
    return;
  }

  tab.savedContent = tab.content;
  tab.dirty = false;
  EditorManager.clearChangeDecorations(appState.activeTabPath);
  renderTabs();
  if (isAssessmentSettingsTab(tab)) await configureProxyListener();
  const savedPath = String(tab.diskPath || "").replace(/\\/g, "/").toLowerCase();
  if (savedPath.endsWith("mcp.json") && appState.appSettingsSection === "commands") {
    await loadMcpSettings();
  }
}

export function focusExplorerSidebar() {
  setSidebarView("project");
  if (appState.sidebarCollapsed) setSidebarCollapsed(false);
  setExplorerRootExpanded(true);
}

export function getEditorTabAbsolutePath(tab) {
  if (!tab || isSettingsTab(tab) || isInterceptorTab(tab) || isBrowserTab(tab)) return null;
  const rawPath = tab.diskPath || tab.path || "";
  if (!rawPath || String(rawPath).startsWith("xekute:")) return null;
  if (appState.rootPath) {
    const relativePath = relativePathFromRoot(rawPath);
    if (relativePath !== null) return joinWorkspacePath(relativePath);
  }
  return rawPath;
}

export function getEditorTabFileActions(tab) {
  const absolutePath = getEditorTabAbsolutePath(tab);
  if (!absolutePath) {
    return { canReveal: false, canCopyPath: false, canCopyRelative: false };
  }
  const diskPath = normPath(absolutePath);
  const relativePath = appState.rootPath ? relativePathFromRoot(absolutePath) : null;
  return {
    canReveal: true,
    canCopyPath: true,
    canCopyRelative: relativePath !== null,
    diskPath,
    relativePath: relativePath ?? "",
  };
}

export function updateEditorTabContextMenuActions(tab) {
  if (!editorTabContextMenu) return;
  const actions = getEditorTabFileActions(tab);
  const showCopySection = actions.canCopyPath || actions.canCopyRelative;
  editorTabContextMenu.querySelector('[data-editor-tab-separator="explorer"]')?.toggleAttribute("hidden", !actions.canReveal);
  editorTabContextMenu.querySelector('[data-editor-tab-action="reveal-explorer"]')?.toggleAttribute("hidden", !actions.canReveal);
  editorTabContextMenu.querySelector('[data-editor-tab-separator="copy"]')?.toggleAttribute("hidden", !showCopySection);
  editorTabContextMenu.querySelector('[data-editor-tab-action="copy-path"]')?.toggleAttribute("hidden", !actions.canCopyPath);
  editorTabContextMenu.querySelector('[data-editor-tab-action="copy-relative-path"]')?.toggleAttribute("hidden", !actions.canCopyRelative);
}

export async function revealEditorTabInExplorer(tabPath) {
  const tab = openTabs.get(tabPath);
  const targetPath = getEditorTabAbsolutePath(tab);
  if (!targetPath) return;

  if (typeof window.api?.showItemInFolder !== "function") {
    await AppDialog.alert("Reveal in File Explorer is unavailable.", { title: "Reveal failed" });
    return;
  }

  const result = await window.api.showItemInFolder(targetPath);
  if (result?.error) {
    await AppDialog.alert(result.error, { title: "Reveal failed" });
  }
}

export async function copyEditorTabPath(tabPath, { relative = false } = {}) {
  const tab = openTabs.get(tabPath);
  const actions = getEditorTabFileActions(tab);
  const text = relative ? actions.relativePath : actions.diskPath;
  if (!text) return;
  await writeChatClipboardText(text);
}

export function closeEditorTabContextMenu() {
  if (!editorTabContextMenu) return;
  editorTabContextMenu.hidden = true;
  appState.editorTabContextMenuPath = null;
}

export function openEditorTabContextMenu(clientX, clientY, tabPath) {
  if (!editorTabContextMenu || !openTabs.has(tabPath)) return;
  closeCustomContextMenu();
  closeWorkspaceContextMenu();
  closeSecurityHistoryMenu();

  appState.editorTabContextMenuPath = tabPath;
  const paths = [...openTabs.keys()];
  const idx = paths.indexOf(tabPath);
  const tab = openTabs.get(tabPath);
  const closeRightBtn = editorTabContextMenu.querySelector('[data-editor-tab-action="close-right"]');
  const pinActionBtn = editorTabContextMenu.querySelector('[data-editor-tab-action="toggle-pin"]');
  if (closeRightBtn) closeRightBtn.disabled = idx < 0 || idx >= paths.length - 1;
  if (pinActionBtn) pinActionBtn.textContent = tab?.pinned ? "Unpin" : "Pin";
  updateEditorTabContextMenuActions(tab);

  editorTabContextMenu.hidden = false;
  editorTabContextMenu.style.visibility = "hidden";
  editorTabContextMenu.style.left = "0px";
  editorTabContextMenu.style.top = "0px";

  const { width, height } = editorTabContextMenu.getBoundingClientRect();
  const pad = 4;
  let left = clientX;
  let top = clientY;
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
  if (top + height > window.innerHeight - pad) top = window.innerHeight - height - pad;
  editorTabContextMenu.style.left = `${Math.max(pad, left)}px`;
  editorTabContextMenu.style.top = `${Math.max(pad, top)}px`;
  editorTabContextMenu.style.visibility = "";
}

export async function closeEditorTabsInOrder(paths) {
  for (const path of paths) {
    if (!openTabs.has(path)) continue;
    const countBefore = openTabs.size;
    await closeTab(path);
    if (openTabs.size === countBefore) return;
  }
}

export async function closeEditorTabsToRight(tabPath) {
  const paths = [...openTabs.keys()];
  const idx = paths.indexOf(tabPath);
  if (idx < 0 || idx >= paths.length - 1) return;
  await closeEditorTabsInOrder(paths.slice(idx + 1).reverse());
}

export async function closeAllEditorTabs() {
  await closeEditorTabsInOrder([...openTabs.keys()].reverse());
}

export async function handleEditorTabContextMenuAction(action) {
  const tabPath = appState.editorTabContextMenuPath;
  closeEditorTabContextMenu();
  if (!tabPath) return;
  if (action === "close") await closeTab(tabPath);
  else if (action === "close-right") await closeEditorTabsToRight(tabPath);
  else if (action === "close-all") await closeAllEditorTabs();
  else if (action === "toggle-pin") {
    if (openTabs.get(tabPath)?.pinned) unpinEditorTab(tabPath);
    else pinEditorTab(tabPath);
  }
  else if (action === "reveal-explorer") await revealEditorTabInExplorer(tabPath);
  else if (action === "copy-path") await copyEditorTabPath(tabPath);
  else if (action === "copy-relative-path") await copyEditorTabPath(tabPath, { relative: true });
}

export async function closeTab(filePath, e, { force = false } = {}) {
  e?.stopPropagation();
  if (!openTabs.has(filePath)) return;

  if (filePath === appState.activeTabPath) commitActiveTab();
  const tab = openTabs.get(filePath);
  if (isBrowserTab(tab)) appState.browserWorkspace?.setVisible(false);
  if (tab?.dirty && !force) {
    if (!await AppDialog.confirm(`"${tab.name}" has unsaved changes. Close anyway?`, { title: "Unsaved changes", confirmLabel: "Close", tone: "danger" })) return;
  }

  const paths = [...openTabs.keys()];
  const idx = paths.indexOf(filePath);
  const wasActive = appState.activeTabPath === filePath;
  EditorManager.disposeModel(filePath);
  openTabs.delete(filePath);

  if (wasActive) {
    appState.editorLoadedPath = null;
    if (openTabs.size === 0) {
      appState.activeTabPath = null;
      appState.currentWorkspaceMode = "editor";
      showCodeEditorWorkspace();
      if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
    } else {
      const next = paths[idx + 1] ?? paths[idx - 1];
      appState.activeTabPath = openTabs.has(next) ? next : [...openTabs.keys()][0];
    }
  }

  renderTabs();
  renderEditor();
  restoreChatComposerAfterUiAction();
}
