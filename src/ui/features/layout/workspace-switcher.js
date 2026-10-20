import { appState } from "../../core/app-state.js";
import {
  activitySecurity, activitySettings, editorTabBar, editorBody, editorPane, resourceViewer,
  appSettingsWorkspace, assessmentModuleView, securityWorkspace, webcloneWorkspace,
  resourceViewerContent, securityRequestEditor, sidebar, sidebarResize, activityExplorer,
  activityBugBounty, btnTopFileTree, btnSidebarMore, sidebarViewTitle, explorerSidebarView,
  bugBountySidebarView,
} from "../../core/dom-refs.js";
import { EditorManager, TerminalManager } from "../../core/runtime-globals.js";
import { setTerminalMaximized } from "../../bootstrap.js";
import { openInterceptorTab } from "../interceptor/interceptor-controls.js";
import {
  SECURITY_TOOL_KEY, setSecurityTool, syncSecurityToolsVisibility,
} from "../security/workbench-runner.js";
import { refreshSecurityHistoryIfVisible } from "../security/traffic-history.js";
import { updateEditorPathBar, renderTabs, renderEditor } from "../editor/editor-render.js";
import { openTabs, commitActiveTab } from "../editor/editor-tabs.js";

export const BROWSER_TAB_PATH = "xekute:browser";

export const SIDEBAR_VIEW_KEY = "pointer:sidebarView";

export function syncWorkspaceActivity() {
  const securityActive = appState.currentWorkspaceMode === "security";
  const settingsActive = appState.currentWorkspaceMode === "settings";
  activitySecurity?.classList.toggle("active", securityActive);
  activitySecurity?.setAttribute("aria-pressed", String(securityActive));
  activitySettings?.classList.toggle("active", settingsActive);
  activitySettings?.setAttribute("aria-pressed", String(settingsActive));
  syncSidebarActivity();
}

export function setCodeEditorVisible(visible) {
  if (editorTabBar) editorTabBar.hidden = !visible;
  if (editorBody) editorBody.hidden = !visible;
  if (visible) requestAnimationFrame(() => EditorManager.layout());
}

export function showCodeEditorWorkspace() {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "editor";
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  setCodeEditorVisible(true);
  editorPane?.setAttribute("aria-label", "Code editor");
  syncWorkspaceActivity();
}

export function showResourceWorkspace({ focus = false } = {}) {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "resource";
  setCodeEditorVisible(false);
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = false;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Workspace editor");
  syncWorkspaceActivity();
  if (focus && !resourceViewerContent?.hidden) requestAnimationFrame(() => resourceViewerContent.focus());
}

export function showSecurityWorkspace(tool = "") {
  openInterceptorTab(tool);
}

export function showSecurityWorkspaceContent(tool = "") {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "security";
  if (editorTabBar) editorTabBar.hidden = false;
  if (editorBody) editorBody.hidden = true;
  updateEditorPathBar();
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = false;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Security workspace");
  const saved = tool || localStorage.getItem(SECURITY_TOOL_KEY) || "interceptor";
  setSecurityTool(saved, { persist: Boolean(tool) });
  syncWorkspaceActivity();
  refreshSecurityHistoryIfVisible();
  requestAnimationFrame(() => securityRequestEditor?.focus());
}

export function setSidebarCollapsed(collapsed) {
  appState.sidebarCollapsed = Boolean(collapsed);
  sidebar?.classList.toggle("collapsed", appState.sidebarCollapsed);
  sidebarResize?.classList.toggle("collapsed", appState.sidebarCollapsed);
  syncSidebarActivity();
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

export function syncSidebarActivity() {
  const projectActive = !appState.sidebarCollapsed
    && appState.currentSidebarView === "project";
  btnTopFileTree?.classList.toggle("active", projectActive);
  btnTopFileTree?.classList.toggle("inactive", !projectActive);
  btnTopFileTree?.setAttribute("aria-pressed", String(projectActive));
  activityExplorer?.classList.toggle("active", projectActive);
  activityExplorer?.setAttribute("aria-pressed", String(projectActive));
  activityBugBounty?.classList.toggle("active", projectActive);
  activityBugBounty?.setAttribute("aria-pressed", String(projectActive));
}

export function setSidebarView(view, { persist = true } = {}) {
  const next = "project";
  appState.currentSidebarView = next;
  if (explorerSidebarView) {
    const visible = next === "project";
    explorerSidebarView.hidden = !visible;
    explorerSidebarView.setAttribute("aria-hidden", String(!visible));
  }
  if (bugBountySidebarView) {
    bugBountySidebarView.hidden = true;
    bugBountySidebarView.setAttribute("aria-hidden", "true");
  }
  if (sidebarViewTitle) sidebarViewTitle.textContent = "Project";
  if (btnSidebarMore) {
    btnSidebarMore.hidden = false;
    btnSidebarMore.title = "Project Actions";
    btnSidebarMore.setAttribute("aria-label", btnSidebarMore.title);
  }
  if (persist) localStorage.setItem(SIDEBAR_VIEW_KEY, next);
  syncSidebarActivity();
  syncSecurityToolsVisibility(true);
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

export function activateSidebarView(view) {
  if (!appState.sidebarCollapsed && appState.currentSidebarView === view) {
    setSidebarCollapsed(true);
    return;
  }
  setSidebarView(view);
  if (appState.sidebarCollapsed) setSidebarCollapsed(false);
}

export function openBrowserTab() {
  if (!openTabs.has(BROWSER_TAB_PATH)) openTabs.set(BROWSER_TAB_PATH, {
    path: BROWSER_TAB_PATH,
    diskPath: BROWSER_TAB_PATH,
    name: "Browser",
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
    special: "browser",
  });
  switchToBrowserTab();
}

export function switchToBrowserTab() {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  commitActiveTab();
  appState.activeTabPath = BROWSER_TAB_PATH;
  appState.editorLoadedPath = null;
  renderTabs();
  renderEditor({ focusEditor: false });
}

export function showBrowserWorkspaceContent() {
  appState.currentWorkspaceMode = "browser";
  if (editorTabBar) editorTabBar.hidden = false;
  if (editorBody) editorBody.hidden = true;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  if (assessmentModuleView) { assessmentModuleView.hidden = true; appState.assessmentModuleActive = false; }
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Browser workspace");
  updateEditorPathBar();
  appState.browserWorkspace?.setVisible(true);
  syncWorkspaceActivity();
}

export function isBrowserTab(tab) {
  return tab?.path === BROWSER_TAB_PATH || tab?.special === "browser";
}
