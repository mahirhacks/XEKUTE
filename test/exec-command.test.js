"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createExecCommandTool, resolveShellInvocation, validateInput } = require("../src/agent/tools/process/exec-command.js");
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

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

test("exec_command returns structured process metadata and output", async () => {
  const child = new FakeChild();
  const calls = [];
  const tool = createExecCommandTool({
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      queueMicrotask(() => {
        child.stdout.emit("data", "hello\n");
        child.stderr.emit("data", "warning\n");
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  const result = await tool.execute(
    { executable: "fixture-command", args: ["--safe"], cwd: "G:/workspace" },
    execContext(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.processId, 4242);
  assert.equal(result.value.exitCode, 0);
  assert.equal(result.value.stdout, "hello\n");
  assert.equal(result.value.stderr, "warning\n");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, "G:/workspace");
});

test("exec_command runs complete multiline PowerShell syntax through an explicit shell process", async () => {
  const child = new FakeChild();
  const calls = [];
  const tool = createExecCommandTool({
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      queueMicrotask(() => {
        child.stdout.emit("data", "two\n");
        child.emit("close", 0, null);
      });
      return child;
    },
  });
  const command = "$items = 1, 2\n$items | Select-Object -Last 1";
  const result = await tool.execute({ command, shell: "powershell" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].executable, "powershell.exe");
  assert.deepEqual(calls[0].args.slice(0, -1), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
  assert.equal(calls[0].args.at(-1), command);
  assert.equal(calls[0].options.shell, false);
  assert.equal(result.value.command, command);
  assert.equal(result.value.shell, "powershell");
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

test("exec_command executes real PowerShell pipelines on Windows", { skip: process.platform !== "win32" }, async () => {
  const tool = createExecCommandTool();
  const result = await tool.execute(
    { command: "$values = 1, 2, 3\n$values | Measure-Object -Sum | Select-Object -ExpandProperty Sum", shell: "powershell", timeout_ms: 10_000 },
    execContext({ workspace: { root: process.cwd() } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.exitCode, 0);
  assert.equal(result.value.stdout.trim(), "6");
});

test("exec_command rejects malformed capability input without spawning", async () => {
  let spawnCalls = 0;
  const tool = createExecCommandTool({ spawn: () => { spawnCalls += 1; return new FakeChild(); } });
  assert.equal((await tool.execute({ executable: "" }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal((await tool.execute({ executable: "fixture", args: ["bad\u0000arg"] }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal((await tool.execute({ command: "echo one", executable: "echo" }, execContext())).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ command: "echo one", shell: "unknown" }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ command: "echo one", show_in_terminal: "yes" }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(validateInput({ operation: "list", show_in_terminal: false }).error.code, "INVALID_EXEC_COMMAND_INPUT");
  assert.equal(spawnCalls, 0);
});

test("exec_command terminal visibility is an optional boolean that defaults shown", () => {
  const tool = createExecCommandTool({ spawn: () => new FakeChild() });
  const property = tool.inputSchema.properties.show_in_terminal;
  assert.equal(property.type, "boolean");
  assert.equal(property.default, true);
  assert.match(property.description, /true or omitted[\s\S]*in-app Terminal panel[\s\S]*Set false only for small background commands/i);
  assert.equal(validateInput({ command: "git status" }).ok, true);
  assert.equal(validateInput({ command: "npm test", show_in_terminal: false }).ok, true);
});

test("exec_command direct mode permits multiline argument values and absolute executable paths", async () => {
  const child = new FakeChild();
  const calls = [];
  const tool = createExecCommandTool({
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });
  const result = await tool.execute({ executable: "C:/Program Files/tool/tool.exe", args: ["line one\nline two"] }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].executable, "C:/Program Files/tool/tool.exe");
  assert.deepEqual(calls[0].args, ["line one\nline two"]);
});

test("exec_command rejects an unrestricted execution context projection", async () => {
  const tool = createExecCommandTool({ spawn: () => new FakeChild() });
  const fullContext = createExecutionContext({
    invocationId: "invocation-exec-2",
    toolName: "exec_command",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ executable: "fixture" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("exec_command defaults cwd from the projected workspace root", async () => {
  const child = new FakeChild();
  const calls = [];
  const tool = createExecCommandTool({
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  });

  const result = await tool.execute({ executable: "fixture-command" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls[0].options.cwd, "G:/workspace");
});

test("exec_command registration adds exactly one raw tool entry", () => {
  const tool = createExecCommandTool({ spawn: () => new FakeChild() });
  const registry = createToolRegistry();
  const entry = registerExecCommand(registry, tool);
  assert.equal(entry.name, "exec_command");
  assert.deepEqual(registry.names(), ["exec_command"]);
  assert.throws(() => registerExecCommand(registry, tool), /DUPLICATE_TOOL_NAME/);
});

test("exec_command raw adapter contains no authority decision result", async () => {
  const child = new FakeChild();
  const tool = createExecCommandTool({
    spawn() {
      queueMicrotask(() => child.emit("close", 1, null));
      return child;
    },
  });
  const result = await tool.execute({ executable: "fixture" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.exitCode, 1);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
});
