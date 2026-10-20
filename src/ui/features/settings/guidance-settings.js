import { appState } from "../../core/app-state.js";
import {
  commandSettingsStatus, guidanceSettingsDetail, guidanceSettingsEmpty, guidanceScopeTabs,
  guidanceSettingsList, chatInput,
} from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import { openFile } from "../../bootstrap.js";
import { openChatPane } from "../chat/chat-sessions.js";
import { setChatMode } from "../chat/chat-mode.js";
import { resizeChatInput, setChatInputCaretToEnd, updateSendBtn } from "../chat/composer-input.js";
import { scheduleTier1ContextPreview } from "../chat/context-usage.js";
import { syncCustomSkillSlashCommands } from "../chat/slash-commands.js";

// Project and global guidance intentionally remain additive and never expose
// protected system prompts in the settings workspace.
export const GUIDANCE_KIND_LABELS = Object.freeze({ rules: "Rules", skills: "Skills", subagents: "Subagents" });
export const GUIDANCE_KIND_ICONS = Object.freeze({ rules: "codicon-law", skills: "codicon-symbol-keyword", subagents: "codicon-organization" });
export const GUIDANCE_KIND_DESCRIPTIONS = Object.freeze({
  rules: "Use rules to guide agent behavior, standards, and project conventions.",
  skills: "Skills add focused workflows and domain knowledge the agent can use when relevant.",
  subagents: "Subagents are specialized agents for focused tasks that can be handled in parallel.",
});

export function queueGuidanceAutosave(delay = 650) {
  clearTimeout(appState.guidanceAutosaveTimer);
  appState.guidanceAutosavePending = true;
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Saving automatically…";
  appState.guidanceAutosaveTimer = setTimeout(() => { void flushGuidanceAutosave(); }, delay);
}

export async function flushGuidanceAutosave() {
  clearTimeout(appState.guidanceAutosaveTimer);
  appState.guidanceAutosaveTimer = null;
  if (appState.guidanceAutosavePromise) {
    appState.guidanceAutosavePending = true;
    await appState.guidanceAutosavePromise;
    return appState.guidanceAutosavePending ? flushGuidanceAutosave() : true;
  }
  if (!guidanceDetailIsDirty()) {
    appState.guidanceAutosavePending = false;
    return true;
  }
  appState.guidanceAutosavePending = false;
  appState.guidanceAutosavePromise = saveGuidanceFile({ autoSave: true });
  const saved = await appState.guidanceAutosavePromise;
  appState.guidanceAutosavePromise = null;
  if (appState.guidanceAutosavePending) return flushGuidanceAutosave();
  return saved;
}

export function guidanceKindLabel(kind) {
  return GUIDANCE_KIND_LABELS[String(kind || "").toLowerCase()] || "Subagents";
}

export function guidanceEntryKind(entry) {
  const explicit = String(entry?.kind || "").toLowerCase();
  if (GUIDANCE_KIND_LABELS[explicit]) return explicit;
  const parts = String(entry?.relativePath || "").replace(/\\/g, "/").split("/");
  const raw = parts[1] === "instructions" ? "subagents" : parts[1];
  return GUIDANCE_KIND_LABELS[raw] ? raw : "skills";
}

export function guidanceScopeLabel(scope) {
  return String(scope || "project").toLowerCase() === "global" ? "Global" : "Project";
}

export function guidanceEntryKey(entry) {
  return `${entry?.scope || "project"}:${entry?.relativePath || ""}`;
}

export function guidanceDetailIsDirty() {
  return Boolean(appState.guidanceDraft?.dirty || guidanceSettingsDetail?.querySelector("textarea")?.dataset.dirty === "true");
}

export function setGuidanceEmptyState(message = "Create a rule, skill, or subagent with the AI.") {
  if (!guidanceSettingsEmpty) return;
  guidanceSettingsEmpty.hidden = false;
  guidanceSettingsEmpty.innerHTML = `<span class="codicon codicon-symbol-keyword"></span><h2>No guidance yet</h2><p>${escapeHtml(message)}</p>`;
  if (guidanceSettingsDetail) guidanceSettingsDetail.hidden = true;
}

export function renderGuidanceScopeTabs() {
  const selected = ["all", "project", "global"].includes(appState.guidanceScope) ? appState.guidanceScope : "all";
  appState.guidanceScope = selected;
  guidanceScopeTabs?.querySelectorAll("[data-guidance-scope]").forEach((button) => {
    const active = button.dataset.guidanceScope === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

export function renderGuidanceList() {
  if (!guidanceSettingsList) return;
  if (guidanceSettingsEmpty?.querySelector("#guidance-empty-new")) guidanceSettingsEmpty.innerHTML = "";
  renderGuidanceScopeTabs();
  const visible = appState.customGuidanceEntries.filter((entry) => appState.guidanceScope === "all" || String(entry.scope || "project") === appState.guidanceScope);
  const categories = ["rules", "skills", "subagents"];
  const projectNotice = appState.guidanceScope === "project" && !appState.rootPath
    ? `<div class="guidance-scope-notice"><span class="codicon codicon-folder-library"></span><span>Open a project to create project guidance. Global guidance remains available.</span></div>`
    : "";
  guidanceSettingsList.innerHTML = projectNotice + categories.map((kind) => {
    const entries = visible.filter((entry) => guidanceEntryKind(entry) === kind);
    const cards = entries.length
      ? entries.map((entry) => {
        const selected = guidanceEntryKey(entry) === `${appState.selectedGuidanceScope}:${appState.selectedGuidancePath}`;
        const summary = entry.summary || `Open this ${guidanceKindLabel(kind).toLowerCase().replace(/s$/, "")} to view its instructions.`;
        const entryName = entry.name || entry.relativePath.split("/").pop() || "guidance";
        const entryPath = escapeHtml(entry.relativePath);
        const entryScope = escapeHtml(entry.scope || "project");
        return `<div class="guidance-entry-row"><button type="button" class="guidance-entry${selected ? " active" : ""}" data-guidance-path="${entryPath}" data-guidance-scope="${entryScope}" aria-pressed="${selected}"><span class="guidance-entry-copy"><strong>${escapeHtml(entryName)}</strong><small>${escapeHtml(summary)}</small></span></button><button type="button" class="guidance-entry-delete" data-guidance-delete-path="${entryPath}" data-guidance-delete-scope="${entryScope}" aria-label="Delete ${escapeHtml(entryName)}" title="Delete ${escapeHtml(entryName)}"><span class="codicon codicon-trash" aria-hidden="true"></span></button></div>`;
      }).join("")
      : `<div class="guidance-category-empty">No ${guidanceKindLabel(kind).toLowerCase()} yet.</div>`;
    return `<section class="guidance-category" data-guidance-kind="${kind}"><header class="guidance-category-header"><div><span class="codicon ${GUIDANCE_KIND_ICONS[kind]}" aria-hidden="true"></span><div><h3>${guidanceKindLabel(kind)}</h3><p>${GUIDANCE_KIND_DESCRIPTIONS[kind]}</p></div></div><button type="button" class="guidance-new-button" data-guidance-new-kind="${kind}" ${!appState.rootPath && appState.guidanceScope === "project" ? "disabled" : ""}><span class="codicon codicon-add" aria-hidden="true"></span>New</button></header><div class="guidance-category-list">${cards}</div></section>`;
  }).join("");
  guidanceSettingsList.querySelectorAll("[data-guidance-path]").forEach((button) => button.addEventListener("click", () => selectGuidanceEntry(button.dataset.guidancePath, button.dataset.guidanceScope)));
  guidanceSettingsList.querySelectorAll("[data-guidance-delete-path]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    deleteGuidanceEntry(button.dataset.guidanceDeletePath, button.dataset.guidanceDeleteScope);
  }));
  guidanceSettingsList.querySelectorAll("[data-guidance-new-kind]").forEach((button) => button.addEventListener("click", () => beginGuidanceCreate(button.dataset.guidanceNewKind)));
  if (!visible.length && appState.guidanceScope !== "all") setGuidanceEmptyState(appState.guidanceScope === "project" && !appState.rootPath ? "Open a project to add project guidance, or switch to Global." : "Create your first rule, skill, or subagent with the AI.");
  else if (guidanceSettingsEmpty) guidanceSettingsEmpty.hidden = true;
  if (appState.selectedGuidancePath && appState.customGuidanceEntries.some((entry) => guidanceEntryKey(entry) === `${appState.selectedGuidanceScope}:${appState.selectedGuidancePath}`)) renderGuidanceDetail();
  else if (guidanceSettingsDetail) guidanceSettingsDetail.hidden = true;
}

export function renderGuidanceDetail() {
  if (!guidanceSettingsDetail) return;
  const existing = appState.customGuidanceEntries.find((entry) => guidanceEntryKey(entry) === `${appState.selectedGuidanceScope}:${appState.selectedGuidancePath}`);
  if (!existing) {
    guidanceSettingsDetail.hidden = true;
    return;
  }
  const kind = guidanceEntryKind(existing);
  guidanceSettingsEmpty.hidden = true;
  guidanceSettingsDetail.hidden = false;
  guidanceSettingsDetail.innerHTML = `<article class="guidance-detail-card"><header class="guidance-detail-header"><div><span class="codicon ${GUIDANCE_KIND_ICONS[kind]}" aria-hidden="true"></span><div><span class="guidance-detail-eyebrow">${escapeHtml(guidanceScopeLabel(existing.scope))} ${guidanceKindLabel(kind).slice(0, -1)}</span><h2>${escapeHtml(existing.name || "Guidance")}</h2><p>${escapeHtml(existing.relativePath)}</p></div></div><span class="guidance-kind-badge">${escapeHtml(guidanceKindLabel(kind).slice(0, -1))}</span></header><label class="guidance-detail-content-label">Instructions<textarea id="guidance-file-content" spellcheck="false">${escapeHtml(appState.selectedGuidanceContent)}</textarea></label><aside class="guidance-protection-note"><span class="codicon codicon-shield" aria-hidden="true"></span><p>Additive context only. It cannot grant permissions, bypass authorization, change scope, or override runtime guardrails.</p></aside><footer class="guidance-detail-actions"><button type="button" id="guidance-cancel-file" class="secondary-button">Close</button><button type="button" id="guidance-delete-file" class="secondary-button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete</button></footer></article>`;
  const contentInput = guidanceSettingsDetail.querySelector("#guidance-file-content");
  contentInput?.addEventListener("input", () => {
    appState.selectedGuidanceContent = contentInput.value;
    if (appState.guidanceDraft) appState.guidanceDraft.dirty = true;
    contentInput.dataset.dirty = "true";
    queueGuidanceAutosave();
  });
  guidanceSettingsDetail.querySelector("#guidance-cancel-file")?.addEventListener("click", async () => {
    if (!await flushGuidanceAutosave()) return;
    appState.guidanceDraft = null;
    appState.selectedGuidancePath = "";
    appState.selectedGuidanceContent = "";
    renderGuidanceList();
  });
  guidanceSettingsDetail.querySelector("#guidance-delete-file")?.addEventListener("click", deleteGuidanceFile);
}

export async function selectGuidanceEntry(relativePath, scope = "project") {
  if (guidanceDetailIsDirty() && !await flushGuidanceAutosave()) return;
  const selectedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const result = await window.api.guidanceRead?.({ workspace: appState.rootPath, relativePath, scope: selectedScope });
  if (result?.error) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = result.error;
    return;
  }
  appState.selectedGuidancePath = result.relativePath || relativePath;
  appState.selectedGuidanceScope = selectedScope;
  appState.selectedGuidanceContent = String(result.content || "");
  appState.guidanceDraft = null;

  const filePath = String(result.path || "").trim();
  if (filePath) {
    const fileName = filePath.replace(/\\/g, "/").split("/").pop() || appState.selectedGuidancePath;
    await openFile(filePath, fileName);
    if (commandSettingsStatus) commandSettingsStatus.textContent = `Opened ${fileName}`;
    return;
  }

  renderGuidanceList();
  renderGuidanceDetail();
  requestAnimationFrame(() => guidanceSettingsDetail?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

export function guidanceCreationScope() {
  if (appState.guidanceScope === "global") return "global";
  if (appState.guidanceScope === "project" && appState.rootPath) return "project";
  return appState.rootPath ? "project" : "global";
}

export function beginGuidanceCreate(kind = "skills") {
  const scope = guidanceCreationScope();
  if (scope === "project" && !appState.rootPath) {
    setGuidanceEmptyState("Open a project before creating project guidance, or switch to Global.");
    return;
  }
  const commandKind = kind === "subagents" ? "subagent" : kind === "rules" ? "rule" : "skill";
  const label = commandKind === "subagent" ? "subagent" : commandKind;
  const prompt = `/create-${commandKind} Help me create this ${label} for XEKUTE:\n\nScope: ${guidanceScopeLabel(scope)}\n\nDescribe what you want this ${label} to do. The AI will infer a kebab-case filename and create a detailed Markdown file under .xekute/${kind}/ in the selected scope.`;
  appState.guidanceDraft = { isNew: true, kind, scope, dirty: false };
  setChatMode("agent");
  openChatPane({ createIfEmpty: true });
  chatInput.value = prompt;
  resizeChatInput();
  updateSendBtn();
  chatInput.focus();
  setChatInputCaretToEnd();
  if (commandSettingsStatus) commandSettingsStatus.textContent = `Ready to create a ${label} in ${guidanceScopeLabel(scope)} scope`;
}

export async function saveGuidanceFile({ autoSave = false } = {}) {
  const existing = appState.customGuidanceEntries.find((entry) => guidanceEntryKey(entry) === `${appState.selectedGuidanceScope}:${appState.selectedGuidancePath}`);
  if (!existing) return false;
  const content = guidanceSettingsDetail?.querySelector("#guidance-file-content")?.value || "";
  const result = await window.api.guidanceSave?.({ workspace: appState.rootPath, relativePath: appState.selectedGuidancePath, content, scope: appState.selectedGuidanceScope });
  if (result?.error) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = result.error;
    return false;
  }
  const contentInput = guidanceSettingsDetail?.querySelector("#guidance-file-content");
  if (contentInput?.value === content) {
    appState.guidanceDraft = null;
    appState.selectedGuidanceContent = content;
    contentInput.dataset.dirty = "false";
    if (commandSettingsStatus) commandSettingsStatus.textContent = autoSave ? "All changes saved" : `Saved ${appState.selectedGuidancePath}`;
  }
  if (!autoSave) await loadGuidanceSettings({ preserveSelection: true });
  else await refreshCustomSkillCatalog();
  // Rules and skills are Tier 1 categories, so editing one changes the meter
  // even though the session, model, and mode are unchanged.
  scheduleTier1ContextPreview({ force: true });
  return true;
}

export async function deleteGuidanceEntry(relativePath, scope = "project") {
  const normalizedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const entry = appState.customGuidanceEntries.find((candidate) => guidanceEntryKey(candidate) === `${normalizedScope}:${relativePath}`);
  if (!entry || !window.api.guidanceDelete) return false;
  const label = entry.name || String(relativePath || "guidance").split("/").pop() || "guidance";
  if (!await AppDialog.confirm(`Delete ${label}?`, { title: "Delete guidance", confirmLabel: "Delete", tone: "danger" })) return false;
  const result = await window.api.guidanceDelete({ workspace: appState.rootPath, relativePath, scope: normalizedScope });
  if (result?.error) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = result.error;
    return false;
  }
  if (appState.selectedGuidanceScope === normalizedScope && appState.selectedGuidancePath === relativePath) {
    appState.selectedGuidancePath = "";
    appState.selectedGuidanceContent = "";
    appState.guidanceDraft = null;
  }
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Guidance deleted";
  await loadGuidanceSettings();
  scheduleTier1ContextPreview({ force: true });
  return true;
}

export async function deleteGuidanceFile() {
  await deleteGuidanceEntry(appState.selectedGuidancePath, appState.selectedGuidanceScope);
}

export function renderGuidanceSettings() {
  renderGuidanceList();
  if (appState.guidanceDraft && !appState.guidanceDraft.isNew) renderGuidanceDetail();
}

export async function refreshCustomSkillCatalog() {
  const requestedWorkspace = appState.rootPath || "";
  const requestGeneration = ++appState.guidanceEntriesRequestGeneration;
  const catalog = await window.api.guidanceEntries?.({ workspace: requestedWorkspace, scope: "all" });
  if (appState.rootPath !== requestedWorkspace || requestGeneration !== appState.guidanceEntriesRequestGeneration) return false;
  if (!Array.isArray(catalog?.entries)) return false;
  appState.customGuidanceEntries = catalog.entries;
  syncCustomSkillSlashCommands();
  await loadGuidanceContext();
  return true;
}

export async function loadGuidanceContext() {
  if (!window.api.guidanceContext) {
    appState.guidanceContextRequestGeneration += 1;
    appState.guidanceContext = "";
    return appState.guidanceContext;
  }
  const requestedWorkspace = appState.rootPath || "__global__";
  const workspace = appState.rootPath || "";
  if (appState.guidanceContextPromise && appState.guidanceContextRequestPath === requestedWorkspace) return appState.guidanceContextPromise;
  const requestGeneration = ++appState.guidanceContextRequestGeneration;
  appState.guidanceContext = "";
  appState.guidanceContextRequestPath = requestedWorkspace;
  appState.guidanceContextPromise = window.api.guidanceContext({ workspace })
    .then((result) => {
      if (requestGeneration === appState.guidanceContextRequestGeneration && (appState.rootPath || "__global__") === requestedWorkspace) appState.guidanceContext = result?.context || "";
      return appState.guidanceContext;
    })
    .catch(() => {
      if (requestGeneration === appState.guidanceContextRequestGeneration && (appState.rootPath || "__global__") === requestedWorkspace) appState.guidanceContext = "";
      return appState.guidanceContext;
    })
    .finally(() => {
      if (requestGeneration === appState.guidanceContextRequestGeneration && appState.guidanceContextRequestPath === requestedWorkspace) {
        appState.guidanceContextPromise = null;
        appState.guidanceContextRequestPath = "";
      }
    });
  return appState.guidanceContextPromise;
}

export async function loadGuidanceSettings({ preserveSelection = false } = {}) {
  const requestedWorkspace = appState.rootPath || "";
  const requestGeneration = ++appState.guidanceEntriesRequestGeneration;
  const previousSelection = appState.selectedGuidancePath;
  const previousScope = appState.selectedGuidanceScope;
  if (!preserveSelection) appState.guidanceDraft = null;
  if (!window.api.guidanceEntries) {
    appState.customGuidanceEntries = [];
    syncCustomSkillSlashCommands();
    appState.selectedGuidancePath = "";
    appState.selectedGuidanceContent = "";
    renderGuidanceSettings();
    return;
  }
  const result = await window.api.guidanceEntries({ workspace: requestedWorkspace, scope: "all" });
  if (appState.rootPath !== requestedWorkspace || requestGeneration !== appState.guidanceEntriesRequestGeneration) return;
  appState.customGuidanceEntries = Array.isArray(result?.entries) ? result.entries : [];
  syncCustomSkillSlashCommands();
  if (preserveSelection && previousSelection && appState.customGuidanceEntries.some((entry) => guidanceEntryKey(entry) === `${previousScope}:${previousSelection}`)) {
    appState.selectedGuidancePath = previousSelection;
    appState.selectedGuidanceScope = previousScope;
  } else if (!appState.customGuidanceEntries.some((entry) => guidanceEntryKey(entry) === `${appState.selectedGuidanceScope}:${appState.selectedGuidancePath}`)) {
    appState.selectedGuidancePath = "";
    appState.selectedGuidanceContent = "";
  }
  renderGuidanceSettings();
  await loadGuidanceContext();
}
