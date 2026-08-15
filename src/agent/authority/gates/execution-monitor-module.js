"use strict";

const { allow, gate } = require("./gate-utils.js");

function createMonitorState(invocationId, policy = {}) {
  const now = Date.now();
  return {
    invocationId,
    status: "starting",
    startedAt: now,
    lastActivityAt: now,
    lastProgressAt: now,
    lastHeartbeatAt: now,
    progressEvents: 0,
    heartbeatEvents: 0,
    childProcesses: [],
    stallCount: 0,
    observationExtensions: 0,
    softObservations: 0,
    terminationReason: "",
  };
}

async function runMonitoredExecution({ context, state, execute, signal = null, emit = () => {}, checkpoint = () => {} } = {}) {
  if (typeof execute !== "function") throw new TypeError("execute is required");
  const policy = state.timeoutPolicy || {};
  const monitor = createMonitorState(context.invocationId, policy);
  state.monitorState = monitor;
  const event = (type, metadata = {}) => {
    const value = { type, invocationId: context.invocationId, at: new Date().toISOString(), ...metadata };
    emit(value);
    checkpoint({ monitor: { ...monitor }, event: value });
    return value;
  };
  event("monitor_started", { timeoutPolicy: policy });
  monitor.status = "running";
  event("execution_started");

  let hardTimer = null;
  let startTimer = null;
  let observationTimer = null;
  let monitorController = null;
  if (typeof AbortController !== "undefined") monitorController = new AbortController();
  const cancel = (reason) => {
    if (monitor.terminationReason) return;
    monitor.terminationReason = reason;
    monitor.status = "terminating";
    event("cancellation_requested", { reason });
    monitorController?.abort(reason);
  };
  const onAbort = () => cancel("operator_cancelled");
  if (signal?.aborted) onAbort(); else signal?.addEventListener?.("abort", onAbort, { once: true });
  if (Number(policy.hardMs) > 0) hardTimer = setTimeout(() => { event("timeout_triggered", { kind: "hard", timeoutMs: policy.hardMs }); cancel("hard_timeout"); }, policy.hardMs);
  if (Number(policy.startMs) > 0) startTimer = setTimeout(() => event("start_observation_due", { elapsedMs: Date.now() - monitor.startedAt, timeoutMs: policy.startMs }), policy.startMs);

  const observe = () => {
    const idleMs = Date.now() - monitor.lastActivityAt;
    const threshold = Number(policy.idleObservationMs) || 0;
    if (threshold > 0 && idleMs >= threshold) {
      monitor.stallCount += 1;
      event("stall_detected", { idleMs, stallCount: monitor.stallCount });
      const unlimitedExtensions = policy.maxObservationExtensions === null || policy.maxObservationExtensions === undefined;
      if (policy.adaptive && (unlimitedExtensions || monitor.observationExtensions < Number(policy.maxObservationExtensions))) {
        monitor.observationExtensions += 1;
        monitor.lastActivityAt = Date.now();
        event("observation_extended", { extension: monitor.observationExtensions, extensionMs: policy.extensionMs || threshold });
      }
    }
    const softThreshold = Number(policy.softObservationMs) || 0;
    const progressIdleMs = Date.now() - monitor.lastProgressAt;
    if (softThreshold > 0 && progressIdleMs >= softThreshold) {
      monitor.softObservations += 1;
      monitor.lastProgressAt = Date.now();
      event("soft_timeout_observed", { idleMs: progressIdleMs, count: monitor.softObservations, action: "observe_only" });
    }
  };
  const observationEvery = Math.max(1_000, Math.min(Number(policy.idleObservationMs) || 60_000, 60_000));
  observationTimer = setInterval(observe, observationEvery);
  observationTimer.unref?.();

  const runtime = {
    signal: monitorController?.signal || signal,
    heartbeat(metadata = {}) {
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      monitor.lastHeartbeatAt = Date.now();
      monitor.lastActivityAt = monitor.lastHeartbeatAt;
      monitor.heartbeatEvents += 1;
      event("heartbeat", { count: monitor.heartbeatEvents, ...metadata });
    },
    progress(metadata = {}) {
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      monitor.lastActivityAt = Date.now();
      monitor.lastProgressAt = monitor.lastActivityAt;
      monitor.progressEvents += 1;
      event("progress", { count: monitor.progressEvents, ...metadata });
    },
    childProcess(metadata = {}) {
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      const child = { ...metadata, observedAt: new Date().toISOString() };
      monitor.lastProgressAt = Date.now();
      monitor.childProcesses.push(child);
      event("child_process", child);
    },
  };

  try {
    if (monitor.terminationReason) {
      monitor.status = "terminated";
      event("execution_terminated", { terminationReason: monitor.terminationReason });
      return { ok: false, aborted: true, status: "partial", error: { code: "EXECUTION_CANCELLED", message: "Execution was cancelled before the capability started.", retryable: false } };
    }
    const rawResult = await execute(runtime);
    monitor.status = monitor.terminationReason ? "terminated" : "completed";
    event(monitor.terminationReason ? "execution_terminated" : "execution_completed", { terminationReason: monitor.terminationReason });
    if (monitor.terminationReason) {
      return {
        ...(rawResult && typeof rawResult === "object" ? rawResult : {}),
        ok: false,
        aborted: true,
        status: "partial",
        error: rawResult?.error || { code: monitor.terminationReason === "hard_timeout" ? "EXECUTION_TIMEOUT" : "EXECUTION_CANCELLED", message: monitor.terminationReason === "hard_timeout" ? "Execution reached its explicit hard timeout." : "Execution was cancelled by the operator.", retryable: false },
      };
    }
    return rawResult;
  } catch (error) {
    monitor.status = "failed";
    event("execution_completed", { error: error.message, code: error.code || "EXECUTION_FAILED" });
    return { ok: false, error: { code: error.code || "EXECUTION_FAILED", message: error.message, retryable: false } };
  } finally {
    if (hardTimer) clearTimeout(hardTimer);
    if (startTimer) clearTimeout(startTimer);
    if (observationTimer) clearInterval(observationTimer);
    signal?.removeEventListener?.("abort", onAbort);
    monitor.completedAt = Date.now();
    event("monitor_completed", { status: monitor.status, elapsedMs: monitor.completedAt - monitor.startedAt });
  }
}

function createExecutionMonitorModule() {
  return gate("execution_monitor_module", ({ state }) => allow("execution_monitor_module", "Execution will run inside the adaptive lifecycle monitor.", { timeoutPolicy: state.timeoutPolicy }));
}

module.exports = { createExecutionMonitorModule, createMonitorState, runMonitoredExecution };
