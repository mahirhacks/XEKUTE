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
const VERIFY_PRODUCTION_RELATIVE = "scripts/verify-production.js";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function posixRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
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

function walkedSourceFiles() {
  return [...sourceFiles("src"), ...sourceFiles("scripts")].filter(
    (file) => posixRelative(file) !== VERIFY_PRODUCTION_RELATIVE,
  );
}

function assertNoSourceReference(pattern, message) {
  const matches = [];
  for (const file of walkedSourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (pattern.test(text)) matches.push(posixRelative(file));
  }
  assert.deepEqual(matches, [], `${message}: ${matches.join(", ")}`);
}

const main = read("src/app/electron/main.js");
const lifecycle = read("src/app/electron/lifecycle.js");
const html = read("src/ui/index.html");
const preload = read("src/app/electron/preload.js");
const forgeConfig = read("forge.config.js");
const packageJson = JSON.parse(read("package.json"));
const compositionSource = read("src/infrastructure/di/container.js");
const ToolRegistry = require(path.join(root, "src/agent/tools/config/tool-registry.js"));
const ToolPort = require(path.join(root, "src/contracts/tool/tool-port.js"));
const ModeRegistry = require(path.join(root, "src/agent/modes/mode-registry.js"));
const ScopePolicy = require(path.join(root, "src/agent/authority/scope/scope-policy.js"));
const { createSkillKnowledgeGraph } = require(path.join(root, "src/app/services/assessment/knowledge/skill-knowledge-graph.js"));
const { createSpecialSkillRegistry, internalSkillIdForIntent } = require(path.join(root, "src/agent/special-skills/registry.js"));
const v3SchemaSource = read("src/contracts/memory/v3-schemas.js");
const v3ContractsSource = read("src/contracts/memory/v3-contracts.js");
const v3Tier1Source = read("src/app/services/memory/tier1-context-coordinator.js");
const v3SessionSource = read("src/app/storage/memory/v3-session-store.js");
const v3KagSource = read("src/app/services/memory/native-kag-service.js");
const v3KnowledgeStoreSource = read("src/app/services/memory/knowledge-procedure-store.js");
const v3EmbeddingSource = read("src/app/services/memory/local-embedding-service.js");
const v3EmbeddingWorkerSource = read("src/app/services/memory/local-embedding-worker.js");
const embeddingService = require(path.join(root, "src/app/services/memory/local-embedding-service.js"));

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
assert.equal(new Set(canonicalNames).size, 22, "the canonical registry must contain exactly 22 unique tools");
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
    "update_project_artifacts",
    "manage_state",
    "ingest_traffic",
    "manage_identity",
    "replay_request",
    "run_test_case",
    "browser_action",
    "compare_responses",
    "verify_finding",
    "attack_graph",
    "delegate_agent",
    "query_assessment",
    "expand_evidence",
    "query_knowledge",
    "web_research",
  ],
  "the tool contract must preserve the canonical 22-tool inventory and order",
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
  "src/app/services/assessment/knowledge/assessment-knowledge-engine.js",
  "src/app/services/assessment/knowledge/skill-knowledge-graph.js",
  "src/app/services/assessment/knowledge/mcp-runtime.js",
  "src/agent/special-skills/registry.js",
  "src/agent/special-skills/loader.js",
  "src/agent/special-skills/runner.js",
  "src/agent/special-skills/schema.js",
  "src/agent/special-skills/pentest/SKILL.md",
  "src/agent/special-skills/pentest/loop-controller.js",
  "src/domain/assessment/web-artifact-store.js",
  "src/app/electron/lifecycle.js",
  "src/app/ipc/register.js",
  "src/app/ipc/project.js",
  "src/prompts/instructions/system-prompt.js",
  "src/ui/bootstrap.js",
  "src/ui/core/runtime-modules.js",
  "src/ui/features/history/history-model.js",
]) assert.ok(exists(required), `${required} must exist in the canonical tree`);

assert.doesNotMatch(preload, /memoryMigration|memory:migration/i);
for (const forbidden of [
  "legacy-memory-migration.js",
  "migration-store.js",
  "project-memory-v1-adapter.js",
  "migration-contracts.js",
  "memory-ipc-service.js",
]) assert.equal(exists(`src/app/services/memory/${forbidden}`) || exists(`src/app/storage/memory/${forbidden}`) || exists(`src/contracts/memory/${forbidden}`), false, `Agent Memory migration path ${forbidden} must not ship`);
assert.equal(exists("src/app/ipc/memory-v2.js"), false, "retired Agent Memory IPC bridge must not ship");
assert.doesNotMatch(v3SchemaSource, /MigrationPreviewV3|migration_preview|legacy-memory/i);
assert.doesNotMatch(v3ContractsSource, /MigrationPreviewV3|migration_preview|legacy-memory/i);
assert.doesNotMatch(main, /memoryMigration|memory:migration|legacy-memory-migration|migration-store|project-memory-v1-adapter/i);
assert.doesNotMatch(preload, /memoryMigration|memory:migration|migration-preview/i);

for (const requiredLive of [
  "src/app/services/memory/tier1-context-coordinator.js",
  "src/app/storage/memory/tier1-sensitive-store.js",
  "src/app/storage/memory/v3-session-store.js",
  "src/app/storage/memory/project-identity-store.js",
  "src/app/storage/memory/memory-storage-utils.js",
  "src/app/services/artifacts/project-artifact-service.js",
  "src/domain/artifacts/investigation-artifacts.js",
  "src/agent/tools/workspace/update-project-artifacts.js",
  "src/app/services/memory/native-kag-service.js",
  "src/app/services/memory/local-embedding-service.js",
  "src/app/services/memory/local-embedding-worker.js",
  "src/app/services/memory/knowledge-procedure-store.js",
  "src/app/services/knowledge/knowledge-library-service.js",
  "src/domain/memory/knowledge/knowledge-release.js",
  "src/contracts/memory/v3-schemas.js",
  "src/contracts/memory/v3-contracts.js",
  "src/contracts/memory/schema-registry.js",
  "context_memory_revamp/artifact-driven-investigation-state.md",
]) assert.ok(exists(requiredLive), `${requiredLive} must exist in the live memory architecture`);
assert.equal(exists("src/app/services/memory/knowledge-library-service.js"), false, "knowledge library must live under services/knowledge, not services/memory");

for (const schemaName of [
  "CurrentWorkflowV3", "WorkingReferenceV3", "ConversationCheckpointV3",
  "KagSelectionV3", "KnowledgeProcedurePackageV3",
]) assert.match(v3SchemaSource, new RegExp(`\\b${schemaName}\\b`), `${schemaName} must be defined`);

assert.match(v3Tier1Source, /CHECKPOINT_RATIO|METER_ROWS|Active Conversation/);
assert.match(v3SessionSource, /transcript\.enc\.json|writeTranscript/);
assert.match(v3KagSource, /KagSelectionV3|procedure_id/);
assert.match(v3KnowledgeStoreSource, /MEMORY_KNOWLEDGE_RELEASE_ID_INVALID/);
assert.match(v3EmbeddingSource, /createWorkerEmbeddingService|node:worker_threads/);
assert.match(v3EmbeddingWorkerSource, /createInProcessEmbeddingService|parentPort/);
assert.match(compositionSource, /createLocalEmbeddingService\(\{ modelPath: memoryModelPath \}\)/);
const modelAssetRoot = path.join(root, "resources", "memory-v3", "models", "bge-base-en-v1.5");
const modelAssets = embeddingService.verifyModelAssets(modelAssetRoot);
assert.equal(modelAssets.ok, true, `bundled BGE assets must verify: ${modelAssets.error || modelAssets.code || "invalid"}`);
assert.equal(modelAssets.manifest.embedding_dimension, 768);
assert.equal(modelAssets.manifest.max_input_tokens, 512);
const bundledKnowledgeRoot = path.join(root, "resources", "memory-v3", "knowledge");
assert.ok(fs.existsSync(bundledKnowledgeRoot), "bundled V3 knowledge directory must exist");
const bundledKnowledgeFiles = fs.existsSync(bundledKnowledgeRoot)
  ? fs.readdirSync(bundledKnowledgeRoot).filter((entry) => entry.endsWith(".json")).sort()
  : [];
assert.ok(bundledKnowledgeFiles.length > 0, "at least one bundled V3 knowledge release must ship");
assert.match(v3KnowledgeStoreSource, /bundledDir|bundledRoot/);
assert.match(compositionSource, /bundledDir:\s*memoryKnowledgePath/);
assert.doesNotMatch(read("src/agent/tools/config/tool-metadata.js"), /query_memory|generic_memory_writer/i);
assert.doesNotMatch(compositionSource, /createContextCompiler|contextCompiler|createProjectMemoryStore|memoryProjectMemoryRepository|memoryOperationalContextStore|memoryRetrievalService|createBlockMemoryUpdater|createDerivedMemoryProjection|createMemoryGraphView/);
assert.doesNotMatch(compositionSource, /memory-v2|migration-store|legacy-memory|project-memory-v1-adapter/i);
assert.match(compositionSource, /createTier1ContextCoordinator/);
assert.match(compositionSource, /createNativeKagService/);
assert.doesNotMatch(compositionSource, /createMemoryV3Store|createAutomaticTier2UpdateService|createMemoryV3PersistenceWorker/);
assert.doesNotMatch(main, /selectV3SameProviderFallbackModel|runV3SameProviderFallback/);

for (const removed of [
  "src/preload.js",
  "src/application",
  "src/adapters",
  "src/presentation",
  "src/content",
  "src/automation",
  "src/app/services/chat-session-store.js",
  "src/app/storage/session-memory-store.js",
  "src/app/services/memory/legacy-memory-migration.js",
  "src/app/storage/memory/migration-store.js",
  "src/app/storage/memory/project-memory-v1-adapter.js",
  "src/contracts/memory/migration-contracts.js",
  "src/app/services/memory/memory-ipc-service.js",
  "src/app/ipc/memory-v2.js",
  "src/infrastructure/config/memory-feature-flags.js",
  "test/memory-ipc.test.js",
  "src/agent/policy",
  "src/agent/clarification",
  "src/shared/ipc-contracts.js",
  "src/contracts/content/PromptSourcePort.js",
  "src/contracts/tool/tool-surface-config.js",
  "src/agent/memory/action-log.js",
  "src/agent/memory/records.js",
  "src/app/ipc/memory.js",
  "src/contracts/ipc/memory-ipc-contracts.js",
  "src/app/storage/memory/memory-v3-store.js",
  "src/app/storage/memory/transaction-journal.js",
  "src/app/storage/memory/tier2-transaction-coordinator.js",
  "src/app/storage/memory/memory-v3-persistence-worker.js",
  "src/app/services/memory/automatic-tier2-update-service.js",
  "src/app/services/memory/memory-security-audit.js",
  "src/app/services/memory/memory-maintenance-service.js",
  "src/app/services/memory/memory-v3-ipc-service.js",
  "src/app/ipc/memory-v3.js",
  "src/app/services/assessment/mode-workflow.js",
  "src/ui/styles/memory.css",
  "src/contracts/memory/multi-agent-contracts.js",
  "src/contracts/memory/memory-lifecycle.js",
]) assert.equal(exists(removed), false, `${removed} must remain removed`);

const systemPromptSources = sourceFiles("src/prompts").filter((file) => /system[-_]prompt|system-prompt/i.test(path.basename(file)));
assert.deepEqual(
  systemPromptSources.map((file) => posixRelative(file)),
  ["src/prompts/instructions/system-prompt.js"],
);
assert.doesNotMatch(read("src/prompts/instructions/system-prompt.js"), /AUTO-GENERATED|content\/build|prompt_builder/i);
assert.doesNotMatch(read("src/agent/runtime/prompt-compiler.js"), /prompt-source|content-loader|prompt_builder/i);

assert.match(html, /<script type="module" src="bootstrap\.js"><\/script>/);
assert.doesNotMatch(html, /data-app-settings-section="memory"|id="app-settings-memory-panel"|id="memory-health-reset"|Memory Health/);
assert.doesNotMatch(read("src/ui/bootstrap.js"), /loadMemoryHealthPanel/);
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
  [/session-memory-store|project-memory-store|context-memory|failure-memory|context-compiler|context-assembly|memory-feature-flags/i, "pre-V3 memory runtime modules are removed"],
  [/contextSummary|maybeCompactContext|failureMemory|recent_tail|recentTail|recent-message[- ]tail|manual[- ]summar/i, "legacy context compression and tail paths are removed"],
  [/sensitiveWorkingMemory|sensitive-working-memory/i, "the retired generic sensitive-memory adapter is removed"],
  [/memory:[A-Za-z]/, "retired memory:* IPC channels must not remain"],
  [/\bstore_finding\b/, "store_finding must not remain in src/ or scripts/"],
  [/\bmanage_plan\b/, "manage_plan must not remain in src/ or scripts/"],
  [/Memory Health|memory-health-reset|memory-health-restore/, "Memory Health UI markers must not remain"],
  [/memory-update-failure|memoryPendingList|memoryPendingRetry|memoryDiagnostics/, "pending-memory banner callers must not remain"],
  [/\bProjectMemoryV3\b/, "ProjectMemoryV3 must not remain as a schema identifier"],
  [/\bInvestigationMemoryV3\b/, "InvestigationMemoryV3 must not remain as a schema identifier"],
  [/\bEvidenceMemoryV3\b/, "EvidenceMemoryV3 must not remain as a schema identifier"],
  [/\bPendingMemoryJobV3\b/, "PendingMemoryJobV3 must not remain as a schema identifier"],
  [/\bMemoryHealthV3\b/, "MemoryHealthV3 must not remain as a schema identifier"],
  [/\bTier2TransactionV3\b/, "Tier2TransactionV3 must not remain as a schema identifier"],
  [/\bToolMemoryImpactV3\b/, "ToolMemoryImpactV3 must not remain as a schema identifier"],
  [/\bMemoryMaterialityV3\b/, "MemoryMaterialityV3 must not remain as a schema identifier"],
  [/\bMemoryExtractionV3\b/, "MemoryExtractionV3 must not remain as a schema identifier"],
  [/\bMemoryResetPreviewV3\b/, "MemoryResetPreviewV3 must not remain as a schema identifier"],
  [/\bMemoryResetCommitV3\b/, "MemoryResetCommitV3 must not remain as a schema identifier"],
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
    assert.doesNotMatch(content, /require\(["']\.\.\/\.\.\/application\//, `${posixRelative(file)} imports the removed application layer`);
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
  specialSkillRegistry.list(),
  [],
  "internal Markdown package manifests must not appear in the public registry",
);
assert.deepEqual(
  specialSkillRegistry.listInternal().map((skill) => skill.id),
  ["create-rule", "create-skill", "create-subagent", "pentest", "report"],
  "the internal skill registry must contain exactly the five Markdown packages",
);
assert.deepEqual(specialSkillRegistry.diagnostics(), [], "shipped special-skill packages must validate without diagnostics");
const pentestSkill = specialSkillRegistry.listInternal().find((skill) => skill.id === "pentest");
assert.equal(pentestSkill.visibility, "internal", "pentest must remain internal");
assert.equal(pentestSkill.instructionRole, "skill-context", "pentest must use the shared system prompt");
assert.equal(pentestSkill.resources.length, 0, "pentest must not declare supporting package resources");
assert.equal(pentestSkill.requiredTools.includes("manage_pentest"), false, "pentest must not declare a private orchestration capability");
assert.equal(pentestSkill.requiredTools.includes("pentest_checkpoint"), true, "pentest must close each cycle with pentest_checkpoint");
assert.deepEqual(fs.readdirSync(path.join(sourceRoot, "agent", "special-skills", "pentest")).sort(), ["SKILL.md", "loop-controller.js"], "pentest may contain only its Markdown skill and loop coordinator");
const electronMain = read("src/app/electron/main.js");
assert.match(electronMain, /selectInternalSkill\(defaultRegistry/, "ordinary intent must select internal Markdown skills inside the main process");
assert.equal(internalSkillIdForIntent("/pentest example.com"), "pentest", "system skills must support explicit picker invocation");
assert.doesNotMatch(electronMain, /special-skills:list|special-skills:resolve/, "internal skills must not expose renderer IPC");
assert.doesNotMatch(electronMain, /pentestOrchestrator|pentestStateStore|executeManagePentest|MANAGE_PENTEST_TOOL/, "the internal pentest skill must not own a parallel JavaScript runtime");
assert.match(electronMain, /createPentestLoopController/, "pentest must coordinate repeated blocks through the loop controller");
assert.match(electronMain, /createPentestCheckpointToolDefinition/, "pentest must expose its checkpoint only while the internal skill is active");
const rendererBootstrap = read("src/ui/bootstrap.js");
assert.match(rendererBootstrap, /internalSkillId:\s*"pentest"/, "pentest continuation must remain an internal runtime input");
assert.match(rendererBootstrap, /agentRunResult\?\.pentestLoop\?\.continue/, "the renderer must schedule only an explicit Pentest continuation result");

/*
 * Named-path contract (artifact-driven investigation state).
 * Live src/ and scripts/ (excluding this verifier and test/) must not bind
 * canonical writers, PATHS, tool descriptions, or source_refs to leftover
 * `.xekute/project_info.md`, `.xekute/investigation_checklist.md`, or
 * `findings/findings.json`. Mentions that prove those files are unread live
 * only in UNREAD_LEGACY_PATHS. Do not drop these asserts silently.
 */
const Artifacts = require(path.join(root, "src/domain/artifacts/investigation-artifacts.js"));
assert.equal(Artifacts.PATHS.project, undefined, "PATHS.project must not point at project_info.md");
assert.equal(Artifacts.PATHS.projectDirectory, ".xekute/project_info");
assert.equal(Artifacts.PATHS.checklist, ".xekute/checklist.md");
assert.equal(Artifacts.PATHS.findingsIndex, undefined, "a separate canonical findings layer must not exist");
assert.deepEqual([...Artifacts.UNREAD_LEGACY_PATHS], [
  ".xekute/project_info.md",
  ".xekute/investigation_checklist.md",
]);

const leftoverWriterPattern = /\.xekute\/project_info\.md|\.xekute\/investigation_checklist\.md|findings\/findings\.json/;
const leftoverWriterHits = [];
for (const file of walkedSourceFiles()) {
  const text = fs.readFileSync(file, "utf8");
  if (!leftoverWriterPattern.test(text)) continue;
  const relative = posixRelative(file);
  if (relative === "src/domain/artifacts/investigation-artifacts.js") {
    assert.match(text, /UNREAD_LEGACY_PATHS/, "legacy investigation paths may appear only as unread leftovers");
    continue;
  }
  leftoverWriterHits.push(relative);
}
assert.deepEqual(leftoverWriterHits, [], `canonical writers must not bind leftover investigation paths: ${leftoverWriterHits.join(", ")}`);

assertNoSourceReference(/\.xekute\/plans\b/, ".xekute/plans must not remain as a live plan store");
assertNoSourceReference(/\.pointer-assessment\.json|settings\.config|pen_context\.md|\.xekute[\\/]findings|vulnerability-scans|penetration-testing|scope[\\/](?:engagement|in-scope|out-of-scope|configurations)\.json/, "removed assessment paths must not remain live");
const AssessmentWorkspace = require(path.join(root, "src/domain/assessment/assessment-workspace.js"));
assert.deepEqual([...AssessmentWorkspace.REQUIRED_DIRECTORIES], [
  "recon", "enumeration", "traffic", "runs", "report", "context/sources", "evidence", "custom", "custom_scripts", "tools", "Map", "WebClone",
  ".xekute", ".xekute/project_info", ".xekute/evidence", ".xekute/logs", ".xekute/.internal", ".xekute/.internal/transactions",
], "assessment bootstrap directories must match the clean-slate workspace contract");
assert.deepEqual(Object.values(AssessmentWorkspace.ASSESSMENT_ITEM_FILES).sort(), [
  ".xekute/checklist.md", ".xekute/evidence/index.md", ".xekute/hypotheses.md", ".xekute/logs/agent-actions.jsonl", ".xekute/logs/agent-runs.jsonl", ".xekute/logs/tool-output.jsonl", ".xekute/project_info/index.md",
  "enumeration/assets.json", "enumeration/endpoints.json", "enumeration/pages.json", "enumeration/subdomains.json", "recon/active-recon.json", "recon/passive-recon.json", "report/report.md", "runs/runs.json", "traffic/filtered.jsonl", "traffic/raw.jsonl",
].sort(), "assessment bootstrap files must match the clean-slate workspace contract");
assert.equal(ModeRegistry.MODE_TOOL_GROUPS.ask.includes("update_project_artifacts"), false, "Ask must not receive the artifact writer");
assert.notDeepEqual(ModeRegistry.MODE_TOOL_GROUPS.ask, ModeRegistry.MODE_TOOL_GROUPS.agent, "all modes must not have all tools");
assert.doesNotMatch(read("src/ui/bootstrap.js"), /every selected mode receives the canonical catalog/);
assert.doesNotMatch(read("src/agent/tools/workspace/update-project-artifacts.js"), /"project\.remove"/);

const containerSource = read("src/infrastructure/di/container.js");
assert.match(
  containerSource,
  /createAssessmentWorkspace\(\{[\s\S]*projectArtifacts/,
  "T2: container createAssessmentWorkspace( must include projectArtifacts",
);

const mainSource = read("src/app/electron/main.js");
assert.doesNotMatch(mainSource, /revisions\?\.project_info/, "T9: main.js must not hash revisions?.project_info");
assert.match(mainSource, /fingerprintArtifactRevisions\(artifactContext\.revisions\)/);
assert.match(mainSource, /artifactSourceRefs\(/);
assert.doesNotMatch(mainSource, /source_refs:[\s\S]{0,200}\.xekute\/project_info\.md/);
assert.doesNotMatch(mainSource, /source_refs:[\s\S]{0,200}\.xekute\/investigation_checklist\.md/);
assert.match(html, /data-app-settings-section="knowledge"/);
assert.match(html, /Knowledge Library/);
assert.doesNotMatch(html, /Memory Health/);

console.log("XEKUTE production architecture invariants verified.");
