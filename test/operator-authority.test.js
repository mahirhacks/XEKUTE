"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("authority selector offers the three bounded profiles while Agents settings exposes only the sub-agent model", () => {
  const html = read("src/ui/index.html");
  const renderer = read("src/ui/bootstrap.js");
  const styles = read("src/ui/styles/base.css");
  const chatStyles = read("src/ui/styles/chat.css");
  assert.doesNotMatch(html, /Unrestricted|data-authority-mode=["']unrestricted["']/i);
  for (const profile of ["full", "ask", "approve"]) assert.match(html, new RegExp(`data-authority-mode="${profile}"`));
  assert.match(html, /id="app-settings-authority-panel"[\s\S]*?class="agent-subagent-settings"[\s\S]*?id="models-explore-subagent"/);
  assert.doesNotMatch(html, /authority-settings-content|data-authority-permission/);
  assert.doesNotMatch(html, /authority-open-settings|Open Agents settings/);
  assert.doesNotMatch(renderer, /authority-open-settings/);
  assert.match(styles, /\.authority-menu \{[\s\S]*?border: 1px solid var\(--revamp-divider, var\(--border\)\);[\s\S]*?background: var\(--revamp-surface, var\(--bg-0\)\);/);
  assert.match(styles, /\.chat-mode-menu \{[\s\S]*?border: 1px solid var\(--revamp-divider, var\(--border\)\);[\s\S]*?background: var\(--revamp-surface, var\(--bg-0\)\);/);
  assert.match(chatStyles, /\.chat-mode-menu \{[\s\S]*?border: 1px solid var\(--revamp-divider, var\(--border\)\);[\s\S]*?background: var\(--revamp-surface, var\(--bg-0\)\);/);
  assert.match(styles, /\.model-menu \{[\s\S]*?background: var\(--revamp-surface, var\(--bg-0\)\);[\s\S]*?border: 1px solid var\(--revamp-divider, var\(--border\)\);/);
  assert.doesNotMatch(renderer, /renderAuthoritySettings|data-authority-permission|input\.permissions/);
  assert.match(renderer, /permissions:\s*\{ \.\.\.AUTHORITY_DEFAULTS\.permissions \}/);
  assert.match(renderer, /authorityProfile:\s*authoritySettingsData\.superMode/);
});

test("all agent tool calls use the central authority pipeline while scope remains independently enforced", () => {
  const main = read("src/app/electron/main.js");
  const controller = read("src/agent/controller/agent-controller.js");
  const scope = read("src/agent/authority/scope/scope-policy.js");
  assert.match(main, /invocationPipeline\.invoke/);
  assert.doesNotMatch(controller, /evaluateToolScope/);
  assert.doesNotMatch(main, /evaluateAction|classifyAction|requestAgentActionApproval|agentResolveApproval|GATES_DISABLED/);
  assert.doesNotMatch(controller, /evaluateAction|GATES_DISABLED/);
  assert.match(scope, /evaluateNetworkTarget/);
});

test("direct operator actions remain available through ordinary feature handlers", () => {
  const renderer = read("src/ui/bootstrap.js");
  for (const name of ["saveResourceChanges", "runSecurityWorkbench", "deleteSelectedCustomEntries", "saveActiveTab"]) {
    assert.match(renderer, new RegExp(`function ${name}`), name);
  }
});
