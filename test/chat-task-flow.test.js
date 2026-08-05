const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("workspace tasks emit a runtime-grounded plan before model work", () => {
  const controller = read("src/application/agent/controller.js");
  assert.match(controller, /function buildTaskBrief\(/);
  assert.match(controller, /sendEvent\(\{ type: "task_brief", runId, brief: taskBrief \}\)/);
  assert.match(controller, /id: "inspect"/);
  assert.match(controller, /id: "verify"/);
});

test("chat keeps runtime plans internal and renders a compact activity feed", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");
  const controller = read("src/application/agent/controller.js");
  const styles = read("src/presentation/ui/styles/base.css");
  const chatStyles = read("src/presentation/ui/styles/chat.css");
  const main = read("src/presentation/electron/main.js");
  const html = read("src/presentation/ui/index.html");
  assert.match(renderer, /payload\.type === "task_brief"/);
  assert.match(renderer, /completeTaskBrief\(/);
  assert.match(renderer, /FILE_READ_TOOL_NAMES/);
  assert.match(renderer, /if \(phase === "error"\) return "Failed"/);
  assert.match(renderer, /if \(isFileReadTool\(tool\)\) return "Read"/);
  assert.match(renderer, /return "Edited"/);
  assert.match(renderer, /data-guidance-delete-path/);
  assert.match(renderer, /deleteGuidanceEntry\(button\.dataset\.guidanceDeletePath/);
  assert.match(controller, /parts\.push\("Created\."\)/);
  assert.match(controller, /parts\.push\("Edited\."\)/);
  assert.match(controller, /parts\.push\("Deleted\."\)/);
  assert.match(controller, /parts\.push\("Read\."\)/);
  assert.match(renderer, /const filePath = String\(result\.path/);
  assert.match(renderer, /chatSessionSelect\?\.addEventListener\("wheel"/);
  assert.match(renderer, /chatSessionSelect\.scrollLeft - event\.deltaY/);
  assert.match(renderer, /behavior: force \? "smooth" : "auto"/);
  assert.match(styles, /\.agent-task-brief/);
  assert.match(chatStyles, /\.agent-task-brief\s*\{[\s\S]*?display: none !important/);
  assert.match(styles, /\.chat-empty-state/);
  assert.match(styles, /#chat-pane[\s\S]*max-width: max\(300px, 50vw\)/);
  assert.match(chatStyles, /#messages \.tool-card/);
  assert.doesNotMatch(styles, /\.tool-card \{ min-height:66px/);
  assert.match(chatStyles, /#messages \.tool-card,[\s\S]*?display: block !important[\s\S]*?min-height: 0 !important/);
  assert.match(chatStyles, /#messages \.tool-card-file \{[\s\S]*?max-width: none !important[\s\S]*?text-overflow: clip !important/);
  assert.match(chatStyles, /#messages \.chat-turn\.user \.chat-box[\s\S]*?width: 100%/);
  assert.match(chatStyles, /\.composer:focus-within[\s\S]*?border-color: #3b3b3b[\s\S]*?box-shadow: none/);
  assert.match(main, /path: resolved\.target/);
  assert.doesNotMatch(renderer, /Show run details/);
  assert.match(renderer, /function syncChatStickyMask\(/);
  assert.match(renderer, /getBoundingClientRect\(\)/);
  assert.match(renderer, /--chat-sticky-mask-solid-height/);
  assert.doesNotMatch(renderer, /LOCAL AI WORKSPACE|Actions, tool calls, approvals, and verification stay visible/);
  assert.doesNotMatch(html, /chat-header-context|chat-header-status|AI workspace/);

  const chatStart = html.indexOf('<aside id="chat-pane">');
  const chatEnd = html.indexOf('</aside>', chatStart);
  assert.ok(chatStart >= 0 && chatEnd > chatStart, "chat pane markup should remain discoverable");
  const chatMarkup = html.slice(chatStart, chatEnd);
  assert.match(chatMarkup, /id="context-usage-btn"/);
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

test("assistant messages render a relative-time label beside the copy button", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");
  const styles = read("src/presentation/ui/styles/base.css");

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
  assert.match(renderer, /formatRelativeMessageTime\(createdIso\)/);
  assert.match(renderer, /firstAssistantTurn\?\.dataset\?\.createdAt/);

  // Assistant turns in new and restored sessions carry a timestamp.
  assert.match(renderer, /turn\.dataset\.createdAt = new Date\(\)\.toISOString\(\)/);
  assert.match(renderer, /if \(message\.createdAt\) turn\.dataset\.createdAt = message\.createdAt/);

  assert.match(styles, /\.assistant-reply-footer\s*\{[\s\S]*?justify-content/);
  assert.match(styles, /\.assistant-reply-time\s*\{/);
});

test("long user prompts clamp to two lines and expand only on demand", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");
  const chatStyles = read("src/presentation/ui/styles/chat.css");

  assert.match(renderer, /function syncUserPromptDisclosure\(box\)[\s\S]*?content\.scrollHeight > content\.clientHeight \+ 1/);
  assert.match(renderer, /function createUserPromptBox\(text\)[\s\S]*?user-prompt-preview/);
  assert.match(renderer, /function renderCanonicalChatHistory[\s\S]*?createUserPromptBox\(content\)/);
  assert.match(renderer, /function addUserMessage\(text\)[\s\S]*?createUserPromptBox\(text\)/);
  assert.match(renderer, /chatPane\?\.addEventListener\("click"[\s\S]*?collapseExpandedUserPrompts\(\)/);
  assert.match(renderer, /chatPane\?\.addEventListener\("keydown"[\s\S]*?\["Enter", " "\]/);
  assert.match(chatStyles, /user-prompt-preview[\s\S]*?-webkit-line-clamp: 2[\s\S]*?line-clamp: 2/);
  assert.match(chatStyles, /user-prompt-expandable\.is-expanded[\s\S]*?-webkit-line-clamp: unset/);
});
