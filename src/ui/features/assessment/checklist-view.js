import { appState } from "../../core/app-state.js";
import {
  checklistProgress, resourceViewerMeta, resourceViewerContent, checklistFrameworkName,
  checklistFrameworkVersion, checklistSearch, checklistStatusFilter, checklistGroups,
  settingsUIView, checklistUIView, resourceViewerTitle, resourceViewerIcon, resourceViewerEmpty,
  resourceViewerCopy, scopeUIView, assessmentModuleView,
} from "../../core/dom-refs.js";
import {
  setResourceDirty, syncResourceCursorPosition, saveResourceChanges, showResourcePreview,
} from "./resource-viewer.js";
import { escapeHtml } from "../../core/text-format.js";
import {
  SETTINGS_EDITOR_MODE_KEY, syncSettingsEditorButtons,
} from "../settings/settings-tab-editor.js";
import { settingsViewSwitch } from "../../bootstrap.js";
import { showResourceWorkspace } from "../layout/workspace-switcher.js";

export function checklistStatuses() {
  return appState.resourceChecklistType === "mitre"
    ? [["not-started", "Not started"], ["in-progress", "In progress"], ["observed", "Observed"], ["not-observed", "Not observed"], ["not-applicable", "Not applicable"], ["blocked", "Blocked"]]
    : [["not-tested", "Not tested"], ["in-progress", "In progress"], ["passed", "Passed"], ["failed", "Failed"], ["not-applicable", "Not applicable"], ["blocked", "Blocked"]];
}

export function checklistTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

export function checklistStatusIssue(check, status) {
  if (appState.resourceChecklistType === "mitre") return "";
  const procedure = checklistTextList(check?.procedure);
  const evidence = checklistTextList(check?.evidence || check?.evidenceIds);
  const reason = String(check?.result || check?.notes || "").trim();
  if (["passed", "failed"].includes(status) && !procedure.length) {
    return "Record the exact test procedure before marking this check as passed or failed.";
  }
  if (["passed", "failed"].includes(status) && !evidence.length) {
    return "Attach at least one evidence ID before marking this check as passed or failed.";
  }
  if (["blocked", "not-applicable"].includes(status) && !reason) {
    return `Record a reason before marking this check as ${status === "blocked" ? "blocked" : "not applicable"}.`;
  }
  return "";
}

export async function checklistEvidenceIssue(check, status) {
  if (appState.resourceChecklistType === "mitre" || !["passed", "failed"].includes(status)) return "";
  const ids = checklistTextList(check?.evidence || check?.evidenceIds);
  if (!ids.length || !appState.assessmentPath || !window.api.assessmentEvidence) return "";
  const result = await window.api.assessmentEvidence({ path: appState.assessmentPath, limit: 2000 });
  if (result?.error) return `Evidence could not be validated: ${result.error}`;
  const available = new Set((result?.records || []).map((record) => String(record.id || "")));
  const missing = ids.filter((id) => !available.has(id));
  return missing.length ? `These evidence IDs do not exist in the Evidence Index: ${missing.join(", ")}.` : "";
}

export function recalculateChecklistProgress() {
  const checks = Array.isArray(appState.resourceChecklistData?.checks) ? appState.resourceChecklistData.checks : [];
  const counts = { total: checks.length, notStarted: 0, notTested: 0, inProgress: 0, passed: 0, failed: 0, observed: 0, notObserved: 0, notApplicable: 0, blocked: 0 };
  const keys = { "not-started": "notStarted", "not-tested": "notTested", "in-progress": "inProgress", passed: "passed", failed: "failed", observed: "observed", "not-observed": "notObserved", "not-applicable": "notApplicable", blocked: "blocked" };
  checks.forEach((check) => { const key = keys[check.status || (appState.resourceChecklistType === "mitre" ? "not-started" : "not-tested")]; if (key) counts[key] += 1; });
  appState.resourceChecklistData.progress = appState.resourceChecklistType === "mitre"
    ? { total: counts.total, notStarted: counts.notStarted, inProgress: counts.inProgress, observed: counts.observed, notObserved: counts.notObserved, notApplicable: counts.notApplicable, blocked: counts.blocked }
    : { total: counts.total, notTested: counts.notTested + counts.notStarted, inProgress: counts.inProgress, passed: counts.passed, failed: counts.failed, notApplicable: counts.notApplicable, blocked: counts.blocked };
  const completed = checks.filter((check) => !["not-started", "not-tested", "in-progress"].includes(check.status || (appState.resourceChecklistType === "mitre" ? "not-started" : "not-tested"))).length;
  const percent = checks.length ? Math.round((completed / checks.length) * 100) : 0;
  if (checklistProgress) checklistProgress.innerHTML = `<strong>${percent}%</strong><span>${completed} of ${checks.length} reviewed</span><i><b style="width:${percent}%"></b></i>`;
}

export function scheduleChecklistSave() {
  clearTimeout(appState.resourceChecklistSaveTimer);
  recalculateChecklistProgress();
  appState.resourcePreviewText = `${JSON.stringify(appState.resourceChecklistData, null, 2)}\n`;
  resourceViewerContent.value = appState.resourcePreviewText;
  setResourceDirty(appState.resourcePreviewText !== appState.resourceSavedText);
  resourceViewerMeta.textContent = `${appState.resourceChecklistType === "mitre" ? "MITRE ATT&CK" : "OWASP WSTG"} · Saving...`;
  appState.resourceChecklistSaveTimer = setTimeout(async () => {
    const snapshot = `${JSON.stringify(appState.resourceChecklistData, null, 2)}\n`;
    const result = await window.api.writeFile(appState.resourceCurrentFilePath, snapshot);
    if (result?.error) { resourceViewerMeta.textContent = `Save failed: ${result.error}`; return; }
    if (resourceViewerContent.value === snapshot) { appState.resourceSavedText = snapshot; setResourceDirty(false); }
    resourceViewerMeta.textContent = `${appState.resourceChecklistType === "mitre" ? "MITRE ATT&CK" : "OWASP WSTG"} · Saved`;
  }, 350);
}

export function renderChecklistUI() {
  if (!appState.resourceChecklistActive || !appState.resourceChecklistData || !checklistGroups) return;
  const framework = appState.resourceChecklistData.framework || {};
  checklistFrameworkName.textContent = appState.resourceChecklistType === "mitre" ? "MITRE ATT&CK Enterprise" : "OWASP WSTG + Top 10";
  checklistFrameworkVersion.textContent = appState.resourceChecklistType === "mitre"
    ? `ATT&CK ${framework.version || ""} · checked ${framework.checkedAt || ""}`
    : `WSTG ${framework.version || ""} (stable ${framework.stableVersion || ""}) · Top 10:${framework.top10Version || ""}`;
  recalculateChecklistProgress();
  const query = String(checklistSearch?.value || "").trim().toLowerCase();
  const filter = checklistStatusFilter?.value || "all";
  const checks = (appState.resourceChecklistData.checks || []).map((check, index) => ({ check, index })).filter(({ check }) => {
    const haystack = [check.id, check.techniqueId, check.category, check.tactic, check.title, check.technique].join(" ").toLowerCase();
    const statusMatches = filter === "all" || check.status === filter || (filter === "not-tested" && check.status === "not-started") || (filter === "failed" && check.status === "observed");
    return statusMatches && (!query || haystack.includes(query));
  });
  const groupKey = appState.resourceChecklistType === "mitre" ? "tactic" : "category";
  const groups = new Map();
  checks.forEach((entry) => { const name = entry.check[groupKey] || "Other"; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(entry); });
  checklistGroups.innerHTML = "";
  for (const [groupName, entries] of groups) {
    const section = document.createElement("details"); section.className = "checklist-group"; section.open = true;
    const summary = document.createElement("summary"); summary.innerHTML = `<span class="codicon codicon-chevron-right"></span><strong>${escapeHtml(groupName)}</strong><small>${entries.length} checks</small>`; section.appendChild(summary);
    const list = document.createElement("div"); list.className = "checklist-items";
    entries.forEach(({ check, index }) => {
      const normalizedStatus = appState.resourceChecklistType !== "mitre" && check.status === "not-started" ? "not-tested" : (check.status || (appState.resourceChecklistType === "mitre" ? "not-started" : "not-tested"));
      const card = document.createElement("article"); card.className = `checklist-item status-${normalizedStatus}`;
      const heading = document.createElement("div"); heading.className = "checklist-item-heading";
      const identity = document.createElement("div"); identity.className = "checklist-item-identity";
      const code = document.createElement("span"); code.textContent = check.id || check.techniqueId || `#${index + 1}`;
      const title = document.createElement("strong"); title.textContent = check.title || check.technique || "Untitled check"; identity.append(code, title);
      const status = document.createElement("select"); status.className = "checklist-status"; status.dataset.index = String(index);
      checklistStatuses().forEach(([value, label]) => status.add(new Option(label, value))); status.value = normalizedStatus; heading.append(identity, status); card.appendChild(heading);
      if (appState.resourceChecklistType === "mitre") {
        const applicability = document.createElement("select"); applicability.className = "checklist-applicability"; applicability.dataset.index = String(index);
        [["unknown", "Applicability unknown"], ["applicable", "Applicable"], ["not-applicable", "Not applicable"]].forEach(([value, label]) => applicability.add(new Option(label, value))); applicability.value = check.applicability || "unknown"; card.appendChild(applicability);
      } else {
        const procedure = document.createElement("textarea"); procedure.className = "checklist-procedure"; procedure.dataset.index = String(index); procedure.placeholder = "Test procedure (one step per line)"; procedure.value = checklistTextList(check.procedure).join("\n"); card.appendChild(procedure);
        const evidence = document.createElement("input"); evidence.className = "checklist-evidence"; evidence.dataset.index = String(index); evidence.placeholder = "Evidence IDs (comma separated)"; evidence.value = checklistTextList(check.evidence || check.evidenceIds).join(", "); card.appendChild(evidence);
      }
      const notes = document.createElement("textarea"); notes.className = "checklist-notes"; notes.dataset.index = String(index); notes.placeholder = appState.resourceChecklistType === "mitre" ? "Observations, detection opportunities, or evidence paths" : "Result, limitation, blocked reason, or finding IDs"; notes.value = appState.resourceChecklistType === "mitre" ? (check.observations || check.notes || "") : (check.result || check.notes || ""); card.appendChild(notes);
      const issue = checklistStatusIssue(check, normalizedStatus);
      if (issue) { const validation = document.createElement("p"); validation.className = "checklist-validation"; validation.textContent = issue; card.appendChild(validation); }
      const reference = check.references?.[0]; if (/^https:\/\//i.test(reference || "")) { const link = document.createElement("a"); link.href = reference; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = "Framework reference"; card.appendChild(link); }
      list.appendChild(card);
    });
    section.appendChild(list); checklistGroups.appendChild(section);
  }
  if (!groups.size) { const empty = document.createElement("div"); empty.className = "checklist-empty"; empty.textContent = "No checks match the current filters."; checklistGroups.appendChild(empty); }
}

export function setResourceChecklistMode(mode) {
  if (!appState.resourceChecklistActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try { appState.resourceChecklistData = JSON.parse(resourceViewerContent.value); } catch (error) { resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`; return; }
  }
  appState.settingsEditorMode = nextMode; localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, nextMode); syncSettingsEditorButtons();
  resourceViewerContent.hidden = nextMode === "ui"; checklistUIView.hidden = nextMode !== "ui"; settingsUIView.hidden = true;
  if (nextMode === "ui") renderChecklistUI(); else { resourceViewerContent.focus(); syncResourceCursorPosition(); }
}

export async function showChecklistResource(filePath, type) {
  appState.assessmentModuleActive = false; assessmentModuleView.hidden = true;
  if (appState.resourceChecklistActive && appState.resourceCurrentFilePath === filePath) {
    if (appState.settingsEditorMode === "ui") checklistSearch?.focus();
    else resourceViewerContent?.focus();
    return;
  }
  if (appState.resourceDirty && appState.resourceCurrentFilePath && appState.resourceCurrentFilePath !== filePath) { const saved = await saveResourceChanges(); if (saved?.error) return; }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, `${type}-checklist.json`, "Checklist", { icon: "codicon-checklist" });
  let parsed; try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, "Invalid checklist JSON", "Edit the JSON to restore UI mode", { icon: "codicon-error" }); }
  appState.resourceSettingsActive = false; appState.resourceSettingsData = null; appState.resourceScopeActive = false; appState.resourceScopeData = null; settingsUIView.hidden = true; scopeUIView.hidden = true;
  appState.resourceChecklistActive = true; appState.resourceChecklistType = type; appState.resourceChecklistData = parsed;
  appState.resourcePreviewText = `${JSON.stringify(parsed, null, 2)}\n`; appState.resourceCurrentFilePath = filePath; appState.resourceSavedText = appState.resourcePreviewText;
  resourceViewerTitle.textContent = type === "mitre" ? "MITRE ATT&CK Checklist" : type === "asvs" ? "OWASP ASVS Checklist" : "OWASP WSTG Checklist";
  resourceViewerMeta.textContent = type === "mitre" ? "Enterprise ATT&CK technique coverage" : type === "asvs" ? "Application Security Verification Standard coverage" : "WSTG testing scenarios and OWASP Top 10:2025";
  resourceViewerMeta.title = filePath; resourceViewerIcon.className = `codicon ${type === "mitre" ? "codicon-type-hierarchy-sub" : "codicon-checklist"}`;
  resourceViewerEmpty.hidden = true; resourceViewerContent.classList.remove("error"); resourceViewerContent.readOnly = false; resourceViewerContent.value = appState.resourcePreviewText; resourceViewerCopy.disabled = false;
  settingsViewSwitch.hidden = false; setResourceDirty(false); setResourceChecklistMode(appState.settingsEditorMode);
}
