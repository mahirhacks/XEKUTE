"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createAuthorityComposition } = require("../src/agent/authority/composition.js");
const { createInvocationPipeline } = require("../src/agent/authority/invocation-pipeline.js");
const { MODE_TOOL_GROUPS, TOOL_METADATA, TOOL_REGISTRY_NAMES } = require("../src/agent/tools/config/tool-metadata.js");
const { evaluateToolScopeAsync } = require("../src/agent/authority/scope/scope-policy.js");
const { ASK_QUESTIONS_INPUT_SCHEMA } = require("../src/agent/tools/process/ask-questions.js");
const { EXEC_COMMAND_INPUT_SCHEMA } = require("../src/agent/tools/process/exec-command.js");
const { VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA } = require("../src/agent/tools/process/view-active-terminal.js");
const { READ_FILE_INPUT_SCHEMA } = require("../src/agent/tools/workspace/read-file.js");
const { SEARCH_WORKSPACE_INPUT_SCHEMA } = require("../src/agent/tools/workspace/search-workspace.js");
const { APPLY_PATCH_INPUT_SCHEMA } = require("../src/agent/tools/workspace/apply-patch.js");
const { MANAGE_IDENTITY_INPUT_SCHEMA } = require("../src/agent/tools/assessment/manage-identity.js");
const { REPLAY_REQUEST_INPUT_SCHEMA } = require("../src/agent/tools/assessment/replay-request.js");
const { BROWSER_ACTION_INPUT_SCHEMA } = require("../src/agent/tools/assessment/browser-action.js");
const { DELEGATE_AGENT_INPUT_SCHEMA } = require("../src/agent/tools/process/delegate-agent.js");
const { WEB_RESEARCH_INPUT_SCHEMA } = require("../src/agent/tools/assessment/web-research.js");

const SCHEMAS = Object.freeze({
  ask_questions: ASK_QUESTIONS_INPUT_SCHEMA,
  exec_command: EXEC_COMMAND_INPUT_SCHEMA,
  view_active_terminal: VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA,
  read_file: READ_FILE_INPUT_SCHEMA,
  search_workspace: SEARCH_WORKSPACE_INPUT_SCHEMA,
  apply_patch: APPLY_PATCH_INPUT_SCHEMA,
  manage_identity: MANAGE_IDENTITY_INPUT_SCHEMA,
  replay_request: REPLAY_REQUEST_INPUT_SCHEMA,
  browser_action: BROWSER_ACTION_INPUT_SCHEMA,
  delegate_agent: DELEGATE_AGENT_INPUT_SCHEMA,
  web_research: WEB_RESEARCH_INPUT_SCHEMA,
});

const VALID_ARGS = Object.freeze({
  ask_questions: {
    questions: [{ question: "Which file should change?", choices: [{ choice: "src/math.js" }, { choice: "src/todo.js" }] }],
  },
  exec_command: { command: "echo ok", context: "print marker" },
  view_active_terminal: {},
  read_file: { path: "README.md" },
  search_workspace: { mode: "text", query: "MAGIC_TOKEN" },
  apply_patch: { operations: [{ kind: "create", path: "notes/ok.txt", content: "ok" }] },
  manage_identity: { operation: "list" },
  replay_request: { request: { url: "https://example.com/login" } },
  browser_action: { action: "navigate", url: "https://example.com" },
  delegate_agent: {
    task: "Summarize README.md",
    contextPackage: { role: "agent", authority: "full_authority", scope: {}, identity: {}, resources: {} },
    expectedOutput: { description: "short summary", format: "text" },
  },
  web_research: { operation: "search", query: "public docs" },
});

function entryFor(name) {
  return {
    name,
    adapter: { execute: async () => ({ ok: true }) },
    inputSchema: SCHEMAS[name],
    metadata: { ...(TOOL_METADATA[name] || {}) },
  };
}

function context(root, overrides = {}) {
  return createExecutionContext({
    invocationId: overrides.invocationId || `inv-${nameId()}`,
    toolName: overrides.toolName || "read_file",
    role: overrides.role || "agent",
    authority: overrides.authority || "full_authority",
    workspace: { root },
    sessionId: overrides.sessionId || "session-1",
    mode: overrides.role || "agent",
    identityContext: overrides.identityContext || { identityId: "", pageId: "main" },
    resourceLimits: { outputBytes: 100_000, processCount: 4, maximumConcurrency: 4, requestsPerSecond: 10 },
  });
}

function nameId() {
  return Math.random().toString(36).slice(2);
}

function pipeline() {
  const composition = createAuthorityComposition({ evaluateScope: evaluateToolScopeAsync });
  return createInvocationPipeline({ authorityRegistry: composition.registry, concurrency: composition.concurrency });
}

async function invoke(root, { toolName, args, role = "agent", authority = "full_authority", runtime = {}, execute } = {}) {
  let executions = 0;
  const result = await pipeline().invoke({
    context: context(root, { toolName, role, authority }),
    toolName,
    args,
    entry: entryFor(toolName),
    execute: async () => {
      executions += 1;
      if (typeof execute === "function") return execute();
      return { ok: true, value: { ran: toolName } };
    },
    runtime: {
      approvalProvider: runtime.approvalProvider,
      projectProfile: runtime.projectProfile || null,
      identityExists: runtime.identityExists,
    },
  });
  return { result, executions };
}

test("every catalog tool is allowed or denied by mode, then by remaining gates", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-catalog-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Catalog\n");
  assert.deepEqual([...TOOL_REGISTRY_NAMES].sort(), Object.keys(VALID_ARGS).sort());

  for (const toolName of TOOL_REGISTRY_NAMES) {
    const ask = await invoke(root, { toolName, args: VALID_ARGS[toolName], role: "ask", authority: "full_authority" });
    if (MODE_TOOL_GROUPS.ask.includes(toolName)) {
      if (["replay_request", "browser_action"].includes(toolName)) continue;
      assert.equal(ask.result.ok, true, `ask/${toolName} should run`);
      assert.equal(ask.executions, 1, `ask/${toolName} should execute`);
    } else {
      assert.equal(ask.result.ok, false, `ask/${toolName} must be denied`);
      assert.equal(ask.result.code, "TOOL_UNAVAILABLE_IN_MODE", `ask/${toolName}`);
      assert.equal(ask.executions, 0, `ask/${toolName} must not execute`);
    }
  }

  const mcpAsk = await pipeline().invoke({
    context: context(root, { toolName: "mcp__scout__host_search", role: "ask", authority: "full_authority" }),
    toolName: "mcp__scout__host_search",
    args: { host: "example.com" },
    entry: { name: "mcp__scout__host_search", inputSchema: { type: "object", additionalProperties: true }, metadata: { targetTypes: ["network"], targetArguments: ["host"] } },
    execute: async () => ({ ok: true }),
    runtime: {},
  });
  assert.equal(mcpAsk.ok, false);
  assert.equal(mcpAsk.code, "TOOL_UNAVAILABLE_IN_MODE");
});

test("agent full_authority executes local catalog tools and hard-denies unscoped network/wipes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-catalog-agent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Catalog\n");

  for (const toolName of ["ask_questions", "read_file", "search_workspace", "view_active_terminal", "apply_patch", "exec_command", "manage_identity", "delegate_agent", "web_research"]) {
    const { result, executions } = await invoke(root, { toolName, args: VALID_ARGS[toolName], authority: "full_authority" });
    assert.equal(result.ok, true, `${toolName} should succeed: ${result.code || result.error || ""}`);
    assert.equal(executions, 1, toolName);
  }

  const replay = await invoke(root, { toolName: "replay_request", args: VALID_ARGS.replay_request });
  assert.equal(replay.result.ok, false);
  assert.equal(replay.result.code, "SCOPE_NOT_CONFIGURED");
  assert.equal(replay.executions, 0);

  const browse = await invoke(root, { toolName: "browser_action", args: VALID_ARGS.browser_action });
  assert.equal(browse.result.ok, false);
  assert.equal(browse.result.code, "SCOPE_NOT_CONFIGURED");
  assert.equal(browse.executions, 0);

  const pages = await invoke(root, { toolName: "browser_action", args: { action: "list_pages" } });
  assert.equal(pages.result.ok, true);
  assert.equal(pages.executions, 1);

  const nmap = await invoke(root, { toolName: "exec_command", args: { command: "nmap 8.8.8.8", context: "scan resolver" } });
  assert.equal(nmap.result.ok, false);
  assert.equal(nmap.result.code, "SCOPE_NOT_CONFIGURED");
  assert.equal(nmap.executions, 0);

  const inScope = await invoke(root, {
    toolName: "exec_command",
    args: { command: "nmap 10.0.0.5", context: "scan lab host" },
    runtime: { projectProfile: { scope: { inScopeTargets: ["10.0.0.5"] } } },
  });
  assert.equal(inScope.result.ok, true, inScope.result.error || inScope.result.code || "");
  assert.equal(inScope.executions, 1);

  const wipe = await invoke(root, { toolName: "exec_command", args: { command: "Remove-Item -Recurse -Force .\\notes, .\\src", context: "wipe trees" } });
  assert.equal(wipe.result.ok, false);
  assert.equal(wipe.result.code, "DESTRUCTIVE_WIPE_DENIED");
  assert.equal(wipe.executions, 0);

  const mass = await invoke(root, {
    toolName: "apply_patch",
    args: { operations: [
      { kind: "delete", path: "a.js" },
      { kind: "delete", path: "b.js" },
      { kind: "delete", path: "c.js" },
      { kind: "delete", path: "d.js" },
    ] },
  });
  assert.equal(mass.result.ok, false);
  assert.equal(mass.result.code, "MASS_DELETE_DENIED");
  assert.equal(mass.executions, 0);
});

test("ask_for_approval blocks exec without an operator decision and still allows apply_patch", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-approval-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Catalog\n");

  const missing = await invoke(root, {
    toolName: "exec_command",
    args: VALID_ARGS.exec_command,
    authority: "ask_for_approval",
  });
  assert.equal(missing.result.ok, false);
  assert.equal(missing.result.code, "APPROVAL_REQUIRED");
  assert.equal(missing.executions, 0);

  const denied = await invoke(root, {
    toolName: "exec_command",
    args: VALID_ARGS.exec_command,
    authority: "ask_for_approval",
    runtime: { approvalProvider: async () => ({ id: "no", approved: false, reason: "operator said no" }) },
  });
  assert.equal(denied.result.ok, false);
  assert.equal(denied.result.code, "APPROVAL_DENIED");
  assert.equal(denied.executions, 0);

  const granted = await invoke(root, {
    toolName: "exec_command",
    args: VALID_ARGS.exec_command,
    authority: "ask_for_approval",
    runtime: { approvalProvider: async () => ({ id: "yes", approved: true }) },
  });
  assert.equal(granted.result.ok, true);
  assert.equal(granted.executions, 1);

  const patch = await invoke(root, {
    toolName: "apply_patch",
    args: VALID_ARGS.apply_patch,
    authority: "ask_for_approval",
  });
  assert.equal(patch.result.ok, true, "apply_patch must not require interactive approval");
  assert.equal(patch.executions, 1);
});
