"use strict";

const childProcess = require("node:child_process");

const PROCESS_TREE_KILL_GRACE_MS = 2000;
const PROCESS_TREE_KILL_POLL_MS = 50;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsAlive(processKill, pid) {
  if (!Number(pid)) return false;
  try {
    processKill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function childHasExited(child) {
  return child != null && (child.exitCode != null || child.signalCode != null);
}

function isProcessDead(child, pid, isAlive) {
  if (childHasExited(child)) return true;
  if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) return true;
  return false;
}

function uniquePositivePids(child, tree) {
  return [...new Set([child?.pid, ...(Array.isArray(tree?.pids) ? tree.pids : [])]
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0))];
}

function sendPosixSignal(child, pid, signal, processKill) {
  try {
    if (Number.isInteger(pid) && pid > 0) {
      processKill(-pid, signal);
      return;
    }
  } catch {
    /* No detached process group; fall back to the direct child. */
  }
  try { child?.kill?.(signal); } catch { /* Process already exited. */ }
}

async function waitUntilDead(child, pid, { isAlive, sleep, graceMs, pollMs }) {
  const deadline = Date.now() + Math.max(0, Number(graceMs) || 0);
  while (!isProcessDead(child, pid, isAlive) && Date.now() < deadline) {
    await sleep(Math.max(1, Number(pollMs) || PROCESS_TREE_KILL_POLL_MS));
  }
  return isProcessDead(child, pid, isAlive);
}

async function terminateProcessTree(child, tree = null, options = {}) {
  try {
    if (!child?.pid) return;
    const platform = options.platform || process.platform;
    const processKill = options.processKill || process.kill.bind(process);
    const spawnImpl = options.spawnImpl || childProcess.spawn;
    const isAlive = options.isAlive || ((pid) => defaultIsAlive(processKill, pid));
    const sleep = options.sleep || defaultSleep;
    const graceMs = options.graceMs == null ? PROCESS_TREE_KILL_GRACE_MS : Number(options.graceMs);
    const pollMs = options.pollMs == null ? PROCESS_TREE_KILL_POLL_MS : Number(options.pollMs);
    const pid = Number(child.pid);

    if (platform === "win32") {
      try {
        for (const targetPid of uniquePositivePids(child, tree)) {
          try {
            const killer = spawnImpl("taskkill.exe", ["/PID", String(targetPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            killer.unref?.();
          } catch {
            /* taskkill spawn failure must not reject */
          }
        }
      } catch {
        /* Wait for death even when taskkill cannot start. */
      }
      await waitUntilDead(child, pid, { isAlive, sleep, graceMs, pollMs });
      return;
    }

    sendPosixSignal(child, pid, "SIGTERM", processKill);
    const dead = await waitUntilDead(child, pid, { isAlive, sleep, graceMs, pollMs });
    // tree.alive must not drive the wait. After the wait, SIGKILL if death was
    // not observed; a stale tree.alive is only a hint when isAlive/exit are
    // inconclusive (still not dead).
    if (!dead || (tree?.alive === true && !isProcessDead(child, pid, isAlive))) {
      sendPosixSignal(child, pid, "SIGKILL", processKill);
    }
  } catch {
    /* Resolves for ESRCH, already-exited children, and taskkill spawn failure. */
  }
}

module.exports = {
  PROCESS_TREE_KILL_GRACE_MS,
  PROCESS_TREE_KILL_POLL_MS,
  terminateProcessTree,
};
