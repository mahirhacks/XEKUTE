import { SETTINGS_TAB_PATH } from "./app-settings-shell.js";
import {
  settingsUIView, settingsViewJson, settingsViewUi, editorError,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { renderEditor, updateTabDirtyIndicator } from "../../bootstrap.js";
import { openTabs, commitActiveTab, saveActiveTab } from "../editor/editor-tabs.js";
import {
  syncInterceptorToggleUi, configureProxyListener,
} from "../interceptor/interceptor-controls.js";
import { normalizeAuthoritySettings, AUTHORITY_SETTINGS_KEY } from "./authority-settings.js";

export const SETTINGS_EDITOR_MODE_KEY = "pointer:settingsEditorMode";

export function isAssessmentSettingsTab(tab) {
  return tab?.name === "Project Runtime Settings";
}

export function isSettingsTab(tab) {
  return tab?.path === SETTINGS_TAB_PATH || tab?.special === "settings";
}

export function nestedSettingValue(object, settingPath) {
  return String(settingPath || "").split(".").reduce((value, key) => value?.[key], object);
}

export function setNestedSettingValue(object, settingPath, value) {
  const keys = String(settingPath || "").split(".").filter(Boolean);
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  if (keys.length) target[keys.at(-1)] = value;
}

export function parseSettingsTab(tab) {
  try {
    const parsed = JSON.parse(String(tab?.content || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed }
      : { error: "Project runtime settings must contain a JSON object." };
  } catch (error) {
    return { error: `Project runtime settings contain invalid JSON: ${error.message}` };
  }
}

export function renderSettingsForm(tab) {
  const parsed = parseSettingsTab(tab);
  if (parsed.error) return parsed;
  settingsUIView.querySelectorAll("[data-setting-path]").forEach((input) => {
    const value = nestedSettingValue(parsed.value, input.dataset.settingPath);
    if (input.dataset.settingType === "boolean") input.checked = Boolean(value);
    else input.value = value == null ? "" : String(value);
  });
  return { ok: true };
}

export function syncSettingsEditorButtons() {
  const uiActive = appState.settingsEditorMode === "ui";
  settingsViewJson.classList.toggle("active", !uiActive);
  settingsViewJson.setAttribute("aria-pressed", String(!uiActive));
  settingsViewUi.classList.toggle("active", uiActive);
  settingsViewUi.setAttribute("aria-pressed", String(uiActive));
}

export async function setSettingsEditorMode(mode) {
  const next = mode === "ui" ? "ui" : "json";
  const tab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (!isAssessmentSettingsTab(tab) || appState.settingsEditorMode === next) return;
  if (appState.settingsEditorMode === "json") commitActiveTab();
  if (next === "ui") {
    const parsed = parseSettingsTab(tab);
    if (parsed.error) {
      editorError.textContent = parsed.error;
      editorError.hidden = false;
      return;
    }
  }
  appState.settingsEditorMode = next;
  localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, next);
  appState.editorLoadedPath = null;
  syncSettingsEditorButtons();
  await renderEditor();
}

export function updateSettingFromInput(input) {
  if (!appState.activeTabPath) return;
  const tab = openTabs.get(appState.activeTabPath);
  if (!isAssessmentSettingsTab(tab)) return;
  const parsed = parseSettingsTab(tab);
  if (parsed.error) return;
  let value = input.value;
  if (input.dataset.settingType === "boolean") value = input.checked;
  if (input.dataset.settingType === "number") {
    const number = Number(input.value);
    value = Number.isFinite(number) ? number : null;
  }
  setNestedSettingValue(parsed.value, input.dataset.settingPath, value);
  tab.content = `${JSON.stringify(parsed.value, null, 2)}\n`;
  tab.dirty = tab.content !== tab.savedContent;
  appState.assessmentSettingsCache = parsed.value;
  syncInterceptorToggleUi(parsed.value);
  updateTabDirtyIndicator();
  scheduleSettingsAutoSave();
}

export function syncOpenSettingsTabContent(settings) {
  if (!settings || typeof settings !== "object") return;
  for (const tab of openTabs.values()) {
    if (!isAssessmentSettingsTab(tab)) continue;
    const nextContent = `${JSON.stringify(settings, null, 2)}\n`;
    tab.content = nextContent;
    tab.dirty = nextContent !== tab.savedContent;
    updateTabDirtyIndicator();
    if (appState.settingsEditorMode === "ui" && appState.activeTabPath === tab.path) renderSettingsForm(tab);
  }
}

export async function refreshAssessmentSettingsCache() {
  const refreshGeneration = ++appState.assessmentSettingsRefreshGeneration;
  if (!appState.assessmentPath) {
    appState.assessmentSettingsCache = null;
    appState.assessmentSettingsVirtual = false;
    syncInterceptorToggleUi(null);
    return null;
  }
  const requestedAssessment = appState.assessmentPath;
  const requestedWorkspace = appState.rootPath;
  const result = await window.api.assessmentSettings({ path: requestedAssessment });
  if (appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace || refreshGeneration !== appState.assessmentSettingsRefreshGeneration) return null;
  if (result?.error) {
    appState.assessmentSettingsCache = null;
    appState.assessmentSettingsVirtual = false;
    syncInterceptorToggleUi(null);
    return result;
  }
  appState.assessmentSettingsCache = result.settings;
  appState.assessmentSettingsVirtual = Boolean(result.virtual);
  if (!result.virtual && result.settings?.authority) appState.authoritySettingsData = normalizeAuthoritySettings(result.settings.authority);
  syncInterceptorToggleUi(appState.assessmentSettingsCache);
  return result;
}

export async function saveAssessmentSettings(settings) {
  if (!appState.assessmentPath) return { error: "No project open" };
  const requestedAssessment = appState.assessmentPath;
  const requestedWorkspace = appState.rootPath;
  const result = await window.api.assessmentWriteSettings({ path: requestedAssessment, settings });
  if (appState.assessmentPath !== requestedAssessment || appState.rootPath !== requestedWorkspace) return result;
  if (result?.error) return result;
  appState.assessmentSettingsCache = result.settings;
  appState.assessmentSettingsVirtual = false;
  if (result.settings?.authority) {
    appState.authoritySettingsData = normalizeAuthoritySettings(result.settings.authority);
    localStorage.setItem(AUTHORITY_SETTINGS_KEY, JSON.stringify(appState.authoritySettingsData, null, 2));
  }
  syncOpenSettingsTabContent(result.settings);
  syncInterceptorToggleUi(result.settings);
  await configureProxyListener();
  return result;
}

export function scheduleSettingsAutoSave() {
  clearTimeout(appState.settingsAutoSaveTimer);
  appState.settingsAutoSaveTimer = setTimeout(async () => {
    const tab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
    if (!isAssessmentSettingsTab(tab) || !tab.dirty) return;
    await saveActiveTab();
  }, 450);
}
