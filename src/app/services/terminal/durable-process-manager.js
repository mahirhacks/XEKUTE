"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveShellInvocation } = require("../../../agent/tools/process/exec-command.js");
const { MAX_COMMAND_SLOTS, queueRejectionResult } = require("../../../agent/tools/process/command-queue.js");
const { redactSecrets } = require("../../../shared/secret-redaction.js");
const { sampleProcessTree } = require("./process-tree-sampler.js");

const DEFAULT_MONITOR_INTERVAL_MS = 30_000;
const DEFAULT_OUTPUT_POLL_MS = 250;
const DEFAULT_REVIEW_INTERVAL_MS = 15 * 60 * 1000;
const MAX_STREAM_CHUNK = 50_000;

function createDurableProcessManager({
  fsImpl = fs,
  pathImpl = path,
  spawnProcess = spawn,
  resolveWorkspaceTarget,
  resolveExecutable = (value) => value,
  terminateProcessTree = async (child) => { child?.kill?.(); },
  now = () => new Date(),
  sampleTree = sampleProcessTree,
  monitorIntervalMs = DEFAULT_MONITOR_INTERVAL_MS,
  outputPollMs = DEFAULT_OUTPUT_POLL_MS,
  reviewIntervalMs = DEFAULT_REVIEW_INTERVAL_MS,
  cpuCount = Math.max(1, os.cpus?.().length || 1),
} = {}) {
  const live = new Map();
  const records = new Map();
  const pendingSlots = new Map();

  function rootFor(workspace) {
    const digest = crypto.createHash("sha256").update(pathImpl.resolve(workspace)).digest("hex").slice(0, 16);
    return pathImpl.join(os.tmpdir(), "xekute-processes", digest);
  }
  function recordKey(workspace, id) { return `${pathImpl.resolve(workspace)}::${id}`; }
  function writeRecord(workspace, record) { records.set(recordKey(workspace, record.id), record); }
  function readRecord(workspace, id) {
    return records.get(recordKey(workspace, id)) || live.get(id)?.record || null;
  }
  function isAlive(pid) {
    if (!Number(pid)) return false;
    try { process.kill(Number(pid), 0); return true; } catch { return false; }
  }
  function fileSize(file) {
    try { return fsImpl.statSync(file).size; } catch { return 0; }
  }
  function tail(file, maxChars) {
    if (!maxChars) return "";
    try {
      const stat = fsImpl.statSync(file);
      const bytes = Math.min(stat.size, Math.max(maxChars * 4, maxChars));
      const fd = fsImpl.openSync(file, "r");
      const buffer = Buffer.alloc(bytes);
      fsImpl.readSync(fd, buffer, 0, bytes, Math.max(0, stat.size - bytes));
      fsImpl.closeSync(fd);
      return buffer.toString("utf8").slice(-maxChars);
    } catch { return ""; }
  }
  function readFrom(file, offset, maxChars) {
    if (!maxChars) return { text: "", nextOffset: fileSize(file), truncated: false };
    try {
      const stat = fsImpl.statSync(file);
      const start = Math.max(0, Math.min(Number(offset) || 0, stat.size));
      const available = Math.max(0, stat.size - start);
      // Keep the cursor aligned with the bytes actually delivered. Using a
      // character-to-byte multiplier here would skip unread output whenever a
      // command emits a burst larger than the UI chunk budget.
      const maxBytes = Math.max(1, maxChars);
      const bytes = Math.min(available, maxBytes);
      const fd = fsImpl.openSync(file, "r");
      const buffer = Buffer.alloc(bytes);
      fsImpl.readSync(fd, buffer, 0, bytes, start);
      fsImpl.closeSync(fd);
      return { text: buffer.toString("utf8").slice(0, maxChars), nextOffset: start + bytes, truncated: available > bytes };
    } catch { return { text: "", nextOffset: Number(offset) || 0, truncated: false }; }
  }
  function fileExists(file) {
    if (!file) return false;
    try { return Boolean(fsImpl.existsSync(file)); } catch { return false; }
  }
  function sliceRetained(tail, offset, maxChars) {
    const text = String(tail || "");
    const buf = Buffer.from(text, "utf8");
    if (!maxChars) return { text: "", nextOffset: buf.byteLength, truncated: false };
    if (offset === undefined) {
      return { text, nextOffset: buf.byteLength, truncated: false };
    }
    const start = Math.max(0, Number(offset) || 0);
    if (start >= buf.byteLength) return { text: "", nextOffset: buf.byteLength, truncated: false };
    const slice = buf.subarray(start, start + maxChars);
    return {
      text: slice.toString("utf8"),
      nextOffset: start + slice.byteLength,
      truncated: buf.byteLength - start > slice.byteLength,
    };
  }
  function invocation(input) {
    if (typeof input.command === "string") return resolveShellInvocation(input.command, input.shell || "auto");
    return { shell: null, executable: input.executable, args: Array.isArray(input.args) ? input.args : [] };
  }
  function resolveLogPath(workspace, stored) {
    if (!stored) return "";
    return pathImpl.isAbsolute(stored) ? stored : pathImpl.join(workspace, stored);
  }
  function pathsFor(workspace, record) {
    return { stdoutFile: resolveLogPath(workspace, record.stdoutFile), stderrFile: resolveLogPath(workspace, record.stderrFile) };
  }
  function currentAlive(entry, record) {
    if (entry?.tree?.alive !== undefined) return Boolean(entry.tree.alive);
    return record.status === "running" && isAlive(record.pid);
  }
  function formatMetrics(entry, record) {
    const health = entry?.health || record.health || null;
    return health ? {
      state: health.state,
      active: Boolean(health.active),
      quiet: Boolean(health.quiet),
      stalled: false,
      cpuPercent: Number(health.cpuPercent) || 0,
      rssBytes: Number(health.rssBytes) || 0,
      processCount: Number(health.processCount) || 0,
      pids: Array.isArray(health.pids) ? health.pids : [],
      quietForMs: Number(health.quietForMs) || 0,
      sampledAt: health.sampledAt || null,
      note: health.note || "Quiet output is not by itself evidence that the process is stuck.",
    } : null;
  }
  function projectMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") return metrics;
    const { pids, ...rest } = metrics;
    return rest;
  }
  function projectAgentFacing(value) {
    if (!value || typeof value !== "object") return value;
    const projected = { ...value };
    delete projected.pid;
    delete projected.stdoutFile;
    delete projected.stderrFile;
    delete projected.foregroundWaitMs;
    delete projected.foreground_wait_ms;
    delete projected.logsUnlinked;
    delete projected.retainedStdout;
    delete projected.retainedStderr;
    if (projected.metrics) projected.metrics = projectMetrics(projected.metrics);
    if (projected.health && typeof projected.health === "object") projected.health = projectMetrics(projected.health);
    if (!projected.processId && projected.id) projected.processId = projected.id;
    return projected;
  }
  function projectResult(result) {
    if (!result?.value) return result;
    return { ...result, value: projectAgentFacing({ ...result.value }) };
  }
  function listInternal(workspace, sessionId = "") {
    const prefix = `${pathImpl.resolve(workspace)}::`;
    const wantSession = String(sessionId || "").trim();
    const listed = [];
    for (const [key, record] of records) {
      if (!key.startsWith(prefix)) continue;
      if (wantSession && String(record.sessionId || "") !== wantSession) continue;
      listed.push(record);
    }
    return listed.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 200);
  }
  function snapshot(workspace, record, input = {}, entry = live.get(record.id)) {
    const { stdoutFile, stderrFile } = pathsFor(workspace, record);
    const max = input.tail_chars === undefined ? 50_000 : Math.max(0, Number(input.tail_chars) || 0);
    const stderrLimit = Math.min(max, 20_000);
    const logsUnlinked = Boolean(record.logsUnlinked);
    const stdoutMissing = logsUnlinked || !fileExists(stdoutFile);
    const stderrMissing = logsUnlinked || !fileExists(stderrFile);
    const stdoutRead = stdoutMissing
      ? (input.stdout_offset === undefined
        ? sliceRetained(record.stdout, undefined, max)
        : sliceRetained(record.stdout, input.stdout_offset, max))
      : (input.stdout_offset === undefined
        ? { text: tail(stdoutFile, max), nextOffset: fileSize(stdoutFile), truncated: fileSize(stdoutFile) > Math.max(max * 4, max) }
        : readFrom(stdoutFile, input.stdout_offset, max));
    const stderrRead = stderrMissing
      ? (input.stderr_offset === undefined
        ? sliceRetained(record.stderr, undefined, stderrLimit)
        : sliceRetained(record.stderr, input.stderr_offset, stderrLimit))
      : (input.stderr_offset === undefined
        ? { text: tail(stderrFile, stderrLimit), nextOffset: fileSize(stderrFile), truncated: fileSize(stderrFile) > Math.max(stderrLimit * 4, stderrLimit) }
        : readFrom(stderrFile, input.stderr_offset, stderrLimit));
    const alive = currentAlive(entry, record);
    const changed = Boolean(entry?.outputChanged) || stdoutRead.nextOffset > (Number(input.stdout_offset) || 0) || stderrRead.nextOffset > (Number(input.stderr_offset) || 0);
    const quietForMs = Math.max(0, Date.now() - new Date(record.lastOutputAt || record.startedAt || 0).getTime());
    const health = formatMetrics(entry, record);
    return {
      ...record,
      alive,
      stdout: stdoutRead.text,
      stderr: stderrRead.text,
      cursor: { stdoutOffset: stdoutRead.nextOffset, stderrOffset: stderrRead.nextOffset },
      nextStatusArguments: { process_id: record.id, stdout_offset: stdoutRead.nextOffset, stderr_offset: stderrRead.nextOffset },
      outputTruncated: { stdout: stdoutRead.truncated, stderr: stderrRead.truncated },
      metrics: health,
      observation: {
        changed,
        timedOut: false,
        waitedMs: Number(input.waited_ms) || 0,
        state: alive ? (health?.state || (changed ? "progressing" : "quiet")) : "finished",
        quietForMs,
        note: alive && !changed ? "Quiet output is not by itself evidence that the process is stuck." : "",
      },
      outputCompleteness: alive ? "partial" : "complete",
    };
  }
  function emit(runtime, payload) {
    try { runtime?.onEvent?.(payload); } catch { /* lifecycle observers are best effort */ }
  }
  function persist(entry) {
    try { writeRecord(entry.workspace, entry.record); } catch { /* a closed workspace should not kill the process */ }
  }
  function pollOutput(entry) {
    if (entry.finished && entry.outputFlushed) return;
    const { stdoutFile, stderrFile } = pathsFor(entry.workspace, entry.record);
    const streams = [["stdout", stdoutFile, "stdoutOffset"], ["stderr", stderrFile, "stderrOffset"]];
    let changed = false;
    for (const [stream, file, offsetKey] of streams) {
      const read = readFrom(file, entry[offsetKey], MAX_STREAM_CHUNK);
      entry[offsetKey] = read.nextOffset;
      if (!read.text) continue;
      changed = true;
      entry.record.lastOutputAt = now().toISOString();
      entry.record.updatedAt = entry.record.lastOutputAt;
      try { entry.runtime?.onOutput?.({ processId: entry.record.id, terminalId: entry.record.terminalId || "", stream, data: read.text, bytes: Buffer.byteLength(read.text) }); } catch { /* UI may be gone */ }
      entry.runtime?.progress?.({ kind: "durable_process_output", processId: entry.record.id, stream, bytes: Buffer.byteLength(read.text) });
      emit(entry.runtime, { type: "terminal_output", processId: entry.record.id, terminalId: entry.record.terminalId || "", stream, data: read.text });
    }
    entry.outputChanged = changed;
    if (entry.finished) entry.outputFlushed = true;
    if (changed) persist(entry);
  }
  async function sampleHealth(entry) {
    if (entry.finished) return;
    let tree;
    try { tree = await sampleTree(entry.record.pid, { fsImpl, platform: process.platform }); }
    catch { tree = { rootPid: entry.record.pid, pids: [], processes: [], alive: isAlive(entry.record.pid), cpuTimeMs: 0, rssBytes: 0, source: "fallback" }; }
    if (entry.finished) return;
    const sampledAt = Date.now();
    const previous = entry.tree;
    const elapsed = Math.max(1, sampledAt - (entry.lastSampleAt || sampledAt - Number(monitorIntervalMs) || 1));
    const cpuDelta = Math.max(0, Number(tree.cpuTimeMs || 0) - Number(previous?.cpuTimeMs || 0));
    const cpuPercent = Math.max(0, Math.min(100 * Math.max(1, Number(cpuCount) || 1), (cpuDelta / elapsed) * 100 / Math.max(1, Number(cpuCount) || 1)));
    const pidsChanged = Boolean(previous) && JSON.stringify(previous.pids || []) !== JSON.stringify(tree.pids || []);
    const rssChanged = Boolean(previous) && Number(previous.rssBytes || 0) !== Number(tree.rssBytes || 0);
    const outputChanged = Boolean(entry.outputChanged);
    const alive = Boolean(tree.alive);
    const active = alive && (outputChanged || cpuDelta > 0 || pidsChanged || rssChanged);
    const quietForMs = Math.max(0, Date.now() - new Date(entry.record.lastOutputAt || entry.record.startedAt || 0).getTime());
    const state = alive ? (active ? "active" : "quiet") : "finished";
    const health = {
      state,
      active,
      quiet: alive && !active,
      stalled: false,
      cpuPercent: Number(cpuPercent.toFixed(2)),
      cpuTimeMs: Number(tree.cpuTimeMs) || 0,
      rssBytes: Number(tree.rssBytes) || 0,
      processCount: Array.isArray(tree.pids) ? tree.pids.length : 0,
      pids: Array.isArray(tree.pids) ? tree.pids : [],
      source: tree.source || "unknown",
      quietForMs,
      sampledAt: new Date(sampledAt).toISOString(),
      note: alive && !active ? "The process tree is alive. Zero CPU or quiet output is not treated as a stall." : "",
    };
    entry.tree = tree;
    entry.health = health;
    entry.lastSampleAt = sampledAt;
    entry.record.health = health;
    entry.record.updatedAt = health.sampledAt;
    persist(entry);
    const report = { type: "terminal_health", processId: entry.record.id, terminalId: entry.record.terminalId || "", command: entry.record.command, elapsedMs: sampledAt - new Date(entry.record.startedAt).getTime(), alive, health, metrics: formatMetrics(entry, entry.record) };
    emit(entry.runtime, report);
    entry.runtime?.heartbeat?.({ kind: "process_health", processId: entry.record.id, alive, state, cpuPercent: health.cpuPercent, processCount: health.processCount });
    try { entry.runtime?.onHealth?.(report); } catch { /* observer is best effort */ }
    entry.outputChanged = false;
  }
  function reviewReport(entry) {
    const record = readRecord(entry.workspace, entry.record.id) || entry.record;
    const value = snapshot(entry.workspace, record, { tail_chars: 8_000 }, entry);
    return {
      processId: record.id,
      terminalId: record.terminalId || "",
      command: record.command,
      cwd: record.cwd,
      status: record.status,
      alive: value.alive,
      elapsedMs: Date.now() - new Date(record.startedAt).getTime(),
      health: formatMetrics(entry, record),
      stdout: value.stdout,
      stderr: value.stderr,
      cursor: value.cursor,
      outputCompleteness: value.outputCompleteness,
      instruction: "Review the live process. It still holds a queue slot. Leave it running, or stop it with exec_command operation=stop and this process_id. Another live status is sent at the next review if it is still running.",
    };
  }
  function clearEntryTimers(entry) {
    if (entry.outputTimer) clearInterval(entry.outputTimer);
    if (entry.healthTimer) clearInterval(entry.healthTimer);
    if (entry.reviewTimer) clearInterval(entry.reviewTimer);
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
    if (entry.finishPollTimer) clearTimeout(entry.finishPollTimer);
    entry.outputTimer = entry.healthTimer = entry.reviewTimer = entry.timeoutTimer = entry.finishPollTimer = null;
  }
  function completeEntry(entry, { status, exitCode = null, signal = null, terminationReason = "" } = {}) {
    if (!entry || entry.finished) return entry?.completion;
    entry.finished = true;
    clearEntryTimers(entry);
    pollOutput(entry);
    const completedAt = now().toISOString();
    entry.record.status = status;
    entry.record.exitCode = exitCode;
    entry.record.signal = signal;
    entry.record.completedAt = completedAt;
    entry.record.updatedAt = completedAt;
    if (terminationReason) entry.record.terminationReason = terminationReason;
    entry.record.health = { ...(entry.record.health || {}), state: "finished", active: false, quiet: false, stalled: false, sampledAt: completedAt };
    persist(entry);
    const value = snapshot(entry.workspace, entry.record, { tail_chars: 50_000 }, entry);
    value.processId = entry.record.id;
    value.pid = entry.record.pid;
    value.terminalId = entry.record.terminalId || "";
    value.command = entry.record.command;
    value.cwd = entry.record.cwd;
    value.alive = false;
    value.status = status;
    value.exitCode = exitCode;
    value.signal = signal;
    value.finishedAt = completedAt;
    value.elapsedMs = Math.max(0, new Date(completedAt).getTime() - new Date(entry.record.startedAt).getTime());
    value.terminationReason = terminationReason;
    value.outputCompleteness = "complete";
    entry.completion = value;
    entry.record.stdout = String(value.stdout || "");
    entry.record.stderr = String(value.stderr || "");
    persist(entry);
    const { stdoutFile, stderrFile } = pathsFor(entry.workspace, entry.record);
    try { fsImpl.unlinkSync(stdoutFile); } catch { /* best-effort unlink must not fail completion */ }
    try { fsImpl.unlinkSync(stderrFile); } catch { /* best-effort unlink must not fail completion */ }
    if (!fileExists(stdoutFile) && !fileExists(stderrFile)) {
      entry.record.logsUnlinked = true;
      persist(entry);
    }
    live.delete(entry.record.id);
    try { entry.runtime?.onComplete?.(value); } catch { /* renderer may have closed */ }
    emit(entry.runtime, { type: "terminal_complete", processId: entry.record.id, terminalId: entry.record.terminalId || "", command: entry.record.command, ...value });
    entry.doneResolve?.(value);
    return value;
  }
  function attachChild(entry) {
    const child = entry.child;
    child.once?.("error", (error) => {
      if (entry.finished || entry.killIntent) return;
      completeEntry(entry, { status: "failed", terminationReason: "start_failed", signal: error.code || "PROCESS_ERROR" });
    });
    child.once?.("exit", (exitCode, signal) => {
      if (entry.finished || entry.killIntent) return;
      completeEntry(entry, {
        status: exitCode === 0 ? "complete" : "failed",
        exitCode,
        signal,
        terminationReason: signal ? "signaled" : "exit_code",
      });
    });
  }
  async function killAndComplete(entry, intent, { reason } = {}) {
    if (!entry || entry.finished) return entry?.completion;
    entry.killIntent = intent;
    try {
      await terminateProcessTree(entry.child, entry.tree);
    } finally {
      if (!entry.finished) completeEntry(entry, { status: intent, terminationReason: reason || intent });
    }
    return entry.completion;
  }
  function activateMonitoring(entry) {
    entry.outputTimer = setInterval(() => pollOutput(entry), Math.max(50, Number(outputPollMs) || DEFAULT_OUTPUT_POLL_MS));
    entry.healthTimer = setInterval(() => { sampleHealth(entry).catch(() => {}); }, Math.max(100, Number(monitorIntervalMs) || DEFAULT_MONITOR_INTERVAL_MS));
    entry.reviewTimer = setInterval(() => {
      if (entry.finished) return;
      const report = reviewReport(entry);
      if (typeof entry.foregroundReview === "function") {
        const deliver = entry.foregroundReview;
        entry.foregroundReview = null;
        deliver(report);
        return;
      }
      entry.runtime?.heartbeat?.({ kind: "process_review_checkpoint", processId: entry.record.id, elapsedMs: report.elapsedMs });
      emit(entry.runtime, { type: "terminal_checkpoint", ...report });
      try { entry.runtime?.onReview?.(report); } catch { /* best effort */ }
    }, Math.max(1, Number(reviewIntervalMs) || DEFAULT_REVIEW_INTERVAL_MS));
    pollOutput(entry);
    sampleHealth(entry).catch(() => {});
  }
  function makeEntry(workspace, record, child, runtime = {}) {
    const entry = { workspace, record, child, runtime, stdoutOffset: 0, stderrOffset: 0, outputChanged: false, finished: false, killIntent: null, tree: null, health: record.health || null, donePromise: null, doneResolve: null };
    entry.donePromise = new Promise((resolve) => { entry.doneResolve = resolve; });
    return entry;
  }
  function waitForObservation(workspace, record, input, runtime = {}) {
    const waitMs = Number(input.wait_ms) || 0;
    const { stdoutFile, stderrFile } = pathsFor(workspace, record);
    const baseline = { status: record.status, alive: isAlive(record.pid), stdoutBytes: input.stdout_offset === undefined ? fileSize(stdoutFile) : Number(input.stdout_offset), stderrBytes: input.stderr_offset === undefined ? fileSize(stderrFile) : Number(input.stderr_offset) };
    if (waitMs <= 0) return Promise.resolve({ changed: false, waitedMs: 0, observationTimedOut: false, baseline });
    const startedAt = Date.now();
    return new Promise((resolve) => {
      let settled = false;
      let pollTimer = null;
      let heartbeatTimer = null;
      let deadlineTimer = null;
      const onAbort = () => finish(false, false);
      const finish = (changed, observationTimedOut = false) => {
        if (settled) return;
        settled = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        runtime.signal?.removeEventListener?.("abort", onAbort);
        resolve({ changed, waitedMs: Date.now() - startedAt, observationTimedOut, baseline });
      };
      const observe = () => {
        const latest = readRecord(workspace, record.id) || record;
        const alive = isAlive(latest.pid);
        const stdoutBytes = fileSize(stdoutFile);
        const stderrBytes = fileSize(stderrFile);
        if (latest.status !== baseline.status || alive !== baseline.alive || stdoutBytes > baseline.stdoutBytes || stderrBytes > baseline.stderrBytes) {
          runtime.progress?.({ kind: "durable_process_observation", processId: record.id, status: latest.status, alive, stdoutBytes, stderrBytes });
          finish(true, false);
        }
      };
      if (runtime.signal?.aborted) return onAbort();
      runtime.signal?.addEventListener?.("abort", onAbort, { once: true });
      pollTimer = setInterval(observe, 1_000);
      heartbeatTimer = setInterval(() => runtime.heartbeat?.({ kind: "durable_process_wait", processId: record.id, waitedMs: Date.now() - startedAt }), 30_000);
      heartbeatTimer.unref?.();
      deadlineTimer = setTimeout(() => finish(false, true), waitMs);
      observe();
    });
  }
  function sessionKey(workspace, sessionId = "") {
    return `${pathImpl.resolve(String(workspace || ""))}::${String(sessionId || "")}`;
  }
  function runningEntries(workspace, sessionId = "") {
    const root = pathImpl.resolve(String(workspace || ""));
    const wantSession = String(sessionId || "");
    const found = [];
    for (const entry of live.values()) {
      if (!entry || entry.finished) continue;
      if (pathImpl.resolve(String(entry.workspace || "")) !== root) continue;
      if (String(entry.record?.sessionId || "") !== wantSession) continue;
      found.push(entry);
    }
    return found;
  }
  function describeRunning(entries) {
    return entries.map((entry) => ({
      processId: String(entry.record?.id || ""),
      command: String(entry.record?.command || ""),
    }));
  }
  function runningCommands(workspace, sessionId = "") {
    return describeRunning(runningEntries(workspace, sessionId));
  }
  function reserveCommandSlot(workspace, sessionId = "") {
    const key = sessionKey(workspace, sessionId);
    const running = runningEntries(workspace, sessionId);
    const pending = pendingSlots.get(key) || 0;
    const occupied = running.length + pending;
    if (occupied >= MAX_COMMAND_SLOTS) {
      return {
        ok: false,
        result: queueRejectionResult({
          running: describeRunning(running),
          freeSlots: Math.max(0, MAX_COMMAND_SLOTS - running.length),
          requested: 1,
        }, "manager"),
      };
    }
    pendingSlots.set(key, pending + 1);
    return { ok: true, key };
  }
  function releaseCommandSlot(key) {
    if (!key) return;
    const next = (pendingSlots.get(key) || 1) - 1;
    if (next <= 0) pendingSlots.delete(key);
    else pendingSlots.set(key, next);
  }
  async function start(workspace, input = {}, runtime = {}) {
    const reservation = reserveCommandSlot(workspace, runtime?.sessionId);
    if (!reservation.ok) return reservation.result;
    try {
      return await launchProcess(workspace, input, runtime);
    } finally {
      releaseCommandSlot(reservation.key);
    }
  }
  async function launchProcess(workspace, input = {}, runtime = {}) {
    const resolved = resolveWorkspaceTarget(workspace, input.cwd || "");
    if (resolved.error) return { ok: false, error: { code: "WORKSPACE_OUT_OF_SCOPE", message: resolved.error, retryable: false } };
    const selected = invocation(input);
    if (!selected?.executable) return { ok: false, error: { code: "PROCESS_ARGUMENT_INVALID", message: "No executable could be resolved.", retryable: false } };
    const id = `process-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const processRoot = rootFor(workspace);
    fsImpl.mkdirSync(processRoot, { recursive: true, mode: 0o700 });
    const stdoutFile = pathImpl.join(processRoot, `${id}.stdout.log`);
    const stderrFile = pathImpl.join(processRoot, `${id}.stderr.log`);
    const stdoutFd = fsImpl.openSync(stdoutFile, "a", 0o600);
    const stderrFd = fsImpl.openSync(stderrFile, "a", 0o600);
    // Node's Windows `detached` flag uses DETACHED_PROCESS, which opens a
    // visible console window for console-subsystem executables (python.exe,
    // cmd.exe, …). PowerShell also no-ops its command when launched that way.
    // Keep every Windows child attached to the Electron host; POSIX still uses
    // a detached process group so the tree can be supervised independently.
    const launchDetached = process.platform !== "win32";
    let child;
    try {
      child = spawnProcess(resolveExecutable(selected.executable), selected.args, { cwd: resolved.target || resolved.root, env: { ...process.env, ...(input.env || {}), TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0" }, windowsHide: true, detached: launchDetached, shell: false, stdio: ["ignore", stdoutFd, stderrFd] });
    } catch (error) {
      try { fsImpl.closeSync(stdoutFd); fsImpl.closeSync(stderrFd); } catch {}
      return { ok: false, error: { code: error.code || "PROCESS_START_FAILED", message: error.message, retryable: false } };
    }
    try { fsImpl.closeSync(stdoutFd); fsImpl.closeSync(stderrFd); } catch {}
    const stamp = now().toISOString();
    const record = { schemaVersion: 2, id, pid: child.pid, status: "running", executable: pathImpl.basename(String(selected.executable)), shell: selected.shell || "direct", command: redactSecrets(input.command || [input.executable, ...(input.args || [])].join(" ")), cwd: resolved.target || resolved.root, stdoutFile: stdoutFile.replace(/\\/g, "/"), stderrFile: stderrFile.replace(/\\/g, "/"), startedAt: stamp, updatedAt: stamp, lastOutputAt: stamp, exitCode: null, signal: null, detached: launchDetached, resumable: launchDetached, terminalId: runtime.terminalId || "", sessionId: runtime.sessionId || "" };
    writeRecord(workspace, record);
    const entry = makeEntry(workspace, record, child, runtime);
    live.set(id, entry);
    runtime.claimForegroundReview?.(entry);
    attachChild(entry);
    runtime.childProcess?.({ processId: id, pid: child.pid, terminalId: runtime.terminalId || "", detached: launchDetached });
    runtime.onStarted?.({ processId: id, pid: child.pid, terminalId: runtime.terminalId || "", command: record.command, cwd: record.cwd, startedAt: stamp });
    activateMonitoring(entry);
    const timeoutMs = Number(input.timeout_ms) || 0;
    if (timeoutMs > 0) {
      entry.timeoutTimer = setTimeout(() => {
        void killAndComplete(entry, "timeout", { reason: "timeout" }).catch(() => {});
      }, Math.min(timeoutMs, 86_400_000));
      entry.timeoutTimer.unref?.();
    }
    child.unref?.();
    return projectResult({ ok: true, value: { mode: "process_start", processId: id, pid: child.pid, status: "running", command: record.command, cwd: record.cwd, startedAt: stamp, terminalId: runtime.terminalId || "", detached: launchDetached, resumable: launchDetached } });
  }
  async function run(workspace, input = {}, runtime = {}) {
    const waitSpecified = Object.prototype.hasOwnProperty.call(input, "wait_ms");
    const waitMs = waitSpecified ? Math.max(0, Number(input.wait_ms) || 0) : null;
    let reviewResolve = null;
    const reviewPromise = new Promise((resolve) => { reviewResolve = resolve; });
    const startRuntime = waitMs == null
      ? {
        ...runtime,
        claimForegroundReview(entry) {
          entry.foregroundReview = (report) => reviewResolve({ kind: "review", report });
        },
      }
      : runtime;
    const started = await start(workspace, input, startRuntime);
    if (!started.ok) return started;
    const processId = started.value.processId;
    const entry = live.get(processId);
    if (!entry) return { ok: false, error: { code: "PROCESS_START_FAILED", message: "The process started but could not be supervised.", retryable: true } };
    let abortWait = null;
    const onAbort = () => abortWait?.();
    const finishWith = (completed) => {
      runtime.signal?.removeEventListener?.("abort", onAbort);
      return projectResult({ ok: completed.status === "complete" && completed.exitCode === 0, value: { ...completed, mode: "command" } });
    };
    const detachWithPartial = () => {
      runtime.signal?.removeEventListener?.("abort", onAbort);
      const record = readRecord(workspace, processId) || entry.record;
      const value = snapshot(workspace, record, { tail_chars: 50_000 }, entry);
      value.mode = "terminal_wait";
      value.status = "running";
      value.processId = processId;
      value.terminalId = record.terminalId || "";
      value.startedAt = new Date(record.startedAt).getTime();
      value.elapsedMs = Date.now() - value.startedAt;
      value.outputCompleteness = "partial";
      value.waiting = true;
      runtime.onDetached?.(value);
      emit(runtime, { type: "terminal_wait", processId, terminalId: value.terminalId, command: record.command, ...value });
      return projectResult({ ok: true, value });
    };
    const detachWithLiveStatus = (report = {}) => {
      runtime.signal?.removeEventListener?.("abort", onAbort);
      const record = readRecord(workspace, processId) || entry.record;
      const value = snapshot(workspace, record, { tail_chars: 8_000 }, entry);
      value.mode = "terminal_wait";
      value.status = "running";
      value.processId = processId;
      value.terminalId = record.terminalId || "";
      value.startedAt = new Date(record.startedAt).getTime();
      value.elapsedMs = Number(report.elapsedMs) || (Date.now() - value.startedAt);
      value.outputCompleteness = "partial";
      value.waiting = true;
      value.health = report.health || value.metrics;
      value.instruction = report.instruction || "This command is still running and still holds a queue slot. Stop it with exec_command operation=stop and this process_id, or leave it running.";
      runtime.onDetached?.(value);
      emit(runtime, { type: "terminal_wait", processId, terminalId: value.terminalId, command: record.command, ...value });
      return projectResult({ ok: true, value });
    };
    if (waitMs === 0) return detachWithPartial();
    const abortPromise = new Promise((resolve) => { abortWait = () => resolve("aborted"); });
    if (runtime.signal?.aborted) onAbort();
    else runtime.signal?.addEventListener?.("abort", onAbort, { once: true });
    const done = entry.donePromise.then((value) => (value ? { kind: "done", value } : { kind: "detach" }));
    const aborted = abortPromise.then(() => ({ kind: "abort" }));
    if (waitMs == null) {
      const completed = await Promise.race([done, aborted, reviewPromise]);
      entry.foregroundReview = null;
      if (completed.kind === "done") return finishWith(completed.value);
      if (completed.kind === "review") return detachWithLiveStatus(completed.report);
      return detachWithPartial();
    }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: "timeout" }), waitMs); });
    const completed = await Promise.race([done, aborted, timeout]);
    if (timer) clearTimeout(timer);
    if (completed.kind === "done") return finishWith(completed.value);
    return detachWithPartial();
  }
  async function status(workspace, input = {}, runtime = {}) {
    let record = readRecord(workspace, input.process_id);
    if (!record) return { ok: false, error: { code: "PROCESS_NOT_FOUND", message: `Unknown durable process: ${input.process_id}`, retryable: false } };
    const observation = await waitForObservation(workspace, record, input, runtime);
    record = readRecord(workspace, input.process_id) || record;
    let observedTree = live.get(record.id)?.tree || null;
    if (!observedTree) {
      try { observedTree = await sampleTree(record.pid, { fsImpl, platform: process.platform }); } catch { observedTree = null; }
    }
    const alive = observedTree?.alive !== undefined ? Boolean(observedTree.alive) : isAlive(record.pid);
    if (record.status === "running" && !alive && !live.has(record.id)) {
      record.status = "finished_unknown";
      record.completedAt = now().toISOString();
      record.updatedAt = record.completedAt;
      writeRecord(workspace, record);
    }
    const statusEntry = live.get(record.id) || (observedTree ? {
      tree: observedTree,
      health: record.health || {
        state: observedTree.alive ? "quiet" : "finished",
        active: false,
        quiet: Boolean(observedTree.alive),
        stalled: false,
        cpuPercent: 0,
        rssBytes: Number(observedTree.rssBytes) || 0,
        processCount: Array.isArray(observedTree.pids) ? observedTree.pids.length : 0,
        pids: Array.isArray(observedTree.pids) ? observedTree.pids : [],
        sampledAt: new Date().toISOString(),
        note: observedTree.alive ? "The process tree is alive. Zero CPU or quiet output is not treated as a stall." : "",
      },
    } : null);
    const value = snapshot(workspace, record, input, statusEntry);
    value.observation.changed = Boolean(observation.changed || value.observation.changed);
    value.observation.timedOut = observation.observationTimedOut;
    value.observation.waitedMs = observation.waitedMs;
    value.observation.state = value.alive ? (value.observation.changed ? "progressing" : value.metrics?.state || "quiet") : "finished";
    runtime.progress?.({ kind: "durable_process_status", processId: record.id, status: record.status, alive: value.alive, health: value.metrics });
    return projectResult({ ok: true, value });
  }
  async function stop(workspace, input = {}) {
    const record = readRecord(workspace, input.process_id);
    if (!record) return { ok: false, error: { code: "PROCESS_NOT_FOUND", message: `Unknown durable process: ${input.process_id}`, retryable: false } };
    const entry = live.get(record.id);
    if (entry?.finished) return projectResult({ ok: true, value: { processId: record.id, pid: record.pid, status: record.status, completedAt: record.completedAt } });
    if (entry) {
      try {
        const value = await killAndComplete(entry, "stopped", { reason: input.reason || "user_requested" });
        return projectResult({ ok: true, value: { ...value, processId: record.id, pid: record.pid, status: "stopped", completedAt: record.completedAt } });
      } catch (error) {
        return { ok: false, error: { code: "PROCESS_STOP_FAILED", message: error.message, retryable: true } };
      }
    }
    let tree = null;
    let treeAlive;
    if (record.status === "running") {
      try {
        tree = await sampleTree(record.pid, { fsImpl, platform: process.platform });
        treeAlive = Boolean(tree?.alive);
      } catch { treeAlive = undefined; }
    }
    if (record.status === "running" && (treeAlive || isAlive(record.pid))) {
      try {
        await terminateProcessTree({ pid: record.pid, kill: () => process.kill(record.pid) }, tree);
      } catch (error) {
        return { ok: false, error: { code: "PROCESS_STOP_FAILED", message: error.message, retryable: true } };
      }
    }
    if (record.status === "running") {
      record.status = "stopped";
      record.completedAt = now().toISOString();
      record.updatedAt = record.completedAt;
      record.terminationReason = input.reason || "user_requested";
      writeRecord(workspace, record);
    }
    return projectResult({ ok: true, value: { ...snapshot(workspace, record, {}, null), processId: record.id, pid: record.pid, status: "stopped", completedAt: record.completedAt } });
  }
  async function list(workspace, input = {}, runtime = {}) {
    // Session filter comes only from host/runtime. Never from model input —
    // a tool argument could otherwise list another chat's jobs.
    const sessionId = String(runtime?.sessionId || "").trim();
    const processes = [];
    for (const record of listInternal(workspace, sessionId)) {
      let alive = record.status === "running" ? (live.has(record.id) || isAlive(record.pid)) : false;
      // After an app restart there is no in-memory entry. If the detached
      // shell exited while a descendant remains, sample the persisted PID's
      // tree before reporting the process as finished.
      if (record.status === "running" && !live.has(record.id) && !alive) {
        try { alive = Boolean((await sampleTree(record.pid, { fsImpl, platform: process.platform }))?.alive); } catch { /* retain the root-PID result */ }
      }
      processes.push(projectAgentFacing({ ...record, alive, metrics: formatMetrics(live.get(record.id), record) }));
    }
    return { ok: true, value: { processes } };
  }
  async function reconcile(workspace) {
    const changed = [];
    for (const record of listInternal(workspace)) {
      let alive = record.status === "running" ? (live.has(record.id) || isAlive(record.pid)) : false;
      if (record.status === "running" && !live.has(record.id)) {
        try {
          const tree = await sampleTree(record.pid, { fsImpl, platform: process.platform });
          alive = Boolean(tree?.alive);
        } catch { /* retain the cheap root-PID observation */ }
      }
      if (record.status === "running" && !alive && !live.has(record.id)) {
        record.status = "finished_unknown";
        record.completedAt = now().toISOString();
        record.updatedAt = record.completedAt;
        writeRecord(workspace, record);
        changed.push(record.id);
      }
    }
    return changed;
  }
  return { list, reconcile, start, run, status, stop, sampleTree, runningCommands };
}

module.exports = { createDurableProcessManager };
