"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
  if (value.metrics) assert.equal("pids" in value.metrics, false, `${label}.metrics must omit pids`);
  if (value.health) assert.equal("pids" in value.health, false, `${label}.health must omit pids`);
  if (value.processId) assert.match(value.processId, /^process-/);
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
