import {
  generalStatusBarToggle, statusbar, appSettingsPageTitle, appSettingsPageSubtitle,
  appSettingsProfileName, appSettingsProfilePlan, appSettingsGeneralPanel,
  appSettingsProjectPanel, commandSettingsStatus, appSettingsCommandsPanel,
  appSettingsAuthorityPanel, appSettingsPromptsPanel, appSettingsCertificatesPanel,
  appSettingsKnowledgePanel, appSettingsLlmPanel, appSettingsSectionButtons, certificateDirectory,
  certificateLocationBadge, certificateReset,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { loadGuidanceSettings } from "./guidance-settings.js";
import {
  showCodeEditorWorkspace, syncWorkspaceActivity, setTerminalMaximized,
} from "../../bootstrap.js";
import { renderTabs, renderEditor } from "../editor/editor-render.js";
import { openTabs, commitActiveTab } from "../editor/editor-tabs.js";
import { projectName } from "../project/project-activation.js";
import { loadProjectProfile } from "../project/project-profile.js";
import { refreshAssessmentSettingsCache } from "./settings-tab-editor.js";
import { loadMcpSettings } from "./mcp-settings.js";
import {
  renderExploreSubagentSelect, initModelsSettingsPanel, loadLlmSettings, loadOllamaSettings,
} from "./llm-provider-settings.js";
import { addErrorMessage } from "../chat/chat-messages.js";
import { loadAuthoritySettings } from "./authority-settings.js";

export const APP_SETTINGS_SECTION_META = Object.freeze({
  general: { title: "General", subtitle: "" },
  project: { title: "Project", subtitle: "Project and engagement configuration" },
  commands: { title: "Tools & MCPs", subtitle: "Manage slash commands and the tools each one can use" },
  authority: { title: "Agents", subtitle: "" },
  prompts: { title: "Rules, Skills, Subagents", subtitle: "Add project guidance files without changing protected system instructions" },
  llm: { title: "Models", subtitle: "" },
  certificates: { title: "Browser & Network", subtitle: "Manage certificates and isolated authorized identities" },
});

export const SETTINGS_TAB_PATH = "xekute:settings";

export const GENERAL_SETTINGS_STORAGE_KEY = "pointer:general-settings";

export function readGeneralSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(GENERAL_SETTINGS_STORAGE_KEY) || "{}"); } catch { stored = {}; }
  return {
    showStatusBar: stored.showStatusBar !== false,
  };
}

export function renderGeneralSettings() {
  const settings = readGeneralSettings();
  if (generalStatusBarToggle) generalStatusBarToggle.checked = settings.showStatusBar;
  if (statusbar) statusbar.classList.toggle("settings-hidden", !settings.showStatusBar);
}

export function updateGeneralSettings(patch = {}) {
  const settings = { ...readGeneralSettings(), ...patch };
  localStorage.setItem(GENERAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  renderGeneralSettings();
}

export function filterAppSettingsNavigation(query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const navigationGroups = [...document.querySelectorAll(".app-settings-nav-group")];
  navigationGroups.forEach((group) => {
    const buttons = [...group.querySelectorAll("button")];
    buttons.forEach((button) => {
      const label = button.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      button.hidden = Boolean(normalizedQuery && !label.includes(normalizedQuery));
    });
    group.hidden = buttons.length > 0 && buttons.every((button) => button.hidden);
  });
  const visibleGroups = navigationGroups.filter((group) => !group.hidden);
  [...document.querySelectorAll(".app-settings-nav-divider")].forEach((divider, index) => {
    divider.hidden = !visibleGroups.length || index >= visibleGroups.length - 1;
  });
}

export function setAppSettingsSection(section) {
  appState.appSettingsSection = ["general", "project", "commands", "authority", "prompts", "llm", "ollama", "certificates", "knowledge"].includes(section) ? (section === "ollama" ? "llm" : section) : "general";
  const sectionMeta = APP_SETTINGS_SECTION_META[appState.appSettingsSection] || APP_SETTINGS_SECTION_META.general;
  if (appSettingsPageTitle) appSettingsPageTitle.textContent = sectionMeta.title;
  if (appSettingsPageSubtitle) appSettingsPageSubtitle.textContent = sectionMeta.subtitle;
  if (appSettingsProfileName) appSettingsProfileName.textContent = "Local workspace";
  if (appSettingsProfilePlan) appSettingsProfilePlan.textContent = appState.rootPath ? projectName(appState.rootPath) : "XEKUTE";
  if (appSettingsGeneralPanel) appSettingsGeneralPanel.hidden = appState.appSettingsSection !== "general";
  appSettingsProjectPanel.hidden = appState.appSettingsSection !== "project";
  appSettingsCommandsPanel.hidden = appState.appSettingsSection !== "commands";
  appSettingsAuthorityPanel.hidden = appState.appSettingsSection !== "authority";
  appSettingsPromptsPanel.hidden = appState.appSettingsSection !== "prompts";
  appSettingsLlmPanel.hidden = appState.appSettingsSection !== "llm";
  appSettingsCertificatesPanel.hidden = appState.appSettingsSection !== "certificates";
  if (appSettingsKnowledgePanel) appSettingsKnowledgePanel.hidden = appState.appSettingsSection !== "knowledge";
  if (commandSettingsStatus) commandSettingsStatus.hidden = appState.appSettingsSection !== "project";
  appSettingsSectionButtons.forEach((button) => {
    const active = button.dataset.appSettingsSection === appState.appSettingsSection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (appState.appSettingsSection === "general") {
    renderGeneralSettings();
  }
  if (appState.appSettingsSection === "project") loadProjectProfile();
  if (appState.appSettingsSection === "commands") loadMcpSettings();
  if (appState.appSettingsSection === "authority") {
    renderExploreSubagentSelect();
  }
  if (appState.appSettingsSection === "prompts") loadGuidanceSettings({ preserveSelection: true });
  if (appState.appSettingsSection === "llm") {
    loadOllamaSettings();
    loadLlmSettings();
    initModelsSettingsPanel();
  }
  if (appState.appSettingsSection === "certificates") {
    loadCertificateSettings();
  }
}

export function renderCertificateSettings(snapshot = appState.certificateSettingsData) {
  if (!snapshot) return;
  appState.certificateSettingsData = snapshot;
  if (certificateDirectory) certificateDirectory.value = snapshot.directory || "";
  if (certificateLocationBadge) certificateLocationBadge.textContent = snapshot.usingDefault ? "Default" : "Custom";
  if (certificateReset) certificateReset.disabled = Boolean(snapshot.usingDefault);
}

export async function loadCertificateSettings() {
  if (!window.api.certificateSettings) return;
  const result = await window.api.certificateSettings();
  if (result?.error) {
    addErrorMessage(result.error);
    return;
  }
  renderCertificateSettings(result);
}

export async function chooseCertificateDirectory() {
  const result = await window.api.chooseCertificateDirectory?.({ assessmentPath: appState.assessmentPath });
  if (!result || result.canceled) return;
  if (result.error) return addErrorMessage(result.error);
  renderCertificateSettings(result);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Shared CA location updated";
}

export async function resetCertificateDirectory() {
  const result = await window.api.resetCertificateDirectory?.({ assessmentPath: appState.assessmentPath });
  if (result?.error) return addErrorMessage(result.error);
  renderCertificateSettings(result);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Default CA location restored";
}

export function openAppSettings(section) {
  const key = typeof section === "string" ? section : "";
  if (key) setAppSettingsSection(key);
  openSettingsTab();
}

export function openSettingsTab() {
  showCodeEditorWorkspace();
  const existingTab = openTabs.get(SETTINGS_TAB_PATH);
  if (existingTab) {
    switchToSettingsTab();
    return;
  }
  openTabs.set(SETTINGS_TAB_PATH, {
    path: SETTINGS_TAB_PATH,
    diskPath: SETTINGS_TAB_PATH,
    name: "Settings",
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
    special: "settings",
  });
  renderTabs();
  switchToSettingsTab();
}

export function switchToSettingsTab() {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  commitActiveTab();
  appState.activeTabPath = SETTINGS_TAB_PATH;
  appState.editorLoadedPath = null;
  renderTabs();
  openSettingsWorkspace();
  syncWorkspaceActivity();
}

export function openSettingsWorkspace() {
  renderEditor({ focusEditor: false });
}

export function loadSettingsWorkspace() {
  if (appState.settingsWorkspacePromise) return appState.settingsWorkspacePromise;
  appState.settingsWorkspacePromise = (async () => {
    await refreshAssessmentSettingsCache();
    await loadProjectProfile();
    await loadGuidanceSettings();
    await loadAuthoritySettings();
    await loadCertificateSettings();
    await loadMcpSettings();
    setAppSettingsSection(appState.appSettingsSection);
  })();
  return appState.settingsWorkspacePromise;
}
