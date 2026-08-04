const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("AI authority never gates direct operator workspace actions", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");
  const html = read("src/presentation/ui/index.html");

  assert.doesNotMatch(renderer, /function requireAuthority\b|requireAuthority\(/);
  assert.match(html, />Agents</);
  assert.match(renderer, /These switches never restrict your own direct actions in the UI/);

  for (const functionName of [
    "saveResourceChanges",
    "runSecurityWorkbench",
    "createNewItemInput",
    "deleteSelectedCustomEntries",
    "beginCustomEntry",
    "deleteSelectedExplorerItem",
    "toggleInterceptorCapture",
    "saveActiveTab",
  ]) {
    const start = renderer.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const source = renderer.slice(start, renderer.indexOf("\n}", start) + 2);
    assert.doesNotMatch(source, /authorityAllows|authoritySettingsData|requireAuthority/, `${functionName} must be operator-controlled`);
  }
});

test("AI and automated actions retain authority enforcement", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");
  const policy = read("src/application/policies/policy-engine.js");

  assert.match(renderer, /const activeAuthority = await loadAuthoritySettings\(\)/);
  assert.match(renderer, /authority: activeAuthority/);
  assert.match(renderer, /authorityAllows\(requiredPermission\)/);
  assert.match(policy, /authorityPermission: name === "delete_file" \? "workspaceDelete" : "workspaceWrite"/);
  assert.match(policy, /AUTHORITY_PERMISSION_DISABLED/);
});

test("operator HTTP, proxy, and Map IPC paths bypass only AI authority", () => {
  const main = read("src/presentation/electron/main.js");
  const map = read("src/domain/assessment/assessment-map.js");

  assert.match(main, /function effectiveOperatorRuntimeSettings\(root\)/);
  assert.match(main, /superMode: "full"/);
  assert.match(main, /assessmentMap\.read\(assessmentPath, \{ operatorInitiated: true \}\)/);
  assert.match(main, /assessmentMap\.build\(assessmentPath, \{ operatorInitiated: true \}\)/);
  assert.match(map, /!operatorInitiated && \!\["unrestricted", "full", "ask"\]\.includes\(settings\.authority\?\.superMode\) && settings\.authority\?\.permissions\?\.mapBuild === false/);
  assert.match(map, /function loadQueryableGraph\(rawRoot\)[\s\S]*?const result = read\(rawRoot\)/);
});

test("delete lifecycle serializes refreshes and always restores an idle composer", () => {
  const renderer = read("src/presentation/ui/bootstrap.js");

  assert.match(renderer, /let workspaceUiRefreshQueue = Promise\.resolve\(\)/);
  assert.match(renderer, /function refreshWorkspaceUi[\s\S]*?workspaceUiRefreshQueue\.catch/);
  assert.match(renderer, /async function reconcileDeletedWorkspacePath[\s\S]*?closeTabsUnderWorkspacePath\(absPath, \{ force: true \}\)/);
  assert.match(renderer, /async function deleteSelectedExplorerItem[\s\S]*?finally \{[\s\S]*?restoreChatComposerAfterUiAction\(\)/);
  assert.match(renderer, /async function deleteSelectedCustomEntries[\s\S]*?finally \{[\s\S]*?restoreChatComposerAfterUiAction\(\)/);
  assert.match(renderer, /function restoreChatComposerAfterUiAction[\s\S]*?if \(!chatInput\) return;[\s\S]*?chatInput\.disabled = false;[\s\S]*?chatInput\.readOnly = false/);
  assert.match(renderer, /function releaseWorkspaceMutationFocus[\s\S]*?tree-item, #workspace-context-menu, #custom-context-menu/);
  assert.match(renderer, /function restoreChatComposerAfterUiAction[\s\S]*?isLiveWorkspaceInput\(document\.activeElement\)/);
});
