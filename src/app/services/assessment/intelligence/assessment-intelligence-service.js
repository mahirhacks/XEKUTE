"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const Store = require("./intelligence-store.js");
const { sourceFilesForWorkspace, indexWorkspaceSync, cursorFingerprint } = require("./intelligence-indexer.js");
const { createAssessmentKnowledgeEngine } = require("../knowledge/assessment-knowledge-engine.js");

function createAssessmentIntelligenceService({ onEvent = () => {}, enableWorker = true, mcpRuntime = null } = {}) {
  const jobs = new Map();
  const evidenceJobs = new Map();
  const knowledge = createAssessmentKnowledgeEngine({ mcpRuntime });
  let graphProvider = null;

  function setGraphProvider(provider) { graphProvider = provider || null; return { ok: true }; }

  function rootOf(workspace) { return path.resolve(String(workspace || "")); }
  function indexPath(workspace) { return path.join(rootOf(workspace), ".xekute", "intelligence", "index.sqlite"); }
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
    const target = indexPath(root);
    const job = jobs.get(root);
    const estimate = estimateSources(root);
    if (job) return { ok: true, status: job.status, progress: job.progress || null, path: target, estimate };
    if (!fs.existsSync(target)) return { ok: true, status: "not_built", path: target, overview: null, estimate };
    try {
      const db = Store.openDatabase(target);
      const overview = Store.overview(db);
      const meta = Store.readMeta(db);
      const result = { ok: true, status: meta.status === "paused" ? "paused" : meta.status === "indexing" ? "running" : "ready", path: target, overview, estimate };
      db.close();
      return result;
    } catch (error) {
      return { ok: false, status: "corrupt", path: target, error: error.message, code: "INTELLIGENCE_CORRUPT" };
    }
  }

  function start(workspace, options = {}) {
    const root = rootOf(workspace);
    if (!root || !fs.existsSync(root)) return Promise.resolve({ ok: false, error: "Assessment workspace does not exist.", code: "WORKSPACE_NOT_FOUND" });
    const existing = jobs.get(root);
    if (existing && ["queued", "running"].includes(existing.status)) return Promise.resolve({ ok: true, status: existing.status, path: indexPath(root) });
    if (existing && existing.status === "paused" && !options.resume) return Promise.resolve({ ok: true, status: "paused", path: indexPath(root) });
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
    if (!enableWorker) {
      job.completion = Promise.resolve().then(() => indexWorkspaceSync({ workspace: root, indexPath: indexPath(root), runId: options.runId, planId: options.planId, shouldPause: () => job.status === "paused", onProgress: (progress) => { job.status = "running"; job.progress = progress; emit({ type: "progress", progress }); } })).then(finish);
      return job.completion;
    }
    job.completion = new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, "intelligence-worker.js"), { workerData: { workspace: root, indexPath: indexPath(root), runId: options.runId || "", planId: options.planId || "" } });
      job.worker = worker;
      job.status = "running";
      worker.on("message", (message) => {
        if (message.type === "progress") { job.progress = message.progress; emit(message); return; }
        if (message.type === "complete") { const result = finish(message.result); resolve(result); }
      });
      worker.on("error", (error) => resolve(finish({ ok: false, error: error.message, code: "INTELLIGENCE_BUILD_FAILED" })));
      worker.on("exit", (code) => { if (jobs.has(root) && code !== 0) resolve(finish({ ok: false, error: `Intelligence worker exited with code ${code}`, code: "INTELLIGENCE_WORKER_EXITED" })); });
      emit({ type: "status", status: "running", path: indexPath(root) });
    });
    return job.completion;
  }

  function query(workspace, input = {}) {
    const graphOperations = {
      graph_overview: () => graphProvider?.getOverview?.(workspace),
      graph_search: () => graphProvider?.searchNodes?.(workspace, input.query || "", { limit: input.limit, types: input.types }),
      graph_node: () => graphProvider?.getNode?.(workspace, input.id || input.entityId || ""),
      graph_neighbors: () => graphProvider?.getNeighbors?.(workspace, input.id || input.entityId || "", { minConfidence: input.minConfidence, edgeTypes: input.edgeTypes }),
      graph_paths: () => graphProvider?.findPaths?.(workspace, input.from || input.id || "", input.to || input.entityId || "", { maxHops: input.maxHops, minConfidence: input.minConfidence }),
      graph_workflow: () => graphProvider?.getWorkflow?.(workspace, { limit: input.limit }),
      graph_state_model: () => graphProvider?.getStateModel?.(workspace, { limit: input.limit, minConfidence: input.minConfidence }),
      graph_identity_diff: () => graphProvider?.getIdentityDiff?.(workspace, { limit: input.limit }),
      graph_variants: () => graphProvider?.getVariants?.(workspace, input.id || input.entityId || "", { limit: input.limit }),
      graph_anomalies: () => graphProvider?.getAnomalies?.(workspace, { limit: input.limit }),
      graph_evidence: () => graphProvider?.getEvidence?.(workspace, input.evidenceIds?.length ? input.evidenceIds : input.id || input.entityId || "", { maxChars: 24_000 }),
    };
    if (graphOperations[input.operation]) {
      if (!graphProvider) return { ok: false, error: "The application graph provider is unavailable.", code: "GRAPH_UNAVAILABLE" };
      const result = graphOperations[input.operation]();
      return result || { ok: false, error: "The requested graph operation is unavailable.", code: "GRAPH_OPERATION_UNAVAILABLE" };
    }
    if (input.domain === "knowledge" || input.operation === "knowledge") return knowledge.query(input, { workspace: rootOf(workspace), sessionId: input.sessionId || "", mode: input.mode || "agent", activateMcp: false });
    if (input.domain === "both") {
      const engagement = query(workspace, { ...input, domain: "engagement" });
      const assessment = knowledge.query(input, { workspace: rootOf(workspace), sessionId: input.sessionId || "", mode: input.mode || "agent", activateMcp: false });
      return { ok: engagement.ok !== false && assessment.ok !== false, engagement, assessment };
    }
    const target = indexPath(workspace);
    if (!fs.existsSync(target)) return { ok: false, error: "The assessment intelligence index has not been built.", code: "INTELLIGENCE_NOT_BUILT", status: "not_built", remediation: "Start the intelligence build from the assessment Map." };
    try { const db = Store.openDatabase(target); const result = Store.query(db, input); db.close(); return result; }
    catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_QUERY_FAILED" }; }
  }

  function expand(workspace, input = {}) {
    const target = indexPath(workspace);
    if (!fs.existsSync(target)) return { ok: false, error: "The assessment intelligence index has not been built.", code: "INTELLIGENCE_NOT_BUILT" };
    try { const db = Store.openDatabase(target); const result = Store.expand(db, { ...input, workspace: rootOf(workspace) }); db.close(); return result; }
    catch (error) { return { ok: false, error: error.message, code: "INTELLIGENCE_EXPAND_FAILED" }; }
  }

  function relatedEvidence(workspace, refs = []) {
    const target = indexPath(workspace);
    if (!fs.existsSync(target)) return [];
    try { const db = Store.openDatabase(target); const result = Store.relatedEvidence(db, refs, 100); db.close(); return result; }
    catch { return []; }
  }
  function recordRunEvidence(workspace, input = {}) {
    const target = indexPath(workspace);
    if (!fs.existsSync(target)) return { ok: false, code: "INTELLIGENCE_NOT_BUILT" };
    try {
      const db = Store.openDatabase(target);
      Store.recordRunEvidence(db, input);
      db.close();
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
  function recordRuntimeEvidence(workspace, input = {}) {
    const root = rootOf(workspace);
    const target = path.join(root, ".xekute", "evidence", "runtime.jsonl");
    const relativePath = ".xekute/evidence/runtime.jsonl";
    const projection = Store.runtimeEvidenceProjection(input);
    const line = `${JSON.stringify(projection.rawRecord)}\n`;
    queueEvidence(root, async () => {
      await (fs.promises?.mkdir
        ? fs.promises.mkdir(path.dirname(target), { recursive: true })
        : Promise.resolve().then(() => fs.mkdirSync(path.dirname(target), { recursive: true })));
      let sourceOffset = 0;
      try { sourceOffset = fs.existsSync(target) ? fs.statSync(target).size : 0; } catch { sourceOffset = 0; }
      if (fs.promises?.appendFile) await fs.promises.appendFile(target, line, "utf8");
      else fs.appendFileSync(target, line, "utf8");
      if (!fs.existsSync(indexPath(root))) return { ok: true };
      const db = Store.openDatabase(indexPath(root));
      try {
        const result = Store.recordRuntimeEvidence(db, input, { sourcePath: relativePath, sourceOffset, sourceLength: Buffer.byteLength(line, "utf8"), rawRecord: projection.rawRecord });
        const stat = fs.statSync(target);
        Store.setSource(db, {
          path: relativePath,
          kind: "evidence",
          fingerprint: cursorFingerprint(target, stat.size),
          size: stat.size,
          mtime: stat.mtimeMs,
          cursor: stat.size,
          status: "indexed",
        });
        return result;
      } finally { db.close(); }
    });
    return { ok: true, evidenceIds: [projection.evidenceId], queued: true };
  }
  function completeRun(workspace, runId, status = "completed") {
    const target = indexPath(workspace);
    if (!fs.existsSync(target)) return { ok: false, code: "INTELLIGENCE_NOT_BUILT" };
    try { const db = Store.openDatabase(target); Store.completeRun(db, runId, status); db.close(); return { ok: true }; }
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
    const target = indexPath(workspace);
    try {
      if (fs.existsSync(target)) fs.renameSync(target, `${target}.previous-${Date.now()}`);
    } catch (error) { return Promise.resolve({ ok: false, error: error.message, code: "INTELLIGENCE_REBUILD_PREPARE_FAILED" }); }
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
  }

  return Object.freeze({ indexPath, status, start, pause, resume, rebuild, refresh, whenIdle, query, expand, relatedEvidence, recordRunEvidence, recordRuntimeEvidence, completeRun, flush, dispose, setGraphProvider, knowledge, mcpRuntime });
}

module.exports = { createAssessmentIntelligenceService };
