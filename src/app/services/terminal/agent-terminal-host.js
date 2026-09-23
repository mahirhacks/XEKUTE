"use strict";

const revealDefaults = require("./agent-terminal-reveal.js");
const { appendTerminalOutput } = require("./active-terminal-catalog.js");
const { createTerminalOutputBatcher } = require("./terminal-output-batcher.js");

function createAgentTerminalHost({
  webContents,
  sendAgentEvent,
  sessionId = "",
  durableProcessManager,
  terminals,
  createHiddenCommandReveal = revealDefaults.createHiddenCommandReveal,
  HIDDEN_COMMAND_REVEAL_MS = revealDefaults.HIDDEN_COMMAND_REVEAL_MS,
  displayExecCommand,
  agentTerminalRunner,
} = {}) {
  if (!webContents) return null;
  let supervisedTerminalCounter = 0;
  function nextSupervisedTerminalId() {
    supervisedTerminalCounter += 1;
    return `agent-${Date.now().toString(36)}-supervised-${supervisedTerminalCounter}`;
  }
  function sendTerminalData(id, data) {
    if (!webContents || webContents.isDestroyed() || !data) return;
    webContents.send("terminal:data", { id, data: String(data), agent: true });
  }
  function unavailable() {
    return { ok: false, error: { code: "DURABLE_PROCESS_PROVIDER_UNAVAILABLE", message: "Durable process management is unavailable.", retryable: false } };
  }
  function delegate(operation, workspace, input, runtime) {
    if (!durableProcessManager || typeof durableProcessManager[operation] !== "function") return Promise.resolve(unavailable());
    return durableProcessManager[operation](workspace, input, runtime);
  }
  function createSupervisedTerminal(workspace, input, runtime = {}) {
    const manager = durableProcessManager;
    const terminalId = nextSupervisedTerminalId();
    const wantVisible = input.show_in_terminal !== false;
    const command = typeof input.command === "string"
      ? input.command
      : displayExecCommand(input.executable, Array.isArray(input.args) ? input.args : []);
    const commandCallId = String(runtime.commandCallId || "");
    const commandInvocationId = String(runtime.commandInvocationId || "");
    let processId = "";
    let closing = false;
    const reveal = createHiddenCommandReveal({ delayMs: HIDDEN_COMMAND_REVEAL_MS });
    const record = {
      ownerId: webContents.id,
      agent: true,
      supervised: true,
      readOnly: true,
      hidden: !wantVisible,
      processId: "",
      waiting: false,
      command,
      commandCallId,
      commandInvocationId,
      toolName: "exec_command",
      cwd: input.cwd || workspace,
      sessionId,
      outputTail: "",
      exited: false,
      pty: {
        write() {},
        resize() {},
        kill: () => {
          if (closing) return Promise.resolve({ ok: true, status: "stopped" });
          if (!processId) {
            record.stopRequested = true;
            return Promise.resolve({ ok: true, pending: true, status: "stopping" });
          }
          return manager.stop(workspace, { process_id: processId, reason: "user_requested" });
        },
      },
    };
    terminals.set(terminalId, record);
    const outputBatch = createTerminalOutputBatcher((data) => sendTerminalData(terminalId, data));
    const announce = (phase, extra = {}) => {
      sendAgentEvent?.({
        type: "agent_terminal",
        phase,
        id: terminalId,
        terminalId,
        processId: processId || "",
        commandCallId,
        commandInvocationId,
        command,
        toolName: "exec_command",
        cwd: record.cwd,
        sessionId,
        ...extra,
      });
    };
    const revealToUi = ({ replay = [] } = {}) => {
      record.hidden = false;
      announce("start");
      if (processId) announce("started", { pid: record.pid });
      for (const chunk of replay) outputBatch.push(chunk);
      outputBatch.flush();
    };
    reveal.start({ wantVisible, onReveal: revealToUi });
    const supervisedRuntime = {
      ...runtime,
      terminalId,
      sessionId,
      onStarted: (started) => {
        processId = String(started?.processId || "");
        record.processId = processId;
        record.pid = started?.pid;
        if (reveal.isRevealed()) announce("started", { pid: started?.pid });
        runtime.onStarted?.(started);
        if (record.stopRequested && processId) manager.stop(workspace, { process_id: processId, reason: "user_requested" }).catch(() => {});
      },
      onOutput: (payload) => {
        appendTerminalOutput(record, payload?.data);
        const decision = reveal.pushOutput(payload?.data);
        if (decision.live) outputBatch.push(payload?.data);
        runtime.onOutput?.(payload);
      },
      onDetached: (payload) => {
        record.waiting = true;
        runtime.onDetached?.(payload);
      },
      onHealth: (payload) => {
        sendAgentEvent?.({ ...payload, terminalId, processId: payload?.processId || processId, commandCallId, commandInvocationId, sessionId });
        runtime.onHealth?.(payload);
      },
      onReview: (payload) => {
        sendAgentEvent?.({ type: "terminal_checkpoint", ...payload, terminalId, processId: payload?.processId || processId, commandCallId, commandInvocationId, sessionId });
        runtime.onReview?.(payload);
      },
      onComplete: (payload) => {
        closing = true;
        outputBatch.flush();
        const waiting = Boolean(record.waiting);
        const { revealed } = reveal.complete();
        record.exited = true;
        record.exitCode = payload?.exitCode ?? null;
        record.signal = payload?.signal || null;
        if (revealed && !webContents.isDestroyed()) webContents.send("terminal:exit", { id: terminalId, exitCode: payload?.exitCode ?? null, signal: payload?.signal || null, agent: true, processId: payload?.processId || processId, waiting });
        if (revealed) announce("end", { exitCode: payload?.exitCode ?? null, signal: payload?.signal || null, status: payload?.status, terminationReason: payload?.terminationReason, waiting });
        sendAgentEvent?.({ type: "terminal_complete", ...payload, terminalId, processId: payload?.processId || processId, commandCallId, commandInvocationId, command, waiting, sessionId });
        if (!revealed) terminals.delete(terminalId);
        runtime.onComplete?.(payload);
      },
    };
    return { terminalId, wantVisible, reveal, record, runtime: supervisedRuntime, getProcessId: () => processId };
  }
  async function runSupervisedUnqueued(workspace, input, runtime = {}) {
    const manager = durableProcessManager;
    if (!manager) return unavailable();
    const terminal = createSupervisedTerminal(workspace, input, runtime);
    const operation = String(input.operation || "run");
    if (operation !== "run") terminal.record.waiting = true;
    const result = operation === "run"
      ? await manager.run(workspace, input, terminal.runtime)
      : await manager.start(workspace, input, terminal.runtime);
    const revealed = terminal.reveal.isRevealed();
    if (result?.ok === false && !terminal.getProcessId()) terminals.delete(terminal.terminalId);
    if (result?.value && revealed && !result.value.terminalId) result.value.terminalId = terminal.terminalId;
    if (result?.value && !revealed) delete result.value.terminalId;
    if (result?.value) result.value.showInTerminal = revealed;
    if (result?.value && !result.value.processId) result.value.processId = terminal.getProcessId();
    return result;
  }
  async function run(workspace, input = {}, runtime = {}) {
    return runSupervisedUnqueued(workspace, { ...input, operation: "run" }, runtime);
  }
  async function start(workspace, input = {}, runtime = {}) {
    return runSupervisedUnqueued(workspace, { ...input, operation: "start" }, runtime);
  }
  return {
    run,
    start,
    status: (workspace, input, runtime) => delegate("status", workspace, input, runtime),
    stop: (workspace, input, runtime) => delegate("stop", workspace, input, runtime),
    list: (workspace, input, runtime) => delegate("list", workspace, input, runtime),
    runCommand: (workspace, command, options = {}) => agentTerminalRunner.runCommand(webContents, workspace, command, { ...options, sendAgentEvent }),
    runExecutable: (workspace, executable, args, options = {}) => agentTerminalRunner.runExecutable(webContents, workspace, executable, args, { ...options, sendAgentEvent }),
    runShellCommand: (workspace, command, options = {}) => agentTerminalRunner.runShellCommand(webContents, workspace, command, { ...options, sendAgentEvent }),
    sendLifecycleEvent: (payload) => sendAgentEvent?.({ type: "tool_lifecycle", ...payload }),
    startProcess: (workspace, command, options = {}) => agentTerminalRunner.startProcess(webContents, workspace, command, {
      ...options,
      sendAgentEvent,
      ownerId: options.ownerId || webContents.id,
    }),
    stopProcess: (id, ownerId) => agentTerminalRunner.stopProcess(id, ownerId ?? webContents.id),
  };
}

module.exports = { createAgentTerminalHost };
