"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
const chatStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

test("thinking uses one private status line and never exposes model reasoning", () => {
  assert.match(renderer, /thinking:\s*null,\s*\n\s*thinkingConfigured:\s*false/);
  assert.match(renderer, /return settings\?\.thinking !== false/);
  assert.doesNotMatch(renderer, /createAssistantTurn\(modelThinkingEnabled\(settings\)\)/);
  assert.match(renderer, /function createAssistantTurn\(\{ container = messages, sessionId = activeChatSessionId \} = \{\}\)/);
  assert.match(renderer, /showPrivateReasoning\(\)/);
  assert.doesNotMatch(renderer, /assistant\.setStatus\("Thinking…"\)/);
  assert.match(renderer, /block\.className = "agent-status-line"/);
  assert.match(renderer, /assistant\.setLiveState\(\{ kind: "thinking", detail: "Thinking" \}\)/);
  assert.doesNotMatch(renderer, /appendThinking|rawThinking|const completedThinking/);
  assert.doesNotMatch(renderer, /thinking-block collapsed is-thinking/);
  assert.doesNotMatch(renderer, /renderMarkdown\(phase\.body|activeThinkingPhase/);
});

test("content and tool events replace thinking and completion settles to elapsed time", () => {
  assert.match(renderer, /if \(payload\.type === "content" \|\| payload\.type === "token"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /if \(payload\.type === "tool_call"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /this\.setLiveState\(\{ kind: "working", detail: "Writing response" \}\)/);
  assert.match(renderer, /completeReasoningActivity\(\)/);
  assert.match(renderer, /finishLiveState\(outcome = "complete"\)/);
  assert.match(renderer, /`Worked for \$\{duration\}`/);
  assert.match(renderer, /`Stopped after \$\{duration\}`/);
  assert.match(renderer, /this\.settlePendingActivities\(outcome\)/);
  assert.match(renderer, /icon\.hidden = !stopped/);
  assert.doesNotMatch(renderer, /stopped \? "codicon-debug-stop" : "codicon-check"/);
  assert.match(chatStyles, /\.agent-status-line\[data-final="true"\]:not\(\[data-state="error"\]\) \.agent-status-icon[\s\S]*?display: none/);
  assert.doesNotMatch(renderer, /message\.textContent = "Reasoning complete"|completedThinkingLabel/);
});

test("turn finalization settles orphaned progress, file, and command activity", () => {
  assert.match(renderer, /settlePendingActivities\(outcome = "complete"\)/);
  assert.match(renderer, /entry\?\.dataset\.state !== "running"/);
  assert.match(renderer, /\.tool-card\.pending, \.tool-card\[data-state='queued'\], \.tool-card\[data-state='running'\]/);
  assert.match(renderer, /\^Editing[\s\S]*?"Edited"/);
  assert.match(renderer, /\.agent-command-event\[data-state='running'\]/);
  assert.match(renderer, /if \(card\.classList\.contains\("subagent-wait"\)\) continue/);
});

test("status renderer owns one node and updates it in place", () => {
  assert.match(renderer, /if \(this\.liveStateEl\) return this\.liveStateEl/);
  assert.match(renderer, /this\.turn\.insertBefore\(block, this\.contentEl\)/);
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
  assert.match(renderer, /isToolQuestionnaire && input\.checked\) queueMicrotask\(\(\) => submitButton\?\.click\(\)\)/);
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
  assert.match(chatStyles, /#messages \.agent-status-line\[data-final="true"\]/);
  assert.match(chatStyles, /@keyframes agent-status-update/);
  assert.match(chatStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?agent-status-line\.status-updated/);
});

test("raw reasoning never crosses into the renderer or stored agent history", () => {
  assert.match(controller, /sendEvent\(\{ type: "thinking" \}\)/);
  assert.doesNotMatch(controller, /sendEvent\(\{ type: "thinking", delta/);
  assert.doesNotMatch(controller, /thinkingTrace|thinking:\s*String\(result\.thinking/);
  assert.match(main, /event\.sender\.send\("ollama:thinking", null\)/);
  assert.doesNotMatch(renderer, /result\?\.thinking|payload\.delta\s*\|\|\s*""\)\)\s*\{\s*assistant\.setStatus\("Thinking/);
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
