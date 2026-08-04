"use strict";

// Background wait registry for terminal commands and long-lived subagents.
//
// Flow:
//   1. Agent tool starts a process and returns *_wait (agent turn ends).
//   2. This runner polls the process.
//   3. When waitMs elapses while still running, emit *_checkpoint with the
//      current terminal log so the AI can monitor progress (does not kill).
//   4. When the process exits, emit *_complete with the final transcript.
//   5. UI shows live "waiting XmYs" and final "waited XmYs".

function createBackgroundWaitRunner({ toolProcesses, onComplete, onEvent, killProcess } = {}) {
  const waits = new Map();
  let waitCounter = 0;
  const emit = typeof onEvent === "function" ? onEvent : onComplete;

  function nextWaitId(prefix = "wait") {
    waitCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${waitCounter}`;
  }

  function processRecord(processId) {
    return processId ? toolProcesses?.get?.(processId) : null;
  }

  function isFinished(proc) {
    if (!proc) return true;
    if (proc.exitCode !== null && proc.exitCode !== undefined) return true;
    return proc.running === false;
  }

  function computeStatus(record, proc) {
    if (record.timedOut && isFinished(proc)) return "timeout";
    if (proc?.signal === "SIGTERM" || proc?.signal === "SIGKILL") return "stopped";
    if (proc?.timedOut) return "timeout";
    if (proc && proc.exitCode !== null && proc.exitCode !== undefined && proc.exitCode !== 0) return "failed";
    if (!proc) return "failed";
    if (!isFinished(proc)) return "running";
    return "complete";
  }

  function elapsedMsFor(record, at = Date.now()) {
    return Math.max(0, at - (record.startedMs || Date.parse(record.startedAt) || at));
  }

  function snapshot(record, proc, eventType) {
    const stdout = String(proc?.stdout || proc?.buffer || "").slice(-12000);
    const stderr = String(proc?.stderr || "").slice(-4000);
    const elapsedMs = elapsedMsFor(record);
    const baseType = record.kind === "subagent" ? "subagent" : "terminal";
    return {
      type: eventType || (record.kind === "subagent" ? "subagent_complete" : "terminal_complete"),
      kind: record.kind,
      waitId: record.waitId,
      subagentId: record.subagentId || "",
      processId: record.processId || "",
      terminalId: record.terminalId || "",
      toolName: record.toolName || "",
      command: record.command || "",
      target: record.target || "",
      model: record.model || "",
      outputDir: record.outputDir || "",
      configPath: record.configPath || "",
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      waitMs: record.waitMs,
      elapsedMs,
      timedOut: Boolean(record.timedOut),
      checkpoint: Boolean(record.checkpointed && eventType?.includes("checkpoint")),
      checkpointCount: record.checkpointCount || 0,
      stillRunning: !isFinished(proc),
      exitCode: proc?.exitCode ?? null,
      signal: proc?.signal ?? null,
      stdout,
      stderr,
      eventBase: baseType,
    };
  }

  function deliver(record, payload) {
    if (!record.notified && typeof record.notify === "function" && !String(payload.type || "").includes("checkpoint")) {
      record.notified = true;
      try { record.notify(payload); } catch { /* ignore */ }
    }
    if (typeof emit === "function") {
      try { emit(payload); } catch { /* ignore */ }
    }
  }

  function emitCheckpoint(record, proc) {
    record.checkpointed = true;
    record.checkpointCount = (record.checkpointCount || 0) + 1;
    record.status = "running";
    const payload = snapshot(record, proc, record.kind === "subagent" ? "subagent_checkpoint" : "terminal_checkpoint");
    deliver(record, payload);
  }

  function finalize(record, proc) {
    if (!waits.has(record.waitId)) return;
    if (record.finalized) return;
    record.finalized = true;
    const status = computeStatus(record, proc);
    record.status = status === "running" ? "complete" : status;
    record.completedAt = new Date().toISOString();
    record.exitCode = proc?.exitCode ?? null;
    record.signal = proc?.signal ?? null;
    const done = snapshot(record, proc, record.kind === "subagent" ? "subagent_complete" : "terminal_complete");
    deliver(record, done);
    setTimeout(() => {
      waits.delete(record.waitId);
    }, 10 * 60 * 1000).unref?.();
  }

  function watch(record) {
    const started = record.startedMs || Date.now();
    record.startedMs = started;
    const interval = record.checkpointIntervalMs;
    const budget = Number(record.waitMs) > 0 ? Number(record.waitMs) : 0;
    record.nextCheckpointAt = Math.max(interval, budget || interval);
    const poll = () => {
      if (!waits.has(record.waitId) || record.finalized) return;
      const proc = processRecord(record.processId);
      const finished = isFinished(proc);
      const elapsed = Date.now() - started;

      if (finished) {
        finalize(record, processRecord(record.processId) || proc);
        return;
      }

      // Hard-kill escape hatch (legacy): waitMs budget + killOnTimeout means
      // "wait up to waitMs, then kill". Production callers pass killOnTimeout:
      // false and rely on periodic checkpoints instead.
      if (record.killOnTimeout && budget > 0 && elapsed >= budget) {
        record.timedOut = true;
        try { killProcess?.(record.processId, record.ownerId); } catch { /* ignore */ }
        finalize(record, processRecord(record.processId) || proc);
        return;
      }

      // Periodic checkpoints while the process is still running.
      if (interval > 0 && elapsed >= record.nextCheckpointAt) {
        emitCheckpoint(record, proc);
        record.nextCheckpointAt = (Math.floor(elapsed / interval) + 1) * interval;
      }

      // Poll frequently enough to honor small checkpoint intervals, but not so
      // fast that a quiet wait burns CPU.
      const delay = interval > 0 ? Math.min(250, Math.max(50, Math.floor(interval / 2))) : 1000;
      const timer = setTimeout(poll, delay);
      timer.unref?.();
    };
    const timer = setTimeout(poll, 100);
    timer.unref?.();
    poll();
  }

  function registerWait({
    kind = "terminal",
    processId,
    terminalId = "",
    toolName = "",
    command = "",
    waitMs = 0,
    killOnTimeout = false,
    ownerId = "agent",
    notify = null,
    subagentId = "",
    target = "",
    model = "",
    outputDir = "",
    configPath = "",
    workspace = null,
    checkpointIntervalMs = 0,
  } = {}) {
    const waitId = nextWaitId(kind === "subagent" ? "ts" : "term");
    const record = {
      waitId,
      kind: kind === "subagent" ? "subagent" : "terminal",
      subagentId: subagentId || (kind === "subagent" ? waitId : ""),
      processId: String(processId || ""),
      terminalId: String(terminalId || ""),
      toolName: String(toolName || ""),
      command: String(command || ""),
      target: String(target || ""),
      model: String(model || ""),
      outputDir: String(outputDir || ""),
      configPath: String(configPath || ""),
      workspace,
      waitMs: Number.isFinite(Number(waitMs)) ? Math.max(0, Math.round(Number(waitMs))) : 0,
      checkpointIntervalMs: Number.isFinite(Number(checkpointIntervalMs)) ? Math.max(0, Math.round(Number(checkpointIntervalMs))) : 0,
      killOnTimeout: killOnTimeout === true,
      ownerId: String(ownerId || "agent"),
      status: "running",
      startedAt: new Date().toISOString(),
      startedMs: Date.now(),
      completedAt: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      checkpointed: false,
      checkpointCount: 0,
      finalized: false,
      notified: false,
      notify,
    };
    waits.set(waitId, record);
    watch(record);
    return {
      waitId,
      subagentId: record.subagentId,
      record,
    };
  }

  // Traffsucker-compatible API.
  function registerRun(input = {}) {
    return registerWait({
      ...input,
      kind: "subagent",
      toolName: input.toolName || "run_traffsucker",
      killOnTimeout: false,
      waitMs: input.waitMs || 0,
    });
  }

  function getRun(id) {
    const record = [...waits.values()].find((item) => item.waitId === id || item.subagentId === id);
    if (!record) return null;
    return snapshot(record, processRecord(record.processId));
  }

  function listRuns() {
    return [...waits.values()].map((record) => ({
      waitId: record.waitId,
      subagentId: record.subagentId,
      kind: record.kind,
      status: record.status,
      target: record.target,
      command: record.command,
      outputDir: record.outputDir,
      processId: record.processId,
      terminalId: record.terminalId,
      elapsedMs: elapsedMsFor(record),
      waitMs: record.waitMs,
      checkpointed: record.checkpointed,
    }));
  }

  return {
    registerWait,
    registerRun,
    getRun,
    listRuns,
    nextSubagentId: () => nextWaitId("ts"),
  };
}

// Backward-compatible export name used by main/traffsucker.
function createSubagentRunner(options) {
  return createBackgroundWaitRunner(options);
}

module.exports = {
  createBackgroundWaitRunner,
  createSubagentRunner,
};
