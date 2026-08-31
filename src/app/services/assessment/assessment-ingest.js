"use strict";

/* Schema-preserving assessment ingestion without a Python runtime. */

const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const ScopeEngine = require("../../../domain/scope/scope-engine");
const Artifacts = require("../../../domain/artifacts/investigation-artifacts.js");

const MAX_RECORDS = 250;
const MAX_TEXT = 20_000;
const MAX_PAYLOAD_BYTES = 1_000_000;

const RESOURCE_SPECS = Object.freeze({
  "active-recon": { path: "recon/active-recon.json", collection: "discoveredAssets", template: "discoveredAssetTemplate", keys: ["type", "value"], mapRole: "asset" },
  "passive-recon": { path: "recon/passive-recon.json", collection: "discoveredAssets", template: "discoveredAssetTemplate", keys: ["type", "value"], mapRole: "asset" },
  endpoints: { path: "enumeration/endpoints.json", collection: "endpoints", template: "endpointTemplate", keys: ["method", "url"], mapRole: "route" },
  pages: { path: "enumeration/pages.json", collection: "pages", template: "pageTemplate", keys: ["url"], mapRole: "route" },
  subdomains: { path: "enumeration/subdomains.json", collection: "subdomains", template: "subdomainTemplate", keys: ["hostname"], mapRole: "host" },
  assets: { path: "enumeration/assets.json", collection: "assets", template: "assetTemplate", keys: ["assetType", "value"], mapRole: "asset" },
});

const IngestError = class extends Error {
  constructor(message, code = "INGEST_INVALID") { super(message); this.code = code; }
};

function now() { return new Date().toISOString(); }

function bounded(value, depth = 0) {
  if (depth > 6) return null;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => bounded(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [String(key).slice(0, 100), bounded(item, depth + 1)]));
  return String(value).slice(0, MAX_TEXT);
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function mergeAgainstTemplate(template, incoming) {
  if (template && typeof template === "object" && !Array.isArray(template)) {
    const source = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
    return Object.fromEntries(Object.entries(template).map(([key, defaultValue]) => [key, Object.prototype.hasOwnProperty.call(source, key) ? mergeAgainstTemplate(defaultValue, source[key]) : clone(defaultValue)]));
  }
  if (Array.isArray(template)) return Array.isArray(incoming) ? bounded(incoming) : clone(template);
  if (incoming == null) return clone(template);
  if (typeof template === "boolean") return typeof incoming === "boolean" ? incoming : clone(template);
  if (typeof template === "number") return Number.isFinite(Number(incoming)) ? Number(incoming) : clone(template);
  if (template == null) return bounded(incoming);
  return String(incoming).slice(0, MAX_TEXT);
}

function enrich(resource, record, source, timestamp) {
  if ("source" in record && !record.source) record.source = source;
  if ("discoveredBy" in record && !record.discoveredBy) record.discoveredBy = source;
  for (const field of ["discoveredAt", "firstSeen"]) if (field in record && !record[field]) record[field] = timestamp;
  for (const field of ["lastSeen", "lastCheckedAt"]) if (field in record) record[field] = timestamp;
  if (resource === "endpoints" && record.url) {
    const parsed = safeUrl(record.url);
    record.scheme = record.scheme || parsed?.protocol?.replace(":", "") || "https";
    record.host = record.host || parsed?.hostname || "";
    record.port = record.port || Number(parsed?.port) || (record.scheme === "https" ? 443 : 80);
    record.path = record.path || parsed?.pathname || "/";
    record.method = String(record.method || "GET").toUpperCase();
  }
  if (resource === "pages" && record.url && !record.path) record.path = safeUrl(record.url)?.pathname || "/";
  if (resource === "subdomains") record.hostname = String(record.hostname || "").trim().toLowerCase().replace(/\.+$/, "");
  return record;
}

function safeUrl(value) { try { return new URL(String(value)); } catch { return null; } }

function identity(record, keys) { return keys.map((key) => JSON.stringify(record[key]).toLowerCase()).join("\u0000"); }

function meaningful(record, keys) { return keys.length > 0 && keys.some((key) => ![null, "", [], {}].some((empty) => JSON.stringify(record[key]) === JSON.stringify(empty))); }

function statistics(resource, rows) {
  if (resource === "endpoints" || resource === "pages") return { total: rows.length, authenticated: rows.filter((row) => ![null, "", "unknown", "none", "unauthenticated"].includes(row.authentication)).length, unauthenticated: rows.filter((row) => ["none", "unauthenticated"].includes(row.authentication)).length, tested: rows.filter((row) => row.tested === true).length, untested: rows.filter((row) => row.tested !== true).length };
  if (resource === "subdomains") return { total: rows.length, live: rows.filter((row) => row.live === true).length, inScope: rows.filter((row) => row.inScope === true).length, takeoverCandidates: rows.filter((row) => ![null, "", "not-checked", "not-vulnerable"].includes(row.takeoverStatus)).length, tested: rows.filter((row) => row.tested === true).length };
  if (resource === "assets") return { total: rows.length, inScope: rows.filter((row) => row.inScope === true).length, outOfScope: rows.filter((row) => row.inScope === false).length, unknownScope: rows.filter((row) => row.inScope == null).length, live: rows.filter((row) => row.live === true || row.status === "live").length, stale: rows.filter((row) => row.status === "stale").length, untested: rows.filter((row) => row.tested !== true).length };
  return {};
}

function atomicWrite(target, document) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temp, "utf8"));
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  try { fs.renameSync(temp, target); } catch { fs.copyFileSync(temp, target); fs.rmSync(temp, { force: true }); }
}

function provisionedDocument(spec, provision, resource) {
  const template = provision?.[spec.template] && typeof provision[spec.template] === "object" && !Array.isArray(provision[spec.template])
    ? provision[spec.template]
    : {};
  if (provision && typeof provision === "object" && !Array.isArray(provision)) {
    const document = structuredClone(provision);
    document.schemaVersion = document.schemaVersion || 1;
    document.resource = resource || document.resource;
    document[spec.template] = document[spec.template] || structuredClone(template);
    document[spec.collection] = Array.isArray(document[spec.collection]) ? document[spec.collection] : [];
    document.statistics = document.statistics || {};
    document.updatedAt = now();
    document.source = document.source || "xekute-provisioned";
    return document;
  }
  return {
    schemaVersion: 1,
    resource,
    [spec.template]: structuredClone(template),
    [spec.collection]: [],
    statistics: {},
    updatedAt: now(),
    source: "xekute-provisioned",
  };
}

function readJsonFile(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function templateFieldsForDataset(workspace, spec) {
  const doc = readJsonFile(path.resolve(workspace, spec.path), null);
  const template = doc?.[spec.template];
  if (template && typeof template === "object" && !Array.isArray(template)) return Object.keys(template);
  return [...spec.keys];
}

function loadScopePolicy(_workspace, projectProfile = null) {
  const scope = projectProfile?.scope || {};
  return {
    targets: Array.isArray(scope.inScopeTargets) ? scope.inScopeTargets : [],
    wildcardRules: Array.isArray(scope.wildcardRules) ? scope.wildcardRules : [],
    excludedTargets: Array.isArray(scope.outOfScopeTargets) ? scope.outOfScopeTargets : [],
  };
}

function targetsFromRecord(resource, record) {
  if (resource === "endpoints" || resource === "pages") return [record.url].filter(Boolean);
  if (resource === "subdomains") return [record.hostname].filter(Boolean);
  return [record.value, record.host].filter(Boolean);
}

function validateRecordScope(scopePolicy, resource, record) {
  if (!scopePolicy.targets.length && !scopePolicy.wildcardRules.length) return { ok: true };
  for (const target of targetsFromRecord(resource, record)) {
    const verdict = ScopeEngine.evaluateTarget(target, {
      targets: scopePolicy.targets,
      wildcardRules: scopePolicy.wildcardRules,
      excludedTargets: scopePolicy.excludedTargets,
    });
    if (!verdict.allowed) return { ok: false, target: String(target), reason: verdict.reason || verdict.code || "out_of_scope" };
  }
  return { ok: true };
}

function readCoverageSummary(workspace) {
  let matrix = [];
  try {
    const parsed = Artifacts.parseChecklist(fs.readFileSync(path.join(workspace, ...Artifacts.PATHS.checklist.split("/")), "utf8"));
    if (!parsed.ok) return null;
    matrix = parsed.value;
  } catch { return null; }
  const byStatus = {};
  for (const item of matrix) {
    const status = String(item?.status || "unknown");
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const untested = (byStatus["not-tested"] || 0) + (byStatus["in-progress"] || 0) + (byStatus["blocked"] || 0);
  return {
    summary: byStatus,
    byStatus,
    gapCount: untested,
    totalItems: matrix.length,
  };
}

function computeCoverageDelta(before, after) {
  if (!before || !after) return null;
  const delta = {};
  const statuses = new Set([...Object.keys(before.byStatus || {}), ...Object.keys(after.byStatus || {})]);
  for (const status of statuses) {
    const change = (after.byStatus?.[status] || 0) - (before.byStatus?.[status] || 0);
    if (change !== 0) delta[status] = change;
  }
  return {
    gapDelta: (after.gapCount || 0) - (before.gapCount || 0),
    totalDelta: (after.totalItems || 0) - (before.totalItems || 0),
    byStatusDelta: delta,
  };
}

function datasetExists(workspaceRaw, resource) {
  const workspace = path.resolve(workspaceRaw);
  const spec = RESOURCE_SPECS[resource];
  if (!spec) return { ok: false, error: "Unknown resource", code: "RESOURCE_NOT_ALLOWED" };
  try {
    const target = path.resolve(workspace, spec.path);
    const doc = JSON.parse(fs.readFileSync(target, "utf8"));
    return { ok: true, exists: true, resource, ...statistics(resource, Array.isArray(doc?.[spec.collection]) ? doc[spec.collection] : []) };
  } catch {
    return { ok: false, error: "Canonical dataset does not exist yet", code: "DATASET_NOT_FOUND", resource, exists: false };
  }
}

function listDatasets(workspaceRaw) {
  const workspace = path.resolve(String(workspaceRaw || "").trim() || ".");
  const datasets = Object.entries(RESOURCE_SPECS).map(([resource, spec]) => {
    const probe = datasetExists(workspace, resource);
    const templateFields = templateFieldsForDataset(workspace, spec);
    return {
      resource,
      path: spec.path,
      collection: spec.collection,
      keyFields: spec.keys,
      templateFields,
      schemaHint: `Required identity: ${spec.keys.join(", ")}. Template fields: ${templateFields.join(", ")}`,
      mapRole: spec.mapRole || null,
      writable: true,
      exists: probe.exists === true,
      statistics: probe.exists ? { total: probe.total, ...probe } : null,
    };
  });
  return {
    ok: true,
    manifestVersion: 1,
    datasets,
    provisioned: datasets.filter((d) => d.exists).map((d) => d.resource),
    unprovisioned: datasets.filter((d) => !d.exists).map((d) => d.resource),
    coverage: readCoverageSummary(workspace),
  };
}

function ingest(payload = {}) {
  const workspaceRaw = String(payload.workspace || "").trim();
  const resource = String(payload.resource || "").trim().toLowerCase();
  const records = payload.records;
  const source = String(payload.source || "typed-ingest").trim().slice(0, 160) || "typed-ingest";
  if (!workspaceRaw) throw new IngestError("Assessment workspace is required", "WORKSPACE_REQUIRED");
  if (!RESOURCE_SPECS[resource]) throw new IngestError("This Core resource is not writable through typed ingestion", "RESOURCE_NOT_ALLOWED");
  if (!Array.isArray(records) || !records.length) throw new IngestError("At least one structured record is required", "RECORDS_REQUIRED");
  if (records.length > MAX_RECORDS) throw new IngestError(`At most ${MAX_RECORDS} records may be ingested at once`, "RECORD_LIMIT");
  const workspace = path.resolve(workspaceRaw);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new IngestError("Assessment workspace does not exist", "WORKSPACE_NOT_FOUND");
  const spec = RESOURCE_SPECS[resource];
  const target = path.resolve(workspace, spec.path);
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`)) throw new IngestError("Resolved dataset escaped the assessment workspace", "PATH_ESCAPE");
  const coverageBefore = readCoverageSummary(workspace);
  const scopePolicy = loadScopePolicy(workspace, payload.projectProfile || null);
  const expectProvision = !fs.existsSync(target);
  if (expectProvision) {
    const provisioned = provisionedDocument(spec, payload.provision, resource);
    atomicWrite(target, provisioned);
  }
  const document = JSON.parse(fs.readFileSync(target, "utf8"));
  const template = document[spec.template];
  const existing = document[spec.collection];
  if (!template || typeof template !== "object" || Array.isArray(template)) throw new IngestError("The canonical dataset template is missing or invalid", "SCHEMA_INVALID");
  if (!Array.isArray(existing)) throw new IngestError("The canonical dataset collection is missing or invalid", "SCHEMA_INVALID");
  const timestamp = now();
  const accepted = [];
  let rejected = 0;
  let scopeRejected = 0;
  for (const raw of records) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { rejected += 1; continue; }
    const normalized = enrich(resource, mergeAgainstTemplate(template, raw), source, timestamp);
    if (!meaningful(normalized, spec.keys)) { rejected += 1; continue; }
    const scopeCheck = validateRecordScope(scopePolicy, resource, normalized);
    if (!scopeCheck.ok) { rejected += 1; scopeRejected += 1; continue; }
    accepted.push(normalized);
  }
  const merged = new Map();
  for (const row of [...existing, ...accepted]) if (row && typeof row === "object" && meaningful(row, spec.keys)) merged.set(identity(row, spec.keys), row);
  const rows = [...merged.values()];
  document[spec.collection] = rows;
  if (Object.prototype.hasOwnProperty.call(document, "statistics")) document.statistics = statistics(resource, rows);
  if (resource === "assets") document.lastReconciledAt = timestamp;
  atomicWrite(target, document);
  const coverageAfter = readCoverageSummary(workspace);
  return {
    ok: true,
    resource,
    path: spec.path,
    collection: spec.collection,
    accepted: accepted.length,
    rejected,
    scopeRejected,
    total: rows.length,
    source,
    provisioned: expectProvision,
    coverageDelta: computeCoverageDelta(coverageBefore, coverageAfter),
  };
}

module.exports = {
  RESOURCE_SPECS,
  ingest,
  listDatasets,
  datasetExists,
  readCoverageSummary,
  computeCoverageDelta,
  validateRecordScope,
  loadScopePolicy,
  IngestError,
  MAX_PAYLOAD_BYTES,
};
