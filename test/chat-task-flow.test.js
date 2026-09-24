const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createV3SessionStore } = require("../src/app/storage/memory/v3-session-store.js");
const { readUiShell } = require("./helpers/ui-shell.js");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("Agent tasks keep the two-mode catalog without a temporary checklist tool", () => {
  const controller = read("src/agent/controller/agent-controller.js");
  const modes = read("src/agent/modes/mode-registry.js");
  assert.match(controller, /function isReasonablyLargeAgentRequest\(/);
  assert.doesNotMatch(controller, /const shouldOfferTaskList = !nested && profile\.key === "agent"/);
  assert.doesNotMatch(controller, /availableTools = availableTools\.filter\(\(tool\) => String\(tool\?\.function\?\.name \|\| ""\) !== "update_task_list"\)/);
  assert.doesNotMatch(controller, /sendEvent\(\{ type: "task_list"/);
  assert.doesNotMatch(controller, /sendEvent\(\{ type: "task_brief", runId, brief: taskBrief \}\)/);
  assert.match(modes, /const AGENT_TOOLS = Object\.freeze\(\[/);
  assert.match(modes, /const SAFE_READ_TOOLS = Object\.freeze\(\["ask_questions", "end_turn", "read_file", "search_workspace", "view_active_terminal"\]\)/);
  assert.match(modes, /const MODE_TOOL_GROUPS = Object\.freeze\(\{ ask: SAFE_READ_TOOLS, agent: AGENT_TOOLS \}\)/);
  assert.doesNotMatch(modes, /"update_project_artifacts"/);
  assert.doesNotMatch(modes, /"query_knowledge"/);
  assert.doesNotMatch(modes, /ALL_MODE_TOOLS/);
  assert.doesNotMatch(modes, /"manage_plan"/);
});

test("chat keeps runtime plans internal and renders a compact activity feed", () => {
  const renderer = read("src/ui/bootstrap.js");
  const controller = read("src/agent/controller/agent-controller.js");
  const styles = read("src/ui/styles/base.css");
  const chatStyles = read("src/ui/styles/chat.css");
  const layoutStyles = read("src/ui/styles/layout-revamp.css");
  const editorController = read("src/ui/features/editor/editor-controller.js");
  const main = read("src/app/electron/main.js");
  const projectIpc = read("src/app/ipc/project.js");
  const activeIpc = `${main}\n${projectIpc}`;
  const html = readUiShell();
  assert.match(renderer, /payload\.type === "task_brief"/);
  assert.match(renderer, /completeTaskBrief\(/);
  assert.match(renderer, /FILE_READ_TOOL_NAMES/);
  assert.match(renderer, /if \(phase === "error"\) return \{ verb: "Failed"/);
  assert.match(renderer, /running \? "Reading" : "Read"/);
  assert.match(renderer, /running \? "Editing" : "Edited"/);
  assert.match(renderer, /data-guidance-delete-path/);
  assert.match(renderer, /deleteGuidanceEntry\(button\.dataset\.guidanceDeletePath/);
  assert.match(controller, /isReasonablyLargeAgentRequest/);
  assert.match(renderer, /const filePath = String\(result\.path/);
  assert.match(renderer, /chatSessionSelect\?\.addEventListener\("wheel"/);
  assert.match(renderer, /chatSessionSelect\.scrollLeft \+ delta/);
  assert.match(renderer, /editorTabBar\?\.addEventListener\("wheel"/);
  assert.match(renderer, /editorTabBar\.scrollLeft \+ delta/);
  assert.match(renderer, /behavior: force \? "smooth" : "auto"/);
  assert.match(styles, /\.agent-task-brief/);
  assert.match(styles, /\.notification-count\[hidden\] \{ display:none; \}/);
  assert.match(styles, /\.notification-panel \{[\s\S]*?position:fixed;[\s\S]*?border:1px solid #303030;[\s\S]*?border-radius:10px;[\s\S]*?background:#181818;/);
  assert.match(styles, /\.notification-item \{[\s\S]*?border:1px solid #2d2d2d;[\s\S]*?border-radius:8px;[\s\S]*?background:#1d1d1d;/);
  assert.match(styles, /\.update-toast \{[\s\S]*?left: 44px;[\s\S]*?width: 465px;[\s\S]*?height: 61px;[\s\S]*?padding: 12px 13px;[\s\S]*?gap: 48px;[\s\S]*?border: 1px solid #282828;[\s\S]*?border-radius: 31px;/);
  assert.match(styles, /\.update-toast-install \{[\s\S]*?background:#2f8cf4/);
  assert.match(styles, /\.update-toast-btn \{[\s\S]*?min-width:88px;[\s\S]*?height:32px;[\s\S]*?font:400 14px/);
  assert.match(styles, /\.update-toast-icon \{[\s\S]*?width:16px;[\s\S]*?height:16px;/);
  assert.match(styles, /\.update-toast-actions \{[\s\S]*?transform:translateX\(8px\)/);
  assert.match(html, /id="update-toast"[\s\S]*?gift_update_icon\.svg[\s\S]*?New version is available[\s\S]*?id="update-toast-ignore"[\s\S]*?id="update-toast-install"/);
  assert.match(renderer, /function positionNotificationPanel\(\)[\s\S]*?btnNotifications\.getBoundingClientRect\(\)/);
  assert.match(renderer, /updateToastInstall\?\.addEventListener\("click", beginUpdateInstall\)/);
  assert.match(renderer, /updateToastIgnore\?\.addEventListener\("click", ignoreCurrentUpdate\)/);
  assert.match(renderer, /function beginUpdateInstall\(\)[\s\S]*?showUpdateDownloading\([\s\S]*?window\.api\.updatesInstall\(\)/);
  assert.match(renderer, /function ignoreCurrentUpdate\(\)[\s\S]*?window\.api\.updatesIgnore\?\.\(\{ version \}\)[\s\S]*?hideUpdateToast\(\)[\s\S]*?showUpdateNotification\(version\)/);
  assert.match(renderer, /type === "progress"[\s\S]*?update-toast-progress[\s\S]*?style\.setProperty\("width", `\$\{percent\}%`\)/);
  assert.match(renderer, /type === "downloaded"[\s\S]*?Installing…/);
  assert.doesNotMatch(renderer, /Preview only|dataset\.preview|pointerEvents\s*=\s*["']none/);
  assert.match(renderer, /search: \["codicon-search", "Search workspace text", "Workspace Search"\]/);
  assert.match(renderer, /!e\.shiftKey && key === "f"[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?openQuickPalette\("search"\)/);
  assert.doesNotMatch(renderer, /if \(e\.shiftKey && key === "f"\)/);
  assert.match(main, /accelerator: "CmdOrCtrl\+F"[\s\S]*?sendMenuAction\("workspace-search"\)/);
  assert.doesNotMatch(main, /CmdOrCtrl\+Shift\+F/);
  assert.match(html, /title="Search \(Ctrl\+F\)"/);
  assert.doesNotMatch(html, /Ctrl\+Shift\+F/);
  assert.match(renderer, /query\.length < 2[\s\S]*?renderQuickList\(\[\], "", \{ quietEmpty: true \}\)/);
  assert.doesNotMatch(renderer, /Type at least 2 characters to search/);
  assert.match(styles, /\.quick-panel\.quick-panel-minimal \{[\s\S]*?background: #181818;[\s\S]*?border-color: #303030;/);
  assert.match(styles, /\.quick-meta\[hidden\],[\s\S]*?\.quick-results\[hidden\][\s\S]*?display: none;/);
  assert.match(renderer, /const QUICK_SEARCH_RESULT_LIMIT = 10000/);
  assert.match(renderer, /searchWorkspace\(\{ workspace: rootPath, query, limit: QUICK_SEARCH_RESULT_LIMIT, requestId \}\)/);
  assert.match(renderer, /cancelWorkspaceSearch\?\.\(\{ requestId \}\)/);
  assert.match(renderer, /onWorkspaceSearchBatch\?\.\(\(payload\) =>/);
  assert.match(renderer, /const QUICK_SEARCH_DEBOUNCE_MS = 225/);
  assert.match(renderer, /function renderVirtualizedSearchResults\(/);
  assert.match(renderer, /querySelector\(":scope > \.quick-results-virtual-space"\)[\s\S]*?space\.replaceChildren\(fragment\)/);
  assert.match(renderer, /quickSearchRenderFrame = requestAnimationFrame\(\(\) => flushWorkspaceSearchRows\(\)\)/);
  assert.match(renderer, /quickSearchScrollFrame = requestAnimationFrame\(\(\) => \{[\s\S]*?renderVirtualizedSearchResults\(\)/);
  assert.match(renderer, /detailHtml: highlightExactText\(detail, query\)/);
  assert.match(renderer, /exact match\$\{total === 1 \? "" : "es"\}/);
  assert.match(styles, /\.quick-panel\.quick-panel-search \{[\s\S]*?background: #181818;[\s\S]*?border-color: #303030;/);
  assert.match(styles, /\.quick-panel-search \.quick-input-row \{[\s\S]*?flex: 0 0 46px;[\s\S]*?height: 46px;[\s\S]*?padding: 0 16px;/);
  assert.match(styles, /\.quick-panel-search \.quick-meta \{[\s\S]*?flex: 0 0 28px;[\s\S]*?height: 28px;/);
  assert.match(styles, /\.quick-panel-search \.quick-result:hover,[\s\S]*?border-color: #2f8cf4;[\s\S]*?background: rgba\(47, 140, 244, \.1\);/);
  assert.match(styles, /\.quick-results\.is-virtualized \.quick-result \{[\s\S]*?position: absolute;[\s\S]*?height: 48px;/);
  assert.match(renderer, /function workspaceSearchResultItem\([\s\S]*?await openFile\(joinWorkspacePath\(row\.path\), name,[\s\S]*?line,[\s\S]*?column/);
  assert.match(renderer, /async function openFile\([\s\S]*?EditorManager\.revealLocation\?\.\(path, line, column\)/);
  assert.match(renderer, /line > 0 && isMarkdownFileName\(fileName\)[\s\S]*?markdownViewMode = "text"/);
  assert.match(renderer, /line > 0 && fileName === "Project Runtime Settings"[\s\S]*?settingsEditorMode = "json"/);
  assert.match(renderer, /if \(movedViewport\) \{[\s\S]*?renderVirtualizedSearchResults\(\);[\s\S]*?querySelectorAll\("\.quick-result"\)/);
  assert.match(renderer, /row\.addEventListener\("mouseenter"[\s\S]*?classList\.contains\("is-virtualized"\)[\s\S]*?candidate\.classList\.toggle\("active"/);
  assert.match(editorController, /async revealLocation\(path, line = 1, column = 1\)[\s\S]*?setPosition\(position\)[\s\S]*?revealPositionInCenter\(position/);
  assert.match(chatStyles, /\.agent-task-brief\s*\{[\s\S]*?display: none !important/);
  assert.match(styles, /\.chat-empty-state/);
  assert.match(styles, /#chat-pane[\s\S]*max-width: max\(300px, 50vw\)/);
  assert.match(chatStyles, /#messages \.tool-card/);
  assert.doesNotMatch(styles, /\.tool-card \{ min-height:66px/);
  assert.match(chatStyles, /#messages \.tool-card,[\s\S]*?display: block !important[\s\S]*?min-height: 0 !important/);
  assert.match(chatStyles, /#messages \.tool-card-file \{[\s\S]*?max-width: none !important[\s\S]*?text-overflow: clip !important/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \.chat-box[\s\S]*?width: 100%/);
  assert.match(chatStyles, /\.composer:focus-within[\s\S]*?border-color: #3b3b3b[\s\S]*?box-shadow: none/);
  assert.match(activeIpc, /path: resolved\.target/);
  assert.doesNotMatch(renderer, /Show run details/);
  assert.match(renderer, /function syncChatStickyMask\(/);
  assert.match(renderer, /source === "parent_continuation"/);
  assert.match(renderer, /function renderParentContinuationEvent\(/);
  assert.match(main, /function scheduleParentContinuation\(/);
  assert.match(main, /onResultReady: \(readyResult\) => \{[\s\S]*?scheduleParentContinuation\(coordinationKey, readyResult\)/);
  assert.match(main, /agent:pendingParentContinuations/);
  assert.match(renderer, /pendingParentContinuations/);
  assert.match(renderer, /getBoundingClientRect\(\)/);
  assert.match(renderer, /--chat-sticky-mask-solid-height/);
  assert.doesNotMatch(renderer, /LOCAL AI WORKSPACE|Actions, tool calls, approvals, and verification stay visible/);
  assert.doesNotMatch(html, /chat-header-context|chat-header-status|AI workspace/);

  const chatStart = html.indexOf('<aside id="chat-pane">');
  const chatEnd = html.indexOf('</aside>', chatStart);
  assert.ok(chatStart >= 0 && chatEnd > chatStart, "chat pane markup should remain discoverable");
  const chatMarkup = html.slice(chatStart, chatEnd);
  assert.match(chatMarkup, /id="context-usage-btn"/);
  assert.match(chatMarkup, /id="send-btn"[\s\S]*?codicon-arrow-up/);
  assert.match(html, /id="context-usage-popover"[\s\S]*?Context Usage[\s\S]*?id="context-usage-heading-value"[\s\S]*?id="context-usage-used"[\s\S]*?id="context-usage-breakdown"/);
  assert.doesNotMatch(html, /context-usage-free|context-usage-diagnostics|context-compaction-status|context-usage-measure-note/);
  for (const label of ["System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP", "Summarized Conversation", "Active Conversation", "Current Workflow"]) assert.match(renderer, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(renderer, /label: "Working References"/);
  assert.ok(renderer.indexOf("const CONTEXT_USAGE_ROW_LABELS") < renderer.indexOf("\nsyncChatModeUi();"), "context labels must initialize before the first context render");
  assert.match(renderer, /contextUsageUsed\.textContent = `\$\{Math\.round\(displayPct \* 100\)\}%`/);
  assert.doesNotMatch(renderer, /context-usage-row-value">~/);
  assert.match(layoutStyles, /\.context-ring-btn \{[\s\S]*?display: inline-flex;[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
  assert.match(layoutStyles, /\.send-btn:disabled \{[\s\S]*?visibility: visible;/);
  assert.match(layoutStyles, /\.chat-session-label \{[\s\S]*?line-height: 1;/);
  assert.match(layoutStyles, /\.chat-tab-close \{[\s\S]*?align-self: center;[\s\S]*?line-height: 1;/);
  assert.match(layoutStyles, /\.chat-tab-close::before \{[\s\S]*?display: block;[\s\S]*?line-height: 1;[\s\S]*?transform: translateY\([12]px\);/);
  assert.doesNotMatch(chatMarkup, /12\s*Files|paperclip|microphone|attachment/i);
  assert.doesNotMatch(chatMarkup, /chat-sticky-user/);
  assert.match(read("src/ui/react/main.jsx"), /import "\.\.\/styles\/chat\.css"/);
  assert.doesNotMatch(renderer, /chatStickyUser|syncStickyUserTurn|cloneNode\(true\)/);
  assert.match(renderer, /function normalizeChatExchanges\(/);
  assert.match(renderer, /appendChatTurn\(turn, \{ startsExchange: true \}\)/);
  assert.match(chatStyles, /#messages \.chat-exchange-body \{[\s\S]*?gap: 0/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \{[\s\S]*position: sticky[\s\S]*top: 8px/);
  assert.match(chatStyles, /#messages \.agent-response-host > \.assistant-reply-footer/);
  assert.match(chatStyles, /#messages \.chat-exchange-body > \.assistant-reply-footer/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \.chat-box[\s\S]*background: #252526 !important/);
  assert.match(chatStyles, /#chat-pane::before[\s\S]*height: var\(--chat-sticky-mask-solid-height\)[\s\S]*background: #171717/);
  assert.match(chatStyles, /#chat-pane::after[\s\S]*top: calc\(35px \+ var\(--chat-sticky-mask-solid-height\)\)[\s\S]*height: 12px[\s\S]*linear-gradient/);
  assert.match(chatStyles, /#chat-pane::before[\s\S]*right: 10px/);
  assert.match(chatStyles, /#messages::-webkit-scrollbar-track[\s\S]*background: transparent !important/);
  assert.match(chatStyles, /#messages::-webkit-scrollbar-thumb[\s\S]*background: transparent !important/);
  assert.match(renderer, /function syncScrollerScrollbarHover\(/);
  assert.match(renderer, /function chatViewportMaxWidth\(/);
  assert.match(renderer, /window\.innerWidth \* 0\.5/);
  assert.match(renderer, /scrollbar-hover/);
  assert.match(chatStyles, /#messages\.scrollbar-hover[\s\S]*rgba\(66, 66, 66, \.7\)/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \{[\s\S]*margin: var\(--chat-row-gap\) 0 0[\s\S]*padding: 0/);
  assert.doesNotMatch(chatStyles, /\.chat-sticky-user/);
});

test("chat history is compact, searchable, and keeps archive/delete actions hover-only", () => {
  const renderer = read("src/ui/bootstrap.js");
  const history = read("src/ui/features/history/history-model.js");
  const chatStyles = read("src/ui/styles/chat.css");
  const html = readUiShell();

  assert.match(html, /id="chat-history-search"[^>]*placeholder="Search Agents\.\.\."/);
  assert.doesNotMatch(html, /chat-history-close/);
  assert.match(renderer, /chatHistorySearch\?\.addEventListener\("input"/);
  assert.doesNotMatch(renderer, /chatHistoryClose/);
  assert.match(renderer, /data-archive-session/);
  assert.match(renderer, /data-destroy-session/);
  assert.match(renderer, /function archiveChatSession\(/);
  assert.match(history, /RECENT_HISTORY_LIMIT\s*=\s*20/);
  assert.match(history, /slice\(0, safeLimit\)/);
  assert.match(renderer, /data-chat-history-more/);
  assert.match(renderer, /data-toggle-archived/);
  assert.match(renderer, /function fitChatHistoryTitle\(/);
  assert.match(renderer, /\[\.\.\.chatSessions, \.\.\.closedChatSessions\]/);
  assert.match(renderer, /sortHistorySessions\(archivedChatSessions, query\)/);
  assert.match(renderer, /paginateRecentHistory\(recent/);
  assert.match(renderer, /groupHistoryByAge\(visibleRecent\)/);
  assert.match(history, /label: "Today"/);
  assert.match(history, /label: "Previous 7 days"/);
  assert.match(chatStyles, /\.chat-history-group-label/);
  assert.match(renderer, /function scrollChatSessionIntoView\(sessionId = activeChatSessionId\)/);
  assert.match(renderer, /renderChatSessionSelect\(\);\s*scrollChatSessionIntoView\(session\.id\);/);
  assert.match(chatStyles, /\.chat-history-session-actions\s*\{[\s\S]*?opacity:\s*0[\s\S]*?pointer-events:\s*none/);
  assert.match(chatStyles, /\.chat-history-session:hover \.chat-history-session-actions[\s\S]*?opacity:\s*1[\s\S]*?pointer-events:\s*auto/);
  assert.match(chatStyles, /\.chat-history-session-title[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(chatStyles, /\.chat-history-more\s*,[\s\S]*?\.chat-history-archive-toggle/);
});

test("running chats stay navigable and signal background completion per tab", () => {
  const renderer = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");
  const styles = read("src/ui/styles/base.css");
  const renderStart = renderer.indexOf("function renderChatSessionSelect");
  const renderEnd = renderer.indexOf("function scrollChatSessionIntoView", renderStart);
  const tabRenderer = renderer.slice(renderStart, renderEnd);
  const loadStart = renderer.indexOf("function loadChatSession");
  const loadEnd = renderer.indexOf("function newChatSession", loadStart);
  const loadSession = renderer.slice(loadStart, loadEnd);
  const scrollStart = renderer.indexOf("function scrollChatSessionIntoView");
  const scrollEnd = renderer.indexOf("chatSessionSelect?.addEventListener", scrollStart);
  const scrollSession = renderer.slice(scrollStart, scrollEnd);

  assert.match(renderer, /const activeChatRuns = new Map\(\)/);
  assert.match(renderer, /function activeSessionRun\(\)/);
  assert.match(renderer, /activeChatRuns\.set\(run\.sessionId, run\)/);
  assert.match(renderer, /const chatSessionsNeedingAttention = new Set\(\)/);
  assert.match(renderer, /function stashActiveChatRunView\([\s\S]*?while \(messages\.firstChild\) host\.appendChild\(messages\.firstChild\)/);
  assert.match(renderer, /function syncChatRunSession\(/);
  assert.match(tabRenderer, /const running = isChatSessionRunning\(session\.id\)/);
  assert.match(tabRenderer, /codicon-loading codicon-modifier-spin chat-tab-running-icon/);
  assert.match(tabRenderer, /chat-tab-attention/);
  assert.doesNotMatch(tabRenderer, /streaming \|\| !chatSessions\.length/);
  assert.doesNotMatch(loadSession, /\|\| streaming/);
  assert.doesNotMatch(scrollSession, /positionAuxiliary/);
  const scrollCalls = [];
  const scrollTab = {
    dataset: { sessionId: "chat-analysis" },
    scrollIntoView: (options) => scrollCalls.push(options),
  };
  const executeScroll = new Function(
    "chatSessionSelect",
    "activeChatSessionId",
    "requestAnimationFrame",
    `${scrollSession}; return scrollChatSessionIntoView;`,
  )(
    { querySelectorAll: () => [scrollTab] },
    "chat-analysis",
    (callback) => callback(),
  );
  assert.doesNotThrow(() => executeScroll("chat-analysis"));
  assert.deepEqual(scrollCalls, [{ block: "nearest", inline: "nearest", behavior: "auto" }]);
  assert.match(renderer, /if \(completedInBackground\) chatSessionsNeedingAttention\.add\(runSession\.id\)/);
  assert.match(renderer, /chatSessionsNeedingAttention\.delete\(session\.id\)/);
  assert.match(renderer, /if \(isChatSessionRunning\(id\)\) return/);
  assert.match(renderer, /if \(!text \|\| isChatSessionRunning\(targetSessionId\)\) return/);
  assert.match(renderer, /eventSessionId !== runEventSessionId/);
  assert.match(renderer, /sendBtn\.disabled = !activeRunning && \(\s*delegatedLocked/);
  assert.doesNotMatch(renderer, /Another agent is running/);
  assert.match(main, /sender\.send\("agent:event", \{ \.\.\.data, sessionId \}\)/);
  assert.match(styles, /\.chat-tab-running-icon\s*\{/);
  assert.match(styles, /\.chat-tab-attention\s*\{[\s\S]*?box-shadow:/);
});

test("question-tool cards use the refreshed UI and stay scoped to their owning chat", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");
  const html = readUiShell();

  assert.match(html, /id="composer-questions"[^>]*hidden/);
  assert.match(renderer, /const pendingComposerQuestionsBySession = new Map\(\)/);
  assert.match(renderer, /function syncComposerQuestionsForActiveSession\(\)[\s\S]*?pendingComposerQuestionsBySession\.get\(String\(activeChatSessionId \|\| ""\)\)[\s\S]*?composerQuestionsEl\.replaceChildren\(\)/);
  assert.match(renderer, /function applyActiveChatSession\(session\)[\s\S]*?syncComposerQuestionsForActiveSession\(\)/);
  assert.match(renderer, /function showComposerQuestionsPanel\(\{[\s\S]*?sessionId = activeChatSessionId[\s\S]*?pendingComposerQuestionsBySession\.set\(ownerSessionId/);
  assert.match(renderer, /function createAssistantTurn\(\{ container = messages, sessionId = activeChatSessionId \} = \{\}\)/);
  assert.match(renderer, /sessionId: String\(sessionId \|\| activeChatSessionId \|\| ""\)/);
  assert.match(renderer, /requestQuestions\([\s\S]*?sessionId: this\.sessionId/);
  assert.match(renderer, /createAssistantTurn\(\{ container: chatRunContainer\(run\), sessionId: run\.sessionId \}\)/);
  assert.doesNotMatch(renderer, /let pendingComposerQuestions\s*=/);

  assert.match(chatStyles, /\.agent-questions-card\s*\{[\s\S]*?border: 1px solid #303030[\s\S]*?background: #181818/);
  assert.match(chatStyles, /\.agent-questions-option:has\(input\[type="radio"\]:checked\)[\s\S]*?border-color: #2f8cf4[\s\S]*?rgba\(47, 140, 244, \.11\)/);
  assert.match(chatStyles, /data-questions-action="submit"\][\s\S]*?background: #2f8cf4/);
  assert.match(chatStyles, /\.composer-questions\s*\{[\s\S]*?margin-bottom: 8px/);
  assert.match(chatStyles, /#input-bar\.has-composer-questions \.composer\s*\{[\s\S]*?border-color: #3b3b3b/);
  assert.match(renderer, /function questionOptionsWithFreeWrite\(/);
  assert.match(renderer, /placeholder="Or describe something else"/);
  assert.match(renderer, /input\.dataset\.freeWrite !== "1"/);
  assert.doesNotMatch(renderer, /placeholder="Type something\.\.\."/);
});

test("mouse-picked slash commands use a yellow chip while typed commands remain plain", () => {
  const renderer = read("src/ui/bootstrap.js");
  const html = readUiShell();
  const chatStyles = read("src/ui/styles/chat.css");
  const parser = read("src/app/commands/command-parser.js");

  assert.match(html, /id="selected-slash-command"[^>]*hidden/);
  assert.match(html, /id="chat-input"[^>]*contenteditable="plaintext-only"[^>]*role="textbox"[^>]*aria-label="Chat message"[^>]*data-placeholder="Ask, investigate, run, or search"/);
  assert.match(html, /id="chat-input"[\s\S]*?id="selected-slash-command"/);
  assert.doesNotMatch(html, /id="selected-slash-command"[^>]*contenteditable="false"/);
  assert.match(renderer, /function modePlaceholder\(/);
  assert.match(renderer, /chatInput\.placeholder = selectedSlashCommand \? "" : modePlaceholder\(\)/);
  assert.match(renderer, /chooseSlashSuggestion\(index, \{ clicked: true \}\)/);
  assert.match(renderer, /function chooseSlashSuggestion\(index = slashSuggestionIndex, \{ clicked = false \} = \{\}\)/);
  assert.match(renderer, /function effectiveChatInputValue\(\)/);
  assert.match(renderer, /const SYSTEM_SKILL_SLASH_COMMANDS = Object\.freeze\(\[/);
  assert.match(renderer, /"system-skill": "System Skills"/);
  assert.match(renderer, /\.\.\.SYSTEM_SKILL_SLASH_COMMANDS/);
  assert.match(renderer, /SYSTEM_SKILL_COMMANDS\.has\(command\.toLowerCase\(\)\)/);
  assert.match(renderer, /let text = hasExplicitText[\s\S]*?: effectiveChatInputValue\(\)\.trim\(\)/);
  assert.match(html, /class="composer-input-row">[\s\S]*?id="chat-input"[\s\S]*?id="selected-slash-command"/);
  assert.doesNotMatch(html, /selected-slash-command-clear/);
  assert.match(renderer, /\["Tab", "Shift"\]\.includes\(e\.key\)[\s\S]*?chooseSlashSuggestion\(slashSuggestionIndex, \{ clicked: true \}\)/);
  assert.match(renderer, /e\.key === "Backspace" && isChatInputCaretAtArgumentStart\(\)[\s\S]*?clearSelectedSlashCommand\(\)/);
  assert.match(renderer, /function installChatInputEditorAdapter\(\)[\s\S]*?Object\.defineProperties\(chatInput[\s\S]*?value:[\s\S]*?get: \(\) => chatInputEditorValue\(\)/);
  assert.match(renderer, /function setChatInputCaretToEnd\(\)[\s\S]*?range\.selectNodeContents\(chatInput\)/);
  assert.match(renderer, /function reconcileSelectedSlashCommandAfterEdit\(\)[\s\S]*?tokenRemoved[\s\S]*?tokenEdited[\s\S]*?classList\.remove\("selected-slash-command"\)/);
  assert.match(renderer, /\[contenteditable\]:not\(\[contenteditable=\\"false\\"\]\)/);
  assert.match(chatStyles, /\.composer-input-row #chat-input\s*\{[\s\S]*?width:100%;[\s\S]*?white-space:pre-wrap/);
  assert.match(chatStyles, /\.selected-slash-command\s*\{[\s\S]*?display:inline-flex[\s\S]*?background:rgba\(215,173,43,\.14\)[\s\S]*?user-select:text/);
  assert.match(chatStyles, /#chat-input\.chat-input-empty::before[\s\S]*?content:attr\(data-placeholder\)/);
  assert.doesNotMatch(renderer, /name: "\/active"/);
  assert.doesNotMatch(parser, /"\/active"\s*:/);
});

test("background terminal continuations remain internal to the agent runtime", () => {
  const renderer = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");
  const chatStyles = read("src/ui/styles/chat.css");

  assert.match(renderer, /function isInternalRuntimeInputMessage\(message = \{\}\)/);
  assert.match(renderer, /__xekuteInternalRuntimeInput/);
  assert.match(renderer, /\^Harness \(\?:checkpoint:\|waited\\b\)/);
  assert.match(renderer, /handleBackgroundWaitEvent\([\s\S]*?sendMessageWithAgentRuntime\(\{[\s\S]*?internal: true,[\s\S]*?text: message,[\s\S]*?skipContextFiles: true/);
  assert.doesNotMatch(renderer, /function appendHarnessWaitLine\(/);
  assert.doesNotMatch(renderer, /className = "harness-wait-line"/);
  assert.doesNotMatch(chatStyles, /\.harness-wait-line/);
  assert.match(renderer, /querySelectorAll\("\.harness-wait-line"\)\.forEach\(\(node\) => node\.remove\(\)\)/);
  assert.doesNotMatch(renderer, /chatInput\.value = message;[\s\S]{0,100}sendMessageWithAgentRuntime\(\)/);
  assert.match(renderer, /userMessage: internal && options\?\.continuation \? "" : text/);
  assert.match(renderer, /internalRuntimeInput: internal/);
  assert.match(renderer, /internalSkillId: internal \? String\(options\?\.internalSkillId \|\| ""\) : ""/);
  assert.match(main, /const internalSkillId = payload\.internalRuntimeInput \? String\(payload\.internalSkillId \|\| ""\)\.trim\(\)\.toLowerCase\(\) : ""/);
  assert.match(main, /const skillIntent = payload\.internalRuntimeInput[\s\S]*?\? \(internalSkillId \? `\/\$\{internalSkillId\}` : ""\)/);
});

test("hidden background runtime remains isolated from the visible chat surface", () => {
  const renderer = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");
  const prompt = read("src/prompts/instructions/system-prompt.js");

  assert.doesNotMatch(renderer, /scheduleTier2MemoryMaintenance|isTier2MemoryTool|tier2MemoryMaintenance|TIER2_MEMORY/);
  assert.doesNotMatch(main, /tier2MemoryMaintenance|requireArtifactFinalization|update_project_artifacts|query_knowledge/);
  assert.doesNotMatch(prompt, /update_project_artifacts|Tier 2 maintenance/);
  assert.match(renderer, /function executeHiddenAgentRuntime\([\s\S]*?backgroundRuntime: true/);
  assert.match(renderer, /function sendHiddenAgentRuntime\([\s\S]*?hiddenAgentRuntimeQueues\.set\(key, task\)/);
  assert.doesNotMatch(renderer, /schedulePentestContinuation|pentestLoop|internalSkillId:\s*"pentest"/);
  assert.match(renderer, /payload\?\.source === "background_runtime"[\s\S]*?handleHiddenBackgroundRuntimeEvent\(payload\)/);
  assert.match(renderer, /payload\?\.source === "parent_continuation"[\s\S]*?queueParentContinuationEvent\(payload\)/);
  assert.match(renderer, /handleHiddenBackgroundRuntimeEvent[\s\S]*?ackParentContinuation/);
  assert.doesNotMatch(main, /pentestLoopController|createPentestLoopController|pentest_checkpoint/);
  assert.match(main, /source: "background_runtime"/);
  assert.doesNotMatch(main, /result\.finalText = `\$\{String\(result\.finalText/);
});

test("assistant messages render a relative-time label beside the copy button", () => {
  const renderer = read("src/ui/bootstrap.js");
  const styles = read("src/ui/styles/base.css");

  // The formatter follows the documented compact tiers:
  // <1m → "Nm ago", <1d → "Hh Mm ago", <7d → "Nd ago",
  // <1yr → "Nw ago", then "Nyr ago" (final).
  assert.match(renderer, /function formatRelativeMessageTime\(iso\)/);
  assert.match(renderer, /Math\.max\(1, Math\.floor\(diffMs \/ minuteMs\)\)\}m ago/);
  assert.match(renderer, /\$\{h\}h \$\{m\}m ago/);
  assert.match(renderer, /Math\.floor\(diffMs \/ dayMs\)\}d ago/);
  assert.match(renderer, /Math\.floor\(diffMs \/ weekMs\)\}w ago/);
  assert.match(renderer, /Math\.floor\(diffMs \/ yearMs\)\}yr ago/);

  // The copy button is placed inside a footer that also carries the time label.
  assert.match(renderer, /assistant-reply-footer/);
  assert.match(renderer, /function attachAssistantCopyButton/);
  assert.match(renderer, /classList\?\.contains\("assistant-reply"\)/);
  assert.match(renderer, /function writeChatClipboardText\(text\)/);
  assert.match(renderer, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(renderer, /closest\("\.md-code-block, \.md-mermaid-block"\)/);
  assert.match(renderer, /formatRelativeMessageTime\(createdIso\)/);
  assert.match(renderer, /firstAssistantTurn\?\.dataset\?\.createdAt/);

  // Assistant turns in new and restored sessions carry a timestamp.
  assert.match(renderer, /turn\.dataset\.createdAt = new Date\(\)\.toISOString\(\)/);
  assert.match(renderer, /if \(message\.createdAt\) turn\.dataset\.createdAt = message\.createdAt/);

  assert.match(styles, /\.assistant-reply-footer\s*\{[\s\S]*?justify-content/);
  assert.match(styles, /\.assistant-reply-time\s*\{/);
});

test("long user prompts clamp to two lines and expand only on demand", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");

  assert.match(renderer, /function syncUserPromptDisclosure\(box\)[\s\S]*?content\.scrollHeight > content\.clientHeight \+ 1/);
  assert.match(renderer, /function createUserPromptBox\(text\)[\s\S]*?user-prompt-preview/);
  assert.match(renderer, /function renderCanonicalChatHistory[\s\S]*?createUserPromptBox\(content\)/);
  assert.match(renderer, /function addUserMessage\(text\)[\s\S]*?createUserPromptBox\(value\)/);
  assert.match(renderer, /messages\?\.addEventListener\("mousedown"[\s\S]*?activateUserPromptSelection\(promptBox, e\.clientX, e\.clientY\)/);
  assert.match(renderer, /messages\?\.addEventListener\("dblclick"[\s\S]*?selectWholeUserPrompt\(content\)/);
  assert.match(renderer, /function selectWholeUserPrompt\(content\)[\s\S]*?range\.selectNodeContents\(content\)/);
  assert.match(renderer, /dismissUserPromptSelectionIfOutside/);
  assert.match(renderer, /messages\?\.addEventListener\("keydown"[\s\S]*?\["Enter", " "\]/);
  assert.match(chatStyles, /user-prompt-preview[\s\S]*?-webkit-line-clamp: 2[\s\S]*?line-clamp: 2/);
  assert.match(chatStyles, /user-prompt-expandable\.is-expanded[\s\S]*?-webkit-line-clamp: unset/);
});

test("V3 checkpointing never hides or removes visible chat history", () => {
  const renderer = read("src/ui/bootstrap.js");
  const renderStart = renderer.indexOf("function renderCanonicalChatHistory");
  const renderEnd = renderer.indexOf("function ensureChatEmptyState", renderStart);
  const renderBody = renderer.slice(renderStart, renderEnd);

  assert.match(renderBody, /for \(const message of sourceHistory\) \{[\s\S]*?renderMessage\(message, fragment\);[\s\S]*?\}/);
  assert.match(renderBody, /messages\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(renderBody, /archivedThroughMessageId|chat-archive-marker/);
  assert.doesNotMatch(renderer, /maybeCompactContext|v3_checkpoint_owned|renderCanonicalChatHistory\(chatHistory\)/);
});

test("stopped streamed responses enter history before the durable outcome is written", () => {
  const renderer = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");
  const finalizeStart = renderer.indexOf("const finalizeChatHistory = async (outcome) =>");
  const finalizeEnd = renderer.indexOf("const runIsVisible", finalizeStart);
  const finalizeBody = renderer.slice(finalizeStart, finalizeEnd);
  const stopStart = renderer.indexOf("function stopGeneration()");
  const stopEnd = renderer.indexOf("sendBtn.addEventListener", stopStart);
  const stopBody = renderer.slice(stopStart, stopEnd);

  assert.match(renderer, /function syncAssistantDraftToHistory\([\s\S]*?history\.push\(message\)[\s\S]*?schedulePersistChatSessions\(session\)/);
  assert.match(renderer, /assistant\.appendContent\(delta\);[\s\S]*?syncAssistantDraftToHistory\(run, assistant, \{ persist: false \}\)/);
  assert.match(finalizeBody, /syncAssistantDraftToHistory\(run, assistant, \{ persist: false \}\)[\s\S]*?syncChatRunSession\(run, \{ persist: false \}\)[\s\S]*?finishChatHistoryBlock/);
  assert.match(stopBody, /syncAssistantDraftToHistory\(run, run\.assistant, \{ persist: false \}\)[\s\S]*?persistChatHistorySnapshot\(activeChatPersistenceScope, run\.session\)/);
  assert.match(stopBody, /abortActiveChatRun\(run\)/);
  assert.match(stopBody, /dropAutoContinuationsForSession/);
  assert.match(renderer, /function abortActiveChatRun\([\s\S]*?abortChat\?\.\(\{ sessionId \}\)/);
  assert.match(renderer, /isChatSessionStoppedByOperator/);
  assert.match(main, /function abortAgentSession\(/);
  assert.match(main, /key === prefix \|\| key\.startsWith\(`\$\{prefix\}::`\)/);
  assert.match(main, /if \(!current \|\| current\.aborted/);
  assert.doesNotMatch(stopBody, /manager\.stop|agent_cancelled/);
  assert.doesNotMatch(renderer, /runHistory\.splice\(historyStart\)/);
});

test("successful agent runs are not finalized as failed in finally", () => {
  const renderer = read("src/ui/bootstrap.js");
  const sendStart = renderer.indexOf("async function sendMessageWithAgentRuntime");
  const sendEnd = renderer.indexOf("function stopGeneration()", sendStart);
  const sendBody = renderer.slice(sendStart, sendEnd);
  const finallyStart = sendBody.indexOf("} finally {");
  const finallyBody = sendBody.slice(finallyStart);
  assert.match(sendBody, /await finalizeChatHistory\(assistant\.rawContent\.trim\(\) \? "completed" : "incomplete"\)/);
  assert.doesNotMatch(finallyBody, /finalizeChatHistory\(run\.stopRequested \? "stopped" : "failed"\)/);
});

test("encrypted V3 chat sessions preserve the exact sanitized display transcript separately from model history", async () => {
  const documents = new Map();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const projectId = "proj_display-transcript";
  const sensitiveStore = {
    readTranscript: (_projectId, sessionId) => documents.has(sessionId)
      ? { ok: true, exists: true, encrypted: true, durable: true, value: clone(documents.get(sessionId)) }
      : { ok: true, exists: false },
    writeTranscript: (_projectId, sessionId, value) => {
      documents.set(sessionId, clone(value));
      return { ok: true, encrypted: true, durable: true };
    },
    listSessionIds: () => ({ ok: true, session_ids: [...documents.keys()] }),
    deleteSession: (_projectId, sessionId) => ({ ok: true, removed: documents.delete(sessionId) }),
    transcriptFile: () => "",
    flush: () => ({ ok: true }),
  };
  const projectIdentityStore = {
    resolveV3Project: () => ({ ok: true, projectId, canonical: "G:/Xekute", workspace: "G:/Xekute" }),
  };
  const store = createV3SessionStore({ sensitiveStore, projectIdentityStore });
  const begun = await store.begin("G:/Xekute", { sessionId: "visible-chat", userPrompt: "Run it" });
  const displayHtml = '<div class="chat-exchange"><div class="agent-command-event" data-state="error">Command failed</div><div class="tool-card" data-state="success">Read file</div></div>';

  const saved = await store.record("G:/Xekute", {
    type: "snapshot",
    sessionId: begun.sessionId,
    blockId: begun.blockId,
    transcript: [{ role: "user", content: "Run it" }, { role: "assistant", content: "Done" }],
    displayHtml,
  });
  assert.equal(saved.ok, true);

  const loaded = store.load("G:/Xekute");
  assert.equal(loaded.sessions[0].messagesHtml, displayHtml);
  assert.deepEqual(loaded.sessions[0].history.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Run it" },
    { role: "assistant", content: "Done" },
  ]);

  const uiTranscript = {
    version: 1,
    runs: [{
      id: "run-000",
      started_at: "2026-09-12T08:00:00.000Z",
      ended_at: "2026-09-12T08:01:38.000Z",
      worked_for_ms: 98000,
      user: { created_at: "2026-09-12T08:00:00.000Z", message: "Run it" },
      events: [
        { type: "thinking", started_at: "2026-09-12T08:00:04.200Z", ended_at: "2026-09-12T08:00:16.200Z", duration_ms: 12000, text: "check the renderer" },
        { type: "tool_group", items: [{ type: "tool", name: "read_file", target: "index.js", status: "ok" }] },
        { type: "chat", verdict: true, created_at: "2026-09-12T08:01:38.000Z", text: "Done" },
      ],
    }],
  };
  const withTimeline = await store.record("G:/Xekute", {
    type: "snapshot",
    sessionId: begun.sessionId,
    blockId: begun.blockId,
    transcript: [{ role: "user", content: "Run it" }, { role: "assistant", content: "Done" }],
    displayHtml,
    uiTranscript,
  });
  assert.equal(withTimeline.ok, true);
  const reloaded = store.load("G:/Xekute");
  assert.equal(reloaded.sessions[0].transcript.runs[0].worked_for_ms, 98000);
  assert.equal(reloaded.sessions[0].transcript.runs[0].events[0].duration_ms, 12000);
  assert.equal(reloaded.sessions[0].transcript.runs[0].events[2].verdict, true);
});

test("every rendered agent event refreshes the durable display transcript", () => {
  const renderer = read("src/ui/bootstrap.js");
  const store = read("src/app/storage/memory/v3-session-store.js");
  const delegation = read("src/agent/runtime/delegation-provider.js");

  assert.match(renderer, /displayHtml: session\.messagesHtml \|\| ""/);
  assert.match(renderer, /uiTranscript: normalizeUiTranscript\(session\.transcript\)/);
  assert.match(renderer, /function renderStructuredChatTranscript/);
  assert.match(renderer, /from "\.\/features\/chat\/chat-transcript\.js"/);
  assert.match(renderer, /captureChatTranscript\(/);
  assert.match(renderer, /await handleAgentEvent\(payload\);\s*scheduleLiveChatSnapshot\(run\)/);
  assert.match(renderer, /function scheduleLiveChatSnapshot/);
  assert.match(renderer, /LIVE_CHAT_SNAPSHOT_MS = 1200/);
  assert.match(renderer, /function hydratePersistedChatTranscript/);
  assert.match(renderer, /scheduleDelegatedLiveSnapshot\(run\);\s*if \(runIsChildVisible/);
  assert.match(renderer, /function persistCommandTimelineRowState/);
  assert.match(store, /display_html: messageContent\(source\.display_html \|\| source\.displayHtml \|\| ""\)/);
  assert.match(store, /ui_transcript: normalizeUiTranscript/);
  assert.match(store, /transcript: clone\(document\.ui_transcript\)/);
  assert.match(delegation, /childSessionBindings/);
  assert.match(delegation, /blockId: event\.blockId \|\| binding\.blockId \|\| ""/);
});

test("agent turns retain tool and command rows without a redundant progress checklist", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");
  const prompt = read("src/prompts/instructions/system-prompt.js");

  assert.match(renderer, /payload\.type === "content" \|\| payload\.type === "token"/);
  assert.doesNotMatch(renderer, /className = "agent-progress-feed"|setProgressUpdate|agentToolProgressText/);
  assert.match(renderer, /querySelectorAll\("\.agent-progress-feed"\).*node\.remove/);
  assert.match(renderer, /ensureToolCard\(assistant\.turn, assistant\.contentEl, payload\.tool, \{ pending: true \}\)/);
  assert.match(renderer, /KEEPABLE_TOOL_ACTIONS\.has\(action\)/);
  assert.match(renderer, /if \(finalText && !assistant\.rawContent\.trim\(\) && !hasStopVerdict\) assistant\.setRawContent\(finalText\)/);
  assert.doesNotMatch(renderer, /streamedText\.endsWith\(finalText\)/);
  assert.match(renderer, /payload\.type === "output_continuation"/);
  assert.match(renderer, /Continuing the response/);
  assert.doesNotMatch(chatStyles, /\.agent-progress-(?:feed|entry|icon|text)/);
  assert.match(chatStyles, /\.tool-card\[data-state="error"\] \{ display: none !important; \}/);
  assert.match(renderer, /function stripFailedToolCardStubs\(/);
  assert.match(renderer, /function isTransientToolCardLabel\(/);
  assert.match(renderer, /function isPlaceholderToolCardLabel\(/);
  assert.match(renderer, /function isStubToolStatusLabel\(/);
  assert.match(renderer, /syncToolCardPlaceholderVisibility\(card\)/);
  assert.match(renderer, /if \(type === "error"\) \{\s*card\.remove\(\);/);
  assert.match(renderer, /isStubToolStatusLabel\(label\) \|\| isBareToolVerbLabel\(label\) \|\| \(type === "success" && isTransientToolCardLabel\(label\)\)/);
  assert.match(renderer, /KEEPABLE_TOOL_LABEL\.test\(value\)/);
  assert.match(prompt, /Before invoking a tool, provide one short user-facing progress update/);
  assert.match(prompt, /never reveal private chain-of-thought/);
});

test("command execution renders as sequential collapsed chat events without entering copied prose", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");

  assert.match(renderer, /function createCommandTimelineRow/);
  assert.match(renderer, /row\.className = "agent-command-event"/);
  assert.match(renderer, /row\.open = false/);
  assert.doesNotMatch(renderer, /createCommandTimelineRow[\s\S]*?codicon-terminal agent-command-shell/);
  assert.match(renderer, /if \(state === "success"\) return "Ran Command"/);
  assert.match(renderer, /if \(state === "error"\) return "Command failed"/);
  assert.match(renderer, /function commandResultFailed/);
  assert.match(renderer, /failRunningCommand\(tool, result\)/);
  assert.match(renderer, /sealCurrentContentSegment\(\);[\s\S]*?appendChatStreamNode\(this\.toolWorkMount\(\), row\)[\s\S]*?ensurePostToolContentSegment\(/);
  assert.match(renderer, /assistant\.ensureCommandEvent\(payload\.tool\)/);
  assert.match(renderer, /assistant\.completeCommandEvent\(payload\.tool, uiResult\)/);
  assert.match(renderer, /\(this\.rootTurn \|\| this\.turn\)\.dataset\.rawAssistant = this\.rawContent/);
  assert.match(renderer, /assistantTurn\.dataset\.rawAssistant/);
  assert.match(renderer, /TerminalManager\.attachAgentSession\(\{[\s\S]{0,220}payload\.id/);
  assert.match(chatStyles, /\.agent-command-event\s*\{/);
  assert.match(chatStyles, /\.agent-command-event\[open\] \.agent-command-chevron/);
  assert.match(chatStyles, /\.agent-command-body code\s*\{/);
});

test("command completion settles timers immediately across call, process, and terminal identities", () => {
  const renderer = read("src/ui/bootstrap.js");

  assert.match(renderer, /commandCallId/);
  assert.match(renderer, /function commandLifecycleIds/);
  assert.match(renderer, /function bindCommandTimelineIdentity/);
  assert.match(renderer, /completedCommandLifecycles/);
  assert.match(renderer, /if \(type === "terminal_complete"\) \{\s*finalizeCommandTimeline\(payload/);
  assert.match(renderer, /only the transcript continuation waits for the active turn to finish/);
  assert.match(renderer, /const completion = commandCompletionForRow\(row\)/);
  assert.match(renderer, /updateCommandTimelineRow\(row, completion\.state\)/);
  assert.doesNotMatch(renderer, /querySelectorAll\("\.agent-command-event\[data-process-id\]"\)/);
});

test("saved command transcripts reopen through the browser-safe tool normalizer", () => {
  const renderer = read("src/ui/bootstrap.js");
  const start = renderer.indexOf("function commandToolFromHistoryCall");
  const end = renderer.indexOf("function agentTerminalCommandForTool", start);
  const restoreHelper = renderer.slice(start, end);

  assert.match(restoreHelper, /ToolMap\.normalizeToolCall\?\.\(call\)/);
  assert.doesNotMatch(restoreHelper, /ToolMap\.parseArguments/);
  assert.match(restoreHelper, /catch \{ \/\* A damaged historical tool call must not block session opening/);
  assert.match(renderer, /\.map\(commandToolFromHistoryCall\)[\s\S]*?\.filter\(\(tool\) => isAgentTerminalTool\(tool\)\)/);
});

test("chat mode picker stays usable during a reply and only the next user turn uses the new mode", () => {
  const renderer = read("src/ui/bootstrap.js");
  const openMenu = renderer.slice(
    renderer.indexOf("function openChatModeMenu"),
    renderer.indexOf("function closeChatModeMenu"),
  );
  const toggleMenu = renderer.slice(
    renderer.indexOf("function toggleChatModeMenu"),
    renderer.indexOf("function positionChatModeMenu"),
  );
  const setMode = renderer.slice(
    renderer.indexOf("function setChatMode"),
    renderer.indexOf("function setChatFamily"),
  );
  const syncRun = renderer.slice(
    renderer.indexOf("function syncChatRunSession"),
    renderer.indexOf("function prepareActiveChatSessionForSwitch"),
  );
  const hiddenRuntime = renderer.slice(
    renderer.indexOf("async function executeHiddenAgentRuntime"),
    renderer.indexOf("function sendHiddenAgentRuntime"),
  );
  const sendStart = renderer.indexOf("async function sendMessageWithAgentRuntime");
  const sendRuntime = renderer.slice(
    sendStart,
    renderer.indexOf("activeChatRuns.set(run.sessionId, run)", sendStart),
  );

  assert.doesNotMatch(openMenu, /isRunningChatActive\(\)/);
  assert.doesNotMatch(toggleMenu, /isRunningChatActive\(\)/);
  assert.doesNotMatch(setMode, /isRunningChatActive\(\)/);
  assert.doesNotMatch(syncRun, /session\.chatMode = run\.mode/);
  assert.match(sendRuntime, /runSession\.turnMode = runMode/);
  assert.match(sendRuntime, /ensureChatMemorySessionId\(runSession\)/);
  assert.match(hiddenRuntime, /runSession\.turnMode \|\| runSession\.chatMode \|\| chatMode/);
  assert.match(hiddenRuntime, /ensureChatMemorySessionId\(runSession\)/);
  assert.match(renderer, /modeLabel\(liveRun\?\.mode \|\| chatMode\)/);
  assert.match(renderer, /from "\.\/features\/history\/chat-memory-session\.js"/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("function createChatSession"), renderer.indexOf("function memoryRecord")), /ensureChatMemorySessionId/);
});
