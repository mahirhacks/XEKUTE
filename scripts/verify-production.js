"use strict";

/*
 * Production architecture checks.  This script intentionally checks the
 * source tree from the outside: it must fail when a deleted compatibility
 * path is recreated, even if the application still happens to start.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "src");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function sourceFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else result.push(absolute);
    }
  };
  visit(directory);
  return result;
}

function assertNoSourceReference(pattern, message) {
  const matches = [];
  for (const file of sourceFiles("src")) {
    const text = fs.readFileSync(file, "utf8");
    if (pattern.test(text)) matches.push(path.relative(root, file));
  }
  assert.deepEqual(matches, [], `${message}: ${matches.join(", ")}`);
}

const main = read("src/app/electron/main.js");
const lifecycle = read("src/app/electron/lifecycle.js");
const html = read("src/ui/index.html");
const preload = read("src/app/electron/preload.js");
const forgeConfig = read("forge.config.js");
const packageJson = JSON.parse(read("package.json"));
const ToolRegistry = require(path.join(root, "src/agent/tools/config/tool-registry.js"));
const ToolPort = require(path.join(root, "src/contracts/tool/tool-port.js"));
const ModeRegistry = require(path.join(root, "src/agent/modes/mode-registry.js"));
const ScopePolicy = require(path.join(root, "src/agent/authority/scope/scope-policy.js"));
const { createSkillKnowledgeGraph } = require(path.join(root, "src/app/services/assessment/knowledge/skill-knowledge-graph.js"));
const { createSpecialSkillRegistry } = require(path.join(root, "src/agent/special-skills/registry.js"));

assert.match(main, /sandbox:\s*true/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /webviewTag:\s*false/);
assert.match(lifecycle, /setPermissionRequestHandler/);
assert.match(main, /setWindowOpenHandler/);
assert.match(html, /Content-Security-Policy/);
assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i);
assert.match(preload, /contextBridge\.exposeInMainWorld\("api"/);
assert.doesNotMatch(preload, /exposeInMainWorld\("xekute"|legacy compatibility facade|legacyApi|xekuteApi/i);
assert.doesNotMatch(preload, /exposeInMainWorld\("pointer"/);
assert.deepEqual(
  [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]),
  ["electron"],
  "sandboxed preload must not require local CommonJS modules",
);
assert.equal(packageJson.devDependencies.electron, "43.4.0");
assert.equal(packageJson.dependencies["@vscode/codicons"], "0.0.45");
assert.equal(packageJson.productName, "XEKUTE");
assert.match(packageJson.scripts.make, /prepare:update-config/);
assert.ok(exists("scripts/prepare-update-config.js"));
assert.match(forgeConfig, /temp_test/);
assert.match(forgeConfig, /graphify-out/);
assert.match(forgeConfig, /node_modules\/node-pty/);
assert.doesNotMatch(forgeConfig, /maker-squirrel|electron-winstaller|Squirrel\.Windows/);
const builderConfig = read("electron-builder.config.js");
assert.match(builderConfig, /oneClick:\s*false/);
assert.match(builderConfig, /allowToChangeInstallationDirectory:\s*true/);
assert.match(builderConfig, /artifactName:\s*["']XEKUTESetup\.exe["']/);
assert.match(builderConfig, /include:\s*["']build\/installer\.nsh["']/);
assert.match(read("src/app/electron/lifecycle.js"), /function setAllowImmediateQuit/);
assert.match(read("src/app/electron/main.js"), /onInstallReady:\s*\(\)\s*=>\s*setAllowImmediateQuit\(true\)/);
assert.match(read("src/app/services/updates/update-service.js"), /quitAndInstall\(true,\s*true\)/);
assert.match(main, /!app\.isPackaged\s*\?\s*createDisabledUpdateBackend\(\)/);
assert.match(main, /updatedLaunch:\s*process\.argv\.includes\(["']--updated["']\)/);
assert.match(read("src/app/services/updates/update-service.js"), /pendingInstalledVersion/);
assert.match(read("src/app/services/updates/update-service.js"), /deferredVersion/);
assert.match(read("src/ui/bootstrap.js"), /type === "updated"/);
assert.doesNotMatch(forgeConfig, /src\/automation/);

const canonicalNames = ToolPort.REGISTRY_TOOL_NAMES;
assert.equal(new Set(canonicalNames).size, 23, "the canonical registry must contain exactly 23 unique tools");
assert.deepEqual(
  canonicalNames,
  [
    "ask_questions",
    "update_task_list",
    "exec_command",
    "read_file",
    "search_workspace",
    "apply_patch",
    "inspect_environment",
    "manage_plan",
    "manage_state",
    "ingest_traffic",
    "manage_identity",
    "replay_request",
    "run_test_case",
    "browser_action",
    "compare_responses",
    "verify_finding",
    "store_finding",
    "attack_graph",
    "delegate_agent",
    "query_assessment",
    "expand_evidence",
    "query_knowledge",
    "web_research",
  ],
  "the tool contract must preserve the canonical 23-tool inventory and order",
);
assert.deepEqual(ModeRegistry.MODE_TOOL_GROUPS, ToolPort.MODE_TOOL_GROUPS);
assert.deepEqual(
  Object.keys(require(path.join(root, "src/agent/tools/config/tool-metadata.js")).TOOL_METADATA).sort(),
  [...canonicalNames].sort(),
  "every canonical tool must have centralized metadata",
);
assert.deepEqual(ScopePolicy.evaluateToolScope({ workspace: root, toolName: "read_file", args: { path: "package.json" } }).ok, true);
assert.equal(
  ScopePolicy.evaluateToolScope({ workspace: root, toolName: "read_file", args: { path: "..\\outside" } }).code,
  "WORKSPACE_OUT_OF_SCOPE",
);

for (const required of [
  "src/agent/controller/agent-controller.js",
  "src/agent/runtime/agent-runtime.js",
  "src/agent/tools/config/tool-metadata.js",
  "src/agent/tools/config/tool-registry.js",
  "src/agent/tools/config/tool-surface.js",
  "src/agent/tools/process/ask-questions.js",
  "src/agent/authority/scope/scope-policy.js",
  "src/agent/authority/authority-registry.js",
  "src/agent/authority/invocation-pipeline.js",
  "src/agent/authority/composition.js",
  "src/agent/authority/gates/pipeline-manifest.js",
  "src/agent/authority/profiles/profile-manifest.js",
  "src/app/services/assessment/intelligence/intelligence-store.js",
  "src/app/services/assessment/intelligence/intelligence-indexer.js",
  "src/app/services/assessment/intelligence/assessment-intelligence-service.js",
  "src/app/services/approval/command-approval.js",
  "src/app/services/assessment/mode-workflow.js",
  "src/app/services/assessment/knowledge/assessment-knowledge-engine.js",
  "src/app/services/assessment/knowledge/skill-knowledge-graph.js",
  "src/app/services/assessment/knowledge/mcp-runtime.js",
  "src/agent/special-skills/registry.js",
  "src/agent/special-skills/loader.js",
  "src/agent/special-skills/runner.js",
  "src/agent/special-skills/schema.js",
  "src/agent/special-skills/pentest/pipeline.js",
  "src/agent/special-skills/pentest/state-store.js",
  "src/domain/assessment/web-artifact-store.js",
  "src/app/storage/project-memory-store.js",
  "src/agent/memory/context/context-compiler.js",
  "src/app/storage/session-memory-store.js",
  "src/app/electron/lifecycle.js",
  "src/app/ipc/register.js",
  "src/app/ipc/project.js",
  "src/prompts/instructions/system-prompt.js",
  "src/ui/bootstrap.js",
  "src/ui/core/runtime-modules.js",
  "src/ui/features/history/history-model.js",
]) assert.ok(exists(required), `${required} must exist in the canonical tree`);

for (const removed of [
  "src/preload.js",
  "src/application",
  "src/adapters",
  "src/presentation",
  "src/content",
  "src/automation",
  "src/app/services/chat-session-store.js",
  "src/agent/policy",
  "src/agent/clarification",
  "src/shared/ipc-contracts.js",
  "src/contracts/content/PromptSourcePort.js",
  "src/contracts/tool/tool-surface-config.js",
  "src/agent/memory/action-log.js",
  "src/agent/memory/records.js",
]) assert.equal(exists(removed), false, `${removed} must remain removed`);

const systemPromptSources = sourceFiles("src/prompts").filter((file) => /system[-_]prompt|system-prompt/i.test(path.basename(file)));
assert.deepEqual(
  systemPromptSources.map((file) => path.relative(root, file).replaceAll(path.sep, "/")),
  ["src/prompts/instructions/system-prompt.js"],
);
assert.doesNotMatch(read("src/prompts/instructions/system-prompt.js"), /AUTO-GENERATED|content\/build|prompt_builder/i);
assert.doesNotMatch(read("src/agent/runtime/prompt-compiler.js"), /prompt-source|content-loader|prompt_builder/i);

assert.match(html, /<script type="module" src="bootstrap\.js"><\/script>/);
assert.doesNotMatch(html, /presentation\/ui|application\/prompt|prompts\/instructs|src\/preload\.js/);
const rendererSyntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
  input: read("src/ui/bootstrap.js"),
  encoding: "utf8",
});
assert.equal(rendererSyntax.status, 0, `renderer ES module must parse: ${rendererSyntax.stderr || rendererSyntax.stdout}`);
for (const match of html.matchAll(/<script(?:\s+type="module")?\s+src="([^"]+)"\s*><\/script>/g)) {
  const scriptPath = path.join(root, "src/ui", match[1]);
  if (/node_modules/.test(match[1])) continue;
  assert.ok(fs.existsSync(scriptPath), `renderer script must exist: ${match[1]}`);
}

assert.doesNotMatch(main, /evaluateAction|classifyAction|requestAgentActionApproval|agentResolveApproval|GATES_DISABLED/);
assert.doesNotMatch(read("src/agent/controller/agent-controller.js"), /evaluateAction|requestApproval|approval_required|GATES_DISABLED/);
assert.doesNotMatch(read("src/prompts/instructions/initial-context.js"), /authority\s+gate|approval\s+token|bypass/i);
assert.doesNotMatch(read("src/ui/bootstrap.js"), /Unrestricted|unrestricted/);
assert.match(read("src/app/ipc/project.js"), /function registerProjectIpc\(/);

for (const [pattern, message] of [
  [/XEKUTE_AGENT_GATES_DISABLED|XEKUTE_AGENT_TOOLS_DISABLED/i, "environment gate/tool-disable switches are removed"],
  [/requestAgentActionApproval|agentResolveApproval|approval-token|evaluateAction|classifyAction/i, "legacy approval-token and monolithic policy paths are removed"],
  [/policy-engine|role-registry|chat-session-store/i, "legacy runtime modules are removed"],
  [/run_security_tool|load_tool_schemas|ingest_assessment_records/i, "stale controller tool branches are removed"],
]) assertNoSourceReference(pattern, message);

const authorityComposition = require(path.join(root, "src/agent/authority/composition.js")).createAuthorityComposition({
  evaluateScope: async () => ({ ok: true, code: "IN_SCOPE" }),
});
const authorityManifest = require(path.join(root, "src/agent/authority/gates/pipeline-manifest.js"));
assert.equal(authorityComposition.registry.modules().length, 20, "authority registry must contain exactly 20 modules including the resolver");
assert.deepEqual(
  authorityComposition.registry.modules().map((entry) => entry.name).sort(),
  ["authority_profile_resolver", ...authorityManifest.moduleOrder].sort(),
  "authority module inventory must match the fixed pipeline manifest",
);
assert.deepEqual(
  authorityComposition.registry.profiles().map((profile) => profile.id).sort(),
  ["approve_for_me", "ask_for_approval", "full_authority"],
  "exactly three production authority profiles must be active",
);
assert.equal(authorityComposition.registry.profile("full_authority").modulePipeline.includes("approval_gate"), false);
for (const profile of authorityComposition.registry.profiles()) {
  assert.equal(profile.modulePipeline[0], "role_access_gate");
  assert.equal(profile.modulePipeline.includes("authority_profile_resolver"), false);
}

const ipcContractSource = read("src/contracts/ipc/IpcContracts.js");
assert.doesNotMatch(ipcContractSource, /chat-sessions|agent:resolveApproval|approval/);
assert.doesNotMatch(preload, /loadChatSessions|saveChatSessions|agentResolveApproval|resolveApproval/);

for (const directory of ["src/agent/controller", "src/agent/runtime", "src/agent/tools", "src/app", "src/interceptor", "src/domain", "src/contracts", "src/infrastructure"]) {
  for (const file of sourceFiles(directory)) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(content, /require\(["']\.\.\/\.\.\/application\//, `${path.relative(root, file)} imports the removed application layer`);
  }
}

assert.ok(exists("architecture/source-layout.md"));
assert.ok(exists("architecture/runtime-flow.md"));
assert.ok(exists("architecture/authority-roadmap.md"));
assert.ok(exists("architecture/memory-storage.md"));
assert.ok(fs.existsSync(path.join(root, "temp_test")), "temp_test harness must remain present");

const skillGraph = createSkillKnowledgeGraph({ libraryRoot: path.join(sourceRoot, "prompts", "skills") });
const skillValidation = skillGraph.validation();
assert.equal(skillValidation.ok, true, `skill knowledge graph must validate: ${skillValidation.error || "unknown error"}`);
const requiredKnowledgeSkills = [
  "idor", "bola", "xss", "csrf", "ssrf", "sqli", "auth_logic", "business_logic", "payment_logic", "user_account_logic",
  "graphql", "file_upload", "path_traversal", "sensitive_data_exposure",
];
for (const requiredSkill of requiredKnowledgeSkills) assert.ok(skillGraph.list().some((skill) => skill.id === requiredSkill), `knowledge skill ${requiredSkill} must be discoverable`);
assert.ok(!exists("src/prompts/skills/cyber-library.js"), "the JavaScript cyber-library mirror must remain removed");
assert.ok(!exists("src/prompts/skills/vapt-skill-library.js"), "the legacy JavaScript VAPT library adapter must remain removed");
assert.equal(sourceFiles("src/prompts/skills/libraries").some((file) => file.endsWith(".js")), false, "vulnerability library must contain Markdown only");

const specialSkillRegistry = createSpecialSkillRegistry({ root: path.join(sourceRoot, "agent", "special-skills") });
assert.deepEqual(
  specialSkillRegistry.list().map((skill) => skill.command),
  ["/create-rule", "/create-skill", "/create-subagent", "/pentest", "/report"],
  "the shipped special-skill registry must contain exactly the five built-ins",
);
assert.deepEqual(specialSkillRegistry.diagnostics(), [], "shipped special-skill packages must validate without diagnostics");
const pentestSkill = specialSkillRegistry.list().find((skill) => skill.id === "pentest");
assert.ok(pentestSkill.requiredTools.includes("manage_pentest"), "the pentest package must declare its scoped orchestration capability");
assert.ok(exists("src/agent/special-skills/pentest/orchestrator.js"), "the pentest production orchestrator must exist");
const electronMain = read("src/app/electron/main.js");
assert.match(electronMain, /pentestOrchestrator\.initialize\(/, "\/pentest must initialize the production orchestrator");
assert.match(electronMain, /pentestOrchestrator\.observeToolResult\(/, "material pentest tool results must resynchronize the orchestrator");
assert.match(electronMain, /executeManagePentest\(/, "the manage_pentest capability must execute through the main-process authority pipeline");

console.log("XEKUTE production architecture invariants verified.");
