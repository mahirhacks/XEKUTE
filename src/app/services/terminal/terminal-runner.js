"use strict";

const { spawn } = require("node:child_process");
const { resolveShellInvocation } = require("../../../agent/tools/process/exec-command.js");

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?[?-??-??-??-?a-zA-Z\d])|\u001B\][^\x07]*(?:\x07|\u001B\\)/g;

function sanitizeOutput(value) {
  const raw = String(value || "");
  return { value: raw.replace(ANSI_RE, ""), hadAnsi: raw !== raw.replace(ANSI_RE, "") };
}

function createAgentTerminalRunner({
  terminals,
  pty,
  resolveWorkspaceTarget,
  resolveTerminalShell,
  getShellArgs,
  takeLimited,
  toolProcesses,
  terminateProcessTree,
  resolveSecurityExecutable,
  spawnProcess = spawn,
}) {
  let agentTerminalCounter = 0;

  function nextAgentTerminalId() {
    agentTerminalCounter += 1;
    return `agent-${Date.now().toString(36)}-${agentTerminalCounter}`;
  }

  function announceAgentTerminal(webContents, sendAgentEvent, payload) {
    const event = { type: "agent_terminal", ...payload };
    if (typeof sendAgentEvent === "function") sendAgentEvent(event);
    else if (webContents && !webContents.isDestroyed()) webContents.send("agent:event", event);
  }

  function sendTerminalData(webContents, id, data) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send("terminal:data", { id, data, agent: true });
  }

  function sendTerminalExit(webContents, id, exitCode, signal) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send("terminal:exit", { id, exitCode, signal, agent: true });
  }

  function registerTerminal(webContents, id, term, meta = {}) {
    terminals.set(id, {
      pty: term,
      ownerId: webContents.id,
      agent: true,
      readOnly: true,
      buffer: "",
      ...meta,
    });
  }

  function attachBuffer(term, webContents, id, record) {
    term.onData((data) => {
      record.buffer = takeLimited(String(record.buffer || "") + data, 50000);
      record.stdout = record.buffer;
      sendTerminalData(webContents, id, data);
    });
  }

  function spawnShellSession(webContents, workspace, { sendAgentEvent, toolName = "run_command", command = "", env } = {}) {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return { error: resolved.error };

    const id = nextAgentTerminalId();
    const profile = resolveTerminalShell("");
    const shell = profile.path;
    const term = pty.spawn(shell, getShellArgs(shell), {
      name: "xterm-color",
      cwd: resolved.root,
      env: { ...process.env, TERM: "xterm-256color", ...(env || {}) },
      cols: 120,
      rows: 24,
      useConpty: process.platform === "win32",
    });

    const record = { buffer: "", command, toolName, cwd: resolved.root, running: true };
    registerTerminal(webContents, id, term, record);
    attachBuffer(term, webContents, id, record);

    announceAgentTerminal(webContents, sendAgentEvent, {
      phase: "start",
      id,
      command,
      toolName,
      cwd: resolved.root,
    });

    return { id, term, record, resolved };
  }

  function finishCommandSession(webContents, sendAgentEvent, {
    id,
    term,
    record,
    command,
    timedOut,
    exitCode,
    signal,
  }) {
    terminals.delete(id);
    sendTerminalExit(webContents, id, exitCode, signal);
    announceAgentTerminal(webContents, sendAgentEvent, {
      phase: "end",
      id,
      exitCode,
      signal,
      timedOut: Boolean(timedOut),
    });
    record.running = false;
    return {
      ok: !timedOut && exitCode === 0,
      mode: "command",
      command,
      exitCode,
      signal,
      timedOut: Boolean(timedOut),
      stdout: String(record.buffer || "").trimEnd(),
      stderr: "",
      terminalId: id,
    };
  }

  function runCommand(webContents, workspace, command, { timeoutMs = 20000, sendAgentEvent, toolName = "run_command" } = {}) {
    const text = String(command || "").trim();
    if (!text) return Promise.resolve({ error: "Empty command" });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        const session = spawnShellSession(webContents, workspace, { sendAgentEvent, toolName, command: text });
        if (session.error) {
          finish(session);
          return;
        }

        const { id, term, record } = session;
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { term.kill(); } catch { /* ignore */ }
        }, Math.max(1000, Math.min(Number(timeoutMs) || 20000, 120000)));

        term.onExit(({ exitCode, signal }) => {
          clearTimeout(timer);
          finish(finishCommandSession(webContents, sendAgentEvent, {
            id,
            term,
            record,
            command: text,
            timedOut,
            exitCode,
            signal,
          }));
        });

        setTimeout(() => {
          try { term.write(`${text}\r`); } catch { /* ignore */ }
        }, 300);
      } catch (error) {
        finish({ error: error.message, command: text });
      }
    });
  }

  function runExecutable(webContents, workspace, executable, args = [], {
    timeoutMs = 20000,
    sendAgentEvent,
    toolName = "exec_command",
    displayCommand = "",
    cwd = "",
    env = null,
    exposeTerminal = false,
    signal = null,
    onProgress = null,
    onChildProcess = null,
  } = {}) {
    const resolved = resolveWorkspaceTarget(workspace, cwd || "");
    if (resolved.error) return Promise.resolve(resolved);
    if (typeof executable !== "string" || !executable.trim() || /[\u0000\r\n]/.test(executable) || !Array.isArray(args) || args.some((value) => typeof value !== "string" || /\u0000/.test(value))) {
      return Promise.resolve({ error: "Typed adapter produced invalid process arguments", code: "PROCESS_ARGUMENT_INVALID" });
    }

    const command = displayCommand || [executable, ...args].join(" ");
    const resolvedExecutable = typeof resolveSecurityExecutable === "function"
      ? resolveSecurityExecutable(executable)
      : executable;

    return new Promise((resolve) => {
      const startedAt = Date.now();
      let timedOut = false;
      let stopped = false;
      let settled = false;
      let stdout = "";
      let stderr = "";
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        const child = spawnProcess(resolvedExecutable, args, {
          cwd: resolved.target || resolved.root,
          env: { ...process.env, ...(env && typeof env === "object" ? env : {}), TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const id = nextAgentTerminalId();
        const terminalPty = {
          write() {},
          resize() {},
          kill() {
            try { terminateProcessTree(child); } catch { try { child.kill(); } catch { /* process already exited */ } }
          },
        };
        const abortProcess = () => {
          stopped = true;
          try { terminalPty.kill(); } catch { /* process may already have exited */ }
        };
        if (signal?.aborted) abortProcess();
        else signal?.addEventListener("abort", abortProcess, { once: true });
        terminals.set(id, {
          pty: terminalPty,
          child,
          ownerId: webContents.id,
          agent: true,
          readOnly: true,
          command,
          toolName,
          cwd: resolved.target || resolved.root,
        });
        onChildProcess?.({ pid: child.pid, terminalId: id, executable: resolvedExecutable });
        if (exposeTerminal) {
          announceAgentTerminal(webContents, sendAgentEvent, {
            phase: "start", id, command, toolName, cwd: resolved.target || resolved.root,
          });
        }
        const append = (current, chunk) => takeLimited(`${current}${chunk.toString()}`, 50000);
        child.stdout?.on("data", (chunk) => {
          stdout = append(stdout, chunk);
          onProgress?.({ stream: "stdout", bytes: chunk.length || Buffer.byteLength(String(chunk)) });
          if (exposeTerminal) sendTerminalData(webContents, id, chunk.toString());
        });
        child.stderr?.on("data", (chunk) => {
          stderr = append(stderr, chunk);
          onProgress?.({ stream: "stderr", bytes: chunk.length || Buffer.byteLength(String(chunk)) });
          if (exposeTerminal) sendTerminalData(webContents, id, chunk.toString());
        });
        const requestedTimeout = Number(timeoutMs);
        const timer = requestedTimeout > 0 ? setTimeout(() => {
          timedOut = true;
          try { terminalPty.kill(); } catch { /* process may already have exited */ }
        }, Math.max(1, Math.min(requestedTimeout, 86_400_000))) : null;
        child.on("error", (error) => {
          if (settled) return;
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", abortProcess);
          terminals.delete(id);
          if (exposeTerminal) {
            sendTerminalExit(webContents, id, null, "START_FAILED");
            announceAgentTerminal(webContents, sendAgentEvent, { phase: "end", id, exitCode: null, signal: "START_FAILED", timedOut: false, terminationReason: "start_failed" });
          }
          finish({ ok: false, mode: "typed-process", executable, args, error: error.message, code: error.code || "PROCESS_START_FAILED", elapsedMs: Date.now() - startedAt });
        });
        child.on("close", (exitCode, closeSignal) => {
          if (settled) return;
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", abortProcess);
          terminals.delete(id);
          const cleanStdout = sanitizeOutput(stdout);
          const cleanStderr = sanitizeOutput(stderr);
          const terminationReason = stopped ? "stopped" : timedOut ? "timeout" : exitCode === 0 ? "completed" : closeSignal ? "signaled" : "exit_code";
          if (exposeTerminal) {
            sendTerminalExit(webContents, id, exitCode, closeSignal);
            announceAgentTerminal(webContents, sendAgentEvent, {
              phase: "end", id, exitCode, signal: closeSignal, timedOut, terminationReason,
            });
          }
          finish({
            ok: !timedOut && !stopped && exitCode === 0,
            mode: "typed-process",
            executable,
            args,
            exitCode,
            signal: closeSignal,
            timedOut,
            status: stopped ? "stopped" : timedOut ? "timeout" : exitCode === 0 ? "complete" : "failed",
            terminationReason,
            elapsedMs: Date.now() - startedAt,
            stdout: cleanStdout.value.trimEnd(),
            stderr: cleanStderr.value.trimEnd(),
            hadAnsi: cleanStdout.hadAnsi || cleanStderr.hadAnsi,
            outputCompleteness: timedOut || stopped ? "partial" : "complete",
            terminalId: id,
            processId: child.pid,
            cwd: resolved.target || resolved.root,
          });
        });
      } catch (error) {
        finish({ ok: false, error: error.message, code: error.code || "PROCESS_START_FAILED", executable, args, elapsedMs: Date.now() - startedAt });
      }
    });
  }

  function runShellCommand(webContents, workspace, command, {
    shell = "auto",
    timeoutMs = 0,
    sendAgentEvent,
    toolName = "exec_command",
    cwd = "",
    env = null,
    exposeTerminal = false,
    signal = null,
    onProgress = null,
    onChildProcess = null,
  } = {}) {
    const text = String(command || "");
    if (!text.trim() || /\u0000/.test(text)) {
      return Promise.resolve({ error: "Shell command must be a non-empty string without null characters", code: "PROCESS_ARGUMENT_INVALID" });
    }
    const invocation = resolveShellInvocation(text, shell);
    if (!invocation) return Promise.resolve({ error: `Unsupported shell: ${shell}`, code: "SHELL_NOT_SUPPORTED" });
    return runExecutable(webContents, workspace, invocation.executable, invocation.args, {
      timeoutMs,
      sendAgentEvent,
      toolName,
      displayCommand: text,
      cwd,
      env,
      exposeTerminal,
      signal,
      onProgress,
      onChildProcess,
    }).then((result) => ({
      ...result,
      mode: result?.error ? result.mode : "shell-command",
      command: text,
      shell: invocation.shell,
    }));
  }

  function startProcess(webContents, workspace, command, { sendAgentEvent, ownerId = "agent", env } = {}) {
    const text = String(command || "").trim();
    if (!text) return { error: "Empty command" };

    try {
      const session = spawnShellSession(webContents, workspace, {
        sendAgentEvent,
        toolName: "exec_command",
        command: text,
        env,
      });
      if (session.error) return session;

      const { id, term, record } = session;
      const processId = `proc-${id}`;
      record.processId = processId;
      record.id = processId;
      record.ownerId = ownerId;
      record.child = term;
      record.startedAt = Date.now();
      record.exitCode = null;
      record.signal = null;
      record.stdout = "";
      record.stderr = "";
      toolProcesses.set(processId, record);

      term.onExit(({ exitCode, signal }) => {
        record.running = false;
        record.exitCode = exitCode;
        record.signal = signal;
        terminals.delete(id);
        sendTerminalExit(webContents, id, exitCode, signal);
        announceAgentTerminal(webContents, sendAgentEvent, {
          phase: "end",
          id,
          exitCode,
          signal,
          timedOut: false,
        });
        // traffsucker subagents run for hours and the agent must be able to query
        // their outcome; never evict long-lived subagent processes.
        const evictable = ownerId !== "traffsucker";
        if (!evictable) return;
        const eviction = setTimeout(() => {
          if (toolProcesses.get(processId) === record && !record.running) toolProcesses.delete(processId);
        }, 10 * 60 * 1000);
        eviction.unref?.();
      });

      setTimeout(() => {
        try { term.write(`${text}\r`); } catch { /* ignore */ }
      }, 300);

      return { ok: true, mode: "process_start", id: processId, terminalId: id, command: text };
    } catch (error) {
      return { error: error.message };
    }
  }

  function stopProcess(id, ownerId = "agent") {
    const record = toolProcesses.get(id);
    if (!record) return { error: `Unknown process: ${id}` };
    if (record.ownerId !== ownerId) return { error: "Process is not owned by this caller", code: "PROCESS_NOT_OWNED" };
    if (record.running && record.child) {
      try { record.child.kill(); } catch { /* ignore */ }
      if (record.processId) {
        const terminalId = String(record.processId).replace(/^proc-/, "");
        const terminalRecord = terminals.get(terminalId);
        if (terminalRecord?.pty) {
          try { terminalRecord.pty.kill(); } catch { /* ignore */ }
          terminals.delete(terminalId);
        }
      }
      record.running = false;
    } else if (record.running && record.child && !record.processId) {
      terminateProcessTree(record.child);
      record.running = false;
    }
    return {
      ok: true,
      id: record.id || id,
      command: record.command,
      running: record.running,
      exitCode: record.exitCode,
      signal: record.signal,
      seconds: Number(((Date.now() - (record.startedAt || Date.now())) / 1000).toFixed(1)),
      stdout: String(record.stdout || record.buffer || "").trimEnd(),
      stderr: String(record.stderr || "").trimEnd(),
    };
  }

  return {
    runCommand,
    runExecutable,
    runShellCommand,
    startProcess,
    stopProcess,
  };
}

module.exports = { createAgentTerminalRunner };
