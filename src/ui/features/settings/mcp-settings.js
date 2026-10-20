import { appState } from "../../core/app-state.js";
import {
  kaliAccessStatus, mcpSettingsTabs, kaliAccessEnabled, kaliAccessHost, kaliAccessPort,
  kaliAccessUsername, kaliAccessKey, kaliAccessAcceptHostKey, kaliAccessFields, mcpSettingsList,
  commandSettingsStatus, kaliAccessTest,
} from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import { openFile } from "../../bootstrap.js";

export const MCP_KIND_DESCRIPTION = "Configure standard MCP servers using the same command, arguments, and environment fields used by other MCP clients.";
export const MCP_KIND_ICON = "codicon-plug";

export function mcpWorkspacePath() { return appState.rootPath || appState.assessmentPath || ""; }
export function mcpErrorMessage(result, fallback) { return result?.error?.message || result?.error || result?.message || fallback; }

export function setKaliAccessStatus(message, tone = "") {
  if (!kaliAccessStatus) return;
  kaliAccessStatus.textContent = String(message || "");
  kaliAccessStatus.className = `mcp-connection-status${tone ? ` ${tone}` : ""}`;
}

export function mcpScopeLabel(scope) {
  return String(scope || "project").toLowerCase() === "global" ? "Global" : "Project";
}

export function renderMcpScopeTabs() {
  const selected = ["all", "project", "global"].includes(appState.mcpScope) ? appState.mcpScope : "all";
  appState.mcpScope = selected;
  mcpSettingsTabs?.querySelectorAll("[data-mcp-scope]").forEach((button) => {
    const active = button.dataset.mcpScope === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.disabled = button.dataset.mcpScope === "project" && !mcpWorkspacePath();
  });
}

export function kaliAccessFormValue() {
  return {
    enabled: Boolean(kaliAccessEnabled?.checked),
    host: kaliAccessHost?.value.trim() || "",
    port: Number(kaliAccessPort?.value || 22),
    username: kaliAccessUsername?.value.trim() || "kali",
    identityFile: kaliAccessKey?.value.trim() || "",
    acceptNewHostKey: Boolean(kaliAccessAcceptHostKey?.checked),
  };
}

export function queueKaliAccessAutosave(delay = 650) {
  clearTimeout(appState.kaliAccessAutosaveTimer);
  setKaliAccessStatus("Saving automatically…", "testing");
  appState.kaliAccessAutosaveTimer = setTimeout(() => {
    appState.kaliAccessAutosaveTimer = null;
    void saveKaliAccess();
  }, delay);
}

export function renderKaliAccess(profile = {}) {
  const enabled = profile.enabled === true;
  document.getElementById("kali-access-panel")?.classList.toggle("is-enabled", enabled);
  if (kaliAccessEnabled) kaliAccessEnabled.checked = enabled;
  if (kaliAccessFields) kaliAccessFields.hidden = !enabled;
  if (kaliAccessHost) kaliAccessHost.value = profile.host || "";
  if (kaliAccessPort) kaliAccessPort.value = String(profile.port || 22);
  if (kaliAccessUsername) kaliAccessUsername.value = profile.username || "kali";
  if (kaliAccessKey) kaliAccessKey.value = profile.identityFile || "";
  if (kaliAccessAcceptHostKey) kaliAccessAcceptHostKey.checked = profile.acceptNewHostKey !== false;
  setKaliAccessStatus(enabled ? "Kali access is enabled. Test the SSH connection before using a remote MCP server." : "Local Kali access is disabled.");
}

export function renderMcpSettings() {
  if (!mcpSettingsList) return;
  renderMcpScopeTabs();
  const entries = appState.mcpServersCache.filter((entry) => appState.mcpScope === "all" || String(entry.scope || "global") === appState.mcpScope);
  const cards = entries.length
    ? entries.map((entry) => {
      const summary = entry.summary || "MCP server";
      return `<div class="guidance-entry-row"><button type="button" class="guidance-entry" data-mcp-entry-scope="${escapeHtml(entry.scope)}" aria-pressed="false" title="${escapeHtml(summary)}"><span class="guidance-entry-copy"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(summary)}</small></span><span class="guidance-entry-meta"><span class="guidance-entry-scope">${escapeHtml(mcpScopeLabel(entry.scope))}</span><span class="guidance-entry-type">${escapeHtml(entry.type === "kali" ? "Kali" : entry.type)}</span><span class="codicon codicon-chevron-right" aria-hidden="true"></span></span></button></div>`;
    }).join("")
    : "";
  const addDisabled = appState.mcpScope === "project" && !mcpWorkspacePath();
  const addRow = `<button type="button" class="mcp-add-row" data-mcp-add title="Open MCP configuration" ${addDisabled ? "disabled" : ""}><span class="mcp-add-icon"><span class="codicon codicon-add" aria-hidden="true"></span></span><span class="mcp-add-copy"><strong>Add MCP server</strong><small>Open the standard mcp.json configuration</small></span></button>`;
  mcpSettingsList.innerHTML = `<section class="guidance-category" data-mcp-kind="mcp"><header class="guidance-category-header"><div><span class="codicon ${MCP_KIND_ICON}" aria-hidden="true"></span><div><h3>MCP</h3><p>${MCP_KIND_DESCRIPTION}</p></div></div></header><div class="guidance-category-list">${cards}${addRow}</div></section>`;
  mcpSettingsList.querySelectorAll("[data-mcp-entry-scope]").forEach((button) => button.addEventListener("click", () => openMcpConfig(button.dataset.mcpEntryScope || "global")));
  mcpSettingsList.querySelectorAll("[data-mcp-add]").forEach((button) => button.addEventListener("click", () => openMcpConfig(appState.mcpScope === "project" ? "project" : "global")));
}

export async function openMcpConfig(scope = appState.mcpScope === "project" ? "project" : "global") {
  const result = await window.api.mcpEnsure?.({ workspace: mcpWorkspacePath(), scope });
  if (result?.ok === false || result?.error) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = mcpErrorMessage(result, "MCP configuration could not be opened.");
    return;
  }
  const filePath = result?.filePath;
  const fileName = String(filePath).split(/[/\\]/).pop() || "mcp.json";
  await openFile(filePath, fileName);
}

export async function loadMcpSettings() {
  appState.mcpServersCache = [];
  if (!window.api.mcpRead) { renderMcpSettings(); await loadKaliAccess(); return; }
  const result = await window.api.mcpRead({ workspace: mcpWorkspacePath() });
  if (result?.warnings?.length && commandSettingsStatus) commandSettingsStatus.textContent = result.warnings[0];
  appState.mcpServersCache = Array.isArray(result?.entries)
    ? result.entries
    : [];
  renderMcpSettings();
  await loadKaliAccess();
}

export async function loadKaliAccess() {
  if (!window.api.kaliAccessGet) return renderKaliAccess({ enabled: false });
  const result = await window.api.kaliAccessGet();
  if (result?.ok === false || result?.error) return setKaliAccessStatus(mcpErrorMessage(result, "Kali access settings could not be loaded."), "error");
  renderKaliAccess(result.value || {});
}

export async function testKaliAccess() {
  if (!window.api.kaliAccessTest) return;
  setKaliAccessStatus("Testing SSH access to Kali...", "testing");
  if (kaliAccessTest) kaliAccessTest.disabled = true;
  try {
    const result = await window.api.kaliAccessTest({ profile: kaliAccessFormValue() });
    if (result?.ok === false || result?.error) {
      setKaliAccessStatus(mcpErrorMessage(result, "Kali SSH connection failed."), "error");
      return;
    }
    setKaliAccessStatus(`SSH access confirmed in ${Number(result.latencyMs) || 0} ms.`, "success");
  } catch (error) {
    setKaliAccessStatus(error?.message || "Kali SSH connection failed.", "error");
  } finally {
    if (kaliAccessTest) kaliAccessTest.disabled = false;
  }
}

export async function saveKaliAccess(event, { quiet = false } = {}) {
  event?.preventDefault?.();
  if (!window.api.kaliAccessSave) return;
  if (!quiet) setKaliAccessStatus("Saving Kali access...", "testing");
  const result = await window.api.kaliAccessSave({ profile: kaliAccessFormValue() });
  if (result?.ok === false || result?.error) return setKaliAccessStatus(mcpErrorMessage(result, "Kali access could not be saved."), "error");
  renderKaliAccess(result.value || kaliAccessFormValue());
  if (!quiet) setKaliAccessStatus(result.value?.enabled ? "Kali access saved. Add Kali-hosted servers through the normal MCP configuration." : "Local Kali access is disabled.", "success");
}
