"use strict";

const { spawn } = require("node:child_process");
const { redactSecrets } = require("../policies/data-guardrails");
const { id } = require("../../contracts/tool/execution-context");

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?[?-??-??-??-?a-zA-Z\d])|\u001B\][^\x07]*(?:\x07|\u001B\\)/g;

const MAX_LINE_BYTES = 4096;
const MAX_TAIL_BYTES = 20000;
const MAX_RING_BYTES = 50000;
const MAX_ARTIFACT_BYTES = 20000;
const TRUNCATION_REASON = "ARTIFACT_BUDGET_EXCEEDED";

function stripAnsi(value) {
  return String(value || "").replace(ANSI_RE, "");
}

function redact(value) {
  return String(redactSecrets(stripAnsi(value)) || "");
}

function normalizeLineText(value, maxBytes = MAX_LINE_BYTES) {
  let text = redact(value);
  if (text.length > maxBytes) {
    text = `${text.slice(0, Math.max(0, maxBytes - 12))}[TRUNCATED_LINE]`;
  }
  return text;
}

/**
 * Managed process session implementing the descriptor/runtime split, atomic
 * finalization, absolute deadlines, continuation budgets, and segmented
 * redacted artifacts described in the managed-process-monitoring spec.
 *
 * Self-contained (pure Node child_process) so it can be unit-tested without
 * the Electron/PTY terminal stack.
 */
function createManagedProcessSession({
  spawnChild = spawn,
  now = Date.now,
  persistArtifact = null,   // (workspace, redactedText, meta) => artifactId | ""
  persistDescriptor = null, // (descriptor) => void
  loadDescriptor = null,    // (managedOperationId) => persistedDescriptor | null
  terminateProcessTree = null,
  continuationDecisionTimeoutMs: defaultDecisionTimeoutMs = 60000,
  maxManagedContinuationTurns: defaultMaxTurns = null,
  maxManagedContinuationTokens: defaultMaxTokens = null,
} = {}) {
  const managedProcesses = new Map(); // managed_operation_id -> session

  function nextCheckpointId(session) {
    session.descriptor.checkpointSequence = (session.descriptor.checkpointSequence || 0) + 1;
    session.descriptor.currentCheckpointId = `checkpoint-${session.descriptor.checkpointSequence}-${id("cp").slice(0, 20)}`;
    return session.descriptor.currentCheckpointId;
  }

  function ringPush(session, stream, text) {
    const chunks = String(text || "").split(/\r?\n/);
    for (const chunk of chunks) {
      if (chunk === "") continue;
      const record = { seq: session.lineSeq++, stream, text: normalizeLineText(chunk) };
      session.ring.push(record);
    }
    let bytes = session.ring.reduce((sum, item) => sum + Buffer.byteLength(item.text, "utf8"), 0);
    let head = 0;
    while (bytes > MAX_RING_BYTES && head < session.ring.length - 1) {
      bytes -= Buffer.byteLength(session.ring[head].text, "utf8");
      head += 1;
    }
    if (head > 0) session.ring = session.ring.slice(head);
  }

  function logTail(session, requested) {
    const count = Math.max(1, Math.min(Number(requested) || 20, 500));
    const available = session.ring.length;
    const take = Math.min(count, available);
    return session.ring.slice(available - take);
  }

  function persistSegmented(session, workspace, text, meta) {
    const clean = typeof text === "string" && text ? redact(text) : "";
    if (!clean) return [];
    if (!workspace || typeof persistArtifact !== "function") {
      session.uncapturedArtifacts += clean.length;
      return [];
    }
    const refs = [];
    let offset = 0;
    let segment = 0;
    while (offset < clean.length) {
      const slice = clean.slice(offset, offset + MAX_ARTIFACT_BYTES);
      const ref = persistArtifact(workspace, slice, { kind: meta.kind, managed_operation_id: session.descriptor.managedOperationId, segment, checkpoint_sequence: session.descriptor.checkpointSequence });
      if (ref) refs.push(ref);
      offset += slice.length;
      segment += 1;
    }
    return refs;
  }

  function finalizeOnce(session) {
    if (session.finalized) return false;
    session.finalized = true;
    return true;
  }

  function clearTimers(session) {
    if (session.monitorTimer) clearTimeout(session.monitorTimer);
    if (session.hardTimer) clearTimeout(session.hardTimer);
    if (session.decisionTimer) clearTimeout(session.decisionTimer);
    session.monitorTimer = null;
    session.hardTimer = null;
    session.decisionTimer = null;
  }

  function killChild(session) {
    if (!session.runtime?.child) return;
    try {
      if (typeof terminateProcessTree === "function") terminateProcessTree(session.runtime.child);
      else session.runtime.child.kill();
    } catch { /* process may already be closed */ }
  }

  function emitTerminal(session, workspace, status, code, summary, extra = {}) {
    clearTimers(session);
    const ringText = session.ring.map((item) => `${item.stream}:${item.text}`).join("\n");
    const refs = persistSegmented(session, workspace, ringText, { kind: "managed-output", managed_operation_id: session.descriptor.managedOperationId });
    const outputTruncated = session.uncapturedArtifacts > 0;
    const result = {
      ok: status === "success",
      status,
      code,
      summary,
      continuation_required: false,
      checkpoint_id: "",
      lines_available: session.ring.length,
      lines_returned: 0,
      log_lines: [],
      process_status: session.runtime?.child ? "terminated" : "exited",
      running: false,
      elapsed_ms: session.elapsedMs(),
      exit_code: session.lastExitCode,
      signal: session.lastSignal,
      artifact_refs: refs,
      evidence_refs: [...session.evidenceRefs],
      output_complete: !outputTruncated,
      output_truncated: outputTruncated,
      segment_count: refs.length,
      truncation_reason: outputTruncated ? TRUNCATION_REASON : "",
      cleanup: { attempted: true, completed: true, error: "" },
      ...extra,
    };
    for (const key of Object.keys(result)) {
      if (typeof result[key] === "function") delete result[key];
    }
    return result;
  }

  function revalidateHardGates(session, { authorizationVersion, policyVersion } = {}) {
    const nowMs = now();
    if (session.aborted || session.descriptor.status === "terminal") return { ok: false, code: "OPERATION_CANCELLED", error: "Operation is cancelled or terminal." };
    if (session.descriptor.hardDeadlineAt && nowMs >= session.descriptor.hardDeadlineAt) return { ok: false, code: "OPERATION_TIMEOUT", error: "Hard deadline reached." };
    if (session.descriptor.scopeExpiresAt && nowMs >= session.descriptor.scopeExpiresAt) return { ok: false, code: "SCOPE_DENIED", error: "Scope decision has expired." };
    if (authorizationVersion && session.descriptor.authorizationVersion && session.descriptor.authorizationVersion !== authorizationVersion) return { ok: false, code: "AUTHORIZATION_DENIED", error: "Authorization version changed." };
    if (policyVersion && session.descriptor.policyVersion && session.descriptor.policyVersion !== policyVersion) return { ok: false, code: "SCOPE_DENIED", error: "Policy version changed." };
    return { ok: true };
  }

  function consumeCheckpoint(session, checkpointId) {
    const currentSeq = session.descriptor.checkpointSequence || 0;
    const consumed = session.descriptor.lastConsumedCheckpointSequence || 0;
    if (currentSeq === 0) return { ok: false, code: "CONTROL_INVALID", error: "No checkpoint exists for this operation." };
    if (consumed >= currentSeq) return { ok: false, code: "OPERATION_RESUME_DUPLICATE", error: "This checkpoint token was already consumed or is stale." };
    if (checkpointId && checkpointId !== session.descriptor.currentCheckpointId) return { ok: false, code: "OPERATION_RESUME_DUPLICATE", error: "Checkpoint token does not match the current checkpoint." };
    session.descriptor.lastConsumedCheckpointSequence = currentSeq;
    session.descriptor.continuationTurns = (session.descriptor.continuationTurns || 0) + 1;
    return { ok: true };
  }

  function budgetExceeded(session) {
    const turns = session.descriptor.continuationTurns || 0;
    const tokens = session.descriptor.checkpointSequence || 0;
    if (session.maxTurns != null && turns > session.maxTurns) return true;
    if (session.maxTokens != null && tokens > session.maxTokens) return true;
    return false;
  }

  function armDecisionTimer(session) {
    if (session.decisionTimer) clearTimeout(session.decisionTimer);
    if (session.descriptor.status !== "awaiting_decision") return;
    const timeout = session.decisionTimeoutMs || defaultDecisionTimeoutMs || 60000;
    session.descriptor.continuationDecisionExpiresAt = Date.now() + timeout;
    session.decisionTimer = setTimeout(() => {
      if (session.descriptor.status !== "awaiting_decision") return;
      terminateFromHost({ managedOperationId: session.descriptor.managedOperationId, workspace: session.workspace, reason: { code: "MISSING_CONTINUATION_DECISION", summary: "No continuation decision arrived in time." } });
    }, timeout);
    if (session.decisionTimer.unref) session.decisionTimer.unref();
  }

  function armMonitor(session, intervalMs) {
    if (session.monitorTimer) clearTimeout(session.monitorTimer);
    const interval = Math.max(1000, Math.min(Number(intervalMs) || 30000, 600000));
    session.monitorInterval = interval;
    session.monitorTimer = setTimeout(() => {
      if (session.descriptor.status === "terminal") return;
      session.descriptor.status = "awaiting_decision";
      session.persistDescriptor();
      armDecisionTimer(session);
    }, interval);
    if (session.monitorTimer.unref) session.monitorTimer.unref();
  }

  function armHard(session) {
    if (session.hardTimer) clearTimeout(session.hardTimer);
    if (!session.descriptor.hardDeadlineAt) return;
    const remaining = Math.max(0, session.descriptor.hardDeadlineAt - Date.now());
    session.hardTimer = setTimeout(() => {
      terminateFromHost({ managedOperationId: session.descriptor.managedOperationId, workspace: session.workspace, reason: { code: "OPERATION_TIMEOUT", summary: "Hard deadline reached." } });
    }, remaining);
    if (session.hardTimer.unref) session.hardTimer.unref();
  }

  function startManagedProcess({
    managedOperationId,
    auditId,
    workspace,
    executable,
    args,
    cwd,
    env,
    monitorMs,
    hardDeadlineAt,
    scopeExpiresAt,
    continuationDecisionTimeoutMs,
    maxManagedContinuationTurns,
    maxManagedContinuationTokens,
    abortSignal,
    authorizationVersion,
    policyVersion,
    owner = {},
  }) {
    const descriptor = {
      managedOperationId: String(managedOperationId),
      auditId: String(auditId),
      executable: String(executable || ""),
      args: Array.isArray(args) ? args.map(String) : [],
      cwd: String(cwd || ""),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
      checkpointSequence: 0,
      currentCheckpointId: "",
      lastConsumedCheckpointSequence: 0,
      continuationTurns: 0,
      hardDeadlineAt: hardDeadlineAt ? Number(hardDeadlineAt) : null,
      scopeExpiresAt: scopeExpiresAt ? Number(scopeExpiresAt) : null,
      continuationDecisionExpiresAt: null,
      authorizationVersion,
      policyVersion,
      evidenceRefs: [],
      cleanup: { attempted: false, completed: false, error: "" },
      owner,
    };
    const session = {
      descriptor,
      runtime: null,
      ring: [],
      lineSeq: 1,
      evidenceRefs: [],
      uncapturedArtifacts: 0,
      finalized: false,
      aborted: false,
      lastExitCode: null,
      lastSignal: null,
      monitorInterval: 30000,
      decisionTimeoutMs: continuationDecisionTimeoutMs,
      maxTurns: maxManagedContinuationTurns != null ? Number(maxManagedContinuationTurns) : defaultMaxTurns,
      maxTokens: maxManagedContinuationTokens != null ? Number(maxManagedContinuationTokens) : defaultMaxTokens,
      workspace,
      monitorTimer: null,
      hardTimer: null,
      decisionTimer: null,
      lastCheckpointResult: null,
      elapsedMs: () => Date.now() - (descriptor.startedAt || Date.now()),
      persistDescriptor: () => { if (typeof persistDescriptor === "function") persistDescriptor(JSON.parse(JSON.stringify(descriptor))); },
    };
    managedProcesses.set(descriptor.managedOperationId, session);

    let child;
    try {
      child = spawnChild(executable, descriptor.args, {
        cwd,
        env: { ...process.env, TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0", ...(env || {}) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      managedProcesses.delete(descriptor.managedOperationId);
      return { ok: false, code: "PROCESS_START_FAILED", error: error.message };
    }

    session.runtime = { child, stdout: child.stdout, stderr: child.stderr };

    child.stdout?.on?.("data", (chunk) => ringPush(session, "stdout", chunk.toString("utf8")));
    child.stderr?.on?.("data", (chunk) => ringPush(session, "stderr", chunk.toString("utf8")));
    child.on?.("error", (error) => {
      session.lastExitCode = -1;
      session.lastSignal = error?.code || "PROCESS_START_FAILED";
      session.descriptor.status = "terminal";
      session.persistDescriptor();
    });
    child.on?.("close", (exitCode, signal) => {
      session.lastExitCode = exitCode == null ? null : exitCode;
      session.lastSignal = signal;
      session.descriptor.status = "terminal";
      if (finalizeOnce(session)) {
        session.finalResult = emitTerminal(session, session.workspace, exitCode === 0 ? "success" : "failed", exitCode === 0 ? "OK" : "PROCESS_STOPPED", exitCode === 0 ? "Process completed." : "Process exited with a non-zero code.");
      }
      session.persistDescriptor();
    });

    session.persistDescriptor();
    armMonitor(session, monitorMs);
    armHard(session);

    if (abortSignal) {
      const onAbort = () => {
        session.aborted = true;
        session.descriptor.status = "terminal";
        killChild(session);
        session.persistDescriptor();
      };
      abortSignal.addEventListener?.("abort", onAbort, { once: true });
    }

    return { ok: true, session, descriptor, managedOperationId: descriptor.managedOperationId };
  }

  function checkpointProcess(managedOperationId, { workspace, logTailLines = 20 } = {}) {
    const session = managedProcesses.get(managedOperationId);
    if (!session) return { ok: false, code: "OPERATION_NOT_FOUND", error: "Unknown managed operation." };
    if (session.descriptor.status === "terminal") return { ok: false, code: "OPERATION_ALREADY_TERMINAL", error: "Operation is terminal." };
    const checkpointId = nextCheckpointId(session);
    const requested = Math.max(1, Math.min(Number(logTailLines) || 20, 500));
    const tail = logTail(session, requested);
    const result = {
      ok: true,
      status: "partial",
      code: "PARTIAL_RESULT",
      summary: "Checkpoint: process is still running.",
      continuation_required: true,
      checkpoint_id: checkpointId,
      lines_available: session.ring.length,
      lines_returned: tail.length,
      log_lines: tail,
      process_status: "running",
      running: true,
      elapsed_ms: session.elapsedMs(),
      exit_code: null,
      signal: null,
      artifact_refs: [],
      evidence_refs: [...session.evidenceRefs],
      output_complete: true,
      output_truncated: false,
      segment_count: 0,
      truncation_reason: "",
      cleanup: { attempted: false, completed: false, error: "" },
    };
    session.lastCheckpointResult = result;
    return result;
  }

  function continueProcess(managedOperationId, { checkpointId, monitorMs, workspace, authorizationVersion, policyVersion } = {}) {
    const session = managedProcesses.get(managedOperationId);
    if (!session) return { ok: false, code: "OPERATION_NOT_FOUND", error: "Unknown managed operation." };
    const consume = consumeCheckpoint(session, checkpointId);
    if (!consume.ok) return consume;
    const gates = revalidateHardGates(session, { authorizationVersion, policyVersion });
    if (!gates.ok) { terminateFromHost({ managedOperationId, workspace, reason: gates }); return gates; }
    if (budgetExceeded(session)) {
      terminateFromHost({ managedOperationId, workspace, reason: { code: "MANAGED_CONTINUATION_BUDGET_EXCEEDED", summary: "Continuation budget exhausted." } });
      return { ok: false, code: "MANAGED_CONTINUATION_BUDGET_EXCEEDED", error: "Continuation budget exhausted." };
    }
    if (session.decisionTimer) clearTimeout(session.decisionTimer);
    session.descriptor.status = "running";
    session.persistDescriptor();
    armMonitor(session, monitorMs);
    return { ok: true, status: "running", summary: "Continuation accepted." };
  }

  function stopFromModel({ managedOperationId, checkpointId, reason, workspace }) {
    const session = managedProcesses.get(managedOperationId);
    if (!session) return { ok: false, code: "OPERATION_NOT_FOUND", error: "Unknown managed operation." };
    const consume = consumeCheckpoint(session, checkpointId);
    if (!consume.ok) return consume;
    if (!finalizeOnce(session)) return session.finalResult || emitTerminal(session, workspace, "cancelled", "OPERATION_ALREADY_TERMINAL", "Operation already terminal.");
    session.descriptor.status = "terminal";
    killChild(session);
    session.persistDescriptor();
    session.finalResult = emitTerminal(session, workspace, "cancelled", "PROCESS_STOPPED", reason || "Process stopped by the model.");
    return session.finalResult;
  }

  function terminateFromHost({ managedOperationId, reason, workspace }) {
    const session = managedProcesses.get(managedOperationId);
    if (!session) return { ok: false, code: "OPERATION_NOT_FOUND", error: "Unknown managed operation." };
    if (!finalizeOnce(session)) return session.finalResult || emitTerminal(session, workspace, "cancelled", "OPERATION_ALREADY_TERMINAL", "Operation already terminal.");
    session.aborted = true;
    session.descriptor.status = "terminal";
    killChild(session);
    session.persistDescriptor();
    session.finalResult = emitTerminal(session, workspace, "cancelled", reason?.code || "OPERATION_CANCELLED", reason?.summary || "Operation terminated by the host.");
    return session.finalResult;
  }

  function getProcessStatus(managedOperationId) {
    const session = managedProcesses.get(managedOperationId);
    if (!session) return { ok: false, code: "OPERATION_NOT_FOUND", error: "Unknown managed operation." };
    return {
      ok: true,
      status: session.descriptor.status,
      running: session.descriptor.status !== "terminal",
      elapsed_ms: session.elapsedMs(),
      checkpoint_id: session.descriptor.currentCheckpointId,
      checkpoint_sequence: session.descriptor.checkpointSequence,
      continuation_turns: session.descriptor.continuationTurns,
      exit_code: session.lastExitCode,
      signal: session.lastSignal,
    };
  }

  /**
   * Resolve a managed operation that has no live in-memory runtime but has a
   * persisted descriptor (e.g. after an unexpected application restart).
   * PID reconnection is unsafe, so the operation is reported non-recoverable
   * unless a verified external broker owns it (out of scope for this release).
   */
  function resolveUnexpectedRestart(managedOperationId, workspace) {
    const session = managedProcesses.get(managedOperationId);
    if (session) return { ok: true, recoverable: true, status: session.descriptor.status, running: session.descriptor.status !== "terminal" };
    let descriptor = null;
    if (typeof loadDescriptor === "function") descriptor = loadDescriptor(managedOperationId);
    if (!descriptor || descriptor.status === "terminal") {
      return { ok: false, code: "PROCESS_NON_RECOVERABLE", error: "No verified persistent process broker exists; the managed operation cannot resume after restart." };
    }
    const recovered = {
      ok: false,
      code: "PROCESS_NON_RECOVERABLE",
      error: "The application restarted while this managed operation was running. PID reconnection is unsafe without a verified external process broker, so the operation must be restarted.",
      managed_operation_id: managedOperationId,
      last_checkpoint_sequence: descriptor.checkpointSequence,
      continuation_turns: descriptor.continuationTurns,
      hard_deadline_at: descriptor.hardDeadlineAt,
      workspace,
    };
    return recovered;
  }

  function dispose() {
    for (const session of managedProcesses.values()) {
      clearTimers(session);
      killChild(session);
    }
    managedProcesses.clear();
  }

  return Object.freeze({
    startManagedProcess,
    checkpointProcess,
    continueProcess,
    stopFromModel,
    terminateFromHost,
    getProcessStatus,
    resolveUnexpectedRestart,
    dispose,
    managedProcesses,
  });
}

module.exports = { createManagedProcessSession, MAX_LINE_BYTES, MAX_TAIL_BYTES, MAX_RING_BYTES, MAX_ARTIFACT_BYTES };
