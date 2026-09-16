"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { createDurableProcessManager } = require("../src/app/services/terminal/durable-process-manager.js");

function resolveWorkspaceTarget(workspace, relative = "") {
  const root = path.resolve(workspace);
  const target = path.resolve(root, relative || ".");
  const relation = path.relative(root, target);
  if (relation.startsWith("..") || path.isAbsolute(relation)) return { error: "Path escapes workspace" };
  return { root, target, relative: relation };
}

function makeManager(overrides = {}) {
  return createDurableProcessManager({
    resolveWorkspaceTarget,
    outputPollMs: 25,
    monitorIntervalMs: 100,
    reviewIntervalMs: 60_000,
    ...overrides,
  });
}

function assertProjected(value, label = "value") {
  assert.equal("pid" in value, false, `${label} must omit pid`);
  assert.equal("stdoutFile" in value, false, `${label} must omit stdoutFile`);
  assert.equal("stderrFile" in value, false, `${label} must omit stderrFile`);
  assert.equal("logsUnlinked" in value, false, `${label} must omit logsUnlinked`);
  assert.equal("retainedStdout" in value, false, `${label} must omit retainedStdout`);
  assert.equal("retainedStderr" in value, false, `${label} must omit retainedStderr`);
  if (value.metrics) assert.equal("pids" in value.metrics, false, `${label}.metrics must omit pids`);
  if (value.health) assert.equal("pids" in value.health, false, `${label}.health must omit pids`);
  if (value.processId) assert.match(value.processId, /^process-/);
}

function createFakeChild(pid = 999001) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {};
  child.unref = () => {};
  return child;
}

function logPaths(workspace, processId) {
  const digest = crypto.createHash("sha256").update(path.resolve(workspace)).digest("hex").slice(0, 16);
  const dir = path.join(os.tmpdir(), "xekute-processes", digest);
  return {
    stdoutFile: path.join(dir, `${processId}.stdout.log`),
    stderrFile: path.join(dir, `${processId}.stderr.log`),
  };
}

test("durable PowerShell runs persist workspace writes on Windows", { skip: process.platform !== "win32" }, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-durable-"));
  const manager = makeManager();
  let processId = "";
  try {
    const started = await manager.run(workspace, {
      command: "Set-Content -LiteralPath generated.txt -Value persisted; Write-Output persisted",
      shell: "powershell",
      timeout_ms: 30_000,
      wait_ms: 20_000,
    });
    assert.equal(started.ok, true);
    processId = started.value.processId || started.value.id || "";
    assertProjected(started.value, "run");
    let value = started.value;
    const deadline = Date.now() + 20_000;
    while (value.status === "running" && Date.now() < deadline && processId) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const observed = await manager.status(workspace, { process_id: processId, wait_ms: 400 });
      if (observed.ok) value = observed.value;
    }

    assert.equal(value.status, "complete");
    assert.equal(value.exitCode, 0);
    assert.match(String(value.stdout || ""), /persisted/);
    assert.equal(fs.readFileSync(path.join(workspace, "generated.txt"), "utf8").trim(), "persisted");
  } finally {
    if (processId) {
      try { await manager.stop(workspace, { process_id: processId, reason: "test_teardown" }); } catch { /* already finished */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  }
});

test("run waits until exit when wait_ms is omitted and backgrounds only when wait_ms is 0", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-wait-default-"));
  const manager = makeManager();
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  });
  const zeroWait = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    wait_ms: 0,
  });
  assert.equal(zeroWait.ok, true);
  assert.equal(zeroWait.value.mode, "terminal_wait");
  assertProjected(zeroWait.value, "wait_ms:0");
  await manager.stop(workspace, { process_id: zeroWait.value.processId });

  const startedAt = Date.now();
  const defaultWait = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", "setTimeout(() => process.stdout.write('later'), 400)"],
  });
  const elapsed = Date.now() - startedAt;
  assert.equal(defaultWait.ok, true);
  assert.equal(defaultWait.value.mode, "command");
  assert.equal(defaultWait.value.status, "complete");
  assert.match(String(defaultWait.value.stdout || ""), /later/);
  assert.ok(elapsed >= 350, `expected run to wait for exit, got ${elapsed}ms`);
  assert.ok(elapsed < 8_000, `expected run to return after exit, got ${elapsed}ms`);
});

test("timeout_ms during run wait returns timeout result not terminal_wait", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-timeout-run-"));
  const manager = makeManager();
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  });
  const result = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    wait_ms: 5_000,
    timeout_ms: 200,
  });
  assert.equal(result.ok, false);
  assert.equal(result.value.mode, "command");
  assert.equal(result.value.status, "timeout");
  assert.notEqual(result.value.mode, "terminal_wait");
  processId = result.value.processId;
  assertProjected(result.value, "timeout run");
});

test("status wait_ms does not kill the process", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-status-wait-"));
  const manager = makeManager();
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  });
  const started = await manager.start(workspace, { executable: process.execPath, args: ["-e", "setTimeout(() => {}, 30000)"] });
  assert.equal(started.ok, true);
  processId = started.value.processId;
  const probe = await manager.status(workspace, { process_id: processId, wait_ms: 0 });
  if (probe.value.status !== "running") {
    t.skip("child process did not remain running in this environment");
    return;
  }
  const status = await manager.status(workspace, { process_id: processId, wait_ms: 200 });
  assert.equal(status.ok, true);
  assert.notEqual(status.value.status, "stopped");
  assert.notEqual(status.value.terminationReason, "user_requested");
  assertProjected(status.value, "status");
});

test("public returns are projected including start stop and list", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-projected-"));
  const manager = makeManager();
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  });
  const started = await manager.start(workspace, { executable: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"] });
  assert.equal(started.ok, true);
  processId = started.value.processId;
  assertProjected(started.value, "start");
  assert.match(processId, /^process-/);

  const listed = await manager.list(workspace);
  const item = listed.value.processes.find((record) => record.id === processId);
  assert.ok(item);
  assert.equal(item.processId, processId);
  assertProjected(item, "list item");

  const stopped = await manager.stop(workspace, { process_id: processId });
  assert.equal(stopped.ok, true);
  assertProjected(stopped.value, "stop");
  processId = "";
});

test("stop reports stopped when the child exits 0 during the kill wait", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-stop-intent-"));
  const child = createFakeChild();
  const manager = makeManager({
    spawnProcess: () => child,
    async terminateProcessTree(target) {
      target.exitCode = 0;
      target.emit("exit", 0, null);
    },
  });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const started = await manager.start(workspace, { executable: process.execPath, args: ["-e", ""] });
  assert.equal(started.ok, true);
  const stopped = await manager.stop(workspace, { process_id: started.value.processId, reason: "user_requested" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.status, "stopped");
  assert.notEqual(stopped.value.status, "complete");
  assert.notEqual(stopped.value.status, "failed");
});

test("timeout_ms uses the shared terminator and keeps command mode", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-timeout-helper-"));
  const child = createFakeChild();
  let terminatorCalls = 0;
  const manager = makeManager({
    spawnProcess: () => child,
    async terminateProcessTree(target) {
      terminatorCalls += 1;
      target.kill?.();
    },
  });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const result = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", ""],
    timeout_ms: 40,
  });
  assert.equal(result.ok, false);
  assert.equal(result.value.status, "timeout");
  assert.equal(result.value.mode, "command");
  assert.notEqual(result.value.mode, "terminal_wait");
  assert.equal(terminatorCalls, 1);
  assert.equal(result.error, undefined);
});

test("killAndComplete still records the intent when the terminator throws", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-kill-finally-"));
  const child = createFakeChild();
  const manager = makeManager({
    spawnProcess: () => child,
    async terminateProcessTree() {
      throw new Error("terminator failed");
    },
  });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const started = await manager.start(workspace, { executable: process.execPath, args: ["-e", ""] });
  assert.equal(started.ok, true);
  const processId = started.value.processId;
  const stopped = await manager.stop(workspace, { process_id: processId });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.error.code, "PROCESS_STOP_FAILED");
  const listed = await manager.list(workspace);
  const item = listed.value.processes.find((record) => record.id === processId);
  assert.ok(item);
  assert.equal(item.status, "stopped");
  assert.notEqual(item.status, "running");
});

test("completeEntry copies tails then unlinks logs; status and list keep stdout/stderr", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-log-retain-"));
  const manager = makeManager();
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const result = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", "process.stdout.write('hello-out'); process.stderr.write('hello-err');"],
  });
  assert.equal(result.ok, true);
  const processId = result.value.processId;
  const logs = logPaths(workspace, processId);
  assert.equal(fs.existsSync(logs.stdoutFile), false);
  assert.equal(fs.existsSync(logs.stderrFile), false);
  const status = await manager.status(workspace, { process_id: processId });
  assert.equal(status.ok, true);
  assert.match(String(status.value.stdout || ""), /hello-out/);
  assert.match(String(status.value.stderr || ""), /hello-err/);
  const listed = await manager.list(workspace);
  const item = listed.value.processes.find((record) => record.id === processId);
  assert.ok(item);
  assert.match(String(item.stdout || ""), /hello-out/);
  assert.match(String(item.stderr || ""), /hello-err/);
  assert.equal("logsUnlinked" in item, false);
  assert.equal("retainedStdout" in item, false);
  assertProjected(item, "list after unlink");
  const byteLength = Buffer.byteLength(String(status.value.stdout || ""), "utf8");
  const offsetStatus = await manager.status(workspace, { process_id: processId, stdout_offset: byteLength });
  assert.equal(offsetStatus.ok, true);
  assert.equal(offsetStatus.value.stdout, "");
});

test("unlinkSync throw still completes with tails on the record", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-unlink-throw-"));
  const fsImpl = new Proxy(fs, {
    get(target, prop) {
      if (prop === "unlinkSync") {
        return () => {
          const error = new Error("EPERM");
          error.code = "EPERM";
          throw error;
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = makeManager({ fsImpl });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const result = await manager.run(workspace, {
    executable: process.execPath,
    args: ["-e", "process.stdout.write('kept-out'); process.stderr.write('kept-err');"],
  });
  assert.equal(result.ok, true);
  assert.match(String(result.value.stdout || ""), /kept-out/);
  const listed = await manager.list(workspace);
  const item = listed.value.processes.find((record) => record.id === result.value.processId);
  assert.ok(item);
  assert.match(String(item.stdout || ""), /kept-out/);
  assert.match(String(item.stderr || ""), /kept-err/);
});

test("list does not call snapshot", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/app/services/terminal/durable-process-manager.js"), "utf8");
  const listSlice = source.slice(source.indexOf("async function list"), source.indexOf("async function reconcile"));
  assert.doesNotMatch(listSlice, /\bsnapshot\s*\(/);
  assert.match(source, /Buffer\.from\(text, "utf8"\)/);
  assert.match(listSlice, /runtime\?\.sessionId/);
  assert.doesNotMatch(listSlice, /input\.session_id/);
});

test("list with runtime.sessionId only returns that session's processes", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-list-session-"));
  const manager = makeManager();
  const ids = [];
  t.after(async () => {
    for (const id of ids) await manager.stop(workspace, { process_id: id }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const first = await manager.start(workspace, {
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 8000)"],
  }, { sessionId: "sess-a" });
  const second = await manager.start(workspace, {
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 8000)"],
  }, { sessionId: "sess-b" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  ids.push(first.value.processId, second.value.processId);

  const forA = await manager.list(workspace, {}, { sessionId: "sess-a" });
  const forB = await manager.list(workspace, {}, { sessionId: "sess-b" });
  const all = await manager.list(workspace, {});
  const spoofed = await manager.list(workspace, { session_id: "sess-a" });

  const idsOf = (listed) => listed.value.processes.map((record) => record.processId || record.id);
  assert.deepEqual(idsOf(forA).filter((id) => ids.includes(id)), [first.value.processId]);
  assert.deepEqual(idsOf(forB).filter((id) => ids.includes(id)), [second.value.processId]);
  assert.equal(idsOf(all).filter((id) => ids.includes(id)).length, 2);
  assert.equal(idsOf(spoofed).filter((id) => ids.includes(id)).length, 2);
});

test("agent abort detaches run wait without killing the process", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-abort-keep-"));
  const child = createFakeChild();
  let terminatorCalls = 0;
  const manager = makeManager({
    spawnProcess: () => child,
    async terminateProcessTree(target) {
      terminatorCalls += 1;
      target.exitCode = 0;
      target.emit("exit", 0, null);
    },
  });
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* temp workspace */ }
  });
  const abort = new AbortController();
  const pending = manager.run(workspace, { executable: process.execPath, args: ["-e", ""] }, { signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 30));
  abort.abort();
  const result = await pending;
  assert.equal(result.ok, true);
  processId = result.value.processId;
  assert.equal(result.value.mode, "terminal_wait");
  assert.equal(result.value.status, "running");
  assert.equal(result.value.waiting, true);
  assert.equal(terminatorCalls, 0);
  const listed = await manager.list(workspace);
  const item = listed.value.processes.find((record) => record.id === processId);
  assert.ok(item);
  assert.equal(item.status, "running");
  assert.notEqual(item.status, "stopped");
});

test("run abort does not call manager.stop for agent_cancelled", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/app/services/terminal/durable-process-manager.js"), "utf8");
  const runSlice = source.slice(source.indexOf("async function run("), source.indexOf("async function status("));
  assert.doesNotMatch(runSlice, /agent_cancelled/);
  assert.match(runSlice, /Promise\.race\(\[done, aborted\]\)/);
});
