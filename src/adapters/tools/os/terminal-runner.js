"use strict";

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
    toolName = "run_security_tool",
    displayCommand = "",
  } = {}) {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return Promise.resolve(resolved);
    if (!/^[a-z0-9_.-]+$/i.test(String(executable || "")) || !Array.isArray(args) || args.some((value) => typeof value !== "string" || /[\u0000\r\n]/.test(value))) {
      return Promise.resolve({ error: "Typed adapter produced invalid process arguments", code: "PROCESS_ARGUMENT_INVALID" });
    }

    const command = displayCommand || [executable, ...args].join(" ");

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        const id = nextAgentTerminalId();
        const resolvedExecutable = typeof resolveSecurityExecutable === "function"
          ? resolveSecurityExecutable(executable)
          : executable;
        const term = pty.spawn(resolvedExecutable, args, {
          name: "xterm-color",
          cwd: resolved.root,
          env: { ...process.env, TERM: "xterm-256color" },
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

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { term.kill(); } catch { /* ignore */ }
        }, Math.max(1000, Math.min(Number(timeoutMs) || 20000, 120000)));

        term.onExit(({ exitCode, signal }) => {
          clearTimeout(timer);
          finish({
            ...finishCommandSession(webContents, sendAgentEvent, {
              id,
              term,
              record,
              command,
              timedOut,
              exitCode,
              signal,
            }),
            mode: "typed-process",
            executable,
            args,
          });
        });
      } catch (error) {
        finish({ ok: false, error: error.message, code: error.code || "PROCESS_START_FAILED", executable, args });
      }
    });
  }

  function startProcess(webContents, workspace, command, { sendAgentEvent, ownerId = "agent", env } = {}) {
    const text = String(command || "").trim();
    if (!text) return { error: "Empty command" };

    try {
      const session = spawnShellSession(webContents, workspace, {
        sendAgentEvent,
        toolName: "start_process",
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
    startProcess,
    stopProcess,
  };
}

module.exports = { createAgentTerminalRunner };
