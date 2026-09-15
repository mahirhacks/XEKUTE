"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
const chatStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
const workFold = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "chat", "chat-work-fold.js"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

test("thinking streams into a Thinking / Thought for fold", () => {
  assert.match(renderer, /thinking:\s*null,\s*\n\s*thinkingConfigured:\s*false/);
  assert.match(renderer, /return settings\?\.thinking !== false/);
  assert.doesNotMatch(renderer, /createAssistantTurn\(modelThinkingEnabled\(settings\)\)/);
  assert.match(renderer, /function createAssistantTurn\(\{ container = messages, sessionId = activeChatSessionId \} = \{\}\)/);
  assert.match(renderer, /showPrivateReasoning\(\)/);
  assert.doesNotMatch(renderer, /assistant\.setStatus\("Thinking…"\)/);
  assert.match(workFold, /className = "agent-work-header agent-status-line"/);
  assert.match(renderer, /assistant\.setLiveState\(\{ kind: "thinking", detail: "Thinking" \}\)/);
  assert.match(renderer, /appendThinking\(/);
  assert.match(renderer, /function createThinkingFold/);
  assert.match(renderer, /textContent = "Thinking"/);
  assert.match(renderer, /return "Thought briefly"/);
  assert.match(renderer, /`Thought for \$\{formatAgentWorkDuration/);
  assert.match(renderer, /if \(elapsedMs < 10_000\) return "Thought briefly"/);
  assert.match(renderer, /function lastReusableExploredFold\(host\)/);
  assert.match(renderer, /lastStandaloneThinkingFold\(host\)/);
  assert.doesNotMatch(renderer, /thinking-block collapsed is-thinking/);
  assert.doesNotMatch(renderer, /activeThinkingPhase/);
});

test("content and tool events replace thinking and completion settles to elapsed time", () => {
  assert.match(renderer, /if \(payload\.type === "content" \|\| payload\.type === "token"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /if \(payload\.type === "tool_call"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /dismissLiveState\(\)/);
  assert.doesNotMatch(renderer, /detail: "Writing response"/);
  assert.doesNotMatch(renderer, /if \(payload\.type === "content" \|\| payload\.type === "token"\)[\s\S]*?assistant\.dismissLiveState\(\)/);
  assert.match(renderer, /if \(kind === "working" \|\| isStubToolStatusLabel\(label\)\)/);
  assert.doesNotMatch(renderer, /if \(kind === "working" \|\| isPlaceholderToolCardLabel\(label\) \|\| \/\^Working\/i\.test\(label\)\) return/);
  assert.doesNotMatch(renderer, /verb: running \? "Working" : "Done"/);
  assert.match(renderer, /function isStubToolStatusLabel/);
  assert.match(renderer, /completeReasoningActivity\(\)/);
  assert.match(renderer, /finishLiveState\(outcome = "complete"\)/);
  assert.match(renderer, /hadToolActivity\(\)/);
  assert.match(renderer, /if \(!stopped && !this\.hadToolActivity\(\)\) \{[\s\S]*?this\.dismissLiveState\(\)/);
  assert.doesNotMatch(renderer, /if \(payload\.type === "tool_call"\)[\s\S]{0,220}?assistant\.markToolUse\(\)/);
  assert.match(renderer, /`Worked for \$\{duration\}`/);
  assert.match(renderer, /`Finished in \$\{duration\}`/);
  assert.match(renderer, /const stopped = outcome === "stopped"/);
  assert.match(renderer, /const label = stopped[\s\S]*\? "Stopped"/);
  assert.doesNotMatch(renderer, /if \(outcome === "error" \|\| outcome === "stopped"\) \{[\s\S]{0,220}?this\.liveStateEl\?\.remove\(\)/);
  assert.match(renderer, /if \(kind === "planning"\) return "Planning/);
  assert.match(workFold, /export function isFoldableWorkLabel/);
  assert.match(workFold, /export function syncWorkHeaderAffordance/);
  assert.match(renderer, /if \(workHeader\.dataset\.foldable === "false" \|\| workHeader\.dataset\.state === "planning"\) return/);
  assert.match(chatStyles, /#messages \.agent-status-line\[data-state="planning"\] \{[\s\S]*font-size: 12px/);
  assert.match(chatStyles, /#messages \.agent-work-header\[data-foldable="false"\] \.agent-work-caret/);
  assert.match(chatStyles, /#messages \.agent-status-line\[data-state="planning"\] \.agent-work-caret/);
  assert.match(renderer, /isTransientToolCardLabel/);
  assert.match(renderer, /isPlaceholderToolCardLabel/);
  assert.match(chatStyles, /#messages \.agent-status-line\[data-final="true"\] \{[\s\S]*font-weight: 400/);
  assert.match(chatStyles, /#messages \.agent-status-line\[data-final="true"\]\[data-state="stopped"\] \{[\s\S]*font-weight: 700/);
  assert.match(renderer, /this\.settlePendingActivities\(outcome\)/);
  assert.match(renderer, /block\.querySelector\("\.agent-status-icon"\)\?\.remove\(\)/);
  assert.doesNotMatch(renderer, /codicon-debug-stop/);
  assert.match(chatStyles, /#messages \.agent-status-icon[\s\S]*?display: none/);
  assert.match(renderer, /template\.content\.querySelectorAll\("\.agent-status-line:not\(\[data-final='true'\]\)"\)/);
  assert.doesNotMatch(renderer, /else if \(!usedTools &&/);
  assert.doesNotMatch(renderer, /message\.textContent = "Reasoning complete"|completedThinkingLabel/);
});

test("turn finalization settles orphaned file and command activity without a progress checklist", () => {
  assert.match(renderer, /settlePendingActivities\(outcome = "complete"\)/);
  assert.doesNotMatch(renderer, /progressEntries|setProgressUpdate/);
  assert.match(renderer, /\.tool-card\.pending, \.tool-card\[data-state='queued'\], \.tool-card\[data-state='running'\]/);
  assert.match(renderer, /completedToolLabelFromRunning\(runningLabel\)/);
  assert.match(renderer, /\.agent-command-event\[data-state='running'\]/);
  assert.match(renderer, /if \(card\.classList\.contains\("subagent-wait"\)\) continue/);
});

test("status renderer owns one node and updates it in place", () => {
  assert.match(renderer, /if \(this\.liveStateEl\?\.isConnected\) return this\.liveStateEl/);
  // The fold leads the turn, so the status line is always the run's first row.
  assert.match(workFold, /turn\.insertBefore\(fold, turn\.firstChild\)/);
  assert.match(renderer, /block\.dataset\.stateKey === stateKey/);
  assert.match(renderer, /block\.classList\.add\("status-updated"\)/);
  assert.doesNotMatch(renderer, /list\.className = "agent-activity-lines"/);
});

test("tool-free responses do not render a warning or routing notice", () => {
  assert.match(renderer, /function isSilentToolRoutingActivity\(text = ""\)/);
  assert.match(renderer, /if \(isSilentToolRoutingActivity\(payload\.text\)\) return/);
  assert.doesNotMatch(controller, /No tools were routed for this request\./);
});

test("clarification UI is compact, hides internal metadata, and pages questions", () => {
  assert.match(renderer, /class="agent-questions-title"/);
  assert.match(renderer, /data-question-prompt=/);
  assert.match(renderer, /field\.hidden = index !== activeQuestionIndex/);
  assert.match(renderer, /stepLabel\.textContent = `\$\{activeQuestionIndex \+ 1\}\/\$\{questionFields\.length\}`/);
  assert.match(renderer, /codicon-chevron-left/);
  assert.match(renderer, /codicon-chevron-right/);
  assert.doesNotMatch(renderer, /Clarification needed|RUN PAUSED|agent-questions-reason|agent-questions-expiry/);
  assert.match(renderer, /class="agent-questions-recommended">\(Recommended\)<\/span>/);
  assert.match(chatStyles, /\.agent-questions-card \{[\s\S]*?border: 1px solid #303030[\s\S]*?background: #181818/);
  assert.match(chatStyles, /\.agent-questions-option \{[\s\S]*?grid-template-columns: 14px minmax\(0, 1fr\) auto/);
  assert.match(chatStyles, /\.agent-questions-option\.is-selected \{[\s\S]*?border-color: #2f8cf4[\s\S]*?background: rgba\(47, 140, 244, \.11\)/);
  assert.match(chatStyles, /\.agent-questions-field\[hidden\] \{ display: none !important; \}/);
  assert.match(chatStyles, /\.composer-questions \{[\s\S]*?z-index: 1;[\s\S]*?margin-bottom: 8px/);
  assert.match(chatStyles, /\.composer-questions:not\(\[hidden\]\) ~ \.composer \{[\s\S]*?z-index: 2[\s\S]*?border-color: #3b3b3b/);
  assert.match(chatStyles, /\.composer-questions-card \{[\s\S]*?padding-bottom: 0/);
  assert.match(chatStyles, /#input-bar\.has-composer-questions \.composer \{[\s\S]*?box-shadow: none/);
});

test("command approval shows an expandable command and resolves immediately without preselection", () => {
  const commandPanel = renderer.match(/function showCommandApprovalPanel\([\s\S]*?\r?\n}\r?\n\r?\nfunction showComposerQuestionsPanel/)?.[0] || "";
  assert.match(commandPanel, /Allow the below command to be executed\?/);
  assert.match(commandPanel, /class="agent-command-approval-preview" aria-expanded="false"/);
  assert.match(commandPanel, /data-command-decision="approve">Approve/);
  assert.match(commandPanel, /data-command-decision="deny">Deny/);
  assert.match(commandPanel, /document\.addEventListener\("pointerdown", outsidePointer\)/);
  assert.match(commandPanel, /finish\(button\.dataset\.commandDecision/);
  assert.doesNotMatch(commandPanel, /type="radio"|data-questions-action="(?:back|submit|skip)"|codicon-chevron-(?:left|right)/);
  assert.match(chatStyles, /\.agent-command-approval-button \{[\s\S]*?grid-template-columns: 14px minmax\(0, 1fr\)[\s\S]*?border-radius: 999px[\s\S]*?background: #383838/);
  assert.match(chatStyles, /\.agent-command-approval-button::before \{[\s\S]*?width: 13px[\s\S]*?border-radius: 50%[\s\S]*?background: #d0d0d0/);
  assert.doesNotMatch(chatStyles, /\.agent-command-approval-button\.deny/);
  assert.match(chatStyles, /\.agent-command-approval-preview code \{[\s\S]*?-webkit-line-clamp: 2/);
  assert.match(chatStyles, /\.agent-command-approval-preview\[aria-expanded="true"\] code/);
});

test("agent question tool supports recommended-first single select and explicit multi-select paging", () => {
  assert.match(renderer, /const isToolQuestionnaire = questionnaire\?\.kind === "agent_questions"/);
  assert.match(renderer, /const inputType = question\.multiple \? "checkbox" : "radio"/);
  assert.match(renderer, /isToolQuestionnaire && input\.checked && input\.dataset\.freeWrite !== "1"/);
  assert.match(renderer, /queueMicrotask\(\(\) => submitButton\?\.click\(\)\)/);
  assert.match(renderer, /selectedOptionIds: selectedInputs\.map/);
  assert.match(renderer, /Select more than one if applicable/);
  assert.match(chatStyles, /data-questions-action="skip"\] \{ order: 1/);
  assert.match(chatStyles, /data-questions-action="back"\] \{ order: 2; margin-left: auto/);
  assert.match(chatStyles, /data-questions-action="submit"\] \{ order: 3; background: #2f8cf4/);
});

test("large Agent work uses a temporary collapsible composer checklist", () => {
  assert.match(renderer, /function renderComposerTaskList\(payload = \{\}\)/);
  assert.match(renderer, /payload\.clear \|\| payload\.completed/);
  assert.match(renderer, /class="composer-task-list-card" aria-expanded=/);
  assert.match(renderer, /if \(!activeComposerTaskList\?\.expanded \|\| composerTaskListEl\?\.contains\(event\.target\)\) return/);
  assert.match(renderer, /if \(!isAgentTerminalTool\(tool\) && !isTaskListTool\(tool\)\)/);
  assert.match(chatStyles, /\.composer-task-list-card \{[\s\S]*?border-radius: 10px/);
  assert.match(chatStyles, /\.composer-task-list-row\[data-task-status="completed"\] \.composer-task-list-title \{[\s\S]*?text-decoration: line-through/);
});

test("status styling is chrome-free, neutral, animated, and motion-safe", () => {
  assert.match(chatStyles, /#messages \.agent-status-line \{[\s\S]*?border: 0[\s\S]*?background: transparent/);
  assert.match(chatStyles, /#messages \.agent-status-line \{[\s\S]{0,220}font: 400 14px/);
  assert.match(chatStyles, /#messages \.context-checkpoint-notice \{[\s\S]{0,220}font: 400 14px/);
  assert.match(chatStyles, /#messages \.agent-status-line\[data-final="true"\]/);
  assert.doesNotMatch(chatStyles, /#messages \.agent-status-line\[data-final="true"\] \{[\s\S]{0,120}font-size: 11\.5px/);
  assert.match(chatStyles, /@keyframes agent-status-update/);
  assert.match(chatStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?agent-status-line\.status-updated/);
});

test("tool activity sits in a two-lane stream under a Worked for header", () => {
  assert.match(renderer, /function ensureAssistantWorkFold/);
  assert.match(renderer, /function normalizeAssistantTurns/);
  assert.match(renderer, /function assistantStreamHost/);
  assert.match(renderer, /ensureWorkFold\(\)/);
  assert.match(renderer, /this\.ensureWorkFold\(\)/);
  assert.match(renderer, /`Working for \$\{formatAgentWorkDuration\(this\.startedAt\)\}`/);
  assert.match(renderer, /`Worked for \$\{duration\}`/);
  assert.match(workFold, /className = "agent-work-header agent-status-line"/);
  assert.match(workFold, /className = "agent-work-fold-body"/);
  assert.match(renderer, /function appendChatStreamNode/);
  assert.doesNotMatch(renderer, /if \(node\.classList\.contains\("agent-thinking-fold"\)\) continue;/);
  assert.match(renderer, /const fold = createRestoredWorkFold\(run\);\s*turn\.appendChild\(fold\);\s*mount = workFoldBody\(fold\);/);
  assert.match(renderer, /for \(const event of events\) appendTranscriptEvent\(mount, event\);/);
  assert.match(workFold, /className = "agent-work-caret"/);
  assert.match(renderer, /toggleWorkFold\(workHeader\.closest\("\.agent-work-fold"\)\)/);
  assert.match(renderer, /toggleCollapsibleFold\(workFoldToggle\.parentElement\)/);
  assert.match(chatStyles, /#messages \.agent-work-fold\[data-expanded="false"\] > \.agent-work-fold-body/);
  assert.match(workFold, /assets\/icons\/chat_fold_caret\.svg/);
  assert.match(renderer, /className = "agent-file-stack"/);
  assert.match(renderer, /agent-file-row tool-card/);
  assert.match(renderer, /function lastReusableExploredFold/);
  assert.match(renderer, /ensureExploredGroup\(\)/);
  assert.match(renderer, /exploredMount\(\)/);
  assert.match(renderer, /ensurePostToolContentSegment\(/);
  assert.match(renderer, /assistant\?\.ensurePostToolContentSegment\?\.\(\)/);
  assert.match(renderer, /function isKeepableToolCard/);
  assert.match(renderer, /if \(isKeepableToolCard\(card\)\) return false/);
  assert.doesNotMatch(renderer, /if \(card\.closest\?\.\("\.agent-explored-fold"\)\) return true/);
  assert.match(renderer, /function pruneEmptyWorkFolds/);
  assert.match(renderer, /hadToolActivity\(\) \{\s*return this\.assistantTurns\(\)\.some\(\(turn\) => boxHasToolUsage\(turn\)\)/);
  assert.match(renderer, /stripFailedToolCardStubs\(turn\);\s*pruneEmptyWorkFolds\(turn\)/);
  assert.match(renderer, /toolWorkMount\(\)/);
  assert.match(renderer, /conversationMount\(\)/);
  assert.match(workFold, /export function ensureTurnWorkFold/);
  assert.match(workFold, /export function promoteFinalAnswer/);
  assert.match(workFold, /export function unwrapWorkFold/);
  assert.match(renderer, /dataset\.workVerdict = "true"/);
  assert.match(renderer, /this\.verdictOpen = true/);
  assert.match(renderer, /openStopSection\(\{ collapse: true, allowEmpty: true \}\)/);
  assert.match(renderer, /function workFollowingReply/);
  assert.match(renderer, /const followingWork = workFollowingReply\(current\);\s*if \(!followingWork\) return current;/);
  assert.match(renderer, /const misplaced = this\.verdictOpen \? inWorkFold : current\.parentElement !== host;/);
  assert.match(renderer, /this\.pendingVerdictBreak = false;/);
  assert.match(renderer, /function coalesceAdjacentReplyRuns/);
  assert.match(renderer, /\.chat-turn\.assistant\[aria-busy='true'\]"\)\.forEach\(\(turn\) => turn\.setAttribute\("aria-busy", "false"\)\)/);
  assert.match(renderer, /coalesceLiveVerdict\(\)/);
  assert.doesNotMatch(renderer, /function promoteConversationOutOfWorkFolds/);
  assert.match(renderer, /function isBareToolVerbLabel/);
  assert.match(renderer, /ensureConversationSegment\(\)/);
  assert.match(renderer, /this\.ensureConversationSegment\(\)/);
  assert.match(chatStyles, /#messages \.agent-work-fold-body > \.assistant-reply \{[\s\S]{0,80}padding: 0/);
  assert.match(chatStyles, /#messages \.agent-work-fold \+ \.assistant-reply \{[\s\S]{0,80}padding: 0/);
  assert.match(chatStyles, /#messages \.agent-work-fold > \.agent-status-line\[data-final="true"\] \{[\s\S]{0,80}font-weight: 400[\s\S]{0,40}opacity: 0\.6/);
  assert.match(chatStyles, /#messages \.agent-work-fold > \.agent-status-line \{[\s\S]{0,160}font: 400 14px/);
  assert.match(renderer, /assistant\?\.sealCurrentContentSegment\?\.\(\)/);
  assert.doesNotMatch(renderer, /exploredMount\(\) \{[\s\S]{0,180}?agent-run-stop[\s\S]{0,80}?return this\.turn/);
  assert.match(chatStyles, /#messages \.agent-explored-fold \.tool-card\.tool-card-fade \{/);
  assert.match(renderer, /if \(!shouldAutoFadeToolCard\(card\)\) return/);
  assert.match(renderer, /running \? "Reading" : "Read"/);
  assert.match(renderer, /running \? "Searching" : "Searched"/);
  assert.match(renderer, /running \? "Editing" : "Edited"/);
  assert.match(renderer, /running \? "Browsing" : "Browsed"/);
  assert.match(renderer, /running \? "Replaying" : "Replayed"/);
  assert.match(renderer, /running \? "Delegating" : "Delegated"/);
  assert.match(renderer, /running \? "Searching web" : "Searched web"/);
  assert.match(renderer, /running \? "Reading page" : "Read page"/);
  assert.match(renderer, /running \? "Updating identity" : "Updated identity"/);
  assert.match(renderer, /"Ran Command"/);
  assert.match(renderer, /function isAskQuestionsTool/);
  assert.match(renderer, /KEEPABLE_TOOL_ACTIONS/);
  assert.doesNotMatch(chatStyles, /#messages \.agent-work-caret::before/);
  assert.match(chatStyles, /#messages \.agent-work-caret \{[\s\S]{0,180}?transform: none;/);
  assert.match(chatStyles, /#messages \.agent-thinking-fold\[data-expanded="false"\] > \.agent-thinking-toggle \.agent-work-caret[\s\S]{0,400}?transform: rotate\(-90deg\)/);
  assert.doesNotMatch(chatStyles, /#messages \.agent-work-caret \{[\s\S]{0,180}?transform: rotate\(-180deg\)/);
  assert.match(chatStyles, /#messages \.agent-explored-fold\[data-expanded="false"\] > \.agent-explored-body/);
  assert.match(chatStyles, /#messages \.agent-explored-fold:not\(:has\(\.tool-card:not\(\[hidden\]\), \.agent-command-event, \.subagent-run-card, \.agent-thinking-fold\)\)/);
  assert.match(chatStyles, /#messages \.agent-thinking-fold\[data-expanded="false"\] > \.agent-thinking-body/);
  assert.match(chatStyles, /#messages \.agent-tool-verb \{ opacity: \.8; \}/);
  assert.match(chatStyles, /#messages \.agent-tool-detail \{ opacity: \.5; \}/);
  assert.match(chatStyles, /--chat-row-gap: 4px/);
  assert.match(chatStyles, /--chat-work-gap: 24px/);
  assert.match(chatStyles, /--chat-run-gap: 24px/);
  assert.match(chatStyles, /#messages \.chat-turn\.assistant > :not\(\.assistant-reply-footer\),[\s\S]*?margin: var\(--chat-row-gap\) 0 0/);
  assert.match(chatStyles, /#messages \.chat-turn\.assistant > \.agent-work-fold \{[\s\S]*?margin: var\(--chat-work-gap\) 0 0/);
  assert.match(chatStyles, /#messages \.agent-response-host,[\s\S]*?padding: 0;/);
  assert.match(chatStyles, /padding: 12px 16px 24px/);
});

test("the Worked for section is one container, not a lane of stamped siblings", () => {
  // Collapsing must hide a single ancestor. Tool rows force their own display
  // with !important, so per-node hiding can never beat them.
  assert.match(chatStyles, /#messages \.agent-work-fold\[data-expanded="false"\] > \.agent-work-fold-body \{\s*display: none;/);
  assert.doesNotMatch(chatStyles, /data-activity-collapsed/);
  assert.doesNotMatch(chatStyles, /\[data-lane="activity"\]/);
  assert.doesNotMatch(chatStyles, /data-interim/);
  assert.doesNotMatch(renderer, /setActivityCollapsed|toggleActivityCollapsed|collapseFinishedWorkFolds/);
  // The flattener used to tear the container back into siblings on every pass.
  assert.doesNotMatch(renderer, /flattenNestedChatLayout/);

  // Interim work streams into the body; the closing answer sits beside it.
  assert.match(renderer, /return workFoldBody\(turnWorkFold\(host\)\) \|\| host;/);
  assert.match(renderer, /const fold = this\.ensureWorkFold\(\);\s*return workFoldBody\(fold\) \|\| this\.workHostTurn\(\);/);
  assert.match(workFold, /const answer = children\(body\)\.findLast\(\(child\) => isReplyNode\(child\) && !isEmptyReply\(child\)\);/);
  assert.match(workFold, /fold\.after\(answer\);/);
  assert.match(workFold, /child\.dataset\.workVerdict === "true"\) continue;/);
  assert.match(chatStyles, /#messages \.agent-work-fold-body > \.assistant-reply \{[\s\S]{0,60}color: #9a9a9a/);

  // Live completion and restore both settle through the same promotion.
  assert.match(renderer, /const answer = promoteFinalAnswer\(turn\);\s*if \(answer\) answer\.dataset\.workVerdict = "true";\s*if \(isFinishedWorkFold\(fold\)\) setWorkFoldExpanded\(fold, false\);/);
  assert.match(renderer, /restackFileRows\(turn\);\s*const answer = promoteFinalAnswer\(turn\);/);

  // Copy sits on the answer, not on the first folded fragment.
  assert.match(renderer, /this\.contentSegments\.findLast\(\(segment\) => !segment\.el\.hidden\)\?\.el \|\| this\.contentEl/);

  // An empty placeholder reply must not hold open a gap.
  assert.match(chatStyles, /#messages \.assistant-reply\[hidden\],\s*#messages \.assistant-reply:empty \{\s*display: none;/);
});

test("raw reasoning streams on thinking events and settles into a fold", () => {
  assert.match(controller, /sendEvent\(\{ type: "thinking", token: String\(token \|\| ""\) \}\)/);
  assert.doesNotMatch(controller, /thinkingSignaled/);
  assert.doesNotMatch(controller, /thinkingTrace|thinking:\s*String\(result\.thinking/);
  assert.match(main, /event\.sender\.send\("ollama:thinking", null\)/);
  assert.match(renderer, /assistant\.setLiveState\(\{ kind: "thinking", detail: "Thinking" \}\);\s*assistant\.appendThinking\(payload\.token \|\| payload\.delta \|\| ""\)/);
  assert.match(renderer, /this\.finishThinking\(\{ collapse: true \}\)/);
  assert.match(renderer, /sealExploredFolds\(this\.workHostTurn\(\)\)/);
});

test("streaming text fades in by delta without restoring the old activity line", () => {
  assert.match(renderer, /function animateStreamDelta\(container, delta\)/);
  assert.match(renderer, /reveal\.className = "stream-text-reveal"/);
  assert.match(renderer, /this\.syncDisplay\(\{ animateToken: token \}\)/);
  assert.match(styles, /@keyframes stream-text-reveal[\s\S]*?opacity: 0[\s\S]*?opacity: 1/);
  assert.doesNotMatch(renderer, /statusEl\.className = "assistant-status is-active"/);
  assert.doesNotMatch(styles, /\.assistant-status\.is-active/);
});

test("chat auto-follow pauses when the operator scrolls up", () => {
  assert.match(renderer, /let chatAutoFollow = true/);
  assert.match(renderer, /if \(event\.deltaY < 0\) chatAutoFollow = false/);
  assert.match(renderer, /chatAutoFollow = messagesAreNearBottom\(\)/);
  assert.match(renderer, /if \(!chatAutoFollow\) return/);
  assert.match(renderer, /scrollMessages\(\{ force: true \}\)/);
});

test("every agent failure path restores the composer", () => {
  assert.match(renderer, /let assistant = null;[\s\S]*?try \{[\s\S]*?await refreshDirMap\(\)/);
  assert.match(renderer, /catch \(error\) \{[\s\S]*?addErrorMessage\(error\?\.message/);
  assert.match(renderer, /finally \{[\s\S]*?activeChatRuns\.delete\(runSession\.id\)[\s\S]*?chatInput\.disabled = false;[\s\S]*?chatInput\.readOnly = false;[\s\S]*?chatInput\.focus\(\)/);
});

test("agent errors toast above the composer instead of staying in chat", () => {
  assert.match(renderer, /function addErrorMessage/);
  assert.match(renderer, /function hideChatErrorToast/);
  assert.match(renderer, /CHAT_ERROR_TOAST_MS = 15_000/);
  assert.match(renderer, /toast\.id = "chat-error-toast"/);
  assert.match(renderer, /class="chat-error-toast-close"/);
  assert.doesNotMatch(renderer, /turn\.className = "chat-turn error"/);
  assert.match(renderer, /querySelectorAll\("\.chat-turn\.error"\)\.forEach\(\(node\) => node\.remove\(\)\)/);
  assert.match(chatStyles, /\.chat-error-toast-text \{[\s\S]*?color: #dcdcdc/);
  assert.match(chatStyles, /\.chat-error-toast-close/);
  assert.match(chatStyles, /#messages \.chat-turn\.error \{ display: none; \}/);
});

test("thinking folds persist stored duration and never recompute wall-clock age on hydrate", () => {
  assert.match(renderer, /fold\.dataset\.durationMs = String\(durationMs\)/);
  assert.match(renderer, /function hydrateThinkingFolds/);
  assert.match(renderer, /thinkingElapsedMs\(\{ startedAt, endedAt, durationMs \}\)/);
  assert.doesNotMatch(renderer, /function hydrateThinkingFolds\([\s\S]*?finishThinkingFold\(fold, \{ collapse: true \}\)/);
  assert.match(renderer, /data-duration-ms/);
  assert.match(renderer, /data-worked-for-ms/);
  assert.match(renderer, /hasStructuredTranscript\(session\.transcript\)/);
  assert.match(renderer, /renderStructuredChatTranscript\(session\.transcript, messages\)/);
  assert.match(renderer, /agent-work-fold-body/);
  assert.match(renderer, /dataset\.workVerdict = "true"/);
});
