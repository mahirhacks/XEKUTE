import { appState } from "../../core/app-state.js";
import {
  identitySettingsStatus, engagementAccountList, engagementAccountAdd, commandSettingsStatus,
  projectAuthSource, identityRuntimeStatus, identityList, identityImportTarget, credentialCreate,
  credentialList, identityNewId, identityNewName, identityNewRole, credentialNewId,
  credentialNewLabel, credentialNewUsername, credentialNewPassword, credentialNewRole,
  identityImportFormat, identityImportData,
} from "../../core/dom-refs.js";
import { scheduleProjectProfileAutosave, setProjectFieldValue } from "../../bootstrap.js";
import { escapeHtml } from "../../core/text-format.js";

export function identityWorkspacePath() { return appState.rootPath || appState.assessmentPath || ""; }
export function setIdentitySettingsStatus(message, tone = "") {
  if (!identitySettingsStatus) return;
  identitySettingsStatus.textContent = String(message || "Ready");
  identitySettingsStatus.classList.toggle("error", tone === "error");
  identitySettingsStatus.classList.toggle("success", tone === "success");
}

export function identityRecordList(snapshot = appState.identitySettingsSnapshot) {
  const value = snapshot?.value || snapshot || {};
  return Array.isArray(value.identities) ? value.identities : [];
}

export function credentialRecordList(snapshot = appState.identitySettingsSnapshot) {
  const value = snapshot?.value || snapshot || {};
  return Array.isArray(value.credentials) ? value.credentials : [];
}

export function authenticationSourceValue(kind = "none", id = "") {
  return kind === "identity" || kind === "credential" ? `${kind}:${id}` : "none";
}

export function markAuthenticationSourceChanged() {
  scheduleProjectProfileAutosave({ immediate: true });
}

export function reindexEngagementAccountRows() {
  if (!engagementAccountList) return;
  [...engagementAccountList.querySelectorAll(".engagement-account-row")].forEach((row, index) => {
    const accountNumber = index + 1;
    const accountLabel = `Test Account ${accountNumber}`;
    row.dataset.accountNumber = String(accountNumber);
    const heading = row.querySelector(".engagement-account-title");
    if (heading) heading.textContent = accountLabel;
    const deleteButton = row.querySelector("[data-engagement-account-delete]");
    if (deleteButton) {
      deleteButton.setAttribute("aria-label", `Delete ${accountLabel}`);
      deleteButton.title = `Delete ${accountLabel}`;
    }
    row.querySelectorAll("[data-account-field]").forEach((input) => {
      input.setAttribute("aria-label", `${accountLabel} ${input.dataset.accountField}`);
    });
  });
}

export function appendEngagementAccountRow(credential = {}, index = engagementAccountList?.children.length || 0) {
  if (!engagementAccountList) return null;
  const row = document.createElement("article");
  row.className = "engagement-account-row";
  if (credential.credentialId) row.dataset.credentialId = credential.credentialId;
  row.innerHTML = `<header class="engagement-account-header"><h4 class="engagement-account-title">Test Account ${index + 1}</h4><button type="button" class="engagement-account-delete" data-engagement-account-delete aria-label="Delete Test Account ${index + 1}" title="Delete Test Account ${index + 1}"><span class="codicon codicon-trash" aria-hidden="true"></span></button></header><div class="engagement-account-grid"><input type="text" data-account-field="username" aria-label="Test Account ${index + 1} username" placeholder="username" maxlength="500" autocomplete="username" value="${escapeHtml(credential.username || "")}"><input type="password" data-account-field="password" aria-label="Test Account ${index + 1} password" placeholder="${credential.passwordSet ? "password saved" : "password"}" maxlength="4096" autocomplete="new-password"><input type="text" data-account-field="role" aria-label="Test Account ${index + 1} role" placeholder="Role (Optional)" maxlength="120" autocomplete="off" value="${escapeHtml(credential.role || "")}"><input type="password" data-account-field="cookie" aria-label="Test Account ${index + 1} cookie" placeholder="${credential.cookieSet ? "Cookie saved (Optional)" : "Cookie (Optional)"}" maxlength="32768" autocomplete="off"></div>`;
  engagementAccountList.appendChild(row);
  reindexEngagementAccountRows();
  return row;
}

export function renderEngagementAccounts(credentials = [], { error = "", disabled = false } = {}) {
  if (!engagementAccountList) return;
  engagementAccountList.innerHTML = "";
  if (error) {
    engagementAccountList.innerHTML = `<p class="engagement-account-error">${escapeHtml(error)}</p>`;
    if (engagementAccountAdd) engagementAccountAdd.disabled = true;
    return;
  }
  credentials.forEach((credential, index) => appendEngagementAccountRow(credential, index));
  engagementAccountList.querySelectorAll("input").forEach((input) => { input.disabled = disabled; });
  engagementAccountList.querySelectorAll("[data-engagement-account-delete]").forEach((button) => { button.disabled = disabled; });
  if (engagementAccountAdd) engagementAccountAdd.disabled = disabled;
}

export async function deleteEngagementAccountRow(row) {
  if (!row || !engagementAccountList?.contains(row)) return;
  const accountNumber = [...engagementAccountList.querySelectorAll(".engagement-account-row")].indexOf(row) + 1;
  const credentialId = String(row.dataset.credentialId || "").trim();
  if (credentialId) {
    const workspace = identityWorkspacePath();
    if (!workspace || !window.api.credentialDelete) {
      if (commandSettingsStatus) commandSettingsStatus.textContent = "Encrypted account storage is unavailable";
      return;
    }
    if (!window.confirm(`Delete Test Account ${accountNumber}?`)) return;
    try {
      const result = await window.api.credentialDelete({ workspace, credentialId });
      if (result?.ok === false || result?.error) {
        if (commandSettingsStatus) commandSettingsStatus.textContent = result.error?.message || result.error || "Test account could not be deleted";
        return;
      }
      if (projectAuthSource?.value === `credential:${credentialId}`) {
        projectAuthSource.value = "none";
        markAuthenticationSourceChanged();
      }
    } catch (error) {
      if (commandSettingsStatus) commandSettingsStatus.textContent = error?.message || "Test account could not be deleted";
      return;
    }
  }
  row.remove();
  reindexEngagementAccountRows();
  if (commandSettingsStatus) commandSettingsStatus.textContent = credentialId ? "Test account deleted" : "All changes saved";
}

export function selectAuthenticationSource(kind, id) {
  if (!projectAuthSource) return;
  projectAuthSource.value = authenticationSourceValue(kind, id);
  markAuthenticationSourceChanged();
}

export function renderIdentitySettings(snapshot = appState.identitySettingsSnapshot) {
  appState.identitySettingsSnapshot = snapshot;
  const value = snapshot?.value || snapshot || {};
  const identityListError = snapshot?.ok === false ? (snapshot.error?.message || snapshot.error || "Browser identities are unavailable.") : "";
  const credentialListError = value.credentialsError?.message || "";
  const secureStorageUnavailable = value.secureStorageAvailable === false;
  let missingSelectionReset = false;
  const runtime = value.runtime || {};
  if (identityRuntimeStatus) {
    identityRuntimeStatus.textContent = runtime.available
      ? `${runtime.name || "Browser"} available · ${runtime.activeContexts || 0} active context${runtime.activeContexts === 1 ? "" : "s"}`
      : "Microsoft Edge or Google Chrome is required for real browser actions";
    identityRuntimeStatus.classList.toggle("error", !runtime.available);
  }
  const identities = identityRecordList(snapshot);
  const credentials = credentialRecordList(snapshot);
  if (credentialCreate) {
    credentialCreate.disabled = secureStorageUnavailable;
    credentialCreate.textContent = credentials.length ? "Add another" : "Add credential";
    credentialCreate.title = credentials.length ? "Store another encrypted test account" : "Store an encrypted test account";
  }
  if (identityImportTarget) {
    const current = identityImportTarget.value;
    identityImportTarget.innerHTML = `<option value="">Select identity</option>${identities.map((identity) => `<option value="${escapeHtml(identity.identityId)}">${escapeHtml(identity.name || identity.identityId)}</option>`).join("")}`;
    if (identities.some((identity) => identity.identityId === current)) identityImportTarget.value = current;
  }
  if (projectAuthSource) {
    const current = projectAuthSource.value || authenticationSourceValue(appState.projectProfileData?.engagement?.authenticationSelection?.kind, appState.projectProfileData?.engagement?.authenticationSelection?.id);
    const identityOptions = identities.map((identity) => `<option value="identity:${escapeHtml(identity.identityId)}">Browser: ${escapeHtml(identity.name || identity.identityId)}</option>`).join("");
    const credentialOptions = credentials.map((credential) => `<option value="credential:${escapeHtml(credential.credentialId)}">Credential: ${escapeHtml(credential.label || credential.credentialId)} (${escapeHtml(credential.username || "username hidden")})</option>`).join("");
    projectAuthSource.innerHTML = `<option value="none">None (anonymous)</option>${identityOptions ? `<optgroup label="Browser sessions">${identityOptions}</optgroup>` : ""}${credentialOptions ? `<optgroup label="Test credentials">${credentialOptions}</optgroup>` : ""}`;
    const validValues = new Set(["none", ...identities.map((identity) => `identity:${identity.identityId}`), ...credentials.map((credential) => `credential:${credential.credentialId}`)]);
    if (validValues.has(current)) {
      projectAuthSource.value = current;
    } else {
      const temporarilyUnavailable = current.startsWith("identity:") ? Boolean(identityListError) : current.startsWith("credential:") ? Boolean(credentialListError) : false;
      if (temporarilyUnavailable) {
        projectAuthSource.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(current)}" disabled>Saved authentication source is temporarily unavailable</option>`);
        projectAuthSource.value = current;
      } else {
        projectAuthSource.value = "none";
        if (current !== "none") {
          setProjectFieldValue(appState.projectProfileData || {}, "engagement.authenticationSelection", { kind: "none", id: "" });
          markAuthenticationSourceChanged();
          missingSelectionReset = true;
        }
      }
    }
  }
  if (identityList) {
    identityList.innerHTML = identities.length
      ? identities.map((identity) => {
        const status = identity.authStatus || "not_configured";
        const savedAt = identity.authSavedAt ? ` · saved ${mapDateLabel(identity.authSavedAt)}` : "";
        return `<article class="identity-row" data-identity-id="${escapeHtml(identity.identityId)}"><div class="identity-row-main"><strong>${escapeHtml(identity.name || identity.identityId)}</strong><small>${escapeHtml(identity.identityId)} · ${escapeHtml(identity.role || "default")} · ${escapeHtml(status)}${escapeHtml(savedAt)} · ${Number(identity.cookieCount || 0)} cookies · ${Number(identity.originCount || 0)} origins · ${Number(identity.activePageCount || 0)} pages</small></div><div class="identity-row-actions"><button type="button" data-identity-action="select" data-identity-id="${escapeHtml(identity.identityId)}">Use</button><button type="button" data-identity-action="rename" data-identity-id="${escapeHtml(identity.identityId)}">Rename</button><button type="button" data-identity-action="login" data-identity-id="${escapeHtml(identity.identityId)}">Open login</button><button type="button" data-identity-action="save" data-identity-id="${escapeHtml(identity.identityId)}">Save session</button><button type="button" data-identity-action="cancel" data-identity-id="${escapeHtml(identity.identityId)}">Cancel</button><button type="button" data-identity-action="delete" data-identity-id="${escapeHtml(identity.identityId)}">Delete</button></div></article>`;
      }).join("")
      : "<p class=\"identity-empty\">No identities configured.</p>";
  }
  if (credentialList) {
    credentialList.innerHTML = credentialListError
      ? `<p class="identity-empty identity-error">${escapeHtml(credentialListError)}</p>`
      : credentials.length
      ? credentials.map((credential) => `<article class="identity-row credential-row" data-credential-id="${escapeHtml(credential.credentialId)}"><div class="identity-row-main"><strong>${escapeHtml(credential.label || credential.credentialId)}</strong><small>${escapeHtml(credential.credentialId)} · ${escapeHtml(credential.username || "username unavailable")} · ${escapeHtml(credential.role || "user")} · password ${credential.passwordSet ? "saved" : "not set"}</small></div><div class="identity-row-actions"><button type="button" data-credential-action="select" data-credential-id="${escapeHtml(credential.credentialId)}">Use</button><button type="button" data-credential-action="delete" data-credential-id="${escapeHtml(credential.credentialId)}">Delete</button></div></article>`).join("")
      : "<p class=\"identity-empty\">No test credentials configured.</p>";
  }
  renderEngagementAccounts(credentials, { error: credentialListError || identityListError, disabled: secureStorageUnavailable });
  return { identityListError, credentialListError, secureStorageUnavailable, missingSelectionReset };
}

export async function loadIdentitySettings() {
  const loadGeneration = ++appState.identitySettingsLoadGeneration;
  const workspace = identityWorkspacePath();
  if (!workspace || !window.api.identitiesGet) {
    renderIdentitySettings({ identities: [], runtime: { available: false } });
    return;
  }
  setIdentitySettingsStatus("Loading…");
  try {
    const result = await window.api.identitiesGet({ workspace });
    if (identityWorkspacePath() !== workspace || loadGeneration !== appState.identitySettingsLoadGeneration) return;
    const rendered = renderIdentitySettings(result);
    if (result?.ok === false || result?.error) {
      setIdentitySettingsStatus(result.error?.message || result.error || "Identity settings unavailable", "error");
      return;
    }
    if (rendered.credentialListError) {
      setIdentitySettingsStatus(rendered.credentialListError, "error");
      return;
    }
    if (rendered.secureStorageUnavailable) {
      setIdentitySettingsStatus("Windows secure storage is unavailable. Test credentials and authenticated browser state cannot be saved.", "error");
      return;
    }
    if (rendered.missingSelectionReset) {
      setIdentitySettingsStatus("The saved authentication source no longer exists. Selection reset to None; save project settings to keep the change.", "error");
      return;
    }
    setIdentitySettingsStatus("Ready");
  } catch (error) {
    if (identityWorkspacePath() !== workspace || loadGeneration !== appState.identitySettingsLoadGeneration) return;
    renderIdentitySettings({ identities: [], credentials: [], runtime: { available: false } });
    setIdentitySettingsStatus(error?.message || "Identity settings unavailable", "error");
  }
}

export async function createIdentityFromSettings() {
  const workspace = identityWorkspacePath();
  const identityId = String(identityNewId?.value || "").trim();
  const name = String(identityNewName?.value || identityId).trim();
  const role = String(identityNewRole?.value || "default").trim();
  if (!workspace || !identityId) return setIdentitySettingsStatus("Open a project and enter an identity ID first.", "error");
  const result = await window.api.identityCreate?.({ workspace, identity: { identityId, name, role } });
  if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Identity could not be created.", "error");
  if (identityNewId) identityNewId.value = "";
  if (identityNewName) identityNewName.value = "";
  if (identityNewRole) identityNewRole.value = "";
  setIdentitySettingsStatus("Identity created.", "success");
  await loadIdentitySettings();
}

export async function createCredentialFromSettings() {
  const workspace = identityWorkspacePath();
  const credentialId = String(credentialNewId?.value || "").trim();
  const label = String(credentialNewLabel?.value || "").trim();
  const username = String(credentialNewUsername?.value || "");
  const password = String(credentialNewPassword?.value || "");
  const role = String(credentialNewRole?.value || "user").trim();
  if (!workspace) {
    if (credentialNewPassword) credentialNewPassword.value = "";
    return setIdentitySettingsStatus("Open a project before adding test credentials.", "error");
  }
  if (!label || !username || !password) {
    if (credentialNewPassword) credentialNewPassword.value = "";
    return setIdentitySettingsStatus("Enter an account label, username, and password.", "error");
  }
  try {
    const result = await window.api.credentialCreate?.({ workspace, credential: { credentialId, label, username, password, role } });
    if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Credential could not be saved.", "error");
    if (credentialNewId) credentialNewId.value = "";
    if (credentialNewLabel) credentialNewLabel.value = "";
    if (credentialNewUsername) credentialNewUsername.value = "";
    if (credentialNewRole) credentialNewRole.value = "";
    setIdentitySettingsStatus("Encrypted test credential saved.", "success");
    await loadIdentitySettings();
  } catch (error) {
    setIdentitySettingsStatus(error.message || "Credential could not be saved.", "error");
  } finally {
    if (credentialNewPassword) credentialNewPassword.value = "";
  }
}

export function collectEngagementAccountSnapshots() {
  if (!engagementAccountList) return [];
  return [...engagementAccountList.querySelectorAll(".engagement-account-row")].map((row, index) => {
    const usernameInput = row.querySelector('[data-account-field="username"]');
    const passwordInput = row.querySelector('[data-account-field="password"]');
    const roleInput = row.querySelector('[data-account-field="role"]');
    const cookieInput = row.querySelector('[data-account-field="cookie"]');
    return {
      row,
      index,
      credentialId: String(row.dataset.credentialId || "").trim(),
      usernameInput,
      passwordInput,
      roleInput,
      cookieInput,
      username: String(usernameInput?.value || "").trim(),
      password: String(passwordInput?.value || ""),
      role: String(roleInput?.value || "").trim(),
      cookie: String(cookieInput?.value || ""),
    };
  });
}

export async function saveEngagementAccounts({ workspace = identityWorkspacePath(), accounts = null, isCurrent = null } = {}) {
  if (!engagementAccountList) return { ok: true, credentialIds: [] };
  if (!workspace || !window.api.credentialSave) return { ok: false, error: "Encrypted account storage is unavailable." };
  if (isCurrent && !isCurrent()) return { ok: true, credentialIds: [], stale: true };
  const accountSnapshots = accounts || collectEngagementAccountSnapshots();
  for (const account of accountSnapshots) {
    if (isCurrent && !isCurrent()) return { ok: true, credentialIds: [], stale: true };
    if (!account.credentialId && !account.username && !account.password && !account.role && !account.cookie) continue;
    if (!account.username || (!account.credentialId && !account.password)) {
      if (identityWorkspacePath() === workspace) account.usernameInput?.focus();
      return { ok: false, error: `Test Account ${account.index + 1} requires a username and password.` };
    }
  }
  const credentialIds = [];
  for (const account of accountSnapshots) {
    if (isCurrent && !isCurrent()) return { ok: true, credentialIds, stale: true };
    const { row, index, credentialId, passwordInput, cookieInput, username, password, role, cookie } = account;
    if (!credentialId && !username && !password && !role && !cookie) continue;
    const result = await window.api.credentialSave({
      workspace,
      credential: { credentialId, label: `Test Account ${index + 1}`, username, password, role, cookie },
    });
    if (isCurrent && !isCurrent()) return { ok: true, credentialIds, stale: true };
    if (identityWorkspacePath() === workspace) {
      if (passwordInput?.value === password) passwordInput.value = "";
      if (cookieInput?.value === cookie) cookieInput.value = "";
    }
    if (result?.ok === false || result?.error) {
      return { ok: false, error: result.error?.message || result.error || `Test Account ${index + 1} could not be saved.` };
    }
    const savedId = String(result?.value?.credential?.credentialId || credentialId);
    if (savedId) {
      if (identityWorkspacePath() === workspace) row.dataset.credentialId = savedId;
      credentialIds.push(savedId);
    }
  }
  return { ok: true, credentialIds };
}

export async function handleCredentialAction(action, credentialId) {
  const workspace = identityWorkspacePath();
  if (!workspace || !credentialId) return;
  if (action === "select") {
    selectAuthenticationSource("credential", credentialId);
    setIdentitySettingsStatus("Test credential selected. Save project settings to keep this choice.", "success");
    return;
  }
  if (action !== "delete") return;
  if (!window.confirm(`Delete the encrypted test credential ${credentialId}?`)) return;
  try {
    const result = await window.api.credentialDelete?.({ workspace, credentialId });
    if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Credential could not be deleted.", "error");
    if (projectAuthSource?.value === `credential:${credentialId}`) {
      projectAuthSource.value = "none";
      markAuthenticationSourceChanged();
    }
    setIdentitySettingsStatus("Test credential deleted.", "success");
    await loadIdentitySettings();
  } catch (error) {
    setIdentitySettingsStatus(error.message || "Credential operation failed.", "error");
  }
}

export async function handleIdentityAction(action, identityId) {
  const workspace = identityWorkspacePath();
  if (!workspace || !identityId) return;
  try {
    if (action === "select") {
      selectAuthenticationSource("identity", identityId);
      setIdentitySettingsStatus("Browser identity selected. Save project settings to keep this choice.", "success");
    } else if (action === "rename") {
      const current = identityRecordList().find((identity) => identity.identityId === identityId);
      const name = window.prompt("Identity display name:", current?.name || identityId);
      if (!name?.trim()) return;
      const result = await window.api.identityUpdate?.({ workspace, identityId, patch: { name: name.trim() } });
      if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Identity could not be renamed.", "error");
      setIdentitySettingsStatus("Identity renamed.", "success");
      await loadIdentitySettings();
    } else if (action === "login") {
      const url = window.prompt("Reviewed login URL (the host must be in scope or authentication dependencies):", "https://");
      if (!url) return;
      setIdentitySettingsStatus("Opening operator-controlled login window…");
      const result = await window.api.identityLoginStart?.({ workspace, identityId, url });
      if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Login window could not be opened.", "error");
      setIdentitySettingsStatus("Finish login in the browser, then click Save session.", "success");
    } else if (action === "save") {
      const result = await window.api.identityLoginSave?.({ workspace, identityId });
      if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Session could not be saved.", "error");
      setIdentitySettingsStatus("Encrypted session saved.", "success");
      await loadIdentitySettings();
    } else if (action === "cancel") {
      await window.api.identityLoginCancel?.({ workspace, identityId });
      setIdentitySettingsStatus("Login window cancelled.");
      await loadIdentitySettings();
    } else if (action === "delete") {
      if (!window.confirm(`Delete the encrypted session for ${identityId}?`)) return;
      const result = await window.api.identityDelete?.({ workspace, identityId });
      if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Identity could not be deleted.", "error");
      if (projectAuthSource?.value === `identity:${identityId}`) {
        projectAuthSource.value = "none";
        markAuthenticationSourceChanged();
      }
      setIdentitySettingsStatus("Identity deleted.", "success");
      await loadIdentitySettings();
    }
  } catch (error) {
    setIdentitySettingsStatus(error.message || "Identity operation failed.", "error");
  }
}

export async function importIdentityStateFromSettings() {
  const workspace = identityWorkspacePath();
  const identityId = String(identityImportTarget?.value || "").trim();
  const format = String(identityImportFormat?.value || "");
  if (!workspace || !identityId) return setIdentitySettingsStatus("Select an identity first.", "error");
  let data = null;
  if (format === "headers") {
    try { data = JSON.parse(String(identityImportData?.value || "")); }
    catch {
      if (identityImportData) identityImportData.value = "";
      return setIdentitySettingsStatus("Header import must be valid JSON.", "error");
    }
  }
  setIdentitySettingsStatus("Importing and encrypting authentication state…");
  try {
    const result = await window.api.identityImport?.({ workspace, identityId, format, data });
    if (result?.ok === false || result?.error) return setIdentitySettingsStatus(result.error?.message || result.error || "Authentication state could not be imported.", "error");
    setIdentitySettingsStatus("Authentication state imported and encrypted.", "success");
    await loadIdentitySettings();
  } finally {
    // Secret-bearing inline imports must not remain visible after either a
    // successful or rejected main-process import.
    if (identityImportData) identityImportData.value = "";
    data = null;
  }
}
