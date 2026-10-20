import { escapeHtml } from "../../core/text-format.js";
import { appState } from "../../core/app-state.js";
import {
  assessmentModuleSummary, assessmentModuleContent, assessmentReportGenerate,
  assessmentRunProfile, assessmentRunStart, assessmentRunStop, settingsUIView,
  resourceViewerTitle, resourceViewerMeta, resourceViewerIcon, resourceViewerEmpty,
  resourceViewerContent, resourceViewerSave, resourceViewerCopy, checklistUIView, scopeUIView,
  assessmentModuleView, assessmentModuleTitle, assessmentModuleDescription,
} from "../../core/dom-refs.js";
import { basenameOf } from "../../core/workspace-paths.js";
import { setResourceDirty, saveResourceChanges, showResourcePreview } from "./resource-viewer.js";
import { settingsViewSwitch, showResourceWorkspace } from "../../bootstrap.js";
import { assessmentDiskPath } from "./assessment-workspace.js";
import { canonicalChatMode } from "../chat/chat-mode.js";
import { setAgentStatus, addErrorMessage } from "../chat/chat-messages.js";

export const ASSESSMENT_MODULE_META = {
  "traffic/raw.jsonl": ["Raw Traffic", "Captured HTTP exchanges with request and response evidence, provenance, and capture integrity.", "codicon-arrow-swap"],
  "traffic/filtered.jsonl": ["Filtered Traffic", "Curated HTTP exchanges linked to parameters, notes, and evidence.", "codicon-filter"],
};

export function moduleValue(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function moduleCard(label, value, tone = "") {
  return `<div class="assessment-module-card ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(moduleValue(value))}</strong></div>`;
}

export function moduleTable(headers, rows, empty = "No records yet.") {
  if (!rows.length) return `<div class="assessment-module-empty">${escapeHtml(empty)}</div>`;
  return `<div class="assessment-module-table-wrap"><table class="assessment-module-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td title="${escapeHtml(moduleValue(cell))}">${escapeHtml(moduleValue(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderAssessmentModule() {
  if (!appState.assessmentModuleActive || !assessmentModuleContent) return;
  const data = appState.assessmentModuleData;
  const relativePath = appState.assessmentModulePath;
  let summary = "";
  let content = "";

  if (relativePath === "runs/runs.json") {
    const runs = Array.isArray(data?.runs) ? data.runs : [];
    const active = runs.find((run) => run.id === data?.activeRunId) || runs.find((run) => ["running", "paused"].includes(run.status));
    summary = [moduleCard("Total runs", runs.length), moduleCard("Active run", active?.id || "None", active ? "warning" : "success"), moduleCard("Completed", runs.filter((run) => run.status === "completed").length, "success"), moduleCard("Stopped", runs.filter((run) => run.status === "stopped").length)].join("");
    content = `<div class="assessment-module-section"><h3>Run history</h3>${moduleTable(["Run", "Profile", "Status", "Created", "Scope snapshot", "Stop reason"], runs.slice().reverse().map((run) => [run.id, run.profile, run.status, run.createdAt, run.scopeSnapshotSha256 ? `${run.scopeSnapshotSha256.slice(0, 12)}…` : "—", run.stopReason]))}</div>`;
  } else if (relativePath === "enumeration/assets.json") {
    const assets = Array.isArray(data?.assets) ? data.assets : [];
    summary = [moduleCard("Assets", assets.length), moduleCard("In scope", assets.filter((asset) => asset.inScope === true).length, "success"), moduleCard("Out of scope", assets.filter((asset) => asset.inScope === false).length, "danger"), moduleCard("Unknown", assets.filter((asset) => asset.inScope == null).length, "warning"), moduleCard("Untested", assets.filter((asset) => asset.tested !== true).length, "warning")].join("");
    content = `<div class="assessment-module-section"><h3>Asset inventory</h3>${moduleTable(["Asset", "Type", "Environment", "Scope", "Status", "Source", "Last seen"], assets.slice().reverse().map((asset) => [asset.value, asset.assetType, asset.environment, asset.inScope === true ? "In scope" : asset.inScope === false ? "Out of scope" : "Unknown", asset.status, asset.source, asset.lastSeen]))}</div>`;
  } else if (["traffic/raw.jsonl", "traffic/filtered.jsonl"].includes(relativePath)) {
    const records = (Array.isArray(data) ? data : []).filter((record) => record?.recordType !== "pointer-log-schema");
    const methods = new Set(records.map((record) => record.method).filter(Boolean));
    const hosts = new Set(records.map((record) => {
      try { return new URL(record.url).host; } catch { return record.targetId || ""; }
    }).filter(Boolean));
    summary = [
      moduleCard("Exchanges", records.length),
      moduleCard("Hosts", hosts.size),
      moduleCard("Methods", methods.size),
      moduleCard("Linked evidence", records.filter((record) => record.requestId || record.evidenceFiles?.length).length, "success"),
      moduleCard("Parse state", "Valid JSONL", "success"),
    ].join("");
    content = `<div class="assessment-module-section"><h3>HTTP records</h3>${moduleTable(["Time", "Request ID", "Method", "URL", "Status", "Type", "Source"], records.slice().reverse().slice(0, 500).map((record) => [record.timestamp || record.capturedAt, record.requestId || record.id, record.method, record.url, record.statusCode, record.contentType || record.responseContentType, record.source || record.tool]))}</div>`;
  } else if (relativePath === "report/report.md") {
    const text = String(data?.content || "");
    const headings = text.split(/\r?\n/).filter((line) => /^#{1,3}\s/.test(line)).slice(0, 30);
    summary = [moduleCard("Report status", text.trim() ? "Draft available" : "Empty", text.trim() ? "success" : "warning"), moduleCard("Sections", headings.length), moduleCard("Generated export", "Use Generate report")].join("");
    content = `<div class="assessment-module-section"><h3>Report outline</h3>${moduleTable(["Section", "State"], headings.map((heading) => [heading.replace(/^#+\s*/, ""), "Draft section"]))}</div><div class="assessment-module-section"><h3>Next step</h3><p class="assessment-module-report-note">Generate a timestamped Markdown export after reviewing evidence, checklist coverage, and retest state. The working report remains editable through Open JSON.</p></div>`;
  } else {
    const records = Array.isArray(data) ? data : data?.records || [];
    summary = [moduleCard("Records", records.length), moduleCard("Source", relativePath), moduleCard("Integrity", "Metadata preserved", "success")].join("");
    content = `<div class="assessment-module-section"><h3>Recent records</h3>${moduleTable(["Timestamp", "Type", "ID", "Target", "Status", "Hash"], records.slice(0, 200).map((record) => [record.timestamp || record.recordedAt || record.capturedAt, record.type || record.recordType, record.id || record.runId || record.requestId, record.target || record.targetId || record.tool || record.url, record.status || (record.allowed === false ? "blocked" : record.ok === false ? "failed" : "recorded"), (record.sha256 || "").slice(0, 12)]))}</div>`;
  }
  assessmentModuleSummary.innerHTML = summary;
  assessmentModuleContent.innerHTML = content;
  const isRunModule = relativePath === "runs/runs.json";
  if (assessmentReportGenerate) assessmentReportGenerate.hidden = relativePath !== "report/report.md";
  assessmentRunStart.hidden = !isRunModule;
  assessmentRunStop.hidden = !isRunModule;
  assessmentRunProfile.hidden = !isRunModule;
  const active = isRunModule && (data?.runs || []).some((run) => ["running", "paused"].includes(run.status));
  assessmentRunStop.disabled = !active;
  assessmentRunStart.disabled = active;
}

export async function showAssessmentModule(filePath, relativePath) {
  if (appState.resourceDirty && appState.resourceCurrentFilePath && appState.resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, basenameOf(filePath), `Target / ${relativePath}`, { icon: "codicon-error" });
  let parsed;
  if (/\.jsonl$/i.test(relativePath)) {
    parsed = String(result.content || "").split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { type: "invalid", content: line }; } });
  } else if (relativePath.endsWith(".md")) {
    parsed = { content: String(result.content || "") };
  } else {
    try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, basenameOf(filePath), `Target / ${relativePath}`, { icon: "codicon-error" }); }
  }
  const [title, description, icon] = ASSESSMENT_MODULE_META[relativePath] || [basenameOf(filePath), `Target / ${relativePath}`, "codicon-file-text"];
  appState.assessmentModuleActive = true; appState.assessmentModulePath = relativePath; appState.assessmentModuleData = parsed;
  appState.resourceSettingsActive = false; appState.resourceSettingsData = null; appState.resourceChecklistActive = false; appState.resourceChecklistData = null; appState.resourceScopeActive = false; appState.resourceScopeData = null;
  resourceViewerEmpty.hidden = true; resourceViewerContent.hidden = true; resourceViewerContent.value = "";
  appState.resourceCurrentFilePath = ""; appState.resourceSavedText = ""; appState.resourcePreviewText = ""; resourceViewerCopy.disabled = true; resourceViewerSave.disabled = true;
  settingsViewSwitch.hidden = true; settingsUIView.hidden = true; checklistUIView.hidden = true; scopeUIView.hidden = true; assessmentModuleView.hidden = false;
  assessmentModuleTitle.textContent = title; assessmentModuleDescription.textContent = description; resourceViewerTitle.textContent = title; resourceViewerMeta.textContent = `Target / ${relativePath}`; resourceViewerMeta.title = filePath; resourceViewerIcon.className = `codicon ${icon}`;
  setResourceDirty(false); renderAssessmentModule();
}

export async function refreshAssessmentModule() {
  if (!appState.assessmentModuleActive || !appState.assessmentModulePath || !appState.assessmentPath) return;
  const filePath = assessmentDiskPath(appState.assessmentModulePath);
  const result = await window.api.readFile(filePath);
  if (result?.error) return;
  if (/\.jsonl$/i.test(appState.assessmentModulePath)) {
    appState.assessmentModuleData = String(result.content || "").split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { type: "invalid", content: line }; } });
  } else if (appState.assessmentModulePath.endsWith(".md")) {
    appState.assessmentModuleData = { content: String(result.content || "") };
  } else {
    try { appState.assessmentModuleData = JSON.parse(result.content); } catch { return; }
  }
  renderAssessmentModule();
}

export async function startAssessmentRun() {
  if (!appState.assessmentPath || assessmentRunStart?.disabled) return;
  const role = canonicalChatMode(assessmentRunProfile?.value || "ask");
  const profile = role;
  assessmentRunStart.disabled = true;
  const result = await window.api.assessmentCreateRun({ path: appState.assessmentPath, run: { profile, status: "running", operator: "local-user" } });
  if (result?.error) {
    assessmentRunStart.disabled = false;
    addErrorMessage(result.error);
    return;
  }
  setAgentStatus(`Run ${result.run?.id || "started"} running`);
  await refreshAssessmentModule();
}

export async function stopAssessmentRun() {
  if (!appState.assessmentPath || !appState.assessmentModuleData || appState.assessmentModulePath !== "runs/runs.json") return;
  const active = (appState.assessmentModuleData.runs || []).find((run) => ["running", "paused"].includes(run.status));
  if (!active) return;
  const reasonInput = await AppDialog.prompt("Why is this run being stopped?", "Stopped by operator", { title: "Stop run" });
  if (reasonInput === null) return;
  const reason = reasonInput.trim() || "Stopped by operator";
  const result = await window.api.assessmentUpdateRun({ path: appState.assessmentPath, id: active.id, patch: { status: "stopped", completedAt: new Date().toISOString(), stopReason: reason } });
  if (result?.error) { addErrorMessage(result.error); return; }
  setAgentStatus(`Run ${active.id} stopped`);
  await refreshAssessmentModule();
}
