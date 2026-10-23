"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { normalizeRunControl, validateRunControl, emptyRunControl, createTask } = require("../src/agent/runtime/session-input.js");
const { sessionFixture } = require("./helpers/agent-session-store.js");

test("encrypted receipt preserves exact input and retries return the same sequence", async (t) => {
  const f = sessionFixture(t);
  const input = { id: "message:arial", text: "And make sure the report uses Arial font.\nKeep the original title." };
  const first = await f.supervisor.receive({ ...f, input });
  const again = await f.supervisor.receive({ ...f, input });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.durable, true);
  assert.equal(first.encrypted, true);
  assert.deepEqual(again.value, { messageId: input.id, sequence: 1, duplicate: true, status: "received" });
  const snapshot = f.open().supervisor.snapshot(f);
  assert.equal(snapshot.control.arrival, 1);
  assert.equal(snapshot.batch[0].text, input.text);
  assert.doesNotMatch(fs.readFileSync(f.store.sessionFile(f.workspace, f.sessionId), "utf8"), /Arial font/);
  assert.equal(f.store.load(f.workspace).sessions[0].history.length, 0);
});

test("an ID conflict and oversized prompt do not overwrite the durable journal", async (t) => {
  const f = sessionFixture(t);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Original" } });
  assert.equal((await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Different" } })).code, "MESSAGE_ID_CONFLICT");
  assert.equal((await f.supervisor.receive({ ...f, input: { id: "message:2", text: "x".repeat(100001) } })).code, "SESSION_INPUT_INVALID");
  assert.deepEqual(f.supervisor.snapshot(f).batch.map((entry) => entry.text), ["Original"]);
});

test("routes and task revisions commit together and survive restart", async (t) => {
  const f = sessionFixture(t);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Build a page" } });
  await f.supervisor.receive({ ...f, input: { id: "message:2", text: "Make it dark" } });
  const task = (await f.supervisor.startTask({ ...f, task: { taskId: "task:page", runId: "run:page", kind: "primary" } })).value;
  const accepted = await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, routes: ["message:1", "message:2"].map((messageId) => ({ messageId, taskId: task.id, expectedRevision: 0 })) });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const state = f.open().supervisor.snapshot(f).control;
  assert.equal(state.routed, 2);
  assert.equal(state.tasks[0].revision, 2);
  assert.deepEqual(state.tasks[0].deliveries.map((delivery) => delivery.messageId), ["message:1", "message:2"]);
  const duplicateAcceptance = await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, routes: [{ messageId: "message:1", taskId: task.id, expectedRevision: 0 }] });
  assert.equal(duplicateAcceptance.code, "ROUTING_SNAPSHOT_STALE");
});

test("invalid route acceptance does not leave a partial task or advance the cursor", async (t) => {
  const f = sessionFixture(t);
  await f.supervisor.receive({ ...f, input: { id: "message:1", text: "Report" } });
  const result = await f.supervisor.acceptRouting({ ...f, expectedRouted: 0, cancellationEpoch: 0, tasks: [createTask({ taskId: "task:report", runId: "run:report" })], routes: [{ messageId: "wrong", taskId: "task:report", expectedRevision: 0 }] });
  assert.equal(result.ok, false);
  const control = f.open().supervisor.snapshot(f).control;
  assert.equal(control.routed, 0);
  assert.equal(control.tasks.length, 0);
});

test("malformed control state is rejected rather than reset to an empty journal", () => {
  const state = emptyRunControl(); state.arrival = 1;
  assert.throws(() => normalizeRunControl(state), { code: "SESSION_CONTROL_INVALID" });
  assert.throws(() => normalizeRunControl({ ...emptyRunControl(), version: 2 }), { code: "SESSION_CONTROL_INVALID" });
});

test("validation leaves control ownership and recovery to the normalizer", () => {
  const state = emptyRunControl();
  state.tasks = [createTask({ taskId: "task:independent", runId: "run:independent", kind: "independent" })];
  const before = structuredClone(state);
  validateRunControl(state);
  assert.deepEqual(state, before);
  const recovered = normalizeRunControl(state);
  assert.equal(recovered.tasks[0].status, "stopped");
  assert.deepEqual(state, before, "recovery does not mutate its source");
  assert.throws(() => validateRunControl({ ...state, version: 2 }), { code: "SESSION_CONTROL_INVALID" });
});

test("recovery rejects cycles and routed input without matching task delivery", () => {
  const state = emptyRunControl();
  state.tasks = [createTask({ taskId: "task:a", runId: "run:a", kind: "dependent", dependencyOfTaskId: "task:b" }), createTask({ taskId: "task:b", runId: "run:b", kind: "dependent", dependencyOfTaskId: "task:a" })];
  assert.throws(() => normalizeRunControl(state), { code: "SESSION_DEPENDENCY_INVALID" });
  state.tasks = [createTask({ taskId: "task:a", runId: "run:a", kind: "independent" })];
  state.inputs = [{ id: "message:1", sequence: 1, text: "Original" }]; state.arrival = 1; state.routed = 1;
  state.routes = [{ taskId: "task:a", messageId: "message:1", sequence: 1, revision: 1 }];
  assert.throws(() => normalizeRunControl(state), { code: "SESSION_ROUTE_INVALID" });
});
