"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "style.css"), "utf8");

test("thinking disclosure is created only after an actual reasoning delta", () => {
  assert.match(renderer, /thinking:\s*null,\s*\n\s*thinkingConfigured:\s*false/);
  assert.match(renderer, /return settings\?\.thinking !== false/);
  assert.doesNotMatch(renderer, /createAssistantTurn\(modelThinkingEnabled\(settings\)\)/);
  assert.match(renderer, /function createAssistantTurn\(\)/);
  assert.match(renderer, /if \(!pendingThinkingPrefix\.trim\(\)\) return false/);
  assert.match(renderer, /block\.className = "thinking-block collapsed is-thinking"/);
  assert.match(renderer, /<span class="thinking-title">Thinking\.\.\.<\/span>/);
  assert.match(renderer, /const completedThinking = String\(result\?\.thinking \|\| ""\)/);
  assert.doesNotMatch(renderer, /Waiting for model reasoning tokens/);
  assert.doesNotMatch(renderer, /did not emit a reasoning trace/);
  assert.doesNotMatch(renderer, /setThinkingEmptyState/);
});

test("content and tool events close a phase while a later reasoning delta can start another", () => {
  assert.match(renderer, /activeThinkingPhase = null/);
  assert.match(renderer, /if \(payload\.type === "content"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /if \(payload\.type === "tool_call"\)[\s\S]*?assistant\.finalizeThinking\(\)/);
  assert.match(renderer, /phase\.title\.textContent = completedThinkingLabel\(phase\.startedAt\)/);
  assert.match(renderer, /return "Thought for a moment"/);
  assert.match(renderer, /Thought for \$\{seconds\}/);
});

test("thinking disclosure has one click owner so expand and collapse do not cancel out", () => {
  assert.doesNotMatch(renderer, /header\.addEventListener\("click", \(\) => \{\s*thinkingBlock\.classList\.toggle/);
  assert.match(renderer, /messages\.addEventListener\("click"[\s\S]*?closest\("\.thinking-header"\)/);
  assert.match(renderer, /block\.dataset\.userInteracted = "true"/);
  assert.match(renderer, /thinkingHeader\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
});

test("collapsed active thinking shows a bounded live tail and completed thinking collapses", () => {
  assert.match(styles, /\.thinking-block\.is-thinking\.collapsed \.thinking-body\s*\{[\s\S]*?max-height: 12rem/);
  assert.match(styles, /\.thinking-block\.collapsed:not\(\.is-thinking\) \.thinking-body\s*\{\s*display: none/);
  assert.match(renderer, /activeThinkingPhase\.body\.scrollTop = activeThinkingPhase\.body\.scrollHeight/);
  assert.match(renderer, /phase\.block\.dataset\.userInteracted !== "true"/);
});

test("streaming text fades in by delta without restoring the old activity line", () => {
  assert.match(renderer, /function animateStreamDelta\(container, delta\)/);
  assert.match(renderer, /reveal\.className = "stream-text-reveal"/);
  assert.match(renderer, /this\.syncDisplay\(\{ animateToken: token \}\)/);
  assert.match(renderer, /animateStreamDelta\(activeThinkingPhase\.body, delta\)/);
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
