"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("authority selector offers the three bounded profiles and no unrestricted option", () => {
  const html = read("src/ui/index.html");
  const renderer = read("src/ui/bootstrap.js");
  assert.doesNotMatch(html, /Unrestricted|data-authority-mode=["']unrestricted["']/i);
  assert.match(renderer, /saveAuthoritySettings/);
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
