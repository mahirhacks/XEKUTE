"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src/app/main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/ui/index.html"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/preload.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const toolMap = require(path.join(root, "src/harness/core/tool-map"));
const { classifyAction } = require(path.join(root, "src/agent/policy/policy-engine"));

assert.match(main, /sandbox:\s*true/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /webviewTag:\s*false/);
assert.match(main, /setPermissionRequestHandler/);
assert.match(main, /setWindowOpenHandler/);
assert.match(html, /Content-Security-Policy/);
assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i);
assert.match(preload, /contextBridge\.exposeInMainWorld\("xekute"/);
assert.doesNotMatch(preload, /exposeInMainWorld\("pointer"/, "unused Pointer-era preload alias must not return");
assert.match(preload, /projectProfileGet/);
assert.match(preload, /projectProfileSave/);
const preloadRequires = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
assert.deepEqual(preloadRequires, ["electron"], "sandboxed preload must not require local CommonJS modules");
assert.equal(packageJson.devDependencies.electron, "43.1.0");
assert.equal(packageJson.dependencies["@vscode/codicons"], "0.0.45");
assert.equal(packageJson.productName, "XEKUTE");
assert.equal(new Set(toolMap.TOOL_NAMES).size, toolMap.TOOL_NAMES.length, "tool names must be unique");
assert.ok(toolMap.TOOL_NAMES.every((name) => ["os", "cyber"].includes(toolMap.TOOL_META[name]?.category)), "every tool must belong to an explicit category");
assert.ok(!toolMap.toolNamesForProfile("assist", "agent").includes("run_security_tool"), "Safe Agent must not receive active security adapters");
assert.ok(toolMap.toolNamesForProfile("testing", "agent").includes("run_security_tool"), "Testing Agent must receive the policy-controlled security adapter");
assert.ok(toolMap.toolsForProfile("assist", "ask").every((tool) => !toolMap.isMutating(tool.function.name)), "Ask must receive only non-mutating tools");
assert.equal(toolMap.TOOL_GROUPS.cyber.isSecurityCommand("nmap -sV example.com"), true, "security CLIs must be recognized for typed routing");
assert.equal(toolMap.TOOL_GROUPS.cyber.isSecurityCommand("npm run build"), false, "workspace verification must remain an OS command");
assert.equal(classifyAction({ toolName: "run_command", args: { command: "npm run build" } }).active, false, "standard workspace builds must not be misclassified as active testing");
assert.match(html, /harness\/os\/tool-registry\.js[\s\S]+harness\/cyber\/tool-registry\.js[\s\S]+harness\/core\/tool-map\.js[\s\S]+features\/toolbox\/toolbox-controller\.js/);
assert.match(html, /prompts\/instructs\/system_prompt\.js[\s\S]+prompts\/instructs\/initial_prompt\.js[\s\S]+agent\/instructions\/prompt-compiler\.js/, "human-editable prompt sources must load before the browser compiler");
for (const relativePath of [
  "src/prompts/instructs/system_prompt.js",
  "src/prompts/instructs/initial_prompt.js",
  "src/prompts/instructs/triage_prompt.js",
  "src/prompts/skills/agentic-loop.js",
  "src/prompts/skills/bugbounty.js",
  "src/prompts/skills/triage.js",
  "src/prompts/skills/context-router.js",
  "src/prompts/skills/cyber-library.js",
  "src/prompts/rules/operating-mode-rules.js",
  "src/prompts/rules/runtime-policy-rules.js",
  "src/prompts/rules/evidence-rules.js",
  "src/prompts/rules/request-intent-rules.js",
  "src/prompts/guardrail/command-guardrails.js",
  "src/prompts/guardrail/data-guardrails.js",
]) assert.ok(fs.existsSync(path.join(root, relativePath)), `${relativePath} must exist`);
for (const removedFacade of ["security-tool-adapters.js", "web-research.js", "webclone.js", "workspace-search.js", "tools.js"]) {
  assert.equal(fs.existsSync(path.join(root, "src/tools", removedFacade)), false, `obsolete tool facade must stay removed: ${removedFacade}`);
}
const compilerSource = fs.readFileSync(path.join(root, "src/agent/instructions/prompt-compiler.js"), "utf8");
assert.match(compilerSource, /require\("\.\.\/\.\.\/prompts\/instructs\/system_prompt"\)/, "prompt compiler must consume the canonical instruction source");
assert.doesNotMatch(compilerSource, /You are XEKUTE/, "system prompt prose must not drift back into orchestration code");
assert.match(html, /data-action="create-project"[^>]*>Create New Project/);
assert.match(html, /data-action="open-project"[^>]*>Open Existing Project/);
assert.doesNotMatch(html, /data-action="create-assessment"/);
assert.doesNotMatch(html, /data-action="open-assessment"/);
assert.match(html, /data-app-settings-section="project"/);
assert.match(html, /Rules, Skills, Subagents/);
assert.match(html, /guidance-settings-list/);
assert.doesNotMatch(html, /prompt-settings-editor|prompt-model-settings|Effective compiled prompt/);
assert.match(html, /data-project-field="scope\.inScopeTargets"/);
assert.match(html, /data-project-field="rulesOfEngagement\.stopConditions"/);
assert.match(html, /data-project-field="context\.applicationOverview"/);
assert.match(main, /project-profile:get/);
assert.match(main, /project-profile:save/);
assert.match(main, /guidance:save/);
assert.match(preload, /guidanceContext/);
const projectCreateBlock = main.slice(main.indexOf('ipcMain.handle("project:create"'), main.indexOf('/** Open a file picker'));
assert.match(projectCreateBlock, /fs\.mkdirSync\(projectPath, \{ recursive: true \}\)/);
assert.doesNotMatch(projectCreateBlock, /assessmentWorkspace|writeFileSync|repair\(/, "project creation must only create the selected directory");

console.log("XEKUTE production security invariants verified.");
