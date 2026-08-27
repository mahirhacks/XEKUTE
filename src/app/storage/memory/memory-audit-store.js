"use strict";

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/memory-identity.js");
const { redactSecrets } = require("../../../shared/secret-redaction.js");
const { resolvedWorkspace, operationFailure, timestamp } = require("./memory-storage-utils.js");

const MEMORY_AUDIT_SCHEMA_VERSION = 1;
const MAX_AUDIT_LINE_BYTES = 1 * 1024 * 1024;
const MAX_AUDIT_RECORDS = 10_000;
const MAX_LIST_RECORDS = 200;
const SAFE_DETAIL_KEYS = new Set([
  "memory_type", "domain", "phase", "attempt", "count", "pending", "state", "status",
  "reason", "source_revision", "destination_revision", "projection", "redaction_state",
]);
const SECRET_KEY = /(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|raw[_-]?value|ciphertext|credential)/i;

function text(value, maximum = 500) {
  return redactSecrets(String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim()).slice(0, maximum);
}

function integer(value, fallback = 0) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : fallback;
}

function hash(crypto, value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeDetails(value, depth = 0) {
  if (depth > 3 || !value || typeof value !== "object") return {};
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) {
    if (!SAFE_DETAIL_KEYS.has(key) || SECRET_KEY.test(key)) continue;
    if (typeof child === "number" || typeof child === "boolean") output[key] = child;
    else if (typeof child === "string") output[key] = text(child, 500);
    else if (child && typeof child === "object") output[key] = safeDetails(child, depth + 1);
  }
  return output;
}

function createMemoryAuditStore({ fs = nodeFs, path = nodePath, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!fs || !path || !crypto?.createHash) throw new TypeError("Memory audit store dependencies are required.");

  function workspaceRoot(workspace) { return resolvedWorkspace(path, workspace); }
  function auditFile(workspace) { return path.join(workspaceRoot(workspace), ".xekute", "memory", "diagnostics", "audit.jsonl"); }
  function makeEventId() { return createOpaqueId("event", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }); }

  function normalize(input = {}, projectId, eventId = "") {
    let id;
    let project;
    try {
      id = assertMemoryId(eventId || input.event_id || input.eventId || makeEventId(), "event");
      project = assertMemoryId(projectId || input.project_id || input.projectId, "proj");
    } catch (error) {
      throw Object.assign(new Error(error.message), { code: error.code || "MEMORY_AUDIT_INPUT_INVALID", details: error.details || {} });
    }
    const operation = String(input.operation_id || input.operationId || "").trim();
    if (operation) assertMemoryId(operation, "op");
    const record = {
      schema_version: MEMORY_AUDIT_SCHEMA_VERSION,
      event_id: id,
      project_id: project,
      operation_id: operation,
      block_id: String(input.block_id || input.blockId || "").trim().slice(0, 240),
      category: text(input.category || input.event_type || "memory", 80),
      state: text(input.state || input.status || "", 80),
      code: text(input.code, 120),
      retryable: Boolean(input.retryable),
      duration_ms: Math.max(0, Number(input.duration_ms ?? input.durationMs) || 0),
      previous_revision: integer(input.previous_revision ?? input.previousRevision, 0),
      revision: integer(input.revision, 0),
      changed: input.changed === undefined ? undefined : Boolean(input.changed),
      record_count: integer(input.record_count ?? input.recordCount, 0),
      warning_count: integer(input.warning_count ?? input.warningCount, 0),
      source_revision: integer(input.source_revision ?? input.sourceRevision, 0),
      projection_revision: integer(input.projection_revision ?? input.projectionRevision, 0),
      event_range_hash: text(input.event_range_hash || input.eventRangeHash, 128),
      reduction_hash: text(input.reduction_hash || input.reductionHash, 128),
      record_ids: [...new Set((Array.isArray(input.record_ids || input.recordIds) ? input.record_ids || input.recordIds : []).map((value) => text(value, 240)).filter(Boolean))].slice(0, 100),
      details: safeDetails(input.details),
      occurred_at: new Date(input.occurred_at || input.occurredAt || timestamp(now)).toISOString(),
    };
    if (record.changed === undefined) delete record.changed;
    if (record.operation_id) assertMemoryId(record.operation_id, "op");
    return record;
  }

  function read(workspace, projectId = "") {
    let file;
    try {
      file = auditFile(workspace);
      if (projectId) assertMemoryId(projectId, "proj");
    } catch (error) { return operationFailure(error.code || "MEMORY_AUDIT_INPUT_INVALID", error.message, error.details || {}); }
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") return { ok: true, exists: false, records: [], warnings: [], path: file, tailHash: "" };
      return operationFailure("MEMORY_AUDIT_READ_FAILED", `The memory audit stream could not be read: ${error.message}.`, { path: file }, true);
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const records = [];
    const warnings = [];
    let prior = "";
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (Buffer.byteLength(line, "utf8") > MAX_AUDIT_LINE_BYTES) {
        warnings.push({ code: "MEMORY_AUDIT_LINE_TOO_LARGE", line: index + 1 });
        break;
      }
      let record;
      try { record = JSON.parse(line); } catch {
        warnings.push({ code: "MEMORY_AUDIT_RECORD_INVALID", line: index + 1 });
        break;
      }
      const { integrity_hash: integrityHash, previous_hash: previousHash, ...body } = record || {};
      const calculated = hash(crypto, JSON.stringify({ ...body, previous_hash: previousHash }));
      if (previousHash !== prior || integrityHash !== calculated) {
        warnings.push({ code: "MEMORY_AUDIT_INTEGRITY_FAILED", line: index + 1 });
        break;
      }
      prior = integrityHash;
      if (!projectId || body.project_id === projectId) records.push(body);
    }
    return { ok: true, exists: true, records, warnings, path: file, tailHash: prior };
  }

  function append(workspace, projectId, input = {}) {
    let file;
    let record;
    try {
      file = auditFile(workspace);
      record = normalize(input, projectId);
      const previous = read(workspace, projectId);
      if (!previous.ok) return previous;
      if (previous.warnings?.length) return operationFailure("MEMORY_AUDIT_INTEGRITY_FAILED", "The memory audit stream is already inconsistent; refusing to append diagnostics.", { warnings: previous.warnings });
      const body = { ...record, previous_hash: previous.tailHash || "" };
      const integrityHash = hash(crypto, JSON.stringify(body));
      const line = JSON.stringify({ ...body, integrity_hash: integrityHash });
      if (Buffer.byteLength(line, "utf8") > MAX_AUDIT_LINE_BYTES) return operationFailure("MEMORY_AUDIT_RECORD_TOO_LARGE", "The memory audit record exceeds the JSONL line limit.");
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs protect the workspace. */ }
      return { ok: true, changed: true, event_id: record.event_id, reference: `${path.relative(workspaceRoot(workspace), file).replace(/\\/g, "/")}#${integrityHash.slice(0, 16)}`, integrity_hash: integrityHash };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_AUDIT_WRITE_FAILED", `The memory audit record could not be written: ${error.message}.`, { path: file || "" }, true);
    }
  }

  function list(workspace, projectId, { limit = 50, cursor = "" } = {}) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const bounded = Math.min(MAX_LIST_RECORDS, Math.max(1, Number(limit) || 50));
    const start = cursor ? Math.max(0, loaded.records.findIndex((record) => record.event_id === cursor) + 1) : 0;
    const records = loaded.records.slice(start, start + bounded);
    return { ok: true, exists: loaded.exists, records, total: loaded.records.length, nextCursor: records.length === bounded ? records.at(-1)?.event_id || "" : "", warnings: loaded.warnings, tailHash: loaded.tailHash };
  }

  function summary(workspace, projectId) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const last = loaded.records.at(-1) || null;
    return {
      ok: true,
      exists: loaded.exists,
      records: loaded.records.length,
      tail_hash: loaded.tailHash,
      warnings: loaded.warnings,
      last: last ? {
        event_id: last.event_id,
        category: last.category,
        state: last.state,
        code: last.code,
        revision: last.revision,
        occurred_at: last.occurred_at,
      } : null,
    };
  }

  function verify(workspace, projectId = "") {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    return { ok: loaded.warnings.length === 0, code: loaded.warnings[0]?.code || "", records: loaded.records.length, tailHash: loaded.tailHash, warnings: loaded.warnings };
  }

  return Object.freeze({ MEMORY_AUDIT_SCHEMA_VERSION, MAX_AUDIT_LINE_BYTES, auditFile, normalize, read, append, list, summary, verify });
}

module.exports = Object.freeze({ MEMORY_AUDIT_SCHEMA_VERSION, MAX_AUDIT_LINE_BYTES, MAX_AUDIT_RECORDS, createMemoryAuditStore });
