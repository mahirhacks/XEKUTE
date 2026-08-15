"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { normalizeGenericRecord } = require("../../../../domain/assessment/intelligence/ontology.js");
const Store = require("./intelligence-store.js");

const SOURCE_FILES = Object.freeze([
  ["traffic/raw.jsonl", "traffic"],
  ["traffic/filtered.jsonl", "traffic"],
  ["evidence/index.jsonl", "evidence"],
  [".xekute/evidence/runtime.jsonl", "evidence"],
  ["findings/findings.json", "findings"],
  ["enumeration/endpoints.json", "endpoints"],
  ["enumeration/services.json", "services"],
  ["enumeration/assets.json", "assets"],
  [".xekute/logs/agent-hypotheses.jsonl", "hypotheses"],
  [".xekute/logs/agent-actions.jsonl", "actions"],
  ["Map/application-map.json", "map"],
]);

function sourceFilesForWorkspace(workspace) {
  const sources = SOURCE_FILES.filter(([relativePath]) => relativePath !== "Map/application-map.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(workspace, "traffic", "graph", "manifest.json"), "utf8"));
    const relative = String(manifest?.latest?.file || "").replace(/\\/g, "/");
    if (/^traffic\/graph\/[^/\\]+\.json$/i.test(relative)) sources.push([relative, "map"]);
    else if (fs.existsSync(path.join(workspace, "Map", "application-map.json"))) sources.push(["Map/application-map.json", "map"]);
  } catch {
    if (fs.existsSync(path.join(workspace, "Map", "application-map.json"))) sources.push(["Map/application-map.json", "map"]);
  }
  return sources;
}

function fingerprint(filePath, stat) {
  return crypto.createHash("sha256").update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}

function cursorFingerprint(filePath, cursor) {
  const size = Math.max(0, Number(cursor) || 0);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const hash = crypto.createHash("sha256");
    hash.update(`append-v1|${size}|`);
    for (const [start, length] of [[0, Math.min(4_096, size)], [Math.max(0, size - 4_096), Math.min(4_096, size)]]) {
      if (!length) continue;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(descriptor, buffer, 0, length, start);
      hash.update(buffer.subarray(0, bytesRead));
    }
    return `append-v1:${size}:${hash.digest("hex")}`;
  } finally {
    fs.closeSync(descriptor);
  }
}

function resumableOffset(filePath, stat, previous) {
  const cursor = Number(previous?.cursor) || 0;
  if (!previous?.fingerprint?.startsWith("append-v1:") || cursor < 0 || cursor > stat.size) return 0;
  return cursorFingerprint(filePath, cursor) === previous.fingerprint ? cursor : 0;
}

function recordArray(document) {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== "object") return [];
  if (Array.isArray(document.nodes) || Array.isArray(document.edges)) {
    return [
      ...(Array.isArray(document.nodes) ? document.nodes.map((record) => ({ ...record, recordType: record.recordType || "map-node" })) : []),
      ...(Array.isArray(document.edges) ? document.edges.map((record) => ({ ...record, recordType: record.recordType || "map-edge" })) : []),
    ];
  }
  for (const key of ["records", "items", "findings", "endpoints", "services", "assets", "nodes", "observations", "hypotheses"]) {
    if (Array.isArray(document[key])) return document[key];
  }
  return [document];
}

async function indexJsonl(db, workspace, relativePath, kind, onProgress, state = {}) {
  const target = path.join(workspace, ...relativePath.split("/"));
  const stat = fs.statSync(target);
  const previous = db.prepare("SELECT fingerprint,cursor,status FROM sources WHERE path=?").get(relativePath);
  const startOffset = resumableOffset(target, stat, previous);
  const source = { path: relativePath, kind, fingerprint: cursorFingerprint(target, startOffset), size: stat.size, mtime: stat.mtimeMs, cursor: startOffset, status: "indexing" };
  Store.setSource(db, source);
  if (startOffset === stat.size) {
    Store.setSource(db, { ...source, fingerprint: cursorFingerprint(target, stat.size), cursor: stat.size, status: "indexed", updatedAt: new Date().toISOString() });
    return { count: 0, paused: false };
  }
  const stream = fs.createReadStream(target, { encoding: "utf8", ...(startOffset ? { start: startOffset } : {}) });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let offset = startOffset;
  let count = 0;
  let batch = [];
  const flushBatch = () => {
    if (!batch.length) return;
    const pending = batch;
    batch = [];
    Store.transaction(db, () => pending.forEach((item) => Store.insertNormalized(db, item)));
  };
  for await (const line of reader) {
    const length = Buffer.byteLength(line, "utf8") + 1;
    const raw = line.trim();
    if (raw) {
      try {
        const record = JSON.parse(raw);
        const normalized = normalizeGenericRecord(record, { sourcePath: relativePath, sourceOffset: offset, sourceLength: length, runId: state.runId, planId: state.planId });
        batch.push(normalized);
        count += 1;
        if (batch.length >= 100) flushBatch();
      } catch {
        // Keep indexing later records; malformed source lines are recorded by the source status.
      }
    }
    offset += length;
    if (count % 100 === 0) onProgress({ source: relativePath, records: count, bytes: offset, totalBytes: stat.size });
    if (state.shouldPause?.()) {
      flushBatch();
      Store.setSource(db, { ...source, fingerprint: cursorFingerprint(target, offset), cursor: offset, status: "paused", updatedAt: new Date().toISOString() });
      return { count, paused: true };
    }
  }
  flushBatch();
  Store.setSource(db, { ...source, fingerprint: cursorFingerprint(target, offset), cursor: offset, status: "indexed", updatedAt: new Date().toISOString() });
  return { count, paused: false };
}

function indexJson(db, workspace, relativePath, kind, state = {}) {
  const target = path.join(workspace, ...relativePath.split("/"));
  const stat = fs.statSync(target);
  const raw = fs.readFileSync(target, "utf8");
  const sourceFingerprint = fingerprint(relativePath, stat);
  const previous = db.prepare("SELECT fingerprint,status FROM sources WHERE path=?").get(relativePath);
  if (previous?.fingerprint === sourceFingerprint && previous.status === "indexed") return { count: 0, paused: false };
  const source = { path: relativePath, kind, fingerprint: sourceFingerprint, size: stat.size, mtime: stat.mtimeMs, cursor: stat.size, status: "indexing" };
  Store.setSource(db, source);
  let document;
  try { document = JSON.parse(raw); } catch { document = null; }
  const records = recordArray(document);
  const boundedRecords = records.slice(0, 100_000);
  for (let offset = 0; offset < boundedRecords.length; offset += 100) {
    const batch = boundedRecords.slice(offset, offset + 100);
    Store.transaction(db, () => batch.forEach((record, index) => {
      const normalized = normalizeGenericRecord(record, { sourcePath: relativePath, sourceOffset: offset + index, sourceLength: 0, runId: state.runId, planId: state.planId });
      Store.insertNormalized(db, normalized);
    }));
  }
  Store.setSource(db, { ...source, status: "indexed", updatedAt: new Date().toISOString() });
  return { count: records.length, paused: false };
}

async function indexWorkspaceSync({ workspace, indexPath, onProgress = () => {}, runId = "", planId = "", shouldPause = () => false } = {}) {
  const root = path.resolve(String(workspace || ""));
  if (!root || !fs.existsSync(root)) return { ok: false, error: "Assessment workspace does not exist.", code: "WORKSPACE_NOT_FOUND" };
  const db = Store.openDatabase(indexPath || path.join(root, ".xekute", "intelligence", "index.sqlite"));
  Store.setMeta(db, "status", "indexing");
  Store.setMeta(db, "started_at", new Date().toISOString());
  let total = 0;
  try {
    for (const [relativePath, kind] of sourceFilesForWorkspace(root)) {
      const target = path.join(root, ...relativePath.split("/"));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      onProgress({ source: relativePath, status: "started", total });
      const result = relativePath.endsWith(".jsonl")
        ? await indexJsonl(db, root, relativePath, kind, onProgress, { runId, planId, shouldPause })
        : indexJson(db, root, relativePath, kind, { runId, planId });
      total += result.count;
      if (result.paused) {
        Store.setMeta(db, "status", "paused");
        Store.setMeta(db, "updated_at", new Date().toISOString());
        return { ok: true, status: "paused", records: total, overview: Store.overview(db) };
      }
      onProgress({ source: relativePath, status: "complete", total });
    }
    Store.setMeta(db, "status", "ready");
    Store.setMeta(db, "updated_at", new Date().toISOString());
    Store.setMeta(db, "record_count", total);
    return { ok: true, records: total, overview: Store.overview(db) };
  } catch (error) {
    Store.setMeta(db, "status", "error");
    Store.setMeta(db, "error", error.message);
    return { ok: false, error: error.message, code: "INTELLIGENCE_BUILD_FAILED" };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

module.exports = { SOURCE_FILES, sourceFilesForWorkspace, indexWorkspaceSync, cursorFingerprint };
