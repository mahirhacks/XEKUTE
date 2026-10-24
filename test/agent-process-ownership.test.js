"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { createDurableProcessManager, createEncryptedProcessHandleStore } = require("../src/app/services/terminal/durable-process-manager.js");
const { terminateProcessTree } = require("../src/app/services/terminal/terminate-process-tree.js");

function fixture(t) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-process-owner-"));
  const workspace = path.join(baseDir, "workspace");
  fs.mkdirSync(workspace);
  const key = crypto.randomBytes(32);
  const protector = {
    available: () => true,
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt(value) {
      const data = Buffer.from(value, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
  const handleStore = createEncryptedProcessHandleStore({ baseDir: path.join(baseDir, "protected"), protector });
  const children = [];
  const killed = [];
  function child() {
    const value = new EventEmitter();
    value.pid = 999001 + children.length;
    value.exitCode = null;
    value.signalCode = null;
    value.unref = () => {};
    value.kill = () => {};
    children.push(value);
    return value;
  }
  function manager(overrides = {}) {
    return createDurableProcessManager({
      handleStore,
      resolveWorkspaceTarget: (root) => ({ root, target: root }),
      spawnProcess: child,
      sampleTree: async () => ({ alive: true, pids: [] }),
      terminateProcessTree: async (target, tree) => {
        assert.equal(tree, null, "cached descendant PIDs must not be passed to termination");
        killed.push(target);
        target.signalCode = "SIGTERM";
        target.emit("exit", null, "SIGTERM");
      },
      ...overrides,
    });
  }
  t.after(() => {
    for (const value of children) { value.exitCode = 0; value.emit("exit", 0, null); }
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
  const input = { executable: process.execPath, args: ["-e", ""], env: { PRIVATE_EXAMPLE: "do-not-persist-this-secret" } };
  return { baseDir, workspace, handleStore, manager, children, killed, input };
}

test("Stop scopes exact task, chat and workspace ownership", async (t) => {
  const f = fixture(t);
  const manager = f.manager();
  const a = await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  const b = await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "independent" });
  const c = await manager.start(f.workspace, f.input, { sessionId: "chat-b", runId: "main" });
  const result = await manager.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.stopped, [a.value.processId]);
  assert.equal(f.killed.length, 1);
  assert.equal((await manager.status(f.workspace, { process_id: b.value.processId })).value.status, "running");
  assert.equal((await manager.status(f.workspace, { process_id: c.value.processId })).value.status, "running");
  assert.equal((await manager.stop(f.workspace, { process_id: b.value.processId }, { sessionId: "chat-a", runId: "main" })).error.code, "PROCESS_SCOPE_MISMATCH");
  assert.equal((await manager.status(f.workspace, { process_id: b.value.processId }, { sessionId: "chat-b" })).error.code, "PROCESS_SCOPE_MISMATCH");
  assert.equal((await manager.stopOwned({ workspace: f.workspace })).error.code, "PROCESS_STOP_SCOPE_REQUIRED");
  assert.equal((await manager.stopOwned({ workspace: path.join(f.baseDir, "other"), sessionId: "chat-a" })).value.stopped.length, 0);
});

test("Stop cancels starting and queued commands before any spawn", async (t) => {
  const f = fixture(t);
  const manager = f.manager();
  const starting = manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  await manager.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" });
  assert.equal((await starting).error.code, "PROCESS_STOPPED");
  assert.equal(f.children.length, 0);
  for (let index = 0; index < 3; index++) await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  const queued = await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  assert.equal(queued.value.status, "queued");
  const result = await manager.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" });
  assert.equal(result.ok, true);
  assert.equal(f.children.length, 3);
  assert.equal((await manager.status(f.workspace, { process_id: queued.value.processId })).value.status, "stopped");
});

test("metadata survives cold reopen but a restored PID never authorizes Stop or replay", async (t) => {
  const f = fixture(t);
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "tool-round-1-call-1" };
  const started = await f.manager().start(f.workspace, f.input, runtime);
  let sampleCalls = 0;
  const cold = f.manager({ sampleTree: async () => { sampleCalls++; return { alive: true, pids: [999001] }; } });
  const listed = await cold.list(f.workspace, {}, runtime);
  assert.equal(listed.value.processes[0].status, "reconciliation_required");
  assert.equal(listed.value.processes[0].alive, null);
  assert.equal(listed.value.processes[0].replaySafe, false);
  assert.deepEqual(await cold.reconcile(f.workspace), [started.value.processId]);
  assert.equal((await cold.status(f.workspace, { process_id: started.value.processId }, runtime)).value.outputCompleteness, "unknown");
  const stopped = await cold.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" });
  assert.equal(stopped.ok, false);
  assert.deepEqual(stopped.value.unresolved, [started.value.processId]);
  assert.equal((await cold.start(f.workspace, f.input, runtime)).error.code, "PROCESS_RECONCILIATION_REQUIRED");
  assert.equal(f.children.length, 1);
  assert.equal(f.killed.length, 0);
  assert.ok(sampleCalls > 0, "liveness is checked only to settle handles whose process exited");
  assert.equal((await cold.list(f.workspace, {}, runtime)).value.processes[0].status, "reconciliation_required", "a live PID is not ownership evidence");
  const raw = fs.readFileSync(path.join(f.baseDir, "protected", fs.readdirSync(path.join(f.baseDir, "protected"))[0]), "utf8");
  assert.equal(raw.includes("chat-a"), false);
  assert.equal(raw.includes("do-not-persist-this-secret"), false);
  assert.equal(raw.includes("PRIVATE_EXAMPLE"), false);
  const metadata = f.handleStore.read(f.workspace)[0];
  assert.equal(metadata.sessionId, "chat-a");
  assert.equal(metadata.runId, "main");
  assert.equal("command" in metadata, false);
  assert.equal("stdout" in metadata, false);
  assert.equal("env" in metadata, false);
});

test("same operation ID reuses a live handle and rejects changed command arguments", async (t) => {
  const f = fixture(t);
  const manager = f.manager();
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "stable-op" };
  const first = manager.start(f.workspace, f.input, runtime);
  const second = manager.start(f.workspace, f.input, runtime);
  assert.equal((await first).value.processId, (await second).value.processId);
  assert.equal((await manager.start(f.workspace, f.input, runtime)).value.reused, true);
  assert.equal(f.children.length, 1);
  assert.equal((await manager.start(f.workspace, { ...f.input, args: ["different"] }, runtime)).error.code, "PROCESS_OPERATION_CONFLICT");
});

test("command references project existing execution records across chats without granting process control", async t => {
  const f = fixture(t);
  const manager = f.manager();
  const first = await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "one" });
  const second = await manager.start(f.workspace, f.input, { sessionId: "chat-b", runId: "two" });
  const rows = manager.referenceCommands(f.workspace);
  assert.deepEqual(new Set(rows.map(row => row.id)), new Set([first.value.processId, second.value.processId]));
  assert.ok(rows.every(row => row.running === true));
  assert.deepEqual(manager.referenceCommands(path.join(f.workspace, "other")), []);
  assert.equal(manager.readReferenceCommand(path.join(f.workspace, "other"), first.value.processId), null);
  assert.ok(manager.readReferenceCommand(f.workspace, first.value.processId));
  const denied = await manager.stop(f.workspace, { process_id: second.value.processId }, { sessionId: "chat-a", runId: "one" });
  assert.equal(denied.error.code, "PROCESS_SCOPE_MISMATCH");
  assert.equal(f.killed.length, 0);
});

test("tampered encrypted metadata rejects a cold launch without replacing the saved file", async (t) => {
  const f = fixture(t);
  await f.manager().start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  const directory = path.join(f.baseDir, "protected");
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  const payload = Buffer.from(envelope.payload, "base64");
  payload[payload.length - 1] ^= 1;
  envelope.payload = payload.toString("base64");
  const changed = JSON.stringify(envelope);
  fs.writeFileSync(file, changed);
  const result = await f.manager().start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
  assert.equal(result.error.code, "PROCESS_METADATA_READ_FAILED");
  assert.equal(f.children.length, 1);
  assert.equal(fs.readFileSync(file, "utf8"), changed);
});

test("unavailable encryption, corrupt metadata and failed writes reject before launch", async (t) => {
  const f = fixture(t);
  for (const handleStore of [
    createEncryptedProcessHandleStore({ baseDir: path.join(f.baseDir, "unavailable"), protector: { available: () => false } }),
    { read() { throw new Error("corrupt"); }, write() { throw new Error("never"); } },
    { read: () => [], write: () => ({ ok: true, encrypted: false, durable: false }) },
  ]) {
    const result = await f.manager({ handleStore }).start(f.workspace, f.input, { sessionId: "chat-a", runId: "main" });
    assert.equal(result.ok, false);
    assert.match(result.error.code, /PROCESS_METADATA_(READ|WRITE)_FAILED/);
  }
  assert.equal(f.children.length, 0);
});

test("a write failure after spawn retains a known handle and prevents blind replay", async (t) => {
  const f = fixture(t);
  let writes = 0;
  const handleStore = { read: () => [], write() { writes++; if (writes >= 2) throw new Error("disk full"); return { ok: true, encrypted: true, durable: true }; } };
  const manager = f.manager({ handleStore });
  const result = await manager.start(f.workspace, f.input, { sessionId: "chat-a", runId: "main", operationId: "stable-op" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROCESS_METADATA_WRITE_FAILED");
  assert.equal(f.killed.length, 1);
  assert.equal(f.children.length, 1);
});

test("failed metadata save and failed cleanup keep the child owned for a later Stop", async (t) => {
  const f = fixture(t);
  let writes = 0;
  let cleanupFails = true;
  const handleStore = { read: () => [], write() { if (++writes === 2) throw new Error("disk full"); return { ok: true, encrypted: true, durable: true }; } };
  const manager = f.manager({ handleStore, terminateProcessTree: async (child) => {
    if (cleanupFails) throw new Error("cannot terminate yet");
    child.signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
  } });
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "stable-op" };
  const result = await manager.start(f.workspace, f.input, runtime);
  assert.equal(result.error.code, "PROCESS_METADATA_WRITE_FAILED");
  assert.equal((await manager.list(f.workspace, {}, runtime)).value.processes[0].status, "running");
  assert.equal((await manager.start(f.workspace, f.input, runtime)).value.reused, true);
  assert.equal(f.children.length, 1);
  cleanupFails = false;
  assert.equal((await manager.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" })).ok, true);
});

test("explicit task Stop terminates an actual child after observation wait detaches", async (t) => {
  const f = fixture(t);
  const manager = f.manager({ spawnProcess: require("node:child_process").spawn, terminateProcessTree, sampleTree: require("../src/app/services/terminal/process-tree-sampler.js").sampleProcessTree });
  const signal = new AbortController();
  const started = await manager.run(f.workspace, { executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], wait_ms: 0 }, { sessionId: "chat-a", runId: "main", signal: signal.signal });
  assert.equal(started.ok, true);
  signal.abort();
  assert.equal((await manager.status(f.workspace, { process_id: started.value.processId, wait_ms: 1 }, { signal: signal.signal })).value.status, "running");
  const result = await manager.stopOwned({ workspace: f.workspace, sessionId: "chat-a", runId: "main" });
  assert.equal(result.ok, true);
  assert.equal((await manager.status(f.workspace, { process_id: started.value.processId })).value.status, "stopped");
});

test("a restored handle whose process exited settles instead of blocking", async (t) => {
  const f = fixture(t);
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "tool-round-1-call-1" };
  const started = await f.manager().start(f.workspace, f.input, runtime);
  const cold = f.manager({ sampleTree: async () => ({ alive: false, pids: [] }) });
  assert.deepEqual(await cold.reconcile(f.workspace), [started.value.processId]);
  const status = (await cold.status(f.workspace, { process_id: started.value.processId }, runtime)).value;
  assert.equal(status.status, "finished_unknown");
  assert.equal(f.handleStore.read(f.workspace)[0].terminationReason, "host_restart_exited");
  assert.notEqual((await cold.start(f.workspace, f.input, { ...runtime, operationId: "tool-round-2-call-1" })).error?.code, "PROCESS_RECONCILIATION_REQUIRED");
  assert.equal(f.killed.length, 0);
});

test("stopping a restored handle settles it only when its process exited", async (t) => {
  const f = fixture(t);
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "tool-round-1-call-1" };
  const started = await f.manager().start(f.workspace, f.input, runtime);
  let alive = true;
  const cold = f.manager({ sampleTree: async () => ({ alive, pids: [] }) });
  const refused = await cold.stop(f.workspace, { process_id: started.value.processId }, runtime);
  assert.equal(refused.error.code, "PROCESS_IDENTITY_UNPROVEN");
  alive = false;
  const settled = await cold.stop(f.workspace, { process_id: started.value.processId }, runtime);
  assert.equal(settled.ok, true);
  assert.equal(settled.value.status, "finished_unknown");
  assert.equal(f.killed.length, 0, "a restored PID is never signalled");
});

test("the operator can release a restored handle whose PID is still in use", async (t) => {
  const f = fixture(t);
  const runtime = { sessionId: "chat-a", runId: "main", operationId: "tool-round-1-call-1" };
  const started = await f.manager().start(f.workspace, f.input, runtime);
  const cold = f.manager({ sampleTree: async () => ({ alive: true, pids: [] }) });
  await cold.reconcile(f.workspace);
  assert.equal((await cold.list(f.workspace, {})).value.processes[0].status, "reconciliation_required");
  const released = await cold.releaseUnreconciled(f.workspace);
  assert.deepEqual(released.value.released, [{ processId: started.value.processId, pid: 999001, stillRunning: true }]);
  assert.equal((await cold.list(f.workspace, {})).value.processes[0].status, "finished_unknown");
  assert.equal(f.handleStore.read(f.workspace)[0].terminationReason, "operator_released");
  assert.equal(f.killed.length, 0, "releasing never signals the PID");
  assert.deepEqual((await cold.releaseUnreconciled(f.workspace)).value.released, []);
});
