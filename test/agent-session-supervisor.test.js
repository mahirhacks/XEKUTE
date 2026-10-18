"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");

async function start(f, taskId = "task:report", kind = "primary", dependencyOfTaskId = "") {
  const result = await f.supervisor.startTask({ ...f, task: { taskId, runId: `run:${taskId}`, kind, objective: "Write a detailed report", dependencyOfTaskId } });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
const finish = (f, taskId, expectedRevision = 0) => f.supervisor.tryFinalize({ ...f, taskId, expectedRevision, cancellationEpoch: 0 });

test("receipt during a model await blocks finalization until input is accepted and checkpointed", async (t) => {
  const f = sessionFixture(t);
  const task = await start(f);
  const atModelStart = f.supervisor.taskSnapshot({ ...f, taskId: task.id });
  await f.supervisor.receive({ ...f, input: { id: "message:arial", text: "Use Arial font" } });
  assert.deepEqual((await finish(f, task.id)).value, { completed: false, reason: "PENDING_INPUT" });
  await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, routes: [{ messageId: "message:arial", taskId: task.id, expectedRevision: atModelStart.task.revision }] });
  assert.equal((await finish(f, task.id)).code, "FINALIZATION_STALE");
  assert.equal((await finish(f, task.id, 1)).code, "FINALIZATION_STALE");
  const delivered = f.supervisor.taskSnapshot({ ...f, taskId: task.id });
  assert.equal(delivered.deliveries[0].input.text, "Use Arial font");
  await f.supervisor.checkpointTask({ ...f, taskId: task.id, expectedRevision: 1, previousRevision: 0, engine: { accounting: { providerAttempts: 1 } } });
  assert.equal((await finish(f, task.id, 1)).value.completed, true);
});

test("input after terminal commit remains received and can start a new main task", async (t) => {
  const f = sessionFixture(t);
  const task = await start(f);
  assert.equal((await finish(f, task.id)).value.completed, true);
  await f.supervisor.receive({ ...f, input: { id: "message:next", text: "Build a different task" } });
  assert.equal((await finish(f, task.id)).value.duplicate, true);
  assert.equal(f.supervisor.snapshot(f).batch[0].id, "message:next");
  const next = await start(f, "task:next");
  assert.equal(next.id, "task:next");
});

test("dependent children hold main completion", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  const dependent = await start(f, "task:dependent", "dependent", main.id);
  assert.equal((await finish(f, main.id)).value.reason, "PENDING_DEPENDENCIES");
  await finish(f, dependent.id);
  assert.equal((await finish(f, main.id)).value.completed, true);
});

test("stopping the main task stops its dependent children and a duplicate stop does not advance the epoch", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  await start(f, "task:dependent", "dependent", main.id);
  const cancelled = await f.supervisor.cancel({ ...f, taskId: main.id });
  assert.deepEqual(cancelled.value.taskIds, [main.id, "task:dependent"]);
  assert.equal(cancelled.value.cancellationEpoch, 1);
  assert.equal((await f.supervisor.cancel({ ...f, taskId: main.id })).value.cancellationEpoch, 1);
  assert.equal((await finish(f, main.id)).code, "FINALIZATION_STALE");
});

test("stale task checkpoints cannot overwrite applied transcript revision", async (t) => {
  const f = sessionFixture(t);
  const task = await start(f);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Use Arial" } });
  await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, routes: [{ messageId: "message:1", taskId: task.id, expectedRevision: 0 }] });
  await f.supervisor.checkpointTask({ ...f, taskId: task.id, expectedRevision: 1, previousRevision: 0, engine: { accounting: { providerAttempts: 1 } } });
  const stale = await f.supervisor.checkpointTask({ ...f, taskId: task.id, expectedRevision: 0, engine: { accounting: { providerAttempts: 999 } } });
  assert.equal(stale.code, "TASK_REVISION_STALE");
  assert.deepEqual(f.supervisor.taskSnapshot({ ...f, taskId: task.id }).task.engine, { accounting: { providerAttempts: 1 } });
});

test("routing cannot create a second main task or reuse a run identity", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "A new task" } });
  const { createTask } = require("../src/agent/runtime/session-input.js");
  const other = createTask({ taskId: "task:other", runId: "run:other" });
  const proposed = { ...f, expectedRouted: 0, cancellationEpoch: 0, tasks: [other], routes: [{ messageId: "message:1", taskId: other.id, expectedRevision: 0 }] };
  assert.equal((await f.supervisor.acceptRouting(proposed)).code, "PRIMARY_TASK_BUSY");
  other.kind = "independent"; other.runId = main.runId;
  assert.equal((await f.supervisor.acceptRouting(proposed)).code, "SESSION_TASK_CONFLICT");
  assert.equal(f.supervisor.snapshot(f).control.tasks.length, 1);
  assert.equal((await f.supervisor.startTask({ ...f, task: { taskId: "task:other", runId: main.runId } })).code, "SESSION_TASK_CONFLICT");
});

test("plans must match accepted revision and delivery IDs and are invalidated by new input", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Use Arial" } });
  const proposal = { ...f, expectedRouted: 0, cancellationEpoch: 0, routes: [{ messageId: "message:1", taskId: main.id, expectedRevision: 0 }], plan: { id: "plan:1", taskId: main.id, revision: 0, messageIds: ["message:1"], result: { fullText: "Planned" } } };
  assert.equal((await f.supervisor.acceptRouting(proposal)).code, "SESSION_PLAN_INVALID");
  assert.equal(f.supervisor.snapshot(f).control.routed, 0);
  proposal.plan.revision = 1;
  assert.equal((await f.supervisor.acceptRouting(proposal)).ok, true);
  assert.equal(f.supervisor.taskSnapshot({ ...f, taskId: main.id }).task.pendingPlan.result.fullText, "Planned");
  await f.supervisor.receive({ ...f, input: { id: "message:2", text: "Use 12pt" } });
  await f.supervisor.acceptRouting({ ...f, expectedRouted: 1, cancellationEpoch: 0, routes: [{ messageId: "message:2", taskId: main.id, expectedRevision: 1 }] });
  assert.equal(f.supervisor.taskSnapshot({ ...f, taskId: main.id }).task.pendingPlan, undefined);
});

test("a task cannot checkpoint or finalize over another task's block", async (t) => {
  const f = sessionFixture(t);
  const first = await f.store.begin(f.workspace, { sessionId: f.sessionId, userPrompt: "A" });
  const second = await f.store.begin(f.workspace, { sessionId: f.sessionId, userPrompt: "B" });
  await f.supervisor.startTask({ ...f, task: { taskId: "task:a", runId: "run:a", blockId: first.blockId } });
  await f.supervisor.startTask({ ...f, task: { taskId: "task:b", runId: "run:b", kind: "independent", blockId: second.blockId } });
  const payload = { ...f, taskId: "task:a", expectedRevision: 0, blockId: second.blockId, messages: [{ role: "assistant", content: "Wrong task" }] };
  assert.equal((await f.supervisor.checkpointTask(payload)).code, "TASK_BLOCK_MISMATCH");
  assert.equal((await f.supervisor.tryFinalize({ ...payload, cancellationEpoch: 0 })).code, "TASK_BLOCK_MISMATCH");
  assert.equal(f.store.load(f.workspace).sessions[0].history.some((message) => message.content === "Wrong task"), false);
});

test("cancellation settles dispatches and stops nested dependencies", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  await f.supervisor.receive({ ...f, input: { id: "message:child", text: "Child task" } });
  const { createTask } = require("../src/agent/runtime/session-input.js");
  const child = createTask({ taskId: "task:child", runId: "run:child", kind: "dependent", dependencyOfTaskId: main.id });
  await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, tasks: [child], routes: [{ messageId: "message:child", taskId: child.id, expectedRevision: 0 }] });
  await start(f, "task:grandchild", "dependent", child.id);
  const stopped = await f.supervisor.cancel({ ...f, taskId: main.id });
  assert.deepEqual(stopped.value.taskIds, [main.id, child.id, "task:grandchild"]);
  assert.equal(f.open().supervisor.snapshot(f).control.dispatches[0].status, "failed");
});

test("terminal retries return the stored outcome and reject conflicting success", async (t) => {
  const f = sessionFixture(t);
  const main = await start(f);
  const failed = await f.supervisor.tryFinalize({ ...f, taskId: main.id, expectedRevision: 0, cancellationEpoch: 0, status: "failed" });
  assert.equal(failed.value.completed, false);
  assert.equal(failed.value.status, "failed");
  assert.equal((await finish(f, main.id)).code, "TERMINAL_STATUS_CONFLICT");
  assert.equal((await f.supervisor.tryFinalize({ ...f, taskId: main.id, expectedRevision: 0, cancellationEpoch: 0, status: "failed" })).value.duplicate, true);
});
