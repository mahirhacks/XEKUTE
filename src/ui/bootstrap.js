/* ── Renderer (runs in the browser context via contextBridge) ── */

// ── DOM refs ──────────────────────────────────────────────────────────────────
import "./core/runtime-modules.js";
import { createBrowserWorkspace } from "./features/browser/browser-workspace.js";
import { openImageLightbox } from "./features/chat/image-lightbox.js";
import { createChatScroller } from "./features/chat/chat-scroll.js";
import { toggleWorkFold } from "./features/chat/chat-work-fold.js";
import { createLiveInputController, bindLiveInputComposer } from "./features/chat/live-input.js";
import { appState } from "./core/app-state.js";
import {
  $, btnNewFile, btnNewFolder, explorerRootToggle, btnOpenFolder, fileTree, activityExplorer,
  activitySearch, activityRun, activityBugBounty, activitySecurity, activityTerminal,
  activityChat, activitySettings, btnSidebarMore, btnCreateProjectHeader, sidebarViewTitle,
  explorerSidebarView, btnCreateProjectSidebar, btnOpenProjectSidebar, bugBountySidebarView,
  bugBountyTree, btnBugBountyMore, btnCreateProject, btnCreateAssessment, btnOpenAssessment,
  bugBountyRepair, assessmentRepairOverlay, assessmentRepairClose, assessmentRepairCancel,
  assessmentRepairConfirm, editorTabBar, editorTabContextMenu, editorPathBar, editorPathLabel,
  editorBody, editorEmpty, editorView, editorError, monacoContainer, markdownPreview,
  settingsEditorToolbar, settingsUIView, settingsViewJson, settingsViewUi, btnShowProxyCa,
  messages, chatInput, sendBtn, attachImageBtn, attachImageInput, chatModeToggle, chatModeButton,
  chatModeMenu, appMenu, helpGuideOverlay, helpGuideClose, commandCenter, quickOverlay,
  quickPanel, quickIcon, quickInput, quickMeta, quickResults, quickSearchHelp, quickSearchAssist,
  quickSearchSuggestions, quickSearchChips, chatHeader, btnTopFileTree, btnTopTerminal,
  btnTopChat, btnTopSettings, btnNotifications, notificationCount, notificationPanel,
  notificationList, notificationClear, btnWindowMinimize, btnWindowMaximize, btnWindowClose,
  chatSessionSelect, btnChatNew, btnChatDelete, btnChatHistory, chatHistoryPopover,
  chatHistoryBody, chatHistorySearch, btnChatMore, btnChatCollapse, contextUsageBtn,
  contextUsagePopover, inputBar, memorySaveBanner, composerTaskListEl, slashCommandSuggestions,
  contextUsageClose, contextUsageMenu, contextWindowTrigger, contextBlocksTrigger,
  contextBlocksPanel, contextBlocksList, modelPicker, authorityPicker, authorityMenu, modelMenu,
  modelControlsMenu, modelContextTrigger, modelEffortTrigger, modelBrowseTrigger, modelSearch,
  modelAddBtn, modelCustom, modelCustomAdd, modelEditMenu, thinkingToggle, sidebar, sidebarResize,
  chatPane, chatResize, terminalPane, terminalResize, centerPanel, btnTerminalMaximize,
  btnTerminalClose, editorPane, resourceViewer, resourceViewerMeta, resourceViewerContent,
  resourceLineNumbers, resourceViewerSave, resourceViewerCopy, resourceViewerActions,
  appSettingsWorkspace, appSettingsSearch, generalStatusBarToggle, generalUpdatesToggle,
  generalCurrentVersion, updateToast, updateToastVersion, updateToastInstall, updateToastIgnore,
  projectSettingsForm, projectSettingsName, projectSettingsCreate, projectSettingsOpen,
  projectSettingsNav, projectSettingsNavButtons, commandSettingsStatus, mcpSettingsTabs,
  kaliAccessForm, kaliAccessEnabled, kaliAccessFields, kaliAccessKey, kaliAccessAcceptHostKey,
  kaliAccessKeyBrowse, kaliAccessOpenMcp, kaliAccessTest, guidanceScopeTabs, guidanceNew,
  guidanceEmptyNew, guidanceImport, llmProvider, openRouterBaseUrl, openRouterApiKey,
  llmSettingsTest, llmSettingsStatus, llmOpenRouterKeyToggle, llmOpenRouterBaseToggle,
  llmOllamaEnableToggle, llmOllamaEndpointToggle, modelsSettingsSearch, modelsSettingsRefresh,
  modelsViewAllBtn, modelsExploreSubagent, ollamaHostInput, ollamaHostTest, ollamaHostReset,
  certificateBrowse, certificateOpenFolder, certificateReset, identityRefresh, identityCreate,
  identityList, identityImport, projectAuthSource, credentialCreate, credentialList,
  engagementAccountList, engagementAccountAdd, appSettingsSectionButtons, checklistSearch,
  checklistStatusFilter, checklistGroups, scopeUIForm, assessmentModuleView,
  assessmentModuleOpenJson, assessmentReportGenerate, assessmentRunStart, assessmentRunStop,
  securityWorkspace, webcloneWorkspace, webcloneBuildAction, webclonePreviewAction,
  webclonePreviewClose, webcloneFilesToggle, webclonePreviewPane, webclonePreviewFrame,
  customContextDelete, workspaceContextMenu, appSettingsOverlay, customCommandsInput,
  commandRegistryInput, securityWorkspaceTools, securityWorkspaceBody, securityToolSwitcher,
  securityToolButton, securityToolMenu, securityWorkbench, securityProxyBrowserWrap,
  securityProxyBrowserMenu, securityHistoryToggle, securityHistoryPanel, securityHistoryRefresh,
  securityHistoryMenu, securityHistorySortHeaders, securityRepeaterAdd, securityRepeaterPrev,
  securityRepeaterNext, securityIntruderTabButtons, securityAttackButtons, securityPositionMark,
  securityPositionAuto, securityPositionClear, securityPayloadJsonToggle, securityClearButton,
  securityDropButton, securityInterceptToggle, securityRunButton, securityRequestEditor,
  securityResponseEditor, securityPayloadPanel, securityPayloadEditor, securityInspector,
  securityInspectorToggle, securityInspectorClose, securityInspectorTabs, inspectorDecoderInput,
  inspectorDecoderOutput, inspectorJwtToken, inspectorCookieInput, inspectorCookieOutput,
  terminalShellTab, securityExchangeEl, securityExchangeSash, securityWorkbenchResize,
  statusLnCol, statusOllamaPort,
} from "./core/dom-refs.js";
import { SetiIconTheme, EditorManager, TerminalManager } from "./core/runtime-globals.js";
import { escapeHtml, formatWaitClock } from "./core/text-format.js";
import {
  normPath, basenameOf, relativePathFromRoot, joinWorkspacePath,
} from "./core/workspace-paths.js";
import {
  paintLiveInputRecord, createChatSession, clearChatSessionState, reportChatHistoryWarning,
  schedulePersistChatSessions, flushChatSessionsBeforeClose,
} from "./features/chat/chat-persistence.js";
import {
  refreshUserPromptDisclosures, collapseExpandedUserPrompts, userPromptSelectionInside,
  selectWholeUserPrompt, deactivateUserPromptSelection, dismissUserPromptSelectionIfOutside,
  activateUserPromptSelection,
} from "./features/chat/user-prompt-box.js";
import { toggleCollapsibleFold } from "./features/chat/turn-structure.js";
import {
  activeChatRuns, noteParentContinuationStarted, noteParentRunSettled, isRunningChatActive,
  anyChatSessionRunning,
} from "./features/chat/chat-run-state.js";
import {
  chatSessions, activeChatSession, setChatCollapsed, openChatPane, renderChatSessionSelect,
  loadChatSession, newChatSession, closeChatSession, destroyChatSession, deleteActiveChatSession,
  archiveChatSession,
} from "./features/chat/chat-sessions.js";
import {
  reopenChatSession, renderChatHistory, positionChatHistoryPopover, closeChatHistoryPopover,
  toggleChatHistoryPopover, showChatOptions,
} from "./features/chat/chat-history-popover.js";
import {
  CHAT_MODE_KEY, CHAT_PROFILE_DEFS, canonicalChatMode, syncChatModeUi, closeChatModeMenu,
  toggleChatModeMenu, positionChatModeMenu, setChatMode, setChatFamily,
} from "./features/chat/chat-mode.js";
import {
  CONTEXT_USAGE_SECTIONS, pinContextBlock, positionContextPopover, showContextPanel,
  closeContextPopover, toggleContextPopover,
} from "./features/chat/context-usage.js";
import { refreshDirMap } from "./features/chat/prompt-context.js";
import {
  setAgentStatus, renderMarkdown, writeChatClipboardText, attachAssistantCopyButton,
  syncChatStickyMask, bindScrollbarHoverLane, addErrorMessage,
} from "./features/chat/chat-messages.js";
import { toolRowOpensFile } from "./features/chat/tool-cards.js";
import { updateCommandTimelineLabel } from "./features/chat/command-timeline.js";
import {
  renderComposerTaskList, dismissEscalatedQuestionSurfaces, presentOrchestratorEscalatedQuestion,
} from "./features/chat/composer-questions.js";
import {
  CUSTOM_COMMANDS_KEY, COMMAND_REGISTRY_KEY, SYSTEM_SKILL_SLASH_COMMANDS,
  loadBugBountySlashCommands, closeSlashSuggestions, clearSelectedSlashCommand,
  chooseSlashSuggestion, renderSlashSuggestions,
} from "./features/chat/slash-commands.js";
import {
  closeFileTagSuggestions, renderFileTagSuggestions, handleFileTagKeydown,
} from "./features/chat/file-tag-picker.js";
import {
  resizeChatInput, effectiveChatInputValue, installChatInputEditorAdapter,
  isChatInputCaretAtArgumentStart, isTextEditingTarget, submitChatComposer,
  submitChatComposerFromInput, updateSendBtn, onChatInputChange,
} from "./features/chat/composer-input.js";
import {
  addComposerImageFiles, sentImageOriginals, imageFilesFrom, hasDraggedFiles,
} from "./features/chat/composer-images.js";
import { stopGeneration } from "./features/chat/run-stop.js";
import { markSubagentQuestionWaiting } from "./features/agents/subagent-cards.js";
import { handleDelegatedChildEvent } from "./features/agents/delegated-child-runs.js";
import {
  handleDelegatedChildRuntimeEvent, enqueueSubagentResult, queueParentContinuationEvent,
  handleHiddenBackgroundRuntimeEvent,
} from "./features/agents/parent-continuation.js";
import {
  hasCompleteForWait, absorbModelRunCommandResult, handleBackgroundWaitEvent, updateWaitCardLabel,
  finalizeCommandTimeline,
} from "./features/agents/background-waits.js";
import {
  AUTO_CONTEXT_ESTIMATE, EXPLORE_SUBAGENT_MODEL_KEY, addCustomModelName, loadModelSettings,
  getModelSettings, modelThinkingEnabled, saveModelSettings, refreshModelContextCapacity,
} from "./features/models/model-settings.js";
import {
  syncModelLabel, syncModelControlsSummary, openModelControlsMenu, positionModelPanel,
  positionModelMenu, closeModelEditMenu, closeModelMenu, positionModelEditMenu, openModelEditMenu,
  loadModels, renderModelList, openModelMenu, addCustomModel,
} from "./features/models/model-picker.js";
import {
  loadAuthoritySettings, setAuthoritySuperMode, positionAuthorityMenu, closeAuthorityMenu,
  toggleAuthorityMenu,
} from "./features/settings/authority-settings.js";
import {
  beginGuidanceCreate, renderGuidanceSettings, refreshCustomSkillCatalog,
} from "./features/settings/guidance-settings.js";
import {
  updateGeneralSettings, filterAppSettingsNavigation, setAppSettingsSection,
  chooseCertificateDirectory, resetCertificateDirectory, openAppSettings, loadSettingsWorkspace,
} from "./features/settings/app-settings-shell.js";
import {
  OLLAMA_PORT, syncLlmProviderUi, MODELS_SETTINGS_PAGE_SIZE, queueLlmSettingsAutosave,
  syncOpenRouterApiFieldsUi, syncOllamaApiFieldsUi, renderExploreSubagentSelect,
  renderModelsSettingsList, refreshModelsSettingsPanel, isOpenRouterProvider, testLlmSettings,
  testOllamaSettings, resetOllamaSettings,
} from "./features/settings/llm-provider-settings.js";
import {
  setKaliAccessStatus, queueKaliAccessAutosave, renderMcpSettings, openMcpConfig, testKaliAccess,
  saveKaliAccess,
} from "./features/settings/mcp-settings.js";
import {
  setIdentitySettingsStatus, markAuthenticationSourceChanged, appendEngagementAccountRow,
  deleteEngagementAccountRow, renderIdentitySettings, loadIdentitySettings,
  createIdentityFromSettings, createCredentialFromSettings, handleCredentialAction,
  handleIdentityAction, importIdentityStateFromSettings,
} from "./features/settings/identity-settings.js";
import {
  SETTINGS_EDITOR_MODE_KEY, isAssessmentSettingsTab, isSettingsTab, setNestedSettingValue,
  renderSettingsForm, syncSettingsEditorButtons, setSettingsEditorMode, updateSettingFromInput,
} from "./features/settings/settings-tab-editor.js";
import {
  scheduleProjectProfileAutosave, setProjectSettingsTarget,
} from "./features/project/project-profile.js";
import {
  createProject, projectName, setExplorerRootExpanded, restoreLastWorkspace, openProject,
  openFolder, openFileDialog,
} from "./features/project/project-activation.js";
import {
  updateRunMenuState, configureRunCommand, runConfiguredCommand,
} from "./features/project/run-commands.js";
import {
  setExplorerActionsEnabled, createNewItemInput, selectItem, refreshWorkspaceUi,
  restoreChatComposerAfterUiAction, deleteSelectedExplorerItem, isExplorerKeyboardTarget,
  setContextTargetFromSelectedItem,
} from "./features/project/explorer-tree.js";
import {
  closeWorkspaceContextMenu, setWorkspaceClipboard, pasteWorkspaceClipboard,
  runWorkspaceContextAction,
} from "./features/project/explorer-context-menu.js";
import {
  BUG_BOUNTY_SELECTED_KEY, BUG_BOUNTY_PATH_KEY, setBugBountyPhaseExpanded,
  restoreBugBountyTreeState, closeAssessmentRepairDialog, openAssessmentRepairDialog,
  createAssessmentFolder, openAssessmentFolder, repairAssessmentFolder, assessmentDiskPath,
} from "./features/assessment/assessment-workspace.js";
import {
  setResourceDirty, syncResourceCursorPosition, saveResourceChanges, setResourceSettingsMode,
  updateResourceSettingFromInput, setResourceWrapLines, showResourcePreview, openAssessmentItem,
} from "./features/assessment/resource-viewer.js";
import {
  checklistTextList, checklistStatusIssue, checklistEvidenceIssue, scheduleChecklistSave,
  renderChecklistUI, setResourceChecklistMode,
} from "./features/assessment/checklist-view.js";
import { scheduleScopeSave, setResourceScopeMode } from "./features/assessment/scope-view.js";
import { startAssessmentRun, stopAssessmentRun } from "./features/assessment/module-runs.js";
import {
  closeCustomContextMenu, deleteSelectedCustomEntries, beginCustomEntry,
} from "./features/assessment/custom-entries.js";
import {
  buildWebClone, setWebCloneFilesCollapsed, syncWebClonePreviewBounds, toggleWebClonePreview,
  showWebCloneWorkspace,
} from "./features/assessment/webclone-view.js";
import {
  openInterceptorTab, isInterceptorTab, toggleInterceptorCapture, syncProxyListenerUi,
  syncProxyBrowserUi, closeProxyBrowserMenu, chooseProxyBrowserIdentity, launchProxyBrowser,
  handleProxyCapture,
} from "./features/interceptor/interceptor-controls.js";
import { stepRepeaterHistory, createWorkbenchTab } from "./features/security/workbench-tabs.js";
import {
  renderPayloadSets, onSecurityRequestChanged, markSelectionAsPosition, autoDetectPositions,
  clearPayloadPositions, setAttackType, setIntruderTab,
} from "./features/security/intruder-payloads.js";
import {
  SECURITY_TOOL_KEY, SECURITY_INSPECTOR_OPEN_KEY, SECURITY_INSPECTOR_TAB_KEY, SECURITY_TOOL_META,
  syncSecurityExchangeSizes, setSecurityStatus, saveSecurityDraft, closeSecurityToolMenu,
  setSecurityTool, syncSecurityToolsVisibility, runSecurityWorkbench, logSecurityExchangeIfNeeded,
  analyzeSecurityExchange, clearSecurityExchange, dropInterceptedRequest,
} from "./features/security/workbench-runner.js";
import {
  setSecurityInspectorStatus, setSecurityInspectorTab, setSecurityInspectorOpen,
  loadInspectorDecoderSource, runInspectorTransform, decodeInspectorJwt, loadInspectorJwtSource,
  signInspectorJwt, verifyInspectorJwt, loadInspectorCookieSource, analyzeInspectorCookies,
  copyInspectorValue,
} from "./features/security/inspector-panel.js";
import {
  setSecurityHistorySort, closeSecurityHistoryMenu, selectedSecurityHistoryRecords,
  sendHistoryRecordsToRepeater, sendHistoryRecordsToIntruder,
  deleteSelectedSecurityHistoryRecords, loadSecurityHistory, setSecurityHistoryVisible,
  refreshSecurityHistoryIfVisible,
} from "./features/security/traffic-history.js";
import {
  openTabs, clearEditorTabDropIndicators, setEditorTabDropIndicator, reorderOpenTabs,
  unpinEditorTab, openFile, commitActiveTab, switchToTab, saveActiveTab,
  closeEditorTabContextMenu, openEditorTabContextMenu, handleEditorTabContextMenuAction, closeTab,
} from "./features/editor/editor-tabs.js";


const xekuteStore = globalThis.XekuteCore.createAppStore();
const appController = new globalThis.XekuteCore.AppController(xekuteStore);
const appLifecycle = new globalThis.XekuteCore.LifecycleCollection();
const ToolMap = globalThis.ToolMap || (() => {
  const MODE_TOOL_GROUPS = globalThis.XekuteOperatingModes?.MODE_TOOL_GROUPS || {
    ask: ["ask_questions", "read_file", "search_workspace", "view_active_terminal"],
    agent: null,
  };
  const MUTATING = new Set(["apply_patch", "manage_identity"]);
  let catalog = []; // [{name, description, inputSchema, metadata}]
  const TOOL_META = {}; // populated by ensureCatalog; consumed as ToolMap.TOOL_META[tool]

  async function ensureCatalog() {
    if (catalog.length || !globalThis.api?.toolCatalog) return;
    try {
      const response = await globalThis.api.toolCatalog();
      if (response && Array.isArray(response.tools)) catalog = response.tools;
      for (const entry of catalog) {
        TOOL_META[entry.name] = {
          label: entry.name.replace(/_/g, " "),
          badge: MUTATING.has(entry.name) ? "write" : "read",
          mutating: MUTATING.has(entry.name),
          targetTypes: entry.metadata?.targetTypes || [],
        };
      }
    } catch {
      catalog = [];
    }
  }

  function catalogForProfile(profile) {
    const normalized = globalThis.XekuteOperatingModes?.normalizeProfile?.(profile)?.key;
    const key = normalized || String(profile?.key || profile || "agent");
    const group = MODE_TOOL_GROUPS[key];
    const entries = group === null || group === undefined
      ? catalog
      : catalog.filter((entry) => group.includes(entry.name));
    return entries.map((entry) => ({
      type: "function",
      function: { name: entry.name, description: entry.description || "", parameters: entry.inputSchema || {} },
    }));
  }

  function normalizeToolCall(call) {
    if (!call || typeof call !== "object") return null;
    const name = call.function?.name || call.action || call.toolName;
    if (typeof name !== "string" || !name.trim()) return null;
    const raw = call.function?.arguments;
    let args = call.args || {};
    if (typeof raw === "string" && raw.trim()) {
      try { args = JSON.parse(raw); } catch { args = {}; }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      args = raw;
    }
    return { callId: call.id || call.callId, type: call.type || "function", toolName: name, action: name, args };
  }

  return {
    MODE_TOOL_GROUPS,
    toolsForProfile: (profile) => catalogForProfile(profile),
    compactTools: (tools = []) => (Array.isArray(tools) ? tools : []),
    hotToolNamesForProfile: (profile) => catalogForProfile(profile).map((tool) => tool.function.name),
    buildToolCatalog: (profile) => catalogForProfile(profile),
    LOADABLE_PACK_NAMES: [],
    TOOL_META,
    targetForTool: (tool = {}) => tool.file || tool.args?.path || tool.args?.command || tool.query || tool.command || tool.processId || "workspace",
    normalizeToolCall,
    ensureCatalog,
  };
})();
// Fetch the tool catalog once at startup so mode tools / context meter / tool
// cards are registry-backed. Re-sync the mode UI once loaded.
if (typeof ToolMap.ensureCatalog === "function") {
  ToolMap.ensureCatalog().then(() => {
    try { syncChatModeUi(); } catch { /* initial sync already ran */ }
  });
}
globalThis.addEventListener("beforeunload", () => {
  appController.dispose();
  appLifecycle.dispose();
}, { once: true });

const composerEl       = inputBar?.querySelector(".composer") || null;
const CONTEXT_USAGE_ROW_LABELS = Object.freeze(Object.fromEntries(
  CONTEXT_USAGE_SECTIONS.map((section) => [section.key, section.label]),
));

const settingsViewSwitch = settingsViewJson?.closest(".settings-view-switch") || null;
if (resourceViewer && settingsUIView) resourceViewer.appendChild(settingsUIView);
if (resourceViewerActions && settingsViewSwitch) resourceViewerActions.prepend(settingsViewSwitch);
if (settingsViewSwitch) settingsViewSwitch.hidden = true;
if (settingsUIView) settingsUIView.hidden = true;
appState.proxyBrowserMenuHome = securityProxyBrowserMenu?.parentElement || null;
if (securityWorkspaceTools && securityToolSwitcher) securityWorkspaceTools.appendChild(securityToolSwitcher);
if (securityWorkspaceBody && securityWorkbench) securityWorkspaceBody.appendChild(securityWorkbench);
if (securityToolSwitcher) securityToolSwitcher.hidden = false;
if (securityWorkbench) securityWorkbench.hidden = false;


const TERMINAL_HEADER_H = 35;
const TERMINAL_MIN_EXPANDED = 80;
const EDITOR_MIN_HEIGHT = 120;
const WORKBENCH_MIN_H = 80;  // min height for history panel when dragging
const WORKBENCH_TOOL_MIN_H = 120; // min height for the tool panel (interceptor etc.)
appState.resourceWrapLines = localStorage.getItem("xekute.resourceWrapLines") === "true";
appState.resourceSettingsSaveChain = Promise.resolve();


appState.workspaceUiRefreshQueue = Promise.resolve();
const liveInputController = createLiveInputController({ api: window.api, onChange(session, record) {
  paintLiveInputRecord(session, record);
  schedulePersistChatSessions();
} });
appState.chatPersistenceQueue = Promise.resolve();
appState.chatHistoryWriteQueue = Promise.resolve();


const BROWSER_TAB_PATH = "xekute:browser";
appState.markdownViewMode = localStorage.getItem("pointer:markdownViewMode") === "md" ? "md" : "text";
const QUICK_SEARCH_DEBOUNCE_MS = 225;
const QUICK_SEARCH_ROW_HEIGHT = 53;
const QUICK_SEARCH_OVERSCAN = 8;
const QUICK_SEARCH_RESULT_LIMIT = 10000;

const ADVANCED_SEARCH_OPERATORS = [
  ["source", "traffic, JavaScript, evidence, tools, map", ["traffic", "javascript", "evidence", "tool", "map", "asset", "code"]],
  ["path", "workspace path with * or ** wildcards"], ["file", "file name"], ["ext", "file extension", ["js", "ts", "json", "jsonl", "md", "txt"]],
  ["size", "file size comparison, e.g. >500KB"], ["after", "record/file after an ISO date"], ["before", "record/file before an ISO date"],
  ["case", "case-sensitive matching", ["true", "false"]], ["regex", "bounded regular expression"], ["decode", "search decoded content", ["url", "base64", "html", "unicode", "jwt", "auto"]], ["normalized", "normalized URL and whitespace", ["true", "false"]],
  ["host", "request host"], ["scheme", "URL scheme", ["https", "http", "wss", "ws"]], ["port", "request port"],
  ["method", "HTTP method", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]], ["status", "HTTP code, 2xx range, or comparison"],
  ["endpoint", "concrete or normalized endpoint"], ["param", "path, query, form, or JSON parameter"], ["header", "request or response header"], ["cookie", "cookie name or value"], ["mime", "response content type"],
  ["request", "request-only text"], ["response", "response-only text"], ["in-scope", "project scope decision", ["true", "false"]], ["asset", "asset, target, host, or URL"],
  ["identity", "capture identity id, label, or role"], ["authenticated", "authenticated or anonymous", ["true", "false"]],
  ["severity", "evidence severity", ["critical", "high", "medium", "low", "informational", "unrated"]], ["confidence", "evidence confidence comparison"], ["verified", "verified evidence", ["true", "false"]],
  ["evidence-status", "evidence lifecycle status", ["observed", "verified", "rejected", "inconclusive"]], ["cwe", "CWE identifier"], ["owasp", "OWASP category"], ["tag", "tag or risk label"], ["tool", "capture or scanner tool"], ["evidence", "evidence reference"],
  ["url", "URL in JavaScript artifacts"], ["symbol", "function, class, or assigned symbol"], ["secret", "likely secret material", ["true", "false"]],
  ["secret-type", "detected secret family", ["jwt", "aws-access-key", "private-key", "bearer-token", "github-token", "stripe-key", "api-key"]],
  ["sink", "security-sensitive code sink", ["dom-xss", "code-execution", "command-execution", "sql", "redirect"]], ["source-map", "source-map reference", ["true", "false"]],
  ["same", "correlate a shared dimension", ["endpoint", "param", "resource", "status", "response"]], ["different", "require a differing dimension", ["value", "identity", "status", "body", "headers"]],
  ["compare", "cross-record comparison", ["identity", "response"]], ["changed", "changed response dimension", ["status", "body", "headers", "value"]], ["response.diff", "require a response difference", ["true", "false"]],
  ["risk", "VAPT correlation preset", ["idor", "bola", "auth-bypass"]], ["reachable-from", "graph reachability origin"], ["connected-to", "direct graph neighbor"],
].map(([name, description, values = []]) => ({ name, description, values }));

const ADVANCED_SEARCH_PRESETS = [
  { label: "IDOR candidates", query: "risk:idor same:endpoint compare:identity" },
  { label: "BOLA candidates", query: "risk:bola same:endpoint same:param different:value compare:identity" },
  { label: "Auth bypass", query: "risk:auth-bypass same:endpoint compare:identity" },
  { label: "JavaScript secrets", query: "source:javascript secret:true" },
  { label: "Source maps", query: "source:javascript source-map:true" },
  { label: "Server errors", query: "source:traffic status:5xx" },
  { label: "High-confidence evidence", query: "source:evidence severity:(critical,high) confidence:>=0.8" },
  { label: "Auth headers", query: "source:traffic (header:authorization OR cookie:session)" },
];

const SIDEBAR_VIEW_KEY = "pointer:sidebarView";
const MARKDOWN_VIEW_MODE_KEY = "pointer:markdownViewMode";
const CHAT_PROFILE_KEYS = new Set(Object.keys(CHAT_PROFILE_DEFS));
appState.selectedModel = localStorage.getItem("pointer:model") || "";
appState.resolvedContextCapacity = {
  tokens: AUTO_CONTEXT_ESTIMATE,
  source: "fallback",
  approximate: true,
};

const storedChatMode = localStorage.getItem(CHAT_MODE_KEY) || "agent";
appState.chatMode = canonicalChatMode(storedChatMode);
appState.assessmentPath = localStorage.getItem(BUG_BOUNTY_PATH_KEY) || "";
if (editorPane) appState.browserWorkspace = createBrowserWorkspace({
  document,
  api: window.api,
  host: editorPane,
  getAssessmentPath: () => appState.assessmentPath,
  getSessionId: () => appState.activeChatSessionId,
  onError: message => setSecurityStatus(message, "error"),
});
appLifecycle.add(() => appState.browserWorkspace?.dispose());
appState.securityInspectorTab = localStorage.getItem(SECURITY_INSPECTOR_TAB_KEY) || "decoder";
appState.settingsEditorMode = localStorage.getItem(SETTINGS_EDITOR_MODE_KEY) === "ui" ? "ui" : "json";
installChatInputEditorAdapter();
appState.guidanceScope = localStorage.getItem("pointer:guidanceScope") || "all";
appState.mcpScope = localStorage.getItem("pointer:mcpScope") || "all";
const UI_ZOOM_KEY = "pointer:uiZoom";
appState.uiZoom = Number(localStorage.getItem(UI_ZOOM_KEY)) || 1;
























































































































































function syncWorkspaceActivity() {
  const securityActive = appState.currentWorkspaceMode === "security";
  const settingsActive = appState.currentWorkspaceMode === "settings";
  activitySecurity?.classList.toggle("active", securityActive);
  activitySecurity?.setAttribute("aria-pressed", String(securityActive));
  activitySettings?.classList.toggle("active", settingsActive);
  activitySettings?.setAttribute("aria-pressed", String(settingsActive));
  syncSidebarActivity();
}

function setCodeEditorVisible(visible) {
  if (editorTabBar) editorTabBar.hidden = !visible;
  if (editorBody) editorBody.hidden = !visible;
  if (visible) requestAnimationFrame(() => EditorManager.layout());
}

function showCodeEditorWorkspace() {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "editor";
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  setCodeEditorVisible(true);
  editorPane?.setAttribute("aria-label", "Code editor");
  syncWorkspaceActivity();
}

function showResourceWorkspace({ focus = false } = {}) {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "resource";
  setCodeEditorVisible(false);
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = false;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Workspace editor");
  syncWorkspaceActivity();
  if (focus && !resourceViewerContent?.hidden) requestAnimationFrame(() => resourceViewerContent.focus());
}

function showSecurityWorkspace(tool = "") {
  openInterceptorTab(tool);
}

function showSecurityWorkspaceContent(tool = "") {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "security";
  if (editorTabBar) editorTabBar.hidden = false;
  if (editorBody) editorBody.hidden = true;
  updateEditorPathBar();
  if (assessmentModuleView) assessmentModuleView.hidden = true;
  appState.assessmentModuleActive = false;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = false;
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







































































































































function setSidebarCollapsed(collapsed) {
  appState.sidebarCollapsed = Boolean(collapsed);
  sidebar?.classList.toggle("collapsed", appState.sidebarCollapsed);
  sidebarResize?.classList.toggle("collapsed", appState.sidebarCollapsed);
  syncSidebarActivity();
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

function syncSidebarActivity() {
  const projectActive = !appState.sidebarCollapsed
    && appState.currentSidebarView === "project";
  btnTopFileTree?.classList.toggle("active", projectActive);
  btnTopFileTree?.classList.toggle("inactive", !projectActive);
  btnTopFileTree?.setAttribute("aria-pressed", String(projectActive));
  activityExplorer?.classList.toggle("active", projectActive);
  activityExplorer?.setAttribute("aria-pressed", String(projectActive));
  activityBugBounty?.classList.toggle("active", projectActive);
  activityBugBounty?.setAttribute("aria-pressed", String(projectActive));
}

function setSidebarView(view, { persist = true } = {}) {
  const next = "project";
  appState.currentSidebarView = next;
  if (explorerSidebarView) {
    const visible = next === "project";
    explorerSidebarView.hidden = !visible;
    explorerSidebarView.setAttribute("aria-hidden", String(!visible));
  }
  if (bugBountySidebarView) {
    bugBountySidebarView.hidden = true;
    bugBountySidebarView.setAttribute("aria-hidden", "true");
  }
  if (sidebarViewTitle) sidebarViewTitle.textContent = "Project";
  if (btnSidebarMore) {
    btnSidebarMore.hidden = false;
    btnSidebarMore.title = "Project Actions";
    btnSidebarMore.setAttribute("aria-label", btnSidebarMore.title);
  }
  if (persist) localStorage.setItem(SIDEBAR_VIEW_KEY, next);
  syncSidebarActivity();
  syncSecurityToolsVisibility(true);
  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

function activateSidebarView(view) {
  if (!appState.sidebarCollapsed && appState.currentSidebarView === view) {
    setSidebarCollapsed(true);
    return;
  }
  setSidebarView(view);
  if (appState.sidebarCollapsed) setSidebarCollapsed(false);
}








function setNotifications(items = []) {
  const baseItems = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .filter((item) => item.id !== "update-available");
  const merged = updatesState.pendingNotification
    ? [updatesState.pendingNotification, ...baseItems]
    : baseItems;
  appState.notificationItems = merged.filter(Boolean);
  if (notificationCount) {
    notificationCount.textContent = String(appState.notificationItems.length);
    notificationCount.hidden = appState.notificationItems.length === 0;
  }
  if (btnNotifications) {
    btnNotifications.classList.toggle("has-notifications", appState.notificationItems.length > 0);
    btnNotifications.title = appState.notificationItems.length ? `${appState.notificationItems.length} notification${appState.notificationItems.length === 1 ? "" : "s"}` : "Notifications";
  }
  if (!notificationList) return;
  notificationList.innerHTML = appState.notificationItems.length
    ? appState.notificationItems.map((item) => `<article class="notification-item ${escapeHtml(item.tone || "warning")}"><span class="codicon ${escapeHtml(item.icon || "codicon-warning")}"></span><div><strong>${escapeHtml(item.title || "Notification")}</strong><p>${escapeHtml(item.message || "")}</p>${item.action ? `<button type="button" class="notification-action" data-notification-action="${escapeHtml(item.action)}">${escapeHtml(item.actionLabel || "Review")}</button>` : ""}</div></article>`).join("")
    : '<div class="notification-empty">No notifications</div>';
  notificationList.querySelectorAll("[data-notification-action]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.notificationAction === "assessment-repair") openAssessmentRepairDialog();
      if (button.dataset.notificationAction === "update-install") beginUpdateInstallFromNotification();
      if (notificationPanel) notificationPanel.hidden = true;
      btnNotifications?.setAttribute("aria-expanded", "false");
    }));
  }

function positionNotificationPanel() {
  if (!notificationPanel || notificationPanel.hidden || !btnNotifications) return;
  const anchor = btnNotifications.getBoundingClientRect();
  const margin = 8;
  const width = notificationPanel.offsetWidth || 320;
  const height = notificationPanel.offsetHeight || 0;
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(anchor.bottom + 8, window.innerHeight - height - margin));
  notificationPanel.style.left = `${Math.round(left)}px`;
  notificationPanel.style.top = `${Math.round(top)}px`;
  notificationPanel.style.right = "auto";
}

  function beginUpdateInstallFromNotification() {
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    beginUpdateInstall();
  }

// ── In-app updates ──────────────────────────────────────────────────────────
const updatesState = {
  availableVersion: "",
  readyVersion: "",
  ignoredVersion: "",
  deferredVersion: "",
  pendingNotification: null,
  transientTimer: null,
};

async function loadUpdateSettings() {
  try {
    const result = await window.api.updatesSettingsGet?.();
    const settings = result?.value || (result && !result.ok ? null : result);
    if (settings) {
      const currentVersion = String(settings.currentVersion || "").trim();
      if (generalCurrentVersion) generalCurrentVersion.textContent = currentVersion ? `XEKUTE v${currentVersion}` : "Version unavailable";
      updatesState.ignoredVersion = String(settings.ignoredVersion || "");
      updatesState.deferredVersion = String(settings.deferredVersion || settings.ignoredVersion || "");
      if (generalUpdatesToggle) generalUpdatesToggle.checked = settings.checkOnLaunch !== false;
      if (updatesState.deferredVersion) showUpdateNotification(updatesState.deferredVersion);
    }
  } catch { /* bridge unavailable */ }
}

function runUpdateCheck(manual = false) {
  window.api.updatesCheck?.({ manual }).catch(() => {});
}

function showUpdateToast(version) {
  if (!updateToast) return;
  updatesState.availableVersion = String(version || "");
  if (updateToastVersion) updateToastVersion.textContent = updatesState.availableVersion;
  const title = updateToast.querySelector(".update-toast-title");
  if (title) title.textContent = "New version is available";
  const sub = updateToast.querySelector(".update-toast-version");
  if (sub) sub.textContent = "";
  updateToast.classList.remove("update-toast-downloading");
  updateToast.querySelectorAll(".update-toast-progress, .update-toast-progress-label").forEach((el) => el.remove());
  if (updateToastInstall) {
    updateToastInstall.hidden = false;
    updateToastInstall.textContent = "Install";
  }
  if (updateToastIgnore) {
    updateToastIgnore.hidden = false;
    updateToastIgnore.textContent = "Ignore";
  }
  updateToast.hidden = false;
  // Restart the entrance animation.
  updateToast.style.animation = "none";
  void updateToast.offsetWidth;
  updateToast.style.animation = "";
}

function hideUpdateToast() {
  if (updateToast) updateToast.hidden = true;
}

function showTransientUpdateNotice(titleText, subText) {
  if (!updateToast) return;
  clearTimeout(updatesState.transientTimer);
  if (updateToastVersion) updateToastVersion.textContent = "";
  const title = updateToast.querySelector(".update-toast-title");
  if (title) title.textContent = titleText;
  const sub = updateToast.querySelector(".update-toast-version");
  if (sub) sub.textContent = subText;
  updateToast.classList.remove("update-toast-downloading");
  updateToast.querySelectorAll(".update-toast-progress, .update-toast-progress-label").forEach((el) => el.remove());
  if (updateToastInstall) updateToastInstall.hidden = true;
  if (updateToastIgnore) updateToastIgnore.hidden = true;
  updateToast.hidden = false;
  updateToast.style.animation = "none";
  void updateToast.offsetWidth;
  updateToast.style.animation = "";
  updatesState.transientTimer = setTimeout(hideUpdateToast, 4000);
}

function beginUpdateInstall() {
  if (!window.api.updatesInstall) return;
  if (updatesState.readyVersion) {
    window.api.updatesInstall().catch(() => {});
    return;
  }
  showUpdateDownloading(updatesState.availableVersion || updatesState.deferredVersion);
  window.api.updatesInstall().catch(() => {});
}

function showUpdateDownloading(version) {
  showUpdateToast(version);
  if (updateToast) updateToast.classList.add("update-toast-downloading");
  const title = updateToast?.querySelector(".update-toast-title");
  if (title) title.textContent = "Downloading update…";
  if (updateToastInstall) updateToastInstall.hidden = true;
  if (updateToastIgnore) updateToastIgnore.hidden = true;
}

// A download that finished during an agent run waits for the operator. It
// still installs on the next quit, so "Later" only moves it to notifications.
function showUpdateReadyToast(version) {
  showUpdateToast(version);
  const title = updateToast?.querySelector(".update-toast-title");
  if (title) title.textContent = "Update ready to install";
  const sub = updateToast?.querySelector(".update-toast-version");
  if (sub) sub.textContent = "Agent run active. Installs when you quit.";
  if (updateToastInstall) updateToastInstall.textContent = "Restart now";
  if (updateToastIgnore) updateToastIgnore.textContent = "Later";
}

function ignoreCurrentUpdate() {
  if (updatesState.readyVersion) {
    hideUpdateToast();
    showUpdateNotification(updatesState.readyVersion);
    return;
  }
  const version = updatesState.availableVersion;
  updatesState.ignoredVersion = version;
  updatesState.deferredVersion = version;
  window.api.updatesIgnore?.({ version }).catch(() => {});
  hideUpdateToast();
  if (version) showUpdateNotification(version);
}

function showUpdateNotification(version) {
  const v = String(version || "");
  if (!v) return;
  const ready = v === updatesState.readyVersion;
  updatesState.pendingNotification = {
    id: "update-available",
    title: ready ? `Update ready — XEKUTE ${v}` : `Update available — XEKUTE ${v}`,
    message: ready ? "Downloaded. Restart to install, or it installs when you quit." : "A new version has been released. Install it when you're ready.",
    action: "update-install",
    actionLabel: ready ? "Restart" : "Install",
    icon: "codicon-cloud-download",
    tone: "warning",
  };
  setNotifications(appState.notificationItems);
}

function handleUpdateEvent(payload = {}) {
  const type = String(payload.type || "");
  if (type === "available") {
    const version = String(payload.version || "");
    updatesState.availableVersion = version;
    const ignored = Boolean(payload.ignored || (version && version === updatesState.ignoredVersion));
    // A newly released version supersedes an older ignored one. The newest
    // release gets one normal prompt even if several intermediate versions
    // were skipped.
    if (!ignored && version !== updatesState.ignoredVersion) {
      updatesState.ignoredVersion = "";
      updatesState.deferredVersion = "";
      updatesState.pendingNotification = null;
      setNotifications(appState.notificationItems);
    }
    // An explicit Help → Check for Updates still shows the ignored version.
    if (ignored && !payload.manual) {
      updatesState.deferredVersion = version;
      showUpdateNotification(version);
      return;
    }
    showUpdateToast(version);
  } else if (type === "downloading") {
    showUpdateDownloading(payload.version || updatesState.availableVersion || updatesState.deferredVersion);
    handleUpdateEvent({ type: "progress", percent: 0 });
  } else if (type === "progress") {
    if (!updateToast || updateToast.hidden) return;
    updateToast.classList.add("update-toast-downloading");
    if (updateToastInstall) updateToastInstall.hidden = true;
    if (updateToastIgnore) updateToastIgnore.hidden = true;
    let bar = updateToast.querySelector(".update-toast-progress");
    if (!bar) {
      updateToast.querySelector(".update-toast-actions")?.insertAdjacentHTML(
        "beforeend",
        '<span class="update-toast-progress"><i></i></span><span class="update-toast-progress-label">0%</span>'
      );
      bar = updateToast.querySelector(".update-toast-progress");
    }
    const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent) || 0)));
    bar.querySelector("i")?.style.setProperty("width", `${percent}%`);
    const label = updateToast.querySelector(".update-toast-progress-label");
    if (label) label.textContent = `${percent}%`;
  } else if (type === "downloaded") {
    updatesState.ignoredVersion = "";
    updatesState.deferredVersion = "";
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    if (payload.deferred) {
      updatesState.readyVersion = String(payload.version || updatesState.availableVersion || "");
      showUpdateReadyToast(updatesState.readyVersion);
      return;
    }
    const label = updateToast?.querySelector(".update-toast-progress-label");
    if (label) label.textContent = "Installing…";
    else showTransientUpdateNotice("Installing update…", "XEKUTE will restart automatically.");
    // The main process quits the app shortly after this event.
  } else if (type === "installing") {
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    const label = updateToast && !updateToast.hidden ? updateToast.querySelector(".update-toast-progress-label") : null;
    if (label) label.textContent = "Installing…";
    else showTransientUpdateNotice("Installing update…", "XEKUTE will restart automatically.");
  } else if (type === "none") {
    // Launch checks are silent. Explicit checks (including installing a stale
    // deferred reminder) give the user direct feedback.
    if (payload.manual || payload.reason === "install") {
      updatesState.ignoredVersion = "";
      updatesState.deferredVersion = "";
      updatesState.pendingNotification = null;
      setNotifications(appState.notificationItems);
      showTransientUpdateNotice("XEKUTE is up to date", "You're on the latest version.");
    }
  } else if (type === "updated") {
    updatesState.ignoredVersion = "";
    updatesState.deferredVersion = "";
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    showTransientUpdateNotice("XEKUTE is now up to date", `Updated successfully to version ${String(payload.version || "").trim()}.`);
  } else if (type === "disabled") {
    if (payload.manual || payload.reason === "install") {
      showTransientUpdateNotice("Development build", "Production updates are disabled. Set XEKUTE_UPDATE_MOCK=1 to test the update flow.");
    }
  } else if (type === "error") {
    if (payload.phase === "download" && updatesState.availableVersion) {
      updatesState.deferredVersion = updatesState.availableVersion;
      showUpdateNotification(updatesState.availableVersion);
    }
    if (payload.manual || payload.reason === "install" || payload.phase === "download") {
      showTransientUpdateNotice(
        "Update failed",
        String(payload.userMessage || "XEKUTE could not download or install the update. Try again from Help → Check for Updates."),
      );
    }
  }
}














































assessmentModuleOpenJson?.addEventListener("click", () => {
  if (!appState.assessmentModulePath || !appState.assessmentPath) return;
  showResourcePreview(assessmentDiskPath(appState.assessmentModulePath), basenameOf(appState.assessmentModulePath), `Target / ${appState.assessmentModulePath}`, { icon: "codicon-json" });
});
assessmentReportGenerate?.addEventListener("click", async () => {
  if (!appState.assessmentPath || appState.assessmentModulePath !== "report/report.md") return;
  const result = await window.api.assessmentGenerateReport({ path: appState.assessmentPath });
  if (result?.error) addErrorMessage(result.error);
  else setAgentStatus(`Report generated: ${result.path}`);
});
assessmentRunStart?.addEventListener("click", startAssessmentRun);
assessmentRunStop?.addEventListener("click", stopAssessmentRun);



resourceViewerCopy?.addEventListener("click", async () => {
  const text = resourceViewerContent?.value || appState.resourcePreviewText;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  resourceViewerCopy.title = "Copied";
  setTimeout(() => { resourceViewerCopy.title = "Copy resource contents"; }, 1200);
});

resourceViewerSave?.addEventListener("click", saveResourceChanges);
resourceViewerContent?.addEventListener("input", () => {
  appState.resourcePreviewText = resourceViewerContent.value;
  setResourceDirty(appState.resourcePreviewText !== appState.resourceSavedText);
  syncResourceCursorPosition();
});
resourceViewerContent?.addEventListener("keydown", (event) => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.stopPropagation();
    setResourceWrapLines(!appState.resourceWrapLines);
    return;
  }
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
setResourceWrapLines(appState.resourceWrapLines);








/* ── Repeater tabs ─────────────────────────────────────────────── */











/* ── Intruder tabs ─────────────────────────────────────────────── */










/* ── Intruder positions and payloads ───────────────────────────── */
















/* ── Intruder results ──────────────────────────────────────────── */
































































globalThis.XekuteSecurity = {
  async captureExchange({ request = "", response = "", tool = "interceptor" } = {}) {
    if (appState.currentSidebarView !== "project") activateSidebarView("project");
    showSecurityWorkspace(SECURITY_TOOL_META[tool] ? tool : "interceptor");
    securityRequestEditor.value = String(request);
    securityResponseEditor.value = String(response);
    syncSecurityExchangeSizes();
    const logged = await logSecurityExchangeIfNeeded();
    setSecurityStatus(logged?.error ? logged.error : `Captured and logged ${logged.timestamp || ""}`, logged?.error ? "error" : "success");
    return logged;
  },
};

















// Keep both tab strips scrollbar-free while mapping wheel up to left and wheel
// down to right. Horizontal trackpad gestures retain their natural direction.
chatSessionSelect?.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!delta) return;
  const maxScrollLeft = Math.max(0, chatSessionSelect.scrollWidth - chatSessionSelect.clientWidth);
  if (!maxScrollLeft) return;
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, chatSessionSelect.scrollLeft + delta));
  if (nextScrollLeft === chatSessionSelect.scrollLeft) return;
  event.preventDefault();
  chatSessionSelect.scrollLeft = nextScrollLeft;
}, { passive: false });

editorTabBar?.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!delta) return;
  const maxScrollLeft = Math.max(0, editorTabBar.scrollWidth - editorTabBar.clientWidth);
  if (!maxScrollLeft) return;
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, editorTabBar.scrollLeft + delta));
  if (nextScrollLeft === editorTabBar.scrollLeft) return;
  event.preventDefault();
  editorTabBar.scrollLeft = nextScrollLeft;
}, { passive: false });
















// --- Chat history popover -----------------------------------------------











const initialChatSession = createChatSession("New Agent");
clearChatSessionState(initialChatSession);
chatSessions.push(initialChatSession);
appState.activeChatSessionId = chatSessions[0].id;
appState.chatHistory = chatSessions[0].history;
appState.contextFilesCache = chatSessions[0].contextFilesCache;


appState.modelSettings = loadModelSettings();
// Model settings and context counters are initialized before the initial mode
// sync because the context indicator reads both of them.
syncChatModeUi();













































contextBlocksList?.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-block-pin]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const index = Number(button.getAttribute("data-block-pin"));
  if (Number.isSafeInteger(index)) void pinContextBlock(index, button.getAttribute("aria-pressed") !== "true");
});


memorySaveBanner?.querySelector(".memory-save-banner-close")?.addEventListener("click", () => {
  const session = activeChatSession();
  if (session?.memorySaveHealth) session.memorySaveDismissed = session.memorySaveHealth.reason;
  memorySaveBanner.hidden = true;
});









setExplorerActionsEnabled(false);

btnNewFile.addEventListener("click", () => createNewItemInput(false));
btnNewFolder.addEventListener("click", () => createNewItemInput(true));
fileTree?.addEventListener("click", (event) => {
  if (event.target?.closest?.(".tree-item")) return;
  selectItem(null);
});



















// ── File Explorer ─────────────────────────────────────────────────────────────

btnOpenFolder?.addEventListener("click", openFolder);
btnSidebarMore?.addEventListener("click", () => openQuickPalette("command"));
activityExplorer?.addEventListener("click", () => {
  activateSidebarView("explorer");
});
activitySearch?.addEventListener("click", () => openQuickPalette("search"));
activityRun?.addEventListener("click", () => runActiveCode());
  activityBugBounty?.addEventListener("click", () => {
    // The Project activity icon owns only the file-tree pane. It must never
    // replace the active editor, special tab, or chat workspace.
    if (appState.sidebarCollapsed) {
      setSidebarView("project");
      setSidebarCollapsed(false);
      return;
    }
    setSidebarCollapsed(true);
  });
activitySecurity?.addEventListener("click", () => showSecurityWorkspace());
activityTerminal?.addEventListener("click", () => {
  setTerminalCollapsed(!appState.terminalCollapsed);
  if (!appState.terminalCollapsed) TerminalManager.focusActive();
});
activityChat?.addEventListener("click", () => {
  if (appState.chatCollapsed) openChatPane({ createIfEmpty: true });
  else setChatCollapsed(true);
});



function openBrowserTab() {
  if (!openTabs.has(BROWSER_TAB_PATH)) openTabs.set(BROWSER_TAB_PATH, {
    path: BROWSER_TAB_PATH,
    diskPath: BROWSER_TAB_PATH,
    name: "Browser",
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
    special: "browser",
  });
  switchToBrowserTab();
}

function switchToBrowserTab() {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  commitActiveTab();
  appState.activeTabPath = BROWSER_TAB_PATH;
  appState.editorLoadedPath = null;
  renderTabs();
  renderEditor({ focusEditor: false });
}

function showBrowserWorkspaceContent() {
  appState.currentWorkspaceMode = "browser";
  if (editorTabBar) editorTabBar.hidden = false;
  if (editorBody) editorBody.hidden = true;
  if (resourceViewer) resourceViewer.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (webcloneWorkspace) webcloneWorkspace.hidden = true;
  if (assessmentModuleView) { assessmentModuleView.hidden = true; appState.assessmentModuleActive = false; }
  window.api.webCloneHidePreview?.();
  editorPane?.setAttribute("aria-label", "Browser workspace");
  updateEditorPathBar();
  appState.browserWorkspace?.setVisible(true);
  syncWorkspaceActivity();
}




activitySettings?.addEventListener("click", openAppSettings);
btnBugBountyMore?.addEventListener("click", () => openQuickPalette("command"));
btnCreateProjectHeader?.addEventListener("click", createProject);
btnCreateProject?.addEventListener("click", createProject);
btnCreateProjectSidebar?.addEventListener("click", createProject);
btnOpenProjectSidebar?.addEventListener("click", openProject);
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
  if (!appState.assessmentPath) return;
  const result = await window.api.assessmentBuildContext({ path: appState.assessmentPath });
  if (result?.ok) { setAgentStatus(`${result.imported || 0} context source file(s) imported`); await refreshCustomTree(); }
  else if (result?.error) addErrorMessage(result.error);
});





$("btn-custom-file")?.addEventListener("click", (event) => { event.stopPropagation(); beginCustomEntry("file"); });
$("btn-custom-folder")?.addEventListener("click", (event) => { event.stopPropagation(); beginCustomEntry("directory"); });
customContextDelete?.addEventListener("click", (event) => { event.stopPropagation(); deleteSelectedCustomEntries(); });
document.addEventListener("click", (event) => { if (!event.target.closest("#custom-context-menu")) closeCustomContextMenu(); });
document.addEventListener("click", (event) => {
  if (!event.target.closest("#workspace-context-menu")) closeWorkspaceContextMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#editor-tab-context-menu")) closeEditorTabContextMenu();
});
editorTabContextMenu?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-editor-tab-action]")?.dataset.editorTabAction;
  if (!action) return;
  event.stopPropagation();
  void handleEditorTabContextMenuAction(action);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCustomContextMenu();
    closeWorkspaceContextMenu();
    closeEditorTabContextMenu();
  }
});
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
document.addEventListener("click", (event) => {
  const identityAction = event.target.closest("#security-proxy-browser-menu [data-proxy-identity]");
  if (identityAction) {
    event.preventDefault();
    event.stopPropagation();
    closeProxyBrowserMenu();
    launchProxyBrowser(identityAction.dataset.proxyIdentity || "");
    return;
  }
  if (event.target.closest("#security-proxy-browser")) {
    event.stopPropagation();
    closeProxyBrowserMenu();
    openBrowserTab();
  }
});
document.addEventListener("contextmenu", (event) => {
  if (!event.target.closest("#security-proxy-browser")) return;
  event.preventDefault();
  event.stopPropagation();
  chooseProxyBrowserIdentity();
});
securityHistoryToggle?.addEventListener("click", () => setSecurityHistoryVisible(securityHistoryPanel?.hidden));
securityHistoryRefresh?.addEventListener("click", loadSecurityHistory);
securityHistorySortHeaders.forEach((header) => header.querySelector("button")?.addEventListener("click", () => setSecurityHistorySort(header.dataset.historySort)));
securityHistoryMenu?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "analyze-agent") {
    analyzeSecurityExchange(appState.securityHistoryRecords[appState.securityHistoryMenuIndex]);
    return;
  }
  if (action === "delete") {
    deleteSelectedSecurityHistoryRecords();
    return;
  }
  if (action === "send-repeater") {
    sendHistoryRecordsToRepeater(selectedSecurityHistoryRecords());
    return;
  }
  if (action === "send-intruder") {
    sendHistoryRecordsToIntruder(selectedSecurityHistoryRecords());
  }
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
securityRequestEditor?.addEventListener("input", onSecurityRequestChanged);
securityResponseEditor?.addEventListener("input", syncSecurityExchangeSizes);
securityRepeaterAdd?.addEventListener("click", createWorkbenchTab);
securityRepeaterPrev?.addEventListener("click", () => stepRepeaterHistory(-1));
securityRepeaterNext?.addEventListener("click", () => stepRepeaterHistory(1));
securityIntruderTabButtons.forEach((button) => {
  button.addEventListener("click", () => setIntruderTab(button.dataset.intruderTab));
});
securityAttackButtons.forEach((button) => {
  button.addEventListener("click", () => setAttackType(button.dataset.attackType));
});
securityPositionMark?.addEventListener("click", markSelectionAsPosition);
securityPositionAuto?.addEventListener("click", autoDetectPositions);
securityPositionClear?.addEventListener("click", clearPayloadPositions);
securityPayloadJsonToggle?.addEventListener("click", () => {
  if (!securityPayloadPanel) return;
  const showJson = securityPayloadPanel.hidden;
  securityPayloadPanel.hidden = !showJson;
  securityPayloadJsonToggle.setAttribute("aria-pressed", String(showJson));
  if (!showJson) renderPayloadSets();
});
securityPayloadEditor?.addEventListener("input", () => {
  saveSecurityDraft();
  renderPayloadSets();
});
terminalShellTab?.addEventListener("click", () => TerminalManager.focusActive());
document.addEventListener("click", (event) => {
  if (!securityToolMenu?.hidden && !securityToolSwitcher?.contains(event.target)) closeSecurityToolMenu();
  const proxyWrap = document.getElementById("security-proxy-browser-wrap") || securityProxyBrowserWrap;
  const proxyMenu = document.getElementById("security-proxy-browser-menu") || securityProxyBrowserMenu;
  if (proxyMenu && !proxyMenu.hidden && !proxyWrap?.contains(event.target) && !proxyMenu.contains(event.target)) closeProxyBrowserMenu();
});
window.api.onIdentityStatus?.((snapshot) => {
  if (appState.appSettingsSection !== "project") return;
  const rendered = renderIdentitySettings(snapshot);
  if (snapshot?.ok === false || snapshot?.error) setIdentitySettingsStatus(snapshot.error?.message || snapshot.error || "Identity settings unavailable.", "error");
  else if (rendered.credentialListError) setIdentitySettingsStatus(rendered.credentialListError, "error");
  else if (rendered.secureStorageUnavailable) setIdentitySettingsStatus("Windows secure storage is unavailable. Test credentials and authenticated browser state cannot be saved.", "error");
  else if (rendered.missingSelectionReset) setIdentitySettingsStatus("The saved authentication source no longer exists. Selection reset to None; save project settings to keep the change.", "error");
  else setIdentitySettingsStatus("Identity status updated.");
});
window.api.onIdentityPersistence?.((event) => {
  if (appState.appSettingsSection !== "project") return;
  if (event?.ok === false) {
    setIdentitySettingsStatus(event.message || "Refreshed identity state could not be saved; XEKUTE will retry after the next action.", "error");
  } else if (event?.recovered) {
    setIdentitySettingsStatus("Identity state persistence recovered.", "success");
  }
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
  if (item.dataset.bountyFolder === "WebClone") { await showWebCloneWorkspace(); return; }
  if (item.dataset.bountyFolder) return;
  await openAssessmentItem(item);
});

webcloneBuildAction?.addEventListener("click", buildWebClone);
webclonePreviewAction?.addEventListener("click", () => toggleWebClonePreview(webclonePreviewPane?.hidden !== false));
webclonePreviewClose?.addEventListener("click", () => toggleWebClonePreview(false));
webcloneFilesToggle?.addEventListener("click", () => setWebCloneFilesCollapsed(!appState.webcloneFilesCollapsed));
if (webclonePreviewFrame && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncWebClonePreviewBounds).observe(webclonePreviewFrame);
}
$("app-settings-close")?.addEventListener("click", () => { appSettingsOverlay.hidden = true; });
projectSettingsCreate?.addEventListener("click", createProject);
projectSettingsOpen?.addEventListener("click", openProject);
projectSettingsNavButtons.forEach((button) => button.addEventListener("click", () => {
  setProjectSettingsTarget(button.dataset.projectSettingsTarget, { scroll: true });
}));
projectSettingsNav?.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!delta) return;
  const maxScrollLeft = Math.max(0, projectSettingsNav.scrollWidth - projectSettingsNav.clientWidth);
  if (!maxScrollLeft) return;
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, projectSettingsNav.scrollLeft + delta));
  if (nextScrollLeft === projectSettingsNav.scrollLeft) return;
  event.preventDefault();
  projectSettingsNav.scrollLeft = nextScrollLeft;
}, { passive: false });
projectSettingsForm?.addEventListener("input", (event) => {
  if (!event.target.closest("[data-project-field]")) return;
  scheduleProjectProfileAutosave();
  if (event.target.dataset.projectField === "project.name" && projectSettingsName) {
    projectSettingsName.textContent = event.target.value.trim() || projectName(appState.rootPath || "Project");
  }
});
guidanceNew?.addEventListener("click", beginGuidanceCreate);
guidanceEmptyNew?.addEventListener("click", beginGuidanceCreate);
guidanceImport?.addEventListener("click", importGuidanceFiles);
guidanceScopeTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-guidance-scope]");
  if (!button) return;
  appState.guidanceScope = button.dataset.guidanceScope || "all";
  localStorage.setItem("pointer:guidanceScope", appState.guidanceScope);
  renderGuidanceSettings();
});
mcpSettingsTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mcp-scope]");
  if (!button) return;
  appState.mcpScope = button.dataset.mcpScope || "all";
  localStorage.setItem("pointer:mcpScope", appState.mcpScope);
  renderMcpSettings();
});
kaliAccessEnabled?.addEventListener("change", () => {
  document.getElementById("kali-access-panel")?.classList.toggle("is-enabled", kaliAccessEnabled.checked);
  if (kaliAccessFields) kaliAccessFields.hidden = !kaliAccessEnabled.checked;
  if (kaliAccessEnabled.checked) setKaliAccessStatus("Enter the Kali SSH details. Changes save automatically; test when ready.");
  else saveKaliAccess(null, { quiet: true });
});
kaliAccessForm?.addEventListener("submit", saveKaliAccess);
kaliAccessFields?.addEventListener("input", () => queueKaliAccessAutosave());
kaliAccessAcceptHostKey?.addEventListener("change", () => queueKaliAccessAutosave(0));
kaliAccessTest?.addEventListener("click", testKaliAccess);
kaliAccessOpenMcp?.addEventListener("click", () => openMcpConfig(appState.mcpScope === "project" ? "project" : "global"));
kaliAccessKeyBrowse?.addEventListener("click", async () => {
  const result = await window.api.kaliAccessPickIdentity?.();
  if (result?.ok && result.filePath && kaliAccessKey) {
    kaliAccessKey.value = result.filePath;
    queueKaliAccessAutosave(0);
  }
});
btnNotifications?.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = notificationPanel?.hidden !== false;
  if (notificationPanel) notificationPanel.hidden = !opening;
  btnNotifications.setAttribute("aria-expanded", String(opening));
  if (opening) requestAnimationFrame(positionNotificationPanel);
});
globalThis.addEventListener("resize", positionNotificationPanel);
notificationClear?.addEventListener("click", () => {
  // Deferred updates remain reachable until installed or superseded.
  setNotifications([]);
});
document.addEventListener("click", (event) => {
  if (notificationPanel && !notificationPanel.hidden && !notificationPanel.contains(event.target) && !btnNotifications?.contains(event.target)) {
    notificationPanel.hidden = true;
    btnNotifications?.setAttribute("aria-expanded", "false");
  }
});

// In-app update wiring
updateToastInstall?.addEventListener("click", beginUpdateInstall);
updateToastIgnore?.addEventListener("click", ignoreCurrentUpdate);
generalUpdatesToggle?.addEventListener("change", () => {
  window.api.updatesSettingsSet?.({ checkOnLaunch: Boolean(generalUpdatesToggle.checked) }).catch(() => {});
});
certificateBrowse?.addEventListener("click", chooseCertificateDirectory);
certificateReset?.addEventListener("click", resetCertificateDirectory);
identityRefresh?.addEventListener("click", loadIdentitySettings);
identityCreate?.addEventListener("click", createIdentityFromSettings);
identityList?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-identity-action]");
  if (!button) return;
  handleIdentityAction(button.dataset.identityAction || "", button.dataset.identityId || "");
});
identityImport?.addEventListener("click", importIdentityStateFromSettings);
credentialCreate?.addEventListener("click", createCredentialFromSettings);
credentialList?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-credential-action]");
  if (!button) return;
  handleCredentialAction(button.dataset.credentialAction || "", button.dataset.credentialId || "");
});
engagementAccountAdd?.addEventListener("click", () => {
  appendEngagementAccountRow();
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Account details save automatically";
});
engagementAccountList?.addEventListener("input", () => {
  scheduleProjectProfileAutosave();
});
engagementAccountList?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-engagement-account-delete]");
  if (!button || button.disabled) return;
  deleteEngagementAccountRow(button.closest(".engagement-account-row"));
});
projectAuthSource?.addEventListener("change", () => {
  markAuthenticationSourceChanged();
  setIdentitySettingsStatus("Authentication source changed. Save project settings to keep this choice.");
});
ollamaHostTest?.addEventListener("click", testOllamaSettings);
ollamaHostReset?.addEventListener("click", resetOllamaSettings);
llmSettingsTest?.addEventListener("click", testLlmSettings);
llmProvider?.addEventListener("change", () => {
  syncLlmProviderUi(llmProvider.value);
  if (llmSettingsStatus) {
    llmSettingsStatus.textContent = llmProvider.value === "openrouter"
      ? "OpenRouter selected · saving automatically"
      : "Ollama selected · saving automatically";
  }
  queueLlmSettingsAutosave(0);
});
llmOllamaEnableToggle?.addEventListener("change", () => {
  const provider = llmOllamaEnableToggle.checked ? "ollama" : "openrouter";
  if (llmProvider) llmProvider.value = provider;
  syncLlmProviderUi(provider);
  if (llmSettingsStatus) {
    llmSettingsStatus.textContent = provider === "openrouter"
      ? "OpenRouter selected · saving automatically"
      : "Ollama selected · saving automatically";
  }
  queueLlmSettingsAutosave(0);
});
llmOpenRouterKeyToggle?.addEventListener("change", syncOpenRouterApiFieldsUi);
llmOpenRouterBaseToggle?.addEventListener("change", () => {
  syncOpenRouterApiFieldsUi();
  queueLlmSettingsAutosave(0);
});
llmOllamaEndpointToggle?.addEventListener("change", () => {
  syncOllamaApiFieldsUi();
  queueLlmSettingsAutosave(0);
});
openRouterApiKey?.addEventListener("change", () => queueLlmSettingsAutosave(0));
openRouterBaseUrl?.addEventListener("input", () => queueLlmSettingsAutosave());
ollamaHostInput?.addEventListener("input", () => queueLlmSettingsAutosave());
modelsSettingsSearch?.addEventListener("input", () => {
  appState.modelsSettingsDisplayLimit = MODELS_SETTINGS_PAGE_SIZE;
  renderModelsSettingsList();
});
modelsSettingsSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const name = addCustomModelName(modelsSettingsSearch.value);
  if (!name) return;
  modelsSettingsSearch.value = "";
  appState.modelsSettingsDisplayLimit = MODELS_SETTINGS_PAGE_SIZE;
  renderModelsSettingsList();
  renderExploreSubagentSelect();
});
modelsSettingsRefresh?.addEventListener("click", () => refreshModelsSettingsPanel());
modelsViewAllBtn?.addEventListener("click", () => {
  appState.modelsSettingsDisplayLimit += MODELS_SETTINGS_PAGE_SIZE;
  renderModelsSettingsList();
});
modelsExploreSubagent?.addEventListener("change", () => {
  const value = modelsExploreSubagent.value;
  if (!value) return;
  localStorage.setItem(EXPLORE_SUBAGENT_MODEL_KEY, value);
});
certificateOpenFolder?.addEventListener("click", async () => {
  const result = await window.api.showCertificateDirectory?.();
  if (result?.error) addErrorMessage(result.error);
});
appSettingsSectionButtons.forEach((button) => button.addEventListener("click", () => setAppSettingsSection(button.dataset.appSettingsSection)));
generalStatusBarToggle?.addEventListener("change", () => {
  updateGeneralSettings({ showStatusBar: generalStatusBarToggle.checked });
});
appSettingsSearch?.addEventListener("input", () => filterAppSettingsNavigation(appSettingsSearch.value));
document.addEventListener("keydown", (event) => {
  if (appState.currentWorkspaceMode !== "settings" || !event.ctrlKey || event.key.toLowerCase() !== "f") return;
  event.preventDefault();
  appSettingsSearch?.focus();
  appSettingsSearch?.select();
});
$("app-settings-dialog")?.addEventListener("submit", (event) => { event.preventDefault(); localStorage.setItem(CUSTOM_COMMANDS_KEY, customCommandsInput.value); if (commandRegistryInput?.value.trim()) { try { JSON.parse(commandRegistryInput.value); localStorage.setItem(COMMAND_REGISTRY_KEY, commandRegistryInput.value); } catch { addErrorMessage("Command registry must be valid JSON."); return; } } else localStorage.removeItem(COMMAND_REGISTRY_KEY); appSettingsOverlay.hidden = true; renderSlashSuggestions(); });
explorerRootToggle?.addEventListener("click", () => {
  if (!appState.rootPath) return;
  setExplorerRootExpanded(!appState.explorerRootExpanded);
});




// Zoom is applied as native page zoom. The chosen level is kept, but the
// applied level is capped so the layout always has at least this many CSS
// pixels; growing the window restores the chosen level.
const UI_MIN_LAYOUT_WIDTH = 640;
const UI_MIN_LAYOUT_HEIGHT = 480;

function applyUiZoom() {
  if (!window.api?.setUiZoom) return;
  const current = Number(window.api.getUiZoom?.()) || 1;
  const fit = Math.min(
    (window.innerWidth * current) / UI_MIN_LAYOUT_WIDTH,
    (window.innerHeight * current) / UI_MIN_LAYOUT_HEIGHT,
  );
  const next = Math.max(0.5, Math.min(appState.uiZoom, Math.floor(fit * 100) / 100));
  if (Math.abs(next - current) > 0.001) window.api.setUiZoom(next);
}

function setUiZoom(value) {
  appState.uiZoom = Math.round(Math.max(0.8, Math.min(1.5, Number(value) || 1)) * 10) / 10;
  localStorage.setItem(UI_ZOOM_KEY, String(appState.uiZoom));
  applyUiZoom();
}

window.addEventListener("resize", applyUiZoom);

function syncMinimapMenu() {
  const button = appMenu?.querySelector('[data-action="toggle-minimap"]');
  if (!button) return;
  const enabled = Boolean(EditorManager?.isMinimapEnabled?.());
  button.textContent = enabled ? "Hide Minimap" : "Show Minimap";
  button.setAttribute("aria-checked", String(enabled));
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

setUiZoom(appState.uiZoom);
syncMinimapMenu();



async function runMenuAction(action) {
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
    "open-project",
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
    "toggle-minimap",
    "show-project",
    "show-security",
    "show-settings",
    "help-guide",
    "new-chat",
    "about",
    "configure-run",
        "run-code",
        "check-updates",
      ]);
  if (!focusedActions.has(action)) return;
  switch (action) {
    case "new-file":
      if (!appState.rootPath) {
        await AppDialog.alert("Open a folder first.", { title: "Folder required" });
        return;
      }
      createNewItemInput(false);
      break;
    case "new-folder":
      if (!appState.rootPath) {
        await AppDialog.alert("Open a folder first.", { title: "Folder required" });
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
      setTerminalCollapsed(!appState.terminalCollapsed);
      break;
    case "toggle-chat":
      if (appState.chatCollapsed) openChatPane({ createIfEmpty: true });
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
    case "open-project":
      openProject();
      break;
    case "save-file":
      if (appState.resourceCurrentFilePath && resourceViewer && !resourceViewer.hidden) saveResourceChanges();
      else saveActiveTab();
      break;
    case "close-editor":
      if (appState.activeTabPath) closeTab(appState.activeTabPath);
      break;
    case "select-all":
      document.execCommand("selectAll");
      break;
    case "zoom-in":
      setUiZoom(appState.uiZoom + 0.1);
      break;
    case "zoom-out":
      setUiZoom(appState.uiZoom - 0.1);
      break;
    case "zoom-reset":
      setUiZoom(1);
      break;
    case "toggle-minimap":
      EditorManager?.toggleMinimap?.();
      syncMinimapMenu();
      break;
    case "show-project":
      activateSidebarView("project");
      break;
    case "show-security":
      showSecurityWorkspace();
      break;
    case "show-settings":
      openAppSettings();
      break;
    case "help-guide":
          showHelpGuide();
          break;
        case "check-updates":
          runUpdateCheck(true);
          break;
    case "new-chat":
      newChatSession();
      break;
    case "about":
      await AppDialog.alert("XEKUTE — local-first penetration testing and vulnerability assessment workspace", { title: "About XEKUTE" });
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


function quickShortcutLabel(keys) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return keys.replace(/Ctrl/g, isMac ? "Cmd" : "Ctrl");
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
      detail: appState.rootPath ? "Open a file by name" : "Create or open a project first",
      icon: "codicon-go-to-file",
      key: quickShortcutLabel("Ctrl+P"),
      disabled: !appState.rootPath,
      run: () => openQuickPalette("file"),
    },
    {
      title: "Search: Project",
      detail: appState.rootPath ? `Search ${projectName(appState.rootPath)}` : "Open a project first",
      icon: "codicon-search",
      key: quickShortcutLabel("Ctrl+F"),
      disabled: !appState.rootPath,
      run: () => openQuickPalette("search"),
    },
    {
      title: "Project: Create New Project",
      detail: "Create a blank project folder without scaffolding files",
      icon: "codicon-folder-library",
      run: () => createProject(),
    },
    {
      title: "Project: Open Existing Project",
      detail: appState.rootPath || "Choose an existing folder",
      icon: "codicon-folder-library",
      run: () => openProject(),
    },
    {
      title: "Security: Open Workbench",
      detail: "Show Interceptor, Repeater, and Intruder in the workspace",
      icon: "codicon-shield",
      run: () => showSecurityWorkspace(),
    },
    {
      title: "Terminal: Toggle",
      detail: appState.terminalCollapsed ? "Show terminal" : "Hide terminal",
      icon: "codicon-terminal",
      key: "Ctrl+`",
      run: () => setTerminalCollapsed(!appState.terminalCollapsed),
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
      detail: appState.chatCollapsed ? "Show chat" : "Hide chat",
      icon: "codicon-comment-discussion",
      run: () => appState.chatCollapsed ? openChatPane({ createIfEmpty: true }) : setChatCollapsed(true),
    },
    {
      title: "Chat: New Session",
      detail: "Start a fresh chat",
      icon: "codicon-add",
      disabled: false,
      run: () => newChatSession(),
    },
  ];
}

function quickFileItems(query) {
  const files = ToolParser.parseProjectFiles(appState.dirMapCache || "");
  return files
    .map((file) => {
      const name = basenameOf(file);
      const score = Math.max(
        scoreQuickMatch(name, query) + 40,
        scoreQuickMatch(file, query),
      );
      return {
        title: name,
        detail: file,
        icon: "codicon-file",
        score,
        run: () => showResourcePreview(joinWorkspacePath(file), name, file, { icon: "codicon-file" }),
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

function highlightExactText(text, query, highlights = []) {
  const value = String(text || "");
  const needles = [...new Set((highlights.length ? highlights : [query]).map(String).filter(Boolean))]
    .filter((needle) => needle.length <= 200)
    .sort((a, b) => b.length - a.length);
  if (!needles.length) return escapeHtml(value);
  const comparable = value.toLowerCase();
  let cursor = 0;
  let html = "";
  while (cursor < value.length) {
    let foundIndex = -1;
    let foundNeedle = "";
    for (const needle of needles) {
      const index = comparable.indexOf(needle.toLowerCase(), cursor);
      if (index !== -1 && (foundIndex === -1 || index < foundIndex || index === foundIndex && needle.length > foundNeedle.length)) {
        foundIndex = index;
        foundNeedle = needle;
      }
    }
    if (foundIndex === -1) {
      html += escapeHtml(value.slice(cursor));
      break;
    }
    html += escapeHtml(value.slice(cursor, foundIndex));
    html += `<mark class="quick-match">${escapeHtml(value.slice(foundIndex, foundIndex + foundNeedle.length))}</mark>`;
    cursor = foundIndex + foundNeedle.length;
  }
  return html;
}

function setQuickSearchAssistVisible(_visible) {
  if (quickSearchAssist) quickSearchAssist.hidden = true;
  if (quickSearchHelp) quickSearchHelp.setAttribute("aria-expanded", "false");
  if (quickResults?.classList.contains("is-virtualized")) requestAnimationFrame(() => renderVirtualizedSearchResults());
}

function initializeAdvancedSearchHelp() {
  setQuickSearchAssistVisible(false);
}

function advancedSearchTokenRange() {
  if (!quickInput) return null;
  const cursor = quickInput.selectionStart ?? quickInput.value.length;
  let start = cursor;
  while (start > 0 && !/[\s(),]/.test(quickInput.value[start - 1])) start -= 1;
  return { start, end: cursor, value: quickInput.value.slice(start, cursor) };
}

function applyQuickSearchSuggestion(index = appState.quickSearchSuggestionSelection) {
  const suggestion = appState.quickSearchSuggestionItems[index];
  const range = appState.quickSearchSuggestionRange;
  if (!suggestion || !range || !quickInput) return false;
  quickInput.setRangeText(suggestion.insert, range.start, range.end, "end");
  quickSearchSuggestions.hidden = true;
  appState.quickSearchSuggestionItems = [];
  appState.quickSearchSuggestionRange = null;
  appState.quickSelection = 0;
  renderWorkspaceSearch();
  quickInput.focus();
  return true;
}

function renderQuickSearchSuggestions({ force = false } = {}) {
  if (!quickSearchSuggestions || appState.quickMode !== "search" || !quickSearchAssist?.hidden) {
    if (quickSearchSuggestions) quickSearchSuggestions.hidden = true;
    return;
  }
  const tokenRange = advancedSearchTokenRange();
  const rawToken = tokenRange?.value || "";
  const token = rawToken.replace(/^-/, "");
  const colon = token.indexOf(":");
  let items = [];
  let range = tokenRange;
  if (colon >= 0) {
    const name = token.slice(0, colon).toLowerCase();
    const typed = token.slice(colon + 1).toLowerCase();
    const operator = ADVANCED_SEARCH_OPERATORS.find((entry) => entry.name === name);
    if (operator?.values?.length) {
      const complete = operator.values.some((value) => value.toLowerCase() === typed);
      items = complete && !force ? [] : operator.values.filter((value) => !typed || value.toLowerCase().startsWith(typed)).slice(0, 8)
        .map((value) => ({ label: value, description: `${name}: value`, insert: value }));
      range = { start: tokenRange.start + rawToken.indexOf(":") + 1, end: tokenRange.end };
    }
  } else if (force || token.length >= 2) {
    items = ADVANCED_SEARCH_OPERATORS.filter((entry) => !token || entry.name.startsWith(token.toLowerCase())).slice(0, 8)
      .map((entry) => ({ label: `${entry.name}:`, description: entry.description, insert: `${rawToken.startsWith("-") ? "-" : ""}${entry.name}:` }));
  }
  appState.quickSearchSuggestionItems = items;
  appState.quickSearchSuggestionSelection = 0;
  appState.quickSearchSuggestionRange = range;
  quickSearchSuggestions.replaceChildren();
  if (!items.length) {
    quickSearchSuggestions.hidden = true;
    return;
  }
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-search-suggestion${index === 0 ? " active" : ""}`;
    button.innerHTML = `<code>${escapeHtml(item.label)}</code><span>${escapeHtml(item.description)}</span>`;
    button.addEventListener("mouseenter", () => {
      appState.quickSearchSuggestionSelection = index;
      [...quickSearchSuggestions.children].forEach((child, childIndex) => child.classList.toggle("active", childIndex === index));
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyQuickSearchSuggestion(index));
    quickSearchSuggestions.appendChild(button);
  });
  quickSearchSuggestions.hidden = false;
}

function extractAdvancedSearchChips(query) {
  const names = ADVANCED_SEARCH_OPERATORS.map((entry) => entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(`(^|[\\s(])(-?(?:${names})):(\\([^)]*\\)|"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s)]+)`, "gi");
  const chips = [];
  for (const match of String(query || "").matchAll(pattern)) {
    const leading = match[1]?.length || 0;
    chips.push({ label: `${match[2]}:${match[3]}`, start: match.index + leading, end: match.index + match[0].length });
  }
  return chips;
}

function renderAdvancedSearchChips() {
  if (!quickSearchChips) return;
  quickSearchChips.replaceChildren();
  const chips = appState.quickMode === "search" ? extractAdvancedSearchChips(quickInput?.value || "") : [];
  quickSearchChips.hidden = !chips.length;
  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-search-chip";
    button.title = "Remove this filter";
    button.innerHTML = `<span>${escapeHtml(chip.label)}</span><span class="codicon codicon-close"></span>`;
    button.addEventListener("click", () => {
      if (!quickInput) return;
      let start = chip.start;
      let end = chip.end;
      if (quickInput.value[start - 1] === "(" && quickInput.value[end] === ")") {
        start -= 1;
        end += 1;
      }
      const precedingConnector = quickInput.value.slice(0, start).match(/\s+(?:AND|OR)\s*$/);
      const followingConnector = quickInput.value.slice(end).match(/^\s*(?:AND|OR)\s+/);
      if (precedingConnector) start -= precedingConnector[0].length;
      else if (followingConnector) end += followingConnector[0].length;
      else if (start > 0 && /\s/.test(quickInput.value[start - 1])) start -= 1;
      else if (/\s/.test(quickInput.value[end] || "")) end += 1;
      quickInput.setRangeText("", start, end, "end");
      renderWorkspaceSearch();
      quickInput.focus();
    });
    quickSearchChips.appendChild(button);
  }
}

function formattedSearchSources(counts = {}) {
  const labels = { correlation: "Authorization", traffic: "Traffic", javascript: "JavaScript", evidence: "Evidence", tool: "Tools", asset: "Assets", code: "Code", workspace: "Files" };
  return Object.entries(counts).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5).map(([source, count]) => `${labels[source] || source} ${Number(count).toLocaleString()}`).join(" · ");
}

function setQuickSearchMeta(text, { error = false } = {}) {
  if (!quickMeta) return;
  quickMeta.hidden = false;
  quickMeta.textContent = text;
  quickMeta.classList.toggle("quick-meta-error", error);
}

function setQuickModeUi(mode) {
  const labels = {
    command: ["codicon-chevron-right", "Type a command", "Command Palette"],
    file: ["codicon-go-to-file", "Search files by name", "Quick Open"],
    search: ["codicon-search", "Search workspace text", "Workspace Search"],
  };
  const [icon, placeholder, title] = labels[mode] || labels.command;
  quickPanel?.setAttribute("aria-label", title);
  quickPanel?.classList.toggle("quick-panel-search", mode === "search");
  if (mode === "search") initializeAdvancedSearchHelp();
  else setQuickSearchAssistVisible(false);
  if (quickSearchHelp) quickSearchHelp.hidden = mode !== "search";
  if (quickSearchChips && mode !== "search") quickSearchChips.hidden = true;
  if (quickSearchSuggestions && mode !== "search") quickSearchSuggestions.hidden = true;
  if (quickInput) quickInput.placeholder = placeholder;
  if (quickIcon) quickIcon.className = `codicon ${icon}`;
}

function renderQuickList(items, metaText = "", { quietEmpty = false } = {}) {
  appState.quickItems = items;
  appState.quickSelection = Math.max(0, Math.min(appState.quickSelection, appState.quickItems.length - 1));
  quickPanel?.classList.toggle("quick-panel-minimal", quietEmpty);
  if (quickMeta) {
    quickMeta.textContent = metaText;
    quickMeta.hidden = quietEmpty;
    quickMeta.classList.remove("quick-meta-error");
  }
  if (!quickResults) return;
  quickResults.classList.remove("is-virtualized");
  quickResults.innerHTML = "";
  quickResults.hidden = quietEmpty;
  if (quietEmpty) return;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "quick-empty";
    empty.textContent = metaText || "No results";
    quickResults.appendChild(empty);
    return;
  }

  items.forEach((item, index) => quickResults.appendChild(createQuickResultRow(item, index)));
}

function createQuickResultRow(item, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.dataset.quickIndex = String(index);
  row.className = `quick-result${index === appState.quickSelection ? " active" : ""}`;
  row.innerHTML = `
    <span class="codicon ${escapeHtml(item.icon || "codicon-chevron-right")} quick-result-icon"></span>
    <span class="quick-result-main">
      <span class="quick-result-title">${escapeHtml(item.title || "")}</span>
      <span class="quick-result-detail">${item.detailHtml || escapeHtml(item.detail || "")}</span>
    </span>
    <span class="quick-result-key">${escapeHtml(item.key || "")}</span>
  `;
  row.addEventListener("mouseenter", () => {
    appState.quickSelection = index;
    if (quickResults?.classList.contains("is-virtualized")) {
      [...quickResults.querySelectorAll(".quick-result")].forEach((candidate) => {
        candidate.classList.toggle("active", Number(candidate.dataset.quickIndex) === appState.quickSelection);
      });
      return;
    }
    syncQuickSelection();
  });
  row.addEventListener("click", () => runSelectedQuickItem(index));
  return row;
}

function renderVirtualizedSearchResults(metaText = quickMeta?.textContent || "") {
  quickPanel?.classList.remove("quick-panel-minimal");
  if (quickMeta) {
    quickMeta.hidden = false;
    quickMeta.textContent = metaText;
    quickMeta.classList.remove("quick-meta-error");
  }
  if (!quickResults) return;
  quickResults.hidden = false;
  quickResults.classList.add("is-virtualized");
  if (!appState.quickItems.length) {
    quickResults.replaceChildren();
    if (String(metaText).startsWith("Searching")) return;
    const empty = document.createElement("div");
    empty.className = "quick-empty";
    empty.textContent = metaText || "No exact matches";
    quickResults.appendChild(empty);
    return;
  }

  const viewportHeight = quickResults.clientHeight || 480;
  const start = Math.max(0, Math.floor(quickResults.scrollTop / QUICK_SEARCH_ROW_HEIGHT) - QUICK_SEARCH_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / QUICK_SEARCH_ROW_HEIGHT) + (QUICK_SEARCH_OVERSCAN * 2);
  const end = Math.min(appState.quickItems.length, start + visibleCount);
  let space = quickResults.querySelector(":scope > .quick-results-virtual-space");
  if (!space) {
    space = document.createElement("div");
    space.className = "quick-results-virtual-space";
    quickResults.replaceChildren(space);
  }
  space.style.height = `${appState.quickItems.length * QUICK_SEARCH_ROW_HEIGHT}px`;
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    const row = createQuickResultRow(appState.quickItems[index], index);
    row.style.top = `${index * QUICK_SEARCH_ROW_HEIGHT}px`;
    fragment.appendChild(row);
  }
  space.replaceChildren(fragment);
}

function syncQuickSelection() {
  if (!quickResults) return;
  if (quickResults.classList.contains("is-virtualized")) {
    const rowTop = appState.quickSelection * QUICK_SEARCH_ROW_HEIGHT;
    const rowBottom = rowTop + QUICK_SEARCH_ROW_HEIGHT;
    let movedViewport = false;
    if (rowTop < quickResults.scrollTop) {
      quickResults.scrollTop = rowTop;
      movedViewport = true;
    }
    else if (rowBottom > quickResults.scrollTop + quickResults.clientHeight) {
      quickResults.scrollTop = Math.max(0, rowBottom - quickResults.clientHeight);
      movedViewport = true;
    }
    if (movedViewport) {
      renderVirtualizedSearchResults();
      return;
    }
    [...quickResults.querySelectorAll(".quick-result")].forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.quickIndex) === appState.quickSelection);
    });
    return;
  }
  [...quickResults.querySelectorAll(".quick-result")].forEach((row) => {
    const index = Number(row.dataset.quickIndex);
    row.classList.toggle("active", index === appState.quickSelection);
    if (index === appState.quickSelection) row.scrollIntoView({ block: "nearest" });
  });
}

function workspaceSearchResultItem(row, query) {
  const name = basenameOf(row.path);
  const sourceIcons = { correlation: "codicon-shield", traffic: "codicon-globe", finding: "codicon-warning", evidence: "codicon-archive", asset: "codicon-server", tool: "codicon-tools" };
  const line = Number(row.line) || parseSnippetLine(row.snippet);
  const column = Number(row.column) || 1;
  const matchDetail = row.lineText || firstSnippetLine(row.snippet);
  const detail = row.title && row.title !== row.path ? `${row.path} · ${matchDetail}` : matchDetail;
  const sourceLabel = row.source && !["workspace", "code"].includes(row.source)
    ? `${String(row.source).replace(/^./, (char) => char.toUpperCase())} · `
    : "";
  const item = {
    title: row.title || row.path,
    detail,
    detailHtml: highlightExactText(detail, query),
    icon: sourceIcons[row.source] || "codicon-file",
    key: row.key || `${sourceLabel}L${line}:C${column}`,
    run: async () => {
      await openFile(joinWorkspacePath(row.path), name, {
        focusEditor: true,
        line,
        column,
      });
    },
  };
  if (Array.isArray(row.highlights) && row.highlights.length || row.match) {
    item.detailHtml = highlightExactText(detail, query, Array.isArray(row.highlights) ? row.highlights : [row.match]);
  }
  return item;
}

function cancelActiveWorkspaceSearch() {
  const requestId = appState.quickSearchRequestId;
  appState.quickSearchRequestId = "";
  if (appState.quickSearchRenderFrame) cancelAnimationFrame(appState.quickSearchRenderFrame);
  if (appState.quickSearchScrollFrame) cancelAnimationFrame(appState.quickSearchScrollFrame);
  appState.quickSearchRenderFrame = 0;
  appState.quickSearchScrollFrame = 0;
  appState.quickSearchPendingRows = [];
  appState.quickSearchPendingTotal = 0;
  appState.quickSearchSourceCounts = {};
  if (requestId) void window.api.cancelWorkspaceSearch?.({ requestId });
}

function flushWorkspaceSearchRows(metaText = "") {
  if (appState.quickSearchRenderFrame) cancelAnimationFrame(appState.quickSearchRenderFrame);
  appState.quickSearchRenderFrame = 0;
  const query = (quickInput?.value || "").trim();
  const rows = appState.quickSearchPendingRows;
  appState.quickSearchPendingRows = [];
  appState.quickItems.push(...rows.map((row) => workspaceSearchResultItem(row, query)));
  const total = appState.quickSearchPendingTotal || appState.quickItems.length;
  const sources = formattedSearchSources(appState.quickSearchSourceCounts);
  const exactMatchLabel = `exact match${total === 1 ? "" : "es"}`;
  renderVirtualizedSearchResults(metaText || `Searching… ${total.toLocaleString()} ${sources ? `matches · ${sources}` : exactMatchLabel}`);
}

window.api.onWorkspaceSearchBatch?.((payload) => {
  if (!payload?.requestId || payload.requestId !== appState.quickSearchRequestId || appState.quickMode !== "search") return;
  const rows = Array.isArray(payload.results) ? payload.results : [];
  appState.quickSearchPendingRows.push(...rows);
  appState.quickSearchPendingTotal = Number(payload.totalCount) || appState.quickSearchPendingTotal;
  if (payload.sourceCounts && typeof payload.sourceCounts === "object") appState.quickSearchSourceCounts = { ...payload.sourceCounts };
  if (payload.done) {
    const result = payload.summary || {};
    if (result.cancelled) return;
    if (result.error) {
      appState.quickSearchPendingRows = [];
      appState.quickSearchPendingTotal = 0;
      appState.quickSearchRequestId = "";
      appState.quickItems = [];
      if (quickResults) {
        quickResults.replaceChildren();
        quickResults.hidden = true;
      }
      const column = Number(result.position) >= 0 ? ` at column ${Number(result.position) + 1}` : "";
      setQuickSearchMeta(`Query error${column}: ${result.error}`, { error: true });
      return;
    }
    if (result.sourceCounts && typeof result.sourceCounts === "object") appState.quickSearchSourceCounts = { ...result.sourceCounts };
    const total = Number(result.totalCount) || appState.quickSearchPendingTotal || appState.quickItems.length;
    const displayed = appState.quickItems.length + appState.quickSearchPendingRows.length;
    const kind = result.mode === "advanced" ? (result.correlation ? "authorization candidate" : "result") : "exact match";
    const sources = formattedSearchSources(appState.quickSearchSourceCounts);
    const skipped = Number(result.skippedLargeFiles) > 0 ? ` · ${Number(result.skippedLargeFiles).toLocaleString()} oversized file${Number(result.skippedLargeFiles) === 1 ? "" : "s"} skipped` : "";
    const meta = result.capped
      ? `${displayed.toLocaleString()} of ${total.toLocaleString()}+ ${kind}${displayed === 1 ? "" : "es"} — refine your search`
      : result.truncated
        ? (total > displayed
          ? `${displayed.toLocaleString()} of ${total.toLocaleString()} ${kind}${total === 1 ? "" : "es"} — refine your search`
          : `${total.toLocaleString()}+ ${kind}${total === 1 ? "" : "es"} — refine your search`)
        : `${total.toLocaleString()} ${kind}${total === 1 ? "" : "es"}`;
    flushWorkspaceSearchRows(`${meta}${sources ? ` · ${sources}` : ""}${skipped}`);
    appState.quickSearchRequestId = "";
    return;
  }
  if (!appState.quickSearchRenderFrame) {
    appState.quickSearchRenderFrame = requestAnimationFrame(() => flushWorkspaceSearchRows());
  }
});

quickResults?.addEventListener("scroll", () => {
  if (!quickResults.classList.contains("is-virtualized") || appState.quickSearchScrollFrame) return;
  appState.quickSearchScrollFrame = requestAnimationFrame(() => {
    appState.quickSearchScrollFrame = 0;
    renderVirtualizedSearchResults();
  });
}, { passive: true });

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
  if (!appState.rootPath) {
    renderQuickList([], "Open a folder to use Quick Open");
    return;
  }
  const items = quickFileItems(query);
  renderQuickList(items, `${items.length} file${items.length === 1 ? "" : "s"}`);
}

function renderWorkspaceSearch() {
  const query = (quickInput?.value || "").trim();
  if (appState.quickSearchTimer) clearTimeout(appState.quickSearchTimer);
  cancelActiveWorkspaceSearch();
  renderAdvancedSearchChips();
  renderQuickSearchSuggestions();
  if (query.length < 2) {
    renderQuickList([], "", { quietEmpty: true });
    return;
  }
  if (!appState.rootPath) {
    renderQuickList([], "Create or open a Target to search its workspace");
    return;
  }

  const seq = ++appState.quickSearchSeq;
  const requestId = `workspace-search-${Date.now()}-${seq}`;
  appState.quickSearchRequestId = requestId;
  appState.quickItems = [];
  appState.quickSelection = 0;
  if (quickResults) quickResults.scrollTop = 0;
  appState.quickSearchSourceCounts = {};
  renderVirtualizedSearchResults("Searching workspace…");
  appState.quickSearchTimer = setTimeout(async () => {
    const result = await window.api.searchWorkspace({ workspace: appState.rootPath, query, limit: QUICK_SEARCH_RESULT_LIMIT, requestId });
    if (seq !== appState.quickSearchSeq || appState.quickMode !== "search" || requestId !== appState.quickSearchRequestId) return;
    if (result?.error) {
      appState.quickSearchRequestId = "";
      appState.quickSearchPendingRows = [];
      appState.quickSearchPendingTotal = 0;
      if (quickResults) {
        quickResults.replaceChildren();
        quickResults.hidden = true;
      }
      const column = Number(result.position) >= 0 ? ` at column ${Number(result.position) + 1}` : "";
      setQuickSearchMeta(`Query error${column}: ${result.error}`, { error: true });
    }
  }, QUICK_SEARCH_DEBOUNCE_MS);
}

function renderQuickPalette() {
  if (appState.quickMode === "file") renderQuickFiles();
  else if (appState.quickMode === "search") renderWorkspaceSearch();
  else renderCommandPalette();
}

async function openQuickPalette(mode = "command", initialValue = "") {
  if (!quickOverlay || !quickInput) return;
  appState.quickMode = mode;
  appState.quickSelection = 0;
  setQuickModeUi(mode);
  if (mode === "file" && appState.rootPath && !appState.dirMapCache) await refreshDirMap();
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
  if (appState.quickSearchTimer) clearTimeout(appState.quickSearchTimer);
  cancelActiveWorkspaceSearch();
  appState.quickSearchSeq += 1;
  appState.quickItems = [];
  setQuickSearchAssistVisible(false);
  if (quickSearchSuggestions) quickSearchSuggestions.hidden = true;
  if (appState.activeTabPath) EditorManager.focus();
  else chatInput?.focus();
}

async function runSelectedQuickItem(index = appState.quickSelection) {
  const item = appState.quickItems[index];
  if (!item) return;
  closeQuickPalette();
  await item.run?.();
}

quickInput?.addEventListener("input", () => {
  appState.quickSelection = 0;
  renderQuickPalette();
});

quickInput?.addEventListener("keydown", (e) => {
  const suggestionsOpen = quickSearchSuggestions && !quickSearchSuggestions.hidden && appState.quickSearchSuggestionItems.length;
  if (appState.quickMode === "search" && e.ctrlKey && e.code === "Space") {
    e.preventDefault();
    renderQuickSearchSuggestions({ force: true });
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (suggestionsOpen) {
      quickSearchSuggestions.hidden = true;
      appState.quickSearchSuggestionItems = [];
      return;
    }
    if (quickSearchAssist && !quickSearchAssist.hidden) {
      setQuickSearchAssistVisible(false);
      return;
    }
    closeQuickPalette();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (suggestionsOpen) {
      appState.quickSearchSuggestionSelection = (appState.quickSearchSuggestionSelection + 1) % appState.quickSearchSuggestionItems.length;
      [...quickSearchSuggestions.children].forEach((child, index) => child.classList.toggle("active", index === appState.quickSearchSuggestionSelection));
      return;
    }
    appState.quickSelection = appState.quickItems.length ? (appState.quickSelection + 1) % appState.quickItems.length : 0;
    syncQuickSelection();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (suggestionsOpen) {
      appState.quickSearchSuggestionSelection = (appState.quickSearchSuggestionSelection - 1 + appState.quickSearchSuggestionItems.length) % appState.quickSearchSuggestionItems.length;
      [...quickSearchSuggestions.children].forEach((child, index) => child.classList.toggle("active", index === appState.quickSearchSuggestionSelection));
      return;
    }
    appState.quickSelection = appState.quickItems.length ? (appState.quickSelection - 1 + appState.quickItems.length) % appState.quickItems.length : 0;
    syncQuickSelection();
    return;
  }
  if ((e.key === "Enter" || e.key === "Tab") && suggestionsOpen) {
    e.preventDefault();
    applyQuickSearchSuggestion();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    runSelectedQuickItem();
  }
});

quickSearchHelp?.addEventListener("click", (event) => {
  event.stopPropagation();
  setQuickSearchAssistVisible(false);
  quickInput?.focus();
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
























workspaceContextMenu?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-workspace-context-action]");
  if (!button || button.disabled) return;
  event.stopPropagation();
  await runWorkspaceContextAction(button.dataset.workspaceContextAction);
});

















AppDialog?.setAfterCloseHook?.(restoreChatComposerAfterUiAction);








// ── Tabs & Editor ─────────────────────────────────────────────────────────────




function isBrowserTab(tab) {
  return tab?.path === BROWSER_TAB_PATH || tab?.special === "browser";
}

















































function isMarkdownFileName(fileName = "") {
  return /\.(?:md|markdown)$/i.test(String(fileName || ""));
}

function setMarkdownViewMode(mode) {
  appState.markdownViewMode = mode === "md" ? "md" : "text";
  localStorage.setItem(MARKDOWN_VIEW_MODE_KEY, appState.markdownViewMode);
  renderTabs();
  renderEditor({ focusEditor: false });
}

function renderTabs() {
  editorTabBar.innerHTML = "";

  for (const [path, tab] of openTabs) {
    const el = document.createElement("div");
    el.className = "editor-tab"
      + (path === appState.activeTabPath ? " active" : "")
      + (tab.pinned ? " editor-tab-pinned" : "");
    const specialWorkspaceTab = isSettingsTab(tab) || isInterceptorTab(tab) || isBrowserTab(tab);
    if (specialWorkspaceTab) el.classList.add("special-workspace-tab");
    el.title = specialWorkspaceTab
      ? tab.name
      : (relativePathFromRoot(tab.diskPath) || tab.diskPath || tab.name);
    el.draggable = true;
    el.addEventListener("click", () => switchToTab(path));
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      switchToTab(path, { focusEditor: true });
    });
    el.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".tab-close, .tab-pin")) return;
      event.preventDefault();
      event.stopPropagation();
      openEditorTabContextMenu(event.clientX, event.clientY, path);
    });
    el.addEventListener("dragstart", (event) => {
      if (event.target.closest(".tab-close, .tab-pin")) {
        event.preventDefault();
        return;
      }
      appState.draggedEditorTabPath = path;
      el.classList.add("tab-dragging");
      event.dataTransfer?.setData("application/x-xekute-editor-tab", path);
      event.dataTransfer?.setData("text/plain", path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", (event) => {
      const draggedPath = appState.draggedEditorTabPath || event.dataTransfer?.getData("application/x-xekute-editor-tab");
      if (!draggedPath || draggedPath === path) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setEditorTabDropIndicator(el, event);
    });
    el.addEventListener("dragleave", (event) => {
      if (!el.contains(event.relatedTarget)) el.classList.remove("tab-drop-before", "tab-drop-after");
    });
    el.addEventListener("drop", (event) => {
      const draggedPath = appState.draggedEditorTabPath || event.dataTransfer?.getData("application/x-xekute-editor-tab");
      if (!draggedPath || draggedPath === path) return;
      event.preventDefault();
      event.stopPropagation();
      const after = setEditorTabDropIndicator(el, event);
      clearEditorTabDropIndicators();
      reorderOpenTabs(draggedPath, path, { after });
    });
    el.addEventListener("dragend", () => {
      appState.draggedEditorTabPath = null;
      el.classList.remove("tab-dragging");
      clearEditorTabDropIndicators();
    });

    const icon = document.createElement("span");
    const specialIcon = isSettingsTab(tab)
      ? "codicon-settings-gear"
      : isInterceptorTab(tab)
        ? "codicon-debug-disconnect"
        : isBrowserTab(tab) ? "codicon-globe" : "";
    if (specialIcon) {
      icon.className = `tab-icon codicon ${specialIcon}`;
    } else {
      const info = SetiIconTheme.iconForFile(tab.name);
      icon.className = "tab-icon seti-icon";
      icon.textContent = info.glyph;
      icon.style.color = info.color;
    }
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "tab-label" + (tab.dirty ? " tab-dirty" : "");
    label.textContent = tab.name;

    let pin = null;
    if (tab.pinned) {
      pin = document.createElement("button");
      pin.className = "tab-pin";
      pin.title = "Unpin";
      pin.draggable = false;
      pin.innerHTML = '<span class="codicon codicon-pinned"></span>';
      pin.addEventListener("click", (event) => {
        event.stopPropagation();
        unpinEditorTab(path);
      });
    }

    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close";
    close.draggable = false;
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (e) => { void closeTab(path, e); });

    el.appendChild(icon);
    el.appendChild(label);
    if (pin) el.appendChild(pin);
    el.appendChild(close);
    editorTabBar.appendChild(el);
  }

  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (activeTab && isMarkdownFileName(activeTab.name)) {
    const actions = document.createElement("div");
    actions.className = "editor-tab-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Markdown view");

    const switcher = document.createElement("div");
    switcher.className = "editor-tab-view-switch";
    for (const mode of ["md", "text"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = mode === "md" ? "MD" : "Text";
      button.dataset.markdownView = mode;
      button.setAttribute("aria-pressed", String(appState.markdownViewMode === mode));
      button.classList.toggle("active", appState.markdownViewMode === mode);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setMarkdownViewMode(mode);
      });
      switcher.appendChild(button);
    }
    actions.appendChild(switcher);
    editorTabBar.appendChild(actions);
  }

  updateEditorPathBar();
}

function updateEditorPathBar() {
  if (!editorPathBar || !editorPathLabel) return;
  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (!activeTab || isSettingsTab(activeTab) || isInterceptorTab(activeTab) || isBrowserTab(activeTab)) {
    editorPathBar.hidden = true;
    editorPathLabel.textContent = "";
    editorPathLabel.removeAttribute("title");
    return;
  }
  const filePath = activeTab.diskPath || activeTab.path || "";
  const relativePath = relativePathFromRoot(filePath);
  const projectPath = relativePath === null ? (activeTab.name || "") : relativePath;
  const displayPath = normPath(projectPath).replace(/^\/+/, "");
  editorPathLabel.textContent = displayPath;
  editorPathBar.hidden = !displayPath;
  editorPathLabel.title = displayPath;
}

function updateTabDirtyIndicator() {
  const idx = [...openTabs.keys()].indexOf(appState.activeTabPath);
  const tabEl = editorTabBar.children[idx];
  const tab = openTabs.get(appState.activeTabPath);
  tabEl?.querySelector(".tab-label")?.classList.toggle("tab-dirty", !!tab?.dirty);
}

async function renderEditor({ focusEditor = true } = {}) {
  if (markdownPreview) markdownPreview.hidden = true;

  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (isBrowserTab(activeTab)) {
    showBrowserWorkspaceContent();
    return;
  }
  appState.browserWorkspace?.setVisible(false);
  if (isSettingsTab(activeTab)) {
    if (editorEmpty) editorEmpty.setAttribute("hidden", "");
    if (editorView) editorView.setAttribute("hidden", "");
    if (monacoContainer) monacoContainer.hidden = true;
    if (settingsUIView) settingsUIView.hidden = true;
    if (markdownPreview) markdownPreview.hidden = true;
    if (settingsEditorToolbar) settingsEditorToolbar.hidden = true;
    appState.currentWorkspaceMode = "settings";
    if (editorTabBar) editorTabBar.hidden = false;
    if (editorBody) editorBody.hidden = true;
    updateEditorPathBar();
    if (resourceViewer) resourceViewer.hidden = true;
    if (securityWorkspace) securityWorkspace.hidden = true;
    if (webcloneWorkspace) webcloneWorkspace.hidden = true;
    if (assessmentModuleView) { assessmentModuleView.hidden = true; appState.assessmentModuleActive = false; }
    window.api.webCloneHidePreview?.();
    if (appSettingsWorkspace) appSettingsWorkspace.hidden = false;
    editorPane?.setAttribute("aria-label", "XEKUTE Settings");
    loadSettingsWorkspace();
    syncWorkspaceActivity();
    return;
  }

  if (isInterceptorTab(activeTab)) {
    if (editorEmpty) editorEmpty.setAttribute("hidden", "");
    if (editorView) editorView.setAttribute("hidden", "");
    if (monacoContainer) monacoContainer.hidden = true;
    if (settingsUIView) settingsUIView.hidden = true;
    if (markdownPreview) markdownPreview.hidden = true;
    if (settingsEditorToolbar) settingsEditorToolbar.hidden = true;
    showSecurityWorkspaceContent(activeTab.securityTool || "");
    return;
  }

  if (!appState.activeTabPath || !openTabs.has(appState.activeTabPath)) {
    if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
    if (securityWorkspace) securityWorkspace.hidden = true;
    appState.currentWorkspaceMode = "editor";
    if (editorBody) editorBody.hidden = false;
    editorEmpty.removeAttribute("hidden");
    editorView.setAttribute("hidden", "");
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  const tab = openTabs.get(appState.activeTabPath);
  const settingsTab = isAssessmentSettingsTab(tab);
  const markdownTab = isMarkdownFileName(tab.name);
  if (appSettingsWorkspace) appSettingsWorkspace.hidden = true;
  if (securityWorkspace) securityWorkspace.hidden = true;
  appState.currentWorkspaceMode = "editor";
  if (editorBody) editorBody.hidden = false;
  editorEmpty.setAttribute("hidden", "");
  editorView.removeAttribute("hidden");
  settingsEditorToolbar.hidden = !settingsTab;
  settingsUIView.hidden = true;
  monacoContainer.hidden = false;
  if (settingsTab) syncSettingsEditorButtons();

  if (tab.content === null && !tab.error) {
    editorError.hidden = true;
    appState.editorLoadedPath = null;
    try {
      await EditorManager.showTab(appState.activeTabPath, tab.name, "", { loading: true, focus: focusEditor });
    } catch (error) {
      editorError.hidden = false;
      editorError.textContent = `Editor failed to load: ${error?.message || error?.type || "Unknown editor error"}`;
    }
    return;
  }

  if (tab.error) {
    editorError.hidden = false;
    editorError.textContent = tab.error;
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  editorError.hidden = true;
  const text = tab.content ?? "";

  if (markdownTab && appState.markdownViewMode === "md") {
    monacoContainer.hidden = true;
    settingsUIView.hidden = true;
    markdownPreview.hidden = false;
    renderMarkdown(markdownPreview, text);
    return;
  }

  if (settingsTab && appState.settingsEditorMode === "ui") {
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
    appState.editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  if (appState.editorLoadedPath !== appState.activeTabPath) {
    try {
      await EditorManager.showTab(appState.activeTabPath, tab.name, text, { focus: focusEditor });
      appState.editorLoadedPath = appState.activeTabPath;
    } catch (error) {
      editorError.hidden = false;
      editorError.textContent = `Editor failed to load: ${error?.message || error?.type || "Unknown editor error"}`;
    }
  }
}

EditorManager.setOnChange((path) => {
  if (path !== appState.activeTabPath) return;
  const tab = openTabs.get(path);
  if (!tab || tab.error) return;
  tab.content = EditorManager.getValue(path);
  tab.dirty = tab.content !== tab.savedContent;
  updateTabDirtyIndicator();
});

EditorManager.setOnSave(() => saveActiveTab());

settingsViewJson?.addEventListener("click", () => {
  if (appState.resourceScopeActive) setResourceScopeMode("json");
  else if (appState.resourceChecklistActive) setResourceChecklistMode("json");
  else if (appState.resourceSettingsActive) setResourceSettingsMode("json");
  else setSettingsEditorMode("json");
});
settingsViewUi?.addEventListener("click", () => {
  if (appState.resourceScopeActive) setResourceScopeMode("ui");
  else if (appState.resourceChecklistActive) setResourceChecklistMode("ui");
  else if (appState.resourceSettingsActive) setResourceSettingsMode("ui");
  else setSettingsEditorMode("ui");
});
settingsUIView?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-setting-path]");
  if (!input) return;
  if (appState.resourceSettingsActive) updateResourceSettingFromInput(input);
  else updateSettingFromInput(input);
});
checklistSearch?.addEventListener("input", renderChecklistUI);
checklistStatusFilter?.addEventListener("change", renderChecklistUI);
checklistGroups?.addEventListener("change", async (event) => {
  const index = Number(event.target.dataset.index);
  const check = appState.resourceChecklistData?.checks?.[index];
  if (!check) return;
  if (event.target.classList.contains("checklist-status")) {
    const requestedStatus = event.target.value;
    const issue = checklistStatusIssue(check, requestedStatus) || await checklistEvidenceIssue(check, requestedStatus);
    if (issue) {
      resourceViewerMeta.textContent = issue;
      event.target.value = check.status === "not-started" && appState.resourceChecklistType !== "mitre" ? "not-tested" : (check.status || "not-tested");
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
  const check = appState.resourceChecklistData?.checks?.[Number(event.target.dataset.index)];
  if (!check) return;
  if (event.target.classList.contains("checklist-procedure")) check.procedure = checklistTextList(event.target.value);
  else if (event.target.classList.contains("checklist-evidence")) check.evidence = checklistTextList(event.target.value);
  else if (event.target.classList.contains("checklist-notes")) {
    if (appState.resourceChecklistType === "mitre") check.observations = event.target.value;
    else check.result = event.target.value;
  } else return;
  scheduleChecklistSave();
});
scopeUIForm?.addEventListener("input", (event) => {
  const input = event.target.closest("[data-scope-path]");
  if (!input || !appState.resourceScopeData) return;
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
  setNestedSettingValue(appState.resourceScopeData, input.dataset.scopePath, value);
  scheduleScopeSave();
});

statusOllamaPort.textContent = `Ollama :${OLLAMA_PORT}`;
EditorManager.setOnCursorChange((pos) => {
  statusLnCol.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
});


// ── Model picker ──────────────────────────────────────────────────────────────







globalThis.resizeChatInput = resizeChatInput;



















thinkingToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!appState.editingModel || isOpenRouterProvider()) return;
  const settings = getModelSettings(appState.editingModel);
  settings.thinking = !modelThinkingEnabled(settings);
  settings.thinkingConfigured = true;
  saveModelSettings();
  const thinkingEnabled = modelThinkingEnabled(settings);
  thinkingToggle.classList.toggle("on", thinkingEnabled);
  thinkingToggle.setAttribute("aria-pressed", String(thinkingEnabled));
  thinkingToggle.title = thinkingEnabled ? "Thinking enabled" : "Thinking disabled";
  syncModelControlsSummary();
  closeModelEditMenu();
  modelEffortTrigger.focus();
});









modelPicker.addEventListener("click", (e) => {
  e.stopPropagation();
  if (modelControlsMenu.hidden) {
    openModelControlsMenu();
  } else {
    closeModelMenu();
  }
});

modelContextTrigger.addEventListener("click", () => openModelEditMenu("context", modelContextTrigger));
modelEffortTrigger.addEventListener("click", () => openModelEditMenu("effort", modelEffortTrigger));
modelBrowseTrigger.addEventListener("click", () => {
  if (modelMenu.hidden) openModelMenu();
  else { modelMenu.hidden = true; modelBrowseTrigger.setAttribute("aria-expanded", "false"); }
});

modelControlsMenu.addEventListener("keydown", (event) => {
  const options = [...modelControlsMenu.querySelectorAll("button:not(:disabled)")];
  const index = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    document.activeElement?.click();
  }
});

authorityPicker?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAuthorityMenu();
});

authorityMenu?.addEventListener("mousedown", (e) => e.stopPropagation());
authorityMenu?.addEventListener("click", async (e) => {
  const option = e.target.closest("[data-authority-mode]");
  if (option) {
    e.preventDefault();
    e.stopPropagation();
    const mode = option.dataset.authorityMode;
    closeAuthorityMenu();
    await setAuthoritySuperMode(mode);
    return;
  }
});

modelMenu?.addEventListener("mousedown", (e) => e.stopPropagation());

modelSearch.addEventListener("input", renderModelList);
modelSearch.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });

modelAddBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  closeModelMenu();
  openAppSettings("llm");
  requestAnimationFrame(() => modelsSettingsSearch?.focus());
});


modelCustomAdd.addEventListener("click", addCustomModel);
modelCustom.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") addCustomModel();
});

document.addEventListener("click", (e) => {
  if (!modelControlsMenu.hidden) {
    const inMain = modelControlsMenu.contains(e.target) || modelMenu.contains(e.target) || modelPicker.contains(e.target);
    const inEdit = modelEditMenu && !modelEditMenu.hidden && modelEditMenu.contains(e.target);
    if (!inMain && !inEdit) closeModelMenu();
  }
  if (!chatModeMenu?.hidden) {
    const inMode = chatModeToggle?.contains(e.target);
    if (!inMode) closeChatModeMenu();
  }
  if (authorityMenu && !authorityMenu.hidden) {
    const inAuthority = authorityMenu.contains(e.target) || authorityPicker?.contains(e.target);
    if (!inAuthority) closeAuthorityMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (modelControlsMenu.hidden || event.key !== "Escape") return;
  event.preventDefault();
  if (!modelEditMenu.hidden) {
    const anchor = modelEditMenu.dataset.panel === "context" ? modelContextTrigger : modelEffortTrigger;
    closeModelEditMenu();
    anchor.focus();
  } else if (!modelMenu.hidden) {
    modelMenu.hidden = true;
    modelBrowseTrigger.setAttribute("aria-expanded", "false");
    modelBrowseTrigger.focus();
  } else { closeModelMenu(); modelPicker.focus(); }
});

window.api.onWorkspaceChanged?.((payload) => {
  if (!appState.rootPath || !payload?.workspace) return;
  if (normPath(payload.workspace) !== normPath(appState.rootPath)) return;
  const changedPath = String(payload.path || "").replace(/\\/g, "/");
  if (/(?:^|\/)(?:traffic\/(?:raw|filtered)\.jsonl|evidence\/index\.jsonl|\.xekute\/(?:logs|evidence|intelligence)\/)/i.test(changedPath)) return;
  refreshWorkspaceUi().catch((error) => console.warn("Workspace refresh failed", error));
  if (/(?:^|[\\/])(?:\.xekute|custom)[\\/]skills[\\/]/i.test(String(payload.path || ""))) {
    refreshCustomSkillCatalog().catch((error) => console.warn("Custom skill refresh failed", error));
  }
});

window.addEventListener("resize", () => {
  // The React layout fits panels with CSS; writing the shrunk width back here
  // would lose the chosen chat width after any small window or zoom level.
  syncChatResizeLimit({ clamp: !globalThis.__XEKUTE_REACT_LAYOUT__ });
  resizeChatInput();
  if (!chatModeMenu?.hidden) positionChatModeMenu();
  if (!modelControlsMenu.hidden) positionModelPanel(modelControlsMenu, modelPicker);
  if (!modelMenu.hidden) positionModelMenu();
  if (authorityMenu && !authorityMenu.hidden) positionAuthorityMenu();
  if (!contextUsageMenu.hidden) positionContextPopover();
  if (!modelEditMenu.hidden && appState.editingModel) {
    positionModelEditMenu(modelEditMenu.dataset.panel === "context" ? modelContextTrigger : modelEffortTrigger);
  }
});

syncModelLabel();
loadAuthoritySettings();
void (async () => {
  try {
    const llm = await window.api.llmSettings?.();
    if (llm?.provider) appState.activeLlmProvider = llm.provider;
  } catch {
    /* Provider falls back to listModels result. */
  }
  await loadModels({ showLoading: false });
  await refreshModelContextCapacity();
})();

// ── Tools & system prompt ─────────────────────────────────────────────────────





























































































const chatScroller = createChatScroller(messages, { onScroll: syncChatStickyMask });
appLifecycle.add(() => chatScroller.destroy());





bindScrollbarHoverLane(messages);
bindScrollbarHoverLane(chatHistoryBody);
















document.addEventListener("pointerdown", (event) => {
  if (!appState.activeComposerTaskList?.expanded || composerTaskListEl?.contains(event.target)) return;
  appState.activeComposerTaskList.expanded = false;
  renderComposerTaskList(appState.activeComposerTaskList);
});












// ── Sub-agent run cards (delegate_agent) ─────────────────────────────────────






















const SYSTEM_SKILL_COMMANDS = new Set(SYSTEM_SKILL_SLASH_COMMANDS.map((command) => command.name));




















































bindLiveInputComposer({ sendButton: sendBtn, onSend: submitChatComposer });

btnTopTerminal?.addEventListener("click", () => {
  setTerminalCollapsed(!appState.terminalCollapsed);
});

btnTopFileTree?.addEventListener("click", () => {
  activateSidebarView("project");
});

btnTopChat?.addEventListener("click", () => {
  if (appState.chatCollapsed) {
    openChatPane({ createIfEmpty: true });
  } else {
    setChatCollapsed(true);
  }
});

btnTopSettings?.addEventListener("click", openAppSettings);

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
  Promise.resolve(window.api.flushChatHistory?.())
    .catch((error) => reportChatHistoryWarning(error))
    .finally(() => window.api.windowClose?.());
});

window.addEventListener("beforeunload", flushChatSessionsBeforeClose);

// ── Live delegated sub-agent runs ────────────────────────────────────────────
// The child runs on the main process (delegate_agent). Its agent:event payloads
// carry sessionId=childSessionId. We keep a lightweight live run in the renderer
// so that when the operator opens the child tab mid-run, the streamed tokens and
// tool cards render. The parent card updates from the mirrored parentSessionId
// payloads.





















document.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-open-project-settings]")) openAppSettings("project");
});




// Global listener for delegated children: the per-run listener inside
// sendMessageWithAgentRuntime is attached to the parent's session id, so child
// events (sessionId=childSessionId) never reach it.
window.api?.onAgentEvent?.((payload) => {
  const type = String(payload?.type || "");
  const owner = chatSessions.find((session) => session.memorySessionId === payload?.sessionId || session.id === payload?.sessionId);
  if (type.startsWith("input_") && owner) {
    for (const session of chatSessions.filter((item) => item === owner || item.parentMemorySessionId === payload.sessionId)) liveInputController.acceptEvent(session, payload);
    return;
  }
  if (type === "task_started") {
    const session = chatSessions.find((item) => item.taskId === payload.taskId) || owner;
    if (session) { session.taskId = payload.taskId; session.memoryBlockId = payload.blockId || session.memoryBlockId; session.memorySessionId = payload.memorySessionId || session.memorySessionId; }
    const run = session && activeChatRuns.get(session.id);
    if (run) {
      run.taskId = payload.taskId;
      run.memorySessionId = session.memorySessionId;
      const prompt = session.history?.find((message) => message.id === run.initialInputId || message.source_message_id === run.initialInputId);
      if (prompt) prompt.task_id = payload.taskId;
      const host = run.viewHost || (appState.activeChatSessionId === session.id ? messages : null);
      const userTurn = [...(host?.querySelectorAll(".chat-turn.user") || [])].find((turn) => turn.dataset.sourceMessageId === run.initialInputId);
      if (userTurn) userTurn.dataset.taskId = payload.taskId;
    }
    if (run?.initialInputId) liveInputController.acceptEvent(session, { type: "input_received", messageId: run.initialInputId, taskId: payload.taskId });
    schedulePersistChatSessions();
    return;
  }
  if (type === "parent_continuation_started") {
    noteParentContinuationStarted(payload);
    return;
  }
  if (type === "parent_run_settled") {
    noteParentRunSettled(payload);
    return;
  }
  if (payload?.source === "background_runtime") {
    handleHiddenBackgroundRuntimeEvent(payload);
    return;
  }
  if (type === "terminal_health") {
    const waitId = String(payload.processId || payload.terminalId || "");
    if (waitId) {
      const elapsedMs = Number(payload.elapsedMs) || 0;
      const state = String(payload.health?.state || payload.metrics?.state || "running");
      updateWaitCardLabel(waitId, `Running command · ${formatWaitClock(elapsedMs)} · ${state}`);
      updateCommandTimelineLabel(waitId);
    }
    return;
  }
  if (payload?.source === "parent_continuation") {
    queueParentContinuationEvent(payload);
    return;
  }
  if (type === "subagent_result_ready") {
    // Production Electron owns parent re-entry. The renderer still receives
    // the event for observability, but must not race the main-process FIFO
    // claim with a second continuation request. Recovery via
    // pendingSubagentResults remains available after a reload.
    if (payload?.continuationOwner === "main") return;
    enqueueSubagentResult(payload);
    return;
  }
  if (type === "subagent_queued" || type === "subagent_started" || type === "subagent_activity"
    || type === "subagent_completed" || type === "subagent_stopped" || type === "subagent_failed") {
    handleDelegatedChildEvent(payload);
    return;
  }
  if (type === "subagent_question_escalated") {
    markSubagentQuestionWaiting(payload, true);
    presentOrchestratorEscalatedQuestion(payload).catch(() => {});
    return;
  }
  if (type === "subagent_question_resolved") {
    markSubagentQuestionWaiting(payload, false);
    dismissEscalatedQuestionSurfaces(payload);
    return;
  }
  if (payload?.source === "subagent" && payload?.childSessionId) handleDelegatedChildRuntimeEvent(payload).catch(() => {});
});

// When a background terminal command or traffsucker subagent checkpoints or
// completes, the harness re-enters the main agent with the terminal transcript.
// Queue events while any chat is already running so nothing is dropped.
window.api?.onAgentEvent?.((payload) => {
  const type = String(payload?.type || "");
  if (!["subagent_complete", "terminal_complete", "subagent_checkpoint", "terminal_checkpoint"].includes(type)) {
    return;
  }
  // A command that exits stops its timer here. Its output reaches the agent
  // through the task inbox in the main process.
  if (type === "terminal_complete") {
    finalizeCommandTimeline(payload, payload?.status, payload?.exitCode);
    absorbModelRunCommandResult(payload);
    return;
  }
  const phase = type.endsWith("_checkpoint") ? "checkpoint" : "complete";
  const kind = type.startsWith("subagent_") ? "subagent" : "terminal";
  if (!anyChatSessionRunning() && !appState.subagentCompletionPending) {
    handleBackgroundWaitEvent(payload, kind, phase);
    return;
  }
  const waitId = String(payload.subagentId || payload.waitId || payload.processId || payload.terminalId || "");
  // Drop a checkpoint that was outrun by its completion while the chat was busy.
  if (phase === "checkpoint" && hasCompleteForWait(waitId)) return;
  appState.pendingBackgroundWaitEvents.push({ payload, kind, phase });
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
  toggleChatHistoryPopover();
});
btnChatMore?.addEventListener("click", (e) => {
  e.stopPropagation();
  showChatOptions();
});
btnChatCollapse?.addEventListener("click", (e) => {
  e.stopPropagation();
  setChatCollapsed(true);
});

chatSessionSelect?.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest("[data-close-session]")) {
    appState.pressedChatSessionId = "";
    return;
  }
  appState.pressedChatSessionId = e.target.closest(".chat-session-tab")?.dataset.sessionId || "";
});
chatSessionSelect?.addEventListener("pointerup", (e) => {
  const close = e.target.closest("[data-close-session]");
  if (close) {
    e.preventDefault();
    e.stopPropagation();
    appState.pressedChatSessionId = "";
    closeChatSession(close.dataset.closeSession);
    return;
  }
  const releasedId = e.target.closest(".chat-session-tab")?.dataset.sessionId || "";
  const sessionId = releasedId || (e.currentTarget.contains(e.target) ? appState.pressedChatSessionId : "");
  appState.pressedChatSessionId = "";
  if (!sessionId || sessionId === appState.activeChatSessionId) return;
  loadChatSession(sessionId);
});
chatSessionSelect?.addEventListener("pointercancel", () => {
  appState.pressedChatSessionId = "";
});
chatSessionSelect?.addEventListener("click", (e) => {
  if (e.target.closest(".chat-session-tab")) e.preventDefault();
});
chatHeader?.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.id === "btn-chat-new") newChatSession();
  if (button.id === "btn-chat-delete") deleteActiveChatSession();
});
chatInput.addEventListener("keydown", (e) => {
  // Keys pressed while an IME is composing belong to the composition.
  if (e.isComposing || e.keyCode === 229) return;
  if (handleFileTagKeydown(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && isRunningChatActive() && !effectiveChatInputValue().trim()) {
    e.preventDefault();
    stopGeneration();
    return;
  }
  if (e.key === "Backspace" && isChatInputCaretAtArgumentStart()) {
    e.preventDefault();
    clearSelectedSlashCommand();
    onChatInputChange();
    return;
  }
  if (!slashCommandSuggestions?.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    const direction = e.key === "ArrowDown" ? 1 : -1;
    appState.slashSuggestionIndex = appState.slashSuggestionIndex < 0
      ? (direction > 0 ? 0 : appState.slashSuggestionItems.length - 1)
      : (appState.slashSuggestionIndex + direction + appState.slashSuggestionItems.length) % appState.slashSuggestionItems.length;
    renderSlashSuggestions();
    return;
  }
  if (!slashCommandSuggestions?.hidden && ["Tab", "Shift"].includes(e.key)) {
    e.preventDefault(); chooseSlashSuggestion(appState.slashSuggestionIndex, { clicked: true }); return;
  }
  if (!slashCommandSuggestions?.hidden && e.key === "Enter") {
    e.preventDefault(); chooseSlashSuggestion(); return;
  }
  if (!slashCommandSuggestions?.hidden && e.key === "Escape") {
    e.preventDefault(); closeSlashSuggestions(); return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    if (e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    submitChatComposerFromInput();
  }
});
chatInput.addEventListener("beforeinput", (e) => {
  if (e.inputType === "insertParagraph") e.preventDefault();
});




document.addEventListener("keydown", async (e) => {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  const editorSurfaceFocused = Boolean(e.target?.closest?.("#monaco-container") || document.activeElement?.closest?.("#monaco-container"));
  if (e.altKey && !mod && !e.shiftKey && key === "z" && editorSurfaceFocused && appState.activeTabPath) {
    e.preventDefault();
    e.stopPropagation();
    EditorManager.toggleWordWrap?.();
    return;
  }

  if (mod && !e.altKey && !e.shiftKey && key === "s" && appState.activeTabPath
    && !editorSurfaceFocused && !isTextEditingTarget(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    await saveActiveTab();
    return;
  }

  if (e.key === "Delete" && !e.altKey && !isTextEditingTarget(e.target) && isExplorerKeyboardTarget() && appState.selectedItem) {
    e.preventDefault();
    e.stopPropagation();
    closeWorkspaceContextMenu();
    await deleteSelectedExplorerItem();
    return;
  }

  if (mod && !e.altKey && !e.shiftKey && isExplorerKeyboardTarget() && appState.selectedItem && ["x", "c", "v"].includes(key)) {
    // Never hijack copy/cut when the user has an actual text selection
    // (e.g. selecting part of a chat message or a resource preview).
    const selection = window.getSelection?.();
    const hasTextSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
    if (key === "c" && hasTextSelection) return;
    e.preventDefault();
    e.stopPropagation();
    if (!setContextTargetFromSelectedItem()) return;
    if (key === "x") setWorkspaceClipboard("cut");
    else if (key === "c") setWorkspaceClipboard("copy");
    else await pasteWorkspaceClipboard();
    return;
  }

  if (!mod || e.altKey) return;
  // "+" needs Shift on most layouts (Ctrl+Shift+=), so accept it either way.
  if (key === "+" || (!e.shiftKey && key === "=")) {
    e.preventDefault();
    setUiZoom(appState.uiZoom + 0.1);
    return;
  }
  if (!e.shiftKey && key === "-") {
    e.preventDefault();
    setUiZoom(appState.uiZoom - 0.1);
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
    || (!e.shiftKey && key === "f");
  if (quickIsOpen && !opensQuickSurface) return;

  if (!e.shiftKey && key === "s" && appState.resourceCurrentFilePath) {
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

  if (!e.shiftKey && key === "f") {
    e.preventDefault();
    e.stopPropagation();
    await openQuickPalette("search");
    return;
  }
}, true);





// ── Image attachments (clip button) ───────────────────────────────────────






messages?.addEventListener("click", (event) => {
  const img = event.target.closest?.(".user-prompt-images img");
  if (!img) return;
  event.preventDefault();
  event.stopPropagation();
  const src = img.getAttribute("src");
  const original = sentImageOriginals.get(src);
  const view = openImageLightbox(original || src, { alt: img.alt || "Attached image" });
  // After a restart only the preview is in the transcript; the full-quality
  // original is stored encrypted with the chat and replaces it once read.
  const imageId = img.dataset.imageId;
  const session = activeChatSession();
  if (original || !imageId || !view || !window.api?.chatImageRead) return;
  window.api.chatImageRead({ workspace: appState.rootPath, sessionId: session?.memorySessionId || "", imageId })
    .then((result) => {
      const dataUrl = result?.dataUrl || result?.value?.dataUrl;
      if (!dataUrl) return;
      sentImageOriginals.set(src, dataUrl);
      view.setSource(dataUrl);
    })
    .catch(() => { /* the preview stays */ });
}, true);

attachImageBtn?.addEventListener("click", () => attachImageInput?.click());


chatInput?.addEventListener("paste", (event) => {
  const images = imageFilesFrom(event.clipboardData);
  if (!images.length) return;
  if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  void addComposerImageFiles(images);
});

composerEl?.addEventListener("dragover", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  composerEl.classList.add("is-image-drop");
});
composerEl?.addEventListener("dragleave", (event) => {
  if (!composerEl.contains(event.relatedTarget)) composerEl.classList.remove("is-image-drop");
});
composerEl?.addEventListener("drop", (event) => {
  composerEl.classList.remove("is-image-drop");
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  void addComposerImageFiles([...(event.dataTransfer.files || [])]);
});
attachImageInput?.addEventListener("change", () => {
  const files = [...(attachImageInput.files || [])];
  attachImageInput.value = "";
  void addComposerImageFiles(files);
});


chatInput.addEventListener("input", onChatInputChange);
chatInput.addEventListener("blur", closeFileTagSuggestions);
document.addEventListener("selectionchange", () => {
  if (document.activeElement === chatInput) {
    renderSlashSuggestions();
    renderFileTagSuggestions();
  }
});
chatInput.addEventListener("paste", () => requestAnimationFrame(onChatInputChange));
chatInput.addEventListener("cut", () => requestAnimationFrame(onChatInputChange));
window.addEventListener("beforeunload", (event) => {
  window.api.unwatchWorkspace?.();
  if (appState.resourceDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

resizeChatInput();
loadBugBountySlashCommands();

if (chatPane && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    resizeChatInput();
    refreshUserPromptDisclosures();
    syncChatStickyMask();
  }).observe(chatPane);
}

contextUsageBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleContextPopover();
});

contextUsageClose?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeContextPopover();
  contextUsageBtn.focus();
});

contextWindowTrigger?.addEventListener("click", (e) => { e.stopPropagation(); showContextPanel(contextUsagePopover); });
contextBlocksTrigger?.addEventListener("click", (e) => { e.stopPropagation(); showContextPanel(contextBlocksPanel); });

for (const surface of [contextUsageMenu, contextUsagePopover, contextBlocksPanel]) {
  surface?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeContextPopover();
      contextUsageBtn.focus();
      return;
    }
    if (surface !== contextUsageMenu) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      (document.activeElement === contextWindowTrigger ? contextBlocksTrigger : contextWindowTrigger)?.focus();
    } else if (e.key === "ArrowRight" && (document.activeElement === contextWindowTrigger || document.activeElement === contextBlocksTrigger)) {
      e.preventDefault();
      document.activeElement.click();
    }
  });
}

document.addEventListener("click", (e) => {
  if (contextUsageMenu && !contextUsageMenu.hidden) {
    const inside = [contextUsageMenu, contextUsagePopover, contextBlocksPanel, contextUsageBtn].some((element) => element?.contains(e.target));
    if (!inside) closeContextPopover();
  }
});

// Chat history popover wiring
chatHistorySearch?.addEventListener("input", () => {
  renderChatHistory();
  positionChatHistoryPopover();
});
chatHistoryBody?.addEventListener("click", (e) => {
  const more = e.target.closest("[data-chat-history-more]");
  if (more) {
    e.stopPropagation();
    appState.chatHistoryShowAllRecent = more.dataset.chatHistoryMore !== "less";
    renderChatHistory();
    positionChatHistoryPopover();
    return;
  }
  const archiveToggle = e.target.closest("[data-toggle-archived]");
  if (archiveToggle) {
    e.stopPropagation();
    appState.chatHistoryArchivedOpen = !appState.chatHistoryArchivedOpen;
    renderChatHistory();
    positionChatHistoryPopover();
    return;
  }
  const archive = e.target.closest("[data-archive-session]");
  if (archive) {
    e.stopPropagation();
    archiveChatSession(archive.dataset.archiveSession);
    return;
  }
  const destroy = e.target.closest("[data-destroy-session]");
  if (destroy) {
    e.stopPropagation();
    destroyChatSession(destroy.dataset.destroySession);
    renderChatHistory();
    positionChatHistoryPopover();
    return;
  }
  const open = e.target.closest("[data-open-session]");
  if (!open) return;
  reopenChatSession(open.dataset.openSession);
});
document.addEventListener("click", (e) => {
  if (chatHistoryPopover && !chatHistoryPopover.hidden) {
    const inPopover = chatHistoryPopover.contains(e.target) || btnChatHistory?.contains(e.target);
    if (!inPopover) closeChatHistoryPopover();
  }
  dismissUserPromptSelectionIfOutside(e.target);
});

messages?.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  // Attached images open the image view instead of selecting prompt text.
  if (e.target.closest(".user-prompt-images")) return;
  const promptBox = e.target.closest(".chat-turn.user .chat-box");
  if (!promptBox) return;
  activateUserPromptSelection(promptBox, e.clientX, e.clientY);
});

messages?.addEventListener("dblclick", (e) => {
  const content = e.target.closest(".chat-turn.user .chat-box .chat-box-content");
  if (!content) return;
  activateUserPromptSelection(content.closest(".chat-box"), e.clientX, e.clientY);
  selectWholeUserPrompt(content);
});

document.addEventListener("copy", (e) => {
  const anchor = window.getSelection?.()?.anchorNode;
  const anchorHost = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
  const content = e.target?.closest?.(".chat-turn.user .chat-box-content")
    || anchorHost?.closest?.(".chat-turn.user .chat-box-content");
  const text = userPromptSelectionInside(content)?.toString() || "";
  if (!text) return;
  e.preventDefault();
  e.clipboardData?.setData("text/plain", text);
  void writeChatClipboardText(text);
});

messages?.addEventListener("beforeinput", (e) => {
  if (!e.target.closest(".chat-turn.user .chat-box.user-prompt-selectable .chat-box-content[contenteditable='true']")) return;
  e.preventDefault();
});

messages?.addEventListener("paste", (e) => {
  if (!e.target.closest(".chat-turn.user .chat-box.user-prompt-selectable .chat-box-content[contenteditable='true']")) return;
  e.preventDefault();
});

messages?.addEventListener("keydown", (e) => {
  const content = e.target.closest(".chat-turn.user .chat-box.user-prompt-selectable .chat-box-content[contenteditable='true']");
  if (content) {
    if (e.key === "Enter") e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") e.preventDefault();
    return;
  }
  if (!["Enter", " "].includes(e.key)) return;
  const promptBox = e.target.closest(".chat-turn.user .chat-box.user-prompt-expandable");
  if (!promptBox) return;
  e.preventDefault();
  activateUserPromptSelection(promptBox);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!messages?.querySelector(".chat-turn.user .chat-box.user-prompt-selectable")) return;
  deactivateUserPromptSelection();
  collapseExpandedUserPrompts();
});

messages.addEventListener("click", (e) => {
  const starter = e.target.closest("[data-chat-starter]");
  if (starter) {
    chatInput.value = starter.dataset.chatStarter || "";
    onChatInputChange();
    chatInput.focus();
    return;
  }

  const workHeader = e.target.closest(".agent-work-header");
  if (workHeader) {
    if (workHeader.dataset.foldable === "false") return;
    toggleWorkFold(workHeader.closest(".agent-work-fold"));
    return;
  }

  const fileStackToggle = e.target.closest(".agent-file-stack-toggle");
  if (fileStackToggle) {
    toggleCollapsibleFold(fileStackToggle.parentElement);
    return;
  }

  const workFoldToggle = e.target.closest(".agent-work-fold > .agent-status-line, .agent-explored-toggle, .agent-thinking-toggle, .agent-question-toggle");
  if (workFoldToggle) {
    toggleCollapsibleFold(workFoldToggle.parentElement);
    return;
  }

  const fileRow = e.target.closest(".agent-file-row");
  if (fileRow) {
    if (toolRowOpensFile(fileRow)) {
      e.preventDefault();
      const rel = String(fileRow.dataset.path || "").trim();
      openFile(joinWorkspacePath(rel), rel.split(/[/\\]/).pop(), { focusEditor: true });
    }
    return;
  }

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
  const block = btn.closest(".md-code-block, .md-mermaid-block");
  if (!block) return;
  let code = block.dataset.code || "";
  try { code = decodeURIComponent(code); } catch { /* Keep the encoded text if malformed. */ }
  const copyDone = () => {
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  };
  e.preventDefault();
  e.stopPropagation();
  writeChatClipboardText(code).then(copyDone).catch(() => { btn.textContent = "Copy failed"; });
});

globalThis.addEventListener("markdown-ready", () => {
  document.querySelectorAll(".assistant-reply[data-raw-md]").forEach((el) => {
    globalThis.MarkdownRenderer.renderToElement(el, el.dataset.rawMd);
    attachAssistantCopyButton(el);
  });
  const activeTab = appState.activeTabPath ? openTabs.get(appState.activeTabPath) : null;
  if (activeTab && isMarkdownFileName(activeTab.name) && appState.markdownViewMode === "md") {
    renderEditor({ focusEditor: false });
  }
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

if (!globalThis.__XEKUTE_REACT_LAYOUT__) {
  makeDraggable(sidebarResize, (e) => {
    const min = 200, max = 360;
    const left = sidebar.getBoundingClientRect().left;
    sidebar.style.width = Math.min(max, Math.max(min, e.clientX - left)) + "px";
    sidebarResize.setAttribute("aria-valuenow", String(Math.round(sidebar.offsetWidth)));
  });
}

const CHAT_MIN_VIEWPORT_RATIO = 0.2;

function chatViewportMinWidth() {
  return Math.floor(window.innerWidth * CHAT_MIN_VIEWPORT_RATIO);
}

function chatViewportMaxWidth() {
  return Math.max(chatViewportMinWidth(), Math.floor(window.innerWidth * 0.5));
}

function syncChatResizeLimit({ clamp = false } = {}) {
  const min = chatViewportMinWidth();
  const max = chatViewportMaxWidth();
  chatResize?.setAttribute("aria-valuemin", String(min));
  chatResize?.setAttribute("aria-valuemax", String(max));
  if (clamp && chatPane && !chatPane.classList.contains("collapsed")) {
    const width = Math.min(max, Math.max(min, chatPane.offsetWidth));
    chatPane.style.width = `${width}px`;
    chatResize?.setAttribute("aria-valuenow", String(Math.round(chatPane.offsetWidth)));
  }
  return max;
}

syncChatResizeLimit({ clamp: true });

if (!globalThis.__XEKUTE_REACT_LAYOUT__) {
  makeDraggable(chatResize, (e) => {
    const min = chatViewportMinWidth(), max = chatViewportMaxWidth();
    const w = window.innerWidth - e.clientX;
    chatPane.style.width = Math.min(max, Math.max(min, w)) + "px";
    chatResize.setAttribute("aria-valuenow", String(Math.round(chatPane.offsetWidth)));
    resizeChatInput();
  });
}

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
  if (collapsed && appState.terminalMaximized) {
    appState.terminalMaximized = false;
    centerPanel.classList.remove("terminal-maximized");
    syncTerminalMaximizeButton();
  }
  appState.terminalCollapsed = collapsed;
  terminalPane.classList.toggle("collapsed", collapsed);
  terminalResize.classList.toggle("collapsed-hint", collapsed);
  btnTopTerminal?.classList.toggle("active", !collapsed);
  btnTopTerminal?.classList.toggle("inactive", collapsed);
  activityTerminal?.classList.toggle("panel-visible", !collapsed);
  activityTerminal?.setAttribute("aria-pressed", String(!collapsed));
  TerminalManager.setPanelOpen?.(!collapsed);

  if (collapsed) {
    if (terminalPane.offsetHeight > TERMINAL_MIN_EXPANDED) {
      appState.terminalSavedHeight = terminalPane.offsetHeight;
    }
    terminalPane.style.height = "0px";
    terminalPane.style.flex = "none";
    editorPane.style.flex = "1";
    editorPane.style.height = "";
  } else {
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    appState.terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, appState.terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${appState.terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.flex = "none";
    const editorH = Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight);
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
  icon?.classList.toggle("codicon-chevron-up", !appState.terminalMaximized);
  icon?.classList.toggle("codicon-chevron-down", appState.terminalMaximized);
  btnTerminalMaximize.title = appState.terminalMaximized ? "Restore Panel Size" : "Maximize Panel";
  btnTerminalMaximize.setAttribute("aria-pressed", String(appState.terminalMaximized));
}

function setTerminalMaximized(maximized) {
  const next = Boolean(maximized);
  if (next && appState.terminalCollapsed) setTerminalCollapsed(false);
  appState.terminalMaximized = next;
  centerPanel.classList.toggle("terminal-maximized", appState.terminalMaximized);
  syncTerminalMaximizeButton();

  if (!appState.terminalMaximized) {
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    appState.terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, appState.terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${appState.terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight)}px`;
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
  setTerminalMaximized(!appState.terminalMaximized);
});

btnTerminalClose?.addEventListener("click", () => {
  setTerminalCollapsed(true);
});

globalThis.collapseTerminalPanel = () => setTerminalCollapsed(true, { createIfMissing: false });

globalThis.expandTerminalPanel = ({ createIfMissing = true } = {}) => {
  if (appState.terminalCollapsed) setTerminalCollapsed(false, { createIfMissing });
  else if (createIfMissing && !TerminalManager.hasSessions()) TerminalManager.ensureTerminal();
  return true;
};

globalThis.toggleTerminalPanel = () => {
  const nextCollapsed = !appState.terminalCollapsed;
  setTerminalCollapsed(nextCollapsed);
  return !nextCollapsed;
};

globalThis.onTerminalSessionStateChange = ({ count }) => {
  if (count === 0 && !appState.terminalCollapsed) setTerminalCollapsed(true, { createIfMissing: false });
  else TerminalManager.setPanelOpen?.(!appState.terminalCollapsed && count > 0);
};

appState.terminalHeightBeforeDrag = appState.terminalSavedHeight;

function scheduleTerminalDragLayout() {
  if (appState.terminalDragLayoutFrame) return;
  appState.terminalDragLayoutFrame = requestAnimationFrame(() => {
    appState.terminalDragLayoutFrame = 0;
    EditorManager.layout();
  });
}

makeDraggable(terminalResize, (e) => {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  const rect = centerPanel.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const sashH = terminalResize.offsetHeight || 0;
  const availableH = Math.max(0, rect.height - sashH);
  const requestedTerminalH = availableH - relY;
  appState.terminalDragShouldCollapse = requestedTerminalH <= TERMINAL_HEADER_H + 8;

  if (appState.terminalCollapsed) {
    setTerminalCollapsed(false);
  }

  const editorH = Math.min(
    availableH - TERMINAL_MIN_EXPANDED,
    Math.max(EDITOR_MIN_HEIGHT, relY),
  );
  appState.terminalSavedHeight = availableH - editorH;

  editorPane.style.height = `${editorH}px`;
  editorPane.style.flex = "none";
  terminalPane.style.height = `${appState.terminalSavedHeight}px`;
  terminalPane.style.flex = "none";

  scheduleTerminalDragLayout();
}, {
  onStart() {
    appState.terminalDragShouldCollapse = false;
    appState.terminalHeightBeforeDrag = appState.terminalSavedHeight;
    centerPanel.classList.add("terminal-resizing");
  },
  onEnd() {
    centerPanel.classList.remove("terminal-resizing");
    if (appState.terminalDragLayoutFrame) cancelAnimationFrame(appState.terminalDragLayoutFrame);
    appState.terminalDragLayoutFrame = 0;
    if (appState.terminalDragShouldCollapse) {
      appState.terminalSavedHeight = appState.terminalHeightBeforeDrag;
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
  if (appState.terminalMaximized) setTerminalMaximized(false);
  if (appState.terminalCollapsed) setTerminalCollapsed(false);
  const centerH = centerPanel.getBoundingClientRect().height;
  const sashH = terminalResize.offsetHeight || 0;
  const availableH = Math.max(0, centerH - sashH);
  appState.terminalSavedHeight = Math.max(96, Math.min(availableH - EDITOR_MIN_HEIGHT, value));
  terminalPane.style.height = `${appState.terminalSavedHeight}px`;
  terminalPane.style.flex = "none";
  editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight)}px`;
  editorPane.style.flex = "none";
  terminalResize.setAttribute("aria-valuenow", String(Math.round(appState.terminalSavedHeight)));
  requestAnimationFrame(() => { EditorManager.layout(); TerminalManager.fitActive(); });
}

terminalResize.addEventListener("dblclick", () => applyTerminalHeight(240));
terminalResize.addEventListener("keydown", (event) => {
  const centerH = centerPanel.getBoundingClientRect().height;
  const maximum = Math.max(96, centerH - (terminalResize.offsetHeight || 0) - EDITOR_MIN_HEIGHT);
  let next = appState.terminalCollapsed ? 96 : terminalPane.offsetHeight;
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
  const readMinimum = () => typeof minimum === "function" ? minimum() : minimum;
  const sync = () => handle.setAttribute("aria-valuenow", String(Math.round(read())));
  sync();
  handle.addEventListener("keydown", (event) => {
    const decrement = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increment = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let next = read();
    if (event.key === decrement) next -= step;
    else if (event.key === increment) next += step;
    else if (event.key === "Home") next = readMinimum();
    else if (event.key === "End") next = maximum();
    else return;
    event.preventDefault();
    write(Math.max(readMinimum(), Math.min(maximum(), next)));
    sync();
  });
  handle.addEventListener("dblclick", () => {
    reset?.();
    requestAnimationFrame(sync);
  });
}

if (!globalThis.__XEKUTE_REACT_LAYOUT__) {
  installSeparatorKeyboard(sidebarResize, {
    orientation: "vertical", minimum: 200, maximum: () => 360,
    read: () => sidebar.offsetWidth,
    write: (value) => { sidebar.style.width = `${value}px`; },
    reset: () => { sidebar.style.width = "244px"; },
  });
  installSeparatorKeyboard(chatResize, {
    orientation: "vertical", minimum: chatViewportMinWidth, maximum: chatViewportMaxWidth,
    read: () => chatPane.offsetWidth,
    write: (value) => { chatPane.style.width = `${value}px`; resizeChatInput(); },
    reset: () => {
      const width = Math.min(chatViewportMaxWidth(), Math.max(chatViewportMinWidth(), 513));
      chatPane.style.width = `${width}px`;
      resizeChatInput();
    },
  });
}
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
window.api.onProxyBrowserStatus?.(syncProxyBrowserUi);
window.api.proxyStatus?.().then(syncProxyListenerUi).catch(() => {});
window.api.proxyBrowserStatus?.({ assessmentPath: appState.assessmentPath }).then(syncProxyBrowserUi).catch(() => {});
restoreBugBountyTreeState();
setSidebarView("project", { persist: false });
setChatCollapsed(false);
setTerminalCollapsed(!TerminalManager.hasSessions(), { createIfMissing: false });
chatInput.focus();
restoreLastWorkspace();
window.api.onUpdateEvent?.(handleUpdateEvent);
loadUpdateSettings().then(() => runUpdateCheck(false));

export {
  CHAT_PROFILE_KEYS, CONTEXT_USAGE_ROW_LABELS, MARKDOWN_VIEW_MODE_KEY, SYSTEM_SKILL_COMMANDS,
  ToolMap, appController, chatScroller, composerEl, isBrowserTab, isMarkdownFileName,
  liveInputController, openBrowserTab, renderEditor, renderTabs, scoreQuickMatch,
  setCodeEditorVisible, setNotifications, setSidebarCollapsed, setSidebarView,
  setTerminalMaximized, settingsViewSwitch, showCodeEditorWorkspace, showResourceWorkspace,
  switchToBrowserTab, syncWorkspaceActivity, updateTabDirtyIndicator,
};
