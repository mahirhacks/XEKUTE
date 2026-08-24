const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("only reasonably large Agent tasks receive the temporary checklist surface", () => {
  const controller = read("src/agent/controller/agent-controller.js");
  const modes = read("src/agent/modes/mode-registry.js");
  assert.match(controller, /function isReasonablyLargeAgentRequest\(/);
  assert.match(controller, /const shouldOfferTaskList = !nested && profile\.key === "agent"/);
  assert.match(controller, /availableTools = availableTools\.filter\(\(tool\) => String\(tool\?\.function\?\.name \|\| ""\) !== "update_task_list"\)/);
  assert.match(controller, /sendEvent\(\{ type: "task_list"/);
  assert.doesNotMatch(controller, /sendEvent\(\{ type: "task_brief", runId, brief: taskBrief \}\)/);
  assert.match(modes, /const MODE_TOOL_GROUPS = Object\.freeze\(\{ ask: ALL_MODE_TOOLS, agent: ALL_MODE_TOOLS, hypothesis: ALL_MODE_TOOLS, plan: ALL_MODE_TOOLS \}\)/);
  assert.match(modes, /"manage_plan"/);
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
  const html = read("src/ui/index.html");
  assert.match(renderer, /payload\.type === "task_brief"/);
  assert.match(renderer, /completeTaskBrief\(/);
  assert.match(renderer, /FILE_READ_TOOL_NAMES/);
  assert.match(renderer, /if \(phase === "error"\) return "Failed"/);
  assert.match(renderer, /if \(isFileReadTool\(tool\)\) return "Read"/);
  assert.match(renderer, /return "Edited"/);
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
  assert.match(renderer, /line > 0 && fileName === "settings\.config"[\s\S]*?settingsEditorMode = "json"/);
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
  assert.match(main, /onResultReady: \(readyResult\) => scheduleParentContinuation\(runKey, readyResult\)/);
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
  assert.match(html, /id="context-usage-popover"[\s\S]*?Context Usage[\s\S]*?id="context-usage-compact"[\s\S]*?id="context-usage-heading-value"[\s\S]*?id="context-usage-used"[\s\S]*?id="context-usage-breakdown"/);
  assert.doesNotMatch(html, /context-usage-free|context-usage-diagnostics|context-compaction-status|context-usage-measure-note/);
  assert.match(renderer, /system_tools: "System & Tools"[\s\S]*?project_memory: "Project Memory"[\s\S]*?recent_working_set: "Recent Working Set"/);
  assert.ok(renderer.indexOf("const CONTEXT_USAGE_ROW_LABELS") < renderer.indexOf("\nsyncChatModeUi();"), "context labels must initialize before the first context render");
  assert.match(renderer, /contextUsageUsed\.textContent = `\$\{Math\.round\(pct \* 100\)\}%`/);
  assert.doesNotMatch(renderer, /context-usage-row-value">~/);
  assert.match(layoutStyles, /\.context-ring-btn \{[\s\S]*?display: inline-flex;[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
  assert.match(layoutStyles, /\.send-btn:disabled \{[\s\S]*?visibility: visible;/);
  assert.match(layoutStyles, /\.chat-session-label \{[\s\S]*?line-height: 1;/);
  assert.match(layoutStyles, /\.chat-tab-close \{[\s\S]*?align-self: center;[\s\S]*?line-height: 1;/);
  assert.match(layoutStyles, /\.chat-tab-close::before \{[\s\S]*?display: block;[\s\S]*?line-height: 1;[\s\S]*?transform: translateY\([12]px\);/);
  assert.doesNotMatch(chatMarkup, /12\s*Files|paperclip|microphone|attachment/i);
  assert.doesNotMatch(chatMarkup, /chat-sticky-user/);
  assert.match(html, /href="styles\/chat\.css"/);
  assert.doesNotMatch(renderer, /chatStickyUser|syncStickyUserTurn|cloneNode\(true\)/);
  assert.match(renderer, /function normalizeChatExchanges\(/);
  assert.match(renderer, /appendChatTurn\(turn, \{ startsExchange: true \}\)/);
  assert.match(chatStyles, /#messages \.chat-exchange \{[\s\S]*position: relative[\s\S]*flex: 0 0 auto[\s\S]*gap: 18px/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \{[\s\S]*position: sticky[\s\S]*top: 8px/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \.chat-box[\s\S]*background: #252526 !important/);
  assert.match(chatStyles, /#chat-pane::before[\s\S]*height: var\(--chat-sticky-mask-solid-height\)[\s\S]*background: #171717/);
  assert.match(chatStyles, /#chat-pane::after[\s\S]*top: calc\(35px \+ var\(--chat-sticky-mask-solid-height\)\)[\s\S]*height: 12px[\s\S]*linear-gradient/);
  assert.match(chatStyles, /#chat-pane::before[\s\S]*right: 10px/);
  assert.match(chatStyles, /#messages::-webkit-scrollbar-track[\s\S]*background: transparent !important/);
  assert.match(chatStyles, /#messages::-webkit-scrollbar-thumb[\s\S]*background: transparent !important/);
  assert.match(renderer, /function syncChatScrollbarHover\(/);
  assert.match(renderer, /function chatViewportMaxWidth\(/);
  assert.match(renderer, /window\.innerWidth \* 0\.5/);
  assert.match(renderer, /scrollbar-hover/);
  assert.match(chatStyles, /#messages\.scrollbar-hover[\s\S]*rgba\(56, 56, 56, \.55\)/);
  assert.match(chatStyles, /transition: background-color 160ms ease, opacity 160ms ease/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \{[\s\S]*margin: 0[\s\S]*padding: 0/);
  assert.doesNotMatch(chatStyles, /\.chat-sticky-user/);
});

test("chat history is compact, searchable, and keeps archive/delete actions hover-only", () => {
  const renderer = read("src/ui/bootstrap.js");
  const history = read("src/ui/features/history/history-model.js");
  const chatStyles = read("src/ui/styles/chat.css");
  const html = read("src/ui/index.html");

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
  const html = read("src/ui/index.html");

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
});

test("mouse-picked slash commands use a yellow chip while typed commands remain plain", () => {
  const renderer = read("src/ui/bootstrap.js");
  const html = read("src/ui/index.html");
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
  assert.match(renderer, /function addUserMessage\(text\)[\s\S]*?createUserPromptBox\(text\)/);
  assert.match(renderer, /chatPane\?\.addEventListener\("click"[\s\S]*?collapseExpandedUserPrompts\(\)/);
  assert.match(renderer, /chatPane\?\.addEventListener\("keydown"[\s\S]*?\["Enter", " "\]/);
  assert.match(chatStyles, /user-prompt-preview[\s\S]*?-webkit-line-clamp: 2[\s\S]*?line-clamp: 2/);
  assert.match(chatStyles, /user-prompt-expandable\.is-expanded[\s\S]*?-webkit-line-clamp: unset/);
});

test("context compression never hides or removes visible chat history", () => {
  const renderer = read("src/ui/bootstrap.js");
  const renderStart = renderer.indexOf("function renderCanonicalChatHistory");
  const renderEnd = renderer.indexOf("function ensureChatEmptyState", renderStart);
  const compactionStart = renderer.indexOf("async function maybeCompactContext");
  const compactionEnd = renderer.indexOf("function normalizeContextUsageSnapshot", compactionStart);
  const renderBody = renderer.slice(renderStart, renderEnd);
  const compactionBody = renderer.slice(compactionStart, compactionEnd);

  assert.match(renderBody, /for \(const message of sourceHistory\) renderMessage\(message, fragment\)/);
  assert.match(renderBody, /messages\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(renderBody, /archivedThroughMessageId|chat-archive-marker/);
  assert.doesNotMatch(compactionBody, /renderCanonicalChatHistory\(chatHistory\)/);
  assert.match(compactionBody, /syncActiveChatSession\(\)/);
});

test("agent turns stream operational narration and retain transparent tool progress", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");
  const prompt = read("src/prompts/instructions/system-prompt.js");

  assert.match(renderer, /payload\.type === "content" \|\| payload\.type === "token"/);
  assert.match(renderer, /className = "agent-progress-feed"/);
  assert.match(renderer, /setProgressUpdate\(`tool:\$\{toolCardKey\(payload\.tool\)\}`/);
  assert.match(renderer, /Finished running \$\{name\}\. I’m analyzing the result/);
  assert.match(renderer, /card\.dataset\.toolAction === "exec_command"/);
  assert.match(renderer, /if \(!streamedText\) assistant\.setRawContent\(finalText\)/);
  assert.match(renderer, /payload\.type === "output_continuation"/);
  assert.match(renderer, /Continuing response segment/);
  assert.match(chatStyles, /\.agent-progress-feed\s*\{/);
  assert.match(chatStyles, /\.agent-progress-entry\[data-state="success"\]/);
  assert.match(prompt, /Before invoking a tool, provide one short user-facing progress update/);
  assert.match(prompt, /never reveal private chain-of-thought/);
});

test("command execution renders as sequential collapsed chat events without entering copied prose", () => {
  const renderer = read("src/ui/bootstrap.js");
  const chatStyles = read("src/ui/styles/chat.css");

  assert.match(renderer, /function createCommandTimelineRow/);
  assert.match(renderer, /row\.className = "agent-command-event"/);
  assert.match(renderer, /row\.open = false/);
  assert.match(renderer, /codicon-terminal agent-command-shell/);
  assert.match(renderer, /if \(state === "success"\) return "Ran Command"/);
  assert.match(renderer, /sealCurrentContentSegment\(\);[\s\S]*?appendChild\(row\)[\s\S]*?createContentSegment\(\)/);
  assert.match(renderer, /assistant\.ensureCommandEvent\(payload\.tool\)/);
  assert.match(renderer, /assistant\.completeCommandEvent\(payload\.tool, uiResult\)/);
  assert.match(renderer, /turn\.dataset\.rawAssistant = this\.rawContent/);
  assert.match(renderer, /assistantTurn\.dataset\.rawAssistant/);
  assert.doesNotMatch(renderer, /TerminalManager\.attachAgentSession\(\{[\s\S]{0,180}payload\.id/);
  assert.match(chatStyles, /\.agent-command-event\s*\{/);
  assert.match(chatStyles, /\.agent-command-event\[open\] \.agent-command-chevron/);
  assert.match(chatStyles, /\.agent-command-body code\s*\{/);
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
