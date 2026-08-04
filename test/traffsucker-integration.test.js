"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildTraffsuckerPlan } = require("../src/adapters/tools/cyber/security-tool-adapters");
const { createSubagentRunner } = require("../src/adapters/tools/cyber/subagent-runner");
const { createToolHandlers } = require("../src/adapters/tools/core/tool-handlers");
const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const { createWorkspaceSearch } = require("../src/adapters/tools/os/workspace-search");
const XekuteCyberTools = require("../src/adapters/tools/cyber/tool-registry");

function makeToolHandlers({ runner, openRouterApiKey = () => "", startProcess = null }) {
  const search = createWorkspaceSearch({ fs, path });
  const handlers = createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: search.resolveWorkspaceTarget,
    editWorkspaceFile: async () => ({ error: "not used" }),
    deleteWorkspaceFile: () => ({ error: "not used" }),
    buildWorkspaceIndex: search.buildWorkspaceIndex,
    searchWorkspaceIndex: search.searchWorkspaceIndex,
    findWorkspaceFiles: search.findWorkspaceFiles,
    runWorkspaceCommand: async () => ({ error: "not used" }),
    startWorkspaceProcess: () => ({ error: "not used" }),
    readToolProcess: () => ({ error: "not used" }),
    stopToolProcess: () => ({ error: "not used" }),
    listProjectFiles: search.listProjectFiles,
    searchWeb: async (query) => ({ ok: true, provider: "test", query, count: 0, results: [] }),
    fetchWebPage: async (url) => ({ ok: true, url, finalUrl: url, title: "", contentType: "text/html", truncated: false, content: "" }),
    subagentRunner: runner,
    openRouterApiKey,
  });
  return { handlers, terminalHost: {
    startProcess: startProcess || ((workspace, command, options = {}) => ({ ok: true, mode: "process_start", id: "proc-test-1", terminalId: "1", command, options })),
  } };
}

test("buildTraffsuckerPlan authors an in-scope config.yaml and safe processArgs", () => {
  const built = buildTraffsuckerPlan({
    target: "https://example.com",
    model: "anthropic/claude-sonnet",
    context: "Operator persona; authorization confirmed",
    goal: "Map the application",
    max_pages: 150,
    max_depth: 4,
    max_runtime: 1200,
  });
  assert.equal(built.ok, true);
  assert.equal(built.executable, "traffsucker");
  assert.equal(built.plan.host, "https://example.com");
  // config.yaml is authored to the gitignored runtime path (outside source tree)
  assert.match(built.plan.configPath, /^runtime\/traffsucker\/config\.yaml$/);
  assert.match(built.configYaml, /scope:/);
  assert.match(built.configYaml, /hosts: \["https:\/\/example\.com"\]/);
  assert.match(built.configYaml, /model: anthropic\/claude-sonnet/);
  // model goes into config + --model, but never any credential
  assert.ok(built.processArgs.includes("--model"));
  assert.ok(built.processArgs.includes("anthropic/claude-sonnet"));
  // API key must never appear in args or command string
  assert.ok(!built.processArgs.some((arg) => /sk-or-|OPENROUTER/.test(arg)));
  assert.ok(!built.command.includes("sk-or-"));
  assert.ok(!built.command.includes("OPENROUTER"));
});

test("buildTraffsuckerPlan rejects out-of-scope or absolute output paths", () => {
  const badTarget = buildTraffsuckerPlan({ target: "ftp://example.com" });
  assert.equal(badTarget.ok, false);
  assert.equal(badTarget.code, "TARGET_INVALID");

  const badRunDir = buildTraffsuckerPlan({ target: "https://example.com", run_dir: "/etc/traffsucker" });
  assert.equal(badRunDir.ok, false);
  assert.equal(badRunDir.code, "OUTPUT_PATH_INVALID");

  const traversal = buildTraffsuckerPlan({ target: "https://example.com", run_dir: "../secrets" });
  assert.equal(traversal.ok, false);

  const sourceTree = buildTraffsuckerPlan({ target: "https://example.com", run_dir: "src/sub-agent/traffsucker" });
  assert.equal(sourceTree.ok, false);
  assert.equal(sourceTree.code, "OUTPUT_PATH_INVALID");
});

test("SECURITY_EXECUTABLES includes traffsucker and ACTIVE includes run_traffsucker", () => {
  assert.ok(XekuteCyberTools.SECURITY_EXECUTABLES.includes("traffsucker"));
  assert.ok(XekuteCyberTools.ACTIVE.includes("run_traffsucker"));
  assert.ok(ToolMap.TOOL_NAMES.includes("run_traffsucker"));
  const validated = ToolMap.validateToolCall("run_traffsucker", { target: "https://example.com" });
  assert.equal(validated.ok, true);
});

test("run_traffsucker handler authors config and returns subagent_wait", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-traffsucker-"));
  const runs = [];
  const { handlers, terminalHost } = makeToolHandlers({
    runner: createSubagentRunner({ toolProcesses: new Map() }),
    openRouterApiKey: () => "sk-or-v1-supersecret",
    startProcess(workspace, command, options = {}) {
      runs.push({ command, options });
      return { ok: true, mode: "process_start", id: "proc-ts-1", terminalId: "9", command };
    },
  });
  const result = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "run_traffsucker", arguments: { target: "https://example.com", model: "anthropic/claude-sonnet" } } },
    terminalHost,
  });
  assert.equal(result.mode, "subagent_wait");
  assert.equal(result.status, "running");
  assert.ok(result.subagentId);
  // config.yaml was written into runtime/traffsucker/ within the workspace
  const configPath = path.join(root, "runtime", "traffsucker", "config.yaml");
  assert.ok(fs.existsSync(configPath), "config.yaml should be authored");
  const configContent = fs.readFileSync(configPath, "utf8");
  assert.match(configContent, /scope:/);
  // the API key is only injected via env, never into args or the config file
  assert.ok(runs.length === 1);
  assert.equal(runs[0].options.env.OPENROUTER_API_KEY, "sk-or-v1-supersecret");
  assert.ok(!runs[0].command.includes("sk-or-v1-supersecret"));
  assert.ok(!configContent.includes("sk-or-v1-supersecret"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("subagent-runner disables eviction / emits completion for traffsucker owner", async () => {
  const toolProcesses = new Map();
  const processId = "proc-traffsucker-42";
  const procRecord = {
    id: processId,
    command: "traffsucker map ...",
    running: false,
    exitCode: 0,
    signal: null,
    stdout: "done",
    stderr: "",
  };
  toolProcesses.set(processId, procRecord);

  let completed = null;
  const runner = createSubagentRunner({ toolProcesses, onComplete(snapshot) { completed = snapshot; } });
  const { subagentId } = runner.registerRun({
    processId,
    terminalId: "9",
    workspace: "/tmp",
    outputDir: "runtime/traffsucker/map",
    configPath: "runtime/traffsucker/config.yaml",
    model: "anthropic/claude-sonnet",
    target: "example.com",
  });
  assert.ok(subagentId);

  // The run record exists while the process is queryable.
  assert.ok(runner.getRun(subagentId));
  assert.deepEqual(runner.listRuns().map((r) => r.subagentId), [subagentId]);

  // A pre-completed process (exitCode set, running false) finalizes immediately
  // via the 3s poll; give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const snapshot = runner.getRun(subagentId);
  assert.equal(snapshot.status, "complete");
  assert.equal(completed?.status, "complete");
});
