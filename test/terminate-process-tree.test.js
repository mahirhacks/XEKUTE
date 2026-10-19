"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
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

test("POSIX keeps killing a detached group after its root exits", async () => {
  const signals = [];
  let groupAlive = true;
  const child = { pid: 4242, exitCode: null, signalCode: null };
  await terminateProcessTree(child, null, {
    platform: "linux",
    processKill(pid, signal) {
      if (signal === 0) {
        if (pid === -4242 && groupAlive) return;
        const error = new Error("ESRCH");
        error.code = "ESRCH";
        throw error;
      }
      signals.push(`${pid}:${signal}`);
      if (signal === "SIGTERM") child.exitCode = 0;
      if (signal === "SIGKILL") groupAlive = false;
    },
    isAlive: () => false,
    sleep: async () => {},
    graceMs: 5,
    pollMs: 1,
  });
  assert.deepEqual(signals, ["-4242:SIGTERM", "-4242:SIGKILL"]);
  assert.equal(groupAlive, false);
});

test("a detached descendant is killed when its root exits on SIGTERM", { skip: process.platform !== "linux" }, async () => {
  const descendantScript = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
  const rootScript = `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: "ignore" }); process.stdout.write(String(child.pid) + "\\n"); setInterval(() => {}, 1000);`;
  const root = spawn(process.execPath, ["-e", rootScript], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  let descendantPid;
  try {
    const pidText = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The child did not report its descendant PID.")), 2000);
      root.once("error", reject);
      root.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        resolve(String(chunk).trim());
      });
    });
    descendantPid = Number(pidText);
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);

    await terminateProcessTree(root, null, { graceMs: 75, pollMs: 5 });

    const deadline = Date.now() + 2000;
    let descendantRunning = true;
    while (descendantRunning && Date.now() < deadline) {
      try {
        process.kill(descendantPid, 0);
        const stat = fs.readFileSync(`/proc/${descendantPid}/stat`, "utf8");
        descendantRunning = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[0] !== "Z";
      } catch {
        descendantRunning = false;
      }
      if (descendantRunning) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(descendantRunning, false, `descendant ${descendantPid} was still running`);
  } finally {
    try { process.kill(-root.pid, "SIGKILL"); } catch { /* group is already gone */ }
    if (descendantPid) try { process.kill(descendantPid, "SIGKILL"); } catch { /* descendant is already gone */ }
  }
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
