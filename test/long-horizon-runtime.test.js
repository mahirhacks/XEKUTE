"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Tunables = require("../src/agent/runtime/tunables.js");
const { createExecutionBudget } = require("../src/agent/runtime/execution-budget.js");
const { validateInput } = require("../src/agent/tools/process/exec-command.js");
const { createDurableProcessManager } = require("../src/app/services/terminal/durable-process-manager.js");
const { createLongHorizonRunStore } = require("../src/app/storage/long-horizon-run-store.js");

test("long-horizon defaults have no workflow, wall-clock, or model-round deadline", () => {
  assert.equal(Tunables.MAX_AGENT_ROUNDS, 0);
  assert.equal(Tunables.TURN_WALL_CLOCK_MS, 0);
  const budget = createExecutionBudget();
  assert.equal(budget.maxRounds, null);
  assert.equal(budget.deadline, null);
  assert.equal(budget.canContinue(10_000_000, Date.now() + 8 * 24 * 60 * 60 * 1000), true);
});

test("exec_command status observation accepts wait windows and output cursors without changing process lifetime", () => {
  assert.equal(validateInput({ operation: "status", process_id: "process-abc", wait_ms: 86_400_000, stdout_offset: 0, stderr_offset: 10 }).ok, true);
  assert.equal(validateInput({ operation: "run", command: "echo ok", wait_ms: 1 }).ok, false);
  assert.equal(validateInput({ operation: "status", process_id: "process-abc", wait_ms: 86_400_001 }).ok, false);
});

test("durable process manager starts, observes, cursors, lists, and reconciles a detached process", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-durable-process-"));
  const manager = createDurableProcessManager({
    resolveWorkspaceTarget(root, cwd = "") {
      const resolved = path.resolve(root);
      const target = path.resolve(resolved, cwd || ".");
      return target === resolved || target.startsWith(`${resolved}${path.sep}`) ? { root: resolved, target } : { error: "outside" };
    },
    resolveExecutable: (value) => value,
    terminateProcessTree: (child) => child.kill(),
  });
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const started = await manager.start(workspace, { operation: "start", executable: process.execPath, args: ["-e", "setTimeout(() => console.log('durable-finished'), 80)"] });
  assert.equal(started.ok, true);
  processId = started.value.processId;
  const observed = await manager.status(workspace, { operation: "status", process_id: processId, wait_ms: 5_000, stdout_offset: 0, stderr_offset: 0, tail_chars: 10_000 });
  assert.equal(observed.ok, true);
  assert.match(observed.value.stdout, /durable-finished/);
  assert.ok(observed.value.cursor.stdoutOffset > 0);
  assert.equal(["progressing", "finished"].includes(observed.value.observation.state), true);
  const cursorStatus = await manager.status(workspace, { operation: "status", process_id: processId, stdout_offset: observed.value.cursor.stdoutOffset, stderr_offset: observed.value.cursor.stderrOffset });
  assert.equal(cursorStatus.value.stdout, "");
  const listed = await manager.list(workspace);
  assert.equal(listed.value.processes.some((record) => record.id === processId), true);
  await manager.reconcile(workspace);
});

test("durable status waits are cancellable observations and do not stop the underlying process", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-durable-wait-"));
  const manager = createDurableProcessManager({
    resolveWorkspaceTarget(root) { return { root: path.resolve(root), target: path.resolve(root) }; },
    resolveExecutable: (value) => value,
    terminateProcessTree: (child) => child.kill(),
  });
  let processId = "";
  t.after(async () => {
    if (processId) await manager.stop(workspace, { process_id: processId }).catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const started = await manager.start(workspace, { operation: "start", executable: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"] });
  processId = started.value.processId;
  const controller = new AbortController();
  const waiting = manager.status(workspace, { operation: "status", process_id: processId, wait_ms: 5_000 }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  const status = await waiting;
  assert.equal(status.ok, true);
  assert.equal(status.value.alive, true);
  assert.ok(status.value.observation.waitedMs < 1_000);
  await manager.stop(workspace, { operation: "stop", process_id: processId });
});

test("long-horizon run state checkpoints atomically, reconciles stale work, and resumes in a new segment", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-run-store-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  let clock = new Date("2026-08-01T00:00:00.000Z");
  const store = createLongHorizonRunStore({ now: () => new Date(clock) });
  await store.begin(workspace, { runId: "run-1", sessionId: "session-1", objective: "multi-day assessment", mode: "agent", authorityProfile: "full_authority" });
  await store.checkpoint(workspace, "run-1", { round: 4, actionCount: 9, checkpoint: { processIds: ["process-1"], phase: "recon" } });
  let record = store.get(workspace, "run-1");
  assert.equal(record.segment, 1);
  assert.equal(record.checkpointSequence, 1);
  assert.deepEqual(record.checkpoint.processIds, ["process-1"]);
  clock = new Date("2026-08-01T01:00:00.000Z");
  const reconciled = await store.reconcile(workspace, { staleAfterMs: 30 * 60_000 });
  assert.deepEqual(reconciled, ["run-1"]);
  record = store.get(workspace, "run-1");
  assert.equal(record.status, "interrupted");
  assert.equal(record.resumeEligible, true);
  await store.resume(workspace, "run-1");
  record = store.get(workspace, "run-1");
  assert.equal(record.status, "running");
  assert.equal(record.segment, 2);
  assert.equal(record.recoveryCount, 1);
  await store.finish(workspace, "run-1", "completed", { evidenceIds: ["e-1"] });
  assert.equal(store.get(workspace, "run-1").status, "completed");
  await store.flush();
  assert.equal(fs.existsSync(store.fileFor(workspace)), true);
});

test("long-horizon checkpoints recover from a damaged primary file", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-run-recovery-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const store = createLongHorizonRunStore();
  await store.begin(workspace, { runId: "run-recovery", objective: "week-long assessment" });
  await store.checkpoint(workspace, "run-recovery", { round: 2, actionCount: 3 });
  assert.equal(fs.existsSync(store.backupFor(workspace)), true);
  fs.writeFileSync(store.fileFor(workspace), "{damaged");
  const recovered = store.get(workspace, "run-recovery");
  assert.equal(recovered.runId, "run-recovery");
  assert.equal(recovered.status, "running");
});
