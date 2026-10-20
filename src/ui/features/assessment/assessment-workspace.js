import {
  bugBountyTree, assessmentRepairConfirm, assessmentRepairSubtitle, assessmentRepairDescription,
  assessmentRepairSummary, assessmentRepairList, assessmentRepairOverlay, bugBountyRepair,
  assessmentRepairCancel, btnCreateProjectHeader, bugBountyTargetLabel, bugBountySetup,
  bugBountyStateIcon, bugBountyStateTitle, bugBountyStateMessage, btnCreateProject,
  btnCreateAssessment, btnOpenAssessment, bugBountyRepairLabel,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { escapeHtml } from "../../core/text-format.js";
import { projectName, loadWorkspace } from "../project/project-activation.js";
import {
  setNotifications, refreshCustomEntries, syncInterceptorToggleUi, configureProxyListener,
  selectedCustomEntries, refreshSecurityHistoryIfVisible,
} from "../../bootstrap.js";
import { refreshAssessmentSettingsCache } from "../settings/settings-tab-editor.js";

export const BUG_BOUNTY_EXPANSION_KEY = "pointer:bugBountyExpansion";
export const BUG_BOUNTY_SELECTED_KEY = "pointer:bugBountySelected";
export const BUG_BOUNTY_PATH_KEY = "pointer:bugBountyPath";

export function persistBugBountyExpansion() {
  const expanded = [...bugBountyTree.querySelectorAll(".bounty-phase.expanded")]
    .map((phase) => phase.dataset.bountySection)
    .filter(Boolean);
  localStorage.setItem(BUG_BOUNTY_EXPANSION_KEY, JSON.stringify(expanded));
}

export function setBugBountyPhaseExpanded(phase, expanded, { persist = true } = {}) {
  if (!phase) return;
  phase.classList.toggle("expanded", Boolean(expanded));
  phase.querySelector(".bounty-phase-toggle")?.setAttribute("aria-expanded", String(Boolean(expanded)));
  const chevron = phase.querySelector(".bounty-chevron");
  chevron?.classList.toggle("codicon-chevron-down", Boolean(expanded));
  chevron?.classList.toggle("codicon-chevron-right", !expanded);
  if (persist) persistBugBountyExpansion();
}

export function restoreBugBountyTreeState() {
  let expanded = null;
  try {
    const saved = JSON.parse(localStorage.getItem(BUG_BOUNTY_EXPANSION_KEY) || "null");
    if (Array.isArray(saved)) expanded = new Set(saved);
  } catch {
    localStorage.removeItem(BUG_BOUNTY_EXPANSION_KEY);
  }
  bugBountyTree?.querySelectorAll(".bounty-phase").forEach((phase) => {
    const isExpanded = expanded
      ? expanded.has(phase.dataset.bountySection)
      : phase.classList.contains("expanded");
    setBugBountyPhaseExpanded(phase, isExpanded, { persist: false });
  });

  const selected = localStorage.getItem(BUG_BOUNTY_SELECTED_KEY);
  if (!selected) return;
  const item = bugBountyTree?.querySelector(`[data-bounty-item="${CSS.escape(selected)}"], [data-bounty-folder="${CSS.escape(selected)}"]`);
  item?.classList.add("selected");
  item?.setAttribute("aria-selected", "true");
}

export function assessmentFolderName(folder = appState.assessmentPath) {
  return String(folder || "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "ASSESSMENT";
}

export function assessmentRepairIssueDetails(issue = {}) {
  const kind = issue.type === "directory" ? "Folder" : "File";
  if (issue.reason === "missing") return { icon: issue.type === "directory" ? "codicon-folder" : "codicon-file-text", action: `Create ${kind.toLowerCase()}` , tone: "create" };
  if (issue.reason === "missing_fields") {
    const fields = Array.isArray(issue.fields) && issue.fields.length ? `: ${issue.fields.join(", ")}` : "";
    return { icon: "codicon-edit", action: `Merge missing fields${fields}`, tone: "update" };
  }
  if (issue.reason === "invalid_json") return { icon: "codicon-error", action: "Needs manual JSON repair", tone: "blocked" };
  if (issue.reason === "wrong_type") return { icon: "codicon-error", action: `Blocked: expected a ${kind.toLowerCase()}`, tone: "blocked" };
  return { icon: "codicon-warning", action: "Needs manual attention", tone: "blocked" };
}

export function renderAssessmentRepairDialog(verification = appState.assessmentVerification) {
  const missing = Array.isArray(verification?.missing) ? verification.missing : [];
  const createCount = missing.filter((issue) => issue.reason === "missing").length;
  const updateCount = missing.filter((issue) => issue.reason === "missing_fields").length;
  const blockedCount = missing.length - createCount - updateCount;
  const total = missing.length;

  if (assessmentRepairSubtitle) {
    assessmentRepairSubtitle.textContent = `${total} item${total === 1 ? "" : "s"} need attention in ${assessmentFolderName()}.`;
  }
  if (assessmentRepairDescription) {
    assessmentRepairDescription.textContent = blockedCount
      ? "XEKUTE noticed differences from the starter template. Work is never blocked and existing files are never overwritten; incompatible paths are informational only."
      : "XEKUTE noticed optional starter-template items that can be created or merged. Your assessment remains fully usable.";
  }
  if (assessmentRepairSummary) {
    const parts = [];
    if (createCount) parts.push(`${createCount} to create`);
    if (updateCount) parts.push(`${updateCount} to update`);
    if (blockedCount) parts.push(`${blockedCount} blocked for manual attention`);
    assessmentRepairSummary.textContent = parts.join(" · ") || "No changes required";
  }
  if (assessmentRepairList) {
    assessmentRepairList.innerHTML = missing.length
      ? missing.map((issue) => {
        const details = assessmentRepairIssueDetails(issue);
        return `<div class="assessment-repair-item ${details.tone}" role="listitem">
          <span class="codicon ${details.icon}" aria-hidden="true"></span>
          <span class="assessment-repair-item-path" title="${escapeHtml(issue.path || "")}">${escapeHtml(issue.path || "(unknown item)")}</span>
          <span class="assessment-repair-item-action">${escapeHtml(details.action)}</span>
        </div>`;
      }).join("")
      : `<div class="assessment-repair-empty">The assessment is already complete.</div>`;
  }
  if (assessmentRepairConfirm) {
    assessmentRepairConfirm.disabled = !appState.assessmentPath || !missing.length;
    assessmentRepairConfirm.textContent = blockedCount && !createCount && !updateCount
      ? "Close"
      : "Create missing items";
  }
}

export function closeAssessmentRepairDialog() {
  if (assessmentRepairOverlay) assessmentRepairOverlay.hidden = true;
}

export async function openAssessmentRepairDialog() {
  if (!appState.assessmentPath || bugBountyRepair?.disabled) return;
  let verification = appState.assessmentVerification;
  try {
    verification = await window.api.assessmentVerify({ path: appState.assessmentPath });
  } catch (error) {
    verification = { error: error?.message || "Assessment verification failed." };
  }
  appState.assessmentVerification = verification;
  if (verification?.error) {
    setAssessmentUiState("error", { message: verification.error });
    return;
  }
  if (verification?.valid) {
    await refreshAssessmentState();
    return;
  }
  setAssessmentUiState("incomplete", verification);
  renderAssessmentRepairDialog(verification);
  if (assessmentRepairOverlay) assessmentRepairOverlay.hidden = false;
  assessmentRepairCancel?.focus();
}

export function setAssessmentUiState(state, details = {}) {
  const ready = state === "ready";
  const incomplete = state === "incomplete";
  const repairing = state === "repairing";
  const showAssessmentTree = ready || incomplete || repairing;
  bugBountySetup.hidden = showAssessmentTree;
  bugBountyTree.hidden = !showAssessmentTree;
  bugBountyRepair.hidden = !(incomplete || repairing);
  if (showAssessmentTree) refreshCustomEntries();
  btnCreateAssessment.disabled = state === "checking";
  if (btnCreateProject) btnCreateProject.disabled = state === "checking";
  if (btnCreateProjectHeader) btnCreateProjectHeader.disabled = state === "checking";
  btnOpenAssessment.disabled = state === "checking";
  bugBountyRepair.disabled = state === "repairing";
  const schemaOnly = Number(details.schemaIssueCount) > 0 && Number(details.fileMissingCount) === 0;
  if (incomplete) {
    setNotifications([{
      title: "Assessment needs attention",
      message: schemaOnly ? "Some assessment files differ from the template." : `${details.missingCount || 0} assessment item${details.missingCount === 1 ? " is" : "s are"} missing or incomplete.`,
      action: "assessment-repair",
      actionLabel: "Review and repair",
      icon: "codicon-warning",
      tone: "warning",
    }]);
  } else if (state === "error") {
    setNotifications([{ title: details.title || "Assessment unavailable", message: details.message || "The assessment could not be checked.", icon: "codicon-error", tone: "error" }]);
  } else if (state !== "repairing" && state !== "checking") {
    setNotifications([]);
  }
  bugBountyRepairLabel.textContent = state === "repairing"
    ? "Updating assessment structure..."
    : schemaOnly
      ? "Assessment files differ from the template — click to review"
      : details.missingCount
        ? `${details.missingCount} assessment notice${details.missingCount === 1 ? "" : "s"} — click to review`
        : "Assessment files changed — click to review";

  if (bugBountyTargetLabel) {
    bugBountyTargetLabel.textContent = appState.assessmentPath ? assessmentFolderName().toUpperCase() : "ASSESSMENT";
    bugBountyTargetLabel.title = appState.assessmentPath;
  }

  bugBountyStateIcon.className = "codicon bugbounty-setup-icon";
  if (state === "checking" || state === "repairing") {
    bugBountyStateIcon.classList.add("codicon-loading", "codicon-modifier-spin");
    bugBountyStateTitle.textContent = state === "repairing" ? "Repairing Assessment" : "Checking Assessment";
    bugBountyStateMessage.textContent = details.message || appState.assessmentPath;
    return;
  }
  if (incomplete) {
    bugBountyStateIcon.classList.add("codicon-warning");
    bugBountyStateTitle.textContent = "Assessment Ready with Notices";
    bugBountyStateMessage.textContent = details.message
      || (schemaOnly
        ? `${details.schemaIssueCount} file schema${details.schemaIssueCount === 1 ? " needs" : "s need"} a safe update.`
        : `${details.missingCount || 0} required item${details.missingCount === 1 ? " is" : "s are"} missing or incomplete.`);
    return;
  }
  if (state === "error") {
    bugBountyStateIcon.classList.add("codicon-error");
    bugBountyStateTitle.textContent = details.title || "Assessment Unavailable";
    bugBountyStateMessage.textContent = details.message || "The assessment folder could not be checked.";
    return;
  }
  if (state === "project") {
    bugBountyStateIcon.classList.add("codicon-folder-library");
    bugBountyStateTitle.textContent = details.title || "Project Ready";
    bugBountyStateMessage.textContent = details.message || "The project is active for Search, Terminal, and Chat.";
    if (bugBountyTargetLabel && appState.rootPath) {
      bugBountyTargetLabel.textContent = projectName(appState.rootPath).toUpperCase();
      bugBountyTargetLabel.title = appState.rootPath;
    }
    return;
  }
  bugBountyStateIcon.classList.add("codicon-folder-library");
  bugBountyStateTitle.textContent = "No Assessment";
  bugBountyStateMessage.textContent = details.message || "No assessment folder is linked.";
}

export async function refreshAssessmentState() {
  const sequence = ++appState.assessmentRefreshSequence;
  if (!appState.rootPath) {
    appState.assessmentPath = "";
    appState.browserWorkspace?.projectChanged();
    appState.assessmentVerification = null;
    appState.assessmentSettingsCache = null;
    appState.assessmentSettingsVirtual = false;
    syncInterceptorToggleUi(null);
    setAssessmentUiState("setup", {});
    configureProxyListener();
    return;
  }
  if (sequence !== appState.assessmentRefreshSequence) return;
  appState.assessmentPath = appState.rootPath;
  appState.assessmentVerification = null;
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, appState.assessmentPath);
  setAssessmentUiState("project", {
    title: projectName(appState.rootPath),
    message: "Project folder active. Engagement, scope, ROE, and context are managed in XEKUTE Settings.",
  });
  await refreshAssessmentSettingsCache();
  if (sequence !== appState.assessmentRefreshSequence) return;
  await configureProxyListener();
}

export async function createAssessmentFolder() {
  setAssessmentUiState("checking", { message: "Choose a location and assessment name." });
  let result;
  try {
    result = await window.api.assessmentCreate({ defaultParent: appState.rootPath || undefined });
  } catch (error) {
    result = { error: error?.message || "Could not create the assessment folder." };
  }
  if (result?.canceled) {
    await refreshAssessmentState();
    return;
  }
  if (result?.error) {
    setAssessmentUiState("error", { title: "Creation Failed", message: result.error });
    return;
  }
  appState.assessmentPath = result.path || result.root;
  appState.selectedCustomFolder = "";
  selectedCustomEntries.clear();
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, appState.assessmentPath);
  await loadWorkspace(appState.assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

export async function openAssessmentFolder() {
  let result;
  try {
    result = await window.api.assessmentOpen();
  } catch (error) {
    result = { error: error?.message || "Could not open the assessment folder." };
  }
  if (result?.canceled) return;
  if (result?.error || !result?.path) {
    setAssessmentUiState("error", { message: result?.error || "No assessment folder was selected." });
    return;
  }
  appState.assessmentPath = result.path;
  appState.selectedCustomFolder = "";
  selectedCustomEntries.clear();
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, appState.assessmentPath);
  await loadWorkspace(appState.assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

export async function repairAssessmentFolder() {
  if (!appState.assessmentPath || bugBountyRepair.disabled) return;
  const missing = Array.isArray(appState.assessmentVerification?.missing) ? appState.assessmentVerification.missing : [];
  const hasRepairableItems = missing.some((issue) => ["missing", "missing_fields"].includes(issue.reason));
  if (!hasRepairableItems) {
    closeAssessmentRepairDialog();
    return;
  }
  closeAssessmentRepairDialog();
  setAssessmentUiState("repairing", { message: appState.assessmentPath });
  let result;
  try {
    result = await window.api.assessmentRepair({ path: appState.assessmentPath });
  } catch (error) {
    result = { error: error?.message || "Assessment repair failed." };
  }
  if (result?.error) {
    setAssessmentUiState("incomplete", { ...appState.assessmentVerification, message: result.error });
    return;
  }
  appState.assessmentVerification = result;
  if (!result.valid) {
    const blocked = result.blocked?.length || result.missingCount || 0;
    setAssessmentUiState("incomplete", { ...result, message: `${blocked} item${blocked === 1 ? " needs" : "s need"} manual attention.` });
    return;
  }
  await refreshAssessmentState();
}

export function assessmentDiskPath(relativePath) {
  const root = String(appState.assessmentPath || "").replace(/[/\\]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${String(relativePath || "").replace(/[/\\]+/g, separator)}`;
}
