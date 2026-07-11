/* ── Renderer (runs in the browser context via contextBridge) ── */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Pointer no longer exposes a code editor. These no-op hooks keep legacy file-tool
// result handling isolated while Search and Target render through the read-only viewer.
const EditorManager = Object.freeze({
  clear() {},
  clearChangeDecorations() {},
  disposeModel() {},
  focus() { chatInput?.focus(); },
  getValue() { return ""; },
  layout() {},
  setOnChange() {},
  setOnCursorChange() {},
  setOnSave() {},
  showChangeDecorations() {},
  async showTab() {},
});

const btnNewFile       = $("btn-new-file");
const btnNewFolder     = $("btn-new-folder");
const btnDeleteItem    = $("btn-delete-item");
const explorerTitle    = $("explorer-title");
const explorerRootToggle = $("explorer-root-toggle");
const explorerRootChevron = $("explorer-root-chevron");
const btnOpenFolder    = $("btn-open-folder");
const fileTree         = $("file-tree");
const activityExplorer = $("activity-explorer");
const activitySearch   = $("activity-search");
const activityRun      = $("activity-run");
const activityBugBounty = $("activity-bugbounty");
const activitySecurity = $("activity-security");
const activityTerminal = $("activity-terminal");
const activityChat     = $("activity-chat");
const activitySettings = $("activity-settings");
const btnSidebarMore   = $("btn-sidebar-more");
const btnCreateProjectHeader = $("btn-create-project-header");
const sidebarViewTitle = $("sidebar-view-title");
const explorerSidebarView = $("explorer-sidebar-view");
const bugBountySidebarView = $("bugbounty-sidebar-view");
const bugBountyTree    = $("bugbounty-tree");
const btnBugBountyMore = $("btn-bugbounty-more");
const bugBountyTargetLabel = $("bugbounty-target-label");
const bugBountySetup   = $("bugbounty-setup");
const bugBountyStateIcon = $("bugbounty-state-icon");
const bugBountyStateTitle = $("bugbounty-state-title");
const bugBountyStateMessage = $("bugbounty-state-message");
const btnCreateProject = $("btn-create-project");
const btnCreateAssessment = $("btn-create-assessment");
const btnOpenAssessment = $("btn-open-assessment");
const bugBountyRepair = $("bugbounty-repair");
const bugBountyRepairLabel = $("bugbounty-repair-label");
const editorTabBar     = $("editor-tab-bar");
const editorEmpty      = $("editor-empty");
const editorView       = $("editor-view");
const editorError      = $("editor-error");
const monacoContainer  = $("monaco-container");
const settingsEditorToolbar = $("settings-editor-toolbar");
const settingsUIView  = $("settings-ui-view");
const settingsViewJson = $("settings-view-json");
const settingsViewUi  = $("settings-view-ui");
const proxyListenerStatus = $("proxy-listener-status");
const proxyCaPath = $("proxy-ca-path");
const btnShowProxyCa = $("btn-show-proxy-ca");
const messages         = $("messages");
const chatInput        = $("chat-input");
const chatInputMeasure = $("chat-input-measure");
const sendBtn          = $("send-btn");
const chatModeToggle   = $("chat-mode-toggle");
const chatModeButton   = $("chat-mode-button");
const chatModeIcon     = $("chat-mode-icon");
const chatModeButtonLabel = $("chat-mode-button-label");
const chatModeMenu     = $("chat-mode-menu");
const appMenu          = $("app-menu");
const menuRunCode      = $("menu-run-code");
const commandCenter    = $("command-center");
const quickOverlay     = $("quick-overlay");
const quickPanel       = $("quick-panel");
const quickIcon        = $("quick-icon");
const quickInput       = $("quick-input");
const quickMeta        = $("quick-meta");
const quickResults     = $("quick-results");
const chatHeader       = $("chat-header");
const btnTopTerminal  = $("btn-top-terminal");
const btnTopChat      = $("btn-top-chat");
const btnWindowMinimize = $("btn-window-minimize");
const btnWindowMaximize = $("btn-window-maximize");
const btnWindowClose = $("btn-window-close");
const chatSessionSelect = $("chat-session-select");
const btnChatNew      = $("btn-chat-new");
const btnChatDelete   = $("btn-chat-delete");
const btnChatHistory  = $("btn-chat-history");
const btnChatMore     = $("btn-chat-more");
const btnChatCollapse = $("btn-chat-collapse");
const contextUsageBtn  = $("context-usage-btn");
const contextRingFill  = $("context-ring-fill");
const contextUsagePopover = $("context-usage-popover");
const inputBar         = $("input-bar");
const composerEl       = inputBar?.querySelector(".composer") || null;
const contextUsageFill = $("context-usage-fill");
const contextUsageUsed = $("context-usage-used");
const contextUsageFree = $("context-usage-free");
const contextUsagePct  = $("context-usage-pct");
const contextUsageBreakdown = $("context-usage-breakdown");
const contextUsageSource = $("context-usage-source");
const contextUsageClose = $("context-usage-close");
const contextUsageSegments = $("context-usage-segments");
const contextCompactBtn = $("context-compact-btn");
const contextMemoryNote = $("context-memory-note");
const contextMemoryText = $("context-memory-text");
const modelPicker      = $("model-picker");
const modelLabel       = $("model-label");
const modelMenu        = $("model-menu");
const modelSearch      = $("model-search");
const modelList        = $("model-list");
const modelAddBtn      = $("model-add-btn");
const modelAddForm     = $("model-add-form");
const modelCustom      = $("model-custom");
const modelCustomAdd   = $("model-custom-add");
const modelEditMenu    = $("model-edit-menu");
const modelRuntimeNote = $("model-runtime-note");
const thinkingToggle   = $("thinking-toggle");
const contextOptions   = $("context-options");
const sidebar          = $("sidebar");
const sidebarResize    = $("sidebar-resize");
const chatPane         = $("chat-pane");
const chatResize       = $("chat-resize");
const terminalPane     = $("terminal-pane");
const terminalResize   = $("terminal-resize");
const centerPanel      = $("center-panel");
const btnTerminalMaximize = $("btn-terminal-maximize");
const btnTerminalClose = $("btn-terminal-close");
const editorPane       = $("editor-pane");
const resourceViewer = $("resource-viewer");
const resourceViewerTitle = $("resource-viewer-title");
const resourceViewerMeta = $("resource-viewer-meta");
const resourceViewerIcon = $("resource-viewer-icon");
const resourceViewerEmpty = $("resource-viewer-empty");
const resourceViewerContent = $("resource-viewer-content");
const resourceViewerSave = $("resource-viewer-save");
const resourceViewerCopy = $("resource-viewer-copy");
const resourceViewerActions = $("resource-viewer-actions");
const securityWorkspace = $("security-workspace");
const securityWorkspaceTools = $("security-workspace-tools");
const securityWorkspaceBody = $("security-workspace-body");
const settingsViewSwitch = settingsViewJson?.closest(".settings-view-switch") || null;
if (resourceViewer && settingsUIView) resourceViewer.appendChild(settingsUIView);
if (resourceViewerActions && settingsViewSwitch) resourceViewerActions.prepend(settingsViewSwitch);
if (settingsViewSwitch) settingsViewSwitch.hidden = true;
if (settingsUIView) settingsUIView.hidden = true;
const securityToolSwitcher = $("security-tool-switcher");
const securityToolButton = $("security-tool-button");
const securityToolMenu = $("security-tool-menu");
const securityToolIcon = $("security-tool-icon");
const securityToolLabel = $("security-tool-label");
const securityAnalyzeButton = $("security-analyze-button");
const securityWorkbench = $("security-workbench");
const securityWorkbenchMode = $("security-workbench-mode");
const securityWorkbenchStatus = $("security-workbench-status");
const securityHistoryToggle = $("security-history-toggle");
const securityHistoryPanel = $("security-history-panel");
const securityHistoryRefresh = $("security-history-refresh");
const securityHistorySummary = $("security-history-summary");
const securityHistoryRows = $("security-history-rows");
const securityHistoryEmpty = $("security-history-empty");
const securityIntruderControls = $("security-intruder-controls");
const securityAttackType = $("security-attack-type");
const securityClearButton = $("security-clear-button");
const securityDropButton = $("security-drop-button");
const securityInterceptToggle = $("security-intercept-toggle");
const securityInterceptToggleIcon = $("security-intercept-toggle-icon");
const securityInterceptToggleLabel = $("security-intercept-toggle-label");
const securityRunButton = $("security-run-button");
const securityRunLabel = $("security-run-label");
const securityRequestEditor = $("security-request-editor");
const securityResponseEditor = $("security-response-editor");
const securityRequestSize = $("security-request-size");
const securityResponseSize = $("security-response-size");
const securityPayloadPanel = $("security-payload-panel");
const securityPayloadEditor = $("security-payload-editor");
const terminalShellTab = $("terminal-shell-tab");
if (securityWorkspaceTools && securityToolSwitcher) securityWorkspaceTools.appendChild(securityToolSwitcher);
if (securityWorkspaceBody && securityWorkbench) securityWorkspaceBody.appendChild(securityWorkbench);
if (securityToolSwitcher) securityToolSwitcher.hidden = false;
if (securityWorkbench) securityWorkbench.hidden = false;

const securityExchangeEl   = $("security-exchange");
const securityExchangeSash = $("security-exchange-sash");

const TERMINAL_HEADER_H = 35;
const TERMINAL_MIN_EXPANDED = 80;
const EDITOR_MIN_HEIGHT = 120;
let terminalSavedHeight = 220;
let terminalCollapsed = false;
let terminalMaximized = false;
let chatCollapsed = false;
let sidebarCollapsed = false;
let explorerRootExpanded = true;
let currentSidebarView = "bugbounty";
let currentWorkspaceMode = "resource";
let resourcePreviewText = "";
let resourceCurrentFilePath = "";
let resourceSavedText = "";
let resourceDirty = false;
let resourceSettingsActive = false;
let resourceSettingsData = null;
let resourceSettingsSaveTimer = null;
let resourceSettingsSaveChain = Promise.resolve();
const statusLnCol      = $("status-ln-col");
const statusOllamaPort = $("status-ollama-port");
const statusWorkspace  = $("status-workspace");
const statusAgent      = $("status-agent");

const OLLAMA_PORT = 11434;

// ── State ─────────────────────────────────────────────────────────────────────
let rootPath     = null;
let dirMapCache  = "";
let selectedItem = null;
const expandedTreePaths = new Set();
let chatHistory  = [];
let streaming    = false;
let stopRequested = false;
let activeStreamContent = "";
let contextFilesCache = [];
let chatSessionCounter = 0;
let activeChatSessionId = "";
const chatSessions = [];
let contextCompacting = false;
let contextCompactionPromise = null;

const CONTEXT_RING_R = 8;
const CONTEXT_RING_C = 2 * Math.PI * CONTEXT_RING_R;
const CONTEXT_SUMMARY_THRESHOLD = 0.68;
const CONTEXT_COMPACT_KEEP_MESSAGES = 8;
const CONTEXT_COMPACT_MIN_MESSAGES = 10;
const AUTO_CONTEXT = "Auto";
const AUTO_CONTEXT_ESTIMATE = 4096;
const LEGACY_DEFAULT_CONTEXT = "8K";

/** @type {Map<string, { path: string, diskPath: string, name: string, content: string | null, savedContent: string, dirty: boolean, error: string | null }>} */
const openTabs      = new Map();
let activeTabPath   = null;
let editorLoadedPath = null;
let quickMode = "command";
let quickSelection = 0;
let quickItems = [];
let quickSearchSeq = 0;
let quickSearchTimer = null;

const CONTEXT_OPTIONS = [AUTO_CONTEXT, "4K", "8K", "16K", "32K", "64K", "128K", "256K"];
const MODEL_SETTINGS_KEY = "pointer:modelSettings";
const WORKSPACE_KEY = "pointer:workspace";
const RUN_COMMAND_KEY = "pointer:runCommands";
const CHAT_MODE_KEY = "pointer:chatMode";
const SIDEBAR_VIEW_KEY = "pointer:sidebarView";
const BUG_BOUNTY_EXPANSION_KEY = "pointer:bugBountyExpansion";
const BUG_BOUNTY_SELECTED_KEY = "pointer:bugBountySelected";
const BUG_BOUNTY_PATH_KEY = "pointer:bugBountyPath";
const SECURITY_TOOL_KEY = "pointer:securityTool";
const SETTINGS_EDITOR_MODE_KEY = "pointer:settingsEditorMode";
const CHAT_MODES = new Set(["ask", "plan", "agent"]);
const READ_ONLY_TOOL_NAMES = new Set([
  "find_files",
  "list_files",
  "inspect_workspace",
  "read_file",
  "read_files",
  "search_code",
  "get_file_outline",
  "search_web",
  "fetch_url",
]);
const AGENT_TOOL_NAMES = new Set([
  ...READ_ONLY_TOOL_NAMES,
  "create_file",
  "patch_file",
  "delete_file",
  "run_command",
  "start_process",
  "read_process",
  "stop_process",
]);

let selectedModel = localStorage.getItem("pointer:model") || "";
let allModels     = [];
let editingModel  = null;
let modelLoadSeq  = 0;
let modelLoadInFlight = null;
let chatMode = CHAT_MODES.has(localStorage.getItem(CHAT_MODE_KEY))
  ? localStorage.getItem(CHAT_MODE_KEY)
  : "agent";
let assessmentPath = localStorage.getItem(BUG_BOUNTY_PATH_KEY) || "";
let assessmentRefreshSequence = 0;
let assessmentVerification = null;
let selectedSecurityTool = "interceptor";
let securityHistoryRecords = [];
let selectedSecurityHistoryIndex = -1;
let securityHistoryLoading = false;
let securityBusy = false;
let lastLoggedSecuritySignature = "";
const securityDrafts = new Map();
let settingsEditorMode = localStorage.getItem(SETTINGS_EDITOR_MODE_KEY) === "ui" ? "ui" : "json";
let settingsAutoSaveTimer = null;
let currentProxyCaptureId = "";
let proxyListenerState = { running: false };
let assessmentSettingsCache = null;

function createChatSession(title = "New Agent") {
  const id = `chat-${Date.now()}-${++chatSessionCounter}`;
  return {
    id,
    title,
    history: [],
    contextFilesCache: [],
    contextSummary: "",
    contextSummaryMeta: null,
    messagesHtml: "",
    activeStreamContent: "",
  };
}

function buildSummaryContextMessage(summary) {
  const clean = String(summary || "").trim();
  if (!clean) return "";
  return [
    "Structured working memory from earlier turns:",
    clean,
    "Use this for durable goals, constraints, decisions, and progress only. Current files and recent messages win conflicts.",
  ].join("\n");
}

function buildProjectContextMessage({
  dirMap = "",
  activeFile = null,
  extraFiles = [],
  contextBudget = AUTO_CONTEXT_ESTIMATE,
} = {}) {
  const parts = [];
  const fileLimit = contextBudget <= 4096 ? 32 : contextBudget <= 8192 ? 56 : contextBudget <= 16384 ? 100 : 180;
  const embeddedLimit = contextBudget <= 4096 ? 4200 : contextBudget <= 8192 ? 8000 : contextBudget <= 16384 ? 16000 : 28000;

  if (dirMap) {
    const files = ToolParser.parseProjectFiles(dirMap);
    if (files.length) {
      const shown = files.slice(0, fileLimit);
      const omitted = files.length > shown.length ? `\n- ... ${files.length - shown.length} more files omitted` : "";
      parts.push(`Project files:\n${shown.map((file) => `- ${file}`).join("\n")}${omitted}`);
    }
  }

  const shown = new Set();
  let remainingChars = embeddedLimit;
  for (const file of [activeFile, ...extraFiles]) {
    if (!file?.path || file.content == null) continue;
    const norm = file.path.replace(/\\/g, "/");
    if (shown.has(norm)) continue;
    if (remainingChars < 600) break;
    shown.add(norm);
    const allowance = Math.min(remainingChars, contextBudget <= 4096 ? 3200 : 6000);
    const content = String(file.content);
    const snippet = content.length > allowance
      ? `${content.slice(0, Math.floor(allowance * 0.7))}\n...(truncated)...\n${content.slice(-Math.ceil(allowance * 0.3))}`
      : content;
    remainingChars -= snippet.length;
    const label = file === activeFile ? "Currently open" : "File contents";
    parts.push(`${label} - ${file.path}:\n\`\`\`\n${snippet}\n\`\`\``);
  }

  return parts.join("\n\n");
}

function clearChatSessionState(session) {
  if (!session) return;
  session.history = [];
  session.contextFilesCache = [];
  session.contextSummary = "";
  session.contextSummaryMeta = null;
  session.messagesHtml = "";
  session.activeStreamContent = "";
}

function activeChatSession() {
  return chatSessions.find((session) => session.id === activeChatSessionId) || null;
}

function setChatCollapsed(collapsed) {
  chatCollapsed = collapsed;
  chatPane?.classList.toggle("collapsed", collapsed);
  chatResize?.classList.toggle("collapsed", collapsed);
  btnTopChat?.classList.toggle("active", !collapsed);
  btnTopChat?.classList.toggle("inactive", collapsed);
  activityChat?.classList.toggle("panel-visible", !collapsed);
  activityChat?.setAttribute("aria-pressed", String(!collapsed));
  if (!collapsed) {
    requestAnimationFrame(() => {
      resizeChatInput();
      chatInput?.focus();
    });
  }
}

function ensureChatSession() {
  if (activeChatSession()) return activeChatSession();
  const session = createChatSession("New Agent");
  clearChatSessionState(session);
  chatSessions.push(session);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = "";
  messages.innerHTML = "";
  return session;
}

function openChatPane({ createIfEmpty = true } = {}) {
  if (createIfEmpty) ensureChatSession();
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
}

function syncWorkspaceActivity() {
  const securityActive = currentWorkspaceMode === "security";
  activitySecurity?.classList.toggle("active", securityActive);
  activitySecurity?.setAttribute("aria-pressed", String(securityActive));
  syncSidebarActivity();
}

function showResourceWorkspace({ focus = false } = {}) {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "resource";
  if (resourceViewer) resourceViewer.hidden = false;
  if (securityWorkspace) securityWorkspace.hidden = true;
  editorPane?.setAttribute("aria-label", "Workspace editor");
  syncWorkspaceActivity();
  if (focus && !resourceViewerContent?.hidden) requestAnimationFrame(() => resourceViewerContent.focus());
}

function showSecurityWorkspace(tool = "") {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "security";
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = false;
  editorPane?.setAttribute("aria-label", "Security workspace");
  const saved = tool || localStorage.getItem(SECURITY_TOOL_KEY) || "interceptor";
  setSecurityTool(saved, { persist: Boolean(tool) });
  syncWorkspaceActivity();
  refreshSecurityHistoryIfVisible();
  requestAnimationFrame(() => securityRequestEditor?.focus());
}

function modeLabel(mode = chatMode) {
  if (mode === "ask") return "Ask";
  if (mode === "plan") return "Plan";
  return "Agent";
}

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = Boolean(collapsed);
  sidebar?.classList.toggle("collapsed", sidebarCollapsed);
  sidebarResize?.classList.toggle("collapsed", sidebarCollapsed);
  syncSidebarActivity();
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

function syncSidebarActivity() {
  const explorerActive = !sidebarCollapsed && currentSidebarView === "explorer";
  const bugBountyActive = !sidebarCollapsed
    && currentSidebarView === "bugbounty"
    && currentWorkspaceMode !== "security";
  activityExplorer?.classList.toggle("active", explorerActive);
  activityExplorer?.setAttribute("aria-pressed", String(explorerActive));
  activityBugBounty?.classList.toggle("active", bugBountyActive);
  activityBugBounty?.setAttribute("aria-pressed", String(bugBountyActive));
}

function setSidebarView(view, { persist = true } = {}) {
  const next = "bugbounty";
  currentSidebarView = next;
  const bugBountyActive = true;
  if (explorerSidebarView) explorerSidebarView.hidden = true;
  if (bugBountySidebarView) bugBountySidebarView.hidden = false;
  if (sidebarViewTitle) sidebarViewTitle.textContent = "Target";
  if (btnSidebarMore) {
    btnSidebarMore.title = "Target Actions";
    btnSidebarMore.setAttribute("aria-label", btnSidebarMore.title);
  }
  if (persist) localStorage.setItem(SIDEBAR_VIEW_KEY, next);
  syncSidebarActivity();
  syncSecurityToolsVisibility(bugBountyActive);
  if (bugBountyActive) refreshAssessmentState();
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

function activateSidebarView(view) {
  if (!sidebarCollapsed && currentSidebarView === view) {
    setSidebarCollapsed(true);
    return;
  }
  setSidebarView(view);
  if (sidebarCollapsed) setSidebarCollapsed(false);
}

function persistBugBountyExpansion() {
  const expanded = [...bugBountyTree.querySelectorAll(".bounty-phase.expanded")]
    .map((phase) => phase.dataset.bountySection)
    .filter(Boolean);
  localStorage.setItem(BUG_BOUNTY_EXPANSION_KEY, JSON.stringify(expanded));
}

function setBugBountyPhaseExpanded(phase, expanded, { persist = true } = {}) {
  if (!phase) return;
  phase.classList.toggle("expanded", Boolean(expanded));
  phase.querySelector(".bounty-phase-toggle")?.setAttribute("aria-expanded", String(Boolean(expanded)));
  const chevron = phase.querySelector(".bounty-chevron");
  chevron?.classList.toggle("codicon-chevron-down", Boolean(expanded));
  chevron?.classList.toggle("codicon-chevron-right", !expanded);
  if (persist) persistBugBountyExpansion();
}

function restoreBugBountyTreeState() {
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
  const item = bugBountyTree?.querySelector(`[data-bounty-item="${CSS.escape(selected)}"]`);
  item?.classList.add("selected");
  item?.setAttribute("aria-selected", "true");
}

function assessmentFolderName(folder = assessmentPath) {
  return String(folder || "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "ASSESSMENT";
}

function setAssessmentUiState(state, details = {}) {
  const ready = state === "ready";
  const incomplete = state === "incomplete";
  bugBountySetup.hidden = ready;
  bugBountyTree.hidden = !ready;
  bugBountyRepair.hidden = !incomplete;
  btnCreateAssessment.disabled = state === "checking";
  if (btnCreateProject) btnCreateProject.disabled = state === "checking";
  if (btnCreateProjectHeader) btnCreateProjectHeader.disabled = state === "checking";
  btnOpenAssessment.disabled = state === "checking";
  bugBountyRepair.disabled = state === "repairing";
  const schemaOnly = Number(details.schemaIssueCount) > 0 && Number(details.fileMissingCount) === 0;
  bugBountyRepairLabel.textContent = state === "repairing"
    ? "Updating assessment structure..."
    : schemaOnly
      ? "Assessment schema is outdated, click here to update"
      : "Some files are missing, click here to fix";

  if (bugBountyTargetLabel) {
    bugBountyTargetLabel.textContent = assessmentPath ? assessmentFolderName().toUpperCase() : "ASSESSMENT";
    bugBountyTargetLabel.title = assessmentPath;
  }

  bugBountyStateIcon.className = "codicon bugbounty-setup-icon";
  if (state === "checking" || state === "repairing") {
    bugBountyStateIcon.classList.add("codicon-loading", "codicon-modifier-spin");
    bugBountyStateTitle.textContent = state === "repairing" ? "Repairing Assessment" : "Checking Assessment";
    bugBountyStateMessage.textContent = details.message || assessmentPath;
    return;
  }
  if (incomplete) {
    bugBountyStateIcon.classList.add("codicon-warning");
    bugBountyStateTitle.textContent = "Assessment Incomplete";
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
    if (bugBountyTargetLabel && rootPath) {
      bugBountyTargetLabel.textContent = projectName(rootPath).toUpperCase();
      bugBountyTargetLabel.title = rootPath;
    }
    return;
  }
  bugBountyStateIcon.classList.add("codicon-folder-library");
  bugBountyStateTitle.textContent = "No Assessment";
  bugBountyStateMessage.textContent = details.message || "No assessment folder is linked.";
}

async function refreshAssessmentState() {
  const sequence = ++assessmentRefreshSequence;
  if (!assessmentPath) {
    assessmentVerification = null;
    assessmentSettingsCache = null;
    syncInterceptorToggleUi(null);
    setAssessmentUiState(rootPath ? "project" : "setup", rootPath ? {
      title: projectName(rootPath),
      message: "Project active for Search, Terminal, and Chat. Create an assessment whenever you need Target tooling.",
    } : {});
    configureProxyListener();
    return;
  }

  setAssessmentUiState("checking");
  let result;
  try {
    result = await window.api.assessmentVerify({ path: assessmentPath });
  } catch (error) {
    result = { error: error?.message || "Assessment verification failed." };
  }
  if (sequence !== assessmentRefreshSequence) return;
  assessmentVerification = result;

  if (result?.error) {
    if (result.code === "NOT_FOUND" || result.code === "NOT_DIRECTORY") {
      assessmentPath = "";
      localStorage.removeItem(BUG_BOUNTY_PATH_KEY);
    }
    setAssessmentUiState("error", { message: result.error });
    return;
  }
  if (!result?.valid) {
    setAssessmentUiState("incomplete", result);
    return;
  }
  setAssessmentUiState("ready");
  await refreshAssessmentSettingsCache();
  await configureProxyListener();
}

async function createAssessmentFolder() {
  setAssessmentUiState("checking", { message: "Choose a location and assessment name." });
  let result;
  try {
    result = await window.api.assessmentCreate({ defaultParent: rootPath || undefined });
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
  assessmentPath = result.path || result.root;
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, assessmentPath);
  await loadWorkspace(assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

async function createProject() {
  setAssessmentUiState("checking", { message: "Choose a name and location for the new project." });
  let result;
  try {
    result = await window.api.createProject({ defaultParent: rootPath || undefined });
  } catch (error) {
    result = { error: error?.message || "Could not create the project." };
  }
  if (result?.canceled) {
    await refreshAssessmentState();
    return;
  }
  if (result?.error || !result?.path) {
    setAssessmentUiState("error", { title: "Project Creation Failed", message: result?.error || "No project folder was created." });
    return;
  }

  assessmentPath = "";
  assessmentVerification = null;
  assessmentSettingsCache = null;
  localStorage.removeItem(BUG_BOUNTY_PATH_KEY);
  await loadWorkspace(result.path);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
  if (resourceViewerTitle) resourceViewerTitle.textContent = projectName(result.path);
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Project workspace";
  resourcePreviewText = "";
  resourceCurrentFilePath = "";
  resourceSavedText = "";
  resourceSettingsActive = false;
  resourceSettingsData = null;
  if (settingsViewSwitch) settingsViewSwitch.hidden = true;
  if (settingsUIView) settingsUIView.hidden = true;
  if (resourceViewerContent) {
    resourceViewerContent.value = "";
    resourceViewerContent.hidden = true;
  }
  setResourceDirty(false);
  if (resourceViewerEmpty) resourceViewerEmpty.hidden = false;
  if (resourceViewerCopy) resourceViewerCopy.disabled = true;
  showResourceWorkspace();
}

async function openAssessmentFolder() {
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
  assessmentPath = result.path;
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, assessmentPath);
  await loadWorkspace(assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

async function repairAssessmentFolder() {
  if (!assessmentPath || bugBountyRepair.disabled) return;
  setAssessmentUiState("repairing", { message: assessmentPath });
  let result;
  try {
    result = await window.api.assessmentRepair({ path: assessmentPath });
  } catch (error) {
    result = { error: error?.message || "Assessment repair failed." };
  }
  if (result?.error) {
    setAssessmentUiState("incomplete", { ...assessmentVerification, message: result.error });
    return;
  }
  assessmentVerification = result;
  if (!result.valid) {
    const blocked = result.blocked?.length || result.missingCount || 0;
    setAssessmentUiState("incomplete", { ...result, message: `${blocked} item${blocked === 1 ? " needs" : "s need"} manual attention.` });
    return;
  }
  await refreshAssessmentState();
}

function assessmentDiskPath(relativePath) {
  const root = String(assessmentPath || "").replace(/[/\\]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${String(relativePath || "").replace(/[/\\]+/g, separator)}`;
}

function setResourceDirty(dirty) {
  resourceDirty = Boolean(dirty && resourceCurrentFilePath);
  resourceViewerTitle?.classList.toggle("dirty", resourceDirty);
  if (resourceViewerSave) resourceViewerSave.disabled = !resourceDirty;
}

function syncResourceCursorPosition() {
  if (!statusLnCol || !resourceViewerContent || resourceViewerContent.hidden) return;
  const start = resourceViewerContent.selectionStart || 0;
  const before = resourceViewerContent.value.slice(0, start);
  const lines = before.split("\n");
  statusLnCol.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

async function saveResourceChanges() {
  if (!resourceCurrentFilePath || !resourceDirty) return { ok: true };
  const text = resourceViewerContent.value;

  if (resourceSettingsActive) {
    clearTimeout(resourceSettingsSaveTimer);
    let settings;
    try {
      settings = JSON.parse(text);
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Expected a JSON object");
    } catch (error) {
      resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`;
      resourceViewerContent.focus();
      return { error: error.message };
    }
    const result = await saveAssessmentSettings(settings);
    if (result?.error) {
      resourceViewerMeta.textContent = `Save failed: ${result.error}`;
      return result;
    }
    resourceSettingsData = JSON.parse(JSON.stringify(result.settings || settings));
    resourcePreviewText = `${JSON.stringify(resourceSettingsData, null, 2)}\n`;
    resourceViewerContent.value = resourcePreviewText;
    populateResourceSettingsForm(resourceSettingsData);
    resourceViewerMeta.textContent = "Target / settings.config · Saved";
  } else {
    const result = await window.api.writeFile(resourceCurrentFilePath, text);
    if (result?.error) {
      resourceViewerMeta.textContent = `Save failed: ${result.error}`;
      return result;
    }
    resourcePreviewText = text;
    resourceViewerMeta.textContent = `${relativePathFromRoot(resourceCurrentFilePath) || resourceCurrentFilePath} · Saved`;
    await refreshDirMap();
  }

  resourceSavedText = resourceViewerContent.value;
  setResourceDirty(false);
  syncResourceCursorPosition();
  return { ok: true };
}

function populateResourceSettingsForm(settings) {
  if (!settingsUIView || !settings || typeof settings !== "object") return;
  settingsUIView.querySelectorAll("[data-setting-path]").forEach((input) => {
    const value = nestedSettingValue(settings, input.dataset.settingPath);
    if (input.dataset.settingType === "boolean") input.checked = Boolean(value);
    else input.value = value == null ? "" : String(value);
  });
}

function setResourceSettingsMode(mode) {
  if (!resourceSettingsActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try {
      const parsed = JSON.parse(resourceViewerContent.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
      resourceSettingsData = parsed;
    } catch (error) {
      resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`;
      resourceViewerContent.hidden = false;
      settingsUIView.hidden = true;
      return;
    }
  }
  settingsEditorMode = nextMode;
  localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, settingsEditorMode);
  syncSettingsEditorButtons();
  const uiActive = settingsEditorMode === "ui";
  resourceViewerContent.hidden = uiActive;
  settingsUIView.hidden = !uiActive;
  if (uiActive) populateResourceSettingsForm(resourceSettingsData);
}

function scheduleResourceSettingsSaveLegacy() {
  clearTimeout(resourceSettingsSaveTimer);
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Target / settings.config · Saving...";
  resourceSettingsSaveTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(resourceSettingsData || {}));
    resourceSettingsSaveChain = resourceSettingsSaveChain.then(async () => {
      const result = await saveAssessmentSettings(snapshot);
      if (result?.error) {
        if (resourceViewerMeta) resourceViewerMeta.textContent = `Save failed: ${result.error}`;
        return;
      }
      if (resourceViewerMeta) resourceViewerMeta.textContent = "Target / settings.config · Saved";
    });
  }, 400);
}

function scheduleResourceSettingsSave() {
  clearTimeout(resourceSettingsSaveTimer);
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Target / settings.config · Saving...";
  resourceSettingsSaveTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(resourceSettingsData || {}));
    resourceSettingsSaveChain = resourceSettingsSaveChain.then(async () => {
      const result = await saveAssessmentSettings(snapshot);
      if (result?.error) {
        if (resourceViewerMeta) resourceViewerMeta.textContent = `Save failed: ${result.error}`;
        return;
      }
      const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
      const currentText = `${JSON.stringify(resourceSettingsData || {}, null, 2)}\n`;
      if (currentText === snapshotText) {
        resourceSavedText = currentText;
        setResourceDirty(false);
      }
      if (resourceViewerMeta) resourceViewerMeta.textContent = "Target / settings.config · Saved";
    });
  }, 400);
}

function updateResourceSettingFromInput(input) {
  if (!resourceSettingsActive || !resourceSettingsData) return;
  let value = input.value;
  if (input.dataset.settingType === "boolean") value = input.checked;
  if (input.dataset.settingType === "number") {
    const number = Number(input.value);
    value = Number.isFinite(number) ? number : null;
  }
  setNestedSettingValue(resourceSettingsData, input.dataset.settingPath, value);
  assessmentSettingsCache = resourceSettingsData;
  syncInterceptorToggleUi(resourceSettingsData);
  resourcePreviewText = `${JSON.stringify(resourceSettingsData, null, 2)}\n`;
  resourceViewerContent.value = resourcePreviewText;
  setResourceDirty(resourcePreviewText !== resourceSavedText);
  scheduleResourceSettingsSave();
}

async function showSettingsResource(filePath) {
  if (resourceDirty && resourceCurrentFilePath === filePath) {
    resourceViewerContent.focus();
    return;
  }
  if (resourceDirty && resourceCurrentFilePath && resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  const result = await window.api.assessmentSettings({ path: assessmentPath });
  if (result?.error || !result?.settings) {
    await showResourcePreview(filePath, "settings.config", "Target / settings.config", { icon: "codicon-settings-gear" });
    return;
  }

  resourceSettingsActive = true;
  resourceSettingsData = JSON.parse(JSON.stringify(result.settings));
  assessmentSettingsCache = resourceSettingsData;
  resourcePreviewText = `${JSON.stringify(resourceSettingsData, null, 2)}\n`;
  resourceCurrentFilePath = filePath;
  resourceSavedText = resourcePreviewText;
  resourceViewerTitle.textContent = "settings.config";
  resourceViewerMeta.textContent = "Target / settings.config";
  resourceViewerMeta.title = filePath;
  resourceViewerIcon.className = "codicon codicon-settings-gear";
  resourceViewerEmpty.hidden = true;
  resourceViewerContent.classList.remove("error");
  resourceViewerContent.value = resourcePreviewText;
  resourceViewerContent.readOnly = false;
  resourceViewerCopy.disabled = false;
  setResourceDirty(false);
  settingsViewSwitch.hidden = false;
  populateResourceSettingsForm(resourceSettingsData);
  setResourceSettingsMode(settingsEditorMode);
  if (settingsEditorMode === "json") {
    resourceViewerContent.focus();
    syncResourceCursorPosition();
  }
}

async function showResourcePreview(filePath, title, meta = "", { icon = "codicon-file-text", line = 1 } = {}) {
  if (!filePath || !resourceViewerContent) return;
  if (resourceDirty && resourceCurrentFilePath === filePath) {
    resourceViewerContent.focus();
    return;
  }
  if (resourceDirty && resourceCurrentFilePath && resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  resourceSettingsActive = false;
  resourceSettingsData = null;
  if (settingsViewSwitch) settingsViewSwitch.hidden = true;
  if (settingsUIView) settingsUIView.hidden = true;
  const result = await window.api.readFile(filePath);
  resourceViewerTitle.textContent = title || basenameOf(filePath) || "Resource";
  resourceViewerMeta.textContent = meta || filePath;
  resourceViewerMeta.title = filePath;
  resourceViewerIcon.className = `codicon ${icon}`;
  resourceViewerEmpty.hidden = true;
  resourceViewerContent.hidden = false;

  if (result?.error || result?.content == null) {
    resourcePreviewText = `Unable to preview this resource.\n\n${result?.error || "No readable content was returned."}`;
    resourceViewerContent.classList.add("error");
    resourceCurrentFilePath = "";
    resourceSavedText = "";
    resourceViewerContent.readOnly = true;
    resourceViewerCopy.disabled = true;
  } else {
    const raw = String(result.content);
    const limit = 300000;
    resourcePreviewText = raw.length > limit
      ? `${raw.slice(0, limit)}\n\n--- Preview truncated at ${limit.toLocaleString()} characters ---`
      : raw;
    resourceViewerContent.classList.remove("error");
    resourceCurrentFilePath = raw.length > limit ? "" : filePath;
    resourceSavedText = resourcePreviewText;
    resourceViewerContent.readOnly = raw.length > limit;
    resourceViewerCopy.disabled = false;
  }

  resourceViewerContent.value = resourcePreviewText;
  setResourceDirty(false);
  requestAnimationFrame(() => {
    const lineHeight = Number.parseFloat(getComputedStyle(resourceViewerContent).lineHeight) || 19;
    resourceViewerContent.scrollTop = Math.max(0, (Number(line) - 3) * lineHeight);
    resourceViewerContent.focus();
    syncResourceCursorPosition();
  });
}

resourceViewerCopy?.addEventListener("click", async () => {
  const text = resourceViewerContent?.value || resourcePreviewText;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  resourceViewerCopy.title = "Copied";
  setTimeout(() => { resourceViewerCopy.title = "Copy resource contents"; }, 1200);
});

resourceViewerSave?.addEventListener("click", saveResourceChanges);
resourceViewerContent?.addEventListener("input", () => {
  resourcePreviewText = resourceViewerContent.value;
  setResourceDirty(resourcePreviewText !== resourceSavedText);
  syncResourceCursorPosition();
});
resourceViewerContent?.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || resourceViewerContent.readOnly) return;
  event.preventDefault();
  const start = resourceViewerContent.selectionStart;
  const end = resourceViewerContent.selectionEnd;
  resourceViewerContent.setRangeText("  ", start, end, "end");
  resourceViewerContent.dispatchEvent(new Event("input", { bubbles: true }));
});
resourceViewerContent?.addEventListener("click", syncResourceCursorPosition);
resourceViewerContent?.addEventListener("keyup", syncResourceCursorPosition);
resourceViewerContent?.addEventListener("select", syncResourceCursorPosition);

async function openAssessmentItem(item) {
  const relativePath = item?.dataset?.bountyFile;
  if (!assessmentPath || !relativePath) return;

  let verification;
  try {
    verification = await window.api.assessmentVerify({ path: assessmentPath });
  } catch (error) {
    verification = { error: error?.message || "Assessment verification failed." };
  }
  assessmentVerification = verification;
  if (verification?.error) {
    setAssessmentUiState("error", { message: verification.error });
    return;
  }
  if (!verification?.valid) {
    setAssessmentUiState("incomplete", verification);
    return;
  }

  const diskPath = assessmentDiskPath(relativePath);
  const fileName = relativePath.split("/").pop();
  if (relativePath === "settings.config") {
    await showSettingsResource(diskPath);
    return;
  }
  await showResourcePreview(diskPath, fileName, `Target / ${relativePath}`, {
    icon: relativePath.endsWith(".json") ? "codicon-json" : "codicon-file-text",
  });
}

const SECURITY_TOOL_META = {
  interceptor: { label: "Interceptor", icon: "codicon-debug-disconnect", action: "Forward" },
  repeater: { label: "Repeater", icon: "codicon-sync", action: "Send" },
  intruder: { label: "Intruder", icon: "codicon-symbol-event", action: "Start" },
};

function securityExchangeSignature() {
  return `${securityRequestEditor?.value || ""}\u0000${securityResponseEditor?.value || ""}`;
}

function securityByteLabel(value) {
  const bytes = new TextEncoder().encode(String(value || "")).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function syncSecurityExchangeSizes() {
  if (securityRequestSize) securityRequestSize.textContent = securityByteLabel(securityRequestEditor?.value);
  if (securityResponseSize) securityResponseSize.textContent = securityByteLabel(securityResponseEditor?.value);
}

function setSecurityStatus(message, tone = "") {
  if (!securityWorkbenchStatus) return;
  securityWorkbenchStatus.textContent = message || "Ready";
  securityWorkbenchStatus.classList.toggle("error", tone === "error");
  securityWorkbenchStatus.classList.toggle("success", tone === "success");
}

function saveSecurityDraft() {
  securityDrafts.set(selectedSecurityTool, {
    request: securityRequestEditor?.value || "",
    response: securityResponseEditor?.value || "",
    payloads: securityPayloadEditor?.value || "",
    attackType: securityAttackType?.value || "sniper",
  });
}

function closeSecurityToolMenu() {
  if (!securityToolMenu || !securityToolButton) return;
  securityToolMenu.hidden = true;
  securityToolButton.setAttribute("aria-expanded", "false");
  const chevron = securityToolButton.querySelector(".security-tool-chevron");
  chevron?.classList.remove("codicon-chevron-up");
  chevron?.classList.add("codicon-chevron-down");
}

function setSecurityTool(tool, { persist = true } = {}) {
  const next = SECURITY_TOOL_META[tool] ? tool : "interceptor";
  saveSecurityDraft();
  selectedSecurityTool = next;
  const meta = SECURITY_TOOL_META[next];

  securityToolLabel.textContent = meta.label;
  securityToolIcon.className = `codicon ${meta.icon}`;
  securityAnalyzeButton.hidden = false;
  securityWorkbenchMode.textContent = meta.label;
  securityRunLabel.textContent = meta.action;
  securityIntruderControls.hidden = next !== "intruder";
  securityPayloadPanel.hidden = next !== "intruder";
  securityInterceptToggle.hidden = next !== "interceptor";
  securityDropButton.hidden = next !== "interceptor" || !currentProxyCaptureId;
  securityWorkbench.hidden = false;

  securityToolMenu?.querySelectorAll("[data-security-tool]").forEach((option) => {
    const active = option.dataset.securityTool === next;
    option.classList.toggle("active", active);
    option.setAttribute("aria-checked", String(active));
  });

  const draft = securityDrafts.get(next) || {};
  securityRequestEditor.value = draft.request || "GET / HTTP/1.1\nHost: authorized.example\nAccept: */*";
  securityResponseEditor.value = draft.response || "";
  if (draft.payloads) securityPayloadEditor.value = draft.payloads;
  if (draft.attackType) securityAttackType.value = draft.attackType;
  setSecurityStatus(next === "interceptor" && proxyListenerState.running
    ? proxyListenerState.warning || `Listening on ${proxyListenerState.host}:${proxyListenerState.port}`
    : "Ready", proxyListenerState.warning ? "error" : "");
  if (next === "interceptor") syncInterceptorToggleUi(assessmentSettingsCache);
  syncSecurityExchangeSizes();
  closeSecurityToolMenu();
  if (persist) localStorage.setItem(SECURITY_TOOL_KEY, next);
}

function syncSecurityToolsVisibility() {
  if (!securityToolSwitcher) return;
  securityToolSwitcher.hidden = false;
  const saved = localStorage.getItem(SECURITY_TOOL_KEY);
  setSecurityTool(SECURITY_TOOL_META[saved] ? saved : "interceptor", { persist: false });
}

function trafficHeaderValue(rawMessage, headerName) {
  const wanted = String(headerName || "").toLowerCase();
  for (const line of String(rawMessage || "").split(/\r?\n/).slice(1)) {
    if (!line.trim()) break;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toLowerCase() === wanted) return line.slice(separator + 1).trim();
  }
  return "";
}

function trafficHistoryMeta(record, index, count) {
  let host = "";
  let requestPath = String(record?.url || "");
  let hasParams = false;
  try {
    const url = new URL(record.url);
    host = url.origin;
    requestPath = `${url.pathname || "/"}${url.search || ""}`;
    hasParams = Boolean(url.search);
  } catch {
    host = trafficHeaderValue(record?.request, "host");
  }
  const statusMatch = String(record?.response || "").match(/^HTTP\/\S+\s+(\d{3})/i);
  const status = Number(record?.statusCode) || Number(statusMatch?.[1]) || "";
  const response = String(record?.response || "");
  const contentType = String(record?.contentType || trafficHeaderValue(response, "content-type") || "")
    .split(";", 1)[0]
    .toLowerCase();
  const subtype = contentType.split("/").at(-1) || "";
  const mime = subtype === "html" ? "HTML"
    : subtype === "json" ? "JSON"
      : subtype.includes("javascript") ? "script"
        : subtype === "plain" ? "text"
          : subtype;
  return {
    number: count - index,
    host,
    method: String(record?.method || ""),
    path: requestPath,
    params: hasParams ? "✓" : "",
    status,
    length: new TextEncoder().encode(response).length || "",
    mime,
    tool: String(record?.tool || ""),
    time: String(record?.timestamp || record?.isoTimestamp || ""),
  };
}

function appendSecurityHistoryCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value == null ? "" : String(value);
  row.appendChild(cell);
}

function selectSecurityHistoryRecord(index) {
  const record = securityHistoryRecords[index];
  if (!record) return;
  selectedSecurityHistoryIndex = index;
  securityHistoryRows?.querySelectorAll("tr").forEach((row, rowIndex) => {
    row.classList.toggle("selected", rowIndex === index);
    row.setAttribute("aria-selected", String(rowIndex === index));
  });
  if (SECURITY_TOOL_META[record.tool]) setSecurityTool(record.tool);
  securityRequestEditor.value = String(record.request || "");
  securityResponseEditor.value = String(record.response || "");
  syncSecurityExchangeSizes();
  const label = record.requestId || `entry ${securityHistoryRecords.length - index}`;
  setSecurityStatus(`History · ${label} · ${record.timestamp || record.isoTimestamp || ""}`, "success");
}

function renderSecurityHistory(records) {
  securityHistoryRecords = Array.isArray(records) ? records : [];
  selectedSecurityHistoryIndex = -1;
  if (!securityHistoryRows || !securityHistoryEmpty) return;
  securityHistoryRows.innerHTML = "";
  securityHistoryEmpty.hidden = securityHistoryRecords.length > 0;
  securityHistoryRecords.forEach((record, index) => {
    const meta = trafficHistoryMeta(record, index, securityHistoryRecords.length);
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("aria-selected", "false");
    row.title = `${meta.method} ${record.url || meta.path}`.trim();
    appendSecurityHistoryCell(row, meta.number, "history-number");
    appendSecurityHistoryCell(row, meta.host, "history-host");
    appendSecurityHistoryCell(row, meta.method, `history-method method-${meta.method.toLowerCase()}`);
    appendSecurityHistoryCell(row, meta.path, "history-url");
    appendSecurityHistoryCell(row, meta.params, "history-params");
    appendSecurityHistoryCell(row, meta.status, `history-status status-${String(meta.status).charAt(0)}`);
    appendSecurityHistoryCell(row, meta.length, "history-length");
    appendSecurityHistoryCell(row, meta.mime, "history-mime");
    appendSecurityHistoryCell(row, meta.tool, "history-tool");
    appendSecurityHistoryCell(row, meta.time, "history-time");
    row.addEventListener("click", () => selectSecurityHistoryRecord(index));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectSecurityHistoryRecord(index);
    });
    securityHistoryRows.appendChild(row);
  });
}

async function loadSecurityHistory() {
  if (securityHistoryLoading || !securityHistoryPanel || securityHistoryPanel.hidden) return;
  if (!assessmentPath) {
    renderSecurityHistory([]);
    securityHistoryEmpty.textContent = "Create or open an assessment to load Traffic/Raw history.";
    securityHistorySummary.textContent = "No assessment";
    return;
  }
  securityHistoryLoading = true;
  securityHistoryRefresh?.classList.add("loading");
  securityHistorySummary.textContent = "Loading Traffic/Raw...";
  try {
    const result = await window.api.assessmentTrafficHistory({ path: assessmentPath, limit: 500 });
    if (result?.error) {
      renderSecurityHistory([]);
      securityHistoryEmpty.textContent = result.error;
      securityHistorySummary.textContent = "History unavailable";
      return;
    }
    renderSecurityHistory(result.records || []);
    securityHistoryEmpty.textContent = "Traffic/Raw has no captured HTTP exchanges yet.";
    const suffix = result.truncated ? " · latest 500" : "";
    securityHistorySummary.textContent = `${result.records?.length || 0} exchange${result.records?.length === 1 ? "" : "s"}${suffix}`;
  } finally {
    securityHistoryLoading = false;
    securityHistoryRefresh?.classList.remove("loading");
  }
}

function setSecurityHistoryVisible(visible) {
  if (!securityHistoryPanel || !securityHistoryToggle) return;
  securityHistoryPanel.hidden = !visible;
  securityHistoryToggle.classList.toggle("active", Boolean(visible));
  securityHistoryToggle.setAttribute("aria-pressed", String(Boolean(visible)));
  if (visible) loadSecurityHistory();
}

function refreshSecurityHistoryIfVisible() {
  if (!securityHistoryPanel?.hidden) loadSecurityHistory();
}

function setSecurityBusy(busy) {
  securityBusy = Boolean(busy);
  securityRunButton.disabled = securityBusy;
  securityClearButton.disabled = securityBusy;
  securityAnalyzeButton.disabled = securityBusy;
}

async function runSecurityRequest(rawRequest, mode) {
  return window.api.securityHttpRequest({
    assessmentPath,
    rawRequest,
    mode,
  });
}

async function runSecurityWorkbench() {
  if (securityBusy) return;
  if (!assessmentPath) {
    setSecurityStatus("Create or open an assessment first", "error");
    return;
  }
  const request = securityRequestEditor.value.trim();
  if (!request) {
    setSecurityStatus("Request is empty", "error");
    return;
  }

  setSecurityBusy(true);
  setSecurityStatus(selectedSecurityTool === "intruder" ? "Preparing payload requests..." : "Sending...");
  try {
    if (selectedSecurityTool !== "intruder") {
      if (selectedSecurityTool === "interceptor" && currentProxyCaptureId) {
        const forwarded = await window.api.proxyForward({ id: currentProxyCaptureId, request });
        if (forwarded?.error) {
          setSecurityStatus(forwarded.error, "error");
        } else {
          currentProxyCaptureId = "";
          securityDropButton.hidden = true;
          setSecurityStatus("Forwarded - waiting for response");
        }
        return;
      }
      const result = await runSecurityRequest(request, selectedSecurityTool);
      if (result?.error) {
        setSecurityStatus(result.error, "error");
        securityResponseEditor.value = `Pointer blocked the request:\n${result.error}\n${result.code ? `\nCode: ${result.code}` : ""}`;
      } else {
        securityResponseEditor.value = result.response || "";
        lastLoggedSecuritySignature = securityExchangeSignature();
        setSecurityStatus(`${result.status} in ${result.durationMs} ms - logged ${result.logged?.timestamp || ""}`, "success");
      }
      syncSecurityExchangeSizes();
      return;
    }

    const settingsResult = await window.api.assessmentSettings({ path: assessmentPath });
    if (settingsResult?.error) {
      setSecurityStatus(settingsResult.error, "error");
      return;
    }
    const intruderSettings = settingsResult.settings?.intruder || {};
    const maxRequests = Math.max(1, Math.min(Number(intruderSettings.maximumRequestsPerRun) || 25, 25));
    const delayMs = Math.max(500, Math.min(Number(intruderSettings.delayBetweenRequestsMs) || 500, 60000));
    const built = await window.api.securityBuildIntruder({
      rawRequest: request,
      payloadSets: securityPayloadEditor.value,
      attackType: securityAttackType.value,
      maxRequests,
    });
    if (built?.error) {
      setSecurityStatus(built.error, "error");
      return;
    }
    let completed = 0;
    let lastResponse = "";
    for (const generatedRequest of built.requests || []) {
      setSecurityStatus(`Intruder ${completed + 1}/${built.requests.length}`);
      const result = await runSecurityRequest(generatedRequest, "intruder");
      if (result?.error) {
        lastResponse = `Stopped after ${completed} request(s):\n${result.error}\n${result.code ? `\nCode: ${result.code}` : ""}`;
        setSecurityStatus(result.error, "error");
        break;
      }
      completed += 1;
      lastResponse = result.response || "";
      securityResponseEditor.value = lastResponse;
      syncSecurityExchangeSizes();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    securityResponseEditor.value = lastResponse;
    if (completed === built.requests.length) {
      lastLoggedSecuritySignature = securityExchangeSignature();
      setSecurityStatus(`${completed} request${completed === 1 ? "" : "s"} completed and logged${built.capped ? ` (capped at ${built.maxRequests})` : ""}`, "success");
    }
    syncSecurityExchangeSizes();
  } catch (error) {
    setSecurityStatus(error?.message || "Security request failed", "error");
  } finally {
    setSecurityBusy(false);
    refreshSecurityHistoryIfVisible();
  }
}

async function logSecurityExchangeIfNeeded() {
  const signature = securityExchangeSignature();
  if (!assessmentPath || !signature.replace("\u0000", "").trim() || signature === lastLoggedSecuritySignature) return { ok: true };
  const result = await window.api.assessmentTrafficLog({
    path: assessmentPath,
    record: {
      tool: selectedSecurityTool,
      requestId: `capture-${Date.now().toString(36)}`,
      request: securityRequestEditor.value,
      response: securityResponseEditor.value,
      source: "manual-capture",
    },
  });
  if (!result?.error) {
    lastLoggedSecuritySignature = signature;
    refreshSecurityHistoryIfVisible();
  }
  return result;
}

async function analyzeSecurityExchange() {
  if (securityBusy || streaming) return;
  const request = securityRequestEditor.value.trim();
  const response = securityResponseEditor.value.trim();
  if (!request && !response) {
    setSecurityStatus("Nothing to analyze", "error");
    return;
  }
  const logged = await logSecurityExchangeIfNeeded();
  if (logged?.error) {
    setSecurityStatus(logged.error, "error");
    return;
  }

  openChatPane({ createIfEmpty: true });
  setChatMode("ask");
  const clip = (value) => value.length > 14000 ? `${value.slice(0, 14000)}\n...(truncated)` : value;
  chatInput.value = [
    "Analyze this authorized HTTP exchange from the BugBounty workbench.",
    "Identify observable security issues, suspicious behavior, missing controls, and useful follow-up tests.",
    "Separate confirmed evidence from hypotheses. Do not claim a vulnerability without support.",
    "",
    `Tool: ${SECURITY_TOOL_META[selectedSecurityTool]?.label || selectedSecurityTool}`,
    "",
    "REQUEST",
    "```http",
    clip(request),
    "```",
    "",
    "RESPONSE",
    "```http",
    clip(response),
    "```",
  ].join("\n");
  resizeChatInput();
  updateSendBtn();
  await sendMessageWithAgentRuntime();
}

function clearSecurityExchange() {
  if (securityBusy) return;
  if (currentProxyCaptureId) {
    setSecurityStatus("Forward or Drop the pending request before clearing", "error");
    return;
  }
  securityRequestEditor.value = "";
  securityResponseEditor.value = "";
  lastLoggedSecuritySignature = "";
  setSecurityStatus("Ready");
  syncSecurityExchangeSizes();
  securityRequestEditor.focus();
}

async function dropInterceptedRequest() {
  if (!currentProxyCaptureId || securityBusy) return;
  const id = currentProxyCaptureId;
  const result = await window.api.proxyDrop({ id });
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  currentProxyCaptureId = "";
  securityDropButton.hidden = true;
  setSecurityStatus("Request dropped", "success");
}

globalThis.PointerSecurity = {
  async captureExchange({ request = "", response = "", tool = "interceptor" } = {}) {
    if (currentSidebarView !== "bugbounty") activateSidebarView("bugbounty");
    showSecurityWorkspace(SECURITY_TOOL_META[tool] ? tool : "interceptor");
    securityRequestEditor.value = String(request);
    securityResponseEditor.value = String(response);
    syncSecurityExchangeSizes();
    const logged = await logSecurityExchangeIfNeeded();
    setSecurityStatus(logged?.error ? logged.error : `Captured and logged ${logged.timestamp || ""}`, logged?.error ? "error" : "success");
    return logged;
  },
};

function modeButtonClass(mode = chatMode) {
  if (mode === "ask") return "mode-ask";
  if (mode === "plan") return "mode-plan";
  return "mode-agent";
}

function modeIconClass(mode = chatMode) {
  if (mode === "ask") return "codicon-comment-discussion";
  if (mode === "plan") return "codicon-checklist";
  return "codicon-copilot";
}

function modePlaceholder(mode = chatMode) {
  if (mode === "ask") return "Ask about the target or workspace";
  if (mode === "plan") return "Plan an investigation or workflow";
  return "Ask, investigate, run, or search";
}

function modeTools(mode = chatMode) {
  const allowed = mode === "agent" ? AGENT_TOOL_NAMES : READ_ONLY_TOOL_NAMES;
  return ToolMap.TOOLS.filter((tool) => allowed.has(tool.function?.name));
}

function syncChatModeUi() {
  if (chatModeButton) {
    chatModeButton.classList.remove("mode-ask", "mode-plan", "mode-agent");
    chatModeButton.classList.add(modeButtonClass());
  }
  if (chatModeButtonLabel) {
    chatModeButtonLabel.textContent = modeLabel();
  }
  if (chatModeIcon) {
    chatModeIcon.classList.remove("codicon-copilot", "codicon-checklist", "codicon-comment-discussion");
    chatModeIcon.classList.add(modeIconClass());
  }
  chatModeMenu?.querySelectorAll("[data-chat-mode]").forEach((button) => {
    const active = button.dataset.chatMode === chatMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  if (chatInput) {
    chatInput.placeholder = modePlaceholder();
  }
  setAgentStatus(`${modeLabel()} ready`);
  updateContextUsage();
}

function openChatModeMenu() {
  if (!chatModeMenu || !chatModeButton || streaming) return;
  closeModelMenu();
  chatModeMenu.hidden = false;
  chatModeButton.setAttribute("aria-expanded", "true");
  positionChatModeMenu();
}

function closeChatModeMenu() {
  if (!chatModeMenu || !chatModeButton) return;
  chatModeMenu.hidden = true;
  chatModeButton.setAttribute("aria-expanded", "false");
}

function toggleChatModeMenu() {
  if (!chatModeMenu || !chatModeButton || streaming) return;
  if (chatModeMenu.hidden) openChatModeMenu();
  else closeChatModeMenu();
}

function positionChatModeMenu() {
  if (!chatModeMenu || !chatModeButton || chatModeMenu.hidden) return;
  const rect = chatModeButton.getBoundingClientRect();
  const menuW = chatModeMenu.offsetWidth || 174;
  const menuH = chatModeMenu.offsetHeight || 99;
  const pad = 8;
  let left = Math.min(rect.left, window.innerWidth - menuW - pad);
  let top = rect.top - menuH - pad;
  if (top < pad) top = rect.bottom + pad;
  left = Math.max(pad, left);
  chatModeMenu.style.left = `${left}px`;
  chatModeMenu.style.top = `${top}px`;
}

function setChatMode(mode) {
  if (!CHAT_MODES.has(mode) || streaming) return;
  chatMode = mode;
  localStorage.setItem(CHAT_MODE_KEY, mode);
  syncChatModeUi();
  closeChatModeMenu();
  chatInput?.focus();
}

function syncActiveChatSession() {
  const session = activeChatSession();
  if (!session) return;
  session.history = chatHistory;
  session.contextFilesCache = contextFilesCache;
  session.activeStreamContent = activeStreamContent;
  session.messagesHtml = messages?.innerHTML || "";
}

function renderChatSessionSelect() {
  if (!chatSessionSelect) return;
  chatSessionSelect.innerHTML = "";
  chatSessionSelect.classList.toggle("disabled", streaming || !chatSessions.length);

  chatSessions.forEach((session) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `chat-session-tab${session.id === activeChatSessionId ? " active" : ""}`;
    tab.dataset.sessionId = session.id;
    tab.title = session.title || "New Agent";

    const icon = document.createElement("span");
    icon.className = "codicon codicon-comment-discussion chat-title-icon";

    const label = document.createElement("span");
    label.className = "chat-session-label";
    label.textContent = session.title || "New Agent";

    const close = document.createElement("span");
    close.className = "codicon codicon-close chat-tab-close";
    close.dataset.closeSession = session.id;
    close.title = "Delete chat";

    tab.appendChild(icon);
    tab.appendChild(label);
    tab.appendChild(close);
    chatSessionSelect.appendChild(tab);
  });

  if (btnChatDelete) btnChatDelete.disabled = streaming;
  if (btnChatNew) btnChatNew.disabled = streaming;
}

function loadChatSession(id) {
  const session = chatSessions.find((item) => item.id === id);
  if (!session || streaming) {
    renderChatSessionSelect();
    return;
  }
  syncActiveChatSession();
  setChatCollapsed(false);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = session.activeStreamContent || "";
  messages.innerHTML = session.messagesHtml || "";
  renderChatSessionSelect();
  updateContextUsage();
  scrollMessages();
}

function newChatSession() {
  if (streaming) return;
  syncActiveChatSession();
  const session = createChatSession("New Agent");
  clearChatSessionState(session);
  chatSessions.push(session);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = "";
  messages.innerHTML = "";
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
  chatInput.focus();
}

function deleteChatSession(id = activeChatSessionId) {
  if (streaming) return;
  const idx = chatSessions.findIndex((session) => session.id === id);
  if (idx >= 0) {
    clearChatSessionState(chatSessions[idx]);
    chatSessions.splice(idx, 1);
  }
  if (!chatSessions.length) {
    activeChatSessionId = "";
    chatHistory = [];
    contextFilesCache = [];
    activeStreamContent = "";
    messages.innerHTML = "";
    setChatCollapsed(true);
    renderChatSessionSelect();
    updateContextUsage();
    return;
  }
  const next = chatSessions[Math.max(0, Math.min(idx, chatSessions.length - 1))];
  activeChatSessionId = next.id;
  chatHistory = next.history;
  contextFilesCache = next.contextFilesCache;
  activeStreamContent = next.activeStreamContent || "";
  messages.innerHTML = next.messagesHtml || "";
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
  chatInput.focus();
}

function deleteActiveChatSession() {
  deleteChatSession(activeChatSessionId);
}

function openChatHistoryPicker() {
  if (streaming || !chatSessionSelect) return;
  setChatCollapsed(false);
  if (chatSessions.length <= 1) return;
  const idx = chatSessions.findIndex((session) => session.id === activeChatSessionId);
  const next = chatSessions[(idx + 1) % chatSessions.length];
  if (next) loadChatSession(next.id);
}

function showChatOptions() {
  if (!contextUsagePopover || !contextUsageBtn) return;
  openContextPopover();
}

function maybeNameActiveChat(text) {
  const session = activeChatSession();
  if (!session || session.history.length > 1) return;
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  session.title = clean.length > 28 ? `${clean.slice(0, 27)}...` : clean;
  renderChatSessionSelect();
}

const initialChatSession = createChatSession("New Agent");
clearChatSessionState(initialChatSession);
chatSessions.push(initialChatSession);
activeChatSessionId = chatSessions[0].id;
chatHistory = chatSessions[0].history;
contextFilesCache = chatSessions[0].contextFilesCache;

function loadModelSettings() {
  try {
    const raw = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const normalized = {};
    for (const [name, settings] of Object.entries(parsed)) {
      if (!settings || typeof settings !== "object") continue;
      const rawContext = typeof settings.context === "string" ? settings.context : AUTO_CONTEXT;
      const explicitManualContext =
        settings.contextLocked === true
        || (rawContext !== AUTO_CONTEXT && rawContext !== LEGACY_DEFAULT_CONTEXT);
      normalized[name] = {
        thinking: Boolean(settings.thinking),
        context: CONTEXT_OPTIONS.includes(rawContext)
          ? (explicitManualContext ? rawContext : AUTO_CONTEXT)
          : AUTO_CONTEXT,
        contextLocked: explicitManualContext,
      };
    }
    return normalized;
  } catch {
    localStorage.removeItem(MODEL_SETTINGS_KEY);
    return {};
  }
}

let modelSettings = loadModelSettings();
let contextUsageSeq = 0;
let contextUsageTimer = null;

function getModelSettings(name) {
  if (!modelSettings[name]) {
    modelSettings[name] = { thinking: false, context: AUTO_CONTEXT, contextLocked: false };
  }
  return modelSettings[name];
}

function saveModelSettings() {
  localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(modelSettings));
}

function setModelSetting(name, key, value) {
  getModelSettings(name)[key] = value;
  if (key === "context") {
    getModelSettings(name).contextLocked = value !== AUTO_CONTEXT;
  }
  saveModelSettings();
  if (name === selectedModel && key === "context") updateContextUsage();
}

function contextToTokens(label, { forRequest = false } = {}) {
  if (!label || label === AUTO_CONTEXT) {
    return forRequest ? null : AUTO_CONTEXT_ESTIMATE;
  }
  const map = {
    "4K": 4096, "8K": 8192, "16K": 16384, "32K": 32768,
    "64K": 65536, "128K": 131072, "256K": 262144,
  };
  return map[label] ?? (forRequest ? null : AUTO_CONTEXT_ESTIMATE);
}

function estimateTokens(text) {
  if (!text) return 0;
  const value = String(text);
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const pieces = value.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || [];
  const symbolWeight = (value.match(/[{}()[\].,;:+\-*/=<>"'`|&!?]/g) || []).length * 0.15;
  const structuralOverhead = (value.match(/\n/g) || []).length * 0.35;
  return Math.max(1, Math.ceil(cjk + (pieces.length - cjk) * 1.05 + symbolWeight + structuralOverhead));
}

function estimateMessagesTokens(msgs) {
  return msgs.reduce((sum, m) => {
    let t = estimateTokens(m.content || "") + 4;
    if (m.tool_calls?.length) {
      t += estimateTokens(JSON.stringify(m.tool_calls));
    }
    if (m.tool_name) t += estimateTokens(m.tool_name) + 2;
    return sum + t;
  }, 0);
}

function formatTokenCount(n) {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(n);
}

function sanitizeRecentContextMessages(messages) {
  const recent = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      ...message,
      content: String(message?.content || "").trim(),
      ...(Array.isArray(message?.tool_calls) ? { tool_calls: message.tool_calls.map((call) => ({ ...call })) } : {}),
    }))
    .filter((message) => message.content || message.tool_calls?.length);
  while (recent[0]?.role === "tool") recent.shift();
  return recent;
}

function getContextBreakdown() {
  const activeFile = getActiveFileContext();
  const contextSettings = selectedModel ? getModelSettings(selectedModel) : { context: AUTO_CONTEXT };
  const contextBudget = contextToTokens(contextSettings.context);
  const systemPrompt = [
    ToolParser.SYSTEM_PROMPT,
    ToolParser.MODE_PROMPTS?.[chatMode],
  ].filter(Boolean).join("\n\n").trim();
  const projectContext = buildProjectContextMessage({
    dirMap: dirMapCache,
    activeFile,
    extraFiles: contextFilesCache,
    contextBudget,
  });
  const summaryMessage = buildSummaryContextMessage(activeChatSession()?.contextSummary);
  const draft = chatInput.value.trim();
  const streamTokens = activeStreamContent ? estimateTokens(activeStreamContent) + 4 : 0;
  const sections = [
    {
      key: "system",
      label: "System prompt",
      color: "#a7a7ab",
      tokens: systemPrompt ? estimateMessagesTokens([{ role: "system", content: systemPrompt }]) : 0,
    },
    {
      key: "project",
      label: "Project context",
      color: "#4cb27a",
      tokens: projectContext ? estimateMessagesTokens([{ role: "system", content: projectContext }]) : 0,
    },
    {
      key: "tools",
      label: "Tool definitions",
      color: "#a879d6",
      tokens: estimateTokens(JSON.stringify(modeTools())),
    },
    {
      key: "memory",
      label: "Saved memory",
      color: "#d58dbc",
      tokens: summaryMessage ? estimateMessagesTokens([{ role: "system", content: summaryMessage }]) : 0,
    },
    {
      key: "conversation",
      label: "Conversation",
      color: "#7ea9d8",
      tokens: estimateMessagesTokens(chatHistory),
    },
    {
      key: "draft",
      label: "Draft",
      color: "#f0bb64",
      tokens: (draft ? estimateTokens(draft) + 4 : 0) + streamTokens,
    },
  ];
  const summaryTokens = sections.find((section) => section.key === "memory")?.tokens || 0;
  const liveChatTokens = sections.find((section) => section.key === "conversation")?.tokens || 0;
  const toolTokens = sections.find((section) => section.key === "tools")?.tokens || 0;
  const draftTokens = sections.find((section) => section.key === "draft")?.tokens || 0;
  const visibleComposerTokens = draftTokens;
  const estimatedTotal = sections.reduce((sum, section) => sum + section.tokens, 0);

  return {
    sections,
    summaryTokens,
    liveChatTokens,
    draftTokens,
    streamTokens,
    visibleComposerTokens,
    toolTokens,
    estimatedTotal,
  };
}

function setContextCompactionUi(compacting) {
  contextCompacting = Boolean(compacting);
  if (!contextCompactBtn) return;
  const icon = contextCompactBtn.querySelector(".codicon");
  icon?.classList.toggle("codicon-fold", !contextCompacting);
  icon?.classList.toggle("codicon-loading", contextCompacting);
  icon?.classList.toggle("codicon-modifier-spin", contextCompacting);
  contextCompactBtn.disabled = contextCompacting || !selectedModel || chatHistory.length < 6;
  contextCompactBtn.title = contextCompacting
    ? "Summarizing context..."
    : !selectedModel
      ? "Select a model before summarizing context"
      : chatHistory.length < 6
        ? "At least 6 messages are needed to summarize context"
        : "Summarize earlier context";
}

function contextCompactionSplit(history, { force = false, urgent = false } = {}) {
  const sourceHistory = Array.isArray(history) ? history : [];
  const minimum = urgent ? 4 : force ? 6 : CONTEXT_COMPACT_MIN_MESSAGES;
  if (sourceHistory.length < minimum) return null;
  const keepCount = urgent
    ? Math.max(2, Math.floor(sourceHistory.length / 3))
    : force
    ? Math.min(6, Math.max(4, Math.floor(sourceHistory.length / 3)))
    : Math.min(CONTEXT_COMPACT_KEEP_MESSAGES, Math.max(4, Math.floor(sourceHistory.length / 3)));
  let splitIndex = Math.max(1, sourceHistory.length - keepCount);
  while (splitIndex > 0 && sourceHistory[splitIndex]?.role === "tool") splitIndex -= 1;
  if (splitIndex <= 0) return null;
  const oldMessages = sourceHistory.slice(0, splitIndex);
  const recentMessages = sanitizeRecentContextMessages(sourceHistory.slice(splitIndex));
  if (!oldMessages.length || !recentMessages.length) return null;
  return { oldMessages, recentMessages };
}

async function maybeCompactContext(usage = getContextUsage(), { force = false } = {}) {
  if (contextCompactionPromise) return contextCompactionPromise;
  const session = activeChatSession();
  if (streaming || !session) return false;
  if (!force && (!usage || usage.pct < CONTEXT_SUMMARY_THRESHOLD)) return false;
  const historySnapshot = chatHistory.slice();
  const split = contextCompactionSplit(historySnapshot, {
    force,
    urgent: !force && usage.pct >= 0.85,
  });
  if (!split) {
    setContextCompactionUi(false);
    return false;
  }

  const sessionId = session.id;
  const model = selectedModel;
  const settings = model ? getModelSettings(model) : { context: AUTO_CONTEXT };
  const contextBudget = contextToTokens(settings.context);
  const previousSummary = session.contextSummary || "";
  setContextCompactionUi(true);
  if (!streaming) setAgentStatus("Summarizing context...");

  contextCompactionPromise = (async () => {
    let summary = "";
    let source = "fallback";
    let warning = "";

    if (window.api?.summarizeContext && model) {
      try {
        const result = await window.api.summarizeContext({
          model,
          contextBudget,
          previousSummary,
          messages: split.oldMessages,
        });
        if (result?.ok && result.summary) {
          summary = globalThis.ContextMemory?.normalizeSummary(
            result.summary,
            globalThis.ContextMemory.summaryCharLimit(contextBudget),
          ) || String(result.summary).trim();
          source = "model";
        } else {
          warning = result?.error || "Model summarization unavailable.";
        }
      } catch (err) {
        warning = err?.message || "Model summarization unavailable.";
      }
    }

    if (!summary) {
      summary = globalThis.ContextMemory?.buildFallbackSummary(
        previousSummary,
        split.oldMessages,
        { contextTokens: contextBudget },
      ) || previousSummary;
    }
    if (!summary) return false;

    const targetSession = chatSessions.find((item) => item.id === sessionId);
    if (!targetSession) return false;
    const previousCount = Number(targetSession.contextSummaryMeta?.summarizedMessages) || 0;
    targetSession.contextSummary = summary;
    targetSession.contextSummaryMeta = {
      source,
      summarizedMessages: previousCount + split.oldMessages.length,
      updatedAt: Date.now(),
      warning,
    };
    const liveHistory = Array.isArray(targetSession.history) ? targetSession.history : [];
    const mergedHistory = globalThis.ContextMemory?.mergeRecentWithAppended(
      split.recentMessages,
      liveHistory,
      historySnapshot.length,
    ) || [
      ...split.recentMessages,
      ...liveHistory.slice(historySnapshot.length),
    ];
    targetSession.history = sanitizeRecentContextMessages(mergedHistory);
    targetSession.activeStreamContent = "";

    if (activeChatSessionId === sessionId) {
      chatHistory = targetSession.history;
      contextFilesCache = targetSession.contextFilesCache;
      activeStreamContent = "";
      syncActiveChatSession();
    }
    return true;
  })();

  try {
    return await contextCompactionPromise;
  } catch (err) {
    console.error("Context compaction failed:", err);
    return false;
  } finally {
    contextCompactionPromise = null;
    setContextCompactionUi(false);
    if (!streaming) setAgentStatus(`${modeLabel()} ready`);
    updateContextUsage();
  }
}

function getContextUsage(usedOverride = null) {
  const settings = selectedModel ? getModelSettings(selectedModel) : { context: AUTO_CONTEXT };
  const total = contextToTokens(settings.context);
  const breakdown = getContextBreakdown();
  let used = usedOverride;
  if (used == null) {
    used = estimateMessagesTokens(buildMessagesForApi());
    used += breakdown.toolTokens;
    used += breakdown.visibleComposerTokens;
  }
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  return {
    total,
    used,
    free: Math.max(total - used, 0),
    pct,
    contextLabel: settings.context === AUTO_CONTEXT ? `Auto (~${formatTokenCount(total)})` : settings.context,
    breakdown,
  };
}

function updateContextUsageLegacy() {
  if (!contextRingFill) return;
  const { total, used, free, pct } = getContextUsage();
  const filled = pct * CONTEXT_RING_C;

  contextRingFill.style.strokeDasharray = `${filled} ${CONTEXT_RING_C}`;
  contextUsageBtn.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
  contextUsageBtn.classList.toggle("full", pct >= 0.9);

  if (contextUsageFill) {
    contextUsageFill.style.width = `${pct * 100}%`;
    contextUsageFill.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
    contextUsageFill.classList.toggle("full", pct >= 0.9);
  }
  if (contextUsageUsed) contextUsageUsed.textContent = `${formatTokenCount(used)} used`;
  if (contextUsageFree) contextUsageFree.textContent = `${formatTokenCount(free)} free`;
  if (contextUsagePct) {
    contextUsagePct.textContent = `${Math.round(pct * 100)}% used · ${formatTokenCount(total)} max`;
  }
}

function getContextUsageMessages() {
  const msgs = buildMessagesForApi().map((msg) => ({ ...msg }));
  const draft = chatInput.value.trim();
  if (draft) msgs.push({ role: "user", content: draft });
  if (activeStreamContent) msgs.push({ role: "assistant", content: activeStreamContent });
  return msgs;
}

function renderContextUsage({ total, used, free, pct, source }) {
  if (!contextRingFill) return;
  const filled = pct * CONTEXT_RING_C;
  const breakdown = getContextBreakdown();
  const estimatedTotal = Math.max(breakdown.estimatedTotal, 1);
  const scale = used > 0 ? used / estimatedTotal : 1;

  contextRingFill.style.strokeDasharray = `${filled} ${CONTEXT_RING_C}`;
  contextUsageBtn.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
  contextUsageBtn.classList.toggle("full", pct >= 0.9);

  if (contextUsageFill) {
    contextUsageFill.style.width = `${pct * 100}%`;
    contextUsageFill.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
    contextUsageFill.classList.toggle("full", pct >= 0.9);
  }
  if (contextUsageUsed) contextUsageUsed.textContent = `${Math.round(pct * 100)}% Full`;
  if (contextUsageFree) contextUsageFree.textContent = `~${formatTokenCount(used)} / ${formatTokenCount(total)} Tokens`;
  if (contextUsagePct) {
    contextUsagePct.textContent = `${formatTokenCount(used)} used · ${formatTokenCount(free)} free`;
  }
  if (contextUsageSource) {
    contextUsageSource.textContent = source === "model count" ? "Model Count" : "Estimate";
  }
  if (contextUsageSegments) {
    const segments = breakdown.sections
      .filter((section) => section.tokens > 0)
      .map((section) => {
        const scaledTokens = Math.max(0, Math.round(section.tokens * scale));
        const widthPct = Math.max((scaledTokens / Math.max(total, 1)) * 100, 1);
        return `<span class="context-usage-segment" style="width:${widthPct}%;background:${section.color}" title="${escapeHtml(section.label)}: ~${escapeHtml(formatTokenCount(scaledTokens))}"></span>`;
      });
    contextUsageSegments.innerHTML = segments.join("");
  }
  if (contextUsageBreakdown) {
    const rows = breakdown.sections
      .filter((section) => section.tokens > 0)
      .map((section) => {
        const scaledTokens = Math.max(0, Math.round(section.tokens * scale));
        return `
          <div class="context-usage-row">
            <div class="context-usage-row-label">
              <span class="context-usage-swatch" style="background:${section.color}"></span>
              <span>${escapeHtml(section.label)}</span>
            </div>
            <div class="context-usage-row-value">${escapeHtml(formatTokenCount(scaledTokens))}</div>
          </div>
        `;
      });
    contextUsageBreakdown.innerHTML = rows.join("");
  }
  const session = activeChatSession();
  const meta = session?.contextSummaryMeta;
  if (contextMemoryNote && contextMemoryText) {
    const hasMemory = Boolean(session?.contextSummary);
    contextMemoryNote.hidden = !hasMemory;
    if (hasMemory) {
      const count = Number(meta?.summarizedMessages) || 0;
      const sourceLabel = meta?.source === "model" ? "Model summary" : "Local fallback";
      contextMemoryText.textContent = `${sourceLabel}: ${count} earlier message${count === 1 ? "" : "s"} preserved as working memory.`;
      contextMemoryNote.title = meta?.warning || "Current files and recent messages override saved memory when they conflict.";
    }
  }
  setContextCompactionUi(contextCompacting);
  if (contextUsagePopover && !contextUsagePopover.hidden) {
    requestAnimationFrame(positionContextPopover);
  }
}

function updateContextUsage() {
  const fallbackUsage = getContextUsage();
  renderContextUsage({ ...fallbackUsage, source: "estimate" });
  if (!window.api?.countTokens || !selectedModel) {
    maybeCompactContext(fallbackUsage);
    return;
  }

  if (contextUsageTimer) clearTimeout(contextUsageTimer);
  const seq = ++contextUsageSeq;
  contextUsageTimer = setTimeout(async () => {
    try {
      const result = await window.api.countTokens({
        model: selectedModel,
        messages: getContextUsageMessages(),
        tools: modeTools(),
      });
      if (seq !== contextUsageSeq || !result?.ok || !Number.isFinite(result.count)) return;
      const preciseUsage = getContextUsage(result.count);
      renderContextUsage({
        ...preciseUsage,
        source: result.source === "ollama" ? "model count" : "estimate",
      });
      maybeCompactContext(preciseUsage);
    } catch {
      /* keep fallback estimate */
    }
  }, 250);
}

function positionContextPopover() {
  if (!contextUsagePopover || !contextUsageBtn || !chatPane) return;
  const buttonRect = contextUsageBtn.getBoundingClientRect();
  const paneRect = chatPane.getBoundingClientRect();
  const anchorRect = inputBar?.getBoundingClientRect() || buttonRect;
  const composerRect = composerEl?.getBoundingClientRect() || anchorRect;
  const popH = contextUsagePopover.offsetHeight || 100;
  const panePadding = 14;
  let top = anchorRect.top - popH - 14;
  let left = composerRect.left;
  let width = composerRect.width;

  if (width > 0) {
    const maxWidth = paneRect.width - panePadding * 2;
    width = Math.min(width, maxWidth);
    contextUsagePopover.style.width = `${Math.max(width, 260)}px`;
  }

  const popW = contextUsagePopover.offsetWidth || 240;

  if (top < paneRect.top + panePadding) {
    top = Math.min(
      anchorRect.bottom + 10,
      paneRect.bottom - popH - panePadding,
    );
  }
  if (left < paneRect.left + panePadding) {
    left = paneRect.left + panePadding;
  }
  if (left + popW > paneRect.right - panePadding) {
    left = paneRect.right - popW - panePadding;
  }

  contextUsagePopover.style.top = `${top}px`;
  contextUsagePopover.style.left = `${left}px`;
}

function closeContextPopover() {
  if (!contextUsagePopover) return;
  contextUsagePopover.hidden = true;
  contextUsageBtn?.classList.remove("active");
  contextUsageBtn?.setAttribute("aria-expanded", "false");
}

function openContextPopover() {
  closeModelMenu();
  updateContextUsage();
  contextUsagePopover.hidden = false;
  contextUsageBtn.classList.add("active");
  contextUsageBtn.setAttribute("aria-expanded", "true");
  positionContextPopover();
}

function toggleContextPopover() {
  if (contextUsagePopover.hidden) openContextPopover();
  else closeContextPopover();
}

function setExplorerActionsEnabled(enabled) {
  btnNewFile.disabled = !enabled;
  btnNewFolder.disabled = !enabled;
  if (btnDeleteItem) btnDeleteItem.disabled = !enabled || !selectedItem;
}

setExplorerActionsEnabled(false);

btnNewFile.addEventListener("click", () => createNewItemInput(false));
btnNewFolder.addEventListener("click", () => createNewItemInput(true));
btnDeleteItem?.addEventListener("click", () => deleteSelectedExplorerItem());

let creatingItem = false;
async function createNewItemInput(isFolder) {
  if (!rootPath || creatingItem) return;
  creatingItem = true;

  let targetDir = rootPath;
  let targetContainer = fileTree;
  let paddingLeft = "8px";

  // If an item is highlighted, contextualize where to add the new element
  if (selectedItem) {
    const isDir = selectedItem.dataset.isDir === "true";
    if (isDir) {
      targetDir = selectedItem.dataset.path;
      const childrenContainer = selectedItem.nextElementSibling;
      
      // Auto-expand directory exactly like VS Code
      const chevron = selectedItem.querySelector(".tree-chevron");
      const icon = selectedItem.querySelector(".tree-icon");
      if (chevron) chevron.classList.add("expanded");
      if (icon) icon.className = "tree-icon codicon codicon-folder-opened";
      if (childrenContainer) childrenContainer.style.display = "block";
      setExpandedTreePath(targetDir, true);
      
      // Force directory load if it hasn't been cached/expanded yet
      if (childrenContainer && (childrenContainer.childElementCount === 0 || (childrenContainer.children.length === 1 && childrenContainer.children[0].textContent === "Loading…"))) {
        const currentDepth = (parseInt(selectedItem.style.paddingLeft) - 8) / 8;
        childrenContainer.innerHTML = "";
        await renderTree(targetDir, childrenContainer, currentDepth + 1);
      }
      
      targetContainer = childrenContainer;
      paddingLeft = `${parseInt(selectedItem.style.paddingLeft) + 8}px`;
    } else {
      // If a file is selected, create adjacent to it inside its parent folder
      const filePath = selectedItem.dataset.path;
      const lastIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      targetDir = filePath.substring(0, lastIdx);
      targetContainer = selectedItem.parentElement;
      paddingLeft = selectedItem.style.paddingLeft;
    }
  }

  // Generate the temporary tree input node
  const inputRow = document.createElement("div");
  inputRow.className = "tree-item tree-input-row";
  inputRow.style.paddingLeft = paddingLeft;

  const chevron = document.createElement("span");
  chevron.className = isFolder ? "tree-chevron codicon codicon-chevron-right" : "tree-chevron codicon hidden";

  const icon = document.createElement("span");
  icon.className = `tree-icon codicon ${isFolder ? "codicon-folder" : "codicon-file"}`;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-input";

  inputRow.appendChild(chevron);
  inputRow.appendChild(icon);
  inputRow.appendChild(input);

  // Prepend row to top of target directory view
  if (targetContainer.firstChild) {
    targetContainer.insertBefore(inputRow, targetContainer.firstChild);
  } else {
    targetContainer.appendChild(inputRow);
  }

  input.focus();

  let finished = false;
  async function commit() {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (!name) {
      inputRow.remove();
      creatingItem = false;
      return;
    }

    const separator = targetDir.includes("\\") ? "\\" : "/";
    const newPath = targetDir + (targetDir.endsWith(separator) ? "" : separator) + name;

    let result;
    if (isFolder) {
      result = await window.api.mkdir(newPath);
    } else {
      result = await window.api.writeFile(newPath, "");
    }

    if (result && result.error) {
      alert(`Error creating item: ${result.error}`);
      inputRow.remove();
    } else {
      // Re-render folder node to sync new additions sorted alphabetically
      if (targetContainer === fileTree) {
        await rerenderExplorer({ preserveSelectionPath: newPath });
      } else {
        const parentItem = targetContainer.previousElementSibling;
        const parentDepth = (parseInt(parentItem.style.paddingLeft) - 8) / 8;
        await renderTree(targetDir, targetContainer, parentDepth + 1);
      }
      
      // If it's a file, automatically open and highlight it
      if (!isFolder) {
        await openFile(newPath, name);
        const items = targetContainer.querySelectorAll(".tree-item");
        for (const itemRow of items) {
          if (itemRow.dataset.path === newPath) {
            selectItem(itemRow);
            break;
          }
        }
      }
    }
    creatingItem = false;
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finished = true;
      inputRow.remove();
      creatingItem = false;
    }
  });

  input.addEventListener("blur", async () => {
    await commit();
  });
}

function normPath(p) {
  return p.replace(/\\/g, "/");
}

function isExpandedTreePath(filePath) {
  return expandedTreePaths.has(normPath(filePath));
}

function setExpandedTreePath(filePath, expanded) {
  const key = normPath(filePath);
  if (expanded) expandedTreePaths.add(key);
  else expandedTreePaths.delete(key);
}

function projectName(folder) {
  return folder.replace(/[/\\]$/, "").split(/[/\\]/).pop() || folder;
}

function setExplorerRootExpanded(expanded) {
  explorerRootExpanded = Boolean(expanded);
  fileTree.hidden = !explorerRootExpanded || !rootPath;
  explorerRootToggle?.classList.toggle("collapsed", !explorerRootExpanded);
  explorerRootChevron?.classList.toggle("codicon-chevron-down", explorerRootExpanded);
  explorerRootChevron?.classList.toggle("codicon-chevron-right", !explorerRootExpanded);
}

function setProjectFolder(folder) {
  if (folder) {
    explorerTitle.textContent = projectName(folder).toUpperCase();
    explorerTitle.title = folder;
    explorerRootToggle.disabled = false;
    if (statusWorkspace) {
      statusWorkspace.textContent = projectName(folder);
      statusWorkspace.title = folder;
    }
  } else {
    explorerTitle.textContent = "NO FOLDER OPENED";
    explorerTitle.title = "";
    explorerRootToggle.disabled = true;
    if (statusWorkspace) {
      statusWorkspace.textContent = "No target";
      statusWorkspace.title = "";
    }
  }
  setExplorerRootExpanded(Boolean(folder));
  updateRunMenuState();
}

function loadRunCommands() {
  try {
    const raw = localStorage.getItem(RUN_COMMAND_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    localStorage.removeItem(RUN_COMMAND_KEY);
    return {};
  }
}

function runCommandKey() {
  return rootPath || "__global__";
}

function getRunCommand() {
  return loadRunCommands()[runCommandKey()] || "";
}

function setRunCommand(command) {
  const commands = loadRunCommands();
  const key = runCommandKey();
  const value = String(command || "").trim();
  if (value) commands[key] = value;
  else delete commands[key];
  localStorage.setItem(RUN_COMMAND_KEY, JSON.stringify(commands));
  updateRunMenuState();
}

function updateRunMenuState() {
  if (!menuRunCode) return;
  const command = getRunCommand();
  menuRunCode.disabled = !command;
  menuRunCode.title = command ? `Run: ${command}` : "Configure a run command first";
}

function squashAgentTurn(startIdx) {
  const tail = chatHistory.slice(startIdx + 1);
  if (!tail.length) return;

  const assistants = tail.filter((m) => m.role === "assistant" && (m.content || "").trim());
  const lastText = assistants.length
    ? assistants[assistants.length - 1].content.trim()
    : "";

  if (!lastText) return;

  chatHistory.splice(startIdx + 1, tail.length, { role: "assistant", content: lastText });
}

async function loadWorkspace(folder) {
  if (!folder) return false;

  const entries = await window.api.readdir(folder);
  if (entries.error) {
    localStorage.removeItem(WORKSPACE_KEY);
    return false;
  }

  rootPath = folder;
  selectedItem = null;
  expandedTreePaths.clear();
  localStorage.setItem(WORKSPACE_KEY, folder);
  setProjectFolder(folder);
  setExplorerActionsEnabled(true);
  TerminalManager.setCwd(folder);
  await renderTree(folder, fileTree, 0);
  await refreshDirMap();
  await TerminalManager.openWithProject(folder);
  await window.api.watchWorkspace?.(folder);
  updateContextUsage();
  if (!assessmentPath) {
    setAssessmentUiState("project", {
      title: projectName(folder),
      message: "Project active for Search, Terminal, and Chat. Create an assessment whenever you need Target tooling.",
    });
  }
  return true;
}

async function restoreLastWorkspace() {
  const saved = localStorage.getItem(WORKSPACE_KEY);
  if (saved) await loadWorkspace(saved);
}

// ── File Explorer ─────────────────────────────────────────────────────────────

btnOpenFolder?.addEventListener("click", openFolder);
btnSidebarMore?.addEventListener("click", () => openQuickPalette("command"));
activityExplorer?.addEventListener("click", () => {
  activateSidebarView("explorer");
});
activitySearch?.addEventListener("click", () => openQuickPalette("search"));
activityRun?.addEventListener("click", () => runActiveCode());
activityBugBounty?.addEventListener("click", () => {
  const switchingWorkspace = currentWorkspaceMode === "security";
  showResourceWorkspace({ focus: true });
  if (switchingWorkspace) {
    setSidebarView("bugbounty");
    if (sidebarCollapsed) setSidebarCollapsed(false);
  } else {
    activateSidebarView("bugbounty");
  }
});
activitySecurity?.addEventListener("click", () => showSecurityWorkspace());
activityTerminal?.addEventListener("click", () => {
  setTerminalCollapsed(!terminalCollapsed);
  if (!terminalCollapsed) TerminalManager.focusActive();
});
activityChat?.addEventListener("click", () => {
  if (chatCollapsed) openChatPane({ createIfEmpty: true });
  else setChatCollapsed(true);
});
activitySettings?.addEventListener("click", () => openQuickPalette("command"));
btnBugBountyMore?.addEventListener("click", () => openQuickPalette("command"));
btnCreateProjectHeader?.addEventListener("click", createProject);
btnCreateProject?.addEventListener("click", createProject);
btnCreateAssessment?.addEventListener("click", createAssessmentFolder);
btnOpenAssessment?.addEventListener("click", openAssessmentFolder);
bugBountyRepair?.addEventListener("click", repairAssessmentFolder);
securityToolButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = securityToolMenu.hidden;
  securityToolMenu.hidden = !opening;
  securityToolButton.setAttribute("aria-expanded", String(opening));
  const chevron = securityToolButton.querySelector(".security-tool-chevron");
  chevron?.classList.toggle("codicon-chevron-up", opening);
  chevron?.classList.toggle("codicon-chevron-down", !opening);
});
securityToolMenu?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-security-tool]");
  if (!option) return;
  event.stopPropagation();
  showSecurityWorkspace(option.dataset.securityTool);
});
securityRunButton?.addEventListener("click", runSecurityWorkbench);
securityHistoryToggle?.addEventListener("click", () => setSecurityHistoryVisible(securityHistoryPanel?.hidden));
securityHistoryRefresh?.addEventListener("click", loadSecurityHistory);
securityInterceptToggle?.addEventListener("click", toggleInterceptorCapture);
securityAnalyzeButton?.addEventListener("click", analyzeSecurityExchange);
securityClearButton?.addEventListener("click", clearSecurityExchange);
securityDropButton?.addEventListener("click", dropInterceptedRequest);
btnShowProxyCa?.addEventListener("click", async () => {
  const result = await window.api.proxyShowCa();
  if (result?.error) syncProxyListenerUi({ error: result.error });
});
securityRequestEditor?.addEventListener("input", syncSecurityExchangeSizes);
securityResponseEditor?.addEventListener("input", syncSecurityExchangeSizes);
terminalShellTab?.addEventListener("click", () => TerminalManager.focusActive());
document.addEventListener("click", (event) => {
  if (!securityToolMenu?.hidden && !securityToolSwitcher?.contains(event.target)) closeSecurityToolMenu();
});
bugBountyTree?.addEventListener("click", async (event) => {
  const toggle = event.target.closest(".bounty-phase-toggle");
  if (toggle) {
    const phase = toggle.closest(".bounty-phase");
    setBugBountyPhaseExpanded(phase, !phase.classList.contains("expanded"));
    return;
  }

  const item = event.target.closest("[data-bounty-item]");
  if (!item) return;
  bugBountyTree.querySelectorAll("[data-bounty-item].selected").forEach((node) => {
    node.classList.remove("selected");
    node.setAttribute("aria-selected", "false");
  });
  item.classList.add("selected");
  item.setAttribute("aria-selected", "true");
  localStorage.setItem(BUG_BOUNTY_SELECTED_KEY, item.dataset.bountyItem);
  await openAssessmentItem(item);
});
explorerRootToggle?.addEventListener("click", () => {
  if (!rootPath) return;
  setExplorerRootExpanded(!explorerRootExpanded);
});

async function openFolder() {
  const folder = await window.api.openFolder();
  if (!folder) return;
  await loadWorkspace(folder);
}

async function openFileDialog() {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const fileName = filePath.split(/[/\\]/).pop();
  await openFile(filePath, fileName);
}

function closeAppMenus() {
  appMenu?.querySelectorAll(".app-menu-dropdown").forEach((panel) => {
    panel.hidden = true;
  });
  appMenu?.querySelectorAll(".app-menu-button.active").forEach((button) => {
    button.classList.remove("active");
  });
}

function toggleAppMenu(name) {
  if (!appMenu) return;
  const panel = appMenu.querySelector(`[data-menu-panel="${CSS.escape(name)}"]`);
  const button = appMenu.querySelector(`[data-menu="${CSS.escape(name)}"]`);
  if (!panel || !button) return;
  const opening = panel.hidden;
  closeAppMenus();
  panel.hidden = !opening;
  button.classList.toggle("active", opening);
  if (name === "run") updateRunMenuState();
}

function configureRunCommand() {
  const current = getRunCommand();
  const hint = activeTabPath && openTabs.has(activeTabPath)
    ? `Example: python ${openTabs.get(activeTabPath).name}`
    : "Example: python main.py";
  const value = prompt(`Command to run from the project folder:\n${hint}`, current);
  if (value === null) return;
  setRunCommand(value);
}

async function runConfiguredCommand() {
  const command = getRunCommand();
  if (!command) return;
  await TerminalManager.runCommand(command);
}

function runMenuAction(action) {
  const focusedActions = new Set([
    "new-terminal",
    "clear-terminal",
    "kill-terminal",
    "toggle-terminal",
    "toggle-chat",
    "command-palette",
    "quick-open",
    "workspace-search",
    "create-project",
    "create-assessment",
    "open-assessment",
    "new-chat",
    "about",
  ]);
  if (!focusedActions.has(action)) return;
  switch (action) {
    case "new-file":
      if (!rootPath) {
        alert("Open a folder first.");
        return;
      }
      createNewItemInput(false);
      break;
    case "new-folder":
      if (!rootPath) {
        alert("Open a folder first.");
        return;
      }
      createNewItemInput(true);
      break;
    case "open-file":
      openFileDialog();
      break;
    case "open-folder":
      openFolder();
      break;
    case "new-terminal":
      TerminalManager.createTerminalAndShow();
      break;
    case "clear-terminal":
      TerminalManager.clearActive();
      break;
    case "kill-terminal":
      TerminalManager.killTerminal();
      break;
    case "undo":
    case "redo":
    case "cut":
    case "copy":
    case "paste":
      document.execCommand(action);
      break;
    case "toggle-terminal":
      setTerminalCollapsed(!terminalCollapsed);
      break;
    case "toggle-chat":
      if (chatCollapsed) openChatPane({ createIfEmpty: true });
      else setChatCollapsed(true);
      break;
    case "command-palette":
      openQuickPalette("command");
      break;
    case "quick-open":
      openQuickPalette("file");
      break;
    case "workspace-search":
      openQuickPalette("search");
      break;
    case "create-project":
      createProject();
      break;
    case "create-assessment":
      createAssessmentFolder();
      break;
    case "open-assessment":
      openAssessmentFolder();
      break;
    case "new-chat":
      newChatSession();
      break;
    case "about":
      alert("Pointer - local-first search, target, terminal, and chat workspace");
      break;
    case "configure-run":
      configureRunCommand();
      break;
    case "run-code":
      runConfiguredCommand();
      break;
    default:
      break;
  }
}

appMenu?.addEventListener("click", (e) => {
  const menuButton = e.target.closest("[data-menu]");
  if (menuButton) {
    e.stopPropagation();
    toggleAppMenu(menuButton.dataset.menu);
    return;
  }

  const actionButton = e.target.closest("[data-action]");
  if (!actionButton || actionButton.disabled) return;
  e.stopPropagation();
  const action = actionButton.dataset.action;
  closeAppMenus();
  runMenuAction(action);
});

document.addEventListener("click", (e) => {
  if (appMenu?.contains(e.target)) return;
  closeAppMenus();
});

window.api.onMenuAction((action) => {
  runMenuAction(action);
});

function setAgentStatus(text) {
  if (statusAgent) statusAgent.textContent = text || "Agent ready";
}

function quickShortcutLabel(keys) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return keys.replace(/Ctrl/g, isMac ? "Cmd" : "Ctrl");
}

function basenameOf(filePath) {
  return String(filePath || "").replace(/\\/g, "/").split("/").pop() || "";
}

function scoreQuickMatch(text, query) {
  const hay = String(text || "").toLowerCase();
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return 1;
  if (hay === clean) return 1000;
  if (hay.startsWith(clean)) return 700;
  if (hay.includes(clean)) return 500 - hay.indexOf(clean);

  let pos = -1;
  let score = 0;
  for (const char of clean) {
    pos = hay.indexOf(char, pos + 1);
    if (pos < 0) return 0;
    score += Math.max(1, 40 - pos);
  }
  return score;
}

function buildCommandItems() {
  return [
    {
      title: "Search: Open Workspace File",
      detail: rootPath ? "Open a file by name" : "Create or open a project first",
      icon: "codicon-go-to-file",
      key: quickShortcutLabel("Ctrl+P"),
      disabled: !rootPath,
      run: () => openQuickPalette("file"),
    },
    {
      title: "Search: Target Workspace",
      detail: rootPath ? `Search ${assessmentFolderName(rootPath)}` : "Open a target first",
      icon: "codicon-search",
      key: quickShortcutLabel("Ctrl+Shift+F"),
      disabled: !rootPath,
      run: () => openQuickPalette("search"),
    },
    {
      title: "Target: Create New Project",
      detail: "Create an empty workspace for Search, Terminal, and Chat",
      icon: "codicon-folder-library",
      run: () => createProject(),
    },
    {
      title: "Target: Create Assessment",
      detail: "Create and verify a new assessment workspace",
      icon: "codicon-target",
      run: () => createAssessmentFolder(),
    },
    {
      title: "Target: Open Assessment",
      detail: assessmentPath || "Choose an existing assessment folder",
      icon: "codicon-folder-library",
      run: () => openAssessmentFolder(),
    },
    {
      title: "Target: Repair Assessment",
      detail: assessmentVerification?.valid ? "Assessment structure is complete" : "Recreate missing required items",
      icon: "codicon-tools",
      disabled: !assessmentPath || assessmentVerification?.valid,
      run: () => repairAssessmentFolder(),
    },
    {
      title: "Security: Open Workbench",
      detail: "Show Interceptor, Repeater, and Intruder in the workspace",
      icon: "codicon-shield",
      run: () => showSecurityWorkspace(),
    },
    {
      title: "Terminal: Toggle",
      detail: terminalCollapsed ? "Show terminal" : "Hide terminal",
      icon: "codicon-terminal",
      key: "Ctrl+`",
      run: () => setTerminalCollapsed(!terminalCollapsed),
    },
    {
      title: "Terminal: New Session",
      detail: "Create a new shell session",
      icon: "codicon-add",
      key: "Ctrl+Shift+`",
      run: () => TerminalManager.createTerminalAndShow(),
    },
    {
      title: "Terminal: Clear",
      detail: "Clear the active shell",
      icon: "codicon-clear-all",
      run: () => TerminalManager.clearActive(),
    },
    {
      title: "Chat: Toggle",
      detail: chatCollapsed ? "Show chat" : "Hide chat",
      icon: "codicon-comment-discussion",
      run: () => chatCollapsed ? openChatPane({ createIfEmpty: true }) : setChatCollapsed(true),
    },
    {
      title: "Chat: New Session",
      detail: "Start a fresh chat",
      icon: "codicon-add",
      disabled: streaming,
      run: () => newChatSession(),
    },
  ];
}

function buildLegacyCommandItems() {
  const hasFolder = Boolean(rootPath);
  const hasActiveFile = Boolean(activeTabPath && openTabs.has(activeTabPath));
  const command = getRunCommand();
  return [
    {
      title: "File: New File",
      detail: hasFolder ? "Create a file in the explorer" : "Open a folder first",
      icon: "codicon-new-file",
      key: quickShortcutLabel("Ctrl+N"),
      disabled: !hasFolder,
      run: () => createNewItemInput(false),
    },
    {
      title: "File: New Folder",
      detail: hasFolder ? "Create a folder in the explorer" : "Open a folder first",
      icon: "codicon-new-folder",
      disabled: !hasFolder,
      run: () => createNewItemInput(true),
    },
    {
      title: "File: Open Folder",
      detail: "Choose a project folder",
      icon: "codicon-folder-opened",
      run: () => openFolder(),
    },
    {
      title: "File: Save",
      detail: hasActiveFile ? openTabs.get(activeTabPath).name : "No active editor",
      icon: "codicon-save",
      key: quickShortcutLabel("Ctrl+S"),
      disabled: !hasActiveFile,
      run: () => saveActiveTab(),
    },
    {
      title: "File: Close Editor",
      detail: hasActiveFile ? openTabs.get(activeTabPath).name : "No active editor",
      icon: "codicon-close",
      key: quickShortcutLabel("Ctrl+W"),
      disabled: !hasActiveFile,
      run: () => closeTab(activeTabPath),
    },
    {
      title: "Go: Quick Open",
      detail: "Open a workspace file by name",
      icon: "codicon-go-to-file",
      key: quickShortcutLabel("Ctrl+P"),
      disabled: !hasFolder,
      run: () => openQuickPalette("file"),
    },
    {
      title: "Search: Workspace Search",
      detail: "Search indexed code and open matching files",
      icon: "codicon-search",
      key: quickShortcutLabel("Ctrl+Shift+F"),
      disabled: !hasFolder,
      run: () => openQuickPalette("search"),
    },
    {
      title: "View: Explorer",
      detail: "Show the workspace file explorer",
      icon: "codicon-files",
      run: () => activateSidebarView("explorer"),
    },
    {
      title: "View: BugBounty Mode",
      detail: "Show security assessment phases",
      icon: "codicon-target",
      run: () => activateSidebarView("bugbounty"),
    },
    {
      title: "BugBounty: Create Assessment Folder",
      detail: "Create and verify a new assessment workspace",
      icon: "codicon-new-folder",
      run: () => createAssessmentFolder(),
    },
    {
      title: "BugBounty: Open Existing Assessment",
      detail: assessmentPath || "Choose an assessment folder",
      icon: "codicon-folder-opened",
      run: () => openAssessmentFolder(),
    },
    {
      title: "BugBounty: Repair Assessment Structure",
      detail: assessmentVerification?.valid ? "Assessment structure is complete" : "Recreate missing required items",
      icon: "codicon-tools",
      disabled: !assessmentPath || assessmentVerification?.valid,
      run: () => repairAssessmentFolder(),
    },
    {
      title: "View: Toggle Terminal",
      detail: terminalCollapsed ? "Show terminal panel" : "Hide terminal panel",
      icon: "codicon-terminal",
      key: "Ctrl+`",
      run: () => setTerminalCollapsed(!terminalCollapsed),
    },
    {
      title: "View: Toggle Chat",
      detail: chatCollapsed ? "Show AI chat" : "Hide AI chat",
      icon: "codicon-comment-discussion",
      run: () => {
        if (chatCollapsed) openChatPane({ createIfEmpty: true });
        else setChatCollapsed(true);
      },
    },
    {
      title: "Terminal: New Terminal",
      detail: "Create a new shell session",
      icon: "codicon-terminal",
      key: "Ctrl+Shift+`",
      run: () => TerminalManager.createTerminalAndShow(),
    },
    {
      title: "Run: Run Configured Command",
      detail: command || "Configure a run command first",
      icon: "codicon-play",
      disabled: !command,
      run: () => runConfiguredCommand(),
    },
    {
      title: "Run: Configure Run Command",
      detail: "Set the command used by Run Code",
      icon: "codicon-settings-gear",
      run: () => configureRunCommand(),
    },
    {
      title: "Chat: New Agent Chat",
      detail: "Start a fresh chat session",
      icon: "codicon-add",
      disabled: streaming,
      run: () => newChatSession(),
    },
    {
      title: "Chat: Ask Mode",
      detail: "Answer questions without editing files",
      icon: "codicon-comment",
      disabled: streaming,
      run: () => setChatMode("ask"),
    },
    {
      title: "Chat: Plan Mode",
      detail: "Inspect and produce a plan without changing files",
      icon: "codicon-checklist",
      disabled: streaming,
      run: () => setChatMode("plan"),
    },
    {
      title: "Chat: Agent Mode",
      detail: "Autonomously inspect, edit, and verify",
      icon: "codicon-tools",
      disabled: streaming,
      run: () => setChatMode("agent"),
    },
  ];
}

function quickFileItems(query) {
  const files = ToolParser.parseProjectFiles(dirMapCache || "");
  return files
    .map((file) => {
      const name = basenameOf(file);
      const info = fileIconInfo(name);
      const score = Math.max(
        scoreQuickMatch(name, query) + 40,
        scoreQuickMatch(file, query),
      );
      return {
        title: name,
        detail: file,
        icon: `${info.icon} ${info.className}`,
        score,
        run: () => showResourcePreview(joinWorkspacePath(file), name, file, { icon: info.icon }),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.detail.localeCompare(b.detail))
    .slice(0, 80);
}

function parseSnippetLine(snippet) {
  const match = String(snippet || "").match(/^\s*(\d+):/m);
  return match ? Number(match[1]) : 1;
}

function firstSnippetLine(snippet) {
  return String(snippet || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+:\s?/, "").trim())
    .find(Boolean) || "";
}

function setQuickModeUi(mode) {
  const labels = {
    command: ["codicon-chevron-right", "Type a command", "Command Palette"],
    file: ["codicon-go-to-file", "Search files by name", "Quick Open"],
    search: ["codicon-search", "Search workspace text", "Workspace Search"],
  };
  const [icon, placeholder, title] = labels[mode] || labels.command;
  quickPanel?.setAttribute("aria-label", title);
  if (quickInput) quickInput.placeholder = placeholder;
  if (quickIcon) quickIcon.className = `codicon ${icon}`;
}

function renderQuickList(items, metaText = "") {
  quickItems = items;
  quickSelection = Math.max(0, Math.min(quickSelection, quickItems.length - 1));
  if (quickMeta) quickMeta.textContent = metaText;
  if (!quickResults) return;
  quickResults.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "quick-empty";
    empty.textContent = metaText || "No results";
    quickResults.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `quick-result${index === quickSelection ? " active" : ""}`;
    row.innerHTML = `
      <span class="codicon ${escapeHtml(item.icon || "codicon-chevron-right")} quick-result-icon"></span>
      <span class="quick-result-main">
        <span class="quick-result-title">${escapeHtml(item.title || "")}</span>
        <span class="quick-result-detail">${escapeHtml(item.detail || "")}</span>
      </span>
      <span class="quick-result-key">${escapeHtml(item.key || "")}</span>
    `;
    row.addEventListener("mouseenter", () => {
      quickSelection = index;
      syncQuickSelection();
    });
    row.addEventListener("click", () => runSelectedQuickItem(index));
    quickResults.appendChild(row);
  });
}

function syncQuickSelection() {
  if (!quickResults) return;
  [...quickResults.querySelectorAll(".quick-result")].forEach((row, index) => {
    row.classList.toggle("active", index === quickSelection);
    if (index === quickSelection) row.scrollIntoView({ block: "nearest" });
  });
}

function renderCommandPalette() {
  const query = quickInput?.value || "";
  const items = buildCommandItems()
    .filter((item) => !item.disabled)
    .map((item) => ({
      ...item,
      score: Math.max(
        scoreQuickMatch(item.title, query),
        scoreQuickMatch(item.detail, query) * 0.6,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  renderQuickList(items, `${items.length} command${items.length === 1 ? "" : "s"}`);
}

function renderQuickFiles() {
  const query = quickInput?.value || "";
  if (!rootPath) {
    renderQuickList([], "Open a folder to use Quick Open");
    return;
  }
  const items = quickFileItems(query);
  renderQuickList(items, `${items.length} file${items.length === 1 ? "" : "s"}`);
}

function renderWorkspaceSearch() {
  const query = (quickInput?.value || "").trim();
  if (!rootPath) {
    renderQuickList([], "Create or open a Target to search its workspace");
    return;
  }
  if (quickSearchTimer) clearTimeout(quickSearchTimer);
  if (query.length < 2) {
    renderQuickList([], "Type at least 2 characters to search");
    return;
  }

  const seq = ++quickSearchSeq;
  if (quickMeta) quickMeta.textContent = "Searching...";
  quickSearchTimer = setTimeout(async () => {
    const result = await window.api.searchWorkspace({ workspace: rootPath, query, limit: 18 });
    if (seq !== quickSearchSeq || quickMode !== "search") return;
    if (result?.error) {
      renderQuickList([], result.error);
      return;
    }
    const items = (result.results || []).map((row) => {
      const name = basenameOf(row.path);
      const info = fileIconInfo(name);
      const line = parseSnippetLine(row.snippet);
      return {
        title: row.path,
        detail: firstSnippetLine(row.snippet),
        icon: `${info.icon} ${info.className}`,
        key: `L${line}`,
        run: async () => {
          await showResourcePreview(joinWorkspacePath(row.path), name, `${row.path} · line ${line}`, {
            icon: info.icon,
            line,
          });
        },
      };
    });
    renderQuickList(items, `${items.length} result${items.length === 1 ? "" : "s"}`);
  }, 120);
}

function renderQuickPalette() {
  if (quickMode === "file") renderQuickFiles();
  else if (quickMode === "search") renderWorkspaceSearch();
  else renderCommandPalette();
}

async function openQuickPalette(mode = "command", initialValue = "") {
  if (!quickOverlay || !quickInput) return;
  quickMode = mode;
  quickSelection = 0;
  setQuickModeUi(mode);
  if (rootPath && !dirMapCache) await refreshDirMap();
  quickInput.value = initialValue;
  quickOverlay.hidden = false;
  renderQuickPalette();
  requestAnimationFrame(() => {
    quickInput.focus();
    quickInput.select();
  });
}

function closeQuickPalette() {
  if (quickOverlay) quickOverlay.hidden = true;
  if (quickSearchTimer) clearTimeout(quickSearchTimer);
  quickSearchSeq += 1;
  quickItems = [];
  if (activeTabPath) EditorManager.focus();
  else chatInput?.focus();
}

async function runSelectedQuickItem(index = quickSelection) {
  const item = quickItems[index];
  if (!item) return;
  closeQuickPalette();
  await item.run?.();
}

quickInput?.addEventListener("input", () => {
  quickSelection = 0;
  renderQuickPalette();
});

quickInput?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeQuickPalette();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    quickSelection = quickItems.length ? (quickSelection + 1) % quickItems.length : 0;
    syncQuickSelection();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    quickSelection = quickItems.length ? (quickSelection - 1 + quickItems.length) % quickItems.length : 0;
    syncQuickSelection();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    runSelectedQuickItem();
  }
});

quickOverlay?.addEventListener("mousedown", (e) => {
  if (quickPanel?.contains(e.target)) return;
  closeQuickPalette();
});

commandCenter?.addEventListener("click", () => openQuickPalette("search"));

chatModeButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChatModeMenu();
});

chatModeMenu?.addEventListener("click", (e) => {
  const button = e.target.closest("[data-chat-mode]");
  if (!button) return;
  e.stopPropagation();
  setChatMode(button.dataset.chatMode);
});

async function renderTree(dirPath, container, depth) {
  container.innerHTML = "";
  const entries = await window.api.readdir(dirPath);

  if (entries.error) {
    container.innerHTML = `<div class="tree-item dimmed">${entries.error}</div>`;
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDir ? "tree-dir" : "tree-file"}`;
    item.style.paddingLeft = `${depth * 8 + 8}px`;
    item.dataset.path  = entry.path;
    item.dataset.isDir = entry.isDir;

    const chevron = document.createElement("span");
    chevron.className = entry.isDir
      ? "tree-chevron codicon codicon-chevron-right"
      : "tree-chevron codicon hidden";

    const icon = document.createElement("span");
    if (entry.isDir) {
      icon.className = "tree-icon codicon codicon-folder";
    } else {
      const info = fileIconInfo(entry.name);
      icon.className = `tree-file-icon codicon ${info.icon} ${info.className}`;
    }

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    item.appendChild(chevron);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    if (entry.isDir) {
      const children = document.createElement("div");
      children.className = "tree-children";
      children.style.display = "none";
      container.appendChild(children);

      let expanded = isExpandedTreePath(entry.path);

      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item);
        expanded = !expanded;
        setExpandedTreePath(entry.path, expanded);
        chevron.classList.toggle("expanded", expanded);
        icon.className = `tree-icon codicon ${expanded ? "codicon-folder-opened" : "codicon-folder"}`;
        children.style.display = expanded ? "block" : "none";
        if (expanded && children.childElementCount === 0) {
          children.innerHTML = `<div class="tree-item dimmed" style="padding-left:${(depth + 1) * 8 + 24}px">Loading…</div>`;
          await renderTree(entry.path, children, depth + 1);
        }
      });

      if (expanded) {
        chevron.classList.add("expanded");
        icon.className = "tree-icon codicon codicon-folder-opened";
        children.style.display = "block";
        await renderTree(entry.path, children, depth + 1);
      }
    } else {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item);
        await openFile(entry.path, entry.name);
      });
    }
  }
}

function selectItem(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el || null;
  if (selectedItem) selectedItem.classList.add("selected");
  if (btnDeleteItem) btnDeleteItem.disabled = !rootPath || !selectedItem;
}

async function rerenderExplorer({ preserveSelectionPath = selectedItem?.dataset.path || null } = {}) {
  if (!rootPath) return;
  await renderTree(rootPath, fileTree, 0);
  const selectedPath = preserveSelectionPath ? normPath(preserveSelectionPath) : null;
  if (!selectedPath) {
    selectItem(null);
    return;
  }
  const nextSelected = [...fileTree.querySelectorAll(".tree-item")].find(
    (item) => normPath(item.dataset.path || "") === selectedPath,
  );
  selectItem(nextSelected || null);
}

function clearExpandedTreePathsUnder(absPath) {
  const prefix = normPath(absPath);
  for (const item of [...expandedTreePaths]) {
    if (item === prefix || item.startsWith(`${prefix}/`)) {
      expandedTreePaths.delete(item);
    }
  }
}

function closeTabsUnderWorkspacePath(absPath) {
  const target = normPath(absPath);
  for (const tabPath of [...openTabs.keys()]) {
    if (tabPath === target || tabPath.startsWith(`${target}/`)) {
      closeTab(tabPath);
    }
  }
}

async function deleteSelectedExplorerItem() {
  if (!rootPath || !selectedItem) return;
  const absPath = selectedItem.dataset.path;
  const relPath = relativePathFromRoot(absPath);
  const isDir = selectedItem.dataset.isDir === "true";
  if (!relPath) return;

  const label = selectedItem.querySelector(".tree-name")?.textContent || relPath;
  const confirmed = confirm(
    isDir
      ? `Delete folder "${label}" and everything inside it?`
      : `Delete file "${label}"?`,
  );
  if (!confirmed) return;

  const result = await window.api.deletePath({
    workspace: rootPath,
    path: relPath,
  });
  if (result?.error) {
    alert(`Delete failed: ${result.error}`);
    return;
  }

  closeTabsUnderWorkspacePath(absPath);
  clearExpandedTreePathsUnder(absPath);
  contextFilesCache = contextFilesCache.filter((file) => file.path !== relPath && !file.path.startsWith(`${relPath}/`));
  await refreshDirMap();
  await rerenderExplorer({ preserveSelectionPath: null });
}

// ── Tabs & Editor ─────────────────────────────────────────────────────────────

function isAssessmentSettingsTab(tab) {
  return tab?.name === "settings.config";
}

function nestedSettingValue(object, settingPath) {
  return String(settingPath || "").split(".").reduce((value, key) => value?.[key], object);
}

function setNestedSettingValue(object, settingPath, value) {
  const keys = String(settingPath || "").split(".").filter(Boolean);
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  if (keys.length) target[keys.at(-1)] = value;
}

function parseSettingsTab(tab) {
  try {
    const parsed = JSON.parse(String(tab?.content || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed }
      : { error: "settings.config must contain a JSON object." };
  } catch (error) {
    return { error: `settings.config contains invalid JSON: ${error.message}` };
  }
}

function renderSettingsForm(tab) {
  const parsed = parseSettingsTab(tab);
  if (parsed.error) return parsed;
  settingsUIView.querySelectorAll("[data-setting-path]").forEach((input) => {
    const value = nestedSettingValue(parsed.value, input.dataset.settingPath);
    if (input.dataset.settingType === "boolean") input.checked = Boolean(value);
    else input.value = value == null ? "" : String(value);
  });
  return { ok: true };
}

function syncSettingsEditorButtons() {
  const uiActive = settingsEditorMode === "ui";
  settingsViewJson.classList.toggle("active", !uiActive);
  settingsViewJson.setAttribute("aria-pressed", String(!uiActive));
  settingsViewUi.classList.toggle("active", uiActive);
  settingsViewUi.setAttribute("aria-pressed", String(uiActive));
}

async function setSettingsEditorMode(mode) {
  const next = mode === "ui" ? "ui" : "json";
  const tab = activeTabPath ? openTabs.get(activeTabPath) : null;
  if (!isAssessmentSettingsTab(tab) || settingsEditorMode === next) return;
  if (settingsEditorMode === "json") commitActiveTab();
  if (next === "ui") {
    const parsed = parseSettingsTab(tab);
    if (parsed.error) {
      editorError.textContent = parsed.error;
      editorError.hidden = false;
      return;
    }
  }
  settingsEditorMode = next;
  localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, next);
  editorLoadedPath = null;
  syncSettingsEditorButtons();
  await renderEditor();
}

function updateSettingFromInput(input) {
  if (!activeTabPath) return;
  const tab = openTabs.get(activeTabPath);
  if (!isAssessmentSettingsTab(tab)) return;
  const parsed = parseSettingsTab(tab);
  if (parsed.error) return;
  let value = input.value;
  if (input.dataset.settingType === "boolean") value = input.checked;
  if (input.dataset.settingType === "number") {
    const number = Number(input.value);
    value = Number.isFinite(number) ? number : null;
  }
  setNestedSettingValue(parsed.value, input.dataset.settingPath, value);
  tab.content = `${JSON.stringify(parsed.value, null, 2)}\n`;
  tab.dirty = tab.content !== tab.savedContent;
  assessmentSettingsCache = parsed.value;
  syncInterceptorToggleUi(parsed.value);
  updateTabDirtyIndicator();
  scheduleSettingsAutoSave();
}

function syncOpenSettingsTabContent(settings) {
  if (!settings || typeof settings !== "object") return;
  for (const tab of openTabs.values()) {
    if (!isAssessmentSettingsTab(tab)) continue;
    const nextContent = `${JSON.stringify(settings, null, 2)}\n`;
    tab.content = nextContent;
    tab.dirty = nextContent !== tab.savedContent;
    updateTabDirtyIndicator();
    if (settingsEditorMode === "ui" && activeTabPath === tab.path) renderSettingsForm(tab);
  }
}

function isInterceptionActive(settings = assessmentSettingsCache) {
  return Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
}

function syncInterceptorToggleUi(settings = assessmentSettingsCache) {
  if (!securityInterceptToggle) return;
  const active = isInterceptionActive(settings);
  securityInterceptToggle.classList.toggle("active", active);
  securityInterceptToggle.setAttribute("aria-pressed", String(active));
  securityInterceptToggle.disabled = !assessmentPath;
  if (securityInterceptToggleLabel) {
    securityInterceptToggleLabel.textContent = active ? "Intercept On" : "Intercept Off";
  }
  if (securityInterceptToggleIcon) {
    securityInterceptToggleIcon.classList.toggle("codicon-debug-pause", active);
    securityInterceptToggleIcon.classList.toggle("codicon-debug-start", !active);
  }
}

async function refreshAssessmentSettingsCache() {
  if (!assessmentPath) {
    assessmentSettingsCache = null;
    syncInterceptorToggleUi(null);
    return null;
  }
  const result = await window.api.assessmentSettings({ path: assessmentPath });
  if (result?.error) {
    assessmentSettingsCache = null;
    syncInterceptorToggleUi(null);
    return result;
  }
  assessmentSettingsCache = result.settings;
  syncInterceptorToggleUi(assessmentSettingsCache);
  return result;
}

async function saveAssessmentSettings(settings) {
  if (!assessmentPath) return { error: "No assessment open" };
  const result = await window.api.assessmentWriteSettings({ path: assessmentPath, settings });
  if (result?.error) return result;
  assessmentSettingsCache = result.settings;
  syncOpenSettingsTabContent(result.settings);
  syncInterceptorToggleUi(result.settings);
  await configureProxyListener();
  return result;
}

async function toggleInterceptorCapture() {
  if (!assessmentPath) {
    setSecurityStatus("Create or open an assessment first", "error");
    return;
  }
  const current = assessmentSettingsCache || (await refreshAssessmentSettingsCache())?.settings;
  if (!current) {
    setSecurityStatus("Could not read settings.config", "error");
    return;
  }
  const nextSettings = JSON.parse(JSON.stringify(current));
  if (!nextSettings.interception || typeof nextSettings.interception !== "object") nextSettings.interception = {};
  const turningOn = !isInterceptionActive(nextSettings);
  nextSettings.interception.enabled = turningOn;
  nextSettings.interception.interceptRequests = turningOn;
  const result = await saveAssessmentSettings(nextSettings);
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  setSecurityStatus(turningOn ? "Request interception enabled" : "Request interception disabled — traffic passes through");
}

function syncProxyListenerUi(nextState = {}) {
  proxyListenerState = { ...proxyListenerState, ...nextState };
  if (proxyListenerStatus) {
    proxyListenerStatus.classList.toggle("running", Boolean(proxyListenerState.running && !proxyListenerState.warning));
    proxyListenerStatus.classList.toggle("error", Boolean(proxyListenerState.error || proxyListenerState.warning));
    proxyListenerStatus.textContent = proxyListenerState.error
      ? proxyListenerState.error
      : proxyListenerState.running
        ? proxyListenerState.warning || `Listening on ${proxyListenerState.host}:${proxyListenerState.port} - ${proxyListenerState.targetCount ?? 0} scoped target${proxyListenerState.targetCount === 1 ? "" : "s"}`
        : "Stopped";
  }
  if (proxyCaPath) proxyCaPath.value = proxyListenerState.caCertPath || "Generated when the listener starts";
  if (selectedSecurityTool === "interceptor" && proxyListenerState.running && !currentProxyCaptureId) {
    setSecurityStatus(proxyListenerState.warning || `Listening on ${proxyListenerState.host}:${proxyListenerState.port}`,
      proxyListenerState.warning ? "error" : "");
  }
}

async function configureProxyListener() {
  try {
    const result = await window.api.proxyConfigure({ assessmentPath });
    syncProxyListenerUi(result || {});
    return result;
  } catch (error) {
    const result = { error: error?.message || "Proxy listener configuration failed", running: false };
    syncProxyListenerUi(result);
    return result;
  }
}

function scheduleSettingsAutoSave() {
  clearTimeout(settingsAutoSaveTimer);
  settingsAutoSaveTimer = setTimeout(async () => {
    const tab = activeTabPath ? openTabs.get(activeTabPath) : null;
    if (!isAssessmentSettingsTab(tab) || !tab.dirty) return;
    await saveActiveTab();
  }, 450);
}

function handleProxyCapture(payload = {}) {
  const phase = payload.phase;
  if (phase === "error") {
    if (payload.id === currentProxyCaptureId) setSecurityStatus(payload.error || "Proxy capture failed", "error");
    return;
  }
  if (phase === "status") {
    if (payload.id === currentProxyCaptureId) setSecurityStatus(payload.status || "Updated");
    return;
  }

  const draft = securityDrafts.get("interceptor") || {};
  if (payload.request != null) draft.request = String(payload.request);
  if (payload.response != null) draft.response = String(payload.response);
  securityDrafts.set("interceptor", draft);

  if (currentSidebarView === "bugbounty") {
    if (selectedSecurityTool !== "interceptor") setSecurityTool("interceptor");
    if (payload.request != null) securityRequestEditor.value = String(payload.request);
    if (payload.response != null) securityResponseEditor.value = String(payload.response);
    syncSecurityExchangeSizes();
  }

  if (phase === "request") {
    currentProxyCaptureId = payload.paused ? String(payload.id || "") : "";
    securityDropButton.hidden = !payload.paused;
    setSecurityStatus(payload.paused ? `Intercepted ${payload.url} - waiting for Forward or Drop` : `Captured ${payload.url}`);
  } else if (phase === "response-headers") {
    setSecurityStatus(`Receiving ${payload.url}`);
  } else if (phase === "response") {
    currentProxyCaptureId = "";
    securityDropButton.hidden = true;
    lastLoggedSecuritySignature = securityExchangeSignature();
    setSecurityStatus(`Captured and logged ${payload.logged?.timestamp || ""}`, payload.logged?.error ? "error" : "success");
    refreshSecurityHistoryIfVisible();
  }
}

async function openFile(filePath, fileName) {
  const path = normPath(filePath);

  if (openTabs.has(path)) {
    switchToTab(path);
    return;
  }

  openTabs.set(path, {
    path,
    diskPath: filePath,
    name: fileName,
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
  });
  renderTabs();
  switchToTab(path);
  renderEditor();

  const result = await window.api.readFile(filePath);
  const tab = openTabs.get(path);
  if (!tab) return;

  if (result.error) {
    tab.error = result.error;
    tab.content = null;
  } else {
    const text = result.content ?? "";
    tab.content = text;
    tab.savedContent = text;
    tab.dirty = false;
    tab.error = null;
  }

  if (activeTabPath === path) {
    renderEditor();
  }
}

function commitActiveTab() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) return;
  const tab = openTabs.get(activeTabPath);
  if (tab.error || tab.content === null) return;
  if (isAssessmentSettingsTab(tab) && settingsEditorMode === "ui") {
    tab.dirty = tab.content !== tab.savedContent;
    return;
  }
  tab.content = EditorManager.getValue(activeTabPath);
  tab.dirty = tab.content !== tab.savedContent;
}

function switchToTab(filePath) {
  if (!openTabs.has(filePath)) return;
  commitActiveTab();
  activeTabPath = filePath;
  editorLoadedPath = null;
  renderTabs();
  renderEditor();
}

async function saveActiveTab() {
  commitActiveTab();
  if (!activeTabPath) return;
  const tab = openTabs.get(activeTabPath);
  if (!tab || tab.error) return;
  if (!tab.dirty) {
    EditorManager.clearChangeDecorations(activeTabPath);
    if (isAssessmentSettingsTab(tab)) await configureProxyListener();
    return;
  }

  const result = await window.api.writeFile(tab.diskPath, tab.content);
  if (result.error) {
    editorError.textContent = result.error;
    editorError.hidden = false;
    EditorManager.clear();
    return;
  }

  tab.savedContent = tab.content;
  tab.dirty = false;
  EditorManager.clearChangeDecorations(activeTabPath);
  renderTabs();
  if (isAssessmentSettingsTab(tab)) await configureProxyListener();
}

function closeTab(filePath, e) {
  e?.stopPropagation();
  if (!openTabs.has(filePath)) return;

  if (filePath === activeTabPath) commitActiveTab();
  const tab = openTabs.get(filePath);
  if (tab?.dirty) {
    if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
  }

  const paths = [...openTabs.keys()];
  const idx = paths.indexOf(filePath);
  const wasActive = activeTabPath === filePath;
  EditorManager.disposeModel(filePath);
  openTabs.delete(filePath);

  if (wasActive) {
    editorLoadedPath = null;
    if (openTabs.size === 0) {
      activeTabPath = null;
    } else {
      const next = paths[idx + 1] ?? paths[idx - 1];
      activeTabPath = openTabs.has(next) ? next : [...openTabs.keys()][0];
    }
  }

  renderTabs();
  renderEditor();
}

function renderTabs() {
  editorTabBar.innerHTML = "";

  for (const [path, tab] of openTabs) {
    const el = document.createElement("div");
    el.className = "editor-tab" + (path === activeTabPath ? " active" : "");
    el.title = tab.name;
    el.addEventListener("click", () => switchToTab(path));

    const icon = document.createElement("span");
    const info = fileIconInfo(tab.name);
    icon.className = `tab-icon codicon ${info.icon} ${info.className}`;

    const label = document.createElement("span");
    label.className = "tab-label" + (tab.dirty ? " tab-dirty" : "");
    label.textContent = tab.name;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close";
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (e) => closeTab(path, e));

    el.appendChild(icon);
    el.appendChild(label);
    el.appendChild(close);
    editorTabBar.appendChild(el);
  }
}

function updateTabDirtyIndicator() {
  const idx = [...openTabs.keys()].indexOf(activeTabPath);
  const tabEl = editorTabBar.children[idx];
  const tab = openTabs.get(activeTabPath);
  tabEl?.querySelector(".tab-label")?.classList.toggle("tab-dirty", !!tab?.dirty);
}

async function renderEditor() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) {
    editorEmpty.removeAttribute("hidden");
    editorView.setAttribute("hidden", "");
    editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  const tab = openTabs.get(activeTabPath);
  const settingsTab = isAssessmentSettingsTab(tab);
  editorEmpty.setAttribute("hidden", "");
  editorView.removeAttribute("hidden");
  settingsEditorToolbar.hidden = !settingsTab;
  settingsUIView.hidden = true;
  monacoContainer.hidden = false;
  if (settingsTab) syncSettingsEditorButtons();

  if (tab.content === null && !tab.error) {
    editorError.hidden = true;
    editorLoadedPath = null;
    await EditorManager.showTab(activeTabPath, tab.name, "", { loading: true });
    return;
  }

  if (tab.error) {
    editorError.hidden = false;
    editorError.textContent = tab.error;
    editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  editorError.hidden = true;
  const text = tab.content ?? "";

  if (settingsTab && settingsEditorMode === "ui") {
    const rendered = renderSettingsForm(tab);
    if (rendered.error) {
      editorError.hidden = false;
      editorError.textContent = rendered.error;
      monacoContainer.hidden = false;
      settingsUIView.hidden = true;
      return;
    }
    monacoContainer.hidden = true;
    settingsUIView.hidden = false;
    editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  if (editorLoadedPath !== activeTabPath) {
    await EditorManager.showTab(activeTabPath, tab.name, text);
    editorLoadedPath = activeTabPath;
  }
}

EditorManager.setOnChange((path) => {
  if (path !== activeTabPath) return;
  const tab = openTabs.get(path);
  if (!tab || tab.error) return;
  tab.content = EditorManager.getValue(path);
  tab.dirty = tab.content !== tab.savedContent;
  updateTabDirtyIndicator();
});

EditorManager.setOnSave(() => saveActiveTab());

settingsViewJson?.addEventListener("click", () => {
  if (resourceSettingsActive) setResourceSettingsMode("json");
  else setSettingsEditorMode("json");
});
settingsViewUi?.addEventListener("click", () => {
  if (resourceSettingsActive) setResourceSettingsMode("ui");
  else setSettingsEditorMode("ui");
});
settingsUIView?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-setting-path]");
  if (!input) return;
  if (resourceSettingsActive) updateResourceSettingFromInput(input);
  else updateSettingFromInput(input);
});

statusOllamaPort.textContent = `Ollama :${OLLAMA_PORT}`;
EditorManager.setOnCursorChange((pos) => {
  statusLnCol.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fileIconInfo(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    py: ["codicon-symbol-method", "file-icon-py"], pyw: ["codicon-symbol-method", "file-icon-py"],
    c: ["codicon-file-code", "file-icon-c"], h: ["codicon-file-code", "file-icon-c"],
    cpp: ["codicon-file-code", "file-icon-cpp"], cxx: ["codicon-file-code", "file-icon-cpp"], cc: ["codicon-file-code", "file-icon-cpp"], hpp: ["codicon-file-code", "file-icon-cpp"],
    js: ["codicon-file-code", "file-icon-js"], mjs: ["codicon-file-code", "file-icon-js"], cjs: ["codicon-file-code", "file-icon-js"],
    jsx: ["codicon-file-code", "file-icon-js"], ts: ["codicon-symbol-interface", "file-icon-ts"], tsx: ["codicon-symbol-interface", "file-icon-ts"],
    json: ["codicon-json", "file-icon-json"], jsonc: ["codicon-json", "file-icon-json"],
    html: ["codicon-code", "file-icon-html"], htm: ["codicon-code", "file-icon-html"],
    css: ["codicon-symbol-color", "file-icon-css"], scss: ["codicon-symbol-color", "file-icon-css"],
    md: ["codicon-markdown", "file-icon-md"], yml: ["codicon-settings", "file-icon-yaml"], yaml: ["codicon-settings", "file-icon-yaml"],
    rs: ["codicon-file-code", "file-icon-rust"], go: ["codicon-file-code", "file-icon-go"], rb: ["codicon-file-code", "file-icon-ruby"],
    sh: ["codicon-terminal", "file-icon-shell"], ps1: ["codicon-terminal", "file-icon-shell"], bat: ["codicon-terminal", "file-icon-shell"],
    toml: ["codicon-settings", "file-icon-config"], env: ["codicon-key", "file-icon-config"], ini: ["codicon-settings", "file-icon-config"], config: ["codicon-settings-gear", "file-icon-config"],
    lock: ["codicon-lock", "file-icon-lock"], gitignore: ["codicon-git-branch", "file-icon-git"],
    png: ["codicon-file-media", "file-icon-media"], jpg: ["codicon-file-media", "file-icon-media"], jpeg: ["codicon-file-media", "file-icon-media"],
    svg: ["codicon-file-media", "file-icon-media"], gif: ["codicon-file-media", "file-icon-media"], ico: ["codicon-file-media", "file-icon-media"],
    pdf: ["codicon-file-pdf", "file-icon-pdf"],
  };
  const [icon, className] = map[ext] || ["codicon-file", "file-icon-text"];
  return { icon, className };
}

// ── Model picker ──────────────────────────────────────────────────────────────

function syncModelLabel() {
  if (!modelLabel) return;
  modelLabel.textContent = selectedModel || "Select model";
  if (modelPicker) {
    modelPicker.title = selectedModel ? `Model: ${selectedModel}` : "Select model";
  }
  updateContextUsage();
}

const CHAT_INPUT_MAX_LINES = 12;

function getChatInputMetrics() {
  if (!chatInput) return { line: 20, padTop: 12, padBot: 0 };
  const style = getComputedStyle(chatInput);
  let line = parseFloat(style.lineHeight);
  if (!Number.isFinite(line)) {
    line = parseFloat(style.fontSize) * 1.5;
  }
  return {
    line,
    padTop: parseFloat(style.paddingTop) || 0,
    padBot: parseFloat(style.paddingBottom) || 0,
  };
}

function syncChatInputMeasureStyles() {
  if (!chatInput || !chatInputMeasure) return;
  const style = getComputedStyle(chatInput);
  chatInputMeasure.style.width = `${chatInput.clientWidth}px`;
  chatInputMeasure.style.font = style.font;
  chatInputMeasure.style.fontFamily = style.fontFamily;
  chatInputMeasure.style.fontSize = style.fontSize;
  chatInputMeasure.style.fontWeight = style.fontWeight;
  chatInputMeasure.style.letterSpacing = style.letterSpacing;
  chatInputMeasure.style.lineHeight = style.lineHeight;
  chatInputMeasure.style.paddingTop = style.paddingTop;
  chatInputMeasure.style.paddingRight = style.paddingRight;
  chatInputMeasure.style.paddingBottom = style.paddingBottom;
  chatInputMeasure.style.paddingLeft = style.paddingLeft;
}

function getChatInputMaxHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  return Math.ceil(padTop + padBot + line * CHAT_INPUT_MAX_LINES);
}

function getChatInputDefaultHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  return Math.ceil(padTop + padBot + line);
}

function resizeChatInput() {
  if (!chatInput) return;
  const maxH = getChatInputMaxHeight();
  const minH = getChatInputDefaultHeight();
  let contentH = 0;

  if (chatInputMeasure) {
    syncChatInputMeasureStyles();
    let measureText = chatInput.value || " ";
    if (measureText.endsWith("\n")) measureText += " ";
    chatInputMeasure.textContent = measureText;
    contentH = chatInputMeasure.scrollHeight;
  }

  chatInput.style.maxHeight = `${maxH}px`;
  chatInput.style.height = "0px";
  const scrollH = Math.max(contentH, chatInput.scrollHeight);
  const next = Math.min(Math.max(scrollH, minH), maxH);
  chatInput.style.height = `${next}px`;
  const atCap = scrollH > maxH;
  chatInput.style.overflowY = atCap ? "auto" : "hidden";
  chatInput.classList.toggle("at-scroll-cap", atCap);
}

function resetChatInput() {
  if (!chatInput) return;
  chatInput.value = "";
  chatInput.style.overflowY = "hidden";
  chatInput.classList.remove("at-scroll-cap");
  chatInput.style.height = `${getChatInputDefaultHeight()}px`;
  resizeChatInput();
}

function positionModelMenu() {
  if (!modelPicker || !modelMenu) return;
  const rect = modelPicker.getBoundingClientRect();
  const targetWidth = Math.min(340, Math.max(260, window.innerWidth - 16));
  modelMenu.style.width = `${targetWidth}px`;
  const menuW = modelMenu.offsetWidth || targetWidth;
  const menuH = modelMenu.offsetHeight || 320;
  const pad = 8;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  let top = rect.top - menuH - pad;
  if (top < pad) top = rect.bottom + pad;
  if (top + menuH > viewportH - pad) {
    top = Math.max(pad, viewportH - menuH - pad);
  }

  let left = rect.left;
  if (left + menuW > viewportW - pad) {
    left = viewportW - menuW - pad;
  }
  if (left < pad) left = pad;

  modelMenu.style.top = `${top}px`;
  modelMenu.style.left = `${left}px`;
}

function closeModelEditMenu() {
  modelEditMenu.hidden = true;
  editingModel = null;
  modelList.querySelectorAll(".model-item.editing").forEach((el) => {
    el.classList.remove("editing");
  });
}

function closeModelMenu() {
  modelMenu.hidden = true;
  modelMenu.style.visibility = "";
  modelPicker.classList.remove("open");
  modelAddForm.hidden = true;
  modelSearch.value = "";
  closeModelEditMenu();
  closeContextPopover();
  renderModelList();
}

function positionModelEditMenu(anchorEl) {
  if (!anchorEl) return;
  modelEditMenu.hidden = false;
  const mainRect = modelMenu.getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  const menuW = modelEditMenu.offsetWidth || 200;
  const menuH = modelEditMenu.offsetHeight || 280;

  let left = mainRect.left - menuW - 6;
  let top = anchorRect.top;

  if (left < 8) left = mainRect.right + 6;
  if (top + menuH > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuH - 8);
  }

  modelEditMenu.style.left = `${left}px`;
  modelEditMenu.style.top = `${top}px`;
}

function openModelEditMenu(modelName, rowEl) {
  if (!modelEditMenu || !thinkingToggle || !contextOptions) return;
  editingModel = modelName;
  modelList.querySelectorAll(".model-item.editing").forEach((el) => {
    el.classList.remove("editing");
  });
  rowEl.classList.add("editing");

  const settings = getModelSettings(modelName);
  thinkingToggle.classList.toggle("on", settings.thinking);
  thinkingToggle.setAttribute("aria-pressed", String(settings.thinking));
  renderContextOptions(settings.context);
  updateModelRuntimeNote(modelName);

  requestAnimationFrame(() => positionModelEditMenu(rowEl));
}

function renderContextOptions(selected) {
  contextOptions.innerHTML = "";
  for (const opt of CONTEXT_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-option" + (opt === selected ? " selected" : "");
    const label = opt === AUTO_CONTEXT ? "Auto (Ollama default)" : opt;
    btn.innerHTML = `<span>${label}</span><span class="codicon codicon-check"></span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!editingModel) return;
      setModelSetting(editingModel, "context", opt);
      renderContextOptions(opt);
      updateModelRuntimeNote(editingModel);
    });
    contextOptions.appendChild(btn);
  }
}

function setModelRuntimeNote(text, warn = false) {
  if (!modelRuntimeNote) return;
  modelRuntimeNote.textContent = text;
  modelRuntimeNote.classList.toggle("warn", warn);
}

async function updateModelRuntimeNote(modelName) {
  const settings = getModelSettings(modelName);
  const baseNote = settings.context === AUTO_CONTEXT
    ? "Auto lets Ollama choose a VRAM-aware context."
    : "Manual context overrides can increase VRAM use and trigger CPU offload.";
  setModelRuntimeNote(baseNote, false);

  if (!window.api?.runtimeModel || !modelName) return;

  try {
    const result = await window.api.runtimeModel({ model: modelName });
    if (editingModel !== modelName || !result?.ok) return;
    if (!result.loaded) {
      setModelRuntimeNote(`Model not loaded yet. ${baseNote}`, false);
      return;
    }

    const parts = [];
    const contextLabel = result.contextLength ? `${formatTokenCount(result.contextLength)} ctx` : "active ctx";

    if (typeof result.gpuRatio === "number") {
      parts.push(`Loaded with ~${Math.round(result.gpuRatio * 100)}% in VRAM at ${contextLabel}.`);
    } else {
      parts.push(`Loaded at ${contextLabel}.`);
    }

    let warn = false;
    if (result.fullyGpu === false) {
      warn = true;
      parts.push("This model is partially offloaded to CPU, which caps GPU utilization.");
    }
    if (settings.context === AUTO_CONTEXT) {
      parts.push("Auto avoids forcing a larger context than Ollama can comfortably fit.");
    } else if (result.contextLength && result.contextLength > AUTO_CONTEXT_ESTIMATE) {
      warn = true;
      parts.push("Switching back to Auto or using a smaller model can reduce VRAM pressure.");
    }

    setModelRuntimeNote(parts.join(" "), warn);
  } catch {
    setModelRuntimeNote(baseNote, false);
  }
}

thinkingToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!editingModel) return;
  const settings = getModelSettings(editingModel);
  settings.thinking = !settings.thinking;
  saveModelSettings();
  thinkingToggle.classList.toggle("on", settings.thinking);
  thinkingToggle.setAttribute("aria-pressed", String(settings.thinking));
});

function showModelListLoading() {
  modelList.innerHTML = `<div class="model-list-empty">Loading models…</div>`;
}

function setModelListMessage(message) {
  if (!modelList) return;
  modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(message)}</div>`;
}

function normalizeModelNames(models) {
  return [...new Set((models || []).filter(Boolean).map(String))].sort();
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function applyOllamaListResult(result) {
  if (result?.host && statusOllamaPort) {
    statusOllamaPort.textContent = `Ollama :${result.host}`;
  }

  if (!result || result.error) {
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) {
      renderModelList();
    } else if (modelList) {
      setModelListMessage(result?.error || "Failed to load models");
    }
    return;
  }

  allModels = normalizeModelNames(result.models);
  const custom = selectedModel && !allModels.includes(selectedModel) ? [selectedModel] : [];
  allModels = normalizeModelNames([...custom, ...allModels]);
  if (!selectedModel && allModels.length) {
    selectedModel = allModels[0];
    localStorage.setItem("pointer:model", selectedModel);
  }
  renderModelList();
}

async function loadModels({ showLoading = true } = {}) {
  const seq = ++modelLoadSeq;
  syncModelLabel();
  if (showLoading) showModelListLoading();

  if (!window.api?.listModels) {
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) renderModelList();
    else setModelListMessage("App bridge not ready. Restart the app.");
    return;
  }

  try {
    if (!modelLoadInFlight) {
      modelLoadInFlight = withTimeout(
        window.api.listModels(),
        9000,
        "Ollama model loading timed out.",
      ).finally(() => {
        modelLoadInFlight = null;
      });
    }
    const result = await modelLoadInFlight;
    if (seq !== modelLoadSeq) return;
    applyOllamaListResult(result);
  } catch (err) {
    if (seq !== modelLoadSeq) return;
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) renderModelList();
    else setModelListMessage(err.message || "Failed to load models");
  } finally {
    if (seq !== modelLoadSeq) return;
    syncModelLabel();
    if (!modelMenu.hidden) positionModelMenu();
  }
}

function renderModelList() {
  const query = modelSearch.value.trim().toLowerCase();
  const filtered = allModels.filter((m) => m.toLowerCase().includes(query));

  modelList.innerHTML = "";
  if (!filtered.length) {
    modelList.innerHTML = `<div class="model-list-empty">${query ? "No models match your search" : "No models found"}</div>`;
    return;
  }

  for (const name of filtered) {
    const row = document.createElement("div");
    row.className = "model-item" + (name === selectedModel ? " selected" : "");
    row.dataset.model = name;

    const nameEl = document.createElement("span");
    nameEl.className = "model-item-name";
    nameEl.title = name;
    const slashIndex = name.lastIndexOf("/");
    const primary = document.createElement("span");
    primary.className = "model-item-primary";
    primary.textContent = slashIndex >= 0 ? name.slice(slashIndex + 1) : name;
    nameEl.appendChild(primary);
    if (slashIndex >= 0) {
      const secondary = document.createElement("span");
      secondary.className = "model-item-secondary";
      secondary.textContent = name.slice(0, slashIndex);
      nameEl.appendChild(secondary);
    }

    const trailing = document.createElement("div");
    trailing.className = "model-item-trailing";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "model-edit-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (editingModel === name && !modelEditMenu.hidden) {
        closeModelEditMenu();
      } else {
        openModelEditMenu(name, row);
      }
    });

    const check = document.createElement("span");
    check.className = "codicon codicon-check";

    trailing.appendChild(editBtn);
    trailing.appendChild(check);
    row.appendChild(nameEl);
    row.appendChild(trailing);

    row.addEventListener("click", () => {
      selectedModel = name;
      localStorage.setItem("pointer:model", selectedModel);
      syncModelLabel();
      renderModelList();
      updateContextUsage();
      closeModelMenu();
    });

    modelList.appendChild(row);
  }

  if (!modelMenu.hidden) {
    requestAnimationFrame(() => positionModelMenu());
  }
}

async function openModelMenu() {
  closeModelEditMenu();
  closeContextPopover();
  closeChatModeMenu();
  modelMenu.style.visibility = "hidden";
  modelMenu.hidden = false;
  modelPicker.classList.add("open");
  if (allModels.length) renderModelList();
  else showModelListLoading();
  positionModelMenu();
  modelMenu.style.visibility = "visible";
  await loadModels({ showLoading: !allModels.length });
  positionModelMenu();
  modelSearch.focus();
}

modelPicker.addEventListener("click", (e) => {
  e.stopPropagation();
  if (modelMenu.hidden) {
    openModelMenu();
  } else {
    closeModelMenu();
  }
});

modelMenu?.addEventListener("mousedown", (e) => e.stopPropagation());

modelSearch.addEventListener("input", renderModelList);
modelSearch.addEventListener("keydown", (e) => e.stopPropagation());

modelAddBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  modelAddForm.hidden = !modelAddForm.hidden;
  if (!modelAddForm.hidden) {
    modelCustom.focus();
    positionModelMenu();
  }
});

function addCustomModel() {
  const name = modelCustom.value.trim();
  if (!name) return;
  if (!allModels.includes(name)) {
    allModels.push(name);
    allModels.sort();
  }
  selectedModel = name;
  localStorage.setItem("pointer:model", selectedModel);
  modelCustom.value = "";
  modelAddForm.hidden = true;
  syncModelLabel();
  renderModelList();
  updateContextUsage();
  closeModelMenu();
}

modelCustomAdd.addEventListener("click", addCustomModel);
modelCustom.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") addCustomModel();
});

document.addEventListener("click", (e) => {
  if (!modelMenu.hidden) {
    const inMain = modelMenu.contains(e.target) || modelPicker.contains(e.target);
    const inEdit = modelEditMenu && !modelEditMenu.hidden && modelEditMenu.contains(e.target);
    if (!inMain && !inEdit) closeModelMenu();
  }
  if (!chatModeMenu?.hidden) {
    const inMode = chatModeToggle?.contains(e.target);
    if (!inMode) closeChatModeMenu();
  }
});

window.api.onWorkspaceChanged?.(async (payload) => {
  if (!rootPath || !payload?.workspace) return;
  if (normPath(payload.workspace) !== normPath(rootPath)) return;
  await refreshDirMap();
  await rerenderExplorer();
});

window.addEventListener("resize", () => {
  resizeChatInput();
  if (!chatModeMenu?.hidden) positionChatModeMenu();
  if (!modelMenu.hidden) positionModelMenu();
  if (!contextUsagePopover.hidden) positionContextPopover();
  if (!modelEditMenu.hidden && editingModel) {
    const row = [...modelList.querySelectorAll(".model-item")].find(
      (el) => el.dataset.model === editingModel,
    );
    if (row) positionModelEditMenu(row);
  }
});

syncModelLabel();
loadModels();
updateContextUsage();

// ── Tools & system prompt ─────────────────────────────────────────────────────

async function refreshDirMap() {
  if (!rootPath) {
    dirMapCache = "";
    return;
  }
  const result = await window.api.dirMap(rootPath);
  dirMapCache = result.map || "";
}

function relativePathFromRoot(absPath) {
  if (!rootPath || !absPath) return null;
  const root = normPath(rootPath).replace(/\/$/, "");
  const file = normPath(absPath);
  if (file === root) return "";
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  return null;
}

function getActiveFileContext() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) return null;
  commitActiveTab();
  const tab = openTabs.get(activeTabPath);
  const rel = relativePathFromRoot(tab.path);
  if (!rel) return null;
  return { path: rel, content: tab.content ?? "" };
}

async function readWorkspaceFile(relPath) {
  const result = await window.api.readFile(joinWorkspacePath(relPath));
  if (result.error || result.content == null) return null;
  return { path: relPath, content: result.content };
}

/** Load contents of project files mentioned in the user message (small models can't read minds). */
async function collectMentionedFiles(userMessage) {
  const files = [];
  if (!rootPath || !dirMapCache) return files;

  const projectFiles = ToolParser.parseProjectFiles(dirMapCache);
  const activePath = getActiveFileContext()?.path;
  const msg = (userMessage || "").toLowerCase();

  for (const rel of projectFiles) {
    if (files.length >= 3) break;
    if (rel === activePath) continue;
    const base = rel.split("/").pop().toLowerCase();
    if (!msg.includes(base) && !msg.includes(rel.toLowerCase())) continue;
    const file = await readWorkspaceFile(rel);
    if (file) files.push(file);
  }

  // Single-file project: always show it so the model can patch correctly.
  if (!files.length && projectFiles.length === 1 && projectFiles[0] !== activePath) {
    const file = await readWorkspaceFile(projectFiles[0]);
    if (file) files.push(file);
  }

  return files;
}

function buildMessagesForApi() {
  const settings = selectedModel ? getModelSettings(selectedModel) : { context: AUTO_CONTEXT };
  const system = ToolParser.buildSystemContext({
    mode: chatMode,
    contextBudget: contextToTokens(settings.context),
    dirMap: dirMapCache,
    activeFile: getActiveFileContext(),
    extraFiles: contextFilesCache,
  });
  const msgs = [{ role: "system", content: system }];
  const summary = activeChatSession()?.contextSummary;
  const summaryMessage = buildSummaryContextMessage(summary);
  if (summaryMessage) msgs.push({ role: "system", content: summaryMessage });
  return [...msgs, ...chatHistory];
}

function renderMarkdown(el, md, { streaming = false } = {}) {
  if (globalThis.MarkdownRenderer) {
    if (streaming) {
      globalThis.MarkdownRenderer.scheduleRender(el, () => md, true);
    } else {
      globalThis.MarkdownRenderer.renderToElement(el, md);
    }
  } else {
    el.dataset.rawMd = md;
    el.textContent = md;
  }
}

function createToolCard(tool, { pending = false } = {}) {
  const card = document.createElement("div");
  card.className = `tool-card${pending ? " pending" : ""}`;
  const label = ToolMap.targetForTool(tool);
  card.dataset.file = label;
  const detail = ToolParser.toolCardDetail(tool);
  card.innerHTML = `
    <div class="tool-card-header">
      <span class="codicon codicon-file tool-card-icon"></span>
      <span class="tool-card-file">${escapeHtml(label)}</span>
      <span class="tool-card-badge">${escapeHtml(detail)}</span>
      <span class="tool-card-status running">${pending ? "Queued…" : "Working…"}</span>
    </div>
  `;
  return card;
}

function setToolCardStatus(card, type, message) {
  const status = card.querySelector(".tool-card-status");
  if (!status) return;
  status.className = `tool-card-status ${type}`;
  status.textContent = message;
}

function ensureToolCard(turn, contentEl, tool, { pending = false } = {}) {
  const fileKey = ToolMap.targetForTool(tool);
  let card = turn.querySelector(`.tool-card[data-file="${CSS.escape(fileKey)}"]`);
  if (!card) {
    card = createToolCard(tool, { pending });
    turn.insertBefore(card, contentEl);
  } else if (pending) {
    card.classList.add("pending");
    setToolCardStatus(card, "running", "Queued...");
  } else {
    card.classList.remove("pending");
    setToolCardStatus(card, "running", "Working...");
  }
  return card;
}

function joinWorkspacePath(relPath) {
  if (!rootPath) return relPath;
  const sep = rootPath.includes("\\") ? "\\" : "/";
  return rootPath + sep + relPath.replace(/[/\\]/g, sep);
}

function toolCallForExecution(tool) {
  const name = tool.toolName || tool.action;
  const args = { ...(tool.args || {}) };

  if (tool.file) args.path = tool.file;
  if (tool.files) args.paths = tool.files;
  if (tool.query) {
    args.query = tool.query;
    args.limit = tool.limit;
  }
  if (tool.command) {
    args.command = tool.command;
    args.timeout_ms = tool.timeoutMs;
  }
  if (tool.processId) args.id = tool.processId;
  if (tool.code != null) args.content = tool.code;
  if (tool.patches) {
    args.patches = tool.patches;
    if (tool.patches.length === 1) {
      args.search = tool.patches[0].search;
      args.replace = tool.patches[0].replace;
    }
  }

  return {
    id: tool.callId,
    type: "function",
    function: { name, arguments: args },
  };
}

async function applyEditToEditor(tool, newContent, previousContent = null) {
  if (newContent == null) return;

  const filePath = joinWorkspacePath(tool.file);
  const fileName = tool.file.split(/[/\\]/).pop();
  const tabPath = normPath(filePath);

  if (openTabs.has(tabPath)) {
    const tab = openTabs.get(tabPath);
    const before = previousContent ?? tab.content ?? tab.savedContent ?? "";
    tab.content = newContent;
    tab.savedContent = newContent;
    tab.dirty = false;
    tab.error = null;
    if (activeTabPath === tabPath) {
      await EditorManager.showTab(tabPath, fileName, newContent);
      EditorManager.showChangeDecorations(tabPath, before, newContent);
      editorLoadedPath = tabPath;
    }
    renderTabs();
  } else {
    const before = previousContent ?? "";
    await openFile(filePath, fileName);
    const tab = openTabs.get(tabPath);
    if (tab) {
      tab.content = newContent;
      tab.savedContent = newContent;
      tab.dirty = false;
    }
    if (activeTabPath === tabPath) {
      await EditorManager.showTab(tabPath, fileName, newContent);
      EditorManager.showChangeDecorations(tabPath, before, newContent);
      editorLoadedPath = tabPath;
    }
  }
}

async function executeTool(tool, turn, contentEl, editContext = {}) {
  const fileKey = ToolMap.targetForTool(tool);
  let card = turn.querySelector(`.tool-card[data-file="${CSS.escape(fileKey)}"]`);
  if (!card) {
    card = createToolCard(tool);
    turn.insertBefore(card, contentEl);
  } else {
    card.classList.remove("pending");
    setToolCardStatus(card, "running", "Working…");
  }

  if (!rootPath) {
    setToolCardStatus(card, "error", "No folder open");
    return { ok: false, error: "No folder open", toolName: tool.toolName || tool.action, content: "Error: No folder open" };
  }

  let execTool = { ...tool };
  if (
    !execTool.file
    && ["read_file", "write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(execTool.action)
    && editContext.targetFile
  ) {
    execTool.file = editContext.targetFile;
    card.dataset.file = execTool.file;
    const fileEl = card.querySelector(".tool-card-file");
    if (fileEl) fileEl.textContent = execTool.file;
  }
  if (editContext.dirMap && tool.file && tool.action !== "write_file") {
    const file = ToolParser.resolveToolPath(tool.file, editContext);
    if (file !== tool.file) {
      execTool = { ...execTool, file };
      card.dataset.file = file;
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) fileEl.textContent = file;
    }
  }

  let previousContent = null;
  if (execTool.file && ToolMap.isMutating(execTool) && execTool.action !== "delete_file") {
    const before = await readWorkspaceFile(execTool.file);
    previousContent = before?.content ?? "";
  }

  let result = await window.api.executeTool({
    workspace: rootPath,
    toolCall: toolCallForExecution(execTool),
  });

  if (tool.action !== "write_file" && result.error && /not found/i.test(result.error) && editContext.targetFile) {
    const retryFile = ToolParser.resolveToolPath(editContext.targetFile, editContext);
    if (retryFile && retryFile !== execTool.file) {
      execTool = { ...execTool, file: retryFile };
      card.dataset.file = retryFile;
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) fileEl.textContent = retryFile;
      result = await window.api.executeTool({
        workspace: rootPath,
        toolCall: toolCallForExecution(execTool),
      });
    }
  }

  if (result.error) {
    // Rewrite raw errors into instructions the model can act on next round.
    let error = result.error;
    if (/file not found/i.test(error)) {
      error = `File ${execTool.file} does not exist. It is not in the project. Use write_file with the full content to create it first.`;
    } else if (/not found in file/i.test(error)) {
      error = `Patch failed: search text not found in ${execTool.file}. Call read_file on ${execTool.file}, copy the exact lines, then retry patch_file.`;
    }
    setToolCardStatus(card, "error", result.error);
    return { ...result, error, content: `Error: ${error}`, file: execTool.file };
  }

  const badge = card.querySelector(".tool-card-badge");
  if (badge) {
    badge.textContent = ToolParser.toolCardDetail(execTool);
  }

  setToolCardStatus(card, "success", ToolParser.formatToolSuccess(result));

  if (result.mode === "read" && result.file && result.content != null) {
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  if (result.mode === "delete" && result.file) {
    await refreshDirMap();
    clearExpandedTreePathsUnder(joinWorkspacePath(result.file));
    closeTabsUnderWorkspacePath(joinWorkspacePath(result.file));
    await rerenderExplorer({ preserveSelectionPath: null });
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file && !f.path.startsWith(`${result.file}/`));
  } else if (result.mutated || ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    await refreshDirMap();
    await rerenderExplorer({ preserveSelectionPath: joinWorkspacePath(result.file || "") || selectedItem?.dataset.path || null });
    if (result.file && result.content != null) {
      await applyEditToEditor({ ...execTool, file: result.file }, result.content, previousContent);
    }
  }

  // Keep cached context in sync so later rounds see the updated file, not a stale copy.
  if (result.file && result.content != null && ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  syncActiveChatSession();
  scrollMessages();
  return { ...result, file: result.file || execTool.file };
}

async function applyToolResultToUi(tool, result, turn, contentEl) {
  const card = ensureToolCard(turn, contentEl, tool);

  if (result?.error) {
    setToolCardStatus(card, "error", result.error);
    scrollMessages();
    return;
  }

  const badge = card.querySelector(".tool-card-badge");
  if (badge) {
    badge.textContent = ToolParser.toolCardDetail(tool);
  }

  setToolCardStatus(card, "success", ToolParser.formatToolSuccess(result));

  if (result.mode === "read" && result.file && result.content != null) {
    contextFilesCache = contextFilesCache.filter((file) => file.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  if (result.mode === "delete" && result.file) {
    await refreshDirMap();
    clearExpandedTreePathsUnder(joinWorkspacePath(result.file));
    closeTabsUnderWorkspacePath(joinWorkspacePath(result.file));
    await rerenderExplorer({ preserveSelectionPath: null });
    contextFilesCache = contextFilesCache.filter((file) => file.path !== result.file && !file.path.startsWith(`${result.file}/`));
  } else if (result.mutated || ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    await refreshDirMap();
    await rerenderExplorer({ preserveSelectionPath: joinWorkspacePath(result.file || "") || selectedItem?.dataset.path || null });
    if (result.file && result.content != null) {
      const tabPath = normPath(joinWorkspacePath(result.file));
      const previousContent = openTabs.get(tabPath)?.savedContent
        ?? contextFilesCache.find((file) => file.path === result.file)?.content
        ?? "";
      await applyEditToEditor({ ...tool, file: result.file }, result.content, previousContent);
    }
  }

  if (result.file && result.content != null && ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    contextFilesCache = contextFilesCache.filter((file) => file.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  syncActiveChatSession();
  scrollMessages();
}

function waitForOllamaRound(assistant, editContext) {
  return new Promise((resolve) => {
    let roundContent = "";
    let contentStarted = false;
    let abortedForRepetition = false;

    window.api.removeAllListeners("ollama:token");
    window.api.removeAllListeners("ollama:thinking");
    window.api.removeAllListeners("ollama:done");
    window.api.removeAllListeners("ollama:toolcall");

    window.api.onThinking((token) => {
      if (!contentStarted) assistant.setStatus("Thinking…");
      assistant.appendThinking(token);
    });

    window.api.onToolCall((calls) => {
      const tools = ToolParser.resolveTools(
        ToolParser.parseNativeToolCalls(calls),
        editContext,
      );
      for (const tool of tools) {
        const label = tool.file || tool.query || tool.command || tool.processId || tool.action || "";
        const exists = assistant.turn.querySelector(
          `.tool-card[data-file="${CSS.escape(label)}"]`,
        );
        if (!exists) {
          const card = createToolCard(tool, { pending: true });
          assistant.turn.insertBefore(card, assistant.contentEl);
          scrollMessages();
        }
      }
      if (tools.length === 1) {
        assistant.setStatus(ToolParser.toolStatusLabel(tools[0]));
      } else if (tools.length > 1) {
        assistant.setStatus(`Using ${tools.length} tools…`);
      }
    });

    window.api.onToken((token) => {
      if (abortedForRepetition) {
        roundContent += token;
        return;
      }
      const nextContent = roundContent + token;
      if (ToolParser.isRepetitiveLoop(nextContent)) {
        abortedForRepetition = true;
        roundContent = nextContent;
        if (!contentStarted) {
          contentStarted = true;
          assistant.finalizeThinking();
        }
        assistant.rawContent = "";
        assistant.contentEl.hidden = true;
        activeStreamContent = "";
        assistant.setStatus("Retrying with tool instructions...");
        window.api.abortChat?.();
        updateContextUsage();
        return;
      }
      if (!contentStarted) {
        contentStarted = true;
        assistant.finalizeThinking();
        assistant.clearStatus();
      }
      roundContent = nextContent;
      assistant.appendContent(token);
      activeStreamContent = assistant.rawContent;
      updateContextUsage();
    });

    window.api.onDone((payload) => {
      const text = roundContent || payload.fullText || "";
      if (!abortedForRepetition && !roundContent && payload.fullText) {
        const prev = assistant.rawContent.trim();
        assistant.rawContent = prev
          ? `${prev}\n\n${payload.fullText}`
          : payload.fullText;
        assistant.clearStatus();
        assistant.syncDisplay();
      }
      resolve({ ...payload, roundContent: text, abortedForRepetition });
    });
  });
}

async function requestOllamaChat(settings) {
  await refreshDirMap();
  const payload = {
    messages: buildMessagesForApi(),
    model: selectedModel,
    numCtx: contextToTokens(settings.context, { forRequest: true }),
    thinking: settings.thinking,
    tools: modeTools(),
  };
  return window.api.chat(payload);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function scrollMessages() {
  messages.scrollTop = messages.scrollHeight;
}

function createThinkingTimer(metaEl) {
  const start = Date.now();
  const interval = setInterval(() => {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    metaEl.textContent = `Thinking for ${secs}s`;
  }, 100);
  return {
    stop() {
      clearInterval(interval);
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      metaEl.textContent = `Thought for ${secs}s`;
    },
  };
}

function addUserMessage(text) {
  const turn = document.createElement("div");
  turn.className = "chat-turn user";
  const box = document.createElement("div");
  box.className = "chat-box";
  const content = document.createElement("div");
  content.className = "chat-box-content";
  content.textContent = text;
  box.appendChild(content);
  turn.appendChild(box);
  messages.appendChild(turn);
  scrollMessages();
}

function addErrorMessage(text) {
  const turn = document.createElement("div");
  turn.className = "chat-turn error";
  const box = document.createElement("div");
  box.className = "chat-box chat-box-error";
  const content = document.createElement("div");
  content.className = "chat-box-content";
  content.textContent = text;
  box.appendChild(content);
  turn.appendChild(box);
  messages.appendChild(turn);
  syncActiveChatSession();
  scrollMessages();
}

function createAssistantTurn(enableThinking) {
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";

  let thinkingBlock = null;
  let thinkingBody = null;
  let thinkingMeta = null;
  let thinkingTimer = null;

  if (enableThinking) {
    thinkingBlock = document.createElement("div");
    thinkingBlock.className = "thinking-block collapsed";
    thinkingBlock.hidden = true;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "thinking-header";
    header.innerHTML = `
      <span class="codicon codicon-chevron-right thinking-chevron"></span>
      <span class="thinking-title">Thinking</span>
      <span class="thinking-meta">Thinking…</span>
    `;

    thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingMeta = header.querySelector(".thinking-meta");

    header.addEventListener("click", () => {
      thinkingBlock.classList.toggle("collapsed");
      const chevron = header.querySelector(".thinking-chevron");
      chevron.classList.toggle("codicon-chevron-right", thinkingBlock.classList.contains("collapsed"));
      chevron.classList.toggle("codicon-chevron-down", !thinkingBlock.classList.contains("collapsed"));
    });

    thinkingBlock.appendChild(header);
    thinkingBlock.appendChild(thinkingBody);
    turn.appendChild(thinkingBlock);
  }

  const statusEl = document.createElement("div");
  statusEl.className = "assistant-status is-active";
  statusEl.textContent = "Planning…";
  turn.appendChild(statusEl);

  const contentEl = document.createElement("div");
  contentEl.className = "assistant-reply";
  contentEl.hidden = true;
  turn.appendChild(contentEl);
  messages.appendChild(turn);
  scrollMessages();

  const assistant = {
    turn,
    statusEl,
    contentEl,
    rawContent: "",
    rawThinking: "",
    thinkingBlock,
    thinkingBody,
    thinkingMeta,
    setStatus(text) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
      this.statusEl.classList.add("is-active");
    },
    clearStatus() {
      if (!this.statusEl) return;
      this.statusEl.classList.remove("is-active");
    },
    displayContent() {
      const streaming = this.contentEl.classList.contains("streaming");
      return ToolParser.cleanReplyForDisplay(this.rawContent, { streaming });
    },
    syncDisplay() {
      const text = this.displayContent();
      if (text) {
        this.clearStatus();
        this.contentEl.hidden = false;
        renderMarkdown(
          this.contentEl,
          text,
          { streaming: this.contentEl.classList.contains("streaming") },
        );
      }
      scrollMessages();
    },
    appendContent(token) {
      this.rawContent += token;
      this.syncDisplay();
    },
    finalizeContent() {
      const text = this.displayContent();
      if (text) {
        this.contentEl.hidden = false;
        renderMarkdown(this.contentEl, text);
      } else if (this.rawContent.trim() && !ToolParser.isOnlyToolSyntax(this.rawContent)) {
        // Fallback: show raw text if cleaner stripped too aggressively
        this.contentEl.hidden = false;
        renderMarkdown(this.contentEl, this.rawContent.trim());
      } else {
        this.contentEl.hidden = true;
      }
      this.clearStatus();
      this.contentEl.classList.remove("streaming");
      this.pruneIfEmpty();
    },
    pruneIfEmpty() {
      const hasContent = !this.contentEl.hidden && this.contentEl.textContent.trim();
      const statusActive = this.statusEl?.classList.contains("is-active");
      const hasThinking = this.thinkingBlock && !this.thinkingBlock.hidden && this.rawThinking.trim();
      const hasTools = this.turn.querySelector(".tool-card");
      if (!hasContent && !statusActive && !hasThinking && !hasTools) {
        this.turn.remove();
      }
    },
    startThinkingTimer() {
      if (!thinkingMeta || thinkingTimer) return;
      thinkingTimer = createThinkingTimer(thinkingMeta);
    },
    stopThinkingTimer() {
      if (!thinkingTimer) return;
      thinkingTimer.stop();
      thinkingTimer = null;
    },
    appendThinking(text) {
      if (!thinkingBody) return;
      if (thinkingBlock.hidden) {
        thinkingBlock.hidden = false;
        this.startThinkingTimer();
      }
      this.rawThinking += text;
      renderMarkdown(thinkingBody, this.rawThinking, { streaming: true });
      scrollMessages();
    },
    finalizeThinking() {
      this.stopThinkingTimer();
      if (thinkingBody) {
        renderMarkdown(thinkingBody, this.rawThinking);
      }
    },
  };

  return assistant;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || streaming) return;

  if (!selectedModel) {
    addErrorMessage("Select a model before sending a message.");
    return;
  }

  chatInput.value = "";
  resetChatInput();
  addUserMessage(text);
  chatHistory.push({ role: "user", content: text });
  maybeNameActiveChat(text);
  syncActiveChatSession();
  await maybeCompactContext(getContextUsage());

  const historyStart = chatHistory.length - 1;

  streaming = true;
  stopRequested = false;
  setAgentStatus(`${modeLabel()} working`);
  updateSendBtn();
  renderChatSessionSelect();
  activeStreamContent = "";
  await refreshDirMap();
  contextFilesCache = await collectMentionedFiles(text);
  syncActiveChatSession();
  updateContextUsage();

  const settings = getModelSettings(selectedModel);
  const assistant = createAssistantTurn(settings.thinking);
  assistant.contentEl.classList.add("streaming");

  const activeFile = getActiveFileContext();
  const editContext = {
    isEditRequest: chatMode === "agent" && ToolParser.isEditRequest(text),
    targetFile: ToolParser.inferEditTarget(text, activeFile, dirMapCache),
    activeFile,
    userMessage: text,
    dirMap: dirMapCache,
    mode: chatMode,
  };

  let executedTools = false;
  let completedEdit = false;
  let lastToolSummary = "";
  const toolLoopCounts = new Map();
  let noToolEditRetries = 0;

  try {
    for (let round = 0; round < ToolParser.MAX_AGENT_ROUNDS; round += 1) {
      if (round > 0) {
        activeStreamContent = assistant.rawContent;
        assistant.contentEl.classList.add("streaming");
        if (!assistant.rawContent.trim()) {
          assistant.contentEl.hidden = true;
        }
        assistant.setStatus("Planning…");
      }

      const donePromise = waitForOllamaRound(assistant, editContext);
      const result = await requestOllamaChat(settings);

      if (result.error) {
        assistant.turn.remove();
        addErrorMessage(result.error);
        chatHistory.splice(historyStart);
        syncActiveChatSession();
        return;
      }

      const payload = await donePromise;
      assistant.contentEl.classList.remove("streaming");
      assistant.finalizeThinking();

      if (assistant.thinkingBlock && !assistant.rawThinking) {
        assistant.thinkingBlock.hidden = true;
      }

      const rawRound = payload.roundContent || "";
      const roundText = ToolParser.cleanReplyForDisplay(rawRound, {
        stripCodeBlocks: editContext.isEditRequest,
      });
      const tools = ToolParser.collectToolsFromResponse(rawRound, payload.toolCalls, editContext);
      const visibleRoundText = tools.length && editContext.isEditRequest ? "" : roundText;

      if ((payload.aborted || result.aborted) && stopRequested) {
        assistant.rawContent = assistant.displayContent().trim() || "Stopped.";
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      if ((payload.abortedForRepetition || payload.aborted || result.aborted) && !tools.length) {
        if (editContext.isEditRequest && noToolEditRetries < 1) {
          noToolEditRetries += 1;
          assistant.rawContent = "";
          assistant.contentEl.hidden = true;
          assistant.setStatus("Retrying with tighter tool instructions...");
          chatHistory.push({
            role: "user",
            content: [
              "Your previous response repeated text and did not call tools.",
              "Do not write plans, function names, or code in chat.",
              "This is an edit request, so you must call tools now.",
              "Use read_file if needed, patch_file for existing files, and write_file for new files.",
              editContext.targetFile ? `Primary target file: ${editContext.targetFile}.` : "",
              `User request: ${editContext.userMessage}`,
            ].filter(Boolean).join(" "),
          });
          updateContextUsage();
          continue;
        }

        assistant.rawContent = "The model got stuck repeating text instead of using tools, so I stopped it before it filled the chat. Try a stronger tool-capable model or make the file names explicit.";
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      if (!tools.length && ToolParser.isOnlyToolSyntax(rawRound)) {
        assistant.rawContent = "";
        assistant.finalizeContent();
        addErrorMessage("The model emitted malformed tool syntax instead of a usable tool call. Try again, or switch to a model with better tool support.");
        break;
      }

      const repeatedTool = tools.find((tool) => {
        const key = [
          tool.action,
          tool.file || "",
          tool.query || "",
          tool.command || "",
          tool.processId || "",
        ].join("\0");
        const next = (toolLoopCounts.get(key) || 0) + 1;
        toolLoopCounts.set(key, next);
        return next > 2;
      });

      if (repeatedTool) {
        assistant.rawContent = `The model repeated ${ToolParser.toolStatusLabel(repeatedTool).toLowerCase()} too many times, so I stopped the loop before it spammed the chat.`;
        assistant.finalizeContent();
        break;
      }

      if (!tools.length) {
        if (editContext.isEditRequest) {
          const asksClarifyingQuestion = /\?\s*$/.test(roundText.trim());

          if (completedEdit) {
            chatHistory.push({
              role: "assistant",
              content: roundText || lastToolSummary,
            });
            assistant.rawContent = roundText || lastToolSummary;
            assistant.finalizeContent();
            updateContextUsage();
            break;
          }

          if (!asksClarifyingQuestion && noToolEditRetries < 1) {
            noToolEditRetries += 1;
            assistant.rawContent = "";
            assistant.contentEl.hidden = true;
            assistant.setStatus("Retrying with tool instructions…");
            chatHistory.push({
              role: "user",
              content: [
                "You answered without changing files.",
                "This is an edit request, so text is not enough.",
                "Do not claim completion.",
                "Call the correct tool now: read_file if you need contents, then patch_file for an existing file or write_file for a new file.",
                editContext.targetFile ? `Target file: ${editContext.targetFile}` : "",
              ].filter(Boolean).join(" "),
            });
            updateContextUsage();
            continue;
          }

          if (!asksClarifyingQuestion) {
            assistant.rawContent = "I could not get this model to emit a usable edit tool call, so no file was changed. Try a stronger tool-capable model or rephrase with the exact file and operation.";
            assistant.finalizeContent();
            updateContextUsage();
            break;
          }
        }

        chatHistory.push({
          role: "assistant",
          content: roundText || ToolParser.cleanReplyForDisplay(rawRound, {
            stripCodeBlocks: editContext.isEditRequest,
          }),
        });
        const newText = roundText || ToolParser.cleanReplyForDisplay(rawRound, {
          stripCodeBlocks: editContext.isEditRequest,
        }) || rawRound;
        if (newText && !assistant.rawContent.trim()) {
          assistant.rawContent = newText;
        }
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      const assistantMessage = {
        role: "assistant",
        content: visibleRoundText || "",
      };
      if (payload.toolCalls?.length) {
        assistantMessage.tool_calls = ToolParser.normalizeToolCallsForApi(payload.toolCalls);
      }
      chatHistory.push(assistantMessage);

      if (visibleRoundText) {
        const prev = ToolParser.cleanReplyForDisplay(assistant.rawContent, {
          stripCodeBlocks: editContext.isEditRequest,
        });
        assistant.rawContent = prev && !prev.includes(visibleRoundText)
          ? `${prev}\n\n${visibleRoundText}`
          : visibleRoundText;
        assistant.syncDisplay();
      } else if (!assistant.displayContent().trim()) {
        assistant.rawContent = "";
        assistant.contentEl.hidden = true;
      }

      const toolResults = [];
      for (const tool of tools) {
        assistant.setStatus(ToolParser.toolStatusLabel(tool));
        const toolResult = await executeTool(tool, assistant.turn, assistant.contentEl, editContext);
        toolResults.push(toolResult);
        executedTools = true;
        if (
          !toolResult?.error
          && ToolMap.isMutating(tool)
          && toolResult.mutated
        ) {
          completedEdit = true;
        }
        chatHistory.push({
          role: "tool",
          content: ToolParser.toolResultMessage(toolResult),
          tool_name: tool.toolName || tool.action || "write_file",
          ...(tool.callId ? { tool_call_id: tool.callId } : {}),
        });
      }

      updateContextUsage();

      lastToolSummary = ToolParser.buildEditSummary(tools, toolResults);

      if (completedEdit && lastToolSummary) {
        assistant.rawContent = lastToolSummary;
        assistant.finalizeContent();
        break;
      }

      if (round === ToolParser.MAX_AGENT_ROUNDS - 1) {
        assistant.rawContent = lastToolSummary;
        const assistantIdx = chatHistory.length - toolResults.length - 1;
        if (chatHistory[assistantIdx]?.role === "assistant") {
          chatHistory[assistantIdx].content = lastToolSummary;
        }
        assistant.finalizeContent();
        break;
      }
    }

    if (completedEdit && !assistant.displayContent().trim()) {
      assistant.rawContent = lastToolSummary || "Updated the requested file.";
      assistant.finalizeContent();
    } else if (executedTools && !assistant.displayContent().trim()) {
      assistant.rawContent = lastToolSummary || assistant.rawContent;
      assistant.finalizeContent();
    }

    assistant.pruneIfEmpty();
    squashAgentTurn(historyStart);
    syncActiveChatSession();
  } finally {
    activeStreamContent = "";
    streaming = false;
    stopRequested = false;
    setAgentStatus("Agent ready");
    updateSendBtn();
    renderChatSessionSelect();
    updateContextUsage();
    assistant.pruneIfEmpty();
    syncActiveChatSession();
    chatInput.focus();
  }
}

async function sendMessageWithAgentRuntime() {
  const text = chatInput.value.trim();
  if (!text || streaming) return;

  if (!selectedModel) {
    addErrorMessage("Select a model before sending a message.");
    return;
  }

  chatInput.value = "";
  resetChatInput();
  addUserMessage(text);
  chatHistory.push({ role: "user", content: text });
  maybeNameActiveChat(text);
  syncActiveChatSession();
  await maybeCompactContext(getContextUsage());

  const historyStart = chatHistory.length - 1;

  streaming = true;
  stopRequested = false;
  setAgentStatus(`${modeLabel()} working`);
  updateSendBtn();
  renderChatSessionSelect();
  activeStreamContent = "";
  await refreshDirMap();
  contextFilesCache = await collectMentionedFiles(text);
  syncActiveChatSession();
  updateContextUsage();

  const settings = getModelSettings(selectedModel);
  const assistant = createAssistantTurn(settings.thinking);
  assistant.contentEl.classList.add("streaming");

  const activeFile = getActiveFileContext();
  let contentStarted = false;
  let lastAgentText = "";

  const handleAgentEvent = async (payload) => {
    if (!payload) return;

    if (payload.type === "status") {
      assistant.setStatus(payload.text || "Working...");
      setAgentStatus(payload.text || `${modeLabel()} working`);
      return;
    }

    if (payload.type === "thinking") {
      if (!contentStarted) assistant.setStatus("Thinking...");
      assistant.appendThinking(payload.delta || "");
      return;
    }

    if (payload.type === "content") {
      if (!contentStarted) {
        contentStarted = true;
        assistant.finalizeThinking();
        assistant.clearStatus();
      }
      assistant.appendContent(payload.delta || "");
      activeStreamContent = assistant.rawContent;
      lastAgentText = assistant.rawContent;
      updateContextUsage();
      return;
    }

    if (payload.type === "tool_call") {
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      for (const tool of tools) {
        ensureToolCard(assistant.turn, assistant.contentEl, tool, { pending: true });
      }
      if (tools.length === 1) {
        assistant.setStatus(ToolParser.toolStatusLabel(tools[0]));
      } else if (tools.length > 1) {
        assistant.setStatus(`Using ${tools.length} tools...`);
      }
      scrollMessages();
      return;
    }

    if (payload.type === "tool_start" && payload.tool) {
      ensureToolCard(assistant.turn, assistant.contentEl, payload.tool);
      assistant.setStatus(ToolParser.toolStatusLabel(payload.tool));
      scrollMessages();
      return;
    }

    if (payload.type === "tool_result" && payload.tool && payload.result) {
      await applyToolResultToUi(payload.tool, payload.result, assistant.turn, assistant.contentEl);
      updateContextUsage();
    }
  };

  try {
    window.api.removeAllListeners("agent:event");
    window.api.onAgentEvent((payload) => {
      Promise.resolve(handleAgentEvent(payload)).catch(() => {});
    });

    const result = await window.api.agentRun({
      workspace: rootPath,
      model: selectedModel,
      numCtx: contextToTokens(settings.context, { forRequest: true }),
      contextBudget: contextToTokens(settings.context),
      thinking: settings.thinking,
      tools: modeTools(),
      mode: chatMode,
      chatHistory,
      contextSummary: activeChatSession()?.contextSummary || "",
      dirMap: dirMapCache,
      activeFile,
      extraFiles: contextFilesCache,
      userMessage: text,
    });

    assistant.contentEl.classList.remove("streaming");
    assistant.finalizeThinking();

    if (assistant.thinkingBlock && !assistant.rawThinking) {
      assistant.thinkingBlock.hidden = true;
    }

    if (result?.error) {
      assistant.turn.remove();
      addErrorMessage(result.error);
      chatHistory.splice(historyStart);
      syncActiveChatSession();
      return;
    }

    if (stopRequested) {
      assistant.rawContent = assistant.displayContent().trim() || lastAgentText.trim() || "Stopped.";
      assistant.finalizeContent();
      updateContextUsage();
      return;
    }

    if (Array.isArray(result?.appendedMessages) && result.appendedMessages.length) {
      chatHistory.push(...result.appendedMessages);
    }

    const finalText = String(result?.finalText || "").trim();
    if (finalText) {
      assistant.rawContent = finalText;
    } else if (!assistant.displayContent().trim() && lastAgentText.trim()) {
      assistant.rawContent = lastAgentText;
    }

    assistant.finalizeContent();
    assistant.pruneIfEmpty();
    syncActiveChatSession();
  } finally {
    window.api.removeAllListeners("agent:event");
    activeStreamContent = "";
    streaming = false;
    stopRequested = false;
    setAgentStatus(`${modeLabel()} ready`);
    updateSendBtn();
    renderChatSessionSelect();
    updateContextUsage();
    assistant.pruneIfEmpty();
    syncActiveChatSession();
    chatInput.focus();
  }
}

function stopGeneration() {
  if (!streaming) return;
  stopRequested = true;
  activeStreamContent = "";
  setAgentStatus("Stopping...");
  window.api.abortChat?.();
  updateSendBtn();
  updateContextUsage();
}

sendBtn.addEventListener("click", () => {
  if (streaming) stopGeneration();
  else sendMessageWithAgentRuntime();
});

btnTopTerminal?.addEventListener("click", () => {
  setTerminalCollapsed(!terminalCollapsed);
});

btnTopChat?.addEventListener("click", () => {
  if (chatCollapsed) {
    openChatPane({ createIfEmpty: true });
  } else {
    setChatCollapsed(true);
  }
});

btnWindowMinimize?.addEventListener("click", () => {
  window.api.windowMinimize?.();
});

btnWindowMaximize?.addEventListener("click", async () => {
  const maximized = await window.api.windowToggleMaximize?.();
  const icon = btnWindowMaximize.querySelector(".codicon");
  icon?.classList.toggle("codicon-chrome-maximize", !maximized);
  icon?.classList.toggle("codicon-chrome-restore", Boolean(maximized));
  btnWindowMaximize.title = maximized ? "Restore" : "Maximize";
});

btnWindowClose?.addEventListener("click", () => {
  window.api.windowClose?.();
});

btnChatNew?.addEventListener("click", (e) => {
  e.stopPropagation();
  newChatSession();
});
btnChatDelete?.addEventListener("click", (e) => {
  e.stopPropagation();
  deleteActiveChatSession();
});
btnChatHistory?.addEventListener("click", (e) => {
  e.stopPropagation();
  openChatHistoryPicker();
});
btnChatMore?.addEventListener("click", (e) => {
  e.stopPropagation();
  showChatOptions();
});
btnChatCollapse?.addEventListener("click", (e) => {
  e.stopPropagation();
  setChatCollapsed(true);
});
chatSessionSelect?.addEventListener("click", (e) => {
  const close = e.target.closest("[data-close-session]");
  if (close) {
    e.stopPropagation();
    deleteChatSession(close.dataset.closeSession);
    return;
  }

  const tab = e.target.closest(".chat-session-tab");
  if (!tab || streaming) return;
  loadChatSession(tab.dataset.sessionId);
});
chatHeader?.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.id === "btn-chat-new") newChatSession();
  if (button.id === "btn-chat-delete") deleteActiveChatSession();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessageWithAgentRuntime();
  }
});

document.addEventListener("keydown", async (e) => {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  const quickIsOpen = quickOverlay && !quickOverlay.hidden;
  const opensQuickSurface = (e.shiftKey && key === "p")
    || (!e.shiftKey && key === "p")
    || (e.shiftKey && key === "f");
  if (quickIsOpen && !opensQuickSurface) return;

  if (!e.shiftKey && key === "s" && resourceCurrentFilePath) {
    e.preventDefault();
    await saveResourceChanges();
    return;
  }

  if (!e.shiftKey && key === "p") {
    e.preventDefault();
    await openQuickPalette("file");
    return;
  }

  if (e.shiftKey && key === "p") {
    e.preventDefault();
    await openQuickPalette("command");
    return;
  }

  if (e.shiftKey && key === "f") {
    e.preventDefault();
    await openQuickPalette("search");
    return;
  }
}, true);

function updateSendBtn() {
  sendBtn.classList.toggle("stop", streaming);
  sendBtn.title = streaming ? "Stop generation" : "Send message";
  sendBtn.disabled = !streaming && !chatInput.value.trim();
}

function onChatInputChange() {
  resizeChatInput();
  updateSendBtn();
  updateContextUsage();
}

chatInput.addEventListener("input", onChatInputChange);
chatInput.addEventListener("paste", () => requestAnimationFrame(onChatInputChange));
chatInput.addEventListener("cut", () => requestAnimationFrame(onChatInputChange));
window.addEventListener("beforeunload", (event) => {
  window.api.unwatchWorkspace?.();
  if (resourceDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

resizeChatInput();

if (chatPane && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resizeChatInput()).observe(chatPane);
}

contextUsageBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleContextPopover();
});

contextUsageClose?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeContextPopover();
});

contextCompactBtn?.addEventListener("click", async (e) => {
  e.stopPropagation();
  const compacted = await maybeCompactContext(getContextUsage(), { force: true });
  updateContextUsage();
  requestAnimationFrame(positionContextPopover);
  if (!compacted && !contextCompacting) {
    contextCompactBtn.title = chatHistory.length < 6
      ? "At least 6 messages are needed to summarize context"
      : "Context could not be summarized";
  }
});

document.addEventListener("click", (e) => {
  if (!contextUsagePopover.hidden) {
    const inPopover = contextUsagePopover.contains(e.target) || contextUsageBtn.contains(e.target);
    if (!inPopover) closeContextPopover();
  }
});

messages.addEventListener("click", (e) => {
  const thinkingHeader = e.target.closest(".thinking-header");
  if (thinkingHeader) {
    const block = thinkingHeader.closest(".thinking-block");
    if (block) {
      block.classList.toggle("collapsed");
      const chevron = thinkingHeader.querySelector(".thinking-chevron");
      chevron?.classList.toggle("codicon-chevron-right", block.classList.contains("collapsed"));
      chevron?.classList.toggle("codicon-chevron-down", !block.classList.contains("collapsed"));
    }
    return;
  }

  const btn = e.target.closest(".md-code-copy");
  if (!btn) return;
  const block = btn.closest(".md-code-block");
  if (!block) return;
  const code = decodeURIComponent(block.dataset.code || "");
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

globalThis.addEventListener("markdown-ready", () => {
  document.querySelectorAll(".assistant-reply[data-raw-md], .thinking-body[data-raw-md]").forEach((el) => {
    globalThis.MarkdownRenderer.renderToElement(el, el.dataset.rawMd);
  });
});

// ── Resizable Panels ──────────────────────────────────────────────────────────

function makeDraggable(handle, onMove) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

makeDraggable(sidebarResize, (e) => {
  const min = 180, max = 500;
  const left = sidebar.getBoundingClientRect().left;
  sidebar.style.width = Math.min(max, Math.max(min, e.clientX - left)) + "px";
});

makeDraggable(chatResize, (e) => {
  const min = 280, max = 600;
  const w = window.innerWidth - e.clientX;
  chatPane.style.width = Math.min(max, Math.max(min, w)) + "px";
  resizeChatInput();
});

makeDraggable(securityExchangeSash, (e) => {
  if (!securityExchangeEl) return;
  const rect = securityExchangeEl.getBoundingClientRect();
  const sashW = securityExchangeSash.offsetWidth || 4;
  const totalW = rect.width - sashW;
  const MIN_PANE = 120;
  const rawLeft = e.clientX - rect.left;
  const clampedLeft = Math.min(totalW - MIN_PANE, Math.max(MIN_PANE, rawLeft));
  const pct = (clampedLeft / totalW) * 100;
  securityExchangeEl.style.setProperty("--security-exchange-split", `${pct.toFixed(2)}%`);
});

securityExchangeSash?.addEventListener("keydown", (e) => {
  if (!securityExchangeEl) return;
  const STEP = 2; // percent per keypress
  const current = parseFloat(
    getComputedStyle(securityExchangeEl).getPropertyValue("--security-exchange-split") || "50"
  );
  let next = current;
  if (e.key === "ArrowLeft")  { e.preventDefault(); next = Math.max(10, current - STEP); }
  if (e.key === "ArrowRight") { e.preventDefault(); next = Math.min(90, current + STEP); }
  if (next !== current) {
    securityExchangeEl.style.setProperty("--security-exchange-split", `${next.toFixed(2)}%`);
  }
});

function setTerminalCollapsed(collapsed) {
  if (collapsed && terminalMaximized) {
    terminalMaximized = false;
    centerPanel.classList.remove("terminal-maximized");
    syncTerminalMaximizeButton();
  }
  terminalCollapsed = collapsed;
  terminalPane.classList.toggle("collapsed", collapsed);
  terminalResize.classList.toggle("collapsed-hint", collapsed);
  btnTopTerminal?.classList.toggle("active", !collapsed);
  btnTopTerminal?.classList.toggle("inactive", collapsed);
  activityTerminal?.classList.toggle("panel-visible", !collapsed);
  activityTerminal?.setAttribute("aria-pressed", String(!collapsed));

  if (collapsed) {
    if (terminalPane.offsetHeight > TERMINAL_MIN_EXPANDED) {
      terminalSavedHeight = terminalPane.offsetHeight;
    }
    terminalPane.style.height = "0px";
    terminalPane.style.flex = "none";
    editorPane.style.flex = "1";
    editorPane.style.height = "";
  } else {
    terminalPane.style.height = `${terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.flex = "none";
    const centerH = centerPanel.getBoundingClientRect().height;
    const editorH = Math.max(EDITOR_MIN_HEIGHT, centerH - terminalSavedHeight);
    editorPane.style.height = `${editorH}px`;
    requestAnimationFrame(() => {
      EditorManager.layout();
      TerminalManager.fitActive();
    });
  }
}

function syncTerminalMaximizeButton() {
  if (!btnTerminalMaximize) return;
  const icon = btnTerminalMaximize.querySelector(".codicon");
  icon?.classList.toggle("codicon-screen-full", !terminalMaximized);
  icon?.classList.toggle("codicon-screen-normal", terminalMaximized);
  btnTerminalMaximize.title = terminalMaximized ? "Restore Panel Size" : "Maximize Panel";
  btnTerminalMaximize.setAttribute("aria-pressed", String(terminalMaximized));
}

function setTerminalMaximized(maximized) {
  const next = Boolean(maximized);
  if (next && terminalCollapsed) setTerminalCollapsed(false);
  terminalMaximized = next;
  centerPanel.classList.toggle("terminal-maximized", terminalMaximized);
  syncTerminalMaximizeButton();

  if (!terminalMaximized) {
    terminalPane.style.height = `${terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    const centerH = centerPanel.getBoundingClientRect().height;
    editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, centerH - terminalSavedHeight)}px`;
    editorPane.style.flex = "none";
  } else {
    terminalPane.style.height = "";
    terminalPane.style.flex = "1 1 auto";
    editorPane.style.height = "";
    editorPane.style.flex = "1";
  }

  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

btnTerminalMaximize?.addEventListener("click", () => {
  setTerminalMaximized(!terminalMaximized);
});

btnTerminalClose?.addEventListener("click", () => {
  setTerminalCollapsed(true);
});

globalThis.expandTerminalPanel = () => {
  if (terminalCollapsed) setTerminalCollapsed(false);
  return true;
};

globalThis.toggleTerminalPanel = () => {
  const nextCollapsed = !terminalCollapsed;
  setTerminalCollapsed(nextCollapsed);
  return !nextCollapsed;
};

makeDraggable(terminalResize, (e) => {
  if (terminalMaximized) setTerminalMaximized(false);
  const rect = centerPanel.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const collapseAt = rect.height - 12;

  if (relY >= collapseAt) {
    if (!terminalCollapsed) setTerminalCollapsed(true);
    return;
  }

  if (terminalCollapsed) {
    setTerminalCollapsed(false);
  }

  const editorH = Math.min(
    rect.height - TERMINAL_MIN_EXPANDED,
    Math.max(EDITOR_MIN_HEIGHT, relY),
  );
  terminalSavedHeight = rect.height - editorH;

  editorPane.style.height = `${editorH}px`;
  editorPane.style.flex = "none";
  terminalPane.style.height = `${terminalSavedHeight}px`;
  terminalPane.style.flex = "none";

  EditorManager.layout();
  TerminalManager.fitActive();
});

terminalResize.addEventListener("dblclick", () => {
  setTerminalCollapsed(!terminalCollapsed);
});

updateSendBtn();
updateRunMenuState();
renderChatSessionSelect();
window.api.onProxyCapture?.(handleProxyCapture);
window.api.onProxyStatus?.(syncProxyListenerUi);
window.api.proxyStatus?.().then(syncProxyListenerUi).catch(() => {});
restoreBugBountyTreeState();
setSidebarView("bugbounty", { persist: false });
setChatCollapsed(false);
setTerminalCollapsed(false);
chatInput.focus();
restoreLastWorkspace();
