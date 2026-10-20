import { appState } from "../../core/app-state.js";
import {
  scopeUITitle, scopeUIDescription, scopeUIForm, resourceViewerMeta, resourceViewerContent,
  settingsUIView, checklistUIView, scopeUIView, resourceViewerTitle, resourceViewerIcon,
  resourceViewerEmpty, resourceViewerCopy, assessmentModuleView,
} from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import {
  setResourceDirty, syncResourceCursorPosition, saveResourceChanges, showResourcePreview,
} from "./resource-viewer.js";
import {
  SETTINGS_EDITOR_MODE_KEY, syncSettingsEditorButtons,
} from "../settings/settings-tab-editor.js";
import { settingsViewSwitch } from "../../bootstrap.js";
import { showResourceWorkspace } from "../layout/workspace-switcher.js";

export function humanizeScopeKey(key) {
  return String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (char) => char.toUpperCase());
}

export const MANAGED_CORE_RESOURCE_META = Object.freeze({
  "recon/active-recon.json": ["Active Reconnaissance", "Authorized active discovery runs, techniques, observed assets, leads, and linked evidence."],
  "recon/passive-recon.json": ["Passive Reconnaissance", "Passive sources, discovered assets, confidence, provenance, leads, and linked evidence."],
  "enumeration/endpoints.json": ["Endpoints", "Observed routes, methods, parameters, authentication state, technologies, testing state, and evidence."],
  "enumeration/pages.json": ["Pages", "Observed web pages, forms, scripts, API calls, security metadata, testing state, and evidence."],
  "enumeration/subdomains.json": ["Subdomains", "Discovered hostnames, DNS data, liveness, scope state, takeover review, provenance, and evidence."],
});

export function createScopeField(key, value, dataPath) {
  const label = document.createElement("label"); label.className = "scope-ui-field";
  const title = document.createElement("span"); title.textContent = humanizeScopeKey(key); label.appendChild(title);
  let input;
  if (Array.isArray(value) || (value && typeof value === "object")) {
    input = document.createElement("textarea"); input.rows = Math.min(8, Math.max(2, JSON.stringify(value, null, 2).split("\n").length)); input.value = JSON.stringify(value, null, 2); input.dataset.scopeType = Array.isArray(value) ? "array" : "object";
    const hint = document.createElement("small"); hint.textContent = Array.isArray(value) ? "JSON array — add targets, exclusions, rules, or references here." : "JSON object"; label.appendChild(hint);
  } else if (typeof value === "boolean") {
    input = document.createElement("input"); input.type = "checkbox"; input.checked = value; input.dataset.scopeType = "boolean"; label.classList.add("scope-ui-boolean");
  } else if (typeof value === "number") {
    input = document.createElement("input"); input.type = "number"; input.value = String(value); input.dataset.scopeType = "number";
  } else if (/notes|procedure|description/i.test(key)) {
    input = document.createElement("textarea"); input.rows = 3; input.value = value == null ? "" : String(value); input.dataset.scopeType = "string";
  } else {
    input = document.createElement("input"); input.type = /date$/i.test(key) ? "date" : "text"; input.value = value == null ? "" : String(value); input.dataset.scopeType = value === null ? "nullable" : "string";
  }
  input.dataset.scopePath = dataPath; label.appendChild(input); return label;
}

export function appendScopeFields(container, object, prefix = "", depth = 0) {
  for (const [key, value] of Object.entries(object || {})) {
    if (key === "schemaVersion" || /Template$/.test(key)) continue;
    const dataPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length && depth < 2) {
      const group = document.createElement("fieldset"); group.className = "scope-ui-nested";
      const legend = document.createElement("legend"); legend.textContent = humanizeScopeKey(key); group.appendChild(legend);
      appendScopeFields(group, value, dataPath, depth + 1); container.appendChild(group);
    } else {
      container.appendChild(createScopeField(key, value, dataPath));
    }
  }
}

export function renderScopeUI() {
  if (!appState.resourceScopeActive || !appState.resourceScopeData || !scopeUIForm) return;
  const meta = MANAGED_CORE_RESOURCE_META[appState.resourceScopeRelativePath] || ["Managed Core Resource", "Schema-managed assessment data."];
  scopeUITitle.textContent = meta[0]; scopeUIDescription.textContent = meta[1]; scopeUIForm.innerHTML = "";
  for (const [key, value] of Object.entries(appState.resourceScopeData)) {
    if (key === "schemaVersion" || /Template$/.test(key)) continue;
    const section = document.createElement("section"); section.className = "scope-ui-section";
    const heading = document.createElement("header"); heading.innerHTML = `<strong>${escapeHtml(humanizeScopeKey(key))}</strong>`; section.appendChild(heading);
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) appendScopeFields(section, value, key, 0);
    else section.appendChild(createScopeField(key, value, key));
    scopeUIForm.appendChild(section);
  }
}

export function scheduleScopeSave() {
  clearTimeout(appState.resourceScopeSaveTimer);
  appState.resourcePreviewText = `${JSON.stringify(appState.resourceScopeData, null, 2)}\n`; resourceViewerContent.value = appState.resourcePreviewText; setResourceDirty(appState.resourcePreviewText !== appState.resourceSavedText);
  resourceViewerMeta.textContent = `${appState.resourceScopeRelativePath} · Saving...`;
  appState.resourceScopeSaveTimer = setTimeout(async () => {
    const snapshot = `${JSON.stringify(appState.resourceScopeData, null, 2)}\n`;
    const result = await window.api.writeFile(appState.resourceCurrentFilePath, snapshot);
    if (result?.error) { resourceViewerMeta.textContent = `Save failed: ${result.error}`; return; }
    if (resourceViewerContent.value === snapshot) { appState.resourceSavedText = snapshot; setResourceDirty(false); }
    resourceViewerMeta.textContent = `${appState.resourceScopeRelativePath} · Saved`;
  }, 350);
}

export function setResourceScopeMode(mode) {
  if (!appState.resourceScopeActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try { appState.resourceScopeData = JSON.parse(resourceViewerContent.value); } catch (error) { resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`; return; }
  }
  appState.settingsEditorMode = nextMode; localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, nextMode); syncSettingsEditorButtons();
  resourceViewerContent.hidden = nextMode === "ui"; scopeUIView.hidden = nextMode !== "ui"; settingsUIView.hidden = true; checklistUIView.hidden = true;
  if (nextMode === "ui") renderScopeUI(); else { resourceViewerContent.focus(); syncResourceCursorPosition(); }
}

export async function showScopeResource(filePath, relativePath) {
  appState.assessmentModuleActive = false; assessmentModuleView.hidden = true;
  if (appState.resourceScopeActive && appState.resourceCurrentFilePath === filePath) { if (appState.settingsEditorMode === "json") resourceViewerContent.focus(); return; }
  if (appState.resourceDirty && appState.resourceCurrentFilePath && appState.resourceCurrentFilePath !== filePath) { const saved = await saveResourceChanges(); if (saved?.error) return; }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, relativePath.split("/").pop(), `Target / ${relativePath}`, { icon: "codicon-list-tree" });
  let parsed; try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, "Invalid scope JSON", `Target / ${relativePath}`, { icon: "codicon-error" }); }
  appState.resourceSettingsActive = false; appState.resourceChecklistActive = false; appState.resourceScopeActive = true; appState.resourceScopeData = parsed; appState.resourceScopeRelativePath = relativePath;
  settingsUIView.hidden = true; checklistUIView.hidden = true;
  appState.resourcePreviewText = `${JSON.stringify(parsed, null, 2)}\n`; appState.resourceCurrentFilePath = filePath; appState.resourceSavedText = appState.resourcePreviewText;
  resourceViewerTitle.textContent = relativePath.split("/").pop(); resourceViewerMeta.textContent = `Target / ${relativePath}`; resourceViewerMeta.title = filePath; resourceViewerIcon.className = "codicon codicon-list-tree";
  resourceViewerEmpty.hidden = true; resourceViewerContent.classList.remove("error"); resourceViewerContent.readOnly = false; resourceViewerContent.value = appState.resourcePreviewText; resourceViewerCopy.disabled = false;
  settingsViewSwitch.hidden = false; setResourceDirty(false); setResourceScopeMode(appState.settingsEditorMode);
}
