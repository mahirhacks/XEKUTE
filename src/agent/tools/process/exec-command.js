"use strict";

const { spawn: defaultSpawn } = require("node:child_process");
const { assertToolAdapter } = require("../../../contracts/tool/tool-adapter");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const EXEC_COMMAND_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "Run an arbitrary shell command or launch an executable in the active workspace. On Windows, command mode defaults to PowerShell and supports pipelines, redirects, variables, quoting, and multiline scripts.",
  properties: {
    operation: { type: "string", enum: ["run", "start", "status", "stop", "list"], description: "run waits for completion; start creates a durable background job; status/stop inspect or cancel it; list shows project jobs." },
    command: { type: "string", description: "Complete shell command or multiline script. Prefer this for PowerShell/cmd syntax, pipelines, redirection, and compound commands." },
    shell: { type: "string", enum: ["auto", "powershell", "pwsh", "cmd", "bash", "sh"], description: "Shell used for command mode. auto selects PowerShell on Windows and bash elsewhere." },
    executable: { type: "string", description: "Executable name or path for direct process mode. Use with args instead of command." },
    args: { type: "array", items: { type: "string" }, description: "Exact argument vector for direct process mode; no shell parsing is applied." },
    cwd: { type: "string", description: "Working directory inside the active workspace. Defaults to the workspace root." },
    env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables merged over the application environment for this process." },
    timeout_ms: { type: "integer", minimum: 0, maximum: 86400000, description: "Optional timeout in milliseconds. Zero or omission means no timeout." },
    process_id: { type: "string", description: "Durable process ID used by status or stop." },
    tail_chars: { type: "integer", minimum: 0, maximum: 200000, description: "Maximum recent stdout/stderr characters returned by status." },
    wait_ms: { type: "integer", minimum: 0, maximum: 86400000, description: "For status, wait up to this many milliseconds for process state or output to change. This is an observation window, not a process timeout." },
    stdout_offset: { type: "integer", minimum: 0, description: "Optional byte cursor returned by a previous status call. When supplied, stdout contains only newer output." },
    stderr_offset: { type: "integer", minimum: 0, description: "Optional byte cursor returned by a previous status call. When supplied, stderr contains only newer output." },
  },
  anyOf: [{ required: ["command"] }, { required: ["executable"] }, { required: ["process_id"] }, { required: ["operation"] }],
  additionalProperties: false,
});

const SHELL_NAMES = new Set(["auto", "powershell", "pwsh", "cmd", "bash", "sh"]);

function normalizeShell(shell = "auto", platform = process.platform) {
  const requested = String(shell || "auto").trim().toLowerCase();
  if (!SHELL_NAMES.has(requested)) return "";
  if (requested !== "auto") return requested;
  return platform === "win32" ? "powershell" : "bash";
}

function resolveShellInvocation(command, shell = "auto", platform = process.platform, env = process.env) {
  const normalized = normalizeShell(shell, platform);
  if (!normalized) return null;
  if (normalized === "powershell") {
    return {
      shell: normalized,
      executable: platform === "win32" ? "powershell.exe" : "pwsh",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", ...(platform === "win32" ? ["-ExecutionPolicy", "Bypass"] : []), "-Command", command],
    };
  }
  if (normalized === "pwsh") {
    return { shell: normalized, executable: platform === "win32" ? "pwsh.exe" : "pwsh", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] };
  }
  if (normalized === "cmd") {
    return { shell: normalized, executable: env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  if (normalized === "sh") return { shell: normalized, executable: platform === "win32" ? "sh.exe" : "/bin/sh", args: ["-c", command] };
  return { shell: normalized, executable: platform === "win32" ? "bash.exe" : (env.SHELL || "/bin/bash"), args: ["-lc", command] };
}

function invalidInput(message) {
  return {
    ok: false,
    error: {
      code: "INVALID_EXEC_COMMAND_INPUT",
      message,
      retryable: false,
    },
  };
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidInput("Input must be an object");
  const operation = String(input.operation || "run");
  if (!["run", "start", "status", "stop", "list"].includes(operation)) return invalidInput("operation must be run, start, status, stop, or list");
  const commandProvided = Object.prototype.hasOwnProperty.call(input, "command");
  const executableProvided = Object.prototype.hasOwnProperty.call(input, "executable");
  const hasCommand = typeof input.command === "string" && input.command.trim() !== "";
  const hasExecutable = typeof input.executable === "string" && input.executable.trim() !== "";
  if (commandProvided && !hasCommand) return invalidInput("command must be a non-empty string");
  if (executableProvided && !hasExecutable) return invalidInput("executable must be a non-empty string");
  const needsCommand = operation === "run" || operation === "start";
  if (needsCommand && hasCommand === hasExecutable) return invalidInput("Provide exactly one of command or executable");
  if (!needsCommand && (hasCommand || hasExecutable)) return invalidInput(`${operation} does not accept command or executable`);
  if (["status", "stop"].includes(operation) && (typeof input.process_id !== "string" || !input.process_id.trim())) return invalidInput(`${operation} requires process_id`);
  if (operation === "list" && input.process_id !== undefined) return invalidInput("list does not accept process_id");
  if (hasCommand && /\u0000/.test(input.command)) return invalidInput("command contains an invalid null character");
  if (hasExecutable && /[\u0000\r\n]/.test(input.executable)) return invalidInput("executable contains an invalid control character");
  if (input.shell !== undefined && !normalizeShell(input.shell)) return invalidInput("shell must be auto, powershell, pwsh, cmd, bash, or sh");
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some(arg => typeof arg !== "string" || /\u0000/.test(arg)))) {
    return invalidInput("args must contain only strings without null characters");
  }
  if (hasCommand && input.args !== undefined) return invalidInput("args can only be used with executable mode");
  if (hasExecutable && input.shell !== undefined) return invalidInput("shell can only be used with command mode");
  if (input.cwd !== undefined && (typeof input.cwd !== "string" || input.cwd.trim() === "")) return invalidInput("cwd must be a non-empty string");
  if (input.cwd !== undefined && /\u0000/.test(input.cwd)) return invalidInput("cwd contains an invalid null character");
  if (input.env !== undefined && (!input.env || typeof input.env !== "object" || Array.isArray(input.env) || Object.values(input.env).some(value => typeof value !== "string" || /\u0000/.test(value)))) {
    return invalidInput("env must contain only string values without null characters");
  }
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 0 || input.timeout_ms > 86_400_000)) {
    return invalidInput("timeout_ms must be an integer between 0 and 86400000");
  }
  if (input.process_id !== undefined && (typeof input.process_id !== "string" || !/^[a-z0-9-]{3,160}$/i.test(input.process_id))) return invalidInput("process_id is invalid");
  if (input.tail_chars !== undefined && (!Number.isInteger(input.tail_chars) || input.tail_chars < 0 || input.tail_chars > 200_000)) return invalidInput("tail_chars must be between 0 and 200000");
  if (input.wait_ms !== undefined && (!Number.isInteger(input.wait_ms) || input.wait_ms < 0 || input.wait_ms > 86_400_000)) return invalidInput("wait_ms must be between 0 and 86400000");
  if (operation !== "status" && input.wait_ms !== undefined) return invalidInput("wait_ms is only valid for status");
  for (const key of ["stdout_offset", "stderr_offset"]) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < 0)) return invalidInput(`${key} must be a non-negative safe integer`);
    if (operation !== "status" && input[key] !== undefined) return invalidInput(`${key} is only valid for status`);
  }
  return { ok: true };
}

function createExecCommandTool({ spawn = defaultSpawn, processManager = null } = {}) {
  if (typeof spawn !== "function") throw new TypeError("spawn must be a function");

  const adapter = {
    name: "exec_command",
    description: EXEC_COMMAND_INPUT_SCHEMA.description,
    inputSchema: EXEC_COMMAND_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return {
          ok: false,
          error: {
            code: "INVALID_EXECUTION_CONTEXT",
            message: "exec_command requires a restricted tool execution context projection",
            retryable: false,
          },
        };
      }

      const operation = String(input.operation || "run");
      if (operation !== "run") {
        if (!processManager || typeof processManager[operation] !== "function") {
          return { ok: false, error: { code: "DURABLE_PROCESS_PROVIDER_UNAVAILABLE", message: "Durable process management is unavailable in this execution environment.", retryable: false } };
        }
        return processManager[operation](executionContext.workspace?.root, input, runtime);
      }

      const invocation = input.command !== undefined
        ? resolveShellInvocation(input.command, input.shell)
        : { shell: null, executable: input.executable, args: input.args ? [...input.args] : [] };
      const args = [...invocation.args];
      const cwd = input.cwd ?? executionContext.workspace?.root;
      const startedAt = Date.now();
      let child;
      try {
        child = spawn(invocation.executable, args, {
          cwd,
          env: input.env ? { ...process.env, ...input.env } : process.env,
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error.code || "EXEC_COMMAND_START_FAILED",
            message: error.message,
            retryable: false,
          },
        };
      }

      const stdout = [];
      const stderr = [];
      child.stdout?.on("data", chunk => stdout.push(String(chunk)));
      child.stderr?.on("data", chunk => stderr.push(String(chunk)));

      return new Promise(resolve => {
        let settled = false;
        let timedOut = false;
        let stopped = false;
        const timeoutMs = Number(input.timeout_ms) || 0;
        const stop = () => {
          stopped = true;
          try { child.kill(); } catch { /* Process already exited. */ }
        };
        if (runtime?.signal?.aborted) stop();
        else runtime?.signal?.addEventListener?.("abort", stop, { once: true });
        const timer = timeoutMs > 0 ? setTimeout(() => {
          timedOut = true;
          try { child.kill(); } catch { /* Process already exited. */ }
        }, timeoutMs) : null;
        const finish = value => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          runtime?.signal?.removeEventListener?.("abort", stop);
          resolve(value);
        };
        child.on("error", error => finish({
          ok: false,
          error: {
            code: error.code || "EXEC_COMMAND_FAILED",
            message: error.message,
            retryable: false,
          },
          value: {
            processId: child.pid,
            executable: invocation.executable,
            args,
            ...(input.command !== undefined ? { command: input.command, shell: invocation.shell } : {}),
            stdout: stdout.join(""),
            stderr: stderr.join(""),
            startedAt,
            finishedAt: Date.now(),
          },
        }));
        child.on("close", (exitCode, signal) => {
          const finishedAt = Date.now();
          finish({
            ok: true,
            value: {
              processId: child.pid,
              executable: invocation.executable,
              args,
              ...(input.command !== undefined ? { command: input.command, shell: invocation.shell } : {}),
              cwd,
              stdout: stdout.join(""),
              stderr: stderr.join(""),
              exitCode,
              signal,
              timedOut,
              status: stopped ? "stopped" : timedOut ? "timeout" : exitCode === 0 ? "complete" : "failed",
              outputCompleteness: stopped || timedOut ? "partial" : "complete",
              startedAt,
              finishedAt,
              elapsedMs: finishedAt - startedAt,
            },
          });
        });
      });
    },
  };

  return assertToolAdapter(adapter);
}

module.exports = {
  EXEC_COMMAND_INPUT_SCHEMA,
  createExecCommandTool,
  normalizeShell,
  resolveShellInvocation,
  validateInput,
};
