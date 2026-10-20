import { appState } from "../../core/app-state.js";
import { restoreChatComposerAfterUiAction } from "../project/explorer-tree.js";
import {
  refreshAssessmentSettingsCache, syncOpenSettingsTabContent,
} from "./settings-tab-editor.js";
import { authorityPicker, authorityLabel, authorityMenu } from "../../core/dom-refs.js";
import { addErrorMessage } from "../chat/chat-messages.js";
import { closeChatModeMenu } from "../chat/chat-mode.js";
import { closeContextPopover } from "../chat/context-usage.js";
import { closeModelMenu } from "../models/model-picker.js";

export const AUTHORITY_SETTINGS_KEY = "pointer:authoritySettings:v1";

export const AUTHORITY_DEFAULTS = Object.freeze({
  superMode: "ask",
  permissions: Object.freeze({
    workspaceRead: true,
    workspaceWrite: true,
    workspaceDelete: true,
    commandExecution: true,
    backgroundProcesses: true,
    terminalAccess: true,
    webResearch: true,
    outboundHttp: true,
    proxyInterception: true,
    trafficCapture: true,
    mapBuild: true,
    evidenceManagement: true,
    passiveRecon: true,
    activeRecon: true,
    automatedScanning: true,
    exploitValidation: true,
    customScripts: true,
    sensitiveDataAccess: true,
  }),
});

export const AUTHORITY_SUPER_LABELS = Object.freeze({
  ask: "Ask Approval",
  approve: "Auto-approve",
  full: "Full Authority",
});

export function normalizeAuthoritySettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const requestedSuperMode = input.superMode;
  const superMode = ["full", "ask", "approve"].includes(requestedSuperMode) ? requestedSuperMode : AUTHORITY_DEFAULTS.superMode;
  return {
    superMode,
    permissions: { ...AUTHORITY_DEFAULTS.permissions },
  };
}

export async function loadAuthoritySettings() {
  const loadGeneration = ++appState.authoritySettingsLoadGeneration;
  const stateGeneration = ++appState.authoritySettingsWriteGeneration;
  const requestedWorkspace = appState.rootPath;
  const requestedAssessment = appState.assessmentPath;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(AUTHORITY_SETTINGS_KEY) || "{}"); } catch { stored = {}; }
  if (appState.assessmentPath && !appState.assessmentSettingsVirtual) {
    const settings = appState.assessmentSettingsCache || (await refreshAssessmentSettingsCache())?.settings;
    if (loadGeneration !== appState.authoritySettingsLoadGeneration || stateGeneration !== appState.authoritySettingsWriteGeneration || appState.rootPath !== requestedWorkspace || appState.assessmentPath !== requestedAssessment) return appState.authoritySettingsData;
    if (settings?.authority) stored = settings.authority;
  }
  appState.authoritySettingsData = normalizeAuthoritySettings(stored);
  syncAuthorityLabel();
  return appState.authoritySettingsData;
}

export function syncAuthorityLabel() {
  if (!authorityLabel) return;
  const settings = normalizeAuthoritySettings(appState.authoritySettingsData);
  const mode = settings.superMode;
  const label = AUTHORITY_SUPER_LABELS[mode] || AUTHORITY_SUPER_LABELS.ask;
  authorityLabel.textContent = label;
  if (authorityPicker) {
    authorityPicker.title = `Agent authority: ${label}`;
    authorityPicker.classList.remove("mode-ask", "mode-approve", "mode-full");
    authorityPicker.classList.add(`mode-${mode}`);
  }
  if (authorityMenu) {
    authorityMenu.querySelectorAll("[data-authority-mode]").forEach((button) => {
      const active = button.dataset.authorityMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }
}

export async function persistAuthoritySettings() {
  const stateGeneration = ++appState.authoritySettingsWriteGeneration;
  const requestedWorkspace = appState.rootPath;
  const requestedAssessment = appState.assessmentPath;
  try {
    appState.authoritySettingsData = normalizeAuthoritySettings(appState.authoritySettingsData);
    const requestedAuthority = { ...appState.authoritySettingsData, permissions: { ...appState.authoritySettingsData.permissions } };
    localStorage.setItem(AUTHORITY_SETTINGS_KEY, JSON.stringify(appState.authoritySettingsData));
    if (appState.assessmentSettingsCache && appState.assessmentPath && !appState.assessmentSettingsVirtual) {
      const nextSettings = { ...appState.assessmentSettingsCache, authority: requestedAuthority };
      appState.assessmentSettingsCache = nextSettings;
      const result = await window.api.assessmentWriteSettings?.({ path: requestedAssessment, settings: nextSettings });
      if (stateGeneration !== appState.authoritySettingsWriteGeneration || appState.rootPath !== requestedWorkspace || appState.assessmentPath !== requestedAssessment) return result;
      if (result?.error) {
        addErrorMessage(result.error);
      } else if (result?.settings) {
        appState.assessmentSettingsCache = result.settings;
        if (result.settings.authority) {
          appState.authoritySettingsData = normalizeAuthoritySettings(result.settings.authority);
          localStorage.setItem(AUTHORITY_SETTINGS_KEY, JSON.stringify(appState.authoritySettingsData));
        }
        syncOpenSettingsTabContent(result.settings);
      }
    }
    if (stateGeneration !== appState.authoritySettingsWriteGeneration || appState.rootPath !== requestedWorkspace || appState.assessmentPath !== requestedAssessment) return;
    syncAuthorityLabel();
  } catch (error) {
    if (stateGeneration === appState.authoritySettingsWriteGeneration && appState.rootPath === requestedWorkspace && appState.assessmentPath === requestedAssessment) {
      addErrorMessage(error?.message || "Failed to save authority settings");
    }
  }
}

export async function setAuthoritySuperMode(mode) {
  if (!["full", "ask", "approve"].includes(mode)) return;
  try {
    appState.authoritySettingsData = normalizeAuthoritySettings({ ...(appState.authoritySettingsData || {}), superMode: mode });
    await persistAuthoritySettings();
  } finally {
    restoreChatComposerAfterUiAction();
  }
}

export function positionAuthorityMenu() {
  if (!authorityMenu || !authorityPicker || authorityMenu.hidden) return;
  const rect = authorityPicker.getBoundingClientRect();
  const menuW = authorityMenu.offsetWidth || 240;
  const menuH = authorityMenu.offsetHeight || 220;
  const pad = 8;
  let top = rect.top - menuH - pad;
  if (top < pad) top = rect.bottom + pad;
  if (top + menuH > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - menuH - pad);
  let left = rect.left;
  if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
  if (left < pad) left = pad;
  authorityMenu.style.left = `${left}px`;
  authorityMenu.style.top = `${top}px`;
}

export function closeAuthorityMenu() {
  if (!authorityMenu || !authorityPicker) return;
  authorityMenu.hidden = true;
  authorityPicker.classList.remove("open");
  authorityPicker.setAttribute("aria-expanded", "false");
  restoreChatComposerAfterUiAction();
}

export function openAuthorityMenu() {
  if (!authorityMenu || !authorityPicker) return;
  closeModelMenu();
  closeChatModeMenu();
  closeContextPopover();
  syncAuthorityLabel();
  authorityMenu.hidden = false;
  authorityPicker.classList.add("open");
  authorityPicker.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => positionAuthorityMenu());
}

export function toggleAuthorityMenu() {
  if (!authorityMenu || !authorityPicker) return;
  if (authorityMenu.hidden) openAuthorityMenu();
  else closeAuthorityMenu();
}
