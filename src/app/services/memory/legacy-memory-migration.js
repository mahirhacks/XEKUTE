"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/memory-identity.js");
const {
  LEGACY_SOURCE_DEFINITIONS,
  createMigrationPreview,
  createMigrationBatch,
} = require("../../../contracts/memory/migration-contracts.js");
const { createKnowledgeRelease } = require("../../../domain/memory/knowledge/knowledge-release.js");
const { normalizeEntity } = require("../../../domain/memory/project/entity-catalog.js");
const { redactSecrets, redactStructuredValue } = require("../../../shared/secret-redaction.js");
const { operationFailure, clone, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const MIGRATION_SERVICE_VERSION = 1;
const MAX_PARSE_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORY_FILES = 1_000;
const MAX_SOURCE_RECORDS = 1_000;
const MAX_MIGRATION_COMMANDS = 5_000;
const MAX_TEXT = 4_000;
const SECRET_MARKER = /(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|bearer|private[_-]?key|passphrase|password|secret)/gi;
const DATASET_COLLECTIONS = Object.freeze({
  "recon/active-recon.json": "discoveredAssets",
  "recon/passive-recon.json": "discoveredAssets",
  "enumeration/assets.json": "assets",
  "enumeration/pages.json": "pages",
  "enumeration/subdomains.json": "subdomains",
  "enumeration/endpoints.json": "endpoints",
  "enumeration/services.json": "services",
  "vulnerability-scans/services.json": "services",
});
const ASSET_TYPES = Object.freeze({
  host: "hostname",
  hostname: "hostname",
  domain: "domain",
  ip: "ip",
  network: "network_range",
  network_range: "network_range",
  application: "application",
  app: "application",
  service: "service",
  endpoint: "endpoint",
  route: "endpoint",
  page: "page",
  component: "component",
  technology: "technology",
  framework: "technology",
  dependency: "dependency",
  repository: "repository",
});
const MAP_TYPES = Object.freeze({
  route: "endpoint",
  endpoint: "endpoint",
  host: "hostname",
  hostname: "hostname",
  domain: "domain",
  application: "application",
  app: "application",
  service: "service",
  component: "component",
  page: "page",
  workflow: "workflow",
  state: "state",
  technology: "technology",
  dependency: "dependency",
});

function text(value, maximum = MAX_TEXT) {
  return redactSecrets(String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim()).slice(0, maximum);
}

function hash(crypto, value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function id(crypto, prefix, value) { return `${prefix}_${hash(crypto, value).slice(0, 32)}`; }
function safeJson(value) { return redactStructuredValue(value); }
function cloneValue(value) { return value === undefined ? undefined : clone(safeJson(value)); }

function safeRelative(pathImpl, workspace, candidate) {
  const relative = String(candidate || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || /^[A-Za-z]:\//.test(relative)) return "";
  const root = pathImpl.resolve(workspace);
  const absolute = pathImpl.resolve(root, relative);
  const prefix = root.endsWith(pathImpl.sep) ? root : `${root}${pathImpl.sep}`;
  return absolute === root || absolute.startsWith(prefix) ? relative : "";
}

function filePath(pathImpl, workspace, relative) {
  const safe = safeRelative(pathImpl, workspace, relative);
  return safe ? pathImpl.resolve(workspace, safe.split("/").join(pathImpl.sep)) : "";
}

function fileHash(fs, crypto, target) {
  const digest = crypto.createHash("sha256");
  const descriptor = fs.openSync(target, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    while (true) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      digest.update(buffer.subarray(0, read));
      bytes += read;
    }
  } finally { try { fs.closeSync(descriptor); } catch { /* best effort */ } }
  return { sha256: digest.digest("hex"), bytes };
}

function sourceRecords(document, relativePath) {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== "object") return [];
  if (Array.isArray(document.nodes) || Array.isArray(document.edges)) return [
    ...(Array.isArray(document.nodes) ? document.nodes.map((item) => ({ ...item, recordType: item?.recordType || "map-node" })) : []),
    ...(Array.isArray(document.edges) ? document.edges.map((item) => ({ ...item, recordType: item?.recordType || "map-edge" })) : []),
  ];
  const preferred = DATASET_COLLECTIONS[relativePath]
    || (relativePath === "findings/findings.json" ? "findings" : "")
    || (relativePath === "runs/runs.json" ? "runs" : "")
    || (relativePath === "penetration-testing/coverage.json" ? "matrix" : "");
  for (const key of [preferred, "records", "items", "findings", "runs", "matrix", "nodes", "observations", "hypotheses", "assets", "endpoints", "services", "pages", "subdomains"].filter(Boolean)) {
    if (Array.isArray(document[key])) return document[key];
  }
  // Some older writers persisted one record directly rather than wrapping it
  // in a collection.  Treat only record-shaped roots as one record; a generic
  // settings object remains an empty collection and is never imported as a
  // semantic fact.
  const recordKeys = ["id", "recordId", "record_id", "type", "status", "url", "endpoint", "target", "summary", "description", "name", "title"];
  return recordKeys.some((key) => Object.prototype.hasOwnProperty.call(document, key)) ? [document] : [];
}

function schemaVersion(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return "";
  return text(document.schema_version || document.schemaVersion || document.version || document.kind || "", 120);
}

function inspectFile({ fs, path, crypto, workspace, sourceKey, relativePath, format, owner, sensitivity }) {
  const target = filePath(path, workspace, relativePath);
  const base = { key: sourceKey, path: relativePath, format, owner, sensitivity, exists: false, readable: false, bytes: 0, sha256: "", schema_version: "", record_count: 0, invalid_count: 0, secret_markers: 0, truncated: false, warnings: [] };
  if (!target || !fs.existsSync(target)) return { summary: base, records: [], document: null };
  let stat;
  try { stat = fs.statSync(target); } catch (error) { return { summary: { ...base, exists: true, readable: false, warnings: [{ code: "MEMORY_MIGRATION_SOURCE_STAT_FAILED", message: text(error.message, 500), path: relativePath }] }, records: [], document: null }; }
  if (!stat.isFile()) return { summary: { ...base, exists: true, readable: false, warnings: [{ code: "MEMORY_MIGRATION_SOURCE_NOT_FILE", message: "The legacy source path is not a file.", path: relativePath }] }, records: [], document: null };
  let digest;
  try { digest = fileHash(fs, crypto, target); } catch (error) { return { summary: { ...base, exists: true, readable: false, bytes: Number(stat.size) || 0, warnings: [{ code: "MEMORY_MIGRATION_SOURCE_READ_FAILED", message: text(error.message, 500), path: relativePath }] }, records: [], document: null }; }
  const summary = { ...base, exists: true, readable: true, bytes: digest.bytes, sha256: digest.sha256 };
  let raw = null;
  try {
    if (digest.bytes <= MAX_PARSE_BYTES) raw = fs.readFileSync(target, "utf8");
    else summary.truncated = true;
  } catch (error) {
    summary.readable = false;
    summary.warnings.push({ code: "MEMORY_MIGRATION_SOURCE_READ_FAILED", message: text(error.message, 500), path: relativePath });
  }
  if (raw == null) {
    try {
      const descriptor = fs.openSync(target, "r");
      const sampleBuffer = Buffer.alloc(Math.min(digest.bytes, 64 * 1024));
      const bytesRead = fs.readSync(descriptor, sampleBuffer, 0, sampleBuffer.length, 0);
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
      summary.secret_markers = (sampleBuffer.subarray(0, bytesRead).toString("utf8").match(SECRET_MARKER) || []).length;
    } catch { /* metadata remains sufficient */ }
    return { summary, records: [], document: null };
  }
  summary.secret_markers = (raw.match(SECRET_MARKER) || []).length;
  if (format === "text") {
    // Markdown and text plans are inventory-only inputs. Their contents are
    // intentionally not parsed into migration records or returned in a
    // preview; the source hash and bounded metadata preserve lineage.
    return { summary, records: [], document: null };
  }
  if (format === "jsonl") {
    const records = [];
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch (error) { summary.invalid_count += 1; summary.warnings.push({ code: "MEMORY_MIGRATION_JSONL_INVALID", message: "A legacy JSONL record could not be parsed.", path: relativePath, line: index + 1 }); }
      if (records.length >= MAX_SOURCE_RECORDS) { summary.truncated = true; break; }
    }
    summary.record_count = records.length;
    summary.schema_version = schemaVersion(records[0]);
    return { summary, records, document: null };
  }
  let document;
  try { document = JSON.parse(raw); } catch (error) {
    summary.invalid_count = 1;
    summary.warnings.push({ code: "MEMORY_MIGRATION_JSON_INVALID", message: "The legacy JSON source could not be parsed.", path: relativePath });
    return { summary, records: [], document: null };
  }
  const records = sourceRecords(document, relativePath).slice(0, MAX_SOURCE_RECORDS);
  summary.record_count = records.length;
  summary.schema_version = schemaVersion(document) || schemaVersion(records[0]);
  if (sourceRecords(document, relativePath).length > records.length) summary.truncated = true;
  return { summary, records, document };
}

function walkFiles({ fs, path, root, relative, limit = MAX_DIRECTORY_FILES }) {
  const target = filePath(path, root, relative);
  if (!target || !fs.existsSync(target)) return [];
  let stat;
  try { stat = fs.statSync(target); } catch { return []; }
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) return [];
  const result = [];
  const visit = (absolute, relativePath) => {
    if (result.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(absolute, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (result.length >= limit) break;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = `${relativePath}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory()) visit(childAbsolute, childRelative);
      else if (entry.isFile()) result.push(childRelative);
    }
  };
  visit(target, String(relative || "").replace(/\\/g, "/").replace(/\/$/, ""));
  return result;
}

function sourceSelectionEnabled(selection, key) {
  if (!selection || typeof selection !== "object" || !Object.keys(selection).length) return true;
  if (selection[key] !== undefined) return Boolean(selection[key]);
  return Object.entries(selection).some(([candidate, enabled]) => enabled && (candidate === key || key.startsWith(`${candidate}:`) || key.startsWith(`${candidate}_`)));
}

function safeAttributes(record, sourcePath, index) {
  const source = record && typeof record === "object" ? record : {};
  const allowed = ["name", "label", "title", "description", "summary", "type", "assetType", "value", "url", "href", "host", "hostname", "path", "pathname", "method", "port", "protocol", "transport", "version", "technology", "framework", "source", "discoveredBy", "status", "live", "inScope", "authentication", "role", "component", "application", "tags"];
  const attributes = { legacy_source: sourcePath, legacy_index: index };
  for (const key of allowed) {
    if (source[key] === undefined || source[key] === null || typeof source[key] === "object") continue;
    if (/cookie|authorization|token|secret|password|private[_-]?key|passphrase/i.test(key)) continue;
    attributes[key] = text(source[key], 1_000);
  }
  return attributes;
}

function inferEntityType(record, relativePath) {
  const source = record && typeof record === "object" ? record : {};
  const explicit = text(source.entity_type || source.entityType || source.assetType || source.asset_type || source.type || "", 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (ASSET_TYPES[explicit]) return ASSET_TYPES[explicit];
  if (relativePath.includes("endpoints")) return "endpoint";
  if (relativePath.includes("pages")) return "page";
  if (relativePath.includes("subdomains")) return "hostname";
  if (relativePath.includes("services")) return "service";
  if (source.ip || source.address) return "ip";
  if (source.hostname || source.host) return "hostname";
  if (source.url || source.href || source.path || source.pathname) return "application";
  return "";
}

function entityInput(record, type) {
  const source = record && typeof record === "object" ? record : { value: record };
  const name = text(source.name || source.label || source.title || source.hostname || source.host || source.url || source.href || source.path || source.value || source.address || source.ip || "", 1_000);
  return {
    entity_type: type,
    name,
    label: name,
    url: source.url || source.href,
    hostname: source.hostname || source.host,
    host: source.host || source.hostname,
    path: source.path || source.pathname,
    method: source.method,
    port: source.port,
    protocol: source.protocol || source.transport,
    address: source.address || source.ip,
    ip: source.ip || source.address,
    cidr: source.cidr || source.network || source.range,
    version: source.version,
    attributes: safeAttributes(source, "legacy", 0),
  };
}

function mapNodeEntity(node) {
  const source = node && typeof node === "object" ? node : {};
  const rawType = text(source.entity_type || source.entityType || source.type || "", 80).toLowerCase();
  const type = MAP_TYPES[rawType];
  if (!type) return null;
  const name = text(source.name || source.label || source.title || source.host || source.hostname || source.url || source.template || source.path || source.id || "", 1_000);
  if (!name) return null;
  return { ...entityInput({ ...source, name }, type), entity_type: type, name, label: name };
}

function sourceWarning(source, code, message) {
  return { code, message: text(message, 2_000), source_key: source?.key || "", path: source?.path || "" };
}

function commandBase({ operationId, projectId, actor, provenance, expectedRevision, memoryType }) {
  return {
    operation_id: operationId,
    idempotency_key: operationId,
    project_id: projectId,
    memory_type: memoryType,
    expected_base_revision: expectedRevision,
    actor: clone(actor),
    session_id: null,
    block_id: null,
    provenance: clone(provenance),
    sensitivity: memoryType === "project" ? "confidential" : "internal",
  };
}

function sourceProvenance({ source, operationId, now }) {
  return {
    source_type: "import",
    source_refs: [`legacy_source:${source?.sha256 || hash(nodeCrypto, source?.path || "missing")}`, `migration_batch:${operationId}`],
    captured_at: timestamp(now),
    source_hash: source?.sha256 || "",
    migration_batch_id: operationId,
  };
}

function createLegacyKnowledgeRelease({ crypto, now }) {
  return createKnowledgeRelease({
    release_id: "kb_legacy_migration_v1",
    state: "published",
    source: { type: "migration", name: "Xekute legacy migration procedures", version: "1", uri: "xekute://migration/legacy", publisher: "Xekute" },
    procedures: [{
      procedure_id: "procedure_legacy_history_import",
      title: "Review imported legacy history",
      objective: "Review imported legacy records and classify them without treating historical claims as verified vulnerabilities.",
      target_features: ["legacy_import"],
      steps: [{ step_id: "review", instruction: "Review the imported legacy record and preserve its source provenance.", expected: "The record remains traceable to its legacy source.", rejecting: "The record cannot be verified from its source." }],
      verification_rule: { type: "manual_review", requires_source_provenance: true },
      safety_constraints: ["Do not promote legacy candidates to Evidence Memory without the current verification gate."],
      classifications: ["migration", "legacy"],
      source_refs: ["xekute://migration/legacy"],
    }],
  }, { crypto, now });
}

function statusOfLegacy(record) {
  const source = record && typeof record === "object" ? record : {};
  return text(source.status || source.state || source.verdict || source.outcome || "", 80).toLowerCase();
}

function summaryOf(record, fallback = "Imported legacy record") {
  if (typeof record === "string") return text(record, 2_000);
  const source = record && typeof record === "object" ? record : {};
  for (const key of ["summary", "statement", "description", "title", "name", "question"]) {
    if (source[key] !== undefined && source[key] !== null && !/cookie|authorization|token|secret|password|private[_-]?key|passphrase/i.test(key)) {
      const value = text(source[key], 2_000);
      if (value) return value;
    }
  }
  return text(fallback, 2_000);
}

function legacyFindingLooksConfirmed(record) {
  const source = record && typeof record === "object" ? record : {};
  const severity = text(source.severity || source.priority, 40).toLowerCase();
  const state = statusOfLegacy(source);
  const refs = source.evidenceRefs || source.evidence_refs || source.evidenceIds || source.evidence_ids;
  const reproduction = source.reproduction || source.reproductionSteps || source.steps;
  return ["low", "medium", "high", "critical"].includes(severity)
    && ["verified", "confirmed", "accepted", "reproduced"].includes(state)
    && Array.isArray(refs) && refs.length > 0
    && ((Array.isArray(reproduction) && reproduction.length > 0) || (reproduction && typeof reproduction === "object"));
}

function hasSecretMaterial(value, key = "", depth = 0, seen = new WeakSet()) {
  if (depth > 12) return true;
  if (/cookie|authorization|token|secret|password|private[_-]?key|passphrase|credential/i.test(String(key || ""))) return true;
  if (typeof value === "string") {
    return /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/i.test(value)
      || /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[=:]\s*[^\s,;]{4,}/i.test(value);
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasSecretMaterial(item, "", depth + 1, seen));
  return Object.entries(value).some(([childKey, child]) => hasSecretMaterial(child, childKey, depth + 1, seen));
}

function legacyIdOf(record, fallback = "") {
  if (typeof record === "string") return text(record, 300) || fallback;
  const source = record && typeof record === "object" ? record : {};
  return text(source.id || source.record_id || source.recordId || source.runId || source.run_id || source.findingId || source.finding_id || source.hypothesisId || source.hypothesis_id || source.key || fallback, 300) || fallback;
}

function recordTypeOf(record, sourceKey = "") {
  const source = record && typeof record === "object" ? record : {};
  const value = text(source.record_type || source.recordType || source.kind || source.type || source.category || source.status || sourceKey, 120).toLowerCase().replace(/[\s-]+/g, "_");
  if (sourceKey.includes("hypothes")) return "hypothesis";
  if (sourceKey.includes("finding")) return "finding";
  if (sourceKey.includes("coverage")) return "coverage";
  if (sourceKey.includes("runs") || sourceKey.includes("run")) return "run";
  if (sourceKey.includes("scan")) return "scan_result";
  return value || "legacy_record";
}

function boundedLegacySummary(record, fallback = "Imported legacy record") {
  if (typeof record === "string") return text(record, 2_000);
  const source = record && typeof record === "object" ? record : {};
  for (const key of ["summary", "statement", "description", "title", "name", "question", "expectedSignal", "expected_signal", "reason", "message"]) {
    if (/cookie|authorization|token|secret|password|private[_-]?key|passphrase/i.test(key)) continue;
    const value = source[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const result = text(value, 2_000);
    if (result) return result;
  }
  return text(fallback, 2_000);
}

function publicSource(source) {
  return {
    key: text(source?.key, 160),
    path: text(source?.path, 1_000),
    format: text(source?.format, 40),
    owner: text(source?.owner, 80),
    sensitivity: text(source?.sensitivity, 40),
    exists: Boolean(source?.exists),
    readable: source?.readable !== false,
    bytes: Number(source?.bytes) || 0,
    sha256: text(source?.sha256, 128).toLowerCase(),
    schema_version: text(source?.schema_version, 120),
    record_count: Number(source?.record_count) || 0,
    invalid_count: Number(source?.invalid_count) || 0,
    secret_markers: Number(source?.secret_markers) || 0,
    truncated: Boolean(source?.truncated),
    warnings: Array.isArray(source?.warnings) ? source.warnings.map((warning) => ({
      code: text(warning?.code || "MEMORY_MIGRATION_WARNING", 160),
      message: text(warning?.message || "Migration source requires attention.", 2_000),
      ...(warning?.path ? { path: text(warning.path, 1_000) } : {}),
      ...(warning?.line == null ? {} : { line: Number(warning.line) || 0 }),
    })).slice(0, 50) : [],
  };
}

function sourceFormat(relativePath, declaredFormat = "json") {
  const lower = String(relativePath || "").toLowerCase();
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text";
  return declaredFormat === "directory" ? "json" : declaredFormat;
}

function readJsonFile({ fs, path, workspace, relativePath }) {
  const target = filePath(path, workspace, relativePath);
  if (!target || !fs.existsSync(target)) return null;
  try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { return null; }
}

function externalChatFile({ fs, path, crypto, directory, workspace }) {
  const root = String(directory || "").trim();
  if (!root) return "";
  const digest = crypto.createHash("sha256").update(String(workspace || "").trim() || "global", "utf8").digest("hex");
  const candidate = path.resolve(root, "chat-sessions", `${digest}.json`);
  const rootResolved = path.resolve(root);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  return candidate.startsWith(prefix) ? candidate : "";
}

function inspectExternalChat({ fs, path, crypto, directory, workspace }) {
  const target = externalChatFile({ fs, path, crypto, directory, workspace });
  const relativePath = "external:chat-sessions/<workspace-hash>.json";
  const summary = {
    key: "legacy_chat_session",
    path: relativePath,
    format: "json",
    owner: "session",
    sensitivity: "restricted",
    exists: false,
    readable: false,
    bytes: 0,
    sha256: "",
    schema_version: "",
    record_count: 0,
    invalid_count: 0,
    secret_markers: 0,
    truncated: false,
    warnings: [],
  };
  if (!target || !fs.existsSync(target)) return { summary, target, document: null };
  summary.exists = true;
  try {
    const digest = fileHash(fs, crypto, target);
    summary.readable = true;
    summary.bytes = digest.bytes;
    summary.sha256 = digest.sha256;
    if (digest.bytes > MAX_PARSE_BYTES) {
      summary.truncated = true;
      summary.warnings.push({ code: "MEMORY_MIGRATION_CHAT_TOO_LARGE", message: "The legacy chat session is too large for bounded preview parsing.", path: relativePath });
      return { summary, target, document: null };
    }
    const raw = fs.readFileSync(target, "utf8");
    summary.secret_markers = (raw.match(SECRET_MARKER) || []).length;
    const document = JSON.parse(raw);
    const sessions = [
      ...(Array.isArray(document?.sessions) ? document.sessions : []),
      ...(Array.isArray(document?.closedSessions) ? document.closedSessions : []),
    ];
    summary.record_count = sessions.length || (document && typeof document === "object" ? 1 : 0);
    summary.schema_version = schemaVersion(document);
    return { summary, target, document };
  } catch (error) {
    summary.readable = false;
    summary.invalid_count = 1;
    summary.warnings.push({ code: "MEMORY_MIGRATION_CHAT_INVALID", message: "The legacy chat source could not be parsed safely.", path: relativePath });
    return { summary, target, document: null };
  }
}

function sourceCandidates({ fs, path, workspace, selection = {} }) {
  const result = [];
  const seen = new Set();
  const add = (definition, relativePath, format = definition.format, key = definition.key) => {
    const normalizedPath = String(relativePath || "").replace(/\\/g, "/");
    const identity = `${key}|${normalizedPath}`;
    if (!normalizedPath || seen.has(identity) || !sourceSelectionEnabled(selection, definition.key) && !sourceSelectionEnabled(selection, key)) return;
    seen.add(identity);
    result.push({ key, path: normalizedPath, format: sourceFormat(normalizedPath, format), owner: definition.owner, sensitivity: definition.sensitivity });
  };
  for (const definition of LEGACY_SOURCE_DEFINITIONS) {
    for (const declaredPath of definition.paths) {
      if (definition.format !== "directory") {
        add(definition, declaredPath);
        continue;
      }
      const target = filePath(path, workspace, declaredPath);
      const files = walkFiles({ fs, path, root: workspace, relative: declaredPath });
      if (files.length) files.forEach((relativePath) => add(definition, relativePath, "directory", `${definition.key}:${declaredPath}`));
      else if (!target || !fs.existsSync(target)) add(definition, declaredPath, "directory", definition.key);
      else add(definition, declaredPath, "directory", definition.key);
    }
  }
  // The current traffic graph may be stored as a generated file referenced by
  // its manifest. It is a derived source and must remain a view, never truth.
  const graphManifest = readJsonFile({ fs, path, workspace, relativePath: "traffic/graph/manifest.json" });
  const graphPath = String(graphManifest?.latest?.file || graphManifest?.latest_file || "").replace(/\\/g, "/");
  if (/^traffic\/graph\/[^/]+\.json$/i.test(graphPath)) {
    const definition = { key: "map_graph", owner: "derived", sensitivity: "confidential", format: "json" };
    add(definition, graphPath, "json", "map_graph");
  }
  return result;
}

function inspectSources({ fs, path, crypto, workspace, selection = {} }) {
  const entries = [];
  for (const candidate of sourceCandidates({ fs, path, workspace, selection })) {
    const inspected = candidate.format === "directory"
      ? inspectFile({ fs, path, crypto, workspace, sourceKey: candidate.key, relativePath: candidate.path, format: "text", owner: candidate.owner, sensitivity: candidate.sensitivity })
      : inspectFile({ fs, path, crypto, workspace, sourceKey: candidate.key, relativePath: candidate.path, format: candidate.format, owner: candidate.owner, sensitivity: candidate.sensitivity });
    entries.push({ ...candidate, ...inspected });
  }
  return entries;
}

function createLegacyMemoryMigration({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  featureFlags = {},
  projectIdentityStore = null,
  projectMemoryV1Adapter = null,
  projectRepository = null,
  investigationRepository = null,
  investigationMemoryService = null,
  evidenceRepository = null,
  artifactRegistry = null,
  knowledgeReleaseStore = null,
  migrationStore = null,
  sessionMemoryStore = null,
  legacyChatDirectory = "",
  compatibilityWriter = null,
  outboxStore = null,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Legacy memory migration dependencies are required.");

  const store = migrationStore || require("../../storage/memory/migration-store.js").createMigrationStore({ fs, path, crypto, now });
  const actor = { type: "importer", id: "memory-v2-migration" };
  const queues = new Map();

  function stamp() { return timestamp(now); }
  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function projectIdOf(workspace, requested = "", { persist = false } = {}) {
    const requestedId = String(requested || "").trim();
    if (requestedId) {
      try { assertMemoryId(requestedId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, error.details || {}); }
    }
    if (!projectIdentityStore?.resolveProject) return requestedId
      ? { ok: true, projectId: requestedId, workspace: rootOf(workspace), persisted: false }
      : operationFailure("MEMORY_PROJECT_REGISTRY_UNAVAILABLE", "The protected project registry is unavailable.", {}, true);
    const resolved = projectIdentityStore.resolveProject(workspace, { persist, projectId: requestedId });
    if (!resolved?.ok) return resolved;
    if (requestedId && !resolved.persisted) return operationFailure("MEMORY_PROJECT_NOT_BOUND", "The requested project ID is not bound to this workspace in the protected registry.", { projectId: requestedId });
    return { ok: true, projectId: resolved.projectId || requestedId || "", workspace: resolved.workspace || rootOf(workspace), canonical: resolved.canonical || "", persisted: Boolean(resolved.persisted) };
  }
  function queueKey(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }
  function enqueue(workspace, projectId, task) {
    const key = queueKey(workspace, projectId);
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(task);
    const pending = next.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
    queues.set(key, pending);
    return pending;
  }
  function selectionOf(input) { return input?.sources || input?.sourceSelection || input?.source_selection || {}; }
  function internalSourceRef(source) { return `legacy_source:${source?.sha256 || hash(crypto, source?.path || "missing")}`; }
  function sourceByPath(plan, value) {
    const needle = String(value || "").replace(/\\/g, "/");
    return plan.entries.find((entry) => entry.path === needle || entry.summary?.path === needle) || null;
  }
  function addCount(counts, key, amount = 1) { counts[key] = (Number(counts[key]) || 0) + amount; }
  function pushWarning(warnings, value) {
    const warning = {
      code: text(value?.code || "MEMORY_MIGRATION_WARNING", 160),
      message: text(value?.message || value?.error || "Migration requires attention.", 2_000),
      ...(value?.source_key || value?.sourceKey ? { source_key: text(value.source_key || value.sourceKey, 160) } : {}),
      ...(value?.path ? { path: text(value.path, 1_000) } : {}),
      ...(value?.line == null ? {} : { line: Number(value.line) || 0 }),
    };
    if (!warnings.some((item) => item.code === warning.code && item.path === warning.path && item.message === warning.message)) warnings.push(warning);
    return warning;
  }
  function addMapping(mappings, counts, { source, index = 0, record, owner = source?.owner || "unclassified", disposition = "legacy_unclassified", reason = "", recordType = "", recordId = "" }) {
    const value = {
      source_key: text(source?.key || "", 160),
      path: text(source?.path || "", 1_000),
      source_index: Math.max(0, Number(index) || 0),
      legacy_id: legacyIdOf(record, `${source?.key || "legacy"}-${index}`),
      owner: text(owner, 80),
      disposition: text(disposition, 80),
      reason: text(reason, 2_000),
      record_type: text(recordType || recordTypeOf(record, source?.key || ""), 120),
      record_id: text(recordId, 300),
    };
    mappings.push(value);
    addCount(counts, disposition);
    return value;
  }

  function collect(workspace, projectId, options = {}) {
    const root = rootOf(workspace);
    const entries = inspectSources({ fs, path, crypto, workspace: root, selection: selectionOf(options) });
    const external = inspectExternalChat({ fs, path, crypto, directory: options.legacyChatDirectory || legacyChatDirectory, workspace: root });
    if (external.summary.exists || options.includeMissingExternalSession !== false) entries.push({ key: external.summary.key, path: external.summary.path, format: external.summary.format, owner: external.summary.owner, sensitivity: external.summary.sensitivity, summary: external.summary, records: [], document: external.document, externalTarget: external.target });
    const warnings = [];
    for (const entry of entries) {
      for (const warning of entry.summary?.warnings || []) pushWarning(warnings, { ...warning, source_key: entry.key });
      if (entry.summary?.secret_markers > 0) pushWarning(warnings, { code: "MEMORY_MIGRATION_SECRET_MARKERS", message: "The legacy source contains secret-like fields; values will not be imported into general memory.", source_key: entry.key, path: entry.path });
      if (entry.owner === "sensitive") pushWarning(warnings, { code: "MEMORY_MIGRATION_SENSITIVE_SOURCE_SKIPPED", message: "Identity and credential source metadata is inventory-only and is not imported into Sensitive Working Memory.", source_key: entry.key, path: entry.path });
    }
    return { root, projectId: projectId || "", entries, warnings };
  }

  function adapterPlan(plan) {
    if (!plan.projectId || !projectMemoryV1Adapter?.preview) return { ok: true, preview: null, warnings: [] };
    try {
      const result = projectMemoryV1Adapter.preview(plan.root, plan.projectId);
      if (!result?.ok) return { ok: false, result };
      return { ok: true, preview: result.preview, warnings: result.preview?.warnings || [] };
    } catch (error) {
      return { ok: false, result: operationFailure("MEMORY_MIGRATION_PROJECT_V1_PREVIEW_FAILED", error.message, {}, false) };
    }
  }

  function commandForProject(operationId, projectId, source, mutationType, payload) {
    return {
      schema_version: 1,
      operation_id: operationId,
      idempotency_key: operationId,
      project_id: projectId,
      memory_type: "project",
      expected_base_revision: 0,
      actor: clone(actor),
      session_id: null,
      block_id: null,
      mutation_type: mutationType,
      target_record_id: null,
      canonical_key: null,
      payload: cloneValue(payload),
      provenance: {
        source_type: "import",
        source_refs: [internalSourceRef(source), `migration_service:${MIGRATION_SERVICE_VERSION}`],
        captured_at: stamp(),
        source_hash: source?.sha256 || "",
      },
      sensitivity: "confidential",
    };
  }

  function projectEntityCandidate({ record, source, index, projectId }) {
    if (hasSecretMaterial(record)) return { skipped: true, reason: "The legacy record contains secret-like material." };
    const type = inferEntityType(record, source?.path || "");
    const value = record && typeof record === "object" ? record : { value: record };
    const name = text(value.name || value.label || value.title || value.hostname || value.host || value.url || value.href || value.path || value.value || value.address || value.ip || "", 1_000);
    if (!type || !name) return { skipped: true, reason: !type ? "The legacy record has no supported Project entity type." : "The legacy record has no bounded identifying value." };
    const input = {
      ...entityInput(value, type),
      project_id: projectId,
      entity_type: type,
      name,
      label: name,
      record_id: id(crypto, "entity", `${projectId}|${type}|${name}|${value.url || value.href || ""}|${value.hostname || value.host || ""}|${value.path || value.pathname || ""}|${value.method || ""}|${value.port || ""}`),
      aliases: [legacyIdOf(value, `${source?.key || "legacy"}-${index}`)].filter(Boolean),
      attributes: safeAttributes(value, source?.path || source?.key || "legacy", index),
      retrieval_labels: [type, "legacy_import"],
    };
    try { return { entity: normalizeEntity(input, { projectId, recordId: input.record_id }) }; }
    catch (error) { return { skipped: true, reason: error.message, code: error.code || "MEMORY_ENTITY_INVALID" }; }
  }

  function mapProjectSources(plan, operationId, mappings, counts, projectCommands) {
    const canonical = new Map();
    const aliases = new Map();
    for (const command of projectCommands) {
      const entity = command.payload?.entity;
      if (entity?.canonical_key_hash) canonical.set(entity.canonical_key_hash, entity.record_id);
    }
    const nodeIds = new Map();
    const entitySources = new Set(["assessment_assets", "scan_results", "map_legacy", "map_graph"]);
    for (const source of plan.entries) {
      if (!entitySources.has(source.key) && !source.key.startsWith("assessment_assets:")) continue;
      for (const [index, record] of (source.records || []).entries()) {
        if (hasSecretMaterial(record)) {
          addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "skipped", reason: "Secret-bearing legacy content is never imported into Project Memory." });
          addCount(counts, "secret_rejected");
          continue;
        }
        const mapNode = source.key === "map_legacy" || source.key === "map_graph" ? mapNodeEntity(record) : null;
        const candidate = mapNode
          ? projectEntityCandidate({ record: { ...(record && typeof record === "object" ? record : {}), ...mapNode }, source, index, projectId: plan.projectId })
          : projectEntityCandidate({ record, source, index, projectId: plan.projectId });
        if (!candidate || candidate.skipped || !candidate.entity) {
          addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "legacy_unclassified", reason: candidate?.reason || "The record is not a supported Project entity." });
          continue;
        }
        const entity = source.key === "map_legacy" || source.key === "map_graph"
          ? (() => {
            try {
              const base = { ...entityInput(record, candidate.entity.entity_type), ...candidate, project_id: plan.projectId, record_id: id(crypto, "entity", `${plan.projectId}|${candidate.entity.entity_type}|${candidate.name || candidate.label || ""}|${candidate.url || ""}|${candidate.path || ""}`), aliases: [legacyIdOf(record, `${source.key}-${index}`)], attributes: safeAttributes(record, source.path, index) };
              return normalizeEntity(base, { projectId: plan.projectId, recordId: base.record_id });
            } catch { return candidate.entity; }
          })()
          : candidate.entity;
        const prior = canonical.get(entity.canonical_key_hash);
        if (prior) {
          const legacy = legacyIdOf(record, `${source.key}-${index}`);
          aliases.set(legacy, prior);
          addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "deduplicated", reason: "An equivalent canonical entity is already staged.", recordType: "entity", recordId: prior });
          nodeIds.set(legacy, prior);
          nodeIds.set(String(legacy).toLowerCase(), prior);
          continue;
        }
        canonical.set(entity.canonical_key_hash, entity.record_id);
        const command = commandForProject(operationId, plan.projectId, source.summary, "upsert_entity", { entity });
        projectCommands.push(command);
        addCount(counts, "project_commands");
        addCount(counts, "project_entities");
        const legacy = legacyIdOf(record, `${source.key}-${index}`);
        nodeIds.set(legacy, entity.record_id);
        nodeIds.set(String(legacy).toLowerCase(), entity.record_id);
        nodeIds.set(String(entity.label || "").toLowerCase(), entity.record_id);
        addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "accepted", reason: "A factual legacy target record was normalized into Project Memory.", recordType: "entity", recordId: entity.record_id });
      }
    }
    // Map edges are processed after nodes so endpoint validation can use the
    // canonical entity types. Invalid/unknown edges remain migration residue.
    for (const source of plan.entries.filter((entry) => ["map_legacy", "map_graph"].includes(entry.key))) {
      for (const [index, record] of (source.records || []).entries()) {
        const raw = record && typeof record === "object" ? record : {};
        const sourceLegacy = text(raw.source_id || raw.sourceId || raw.from || raw.source || "", 300);
        const targetLegacy = text(raw.target_id || raw.targetId || raw.to || raw.target || "", 300);
        const sourceId = nodeIds.get(sourceLegacy) || nodeIds.get(sourceLegacy.toLowerCase());
        const targetId = nodeIds.get(targetLegacy) || nodeIds.get(targetLegacy.toLowerCase());
        const relationshipType = text(raw.relationship_type || raw.relationshipType || raw.relation || raw.edge_type || raw.type || "", 120).toUpperCase().replace(/[\s-]+/g, "_");
        if (!sourceId || !targetId || !relationshipType) continue;
        const sourceEntity = projectCommands.find((command) => command.payload?.entity?.record_id === sourceId)?.payload.entity;
        const targetEntity = projectCommands.find((command) => command.payload?.entity?.record_id === targetId)?.payload.entity;
        const relationshipId = id(crypto, "rel", `${plan.projectId}|${sourceId}|${relationshipType}|${targetId}`);
        const relationship = { record_type: "relationship", record_id: relationshipId, project_id: plan.projectId, relationship_type: relationshipType, source_id: sourceId, target_id: targetId, source_entity_type: sourceEntity?.entity_type || "", target_entity_type: targetEntity?.entity_type || "", observed_at: stamp(), confidence: 0.5, attributes: safeAttributes(raw, source.path, index) };
        try {
          const normalized = require("../../../domain/memory/project/relationship-catalog.js").normalizeRelationship(relationship, { projectId: plan.projectId, recordId: relationshipId, sourceType: sourceEntity?.entity_type || "", targetType: targetEntity?.entity_type || "" });
          projectCommands.push(commandForProject(operationId, plan.projectId, source.summary, "upsert_relationship", { relationship: normalized }));
          addCount(counts, "project_commands");
          addCount(counts, "project_relationships");
          addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "accepted", reason: "A legacy Map edge passed Project relationship endpoint validation.", recordType: "relationship", recordId: relationshipId });
        } catch (error) {
          addMapping(mappings, counts, { source, index, record, owner: "project", disposition: "legacy_unclassified", reason: error.message, recordType: "relationship" });
        }
      }
    }
    return { aliases, nodeIds };
  }

  function registerSourceArtifacts(plan, { registerArtifacts = true } = {}) {
    const byPath = new Map();
    const artifacts = [];
    const warnings = [];
    if (!registerArtifacts || !artifactRegistry?.register || !plan.projectId) return { ok: true, artifacts, warnings, byPath };
    for (const source of plan.entries) {
      const summary = source.summary;
      if (!summary?.exists || summary.readable === false || !summary.sha256 || source.owner === "sensitive" || source.key === "legacy_chat_session" || source.format === "directory") continue;
      if (!source.path || source.path.startsWith("external:")) continue;
      const input = {
        kind: source.owner === "derived" ? "legacy_derived_source" : source.owner === "evidence" ? "legacy_evidence_source" : "legacy_source",
        sha256: summary.sha256,
        source_hash: summary.sha256,
        // Do not let the registry create an unredacted preview from a legacy
        // JSON/JSONL body. The source remains expandable by an independently
        // authorized artifact path, while semantic memory keeps only metadata.
        preview: "",
        ...(summary.bytes <= MAX_PARSE_BYTES ? { location: { relative_path: source.path } } : {}),
        metadata: { legacy_source_key: source.key, legacy_source_path: source.path, legacy_schema_version: summary.schema_version || "", migration_version: MIGRATION_SERVICE_VERSION },
        sensitivity: source.sensitivity || "confidential",
        captured_by: actor.id,
      };
      try {
        const registered = artifactRegistry.register(plan.root, plan.projectId, input);
        if (!registered?.ok) {
          warnings.push({ code: registered.code || "MEMORY_MIGRATION_ARTIFACT_FAILED", message: "A legacy source could not be registered as a bounded artifact reference.", path: source.path });
          continue;
        }
        byPath.set(source.path, registered.artifactId);
        artifacts.push({ path: source.path, artifact_id: registered.artifactId, changed: Boolean(registered.changed), duplicate: Boolean(registered.duplicate) });
      } catch (error) {
        warnings.push({ code: error.code || "MEMORY_MIGRATION_ARTIFACT_FAILED", message: "A legacy source could not be registered as a bounded artifact reference.", path: source.path });
      }
    }
    return { ok: true, artifacts, warnings, byPath };
  }

  function artifactFor(plan, artifactMap, sourcePath) {
    const relative = String(sourcePath || "").replace(/\\/g, "/");
    if (artifactMap.has(relative)) return artifactMap.get(relative);
    const source = sourceByPath(plan, relative);
    return source ? artifactMap.get(source.path) || "" : "";
  }

  function safeInvestigationText(record, fallback) {
    if (hasSecretMaterial(record)) return "Legacy record contained secret-like fields; details omitted.";
    return boundedLegacySummary(record, fallback);
  }

  function investigationCommand(operationId, projectId, source, expectedRevision, mutationType, payload, extraRefs = []) {
    return {
      schema_version: 1,
      operation_id: operationId,
      idempotency_key: operationId,
      project_id: projectId,
      memory_type: "investigation",
      expected_base_revision: expectedRevision,
      actor: clone(actor),
      session_id: null,
      block_id: null,
      mutation_type: mutationType,
      target_record_id: null,
      payload: cloneValue(payload),
      provenance: {
        source_type: "import",
        source_refs: [...new Set([internalSourceRef(source?.summary || source), ...extraRefs.map((value) => text(value, 500)).filter(Boolean)])].slice(0, 100),
        captured_at: stamp(),
        source_hash: source?.summary?.sha256 || source?.sha256 || "",
      },
      sensitivity: "internal",
    };
  }

  function investigationSpecSource(plan, spec) {
    return spec?.source || plan.entries.find((entry) => entry.key === "project_memory") || plan.entries[0] || { key: "legacy", path: "legacy", summary: {} };
  }

  function buildInvestigationCommands(plan, { expectedRevision = 0, projectRevision = 0, artifactMap = new Map() } = {}) {
    const specs = Array.isArray(plan.investigationSpecs) ? plan.investigationSpecs.slice(0, MAX_MIGRATION_COMMANDS) : [];
    if (!plan.projectId || !specs.length) return { commands: [], ids: {}, counts: {} };
    const release = createLegacyKnowledgeRelease({ crypto, now });
    const programmeId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|programme`);
    const investigationId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|investigation`);
    const procedureId = "procedure_legacy_history_import";
    const commands = [];
    const source = investigationSpecSource(plan, specs[0]);
    commands.push(investigationCommand(plan.operationId, plan.projectId, source, expectedRevision, "upsert_programme", {
      record_id: programmeId,
      programme_id: programmeId,
      objective: "Review imported legacy assessment history",
      description: "Imported legacy records are retained as scoped Investigation history and require current verification before any Evidence promotion.",
      state: "completed",
      status: "completed",
      project_revision: projectRevision,
      knowledge_release_id: release.release_id,
      knowledge_content_hash: release.content_hash,
      investigation_ids: [investigationId],
    }, ["legacy:programme"]));
    commands.push(investigationCommand(plan.operationId, plan.projectId, source, expectedRevision, "upsert_investigation", {
      record_id: investigationId,
      investigation_id: investigationId,
      programme_id: programmeId,
      objective: "Classify imported legacy assessment history",
      state: "completed",
      status: "completed",
      custom: false,
      verification_rule: { type: "current_v2_review", requires_current_scope_and_proof: true },
      safety_constraints: ["Do not promote historical candidates without the current verification gate."],
      project_revision: projectRevision,
      knowledge_release_id: release.release_id,
      knowledge_content_hash: release.content_hash,
      procedure_id: procedureId,
      procedure_ids: [procedureId],
      target_bindings: [],
      priority: 0,
    }, ["legacy:investigation"]));

    const ids = { programme: [programmeId], investigation: [investigationId], test_cases: [], attempts: [], candidates: [], blockers: [], coverage: [] };
    const commandCounts = { investigation: 2, attempts: 0, negative_results: 0, candidates: 0, blockers: 0, coverage: 0, test_cases: 0 };
    const seen = new Set();
    for (const [index, spec] of specs.entries()) {
      const currentSource = investigationSpecSource(plan, spec);
      const record = spec.record;
      const legacyId = legacyIdOf(record, `${currentSource.key}-${spec.index ?? index}`);
      const identity = `${currentSource.path}|${spec.index ?? index}|${spec.kind}|${legacyId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const sourceIndex = Number(spec.index ?? index) || 0;
      const testCaseId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|test-case|${identity}`);
      const sourceArtifact = artifactFor(plan, artifactMap, currentSource.path);
      const artifactRefs = sourceArtifact ? [sourceArtifact] : [];
      const summary = safeInvestigationText(record, `Imported ${spec.recordType || "legacy"} record`);
      const testCase = {
        record_id: testCaseId,
        test_case_id: testCaseId,
        investigation_id: investigationId,
        procedure_id: procedureId,
        objective: summary,
        verification_rule: { type: "legacy_source_review", source_path: currentSource.path },
        safety_constraints: ["Use current scope and authority checks before retesting."],
        target_bindings: [],
        coverage_dimensions: { legacy_source: currentSource.key, legacy_record_type: spec.recordType || "legacy_record" },
        state: "completed",
        status: "completed",
      };
      commands.push(investigationCommand(plan.operationId, plan.projectId, currentSource, expectedRevision, "upsert_test_case", testCase, [`legacy:${currentSource.path}:${sourceIndex}`]));
      ids.test_cases.push(testCaseId);
      commandCounts.test_cases += 1;
      const attemptId = id(crypto, "attempt", `${plan.projectId}|${plan.operationId}|attempt|${identity}`);
      const negative = spec.kind === "negative" || spec.recordType === "negative_result" || spec.recordType === "failure";
      const candidate = spec.kind === "candidate";
      const rawStatus = statusOfLegacy(record);
      const outcome = negative
        ? rawStatus.includes("block") ? "blocked" : rawStatus.includes("error") || rawStatus.includes("fail") ? "error" : rawStatus.includes("inconclusive") ? "inconclusive" : "not_reproduced"
        : candidate ? "supported" : "inconclusive";
      const attemptPayload = {
        record_id: attemptId,
        attempt_id: attemptId,
        investigation_id: investigationId,
        test_case_id: testCaseId,
        payload_class: `legacy:${text(spec.recordType || "record", 200)}`,
        tool_refs: [],
        artifact_refs: artifactRefs,
        expected_behavior: negative ? "The legacy result remains scoped and non-global." : "The legacy record is available for current review.",
        observed_behavior: summary,
        outcome,
        coverage_dimensions: { legacy_source: currentSource.key, legacy_record_id: legacyId },
        stop_condition: "Historical import does not perform a live verification.",
        invocation_id: legacyId,
        variant_key: `${currentSource.key}:${sourceIndex}`,
      };
      commands.push(investigationCommand(plan.operationId, plan.projectId, currentSource, expectedRevision, negative ? "record_negative_result" : "record_attempt", negative ? { ...attemptPayload, limitation: "Imported history is not a global security claim." } : attemptPayload, [`legacy:${currentSource.path}:${sourceIndex}`]));
      ids.attempts.push(attemptId);
      commandCounts.attempts += 1;
      if (negative) commandCounts.negative_results += 1;
      if (candidate) {
        const candidateId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|candidate|${identity}`);
        const candidatePayload = {
          record_id: candidateId,
          candidate_id: candidateId,
          investigation_id: investigationId,
          attempt_ids: [attemptId],
          artifact_refs: artifactRefs,
          vulnerability_class: text(record?.vulnerability_class || record?.vulnerabilityClass || record?.title || record?.summary || "legacy finding candidate", 500),
          severity: text(record?.severity || "", 40).toLowerCase(),
          summary,
          verification_status: "unverified",
        };
        commands.push(investigationCommand(plan.operationId, plan.projectId, currentSource, expectedRevision, "record_candidate", candidatePayload, [`legacy:${currentSource.path}:${sourceIndex}`]));
        ids.candidates.push(candidateId);
        commandCounts.candidates += 1;
      }
      if (spec.kind === "blocker" || rawStatus.includes("blocked")) {
        const blockerId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|blocker|${identity}`);
        commands.push(investigationCommand(plan.operationId, plan.projectId, currentSource, expectedRevision, "upsert_blocker", { record_id: blockerId, blocker_id: blockerId, investigation_id: investigationId, kind: "legacy_import", description: summary, blocker_status: "open" }, [`legacy:${currentSource.path}:${sourceIndex}`]));
        ids.blockers.push(blockerId);
        commandCounts.blockers += 1;
      }
      if (spec.kind === "coverage" || spec.recordType === "coverage") {
        const coverageId = id(crypto, "inv", `${plan.projectId}|${plan.operationId}|coverage|${identity}`);
        commands.push(investigationCommand(plan.operationId, plan.projectId, currentSource, expectedRevision, "upsert_coverage", { record_id: coverageId, coverage_id: coverageId, investigation_id: investigationId, test_case_id: testCaseId, dimensions: { legacy_source: currentSource.key, legacy_record_type: "coverage", legacy_record_id: legacyId }, status: "covered", attempt_ids: [attemptId] }, [`legacy:${currentSource.path}:${sourceIndex}`]));
        ids.coverage.push(coverageId);
        commandCounts.coverage += 1;
      }
    }
    return { commands: commands.slice(0, MAX_MIGRATION_COMMANDS), ids, counts: commandCounts, release };
  }

  function remapProjectCommands(commands, state) {
    const byCanonical = new Map();
    const byStagedId = new Map();
    for (const entity of state?.entities || []) if (entity.canonical_key_hash) byCanonical.set(entity.canonical_key_hash, entity.record_id);
    for (const command of Array.isArray(commands) ? commands : []) {
      const entity = command.payload?.entity;
      if (!entity?.record_id || !entity.canonical_key_hash) continue;
      const existing = byCanonical.get(entity.canonical_key_hash);
      if (existing) byStagedId.set(entity.record_id, existing);
    }
    return (Array.isArray(commands) ? commands : []).map((command) => {
      const next = cloneValue(command);
      const payload = next.payload && typeof next.payload === "object" ? next.payload : {};
      if (payload.entity && typeof payload.entity === "object") {
        const mapped = byStagedId.get(payload.entity.record_id);
        if (mapped) payload.entity.record_id = mapped;
      }
      if (payload.claim && typeof payload.claim === "object") {
        payload.claim.subject_id = byStagedId.get(payload.claim.subject_id) || payload.claim.subject_id;
        if (payload.claim.object?.entity_id) payload.claim.object.entity_id = byStagedId.get(payload.claim.object.entity_id) || payload.claim.object.entity_id;
      }
      if (payload.relationship && typeof payload.relationship === "object") {
        payload.relationship.source_id = byStagedId.get(payload.relationship.source_id) || payload.relationship.source_id;
        payload.relationship.target_id = byStagedId.get(payload.relationship.target_id) || payload.relationship.target_id;
      }
      if (next.mutation_type === "register_alias") payload.canonical_id = byStagedId.get(payload.canonical_id) || payload.canonical_id;
      next.payload = payload;
      return next;
    });
  }

  async function maybe(value) { return value && typeof value.then === "function" ? await value : value; }

  async function installLegacyKnowledgeRelease() {
    const release = createLegacyKnowledgeRelease({ crypto, now });
    if (!knowledgeReleaseStore?.install) return { ok: true, release, installed: false, warning: "Knowledge release storage is unavailable; the release identity remains in migration metadata." };
    const installed = await maybe(knowledgeReleaseStore.install(release));
    if (!installed?.ok) return installed;
    return { ok: true, release: installed.release || release, installed: Boolean(installed.changed), duplicate: Boolean(installed.duplicate) };
  }

  async function importLegacySession(plan, options = {}) {
    const source = plan.externalChat;
    if (!source?.summary?.exists || !source.document) return { ok: true, imported: false, changed: false, reason: "legacy_chat_session_missing", warnings: [] };
    if (Number(source.summary.secret_markers) > 0) return { ok: true, imported: false, changed: false, reason: "legacy_chat_session_secret_bearing", warnings: [{ code: "MEMORY_MIGRATION_CHAT_SECRET_SKIPPED", message: "The legacy chat source contains secret-like fields and was not copied into canonical session memory." }] };
    if (source.document.encrypted === true) return { ok: true, imported: false, changed: false, reason: "legacy_chat_session_encrypted", warnings: [{ code: "MEMORY_MIGRATION_CHAT_ENCRYPTED", message: "The legacy chat file is encrypted and was not copied or decrypted by migration." }] };
    const targetStore = typeof sessionMemoryStore === "function" ? sessionMemoryStore() : sessionMemoryStore;
    if (!targetStore?.importLegacy) return { ok: true, imported: false, changed: false, reason: "session_import_unavailable", warnings: [{ code: "MEMORY_MIGRATION_SESSION_UNAVAILABLE", message: "The canonical session store does not expose the additive legacy import operation." }] };
    const imported = await maybe(targetStore.importLegacy(plan.root, source.document, { sourceHash: source.summary.sha256, operationId: plan.operationId }));
    return imported?.ok === false ? imported : { ok: true, ...imported, warnings: imported?.warnings || [] };
  }

  function importedIdsFrom(result, plan, artifactResult, investigation) {
    const imported = {
      project: [...new Set(result?.project?.recordIds || [])],
      investigation: [...new Set([...(result?.investigation?.recordIds || []), ...(investigation?.ids ? Object.values(investigation.ids).flat() : [])])],
      artifact: [...new Set((artifactResult?.artifacts || []).map((entry) => entry.artifact_id).filter(Boolean))],
      knowledge: investigation?.release?.release_id ? [investigation.release.release_id] : [],
      session: [...new Set(result?.session?.sessionIds || [])],
    };
    return Object.fromEntries(Object.entries(imported).filter(([, ids]) => ids.length));
  }

  async function importMemory(input = {}) {
    if (featureFlags.migrationDualWrite !== true && input.allowWhenDisabled !== true) return operationFailure("MEMORY_MIGRATION_DISABLED", "Migration writes are disabled by the migrationDualWrite feature flag.");
    const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
    if (!scope?.ok) return scope;
    if (!scope.projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "An initialized project ID is required before legacy memory can be imported.");
    return enqueue(scope.workspace, scope.projectId, async () => {
      const plan = createPlan(scope.workspace, scope.projectId, input);
      if (!plan.ok) return plan;
      const existing = await maybe(store.get(scope.workspace, scope.projectId, plan.operationId));
      if (existing?.ok && ["completed", "partial", "failed", "rolled_back"].includes(existing.batch?.state)) {
        return { ok: true, imported: false, duplicate: true, changed: false, operationId: plan.operationId, preview: plan.preview, batch: existing.batch, warnings: existing.batch.warnings || [] };
      }
      const hasLegacy = plan.entries.some((entry) => entry.summary?.exists && entry.key !== "legacy_chat_session") || Boolean(plan.externalChat?.summary?.exists);
      if (!hasLegacy) return { ok: true, imported: false, changed: false, reason: "legacy_sources_missing", operationId: plan.operationId, preview: plan.preview, warnings: plan.warnings };
      const initial = await maybe(store.saveBatch(scope.workspace, scope.projectId, {
        project_id: scope.projectId,
        operation_id: plan.operationId,
        preview_hash: plan.preview.preview_hash,
        source_hashes: plan.sourceHashes,
        source_paths: plan.entries.filter((entry) => entry.summary?.exists).map((entry) => entry.path),
        state: "importing",
        counts: plan.counts,
        warnings: plan.warnings,
      }));
      if (!initial?.ok) return initial;
      const importedResult = { ok: true, operationId: plan.operationId, imported: true, changed: false, preview: plan.preview, warnings: [...plan.warnings], project: null, investigation: null, evidence: { ok: true, promoted: 0, candidatesRemainInInvestigation: true }, artifacts: null, session: null };
      const importedIds = {};
      try {
        const releaseResult = plan.investigationSpecs.length ? await installLegacyKnowledgeRelease() : { ok: true, release: null, installed: false };
        if (!releaseResult.ok) throw Object.assign(new Error(releaseResult.error || "The legacy Knowledge release could not be installed."), { code: releaseResult.code || "MEMORY_KB_RELEASE_INSTALL_FAILED", details: releaseResult.details || {} });
        const artifactResult = registerSourceArtifacts(plan, { registerArtifacts: input.registerArtifacts !== false });
        importedResult.artifacts = artifactResult;
        importedResult.warnings.push(...artifactResult.warnings);
        if (artifactResult.artifacts.length) importedIds.artifact = artifactResult.artifacts.map((entry) => entry.artifact_id);

        let projectResult = { ok: true, changed: false, recordIds: [], previousRevision: 0, revision: 0, warnings: [] };
        if (plan.projectCommands.length) {
          if (!projectRepository?.load || !projectRepository?.apply) throw Object.assign(new Error("Project Memory v2 repository is unavailable."), { code: "MEMORY_PROJECT_REPOSITORY_UNAVAILABLE" });
          const loadedProject = await maybe(projectRepository.load(scope.workspace, scope.projectId));
          if (!loadedProject?.ok) throw Object.assign(new Error(loadedProject.error || "Project Memory could not be loaded."), { code: loadedProject.code || "MEMORY_PROJECT_LOAD_FAILED", details: loadedProject.details || {}, retryable: loadedProject.retryable });
          const commands = remapProjectCommands(plan.projectCommands, loadedProject.state).map((command) => ({ ...command, operation_id: plan.operationId, idempotency_key: plan.operationId, project_id: scope.projectId, expected_base_revision: loadedProject.revision }));
          projectResult = await maybe(projectRepository.apply(scope.workspace, scope.projectId, commands));
          if (!projectResult?.ok) throw Object.assign(new Error(projectResult.error || "Project Memory import failed."), { code: projectResult.code || "MEMORY_PROJECT_IMPORT_FAILED", details: projectResult.details || {}, retryable: projectResult.retryable });
          importedIds.project = projectResult.recordIds || [];
        }
        importedResult.project = projectResult;
        const projectRevision = Number(projectResult.revision || 0);
        if (plan.investigationSpecs.length) {
          if (!investigationRepository?.load || !investigationRepository?.apply) throw Object.assign(new Error("Investigation Memory v2 repository is unavailable."), { code: "MEMORY_INVESTIGATION_REPOSITORY_UNAVAILABLE" });
          const loadedInvestigation = await maybe(investigationRepository.load(scope.workspace, scope.projectId));
          if (!loadedInvestigation?.ok) throw Object.assign(new Error(loadedInvestigation.error || "Investigation Memory could not be loaded."), { code: loadedInvestigation.code || "MEMORY_INVESTIGATION_LOAD_FAILED", details: loadedInvestigation.details || {}, retryable: loadedInvestigation.retryable });
          const investigationPlan = buildInvestigationCommands(plan, { expectedRevision: loadedInvestigation.revision, projectRevision, artifactMap: artifactResult.byPath });
          const commands = investigationPlan.commands.map((command) => ({ ...command, expected_base_revision: loadedInvestigation.revision }));
          const investigationResult = await maybe(investigationRepository.apply(scope.workspace, scope.projectId, commands));
          if (!investigationResult?.ok) throw Object.assign(new Error(investigationResult.error || "Investigation Memory import failed."), { code: investigationResult.code || "MEMORY_INVESTIGATION_IMPORT_FAILED", details: investigationResult.details || {}, retryable: investigationResult.retryable });
          importedResult.investigation = { ...investigationResult, knowledge_release_id: investigationPlan.release.release_id, knowledge_content_hash: investigationPlan.release.content_hash, counts: investigationPlan.counts };
          importedIds.investigation = investigationResult.recordIds || [];
          importedIds.knowledge = [investigationPlan.release.release_id];
        } else importedResult.investigation = { ok: true, changed: false, recordIds: [] };
        const sessionResult = await importLegacySession(plan, input);
        if (sessionResult?.ok === false) throw Object.assign(new Error(sessionResult.error || "Legacy session import failed."), { code: sessionResult.code || "MEMORY_SESSION_IMPORT_FAILED", details: sessionResult.details || {}, retryable: sessionResult.retryable });
        importedResult.session = sessionResult;
        if (Array.isArray(sessionResult?.sessionIds)) importedIds.session = sessionResult.sessionIds;
        importedResult.changed = Boolean(projectResult.changed || importedResult.investigation?.changed || artifactResult.artifacts.some((entry) => entry.changed) || sessionResult?.changed);
        const batch = await maybe(store.updateBatch(scope.workspace, scope.projectId, plan.operationId, {
          state: "completed",
          imported_record_ids: importedIds,
          counts: { ...plan.counts, ...(importedResult.investigation?.counts || {}), imported: 1 },
          warnings: importedResult.warnings,
          completed_at: stamp(),
        }));
        if (!batch?.ok) return { ...operationFailure(batch.code || "MEMORY_MIGRATION_BATCH_UPDATE_FAILED", batch.error || "Migration batch completion could not be recorded.", batch.details || {}, batch.retryable), canonical: importedResult };
        importedResult.batch = batch.batch;
        importedResult.imported_record_ids = importedIds;
        return importedResult;
      } catch (error) {
        const failedIds = importedIds;
        const failedBatch = await maybe(store.updateBatch(scope.workspace, scope.projectId, plan.operationId, { state: "partial", imported_record_ids: failedIds, warnings: [...importedResult.warnings, { code: error.code || "MEMORY_MIGRATION_FAILED", message: "The migration stopped after a recoverable partial write." }], updated_at: stamp() })).catch(() => null);
        return { ok: false, code: error.code || "MEMORY_MIGRATION_FAILED", error: error.message || "Legacy memory migration failed.", retryable: Boolean(error.retryable), details: { projectId: scope.projectId, operationId: plan.operationId, importedRecordIds: failedIds, batch: failedBatch?.batch || null }, preview: plan.preview, warnings: importedResult.warnings };
      }
    });
  }

  function recordIdOf(record) { return String(record?.record_id || record?.recordId || record?.id || record?.canonical_id || "").trim(); }
  function recordKeyOf(record) {
    return String(record?.canonical_key_hash || record?.canonicalKeyHash || record?.canonical_key || record?.canonicalKey || record?.legacy_id || record?.legacyId || recordIdOf(record) || "").trim();
  }
  function recordsFromState(domain, state) {
    if (!state || typeof state !== "object") return [];
    if (domain === "project") return [...(state.entities || []), ...(state.claims || []), ...(state.relationships || [])];
    if (domain === "investigation") return ["programmes", "investigations", "applicability", "test_cases", "assignments", "attempts", "negative_results", "candidates", "blockers", "coverage", "remaining_work"].flatMap((key) => Array.isArray(state[key]) ? state[key] : []);
    if (domain === "evidence") return [...(state.findings || []), ...(state.verifications || []), ...(state.remediations || []), ...(state.retests || [])];
    return [];
  }
  async function canonicalRecords(input, scope, domain) {
    if (Array.isArray(input.canonicalRecords)) return input.canonicalRecords.map(cloneValue);
    if (Array.isArray(input.canonical?.records)) return input.canonical.records.map(cloneValue);
    if (Array.isArray(input.canonical?.items)) return input.canonical.items.map(cloneValue);
    const repository = domain === "project" ? projectRepository : domain === "investigation" ? investigationRepository : evidenceRepository;
    if (!repository?.load) return [];
    const loaded = await maybe(repository.load(scope.workspace, scope.projectId));
    return loaded?.ok ? recordsFromState(domain, loaded.state) : [];
  }
  function legacyRecordsFromPlan(plan, domain) {
    if (domain === "project") {
      const adapterRecords = [];
      for (const command of plan.adapter?.commands || []) {
        const record = command.payload?.entity || command.payload?.claim || command.payload?.relationship;
        if (record) adapterRecords.push({ ...cloneValue(record), authority: "legacy_compatibility", source: "project-memory-v1" });
      }
      return adapterRecords;
    }
    return plan.preview.mappings.filter((mapping) => domain === "investigation"
      ? ["investigation", "queued", "candidate", "legacy_unclassified"].includes(mapping.owner) || mapping.disposition === "queued"
      : domain === "evidence" && mapping.owner === "evidence").map((mapping) => ({
      record_id: mapping.legacy_id,
      record_type: mapping.record_type,
      summary: mapping.reason,
      legacy_id: mapping.legacy_id,
      source_key: mapping.source_key,
      source_path: mapping.path,
    }));
  }
  function isExcluded(excluded, domain, record) {
    const idValue = recordIdOf(record);
    return Boolean(idValue && (excluded?.[domain] || []).includes(idValue));
  }

  async function dualRead(input = {}) {
    const domain = text(input.domain || input.memoryType || "project", 40).toLowerCase();
    if (!["project", "investigation", "evidence"].includes(domain)) return operationFailure("MEMORY_MIGRATION_DOMAIN_INVALID", "Dual-read supports Project, Investigation, and Evidence domains only.");
    const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
    if (!scope?.ok) return scope;
    if (!scope.projectId) return { ok: true, enabled: featureFlags.migrationDualRead === true, project_id: "", domain, records: [], total: 0, authority: "none", warnings: [{ code: "MEMORY_PROJECT_UNINITIALIZED", message: "The workspace has no protected project binding." }] };
    const canonical = await canonicalRecords(input, scope, domain);
      const legacyPlan = (!Array.isArray(input.legacyRecords) && !input.legacy?.records) ? createPlan(scope.workspace, scope.projectId, input) : null;
      if (legacyPlan && !legacyPlan.ok) return legacyPlan;
      const legacy = Array.isArray(input.legacyRecords) ? input.legacyRecords.map(cloneValue) : input.legacy?.records ? input.legacy.records.map(cloneValue) : legacyRecordsFromPlan(legacyPlan, domain);
    const excludedResult = store.excludedRecordIds(scope.workspace, scope.projectId);
    const excluded = excludedResult?.ok ? excludedResult.excluded : {};
    const output = [];
    const seen = new Set();
    for (const record of canonical) {
      if (isExcluded(excluded, domain, record)) continue;
      const copy = cloneValue(record);
      copy.authority = "canonical_v2";
      copy.source = "v2";
      const key = recordKeyOf(copy);
      if (key) seen.add(key);
      output.push(copy);
    }
    if (featureFlags.migrationDualRead === true) {
      for (const record of legacy) {
        const copy = cloneValue(record);
        copy.authority = "legacy_compatibility";
        copy.source = copy.source || "legacy";
        const key = recordKeyOf(copy);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        output.push(copy);
      }
    }
    output.sort((left, right) => `${left.authority}|${recordKeyOf(left)}`.localeCompare(`${right.authority}|${recordKeyOf(right)}`));
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
    return { ok: true, enabled: featureFlags.migrationDualRead === true, project_id: scope.projectId, domain, records: output.slice(0, limit), items: output.slice(0, limit), total: output.length, omitted: Math.max(0, output.length - limit), authority: "canonical_v2_first", sourceRevision: Number(input.sourceRevision || 0) || 0, warnings: excludedResult?.warning ? [{ code: "MEMORY_MIGRATION_STORE_RECOVERED", message: "Migration rollback metadata was recovered from backup." }] : [] };
  }

  async function shadowCompare(input = {}) {
    const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
    if (!scope?.ok) return scope;
    if (!scope.projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "A protected project ID is required for shadow comparison.");
    const plan = createPlan(scope.workspace, scope.projectId, input);
    if (!plan.ok) return plan;
    const domains = ["project", "investigation", "evidence"];
    const comparison = {};
    let unexplainedLosses = 0;
    let verificationUpgrades = 0;
    for (const domain of domains) {
      const legacy = Array.isArray(input[`${domain}Legacy`]) ? input[`${domain}Legacy`] : legacyRecordsFromPlan(plan, domain);
      const canonical = await canonicalRecords({ ...input, canonicalRecords: input[`${domain}Canonical`], canonical: input[`${domain}Canonical`] ? { records: input[`${domain}Canonical`] } : input.canonical }, scope, domain);
      const canonicalKeys = new Set(canonical.map(recordKeyOf).filter(Boolean));
      const missing = legacy.map(recordKeyOf).filter((key) => key && !canonicalKeys.has(key)).slice(0, 500);
      const upgrades = domain === "evidence" ? canonical.filter((record) => ["verified", "confirmed", "accepted"].includes(String(record?.state || record?.status || "").toLowerCase()) && record?.authority !== "verified_by_v2").map(recordIdOf).filter(Boolean) : [];
      unexplainedLosses += missing.length;
      verificationUpgrades += upgrades.length;
      comparison[domain] = { legacy_count: legacy.length, canonical_count: canonical.length, missing_count: missing.length, missing_keys: missing, verification_upgrades: upgrades, warnings: [] };
    }
    const expectedProject = plan.projectCommands.filter((command) => ["upsert_entity", "upsert_claim", "upsert_relationship"].includes(command.mutation_type)).length;
    if (expectedProject && comparison.project.canonical_count === 0) comparison.project.warnings.push({ code: "MEMORY_MIGRATION_CANONICAL_NOT_INITIALIZED", message: "Canonical Project Memory has not yet received the shadowed legacy facts." });
    const parity = unexplainedLosses === 0 && verificationUpgrades === 0;
    return { ok: true, project_id: scope.projectId, operation_id: plan.operationId, preview_hash: plan.preview.preview_hash, parity, blocked: !parity, comparison, unexplained_losses: unexplainedLosses, verification_upgrades: verificationUpgrades, expected_differences: plan.preview.mappings.filter((mapping) => ["candidate", "queued", "legacy_unclassified", "skipped"].includes(mapping.disposition)).length, warnings: plan.warnings };
  }

  async function runCompatibilityWriter(input, canonical) {
    const writer = input.compatibilityWriter || compatibilityWriter;
    if (typeof writer === "function") return writer({ ...input, canonical: cloneValue(canonical), projectCommands: cloneValue(input.projectCommands || []), investigationCommands: cloneValue(input.investigationCommands || []) });
    if (writer?.write) return writer.write({ ...input, canonical: cloneValue(canonical), projectCommands: cloneValue(input.projectCommands || []), investigationCommands: cloneValue(input.investigationCommands || []) });
    return { ok: true, skipped: true, reason: "compatibility_writer_unconfigured" };
  }

  async function dualWrite(input = {}) {
    if (featureFlags.migrationDualWrite !== true && input.allowWhenDisabled !== true) return operationFailure("MEMORY_MIGRATION_DISABLED", "Dual-write is disabled by the migrationDualWrite feature flag.");
    const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
    if (!scope?.ok) return scope;
    if (!scope.projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "A protected project ID is required for dual-write.");
    if (Array.isArray(input.evidenceCommands) && input.evidenceCommands.length) return operationFailure("MEMORY_MIGRATION_EVIDENCE_WRITE_FORBIDDEN", "Dual-write cannot bypass the Evidence verification and promotion gate.");
    const operationId = String(input.operationId || input.operation_id || id(crypto, "op", canonicalJson({ projectId: scope.projectId, projectCommands: input.projectCommands || [], investigationCommands: input.investigationCommands || [] }))).trim();
    const activeOutboxStore = input.outboxStore || outboxStore;
    const applyDomain = async (repository, commands, domain) => {
      if (!Array.isArray(commands) || !commands.length) return { ok: true, changed: false, recordIds: [], domain };
      if (!repository?.load || !repository?.apply) return operationFailure(`MEMORY_${domain.toUpperCase()}_REPOSITORY_UNAVAILABLE`, `${domain} Memory v2 repository is unavailable.`);
      const loaded = await maybe(repository.load(scope.workspace, scope.projectId));
      if (!loaded?.ok) return loaded;
      const prepared = commands.map((command) => ({ ...cloneValue(command), operation_id: operationId, idempotency_key: operationId, project_id: scope.projectId, memory_type: domain, expected_base_revision: loaded.revision }));
      return repository.apply(scope.workspace, scope.projectId, prepared);
    };
    const project = await applyDomain(projectRepository, input.projectCommands, "project");
    if (!project?.ok) return { ...project, operationId, canonical: { project } };
    const investigation = await applyDomain(investigationRepository, input.investigationCommands, "investigation");
    if (!investigation?.ok) return { ...investigation, operationId, canonical: { project, investigation } };
    const canonical = { project, investigation, evidence: { ok: true, promoted: 0 } };
    let compatibility = { ok: true, skipped: true, reason: "compatibility_writer_unconfigured" };
    let outbox = null;
    if (input.enqueueCompatibility !== false && activeOutboxStore?.enqueue) {
      outbox = await maybe(activeOutboxStore.enqueue(scope.workspace, scope.projectId, { operation_id: operationId, source_memory: "project", source_revision: project.revision || 0, destination_memory: "project", destination_mutation: { kind: "legacy_compatibility_projection", operation_id: operationId, project_record_ids: project.recordIds || [], investigation_record_ids: investigation.recordIds || [] } }));
    }
    try {
      compatibility = await runCompatibilityWriter(input, canonical);
      if (!compatibility || compatibility.ok === false) compatibility = { ok: false, code: compatibility?.code || "MEMORY_COMPATIBILITY_WRITE_FAILED", error: compatibility?.error || "The compatibility projection failed.", retryable: Boolean(compatibility?.retryable) };
    } catch (error) {
      compatibility = { ok: false, code: error.code || "MEMORY_COMPATIBILITY_WRITE_FAILED", error: error.message || "The compatibility projection failed.", retryable: Boolean(error.retryable) };
    }
    if (outbox?.ok && activeOutboxStore?.transition) {
      const entryId = outbox.entry?.entry_id;
      if (entryId) await maybe(activeOutboxStore.transition(scope.workspace, scope.projectId, entryId, compatibility.ok === false ? "failed" : "completed", compatibility.ok === false ? { error: { code: compatibility.code, message: "Compatibility projection failed after canonical v2 commit.", retryable: Boolean(compatibility.retryable) } } : { result: { compatibility: "applied" } }));
    }
    const warnings = compatibility.ok === false ? [{ code: compatibility.code, message: "Canonical v2 memory committed, but the legacy compatibility projection needs retry." }] : [];
    return { ok: true, operationId, changed: Boolean(project.changed || investigation.changed), canonical, compatibility, outbox, warnings };
  }

  function status(workspace, projectId) {
    if (!projectId) return { ok: true, project_id: "", initialized: false, state: "idle", batch_count: 0, pending_count: 0, failed_count: 0, rolled_back_count: 0 };
    return store.status(workspace, projectId);
  }

  return Object.freeze({
    MIGRATION_SERVICE_VERSION,
    discover: (workspace, options = {}) => {
      try {
        const collected = collect(workspace, options.projectId || options.project_id || "", options);
        return { ok: true, project_id: options.projectId || options.project_id || "", workspace: collected.root, sources: collected.entries.map((entry) => publicSource(entry.summary)), warnings: collected.warnings };
      }
      catch (error) { return operationFailure(error.code || "MEMORY_MIGRATION_DISCOVERY_FAILED", error.message); }
    },
    preview: async (input = {}) => {
      const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
      if (!scope?.ok) return scope;
      const plan = createPlan(scope.workspace, scope.projectId, input);
      if (!plan.ok) return plan;
      return { ok: true, ...clone(plan.preview), preview: clone(plan.preview), plan: { project_commands: plan.projectCommands.length, investigation_specs: plan.investigationSpecs.length, source_files: plan.entries.length, initialized: plan.preview.initialized }, status: status(scope.workspace, scope.projectId) };
    },
    import: importMemory,
    rollback: async (input = {}) => {
      if (featureFlags.migrationDualWrite !== true && input.allowWhenDisabled !== true) return operationFailure("MEMORY_MIGRATION_DISABLED", "Migration rollback is disabled by the migrationDualWrite feature flag.");
      const scope = projectIdOf(input.workspace, input.projectId || input.project_id, { persist: false });
      if (!scope?.ok) return scope;
      if (!scope.projectId) return operationFailure("MEMORY_PROJECT_UNINITIALIZED", "A protected project ID is required for migration rollback.");
      return store.rollback(scope.workspace, scope.projectId, input.operationId || input.operation_id, { reason: input.reason, rollbackOperationId: input.rollbackOperationId || input.rollback_operation_id });
    },
    status,
    dualRead,
    shadowCompare,
    dualWrite,
    isExcluded: (workspace, projectId, domain, recordId) => {
      const excluded = store.excludedRecordIds(workspace, projectId);
      return excluded?.ok ? (excluded.excluded?.[domain] || []).includes(String(recordId || "")) : false;
    },
  });

  function addAdapterMappings(adapter, plan, mappings, counts) {
    const source = plan.entries.find((entry) => entry.key === "project_memory") || {
      key: "project_memory",
      path: ".xekute/context/project-memory.json",
      summary: { key: "project_memory", path: ".xekute/context/project-memory.json", sha256: adapter?.source?.sha256 || "" },
    };
    for (const item of adapter?.mappings || []) {
      const disposition = item.disposition === "accepted"
        ? "accepted"
        : item.disposition === "alias"
          ? "alias"
          : item.disposition === "deduplicated"
            ? "deduplicated"
            : item.disposition === "referenced"
              ? "artifact_reference"
              : item.disposition === "queued"
                ? "queued"
                : item.disposition === "candidate"
                  ? "candidate"
                  : "legacy_unclassified";
      addMapping(mappings, counts, {
        source,
        index: item.source_index,
        record: { id: item.legacy_id, summary: item.reason },
        owner: item.owner || "project",
        disposition,
        reason: item.reason || "The legacy Project Memory adapter classified the record.",
        recordType: item.target?.record_type || item.source_field || "legacy_project_memory",
        recordId: item.target?.record_id || "",
      });
    }
    for (const item of adapter?.investigation_queue || []) addCount(counts, "legacy_unclassified");
    for (const item of adapter?.evidence_candidates || []) addCount(counts, "candidate");
    for (const item of adapter?.artifact_references || []) addCount(counts, "artifact_reference");
  }

  function mapLegacyRecord(plan, source, index, record, mappings, counts, investigationSpecs) {
    const recordType = recordTypeOf(record, source.key);
    if (hasSecretMaterial(record)) {
      addMapping(mappings, counts, { source, index, record, owner: source.owner, disposition: "skipped", reason: "Secret-bearing legacy content is inventory-only and was not imported." });
      addCount(counts, "secret_rejected");
      return;
    }
    if (source.owner === "sensitive") {
      addMapping(mappings, counts, { source, index, record, owner: "sensitive", disposition: "skipped", reason: "Sensitive legacy identity data is not copied into v2 memory." });
      return;
    }
    if (source.owner === "artifact" || source.owner === "derived") {
      addMapping(mappings, counts, { source, index, record, owner: "artifact", disposition: "artifact_reference", reason: "The legacy body remains at its source location and is referenced by a hash-backed artifact." });
      return;
    }
    if (source.key === "findings" || source.owner === "evidence") {
      if (legacyFindingLooksConfirmed(record)) {
        addMapping(mappings, counts, { source, index, record, owner: "evidence", disposition: "candidate", reason: "The legacy finding appears confirmed but must pass the v2 verification gate before Evidence Memory promotion.", recordType: "finding_candidate" });
        investigationSpecs.push({ source, index, record, kind: "candidate", recordType: "finding_candidate" });
      } else {
        addMapping(mappings, counts, { source, index, record, owner: "investigation", disposition: "queued", reason: "The legacy finding is unverified, informational, ambiguous, or missing required proof.", recordType: "finding_candidate" });
        investigationSpecs.push({ source, index, record, kind: "history", recordType: "finding_candidate" });
      }
      return;
    }
    if (source.owner === "investigation") {
      addMapping(mappings, counts, { source, index, record, owner: "investigation", disposition: "queued", reason: "Legacy execution, coverage, scan, hypothesis, or run history belongs to Investigation Memory." });
      investigationSpecs.push({ source, index, record, kind: recordType.includes("negative") || recordType === "failure" ? "negative" : recordType === "coverage" ? "coverage" : recordType.includes("block") ? "blocker" : "history", recordType });
      return;
    }
    if (source.owner === "session") {
      addMapping(mappings, counts, { source, index, record, owner: "session", disposition: "legacy_unclassified", reason: "Legacy session/run logs remain compatibility history; they are not Project facts." });
      return;
    }
    addMapping(mappings, counts, { source, index, record, owner: source.owner || "unclassified", disposition: "legacy_unclassified", reason: "No safe v2 owner mapping was available." });
    investigationSpecs.push({ source, index, record, kind: "history", recordType });
  }

  function createPlan(workspace, projectId, options = {}) {
    let collected;
    try { collected = collect(workspace, projectId, options); } catch (error) { return operationFailure(error.code || "MEMORY_MIGRATION_DISCOVERY_FAILED", error.message, {}, false); }
    const adapter = adapterPlan(collected);
    if (!adapter.ok) return adapter.result;
    const sourceHashes = collected.entries.filter((entry) => entry.summary?.exists && entry.summary?.sha256).map((entry) => `${entry.key}:${entry.path}:${entry.summary.sha256}`).sort();
    const adapterHash = adapter.preview?.source?.sha256 || "";
    const operationId = id(crypto, "op", canonicalJson({ project_id: projectId || "", source_hashes: sourceHashes, adapter_hash: adapterHash, version: MIGRATION_SERVICE_VERSION }));
    const counts = { source_files: collected.entries.filter((entry) => entry.summary?.exists).length, legacy_records: 0, project_commands: 0, project_entities: 0, project_claims: 0, project_relationships: 0, accepted: 0, deduplicated: 0, aliases: 0, artifact_reference: 0, investigation: 0, investigation_commands: 0, candidate: 0, queued: 0, legacy_unclassified: 0, skipped: 0, unavailable: 0, rejected: 0, secret_rejected: 0, invalid: collected.entries.reduce((sum, entry) => sum + (Number(entry.summary?.invalid_count) || 0), 0), warnings: collected.warnings.length };
    const mappings = [];
    const projectCommands = [];
    const investigationSpecs = [];
    if (adapter.preview) {
      for (const command of adapter.preview.commands || []) {
        const cloned = cloneValue(command);
        if (!cloned?.mutation_type || !cloned.payload) continue;
        cloned.operation_id = operationId;
        cloned.idempotency_key = operationId;
        cloned.project_id = projectId;
        cloned.expected_base_revision = 0;
        projectCommands.push(cloned);
        addCount(counts, "project_commands");
        if (cloned.mutation_type === "upsert_entity") addCount(counts, "project_entities");
        if (cloned.mutation_type === "upsert_claim") addCount(counts, "project_claims");
        if (cloned.mutation_type === "upsert_relationship") addCount(counts, "project_relationships");
      }
      addAdapterMappings(adapter.preview, collected, mappings, counts);
      for (const item of adapter.preview.investigation_queue || []) investigationSpecs.push({ source: collected.entries.find((entry) => entry.key === "project_memory") || collected.entries[0], index: 0, record: item, kind: item.record_type === "negative_result" ? "negative" : "history", recordType: item.record_type || "legacy_unclassified" });
      for (const item of adapter.preview.evidence_candidates || []) investigationSpecs.push({ source: collected.entries.find((entry) => entry.key === "project_memory") || collected.entries[0], index: 0, record: item, kind: "candidate", recordType: "finding_candidate" });
    }
    const mapped = projectId ? mapProjectSources({ ...collected, projectId, entries: collected.entries }, operationId, mappings, counts, projectCommands) : { aliases: new Map(), nodeIds: new Map() };
    for (const source of collected.entries) {
      for (const [index, record] of (source.records || []).entries()) {
        addCount(counts, "legacy_records");
        if (source.key === "project_memory" || source.key.startsWith("assessment_assets") || source.key === "map_legacy" || source.key === "map_graph" || source.key === "scan_results") {
          // These sources were handled by the typed Project mapper above. A
          // scanner service record may additionally be useful as target
          // history, but the assessment asset collection must not be queued as
          // an Investigation record a second time.
          if (source.key === "scan_results") mapLegacyRecord(collected, source, index, record, mappings, counts, investigationSpecs);
          continue;
        }
        mapLegacyRecord(collected, source, index, record, mappings, counts, investigationSpecs);
      }
      if (source.summary?.exists && ["artifact", "derived", "evidence"].includes(source.owner)) addCount(counts, "artifact_reference");
    }
    // One source can be encountered through both the adapter and the broad
    // inventory. Keep mappings bounded and deterministic for UI/IPC clients.
    mappings.sort((left, right) => `${left.source_key}|${left.path}|${left.source_index}|${left.legacy_id}|${left.disposition}`.localeCompare(`${right.source_key}|${right.path}|${right.source_index}|${right.legacy_id}|${right.disposition}`));
    const warnings = [...collected.warnings];
    for (const warning of adapter.warnings || []) pushWarning(warnings, warning);
    for (const source of collected.entries) {
      if (source.summary?.truncated) pushWarning(warnings, { code: "MEMORY_MIGRATION_SOURCE_TRUNCATED", message: "Only bounded source metadata was inspected; full legacy content remains external.", source_key: source.key, path: source.path });
      if (source.summary?.readable === false && source.summary?.exists) pushWarning(warnings, { code: "MEMORY_MIGRATION_SOURCE_UNAVAILABLE", message: "The legacy source exists but could not be read during preview.", source_key: source.key, path: source.path });
    }
    const initialized = fs.existsSync(path.join(collected.root, ".xekute", "memory"));
    const preview = createMigrationPreview({
      project_id: projectId || "",
      operation_id: operationId,
      generated_at: stamp(),
      sources: collected.entries.map((entry) => publicSource(entry.summary)),
      mappings,
      counts,
      warnings,
      initialized,
    });
    return { ok: true, root: collected.root, projectId: projectId || "", operationId, entries: collected.entries, adapter: adapter.preview, projectCommands, investigationSpecs, preview, warnings, counts, sourceHashes, externalChat: collected.entries.find((entry) => entry.key === "legacy_chat_session") || null };
  }
}

module.exports = Object.freeze({ MIGRATION_SERVICE_VERSION, createLegacyMemoryMigration });
