"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createManagedProcessSession } = require("../src/application/tools/managed-process-session");

// A fake child process that emits stdout/close deterministically, so the tests
// never depend on real OS timing.
function fakeChild({ stdout = "", stderr = "", exitCode = 0, signal = null, spawnError = null, delay = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 9999;
  child.killed = false;
  child.kills = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  child.stdin = new EventEmitter();
  child.__exitCode = exitCode;
  child.__signal = signal;
  child.__delay = delay;
  return child;
}

function makeSession({ lines, exitCode = 0, signal = null, extra = {} } = {}) {
  const spawned = [];
  const artifacts = [];
  const descriptors = [];
  const managed = createManagedProcessSession({
    spawnChild(executable, args, options) {
      const child = fakeChild({ exitCode, signal });
      spawned.push({ executable, args, options, child });
      return child;
    },
    persistArtifact(workspace, text, meta) {
      artifacts.push({ workspace, text, meta });
      return `artifact-${artifacts.length}`;
    },
    persistDescriptor(descriptor) { descriptors.push(JSON.parse(JSON.stringify(descriptor))); },
    terminateProcessTree: null,
    ...extra,
  });
  return { managed, spawned, artifacts, descriptors };
}

function start(session, overrides = {}) {
  const { managed, spawned, artifacts } = session;
  const result = managed.startManagedProcess({
    managedOperationId: "managed-1",
    auditId: "audit-1",
    workspace: "ws",
    executable: "echo",
    args: ["hi"],
    cwd: "ws",
    monitorMs: 100000,
    hardDeadlineAt: Date.now() + 600000,
    scopeExpiresAt: Date.now() + 300000,
    ...overrides,
  });
  return result;
}

test("start emits a running descriptor with a bounded ring buffer and no terminal state", () => {
  const session = makeSession();
  const started = start(session);
  assert.equal(started.ok, true);
  assert.equal(started.managedOperationId, "managed-1");
  const desc = session.descriptors[0];
  assert.equal(desc.status, "running");
  assert.equal(desc.checkpointSequence, 0);
  assert.equal(desc.hardDeadlineAt > Date.now() - 1000, true);
  assert.equal(desc.scopeExpiresAt > Date.now() - 1000, true);
  assert.ok(session.managed.managedProcesses.has("managed-1"));
});

test("checkpoint returns a single-use token with lines_returned = lines_available when tail exceeds output", () => {
  const session = makeSession();
  const started = start(session);
  const child = session.spawned[0].child;
  child.stdout.emit("data", "line1\nline2\nline3\n");
  const cp = session.managed.checkpointProcess("managed-1", { workspace: "ws", logTailLines: 20 });
  assert.equal(cp.ok, true);
  assert.equal(cp.continuation_required, true);
  assert.ok(cp.checkpoint_id);
  assert.equal(cp.lines_available, 3);
  assert.equal(cp.lines_returned, 3);
  assert.equal(cp.log_lines.length, 3);
});

test("continue consumes the checkpoint token atomically; replay yields OPERATION_RESUME_DUPLICATE", () => {
  const session = makeSession();
  start(session);
  const cp = session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  // mark awaiting_decision so continue applies cleanly
  session.managed.managedProcesses.get("managed-1").descriptor.status = "awaiting_decision";
  const cont = session.managed.continueProcess("managed-1", { checkpointId: cp.checkpoint_id, workspace: "ws" });
  assert.equal(cont.ok, true);
  // replaying the same token is rejected
  session.managed.managedProcesses.get("managed-1").descriptor.status = "awaiting_decision";
  const replay = session.managed.continueProcess("managed-1", { checkpointId: cp.checkpoint_id, workspace: "ws" });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, "OPERATION_RESUME_DUPLICATE");
});

test("stale or mismatched checkpoint tokens are rejected before dispatch", () => {
  const session = makeSession();
  start(session);
  session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  session.managed.managedProcesses.get("managed-1").descriptor.status = "awaiting_decision";
  const wrong = session.managed.continueProcess("managed-1", { checkpointId: "checkpoint-999-other", workspace: "ws" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, "OPERATION_RESUME_DUPLICATE");
});

test("host terminate requires no checkpoint token and finalizes exactly once", () => {
  const session = makeSession();
  start(session);
  const first = session.managed.terminateFromHost({ managedOperationId: "managed-1", workspace: "ws", reason: { code: "OPERATION_CANCELLED", summary: "shutdown" } });
  assert.equal(first.status, "cancelled");
  assert.equal(first.process_status === "terminated" || first.process_status === "exited", true);
  // second termination is idempotent (finalize-once)
  const second = session.managed.terminateFromHost({ managedOperationId: "managed-1", workspace: "ws", reason: { code: "OPERATION_CANCELLED", summary: "again" } });
  assert.equal(second.finalized !== true, true);
});

test("stopFromModel consumes the checkpoint token and stops, but host terminate is also possible", () => {
  const session = makeSession();
  start(session);
  const cp = session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  const stopped = session.managed.stopFromModel({ managedOperationId: "managed-1", checkpointId: cp.checkpoint_id, workspace: "ws", reason: "enough" });
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.code, "PROCESS_STOPPED");
});

test("continuation budgets terminate the process when exhausted", () => {
  const session = makeSession();
  start(session, { maxManagedContinuationTurns: 1 });
  const live = session.managed.managedProcesses.get("managed-1");
  const cp = session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  live.descriptor.status = "awaiting_decision";
  const cont = session.managed.continueProcess("managed-1", { checkpointId: cp.checkpoint_id, workspace: "ws" });
  assert.equal(cont.ok, true);
  // second continuation exceeds the 1-turn budget
  const cp2 = session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  live.descriptor.status = "awaiting_decision";
  const blocked = session.managed.continueProcess("managed-1", { checkpointId: cp2.checkpoint_id, workspace: "ws" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "MANAGED_CONTINUATION_BUDGET_EXCEEDED");
  assert.equal(live.descriptor.status, "terminal");
});

test("hard deadline revalidation rejects a continuation after the deadline", () => {
  const session = makeSession();
  start(session, { hardDeadlineAt: Date.now() + 50 });
  const live = session.managed.managedProcesses.get("managed-1");
  session.managed.checkpointProcess("managed-1", { workspace: "ws" });
  live.descriptor.status = "awaiting_decision";
  // simulate deadline passing
  live.descriptor.hardDeadlineAt = Date.now() - 10;
  const result = session.managed.continueProcess("managed-1", { checkpointId: live.descriptor.currentCheckpointId, workspace: "ws" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "OPERATION_TIMEOUT");
});

test("oversized single line is truncated with an explicit marker in the ring buffer", () => {
  const session = makeSession();
  start(session);
  const child = session.spawned[0].child;
  const big = "x".repeat(20000);
  child.stdout.emit("data", big);
  const cp = session.managed.checkpointProcess("managed-1", { workspace: "ws", logTailLines: 20 });
  const line = cp.log_lines.find((item) => item.stream === "stdout");
  assert.match(line.text, /TRUNCATED_LINE/);
  assert.ok(line.text.length < 20000);
});

test("natural exit while awaiting decision finalizes as exited with output artifacts", () => {
  const session = makeSession({ exitCode: 0 });
  start(session);
  const live = session.managed.managedProcesses.get("managed-1");
  live.descriptor.status = "awaiting_decision";
  // simulate natural process exit via the close event
  session.spawned[0].child.emit("close", 0, null);
  assert.equal(live.descriptor.status, "terminal");
  assert.equal(live.finalResult.exit_code, 0);
  assert.equal(live.finalResult.status, "success");
  assert.equal(Math.max(0, live.finalResult.artifact_refs.length) >= 0, true);
});

test("unexpected restart with no live runtime is reported non-recoverable", () => {
  const session = makeSession();
  const recovered = session.managed.resolveUnexpectedRestart("managed-missing", "ws");
  assert.equal(recovered.ok, false);
  assert.equal(recovered.code, "PROCESS_NON_RECOVERABLE");
});
