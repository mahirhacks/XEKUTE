const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("workspace tasks emit a runtime-grounded plan before model work", () => {
  const controller = read("src/agent/controller.js");
  assert.match(controller, /function buildTaskBrief\(/);
  assert.match(controller, /sendEvent\(\{ type: "task_brief", runId, brief: taskBrief \}\)/);
  assert.match(controller, /id: "inspect"/);
  assert.match(controller, /id: "verify"/);
});

test("chat renders the plan, live run state, and transparent run details", () => {
  const renderer = read("src/ui/bootstrap.js");
  const styles = read("src/ui/styles/base.css");
  const html = read("src/ui/index.html");
  assert.match(renderer, /payload\.type === "task_brief"/);
  assert.match(renderer, /completeTaskBrief\(/);
  assert.match(renderer, /Show run details/);
  assert.match(styles, /\.agent-task-brief/);
  assert.match(styles, /\.chat-empty-state/);
  assert.doesNotMatch(renderer, /LOCAL AI WORKSPACE|Actions, tool calls, approvals, and verification stay visible/);
  assert.doesNotMatch(html, /chat-header-context|chat-header-status|AI workspace/);

  const chatStart = html.indexOf('<aside id="chat-pane">');
  const chatEnd = html.indexOf('</aside>', chatStart);
  assert.ok(chatStart >= 0 && chatEnd > chatStart, "chat pane markup should remain discoverable");
  const chatMarkup = html.slice(chatStart, chatEnd);
  assert.match(chatMarkup, /id="context-usage-btn"/);
  assert.doesNotMatch(chatMarkup, /12\s*Files|paperclip|microphone|attachment/i);
  assert.match(html, /href="styles\/chat\.css"/);
});
