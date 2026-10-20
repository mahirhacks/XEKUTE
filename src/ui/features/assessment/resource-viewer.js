import { appState } from "../../core/app-state.js";
import {
  resourceViewerTitle, resourceViewerSave, resourceViewerContent, resourceLineNumbers,
  statusLnCol, resourceViewerMeta, settingsUIView, resourceViewerIcon, resourceViewerEmpty,
  resourceViewerCopy, checklistUIView, scopeUIView, assessmentModuleView,
} from "../../core/dom-refs.js";
import { relativePathFromRoot, basenameOf } from "../../core/workspace-paths.js";
import { refreshDirMap } from "../chat/prompt-context.js";
import {
  saveAssessmentSettings, nestedSettingValue, SETTINGS_EDITOR_MODE_KEY, syncSettingsEditorButtons,
  setNestedSettingValue,
} from "../settings/settings-tab-editor.js";
import { settingsViewSwitch, showResourceWorkspace } from "../../bootstrap.js";
import { syncInterceptorToggleUi } from "../interceptor/interceptor-controls.js";
import { ASSESSMENT_MODULE_META, showAssessmentModule } from "./module-runs.js";
import { MANAGED_CORE_RESOURCE_META, showScopeResource } from "./scope-view.js";
import { setAssessmentUiState, assessmentDiskPath } from "./assessment-workspace.js";

export function setResourceDirty(dirty) {
  appState.resourceDirty = Boolean(dirty && appState.resourceCurrentFilePath);
  resourceViewerTitle?.classList.toggle("dirty", appState.resourceDirty);
  if (resourceViewerSave) resourceViewerSave.disabled = !appState.resourceDirty;
}

export function syncResourceCursorPosition() {
  if (!resourceViewerContent) return;
  const lineCount = Math.max(1, resourceViewerContent.value.split("\n").length);
  if (resourceLineNumbers && resourceLineNumbers.dataset.lineCount !== String(lineCount)) {
    resourceLineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
    resourceLineNumbers.dataset.lineCount = String(lineCount);
  }
  if (resourceLineNumbers) resourceLineNumbers.scrollTop = resourceViewerContent.scrollTop;
  if (!statusLnCol || resourceViewerContent.hidden) return;
  const start = resourceViewerContent.selectionStart || 0;
  const before = resourceViewerContent.value.slice(0, start);
  const lines = before.split("\n");
  statusLnCol.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

export async function saveResourceChanges() {
  if (!appState.resourceCurrentFilePath || !appState.resourceDirty) return { ok: true };
  const text = resourceViewerContent.value;

  if (appState.resourceSettingsActive) {
    clearTimeout(appState.resourceSettingsSaveTimer);
    let settings;
    try {
      settings = JSON.parse(text);
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Expected a JSON object");
    } catch (error) {
      resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`;
      resourceViewerContent.focus();
      return { error: error.message };
    }
    const result = await saveAssessmentSettings(settings);
    if (result?.error) {
      resourceViewerMeta.textContent = `Save failed: ${result.error}`;
      return result;
    }
    appState.resourceSettingsData = JSON.parse(JSON.stringify(result.settings || settings));
    appState.resourcePreviewText = `${JSON.stringify(appState.resourceSettingsData, null, 2)}\n`;
    resourceViewerContent.value = appState.resourcePreviewText;
    populateResourceSettingsForm(appState.resourceSettingsData);
    resourceViewerMeta.textContent = "Project runtime settings · Saved";
  } else {
    const result = await window.api.writeFile(appState.resourceCurrentFilePath, text);
    if (result?.error) {
      resourceViewerMeta.textContent = `Save failed: ${result.error}`;
      return result;
    }
    appState.resourcePreviewText = text;
    resourceViewerMeta.textContent = `${relativePathFromRoot(appState.resourceCurrentFilePath) || appState.resourceCurrentFilePath} · Saved`;
    await refreshDirMap();
  }

  appState.resourceSavedText = resourceViewerContent.value;
  setResourceDirty(false);
  syncResourceCursorPosition();
  return { ok: true };
}

export function populateResourceSettingsForm(settings) {
  if (!settingsUIView || !settings || typeof settings !== "object") return;
  settingsUIView.querySelectorAll("[data-setting-path]").forEach((input) => {
    const value = nestedSettingValue(settings, input.dataset.settingPath);
    if (input.dataset.settingType === "boolean") input.checked = Boolean(value);
    else input.value = value == null ? "" : String(value);
  });
}

export function setResourceSettingsMode(mode) {
  if (!appState.resourceSettingsActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try {
      const parsed = JSON.parse(resourceViewerContent.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
      appState.resourceSettingsData = parsed;
    } catch (error) {
      resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`;
      resourceViewerContent.hidden = false;
      settingsUIView.hidden = true;
      return;
    }
  }
  appState.settingsEditorMode = nextMode;
  localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, appState.settingsEditorMode);
  syncSettingsEditorButtons();
  const uiActive = appState.settingsEditorMode === "ui";
  resourceViewerContent.hidden = uiActive;
  settingsUIView.hidden = !uiActive;
  if (uiActive) populateResourceSettingsForm(appState.resourceSettingsData);
}

export function scheduleResourceSettingsSave() {
  clearTimeout(appState.resourceSettingsSaveTimer);
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Project runtime settings · Saving...";
  appState.resourceSettingsSaveTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(appState.resourceSettingsData || {}));
    appState.resourceSettingsSaveChain = appState.resourceSettingsSaveChain.then(async () => {
      const result = await saveAssessmentSettings(snapshot);
      if (result?.error) {
        if (resourceViewerMeta) resourceViewerMeta.textContent = `Save failed: ${result.error}`;
        return;
      }
      const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
      const currentText = `${JSON.stringify(appState.resourceSettingsData || {}, null, 2)}\n`;
      if (currentText === snapshotText) {
        appState.resourceSavedText = currentText;
        setResourceDirty(false);
      }
      if (resourceViewerMeta) resourceViewerMeta.textContent = "Project runtime settings · Saved";
    });
  }, 400);
}

export function updateResourceSettingFromInput(input) {
  if (!appState.resourceSettingsActive || !appState.resourceSettingsData) return;
  let value = input.value;
  if (input.dataset.settingType === "boolean") value = input.checked;
  if (input.dataset.settingType === "number") {
    const number = Number(input.value);
    value = Number.isFinite(number) ? number : null;
  }
  setNestedSettingValue(appState.resourceSettingsData, input.dataset.settingPath, value);
  appState.assessmentSettingsCache = appState.resourceSettingsData;
  syncInterceptorToggleUi(appState.resourceSettingsData);
  appState.resourcePreviewText = `${JSON.stringify(appState.resourceSettingsData, null, 2)}\n`;
  resourceViewerContent.value = appState.resourcePreviewText;
  setResourceDirty(appState.resourcePreviewText !== appState.resourceSavedText);
  scheduleResourceSettingsSave();
}

export async function showSettingsResource(filePath) {
  appState.assessmentModuleActive = false; assessmentModuleView.hidden = true;
  if (appState.resourceDirty && appState.resourceCurrentFilePath === filePath) {
    resourceViewerContent.focus();
    return;
  }
  if (appState.resourceDirty && appState.resourceCurrentFilePath && appState.resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  const result = await window.api.assessmentSettings({ path: appState.assessmentPath });
  if (result?.error || !result?.settings) {
    await showResourcePreview(filePath, "Project Runtime Settings", "App-managed project settings", { icon: "codicon-settings-gear" });
    return;
  }

  appState.resourceSettingsActive = true;
  appState.resourceChecklistActive = false;
  appState.resourceChecklistData = null;
  appState.resourceScopeActive = false;
  appState.resourceScopeData = null;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
  appState.resourceSettingsData = JSON.parse(JSON.stringify(result.settings));
  appState.assessmentSettingsCache = appState.resourceSettingsData;
  appState.resourcePreviewText = `${JSON.stringify(appState.resourceSettingsData, null, 2)}\n`;
  appState.resourceCurrentFilePath = filePath;
  appState.resourceSavedText = appState.resourcePreviewText;
  resourceViewerTitle.textContent = "Project Runtime Settings";
  resourceViewerMeta.textContent = "App-managed project settings";
  resourceViewerMeta.title = filePath;
  resourceViewerIcon.className = "codicon codicon-settings-gear";
  resourceViewerEmpty.hidden = true;
  resourceViewerContent.classList.remove("error");
  resourceViewerContent.value = appState.resourcePreviewText;
  resourceViewerContent.readOnly = false;
  resourceViewerCopy.disabled = false;
  setResourceDirty(false);
  settingsViewSwitch.hidden = false;
  populateResourceSettingsForm(appState.resourceSettingsData);
  setResourceSettingsMode(appState.settingsEditorMode);
  if (appState.settingsEditorMode === "json") {
    resourceViewerContent.focus();
    syncResourceCursorPosition();
  }
}

export function setResourceWrapLines(wrapped) {
  appState.resourceWrapLines = Boolean(wrapped);
  localStorage.setItem("xekute.resourceWrapLines", String(appState.resourceWrapLines));
  if (!resourceViewerContent) return;
  resourceViewerContent.classList.toggle("wrap-lines", appState.resourceWrapLines);
  resourceViewerContent.setAttribute("wrap", appState.resourceWrapLines ? "soft" : "off");
  resourceViewerContent.title = appState.resourceWrapLines
    ? "Line wrapping on · Alt+Z to unwrap"
    : "Line wrapping off · Alt+Z to wrap";
  syncResourceCursorPosition();
}

export async function showResourcePreview(filePath, title, meta = "", { icon = "codicon-file-text", line = 1 } = {}) {
  if (!filePath || !resourceViewerContent) return;
  appState.assessmentModuleActive = false;
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  if (appState.resourceDirty && appState.resourceCurrentFilePath === filePath) {
    resourceViewerContent.focus();
    return;
  }
  if (appState.resourceDirty && appState.resourceCurrentFilePath && appState.resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  appState.resourceSettingsActive = false;
  appState.resourceSettingsData = null;
  appState.resourceChecklistActive = false;
  appState.resourceChecklistData = null;
  appState.resourceScopeActive = false;
  appState.resourceScopeData = null;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
  if (settingsViewSwitch) settingsViewSwitch.hidden = true;
  if (settingsUIView) settingsUIView.hidden = true;
  const result = await window.api.readFile(filePath);
  resourceViewerTitle.textContent = title || basenameOf(filePath) || "Resource";
  resourceViewerMeta.textContent = meta || filePath;
  resourceViewerMeta.title = filePath;
  resourceViewerIcon.className = `codicon ${icon}`;
  resourceViewerEmpty.hidden = true;
  resourceViewerContent.hidden = false;

  if (result?.error || result?.content == null) {
    appState.resourcePreviewText = `Unable to preview this resource.\n\n${result?.error || "No readable content was returned."}`;
    resourceViewerContent.classList.add("error");
    appState.resourceCurrentFilePath = "";
    appState.resourceSavedText = "";
    resourceViewerContent.readOnly = true;
    resourceViewerCopy.disabled = true;
  } else {
    const raw = String(result.content);
    const limit = 300000;
    appState.resourcePreviewText = raw.length > limit
      ? `${raw.slice(0, limit)}\n\n--- Preview truncated at ${limit.toLocaleString()} characters ---`
      : raw;
    resourceViewerContent.classList.remove("error");
    appState.resourceCurrentFilePath = raw.length > limit ? "" : filePath;
    appState.resourceSavedText = appState.resourcePreviewText;
    resourceViewerContent.readOnly = raw.length > limit;
    resourceViewerCopy.disabled = false;
  }

  resourceViewerContent.value = appState.resourcePreviewText;
  setResourceDirty(false);
  requestAnimationFrame(() => {
    const lineHeight = Number.parseFloat(getComputedStyle(resourceViewerContent).lineHeight) || 19;
    resourceViewerContent.scrollTop = Math.max(0, (Number(line) - 3) * lineHeight);
    resourceViewerContent.focus();
    syncResourceCursorPosition();
  });
}

export async function openAssessmentItem(item) {
  const relativePath = item?.dataset?.bountyFile;
  if (!appState.assessmentPath || !relativePath) return;

  let verification;
  try {
    verification = await window.api.assessmentVerify({ path: appState.assessmentPath });
  } catch (error) {
    verification = { error: error?.message || "Assessment verification failed." };
  }
  appState.assessmentVerification = verification;
  if (verification?.error) {
    setAssessmentUiState("error", { message: verification.error });
    return;
  }
  if (!verification?.valid) {
    // An incomplete assessment must not lock the workspace. The verifier is
    // allowed to report repair issues while existing files remain readable;
    // individual readers below will show a useful error/JSON preview when a
    // particular file is actually missing or malformed.
    setAssessmentUiState("incomplete", verification);
  }

  const diskPath = assessmentDiskPath(relativePath);
  const fileName = relativePath.split("/").pop();
  if (MANAGED_CORE_RESOURCE_META[relativePath]) {
    await showScopeResource(diskPath, relativePath);
    return;
  }
  if (ASSESSMENT_MODULE_META[relativePath]) {
    await showAssessmentModule(diskPath, relativePath);
    return;
  }
  await showResourcePreview(diskPath, fileName, `Target / ${relativePath}`, {
    icon: relativePath.endsWith(".json") ? "codicon-json" : "codicon-file-text",
  });
}
