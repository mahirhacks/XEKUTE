"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveShellInvocation } = require("../../../agent/tools/process/exec-command.js");
const { redactSecrets } = require("../../../shared/secret-redaction.js");

function createDurableProcessManager({
  fsImpl = fs,
  pathImpl = path,
  spawnProcess = spawn,
  resolveWorkspaceTarget,
  resolveExecutable = (value) => value,
  terminateProcessTree = (child) => child?.kill?.(),
  now = () => new Date(),
} = {}) {
  const live = new Map();
  function rootFor(workspace) { return pathImpl.join(pathImpl.resolve(workspace), ".xekute", "state", "processes"); }
  function recordFile(workspace, id) { return pathImpl.join(rootFor(workspace), `${id}.json`); }
  function writeRecord(workspace, record) {
    const file = recordFile(workspace, record.id);
    fsImpl.mkdirSync(pathImpl.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fsImpl.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try { fsImpl.renameSync(temp, file); } catch { try { fsImpl.rmSync(file, { force: true }); } catch {} fsImpl.renameSync(temp, file); }
    try { fsImpl.chmodSync(file, 0o600); } catch {}
  }
  function readRecord(workspace, id) {
    try { return JSON.parse(fsImpl.readFileSync(recordFile(workspace, id), "utf8")); } catch { return null; }
  }
  function isAlive(pid) {
    if (!Number(pid)) return false;
    try { process.kill(Number(pid), 0); return true; } catch { return false; }
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
  function fileSize(file) {
    try { return fsImpl.statSync(file).size; } catch { return 0; }
  }
  function readFrom(file, offset, maxChars) {
    if (!maxChars) return { text: "", nextOffset: fileSize(file), truncated: false };
    try {
      const stat = fsImpl.statSync(file);
      const start = Math.max(0, Math.min(Number(offset) || 0, stat.size));
      const available = Math.max(0, stat.size - start);
      const maxBytes = Math.max(maxChars * 4, maxChars);
      const bytes = Math.min(available, maxBytes);
      const fd = fsImpl.openSync(file, "r");
      const buffer = Buffer.alloc(bytes);
      fsImpl.readSync(fd, buffer, 0, bytes, start);
      fsImpl.closeSync(fd);
      return { text: buffer.toString("utf8").slice(0, maxChars), nextOffset: start + bytes, truncated: available > bytes };
    } catch { return { text: "", nextOffset: Number(offset) || 0, truncated: false }; }
  }
  function waitForObservation(workspace, record, input, runtime = {}) {
    const waitMs = Number(input.wait_ms) || 0;
    const stdoutFile = pathImpl.join(workspace, record.stdoutFile);
    const stderrFile = pathImpl.join(workspace, record.stderrFile);
    const baseline = {
      status: record.status,
      alive: isAlive(record.pid),
      stdoutBytes: input.stdout_offset === undefined ? fileSize(stdoutFile) : Number(input.stdout_offset),
      stderrBytes: input.stderr_offset === undefined ? fileSize(stderrFile) : Number(input.stderr_offset),
    };
    if (waitMs <= 0) return Promise.resolve({ changed: false, waitedMs: 0, observationTimedOut: false, baseline });
    const startedAt = Date.now();
    return new Promise((resolve) => {
      let settled = false;
      let pollTimer = null;
      let heartbeatTimer = null;
      let deadlineTimer = null;
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
      const onAbort = () => finish(false, false);
      if (runtime.signal?.aborted) return onAbort();
      runtime.signal?.addEventListener?.("abort", onAbort, { once: true });
      pollTimer = setInterval(observe, 1_000);
      heartbeatTimer = setInterval(() => runtime.heartbeat?.({ kind: "durable_process_wait", processId: record.id, waitedMs: Date.now() - startedAt }), 30_000);
      heartbeatTimer.unref?.();
      deadlineTimer = setTimeout(() => finish(false, true), waitMs);
      observe();
    });
  }
  function invocation(input) {
    if (typeof input.command === "string") return resolveShellInvocation(input.command, input.shell || "auto");
    return { shell: null, executable: input.executable, args: Array.isArray(input.args) ? input.args : [] };
  }
  async function start(workspace, input = {}, runtime = {}) {
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
    let child;
    try {
      child = spawnProcess(resolveExecutable(selected.executable), selected.args, {
        cwd: resolved.target || resolved.root,
        env: { ...process.env, ...(input.env || {}), TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0" },
        windowsHide: true,
        detached: true,
        shell: false,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } catch (error) {
      try { fsImpl.closeSync(stdoutFd); fsImpl.closeSync(stderrFd); } catch {}
      return { ok: false, error: { code: error.code || "PROCESS_START_FAILED", message: error.message, retryable: false } };
    }
    try { fsImpl.closeSync(stdoutFd); fsImpl.closeSync(stderrFd); } catch {}
    const stamp = now().toISOString();
    const record = {
      schemaVersion: 1,
      id,
      pid: child.pid,
      status: "running",
      executable: pathImpl.basename(String(selected.executable)),
      shell: selected.shell || "direct",
      command: redactSecrets(input.command || [input.executable, ...(input.args || [])].join(" ")),
      cwd: resolved.target || resolved.root,
      stdoutFile: pathImpl.relative(workspace, stdoutFile).replace(/\\/g, "/"),
      stderrFile: pathImpl.relative(workspace, stderrFile).replace(/\\/g, "/"),
      startedAt: stamp,
      updatedAt: stamp,
      lastOutputAt: stamp,
      exitCode: null,
      signal: null,
      detached: true,
      resumable: true,
    };
    writeRecord(workspace, record);
    live.set(id, { child, workspace });
    runtime.childProcess?.({ processId: id, pid: child.pid, detached: true });
    child.once("exit", (exitCode, signal) => {
      const current = readRecord(workspace, id) || record;
      current.status = exitCode === 0 ? "completed" : "failed";
      current.exitCode = exitCode;
      current.signal = signal;
      current.completedAt = now().toISOString();
      current.updatedAt = current.completedAt;
      writeRecord(workspace, current);
      live.delete(id);
    });
    child.unref?.();
    return { ok: true, value: { processId: id, pid: child.pid, status: "running", command: record.command, cwd: record.cwd, startedAt: stamp, detached: true, resumable: true } };
  }
  async function status(workspace, input = {}, runtime = {}) {
    let record = readRecord(workspace, input.process_id);
    if (!record) return { ok: false, error: { code: "PROCESS_NOT_FOUND", message: `Unknown durable process: ${input.process_id}`, retryable: false } };
    const observation = await waitForObservation(workspace, record, input, runtime);
    record = readRecord(workspace, input.process_id) || record;
    const alive = isAlive(record.pid);
    if (record.status === "running" && !alive) {
      record.status = "finished_unknown";
      record.completedAt = now().toISOString();
      record.updatedAt = record.completedAt;
      writeRecord(workspace, record);
    }
    const max = input.tail_chars === undefined ? 50_000 : input.tail_chars;
    const stdoutFile = pathImpl.join(workspace, record.stdoutFile);
    const stderrFile = pathImpl.join(workspace, record.stderrFile);
    const stdoutRead = input.stdout_offset === undefined
      ? { text: tail(stdoutFile, max), nextOffset: fileSize(stdoutFile), truncated: fileSize(stdoutFile) > Math.max(max * 4, max) }
      : readFrom(stdoutFile, input.stdout_offset, max);
    const stderrLimit = Math.min(max, 20_000);
    const stderrRead = input.stderr_offset === undefined
      ? { text: tail(stderrFile, stderrLimit), nextOffset: fileSize(stderrFile), truncated: fileSize(stderrFile) > Math.max(stderrLimit * 4, stderrLimit) }
      : readFrom(stderrFile, input.stderr_offset, stderrLimit);
    const outputChanged = stdoutRead.nextOffset > observation.baseline.stdoutBytes || stderrRead.nextOffset > observation.baseline.stderrBytes;
    if (outputChanged) {
      record.lastOutputAt = now().toISOString();
      record.updatedAt = record.lastOutputAt;
      writeRecord(workspace, record);
    }
    const quietForMs = Math.max(0, Date.now() - new Date(record.lastOutputAt || record.startedAt || 0).getTime());
    return {
      ok: true,
      value: {
        ...record,
        alive,
        stdout: stdoutRead.text,
        stderr: stderrRead.text,
        cursor: { stdoutOffset: stdoutRead.nextOffset, stderrOffset: stderrRead.nextOffset },
        nextStatusArguments: { process_id: record.id, stdout_offset: stdoutRead.nextOffset, stderr_offset: stderrRead.nextOffset },
        outputTruncated: { stdout: stdoutRead.truncated, stderr: stderrRead.truncated },
        observation: {
          changed: observation.changed || outputChanged,
          timedOut: observation.observationTimedOut,
          waitedMs: observation.waitedMs,
          state: alive ? (observation.changed || outputChanged ? "progressing" : "quiet") : "finished",
          quietForMs,
          note: alive && !(observation.changed || outputChanged) ? "Quiet output is not by itself evidence that the process is stuck." : "",
        },
        outputCompleteness: alive ? "partial" : "complete",
      },
    };
  }
  async function stop(workspace, input = {}) {
    const record = readRecord(workspace, input.process_id);
    if (!record) return { ok: false, error: { code: "PROCESS_NOT_FOUND", message: `Unknown durable process: ${input.process_id}`, retryable: false } };
    const active = live.get(record.id)?.child || { pid: record.pid, kill: () => process.kill(record.pid) };
    if (isAlive(record.pid)) {
      try { terminateProcessTree(active); } catch (error) { return { ok: false, error: { code: "PROCESS_STOP_FAILED", message: error.message, retryable: true } }; }
    }
    record.status = "stopped";
    record.completedAt = now().toISOString();
    record.updatedAt = record.completedAt;
    writeRecord(workspace, record);
    live.delete(record.id);
    return { ok: true, value: { processId: record.id, pid: record.pid, status: "stopped", completedAt: record.completedAt } };
  }
  async function list(workspace, input = {}) {
    const root = rootFor(workspace);
    let records = [];
    try { records = fsImpl.readdirSync(root).filter((name) => /^process-.*\.json$/.test(name)).map((name) => JSON.parse(fsImpl.readFileSync(pathImpl.join(root, name), "utf8"))); } catch { records = []; }
    return { ok: true, value: { processes: records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 200).map((record) => ({ ...record, alive: record.status === "running" ? isAlive(record.pid) : false })) } };
  }
  async function reconcile(workspace) {
    const result = await list(workspace);
    const changed = [];
    for (const record of result.value.processes) {
      if (record.status === "running" && !record.alive) {
        record.status = "finished_unknown";
        record.completedAt = now().toISOString();
        record.updatedAt = record.completedAt;
        writeRecord(workspace, record);
        changed.push(record.id);
      }
    }
    return changed;
  }
  return { list, reconcile, start, status, stop };
}

module.exports = { createDurableProcessManager };
