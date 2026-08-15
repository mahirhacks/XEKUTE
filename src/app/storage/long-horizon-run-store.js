"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");

function createLongHorizonRunStore({ fsImpl = fs, pathImpl = path, now = () => new Date() } = {}) {
  const queues = new Map();
  function fileFor(workspace) { return pathImpl.join(pathImpl.resolve(workspace), ".xekute", "state", "long-horizon-runs.json"); }
  function backupFor(workspace) { return `${fileFor(workspace)}.bak`; }
  function read(workspace) {
    for (const candidate of [fileFor(workspace), backupFor(workspace)]) {
      try {
        const value = JSON.parse(fsImpl.readFileSync(candidate, "utf8"));
        if (value && typeof value === "object") return value;
      } catch { /* Try the crash-recovery backup. */ }
    }
    return { schemaVersion: 1, runs: {} };
  }
  function write(workspace, document) {
    const file = fileFor(workspace);
    const backup = backupFor(workspace);
    fsImpl.mkdirSync(pathImpl.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const backupTemp = `${backup}.${process.pid}.${Date.now()}.tmp`;
    fsImpl.writeFileSync(temp, `${JSON.stringify(redactStructuredValue(document), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    if (fsImpl.existsSync(file)) {
      try {
        fsImpl.copyFileSync(file, backupTemp);
        try { fsImpl.rmSync(backup, { force: true }); } catch {}
        fsImpl.renameSync(backupTemp, backup);
      } catch { try { fsImpl.rmSync(backupTemp, { force: true }); } catch {} }
    }
    try { fsImpl.renameSync(temp, file); } catch {
      try { fsImpl.rmSync(file, { force: true }); } catch {}
      fsImpl.renameSync(temp, file);
    }
    try { fsImpl.chmodSync(file, 0o600); } catch { /* Windows ACLs protect workspace state. */ }
    try { if (fsImpl.existsSync(backup)) fsImpl.chmodSync(backup, 0o600); } catch {}
  }
  function update(workspace, mutate) {
    const key = pathImpl.resolve(workspace);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(() => {
      const document = read(workspace);
      const result = mutate(document) || document;
      write(workspace, document);
      return result;
    });
    queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
    return next;
  }
  function begin(workspace, input = {}) {
    if (!workspace || !input.runId) return Promise.resolve(null);
    return update(workspace, (document) => {
      const stamp = now().toISOString();
      const existing = document.runs[input.runId] || {};
      document.runs[input.runId] = {
        schemaVersion: 1,
        runId: input.runId,
        sessionId: String(input.sessionId || existing.sessionId || ""),
        objective: String(input.objective || existing.objective || "").slice(0, 4000),
        mode: String(input.mode || existing.mode || "agent"),
        authorityProfile: String(input.authorityProfile || existing.authorityProfile || "approve_for_me"),
        status: "running",
        segment: Number(existing.segment || 0) + 1,
        round: Number(existing.round || 0),
        actionCount: Number(existing.actionCount || 0),
        lastHeartbeatAt: stamp,
        createdAt: existing.createdAt || stamp,
        updatedAt: stamp,
        checkpoint: existing.checkpoint || {},
        recoveryCount: Number(existing.recoveryCount || 0),
        checkpointSequence: Number(existing.checkpointSequence || 0),
        resumeEligible: false,
        events: Array.isArray(existing.events) ? existing.events.slice(-199) : [],
      };
      document.runs[input.runId].events.push({ type: existing.createdAt ? "run_resumed" : "run_started", at: stamp, segment: document.runs[input.runId].segment });
      return document.runs[input.runId];
    });
  }
  function checkpoint(workspace, runId, patch = {}) {
    if (!workspace || !runId) return Promise.resolve(null);
    return update(workspace, (document) => {
      const current = document.runs[runId];
      if (!current) return null;
      const stamp = now().toISOString();
      Object.assign(current, {
        round: patch.round ?? current.round,
        actionCount: patch.actionCount ?? current.actionCount,
        status: patch.status || current.status,
        checkpoint: { ...(current.checkpoint || {}), ...(patch.checkpoint || {}) },
        lastHeartbeatAt: stamp,
        updatedAt: stamp,
        checkpointSequence: Number(current.checkpointSequence || 0) + 1,
      });
      current.events = Array.isArray(current.events) ? current.events : [];
      current.events.push({ type: "checkpoint", at: stamp, sequence: current.checkpointSequence, round: current.round, actionCount: current.actionCount });
      if (current.events.length > 200) current.events.splice(0, current.events.length - 200);
      return current;
    });
  }
  function finish(workspace, runId, status, patch = {}) {
    return update(workspace, (document) => {
      const current = document.runs[runId];
      if (!current) return null;
      const stamp = now().toISOString();
      Object.assign(current, patch, { status, updatedAt: stamp, completedAt: stamp, lastHeartbeatAt: stamp, resumeEligible: false });
      current.events = Array.isArray(current.events) ? current.events : [];
      current.events.push({ type: "run_finished", at: stamp, status });
      if (current.events.length > 200) current.events.splice(0, current.events.length - 200);
      return current;
    });
  }
  function reconcile(workspace, { staleAfterMs = 30 * 60_000 } = {}) {
    return update(workspace, (document) => {
      const stamp = now();
      const reconciled = [];
      for (const run of Object.values(document.runs || {})) {
        if (run.status !== "running") continue;
        const age = stamp.getTime() - Date.parse(run.lastHeartbeatAt || run.updatedAt || run.createdAt || 0);
        if (age > staleAfterMs) {
          run.status = "interrupted";
          run.interruptedAt = stamp.toISOString();
          run.updatedAt = run.interruptedAt;
          run.resumeEligible = true;
          run.recoveryCount = Number(run.recoveryCount || 0) + 1;
          run.events = Array.isArray(run.events) ? run.events : [];
          run.events.push({ type: "run_interrupted", at: run.interruptedAt, reason: "stale_heartbeat" });
          if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
          reconciled.push(run.runId);
        }
      }
      return reconciled;
    });
  }
  function get(workspace, runId) { return read(workspace).runs?.[runId] || null; }
  function list(workspace) { return Object.values(read(workspace).runs || {}); }
  function heartbeat(workspace, runId, details = {}) {
    return checkpoint(workspace, runId, { status: "running", checkpoint: { heartbeat: { ...details, at: now().toISOString() } } });
  }
  function resume(workspace, runId) {
    const existing = get(workspace, runId);
    if (!existing || !["interrupted", "paused", "waiting"].includes(existing.status)) return Promise.resolve(null);
    return begin(workspace, existing);
  }
  async function flush() { await Promise.allSettled([...queues.values()]); }
  return { backupFor, begin, checkpoint, fileFor, finish, flush, get, heartbeat, list, read, reconcile, resume };
}

module.exports = { createLongHorizonRunStore };
