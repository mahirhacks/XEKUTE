"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "main.js"), "utf8");

test("thinking disclosure shows only a private status and never model reasoning", () => {
  assert.match(renderer, /thinking:\s*null,\s*\n\s*thinkingConfigured:\s*false/);
  assert.match(renderer, /return settings\?\.thinking !== false/);
  assert.doesNotMatch(renderer, /createAssistantTurn\(modelThinkingEnabled\(settings\)\)/);
  assert.match(renderer, /function createAssistantTurn\(\)/);
  assert.match(renderer, /showPrivateReasoning\(\)/);
  assert.match(renderer, /block\.className = "thinking-block collapsed is-thinking"/);
  assert.match(renderer, /<span class="thinking-title">Thinking\.\.\.<\/span>/);
  assert.match(renderer, /Raw chain-of-thought and system instructions stay hidden/);
  assert.doesNotMatch(renderer, /appendThinking|rawThinking|const completedThinking/);
  assert.doesNotMatch(renderer, /renderMarkdown\(phase\.body|animateStreamDelta\(activeThinkingPhase\.body/);
});

test("content and tool events close a phase while a later reasoning delta can start another", () => {
  assert.match(renderer, /activeThinkingPhase = null/);
  assert.match(renderer, /if \(payload\.type === "content"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /if \(payload\.type === "tool_call"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /phase\.title\.textContent = completedThinkingLabel\(phase\.startedAt\)/);
  assert.match(renderer, /completeReasoningActivity\(\)/);
  assert.match(renderer, /message\.textContent = "Reasoning complete"/);
  assert.match(renderer, /return "Thought for a moment"/);
  assert.match(renderer, /Thought for \$\{seconds\}/);
});

test("thinking disclosure has one click owner so expand and collapse do not cancel out", () => {
  assert.doesNotMatch(renderer, /header\.addEventListener\("click", \(\) => \{\s*thinkingBlock\.classList\.toggle/);
  assert.match(renderer, /messages\.addEventListener\("click"[\s\S]*?closest\("\.thinking-header"\)/);
  assert.match(renderer, /block\.dataset\.userInteracted = "true"/);
  assert.match(renderer, /thinkingHeader\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
});

test("collapse state always hides the body, including while thinking is active", () => {
  assert.match(styles, /\.thinking-block\.collapsed \.thinking-body\s*\{\s*display: none/);
  assert.doesNotMatch(styles, /\.thinking-block\.is-thinking\.collapsed \.thinking-body/);
  assert.match(renderer, /phase\.block\.dataset\.userInteracted !== "true"/);
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
  assert.match(renderer, /finally \{[\s\S]*?streaming = false;[\s\S]*?chatInput\.disabled = false;[\s\S]*?chatInput\.readOnly = false;[\s\S]*?chatInput\.focus\(\)/);
});
