"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");
const { atomicWriteText } = require("./memory/memory-storage-utils.js");

function createLongHorizonRunStore({
  fsImpl = nodeFs,
  pathImpl = nodePath,
  now = () => new Date(),
} = {}) {
  const queues = new Map();
  const documents = new Map();
  const knownWorkspaces = new Set();

  function keyFor(workspace) { return pathImpl.resolve(workspace); }
  function fileFor(workspace) { return pathImpl.join(keyFor(workspace), ".xekute", "state", "long-horizon-runs.json"); }
  function backupFor(workspace) { return `${fileFor(workspace)}.bak`; }

  function emptyDocument() {
    return { schemaVersion: 1, runs: {} };
  }

  function parseDocument(raw) {
    try {
      const parsed = JSON.parse(String(raw || ""));
      if (!parsed || typeof parsed !== "object") return emptyDocument();
      return redactStructuredValue({
        schemaVersion: Number(parsed.schemaVersion) || 1,
        runs: parsed.runs && typeof parsed.runs === "object" ? parsed.runs : {},
      });
    } catch {
      return emptyDocument();
    }
  }

  function loadFromDisk(workspace) {
    const file = fileFor(workspace);
    try {
      if (fsImpl.existsSync(file)) return parseDocument(fsImpl.readFileSync(file, "utf8"));
    } catch { /* try backup */ }
    try {
      const backup = backupFor(workspace);
      if (fsImpl.existsSync(backup)) return parseDocument(fsImpl.readFileSync(backup, "utf8"));
    } catch { /* empty document */ }
    return emptyDocument();
  }

  function read(workspace) {
    const key = keyFor(workspace);
    knownWorkspaces.add(key);
    if (!documents.has(key)) documents.set(key, loadFromDisk(workspace));
    return documents.get(key);
  }

  function persist(workspace, document) {
    const redacted = redactStructuredValue(document);
    documents.set(keyFor(workspace), redacted);
    const file = fileFor(workspace);
    return new Promise((resolve) => {
      // Disk writes stay durable for awaiters, but they run on a later turn so
      // a tool result can reach the window before the file rewrite blocks it.
      setImmediate(() => {
        try {
          atomicWriteText({ fs: fsImpl, path: pathImpl }, file, `${JSON.stringify(redacted, null, 2)}\n`);
        } catch {
          // Keep the in-memory document even when the workspace is not writable.
        }
        resolve(redacted);
      });
    });
  }

  function write(workspace, document) {
    return persist(workspace, document);
  }

  function update(workspace, mutate) {
    const key = pathImpl.resolve(workspace);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const document = read(workspace);
      const result = mutate(document) || document;
      await write(workspace, document);
      return result;
    });
    queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
    return next;
  }

  function publicRecord(record = {}) {
    if (!record || typeof record !== "object") return null;
    return redactStructuredValue({
      schemaVersion: 1,
      runId: String(record.runId || ""),
      sessionId: String(record.sessionId || ""),
      workspace: String(record.workspace || ""),
      model: String(record.model || "").slice(0, 240),
      mode: String(record.mode || "agent"),
      authorityProfile: String(record.authorityProfile || "approve_for_me"),
      objective: String(record.objective || "").slice(0, 4000),
      status: String(record.status || "running"),
      segment: Number(record.segment || 0),
      round: Number(record.round || 0),
      actionCount: Number(record.actionCount || 0),
      lastHeartbeatAt: record.lastHeartbeatAt || "",
      createdAt: record.createdAt || "",
      updatedAt: record.updatedAt || "",
      checkpoint: record.checkpoint && typeof record.checkpoint === "object" ? record.checkpoint : {},
      recoveryCount: Number(record.recoveryCount || 0),
      checkpointSequence: Number(record.checkpointSequence || 0),
      resumeEligible: Boolean(record.resumeEligible),
      events: Array.isArray(record.events) ? record.events.slice(-200) : [],
    });
  }

  function begin(workspace, input = {}) {
    if (!workspace || !input.runId) return Promise.resolve(null);
    return update(workspace, (document) => {
      const stamp = now().toISOString();
      const existing = document.runs[input.runId] || {};
      document.runs[input.runId] = publicRecord({
        ...existing,
        runId: input.runId,
        sessionId: String(input.sessionId || existing.sessionId || ""),
        workspace: keyFor(workspace),
        model: String(input.model || existing.model || ""),
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
      });
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
      Object.assign(current, publicRecord({
        ...current,
        round: patch.round ?? current.round,
        actionCount: patch.actionCount ?? current.actionCount,
        status: patch.status || current.status,
        checkpoint: { ...(current.checkpoint || {}), ...(patch.checkpoint || {}) },
        lastHeartbeatAt: stamp,
        updatedAt: stamp,
        checkpointSequence: Number(current.checkpointSequence || 0) + 1,
        resumeEligible: current.status === "running" ? false : Boolean(current.resumeEligible),
      }));
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
      Object.assign(current, publicRecord({ ...current, ...patch, status, updatedAt: stamp, lastHeartbeatAt: stamp, resumeEligible: false }), { completedAt: stamp });
      current.events = Array.isArray(current.events) ? current.events : [];
      current.events.push({ type: "run_finished", at: stamp, status });
      if (current.events.length > 200) current.events.splice(0, current.events.length - 200);
      return current;
    });
  }

  function reconcile(workspace, { staleAfterMs = 24 * 60 * 60 * 1000 } = {}) {
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
  function listBySession(workspace, sessionId) {
    const sid = String(sessionId || "");
    return list(workspace).filter((run) => String(run.sessionId || "") === sid);
  }
  function listResumeEligible(workspace, sessionIds = []) {
    const requested = new Set((Array.isArray(sessionIds) ? sessionIds : []).map((value) => String(value || "")).filter(Boolean));
    return list(workspace).filter((run) => {
      if (!["interrupted", "paused", "waiting", "running"].includes(String(run.status || ""))) return false;
      if (run.status === "running" && !run.resumeEligible) return false;
      if (!run.resumeEligible && run.status !== "interrupted") return false;
      if (requested.size && run.sessionId && !requested.has(String(run.sessionId))) return false;
      return true;
    });
  }
  function known() { return [...knownWorkspaces]; }
  function heartbeat(workspace, runId, details = {}) {
    return checkpoint(workspace, runId, { status: "running", checkpoint: { heartbeat: { ...details, at: now().toISOString() } } });
  }
  function resume(workspace, runId) {
    const existing = get(workspace, runId);
    if (!existing) return Promise.resolve(null);
    const resumable = ["interrupted", "paused", "waiting"].includes(existing.status)
      || (existing.status === "running" && existing.resumeEligible);
    if (!resumable) return Promise.resolve(null);
    return begin(workspace, existing);
  }
  async function flush() { await Promise.allSettled([...queues.values()]); }
  return {
    backupFor,
    begin,
    checkpoint,
    fileFor,
    finish,
    flush,
    get,
    heartbeat,
    known,
    list,
    listBySession,
    listResumeEligible,
    read,
    reconcile,
    resume,
  };
}

module.exports = { createLongHorizonRunStore };
