/* ── Renderer (runs in the browser context via contextBridge) ── */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const pointerStore = globalThis.PointerCore.createAppStore();
const appController = new globalThis.PointerCore.AppController(pointerStore);
const appLifecycle = new globalThis.PointerCore.LifecycleCollection();
globalThis.addEventListener("beforeunload", () => {
  appController.dispose();
  appLifecycle.dispose();
}, { once: true });

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
const activityToolbox = $("activity-toolbox");
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
const assessmentRepairOverlay = $("assessment-repair-overlay");
const assessmentRepairClose = $("assessment-repair-close");
const assessmentRepairCancel = $("assessment-repair-cancel");
const assessmentRepairConfirm = $("assessment-repair-confirm");
const assessmentRepairSubtitle = $("assessment-repair-subtitle");
const assessmentRepairDescription = $("assessment-repair-description");
const assessmentRepairSummary = $("assessment-repair-summary");
const assessmentRepairList = $("assessment-repair-list");
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
const helpGuideOverlay = $("help-guide-overlay");
const helpGuideClose   = $("help-guide-close");
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
const btnNotifications = $("btn-notifications");
const notificationCount = $("notification-count");
const notificationPanel = $("notification-panel");
const notificationList = $("notification-list");
const notificationClear = $("notification-clear");
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
const slashCommandSuggestions = $("slash-command-suggestions");
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
const resourceEditorShell = $("resource-editor-shell");
const resourceLineNumbers = $("resource-line-numbers");
const resourceViewerSave = $("resource-viewer-save");
const resourceViewerCopy = $("resource-viewer-copy");
const resourceViewerActions = $("resource-viewer-actions");
const appSettingsWorkspace = $("app-settings-workspace");
const commandSettingsList = $("command-settings-list");
const commandSettingsDetail = $("command-settings-detail");
const commandSettingsSave = $("command-settings-save");
const commandSettingsAdd = $("command-settings-add");
const commandSettingsStatus = $("command-settings-status");
const customCommandsList = $("custom-commands-list");
const appSettingsCommandsPanel = $("app-settings-commands-panel");
const appSettingsAuthorityPanel = $("app-settings-authority-panel");
const authoritySettingsContent = $("authority-settings-content");
const appSettingsPromptsPanel = $("app-settings-prompts-panel");
const promptSettingsModules = $("prompt-settings-modules");
const promptSettingsTitle = $("prompt-settings-title");
const promptSettingsEditor = $("prompt-settings-editor");
const promptSettingsDirty = $("prompt-settings-dirty");
const promptSettingsRestore = $("prompt-settings-restore");
const promptSettingsRestoreAll = $("prompt-settings-restore-all");
const promptSettingsExport = $("prompt-settings-export");
const promptSettingsImport = $("prompt-settings-import");
const promptSettingsImportBuffer = $("prompt-settings-import-buffer");
const promptSettingsValidation = $("prompt-settings-validation");
const promptSettingsTokenCost = $("prompt-settings-token-cost");
const promptSettingsDiff = $("prompt-settings-diff");
const promptSettingsEffective = $("prompt-settings-effective");
const promptVerifierModel = $("prompt-verifier-model");
const promptRequireQualified = $("prompt-require-qualified");
const promptUnqualifiedOverride = $("prompt-unqualified-override");
const appSettingsCertificatesPanel = $("app-settings-certificates-panel");
const certificateDirectory = $("certificate-directory");
const certificateLocationBadge = $("certificate-location-badge");
const certificateStatus = $("certificate-status");
const certificateFilePath = $("certificate-file-path");
const certificateBrowse = $("certificate-browse");
const certificateOpenFolder = $("certificate-open-folder");
const certificateReset = $("certificate-reset");
const appSettingsSectionButtons = [...document.querySelectorAll("[data-app-settings-section]")];
const checklistUIView = $("checklist-ui-view");
const checklistFrameworkName = $("checklist-framework-name");
const checklistFrameworkVersion = $("checklist-framework-version");
const checklistProgress = $("checklist-progress");
const checklistSearch = $("checklist-search");
const checklistStatusFilter = $("checklist-status-filter");
const checklistGroups = $("checklist-groups");
const scopeUIView = $("scope-ui-view");
const scopeUITitle = $("scope-ui-title");
const scopeUIDescription = $("scope-ui-description");
const scopeUIForm = $("scope-ui-form");
const assessmentModuleView = $("assessment-module-view");
const assessmentModuleTitle = $("assessment-module-title");
const assessmentModuleDescription = $("assessment-module-description");
const assessmentModuleSummary = $("assessment-module-summary");
const assessmentModuleContent = $("assessment-module-content");
const assessmentModuleOpenJson = $("assessment-module-open-json");
const assessmentFindingNew = $("assessment-finding-new");
const assessmentReportGenerate = $("assessment-report-generate");
const assessmentRunProfile = $("assessment-run-profile");
const assessmentRunStart = $("assessment-run-start");
const assessmentRunStop = $("assessment-run-stop");
const securityWorkspace = $("security-workspace");
const toolsWorkspace = $("tools-workspace");
const toolHealthAction = $("tool-health-action");
const toolHealthResults = $("tool-health-results");
const mapWorkspace = $("map-workspace");
const mapWorkspaceSubtitle = $("map-workspace-subtitle");
const mapBuildAction = $("map-build-action");
const mapBuiltAt = $("map-built-at");
const mapLoading = $("map-loading");
const mapEmpty = $("map-empty");
const mapContent = $("map-content");
const mapSearch = $("map-search");
const mapHostFilter = $("map-host-filter");
const mapMethodFilter = $("map-method-filter");
const mapVisibilityFilter = $("map-visibility-filter");
const mapGraph = $("map-graph");
const mapViewport = $("map-viewport");
const mapNoResults = $("map-no-results");
const mapMain = document.querySelector(".map-main");
const mapDetailToggle = $("map-detail-toggle");
const mapDetailBody = $("map-detail-body");
const mapDetailEmpty = $("map-detail-empty");
const mapDetailContent = $("map-detail-content");
const webcloneWorkspace = $("webclone-workspace");
const webcloneBuildAction = $("webclone-build-action");
const webclonePreviewAction = $("webclone-preview-action");
const webclonePreviewClose = $("webclone-preview-close");
const webcloneTarget = $("webclone-target");
const webcloneFilesToggle = $("webclone-files-toggle");
const webcloneStatus = $("webclone-status");
const webcloneEmpty = $("webclone-empty");
const webcloneContent = $("webclone-content");
const webcloneFileList = $("webclone-file-list");
const webcloneFileCount = $("webclone-file-count");
const webcloneFileTitle = $("webclone-file-title");
const webcloneFileMeta = $("webclone-file-meta");
const webcloneFileContent = $("webclone-file-content");
const webcloneEditorPane = document.querySelector(".webclone-editor-pane");
const webclonePreviewPane = document.querySelector(".webclone-preview-pane");
const webclonePreviewFrame = $("webclone-preview-frame");
const toolCatalog = $("tool-catalog");
const toolConfigOverlay = $("tool-config-overlay");
const toolConfigDialog = $("tool-config-dialog");
const toolConfigTitle = $("tool-config-title");
const toolConfigDescription = $("tool-config-description");
const toolConfigUi = $("tool-config-ui");
const toolConfigJson = $("tool-config-json");
const toolRegisterAction = $("tool-register-action");
const toolRegisterOverlay = $("tool-register-overlay");
const toolRegisterDialog = $("tool-register-dialog");
const toolRegisterClose = $("tool-register-close");
const toolRegisterCancel = $("tool-register-cancel");
const toolRegisterImport = $("tool-register-import");
const toolRegisterFile = $("tool-register-file");
const toolCommandPreview = $("tool-command-preview");
const customTreeItems = $("custom-tree-items");
const customContextMenu = $("custom-context-menu");
const customContextDelete = $("custom-context-delete");
const customContextDeleteLabel = $("custom-context-delete-label");
const appSettingsOverlay = $("app-settings-overlay");
const customCommandsInput = $("custom-commands-input");
const commandRegistryInput = $("command-registry-input");
const chatSafetyToggle = $("chat-safety-toggle");
const chatSafetyButton = $("chat-safety-button");
const chatSafetyLabel = $("chat-safety-label");
const chatSafetyTooltip = $("chat-safety-tooltip");
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
const securityHistoryMenu = $("security-history-menu");
const securityHistoryDeleteLabel = $("security-history-delete-label");
const securityHistorySortHeaders = [...document.querySelectorAll(".security-history-table th[data-history-sort]")];
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
const securityInspector = $("security-inspector");
const securityInspectorToggle = $("security-inspector-toggle");
const securityInspectorPanel = $("security-inspector-panel");
const securityInspectorClose = $("security-inspector-close");
const securityInspectorContext = $("security-inspector-context");
const securityInspectorStatus = $("security-inspector-status");
const securityInspectorTabs = [...document.querySelectorAll("[data-inspector-tab]")];
const securityInspectorPanels = [...document.querySelectorAll("[data-inspector-panel]")];
const inspectorDecoderFormat = $("inspector-decoder-format");
const inspectorDecoderInput = $("inspector-decoder-input");
const inspectorDecoderOutput = $("inspector-decoder-output");
const inspectorJwtToken = $("inspector-jwt-token");
const inspectorJwtHeader = $("inspector-jwt-header");
const inspectorJwtPayload = $("inspector-jwt-payload");
const inspectorJwtAlg = $("inspector-jwt-alg");
const inspectorJwtSecret = $("inspector-jwt-secret");
const inspectorJwtAnalysis = $("inspector-jwt-analysis");
const inspectorCookieInput = $("inspector-cookie-input");
const inspectorCookieOutput = $("inspector-cookie-output");
const inspectorCookieResults = $("inspector-cookie-results");
const terminalShellTab = $("terminal-shell-tab");
if (securityWorkspaceTools && securityToolSwitcher) securityWorkspaceTools.appendChild(securityToolSwitcher);
if (securityWorkspaceBody && securityWorkbench) securityWorkspaceBody.appendChild(securityWorkbench);
if (securityToolSwitcher) securityToolSwitcher.hidden = false;
if (securityWorkbench) securityWorkbench.hidden = false;

const securityExchangeEl   = $("security-exchange");
const securityExchangeSash = $("security-exchange-sash");
const securityWorkbenchResize = $("security-workbench-resize");

const TERMINAL_HEADER_H = 35;
const TERMINAL_MIN_EXPANDED = 80;
const EDITOR_MIN_HEIGHT = 120;
const WORKBENCH_MIN_H = 80;  // min height for history panel when dragging
const WORKBENCH_TOOL_MIN_H = 120; // min height for the tool panel (interceptor etc.)
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
let resourceChecklistActive = false;
let resourceChecklistType = "";
let resourceChecklistData = null;
let resourceChecklistSaveTimer = null;
let resourceScopeActive = false;
let resourceScopeData = null;
let resourceScopeRelativePath = "";
let resourceScopeSaveTimer = null;
let applicationMap = null;
let applicationMapMode = "route";
let selectedMapNodeId = "";
let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let mapPointerState = null;
let mapNodeDragState = null;
let mapNodeClickSuppressed = false;
let currentMapPositions = new Map();
const mapNodePositionsByMode = new Map(["route", "workflow", "risk"].map((mode) => [mode, new Map()]));
let mapLoadSequence = 0;
let webcloneManifest = null;
let webcloneSelectedFile = "";
let webcloneFilesCollapsed = false;
let selectedCustomFolder = "";
const selectedCustomEntries = new Set();
let customSelectionAnchor = "";
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
let activeChatPersistenceScope = "";
let chatPersistenceTimer = null;
let chatPersistenceQueue = Promise.resolve();
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
const CHAT_FAMILY_KEY = "pointer:chatFamily";
const SIDEBAR_VIEW_KEY = "pointer:sidebarView";
const BUG_BOUNTY_EXPANSION_KEY = "pointer:bugBountyExpansion";
const BUG_BOUNTY_SELECTED_KEY = "pointer:bugBountySelected";
const BUG_BOUNTY_PATH_KEY = "pointer:bugBountyPath";
const SECURITY_TOOL_KEY = "pointer:securityTool";
const SECURITY_INSPECTOR_OPEN_KEY = "pointer:securityInspectorOpen";
const SECURITY_INSPECTOR_TAB_KEY = "pointer:securityInspectorTab";
const SETTINGS_EDITOR_MODE_KEY = "pointer:settingsEditorMode";
const CUSTOM_COMMANDS_KEY = "pointer:customSlashCommands";
const COMMAND_REGISTRY_KEY = "pointer:commandRegistry";
const AUTHORITY_SETTINGS_KEY = "pointer:authoritySettings:v1";
const MAP_INSPECT_COLLAPSED_KEY = "pointer:mapInspectCollapsed";
const CHAT_ROLES = new Set(["planner", "agent", "ask"]);
const CHAT_FAMILIES = new Set(["testing", "assist"]);
const CHAT_PROFILE_DEFS = ToolParser.MODE_PROFILES || {};
const CHAT_PROFILE_KEYS = new Set(Object.keys(CHAT_PROFILE_DEFS));
const CHAT_ROLE_ALIASES = Object.freeze({
  "testing:analyze": "testing:ask",
  "testing:execution": "testing:agent",
  "testing:exploit": "testing:agent",
  "assist:executor": "assist:agent",
  "assist:observer": "assist:ask",
  "assist:verifier": "assist:ask",
  "assist:reporter": "assist:ask",
  ask: "assist:ask",
  plan: "assist:planner",
  agent: "assist:agent",
});
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
  "get_map_overview",
  "get_map_node",
  "get_map_neighbors",
  "find_map_paths",
  "search_map_routes",
  "get_map_shared_objects",
  "get_map_evidence",
  "get_map_hypotheses",
  "record_hypothesis",
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
  "annotate_map_finding",
  "ingest_assessment_records",
]);

let selectedModel = localStorage.getItem("pointer:model") || "";
let allModels     = [];
let editingModel  = null;
let modelLoadSeq  = 0;
let modelLoadInFlight = null;
function canonicalChatMode(value, family = "assist") {
  const raw = String(value || "").toLowerCase();
  const aliased = CHAT_ROLE_ALIASES[raw] || raw;
  if (CHAT_PROFILE_KEYS.has(aliased) && aliased.split(":")[0] === family) return aliased;
  const role = aliased.includes(":") ? aliased.split(":")[1] : aliased;
  if (CHAT_ROLES.has(role)) {
    const candidate = `${family}:${role}`;
    if (CHAT_PROFILE_KEYS.has(candidate)) return candidate;
  }
  return `${family}:agent`;
}

const storedChatFamily = localStorage.getItem(CHAT_FAMILY_KEY);
const storedChatMode = localStorage.getItem(CHAT_MODE_KEY) || "assist:agent";
let chatFamily = CHAT_FAMILIES.has(storedChatFamily)
  ? storedChatFamily
  : (String(storedChatMode).includes(":") && CHAT_FAMILIES.has(String(storedChatMode).split(":")[0])
    ? String(storedChatMode).split(":")[0]
    : "assist");
let chatMode = canonicalChatMode(storedChatMode, chatFamily);
let exploitApprovalGranted = false;
let assessmentPath = localStorage.getItem(BUG_BOUNTY_PATH_KEY) || "";
let assessmentRefreshSequence = 0;
let assessmentVerification = null;
let assessmentModuleActive = false;
let assessmentModulePath = "";
let assessmentModuleData = null;
let selectedSecurityTool = "interceptor";
let securityHistoryRecords = [];
let selectedSecurityHistoryIndices = new Set();
let selectedSecurityHistoryRequestIds = new Set();
let securityHistoryAnchorIndex = -1;
let securityHistoryLoading = false;
let securityHistorySort = { key: "time", direction: "desc" };
let securityInspectorTab = localStorage.getItem(SECURITY_INSPECTOR_TAB_KEY) || "decoder";
let securityBusy = false;
let lastLoggedSecuritySignature = "";
const securityDrafts = new Map();
let settingsEditorMode = localStorage.getItem(SETTINGS_EDITOR_MODE_KEY) === "ui" ? "ui" : "json";
let settingsAutoSaveTimer = null;
let currentProxyCaptureId = "";
let proxyListenerState = { running: false };
let assessmentSettingsCache = null;
let slashSuggestionItems = [];
let slashSuggestionIndex = 0;
let commandSettingsData = {};
let selectedCommandSettingsName = "/passive";
let customScriptsCache = [];
let appSettingsSection = "commands";
let authoritySettingsData = null;
let promptSettingsData = null;
let aiModelSettingsData = null;
let selectedPromptModule = "role";
let certificateSettingsData = null;
let notificationItems = [];
const UI_ZOOM_KEY = "pointer:uiZoom";
let uiZoom = Number(localStorage.getItem(UI_ZOOM_KEY)) || 1;

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
    chatMode,
    chatFamily,
    selectedModel,
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

function currentChatPersistenceScope() {
  const workspace = assessmentPath || rootPath || "global";
  return String(workspace).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() || "global";
}

function sanitizePersistedChatHtml(html) {
  const raw = String(html || "");
  const clean = globalThis.DOMPurify
    ? globalThis.DOMPurify.sanitize(raw, {
      ADD_TAGS: ["button"],
      ADD_ATTR: ["class", "data-code", "data-mermaid-source", "data-raw-md", "title", "type", "hidden", "aria-hidden", "aria-expanded"],
    })
    : "";
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll(".stream-cursor").forEach((node) => node.remove());
  template.content.querySelectorAll(".streaming").forEach((node) => node.classList.remove("streaming"));
  // Old chat snapshots may contain Pointer's former Planning/Working line.
  template.content.querySelectorAll(".assistant-status").forEach((node) => node.remove());
  return template.innerHTML;
}

function normalizePersistedChatSession(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id.trim()) return null;
  const sourceMessages = Array.isArray(value.messages) ? value.messages : value.history;
  const history = Array.isArray(sourceMessages)
    ? sourceMessages.filter((message) => message && typeof message === "object" && typeof message.role === "string")
    : [];
  const storedFamily = value.safetyFamily || value.chatFamily;
  const family = CHAT_FAMILIES.has(storedFamily) ? storedFamily : chatFamily;
  return {
    id: value.id.slice(0, 200),
    title: String(value.title || "New Agent").slice(0, 120),
    history,
    contextFilesCache: [],
    contextSummary: typeof value.contextSummary === "string" ? value.contextSummary : "",
    contextSummaryMeta: value.contextSummaryMeta && typeof value.contextSummaryMeta === "object" ? value.contextSummaryMeta : null,
    messagesHtml: sanitizePersistedChatHtml(value.messagesHtml),
    activeStreamContent: "",
    chatFamily: family,
    chatMode: canonicalChatMode(value.mode || value.chatMode, family),
    selectedModel: typeof (value.model || value.selectedModel) === "string" ? (value.model || value.selectedModel) : "",
    status: ["complete", "stopped", "interrupted"].includes(value.status) ? value.status : "complete",
  };
}

function chatPersistenceState() {
  return {
    activeSessionId: activeChatSessionId,
    sessions: chatSessions.map((session) => ({
      id: session.id,
      title: session.title,
      messages: session.history,
      contextSummary: session.contextSummary,
      contextSummaryMeta: session.contextSummaryMeta,
      mode: session.chatMode || chatMode,
      safetyFamily: session.chatFamily || chatFamily,
      model: session.selectedModel || selectedModel,
      status: streaming && session.id === activeChatSessionId ? "interrupted" : "complete",
    })),
  };
}

function persistChatSessionsNow(scope = activeChatPersistenceScope) {
  if (!scope || !window.api.saveChatSessions) return Promise.resolve();
  const state = chatPersistenceState();
  chatPersistenceQueue = chatPersistenceQueue
    .catch(() => {})
    .then(() => window.api.saveChatSessions({ scope, state }))
    .catch((error) => console.warn("Could not save chat sessions:", error));
  return chatPersistenceQueue;
}

function schedulePersistChatSessions() {
  if (!activeChatPersistenceScope) return;
  clearTimeout(chatPersistenceTimer);
  const scope = activeChatPersistenceScope;
  chatPersistenceTimer = setTimeout(() => {
    chatPersistenceTimer = null;
    persistChatSessionsNow(scope);
  }, 120);
}

function flushChatSessionsBeforeClose() {
  if (!activeChatPersistenceScope || !window.api.saveChatSessionsBeforeClose) return;
  clearTimeout(chatPersistenceTimer);
  chatPersistenceTimer = null;
  syncActiveChatSession({ persist: false });
  try {
    window.api.saveChatSessionsBeforeClose({
      scope: activeChatPersistenceScope,
      state: chatPersistenceState(),
    });
  } catch (error) {
    console.warn("Could not flush chat sessions before closing:", error);
  }
}

function renderCanonicalChatHistory(history = []) {
  messages.innerHTML = "";
  for (const message of history) {
    const content = String(message?.content || "").trim();
    if (!content) continue;
    if (message.role === "user") {
      const turn = document.createElement("div");
      turn.className = "chat-turn user";
      const box = document.createElement("div");
      box.className = "chat-box";
      const body = document.createElement("div");
      body.className = "chat-box-content";
      body.textContent = content;
      box.appendChild(body);
      turn.appendChild(box);
      messages.appendChild(turn);
    } else if (message.role === "assistant") {
      const turn = document.createElement("div");
      turn.className = "chat-turn assistant";
      const body = document.createElement("div");
      body.className = "assistant-reply";
      renderMarkdown(body, content);
      turn.appendChild(body);
      messages.appendChild(turn);
    }
  }
}

function applyActiveChatSession(session) {
  if (!session) {
    activeChatSessionId = "";
    chatHistory = [];
    contextFilesCache = [];
    activeStreamContent = "";
    messages.innerHTML = "";
    setChatCollapsed(true);
    return;
  }
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = [];
  activeStreamContent = "";
  chatFamily = CHAT_FAMILIES.has(session.chatFamily) ? session.chatFamily : chatFamily;
  chatMode = canonicalChatMode(session.chatMode, chatFamily);
  if (session.selectedModel) selectedModel = session.selectedModel;
  localStorage.setItem(CHAT_MODE_KEY, chatMode);
  localStorage.setItem(CHAT_FAMILY_KEY, chatFamily);
  if (selectedModel) localStorage.setItem("pointer:model", selectedModel);
  if (session.messagesHtml) messages.innerHTML = session.messagesHtml;
  else renderCanonicalChatHistory(session.history);
  setChatCollapsed(false);
  syncChatModeUi();
  requestAnimationFrame(() => {
    messages.querySelectorAll(".assistant-reply[data-raw-md], .thinking-body[data-raw-md]").forEach((element) => {
      globalThis.MarkdownRenderer?.renderToElement(element, element.dataset.rawMd || "");
    });
    scrollMessages({ force: true });
  });
}

async function restoreChatSessionsForCurrentWorkspace() {
  const scope = currentChatPersistenceScope();
  if (scope === activeChatPersistenceScope) return;
  clearTimeout(chatPersistenceTimer);
  chatPersistenceTimer = null;
  if (activeChatPersistenceScope) await persistChatSessionsNow(activeChatPersistenceScope);
  activeChatPersistenceScope = scope;

  let saved;
  try {
    saved = await window.api.loadChatSessions?.({ scope });
  } catch (error) {
    console.warn("Could not load chat sessions:", error);
  }
  if (scope !== activeChatPersistenceScope) return;

  const restored = saved?.exists
    ? (saved.sessions || []).map(normalizePersistedChatSession).filter(Boolean)
    : [createChatSession("New Agent")];
  const unique = new Map(restored.map((session) => [session.id, session]));
  chatSessions.splice(0, chatSessions.length, ...unique.values());
  const active = chatSessions.find((session) => session.id === saved?.activeSessionId) || chatSessions[0] || null;
  applyActiveChatSession(active);
  renderChatSessionSelect();
  updateContextUsage();
  if (saved?.exists && Number(saved.version) < 2) schedulePersistChatSessions();
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
  const toolsActive = currentWorkspaceMode === "tools";
  const settingsActive = currentWorkspaceMode === "settings";
  activitySecurity?.classList.toggle("active", securityActive);
  activitySecurity?.setAttribute("aria-pressed", String(securityActive));
  activityToolbox?.classList.toggle("active", toolsActive);
  activityToolbox?.setAttribute("aria-pressed", String(toolsActive));
  activitySettings?.classList.toggle("active", settingsActive);
  activitySettings?.setAttribute("aria-pressed", String(settingsActive));
  syncSidebarActivity();
}

function showResourceWorkspace({ focus = false } = {}) {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "resource";
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = false;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (toolsWorkspace) toolsWorkspace.hidden = true;
  if (mapWorkspace) mapWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Workspace editor");
  syncWorkspaceActivity();
  if (focus && !resourceViewerContent?.hidden) requestAnimationFrame(() => resourceViewerContent.focus());
}

function showSecurityWorkspace(tool = "") {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "security";
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = false;
  if (toolsWorkspace) toolsWorkspace.hidden = true;
  if (mapWorkspace) mapWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Security workspace");
  const saved = tool || localStorage.getItem(SECURITY_TOOL_KEY) || "interceptor";
  setSecurityTool(saved, { persist: Boolean(tool) });
  syncWorkspaceActivity();
  refreshSecurityHistoryIfVisible();
  requestAnimationFrame(() => securityRequestEditor?.focus());
}

const TOOL_CATALOG = [
  { category: "Passive Recon Tools", tools: [
    ["amass", "Amass", "Discover external assets and subdomains", "amass enum -passive -d {target}"],
    ["subfinder", "Subfinder", "Passive subdomain discovery", "subfinder -d {target}"],
    ["theharvester", "theHarvester", "Collect public hosts, emails, and names", "theHarvester -d {target} -b all"],
    ["google-dorking", "Google Dorking", "Prepare targeted search operators", "site:{target} inurl:admin"],
  ]},
  { category: "Active Recon Tools", tools: [
    ["nmap", "Nmap", "Service and port discovery", "nmap {ports} {target}"],
    ["naabu", "Naabu", "Fast port enumeration", "naabu -host {target} {ports}"],
    ["masscan", "Masscan", "High-speed authorized network discovery", "masscan {target} {ports}"],
  ]},
  { category: "Web & Endpoint Discovery", tools: [
    ["httpx", "httpx", "Probe HTTP services and metadata", "httpx -u {target}"],
    ["katana", "Katana", "Crawl pages and endpoints", "katana -u {target} -d {depth}"],
    ["ffuf", "ffuf", "Content and parameter discovery", "ffuf -u {target}/FUZZ -w {wordlist}"],
    ["gobuster", "Gobuster", "Directory and DNS enumeration", "gobuster dir -u {target} -w {wordlist}"],
  ]},
  { category: "Firewall & WAF Analysis", tools: [
    ["wafw00f", "WAFW00F", "Fingerprint an authorized web application firewall", "wafw00f {target}", { fields: ["target", "timeout", "rate", "outputFormat", "outputPath"] }],
    ["nmap-firewall", "Nmap ACK Analysis", "Classify filtered and unfiltered TCP ports with bounded ACK probes", "nmap -Pn -sA --reason -p {port} --max-rate {rate} {target}", { fields: ["target", "port", "timeout", "rate", "outputFormat", "outputPath"] }],
    ["hping3", "Hping3", "Send a small bounded TCP probe set for filtering-response analysis", "hping3 -S -c {packetCount} -p {port} -i u500000 {target}", { fields: ["target", "port", "packetCount", "timeout", "rate", "outputFormat", "outputPath"] }],
    ["traceroute", "Traceroute", "Trace network hops and possible filtering boundaries", "traceroute -n -m {maxHops} {target}", { fields: ["target", "maxHops", "timeout", "outputFormat", "outputPath"] }],
  ]},
  { category: "Vulnerability & TLS Analysis", tools: [
    ["nuclei", "Nuclei", "Template-based vulnerability checks", "nuclei -u {target} -severity {severity}"],
    ["nikto", "Nikto", "Web server checks", "nikto -h {target}"],
    ["testssl", "testssl.sh", "TLS configuration analysis", "testssl.sh {target}"],
    ["sqlmap", "SQLmap", "Authorized SQL injection validation", "sqlmap -u {target} --risk={risk} --level={level}"],
  ]},
];
const TOOL_PRESETS = {
  easy: { target: "", timeout: 15, threads: 2, rate: 2, ports: "--top-ports 100", port: 443, packetCount: 3, maxHops: 15, depth: 2, severity: "high,critical", risk: 1, level: 1, wordlist: "", outputFormat: "json" },
  medium: { target: "", timeout: 30, threads: 5, rate: 5, ports: "--top-ports 1000", port: 443, packetCount: 5, maxHops: 20, depth: 3, severity: "medium,high,critical", risk: 2, level: 3, wordlist: "", outputFormat: "json" },
  high: { target: "", timeout: 60, threads: 10, rate: 10, ports: "-p-", port: 443, packetCount: 10, maxHops: 30, depth: 5, severity: "info,low,medium,high,critical", risk: 3, level: 5, wordlist: "", outputFormat: "json" },
};
const TOOL_FIELD_DEFINITIONS = Object.freeze({
  target: { label: "Target", type: "text" }, timeout: { label: "Timeout (seconds)", type: "number", min: 1, max: 3600 },
  threads: { label: "Concurrency / threads", type: "number", min: 1, max: 200 }, rate: { label: "Rate / second", type: "number", min: 1, max: 100000 },
  ports: { label: "Ports", type: "text" }, port: { label: "Destination port", type: "number", min: 1, max: 65535 },
  packetCount: { label: "Packet count", type: "number", min: 1, max: 100 }, maxHops: { label: "Maximum hops", type: "number", min: 1, max: 64 },
  depth: { label: "Crawl depth", type: "number", min: 1, max: 10 }, severity: { label: "Severities", type: "text" },
  risk: { label: "Risk", type: "number", min: 1, max: 3 }, level: { label: "Level", type: "number", min: 1, max: 5 },
  wordlist: { label: "Wordlist path", type: "text" }, sources: { label: "Data sources", type: "text" }, limit: { label: "Result limit", type: "number", min: 1, max: 10000 },
  query: { label: "Search operators", type: "text" }, extensions: { label: "Extensions", type: "text" }, matchCodes: { label: "Match status codes", type: "text" },
  tags: { label: "Template tags", type: "text" }, templates: { label: "Template path", type: "text" }, tuning: { label: "Nikto tuning", type: "text" },
  parameter: { label: "Test parameter", type: "text" }, techniques: { label: "SQLi techniques", type: "text" }, excludePorts: { label: "Excluded ports", type: "text" },
  scanType: { label: "Scan type", type: "select", options: [["TCP connect", "-sT"], ["SYN", "-sS"], ["ACK", "-sA"], ["UDP", "-sU"]] },
  timing: { label: "Timing profile", type: "select", options: [["Polite (T2)", "-T2"], ["Normal (T3)", "-T3"], ["Aggressive (T4)", "-T4"]] },
  serviceFlags: { label: "Service detection", type: "select", options: [["Version light", "-sV --version-light"], ["Standard version scan", "-sV"], ["Disabled", ""]] },
  mode: { label: "Discovery mode", type: "select", options: [["Directory", "dir"], ["Virtual host", "vhost"], ["DNS", "dns"]] },
  redirects: { label: "Redirect behavior", type: "select", options: [["Follow redirects", "-fr"], ["Do not follow", ""]] },
  scopeMode: { label: "Crawler scope", type: "select", options: [["Exact FQDN", "fqdn"], ["Registered domain", "rdn"], ["No scope restriction", ""]] },
  protocol: { label: "TLS focus", type: "select", options: [["Complete TLS review", ""], ["Protocols only", "--protocols"], ["TLS 1.3", "--tls13"]] },
  outputFormat: { label: "Output format", type: "select", options: [["JSON", "json"], ["XML", "xml"], ["Text", "txt"], ["CSV", "csv"], ["HTML", "html"]] },
  outputPath: { label: "Output path", type: "text" },
});
const TOOL_PROFILES = Object.freeze({
  amass: { fields: ["target", "sources", "timeout", "outputFormat", "outputPath"], command: "amass enum -passive -d {target} -src {sources}", presets: { easy: { sources: "", timeout: 15 }, medium: { sources: "", timeout: 30 }, high: { sources: "", timeout: 60 } } },
  subfinder: { fields: ["target", "threads", "timeout", "outputFormat", "outputPath"], command: "subfinder -d {target} -silent -t {threads} -timeout {timeout}", presets: { easy: { threads: 5 }, medium: { threads: 10 }, high: { threads: 25 } } },
  theharvester: { fields: ["target", "sources", "limit", "outputFormat", "outputPath"], command: "theHarvester -d {target} -b {sources} -l {limit}", presets: { easy: { sources: "crtsh,duckduckgo", limit: 200 }, medium: { sources: "crtsh,duckduckgo,otx,urlscan", limit: 500 }, high: { sources: "all", limit: 1000 } } },
  "google-dorking": { fields: ["target", "query", "outputFormat", "outputPath"], command: "site:{target} {query}", presets: { easy: { query: "inurl:login" }, medium: { query: "(inurl:admin OR inurl:api)" }, high: { query: "(ext:json OR ext:xml OR ext:env OR inurl:debug)" } } },
  nmap: { fields: ["target", "scanType", "ports", "timing", "serviceFlags", "rate", "timeout", "outputFormat", "outputPath"], command: "nmap {scanType} {timing} {serviceFlags} -p {ports} --max-rate {rate} {target}", presets: { easy: { scanType: "-sT", ports: "80,443,8080,8443", timing: "-T2", serviceFlags: "-sV --version-light", rate: 50 }, medium: { scanType: "-sT", ports: "1-1000", timing: "-T3", serviceFlags: "-sV", rate: 200 }, high: { scanType: "-sS", ports: "1-65535", timing: "-T3", serviceFlags: "-sV", rate: 500 } } },
  naabu: { fields: ["target", "ports", "rate", "threads", "timeout", "outputFormat", "outputPath"], command: "naabu -host {target} -p {ports} -rate {rate} -c {threads} -json", presets: { easy: { ports: "80,443,8080,8443", rate: 50, threads: 10 }, medium: { ports: "top-1000", rate: 200, threads: 25 }, high: { ports: "-", rate: 500, threads: 50 } } },
  masscan: { fields: ["target", "ports", "rate", "excludePorts", "outputFormat", "outputPath"], command: "masscan {target} -p {ports} --rate {rate} --exclude-ports {excludePorts}", presets: { easy: { ports: "80,443,8080,8443", rate: 50, excludePorts: "" }, medium: { ports: "1-1000", rate: 200, excludePorts: "" }, high: { ports: "1-65535", rate: 500, excludePorts: "" } } },
  httpx: { fields: ["target", "threads", "rate", "timeout", "redirects", "outputFormat", "outputPath"], command: "httpx -u {target} -threads {threads} -rl {rate} -timeout {timeout} {redirects} -json", presets: { easy: { threads: 5, rate: 5, redirects: "" }, medium: { threads: 15, rate: 20, redirects: "-fr" }, high: { threads: 30, rate: 50, redirects: "-fr" } } },
  katana: { fields: ["target", "depth", "threads", "rate", "scopeMode", "timeout", "outputFormat", "outputPath"], command: "katana -u {target} -d {depth} -c {threads} -rl {rate} -fs {scopeMode} -jsonl", presets: { easy: { depth: 2, threads: 2, rate: 2, scopeMode: "fqdn" }, medium: { depth: 3, threads: 5, rate: 5, scopeMode: "fqdn" }, high: { depth: 5, threads: 10, rate: 10, scopeMode: "rdn" } } },
  ffuf: { fields: ["target", "wordlist", "extensions", "matchCodes", "threads", "rate", "timeout", "outputFormat", "outputPath"], command: "ffuf -u {target}/FUZZ -w {wordlist} -e {extensions} -mc {matchCodes} -t {threads} -rate {rate}", presets: { easy: { extensions: "", matchCodes: "200,204,301,302,307,401,403", threads: 5, rate: 5 }, medium: { extensions: ".html,.js,.json,.php", matchCodes: "all", threads: 15, rate: 20 }, high: { extensions: ".html,.js,.json,.php,.txt,.xml,.bak", matchCodes: "all", threads: 30, rate: 50 } } },
  gobuster: { fields: ["target", "mode", "wordlist", "extensions", "threads", "timeout", "outputFormat", "outputPath"], command: "gobuster {mode} -u {target} -w {wordlist} -x {extensions} -t {threads}", presets: { easy: { mode: "dir", extensions: "", threads: 5 }, medium: { mode: "dir", extensions: "html,js,json,php", threads: 15 }, high: { mode: "vhost", extensions: "", threads: 30 } } },
  wafw00f: { fields: ["target", "timeout", "outputFormat", "outputPath"], presets: { easy: { timeout: 15 }, medium: { timeout: 30 }, high: { timeout: 60 } } },
  "nmap-firewall": { fields: ["target", "port", "rate", "timing", "timeout", "outputFormat", "outputPath"], presets: { easy: { port: 443, rate: 2, timing: "-T2" }, medium: { port: 443, rate: 5, timing: "-T3" }, high: { port: 443, rate: 10, timing: "-T3" } } },
  hping3: { fields: ["target", "port", "packetCount", "rate", "timeout", "outputFormat", "outputPath"], presets: { easy: { packetCount: 3, rate: 2 }, medium: { packetCount: 5, rate: 5 }, high: { packetCount: 10, rate: 10 } } },
  traceroute: { fields: ["target", "maxHops", "timeout", "outputFormat", "outputPath"], presets: { easy: { maxHops: 15 }, medium: { maxHops: 20 }, high: { maxHops: 30 } } },
  nuclei: { fields: ["target", "severity", "tags", "templates", "threads", "rate", "timeout", "outputFormat", "outputPath"], command: "nuclei -u {target} -severity {severity} -tags {tags} -t {templates} -c {threads} -rl {rate} -jsonl", presets: { easy: { severity: "high,critical", tags: "", templates: "", threads: 2, rate: 2 }, medium: { severity: "medium,high,critical", tags: "", templates: "", threads: 5, rate: 5 }, high: { severity: "info,low,medium,high,critical", tags: "", templates: "", threads: 10, rate: 10 } } },
  nikto: { fields: ["target", "tuning", "timeout", "outputFormat", "outputPath"], command: "nikto -host {target} -Tuning {tuning} -maxtime {timeout}s -nointeractive", presets: { easy: { tuning: "2,3", timeout: 60 }, medium: { tuning: "1,2,3,6", timeout: 180 }, high: { tuning: "x", timeout: 600 } } },
  testssl: { fields: ["target", "protocol", "timeout", "outputFormat", "outputPath"], command: "testssl {protocol} --warnings batch {target}", presets: { easy: { protocol: "--protocols", timeout: 60 }, medium: { protocol: "", timeout: 180 }, high: { protocol: "", timeout: 600 } } },
  sqlmap: { fields: ["target", "parameter", "techniques", "risk", "level", "threads", "timeout", "outputFormat", "outputPath"], command: "sqlmap -u {target} -p {parameter} --technique={techniques} --risk={risk} --level={level} --threads={threads} --batch", presets: { easy: { parameter: "", techniques: "BE", risk: 1, level: 1, threads: 1 }, medium: { parameter: "", techniques: "BEUSTQ", risk: 2, level: 3, threads: 3 }, high: { parameter: "", techniques: "BEUSTQ", risk: 3, level: 5, threads: 5 } } },
});
let selectedCatalogTool = null;
let selectedToolPreset = "easy";
let selectedToolView = "ui";
let selectedToolConfig = {};
const CUSTOM_TOOLS_KEY = "pointer:customToolManifests";
let customToolManifests = [];

const TOOL_ICONS = {
  amass: "codicon-globe", subfinder: "codicon-search", theharvester: "codicon-list-tree", "google-dorking": "codicon-search-fuzzy",
  nmap: "codicon-server-process", naabu: "codicon-radio-tower", masscan: "codicon-broadcast",
  httpx: "codicon-globe", katana: "codicon-git-branch", ffuf: "codicon-symbol-key", gobuster: "codicon-folder",
  wafw00f: "codicon-shield", "nmap-firewall": "codicon-server-process", hping3: "codicon-pulse", traceroute: "codicon-git-merge",
  nuclei: "codicon-bug", nikto: "codicon-shield", testssl: "codicon-lock", sqlmap: "codicon-database",
};

function renderToolCatalog() {
  if (!toolCatalog) return;
  toolCatalog.innerHTML = "";
  const groups = [...TOOL_CATALOG];
  const customGroups = new Map();
  customToolManifests.forEach((tool) => {
    const category = tool.category || "Custom Tools";
    if (!customGroups.has(category)) customGroups.set(category, []);
    customGroups.get(category).push([tool.id, tool.name, tool.description, tool.command, tool]);
  });
  customGroups.forEach((tools, category) => groups.push({ category, tools }));
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "tool-category";
    section.innerHTML = `<header><strong>${group.category}</strong><span>${group.tools.length} tools</span></header>`;
    const grid = document.createElement("div"); grid.className = "tool-card-grid";
    group.tools.forEach(([id, name, description, command, manifest]) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "tool-card";
      button.innerHTML = `<span class="codicon ${TOOL_ICONS[id] || "codicon-tools"} tool-card-icon"></span><span><strong>${name}</strong><small>${description}</small></span><span class="codicon codicon-chevron-right"></span>`;
      button.addEventListener("click", () => openToolConfig({ id, name, description, command, ...(TOOL_PROFILES[id] || {}), ...(manifest || {}) })); grid.appendChild(button);
    }); section.appendChild(grid); toolCatalog.appendChild(section);
  });
}

function loadCustomToolManifests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || "[]");
    customToolManifests = Array.isArray(parsed) ? parsed.filter((tool) => tool && /^[a-z0-9][a-z0-9_-]{1,40}$/.test(tool.id) && tool.name && tool.command) : [];
  } catch { customToolManifests = []; }
}

function saveCustomToolManifests() {
  localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(customToolManifests, null, 2));
}

function openToolRegister() {
  toolRegisterOverlay.hidden = false;
  toolRegisterDialog?.querySelector("input")?.focus();
}

function closeToolRegister() {
  if (toolRegisterOverlay) toolRegisterOverlay.hidden = true;
}

function registerCustomTool(manifest) {
  const tool = {
    id: String(manifest.id || "").trim().toLowerCase(),
    name: String(manifest.name || "").trim().slice(0, 100),
    category: String(manifest.category || "Custom Tools").trim().slice(0, 80),
    executable: String(manifest.executable || "").trim().slice(0, 160),
    description: String(manifest.description || "").trim().slice(0, 300),
    command: String(manifest.command || "").trim().slice(0, 1000),
  };
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(tool.id) || !tool.name || !tool.executable || !tool.description || !tool.command) {
    addErrorMessage("Custom tool requires a valid ID, name, executable, description, and command template.");
    return false;
  }
  const builtIn = TOOL_CATALOG.some((group) => group.tools.some(([id]) => id === tool.id));
  if (builtIn || customToolManifests.some((entry) => entry.id === tool.id)) {
    addErrorMessage(`A tool with ID ${tool.id} is already registered.`);
    return false;
  }
  customToolManifests.push(tool);
  saveCustomToolManifests();
  renderToolCatalog();
  return true;
}

async function refreshToolHealth() {
  if (!toolHealthResults || !window.api?.toolHealth) return;
  toolHealthResults.hidden = false;
  toolHealthResults.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span><span>Checking configured tool adapters...</span>';
  const result = await window.api.toolHealth({ customTools: customToolManifests });
  if (result?.error) { toolHealthResults.textContent = result.error; return; }
  const tools = result?.tools || [];
  const installed = tools.filter((tool) => tool.installed).length;
  toolHealthResults.innerHTML = `<strong>${installed}/${tools.length} available</strong>${tools.map((tool) => `<span class="tool-health-chip ${tool.installed ? "ok" : "missing"}" title="${escapeHtml(tool.version || tool.error || "")}"><i class="codicon ${tool.installed ? "codicon-check" : "codicon-error"}"></i>${escapeHtml(tool.executable)}</span>`).join("")}`;
}

function toolOutputPath(tool, config) { return `tools/${tool.id}/results.${config.outputFormat || "json"}`; }
function syncToolCommand() {
  if (!selectedCatalogTool) return;
  const config = selectedToolConfig;
  const command = selectedCatalogTool.command.replace(/\{(\w+)\}/g, (_, key) => String(config[key] ?? ""));
  toolCommandPreview.textContent = command;
  if (selectedToolView === "json") toolConfigJson.value = JSON.stringify(config, null, 2);
}
function renderToolFields() {
  toolConfigUi.innerHTML = "";
  const fieldKeys = selectedCatalogTool?.fields || ["target", "timeout", "threads", "rate", "outputFormat", "outputPath"];
  fieldKeys.forEach((key) => {
    const definition = TOOL_FIELD_DEFINITIONS[key];
    if (!definition) return;
    const row = document.createElement("label"); row.innerHTML = `<span>${definition.label}</span>`;
    const input = definition.type === "select" ? document.createElement("select") : document.createElement("input");
    if (definition.type === "select") {
      (definition.options || []).forEach(([label, value]) => input.add(new Option(label, value)));
    } else {
      input.type = definition.type;
      if (definition.min != null) input.min = String(definition.min);
      if (definition.max != null) input.max = String(definition.max);
    }
    input.value = selectedToolConfig[key] ?? ""; input.addEventListener("input", () => { selectedToolConfig[key] = definition.type === "number" ? Number(input.value) : input.value; if (key === "outputFormat") { selectedToolConfig.outputPath = toolOutputPath(selectedCatalogTool, selectedToolConfig); renderToolFields(); } syncToolCommand(); });
    row.appendChild(input); toolConfigUi.appendChild(row);
  });
}
function applyToolPreset(preset) {
  selectedToolPreset = preset;
  if (preset !== "custom") {
    const base = { ...TOOL_PRESETS[preset], ...(selectedCatalogTool?.presets?.[preset] || {}) };
    const allowedFields = new Set(selectedCatalogTool?.fields || Object.keys(base));
    selectedToolConfig = Object.fromEntries(Object.entries(base).filter(([key]) => allowedFields.has(key)));
    if (allowedFields.has("outputPath")) selectedToolConfig.outputPath = toolOutputPath(selectedCatalogTool, selectedToolConfig);
  }
  document.querySelectorAll("[data-tool-preset]").forEach((button) => button.classList.toggle("active", button.dataset.toolPreset === preset));
  renderToolFields(); syncToolCommand();
}
function setToolView(view) {
  if (view === "ui" && selectedToolView === "json") { try { selectedToolConfig = JSON.parse(toolConfigJson.value); } catch { return; } }
  selectedToolView = view; toolConfigUi.hidden = view !== "ui"; toolConfigJson.hidden = view !== "json";
  document.querySelectorAll("[data-tool-view]").forEach((button) => button.classList.toggle("active", button.dataset.toolView === view));
  if (view === "ui") renderToolFields(); syncToolCommand();
}
function openToolConfig(tool) {
  selectedCatalogTool = tool; toolConfigTitle.textContent = tool.name; toolConfigDescription.textContent = tool.description;
  const icon = $("tool-config-icon"); if (icon) icon.className = `codicon ${TOOL_ICONS[tool.id] || "codicon-tools"}`;
  toolConfigOverlay.hidden = false; applyToolPreset("easy"); setToolView("ui");
}
function showToolsWorkspace() {
  if (terminalMaximized) setTerminalMaximized(false); currentWorkspaceMode = "tools";
  resourceViewer.hidden = true; securityWorkspace.hidden = true; toolsWorkspace.hidden = false; mapWorkspace.hidden = true; appSettingsWorkspace.hidden = true; webcloneWorkspace.hidden = true; window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Security toolbox"); loadCustomToolManifests(); renderToolCatalog(); syncWorkspaceActivity();
}

const AUTHORITY_DEFAULTS = Object.freeze({
  superMode: "ask",
  permissions: {
    workspaceRead: true,
    workspaceWrite: true,
    workspaceDelete: false,
    commandExecution: true,
    backgroundProcesses: true,
    terminalAccess: true,
    webResearch: true,
    outboundHttp: true,
    proxyInterception: true,
    trafficCapture: true,
    mapBuild: true,
    evidenceManagement: true,
    passiveRecon: true,
    activeRecon: false,
    automatedScanning: false,
    exploitValidation: false,
    customScripts: false,
    sensitiveDataAccess: false,
  },
});

const AUTHORITY_GROUPS = [
  ["Workspace", "Files, local processes, and the integrated terminal.", [
    ["workspaceRead", "Read workspace files", "Allow the app and AI to inspect project and assessment files."],
    ["workspaceWrite", "Create and edit files", "Allow writes, patches, generated reports, and assessment updates."],
    ["workspaceDelete", "Delete files and folders", "Allow destructive removal of user-created workspace content."],
    ["commandExecution", "Run local commands", "Allow foreground command execution through typed tool adapters."],
    ["backgroundProcesses", "Start background processes", "Allow long-running tools and managed process sessions."],
    ["terminalAccess", "Use the integrated terminal", "Allow operator and AI-assisted terminal workflows."],
    ["customScripts", "Run custom scripts", "Allow scripts from the assessment custom_scripts folder."],
  ]],
  ["Network and Traffic", "Outbound requests, interception, capture, and research.", [
    ["webResearch", "Web research", "Allow search and readable-page retrieval from public sources."],
    ["outboundHttp", "Send HTTP requests", "Allow Repeater, Intruder, endpoint probes, and HTTP adapters."],
    ["proxyInterception", "Intercept proxied traffic", "Allow the local interception proxy and request forwarding."],
    ["trafficCapture", "Capture request/response traffic", "Allow Traffic/Raw logging and response evidence."],
    ["sensitiveDataAccess", "Read unredacted sensitive data", "Allow access to credentials, tokens, cookies, and unredacted bodies."],
  ]],
  ["Assessment", "Evidence, graph, reporting, and passive discovery.", [
    ["mapBuild", "Build and query the Map", "Allow application graph generation and Map evidence queries."],
    ["evidenceManagement", "Manage evidence and findings", "Allow evidence records, hypotheses, findings, and reports."],
    ["passiveRecon", "Run passive reconnaissance", "Allow public-source discovery without active probing."],
  ]],
  ["Sensitive Testing", "Capabilities that may send substantial traffic or validate vulnerabilities.", [
    ["activeRecon", "Run active reconnaissance", "Allow approved probing of in-scope assets."],
    ["automatedScanning", "Run automated scanners", "Allow tools such as Nmap, ffuf, Nuclei, Nikto, and Katana."],
    ["exploitValidation", "Validate exploit hypotheses", "Allow explicitly authorized exploit-oriented checks in Test mode."],
  ]],
];

function normalizeAuthoritySettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const superMode = ["full", "ask", "approve"].includes(input.superMode) ? input.superMode : AUTHORITY_DEFAULTS.superMode;
  return {
    superMode,
    permissions: { ...AUTHORITY_DEFAULTS.permissions, ...(input.permissions && typeof input.permissions === "object" ? input.permissions : {}) },
  };
}

function authorityAllows(permission) {
  const settings = normalizeAuthoritySettings(authoritySettingsData);
  return settings.superMode === "full" || settings.permissions[permission] !== false;
}

function requireAuthority(permission, actionLabel) {
  if (authorityAllows(permission)) return true;
  const message = `${actionLabel} is disabled in Pointer Settings → Authority.`;
  setAgentStatus(message);
  addErrorMessage(message);
  return false;
}

const PROMPT_MODULE_LABELS = Object.freeze({
  role: "Role",
  evidence: "Evidence",
  loop: "Loop",
  failure: "Failure",
  feedback: "Feedback",
  guardrails: "Guardrails",
  "assist:planner": "Safe Planner",
  "assist:agent": "Safe Agent",
  "assist:ask": "Safe Ask",
  "testing:planner": "Test Planner",
  "testing:agent": "Test Agent",
  "testing:ask": "Test Ask",
});

function promptDefaults() {
  return globalThis.PointerPromptCompiler?.defaults?.() || { version: 1, modules: {}, overlays: {} };
}

function normalizePromptSettings(value) {
  const defaults = promptDefaults();
  const input = value && typeof value === "object" ? value : {};
  return {
    version: defaults.version,
    modules: { ...defaults.modules, ...(input.modules || {}) },
    overlays: { ...defaults.overlays, ...(input.overlays || {}) },
  };
}

function normalizeAIModelSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    verifierModel: String(input.verifierModel || ""),
    requireQualifiedModelForTestAgent: input.requireQualifiedModelForTestAgent !== false,
    allowUnqualifiedTestAgentDeveloperOverride: Boolean(input.allowUnqualifiedTestAgentDeveloperOverride),
    qualification: input.qualification && typeof input.qualification === "object" ? input.qualification : {},
    temperatures: { planner: 0.1, agent: 0.1, ask: 0.2, verifier: 0, reporter: 0, ...(input.temperatures || {}) },
  };
}

function promptModuleValue(key, source = promptSettingsData) {
  return key.includes(":") ? source?.overlays?.[key] || "" : source?.modules?.[key] || "";
}

function setPromptModuleValue(key, value) {
  promptSettingsData = normalizePromptSettings(promptSettingsData);
  const bucket = key.includes(":") ? promptSettingsData.overlays : promptSettingsData.modules;
  bucket[key] = String(value || "");
}

function renderPromptModuleDiff(current, recommended) {
  if (current === recommended) return "No changes from the recommended default.";
  const currentLines = String(current || "").split("\n");
  const defaultLines = String(recommended || "").split("\n");
  const output = [];
  const count = Math.max(currentLines.length, defaultLines.length);
  for (let index = 0; index < count; index += 1) {
    if (defaultLines[index] === currentLines[index]) continue;
    if (defaultLines[index] !== undefined) output.push(`- ${defaultLines[index]}`);
    if (currentLines[index] !== undefined) output.push(`+ ${currentLines[index]}`);
  }
  return output.join("\n") || "The profile metadata changed; module text is unchanged.";
}

function validatePromptSettings() {
  const result = globalThis.PointerPromptCompiler?.validate?.(promptSettingsData) || { ok: true, errors: [], warnings: [] };
  const effective = globalThis.PointerPromptCompiler?.compile?.({ family: chatFamily || "assist", mode: chatMode || "ask", overrides: promptSettingsData }) || "";
  const defaults = promptDefaults();
  const changed = promptModuleValue(selectedPromptModule) !== promptModuleValue(selectedPromptModule, defaults);
  if (promptSettingsDirty) promptSettingsDirty.hidden = !changed;
  if (promptSettingsValidation) {
    promptSettingsValidation.textContent = result.ok
      ? (result.warnings?.length ? result.warnings.join(" ") : "Valid. Runtime policy remains non-bypassable.")
      : result.errors.join(" ");
    promptSettingsValidation.classList.toggle("error", !result.ok);
  }
  const checksum = globalThis.PointerPromptCompiler?.checksum?.(promptSettingsData) || "unavailable";
  if (promptSettingsTokenCost) promptSettingsTokenCost.textContent = `${Math.ceil(effective.length / 4).toLocaleString()} estimated tokens · profile v${promptSettingsData?.version || 1} · ${checksum}`;
  if (promptSettingsDiff) promptSettingsDiff.textContent = renderPromptModuleDiff(promptModuleValue(selectedPromptModule), promptModuleValue(selectedPromptModule, defaults));
  if (promptSettingsEffective) promptSettingsEffective.textContent = effective;
  if (commandSettingsSave) commandSettingsSave.disabled = !result.ok;
  return result;
}

function renderPromptSettings() {
  promptSettingsData = normalizePromptSettings(promptSettingsData || assessmentSettingsCache?.aiPrompts);
  aiModelSettingsData = normalizeAIModelSettings(aiModelSettingsData || assessmentSettingsCache?.aiModels);
  const keys = Object.keys(PROMPT_MODULE_LABELS);
  if (!keys.includes(selectedPromptModule)) selectedPromptModule = keys[0];
  if (promptSettingsModules) {
    promptSettingsModules.innerHTML = keys.map((key) => `<button type="button" data-prompt-module="${key}" class="${selectedPromptModule === key ? "active" : ""}"><span>${escapeHtml(PROMPT_MODULE_LABELS[key])}</span><small>${key.includes(":") ? "Mode overlay" : "Core module"}</small></button>`).join("");
    promptSettingsModules.querySelectorAll("[data-prompt-module]").forEach((button) => button.addEventListener("click", () => {
      selectedPromptModule = button.dataset.promptModule;
      renderPromptSettings();
    }));
  }
  if (promptSettingsTitle) promptSettingsTitle.textContent = PROMPT_MODULE_LABELS[selectedPromptModule];
  if (promptSettingsEditor) promptSettingsEditor.value = promptModuleValue(selectedPromptModule);
  if (promptVerifierModel) promptVerifierModel.value = aiModelSettingsData.verifierModel;
  if (promptRequireQualified) promptRequireQualified.checked = aiModelSettingsData.requireQualifiedModelForTestAgent;
  if (promptUnqualifiedOverride) promptUnqualifiedOverride.checked = aiModelSettingsData.allowUnqualifiedTestAgentDeveloperOverride;
  validatePromptSettings();
}

function loadPromptSettings() {
  promptSettingsData = normalizePromptSettings(assessmentSettingsCache?.aiPrompts);
  aiModelSettingsData = normalizeAIModelSettings(assessmentSettingsCache?.aiModels);
  renderPromptSettings();
}

async function loadAuthoritySettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(AUTHORITY_SETTINGS_KEY) || "{}"); } catch { stored = {}; }
  if (assessmentPath) {
    const settings = assessmentSettingsCache || (await refreshAssessmentSettingsCache())?.settings;
    if (settings?.authority) stored = settings.authority;
  }
  authoritySettingsData = normalizeAuthoritySettings(stored);
  return authoritySettingsData;
}

function setAppSettingsSection(section) {
  appSettingsSection = ["commands", "authority", "prompts", "certificates"].includes(section) ? section : "commands";
  appSettingsCommandsPanel.hidden = appSettingsSection !== "commands";
  appSettingsAuthorityPanel.hidden = appSettingsSection !== "authority";
  appSettingsPromptsPanel.hidden = appSettingsSection !== "prompts";
  appSettingsCertificatesPanel.hidden = appSettingsSection !== "certificates";
  if (commandSettingsSave) commandSettingsSave.hidden = appSettingsSection === "certificates";
  appSettingsSectionButtons.forEach((button) => {
    const active = button.dataset.appSettingsSection === appSettingsSection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (appSettingsSection === "authority") renderAuthoritySettings();
  if (appSettingsSection === "prompts") renderPromptSettings();
  if (appSettingsSection === "certificates") loadCertificateSettings();
}

function renderCertificateSettings(snapshot = certificateSettingsData) {
  if (!snapshot) return;
  certificateSettingsData = snapshot;
  if (certificateDirectory) certificateDirectory.value = snapshot.directory || "";
  if (certificateLocationBadge) certificateLocationBadge.textContent = snapshot.usingDefault ? "Default" : "Custom";
  if (certificateStatus) {
    certificateStatus.textContent = snapshot.certificateExists ? "Ready · shared by every assessment" : "Not generated · start the proxy listener to create it";
    certificateStatus.classList.toggle("ready", Boolean(snapshot.certificateExists));
  }
  if (certificateFilePath) certificateFilePath.textContent = snapshot.certificatePath || "Generated when the proxy listener first starts";
  if (certificateReset) certificateReset.disabled = Boolean(snapshot.usingDefault);
}

async function loadCertificateSettings() {
  if (!window.api.certificateSettings) return;
  if (certificateStatus) certificateStatus.textContent = "Checking…";
  const result = await window.api.certificateSettings();
  if (result?.error) {
    if (certificateStatus) certificateStatus.textContent = result.error;
    return;
  }
  renderCertificateSettings(result);
}

async function chooseCertificateDirectory() {
  const result = await window.api.chooseCertificateDirectory?.({ assessmentPath });
  if (!result || result.canceled) return;
  if (result.error) return addErrorMessage(result.error);
  renderCertificateSettings(result);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Shared CA location updated";
}

async function resetCertificateDirectory() {
  const result = await window.api.resetCertificateDirectory?.({ assessmentPath });
  if (result?.error) return addErrorMessage(result.error);
  renderCertificateSettings(result);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Default CA location restored";
}

function renderAuthoritySettings() {
  if (!authoritySettingsContent) return;
  authoritySettingsData = normalizeAuthoritySettings(authoritySettingsData);
  const mode = authoritySettingsData.superMode;
  const superOptions = [
    ["full", "Full Authority", "Forces every listed permission ON and bypasses Pointer approval prompts.", "Overrides all permission switches and approval behavior.", "danger"],
    ["ask", "Ask for Approval", "Uses the detailed permission switches and asks before sensitive or mutating actions.", "Overrides automatic approval; recommended for human-in-the-loop work.", ""],
    ["approve", "Approve for me", "Uses the detailed permission switches and automatically approves actions that they allow.", "Overrides approval prompts, but does not enable disabled permissions.", ""],
  ];
  const modeSummary = mode === "full"
    ? '<strong>Effective override:</strong> every permission below is ON and Pointer approval prompts are bypassed. Safe/Test mode and engagement scope remain visible operational boundaries.'
    : mode === "approve"
      ? '<strong>Effective override:</strong> enabled permissions are automatically approved. Disabled permissions still block the app and AI.'
      : '<strong>Effective override:</strong> detailed permissions remain authoritative and sensitive actions require operator approval.';
  const groups = AUTHORITY_GROUPS.map(([title, description, permissions]) => `<section class="authority-group"><header><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></header>${permissions.map(([key, label, detail]) => {
    const effective = mode === "full" || authoritySettingsData.permissions[key] !== false;
    return `<label class="authority-permission${mode === "full" ? " overridden" : ""}"><span><strong>${escapeHtml(label)}${mode === "full" ? '<em class="authority-effective">Forced on</em>' : ""}</strong><small>${escapeHtml(detail)}</small></span><input type="checkbox" data-authority-permission="${key}" ${effective ? "checked" : ""} ${mode === "full" ? "disabled" : ""}></label>`;
  }).join("")}</section>`).join("");
  authoritySettingsContent.innerHTML = `<div class="authority-intro"><h2>Authority</h2><p>Control exactly what Pointer and its AI workflows may read, change, execute, send, capture, and validate. Engagement scope and authorization remain separately documented under Scope.</p></div><div class="authority-super-grid">${superOptions.map(([key, label, description, override, tone]) => `<label class="authority-super-option ${tone}${mode === key ? " selected" : ""}"><input type="radio" name="authority-super" value="${key}" ${mode === key ? "checked" : ""}><strong>${label}</strong><small>${description}</small><em>${override}</em></label>`).join("")}</div><div class="authority-override-summary ${mode === "full" ? "danger" : mode === "ask" ? "warning" : ""}">${modeSummary}</div><div class="authority-groups">${groups}</div>`;
  authoritySettingsContent.querySelectorAll('input[name="authority-super"]').forEach((input) => input.addEventListener("change", () => {
    if (input.value === "full" && !window.confirm("Full Authority enables every listed capability and bypasses Pointer approval prompts. Engagement scope still applies. Continue?")) {
      renderAuthoritySettings();
      return;
    }
    authoritySettingsData.superMode = input.value;
    commandSettingsStatus.textContent = "Unsaved authority changes";
    renderAuthoritySettings();
  }));
  authoritySettingsContent.querySelectorAll("[data-authority-permission]").forEach((input) => input.addEventListener("change", () => {
    authoritySettingsData.permissions[input.dataset.authorityPermission] = input.checked;
    commandSettingsStatus.textContent = "Unsaved authority changes";
  }));
}

async function showAppSettingsWorkspace() {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "settings";
  resourceViewer.hidden = true; securityWorkspace.hidden = true; toolsWorkspace.hidden = true; mapWorkspace.hidden = true; appSettingsWorkspace.hidden = false; webcloneWorkspace.hidden = true; window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Pointer Settings");
  await refreshAssessmentSettingsCache();
  loadCommandSettings();
  loadPromptSettings();
  await loadAuthoritySettings();
  await loadCertificateSettings();
  renderCommandSettings();
  setAppSettingsSection(appSettingsSection);
  refreshCustomScripts();
  syncWorkspaceActivity();
}

const COMMAND_SETTINGS_DEFAULTS = {
  "/passive": { role: "static", enabled: true, tools: ["subfinder", "amass", "theharvester"], output: "recon/passive-recon.json" },
  "/active": { role: "static", enabled: true, tools: ["httpx", "nmap", "ffuf"], output: "recon/active-recon.json", wordlist: "", rate: 2, threads: 10 },
  "/endpoint": { role: "static", enabled: true, tools: ["katana", "httpx"], output: "enumeration/endpoints.json" },
  "/webclone": { role: "static", enabled: true, tools: ["katana", "httpx", "gowitness"], output: "enumeration/pages.json" },
  "/pentest": { role: "ai", enabled: true, tools: [], aim: "Find and validate security weaknesses within the authorized assessment scope.", description: "AI-guided penetration testing that stays evidence-led and asks before intrusive actions.", prompt: "Run a careful authorized pentest workflow." },
  "/scope": { role: "ai", enabled: true, tools: [], aim: "Establish what may be tested before any security action is taken.", description: "Review authorization, scope, exclusions, and rules of engagement.", prompt: "Review authorization, scope, exclusions, and rules of engagement." },
  "/report": { role: "ai", enabled: true, tools: [], aim: "Turn assessment evidence into a clear, traceable security report.", description: "Synthesize findings while preserving evidence IDs, confidence, and reproduction details.", prompt: "Synthesize the current assessment evidence into a traceable report." },
  "/map": { role: "ai", enabled: true, tools: [], aim: "Explain how hosts, routes, observations, and workflows relate to one another.", description: "Analyze the application behavior Map and identify evidence-backed relationships.", prompt: "Analyze the application behavior Map and identify evidence-backed relationships." },
  "/settings": { role: "ai", enabled: true, tools: [], aim: "Configure Pointer commands and execution behavior.", description: "Open the dedicated Pointer Settings workspace.", prompt: "" },
};
const COMMAND_TOOL_OPTIONS = ["subfinder", "amass", "theharvester", "httpx", "nmap", "ffuf", "katana", "gowitness", "gobuster", "nuclei", "nikto", "testssl", "sqlmap", "custom_script"];

function loadCommandSettings() {
  try { commandSettingsData = JSON.parse(localStorage.getItem(COMMAND_REGISTRY_KEY) || "{}"); } catch { commandSettingsData = {}; }
  if (!commandSettingsData || typeof commandSettingsData !== "object") commandSettingsData = {};
}

function commandSettingNames() {
  const names = [...Object.keys(COMMAND_SETTINGS_DEFAULTS), ...Object.keys(commandSettingsData || {})];
  return names.filter((name, index) => /^\/[\w-]+$/.test(name) && names.indexOf(name) === index);
}

function commandSetting(name) {
  return { ...(COMMAND_SETTINGS_DEFAULTS[name] || { role: "ai", enabled: true, tools: [] }), ...(commandSettingsData[name] || {}) };
}

function updateCommandSetting(key, value) {
  const current = commandSetting(selectedCommandSettingsName);
  commandSettingsData[selectedCommandSettingsName] = { ...current, [key]: value };
  if (key === "tools") renderCommandSettings();
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Unsaved changes";
}

function renderCustomCommandsPanel(names) {
  if (!customCommandsList) return;
  customCommandsList.innerHTML = names.length ? names.map((name) => {
    const config = commandSetting(name);
    return `<div class="command-setting-item custom-command-row${name === selectedCommandSettingsName ? " selected" : ""}" data-command-setting="${escapeHtml(name)}"><button type="button" class="command-setting-select" aria-label="Select ${escapeHtml(name)}"><span class="codicon codicon-terminal"></span><span><strong>${escapeHtml(name)}</strong><small>${config.role} · ${config.enabled === false ? "disabled" : "enabled"}</small></span></button><button type="button" class="icon-btn command-delete-btn" data-delete-command="${escapeHtml(name)}" title="Delete ${escapeHtml(name)}" aria-label="Delete ${escapeHtml(name)}"><span class="codicon codicon-trash"></span></button></div>`;
  }).join("") : '<div class="custom-scripts-empty">Use + to create a command.</div>';
  customCommandsList.querySelectorAll("[data-command-setting]").forEach((row) => row.querySelector(".command-setting-select")?.addEventListener("click", () => { selectedCommandSettingsName = row.dataset.commandSetting; renderCommandSettings(); }));
  customCommandsList.querySelectorAll("[data-delete-command]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const name = button.dataset.deleteCommand;
    if (!name || !window.confirm(`Delete custom command ${name}?`)) return;
    delete commandSettingsData[name];
    if (selectedCommandSettingsName === name) selectedCommandSettingsName = Object.keys(COMMAND_SETTINGS_DEFAULTS)[0];
    commandSettingsStatus.textContent = "Unsaved changes";
    renderCommandSettings();
  }));
}

async function refreshCustomScripts() {
  const root = assessmentPath || workspacePath;
  if (!root || !window.api.listCustomScripts) { customScriptsCache = []; return; }
  const result = await window.api.listCustomScripts({ path: root });
  customScriptsCache = result?.scripts || [];
  // Scripts are intentionally not displayed in the sidebar. They remain
  // available to the command editor's explicit script selector.
  if (currentWorkspaceMode === "settings") renderCommandSettings();
}

function renderCommandSettings() {
  if (!commandSettingsList || !commandSettingsDetail) return;
  const names = commandSettingNames();
  const builtinNames = Object.keys(COMMAND_SETTINGS_DEFAULTS);
  const customNames = names.filter((name) => !builtinNames.includes(name));
  if (!names.includes(selectedCommandSettingsName)) selectedCommandSettingsName = names[0] || "/passive";
  commandSettingsList.innerHTML = builtinNames.map((name) => {
    const config = commandSetting(name);
    return `<button type="button" class="command-setting-item${name === selectedCommandSettingsName ? " selected" : ""}" data-command-setting="${escapeHtml(name)}"><span class="codicon ${config.role === "static" ? "codicon-terminal" : "codicon-copilot"}"></span><span><strong>${escapeHtml(name)}</strong><small>${config.role} · ${config.enabled === false ? "disabled" : "enabled"}</small></span></button>`;
  }).join("");
  commandSettingsList.querySelectorAll("[data-command-setting]").forEach((button) => button.addEventListener("click", () => { selectedCommandSettingsName = button.dataset.commandSetting; renderCommandSettings(); }));
  renderCustomCommandsPanel(customNames);
  renderCommandSettingsDetail(commandSetting(selectedCommandSettingsName));
}

function renderCommandSettingsDetail(config) {
  const name = selectedCommandSettingsName;
  const toolChecks = COMMAND_TOOL_OPTIONS.map((tool) => `<label class="command-tool-check"><input type="checkbox" data-command-tool="${tool}" ${(config.tools || []).includes(tool) ? "checked" : ""}><span>${tool}</span></label>`).join("");
  const toolConfigFields = (config.tools || []).filter((tool) => tool !== "custom_script").map((tool) => `<label class="command-tool-config-field"><span>${tool} advanced configuration</span><textarea data-tool-config="${tool}" spellcheck="false">${escapeHtml(JSON.stringify((config.toolConfig || {})[tool] || {}, null, 2))}</textarea></label>`).join("");
  const scripts = customScriptsCache.map((script) => `<option value="${escapeHtml(script.relativePath)}">${escapeHtml(script.relativePath)}</option>`).join("");
  const aiFields = config.role === "ai" ? `<div class="command-settings-section command-ai-section"><h3>AI behavior</h3><p>These fields shape the Agent workflow and are only available for commands with the AI role.</p><div class="command-settings-grid"><label>Aim<input id="command-ai-aim" value="${escapeHtml(config.aim || "")}" placeholder="What should the agent accomplish?"></label><label>Expected output<input id="command-ai-output" value="${escapeHtml(config.expectedOutput || "")}" placeholder="What should it produce?"></label></div><label>Description<textarea id="command-ai-description" placeholder="Describe the command's purpose and operating context.">${escapeHtml(config.description || "")}</textarea></label><label>Prompt<textarea id="command-prompt" placeholder="Instructions used when this command has the AI role.">${escapeHtml(config.prompt || "")}</textarea></label><label>Safety constraints<textarea id="command-ai-constraints" placeholder="Authorization, rate, or evidence constraints the agent must respect.">${escapeHtml(config.constraints || "")}</textarea></label></div>` : "";
  commandSettingsDetail.innerHTML = `<header class="command-settings-detail-header"><div><span class="codicon codicon-terminal"></span><div><strong>${escapeHtml(name)}</strong><small>Configure execution behavior and tool composition.</small></div></div><span class="command-role-badge ${config.role}">${config.role}</span></header><div class="command-settings-form"><div class="command-settings-row command-settings-row-inline"><label>Enabled<small>Show and allow this command.</small></label><input id="command-enabled" type="checkbox" ${config.enabled !== false ? "checked" : ""}></div><div class="command-settings-row"><label>Role<small>Static runs through Python; AI expands into the Agent workflow.</small></label><select id="command-role"><option value="static" ${config.role === "static" ? "selected" : ""}>Static · Python runner</option><option value="ai" ${config.role === "ai" ? "selected" : ""}>AI · Agent workflow</option></select></div><div class="command-settings-section"><h3>Tools</h3><p>Enable or disable tools used by this command.</p><div class="command-tools-grid">${toolChecks}</div></div><div class="command-settings-section"><h3>Basic configuration</h3><div class="command-settings-grid"><label>Wordlist<input id="command-wordlist" value="${escapeHtml(config.wordlist || "")}" placeholder="Required by ffuf"></label><label>Rate / second<input id="command-rate" type="number" min="1" max="20" value="${Number(config.rate) || 2}"></label><label>Threads<input id="command-threads" type="number" min="1" max="20" value="${Number(config.threads) || 10}"></label><label>Output path<input id="command-output" value="${escapeHtml(config.output || "")}"></label></div></div><div class="command-settings-section"><h3>Per-tool advanced configuration</h3><p>JSON configuration is stored per enabled tool.</p><div class="command-tool-config-grid">${toolConfigFields || '<span class="custom-scripts-empty">Enable a tool above to configure it.</span>'}</div></div><div class="command-settings-section"><h3>Custom scripts</h3><p>Scripts are loaded from the assessment <code>custom_scripts/</code> folder.</p><select id="command-script"><option value="">No custom script</option>${scripts}</select></div>${aiFields}<div class="command-settings-section"><h3>Advanced command JSON</h3><textarea id="command-advanced" spellcheck="false">${escapeHtml(JSON.stringify(config, null, 2))}</textarea></div></div>`;
  commandSettingsDetail.querySelector("#command-enabled")?.addEventListener("change", (event) => updateCommandSetting("enabled", event.target.checked));
  commandSettingsDetail.querySelector("#command-role")?.addEventListener("change", (event) => { updateCommandSetting("role", event.target.value); renderCommandSettings(); });
  commandSettingsDetail.querySelectorAll("[data-command-tool]").forEach((input) => input.addEventListener("change", () => updateCommandSetting("tools", [...commandSettingsDetail.querySelectorAll("[data-command-tool]:checked")].map((item) => item.dataset.commandTool))));
  commandSettingsDetail.querySelectorAll("[data-tool-config]").forEach((input) => input.addEventListener("change", () => { try { const tool = input.dataset.toolConfig; const toolConfig = { ...(commandSetting(name).toolConfig || {}), [tool]: JSON.parse(input.value || "{}") }; updateCommandSetting("toolConfig", toolConfig); } catch { commandSettingsStatus.textContent = "Tool JSON is invalid"; } }));
  [["command-wordlist", "wordlist"], ["command-rate", "rate"], ["command-threads", "threads"], ["command-output", "output"], ["command-script", "script"], ["command-ai-aim", "aim"], ["command-ai-output", "expectedOutput"], ["command-ai-description", "description"], ["command-prompt", "prompt"], ["command-ai-constraints", "constraints"]].forEach(([id, key]) => commandSettingsDetail.querySelector(`#${id}`)?.addEventListener("input", (event) => updateCommandSetting(key, ["rate", "threads"].includes(key) ? Number(event.target.value) : event.target.value)));
  commandSettingsDetail.querySelector("#command-advanced")?.addEventListener("change", (event) => { try { const value = JSON.parse(event.target.value); if (value && typeof value === "object") { commandSettingsData[name] = { ...commandSetting(name), ...value }; renderCommandSettings(); } } catch { commandSettingsStatus.textContent = "Advanced JSON is invalid"; } });
}

async function saveCommandSettings() {
  localStorage.setItem(COMMAND_REGISTRY_KEY, JSON.stringify(commandSettingsData, null, 2));
  authoritySettingsData = normalizeAuthoritySettings(authoritySettingsData);
  localStorage.setItem(AUTHORITY_SETTINGS_KEY, JSON.stringify(authoritySettingsData, null, 2));
  if (assessmentPath) {
    const current = assessmentSettingsCache || (await refreshAssessmentSettingsCache())?.settings;
    if (!current) {
      if (commandSettingsStatus) commandSettingsStatus.textContent = "Authority save failed";
      return;
    }
    const promptValidation = validatePromptSettings();
    if (!promptValidation.ok) {
      if (commandSettingsStatus) commandSettingsStatus.textContent = "Prompt validation failed";
      return;
    }
    const result = await saveAssessmentSettings({ ...current, authority: authoritySettingsData, aiPrompts: promptSettingsData, aiModels: normalizeAIModelSettings(aiModelSettingsData || current.aiModels) });
    if (result?.error) {
      if (commandSettingsStatus) commandSettingsStatus.textContent = result.error;
      return;
    }
  }
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Saved";
  renderSlashSuggestions();
}

function beginCreateCommand() {
  if (!customCommandsList || customCommandsList.querySelector(".command-create-inline")) return;
  const form = document.createElement("div");
  form.className = "command-create-inline";
  form.innerHTML = `<input type="text" placeholder="/my-command" aria-label="New command name"><button type="button" class="icon-btn" title="Create"><span class="codicon codicon-check"></span></button>`;
  customCommandsList.prepend(form);
  const input = form.querySelector("input");
  const commit = () => {
    const name = input.value.trim().toLowerCase();
    if (!/^\/[\w-]+$/.test(name) || Object.prototype.hasOwnProperty.call(COMMAND_SETTINGS_DEFAULTS, name)) { input.classList.add("invalid"); return; }
    selectedCommandSettingsName = name;
    commandSettingsData[name] = { role: "ai", enabled: true, tools: [], aim: "", description: "", prompt: "", expectedOutput: "", constraints: "" };
    renderCommandSettings();
  };
  form.querySelector("button")?.addEventListener("click", commit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") form.remove(); });
  input.focus();
}

function setMapWorkspaceState({ exists = false, busy = false, message = "" } = {}) {
  if (mapEmpty) mapEmpty.hidden = exists;
  if (mapContent) mapContent.hidden = !exists;
  if (mapLoading) mapLoading.hidden = !busy;
  if (mapBuildAction) {
    mapBuildAction.disabled = busy || !assessmentPath;
    mapBuildAction.querySelector("span:last-child").textContent = exists ? "Rebuild" : "Build";
    mapBuildAction.title = exists ? "Rebuild from Traffic/Raw" : "Build from Traffic/Raw";
  }
  if (message && mapWorkspaceSubtitle) mapWorkspaceSubtitle.textContent = message;
}

function mapDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function populateMapFilters(graph) {
  const routes = graph?.nodes?.filter((node) => node.type === "Route") || [];
  const replaceOptions = (select, values, label) => {
    if (!select) return;
    const selected = select.value;
    select.innerHTML = "";
    select.add(new Option(label, ""));
    values.forEach((value) => select.add(new Option(value, value)));
    select.value = values.includes(selected) ? selected : "";
  };
  replaceOptions(mapHostFilter, [...new Set(routes.map((node) => node.host))].sort(), "All hosts");
  replaceOptions(mapMethodFilter, [...new Set(routes.map((node) => node.method))].sort(), "All methods");
}

function updateMapMetrics(graph) {
  const stats = graph?.stats || {};
  const values = {
    "map-stat-hosts": stats.hosts,
    "map-stat-routes": stats.routes,
    "map-stat-observations": stats.observations,
    "map-stat-variants": stats.variants,
    "map-stat-risk": stats.highRiskRoutes,
  };
  Object.entries(values).forEach(([id, value]) => { const element = $(id); if (element) element.textContent = Number(value) || 0; });
  if (mapBuiltAt) {
    const audit = graph?.verification;
    const verificationLabel = audit?.verified ? `Verified ${audit.checkedNodes} nodes${audit.sourceComplete === false ? " · source truncated" : ""}${audit.referencesComplete === false ? " · reference limit reached" : ""}` : graph ? "Rebuild to verify" : "";
    mapBuiltAt.textContent = graph?.builtAt ? `${verificationLabel} · Built ${mapDateLabel(graph.builtAt)}` : verificationLabel;
    mapBuiltAt.title = [...(graph?.source?.warnings || []), graph?.builderVersion ? `Builder ${graph.builderVersion}` : ""].filter(Boolean).join("\n");
  }
}

function filteredMapRoutes() {
  const allRoutes = applicationMap?.nodes?.filter((node) => node.type === "Route") || [];
  const query = String(mapSearch?.value || "").trim().toLowerCase();
  const host = mapHostFilter?.value || "";
  const method = mapMethodFilter?.value || "";
  const visibility = mapVisibilityFilter?.value || "relevant";
  return allRoutes.filter((route) => {
    if (host && route.host !== host) return false;
    if (method && route.method !== method) return false;
    if (query && !`${route.label} ${route.host} ${route.template} ${(route.riskTags || []).join(" ")}`.toLowerCase().includes(query)) return false;
    if (visibility === "relevant" && route.visibility === "hidden") return false;
    if (visibility === "application" && route.filterReason === "third_party_telemetry") return false;
    return true;
  }).slice(0, 600);
}

function mapPositionStorageKey(graph = applicationMap) {
  const graphKey = graph?.project?.rootHash || graph?.project?.name || "default";
  return `pointer:mapNodePositions:v2:${graphKey}`;
}

function activeMapPositionOverrides(mode = applicationMapMode) {
  return mapNodePositionsByMode.get(mode) || mapNodePositionsByMode.get("route");
}

function loadMapNodePositions(graph) {
  mapNodePositionsByMode.forEach((positions) => positions.clear());
  if (!graph) return;
  const nodeIds = new Set(graph.nodes?.map((node) => node.id) || []);
  try {
    const saved = JSON.parse(localStorage.getItem(mapPositionStorageKey(graph)) || "{}");
    for (const mode of mapNodePositionsByMode.keys()) {
      Object.entries(saved?.[mode] || {}).forEach(([id, point]) => {
        if (nodeIds.has(id) && Number.isFinite(point?.x) && Number.isFinite(point?.y)) mapNodePositionsByMode.get(mode).set(id, { x: point.x, y: point.y });
      });
    }
    const legacyKey = `pointer:mapWorkflowPositions:${graph.project?.rootHash || graph.project?.name || "default"}`;
    const legacy = JSON.parse(localStorage.getItem(legacyKey) || "{}");
    Object.entries(legacy).forEach(([id, point]) => {
      if (nodeIds.has(id) && Number.isFinite(point?.x) && Number.isFinite(point?.y) && !mapNodePositionsByMode.get("workflow").has(id)) mapNodePositionsByMode.get("workflow").set(id, { x: point.x, y: point.y });
    });
  } catch { localStorage.removeItem(mapPositionStorageKey(graph)); }
}

function persistMapNodePositions() {
  if (!applicationMap) return;
  const saved = Object.fromEntries([...mapNodePositionsByMode].map(([mode, positions]) => [mode, Object.fromEntries([...positions].map(([id, point]) => [id, { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }]))]));
  try { localStorage.setItem(mapPositionStorageKey(), JSON.stringify(saved)); } catch { /* keep the current in-memory arrangement */ }
}

function layoutMapNodes(routes, visibleHostNodes = []) {
  const positions = new Map();
  if (applicationMapMode === "workflow") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(routes.length * 1.7)));
    const rows = Math.max(1, Math.ceil(routes.length / columns));
    const width = Math.min(1220, Math.max(500, columns * 145));
    const height = Math.min(700, Math.max(300, rows * 95));
    routes.forEach((route, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const defaultPoint = { x: 700 - width / 2 + (column + .5) * (width / columns), y: 410 - height / 2 + (row + .5) * (height / rows) };
      positions.set(route.id, defaultPoint);
    });
    for (const [id, point] of activeMapPositionOverrides()) if (positions.has(id)) positions.set(id, point);
    return positions;
  }

  const hosts = [...new Set([...routes.map((route) => route.host), ...visibleHostNodes.map((node) => node.host)])];
  const columns = Math.max(1, Math.ceil(Math.sqrt(hosts.length * 1.6)));
  const rows = Math.max(1, Math.ceil(hosts.length / columns));
  const cellWidth = Math.min(600, 1300 / columns);
  const cellHeight = Math.min(520, 750 / rows);
  hosts.forEach((host, hostIndex) => {
    const column = hostIndex % columns;
    const row = Math.floor(hostIndex / columns);
    const center = { x: 700 + (column - (columns - 1) / 2) * cellWidth, y: 410 + (row - (rows - 1) / 2) * cellHeight };
    const hostNode = visibleHostNodes.find((node) => node.host === host) || applicationMap.nodes.find((node) => node.type === "Host" && node.host === host);
    if (hostNode) positions.set(hostNode.id, center);
    const hostRoutes = routes.filter((route) => route.host === host);
    hostRoutes.forEach((route, index) => {
      const ring = Math.floor(index / 12);
      const ringStart = ring * 12;
      const ringCount = Math.min(12, hostRoutes.length - ringStart);
      const angle = -Math.PI / 2 + ((index - ringStart) / Math.max(1, ringCount)) * Math.PI * 2;
      const radius = Math.min(Math.max(82, Math.min(cellWidth, cellHeight) * .31) + ring * 58, Math.min(cellWidth, cellHeight) * .46);
      positions.set(route.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    });
  });
  for (const [id, point] of activeMapPositionOverrides()) if (positions.has(id)) positions.set(id, point);
  return positions;
}

function updateMapViewportTransform() {
  mapViewport?.setAttribute("transform", `translate(${mapPanX} ${mapPanY}) scale(${mapZoom})`);
}

function mapClientPoint(clientX, clientY) {
  if (!mapGraph || !mapViewport) return { x: 0, y: 0 };
  const point = mapGraph.createSVGPoint();
  point.x = clientX; point.y = clientY;
  const matrix = mapViewport.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function updateDraggedMapNode(nodeId, point, mode = applicationMapMode) {
  if (!mapViewport || !nodeId) return;
  currentMapPositions.set(nodeId, point);
  activeMapPositionOverrides(mode).set(nodeId, point);
  mapViewport.querySelector(`[data-map-node-id="${CSS.escape(nodeId)}"]`)?.setAttribute("transform", `translate(${point.x} ${point.y})`);
  mapViewport.querySelectorAll(`[data-map-edge-source="${CSS.escape(nodeId)}"], [data-map-edge-target="${CSS.escape(nodeId)}"]`).forEach((edge) => {
    const source = currentMapPositions.get(edge.dataset.mapEdgeSource);
    const target = currentMapPositions.get(edge.dataset.mapEdgeTarget);
    if (!source || !target) return;
    edge.setAttribute("x1", source.x); edge.setAttribute("y1", source.y);
    edge.setAttribute("x2", target.x); edge.setAttribute("y2", target.y);
  });
}

function setMapDetailCollapsed(collapsed, { persist = true } = {}) {
  const next = Boolean(collapsed);
  mapMain?.classList.toggle("detail-collapsed", next);
  mapDetailToggle?.setAttribute("aria-expanded", String(!next));
  if (mapDetailToggle) mapDetailToggle.title = next ? "Expand node inspector" : "Collapse node inspector";
  const icon = mapDetailToggle?.querySelector(".codicon");
  icon?.classList.toggle("codicon-chevron-left", next);
  icon?.classList.toggle("codicon-chevron-right", !next);
  if (mapDetailBody) mapDetailBody.setAttribute("aria-hidden", String(next));
  if (persist) localStorage.setItem(MAP_INSPECT_COLLAPSED_KEY, String(next));
}

function renderMapDetails(node) {
  if (!mapDetailContent || !mapDetailEmpty) return;
  mapDetailEmpty.hidden = Boolean(node);
  mapDetailContent.hidden = !node;
  if (!node) { mapDetailContent.innerHTML = ""; return; }
  const connections = (applicationMap?.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 30);
  const nodeById = new Map((applicationMap?.nodes || []).map((item) => [item.id, item]));
  const connectionMarkup = connections.length ? connections.map((edge) => {
    const outgoing = edge.source === node.id;
    const peer = nodeById.get(outgoing ? edge.target : edge.source);
    const evidence = (edge.evidenceIds || []).slice(0, 3).map((id) => `<button type="button" class="map-evidence" data-map-evidence="${escapeHtml(String(id))}">${escapeHtml(String(id))}</button>`).join("");
    const origin = edge.observationType || "legacy";
    const support = Number(edge.supportCount) || Number(edge.observedCount) || 0;
    const extractor = edge.provenanceSamples?.[0]?.extractor || "legacy";
    return `<div class="map-connection"><strong>${outgoing ? "→" : "←"} ${escapeHtml(edge.type)}</strong><span>${escapeHtml(peer?.label || peer?.host || "Unknown node")} · ${Math.round((Number(edge.confidence) || 0) * 100)}% · ${escapeHtml(origin)} · ${support} support${support === 1 ? "" : "s"} · ${escapeHtml(extractor)}</span>${evidence ? `<div class="map-evidence-list">${evidence}</div>` : ""}</div>`;
  }).join("") : '<div class="map-tags"><span>No connections</span></div>';
  if (node.type === "Host") {
    mapDetailContent.innerHTML = `<div class="map-detail-title"><span>Host</span><h2>${escapeHtml(node.label)}</h2><p>${node.observed ? "Observed traffic host" : "Discovered application host"}</p></div><section class="map-detail-section"><div class="map-detail-grid"><div><span>Routes</span><strong>${Number(node.routeCount) || 0}</strong></div><div><span>Observations</span><strong>${Number(node.observedCount) || 0}</strong></div><div><span>Highest risk</span><strong>${Number(node.riskScore) || 0}/100</strong></div><div><span>Source</span><strong>${node.observed ? "Observed" : "Derived"}</strong></div></div></section><section class="map-detail-section"><h3>Connections</h3>${connectionMarkup}</section>`;
    return;
  }
  const tags = (items, empty = "None observed") => items?.length ? `<div class="map-tags">${items.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("")}</div>` : `<div class="map-tags"><span>${empty}</span></div>`;
  const parameterLabels = (node.parameters || []).map((item) => `${item.location}: ${item.name}`);
  const relatedHypotheses = (applicationMap?.hypotheses || []).filter((item) => (item.routes || []).includes(node.id));
  const hypothesisMarkup = relatedHypotheses.length
    ? relatedHypotheses.map((item) => `<div class="map-hypothesis"><strong>${escapeHtml(item.hypothesis || "candidate hypothesis")}</strong><span>${escapeHtml(item.basis || "")}</span><em>${escapeHtml(item.status || "untested")} · ${Math.round((Number(item.confidence) || 0) * 100)}% confidence</em></div>`).join("")
    : '<div class="map-tags"><span>No candidate hypotheses</span></div>';
  const variantItems = Array.isArray(node.variants) ? [...node.variants].sort((a, b) => Number(b.occurrenceCount) - Number(a.occurrenceCount)) : [];
  const variants = variantItems.map((variant, index) => {
    const evidenceIds = Array.isArray(variant.evidenceIds) ? variant.evidenceIds : (Array.isArray(variant.evidenceRefs) ? variant.evidenceRefs : []);
    const evidence = evidenceIds.slice(0, 8).map((id) => `<button type="button" class="map-evidence" data-map-evidence="${escapeHtml(String(id))}">${escapeHtml(String(id))}</button>`).join("");
    const auth = variant.authenticationState || variant.authState || variant.authType || "unknown";
    const status = variant.statusCode == null ? "—" : String(variant.statusCode);
    const requestShape = String(variant.requestShapeHash || "unknown").slice(0, 12);
    const responseSchema = String(variant.responseSchemaHash || "unknown").slice(0, 12);
    return `<article class="map-variant" data-variant-index="${index}"><div class="map-variant-header"><strong>Variant ${index + 1}</strong><b>${escapeHtml(auth)}</b><em>${Number(variant.occurrenceCount) || 0} observation${Number(variant.occurrenceCount) === 1 ? "" : "s"}</em></div><div class="map-variant-meta"><span><label>Status</label><strong>HTTP ${escapeHtml(status)}</strong></span><span><label>Request shape</label><strong title="${escapeHtml(requestShape)}">${escapeHtml(requestShape)}</strong></span><span><label>Response schema</label><strong title="${escapeHtml(responseSchema)}">${escapeHtml(responseSchema)}</strong></span></div>${evidence ? `<div class="map-variant-evidence"><label>Evidence</label><div class="map-evidence-list">${evidence}</div></div>` : ""}</article>`;
  }).join("");
  mapDetailContent.innerHTML = `
    <div class="map-detail-title"><span>Route</span><h2>${escapeHtml(node.label)}</h2><p>${escapeHtml(node.host)} · ${escapeHtml(node.routeFingerprint?.slice(0, 12) || "")}</p><div class="map-ai-summary">${escapeHtml(node.aiSummary || "No AI summary available for this route.")}</div></div>
    <div class="map-detail-score"><strong>${Number(node.riskScore) || 0}</strong><div><i style="width:${Math.max(0, Math.min(100, Number(node.riskScore) || 0))}%"></i></div><span>risk</span></div>
    <section class="map-detail-section"><div class="map-detail-grid"><div><span>Observed</span><strong>${Number(node.observedCount) || 0}×</strong></div><div><span>Variants</span><strong>${node.variants?.length || 0}</strong></div><div><span>Origin</span><strong>${escapeHtml(node.observationType || "legacy")}</strong></div><div><span>Method confidence</span><strong>${Math.round((Number(node.methodConfidence) || 0) * 100)}%</strong></div><div><span>Status codes</span><strong>${escapeHtml((node.statusCodes || []).join(", ") || "—")}</strong></div><div><span>Auth</span><strong>${escapeHtml((node.authTypes || []).join(", ") || "none")}</strong></div><div><span>First seen</span><strong>${escapeHtml(mapDateLabel(node.firstSeen) || "—")}</strong></div><div><span>Last seen</span><strong>${escapeHtml(mapDateLabel(node.lastSeen) || "—")}</strong></div></div></section>
    <section class="map-detail-section"><h3>Entry-point evidence</h3>${tags((node.entryPointReasons || []).map((reason) => `${reason.type} · ${Math.round((Number(reason.confidence) || 0) * 100)}%`))}</section>
    <section class="map-detail-section"><h3>Risk signals</h3>${tags(node.riskTags)}</section>
    <section class="map-detail-section"><h3>Parameters</h3>${tags(parameterLabels)}</section>
    <section class="map-detail-section"><h3>Sensitive response fields</h3>${tags(node.sensitiveFields)}</section>
    <section class="map-detail-section"><div class="map-section-heading"><h3>Candidate hypotheses</h3><span class="map-section-count">${relatedHypotheses.length}</span></div>${hypothesisMarkup}</section>
    <section class="map-detail-section"><h3>Connections</h3>${connectionMarkup}</section>
    <section class="map-detail-section map-variants-section"><div class="map-section-heading"><h3>Behavior variants</h3><span class="map-section-count">${variantItems.length}</span></div>${variants || '<div class="map-variants-empty">No behavior variants were recorded for this route.</div>'}</section>`;
}

function renderApplicationMap() {
  if (!applicationMap || !mapViewport) return;
  const routes = filteredMapRoutes();
  const hostNames = new Set(routes.map((route) => route.host));
  const allHosts = applicationMap.nodes.filter((node) => node.type === "Host");
  const visibleHostIds = new Set(allHosts.filter((node) => hostNames.has(node.host)).map((node) => node.id));
  if (applicationMapMode !== "workflow") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of applicationMap.edges || []) {
        if (!["SUBDOMAIN_OF", "REFERENCES_HOST"].includes(edge.type)) continue;
        if (visibleHostIds.has(edge.source) && !visibleHostIds.has(edge.target)) { visibleHostIds.add(edge.target); changed = true; }
        if (visibleHostIds.has(edge.target) && !visibleHostIds.has(edge.source)) { visibleHostIds.add(edge.source); changed = true; }
      }
    }
  }
  const hostNodes = applicationMapMode === "workflow" ? [] : allHosts.filter((node) => visibleHostIds.has(node.id));
  const nodes = [...hostNodes, ...routes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const positions = layoutMapNodes(routes, hostNodes);
  currentMapPositions = positions;
  const edgeTypes = applicationMapMode === "workflow"
    ? new Set(["FOLLOWED_BY", "REDIRECTS_TO"])
    : new Set(["EXPOSES", "LINKS_TO", "REDIRECTS_TO", "REFERRED_TO", "REFERENCES", "SHARES_OBJECT", "SUBDOMAIN_OF", "REFERENCES_HOST"]);
  const edges = (applicationMap.edges || []).filter((edge) => edgeTypes.has(edge.type) && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const selectedVisible = selectedMapNodeId && nodeIds.has(selectedMapNodeId);
  if (!selectedVisible) selectedMapNodeId = "";
  const selectedNode = nodes.find((node) => node.id === selectedMapNodeId);
  const adjacent = new Set();
  // Use every graph relationship for highlighting, even when the active view
  // renders only a subset of edge types.
  if (selectedNode) (applicationMap.edges || []).forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    if (edge.source === selectedNode.id) adjacent.add(edge.target);
    if (edge.target === selectedNode.id) adjacent.add(edge.source);
  });
  const edgeMarkup = edges.map((edge) => {
    const source = positions.get(edge.source); const target = positions.get(edge.target);
    if (!source || !target) return "";
    const dimmed = selectedNode && edge.source !== selectedNode.id && edge.target !== selectedNode.id;
    const relationshipClass = edge.type === "FOLLOWED_BY" ? "workflow" : edge.type === "SUBDOMAIN_OF" || edge.type === "REFERENCES_HOST" ? "subdomain" : edge.semantic === false ? "inferred" : edge.type === "EXPOSES" ? "exposes" : "semantic";
    return `<line class="map-edge ${relationshipClass} ${dimmed ? "dimmed" : ""}" data-map-edge-source="${edge.source}" data-map-edge-target="${edge.target}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"><title>${escapeHtml(edge.type)} · ${Number(edge.observedCount) || 0} observation(s) · ${Math.round((Number(edge.confidence) || 0) * 100)}% confidence</title></line>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const point = positions.get(node.id); if (!point) return "";
    const risk = Number(node.riskScore) || 0;
    const radius = node.type === "Host" ? 16 : applicationMapMode === "risk" ? 7 + risk * .09 : 8 + Math.min(6, Math.log2((Number(node.observedCount) || 1) + 1) * 1.5);
    const classes = ["map-node", "draggable", node.type.toLowerCase(), `origin-${node.observationType || "legacy"}`, risk >= 60 ? "high-risk" : risk >= 30 ? "medium-risk" : "", node.visibility === "hidden" ? "hidden-traffic" : "", node.id === selectedMapNodeId ? "selected" : "", selectedNode && node.id !== selectedNode.id && !adjacent.has(node.id) ? "dimmed" : ""].filter(Boolean).join(" ");
    const label = String(node.label || "");
    const shortLabel = label.length > 36 ? `${label.slice(0, 35)}…` : label;
    const badge = node.type === "Route" && risk >= 60 ? `<text class="map-node-badge" x="0" y=".5">!</text>` : "";
    return `<g class="${classes}" transform="translate(${point.x} ${point.y})" data-map-node-id="${node.id}" tabindex="0" role="button"><circle r="${radius}"></circle>${badge}<text x="${radius + 6}" y="3">${escapeHtml(shortLabel)}</text><title>${escapeHtml(label)} · ${Number(node.observedCount) || 0} observation(s)</title></g>`;
  }).join("");
  mapViewport.innerHTML = `<defs><marker id="map-arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#547e98"></path></marker></defs>${edgeMarkup}${nodeMarkup}`;
  updateMapViewportTransform();
  if (mapNoResults) mapNoResults.hidden = routes.length > 0;
  if (mapWorkspaceSubtitle) {
    const total = applicationMap.nodes.filter((node) => node.type === "Route").length;
    const verification = applicationMap.verification?.verified
      ? `connectivity verified · ${applicationMap.verification.components} component${applicationMap.verification.components === 1 ? "" : "s"}${applicationMap.verification.sourceComplete === false ? " · source truncated" : ""}${applicationMap.verification.referencesComplete === false ? " · reference limit reached" : ""}`
      : "legacy graph · rebuild to verify";
    mapWorkspaceSubtitle.textContent = routes.length === total ? `${total} deduplicated route${total === 1 ? "" : "s"} · ${verification}` : `Showing ${routes.length} of ${total} routes · ${verification}`;
  }
  renderMapDetails(selectedNode || null);
}

async function loadApplicationMap({ build = false } = {}) {
  const sequence = ++mapLoadSequence;
  setMapWorkspaceState({ exists: Boolean(applicationMap), busy: true, message: build ? "Normalizing traffic, classifying variants, and building graph edges…" : "Loading application behavior graph…" });
  if (!assessmentPath) {
    applicationMap = null;
    setMapWorkspaceState({ exists: false, busy: false, message: "Open or create an assessment before building its application Map." });
    return;
  }
  let result;
  try {
    result = build ? await window.api.assessmentBuildMap({ path: assessmentPath }) : await window.api.assessmentMap({ path: assessmentPath });
  } catch (error) { result = { error: error?.message || "The application Map could not be loaded." }; }
  if (sequence !== mapLoadSequence) return;
  if (result?.error) {
    applicationMap = null;
    setMapWorkspaceState({ exists: false, busy: false, message: result.error });
    addErrorMessage(result.error);
    return;
  }
  applicationMap = result?.graph || null;
  selectedMapNodeId = "";
  loadMapNodePositions(applicationMap);
  setMapWorkspaceState({ exists: Boolean(result?.exists && applicationMap), busy: false, message: result?.exists ? "Application behavior graph ready." : "No graph exists yet. Build it from Traffic/Raw." });
  if (applicationMap) {
    populateMapFilters(applicationMap);
    updateMapMetrics(applicationMap);
    renderApplicationMap();
  } else {
    updateMapMetrics(null);
    if (mapBuiltAt) mapBuiltAt.textContent = "";
  }
}

async function showMapWorkspace() {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "map";
  resourceViewer.hidden = true;
  securityWorkspace.hidden = true;
  toolsWorkspace.hidden = true;
  mapWorkspace.hidden = false;
  appSettingsWorkspace.hidden = true;
  webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Application behavior map");
  syncWorkspaceActivity();
  await loadApplicationMap();
}

function webcloneTargetFromScope() {
  try {
    const raw = resourcePreviewText || "";
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed?.targets) ? parsed.targets : [];
    const first = values.find((value) => typeof value === "string" ? /^https?:\/\//i.test(value) : /^https?:\/\//i.test(String(value?.value || "")));
    return typeof first === "string" ? first : String(first?.value || "");
  } catch { return ""; }
}

function renderWebCloneFiles() {
  if (!webcloneFileList) return;
  const files = Array.isArray(webcloneManifest?.files) ? webcloneManifest.files : [];
  if (webcloneFileCount) webcloneFileCount.textContent = String(files.length);
  webcloneFileList.innerHTML = files.length ? files.map((file, index) => `<button type="button" class="webclone-file-item${file.path === webcloneSelectedFile ? " selected" : ""}" data-webclone-file="${escapeHtml(file.path)}" role="treeitem" aria-selected="${file.path === webcloneSelectedFile}"><span class="codicon ${String(file.path).endsWith(".html") ? "codicon-file-code" : String(file.path).endsWith(".css") ? "codicon-symbol-color" : String(file.path).endsWith(".js") ? "codicon-symbol-event" : "codicon-file"}"></span><span>${escapeHtml(file.path.replace(/^webclone\//, ""))}</span><small>${Math.ceil(Number(file.bytes || 0) / 1024)} KB</small></button>`).join("") : '<div class="webclone-file-empty">Build a clone to populate files.</div>';
  webcloneFileList.querySelectorAll("[data-webclone-file]").forEach((button) => button.addEventListener("click", () => openWebCloneFile(button.dataset.webcloneFile)));
}

async function openWebCloneFile(relativePath) {
  if (!relativePath || !assessmentPath) return;
  const file = await window.api.webCloneReadFile?.({ path: assessmentPath, relativePath });
  if (!file || file?.error) return addErrorMessage(file?.error || "WebClone file reader is unavailable.");
  webcloneSelectedFile = relativePath;
  if (webcloneFileTitle) webcloneFileTitle.textContent = relativePath.replace(/^webclone\//, "");
  if (webcloneFileMeta) webcloneFileMeta.textContent = `${file.content?.length || 0} characters`;
  if (webcloneFileContent) webcloneFileContent.textContent = String(file.content || "");
  renderWebCloneFiles();
  if (webclonePreviewAction) webclonePreviewAction.disabled = !String(relativePath).endsWith("index.html");
}

async function loadWebCloneManifest() {
  if (!assessmentPath) return;
  const result = await window.api.webCloneManifest?.({ path: assessmentPath });
  webcloneManifest = result?.ok === false ? null : result;
  const files = webcloneManifest?.files || [];
  if (webcloneEmpty) webcloneEmpty.hidden = files.length > 0;
  if (webcloneContent) webcloneContent.hidden = files.length === 0;
  if (webcloneStatus) webcloneStatus.textContent = files.length ? `${files.length} files · ${webcloneManifest.builtAt ? new Date(webcloneManifest.builtAt).toLocaleString() : "ready"}` : "No clone built";
  if (webcloneTarget && webcloneManifest?.target) webcloneTarget.value = webcloneManifest.target;
  if (files.length) {
    webcloneSelectedFile = files.some((file) => file.path === webcloneSelectedFile) ? webcloneSelectedFile : files[0].path;
    renderWebCloneFiles();
    await openWebCloneFile(webcloneSelectedFile);
  } else renderWebCloneFiles();
}

async function buildWebClone() {
  if (!assessmentPath) return addErrorMessage("Open an assessment before building WebClone.");
  let target = String(webcloneTarget?.value || webcloneManifest?.target || webcloneTargetFromScope()).trim();
  if (!target) return;
  webcloneBuildAction.disabled = true;
  if (webcloneStatus) webcloneStatus.textContent = "Building…";
  try {
    const result = await window.api.webCloneBuild?.({ path: assessmentPath, target, maxAssets: 80 });
    if (result?.error) return addErrorMessage(result.error);
    webcloneManifest = result;
    webcloneSelectedFile = "webclone/index.html";
    await loadWebCloneManifest();
  } finally { webcloneBuildAction.disabled = false; }
}

function setWebCloneFilesCollapsed(collapsed) {
  webcloneFilesCollapsed = Boolean(collapsed);
  webcloneContent?.classList.toggle("files-collapsed", webcloneFilesCollapsed);
  webcloneFilesToggle?.setAttribute("aria-label", webcloneFilesCollapsed ? "Expand files" : "Collapse files");
  webcloneFilesToggle?.setAttribute("title", webcloneFilesCollapsed ? "Expand files" : "Collapse files");
  if (webcloneFilesToggle) webcloneFilesToggle.innerHTML = `<span class="codicon codicon-chevron-${webcloneFilesCollapsed ? "left" : "right"}"></span>`;
}

function getWebClonePreviewBounds() {
  const rect = webclonePreviewFrame?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

let webClonePreviewResizeFrame = 0;
function syncWebClonePreviewBounds() {
  if (webclonePreviewPane?.hidden !== false || !webclonePreviewFrame) return;
  if (webClonePreviewResizeFrame) cancelAnimationFrame(webClonePreviewResizeFrame);
  webClonePreviewResizeFrame = requestAnimationFrame(() => {
    webClonePreviewResizeFrame = 0;
    const bounds = getWebClonePreviewBounds();
    if (bounds) window.api.webClonePreviewBounds?.({ bounds });
  });
}

async function toggleWebClonePreview(show = true) {
  if (!webclonePreviewPane || !webclonePreviewFrame) return;
  webclonePreviewPane.hidden = !show;
  if (webcloneEditorPane) webcloneEditorPane.hidden = show;
  webclonePreviewAction?.setAttribute("aria-pressed", String(show));
  if (webclonePreviewAction) webclonePreviewAction.innerHTML = `<span class="codicon codicon-${show ? "file-code" : "play"}"></span>${show ? "Files" : "Preview"}`;
  if (!show) {
    await window.api.webCloneHidePreview?.();
    return;
  }
  if (show && webcloneFileContent && webcloneSelectedFile.endsWith("index.html")) {
    // Run the cloned application in an opaque sandbox. A strict document CSP
    // prevents it from making network calls or reaching the Pointer parent.
    const html = String(webcloneFileContent.textContent || "").replace(/^\uFEFF/, "");
    const previewDocument = new DOMParser().parseFromString(html, "text/html");
    const csp = previewDocument.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "default-src data: blob:; img-src data: blob:; style-src data: blob: 'unsafe-inline'; script-src data: blob: 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";
    previewDocument.head.prepend(csp);
    const files = Array.isArray(webcloneManifest?.files) ? webcloneManifest.files : [];
    const embeddedAssets = [];
    for (const file of files) {
      if (file.path === "webclone/index.html") continue;
      const loaded = await window.api.webCloneReadFile?.({ path: assessmentPath, relativePath: file.path });
      if (loaded?.error || typeof loaded.content !== "string") continue;
      const relative = file.path.replace(/^webclone\//, "");
      if (!/\.(?:css|js|mjs)$/i.test(relative)) continue;
      const encoded = `data:${file.contentType || "text/plain"};charset=utf-8,${encodeURIComponent(loaded.content)}`;
      let sourceUrl = "";
      let sourcePath = "";
      try {
        const parsedSource = file.source ? new URL(file.source) : null;
        sourceUrl = parsedSource?.href || "";
        sourcePath = parsedSource?.pathname || "";
      } catch { /* Source metadata is optional. */ }
      embeddedAssets.push({ relative, basename: relative.split("/").pop(), sourceUrl, sourcePath, encoded });
    }
    const baseUrl = webcloneManifest?.finalUrl || webcloneManifest?.target || "https://pointer.invalid/";
    previewDocument.querySelectorAll("script[src], link[rel~='stylesheet'][href]").forEach((element) => {
      const attribute = element.hasAttribute("src") ? "src" : "href";
      const original = String(element.getAttribute(attribute) || "").trim();
      let absolute = "";
      let pathname = "";
      try {
        const parsed = new URL(original, baseUrl);
        absolute = parsed.href;
        pathname = parsed.pathname;
      } catch { /* Leave malformed attributes untouched. */ }
      const match = embeddedAssets.find((asset) => (
        (asset.sourceUrl && absolute === asset.sourceUrl)
        || (asset.sourcePath && pathname === asset.sourcePath)
        || original === asset.relative
        || original === `/${asset.relative}`
        || (!asset.sourceUrl && asset.basename && pathname.endsWith(`/${asset.basename}`))
      ));
      if (match) element.setAttribute(attribute, match.encoded);
      else if (element.tagName === "SCRIPT" && element.hasAttribute("src")) element.remove();
      else if (element.tagName === "LINK" && String(element.getAttribute("rel") || "").toLowerCase() === "stylesheet") element.remove();
    });
    const previewHtml = `<!doctype html>\n${previewDocument.documentElement.outerHTML}`;
    const bounds = getWebClonePreviewBounds();
    const previewResult = await window.api.webClonePreviewDocument?.({ html: previewHtml, bounds });
    if (!previewResult || previewResult?.error || previewResult.ok === false) {
      addErrorMessage(previewResult?.error || "WebClone preview service is unavailable.");
      return;
    }
  }
}

async function showWebCloneWorkspace() {
  if (terminalMaximized) setTerminalMaximized(false);
  currentWorkspaceMode = "webclone";
  resourceViewer.hidden = true; securityWorkspace.hidden = true; toolsWorkspace.hidden = true; mapWorkspace.hidden = true; appSettingsWorkspace.hidden = true; webcloneWorkspace.hidden = false;
  editorPane?.setAttribute("aria-label", "WebClone workspace");
  toggleWebClonePreview(false);
  setWebCloneFilesCollapsed(false);
  syncWorkspaceActivity();
  await loadWebCloneManifest();
}

async function openMapEvidence(evidenceId) {
  if (!evidenceId) return;
  if (securityHistoryPanel) securityHistoryPanel.hidden = true;
  showSecurityWorkspace("repeater");
  if (securityHistoryPanel) securityHistoryPanel.hidden = false;
  securityHistoryToggle?.classList.add("active");
  securityHistoryToggle?.setAttribute("aria-pressed", "true");
  await loadSecurityHistory();
  const index = securityHistoryRecords.findIndex((record) => String(record.requestId) === String(evidenceId));
  if (index >= 0) setSecurityHistorySelection([index], { loadRecordIndex: index, anchorIndex: index });
  else setSecurityStatus(`Evidence ${evidenceId} is outside the latest 500 history records`, "error");
}

function modeLabel(mode = chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode, mode.includes(":") ? mode.split(":")[0] : chatFamily)] || {};
  return profile?.label || "Agent";
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
    && ["resource", "map", "webclone"].includes(currentWorkspaceMode);
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
  const item = bugBountyTree?.querySelector(`[data-bounty-item="${CSS.escape(selected)}"], [data-bounty-folder="${CSS.escape(selected)}"]`);
  item?.classList.add("selected");
  item?.setAttribute("aria-selected", "true");
}

function assessmentFolderName(folder = assessmentPath) {
  return String(folder || "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "ASSESSMENT";
}

function assessmentRepairIssueDetails(issue = {}) {
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

function renderAssessmentRepairDialog(verification = assessmentVerification) {
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
      ? "Pointer noticed differences from the starter template. Work is never blocked and existing files are never overwritten; incompatible paths are informational only."
      : "Pointer noticed optional starter-template items that can be created or merged. Your assessment remains fully usable.";
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
    assessmentRepairConfirm.disabled = !assessmentPath || !missing.length;
    assessmentRepairConfirm.textContent = blockedCount && !createCount && !updateCount
      ? "Close"
      : "Create missing items";
  }
}

function closeAssessmentRepairDialog() {
  if (assessmentRepairOverlay) assessmentRepairOverlay.hidden = true;
}

function setNotifications(items = []) {
  notificationItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (notificationCount) {
    notificationCount.textContent = String(notificationItems.length);
    notificationCount.hidden = notificationItems.length === 0;
  }
  if (btnNotifications) {
    btnNotifications.classList.toggle("has-notifications", notificationItems.length > 0);
    btnNotifications.title = notificationItems.length ? `${notificationItems.length} notification${notificationItems.length === 1 ? "" : "s"}` : "Notifications";
  }
  if (!notificationList) return;
  notificationList.innerHTML = notificationItems.length
    ? notificationItems.map((item) => `<article class="notification-item ${escapeHtml(item.tone || "warning")}"><span class="codicon ${escapeHtml(item.icon || "codicon-warning")}"></span><div><strong>${escapeHtml(item.title || "Notification")}</strong><p>${escapeHtml(item.message || "")}</p>${item.action ? `<button type="button" class="notification-action" data-notification-action="${escapeHtml(item.action)}">${escapeHtml(item.actionLabel || "Review")}</button>` : ""}</div></article>`).join("")
    : '<div class="notification-empty">No notifications</div>';
  notificationList.querySelectorAll("[data-notification-action]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.notificationAction === "assessment-repair") openAssessmentRepairDialog();
    if (notificationPanel) notificationPanel.hidden = true;
    btnNotifications?.setAttribute("aria-expanded", "false");
  }));
}

async function openAssessmentRepairDialog() {
  if (!assessmentPath || bugBountyRepair?.disabled) return;
  let verification = assessmentVerification;
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
  if (verification?.valid) {
    await refreshAssessmentState();
    return;
  }
  setAssessmentUiState("incomplete", verification);
  renderAssessmentRepairDialog(verification);
  if (assessmentRepairOverlay) assessmentRepairOverlay.hidden = false;
  assessmentRepairCancel?.focus();
}

function setAssessmentUiState(state, details = {}) {
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
      selectedCustomFolder = "";
      selectedCustomEntries.clear();
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
  applicationMap = null;
  assessmentPath = result.path || result.root;
  selectedCustomFolder = "";
  selectedCustomEntries.clear();
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, assessmentPath);
  await loadWorkspace(assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

function resetProjectWorkspaceState() {
  assessmentPath = "";
  applicationMap = null;
  selectedCustomFolder = "";
  selectedCustomEntries.clear();
  assessmentVerification = null;
  assessmentSettingsCache = null;
  localStorage.removeItem(BUG_BOUNTY_PATH_KEY);

  if (resourceViewerTitle) resourceViewerTitle.textContent = rootPath ? projectName(rootPath) : "Project workspace";
  if (resourceViewerMeta) resourceViewerMeta.textContent = "Project workspace";
  resourcePreviewText = "";
  resourceCurrentFilePath = "";
  resourceSavedText = "";
  resourceSettingsActive = false;
  resourceSettingsData = null;
  resourceChecklistActive = false;
  resourceChecklistData = null;
  resourceScopeActive = false;
  resourceScopeData = null;
  if (settingsViewSwitch) settingsViewSwitch.hidden = true;
  if (settingsUIView) settingsUIView.hidden = true;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
  if (resourceViewerContent) {
    resourceViewerContent.value = "";
    resourceViewerContent.hidden = true;
  }
  setResourceDirty(false);
  if (resourceViewerEmpty) resourceViewerEmpty.hidden = false;
  if (resourceViewerCopy) resourceViewerCopy.disabled = true;
  showResourceWorkspace();
}

async function activateProjectWorkspace(folder) {
  if (!folder) return false;

  // Verify the folder before replacing the current Target state. This keeps a
  // canceled/invalid selection from blanking the active assessment.
  let entries;
  try {
    entries = await window.api.readdir(folder);
  } catch (error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "Could not read the selected folder." });
    return false;
  }
  if (!entries || entries.error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: entries?.error || "Could not read the selected folder." });
    return false;
  }

  resetProjectWorkspaceState();
  let loaded = false;
  try {
    loaded = await loadWorkspace(folder);
  } catch (error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "The selected folder could not be loaded." });
    return false;
  }
  if (!loaded) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: "The selected folder could not be loaded." });
    return false;
  }
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
  if (resourceViewerTitle) resourceViewerTitle.textContent = projectName(folder);
  return true;
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

  resetProjectWorkspaceState();
  await loadWorkspace(result.path);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
  if (resourceViewerTitle) resourceViewerTitle.textContent = projectName(result.path);
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
  applicationMap = null;
  selectedCustomFolder = "";
  selectedCustomEntries.clear();
  localStorage.setItem(BUG_BOUNTY_PATH_KEY, assessmentPath);
  await loadWorkspace(assessmentPath);
  await refreshAssessmentState();
  refreshSecurityHistoryIfVisible();
}

async function repairAssessmentFolder() {
  if (!assessmentPath || bugBountyRepair.disabled) return;
  const missing = Array.isArray(assessmentVerification?.missing) ? assessmentVerification.missing : [];
  const hasRepairableItems = missing.some((issue) => ["missing", "missing_fields"].includes(issue.reason));
  if (!hasRepairableItems) {
    closeAssessmentRepairDialog();
    return;
  }
  closeAssessmentRepairDialog();
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
  if (!resourceViewerContent) return;
  const lineCount = Math.max(1, resourceViewerContent.value.split("\n").length);
  if (resourceLineNumbers && resourceLineNumbers.dataset.lineCount !== String(lineCount)) {
    resourceLineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
    resourceLineNumbers.dataset.lineCount = String(lineCount);
  }
  if (resourceLineNumbers) resourceLineNumbers.scrollTop = resourceViewerContent.scrollTop;
  if (!statusLnCol || resourceViewerContent.hidden) return;
  const start = resourceViewerContent.selectionStart || 0;
  const before = resourceViewerContent.value.slice(0, start);
  const lines = before.split("\n");
  statusLnCol.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

async function saveResourceChanges() {
  if (!resourceCurrentFilePath || !resourceDirty) return { ok: true };
  if (!requireAuthority("workspaceWrite", "Workspace editing")) return { error: "Workspace editing is disabled by Authority settings" };
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
  assessmentModuleActive = false; assessmentModuleView.hidden = true;
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
  resourceChecklistActive = false;
  resourceChecklistData = null;
  resourceScopeActive = false;
  resourceScopeData = null;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
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

function checklistStatuses() {
  return resourceChecklistType === "mitre"
    ? [["not-started", "Not started"], ["in-progress", "In progress"], ["observed", "Observed"], ["not-observed", "Not observed"], ["not-applicable", "Not applicable"], ["blocked", "Blocked"]]
    : [["not-tested", "Not tested"], ["in-progress", "In progress"], ["passed", "Passed"], ["failed", "Failed"], ["not-applicable", "Not applicable"], ["blocked", "Blocked"]];
}

function checklistTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function checklistStatusIssue(check, status) {
  if (resourceChecklistType === "mitre") return "";
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

async function checklistEvidenceIssue(check, status) {
  if (resourceChecklistType === "mitre" || !["passed", "failed"].includes(status)) return "";
  const ids = checklistTextList(check?.evidence || check?.evidenceIds);
  if (!ids.length || !assessmentPath || !window.api.assessmentEvidence) return "";
  const result = await window.api.assessmentEvidence({ path: assessmentPath, limit: 2000 });
  if (result?.error) return `Evidence could not be validated: ${result.error}`;
  const available = new Set((result?.records || []).map((record) => String(record.id || "")));
  const missing = ids.filter((id) => !available.has(id));
  return missing.length ? `These evidence IDs do not exist in the Evidence Index: ${missing.join(", ")}.` : "";
}

function recalculateChecklistProgress() {
  const checks = Array.isArray(resourceChecklistData?.checks) ? resourceChecklistData.checks : [];
  const counts = { total: checks.length, notStarted: 0, notTested: 0, inProgress: 0, passed: 0, failed: 0, observed: 0, notObserved: 0, notApplicable: 0, blocked: 0 };
  const keys = { "not-started": "notStarted", "not-tested": "notTested", "in-progress": "inProgress", passed: "passed", failed: "failed", observed: "observed", "not-observed": "notObserved", "not-applicable": "notApplicable", blocked: "blocked" };
  checks.forEach((check) => { const key = keys[check.status || (resourceChecklistType === "mitre" ? "not-started" : "not-tested")]; if (key) counts[key] += 1; });
  resourceChecklistData.progress = resourceChecklistType === "mitre"
    ? { total: counts.total, notStarted: counts.notStarted, inProgress: counts.inProgress, observed: counts.observed, notObserved: counts.notObserved, notApplicable: counts.notApplicable, blocked: counts.blocked }
    : { total: counts.total, notTested: counts.notTested + counts.notStarted, inProgress: counts.inProgress, passed: counts.passed, failed: counts.failed, notApplicable: counts.notApplicable, blocked: counts.blocked };
  const completed = checks.filter((check) => !["not-started", "not-tested", "in-progress"].includes(check.status || (resourceChecklistType === "mitre" ? "not-started" : "not-tested"))).length;
  const percent = checks.length ? Math.round((completed / checks.length) * 100) : 0;
  if (checklistProgress) checklistProgress.innerHTML = `<strong>${percent}%</strong><span>${completed} of ${checks.length} reviewed</span><i><b style="width:${percent}%"></b></i>`;
}

function scheduleChecklistSave() {
  clearTimeout(resourceChecklistSaveTimer);
  recalculateChecklistProgress();
  resourcePreviewText = `${JSON.stringify(resourceChecklistData, null, 2)}\n`;
  resourceViewerContent.value = resourcePreviewText;
  setResourceDirty(resourcePreviewText !== resourceSavedText);
  resourceViewerMeta.textContent = `${resourceChecklistType === "mitre" ? "MITRE ATT&CK" : "OWASP WSTG"} · Saving...`;
  resourceChecklistSaveTimer = setTimeout(async () => {
    const snapshot = `${JSON.stringify(resourceChecklistData, null, 2)}\n`;
    const result = await window.api.writeFile(resourceCurrentFilePath, snapshot);
    if (result?.error) { resourceViewerMeta.textContent = `Save failed: ${result.error}`; return; }
    if (resourceViewerContent.value === snapshot) { resourceSavedText = snapshot; setResourceDirty(false); }
    resourceViewerMeta.textContent = `${resourceChecklistType === "mitre" ? "MITRE ATT&CK" : "OWASP WSTG"} · Saved`;
  }, 350);
}

function renderChecklistUI() {
  if (!resourceChecklistActive || !resourceChecklistData || !checklistGroups) return;
  const framework = resourceChecklistData.framework || {};
  checklistFrameworkName.textContent = resourceChecklistType === "mitre" ? "MITRE ATT&CK Enterprise" : "OWASP WSTG + Top 10";
  checklistFrameworkVersion.textContent = resourceChecklistType === "mitre"
    ? `ATT&CK ${framework.version || ""} · checked ${framework.checkedAt || ""}`
    : `WSTG ${framework.version || ""} (stable ${framework.stableVersion || ""}) · Top 10:${framework.top10Version || ""}`;
  recalculateChecklistProgress();
  const query = String(checklistSearch?.value || "").trim().toLowerCase();
  const filter = checklistStatusFilter?.value || "all";
  const checks = (resourceChecklistData.checks || []).map((check, index) => ({ check, index })).filter(({ check }) => {
    const haystack = [check.id, check.techniqueId, check.category, check.tactic, check.title, check.technique].join(" ").toLowerCase();
    const statusMatches = filter === "all" || check.status === filter || (filter === "not-tested" && check.status === "not-started") || (filter === "failed" && check.status === "observed");
    return statusMatches && (!query || haystack.includes(query));
  });
  const groupKey = resourceChecklistType === "mitre" ? "tactic" : "category";
  const groups = new Map();
  checks.forEach((entry) => { const name = entry.check[groupKey] || "Other"; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(entry); });
  checklistGroups.innerHTML = "";
  for (const [groupName, entries] of groups) {
    const section = document.createElement("details"); section.className = "checklist-group"; section.open = true;
    const summary = document.createElement("summary"); summary.innerHTML = `<span class="codicon codicon-chevron-right"></span><strong>${escapeHtml(groupName)}</strong><small>${entries.length} checks</small>`; section.appendChild(summary);
    const list = document.createElement("div"); list.className = "checklist-items";
    entries.forEach(({ check, index }) => {
      const normalizedStatus = resourceChecklistType !== "mitre" && check.status === "not-started" ? "not-tested" : (check.status || (resourceChecklistType === "mitre" ? "not-started" : "not-tested"));
      const card = document.createElement("article"); card.className = `checklist-item status-${normalizedStatus}`;
      const heading = document.createElement("div"); heading.className = "checklist-item-heading";
      const identity = document.createElement("div"); identity.className = "checklist-item-identity";
      const code = document.createElement("span"); code.textContent = check.id || check.techniqueId || `#${index + 1}`;
      const title = document.createElement("strong"); title.textContent = check.title || check.technique || "Untitled check"; identity.append(code, title);
      const status = document.createElement("select"); status.className = "checklist-status"; status.dataset.index = String(index);
      checklistStatuses().forEach(([value, label]) => status.add(new Option(label, value))); status.value = normalizedStatus; heading.append(identity, status); card.appendChild(heading);
      if (resourceChecklistType === "mitre") {
        const applicability = document.createElement("select"); applicability.className = "checklist-applicability"; applicability.dataset.index = String(index);
        [["unknown", "Applicability unknown"], ["applicable", "Applicable"], ["not-applicable", "Not applicable"]].forEach(([value, label]) => applicability.add(new Option(label, value))); applicability.value = check.applicability || "unknown"; card.appendChild(applicability);
      } else {
        const procedure = document.createElement("textarea"); procedure.className = "checklist-procedure"; procedure.dataset.index = String(index); procedure.placeholder = "Test procedure (one step per line)"; procedure.value = checklistTextList(check.procedure).join("\n"); card.appendChild(procedure);
        const evidence = document.createElement("input"); evidence.className = "checklist-evidence"; evidence.dataset.index = String(index); evidence.placeholder = "Evidence IDs (comma separated)"; evidence.value = checklistTextList(check.evidence || check.evidenceIds).join(", "); card.appendChild(evidence);
      }
      const notes = document.createElement("textarea"); notes.className = "checklist-notes"; notes.dataset.index = String(index); notes.placeholder = resourceChecklistType === "mitre" ? "Observations, detection opportunities, or evidence paths" : "Result, limitation, blocked reason, or finding IDs"; notes.value = resourceChecklistType === "mitre" ? (check.observations || check.notes || "") : (check.result || check.notes || ""); card.appendChild(notes);
      const issue = checklistStatusIssue(check, normalizedStatus);
      if (issue) { const validation = document.createElement("p"); validation.className = "checklist-validation"; validation.textContent = issue; card.appendChild(validation); }
      const reference = check.references?.[0]; if (/^https:\/\//i.test(reference || "")) { const link = document.createElement("a"); link.href = reference; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = "Framework reference"; card.appendChild(link); }
      list.appendChild(card);
    });
    section.appendChild(list); checklistGroups.appendChild(section);
  }
  if (!groups.size) { const empty = document.createElement("div"); empty.className = "checklist-empty"; empty.textContent = "No checks match the current filters."; checklistGroups.appendChild(empty); }
}

function setResourceChecklistMode(mode) {
  if (!resourceChecklistActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try { resourceChecklistData = JSON.parse(resourceViewerContent.value); } catch (error) { resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`; return; }
  }
  settingsEditorMode = nextMode; localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, nextMode); syncSettingsEditorButtons();
  resourceViewerContent.hidden = nextMode === "ui"; checklistUIView.hidden = nextMode !== "ui"; settingsUIView.hidden = true;
  if (nextMode === "ui") renderChecklistUI(); else { resourceViewerContent.focus(); syncResourceCursorPosition(); }
}

async function showChecklistResource(filePath, type) {
  assessmentModuleActive = false; assessmentModuleView.hidden = true;
  if (resourceChecklistActive && resourceCurrentFilePath === filePath) {
    if (settingsEditorMode === "ui") checklistSearch?.focus();
    else resourceViewerContent?.focus();
    return;
  }
  if (resourceDirty && resourceCurrentFilePath && resourceCurrentFilePath !== filePath) { const saved = await saveResourceChanges(); if (saved?.error) return; }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, `${type}-checklist.json`, "Target / penetration-testing", { icon: "codicon-checklist" });
  let parsed; try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, "Invalid checklist JSON", "Edit the JSON to restore UI mode", { icon: "codicon-error" }); }
  resourceSettingsActive = false; resourceSettingsData = null; resourceScopeActive = false; resourceScopeData = null; settingsUIView.hidden = true; scopeUIView.hidden = true;
  resourceChecklistActive = true; resourceChecklistType = type; resourceChecklistData = parsed;
  resourcePreviewText = `${JSON.stringify(parsed, null, 2)}\n`; resourceCurrentFilePath = filePath; resourceSavedText = resourcePreviewText;
  resourceViewerTitle.textContent = type === "mitre" ? "MITRE ATT&CK Checklist" : type === "asvs" ? "OWASP ASVS Checklist" : "OWASP WSTG Checklist";
  resourceViewerMeta.textContent = type === "mitre" ? "Enterprise ATT&CK technique coverage" : type === "asvs" ? "Application Security Verification Standard coverage" : "WSTG testing scenarios and OWASP Top 10:2025";
  resourceViewerMeta.title = filePath; resourceViewerIcon.className = `codicon ${type === "mitre" ? "codicon-type-hierarchy-sub" : "codicon-checklist"}`;
  resourceViewerEmpty.hidden = true; resourceViewerContent.classList.remove("error"); resourceViewerContent.readOnly = false; resourceViewerContent.value = resourcePreviewText; resourceViewerCopy.disabled = false;
  settingsViewSwitch.hidden = false; setResourceDirty(false); setResourceChecklistMode(settingsEditorMode);
}

function humanizeScopeKey(key) {
  return String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (char) => char.toUpperCase());
}

const MANAGED_CORE_RESOURCE_META = Object.freeze({
  "scope/in-scope.json": ["In-Scope Assets", "Engagement authorization, targets, wildcard rules, testing windows, and ownership evidence."],
  "scope/out-of-scope.json": ["Out-of-Scope Assets", "Explicit exclusions, prohibited actions, third-party systems, and exception handling."],
  "scope/configurations.json": ["Assessment Configuration", "Operator identity, authorization gates, safety limits, network behavior, evidence, and data handling."],
  "recon/active-recon.json": ["Active Reconnaissance", "Authorized active discovery runs, techniques, observed assets, leads, and linked evidence."],
  "recon/passive-recon.json": ["Passive Reconnaissance", "Passive sources, discovered assets, confidence, provenance, leads, and linked evidence."],
  "enumeration/endpoints.json": ["Endpoints", "Observed routes, methods, parameters, authentication state, technologies, testing state, and evidence."],
  "enumeration/pages.json": ["Pages", "Observed web pages, forms, scripts, API calls, security metadata, testing state, and evidence."],
  "enumeration/subdomains.json": ["Subdomains", "Discovered hostnames, DNS data, liveness, scope state, takeover review, provenance, and evidence."],
  "vulnerability-scans/services.json": ["Services", "Observed services, versions, lifecycle state, TLS metadata, confidence, and linked evidence."],
  "vulnerability-scans/info.json": ["Informational Observations", "Schema-managed informational observations and their supporting evidence."],
  "vulnerability-scans/easy.json": ["Low-Severity Observations", "Schema-managed low-severity finding candidates and their supporting evidence."],
  "vulnerability-scans/medium.json": ["Medium-Severity Observations", "Schema-managed medium-severity finding candidates and their supporting evidence."],
  "vulnerability-scans/high.json": ["High-Severity Observations", "Schema-managed high-severity finding candidates and their supporting evidence."],
  "vulnerability-scans/critical.json": ["Critical-Severity Observations", "Schema-managed critical finding candidates and their supporting evidence."],
});

function createScopeField(key, value, dataPath) {
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

function appendScopeFields(container, object, prefix = "", depth = 0) {
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

function renderScopeUI() {
  if (!resourceScopeActive || !resourceScopeData || !scopeUIForm) return;
  const meta = MANAGED_CORE_RESOURCE_META[resourceScopeRelativePath] || ["Managed Core Resource", "Schema-managed assessment data."];
  scopeUITitle.textContent = meta[0]; scopeUIDescription.textContent = meta[1]; scopeUIForm.innerHTML = "";
  for (const [key, value] of Object.entries(resourceScopeData)) {
    if (key === "schemaVersion" || /Template$/.test(key)) continue;
    const section = document.createElement("section"); section.className = "scope-ui-section";
    const heading = document.createElement("header"); heading.innerHTML = `<strong>${escapeHtml(humanizeScopeKey(key))}</strong>`; section.appendChild(heading);
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) appendScopeFields(section, value, key, 0);
    else section.appendChild(createScopeField(key, value, key));
    scopeUIForm.appendChild(section);
  }
}

function scheduleScopeSave() {
  clearTimeout(resourceScopeSaveTimer);
  resourcePreviewText = `${JSON.stringify(resourceScopeData, null, 2)}\n`; resourceViewerContent.value = resourcePreviewText; setResourceDirty(resourcePreviewText !== resourceSavedText);
  resourceViewerMeta.textContent = `${resourceScopeRelativePath} · Saving...`;
  resourceScopeSaveTimer = setTimeout(async () => {
    const snapshot = `${JSON.stringify(resourceScopeData, null, 2)}\n`;
    const result = await window.api.writeFile(resourceCurrentFilePath, snapshot);
    if (result?.error) { resourceViewerMeta.textContent = `Save failed: ${result.error}`; return; }
    if (resourceViewerContent.value === snapshot) { resourceSavedText = snapshot; setResourceDirty(false); }
    resourceViewerMeta.textContent = `${resourceScopeRelativePath} · Saved`;
  }, 350);
}

function setResourceScopeMode(mode) {
  if (!resourceScopeActive) return;
  const nextMode = mode === "ui" ? "ui" : "json";
  if (nextMode === "ui") {
    try { resourceScopeData = JSON.parse(resourceViewerContent.value); } catch (error) { resourceViewerMeta.textContent = `Invalid JSON: ${error.message}`; return; }
  }
  settingsEditorMode = nextMode; localStorage.setItem(SETTINGS_EDITOR_MODE_KEY, nextMode); syncSettingsEditorButtons();
  resourceViewerContent.hidden = nextMode === "ui"; scopeUIView.hidden = nextMode !== "ui"; settingsUIView.hidden = true; checklistUIView.hidden = true;
  if (nextMode === "ui") renderScopeUI(); else { resourceViewerContent.focus(); syncResourceCursorPosition(); }
}

async function showScopeResource(filePath, relativePath) {
  assessmentModuleActive = false; assessmentModuleView.hidden = true;
  if (resourceScopeActive && resourceCurrentFilePath === filePath) { if (settingsEditorMode === "json") resourceViewerContent.focus(); return; }
  if (resourceDirty && resourceCurrentFilePath && resourceCurrentFilePath !== filePath) { const saved = await saveResourceChanges(); if (saved?.error) return; }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, relativePath.split("/").pop(), `Target / ${relativePath}`, { icon: "codicon-list-tree" });
  let parsed; try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, "Invalid scope JSON", `Target / ${relativePath}`, { icon: "codicon-error" }); }
  resourceSettingsActive = false; resourceChecklistActive = false; resourceScopeActive = true; resourceScopeData = parsed; resourceScopeRelativePath = relativePath;
  settingsUIView.hidden = true; checklistUIView.hidden = true;
  resourcePreviewText = `${JSON.stringify(parsed, null, 2)}\n`; resourceCurrentFilePath = filePath; resourceSavedText = resourcePreviewText;
  resourceViewerTitle.textContent = relativePath.split("/").pop(); resourceViewerMeta.textContent = `Target / ${relativePath}`; resourceViewerMeta.title = filePath; resourceViewerIcon.className = "codicon codicon-list-tree";
  resourceViewerEmpty.hidden = true; resourceViewerContent.classList.remove("error"); resourceViewerContent.readOnly = false; resourceViewerContent.value = resourcePreviewText; resourceViewerCopy.disabled = false;
  settingsViewSwitch.hidden = false; setResourceDirty(false); setResourceScopeMode(settingsEditorMode);
}

const ASSESSMENT_MODULE_META = {
  "scope/engagement.json": ["Engagement & Rules of Engagement", "Authorization, testing windows, contacts, safety limits, and data-handling commitments.", "codicon-shield"],
  "runs/runs.json": ["Run Manager", "Every assessment run has a profile, scope/configuration snapshot, approval state, and stop reason.", "codicon-history"],
  "evidence/index.jsonl": ["Evidence Index", "Chain-of-custody metadata for captured traffic and tool artifacts. Raw secrets remain redacted.", "codicon-file-text"],
  "findings/findings.json": ["Finding Lifecycle", "Deduplicated findings with severity, confidence, evidence links, remediation, and retest state.", "codicon-warning"],
  "enumeration/assets.json": ["Asset Inventory", "Reconciled hosts, subdomains, services, ownership, scope state, provenance, and freshness.", "codicon-globe"],
  "traffic/raw.jsonl": ["Raw Traffic", "Captured HTTP exchanges with request and response evidence, provenance, and capture integrity.", "codicon-arrow-swap"],
  "traffic/filtered.jsonl": ["Filtered Traffic", "Curated HTTP exchanges linked to parameters, findings, notes, and evidence.", "codicon-filter"],
  "penetration-testing/coverage.json": ["Coverage Matrix", "Tested, passed, failed, blocked, and not-applicable coverage across security frameworks.", "codicon-checklist"],
  "report/report.md": ["Assessment Report", "Evidence-linked reporting with executive summary, findings, remediation, retest state, and limitations.", "codicon-file-text"],
  "logs/agent-runs.jsonl": ["Agent Runs", "Transparent run lifecycle records generated by the autonomous agent loop.", "codicon-history"],
  "logs/agent-actions.jsonl": ["Agent Actions", "Every proposed and completed tool action with policy decision and outcome.", "codicon-list-tree"],
  "logs/agent-approvals.jsonl": ["Agent Approvals", "Human approvals and policy gates for active or sensitive actions.", "codicon-shield"],
  "logs/agent-hypotheses.jsonl": ["Hypotheses", "Explicit security questions, expected signals, evidence, and test status.", "codicon-lightbulb"],
  "logs/tool-output.jsonl": ["Tool Output", "Normalized tool-output provenance, hashes, truncation state, and saved artifact paths.", "codicon-terminal"],
};

function moduleValue(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function moduleCard(label, value, tone = "") {
  return `<div class="assessment-module-card ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(moduleValue(value))}</strong></div>`;
}

function moduleTable(headers, rows, empty = "No records yet.") {
  if (!rows.length) return `<div class="assessment-module-empty">${escapeHtml(empty)}</div>`;
  return `<div class="assessment-module-table-wrap"><table class="assessment-module-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td title="${escapeHtml(moduleValue(cell))}">${escapeHtml(moduleValue(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderAssessmentModule() {
  if (!assessmentModuleActive || !assessmentModuleContent) return;
  const data = assessmentModuleData;
  const relativePath = assessmentModulePath;
  let summary = "";
  let content = "";

  if (relativePath === "scope/engagement.json") {
    const authorization = data?.authorization || {};
    const review = data?.scopeReview || {};
    const rules = data?.rulesOfEngagement || {};
    summary = [
      moduleCard("Status", data?.status || "draft", data?.status === "active" ? "success" : "warning"),
      moduleCard("Authorization", authorization.confirmed ? "Confirmed" : "Not confirmed", authorization.confirmed ? "success" : "danger"),
      moduleCard("Scope review", review.reviewed ? "Reviewed" : "Not reviewed", review.reviewed ? "success" : "danger"),
      moduleCard("Rules accepted", data?.scopeReview?.exclusionsConfirmed ? "Confirmed" : "Pending", data?.scopeReview?.exclusionsConfirmed ? "success" : "warning"),
      moduleCard("Rate limit", `${rules.requestsPerSecond || 0} req/s`),
      moduleCard("Concurrency", rules.maximumConcurrency || 1),
    ].join("");
    content = `<div class="assessment-module-section"><h3>Authorization</h3>${moduleTable(["Field", "Value"], [["Authorized by", authorization.authorizedBy], ["Reference", authorization.authorizationReference], ["Signed at", authorization.signedAt], ["Expires at", authorization.expiresAt], ["Emergency contact", data?.contacts?.emergency]])}</div><div class="assessment-module-section"><h3>Stop conditions</h3><div class="assessment-module-tags">${(rules.stopConditions || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<em>None configured</em>"}</div></div>`;
  } else if (relativePath === "runs/runs.json") {
    const runs = Array.isArray(data?.runs) ? data.runs : [];
    const active = runs.find((run) => run.id === data?.activeRunId) || runs.find((run) => ["running", "paused"].includes(run.status));
    summary = [moduleCard("Total runs", runs.length), moduleCard("Active run", active?.id || "None", active ? "warning" : "success"), moduleCard("Completed", runs.filter((run) => run.status === "completed").length, "success"), moduleCard("Stopped", runs.filter((run) => run.status === "stopped").length), moduleCard("Policy", data?.defaults?.requireApproval ? "Approval required" : "Approval optional", "warning")].join("");
    content = `<div class="assessment-module-section"><h3>Run history</h3>${moduleTable(["Run", "Profile", "Status", "Created", "Scope snapshot", "Stop reason"], runs.slice().reverse().map((run) => [run.id, run.profile, run.status, run.createdAt, run.scopeSnapshotSha256 ? `${run.scopeSnapshotSha256.slice(0, 12)}…` : "—", run.stopReason]))}</div>`;
  } else if (relativePath === "findings/findings.json") {
    const findings = Array.isArray(data?.findings) ? data.findings : [];
    summary = [moduleCard("Findings", findings.length), moduleCard("Confirmed", findings.filter((finding) => finding.status === "confirmed").length, "danger"), moduleCard("Reported", findings.filter((finding) => finding.status === "reported").length, "warning"), moduleCard("Retest required", findings.filter((finding) => finding.status === "retest-required").length, "warning"), moduleCard("Remediated", findings.filter((finding) => finding.status === "remediated").length, "success")].join("");
    content = `<div class="assessment-module-section"><h3>Finding lifecycle</h3>${moduleTable(["ID", "Title", "Severity", "Confidence", "Status", "Asset", "Evidence"], findings.slice().reverse().map((finding) => [finding.id, finding.title, finding.severity, finding.confidence, finding.status, finding.asset?.host || finding.asset?.url || "—", (finding.evidence || []).length]))}</div>`;
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
  } else if (relativePath === "penetration-testing/coverage.json") {
    const summaryData = data?.summary || {};
    const frameworks = Array.isArray(data?.frameworks) ? data.frameworks : [];
    summary = [moduleCard("Total checks", summaryData.total || 0), moduleCard("Tested", summaryData.tested || 0), moduleCard("Passed", summaryData.passed || 0, "success"), moduleCard("Failed", summaryData.failed || 0, "danger"), moduleCard("Blocked", summaryData.blocked || 0, "warning"), moduleCard("Not tested", summaryData.notTested || 0, "warning")].join("");
    content = `<div class="assessment-module-section"><h3>Framework coverage</h3>${moduleTable(["Framework", "Source", "Status"], frameworks.map((framework) => [framework.name, framework.source || "Not configured", framework.status]))}</div><div class="assessment-module-section"><h3>Coverage gaps</h3><div class="assessment-module-tags">${(data?.gaps || []).map((gap) => `<span>${escapeHtml(typeof gap === "string" ? gap : gap.title || gap.id || JSON.stringify(gap))}</span>`).join("") || "<em>No gaps recorded</em>"}</div></div>`;
  } else if (relativePath === "report/report.md") {
    const text = String(data?.content || "");
    const headings = text.split(/\r?\n/).filter((line) => /^#{1,3}\s/.test(line)).slice(0, 30);
    summary = [moduleCard("Report status", text.trim() ? "Draft available" : "Empty", text.trim() ? "success" : "warning"), moduleCard("Sections", headings.length), moduleCard("Generated export", "Use Generate report")].join("");
    content = `<div class="assessment-module-section"><h3>Report outline</h3>${moduleTable(["Section", "State"], headings.map((heading) => [heading.replace(/^#+\s*/, ""), "Draft section"]))}</div><div class="assessment-module-section"><h3>Next step</h3><p class="assessment-module-report-note">Generate a timestamped Markdown export after reviewing findings, evidence, coverage, and retest state. The working report remains editable through Open JSON.</p></div>`;
  } else {
    const records = Array.isArray(data) ? data : data?.records || [];
    summary = [moduleCard("Records", records.length), moduleCard("Source", relativePath), moduleCard("Integrity", "Metadata preserved", "success")].join("");
    content = `<div class="assessment-module-section"><h3>Recent records</h3>${moduleTable(["Timestamp", "Type", "ID", "Target", "Status", "Hash"], records.slice(0, 200).map((record) => [record.timestamp || record.recordedAt || record.capturedAt, record.type || record.recordType, record.id || record.runId || record.requestId, record.target || record.targetId || record.tool || record.url, record.status || (record.allowed === false ? "blocked" : record.ok === false ? "failed" : "recorded"), (record.sha256 || "").slice(0, 12)]))}</div>`;
  }
  assessmentModuleSummary.innerHTML = summary;
  assessmentModuleContent.innerHTML = content;
  const isRunModule = relativePath === "runs/runs.json";
  if (assessmentFindingNew) assessmentFindingNew.hidden = relativePath !== "findings/findings.json";
  if (assessmentReportGenerate) assessmentReportGenerate.hidden = relativePath !== "report/report.md";
  assessmentRunStart.hidden = !isRunModule;
  assessmentRunStop.hidden = !isRunModule;
  assessmentRunProfile.hidden = !isRunModule;
  const active = isRunModule && (data?.runs || []).some((run) => ["running", "paused"].includes(run.status));
  assessmentRunStop.disabled = !active;
  assessmentRunStart.disabled = active;
}

async function showAssessmentModule(filePath, relativePath) {
  if (resourceDirty && resourceCurrentFilePath && resourceCurrentFilePath !== filePath) {
    const saved = await saveResourceChanges();
    if (saved?.error) return;
  }
  showResourceWorkspace();
  const result = await window.api.readFile(filePath);
  if (result?.error) return showResourcePreview(filePath, basenameOf(filePath), `Target / ${relativePath}`, { icon: "codicon-error" });
  let parsed;
  if (/\.jsonl$/i.test(relativePath)) {
    parsed = String(result.content || "").split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { type: "invalid", content: line }; } });
  } else if (relativePath === "report/report.md") {
    parsed = { content: String(result.content || "") };
  } else {
    try { parsed = JSON.parse(result.content); } catch { return showResourcePreview(filePath, basenameOf(filePath), `Target / ${relativePath}`, { icon: "codicon-error" }); }
  }
  const [title, description, icon] = ASSESSMENT_MODULE_META[relativePath] || [basenameOf(filePath), `Target / ${relativePath}`, "codicon-file-text"];
  assessmentModuleActive = true; assessmentModulePath = relativePath; assessmentModuleData = parsed;
  resourceSettingsActive = false; resourceSettingsData = null; resourceChecklistActive = false; resourceChecklistData = null; resourceScopeActive = false; resourceScopeData = null;
  resourceViewerEmpty.hidden = true; resourceViewerContent.hidden = true; resourceViewerContent.value = "";
  resourceCurrentFilePath = ""; resourceSavedText = ""; resourcePreviewText = ""; resourceViewerCopy.disabled = true; resourceViewerSave.disabled = true;
  settingsViewSwitch.hidden = true; settingsUIView.hidden = true; checklistUIView.hidden = true; scopeUIView.hidden = true; assessmentModuleView.hidden = false;
  assessmentModuleTitle.textContent = title; assessmentModuleDescription.textContent = description; resourceViewerTitle.textContent = title; resourceViewerMeta.textContent = `Target / ${relativePath}`; resourceViewerMeta.title = filePath; resourceViewerIcon.className = `codicon ${icon}`;
  setResourceDirty(false); renderAssessmentModule();
}

async function refreshAssessmentModule() {
  if (!assessmentModuleActive || !assessmentModulePath || !assessmentPath) return;
  const filePath = assessmentDiskPath(assessmentModulePath);
  const result = await window.api.readFile(filePath);
  if (result?.error) return;
  if (/\.jsonl$/i.test(assessmentModulePath)) {
    assessmentModuleData = String(result.content || "").split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { type: "invalid", content: line }; } });
  } else if (assessmentModulePath === "report/report.md") {
    assessmentModuleData = { content: String(result.content || "") };
  } else {
    try { assessmentModuleData = JSON.parse(result.content); } catch { return; }
  }
  renderAssessmentModule();
}

async function startAssessmentRun() {
  if (!assessmentPath || assessmentRunStart?.disabled) return;
  const role = assessmentRunProfile?.value || "ask";
  const profile = `${chatFamily === "testing" ? "testing" : "assist"}:${role}`;
  if (profile === "testing:agent" && !window.confirm("Testing Agent can perform actions allowed by the current Authority and engagement policy. Confirm that scope, rate limits, and stop conditions are correct.")) return;
  assessmentRunStart.disabled = true;
  const result = await window.api.assessmentCreateRun({ path: assessmentPath, run: { profile, status: "running", operator: "local-user" } });
  if (result?.error) {
    assessmentRunStart.disabled = false;
    addErrorMessage(result.error);
    return;
  }
  setAgentStatus(`Run ${result.run?.id || "started"} running`);
  await refreshAssessmentModule();
}

async function stopAssessmentRun() {
  if (!assessmentPath || !assessmentModuleData || assessmentModulePath !== "runs/runs.json") return;
  const active = (assessmentModuleData.runs || []).find((run) => ["running", "paused"].includes(run.status));
  if (!active) return;
  const reason = window.prompt("Why is this run being stopped?", "Stopped by operator") || "Stopped by operator";
  const result = await window.api.assessmentUpdateRun({ path: assessmentPath, id: active.id, patch: { status: "stopped", completedAt: new Date().toISOString(), stopReason: reason } });
  if (result?.error) { addErrorMessage(result.error); return; }
  setAgentStatus(`Run ${active.id} stopped`);
  await refreshAssessmentModule();
}

assessmentModuleOpenJson?.addEventListener("click", () => {
  if (!assessmentModulePath || !assessmentPath) return;
  showResourcePreview(assessmentDiskPath(assessmentModulePath), basenameOf(assessmentModulePath), `Target / ${assessmentModulePath}`, { icon: "codicon-json" });
});
assessmentFindingNew?.addEventListener("click", async () => {
  if (!assessmentPath || assessmentModulePath !== "findings/findings.json") return;
  const title = window.prompt("Finding title", "New suspected issue");
  if (!title?.trim()) return;
  const severity = (window.prompt("Severity (informational/low/medium/high/critical)", "medium") || "medium").trim().toLowerCase();
  const result = await window.api.assessmentAppendFinding({ path: assessmentPath, finding: { title: title.trim(), severity, status: "draft", source: "manual" } });
  if (result?.error) addErrorMessage(result.error); else await refreshAssessmentModule();
});
assessmentReportGenerate?.addEventListener("click", async () => {
  if (!assessmentPath || assessmentModulePath !== "report/report.md") return;
  const result = await window.api.assessmentGenerateReport({ path: assessmentPath });
  if (result?.error) addErrorMessage(result.error);
  else setAgentStatus(`Report generated: ${result.path}`);
});
assessmentRunStart?.addEventListener("click", startAssessmentRun);
assessmentRunStop?.addEventListener("click", stopAssessmentRun);

async function showResourcePreview(filePath, title, meta = "", { icon = "codicon-file-text", line = 1 } = {}) {
  if (!filePath || !resourceViewerContent) return;
  assessmentModuleActive = false;
  if (assessmentModuleView) assessmentModuleView.hidden = true;
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
  resourceChecklistActive = false;
  resourceChecklistData = null;
  resourceScopeActive = false;
  resourceScopeData = null;
  if (checklistUIView) checklistUIView.hidden = true;
  if (scopeUIView) scopeUIView.hidden = true;
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
resourceViewerContent?.addEventListener("scroll", () => {
  if (resourceLineNumbers) resourceLineNumbers.scrollTop = resourceViewerContent.scrollTop;
});

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
    // An incomplete assessment must not lock the workspace. The verifier is
    // allowed to report repair issues while existing files remain readable;
    // individual readers below will show a useful error/JSON preview when a
    // particular file is actually missing or malformed.
    setAssessmentUiState("incomplete", verification);
  }

  const diskPath = assessmentDiskPath(relativePath);
  const fileName = relativePath.split("/").pop();
  if (MANAGED_CORE_RESOURCE_META[relativePath]) {
    await showScopeResource(diskPath, relativePath);
    return;
  }
  if (relativePath === "settings.config") {
    await showSettingsResource(diskPath);
    return;
  }
  if (relativePath === "penetration-testing/wstg-checklist.json") {
    await showChecklistResource(diskPath, "wstg");
    return;
  }
  if (relativePath === "penetration-testing/mitre-checklist.json") {
    await showChecklistResource(diskPath, "mitre");
    return;
  }
  if (relativePath === "penetration-testing/asvs-checklist.json") {
    await showChecklistResource(diskPath, "asvs");
    return;
  }
  if (ASSESSMENT_MODULE_META[relativePath]) {
    await showAssessmentModule(diskPath, relativePath);
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
  if (securityInspector && !securityInspector.classList.contains("collapsed")) refreshSecurityInspectorContext();
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

function trafficMessageBody(rawMessage) {
  const message = String(rawMessage || "");
  const match = message.match(/\r?\n\r?\n/);
  return match ? message.slice(match.index + match[0].length) : "";
}

function trafficBodyParameterCount(record) {
  const request = String(record?.request || "");
  const body = trafficMessageBody(request).trim();
  if (!body) return 0;
  const contentType = trafficHeaderValue(request, "content-type").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try { return [...new URLSearchParams(body).keys()].length || 1; } catch { return 1; }
  }
  if (contentType.includes("json")) {
    try { const parsed = JSON.parse(body); return parsed && typeof parsed === "object" ? Math.max(1, Object.keys(parsed).length) : 1; } catch { return 1; }
  }
  if (contentType.includes("multipart/")) return Math.max(1, [...body.matchAll(/content-disposition:\s*form-data;[^\r\n]*\bname=/gi)].length);
  return 1;
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
  hasParams = hasParams || trafficBodyParameterCount(record) > 0;
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
    number: Number(record?.__pointerHistoryNumber) || count - index,
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

function setSecurityInspectorStatus(message, tone = "") {
  if (!securityInspectorStatus) return;
  securityInspectorStatus.textContent = message || "Ready";
  securityInspectorStatus.classList.toggle("error", tone === "error");
  securityInspectorStatus.classList.toggle("success", tone === "success");
}

function setSecurityInspectorTab(tab) {
  securityInspectorTab = ["decoder", "jwt", "cookies"].includes(tab) ? tab : "decoder";
  securityInspectorTabs.forEach((button) => {
    const active = button.dataset.inspectorTab === securityInspectorTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  securityInspectorPanels.forEach((panel) => { panel.hidden = panel.dataset.inspectorPanel !== securityInspectorTab; });
  localStorage.setItem(SECURITY_INSPECTOR_TAB_KEY, securityInspectorTab);
}

function setSecurityInspectorOpen(open) {
  const expanded = Boolean(open);
  securityInspector?.classList.toggle("collapsed", !expanded);
  if (securityInspectorPanel) securityInspectorPanel.hidden = !expanded;
  securityInspectorToggle?.setAttribute("aria-expanded", String(expanded));
  if (securityInspectorToggle) securityInspectorToggle.title = expanded ? "Close Inspector" : "Open Inspector";
  localStorage.setItem(SECURITY_INSPECTOR_OPEN_KEY, String(expanded));
  if (expanded) { setSecurityInspectorTab(securityInspectorTab); refreshSecurityInspectorContext(); }
}

function inspectorEditorSelection() {
  const editor = [securityRequestEditor, securityResponseEditor].find((candidate) => candidate === document.activeElement)
    || [securityRequestEditor, securityResponseEditor].find((candidate) => candidate && candidate.selectionEnd > candidate.selectionStart);
  if (!editor) return "";
  return editor.value.slice(editor.selectionStart, editor.selectionEnd);
}

function refreshSecurityInspectorContext() {
  if (!securityInspectorContext || !window.SecurityInspectorCodec) return;
  const request = securityRequestEditor?.value || "";
  const response = securityResponseEditor?.value || "";
  const jwtCount = [request, response].filter((value) => SecurityInspectorCodec.findJwt(value)).length;
  const cookieCount = SecurityInspectorCodec.extractHeaderValues(request, "cookie").length + SecurityInspectorCodec.extractHeaderValues(response, "set-cookie").length;
  securityInspectorContext.textContent = `${jwtCount} JWT source${jwtCount === 1 ? "" : "s"} · ${cookieCount} cookie header${cookieCount === 1 ? "" : "s"} detected`;
}

function loadInspectorDecoderSource(source) {
  if (!inspectorDecoderInput) return;
  const value = source === "selection" ? inspectorEditorSelection()
    : source === "response" ? securityResponseEditor?.value || ""
      : securityRequestEditor?.value || "";
  inspectorDecoderInput.value = value;
  setSecurityInspectorStatus(value ? `Loaded ${source}` : `No ${source} content available`, value ? "success" : "error");
}

function runInspectorTransform(direction) {
  try {
    const codec = window.SecurityInspectorCodec;
    if (!codec) throw new Error("Inspector codec is unavailable");
    const input = inspectorDecoderInput?.value || "";
    const format = inspectorDecoderFormat?.value || "url-component";
    inspectorDecoderOutput.value = direction === "encode" ? codec.encodeTransform(input, format) : codec.decodeTransform(input, format);
    setSecurityInspectorStatus(`${direction === "encode" ? "Encoded" : "Decoded"} as ${format}`, "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

function renderInspectorJwtAnalysis(parsed, verification = "") {
  if (!inspectorJwtAnalysis) return;
  const analysis = SecurityInspectorCodec.analyzeJwt(parsed);
  const warnings = analysis.warnings.map((item) => `<li class="warning">${escapeHtml(item)}</li>`).join("");
  const observations = analysis.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  inspectorJwtAnalysis.className = "inspector-analysis";
  inspectorJwtAnalysis.innerHTML = `<strong>${escapeHtml(analysis.algorithm)} · ${analysis.signed ? "signature present" : "unsigned"}${verification ? ` · ${escapeHtml(verification)}` : ""}</strong>${warnings || observations ? `<ul>${warnings}${observations}</ul>` : '<span class="success">No obvious structural warnings.</span>'}`;
}

function decodeInspectorJwt(token = inspectorJwtToken?.value || "") {
  try {
    const parsed = SecurityInspectorCodec.parseJwt(token);
    inspectorJwtToken.value = parsed.token;
    inspectorJwtHeader.value = JSON.stringify(parsed.header, null, 2);
    inspectorJwtPayload.value = JSON.stringify(parsed.payload, null, 2);
    if (["HS256", "HS384", "HS512", "none"].includes(parsed.header.alg)) inspectorJwtAlg.value = parsed.header.alg;
    renderInspectorJwtAnalysis(parsed);
    setSecurityInspectorStatus("JWT decoded locally; signature has not been trusted or verified", "success");
    return parsed;
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); return null; }
}

function loadInspectorJwtSource(source) {
  const raw = source === "response" ? securityResponseEditor?.value : securityRequestEditor?.value;
  const token = SecurityInspectorCodec.findJwt(raw || "");
  if (!token) { setSecurityInspectorStatus(`No JWT found in ${source}`, "error"); return; }
  inspectorJwtToken.value = token;
  decodeInspectorJwt(token);
}

async function importInspectorHmacKey(secret, algorithm) {
  if (!secret) throw new Error("Enter an HMAC secret for signing or verification");
  const hash = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[algorithm];
  if (!hash) throw new Error(`Unsupported signing algorithm: ${algorithm}`);
  return crypto.subtle.importKey("raw", SecurityInspectorCodec.utf8Bytes(secret), { name: "HMAC", hash }, false, ["sign", "verify"]);
}

async function signInspectorJwt() {
  try {
    const header = JSON.parse(inspectorJwtHeader.value || "{}");
    const payload = JSON.parse(inspectorJwtPayload.value || "{}");
    const algorithm = inspectorJwtAlg.value || "HS256";
    header.alg = algorithm;
    const signingInput = `${SecurityInspectorCodec.toBase64Url(JSON.stringify(header))}.${SecurityInspectorCodec.toBase64Url(JSON.stringify(payload))}`;
    let signature = "";
    if (algorithm !== "none") {
      const key = await importInspectorHmacKey(inspectorJwtSecret.value, algorithm);
      const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, SecurityInspectorCodec.utf8Bytes(signingInput)));
      signature = SecurityInspectorCodec.bytesToBase64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    inspectorJwtToken.value = `${signingInput}.${signature}`;
    decodeInspectorJwt(inspectorJwtToken.value);
    setSecurityInspectorStatus(algorithm === "none" ? "Unsigned JWT encoded" : `${algorithm} JWT signed locally`, algorithm === "none" ? "error" : "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

async function verifyInspectorJwt() {
  try {
    const parsed = SecurityInspectorCodec.parseJwt(inspectorJwtToken.value);
    const algorithm = String(parsed.header.alg || "");
    if (!/^HS(?:256|384|512)$/.test(algorithm)) throw new Error("Verification currently supports HMAC JWTs: HS256, HS384, and HS512");
    const key = await importInspectorHmacKey(inspectorJwtSecret.value, algorithm);
    const verified = await crypto.subtle.verify("HMAC", key, SecurityInspectorCodec.base64UrlToBytes(parsed.signature), SecurityInspectorCodec.utf8Bytes(parsed.signingInput));
    renderInspectorJwtAnalysis(parsed, verified ? "signature valid" : "signature invalid");
    setSecurityInspectorStatus(verified ? "JWT signature is valid for the supplied secret" : "JWT signature does not match the supplied secret", verified ? "success" : "error");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

function loadInspectorCookieSource(source) {
  const raw = source === "response" ? securityResponseEditor?.value || "" : securityRequestEditor?.value || "";
  const header = source === "response" ? "set-cookie" : "cookie";
  const values = SecurityInspectorCodec.extractHeaderValues(raw, header);
  inspectorCookieInput.value = values.join(source === "response" ? "\n" : "; ");
  if (values.length) analyzeInspectorCookies();
  else setSecurityInspectorStatus(`No ${header} header found`, "error");
}

function analyzeInspectorCookies() {
  try {
    const rows = SecurityInspectorCodec.parseCookies(inspectorCookieInput.value);
    if (!rows.length) throw new Error("No cookie name/value pairs found");
    inspectorCookieResults.className = "inspector-analysis";
    inspectorCookieResults.innerHTML = `<strong>${rows.length} cookie${rows.length === 1 ? "" : "s"}</strong><table class="inspector-cookie-table"><thead><tr><th>Name</th><th>Decoded value</th><th>Attributes / analysis</th></tr></thead><tbody>${rows.map((row) => `<tr><td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td><td title="${escapeHtml(row.decodedValue)}">${escapeHtml(row.decodedValue)}</td><td class="${row.notes.length ? "warning" : ""}">${escapeHtml([...Object.entries(row.attributes).map(([name, value]) => `${name}${value === true ? "" : `=${value}`}`), ...row.notes].join(" · ") || "—")}</td></tr>`).join("")}</tbody></table>`;
    setSecurityInspectorStatus("Cookie values and attributes analyzed locally", "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

async function copyInspectorValue(value, label) {
  if (!value) { setSecurityInspectorStatus(`Nothing to copy from ${label}`, "error"); return; }
  await navigator.clipboard.writeText(value);
  setSecurityInspectorStatus(`${label} copied`, "success");
}

function securityHistoryTimeValue(record) {
  const iso = Date.parse(String(record?.isoTimestamp || ""));
  if (Number.isFinite(iso)) return iso;
  const raw = String(record?.timestamp || "");
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})-(\d{2}):(\d{2}):(\d{2})(?::(\d{1,3}))?$/);
  if (!match) return Date.parse(raw) || 0;
  const [, day, month, year, hour, minute, second, millisecond = "0"] = match;
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  return Date.UTC(fullYear, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond.padEnd(3, "0")));
}

function securityHistorySortValue(record, key) {
  const meta = trafficHistoryMeta(record, 0, securityHistoryRecords.length || 1);
  if (key === "number") return Number(record?.__pointerHistoryNumber) || 0;
  if (key === "params") {
    let queryCount = 0;
    try { queryCount = [...new URL(record?.url || "").searchParams.keys()].length; } catch { /* keep zero */ }
    return queryCount + trafficBodyParameterCount(record);
  }
  if (key === "status") return Number(meta.status) || 0;
  if (key === "length") return Number(meta.length) || 0;
  if (key === "time") return securityHistoryTimeValue(record);
  return String(meta[key] || "").toLocaleLowerCase();
}

function sortedSecurityHistoryRecords(records) {
  const direction = securityHistorySort.direction === "desc" ? -1 : 1;
  const key = securityHistorySort.key;
  return [...records].sort((left, right) => {
    const leftValue = securityHistorySortValue(left, key);
    const rightValue = securityHistorySortValue(right, key);
    const compared = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
    if (compared) return compared * direction;
    return ((Number(left?.__pointerHistoryNumber) || 0) - (Number(right?.__pointerHistoryNumber) || 0)) * -1;
  });
}

function updateSecurityHistorySortHeaders() {
  securityHistorySortHeaders.forEach((header) => {
    const active = header.dataset.historySort === securityHistorySort.key;
    const direction = active ? securityHistorySort.direction : "none";
    header.classList.toggle("sorted", active);
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    const icon = header.querySelector(".codicon");
    icon?.classList.toggle("codicon-chevron-up", active && direction === "asc");
    icon?.classList.toggle("codicon-chevron-down", !active || direction === "desc");
    const label = header.querySelector("span")?.textContent || header.dataset.historySort;
    header.querySelector("button")?.setAttribute("title", active
      ? `${label}: ${direction === "asc" ? "ascending" : "descending"}. Click to reverse.`
      : `Sort by ${label}`);
  });
}

function setSecurityHistorySort(key) {
  if (!key) return;
  if (securityHistorySort.key === key) securityHistorySort.direction = securityHistorySort.direction === "asc" ? "desc" : "asc";
  else securityHistorySort = { key, direction: key === "time" ? "desc" : "asc" };
  renderSecurityHistory(securityHistoryRecords);
}

function syncSecurityHistorySelectionUi() {
  securityHistoryRows?.querySelectorAll("tr").forEach((row, rowIndex) => {
    const selected = selectedSecurityHistoryIndices.has(rowIndex);
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
  });
}

function loadSecurityHistoryRecord(index) {
  const record = securityHistoryRecords[index];
  if (!record) return;
  if (SECURITY_TOOL_META[record.tool]) setSecurityTool(record.tool);
  securityRequestEditor.value = String(record.request || "");
  securityResponseEditor.value = String(record.response || "");
  syncSecurityExchangeSizes();
  const label = record.requestId || `entry ${securityHistoryRecords.length - index}`;
  setSecurityStatus(`History · ${label} · ${record.timestamp || record.isoTimestamp || ""}`, "success");
}

function setSecurityHistorySelection(indices, { loadRecordIndex = null, anchorIndex = null } = {}) {
  selectedSecurityHistoryIndices = new Set(indices);
  selectedSecurityHistoryRequestIds = new Set([...selectedSecurityHistoryIndices]
    .map((index) => securityHistoryRecords[index]?.requestId)
    .filter(Boolean)
    .map(String));
  if (anchorIndex != null) securityHistoryAnchorIndex = anchorIndex;
  syncSecurityHistorySelectionUi();
  if (loadRecordIndex != null && loadRecordIndex >= 0) loadSecurityHistoryRecord(loadRecordIndex);
}

function selectSecurityHistoryRecord(index, event = null) {
  const record = securityHistoryRecords[index];
  if (!record) return;

  if (event?.shiftKey && securityHistoryAnchorIndex >= 0) {
    const start = Math.min(securityHistoryAnchorIndex, index);
    const end = Math.max(securityHistoryAnchorIndex, index);
    const indices = [];
    for (let i = start; i <= end; i += 1) indices.push(i);
    setSecurityHistorySelection(indices, { loadRecordIndex: index, anchorIndex: securityHistoryAnchorIndex });
    return;
  }

  if (event && (event.ctrlKey || event.metaKey)) {
    const next = new Set(selectedSecurityHistoryIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSecurityHistorySelection([...next], { loadRecordIndex: index, anchorIndex: index });
    return;
  }

  setSecurityHistorySelection([index], { loadRecordIndex: index, anchorIndex: index });
}

function closeSecurityHistoryMenu() {
  if (!securityHistoryMenu) return;
  securityHistoryMenu.hidden = true;
}

function openSecurityHistoryMenu(clientX, clientY) {
  if (!securityHistoryMenu || selectedSecurityHistoryIndices.size === 0) return;
  const count = selectedSecurityHistoryIndices.size;
  if (securityHistoryDeleteLabel) {
    securityHistoryDeleteLabel.textContent = count === 1 ? "Delete" : `Delete ${count} entries`;
  }

  securityHistoryMenu.hidden = false;
  securityHistoryMenu.style.visibility = "hidden";
  securityHistoryMenu.style.left = "0px";
  securityHistoryMenu.style.top = "0px";

  const { width, height } = securityHistoryMenu.getBoundingClientRect();
  const pad = 4;
  let left = clientX;
  let top = clientY;
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
  if (top + height > window.innerHeight - pad) top = window.innerHeight - height - pad;
  securityHistoryMenu.style.left = `${Math.max(pad, left)}px`;
  securityHistoryMenu.style.top = `${Math.max(pad, top)}px`;
  securityHistoryMenu.style.visibility = "";
}

async function deleteSelectedSecurityHistoryRecords() {
  if (!assessmentPath || selectedSecurityHistoryIndices.size === 0) return;
  const requestIds = [...selectedSecurityHistoryIndices]
    .map((index) => securityHistoryRecords[index]?.requestId)
    .filter(Boolean);
  if (!requestIds.length) return;

  closeSecurityHistoryMenu();
  setSecurityStatus(`Deleting ${requestIds.length} exchange${requestIds.length === 1 ? "" : "s"}...`);
  const result = await window.api.assessmentDeleteTrafficRecords({ path: assessmentPath, requestIds });
  if (result?.error) {
    setSecurityStatus(result.error, "error");
    return;
  }
  selectedSecurityHistoryIndices = new Set();
  selectedSecurityHistoryRequestIds = new Set();
  securityHistoryAnchorIndex = -1;
  securityRequestEditor.value = "";
  securityResponseEditor.value = "";
  syncSecurityExchangeSizes();
  await loadSecurityHistory();
  setSecurityStatus(`Deleted ${result.deleted || 0} exchange${result.deleted === 1 ? "" : "s"}`, "success");
}

function renderSecurityHistory(records) {
  const preservedRequestIds = new Set(selectedSecurityHistoryRequestIds);
  if (!preservedRequestIds.size) {
    preservedRequestIds.clear();
    [...selectedSecurityHistoryIndices].forEach((index) => {
      const requestId = securityHistoryRecords[index]?.requestId;
      if (requestId) preservedRequestIds.add(String(requestId));
    });
  }
  const sourceRecords = Array.isArray(records) ? records : [];
  sourceRecords.forEach((record, index) => {
    if (!record || Object.prototype.hasOwnProperty.call(record, "__pointerHistoryNumber")) return;
    Object.defineProperty(record, "__pointerHistoryNumber", { value: sourceRecords.length - index, enumerable: false, configurable: true });
  });
  securityHistoryRecords = sortedSecurityHistoryRecords(sourceRecords);
  updateSecurityHistorySortHeaders();
  const restoredIndices = securityHistoryRecords
    .map((record, index) => preservedRequestIds.has(String(record.requestId)) ? index : -1)
    .filter((index) => index >= 0);
  selectedSecurityHistoryIndices = new Set(restoredIndices);
  selectedSecurityHistoryRequestIds = new Set(restoredIndices.map((index) => String(securityHistoryRecords[index].requestId)));
  securityHistoryAnchorIndex = restoredIndices.length ? restoredIndices[0] : -1;
  closeSecurityHistoryMenu();
  if (!securityHistoryRows || !securityHistoryEmpty) return;
  securityHistoryRows.innerHTML = "";
  securityHistoryEmpty.hidden = securityHistoryRecords.length > 0;
  securityHistoryRecords.forEach((record, index) => {
    const meta = trafficHistoryMeta(record, index, securityHistoryRecords.length);
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("aria-selected", String(selectedSecurityHistoryIndices.has(index)));
    row.classList.toggle("selected", selectedSecurityHistoryIndices.has(index));
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
    row.addEventListener("click", (event) => selectSecurityHistoryRecord(index, event));
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!selectedSecurityHistoryIndices.has(index)) {
        setSecurityHistorySelection([index], { loadRecordIndex: index, anchorIndex: index });
      }
      openSecurityHistoryMenu(event.clientX, event.clientY);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectSecurityHistoryRecord(index, event);
    });
    securityHistoryRows.appendChild(row);
  });
  if (restoredIndices.length) loadSecurityHistoryRecord(restoredIndices[0]);
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
  if (!requireAuthority("outboundHttp", "Outbound HTTP requests")) return;
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
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode, mode.includes(":") ? mode.split(":")[0] : chatFamily)];
  if (profile?.key === "planner") return "mode-plan";
  if (profile?.key === "agent" || profile?.key === "executor" || profile?.key === "execution" || profile?.key === "exploit") return "mode-agent";
  return "mode-ask";
}

function modeIconClass(mode = chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode, mode.includes(":") ? mode.split(":")[0] : chatFamily)];
  if (profile?.key === "planner") return "codicon-checklist";
  if (profile?.key === "agent" || profile?.key === "executor") return "codicon-copilot";
  return "codicon-comment-discussion";
}

function modePlaceholder(mode = chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode, mode.includes(":") ? mode.split(":")[0] : chatFamily)];
  if (profile?.key === "planner") return "Plan an investigation or workflow";
  if (profile?.key === "ask") return "Ask, analyze, observe, or explain";
  if (profile?.key === "agent") return chatFamily === "testing" ? "Describe the approved test or investigation" : "Ask the safe Agent to inspect or update the workspace";
  return "Ask, investigate, run, or search";
}

function modeTools(mode = chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode, mode.includes(":") ? mode.split(":")[0] : chatFamily)] || {};
  const allowed = profile.key === "agent" || profile.key === "executor" || profile.capability === "workspace" || profile.capability === "active" || profile.capability === "exploit"
    ? AGENT_TOOL_NAMES
    : READ_ONLY_TOOL_NAMES;
  return ToolMap.TOOLS.filter((tool) => allowed.has(tool.function?.name));
}

function syncChatModeUi() {
  const isTesting = chatFamily === "testing";
  if (chatModeButton) {
    chatModeButton.classList.remove("mode-ask", "mode-plan", "mode-agent", "mode-exploit");
    chatModeButton.classList.add(modeButtonClass());
  }
  if (chatModeButtonLabel) {
    chatModeButtonLabel.textContent = modeLabel();
  }
  if (chatModeButton) {
    chatModeButton.title = `${modeLabel()} · ${isTesting ? "Test" : "Safe"} mode`;
  }
  if (chatModeIcon) {
    chatModeIcon.classList.remove("codicon-copilot", "codicon-checklist", "codicon-comment-discussion", "codicon-play", "codicon-warning", "codicon-shield", "codicon-search", "codicon-eye", "codicon-verified", "codicon-file-text");
    chatModeIcon.classList.add(modeIconClass());
  }
  if (chatSafetyToggle) {
    chatSafetyToggle.classList.toggle("safe", !isTesting);
    chatSafetyToggle.classList.toggle("test", isTesting);
    chatSafetyToggle.dataset.safetyMode = isTesting ? "test" : "safe";
  }
  if (chatSafetyButton) {
    chatSafetyButton.classList.toggle("safe", !isTesting);
    chatSafetyButton.classList.toggle("test", isTesting);
    chatSafetyButton.setAttribute("aria-checked", String(isTesting));
    chatSafetyButton.setAttribute("aria-label", isTesting ? "Switch to Assist safe mode" : "Switch to Testing mode");
    chatSafetyButton.title = isTesting ? "Test mode · sensitive actions enabled" : "Safe mode · sensitive actions blocked";
  }
  if (chatSafetyLabel) {
    chatSafetyLabel.classList.toggle("safe", !isTesting);
    chatSafetyLabel.classList.toggle("test", isTesting);
    chatSafetyLabel.textContent = isTesting ? "Test" : "Safe";
  }
  chatModeMenu?.querySelectorAll("[data-chat-mode]").forEach((button) => {
    const active = button.dataset.chatMode === chatMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  chatModeMenu?.querySelectorAll("[data-chat-family]").forEach((button) => {
    const active = button.dataset.chatFamily === chatFamily;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  chatModeMenu?.classList.toggle("testing-active", isTesting);
  chatModeMenu?.classList.toggle("assist-active", !isTesting);
  chatModeMenu?.querySelectorAll("[data-mode-family]").forEach((group) => {
    group.hidden = group.dataset.modeFamily !== chatFamily;
  });
  const policyText = $("chat-mode-policy-text");
  if (policyText) {
    policyText.textContent = isTesting
      ? "Test mode · sensitive execution available within policy"
      : "Safe mode · no sensitive execution or exploit authority";
  }
  if (chatInput) {
    chatInput.placeholder = modePlaceholder();
  }
  setAgentStatus(`${modeLabel()} ready`);
  updateContextUsage();
  if (chatModeMenu && !chatModeMenu.hidden) {
    requestAnimationFrame(() => positionChatModeMenu());
  }
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
  const pad = 8;
  // Keep the bottom edge anchored above the trigger. Extra content can only
  // move the top edge upward; it must never push the picker downward.
  chatModeMenu.style.maxHeight = `${Math.max(120, rect.top - pad * 2)}px`;
  const menuH = chatModeMenu.offsetHeight || 99;
  let left = Math.min(rect.left, window.innerWidth - menuW - pad);
  // Keep the picker anchored above the Agent button. When the menu is taller
  // than the available space, clamp its top instead of letting it flip below.
  const top = Math.max(pad, rect.top - menuH - pad);
  left = Math.max(pad, left);
  chatModeMenu.style.left = `${left}px`;
  chatModeMenu.style.top = `${top}px`;
}

function setChatMode(mode) {
  if (streaming) return;
  const requestedFamily = String(mode || "").includes(":") ? String(mode).split(":")[0] : chatFamily;
  const canonical = canonicalChatMode(mode, CHAT_FAMILIES.has(requestedFamily) ? requestedFamily : chatFamily);
  if (!CHAT_PROFILE_KEYS.has(canonical)) return;
  chatMode = canonical;
  chatFamily = canonical.split(":")[0];
  localStorage.setItem(CHAT_MODE_KEY, canonical);
  localStorage.setItem(CHAT_FAMILY_KEY, chatFamily);
  syncChatModeUi();
  syncActiveChatSession();
  chatInput?.focus();
}

function setChatFamily(family) {
  if (!CHAT_FAMILIES.has(family) || streaming) return;
  const currentRole = CHAT_PROFILE_DEFS[chatMode]?.key;
  const role = CHAT_ROLES.has(currentRole) ? currentRole : "agent";
  setChatMode(`${family}:${role}`);
}

function syncActiveChatSession({ persist = true } = {}) {
  const session = activeChatSession();
  if (!session) return;
  session.history = chatHistory;
  session.contextFilesCache = contextFilesCache;
  session.activeStreamContent = activeStreamContent;
  session.messagesHtml = messages?.innerHTML || "";
  session.chatMode = chatMode;
  session.chatFamily = chatFamily;
  session.selectedModel = selectedModel;
  if (persist) schedulePersistChatSessions();
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
  applyActiveChatSession(session);
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
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
  schedulePersistChatSessions();
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
    schedulePersistChatSessions();
    return;
  }
  const next = chatSessions[Math.max(0, Math.min(idx, chatSessions.length - 1))];
  applyActiveChatSession(next);
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
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
      // Older Pointer builds persisted `thinking: false` for every model even
      // when the user never disabled it. Treat that legacy value as "auto" so
      // Ollama can use its capability-aware default. A true value could only
      // have been chosen explicitly in the old UI, so preserve it.
      const thinkingConfigured = settings.thinkingConfigured === true || settings.thinking === true;
      normalized[name] = {
        thinking: thinkingConfigured ? Boolean(settings.thinking) : null,
        thinkingConfigured,
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
// Model settings and context counters are initialized before the initial mode
// sync because the context indicator reads both of them.
syncChatModeUi();

function getModelSettings(name) {
  if (!modelSettings[name]) {
    modelSettings[name] = {
      thinking: null,
      thinkingConfigured: false,
      context: AUTO_CONTEXT,
      contextLocked: false,
    };
  }
  return modelSettings[name];
}

function modelThinkingEnabled(settings) {
  // null means automatic: omit the API option and let Ollama enable thinking
  // only for models that advertise the capability.
  return settings?.thinking !== false;
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
    ToolParser.MODE_PROMPTS?.[`${chatFamily}:${chatMode}`],
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
  if (!requireAuthority("workspaceWrite", "Creating workspace items")) return;
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

  const workspaceOperation = appController.beginWorkspace(folder);

  const entries = await window.api.readdir(folder);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
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
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await refreshDirMap();
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await TerminalManager.openWithProject(folder);
  if (!appController.isCurrent(workspaceOperation.epoch)) return false;
  await window.api.watchWorkspace?.(folder);
  await restoreChatSessionsForCurrentWorkspace();
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
  else await restoreChatSessionsForCurrentWorkspace();
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
  const switchingWorkspace = currentWorkspaceMode !== "resource";
  showResourceWorkspace({ focus: true });
  if (switchingWorkspace) {
    setSidebarView("bugbounty");
    if (sidebarCollapsed) setSidebarCollapsed(false);
  } else {
    activateSidebarView("bugbounty");
  }
});
activitySecurity?.addEventListener("click", () => showSecurityWorkspace());
activityToolbox?.addEventListener("click", showToolsWorkspace);
toolHealthAction?.addEventListener("click", refreshToolHealth);
activityTerminal?.addEventListener("click", () => {
  if (!requireAuthority("terminalAccess", "Integrated terminal access")) return;
  setTerminalCollapsed(!terminalCollapsed);
  if (!terminalCollapsed) TerminalManager.focusActive();
});
activityChat?.addEventListener("click", () => {
  if (chatCollapsed) openChatPane({ createIfEmpty: true });
  else setChatCollapsed(true);
});
function openAppSettings() {
  showAppSettingsWorkspace();
}
activitySettings?.addEventListener("click", openAppSettings);
btnBugBountyMore?.addEventListener("click", () => openQuickPalette("command"));
btnCreateProjectHeader?.addEventListener("click", createProject);
btnCreateProject?.addEventListener("click", createProject);
btnCreateAssessment?.addEventListener("click", createAssessmentFolder);
btnOpenAssessment?.addEventListener("click", openAssessmentFolder);

// Bind the application menu as soon as the core workspace controls are ready.
// Keeping this listener near the other top-level controls prevents a later,
// optional workspace setup error from making the File menu appear inert.
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

bugBountyRepair?.addEventListener("click", openAssessmentRepairDialog);
assessmentRepairClose?.addEventListener("click", closeAssessmentRepairDialog);
assessmentRepairCancel?.addEventListener("click", closeAssessmentRepairDialog);
assessmentRepairConfirm?.addEventListener("click", repairAssessmentFolder);
assessmentRepairOverlay?.addEventListener("click", (event) => {
  if (event.target === assessmentRepairOverlay) closeAssessmentRepairDialog();
});
$("btn-context-add")?.addEventListener("click", async () => {
  if (!assessmentPath) return;
  const result = await window.api.assessmentBuildContext({ path: assessmentPath });
  if (result?.ok) await showResourcePreview(result.path, "pen_context.md", `Context · ${result.parsed || 0}/${result.total || 0} files parsed`, { icon: "codicon-markdown" });
  else if (result?.error) addErrorMessage(result.error);
});
function syncCustomSelectionUI() {
  customTreeItems?.querySelectorAll(".custom-entry-row[data-custom-path]").forEach((row) => {
    const selected = selectedCustomEntries.has(row.dataset.customPath);
    row.classList.toggle("selected", selected);
    row.querySelector(".custom-entry")?.setAttribute("aria-selected", String(selected));
  });
}

function selectCustomEntry(event, entry, { contextMenu = false } = {}) {
  if (entry.source !== "custom") return;
  const pathValue = entry.relativePath;
  const additive = event.ctrlKey || event.metaKey;
  const rows = [...customTreeItems.querySelectorAll(".custom-entry-row[data-custom-path]")];
  const ordered = rows.map((row) => row.dataset.customPath);
  if (event.shiftKey && customSelectionAnchor && ordered.includes(customSelectionAnchor)) {
    const start = ordered.indexOf(customSelectionAnchor); const end = ordered.indexOf(pathValue);
    if (!additive) selectedCustomEntries.clear();
    ordered.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => selectedCustomEntries.add(item));
  } else if (additive) {
    if (selectedCustomEntries.has(pathValue)) selectedCustomEntries.delete(pathValue); else selectedCustomEntries.add(pathValue);
    customSelectionAnchor = pathValue;
  } else if (!contextMenu || !selectedCustomEntries.has(pathValue)) {
    selectedCustomEntries.clear(); selectedCustomEntries.add(pathValue); customSelectionAnchor = pathValue;
  }
  if (entry.type === "directory") selectedCustomFolder = pathValue;
  syncCustomSelectionUI();
}

function closeCustomContextMenu() {
  if (customContextMenu) customContextMenu.hidden = true;
}

function openCustomContextMenu(event, entry) {
  if (!customContextMenu || entry.source !== "custom") return;
  event.preventDefault(); event.stopPropagation(); selectCustomEntry(event, entry, { contextMenu: true });
  const count = selectedCustomEntries.size;
  customContextDeleteLabel.textContent = count === 1 ? "Delete" : `Delete ${count} Items`;
  customContextMenu.hidden = false;
  const width = customContextMenu.offsetWidth || 190; const height = customContextMenu.offsetHeight || 34;
  customContextMenu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - width - 4))}px`;
  customContextMenu.style.top = `${Math.max(34, Math.min(event.clientY, window.innerHeight - height - 4))}px`;
  customContextDelete?.focus();
}

async function deleteSelectedCustomEntries() {
  const relativePaths = [...selectedCustomEntries];
  if (!relativePaths.length || !assessmentPath) return;
  if (!requireAuthority("workspaceDelete", "Deleting custom assessment items")) return;
  const currentPath = String(resourceCurrentFilePath || "").replace(/\\/g, "/").toLowerCase();
  const deletedCurrentResource = relativePaths.some((item) => {
    const target = assessmentDiskPath(`custom/${item}`).replace(/\\/g, "/").toLowerCase();
    return currentPath === target || currentPath.startsWith(`${target}/`);
  });
  customContextDelete.disabled = true;
  const result = await window.api.assessmentDeleteEntries({ path: assessmentPath, relativePaths });
  customContextDelete.disabled = false;
  closeCustomContextMenu();
  if (result?.error) { addErrorMessage(result.error); return; }
  if (selectedCustomFolder && relativePaths.some((item) => selectedCustomFolder === item || selectedCustomFolder.startsWith(`${item}/`))) selectedCustomFolder = "";
  selectedCustomEntries.clear(); customSelectionAnchor = "";
  if (deletedCurrentResource) {
    setResourceDirty(false); resourceCurrentFilePath = ""; resourcePreviewText = ""; resourceSavedText = "";
    resourceViewerContent.value = ""; resourceViewerContent.hidden = true; resourceViewerEmpty.hidden = false; resourceViewerTitle.textContent = "Target workspace"; resourceViewerMeta.textContent = "The selected Custom item was deleted."; resourceViewerCopy.disabled = true; settingsViewSwitch.hidden = true; settingsUIView.hidden = true; checklistUIView.hidden = true; scopeUIView.hidden = true;
  }
  await refreshCustomEntries(); await refreshDirMap();
}

async function refreshCustomEntries() {
  if (!customTreeItems || !assessmentPath) return;
  const result = await window.api.assessmentCustomEntries({ path: assessmentPath });
  customTreeItems.innerHTML = "";
  let toolsLabelAdded = false;
  const entries = result?.entries || [];
  const selectablePaths = new Set(entries.filter((entry) => entry.source === "custom").map((entry) => entry.relativePath));
  for (const selected of selectedCustomEntries) if (!selectablePaths.has(selected)) selectedCustomEntries.delete(selected);
  const customFolders = new Set(entries.filter((entry) => entry.source === "custom" && entry.type === "directory").map((entry) => entry.relativePath));
  if (selectedCustomFolder && !customFolders.has(selectedCustomFolder)) selectedCustomFolder = "";
  entries.forEach((entry) => {
    if (entry.source === "tools" && !toolsLabelAdded) {
      toolsLabelAdded = true;
      const label = document.createElement("div"); label.className = "custom-inline-label"; label.textContent = "Tool Results"; customTreeItems.appendChild(label);
    }
    const row = document.createElement("div"); row.className = "custom-entry-row"; row.style.paddingLeft = `${8 + (entry.relativePath.split("/").length - 1) * 14}px`;
    if (entry.source === "custom") row.dataset.customPath = entry.relativePath;
    const button = document.createElement("button"); button.type = "button"; button.className = "bounty-report-item custom-entry";
    const icon = document.createElement("span"); icon.className = `codicon ${entry.type === "directory" ? "codicon-folder" : "codicon-file"}`;
    const name = document.createElement("span"); name.textContent = entry.name; button.append(icon, name); row.appendChild(button);
    if (entry.source === "tools" && entry.relativePath.split("/").length === 1) row.classList.add("tool-result-root");
    if (entry.type === "file") button.addEventListener("click", (event) => {
      if (entry.source === "custom") selectCustomEntry(event, entry);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) showResourcePreview(assessmentDiskPath(`${entry.source}/${entry.relativePath}`), entry.name, `${entry.source === "tools" ? "Tool Results" : "Custom"} / ${entry.relativePath}`, { icon: "codicon-file" });
    });
    if (entry.type === "directory" && entry.source === "custom") {
      row.classList.toggle("creation-target", entry.relativePath === selectedCustomFolder);
      button.addEventListener("click", (event) => selectCustomEntry(event, entry));
      const actions = document.createElement("span"); actions.className = "custom-folder-actions";
      [["file", "codicon-new-file", "New file in folder"], ["directory", "codicon-new-folder", "New subfolder"]].forEach(([type, iconName, title]) => {
        const action = document.createElement("button"); action.type = "button"; action.className = "custom-folder-action"; action.title = title; action.setAttribute("aria-label", title); action.innerHTML = `<span class="codicon ${iconName}"></span>`;
        action.addEventListener("click", (event) => { event.stopPropagation(); selectedCustomFolder = entry.relativePath; beginCustomEntry(type, entry.relativePath, row); }); actions.appendChild(action);
      });
      row.appendChild(actions);
    }
    if (entry.source === "custom") row.addEventListener("contextmenu", (event) => openCustomContextMenu(event, entry));
    customTreeItems.appendChild(row);
  });
  syncCustomSelectionUI();
}
function beginCustomEntry(type, parentRelative = selectedCustomFolder, anchorRow = null) {
  if (!assessmentPath || !customTreeItems) return;
  if (!requireAuthority("workspaceWrite", "Creating custom assessment items")) return;
  customTreeItems.querySelector(".custom-create-row")?.remove();
  const row = document.createElement("div"); row.className = "custom-create-row";
  const parent = String(parentRelative || "").replace(/^\/+|\/+$/g, "");
  row.style.paddingLeft = `${9 + (parent ? parent.split("/").length * 14 : 0)}px`;
  const icon = document.createElement("span"); icon.className = `codicon ${type === "directory" ? "codicon-folder" : "codicon-file"}`;
  const input = document.createElement("input"); input.type = "text"; input.className = "custom-create-input"; input.placeholder = type === "directory" ? "folder-name" : "filename.ext"; input.setAttribute("aria-label", type === "directory" ? "New custom folder name" : "New custom file name"); input.autocomplete = "off"; input.spellcheck = false;
  row.append(icon, input); if (anchorRow?.isConnected) anchorRow.after(row); else customTreeItems.prepend(row);
  let committing = false;
  const cancel = () => { if (!committing && row.isConnected) row.remove(); };
  const commit = async () => {
    const name = input.value.trim();
    if (!name) { cancel(); return; }
    committing = true; input.disabled = true; row.classList.add("creating");
    const relativeName = parent ? `${parent}/${name}` : name;
    const result = await window.api.assessmentCreateEntry({ path: assessmentPath, relativePath: `custom/${relativeName}`, type });
    if (result?.error) {
      committing = false; input.disabled = false; row.classList.remove("creating"); row.classList.add("error"); input.title = result.error; input.focus(); input.select(); return;
    }
    if (type === "directory") selectedCustomFolder = relativeName;
    await refreshCustomEntries();
    if (type === "file" && result.path) await showResourcePreview(result.path, name.split(/[\\/]/).pop(), `Custom / ${relativeName}`, { icon: "codicon-file" });
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  });
  input.addEventListener("input", () => { row.classList.remove("error"); input.removeAttribute("title"); });
  input.addEventListener("blur", () => setTimeout(cancel, 120));
  requestAnimationFrame(() => input.focus());
}
$("btn-custom-file")?.addEventListener("click", (event) => { event.stopPropagation(); beginCustomEntry("file"); });
$("btn-custom-folder")?.addEventListener("click", (event) => { event.stopPropagation(); beginCustomEntry("directory"); });
customContextDelete?.addEventListener("click", (event) => { event.stopPropagation(); deleteSelectedCustomEntries(); });
document.addEventListener("click", (event) => { if (!event.target.closest("#custom-context-menu")) closeCustomContextMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCustomContextMenu(); });
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
securityHistorySortHeaders.forEach((header) => header.querySelector("button")?.addEventListener("click", () => setSecurityHistorySort(header.dataset.historySort)));
securityHistoryMenu?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "delete") deleteSelectedSecurityHistoryRecords();
});
document.addEventListener("click", (event) => {
  if (!securityHistoryMenu || securityHistoryMenu.hidden) return;
  if (event.target.closest("#security-history-menu")) return;
  closeSecurityHistoryMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSecurityHistoryMenu();
});
securityInterceptToggle?.addEventListener("click", toggleInterceptorCapture);
securityAnalyzeButton?.addEventListener("click", analyzeSecurityExchange);
securityClearButton?.addEventListener("click", clearSecurityExchange);
securityDropButton?.addEventListener("click", dropInterceptedRequest);
securityInspectorToggle?.addEventListener("click", () => setSecurityInspectorOpen(securityInspector?.classList.contains("collapsed")));
securityInspectorClose?.addEventListener("click", () => setSecurityInspectorOpen(false));
securityInspectorTabs.forEach((button) => button.addEventListener("click", () => setSecurityInspectorTab(button.dataset.inspectorTab)));
document.querySelectorAll("[data-inspector-source]").forEach((button) => button.addEventListener("click", () => loadInspectorDecoderSource(button.dataset.inspectorSource)));
$("inspector-decode")?.addEventListener("click", () => runInspectorTransform("decode"));
$("inspector-encode")?.addEventListener("click", () => runInspectorTransform("encode"));
$("inspector-swap")?.addEventListener("click", () => { const previous = inspectorDecoderInput.value; inspectorDecoderInput.value = inspectorDecoderOutput.value; inspectorDecoderOutput.value = previous; setSecurityInspectorStatus("Input and output swapped", "success"); });
$("inspector-copy-output")?.addEventListener("click", () => copyInspectorValue(inspectorDecoderOutput.value, "Decoder output"));
document.querySelectorAll("[data-jwt-source]").forEach((button) => button.addEventListener("click", () => loadInspectorJwtSource(button.dataset.jwtSource)));
$("inspector-jwt-decode")?.addEventListener("click", () => decodeInspectorJwt());
$("inspector-jwt-copy")?.addEventListener("click", () => copyInspectorValue(inspectorJwtToken.value, "JWT"));
$("inspector-jwt-sign")?.addEventListener("click", signInspectorJwt);
$("inspector-jwt-verify")?.addEventListener("click", verifyInspectorJwt);
document.querySelectorAll("[data-cookie-source]").forEach((button) => button.addEventListener("click", () => loadInspectorCookieSource(button.dataset.cookieSource)));
$("inspector-cookie-analyze")?.addEventListener("click", analyzeInspectorCookies);
$("inspector-cookie-decode")?.addEventListener("click", () => { inspectorCookieOutput.value = SecurityInspectorCodec.transformCookieValues(inspectorCookieInput.value, "decode"); setSecurityInspectorStatus("Cookie values URL-decoded", "success"); });
$("inspector-cookie-encode")?.addEventListener("click", () => { inspectorCookieOutput.value = SecurityInspectorCodec.transformCookieValues(inspectorCookieInput.value, "encode"); setSecurityInspectorStatus("Cookie values URL-encoded", "success"); });
$("inspector-cookie-copy")?.addEventListener("click", () => copyInspectorValue(inspectorCookieOutput.value, "Cookie output"));
setSecurityInspectorOpen(localStorage.getItem(SECURITY_INSPECTOR_OPEN_KEY) === "true");
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
setMapDetailCollapsed(localStorage.getItem(MAP_INSPECT_COLLAPSED_KEY) === "true", { persist: false });
mapDetailToggle?.addEventListener("click", () => setMapDetailCollapsed(!mapMain?.classList.contains("detail-collapsed")));
mapBuildAction?.addEventListener("click", () => {
  if (!requireAuthority("mapBuild", "Application Map building")) return;
  loadApplicationMap({ build: true });
});
document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
  applicationMapMode = button.dataset.mapMode || "route";
  document.querySelectorAll("[data-map-mode]").forEach((candidate) => {
    const active = candidate.dataset.mapMode === applicationMapMode;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-pressed", String(active));
  });
  selectedMapNodeId = "";
  renderApplicationMap();
}));
[mapSearch, mapHostFilter, mapMethodFilter, mapVisibilityFilter].forEach((control) => control?.addEventListener(control === mapSearch ? "input" : "change", renderApplicationMap));
$("map-zoom-in")?.addEventListener("click", () => { mapZoom = Math.min(4, mapZoom * 1.2); updateMapViewportTransform(); });
$("map-zoom-out")?.addEventListener("click", () => { mapZoom = Math.max(.12, mapZoom / 1.2); updateMapViewportTransform(); });
$("map-fit")?.addEventListener("click", () => { mapZoom = 1; mapPanX = 0; mapPanY = 0; updateMapViewportTransform(); });
function selectMapNode(nodeId) {
  if (!nodeId) return;
  selectedMapNodeId = nodeId;
  setMapDetailCollapsed(false);
  renderApplicationMap();
}
mapGraph?.addEventListener("click", (event) => {
  const node = event.target.closest?.("[data-map-node-id]");
  if (mapNodeClickSuppressed) { mapNodeClickSuppressed = false; return; }
  if (mapPointerState?.moved) return;
  if (!node) {
    selectedMapNodeId = "";
    renderApplicationMap();
    return;
  }
  selectMapNode(node.dataset.mapNodeId || "");
});
mapGraph?.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const node = event.target.closest?.("[data-map-node-id]");
  if (!node) return;
  event.preventDefault(); selectMapNode(node.dataset.mapNodeId || "");
});
mapGraph?.addEventListener("wheel", (event) => {
  event.preventDefault();
  mapZoom = Math.max(.12, Math.min(4, mapZoom * (event.deltaY < 0 ? 1.1 : .9)));
  updateMapViewportTransform();
}, { passive: false });
mapGraph?.addEventListener("pointerdown", (event) => {
  const node = event.target.closest?.("[data-map-node-id]");
  if (node && event.button === 0 && event.isPrimary !== false) {
    const nodeId = node.dataset.mapNodeId || "";
    const origin = currentMapPositions.get(nodeId);
    if (!origin) return;
    const mode = applicationMapMode;
    const overrides = activeMapPositionOverrides(mode);
    mapNodeDragState = {
      id: event.pointerId,
      nodeId,
      mode,
      start: mapClientPoint(event.clientX, event.clientY),
      origin: { ...origin },
      previousOverride: overrides.has(nodeId) ? { ...overrides.get(nodeId) } : null,
      moved: false,
      armed: false,
      holdTimer: null,
    };
    mapNodeClickSuppressed = false;
    mapNodeDragState.holdTimer = setTimeout(() => {
      if (!mapNodeDragState || mapNodeDragState.id !== event.pointerId) return;
      mapNodeDragState.armed = true;
      try { mapGraph.setPointerCapture(event.pointerId); } catch { /* pointer may have been released */ }
      mapGraph.classList.add("dragging-node", "is-holding");
    }, 1000);
    return;
  }
  mapPointerState = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: mapPanX, panY: mapPanY, moved: false };
  mapGraph.setPointerCapture(event.pointerId); mapGraph.classList.add("panning", "is-holding");
});
mapGraph?.addEventListener("pointermove", (event) => {
  if (mapNodeDragState?.id === event.pointerId) {
    if (!mapNodeDragState.armed) return;
    const current = mapClientPoint(event.clientX, event.clientY);
    const dx = current.x - mapNodeDragState.start.x;
    const dy = current.y - mapNodeDragState.start.y;
    if (!mapNodeDragState.moved && Math.hypot(dx, dy) <= 4) return;
    mapNodeDragState.moved = true;
    mapNodeClickSuppressed = true;
    const limit = 1_000_000;
    updateDraggedMapNode(mapNodeDragState.nodeId, {
      x: Math.max(-limit, Math.min(limit, mapNodeDragState.origin.x + dx)),
      y: Math.max(-limit, Math.min(limit, mapNodeDragState.origin.y + dy)),
    }, mapNodeDragState.mode);
    return;
  }
  if (!mapPointerState || mapPointerState.id !== event.pointerId) return;
  const rect = mapGraph.getBoundingClientRect();
  const dx = (event.clientX - mapPointerState.x) * 1400 / Math.max(1, rect.width);
  const dy = (event.clientY - mapPointerState.y) * 820 / Math.max(1, rect.height);
  if (Math.abs(dx) + Math.abs(dy) > 2) mapPointerState.moved = true;
  mapPanX = mapPointerState.panX + dx; mapPanY = mapPointerState.panY + dy; updateMapViewportTransform();
});
const endMapPointer = (event, canceled = false) => {
  if (mapNodeDragState?.id === event.pointerId) {
    const drag = mapNodeDragState;
    mapNodeDragState = null;
    if (drag.holdTimer) clearTimeout(drag.holdTimer);
    mapGraph?.classList.remove("dragging-node", "is-holding");
    try { mapGraph?.releasePointerCapture(event.pointerId); } catch { /* pointer capture may already be released */ }
    if (canceled) {
      const overrides = activeMapPositionOverrides(drag.mode);
      if (drag.previousOverride) overrides.set(drag.nodeId, drag.previousOverride);
      else overrides.delete(drag.nodeId);
      renderApplicationMap();
    } else if (drag.moved) {
      persistMapNodePositions();
    } else {
      // Handle short clicks (and a held-but-never-moved node) directly on
      // pointer release. Pointer capture can otherwise prevent the browser's
      // synthetic click from reaching the freshly-rendered node.
      mapNodeClickSuppressed = true;
      selectMapNode(drag.nodeId);
      setTimeout(() => { mapNodeClickSuppressed = false; }, 250);
    }
    if (drag.moved) setTimeout(() => { mapNodeClickSuppressed = false; }, 250);
    return;
  }
  if (!mapPointerState || mapPointerState.id !== event.pointerId) return;
  mapGraph?.classList.remove("panning", "is-holding");
  try { mapGraph?.releasePointerCapture(event.pointerId); } catch { /* pointer capture may already be released */ }
  setTimeout(() => { mapPointerState = null; }, 0);
};
mapGraph?.addEventListener("pointerup", endMapPointer);
mapGraph?.addEventListener("pointercancel", (event) => endMapPointer(event, true));
mapDetailContent?.addEventListener("click", (event) => {
  const evidence = event.target.closest?.("[data-map-evidence]");
  if (evidence) openMapEvidence(evidence.dataset.mapEvidence);
});
bugBountyTree?.addEventListener("click", async (event) => {
  const toggle = event.target.closest(".bounty-phase-toggle");
  if (toggle) {
    const phase = toggle.closest(".bounty-phase");
    setBugBountyPhaseExpanded(phase, !phase.classList.contains("expanded"));
    return;
  }

  const item = event.target.closest("[data-bounty-item], [data-bounty-folder]");
  if (!item) return;
  bugBountyTree.querySelectorAll("[data-bounty-item].selected, [data-bounty-folder].selected").forEach((node) => {
    node.classList.remove("selected");
    node.setAttribute("aria-selected", "false");
  });
  item.classList.add("selected");
  item.setAttribute("aria-selected", "true");
  const selectedKey = item.dataset.bountyItem || item.dataset.bountyFolder;
  localStorage.setItem(BUG_BOUNTY_SELECTED_KEY, selectedKey);
  if (item.dataset.bountyFolder === "Map") { await showMapWorkspace(); return; }
  if (item.dataset.bountyFolder === "WebClone") { await showWebCloneWorkspace(); return; }
  if (item.dataset.bountyFolder) return;
  await openAssessmentItem(item);
});

document.querySelectorAll("[data-tool-preset]").forEach((button) => button.addEventListener("click", () => applyToolPreset(button.dataset.toolPreset)));
document.querySelectorAll("[data-tool-view]").forEach((button) => button.addEventListener("click", () => setToolView(button.dataset.toolView)));
$("tool-config-close")?.addEventListener("click", () => { toolConfigOverlay.hidden = true; });
toolConfigOverlay?.addEventListener("click", (event) => { if (event.target === toolConfigOverlay) toolConfigOverlay.hidden = true; });
toolConfigJson?.addEventListener("input", () => { try { selectedToolConfig = JSON.parse(toolConfigJson.value); toolConfigJson.classList.remove("error"); syncToolCommand(); } catch { toolConfigJson.classList.add("error"); } });
$("tool-copy-command")?.addEventListener("click", () => navigator.clipboard.writeText(toolCommandPreview.textContent || ""));
toolConfigDialog?.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!assessmentPath || !selectedCatalogTool) return addErrorMessage("Open an assessment before saving a tool configuration.");
  if (selectedToolView === "json") { try { selectedToolConfig = JSON.parse(toolConfigJson.value); } catch { return; } }
  const folder = assessmentDiskPath(`tools/${selectedCatalogTool.id}`); await window.api.mkdir(folder);
  const file = `${folder}${folder.includes("\\") ? "\\" : "/"}config.json`;
  const result = await window.api.writeFile(file, `${JSON.stringify({ tool: selectedCatalogTool.id, preset: selectedToolPreset, ...selectedToolConfig }, null, 2)}\n`);
  if (result?.error) addErrorMessage(result.error); else { toolConfigOverlay.hidden = true; refreshCustomEntries(); }
});
toolRegisterAction?.addEventListener("click", openToolRegister);
toolRegisterClose?.addEventListener("click", closeToolRegister);
toolRegisterCancel?.addEventListener("click", closeToolRegister);
toolRegisterOverlay?.addEventListener("click", (event) => { if (event.target === toolRegisterOverlay) closeToolRegister(); });
toolRegisterDialog?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = {
    id: $("tool-register-id")?.value,
    name: $("tool-register-name")?.value,
    category: $("tool-register-category")?.value,
    executable: $("tool-register-executable")?.value,
    description: $("tool-register-description")?.value,
    command: $("tool-register-command")?.value,
  };
  if (registerCustomTool(value)) { toolRegisterDialog.reset(); closeToolRegister(); }
});
toolRegisterImport?.addEventListener("click", () => toolRegisterFile?.click());
toolRegisterFile?.addEventListener("change", async () => {
  const file = toolRegisterFile.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const manifests = Array.isArray(parsed) ? parsed : [parsed];
    manifests.forEach((manifest) => registerCustomTool(manifest));
    closeToolRegister();
  } catch { addErrorMessage("Custom tool manifest is not valid JSON."); }
  toolRegisterFile.value = "";
});
webcloneBuildAction?.addEventListener("click", buildWebClone);
webclonePreviewAction?.addEventListener("click", () => toggleWebClonePreview(webclonePreviewPane?.hidden !== false));
webclonePreviewClose?.addEventListener("click", () => toggleWebClonePreview(false));
webcloneFilesToggle?.addEventListener("click", () => setWebCloneFilesCollapsed(!webcloneFilesCollapsed));
if (webclonePreviewFrame && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncWebClonePreviewBounds).observe(webclonePreviewFrame);
}
$("app-settings-close")?.addEventListener("click", () => { appSettingsOverlay.hidden = true; });
commandSettingsSave?.addEventListener("click", saveCommandSettings);
commandSettingsAdd?.addEventListener("click", beginCreateCommand);
promptSettingsEditor?.addEventListener("input", () => {
  setPromptModuleValue(selectedPromptModule, promptSettingsEditor.value);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Unsaved prompt changes";
  validatePromptSettings();
});
promptVerifierModel?.addEventListener("input", () => { aiModelSettingsData = normalizeAIModelSettings({ ...aiModelSettingsData, verifierModel: promptVerifierModel.value.trim() }); });
promptRequireQualified?.addEventListener("change", () => { aiModelSettingsData = normalizeAIModelSettings({ ...aiModelSettingsData, requireQualifiedModelForTestAgent: promptRequireQualified.checked }); });
promptUnqualifiedOverride?.addEventListener("change", () => { aiModelSettingsData = normalizeAIModelSettings({ ...aiModelSettingsData, allowUnqualifiedTestAgentDeveloperOverride: promptUnqualifiedOverride.checked }); });
promptSettingsRestore?.addEventListener("click", () => {
  setPromptModuleValue(selectedPromptModule, promptModuleValue(selectedPromptModule, promptDefaults()));
  renderPromptSettings();
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Prompt module restored; save to apply";
});
promptSettingsRestoreAll?.addEventListener("click", () => {
  promptSettingsData = promptDefaults();
  renderPromptSettings();
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Default prompt profile restored; save to apply";
});
promptSettingsExport?.addEventListener("click", async () => {
  const profileValue = { ...promptSettingsData, checksum: globalThis.PointerPromptCompiler?.checksum?.(promptSettingsData) || "" };
  const profile = JSON.stringify(profileValue, null, 2);
  await navigator.clipboard.writeText(profile);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Prompt profile copied to clipboard";
});
promptSettingsImport?.addEventListener("click", async () => {
  if (!promptSettingsImportBuffer) return;
  if (promptSettingsImportBuffer.hidden) {
    promptSettingsImportBuffer.hidden = false;
    promptSettingsImportBuffer.value = "";
    promptSettingsImportBuffer.placeholder = "Paste a Pointer prompt profile, then click Import profile again";
    promptSettingsImportBuffer.focus();
    return;
  }
  try {
    const imported = JSON.parse(promptSettingsImportBuffer.value);
    if (imported.checksum) {
      const { checksum, ...profile } = imported;
      const actual = globalThis.PointerPromptCompiler?.checksum?.(profile);
      if (actual && checksum !== actual) throw new Error("Prompt profile checksum does not match its contents.");
    }
    const validation = globalThis.PointerPromptCompiler?.validate?.(imported);
    if (validation && !validation.ok) throw new Error(validation.errors.join(" "));
    promptSettingsData = normalizePromptSettings(imported);
    promptSettingsImportBuffer.hidden = true;
    renderPromptSettings();
    if (commandSettingsStatus) commandSettingsStatus.textContent = "Prompt profile imported; save to apply";
  } catch (error) {
    if (commandSettingsStatus) commandSettingsStatus.textContent = `Import failed: ${error.message}`;
  }
});
btnNotifications?.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = notificationPanel?.hidden !== false;
  if (notificationPanel) notificationPanel.hidden = !opening;
  btnNotifications.setAttribute("aria-expanded", String(opening));
});
notificationClear?.addEventListener("click", () => setNotifications([]));
document.addEventListener("click", (event) => {
  if (notificationPanel && !notificationPanel.hidden && !notificationPanel.contains(event.target) && !btnNotifications?.contains(event.target)) {
    notificationPanel.hidden = true;
    btnNotifications?.setAttribute("aria-expanded", "false");
  }
});
certificateBrowse?.addEventListener("click", chooseCertificateDirectory);
certificateReset?.addEventListener("click", resetCertificateDirectory);
certificateOpenFolder?.addEventListener("click", async () => {
  const result = await window.api.showCertificateDirectory?.();
  if (result?.error) addErrorMessage(result.error);
});
appSettingsSectionButtons.forEach((button) => button.addEventListener("click", () => setAppSettingsSection(button.dataset.appSettingsSection)));
$("app-settings-dialog")?.addEventListener("submit", (event) => { event.preventDefault(); localStorage.setItem(CUSTOM_COMMANDS_KEY, customCommandsInput.value); if (commandRegistryInput?.value.trim()) { try { JSON.parse(commandRegistryInput.value); localStorage.setItem(COMMAND_REGISTRY_KEY, commandRegistryInput.value); } catch { addErrorMessage("Command registry must be valid JSON."); return; } } else localStorage.removeItem(COMMAND_REGISTRY_KEY); appSettingsOverlay.hidden = true; renderSlashSuggestions(); });
explorerRootToggle?.addEventListener("click", () => {
  if (!rootPath) return;
  setExplorerRootExpanded(!explorerRootExpanded);
});

async function openProject() {
  let folder;
  try {
    folder = await window.api.openFolder();
  } catch (error) {
    setAssessmentUiState("error", { title: "Project Open Failed", message: error?.message || "Could not open the project picker." });
    return false;
  }
  if (!folder) return false;
  return activateProjectWorkspace(folder);
}

async function openFolder() {
  return openProject();
}

async function openFileDialog() {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const fileName = filePath.split(/[/\\]/).pop();
  await openFile(filePath, fileName);
}

function setUiZoom(value) {
  uiZoom = Math.max(0.8, Math.min(1.5, Number(value) || 1));
  document.documentElement.style.setProperty("--ui-zoom", String(uiZoom));
  localStorage.setItem(UI_ZOOM_KEY, String(uiZoom));
}

function showHelpGuide() {
  closeAppMenus();
  if (!helpGuideOverlay) return;
  helpGuideOverlay.hidden = false;
  helpGuideClose?.focus();
}

function closeHelpGuide() {
  if (helpGuideOverlay) helpGuideOverlay.hidden = true;
}

function closeAppMenus() {
  appMenu?.querySelectorAll(".app-menu-dropdown").forEach((panel) => {
    panel.hidden = true;
  });
  appMenu?.querySelectorAll(".app-menu-button.active").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-expanded", "false");
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
  button.setAttribute("aria-expanded", String(opening));
  if (name === "run") updateRunMenuState();
}

setUiZoom(uiZoom);

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
    "new-file",
    "new-folder",
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
    "open-project",
    "open-assessment",
    "open-file",
    "save-file",
    "close-editor",
    "open-folder",
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "select-all",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "show-target",
    "show-security",
    "show-toolbox",
    "show-settings",
    "help-guide",
    "new-chat",
    "about",
    "configure-run",
    "run-code",
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
    case "open-project":
      openProject();
      break;
    case "open-assessment":
      openAssessmentFolder();
      break;
    case "save-file":
      if (resourceCurrentFilePath && resourceViewer && !resourceViewer.hidden) saveResourceChanges();
      else saveActiveTab();
      break;
    case "close-editor":
      if (activeTabPath) closeTab(activeTabPath);
      break;
    case "select-all":
      document.execCommand("selectAll");
      break;
    case "zoom-in":
      setUiZoom(uiZoom + 0.1);
      break;
    case "zoom-out":
      setUiZoom(uiZoom - 0.1);
      break;
    case "zoom-reset":
      setUiZoom(1);
      break;
    case "show-target":
      activateSidebarView("bugbounty");
      break;
    case "show-security":
      showSecurityWorkspace();
      break;
    case "show-toolbox":
      showToolsWorkspace();
      break;
    case "show-settings":
      showAppSettingsWorkspace();
      break;
    case "help-guide":
      showHelpGuide();
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

document.addEventListener("click", (e) => {
  if (appMenu?.contains(e.target)) return;
  closeAppMenus();
});

helpGuideClose?.addEventListener("click", closeHelpGuide);
helpGuideOverlay?.addEventListener("click", (event) => { if (event.target === helpGuideOverlay) closeHelpGuide(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAppMenus();
    if (helpGuideOverlay && !helpGuideOverlay.hidden) closeHelpGuide();
    if (assessmentRepairOverlay && !assessmentRepairOverlay.hidden) closeAssessmentRepairDialog();
  }
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
      detail: "Safe Ask role: analyze, observe, and answer",
      icon: "codicon-comment",
      disabled: streaming,
      run: () => setChatMode("assist:ask"),
    },
    {
      title: "Chat: Plan Mode",
      detail: "Safe Planner role: analyze and produce a plan",
      icon: "codicon-checklist",
      disabled: streaming,
      run: () => setChatMode("assist:planner"),
    },
    {
      title: "Chat: Agent Mode",
      detail: "Safe Agent role: inspect and make safe workspace changes",
      icon: "codicon-tools",
      disabled: streaming,
      run: () => setChatMode("assist:agent"),
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

chatSafetyButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  setChatFamily(chatFamily === "testing" ? "assist" : "testing");
});

chatModeMenu?.addEventListener("click", (e) => {
  const familyButton = e.target.closest("[data-chat-family]");
  if (familyButton) {
    e.stopPropagation();
    setChatFamily(familyButton.dataset.chatFamily);
    return;
  }
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
  if (!requireAuthority("workspaceDelete", "Deleting workspace items")) return;
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
  if (result.settings?.authority) authoritySettingsData = normalizeAuthoritySettings(result.settings.authority);
  syncInterceptorToggleUi(assessmentSettingsCache);
  return result;
}

async function saveAssessmentSettings(settings) {
  if (!assessmentPath) return { error: "No assessment open" };
  const result = await window.api.assessmentWriteSettings({ path: assessmentPath, settings });
  if (result?.error) return result;
  assessmentSettingsCache = result.settings;
  if (result.settings?.authority) {
    authoritySettingsData = normalizeAuthoritySettings(result.settings.authority);
    localStorage.setItem(AUTHORITY_SETTINGS_KEY, JSON.stringify(authoritySettingsData, null, 2));
  }
  syncOpenSettingsTabContent(result.settings);
  syncInterceptorToggleUi(result.settings);
  await configureProxyListener();
  return result;
}

async function toggleInterceptorCapture() {
  if (!requireAuthority("proxyInterception", "Proxy interception")) return;
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
    const result = await window.api.proxyConfigure({ assessmentPath: authorityAllows("proxyInterception") ? assessmentPath : "" });
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
  } else if (phase === "request-complete") {
    setSecurityStatus(`Request body captured for ${payload.url}`);
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
  if (!requireAuthority("workspaceWrite", "Workspace editing")) return;
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
  if (resourceScopeActive) setResourceScopeMode("json");
  else if (resourceChecklistActive) setResourceChecklistMode("json");
  else if (resourceSettingsActive) setResourceSettingsMode("json");
  else setSettingsEditorMode("json");
});
settingsViewUi?.addEventListener("click", () => {
  if (resourceScopeActive) setResourceScopeMode("ui");
  else if (resourceChecklistActive) setResourceChecklistMode("ui");
  else if (resourceSettingsActive) setResourceSettingsMode("ui");
  else setSettingsEditorMode("ui");
});
settingsUIView?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-setting-path]");
  if (!input) return;
  if (resourceSettingsActive) updateResourceSettingFromInput(input);
  else updateSettingFromInput(input);
});
checklistSearch?.addEventListener("input", renderChecklistUI);
checklistStatusFilter?.addEventListener("change", renderChecklistUI);
checklistGroups?.addEventListener("change", async (event) => {
  const index = Number(event.target.dataset.index);
  const check = resourceChecklistData?.checks?.[index];
  if (!check) return;
  if (event.target.classList.contains("checklist-status")) {
    const requestedStatus = event.target.value;
    const issue = checklistStatusIssue(check, requestedStatus) || await checklistEvidenceIssue(check, requestedStatus);
    if (issue) {
      resourceViewerMeta.textContent = issue;
      event.target.value = check.status === "not-started" && resourceChecklistType !== "mitre" ? "not-tested" : (check.status || "not-tested");
      renderChecklistUI();
      return;
    }
    check.status = requestedStatus;
    if (["passed", "failed"].includes(requestedStatus)) check.completedAt = new Date().toISOString();
  }
  if (event.target.classList.contains("checklist-applicability")) check.applicability = event.target.value;
  scheduleChecklistSave();
  if (event.target.classList.contains("checklist-status")) renderChecklistUI();
});
checklistGroups?.addEventListener("input", (event) => {
  const check = resourceChecklistData?.checks?.[Number(event.target.dataset.index)];
  if (!check) return;
  if (event.target.classList.contains("checklist-procedure")) check.procedure = checklistTextList(event.target.value);
  else if (event.target.classList.contains("checklist-evidence")) check.evidence = checklistTextList(event.target.value);
  else if (event.target.classList.contains("checklist-notes")) {
    if (resourceChecklistType === "mitre") check.observations = event.target.value;
    else check.result = event.target.value;
  } else return;
  scheduleChecklistSave();
});
scopeUIForm?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-scope-path]");
  if (!input || !resourceScopeData) return;
  let value = input.value;
  if (input.dataset.scopeType === "boolean") value = input.checked;
  else if (input.dataset.scopeType === "number") value = Number(input.value);
  else if (["array", "object"].includes(input.dataset.scopeType)) {
    try {
      value = JSON.parse(input.value);
      if (input.dataset.scopeType === "array" && !Array.isArray(value)) throw new Error("Expected an array");
      if (input.dataset.scopeType === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("Expected an object");
      input.classList.remove("invalid"); input.removeAttribute("title");
    } catch (error) { input.classList.add("invalid"); input.title = error.message; return; }
  }
  setNestedSettingValue(resourceScopeData, input.dataset.scopePath, value);
  scheduleScopeSave();
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
  const thinkingEnabled = modelThinkingEnabled(settings);
  thinkingToggle.classList.toggle("on", thinkingEnabled);
  thinkingToggle.setAttribute("aria-pressed", String(thinkingEnabled));
  thinkingToggle.title = settings.thinkingConfigured
    ? (thinkingEnabled ? "Thinking enabled" : "Thinking disabled")
    : "Thinking automatic for supported models";
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
  settings.thinking = !modelThinkingEnabled(settings);
  settings.thinkingConfigured = true;
  saveModelSettings();
  const thinkingEnabled = modelThinkingEnabled(settings);
  thinkingToggle.classList.toggle("on", thinkingEnabled);
  thinkingToggle.setAttribute("aria-pressed", String(thinkingEnabled));
  thinkingToggle.title = thinkingEnabled ? "Thinking enabled" : "Thinking disabled";
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
    modeFamily: chatFamily,
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
      if (assistant.appendThinking(token)) {
        assistant.setStatus("Thinking…");
      }
    });

    window.api.onToolCall((calls) => {
      assistant.finalizeThinking();
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
      if (!token) return;
      assistant.finalizeThinking();
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

const CHAT_BOTTOM_THRESHOLD = 8;
let chatAutoFollow = true;

function messagesAreNearBottom() {
  if (!messages) return true;
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= CHAT_BOTTOM_THRESHOLD;
}

function scrollMessages({ force = false } = {}) {
  if (!messages) return;
  if (force) chatAutoFollow = true;
  if (!chatAutoFollow) return;
  messages.scrollTop = messages.scrollHeight;
}

messages.addEventListener("wheel", (event) => {
  // Disable follow immediately, including for a small upward wheel movement
  // that has not yet crossed the bottom-distance threshold.
  if (event.deltaY < 0) chatAutoFollow = false;
}, { passive: true });

messages.addEventListener("scroll", () => {
  chatAutoFollow = messagesAreNearBottom();
}, { passive: true });

function animateStreamDelta(container, delta) {
  if (!container || !String(delta || "").trim()) return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let candidate = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest("button, .md-code-copy, [aria-hidden='true']")) continue;
    candidate = node;
  }
  if (!candidate?.parentNode) return;

  const visibleDelta = String(delta).trimEnd();
  const revealLength = Math.min(candidate.data.length, Math.max(1, visibleDelta.length));
  const suffix = candidate.splitText(Math.max(0, candidate.data.length - revealLength));
  const reveal = document.createElement("span");
  reveal.className = "stream-text-reveal";
  suffix.parentNode.insertBefore(reveal, suffix);
  reveal.appendChild(suffix);
}

let thinkingDisclosureSequence = 0;

function completedThinkingLabel(startedAt) {
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  if (elapsedSeconds < 1) return "Thought for a moment";
  const seconds = Math.max(1, Math.round(elapsedSeconds));
  return `Thought for ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
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
  scrollMessages({ force: true });
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
  scrollMessages({ force: true });
}

function createAssistantTurn() {
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";
  turn.setAttribute("aria-busy", "true");

  let activeThinkingPhase = null;
  let pendingThinkingPrefix = "";

  const contentEl = document.createElement("div");
  contentEl.className = "assistant-reply";
  contentEl.hidden = true;
  turn.appendChild(contentEl);
  messages.appendChild(turn);
  scrollMessages();

  const assistant = {
    turn,
    statusEl: null,
    contentEl,
    rawContent: "",
    rawThinking: "",
    thinkingBlock: null,
    thinkingBody: null,
    thinkingPhases: [],
    setStatus(text) {
      this.turn.dataset.activity = String(text || "");
      this.turn.setAttribute("aria-busy", "true");
    },
    clearStatus() {
      delete this.turn.dataset.activity;
      this.turn.setAttribute("aria-busy", "false");
    },
    displayContent() {
      const streaming = this.contentEl.classList.contains("streaming");
      return ToolParser.cleanReplyForDisplay(this.rawContent, { streaming });
    },
    syncDisplay({ animateToken = "" } = {}) {
      const text = this.displayContent();
      if (text) {
        this.clearStatus();
        this.contentEl.hidden = false;
        renderMarkdown(
          this.contentEl,
          text,
          { streaming: this.contentEl.classList.contains("streaming") },
        );
        if (animateToken) animateStreamDelta(this.contentEl, animateToken);
      }
      scrollMessages();
    },
    appendContent(token) {
      this.rawContent += token;
      this.syncDisplay({ animateToken: token });
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
      const statusActive = this.turn.getAttribute("aria-busy") === "true";
      const hasThinking = this.thinkingBlock && !this.thinkingBlock.hidden && this.rawThinking.trim();
      const hasTools = this.turn.querySelector(".tool-card");
      if (!hasContent && !statusActive && !hasThinking && !hasTools) {
        this.turn.remove();
      }
    },
    appendThinking(text) {
      const delta = String(text || "");
      if (!delta) return false;

      this.rawThinking += delta;
      if (!activeThinkingPhase) {
        pendingThinkingPrefix += delta;
        // Retain leading whitespace, but do not flash a blank disclosure.
        if (!pendingThinkingPrefix.trim()) return false;

        const block = document.createElement("section");
        block.className = "thinking-block collapsed is-thinking";
        block.dataset.userInteracted = "false";

        const bodyId = `thinking-body-${++thinkingDisclosureSequence}`;
        const header = document.createElement("button");
        header.type = "button";
        header.className = "thinking-header";
        header.setAttribute("aria-expanded", "false");
        header.setAttribute("aria-controls", bodyId);
        header.innerHTML = `
          <span class="codicon codicon-chevron-right thinking-chevron" aria-hidden="true"></span>
          <span class="thinking-title">Thinking...</span>
        `;

        const body = document.createElement("div");
        body.id = bodyId;
        body.className = "thinking-body";
        body.setAttribute("role", "region");
        body.setAttribute("aria-label", "Model reasoning");

        block.appendChild(header);
        block.appendChild(body);
        this.turn.insertBefore(block, this.contentEl);

        activeThinkingPhase = {
          block,
          body,
          header,
          title: header.querySelector(".thinking-title"),
          startedAt: Date.now(),
          text: pendingThinkingPrefix,
        };
        pendingThinkingPrefix = "";
        this.thinkingBlock = block;
        this.thinkingBody = body;
        this.thinkingPhases.push(activeThinkingPhase);
      } else {
        activeThinkingPhase.text += delta;
      }

      renderMarkdown(activeThinkingPhase.body, activeThinkingPhase.text, { streaming: true });
      animateStreamDelta(activeThinkingPhase.body, delta);
      // Keep the compact live tail pinned to the newest reasoning token.
      if (activeThinkingPhase.block.classList.contains("collapsed")) {
        activeThinkingPhase.body.scrollTop = activeThinkingPhase.body.scrollHeight;
      }
      scrollMessages();
      return true;
    },
    finalizeThinking() {
      if (!activeThinkingPhase) {
        pendingThinkingPrefix = "";
        return false;
      }
      const phase = activeThinkingPhase;
      activeThinkingPhase = null;
      phase.block.classList.remove("is-thinking");
      phase.title.textContent = completedThinkingLabel(phase.startedAt);
      renderMarkdown(phase.body, phase.text);

      if (phase.block.dataset.userInteracted !== "true") {
        phase.block.classList.add("collapsed");
        phase.header.setAttribute("aria-expanded", "false");
        const chevron = phase.header.querySelector(".thinking-chevron");
        chevron?.classList.add("codicon-chevron-right");
        chevron?.classList.remove("codicon-chevron-up");
      }
      return true;
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
  const assistant = createAssistantTurn();
  assistant.contentEl.classList.add("streaming");

  const activeFile = getActiveFileContext();
  const activeProfile = CHAT_PROFILE_DEFS[chatMode] || {};
  const editContext = {
    isEditRequest: activeProfile.capability === "workspace" && ToolParser.isEditRequest(text),
    targetFile: ToolParser.inferEditTarget(text, activeFile, dirMapCache),
    activeFile,
    userMessage: text,
    dirMap: dirMapCache,
    mode: activeProfile.legacyMode || "agent",
    modeFamily: activeProfile.family || "assist",
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

const BUILTIN_SLASH_COMMANDS = [
  { name: "/passive", description: "Run passive reconnaissance", prompt: "Perform a passive reconnaissance workflow using only public, non-intrusive sources. Review scope first, use pen_context.md, execute appropriate available tools, and record useful findings under recon/passive-recon.json." },
  { name: "/active", description: "Run authorized active reconnaissance (httpx, nmap, ffuf)", prompt: "Plan and perform authorized active reconnaissance. Verify the authorization gate and scope before sending traffic, execute appropriate available tools with conservative rates, and save evidence and tool results." },
  { name: "/endpoint", description: "Discover and organize endpoints", prompt: "Discover and organize application endpoints, parameters, methods, and authentication requirements using appropriate available tools; update enumeration/endpoints.json with evidence." },
  { name: "/scope", description: "Review scope and authorization", prompt: "Review the assessment scope, exclusions, authorization, and rules of engagement. Summarize any blockers before testing." },
  { name: "/report", description: "Build the assessment report", prompt: "Synthesize the current assessment evidence into the security report, preserving traceability to findings and request-response evidence." },
  { name: "/map", description: "Inventory application relationships", prompt: "Prepare the current assessment data for the future application Map feature. For now, inventory hosts, pages, endpoints, scripts, and relationships without inventing data." },
  { name: "/webclone", description: "Prepare a safe WebClone inventory", prompt: "Prepare a safe WebClone plan for the authorized target. For now, inventory cloneable public assets and dependencies; do not execute cloning." },
  { name: "/settings", description: "Edit custom slash commands", prompt: "" },
];

function availableSlashCommands() {
  const commands = [...BUILTIN_SLASH_COMMANDS];
  for (const line of (localStorage.getItem(CUSTOM_COMMANDS_KEY) || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(\/[\w-]+)\s*=\s*(.+)$/);
    if (match) commands.push({ name: match[1].toLowerCase(), description: "Custom command", prompt: match[2] });
  }
  return commands.filter((command, index, all) => all.findIndex((item) => item.name === command.name) === index);
}

function closeSlashSuggestions() {
  if (slashCommandSuggestions) slashCommandSuggestions.hidden = true;
  slashSuggestionItems = [];
  slashSuggestionIndex = 0;
}

function chooseSlashSuggestion(index = slashSuggestionIndex) {
  const command = slashSuggestionItems[index];
  if (!command) return false;
  const current = chatInput.value;
  const argumentStart = current.search(/\s/);
  const argumentsText = argumentStart >= 0 ? current.slice(argumentStart) : " ";
  chatInput.value = `${command.name}${argumentsText}`;
  closeSlashSuggestions();
  resizeChatInput(); updateSendBtn(); chatInput.focus();
  chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
  return true;
}

function renderSlashSuggestions() {
  if (!slashCommandSuggestions || streaming) return closeSlashSuggestions();
  const value = chatInput.value;
  if (!/^\/[\w-]*$/.test(value)) return closeSlashSuggestions();
  const query = value.toLowerCase();
  slashSuggestionItems = availableSlashCommands()
    .map((command) => ({ command, score: command.name.startsWith(query) ? 0 : command.name.includes(query.slice(1)) || command.description.toLowerCase().includes(query.slice(1)) ? 1 : 2 }))
    .filter((item) => item.score < 2)
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
    .slice(0, 3)
    .map((item) => item.command);
  if (!slashSuggestionItems.length) return closeSlashSuggestions();
  slashSuggestionIndex = Math.min(slashSuggestionIndex, slashSuggestionItems.length - 1);
  slashCommandSuggestions.innerHTML = "";
  slashSuggestionItems.forEach((command, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `slash-command-option${index === slashSuggestionIndex ? " selected" : ""}`; button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(index === slashSuggestionIndex));
    button.innerHTML = `<span class="slash-command-name">${command.name}</span><span class="slash-command-description">${command.description}</span>`;
    button.addEventListener("mousedown", (event) => { event.preventDefault(); chooseSlashSuggestion(index); });
    slashCommandSuggestions.appendChild(button);
  });
  slashCommandSuggestions.hidden = false;
}

function expandSlashCommand(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("/")) return text;
  const [command, ...rest] = text.split(/\s+/); const args = rest.join(" ");
  if (command === "/settings") { openAppSettings(); return ""; }
  const override = slashCommandOverrides()[command.toLowerCase()];
  const configuredAiFields = override?.role === "ai" ? [
    override.aim && `Aim: ${override.aim}`,
    override.description && `Description: ${override.description}`,
    override.prompt && `Instructions: ${override.prompt}`,
    override.expectedOutput && `Expected output: ${override.expectedOutput}`,
    override.constraints && `Safety constraints: ${override.constraints}`,
  ].filter(Boolean).join("\n\n") : "";
  const expansion = configuredAiFields || override?.prompt || availableSlashCommands().find((item) => item.name === command.toLowerCase())?.prompt;
  return expansion ? `${expansion}${args ? `\n\nUser parameters: ${args}` : ""}` : text;
}

function slashCommandOverrides() {
  const raw = localStorage.getItem(COMMAND_REGISTRY_KEY) || "";
  let parsed = {};
  if (raw.trim()) { try { parsed = JSON.parse(raw); } catch { parsed = {}; } }
  if (!parsed || typeof parsed !== "object") parsed = {};
  for (const line of (localStorage.getItem(CUSTOM_COMMANDS_KEY) || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(\/[\w-]+)\s*=\s*(.+)$/);
    if (match && !parsed[match[1].toLowerCase()]) parsed[match[1].toLowerCase()] = { role: "ai", prompt: match[2] };
  }
  return parsed;
}

async function runStaticSlashCommand(rawCommand) {
  if (rawCommand.trim().toLowerCase() === "/settings") return false;
  const parsed = await window.api.parseSlashCommand({ command: rawCommand, overrides: slashCommandOverrides() });
  if (!parsed?.ok) { addErrorMessage(parsed?.error || "Could not parse slash command."); return true; }
  if (parsed.role !== "static") return false;
  const authority = await loadAuthoritySettings();
  const safeStaticTools = new Set(["httpx", "nmap", "ffuf", "gobuster", "dirb", "katana", "nikto", "sqlmap", "testssl", "gowitness", "custom_script"]);
  const parsedTools = Array.isArray(parsed.tools) ? parsed.tools.map((tool) => String(tool).toLowerCase()) : [];
  const requiredPermission = parsed.command === "/passive" ? "passiveRecon" : "activeRecon";
  if (!authorityAllows(requiredPermission)) { addErrorMessage(`${parsed.command} is disabled in Pointer Settings → Authority.`); return true; }
  if (parsedTools.includes("custom_script") && !authorityAllows("customScripts")) { addErrorMessage("Custom scripts are disabled in Pointer Settings → Authority."); return true; }
  if (parsed.command !== "/passive" && !authorityAllows("automatedScanning")) { addErrorMessage("Automated scanning is disabled in Pointer Settings → Authority."); return true; }
  if (chatFamily === "assist" && (parsed.command !== "/passive" || parsedTools.some((tool) => safeStaticTools.has(tool)))) {
    addErrorMessage("Safe mode blocks sensitive static commands. Switch to Testing mode before running active recon or custom scripts.");
    return true;
  }
  if (authority.superMode === "ask" && parsed.command !== "/passive" && !window.confirm(`Approve ${parsed.command} for this authorized target?`)) return true;
  addUserMessage(rawCommand);
  chatHistory.push({ role: "user", content: rawCommand });
  const commandPayload = { assessment: assessmentPath, command: rawCommand, modeFamily: chatFamily, mode: chatMode, authority: authoritySettingsData, overrides: slashCommandOverrides() };
  let result = await window.api.runSlashCommand(commandPayload);
  if (result?.policyDecision?.requiresApproval && result?.approvalProposal) {
    const proposal = result.approvalProposal;
    const approved = window.confirm(`Approve this one slash-command action?\n\nTarget: ${proposal.target}\nCapability: ${proposal.capability}\nRisk: ${proposal.risk}\n\n${result.error}`);
    if (approved) result = await window.api.runSlashCommand({ ...commandPayload, approvalGranted: proposal });
  }
  const assistant = createAssistantTurn();
  const message = result?.ok
    ? `${parsed.command} completed for ${result.target}.\n\nNormalized results: ${JSON.stringify(result.normalized || {})}\nOutput: ${result.output || "assessment output"}\n\n${(result.results || []).map((item) => `- ${item.tool}: ${item.status || (item.exitCode === 0 ? "completed" : `exit ${item.exitCode}`)}${item.error ? ` (${item.error})` : ""}`).join("\n")}`
    : `/${String(parsed.command || "command").replace(/^\//, "")} failed: ${result?.error || "Unknown command error"}`;
  assistant.rawContent = message;
  assistant.finalizeContent();
  chatHistory.push({ role: "assistant", content: message });
  syncActiveChatSession();
  return true;
}

async function sendMessageWithAgentRuntime() {
  let text = chatInput.value.trim();
  if (!text || streaming) return;
  if (text.startsWith("/")) {
    const handled = await runStaticSlashCommand(text);
    if (handled) { chatInput.value = ""; resetChatInput(); closeSlashSuggestions(); return; }
  }
  text = expandSlashCommand(text);
  if (!text) return;
  closeSlashSuggestions();

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
  const assistant = createAssistantTurn();
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
      if (assistant.appendThinking(payload.delta || "")) {
        assistant.setStatus("Thinking...");
      }
      return;
    }

    if (payload.type === "content") {
      const delta = String(payload.delta || "");
      if (!delta) return;
      assistant.finalizeThinking();
      if (!contentStarted) {
        contentStarted = true;
        assistant.clearStatus();
      }
      assistant.appendContent(delta);
      activeStreamContent = assistant.rawContent;
      lastAgentText = assistant.rawContent;
      updateContextUsage();
      return;
    }

    if (payload.type === "run_state") {
      const state = payload.state || {};
      const phase = String(state.phase || "preflight").replace(/-/g, " ");
      assistant.setStatus(`${phase} · ${state.completionGate || "evaluating gate"}`);
      setAgentStatus(`${modeLabel()} · ${phase}`);
      return;
    }

    if (payload.type === "model_qualification") {
      const qualification = payload.qualification || {};
      assistant.setStatus(qualification.qualified ? `Model qualified (${Math.round((qualification.score || 0) * 100)}%)` : "Model is unqualified for Test Agent");
      return;
    }

    if (payload.type === "action_policy") {
      const decision = payload.decision || {};
      const target = payload.tool?.file || payload.tool?.query || payload.tool?.url || payload.tool?.command || "workspace";
      assistant.setStatus(decision.allowed ? `Approved ${decision.risk || "action"}: ${target}` : `Blocked: ${decision.reason || "policy"}`);
      return;
    }

    if (payload.type === "approval_required") {
      const details = [
        `Tool: ${payload.tool || "unknown"}`,
        `Target: ${payload.target || "workspace"}`,
        `Capability: ${payload.capability || "unknown"}`,
        `Risk: ${payload.risk || "unknown"}`,
        "",
        payload.reason || "This action requires operator approval.",
      ].join("\n");
      const approved = window.confirm(`Approve this one action?\n\n${details}`);
      await window.api.agentResolveApproval({ actionId: payload.actionId, approved });
      assistant.setStatus(approved ? "Action-specific approval granted" : "Action denied by operator");
      return;
    }

    if (payload.type === "tool_call") {
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      assistant.finalizeThinking();
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
      assistant.finalizeThinking();
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

  const activeAuthority = await loadAuthoritySettings();
  const authorityApproval = activeAuthority.superMode === "full" || activeAuthority.superMode === "approve" || exploitApprovalGranted;
  let unsubscribeAgentEvent = () => {};

  try {
    unsubscribeAgentEvent = window.api.onAgentEvent((payload) => {
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
      modeFamily: chatFamily,
      approvalGranted: authorityApproval,
      authority: activeAuthority,
      chatHistory,
      contextSummary: activeChatSession()?.contextSummary || "",
      dirMap: dirMapCache,
      activeFile,
      extraFiles: contextFilesCache,
      userMessage: text,
    });

    // The event stream is authoritative for live rendering. The completed
    // result is a lossless fallback if an Electron event was missed while the
    // renderer was busy processing a large tool result.
    const completedThinking = String(result?.thinking || "");
    if (completedThinking && completedThinking !== assistant.rawThinking) {
      const missingThinking = completedThinking.startsWith(assistant.rawThinking)
        ? completedThinking.slice(assistant.rawThinking.length)
        : (assistant.rawThinking ? `\n\n${completedThinking}` : completedThinking);
      if (missingThinking) assistant.appendThinking(missingThinking);
    }

    assistant.contentEl.classList.remove("streaming");
    assistant.finalizeThinking();

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

    const claimBadges = [];
    for (const claim of Array.isArray(result?.claims) ? result.claims : []) {
      if (claim?.state) claimBadges.push([claim.state, `${claim.state[0].toUpperCase()}${claim.state.slice(1)}${claim.evidenceIds?.length ? ` · ${claim.evidenceIds.length} evidence` : ""}`]);
    }
    if (!claimBadges.length && result?.runState?.evidenceIds?.length) claimBadges.push(["observed", `Observed · ${result.runState.evidenceIds.length} evidence`]);
    if (result?.runState?.hypothesisId) claimBadges.push(["hypothesis", "Hypothesis"]);
    if (result?.runState?.verification?.status === "passed") claimBadges.push(["verified", "Verified"]);
    if (result?.runState?.status === "inconclusive" || result?.claimWarnings?.length) claimBadges.push(["inconclusive", "Inconclusive"]);
    if (claimBadges.length) {
      const strip = document.createElement("div");
      strip.className = "claim-state-strip";
      strip.innerHTML = claimBadges.map(([state, label]) => `<span class="claim-state ${state}">${escapeHtml(label)}</span>`).join("");
      assistant.contentEl.before(strip);
    }
    if (result?.operatorFeedback) {
      const feedback = result.operatorFeedback;
      const panel = document.createElement("details");
      panel.className = "operator-feedback";
      panel.innerHTML = `<summary>Run evidence and policy</summary><dl><dt>Known</dt><dd>${escapeHtml((feedback.known || []).join(" ") || "None")}</dd><dt>Unknown</dt><dd>${escapeHtml((feedback.unknown || []).join(" ") || "None")}</dd><dt>Hypothesis</dt><dd>${escapeHtml(feedback.hypothesis || "None")}</dd><dt>Action</dt><dd>${escapeHtml(feedback.action || "None")}</dd><dt>Policy</dt><dd>${escapeHtml(`${feedback.policy?.code || "NOT_EVALUATED"}: ${feedback.policy?.reason || ""}`)}</dd><dt>Evidence</dt><dd>${escapeHtml((feedback.evidence || []).join(", ") || "None")}</dd><dt>Verification</dt><dd>${escapeHtml(`${feedback.verification?.status || "not-run"}${feedback.verification?.details ? ` · ${feedback.verification.details}` : ""}`)}</dd><dt>Limitations</dt><dd>${escapeHtml((feedback.limitations || []).map((item) => typeof item === "string" ? item : item.phase || JSON.stringify(item)).join(" ") || "None")}</dd><dt>Next step</dt><dd>${escapeHtml(feedback.nextStep || "Review the run record.")}</dd></dl>`;
      assistant.contentEl.before(panel);
    }

    assistant.finalizeContent();
    assistant.pruneIfEmpty();
    syncActiveChatSession();
  } finally {
    unsubscribeAgentEvent();
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
  flushChatSessionsBeforeClose();
  window.api.windowClose?.();
});

window.addEventListener("beforeunload", flushChatSessionsBeforeClose);

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
  if (!slashCommandSuggestions?.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    const direction = e.key === "ArrowDown" ? 1 : -1;
    slashSuggestionIndex = (slashSuggestionIndex + direction + slashSuggestionItems.length) % slashSuggestionItems.length;
    renderSlashSuggestions();
    return;
  }
  if (!slashCommandSuggestions?.hidden && (e.key === "Tab" || e.key === "Enter")) {
    e.preventDefault(); chooseSlashSuggestion(); return;
  }
  if (!slashCommandSuggestions?.hidden && e.key === "Escape") {
    e.preventDefault(); closeSlashSuggestions(); return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessageWithAgentRuntime();
  }
});

document.addEventListener("keydown", async (e) => {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  if (!e.shiftKey && (key === "=" || key === "+")) {
    e.preventDefault();
    setUiZoom(uiZoom + 0.1);
    return;
  }
  if (!e.shiftKey && key === "-") {
    e.preventDefault();
    setUiZoom(uiZoom - 0.1);
    return;
  }
  if (!e.shiftKey && key === "0") {
    e.preventDefault();
    setUiZoom(1);
    return;
  }
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
  renderSlashSuggestions();
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
      block.dataset.userInteracted = "true";
      block.classList.toggle("collapsed");
      const collapsed = block.classList.contains("collapsed");
      thinkingHeader.setAttribute("aria-expanded", String(!collapsed));
      const chevron = thinkingHeader.querySelector(".thinking-chevron");
      chevron?.classList.toggle("codicon-chevron-right", collapsed);
      chevron?.classList.toggle("codicon-chevron-up", !collapsed);
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

function makeDraggable(handle, onMove, { onStart, onEnd } = {}) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    let latestEvent = null;
    let animationFrame = 0;
    const resizeClass = handle.classList.contains("sash-h") ? "resizing-row" : "resizing-column";

    const flush = () => {
      animationFrame = 0;
      if (!latestEvent) return;
      const next = latestEvent;
      latestEvent = null;
      onMove(next);
    };
    const move = (next) => {
      if (next.pointerId !== pointerId) return;
      latestEvent = next;
      if (!animationFrame) animationFrame = requestAnimationFrame(flush);
    };
    const finish = (next) => {
      if (next.pointerId !== pointerId) return;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (latestEvent) flush();
      handle.classList.remove("dragging");
      document.documentElement.classList.remove("panel-resizing", resizeClass);
      handle.releasePointerCapture?.(pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      onEnd?.(next);
    };

    handle.classList.add("dragging");
    document.documentElement.classList.add("panel-resizing", resizeClass);
    handle.setPointerCapture?.(pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    onStart?.(event);
  });
}

makeDraggable(sidebarResize, (e) => {
  const min = 200, max = 360;
  const left = sidebar.getBoundingClientRect().left;
  sidebar.style.width = Math.min(max, Math.max(min, e.clientX - left)) + "px";
  sidebarResize.setAttribute("aria-valuenow", String(Math.round(sidebar.offsetWidth)));
});

makeDraggable(chatResize, (e) => {
  const min = 300, max = 520;
  const w = window.innerWidth - e.clientX;
  chatPane.style.width = Math.min(max, Math.max(min, w)) + "px";
  chatResize.setAttribute("aria-valuenow", String(Math.round(chatPane.offsetWidth)));
  resizeChatInput();
});

makeDraggable(securityWorkbenchResize, (e) => {
  if (!securityHistoryPanel || securityHistoryPanel.hidden) return;
  const body = securityHistoryPanel.parentElement;
  if (!body) return;
  const bodyRect = body.getBoundingClientRect();
  const relY = e.clientY - bodyRect.top;
  // clamp so neither panel shrinks below its minimum
  const maxHistoryH = bodyRect.height - WORKBENCH_TOOL_MIN_H - 4; // 4px = sash height
  const newH = Math.min(maxHistoryH, Math.max(WORKBENCH_MIN_H, relY));
  securityHistoryPanel.style.height = `${newH}px`;
  securityWorkbenchResize.setAttribute("aria-valuenow", String(Math.round(newH)));
});

securityWorkbenchResize?.addEventListener("dblclick", () => {
  // reset history panel to its CSS default
  if (securityHistoryPanel) securityHistoryPanel.style.height = "";
});

makeDraggable(securityExchangeSash, (e) => {
  if (!securityExchangeEl) return;
  const rect = securityExchangeEl.getBoundingClientRect();
  const sashW = 8; // matches the fixed 8px grid column
  const totalW = rect.width - sashW;
  if (totalW <= 0) return;
  const MIN_PANE = 120;
  const rawLeft = e.clientX - rect.left;
  const clampedLeft = Math.min(totalW - MIN_PANE, Math.max(MIN_PANE, rawLeft));
  const pct = (clampedLeft / totalW) * 100;
  securityExchangeEl.style.setProperty("--security-exchange-split", `${pct.toFixed(2)}%`);
});

securityExchangeSash?.addEventListener("dblclick", () => {
  securityExchangeEl?.style.setProperty("--security-exchange-split", "50%");
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

function setTerminalCollapsed(collapsed, { createIfMissing = true } = {}) {
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
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.flex = "none";
    const editorH = Math.max(EDITOR_MIN_HEIGHT, availableH - terminalSavedHeight);
    editorPane.style.height = `${editorH}px`;
    requestAnimationFrame(() => {
      EditorManager.layout();
      TerminalManager.fitActive();
    });
    if (createIfMissing && !TerminalManager.hasSessions()) {
      TerminalManager.ensureTerminal();
    }
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
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - terminalSavedHeight)}px`;
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

globalThis.expandTerminalPanel = ({ createIfMissing = true } = {}) => {
  if (terminalCollapsed) setTerminalCollapsed(false, { createIfMissing });
  else if (createIfMissing && !TerminalManager.hasSessions()) TerminalManager.ensureTerminal();
  return true;
};

globalThis.toggleTerminalPanel = () => {
  const nextCollapsed = !terminalCollapsed;
  setTerminalCollapsed(nextCollapsed);
  return !nextCollapsed;
};

globalThis.onTerminalSessionStateChange = ({ count }) => {
  if (count === 0 && !terminalCollapsed) setTerminalCollapsed(true, { createIfMissing: false });
};

let terminalDragShouldCollapse = false;
let terminalDragLayoutFrame = 0;
let terminalHeightBeforeDrag = terminalSavedHeight;

function scheduleTerminalDragLayout() {
  if (terminalDragLayoutFrame) return;
  terminalDragLayoutFrame = requestAnimationFrame(() => {
    terminalDragLayoutFrame = 0;
    EditorManager.layout();
  });
}

makeDraggable(terminalResize, (e) => {
  if (terminalMaximized) setTerminalMaximized(false);
  const rect = centerPanel.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const sashH = terminalResize.offsetHeight || 0;
  const availableH = Math.max(0, rect.height - sashH);
  const requestedTerminalH = availableH - relY;
  terminalDragShouldCollapse = requestedTerminalH <= TERMINAL_HEADER_H + 8;

  if (terminalCollapsed) {
    setTerminalCollapsed(false);
  }

  const editorH = Math.min(
    availableH - TERMINAL_MIN_EXPANDED,
    Math.max(EDITOR_MIN_HEIGHT, relY),
  );
  terminalSavedHeight = availableH - editorH;

  editorPane.style.height = `${editorH}px`;
  editorPane.style.flex = "none";
  terminalPane.style.height = `${terminalSavedHeight}px`;
  terminalPane.style.flex = "none";

  scheduleTerminalDragLayout();
}, {
  onStart() {
    terminalDragShouldCollapse = false;
    terminalHeightBeforeDrag = terminalSavedHeight;
    centerPanel.classList.add("terminal-resizing");
  },
  onEnd() {
    centerPanel.classList.remove("terminal-resizing");
    if (terminalDragLayoutFrame) cancelAnimationFrame(terminalDragLayoutFrame);
    terminalDragLayoutFrame = 0;
    if (terminalDragShouldCollapse) {
      terminalSavedHeight = terminalHeightBeforeDrag;
      setTerminalCollapsed(true);
      return;
    }
    requestAnimationFrame(() => {
      EditorManager.layout();
      TerminalManager.fitActive();
    });
  },
});

function applyTerminalHeight(value) {
  if (terminalMaximized) setTerminalMaximized(false);
  if (terminalCollapsed) setTerminalCollapsed(false);
  const centerH = centerPanel.getBoundingClientRect().height;
  const sashH = terminalResize.offsetHeight || 0;
  const availableH = Math.max(0, centerH - sashH);
  terminalSavedHeight = Math.max(96, Math.min(availableH - EDITOR_MIN_HEIGHT, value));
  terminalPane.style.height = `${terminalSavedHeight}px`;
  terminalPane.style.flex = "none";
  editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - terminalSavedHeight)}px`;
  editorPane.style.flex = "none";
  terminalResize.setAttribute("aria-valuenow", String(Math.round(terminalSavedHeight)));
  requestAnimationFrame(() => { EditorManager.layout(); TerminalManager.fitActive(); });
}

terminalResize.addEventListener("dblclick", () => applyTerminalHeight(240));
terminalResize.addEventListener("keydown", (event) => {
  const centerH = centerPanel.getBoundingClientRect().height;
  const maximum = Math.max(96, centerH - (terminalResize.offsetHeight || 0) - EDITOR_MIN_HEIGHT);
  let next = terminalCollapsed ? 96 : terminalPane.offsetHeight;
  if (event.key === "ArrowUp") next += 8;
  else if (event.key === "ArrowDown") next -= 8;
  else if (event.key === "Home") next = 96;
  else if (event.key === "End") next = maximum;
  else return;
  event.preventDefault();
  applyTerminalHeight(next);
});

function installSeparatorKeyboard(handle, { orientation, minimum, maximum, read, write, step = 8, reset }) {
  if (!handle) return;
  const sync = () => handle.setAttribute("aria-valuenow", String(Math.round(read())));
  sync();
  handle.addEventListener("keydown", (event) => {
    const decrement = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increment = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let next = read();
    if (event.key === decrement) next -= step;
    else if (event.key === increment) next += step;
    else if (event.key === "Home") next = minimum;
    else if (event.key === "End") next = maximum();
    else return;
    event.preventDefault();
    write(Math.max(minimum, Math.min(maximum(), next)));
    sync();
  });
  handle.addEventListener("dblclick", () => {
    reset?.();
    requestAnimationFrame(sync);
  });
}

installSeparatorKeyboard(sidebarResize, {
  orientation: "vertical", minimum: 200, maximum: () => 360,
  read: () => sidebar.offsetWidth,
  write: (value) => { sidebar.style.width = `${value}px`; },
  reset: () => { sidebar.style.width = "240px"; },
});
installSeparatorKeyboard(chatResize, {
  orientation: "vertical", minimum: 300, maximum: () => 520,
  read: () => chatPane.offsetWidth,
  write: (value) => { chatPane.style.width = `${value}px`; resizeChatInput(); },
  reset: () => { chatPane.style.width = "400px"; resizeChatInput(); },
});
installSeparatorKeyboard(securityWorkbenchResize, {
  orientation: "horizontal", minimum: WORKBENCH_MIN_H,
  maximum: () => Math.max(WORKBENCH_MIN_H, (securityHistoryPanel?.parentElement?.clientHeight || 0) - WORKBENCH_TOOL_MIN_H - 4),
  read: () => securityHistoryPanel?.offsetHeight || WORKBENCH_MIN_H,
  write: (value) => { if (securityHistoryPanel) securityHistoryPanel.style.height = `${value}px`; },
  reset: () => { if (securityHistoryPanel) securityHistoryPanel.style.height = ""; },
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
setTerminalCollapsed(!TerminalManager.hasSessions(), { createIfMissing: false });
chatInput.focus();
restoreLastWorkspace();
