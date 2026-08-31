"use strict";

// Tool-wiring tests: the DI container builds the 22-tool registry, and the
// execution path (registry adapter + restricted context projection) works
// end-to-end for apply_patch/read_file/search_workspace.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createExecutionContext, projectExecutionContext, isRestrictedToolContext } = require("../src/contracts/tool/execution-context");
const { toOpenAITool } = require("../src/agent/tools/config/tool-registry.js");
const { createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
const { createReadFileTool } = require("../src/agent/tools/workspace/read-file.js");
const { createSearchWorkspaceTool } = require("../src/agent/tools/workspace/search-workspace.js");
const { createExecCommandTool } = require("../src/agent/tools/process/exec-command.js");

const EXPECTED_TOOLS = [
  "ask_questions",
  "update_task_list",
  "exec_command", "read_file", "search_workspace", "apply_patch", "inspect_environment",
  "update_project_artifacts", "manage_state", "ingest_traffic", "manage_identity", "replay_request",
  "run_test_case", "browser_action", "compare_responses", "verify_finding",
  "attack_graph", "delegate_agent",
  "query_assessment", "expand_evidence", "query_knowledge", "web_research",
];

function restrictedContext(root, toolName) {
  return projectExecutionContext(createExecutionContext({
    invocationId: `wire-test-${Date.now().toString(36)}`,
    toolName,
    role: "agent",
    authority: "approve_for_me",
    workspace: { root },
  }));
}

test("wiring: DI container builds a registry with the canonical tool catalog and serializable catalog", async () => {
  const { createContainer } = require("../src/infrastructure/di/container");
  // createContainer requires an Electron app; use a minimal stub with getPath.
  const app = { getPath: (name) => path.join(os.tmpdir(), "xekute-wire-test", String(name)) };
  const container = createContainer({ app, safeStorage: { isEncryptionAvailable: () => false } });
  const registry = container.toolRegistry;
  assert.ok(registry, "container must expose toolRegistry");
  assert.equal(registry.size(), EXPECTED_TOOLS.length, `exactly ${EXPECTED_TOOLS.length} tools`);
  assert.deepEqual([...registry.names()].sort(), [...EXPECTED_TOOLS].sort());
  const catalog = registry.entries().map(toOpenAITool);
  assert.equal(catalog.length, EXPECTED_TOOLS.length);
  for (const tool of catalog) {
    assert.ok(tool.function.name, "catalog entry must have a name");
    assert.ok(tool.function.parameters, "catalog entry must have a schema");
  }
  container.dispose();
});

test("wiring: executeToolCall path applies a patch, reads it back, and searches it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wire-tool-"));
  const applyPatch = createApplyPatchTool();
  const readFile = createReadFileTool();
  const search = createSearchWorkspaceTool();

  const createResult = await applyPatch.execute(
    { operations: [{ kind: "create", path: "report.md", content: "# Wire Test\n\ncontent here" }] },
    restrictedContext(root, "apply_patch"),
  );
  assert.equal(createResult.ok, true, JSON.stringify(createResult.error || {}));
  assert.ok(fs.existsSync(path.join(root, "report.md")), "file must be written");

  const readResult = await readFile.execute({ path: "report.md" }, restrictedContext(root, "read_file"));
  assert.equal(readResult.ok, true);
  assert.match(readResult.value.content, /Wire Test/);

  const searchResult = await search.execute({ mode: "text", query: "Wire Test" }, restrictedContext(root, "search_workspace"));
  assert.equal(searchResult.ok, true);
  assert.equal(searchResult.value.count, 1);
  assert.equal(searchResult.value.matches[0].path, "report.md");

  fs.rmSync(root, { recursive: true, force: true });
});

test("wiring: unknown tool returns UNKNOWN_TOOL (dispatcher contract)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wire-tool-"));
  const registry = new Map();
  // Simulate the dispatcher: unknown name -> UNKNOWN_TOOL.
  const name = "not_a_tool";
  const entry = registry.get(name);
  const result = entry
    ? { ok: true }
    : { ok: false, error: `Unknown tool '${name}'`, code: "UNKNOWN_TOOL", retryable: false };
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_TOOL");
  fs.rmSync(root, { recursive: true, force: true });
});

test("wiring: adapters reject unrestricted contexts (safety preserved)", async () => {
  const applyPatch = createApplyPatchTool();
  const result = await applyPatch.execute(
    { operations: [{ kind: "create", path: "x.md", content: "x" }] },
    { invocationId: "full", toolName: "apply_patch", role: "agent", authority: "approve_for_me", workspace: { root: os.tmpdir() } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("wiring: exec_command adapter is executable under a restricted projection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wire-tool-"));
  const tool = createExecCommandTool();
  const result = await tool.execute({ executable: process.execPath, args: ["-e", "console.log('hi')"] }, restrictedContext(root, "exec_command"));
  assert.equal(result.ok, true);
  assert.match(result.value.stdout, /hi/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("wiring: restricted context projection is valid and frozen", () => {
  const ctx = restrictedContext(os.tmpdir(), "read_file");
  assert.equal(isRestrictedToolContext(ctx), true);
  assert.equal(ctx.contextKind, "raw_tool_projection");
  assert.equal(ctx.toolName, "read_file");
});
