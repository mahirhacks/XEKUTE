"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { redactSecrets } = require("../../policies/data-guardrails");

const DEFAULT_EXECUTABLES = new Set(["node", "node.exe", "npm", "npm.cmd", "npx", "npx.cmd", "git", "git.exe", "python", "python.exe", "python3", "py", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"]);
const SHELL_SYNTAX_RE = /[&|;<>()`\r\n]/;
const SECURITY_COMMAND_RE = /(?:^|\s)(?:nmap|nuclei|ffuf|gobuster|sqlmap|nikto|katana|subfinder|amass|httpx|naabu|traceroute|tracert|hping3|testssl|wafw00f)\b/i;

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (const char of String(command || "")) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (quote) return { ok: false, code: "COMMAND_QUOTE_INVALID", error: "Command contains an unterminated quote." };
  if (current) tokens.push(current);
  return { ok: tokens.length > 0, tokens, code: tokens.length ? "OK" : "COMMAND_EMPTY", error: tokens.length ? "" : "Command is empty." };
}

function executableName(value) {
  return path.basename(String(value || "")).toLowerCase();
}

function createCommandPort({ fs, path: pathModule = path, allowedExecutables = DEFAULT_EXECUTABLES, artifactStore = null, terminateProcessTree = null } = {}) {
  function persistOutput(context, output, kind) {
    const value = redactSecrets(String(output || ""));
    if (!value || typeof artifactStore !== "function") return "";
    return artifactStore(context.workspace, value, { operationId: context.operationId, kind });
  }

  function run(input = {}, context = {}) {
    const command = String(input.command || "").trim();
    if (!command) return Promise.resolve({ ok: false, code: "COMMAND_EMPTY", error: "Command is empty." });
    if (SHELL_SYNTAX_RE.test(command)) return Promise.resolve({ ok: false, code: "SHELL_SYNTAX_BLOCKED", error: "Shell chaining and redirection are not allowed." });
    if (SECURITY_COMMAND_RE.test(command)) return Promise.resolve({ ok: false, code: "TYPED_VAPT_OPERATION_REQUIRED", error: "Target-directed security commands must use run_test_case or another typed VAPT operation." });
    if (input.network && input.network !== "development-disabled") return Promise.resolve({ ok: false, code: "NETWORK_CAPABILITY_REQUIRED", error: "exec_command has no assessment-target network capability." });
    const parsed = tokenizeCommand(command);
    if (!parsed.ok) return Promise.resolve(parsed);
    const [executable, ...args] = parsed.tokens;
    if (!allowedExecutables.has(executableName(executable))) return Promise.resolve({ ok: false, code: "EXECUTABLE_NOT_ALLOWED", error: `Executable is not allowed: ${executableName(executable)}` });
    if (args.some((arg) => /[\u0000\r\n]/.test(arg))) return Promise.resolve({ ok: false, code: "PROCESS_ARGUMENT_INVALID", error: "Process arguments contain invalid characters." });
    const cwd = pathModule.resolve(context.workspace || ".", String(input.cwd || "."));
    const root = pathModule.resolve(context.workspace || ".");
    const relative = pathModule.relative(root, cwd);
    if (relative.startsWith("..") || pathModule.isAbsolute(relative)) return Promise.resolve({ ok: false, code: "WORKSPACE_ESCAPE", error: "Command working directory escapes the workspace." });
    const timeoutMs = Math.max(1000, Math.min(Number(input.timeout_ms) || 20000, 120000));
    const outputLimit = Math.max(100, Math.min(Number(input.output_limit) || 50000, 50000));
    const envKeys = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "NODE_PATH"];
    const env = Object.fromEntries(envKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-outputLimit);
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
      const kill = () => {
        try {
          if (typeof terminateProcessTree === "function") terminateProcessTree(child);
          else child.kill();
        } catch { /* process may already be closed */ }
      };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      const onAbort = () => { cancelled = true; kill(); };
      context.abortSignal?.addEventListener?.("abort", onAbort, { once: true });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.abortSignal?.removeEventListener?.("abort", onAbort);
        resolve(result);
      };
      child.on("error", (error) => finish({ ok: false, code: error.code || "PROCESS_START_FAILED", error: error.message }));
      child.on("close", (exitCode, signal) => {
        const stdoutRef = persistOutput(context, stdout, "stdout");
        const stderrRef = persistOutput(context, stderr, "stderr");
        finish({
          ok: !timedOut && !cancelled && exitCode === 0,
          status: cancelled ? "cancelled" : timedOut ? "timeout" : exitCode === 0 ? "complete" : "failed",
          code: cancelled ? "OPERATION_CANCELLED" : timedOut ? "OPERATION_TIMEOUT" : exitCode === 0 ? "OK" : "COMMAND_EXIT_NONZERO",
          error: cancelled ? "Command cancelled." : timedOut ? "Command timed out." : exitCode === 0 ? "" : `Command exited with code ${exitCode}.`,
          exitCode,
          signal,
          timedOut,
          cancelled,
          stdout,
          stderr,
          artifact_refs: [stdoutRef, stderrRef].filter(Boolean),
          outputCompleteness: timedOut || cancelled ? "partial" : "complete",
        });
      });
    });
  }

  return Object.freeze({ execute: run, tokenizeCommand });
}

module.exports = { DEFAULT_EXECUTABLES, tokenizeCommand, createCommandPort };
