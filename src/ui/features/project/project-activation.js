import { appState } from "../../core/app-state.js";
import {
  settingsUIView, resourceViewerTitle, resourceViewerMeta, resourceViewerEmpty,
  resourceViewerContent, resourceViewerCopy, checklistUIView, scopeUIView, explorerRootToggle,
  explorerRootChevron, fileTree, explorerTitle, projectSetup, sidebarHeader, statusWorkspace,
} from "../../core/dom-refs.js";
import {
  settingsViewSwitch, selectedCustomEntries, BUG_BOUNTY_PATH_KEY, showResourceWorkspace,
  setResourceDirty, setAssessmentUiState, refreshAssessmentState, refreshSecurityHistoryIfVisible,
  updateRunMenuState, appController, selectedExplorerPaths, expandedTreePaths,
  setExplorerActionsEnabled, renderTree, openFile,
} from "../../bootstrap.js";
import { TerminalManager } from "../../core/runtime-globals.js";
import { restoreChatSessionsForCurrentWorkspace } from "../chat/chat-sessions.js";
import { updateContextUsage } from "../chat/context-usage.js";
import { refreshDirMap } from "../chat/prompt-context.js";
import { loadGuidanceSettings } from "../settings/guidance-settings.js";
import { loadProjectProfile } from "./project-profile.js";

export const WORKSPACE_KEY = "pointer:workspace";

export function resetProjectWorkspaceState() {
  appState.assessmentPath = "";
  appState.browserWorkspace?.projectChanged();
  appState.selectedCustomFolder = "";
  selectedCustomEntries.clear();
  appState.assessmentVerification = null;
  appState.assessmentSettingsCache = null;
  appState.assessmentSettingsVirtual = false;
  localStorage.removeItem(BUG_BOUNTY_PATH_KEY);

  if (resourceViewerTitle) resourceViewerTitle.textContent = appState.rootPath ? projectName(appState.rootPath) : "Project workspace";
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Project workspace";
  appState.resourcePreviewText = "";
  appState.resourceCurrentFilePath = "";
  appState.resourceSavedText = "";
  appState.resourceSettingsActive = false;
  appState.resourceSettingsData = null;
  appState.resourceChecklistActive = false;
  appState.resourceChecklistData = null;
  appState.resourceScopeActive = false;
  appState.resourceScopeData = null;
  if (settingsViewSwitch) settingsViewSwitch.hidden = true;
  if (settingsUIView) settingsUIView.hidden = true;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
  if (resourceViewerContent) {
    resourceViewerContent.value = "";
    resourceViewerContent.hidden = true;
  }
  setResourceDirty(false);
  if (resourceViewerEmpty) resourceViewerEmpty.hidden = false;
  if (resourceViewerCopy) resourceViewerCopy.disabled = true;
  showResourceWorkspace();
}

export async function activateProjectWorkspace(folder) {
  if (!folder) return false;
  const activationGeneration = ++appState.projectActivationGeneration;

  // Verify the folder before replacing the current Target state. This keeps a
  // canceled/invalid selection from blanking the active assessment.
  let entries;
  try {
    entries = await window.api.readdir(folder);
  } catch (error) {
    if (activationGeneration !== appState.projectActivationGeneration) return false;
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "Could not read the selected folder." });
    return false;
  }
  if (activationGeneration !== appState.projectActivationGeneration) return false;
  if (!entries || entries.error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: entries?.error || "Could not read the selected folder." });
    return false;
  }

  resetProjectWorkspaceState();
  let loaded = false;
  try {
    loaded = await loadWorkspace(folder);
  } catch (error) {
    if (activationGeneration !== appState.projectActivationGeneration) return false;
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "The selected folder could not be loaded." });
    return false;
  }
  if (activationGeneration !== appState.projectActivationGeneration) return false;
  if (!loaded) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: "The selected folder could not be loaded." });
    return false;
  }
  await refreshAssessmentState();
  if (activationGeneration !== appState.projectActivationGeneration) return false;
  refreshSecurityHistoryIfVisible();
  if (resourceViewerTitle) resourceViewerTitle.textContent = projectName(folder);
  return true;
}

export async function createProject() {
  setAssessmentUiState("checking", { message: "Choose a name and location for the new project." });
  let result;
  try {
    result = await window.api.createProject({ defaultParent: appState.rootPath || undefined });
  } catch (error) {
    result = { error: error?.message || "Could not create the project." };
  }
  if (result?.canceled) {
    await refreshAssessmentState();
    return;
  }
  if (result?.error || !result?.path) {
    setAssessmentUiState("error", { title: "Project Creation Failed", message: result?.error || "No project folder was created." });
    return;
  }

  resetProjectWorkspaceState();
  await loadWorkspace(result.path);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
  if (resourceViewerTitle) resourceViewerTitle.textContent = projectName(result.path);
}

export function projectName(folder) {
  return folder.replace(/[/\\]$/, "").split(/[/\\]/).pop() || folder;
}

export function setExplorerRootExpanded(expanded) {
  appState.explorerRootExpanded = Boolean(expanded);
  fileTree.hidden = !appState.explorerRootExpanded || !appState.rootPath;
  explorerRootToggle?.classList.toggle("collapsed", !appState.explorerRootExpanded);
  explorerRootChevron?.classList.toggle("codicon-chevron-down", appState.explorerRootExpanded);
  explorerRootChevron?.classList.toggle("codicon-chevron-right", !appState.explorerRootExpanded);
}

export function setProjectFolder(folder) {
  if (projectSetup) projectSetup.hidden = Boolean(folder);
  if (sidebarHeader) sidebarHeader.hidden = !folder;
  if (folder) {
    explorerTitle.textContent = projectName(folder).toUpperCase();
    explorerTitle.title = folder;
    explorerRootToggle.disabled = false;
    if (statusWorkspace) {
      statusWorkspace.textContent = projectName(folder);
      statusWorkspace.title = folder;
    }
  } else {
    explorerTitle.textContent = "NO FOLDER OPENED";
    explorerTitle.title = "";
    explorerRootToggle.disabled = true;
    if (statusWorkspace) {
      statusWorkspace.textContent = "No project";
      statusWorkspace.title = "";
    }
  }
  setExplorerRootExpanded(Boolean(folder));
  updateRunMenuState();
}

export async function loadWorkspace(folder) {
  if (!folder) return false;

  const workspaceOperation = appController.beginWorkspace(folder);

  const entries = await window.api.readdir(folder);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  if (entries.error) {
    localStorage.removeItem(WORKSPACE_KEY);
    return false;
  }

  appState.rootPath = folder;
  appState.assessmentPath = folder;
  appState.browserWorkspace?.projectChanged();
  appState.guidanceContext = "";
  appState.guidanceContextRequestPath = folder;
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, folder);
  appState.selectedItem = null;
  selectedExplorerPaths.clear();
  appState.explorerSelectionAnchorPath = "";
  expandedTreePaths.clear();
  localStorage.setItem(WORKSPACE_KEY, folder);
  setProjectFolder(folder);
  setExplorerActionsEnabled(true);
  TerminalManager.setCwd(folder);
  await renderTree(folder, fileTree, 0);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await refreshDirMap();
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await TerminalManager.openWithProject(folder);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await window.api.watchWorkspace?.(folder);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await restoreChatSessionsForCurrentWorkspace();
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await loadGuidanceSettings({ preserveSelection: true });
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  updateContextUsage();
  setAssessmentUiState("project", {
    title: projectName(folder),
    message: "Project folder active. Configure engagement, scope, ROE, and context in XEKUTE Settings.",
  });
  if (appState.currentWorkspaceMode === "settings") {
    await loadProjectProfile();
    if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  }
  return true;
}

export async function restoreLastWorkspace() {
  const saved = localStorage.getItem(WORKSPACE_KEY);
  if (saved) await loadWorkspace(saved);
  else {
    await restoreChatSessionsForCurrentWorkspace();
    await loadGuidanceSettings({ preserveSelection: true });
  }
}

export async function openProject() {
  let folder;
  try {
    folder = await window.api.openFolder();
  } catch (error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "Could not open the project picker." });
    return false;
  }
  if (!folder) return false;
  return activateProjectWorkspace(folder);
}

export async function openFolder() {
  return openProject();
}

export async function openFileDialog() {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const fileName = filePath.split(/[/\\]/).pop();
  await openFile(filePath, fileName);
}
