"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecCommandTool, resolveShellInvocation, validateInput } = require("../src/agent/tools/process/exec-command.js");
const { validateExecCommandContext } = require("../src/agent/tools/process/exec-command-context.js");
const { createToolRegistry, registerExecCommand } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-exec-1",
    toolName: "exec_command",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: "G:/workspace" },
    ...overrides,
  }));
}

function managerDouble(value = { mode: "command", processId: "process-test-abc", status: "complete", exitCode: 0, stdout: "hello\n", stderr: "warning\n" }) {
  return {
    run: async () => ({ ok: true, value }),
    start: async () => ({ ok: true, value }),
    status: async () => ({ ok: true, value }),
    stop: async () => ({ ok: true, value }),
    list: async () => ({ ok: true, value: { processes: [] } }),
  };
}

test("exec_command returns structured process metadata through the manager", async () => {
  const calls = [];
  const processManager = {
    async run(workspace, input, runtime) {
      calls.push({ workspace, input, runtime });
      return { ok: true, value: { mode: "command", processId: "process-test-abc", exitCode: 0, stdout: "hello\n", stderr: "warning\n" } };
    },
  };
  const tool = createExecCommandTool({ processManager });

  const result = await tool.execute(
    { executable: "fixture-command", args: ["--safe"], cwd: "G:/workspace", context: "fixture command" },
    execContext(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.processId, "process-test-abc");
  assert.notEqual(result.value.processId, 4242);
  assert.equal(result.value.exitCode, 0);
  assert.equal(result.value.stdout, "hello\n");
  assert.equal(result.value.stderr, "warning\n");
  assert.equal(calls[0].workspace, "G:/workspace");
});

test("exec_command runs complete multiline PowerShell syntax through the manager", async () => {
  const calls = [];
  const processManager = {
    async run(workspace, input) {
      calls.push({ workspace, input });
      return { ok: true, value: { mode: "command", processId: "process-ps-1", exitCode: 0, stdout: "two\n" } };
    },
  };
  const tool = createExecCommandTool({ processManager });
  const command = "$items = 1, 2\n$items | Select-Object -Last 1";
  const result = await tool.execute({ command, shell: "powershell", context: "powershell pipeline" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.command, command);
  assert.equal(calls[0].input.shell, "powershell");
});

test("exec_command resolves cmd and Unix shell invocations without interpreting command text itself", () => {
  assert.deepEqual(resolveShellInvocation("echo one && echo two", "cmd", "win32", { COMSPEC: "C:/Windows/System32/cmd.exe" }), {
    shell: "cmd",
    executable: "C:/Windows/System32/cmd.exe",
    args: ["/d", "/s", "/c", "echo one && echo two"],
  });
  assert.deepEqual(resolveShellInvocation("printf '%s\\n' one | tail -1", "bash", "linux", { SHELL: "/usr/bin/bash" }), {
    shell: "bash",
    executable: "/usr/bin/bash",
    args: ["-lc", "printf '%s\\n' one | tail -1"],
  });
});

test("exec_command executes real PowerShell pipelines on Windows through the manager", { skip: process.platform !== "win32" }, async () => {
  const { createDurableProcessManager } = require("../src/app/services/terminal/durable-process-manager.js");
  const manager = createDurableProcessManager({
    resolveWorkspaceTarget(root) { return { root: require("node:path").resolve(root), target: require("node:path").resolve(root) }; },
  });
  const tool = createExecCommandTool({ processManager: manager });
  const result = await tool.execute(
    { command: "$values = 1, 2, 3\n$values | Measure-Object -Sum | Select-Object -ExpandProperty Sum", shell: "powershell", timeout_ms: 10_000, wait_ms: 5_000, context: "powershell sum" },
    execContext({ workspace: { root: process.cwd() } }),
  );
  assert.equal(result.ok, true);
  assert.match(result.value.processId, /^process-/);
  if (result.value.stdout) assert.match(result.value.stdout.trim(), /6/);
});

test("exec_command rejects malformed capability input without calling the manager", async () => {
  let managerCalls = 0;
  const tool = createExecCommandTool({ processManager: { run: async () => { managerCalls += 1; return { ok: true, value: {} }; } } });
  assert.equal((await tool.execute({ executable: "" }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal((await tool.execute({ executable: "fixture", args: ["bad\u0000arg"] }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal((await tool.execute({ command: "echo one", executable: "echo" }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ command: "echo one", shell: "unknown" }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ command: "echo one", show_in_terminal: "yes" }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ operation: "list", show_in_terminal: false }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(managerCalls, 0);
});

test("exec_command fail-closed when manager run is unavailable", async () => {
  const tool = createExecCommandTool();
  const result = await tool.execute({ command: "echo ok", context: "echo check" }, execContext());
  assert.equal(result.error.code, "DURABLE_PROCESS_PROVIDER_UNAVAILABLE");
});

test("exec_command validateInput allows wait_ms on run and rejects on start", () => {
  assert.equal(validateInput({ operation: "run", command: "echo ok", context: "echo check", wait_ms: 1 }).ok, true);
  assert.equal(validateInput({ operation: "start", command: "echo ok", context: "echo check", wait_ms: 1 }).ok, false);
  assert.equal(validateInput({ operation: "status", process_id: "process-abc", wait_ms: 1 }).ok, true);
});

test("exec_command terminal visibility is an optional boolean that defaults shown", () => {
  const tool = createExecCommandTool({ processManager: managerDouble() });
  const property = tool.inputSchema.properties.show_in_terminal;
  assert.equal(property.type, "boolean");
  assert.equal(property.default, true);
  assert.match(property.description, /true or omitted[\s\S]*in-app Terminal panel[\s\S]*Set false only for small background commands/i);
  assert.equal(validateInput({ command: "git status", context: "git status" }).ok, true);
  assert.equal(validateInput({ command: "npm test", context: "npm test", show_in_terminal: false }).ok, true);
});

test("exec_command direct mode permits multiline argument values and absolute executable paths", async () => {
  const calls = [];
  const processManager = {
    async run(workspace, input) {
      calls.push({ workspace, input });
      return { ok: true, value: { mode: "command", processId: "process-direct-1", exitCode: 0 } };
    },
  };
  const tool = createExecCommandTool({ processManager });
  const result = await tool.execute({ executable: "C:/Program Files/tool/tool.exe", args: ["line one\nline two"], context: "direct tool" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.executable, "C:/Program Files/tool/tool.exe");
  assert.deepEqual(calls[0].input.args, ["line one\nline two"]);
});

test("exec_command rejects an unrestricted execution context projection", async () => {
  const tool = createExecCommandTool({ processManager: managerDouble() });
  const fullContext = createExecutionContext({
    invocationId: "invocation-exec-2",
    toolName: "exec_command",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ executable: "fixture", context: "fixture run" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("exec_command defaults cwd from the projected workspace root", async () => {
  const calls = [];
  const processManager = {
    async run(workspace, input) {
      calls.push({ workspace, input });
      return { ok: true, value: { mode: "command", processId: "process-cwd-1", exitCode: 0 } };
    },
  };
  const tool = createExecCommandTool({ processManager });

  const result = await tool.execute({ executable: "fixture-command", context: "fixture command" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].workspace, "G:/workspace");
});

test("exec_command registration adds exactly one raw tool entry", () => {
  const tool = createExecCommandTool({ processManager: managerDouble() });
  const registry = createToolRegistry();
  const entry = registerExecCommand(registry, tool);
  assert.equal(entry.name, "exec_command");
  assert.deepEqual(registry.names(), ["exec_command"]);
  assert.throws(() => registerExecCommand(registry, tool), /DUPLICATE_TOOL_NAME/);
});

test("exec_command raw adapter contains no authority decision result", async () => {
  const processManager = {
    async run() {
      return { ok: true, value: { mode: "command", processId: "process-exit-1", exitCode: 1 } };
    },
  };
  const tool = createExecCommandTool({ processManager });
  const result = await tool.execute({ executable: "fixture", context: "fixture run" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.exitCode, 1);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
});

test("exec_command context is at most 5 words and is required for run and start", () => {
  assert.equal(validateExecCommandContext("amass subdomain enum").ok, true);
  assert.equal(validateExecCommandContext("one two three four five six").ok, false);
  assert.match(validateExecCommandContext("one two three four five six").message, /at most 5 words/);
  assert.equal(validateInput({ command: "echo ok", context: "echo check" }).ok, true);
  assert.equal(validateInput({ command: "echo ok", context: "one two three four five six" }).ok, false);
  assert.equal(validateInput({ command: "echo ok" }).ok, false);
  assert.equal(validateInput({ operation: "status", process_id: "process-abc", context: "status peek" }).ok, false);
  assert.equal((validateInput({ command: "echo ok", context: "one two three four five six" })).error.code, "INVALID_EXEC_COMMAND_INPUT");
});
