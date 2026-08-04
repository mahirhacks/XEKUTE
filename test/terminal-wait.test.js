"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createBackgroundWaitRunner } = require("../src/adapters/tools/cyber/subagent-runner");
const { createToolHandlers } = require("../src/adapters/tools/core/tool-handlers");
const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const { createWorkspaceSearch } = require("../src/adapters/tools/os/workspace-search");

test("clampWaitMs accepts zero for wait-until-exit and caps long waits", () => {
  assert.equal(ToolMap.clampWaitMs(0, 60000), 0);
  assert.equal(ToolMap.clampWaitMs("0", 60000), 0);
  assert.equal(ToolMap.clampWaitMs(500, 60000), 1000);
  assert.ok(ToolMap.clampWaitMs(999999999, 60000) <= 24 * 60 * 60 * 1000);
});

test("run_command returns terminal_wait and registers a harness wait", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-term-wait-"));
  const toolProcesses = new Map();
  const events = [];
  const runner = createBackgroundWaitRunner({
    toolProcesses,
    onComplete(snapshot) { events.push(snapshot); },
  });
  const search = createWorkspaceSearch({ fs, path });
  const handlers = createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: search.resolveWorkspaceTarget,
    editWorkspaceFile: async () => ({ error: "not used" }),
    deleteWorkspaceFile: () => ({ error: "not used" }),
    buildWorkspaceIndex: search.buildWorkspaceIndex,
    searchWorkspaceIndex: search.searchWorkspaceIndex,
    findWorkspaceFiles: search.findWorkspaceFiles,
    runWorkspaceCommand: async () => ({ error: "should not sync-wait" }),
    startWorkspaceProcess: () => ({ error: "not used" }),
    readToolProcess: () => ({ error: "not used" }),
    stopToolProcess: () => ({ error: "not used" }),
    listProjectFiles: search.listProjectFiles,
    searchWeb: async () => ({ ok: true, results: [] }),
    fetchWebPage: async () => ({ ok: true, content: "" }),
    subagentRunner: runner,
  });

  toolProcesses.set("proc-1", {
    id: "proc-1",
    running: true,
    exitCode: null,
    stdout: "",
    buffer: "",
    startedAt: Date.now(),
  });

  const result = await handlers.executeToolCall({
    workspace: root,
    toolCall: {
      function: {
        name: "run_command",
        arguments: { command: "echo hello", wait_ms: 5000 },
      },
    },
    terminalHost: {
      startProcess() {
        return { ok: true, mode: "process_start", id: "proc-1", terminalId: "agent-1", command: "echo hello" };
      },
    },
  });

  assert.equal(result.mode, "terminal_wait");
  assert.equal(result.processId, "proc-1");
  assert.equal(result.waitMs, 5000);
  assert.ok(result.waitId);

  toolProcesses.set("proc-1", {
    id: "proc-1",
    running: false,
    exitCode: 0,
    stdout: "hello\n",
    buffer: "hello\n",
    startedAt: Date.now() - 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok(events.some((item) => item.type === "terminal_complete" && item.status === "complete"));
  assert.match(events.find((item) => item.type === "terminal_complete").stdout || "", /hello/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("wait_ms emits a checkpoint with ongoing log then complete when process exits", async () => {
  const toolProcesses = new Map();
  const events = [];
  const runner = createBackgroundWaitRunner({
    toolProcesses,
    onComplete(snapshot) { events.push(snapshot); },
  });

  toolProcesses.set("proc-2", {
    id: "proc-2",
    running: true,
    exitCode: null,
    stdout: "still going\n",
    buffer: "still going\n",
    startedAt: Date.now(),
  });

  runner.registerWait({
    processId: "proc-2",
    terminalId: "agent-2",
    toolName: "run_command",
    command: "sleep 30",
    waitMs: 50,
    checkpointIntervalMs: 50,
    killOnTimeout: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 700));
  const checkpoint = events.filter((item) => item.type === "terminal_checkpoint");
  assert.ok(checkpoint.length, "expected terminal_checkpoint");
  assert.equal(checkpoint[0].stillRunning, true);
  assert.match(checkpoint[0].stdout || "", /still going/);
  assert.ok(Number(checkpoint[0].elapsedMs) >= 0);
  assert.ok(checkpoint.some((item) => Number(item.checkpointCount) >= 1), "expected at least one checkpoint");

  toolProcesses.set("proc-2", {
    id: "proc-2",
    running: false,
    exitCode: 0,
    stdout: "still going\ndone\n",
    buffer: "still going\ndone\n",
    startedAt: Date.now() - 1000,
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const complete = events.find((item) => item.type === "terminal_complete");
  assert.ok(complete, "expected terminal_complete after exit");
  assert.equal(complete.status, "complete");
  assert.match(complete.stdout || "", /done/);
  assert.ok(Number(complete.elapsedMs) >= 0);
});

test("periodic checkpoints fire while the process keeps running", async () => {
  const toolProcesses = new Map();
  const events = [];
  const runner = createBackgroundWaitRunner({
    toolProcesses,
    onComplete(snapshot) { events.push(snapshot); },
  });

  toolProcesses.set("proc-3", {
    id: "proc-3",
    running: true,
    exitCode: null,
    stdout: "tick\n",
    buffer: "tick\n",
    startedAt: Date.now(),
  });

  runner.registerWait({
    processId: "proc-3",
    terminalId: "agent-3",
    toolName: "run_command",
    command: "long task",
    checkpointIntervalMs: 120,
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));
  const checkpoints = events.filter((item) => item.type === "terminal_checkpoint");
  assert.ok(checkpoints.length >= 2, `expected multiple checkpoints, got ${checkpoints.length}`);
  assert.equal(checkpoints[0].status, "running");
  assert.equal(checkpoints[0].stillRunning, true);

  toolProcesses.set("proc-3", {
    id: "proc-3",
    running: false,
    exitCode: 0,
    stdout: "tick\ndone\n",
    buffer: "tick\ndone\n",
    startedAt: Date.now() - 1000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const complete = events.find((item) => item.type === "terminal_complete");
  assert.ok(complete, "expected terminal_complete after exit");
});

test("killOnTimeout kills and finalizes when the finite budget elapses", async () => {
  const toolProcesses = new Map();
  const events = [];
  const killed = [];
  const runner = createBackgroundWaitRunner({
    toolProcesses,
    onComplete(snapshot) { events.push(snapshot); },
    killProcess: (processId, ownerId) => { killed.push({ processId, ownerId }); },
  });

  toolProcesses.set("proc-4", {
    id: "proc-4",
    running: true,
    exitCode: null,
    stdout: "",
    buffer: "",
    startedAt: Date.now(),
  });

  runner.registerWait({
    processId: "proc-4",
    terminalId: "agent-4",
    toolName: "run_command",
    command: "will hang",
    waitMs: 60,
    killOnTimeout: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.ok(killed.length >= 1, "expected killProcess to be called");
  const complete = events.find((item) => item.type === "terminal_complete");
  assert.ok(complete, "expected terminal_complete after kill");
  assert.equal(complete.timedOut, true);
});
