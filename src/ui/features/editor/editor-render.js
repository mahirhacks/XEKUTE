import { appState } from "../../core/app-state.js";
import {
  editorTabBar, editorPathBar, editorPathLabel, editorBody, editorEmpty, editorView, editorError,
  monacoContainer, markdownPreview, settingsEditorToolbar, settingsUIView, editorPane,
  resourceViewer, appSettingsWorkspace, assessmentModuleView, securityWorkspace,
  webcloneWorkspace,
} from "../../core/dom-refs.js";
import { SetiIconTheme, EditorManager } from "../../core/runtime-globals.js";
import { relativePathFromRoot, normPath } from "../../core/workspace-paths.js";
import {
  isSettingsTab, isAssessmentSettingsTab, renderSettingsForm, syncSettingsEditorButtons,
} from "../settings/settings-tab-editor.js";
import { isInterceptorTab } from "../interceptor/interceptor-controls.js";
import {
  openTabs, clearEditorTabDropIndicators, setEditorTabDropIndicator, reorderOpenTabs,
  unpinEditorTab, switchToTab, openEditorTabContextMenu, closeTab,
} from "./editor-tabs.js";
import {
  isBrowserTab, syncWorkspaceActivity, showSecurityWorkspaceContent, showBrowserWorkspaceContent,
} from "../../bootstrap.js";
import { renderMarkdown } from "../chat/chat-messages.js";
import { loadSettingsWorkspace } from "../settings/app-settings-shell.js";

export const MARKDOWN_VIEW_MODE_KEY = "pointer:markdownViewMode";

export function isMarkdownFileName(fileName = "") {
  return /\.(?:md|markdown)$/i.test(String(fileName || ""));
}

export function setMarkdownViewMode(mode) {
  appState.markdownViewMode = mode === "md" ? "md" : "text";
  localStorage.setItem(MARKDOWN_VIEW_MODE_KEY, appState.markdownViewMode);
  renderTabs();
  renderEditor({ focusEditor: false });
}

export function renderTabs() {
  editorTabBar.innerHTML = "";

  for (const [path, tab] of openTabs) {
    const el = document.createElement("div");
    el.className = "editor-tab"
      + (path === appState.activeTabPath ? " active" : "")
      + (tab.pinned ? " editor-tab-pinned" : "");
    const specialWorkspaceTab = isSettingsTab(tab) || isInterceptorTab(tab) || isBrowserTab(tab);
    if (specialWorkspaceTab) el.classList.add("special-workspace-tab");
    el.title = specialWorkspaceTab
      ? tab.name
      : (relativePathFromRoot(tab.diskPath) || tab.diskPath || tab.name);
    el.draggable = true;
    el.addEventListener("click", () => switchToTab(path));
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      switchToTab(path, { focusEditor: true });
    });
    el.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".tab-close, .tab-pin")) return;
      event.preventDefault();
      event.stopPropagation();
      openEditorTabContextMenu(event.clientX, event.clientY, path);
    });
    el.addEventListener("dragstart", (event) => {
      if (event.target.closest(".tab-close, .tab-pin")) {
        event.preventDefault();
        return;
      }
      appState.draggedEditorTabPath = path;
      el.classList.add("tab-dragging");
      event.dataTransfer?.setData("application/x-xekute-editor-tab", path);
      event.dataTransfer?.setData("text/plain", path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", (event) => {
      const draggedPath = appState.draggedEditorTabPath || event.dataTransfer?.getData("application/x-xekute-editor-tab");
      if (!draggedPath || draggedPath === path) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setEditorTabDropIndicator(el, event);
    });
    el.addEventListener("dragleave", (event) => {
      if (!el.contains(event.relatedTarget)) el.classList.remove("tab-drop-before", "tab-drop-after");
    });
    el.addEventListener("drop", (event) => {
      const draggedPath = appState.draggedEditorTabPath || event.dataTransfer?.getData("application/x-xekute-editor-tab");
      if (!draggedPath || draggedPath === path) return;
      event.preventDefault();
      event.stopPropagation();
      const after = setEditorTabDropIndicator(el, event);
      clearEditorTabDropIndicators();
      reorderOpenTabs(draggedPath, path, { after });
    });
    el.addEventListener("dragend", () => {
      appState.draggedEditorTabPath = null;
      el.classList.remove("tab-dragging");
      clearEditorTabDropIndicators();
    });

    const icon = document.createElement("span");
    const specialIcon = isSettingsTab(tab)
      ? "codicon-settings-gear"
      : isInterceptorTab(tab)
        ? "codicon-debug-disconnect"
        : isBrowserTab(tab) ? "codicon-globe" : "";
    if (specialIcon) {
      icon.className = `tab-icon codicon ${specialIcon}`;
    } else {
      const info = SetiIconTheme.iconForFile(tab.name);
      icon.className = "tab-icon seti-icon";
      icon.textContent = info.glyph;
      icon.style.color = info.color;
    }
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "tab-label" + (tab.dirty ? " tab-dirty" : "");
    label.textContent = tab.name;

    let pin = null;
    if (tab.pinned) {
      pin = document.createElement("button");
      pin.className = "tab-pin";
      pin.title = "Unpin";
      pin.draggable = false;
      pin.innerHTML = '<span class="codicon codicon-pinned"></span>';
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        unpinEditorTab(path);
      });
    }

    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close";
    close.draggable = false;
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (e) => { void closeTab(path, e); });

    el.appendChild(icon);
    el.appendChild(label);
    if (pin) el.appendChild(pin);
    el.appendChild(close);
    editorTabBar.appendChild(el);
  }

  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (activeTab && isMarkdownFileName(activeTab.name)) {
    const actions = document.createElement("div");
    actions.className = "editor-tab-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Markdown view");

    const switcher = document.createElement("div");
    switcher.className = "editor-tab-view-switch";
    for (const mode of ["md", "text"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = mode === "md" ? "MD" : "Text";
      button.dataset.markdownView = mode;
      button.setAttribute("aria-pressed", String(appState.markdownViewMode === mode));
      button.classList.toggle("active", appState.markdownViewMode === mode);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setMarkdownViewMode(mode);
      });
      switcher.appendChild(button);
    }
    actions.appendChild(switcher);
    editorTabBar.appendChild(actions);
  }

  updateEditorPathBar();
}

export function updateEditorPathBar() {
  if (!editorPathBar || !editorPathLabel) return;
  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (!activeTab || isSettingsTab(activeTab) || isInterceptorTab(activeTab) || isBrowserTab(activeTab)) {
    editorPathBar.hidden = true;
    editorPathLabel.textContent = "";
    editorPathLabel.removeAttribute("title");
    return;
  }
  const filePath = activeTab.diskPath || activeTab.path || "";
  const relativePath = relativePathFromRoot(filePath);
  const projectPath = relativePath === null ? (activeTab.name || "") : relativePath;
  const displayPath = normPath(projectPath).replace(/^\/+/, "");
  editorPathLabel.textContent = displayPath;
  editorPathBar.hidden = !displayPath;
  editorPathLabel.title = displayPath;
}

export function updateTabDirtyIndicator() {
  const idx = [...openTabs.keys()].indexOf(appState.activeTabPath);
  const tabEl = editorTabBar.children[idx];
  const tab = openTabs.get(appState.activeTabPath);
  tabEl?.querySelector(".tab-label")?.classList.toggle("tab-dirty", !!tab?.dirty);
}

export async function renderEditor({ focusEditor = true } = {}) {
  if (markdownPreview) markdownPreview.hidden = true;

  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (isBrowserTab(activeTab)) {
    showBrowserWorkspaceContent();
    return;
  }
  appState.browserWorkspace?.setVisible(false);
  if (isSettingsTab(activeTab)) {
    if (editorEmpty) editorEmpty.setAttribute("hidden", "");
    if (editorView) editorView.setAttribute("hidden", "");
    if (monacoContainer) monacoContainer.hidden = true;
    if (settingsUIView) settingsUIView.hidden = true;
    if (markdownPreview) markdownPreview.hidden = true;
    if (settingsEditorToolbar) settingsEditorToolbar.hidden = true;
    appState.currentWorkspaceMode = "settings";
    if (editorTabBar) editorTabBar.hidden = false;
    if (editorBody) editorBody.hidden = true;
    updateEditorPathBar();
    if (resourceViewer) resourceViewer.hidden = true;
    if (securityWorkspace) securityWorkspace.hidden = true;
    if (webcloneWorkspace) webcloneWorkspace.hidden = true;
    if (assessmentModuleView) { assessmentModuleView.hidden = true; appState.assessmentModuleActive = false; }
    window.api.webCloneHidePreview?.();
    if (appSettingsWorkspace) appSettingsWorkspace.hidden = false;
    editorPane?.setAttribute("aria-label", "XEKUTE Settings");
    loadSettingsWorkspace();
    syncWorkspaceActivity();
    return;
  }

  if (isInterceptorTab(activeTab)) {
    if (editorEmpty) editorEmpty.setAttribute("hidden", "");
    if (editorView) editorView.setAttribute("hidden", "");
    if (monacoContainer) monacoContainer.hidden = true;
    if (settingsUIView) settingsUIView.hidden = true;
    if (markdownPreview) markdownPreview.hidden = true;
    if (settingsEditorToolbar) settingsEditorToolbar.hidden = true;
    showSecurityWorkspaceContent(activeTab.securityTool || "");
    return;
  }

  if (!appState.activeTabPath || !openTabs.has(appState.activeTabPath)) {
    if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
    if (securityWorkspace) securityWorkspace.hidden = true;
    appState.currentWorkspaceMode = "editor";
    if (editorBody) editorBody.hidden = false;
    editorEmpty.removeAttribute("hidden");
    editorView.setAttribute("hidden", "");
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  const tab = openTabs.get(appState.activeTabPath);
  const settingsTab = isAssessmentSettingsTab(tab);
  const markdownTab = isMarkdownFileName(tab.name);
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  appState.currentWorkspaceMode = "editor";
  if (editorBody) editorBody.hidden = false;
  editorEmpty.setAttribute("hidden", "");
  editorView.removeAttribute("hidden");
  settingsEditorToolbar.hidden = !settingsTab;
  settingsUIView.hidden = true;
  monacoContainer.hidden = false;
  if (settingsTab) syncSettingsEditorButtons();

  if (tab.content === null && !tab.error) {
    editorError.hidden = true;
    appState.editorLoadedPath = null;
    try {
      await EditorManager.showTab(appState.activeTabPath, tab.name, "", { loading: true, focus: focusEditor });
    } catch (error) {
      editorError.hidden = false;
      editorError.textContent = `Editor failed to load: ${error?.message || error?.type || "Unknown editor error"}`;
    }
    return;
  }

  if (tab.error) {
    editorError.hidden = false;
    editorError.textContent = tab.error;
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  editorError.hidden = true;
  const text = tab.content ?? "";

  if (markdownTab && appState.markdownViewMode === "md") {
    monacoContainer.hidden = true;
    settingsUIView.hidden = true;
    markdownPreview.hidden = false;
    renderMarkdown(markdownPreview, text);
    return;
  }

  if (settingsTab && appState.settingsEditorMode === "ui") {
    const rendered = renderSettingsForm(tab);
    if (rendered.error) {
      editorError.hidden = false;
      editorError.textContent = rendered.error;
      monacoContainer.hidden = false;
      settingsUIView.hidden = true;
      return;
    }
    monacoContainer.hidden = true;
    settingsUIView.hidden = false;
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  if (appState.editorLoadedPath !== appState.activeTabPath) {
    try {
      await EditorManager.showTab(appState.activeTabPath, tab.name, text, { focus: focusEditor });
      appState.editorLoadedPath = appState.activeTabPath;
    } catch (error) {
      editorError.hidden = false;
      editorError.textContent = `Editor failed to load: ${error?.message || error?.type || "Unknown editor error"}`;
    }
  }
}
