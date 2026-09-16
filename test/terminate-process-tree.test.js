"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PROCESS_TREE_KILL_GRACE_MS,
  terminateProcessTree,
} = require("../src/app/services/terminal/terminate-process-tree.js");

function collectKillSignals() {
  const signals = [];
  return {
    signals,
    processKill(pid, signal) {
      if (signal === 0) {
        const error = new Error("ESRCH");
        error.code = "ESRCH";
        throw error;
      }
      signals.push(`${pid}:${signal}`);
    },
  };
}

test("production grace default is 2000ms", () => {
  assert.equal(PROCESS_TREE_KILL_GRACE_MS, 2000);
});

test("POSIX SIGTERM then SIGKILL when the child stays alive", async () => {
  const { signals, processKill } = collectKillSignals();
  let alive = true;
  const child = { pid: 4242, kill(signal) { signals.push(`child:${signal}`); } };
  await terminateProcessTree(child, null, {
    platform: "linux",
    processKill,
    isAlive: () => alive,
    graceMs: 25,
    pollMs: 5,
  });
  assert.deepEqual(signals, ["-4242:SIGTERM", "-4242:SIGKILL"]);
});

test("POSIX SIGTERM only when the child dies during the wait", async () => {
  const signals = [];
  let alive = true;
  const child = { pid: 4242, exitCode: null, signalCode: null, kill(signal) { signals.push(`child:${signal}`); } };
  await terminateProcessTree(child, null, {
    platform: "linux",
    processKill(pid, signal) {
      if (signal === 0) {
        if (!alive) {
          const error = new Error("ESRCH");
          error.code = "ESRCH";
          throw error;
        }
        return;
      }
      signals.push(`${pid}:${signal}`);
      if (signal === "SIGTERM") alive = false;
    },
    isAlive: () => alive,
    graceMs: 40,
    pollMs: 5,
  });
  assert.deepEqual(signals, ["-4242:SIGTERM"]);
});

test("stale tree.alive does not pin the wait after isAlive is false", async () => {
  const signals = [];
  const child = { pid: 4242, exitCode: 0, signalCode: null, kill(signal) { signals.push(`child:${signal}`); } };
  const startedAt = Date.now();
  await terminateProcessTree(child, { alive: true, pids: [4242] }, {
    platform: "linux",
    processKill(pid, signal) {
      if (signal === 0) {
        const error = new Error("ESRCH");
        error.code = "ESRCH";
        throw error;
      }
      signals.push(`${pid}:${signal}`);
    },
    isAlive: () => false,
    graceMs: 2000,
    pollMs: 50,
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 400, `stale tree.alive pinned the wait for ${elapsed}ms`);
  assert.deepEqual(signals, ["-4242:SIGTERM"]);
});

test("Windows taskkill waits and does not send SIGKILL", async () => {
  const spawned = [];
  const signals = [];
  const child = { pid: 99, kill(signal) { signals.push(`child:${signal}`); } };
  await terminateProcessTree(child, { pids: [99, 100] }, {
    platform: "win32",
    spawnImpl(cmd, args, opts) {
      spawned.push({ cmd, args, opts });
      return { unref() {} };
    },
    processKill(pid, signal) {
      signals.push(`${pid}:${signal}`);
      if (signal === 0) {
        const error = new Error("ESRCH");
        error.code = "ESRCH";
        throw error;
      }
    },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
  });
  assert.equal(spawned.length, 2);
  for (const item of spawned) {
    assert.equal(item.cmd, "taskkill.exe");
    assert.deepEqual(item.args.slice(0, 1), ["/PID"]);
    assert.ok(item.args.includes("/T"));
    assert.ok(item.args.includes("/F"));
    assert.equal(item.opts.windowsHide, true);
    assert.equal(item.opts.stdio, "ignore");
  }
  assert.equal(signals.some((entry) => String(entry).includes("SIGKILL")), false);
});

test("helper resolves when processKill throws ESRCH", async () => {
  await terminateProcessTree({ pid: 7, kill() { throw new Error("gone"); } }, null, {
    platform: "linux",
    processKill() {
      const error = new Error("ESRCH");
      error.code = "ESRCH";
      throw error;
    },
    isAlive: () => false,
    graceMs: 10,
    pollMs: 5,
  });
});

test("waitUntilDead does not consult tree.alive", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/app/services/terminal/terminate-process-tree.js"), "utf8");
  const waitFn = source.slice(source.indexOf("async function waitUntilDead"), source.indexOf("async function terminateProcessTree"));
  assert.doesNotMatch(waitFn, /tree\.alive/);
});
