import { appState } from "../../core/app-state.js";
import {
  projectSettingsForm, projectSettingsName, projectSettingsRoot, projectAuthSource,
  commandSettingsStatus, projectSettingsSections, projectSettingsNav, projectSettingsNavButtons,
  projectSettingsUnavailable, projectSettingsShell,
} from "../../core/dom-refs.js";
import { configureProxyListener } from "../interceptor/interceptor-controls.js";
import { projectName } from "./project-activation.js";
import {
  collectEngagementAccountSnapshots, loadIdentitySettings, saveEngagementAccounts,
} from "../settings/identity-settings.js";

export function projectFieldValue(object, dottedPath) {
  return String(dottedPath || "").split(".").reduce((value, key) => value?.[key], object);
}

export function setProjectFieldValue(object, dottedPath, value) {
  const keys = String(dottedPath || "").split(".").filter(Boolean);
  let target = object;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) target[key] = value;
    else {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      target = target[key];
    }
  });
}

export function populateProjectSettings(profile = appState.projectProfileData) {
  if (!projectSettingsForm || !profile) return;
  projectSettingsForm.querySelectorAll("[data-project-field]").forEach((field) => {
    const value = projectFieldValue(profile, field.dataset.projectField);
    if (field.dataset.projectKind === "boolean") field.checked = Boolean(value);
    else if (field.dataset.projectKind === "array") field.value = Array.isArray(value) ? value.join("\n") : "";
    else field.value = value == null ? "" : String(value);
  });
  if (projectSettingsName) projectSettingsName.textContent = profile.project?.name || (appState.rootPath ? projectName(appState.rootPath) : "Project");
  if (projectSettingsRoot) {
    projectSettingsRoot.textContent = appState.rootPath || "";
    projectSettingsRoot.title = appState.rootPath || "";
  }
  if (projectAuthSource) {
    const selection = profile.engagement?.authenticationSelection || { kind: "none", id: "" };
    projectAuthSource.value = selection.kind === "none" ? "none" : `${selection.kind}:${selection.id || ""}`;
  }
}

export function collectProjectSettings() {
  const profile = JSON.parse(JSON.stringify(appState.projectProfileData || {}));
  projectSettingsForm?.querySelectorAll("[data-project-field]").forEach((field) => {
    let value = field.value;
    if (field.dataset.projectKind === "boolean") value = Boolean(field.checked);
    if (field.dataset.projectKind === "number") value = Number(field.value);
    if (field.dataset.projectKind === "array") value = String(field.value || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
    setProjectFieldValue(profile, field.dataset.projectField, value);
  });
  if (projectAuthSource) {
    const [kind, id = ""] = String(projectAuthSource.value || "none").split(":");
    setProjectFieldValue(profile, "engagement.authenticationSelection", {
      kind: ["identity", "credential"].includes(kind) && id ? kind : "none",
      id: ["identity", "credential"].includes(kind) && id ? id : "",
    });
  }
  return profile;
}

export function queueProjectProfileAutosave(delay = 650) {
  clearTimeout(appState.projectAutosaveTimer);
  appState.projectAutosaveTimer = setTimeout(() => { void flushProjectProfileAutosave(); }, delay);
}

export function scheduleProjectProfileAutosave({ immediate = false } = {}) {
  if (!appState.rootPath || appState.projectProfileWorkspace !== appState.rootPath || !appState.projectProfileData || !projectSettingsForm) return;
  appState.projectAutosaveRevision += 1;
  const pending = {
    workspace: appState.rootPath,
    revision: appState.projectAutosaveRevision,
    profileGeneration: appState.projectProfileWorkspaceGenerations.get(appState.rootPath) ?? appState.projectProfileLoadGeneration,
    writeGeneration: appState.projectProfileWriteGenerations.get(appState.rootPath) || 0,
    profile: collectProjectSettings(),
    accounts: collectEngagementAccountSnapshots(),
  };
  appState.projectAutosavePending.set(appState.rootPath, pending);
  appState.projectAutosaveLatestRevisionByWorkspace.set(appState.rootPath, pending.revision);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Saving automatically…";
  queueProjectProfileAutosave(immediate ? 0 : 650);
}

export function isCurrentProjectProfileAutosave({ workspace, revision, profileGeneration, writeGeneration }) {
  return appState.projectAutosaveLatestRevisionByWorkspace.get(workspace) === revision
    && appState.projectProfileWorkspaceGenerations.get(workspace) === profileGeneration
    && (appState.projectProfileWriteGenerations.get(workspace) || 0) === writeGeneration;
}

export async function flushProjectProfileAutosave() {
  appState.projectAutosaveTimer = null;
  if (appState.projectAutosaveRunning || !appState.projectAutosavePending.size) return;
  const pending = appState.projectAutosavePending.values().next().value;
  if (appState.projectAutosavePending.get(pending.workspace) === pending) appState.projectAutosavePending.delete(pending.workspace);
  appState.projectAutosaveRunning = true;
  try {
    await saveProjectProfile({
      autoSave: true,
      revision: pending.revision,
      profileGeneration: pending.profileGeneration,
      writeGeneration: pending.writeGeneration,
      workspace: pending.workspace,
      profile: pending.profile,
      accounts: pending.accounts,
    });
  } catch (error) {
    if (isCurrentProjectProfileAutosave(pending)
      && appState.rootPath === pending.workspace
      && appState.projectProfileWorkspace === pending.workspace
      && commandSettingsStatus) {
      commandSettingsStatus.textContent = error?.message || "Could not save project settings";
    }
  } finally {
    appState.projectAutosaveRunning = false;
    if (appState.projectAutosavePending.size) queueProjectProfileAutosave(0);
  }
}

export function setProjectSettingsTarget(targetId, { scroll = false } = {}) {
  const fallbackTarget = projectSettingsNavButtons[0]?.dataset.projectSettingsTarget;
  const resolvedTarget = projectSettingsSections.some((section) => section.id === targetId)
    ? targetId
    : fallbackTarget;
  if (!resolvedTarget) return null;

  projectSettingsSections.forEach((section) => {
    section.hidden = section.id !== resolvedTarget;
  });
  let activeButton = null;
  projectSettingsNavButtons.forEach((button) => {
    const active = button.dataset.projectSettingsTarget === resolvedTarget;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active) activeButton = button;
  });

  requestAnimationFrame(() => {
    if (!projectSettingsNav || !activeButton) return;
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const behavior = scroll && !reducedMotion ? "smooth" : "auto";
    if (activeButton === projectSettingsNavButtons[0]) {
      projectSettingsNav.scrollTo({ left: 0, behavior });
      return;
    }
    const navBounds = projectSettingsNav.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    if (buttonBounds.left < navBounds.left) {
      projectSettingsNav.scrollBy({ left: buttonBounds.left - navBounds.left, behavior });
    } else if (buttonBounds.right > navBounds.right) {
      projectSettingsNav.scrollBy({ left: buttonBounds.right - navBounds.right, behavior });
    }
  });

  if (scroll) {
    const scrollHost = projectSettingsForm?.closest(".app-settings-content");
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    scrollHost?.scrollTo?.({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }
  return resolvedTarget;
}

export async function loadProjectProfile() {
  const loadGeneration = ++appState.projectProfileLoadGeneration;
  if (!appState.projectAutosavePending?.size) {
    clearTimeout(appState.projectAutosaveTimer);
    appState.projectAutosaveTimer = null;
  }
  appState.projectAutosaveRevision += 1;
  const workspace = appState.rootPath;
  if (workspace) appState.projectProfileWorkspaceGenerations.set(workspace, loadGeneration);
  appState.projectProfileWorkspace = "";
  const hasProject = Boolean(workspace);
  if (projectSettingsUnavailable) projectSettingsUnavailable.hidden = hasProject;
  if (projectSettingsShell) projectSettingsShell.hidden = !hasProject;
  if (!hasProject) {
    appState.projectProfileData = null;
    appState.projectProfileExists = false;
    if (commandSettingsStatus) commandSettingsStatus.textContent = "Open a project to configure it";
    return null;
  }
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Loading project settingsâ€¦";
  const result = await window.api.projectProfileGet?.({ path: workspace });
  if (appState.rootPath !== workspace || loadGeneration !== appState.projectProfileLoadGeneration) return null;
  if (result?.error || !result?.profile) {
    appState.projectProfileData = null;
    appState.projectProfileExists = false;
    if (commandSettingsStatus) commandSettingsStatus.textContent = result?.error || "Project settings unavailable";
    return result;
  }
  appState.projectProfileData = result.profile;
  appState.projectProfileExists = Boolean(result.exists);
  appState.projectProfileWorkspace = workspace;
  populateProjectSettings(appState.projectProfileData);
  const activeTarget = projectSettingsNavButtons.find((button) => button.classList.contains("active"))?.dataset.projectSettingsTarget;
  setProjectSettingsTarget(activeTarget);
  if (commandSettingsStatus) {
    commandSettingsStatus.textContent = appState.projectProfileExists
      ? "Project settings loaded"
      : "New profile â€” project folder remains untouched";
  }
  await loadIdentitySettings();
  if (appState.rootPath !== workspace || loadGeneration !== appState.projectProfileLoadGeneration) return null;
  return result;
}

export async function saveProjectProfile({ autoSave = false, revision = appState.projectAutosaveRevision, profileGeneration = appState.projectProfileLoadGeneration, writeGeneration: requestedWriteGeneration = null, workspace: requestedWorkspace = appState.rootPath, profile: requestedProfile = null, accounts = null } = {}) {
  const workspace = requestedWorkspace;
  if (!workspace || !projectSettingsForm) {
    if (appState.rootPath === workspace && commandSettingsStatus) commandSettingsStatus.textContent = "Open a project first";
    return;
  }
  if (!autoSave && (appState.projectProfileWorkspace !== workspace || profileGeneration !== appState.projectProfileLoadGeneration)) {
    if (appState.rootPath === workspace && commandSettingsStatus) commandSettingsStatus.textContent = "Project settings are still loading";
    return;
  }
  const profile = requestedProfile || collectProjectSettings();
  if (!profile.project?.name?.trim()) {
    if (appState.rootPath === workspace && commandSettingsStatus) commandSettingsStatus.textContent = "Project name is required";
    if (appState.rootPath === workspace) projectSettingsForm.querySelector('[data-project-field="project.name"]')?.focus();
    return;
  }
  let writeGeneration = requestedWriteGeneration;
  if (autoSave) {
    const snapshot = { workspace, revision, profileGeneration, writeGeneration };
    if (!isCurrentProjectProfileAutosave(snapshot)) return;
  } else {
    writeGeneration = (appState.projectProfileWriteGenerations.get(workspace) || 0) + 1;
    appState.projectProfileWriteGenerations.set(workspace, writeGeneration);
  }
  const currentWorkspaceProfileGeneration = appState.projectProfileWorkspaceGenerations.get(workspace);
  const isCurrentWrite = () => autoSave
    ? isCurrentProjectProfileAutosave({ workspace, revision, profileGeneration, writeGeneration })
    : (appState.projectProfileWriteGenerations.get(workspace) || 0) === writeGeneration
      && (currentWorkspaceProfileGeneration === undefined
        ? appState.projectProfileWorkspaceGenerations.get(workspace) === undefined
        : appState.projectProfileWorkspaceGenerations.get(workspace) === profileGeneration);
  if (appState.rootPath === workspace && appState.projectProfileWorkspace === workspace && commandSettingsStatus) commandSettingsStatus.textContent = "Saving authentication accounts…";
  const accountsResult = await saveEngagementAccounts({ workspace, accounts, isCurrent: isCurrentWrite });
  if (!accountsResult.ok) {
    if (isCurrentWrite() && appState.rootPath === workspace && appState.projectProfileWorkspace === workspace && commandSettingsStatus) commandSettingsStatus.textContent = accountsResult.error || "Authentication accounts could not be saved";
    return;
  }
  if (!isCurrentWrite()) return;
  const currentAuthentication = profile?.engagement?.authenticationSelection || { kind: "none", id: "" };
  if (currentAuthentication.kind === "none" && accountsResult.credentialIds[0]) {
    setProjectFieldValue(profile, "engagement.authenticationSelection", { kind: "credential", id: accountsResult.credentialIds[0] });
  }
  if (appState.rootPath === workspace && appState.projectProfileWorkspace === workspace && commandSettingsStatus) commandSettingsStatus.textContent = "Saving project settingsâ€¦";
  const result = await window.api.projectProfileSave?.({ path: workspace, profile });
  if (!isCurrentWrite() || appState.rootPath !== workspace || appState.projectProfileWorkspace !== workspace || profileGeneration !== appState.projectProfileLoadGeneration) return result;
  if (result?.error || !result?.profile) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = result?.error || "Could not save project settings";
    return;
  }
  appState.projectProfileData = result.profile;
  appState.projectProfileExists = true;
  if (!autoSave) populateProjectSettings(appState.projectProfileData);
  if (commandSettingsStatus && (!autoSave || revision === appState.projectAutosaveRevision)) {
    commandSettingsStatus.textContent = autoSave ? "All changes saved" : "Saved outside the project folder";
  }
  if (!autoSave) {
    if (!isCurrentWrite()) return result;
    await loadIdentitySettings();
    if (!isCurrentWrite() || appState.rootPath !== workspace || appState.projectProfileWorkspace !== workspace || profileGeneration !== appState.projectProfileLoadGeneration) return result;
  }
  if (!isCurrentWrite() || appState.rootPath !== workspace || appState.projectProfileWorkspace !== workspace || profileGeneration !== appState.projectProfileLoadGeneration) return result;
  await configureProxyListener();
}
