"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { redactStructuredValue } = require("../../../../shared/secret-redaction.js");
const { normalizeGenericRecord } = require("../../../../domain/assessment/intelligence/ontology.js");

const SCHEMA_VERSION = 1;

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDatabase(indexPath) {
  ensureDirectory(indexPath);
  const db = new DatabaseSync(indexPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (
      path TEXT PRIMARY KEY, kind TEXT NOT NULL, fingerprint TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
      cursor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, entity_key TEXT NOT NULL,
      label TEXT NOT NULL, summary TEXT NOT NULL, data_json TEXT NOT NULL,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, observation_count INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS entities_type_key ON entities(type, entity_key);
    CREATE INDEX IF NOT EXISTS entities_type ON entities(type);
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, source_path TEXT NOT NULL,
      source_offset INTEGER NOT NULL DEFAULT 0, source_length INTEGER NOT NULL DEFAULT 0,
      source_hash TEXT NOT NULL, summary TEXT NOT NULL, sanitized_json TEXT NOT NULL,
      produced_run_id TEXT NOT NULL DEFAULT '', plan_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_source ON evidence(source_path, source_offset);
    CREATE INDEX IF NOT EXISTS evidence_run ON evidence(produced_run_id);
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY, observation_key TEXT NOT NULL, summary TEXT NOT NULL,
      data_json TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS observations_key ON observations(observation_key);
    CREATE TABLE IF NOT EXISTS relationships (
      source_id TEXT NOT NULL, target_id TEXT NOT NULL, relationship_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1, data_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(source_id, target_id, relationship_type)
    );
    CREATE INDEX IF NOT EXISTS relationships_source ON relationships(source_id);
    CREATE INDEX IF NOT EXISTS relationships_target ON relationships(target_id);
    CREATE TABLE IF NOT EXISTS entity_evidence (
      entity_id TEXT NOT NULL, evidence_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
      rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(entity_id, evidence_id)
    );
    CREATE TABLE IF NOT EXISTS response_clusters (
      id TEXT PRIMARY KEY, signature TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      representative_evidence_id TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running'
    );
    CREATE TABLE IF NOT EXISTS run_evidence (
      run_id TEXT NOT NULL, evidence_id TEXT NOT NULL, step_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(run_id, evidence_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      record_id UNINDEXED, domain, record_type, title, body
    );
  `);
  db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SCHEMA_VERSION));
  return db;
}

function json(value) {
  try { return JSON.stringify(value == null ? {} : value); } catch { return "{}"; }
}

function now() { return new Date().toISOString(); }

function transaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function upsertEntity(db, item, timestamp, increment = true) {
  db.prepare(`INSERT INTO entities(id,type,entity_key,label,summary,data_json,first_seen,last_seen,observation_count)
    VALUES(?,?,?,?,?,?,?,?,1)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label, summary=excluded.summary,
      data_json=excluded.data_json, last_seen=excluded.last_seen, observation_count=entities.observation_count+${increment ? 1 : 0}`).run(
    item.id, item.type, item.key, item.label, item.summary, json(item.data), timestamp, timestamp,
  );
  db.prepare("DELETE FROM search_index WHERE record_id=?").run(item.id);
  db.prepare("INSERT INTO search_index(record_id,domain,record_type,title,body) VALUES(?,?,?,?,?)").run(item.id, "engagement", item.type, item.label, `${item.summary} ${json(item.data)}`);
}

function upsertEvidence(db, item) {
  db.prepare(`INSERT INTO evidence(id,type,source_path,source_offset,source_length,source_hash,summary,sanitized_json,produced_run_id,plan_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash, summary=excluded.summary,
      sanitized_json=excluded.sanitized_json, produced_run_id=excluded.produced_run_id,
      plan_id=excluded.plan_id, created_at=excluded.created_at`).run(
    item.id, item.type, item.sourcePath, item.sourceOffset, item.sourceLength, item.sourceHash,
    item.summary, json(item.sanitized), item.producedRunId || "", item.planId || "", item.createdAt || now(),
  );
  db.prepare("DELETE FROM search_index WHERE record_id=?").run(item.id);
  db.prepare("INSERT INTO search_index(record_id,domain,record_type,title,body) VALUES(?,?,?,?,?)").run(item.id, "engagement", "evidence", item.type, `${item.summary} ${json(item.sanitized)}`);
}

function upsertObservation(db, item, timestamp, increment = true) {
  const existing = db.prepare("SELECT id FROM observations WHERE observation_key=?").get(item.key);
  const id = existing?.id || item.id;
  db.prepare(`INSERT INTO observations(id,observation_key,summary,data_json,first_seen,last_seen,count)
    VALUES(?,?,?,?,?,?,1)
    ON CONFLICT(observation_key) DO UPDATE SET summary=excluded.summary, data_json=excluded.data_json,
      last_seen=excluded.last_seen, count=observations.count+${increment ? 1 : 0}`).run(
    id, item.key, item.summary, json(item.data), timestamp, timestamp,
  );
  db.prepare("DELETE FROM search_index WHERE record_id=?").run(id);
  db.prepare("INSERT INTO search_index(record_id,domain,record_type,title,body) VALUES(?,?,?,?,?)").run(id, "engagement", "observation", "Observation", `${item.summary} ${json(item.data)}`);
}

function insertNormalized(db, normalized) {
  const timestamp = normalized.evidence?.createdAt || now();
  const evidenceExisted = Boolean(normalized.evidence?.id && db.prepare("SELECT 1 AS found FROM evidence WHERE id=?").get(normalized.evidence.id)?.found);
  for (const item of normalized.entities || []) upsertEntity(db, item, timestamp, !evidenceExisted);
  if (normalized.evidence) upsertEvidence(db, normalized.evidence);
  for (const item of normalized.entities || []) {
    if (item.type !== "response-cluster") continue;
    db.prepare(`INSERT INTO response_clusters(id,signature,count,representative_evidence_id,data_json)
      VALUES(?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET count=response_clusters.count+${evidenceExisted ? 0 : 1},
      representative_evidence_id=CASE WHEN response_clusters.representative_evidence_id='' THEN excluded.representative_evidence_id ELSE response_clusters.representative_evidence_id END,
      data_json=excluded.data_json`).run(item.id, item.key, normalized.evidence?.id || "", json(item.data));
  }
  for (const item of normalized.observations || []) upsertObservation(db, item, timestamp, !evidenceExisted);
  for (const relation of normalized.relationships || []) {
    db.prepare(`INSERT INTO relationships(source_id,target_id,relationship_type,confidence,data_json)
      VALUES(?,?,?,?,?) ON CONFLICT(source_id,target_id,relationship_type)
      DO UPDATE SET confidence=MAX(relationships.confidence, excluded.confidence)`).run(
      relation.sourceId, relation.targetId, relation.type, Number(relation.confidence) || 0, json(relation.data),
    );
  }
  const entityIds = (normalized.entities || []).map((item) => item.id);
  for (const entityId of entityIds) {
    if (!normalized.evidence?.id) continue;
    db.prepare("INSERT OR IGNORE INTO entity_evidence(entity_id,evidence_id,role,rank) VALUES(?,?,?,?)").run(entityId, normalized.evidence.id, "observed", 0);
  }
}

function setSource(db, source) {
  db.prepare(`INSERT INTO sources(path,kind,fingerprint,size,mtime,cursor,status,error,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,
      fingerprint=excluded.fingerprint,size=excluded.size,mtime=excluded.mtime,
      cursor=excluded.cursor,status=excluded.status,error=excluded.error,updated_at=excluded.updated_at`).run(
    source.path, source.kind || "file", source.fingerprint || "", Number(source.size) || 0,
    Number(source.mtime) || 0, Number(source.cursor) || 0, source.status || "indexed", source.error || "", source.updatedAt || now(),
  );
}

function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value ?? ""));
}

function recordRun(db, { runId = "", planId = "", status = "running" } = {}) {
  if (!runId) return;
  db.prepare(`INSERT INTO runs(run_id,plan_id,started_at,status) VALUES(?,?,?,?)
    ON CONFLICT(run_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status`).run(String(runId), String(planId || ""), now(), String(status || "running"));
}

function recordRunEvidence(db, { runId = "", planId = "", stepId = "", evidenceIds = [] } = {}) {
  if (!runId) return;
  transaction(db, () => {
    recordRun(db, { runId, planId, status: "running" });
    for (const evidenceId of [...new Set(evidenceIds.map(String).filter(Boolean))].slice(0, 100)) {
      db.prepare("INSERT OR IGNORE INTO run_evidence(run_id,evidence_id,step_id) VALUES(?,?,?)").run(String(runId), evidenceId, String(stepId || ""));
      db.prepare("UPDATE evidence SET produced_run_id=?,plan_id=? WHERE id=?").run(String(runId), String(planId || ""), evidenceId);
    }
  });
}

function runtimeEvidenceProjection({ runId = "", planId = "", stepId = "", repetition = 1, action = "", identityId = "", pageId = "main", result = null } = {}) {
  const sanitizedResult = redactStructuredValue(result);
  const key = JSON.stringify({ runId, planId, stepId, repetition, action, identityId, pageId, result: sanitizedResult });
  const evidenceId = `runtime-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
  const rawRecord = {
    id: evidenceId,
    recordType: "runtime-step",
    runId,
    planId,
    stepId,
    repetition,
    action,
    identityId,
    pageId,
    result: sanitizedResult,
    createdAt: now(),
  };
  return { evidenceId, sanitizedResult, rawRecord };
}

function runtimeEvidenceId(input = {}) { return runtimeEvidenceProjection(input).evidenceId; }

function recordRuntimeEvidence(db, input = {}, { sourcePath = "", sourceOffset = 0, sourceLength = 0, rawRecord = null } = {}) {
  const { runId = "", planId = "", stepId = "", repetition = 1, action = "", identityId = "", pageId = "main" } = input;
  const projection = rawRecord && typeof rawRecord === "object" ? {
    evidenceId: String(rawRecord.id || ""),
    sanitizedResult: redactStructuredValue(rawRecord.result),
    rawRecord,
  } : runtimeEvidenceProjection(input);
  const { evidenceId, sanitizedResult } = projection;
  const normalized = normalizeGenericRecord(projection.rawRecord, {
    sourcePath: sourcePath || `runtime://${String(runId || "adhoc")}/${String(stepId || "step")}/${Number(repetition) || 1}`,
    sourceOffset,
    sourceLength: sourceLength || Math.min(24_000, JSON.stringify(sanitizedResult || null).length),
    runId,
    planId,
  });
  transaction(db, () => {
    insertNormalized(db, normalized);
    if (runId) {
      recordRun(db, { runId, planId, status: "running" });
      db.prepare("INSERT OR IGNORE INTO run_evidence(run_id,evidence_id,step_id) VALUES(?,?,?)").run(String(runId), normalized.evidence.id, String(stepId || ""));
      db.prepare("UPDATE evidence SET produced_run_id=?,plan_id=? WHERE id=?").run(String(runId), String(planId || ""), normalized.evidence.id);
    }
  });
  return { ok: true, evidenceIds: [normalized.evidence.id] };
}

function completeRun(db, runId, status = "completed") {
  if (!runId) return;
  db.prepare("UPDATE runs SET status=?,completed_at=? WHERE run_id=?").run(String(status), now(), String(runId));
}

function readMeta(db) {
  return Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((row) => [row.key, row.value]));
}

function overview(db) {
  const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
  const meta = readMeta(db);
  return {
    schemaVersion: Number(meta.schema_version || SCHEMA_VERSION),
    status: meta.status || "ready",
    updatedAt: meta.updated_at || "",
    counts: {
      entities: count("entities"),
      evidence: count("evidence"),
      observations: count("observations"),
      relationships: count("relationships"),
      responseClusters: count("response_clusters"),
      sources: count("sources"),
    },
  };
}

function parseRow(row, jsonKey) {
  if (!row) return null;
  const value = { ...row };
  if (jsonKey && value[jsonKey]) {
    try { value.data = JSON.parse(value[jsonKey]); } catch { value.data = {}; }
    delete value[jsonKey];
  }
  return value;
}

function query(db, input = {}) {
  const operation = String(input.operation || "overview");
  if (operation === "overview") return { ok: true, level: 0, overview: overview(db) };
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 30));
  if (operation === "entity") {
    const id = String(input.id || input.entityId || "");
    const row = db.prepare("SELECT * FROM entities WHERE id=? OR entity_key=? LIMIT 1").get(id, id);
    if (!row) return { ok: false, error: "Entity was not found.", code: "ENTITY_NOT_FOUND" };
    const evidence = db.prepare(`SELECT e.id,e.type,e.summary,e.source_path,e.created_at
      FROM evidence e JOIN entity_evidence ee ON ee.evidence_id=e.id WHERE ee.entity_id=? ORDER BY e.created_at DESC LIMIT ?`).all(row.id, limit);
    return { ok: true, level: 1, entity: parseRow(row, "data_json"), evidenceRefs: evidence };
  }
  if (operation === "relationships") {
    const id = String(input.id || input.entityId || "");
    const rows = db.prepare(`SELECT r.*, e1.label AS source_label, e2.label AS target_label
      FROM relationships r LEFT JOIN entities e1 ON e1.id=r.source_id LEFT JOIN entities e2 ON e2.id=r.target_id
      WHERE r.source_id=? OR r.target_id=? ORDER BY r.confidence DESC LIMIT ?`).all(id, id, limit);
    return { ok: true, level: 1, relationships: rows };
  }
  if (operation === "hypotheses") {
    const rows = db.prepare("SELECT id,summary,source_path,created_at FROM evidence WHERE type LIKE '%hypothesis%' ORDER BY created_at DESC LIMIT ?").all(limit);
    return { ok: true, level: 1, items: rows };
  }
  const queryText = String(input.query || "").trim();
  let rows;
  if (queryText) {
    const terms = queryText.replace(/[^a-zA-Z0-9_./-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 12).map((term) => `${term.replace(/[^a-zA-Z0-9_]/g, "")}*`).filter((term) => term !== "*").join(" ");
    rows = terms
      ? db.prepare(`SELECT record_id,record_type,title,body FROM search_index WHERE search_index MATCH ? LIMIT ?`).all(terms, limit)
      : [];
  } else {
    rows = db.prepare("SELECT id AS record_id,type AS record_type,label AS title,summary AS body FROM entities ORDER BY last_seen DESC LIMIT ?").all(limit);
  }
  const items = rows.map((row) => ({ id: row.record_id, type: row.record_type, title: row.title, summary: String(row.body || "").slice(0, 1_000) }));
  return { ok: true, level: 1, items, hasMore: items.length === limit, overview: overview(db) };
}

function sourceHash(value) {
  const sanitized = redactStructuredValue(value);
  const serialized = String(typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized) || "")
    .replace(/\u0000/g, "").trim().slice(0, 12_000);
  return require("node:crypto").createHash("sha256").update(serialized).digest("hex");
}

function readSourceRecord(workspace, row) {
  if (!workspace || !row.source_path || !row.source_path.endsWith(".jsonl")) return { ok: false, code: "SOURCE_NOT_LINE_ADDRESSABLE" };
  const root = path.resolve(workspace);
  const filePath = path.resolve(root, ...String(row.source_path).split("/"));
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { ok: false, code: "SOURCE_OUTSIDE_WORKSPACE" };
  try {
    const handle = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(Math.max(0, Number(row.source_length) || 0));
    fs.readSync(handle, buffer, 0, buffer.length, Math.max(0, Number(row.source_offset) || 0));
    fs.closeSync(handle);
    const parsed = JSON.parse(buffer.toString("utf8").trim());
    if (sourceHash(parsed) !== row.source_hash) return { ok: false, code: "SOURCE_MUTATED" };
    return { ok: true, value: redactStructuredValue(parsed) };
  } catch (error) {
    return { ok: false, code: "SOURCE_READ_FAILED", error: error.message };
  }
}

function expand(db, input = {}) {
  const refs = [...new Set((Array.isArray(input.refs) ? input.refs : [input.ref]).map(String).filter(Boolean))].slice(0, 10);
  if (!refs.length) return { ok: false, error: "At least one evidence reference is required.", code: "EVIDENCE_QUERY_INVALID" };
  const placeholders = refs.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id,type,source_path,source_offset,source_length,source_hash,summary,sanitized_json,produced_run_id,plan_id,created_at FROM evidence WHERE id IN (${placeholders})`).all(...refs);
  const workspace = input.workspace || "";
  let totalCharacters = 0;
  const items = [];
  let truncated = false;
  for (const row of rows) {
    let sanitized = {};
    try { sanitized = JSON.parse(row.sanitized_json); } catch { sanitized = {}; }
    let sourceVerified = false;
    if (input.level === "raw") {
      const source = readSourceRecord(workspace, row);
      if (source.ok) { sanitized = source.value; sourceVerified = true; }
    }
    const item = { id: row.id, type: row.type, summary: row.summary, sourcePath: row.source_path, sourceOffset: row.source_offset, sourceLength: row.source_length, sourceHash: row.source_hash, sanitized, sourceVerified, producedRunId: row.produced_run_id, planId: row.plan_id, createdAt: row.created_at };
    const serialized = JSON.stringify(item);
    if (serialized.length > 8_000) {
      item.sanitized = String(JSON.stringify(sanitized) || "").slice(0, 8_000);
    }
    const itemLength = JSON.stringify(item).length;
    if (totalCharacters + itemLength > 24_000) { truncated = true; break; }
    totalCharacters += itemLength;
    items.push(item);
  }
  return { ok: true, level: input.level === "raw" ? 3 : 2, items, missing: refs.filter((id) => !items.some((item) => item.id === id)), truncated };
}

function relatedEvidence(db, refs = [], limit = 100) {
  const seed = [...new Set(refs.map(String).filter(Boolean))].slice(0, 50);
  if (!seed.length) return [];
  const entityRows = db.prepare(`SELECT DISTINCT entity_id FROM entity_evidence WHERE evidence_id IN (${seed.map(() => "?").join(",")})`).all(...seed);
  const entityIds = [...new Set(entityRows.map((row) => row.entity_id))];
  if (!entityIds.length) return seed;
  const relationRows = db.prepare(`SELECT source_id,target_id FROM relationships WHERE source_id IN (${entityIds.map(() => "?").join(",")}) OR target_id IN (${entityIds.map(() => "?").join(",")})`).all(...entityIds, ...entityIds);
  const relatedEntities = [...new Set([...entityIds, ...relationRows.flatMap((row) => [row.source_id, row.target_id])])];
  const evidenceRows = db.prepare(`SELECT DISTINCT evidence_id FROM entity_evidence WHERE entity_id IN (${relatedEntities.map(() => "?").join(",")}) LIMIT ?`).all(...relatedEntities, Math.max(1, Math.min(Number(limit) || 100, 100)));
  return [...new Set([...seed, ...evidenceRows.map((row) => row.evidence_id)])].slice(0, 100);
}

module.exports = {
  SCHEMA_VERSION,
  openDatabase,
  transaction,
  insertNormalized,
  setSource,
  setMeta,
  recordRun,
  recordRunEvidence,
  runtimeEvidenceId,
  runtimeEvidenceProjection,
  recordRuntimeEvidence,
  completeRun,
  readMeta,
  overview,
  query,
  expand,
  relatedEvidence,
};
