"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src/presentation/electron/main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/presentation/ui/index.html"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/preload.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const toolMap = require(path.join(root, "src/adapters/tools/core/tool-catalog"));
const { classifyAction } = require(path.join(root, "src/application/policies/policy-engine"));

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
assert.ok(!toolMap.toolNamesForProfile("ask").includes("run_security_tool"), "Ask must not receive active security adapters");
assert.ok(toolMap.toolNamesForProfile("agent").includes("run_security_tool"), "Agent must receive the policy-controlled security adapter");
assert.ok(toolMap.toolsForProfile("ask").every((tool) => !toolMap.isMutating(tool.function.name)), "Ask must receive only non-mutating tools");
assert.equal(toolMap.TOOL_GROUPS.cyber.isSecurityCommand("nmap -sV example.com"), true, "security CLIs must be recognized for typed routing");
assert.equal(toolMap.TOOL_GROUPS.cyber.isSecurityCommand("npm run build"), false, "workspace verification must remain an OS command");
assert.equal(classifyAction({ toolName: "run_command", args: { command: "npm run build" } }).active, false, "standard workspace builds must not be misclassified as active testing");
assert.match(html, /adapters\/tools\/os\/tool-registry\.js[\s\S]+adapters\/tools\/cyber\/tool-registry\.js[\s\S]+adapters\/tools\/core\/tool-catalog\.js[\s\S]+features\/toolbox\/toolbox-controller\.js/);
assert.match(html, /prompts\/instructs\/system_prompt\.js[\s\S]+prompts\/instructs\/initial_prompt\.js[\s\S]+application\/prompt\/prompt-compiler\.js/, "human-editable prompt sources must load before the browser compiler");
// Renderer scripts must be browser-safe. A CommonJS re-export shim
// (module.exports = require(...)) throws "module is not defined" in a script
// tag and kills the whole chain (this has regressed twice). Guard it.
for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
  const src = match[1];
  if (/node_modules/.test(src)) continue;
  const scriptPath = path.join(root, "src/presentation/ui", src.replace(/^\//, ""));
  assert.ok(fs.existsSync(scriptPath), `renderer script must exist: ${src}`);
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.ok(
    !/module\.exports\s*=\s*require/.test(source),
    `renderer script must not be a CommonJS shim: ${src}`,
  );
}
for (const relativePath of [
  "src/prompts/instructs/system_prompt.js",
  "src/prompts/instructs/initial_prompt.js",
  "src/prompts/instructs/triage_prompt.js",
  "src/prompts/skills/triage.js",
  "src/prompts/skills/context-router.js",
  "src/prompts/skills/cyber-library.js",
  "src/application/policies/agentic-loop.js",
  "src/application/policies/bugbounty.js",
  "src/application/policies/operating-mode-rules.js",
  "src/application/policies/runtime-policy-rules.js",
  "src/application/policies/evidence-rules.js",
  "src/application/policies/request-intent-rules.js",
  "src/application/policies/command-guardrails.js",
  "src/application/policies/data-guardrails.js",
]) assert.ok(fs.existsSync(path.join(root, relativePath)), `${relativePath} must exist`);
for (const removedFacade of ["security-tool-adapters.js", "web-research.js", "webclone.js", "workspace-search.js", "tools.js"]) {
  assert.equal(fs.existsSync(path.join(root, "src/tools", removedFacade)), false, `obsolete tool facade must stay removed: ${removedFacade}`);
}
// Obsolete source trees must stay removed after the layered restructure.
for (const obsoleteTree of ["src/sub-agent", "src/harness", "src/prompt"]) {
  assert.equal(fs.existsSync(path.join(root, obsoleteTree)), false, `obsolete tree must stay removed: ${obsoleteTree}`);
}
const compilerSource = fs.readFileSync(path.join(root, "src/application/prompt/prompt-compiler.js"), "utf8");
assert.match(compilerSource, /prompt-source/, "prompt compiler must consume the application PromptSourcePort adapter in Node");
assert.match(compilerSource, /getSystemPrompt/, "prompt compiler must resolve the system prompt through the prompt-source seam");
assert.match(compilerSource, /XekuteSystemPrompt/, "prompt compiler must consume the preloaded browser global when not in Node");
assert.doesNotMatch(compilerSource, /You are XEKUTE/, "system prompt prose must not drift back into orchestration code");
assert.ok(fs.existsSync(path.join(root, "src/content/build/manifest.json")), "content build manifest must exist");
assert.ok(fs.existsSync(path.join(root, "src/content/content-loader.js")), "content loader must exist");
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
