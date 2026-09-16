"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Store = require("./intelligence-store.js");
const { sourceFilesForWorkspace, indexWorkspaceSync } = require("./intelligence-indexer.js");
const { createAssessmentKnowledgeEngine } = require("../knowledge/assessment-knowledge-engine.js");

function createAssessmentIntelligenceService({ onEvent = () => {}, mcpRuntime = null } = {}) {
  const jobs = new Map();
  const evidenceJobs = new Map();
  const databases = new Map();
  const runtimeEvidence = new Map();
  const knowledge = createAssessmentKnowledgeEngine({ mcpRuntime });

  function rootOf(workspace) { return path.resolve(String(workspace || "")); }
  function indexPath(_workspace) { return ":memory:"; }
  function databaseFor(workspace, { create = false } = {}) {
    const root = rootOf(workspace);
    if (databases.has(root)) return databases.get(root);
    if (!create) return null;
    const db = Store.openDatabase(":memory:");
    databases.set(root, db);
    return db;
  }
  function estimateSources(workspace) {
    const root = rootOf(workspace);
    const sources = [];
    for (const [relativePath, kind] of sourceFilesForWorkspace(root)) {
      const target = path.join(root, ...relativePath.split("/"));
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) continue;
        sources.push({ path: relativePath, kind, bytes: stat.size, estimatedRecords: Math.max(1, Math.ceil(stat.size / (relativePath.endsWith(".jsonl") ? 350 : 1_024))) });
      } catch { /* source is optional */ }
    }
    return {
      sourceCount: sources.length,
      estimatedRecordCount: sources.reduce((sum, source) => sum + source.estimatedRecords, 0),
      estimatedBytes: sources.reduce((sum, source) => sum + source.bytes, 0),
      sources,
    };
  }
  function status(workspace) {
    const root = rootOf(workspace);
    const job = jobs.get(root);
    const estimate = estimateSources(root);
    if (job) return { ok: true, status: job.status, progress: job.progress || null, path: ":memory:", estimate };
    const db = databaseFor(root);
    if (!db) return { ok: true, status: "not_built", path: ":memory:", overview: null, estimate };
    try {
      const overview = Store.overview(db);
      const meta = Store.readMeta(db);
      return { ok: true, status: meta.status === "paused" ? "paused" : meta.status === "indexing" ? "running" : "ready", path: ":memory:", overview, estimate };
    } catch (error) {
      return { ok: false, status: "corrupt", path: ":memory:", error: error.message, code: "INTELLIGENCE_CORRUPT" };
    }
  }

  function start(workspace, options = {}) {
    const root = rootOf(workspace);
    if (!root || !fs.existsSync(root)) return Promise.resolve({ ok: false, error: "Assessment workspace does not exist.", code: "WORKSPACE_NOT_FOUND" });
    const existing = jobs.get(root);
    if (existing && ["queued", "running"].includes(existing.status)) return Promise.resolve({ ok: true, status: existing.status, path: ":memory:" });
    if (existing && existing.status === "paused" && !options.resume) return Promise.resolve({ ok: true, status: "paused", path: ":memory:" });
    if (existing && existing.status === "paused") jobs.delete(root);
    const job = { status: "queued", progress: { source: "", records: 0, total: 0 }, worker: null, completion: null };
    jobs.set(root, job);
    const emit = (payload) => onEvent({ workspace: root, ...payload });
    const finish = (result) => {
      job.status = result?.status === "paused" ? "paused" : result?.ok ? "ready" : "error";
      job.result = result;
      emit({ type: "status", status: job.status, result });
      if (job.worker) job.worker = null;
      if (job.status !== "paused") jobs.delete(root);
      return result;
    };
    const db = databaseFor(root, { create: true });
    job.completion = Promise.resolve()
      .then(() => indexWorkspaceSync({ workspace: root, db, runId: options.runId, planId: options.planId, shouldPause: () => job.status === "paused", onProgress: (progress) => { job.status = "running"; job.progress = progress; emit({ type: "progress", progress }); } }))
      .then((result) => {
        replayRuntimeEvidence(root, db);
        return result;
      })
      .then(finish);
    return job.completion;
  }

  function query(workspace, input = {}) {
    if (input.domain === "knowledge" || input.operation === "knowledge") return knowledge.query(input, { workspace: rootOf(workspace), sessionId: input.sessionId || "", mode: input.mode || "agent", activateMcp: false });
    if (input.domain === "both") {
      const engagement = query(workspace, { ...input, domain: "engagement" });
      const assessment = knowledge.query(input, { workspace: rootOf(workspace), sessionId: input.sessionId || "", mode: input.mode || "agent", activateMcp: false });
      return { ok: engagement.ok !== false && assessment.ok !== false, engagement, assessment };
    }
    const db = databaseFor(workspace);
    if (!db) return { ok: false, error: "The assessment intelligence index has not been built.", code: "INTELLIGENCE_NOT_BUILT", status: "not_built", remediation: "Start the intelligence build from the assessment workspace." };
    try { return Store.query(db, input); }
    catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_QUERY_FAILED" }; }
  }

  function expand(workspace, input = {}) {
    const db = databaseFor(workspace);
    if (!db) return { ok: false, error: "The assessment intelligence index has not been built.", code: "INTELLIGENCE_NOT_BUILT" };
    try { return Store.expand(db, { ...input, workspace: rootOf(workspace) }); }
    catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_EXPAND_FAILED" }; }
  }

  function relatedEvidence(workspace, refs = []) {
    const db = databaseFor(workspace);
    if (!db) return [];
    try { return Store.relatedEvidence(db, refs, 100); }
    catch { return []; }
  }
  function recordRunEvidence(workspace, input = {}) {
    const db = databaseFor(workspace);
    if (!db) return { ok: false, code: "INTELLIGENCE_NOT_BUILT" };
    try {
      Store.recordRunEvidence(db, input);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_RUN_RECORD_FAILED" }; }
  }
  function queueEvidence(root, task) {
    const previous = evidenceJobs.get(root) || Promise.resolve();
    const next = previous.catch(() => {}).then(task).catch((error) => {
      onEvent({ workspace: root, type: "warning", code: "INTELLIGENCE_RUNTIME_EVIDENCE_FAILED", error: error.message });
      return { ok: false, error: error.message, code: "INTELLIGENCE_RUNTIME_EVIDENCE_FAILED" };
    });
    evidenceJobs.set(root, next);
    next.finally(() => { if (evidenceJobs.get(root) === next) evidenceJobs.delete(root); }).catch(() => {});
    return next;
  }
  function pendingRuntimeEvidence(root) {
    if (!runtimeEvidence.has(root)) runtimeEvidence.set(root, []);
    return runtimeEvidence.get(root);
  }
  function applyRuntimeEvidence(db, input, projection) {
    const serialized = JSON.stringify(projection.rawRecord);
    return Store.recordRuntimeEvidence(db, input, {
      sourcePath: "runtime-evidence",
      sourceOffset: 0,
      sourceLength: Buffer.byteLength(serialized, "utf8"),
      rawRecord: projection.rawRecord,
    });
  }
  function replayRuntimeEvidence(root, db) {
    if (!db) return;
    for (const item of pendingRuntimeEvidence(root)) applyRuntimeEvidence(db, item.input, item.projection);
  }
  function recordRuntimeEvidence(workspace, input = {}) {
    const root = rootOf(workspace);
    const projection = Store.runtimeEvidenceProjection(input);
    pendingRuntimeEvidence(root).push({ input, projection });
    queueEvidence(root, async () => {
      const db = databaseFor(root);
      if (!db) return { ok: true };
      return applyRuntimeEvidence(db, input, projection);
    });
    return { ok: true, evidenceIds: [projection.evidenceId], queued: true };
  }
  function completeRun(workspace, runId, status = "completed") {
    const db = databaseFor(workspace);
    if (!db) return { ok: false, code: "INTELLIGENCE_NOT_BUILT" };
    try { Store.completeRun(db, runId, status); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_RUN_COMPLETE_FAILED" }; }
  }

  function pause(workspace) {
    const job = jobs.get(rootOf(workspace));
    if (!job) return { ok: false, error: "No intelligence build is running.", code: "INTELLIGENCE_NOT_RUNNING" };
    job.status = "paused";
    try { job.worker?.postMessage?.({ type: "pause" }); } catch { /* worker checkpoint remains safe */ }
    onEvent({ workspace: rootOf(workspace), type: "status", status: "paused" });
    return { ok: true, status: "paused" };
  }

  function resume(workspace, options = {}) { return start(workspace, { ...options, resume: true }); }
  function rebuild(workspace, options = {}) {
    const root = rootOf(workspace);
    const existing = databases.get(root);
    if (existing) {
      try { existing.close(); } catch { /* ignore */ }
      databases.delete(root);
    }
    return start(workspace, options);
  }
  function refresh(workspace, options = {}) {
    const current = status(workspace);
    if (current.status !== "ready") return Promise.resolve(current);
    return start(workspace, options);
  }
  function whenIdle(workspace) {
    const job = jobs.get(rootOf(workspace));
    return job?.completion || Promise.resolve(status(workspace));
  }
  async function flush() {
    const pendingEvidence = [...evidenceJobs.values()];
    const pendingIndexes = [...jobs.values()].map((job) => job?.completion).filter(Boolean);
    const [evidenceResults, indexResults] = await Promise.all([
      Promise.all(pendingEvidence),
      Promise.all(pendingIndexes),
    ]);
    const results = [...evidenceResults, ...indexResults];
    return {
      ok: results.every((result) => result?.ok !== false),
      jobs: pendingIndexes.length,
      evidenceJobs: pendingEvidence.length,
    };
  }
  async function dispose() {
    await flush();
    for (const job of jobs.values()) { try { job.worker?.terminate(); } catch { /* ignore */ } }
    jobs.clear();
    for (const db of databases.values()) { try { db.close(); } catch { /* ignore */ } }
    databases.clear();
    runtimeEvidence.clear();
  }

  return Object.freeze({ indexPath, status, start, pause, resume, rebuild, refresh, whenIdle, query, expand, relatedEvidence, recordRunEvidence, recordRuntimeEvidence, completeRun, flush, dispose, knowledge, mcpRuntime });
}

module.exports = { createAssessmentIntelligenceService };
