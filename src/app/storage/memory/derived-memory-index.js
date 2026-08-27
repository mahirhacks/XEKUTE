"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const { redactSecrets, redactStructuredValue, SECRET_KEY_RE } = require("../../../shared/secret-redaction.js");
const {
  clone,
  ensureDirectory,
  operationFailure,
  resolvedWorkspace,
  safeComponent,
  timestamp,
  uniqueTemporaryPath,
} = require("./memory-storage-utils.js");

const DERIVED_MEMORY_INDEX_SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TEXT_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 500;
const DERIVED_DOMAINS = Object.freeze(["project", "investigation", "evidence", "artifact", "graph", "knowledge"]);
const SAFE_META_KEYS = new Set(["schema_version", "project_id", "projection_revision", "content_hash", "status", "updated_at", "source_revisions", "watermark"]);

// The derived index is intentionally stricter than the canonical record stores.
// It keeps searchable metadata and references, never request/response bodies or
// reusable authentication material.
const OMITTED_KEYS = /^(?:body|raw|raw_body|request_body|response_body|raw_request|raw_response|headers|request_headers|response_headers|cookie|cookies|set_cookie|authorization|proxy_authorization|access_token|refresh_token|csrf_token|bearer_token|private_key|client_private_key|passphrase|password|secret|secret_value|credential|credentials|value)$/i;

function text(value, maximum = MAX_TEXT_LENGTH) {
  return redactSecrets(String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim()).slice(0, maximum);
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function limitOf(value) {
  return Math.min(MAX_LIMIT, Math.max(1, Number(value) || DEFAULT_LIMIT));
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value || {}), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeProjection(value, key = "", depth = 0, seen = new WeakSet()) {
  if (depth > 12) return "[OMITTED_TOO_DEEP]";
  if (OMITTED_KEYS.test(String(key || "")) || SECRET_KEY_RE.test(String(key || ""))) return undefined;
  if (typeof value === "string") return redactSecrets(value).replace(/[\u0000]/g, "").slice(0, MAX_TEXT_LENGTH);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (typeof value !== "object") return String(value).slice(0, MAX_TEXT_LENGTH);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeProjection(item, "", depth + 1, seen)).filter((item) => item !== undefined).slice(0, 2_000);
  const output = {};
  for (const [childKey, child] of Object.entries(value)) {
    const projected = safeProjection(child, childKey, depth + 1, seen);
    if (projected !== undefined) output[childKey] = projected;
  }
  return output;
}

function normalizedSafeObject(value) {
  const projected = safeProjection(redactStructuredValue(value && typeof value === "object" ? value : {}));
  return projected && typeof projected === "object" && !Array.isArray(projected) ? projected : {};
}

function json(value) {
  try { return JSON.stringify(value == null ? {} : value); } catch { return "{}"; }
}

function hashValue(crypto, value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function createDerivedMemoryIndex({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  databaseFactory = (file) => new DatabaseSync(file),
} = {}) {
  if (!fs || !path || !crypto || typeof databaseFactory !== "function") throw new TypeError("Derived memory index dependencies are required.");

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function indexPath(workspace) { return path.join(rootOf(workspace), ".xekute", "memory", "derived", "index.sqlite"); }

  function schema(db) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        project_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT '',
        source_revision INTEGER NOT NULL DEFAULT 0,
        canonical_key TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        searchable_text TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, domain, record_id)
      );
      CREATE INDEX IF NOT EXISTS records_project_domain ON records(project_id, domain, record_id);
      CREATE INDEX IF NOT EXISTS records_project_type ON records(project_id, record_type, record_id);
      CREATE INDEX IF NOT EXISTS records_project_canonical ON records(project_id, canonical_key);
      CREATE TABLE IF NOT EXISTS edges (
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        source_domain TEXT NOT NULL DEFAULT '',
        target_domain TEXT NOT NULL DEFAULT '',
        source_revision INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL DEFAULT '{}',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, source_id, target_id, edge_type)
      );
      CREATE INDEX IF NOT EXISTS edges_project_source ON edges(project_id, source_id, edge_type, target_id);
      CREATE INDEX IF NOT EXISTS edges_project_target ON edges(project_id, target_id, edge_type, source_id);
    `);
    db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(DERIVED_MEMORY_INDEX_SCHEMA_VERSION));
  }

  // SQLite's parameter binding is used for all user/project data. The schema
  // statement above is static; this helper only opens a validated project DB.
  function open(workspace, projectId, { create = false } = {}) {
    let root;
    try {
      root = rootOf(workspace);
      assertMemoryId(projectId, "proj");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_DERIVED_INDEX_INPUT_INVALID", error.message, error.details || {});
    }
    const file = indexPath(root);
    if (!create && !fs.existsSync(file)) return { ok: true, initialized: false, exists: false, path: file, projectId };
    let db = null;
    try {
      if (create) ensureDirectory(fs, path, path.dirname(file));
      db = databaseFactory(file);
      schema(db);
      const storedProject = db.prepare("SELECT value FROM meta WHERE key='project_id'").get()?.value || "";
      if (storedProject && storedProject !== projectId) {
        try { db.close?.(); } catch { /* Preserve the project mismatch. */ }
        db = null;
        return operationFailure("MEMORY_PROJECT_MISMATCH", "The derived memory index belongs to a different project.", { expectedProjectId: projectId, actualProjectId: storedProject });
      }
      if (!storedProject) db.prepare("INSERT INTO meta(key, value) VALUES('project_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(projectId);
      return { ok: true, initialized: true, exists: true, path: file, projectId, db };
    } catch (error) {
      try { db?.close?.(); } catch { /* Best effort cleanup after a failed open. */ }
      return operationFailure("MEMORY_DERIVED_INDEX_CORRUPT", `The derived memory index could not be opened: ${error.message}.`, { path: file }, true);
    }
  }

  function close(opened) {
    try { opened?.db?.close?.(); } catch { /* Best effort; caller keeps the operation result. */ }
  }

  function withDatabase(workspace, projectId, callback, options = {}) {
    const opened = open(workspace, projectId, options);
    if (!opened.ok) return opened;
    if (!opened.db) return typeof options.empty === "function" ? options.empty(opened) : opened;
    try { return callback(opened.db, opened); } catch (error) {
      return operationFailure(error.code || "MEMORY_DERIVED_INDEX_FAILED", error.message, { path: opened.path }, true);
    } finally { close(opened); }
  }

  function normalizeRecord(input, projectId) {
    const source = input && typeof input === "object" ? input : {};
    const actualProjectId = String(source.project_id || source.projectId || projectId).trim();
    assertMemoryId(actualProjectId, "proj");
    if (actualProjectId !== projectId) throw Object.assign(new Error("The derived record belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    const domain = String(source.domain || "").trim().toLowerCase();
    if (!DERIVED_DOMAINS.includes(domain)) throw Object.assign(new Error(`Unsupported derived memory domain: ${domain || "<empty>"}.`), { code: "MEMORY_DERIVED_DOMAIN_INVALID", details: { domain } });
    const recordId = String(source.record_id || source.recordId || source.id || "").trim().slice(0, 240);
    if (!recordId) throw Object.assign(new Error("A derived record ID is required."), { code: "MEMORY_DERIVED_RECORD_ID_REQUIRED" });
    const record = normalizedSafeObject(source.data || source.record || source.value || {});
    const provenance = normalizedSafeObject(source.provenance || {});
    return {
      project_id: projectId,
      domain,
      record_id: recordId,
      record_type: text(source.record_type || source.recordType || source.type || domain, 120),
      lifecycle_state: text(source.lifecycle_state || source.lifecycleState || source.state || source.status || "", 80),
      source_revision: numberOr(source.source_revision ?? source.sourceRevision ?? source.revision, 0),
      canonical_key: text(source.canonical_key || source.canonicalKey || source.canonical_key_hash || source.canonicalKeyHash || "", 160),
      title: text(source.title || source.label || source.name || `${domain}:${recordId}`, MAX_TITLE_LENGTH),
      searchable_text: text(source.searchable_text || source.searchableText || `${source.title || source.label || ""} ${json(record)}`, MAX_TEXT_LENGTH),
      data_json: json(record),
      provenance_json: json(provenance),
      updated_at: text(source.updated_at || source.updatedAt || timestamp(now), 80),
    };
  }

  function normalizeEdge(input, projectId) {
    const source = input && typeof input === "object" ? input : {};
    const actualProjectId = String(source.project_id || source.projectId || projectId).trim();
    assertMemoryId(actualProjectId, "proj");
    if (actualProjectId !== projectId) throw Object.assign(new Error("The derived edge belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    const sourceId = String(source.source_id || source.sourceId || source.from || "").trim().slice(0, 240);
    const targetId = String(source.target_id || source.targetId || source.to || "").trim().slice(0, 240);
    const edgeType = text(source.edge_type || source.edgeType || source.type || "", 120);
    if (!sourceId || !targetId || !edgeType) throw Object.assign(new Error("Derived edges require source, target, and type."), { code: "MEMORY_DERIVED_EDGE_INVALID" });
    return {
      project_id: projectId,
      source_id: sourceId,
      target_id: targetId,
      edge_type: edgeType,
      source_domain: text(source.source_domain || source.sourceDomain || "", 80),
      target_domain: text(source.target_domain || source.targetDomain || "", 80),
      source_revision: numberOr(source.source_revision ?? source.sourceRevision ?? source.revision, 0),
      data_json: json(normalizedSafeObject(source.data || source.record || {})),
      provenance_json: json(normalizedSafeObject(source.provenance || {})),
      updated_at: text(source.updated_at || source.updatedAt || timestamp(now), 80),
    };
  }

  function meta(db) {
    return Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().filter((row) => SAFE_META_KEYS.has(row.key)).map((row) => {
      if (["source_revisions", "watermark"].includes(row.key)) {
        try { return [row.key, JSON.parse(row.value)]; } catch { return [row.key, {}]; }
      }
      return [row.key, row.value];
    }));
  }

  function count(db, table, projectId) {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`).get(projectId)?.count || 0);
  }

  function overview(workspace, projectId) {
    return withDatabase(workspace, projectId, (db, opened) => {
      const values = meta(db);
      return {
        ok: true,
        project_id: projectId,
        initialized: true,
        path: opened.path,
        schema_version: Number(values.schema_version || DERIVED_MEMORY_INDEX_SCHEMA_VERSION),
        projection_revision: numberOr(values.projection_revision, 0),
        source_revisions: values.source_revisions || {},
        watermark: values.watermark || null,
        status: values.status || "ready",
        updated_at: values.updated_at || "",
        content_hash: values.content_hash || "",
        counts: { records: count(db, "records", projectId), edges: count(db, "edges", projectId) },
      };
    }, { empty: (opened) => ({ ok: true, project_id: projectId, initialized: false, path: opened.path, schema_version: DERIVED_MEMORY_INDEX_SCHEMA_VERSION, projection_revision: 0, source_revisions: {}, watermark: null, status: "not_built", updated_at: "", content_hash: "", counts: { records: 0, edges: 0 } }) });
  }

  function mapRecord(row) {
    let data = {};
    let provenance = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    try { provenance = JSON.parse(row.provenance_json || "{}"); } catch { provenance = {}; }
    return {
      project_id: row.project_id,
      domain: row.domain,
      record_id: row.record_id,
      record_type: row.record_type,
      lifecycle_state: row.lifecycle_state,
      source_revision: Number(row.source_revision || 0),
      canonical_key: row.canonical_key,
      title: row.title,
      searchable_text: row.searchable_text,
      data,
      provenance,
      updated_at: row.updated_at,
    };
  }

  function mapEdge(row) {
    let data = {};
    let provenance = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
    try { provenance = JSON.parse(row.provenance_json || "{}"); } catch { provenance = {}; }
    return { project_id: row.project_id, source_id: row.source_id, target_id: row.target_id, edge_type: row.edge_type, source_domain: row.source_domain, target_domain: row.target_domain, source_revision: Number(row.source_revision || 0), data, provenance, updated_at: row.updated_at };
  }

  function query(workspace, projectId, request = {}) {
    const domain = String(request.domain || "").trim().toLowerCase();
    if (domain && !DERIVED_DOMAINS.includes(domain)) return operationFailure("MEMORY_DERIVED_DOMAIN_INVALID", `Unsupported derived memory domain: ${domain}.`, { domain });
    const limit = limitOf(request.limit);
    const cursor = decodeCursor(request.cursor);
    if (request.cursor && (!cursor || typeof cursor.domain !== "string" || typeof cursor.record_id !== "string")) return operationFailure("MEMORY_DERIVED_CURSOR_INVALID", "The derived index cursor is invalid.");
    return withDatabase(workspace, projectId, (db) => {
      const values = [];
      const where = ["project_id=?"];
      values.push(projectId);
      if (domain) { where.push("domain=?"); values.push(domain); }
      const recordType = String(request.record_type || request.recordType || "").trim();
      if (recordType) { where.push("record_type=?"); values.push(recordType); }
      const lifecycle = String(request.lifecycle_state || request.lifecycleState || request.state || "").trim();
      if (lifecycle) { where.push("lifecycle_state=?"); values.push(lifecycle); }
      const search = text(request.query || request.search || "", 500).toLowerCase();
      if (search) { where.push("LOWER(searchable_text) LIKE ? ESCAPE '\\'"); values.push(`%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`); }
      if (cursor) {
        where.push("(domain > ? OR (domain=? AND record_id>?))");
        values.push(cursor.domain, cursor.domain, cursor.record_id);
      }
      const predicate = where.join(" AND ");
      const rows = db.prepare(`SELECT * FROM records WHERE ${predicate} ORDER BY domain ASC, record_id ASC LIMIT ?`).all(...values, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map(mapRecord);
      const totalValues = values.slice(0, cursor ? values.length - 3 : values.length);
      const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM records WHERE ${predicate.replace("(domain > ? OR (domain=? AND record_id>?))", "1=1")}`).get(...totalValues)?.count || 0);
      const last = page.at(-1);
      const valuesMeta = meta(db);
      return {
        ok: true,
        project_id: projectId,
        records: page,
        total,
        omitted: Math.max(0, total - page.length),
        next_cursor: hasMore && last ? encodeCursor({ domain: last.domain, record_id: last.record_id }) : null,
        source_revision: numberOr(valuesMeta.projection_revision, 0),
        source_revisions: valuesMeta.source_revisions || {},
        projection_revision: numberOr(valuesMeta.projection_revision, 0),
        status: valuesMeta.status || "ready",
        warnings: [],
      };
    }, { empty: (opened) => ({ ok: true, project_id: projectId, initialized: false, path: opened.path, records: [], total: 0, omitted: 0, next_cursor: null, source_revision: 0, source_revisions: {}, projection_revision: 0, status: "not_built", warnings: [] }) });
  }

  function get(workspace, projectId, recordId, { domain = "" } = {}) {
    const id = String(recordId || "").trim();
    if (!id) return operationFailure("MEMORY_DERIVED_RECORD_ID_REQUIRED", "A derived record ID is required.");
    return withDatabase(workspace, projectId, (db) => {
      const row = domain
        ? db.prepare("SELECT * FROM records WHERE project_id=? AND domain=? AND record_id=?").get(projectId, domain, id)
        : db.prepare("SELECT * FROM records WHERE project_id=? AND record_id=? ORDER BY domain ASC LIMIT 1").get(projectId, id);
      if (!row) return operationFailure("MEMORY_RECORD_NOT_FOUND", "The derived memory record was not found.", { recordId: id });
      return { ok: true, project_id: projectId, record: mapRecord(row), source_revision: numberOr(meta(db).projection_revision, 0) };
    }, { empty: () => operationFailure("MEMORY_RECORD_NOT_FOUND", "The derived memory record was not found.", { recordId: id }) });
  }

  function edges(workspace, projectId, request = {}) {
    const nodeId = String(request.node_id || request.nodeId || request.id || "").trim();
    if (!nodeId) return operationFailure("MEMORY_DERIVED_NODE_ID_REQUIRED", "A graph node ID is required.");
    const limit = limitOf(request.limit);
    return withDatabase(workspace, projectId, (db) => {
      const type = String(request.edge_type || request.edgeType || "").trim();
      const rows = type
        ? db.prepare("SELECT * FROM edges WHERE project_id=? AND edge_type=? AND (source_id=? OR target_id=?) ORDER BY edge_type ASC, source_id ASC, target_id ASC LIMIT ?").all(projectId, type, nodeId, nodeId, limit)
        : db.prepare("SELECT * FROM edges WHERE project_id=? AND (source_id=? OR target_id=?) ORDER BY edge_type ASC, source_id ASC, target_id ASC LIMIT ?").all(projectId, nodeId, nodeId, limit);
      const valuesMeta = meta(db);
      return { ok: true, project_id: projectId, node_id: nodeId, edges: rows.map(mapEdge), source_revision: numberOr(valuesMeta.projection_revision, 0), omitted: Math.max(0, count(db, "edges", projectId) - rows.length) };
    }, { empty: (opened) => ({ ok: true, project_id: projectId, initialized: false, path: opened.path, node_id: nodeId, edges: [], source_revision: 0, omitted: 0 }) });
  }

  function writeMeta(db, projectId, values) {
    const pairs = {
      schema_version: String(DERIVED_MEMORY_INDEX_SCHEMA_VERSION),
      project_id: projectId,
      ...values,
    };
    const statement = db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (const [key, value] of Object.entries(pairs)) {
      if (!SAFE_META_KEYS.has(key)) continue;
      statement.run(key, typeof value === "string" ? value : JSON.stringify(value == null ? {} : value));
    }
  }

  function normalizedRows(projectId, records = [], edgeValues = []) {
    const rows = [...new Map((Array.isArray(records) ? records : []).map((record) => {
      const normalized = normalizeRecord(record, projectId);
      return [`${normalized.domain}|${normalized.record_id}`, normalized];
    })).values()].sort((left, right) => `${left.domain}|${left.record_id}`.localeCompare(`${right.domain}|${right.record_id}`));
    const normalizedEdges = [...new Map((Array.isArray(edgeValues) ? edgeValues : []).map((edge) => {
      const normalized = normalizeEdge(edge, projectId);
      return [`${normalized.source_id}|${normalized.target_id}|${normalized.edge_type}`, normalized];
    })).values()].sort((left, right) => `${left.source_id}|${left.target_id}|${left.edge_type}`.localeCompare(`${right.source_id}|${right.target_id}|${right.edge_type}`));
    return { rows, edges: normalizedEdges };
  }

  function replace(workspace, projectId, { records = [], edges: edgeValues = [], sourceRevisions = {}, watermark = null, projectionRevision = null, status = "ready" } = {}) {
    let normalized;
    try { normalized = normalizedRows(projectId, records, edgeValues); } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_RECORD_INVALID", error.message, error.details || {}); }
    const contentHash = hashValue(crypto, { records: normalized.rows, edges: normalized.edges, source_revisions: sourceRevisions || {}, watermark: watermark || null });
    return withDatabase(workspace, projectId, (db) => {
      const current = meta(db);
      if (current.content_hash === contentHash) return { ok: true, changed: false, project_id: projectId, projection_revision: numberOr(current.projection_revision, 0), content_hash: contentHash, counts: { records: count(db, "records", projectId), edges: count(db, "edges", projectId) } };
      const previousRevision = numberOr(current.projection_revision, 0);
      const nextRevision = projectionRevision == null ? previousRevision + 1 : numberOr(projectionRevision, previousRevision + 1);
      const updatedAt = timestamp(now);
      const recordStatement = db.prepare("INSERT INTO records(project_id,domain,record_id,record_type,lifecycle_state,source_revision,canonical_key,title,searchable_text,data_json,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
      const edgeStatement = db.prepare("INSERT INTO edges(project_id,source_id,target_id,edge_type,source_domain,target_domain,source_revision,data_json,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM records WHERE project_id=?").run(projectId);
        db.prepare("DELETE FROM edges WHERE project_id=?").run(projectId);
        for (const row of normalized.rows) recordStatement.run(row.project_id, row.domain, row.record_id, row.record_type, row.lifecycle_state, row.source_revision, row.canonical_key, row.title, row.searchable_text, row.data_json, row.provenance_json, updatedAt);
        for (const edge of normalized.edges) edgeStatement.run(edge.project_id, edge.source_id, edge.target_id, edge.edge_type, edge.source_domain, edge.target_domain, edge.source_revision, edge.data_json, edge.provenance_json, updatedAt);
        writeMeta(db, projectId, { projection_revision: String(nextRevision), content_hash: contentHash, status: text(status, 40) || "ready", updated_at: updatedAt, source_revisions: sourceRevisions || {}, watermark: watermark || null });
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* Preserve the original database failure. */ }
        throw error;
      }
      return { ok: true, changed: true, project_id: projectId, previous_revision: previousRevision, projection_revision: nextRevision, content_hash: contentHash, counts: { records: normalized.rows.length, edges: normalized.edges.length } };
    }, { create: true });
  }

  function upsert(workspace, projectId, { records = [], edges: edgeValues = [], sourceRevisions = {}, watermark = null, status = "ready" } = {}) {
    let normalized;
    try { normalized = normalizedRows(projectId, records, edgeValues); } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_RECORD_INVALID", error.message, error.details || {}); }
    return withDatabase(workspace, projectId, (db) => {
      const current = meta(db);
      const previousRevision = numberOr(current.projection_revision, 0);
      const updatedAt = timestamp(now);
      let changed = false;
      db.exec("BEGIN IMMEDIATE");
      try {
        const recordStatement = db.prepare("INSERT INTO records(project_id,domain,record_id,record_type,lifecycle_state,source_revision,canonical_key,title,searchable_text,data_json,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,domain,record_id) DO UPDATE SET record_type=excluded.record_type,lifecycle_state=excluded.lifecycle_state,source_revision=excluded.source_revision,canonical_key=excluded.canonical_key,title=excluded.title,searchable_text=excluded.searchable_text,data_json=excluded.data_json,provenance_json=excluded.provenance_json,updated_at=excluded.updated_at");
        for (const row of normalized.rows) {
          const before = db.prepare("SELECT data_json,record_type,lifecycle_state,source_revision,canonical_key,title,searchable_text,provenance_json FROM records WHERE project_id=? AND domain=? AND record_id=?").get(projectId, row.domain, row.record_id);
          recordStatement.run(row.project_id, row.domain, row.record_id, row.record_type, row.lifecycle_state, row.source_revision, row.canonical_key, row.title, row.searchable_text, row.data_json, row.provenance_json, updatedAt);
          if (!before || canonicalJson({ ...before, source_revision: Number(before.source_revision || 0) }) !== canonicalJson({ data_json: row.data_json, record_type: row.record_type, lifecycle_state: row.lifecycle_state, source_revision: row.source_revision, canonical_key: row.canonical_key, title: row.title, searchable_text: row.searchable_text, provenance_json: row.provenance_json })) changed = true;
        }
        const edgeStatement = db.prepare("INSERT INTO edges(project_id,source_id,target_id,edge_type,source_domain,target_domain,source_revision,data_json,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,source_id,target_id,edge_type) DO UPDATE SET source_domain=excluded.source_domain,target_domain=excluded.target_domain,source_revision=excluded.source_revision,data_json=excluded.data_json,provenance_json=excluded.provenance_json,updated_at=excluded.updated_at");
        for (const edge of normalized.edges) { edgeStatement.run(edge.project_id, edge.source_id, edge.target_id, edge.edge_type, edge.source_domain, edge.target_domain, edge.source_revision, edge.data_json, edge.provenance_json, updatedAt); changed = true; }
        if (changed || Object.keys(sourceRevisions || {}).length || watermark) writeMeta(db, projectId, { projection_revision: String(previousRevision + (changed ? 1 : 0)), status: text(status, 40) || "ready", updated_at: updatedAt, source_revisions: sourceRevisions || current.source_revisions || {}, watermark: watermark || current.watermark || null });
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* Preserve the original database failure. */ }
        throw error;
      }
      const revision = previousRevision + (changed ? 1 : 0);
      return { ok: true, changed, project_id: projectId, previous_revision: previousRevision, projection_revision: revision, counts: { records: count(db, "records", projectId), edges: count(db, "edges", projectId) } };
    }, { create: true });
  }

  function remove(workspace, projectId, { recordIds = [], domains = [], edgeIds = [] } = {}) {
    const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
    const selectedDomains = [...new Set((Array.isArray(domains) ? domains : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
    return withDatabase(workspace, projectId, (db) => {
      const current = meta(db);
      const before = count(db, "records", projectId) + count(db, "edges", projectId);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!ids.length && !selectedDomains.length && !edgeIds.length) {
          db.prepare("DELETE FROM records WHERE project_id=?").run(projectId);
          db.prepare("DELETE FROM edges WHERE project_id=?").run(projectId);
        } else {
          for (const id of ids) {
            db.prepare("DELETE FROM records WHERE project_id=? AND record_id=?").run(projectId, id);
            db.prepare("DELETE FROM edges WHERE project_id=? AND (source_id=? OR target_id=? )").run(projectId, id, id);
          }
          for (const selected of selectedDomains) db.prepare("DELETE FROM records WHERE project_id=? AND domain=?").run(projectId, selected);
          for (const edgeId of edgeIds) {
            const parts = String(edgeId).split("|");
            if (parts.length >= 3) db.prepare("DELETE FROM edges WHERE project_id=? AND source_id=? AND target_id=? AND edge_type=?").run(projectId, parts[0], parts[1], parts.slice(2).join("|"));
          }
        }
        const after = count(db, "records", projectId) + count(db, "edges", projectId);
        const changed = before !== after;
        const revision = numberOr(current.projection_revision, 0) + (changed ? 1 : 0);
        if (changed) writeMeta(db, projectId, { projection_revision: String(revision), content_hash: "", updated_at: timestamp(now), status: "ready" });
        db.exec("COMMIT");
        return { ok: true, changed, project_id: projectId, previous_revision: numberOr(current.projection_revision, 0), projection_revision: revision };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* Preserve the original database failure. */ }
        throw error;
      }
    });
  }

  function deleteIndex(workspace, projectId) {
    const file = indexPath(workspace);
    try {
      assertMemoryId(projectId, "proj");
      if (!fs.existsSync(file)) return { ok: true, changed: false, path: file };
      const opened = open(workspace, projectId);
      if (!opened.ok) return opened;
      close(opened);
      for (const candidate of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(candidate, { force: true });
      return { ok: true, changed: true, path: file };
    } catch (error) { return operationFailure(error.code || "MEMORY_DERIVED_INDEX_DELETE_FAILED", error.message, { path: file }, true); }
  }

  return Object.freeze({
    DERIVED_MEMORY_INDEX_SCHEMA_VERSION,
    DERIVED_DOMAINS,
    indexPath,
    normalizeRecord,
    normalizeEdge,
    overview,
    query,
    get,
    edges,
    replace,
    upsert,
    remove,
    delete: deleteIndex,
  });
}

module.exports = Object.freeze({
  DERIVED_MEMORY_INDEX_SCHEMA_VERSION,
  DERIVED_DOMAINS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createDerivedMemoryIndex,
  safeProjection,
});
