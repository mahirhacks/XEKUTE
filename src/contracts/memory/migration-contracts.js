"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId, canonicalJson, canonicalKeyHash } = require("./memory-identity.js");

const MIGRATION_CONTRACT_VERSION = 1;
const MIGRATION_STATES = Object.freeze(["preview", "importing", "completed", "partial", "failed", "rolled_back"]);
const MIGRATION_DISPOSITIONS = Object.freeze([
  "accepted",
  "deduplicated",
  "alias",
  "artifact_reference",
  "candidate",
  "queued",
  "legacy_unclassified",
  "skipped",
  "unavailable",
  "rejected",
]);
const MAX_SOURCES = 200;
const MAX_MAPPINGS = 2_000;
const MAX_WARNINGS = 500;
const MAX_IDS = 5_000;
const MAX_TEXT = 4_000;

/*
 * This is deliberately a closed inventory.  Migration must not recursively
 * inspect arbitrary project files because a project may contain credentials,
 * unrelated source code, or very large generated data.  New legacy formats
 * must be added explicitly and receive a classification rule and tests.
 */
const LEGACY_SOURCE_DEFINITIONS = Object.freeze([
  { key: "project_memory", paths: [".xekute/context/project-memory.json"], format: "json", owner: "project", sensitivity: "confidential" },
  { key: "traffic_raw", paths: ["traffic/raw.jsonl"], format: "jsonl", owner: "artifact", sensitivity: "restricted" },
  { key: "traffic_filtered", paths: ["traffic/filtered.jsonl"], format: "jsonl", owner: "artifact", sensitivity: "restricted" },
  { key: "map_legacy", paths: ["Map/application-map.json"], format: "json", owner: "derived", sensitivity: "confidential" },
  { key: "evidence_index", paths: ["evidence/index.jsonl"], format: "jsonl", owner: "artifact", sensitivity: "confidential" },
  { key: "runtime_evidence", paths: [".xekute/evidence/runtime.jsonl"], format: "jsonl", owner: "artifact", sensitivity: "confidential" },
  { key: "findings", paths: ["findings/findings.json"], format: "json", owner: "evidence", sensitivity: "confidential" },
  { key: "runs", paths: ["runs/runs.json"], format: "json", owner: "investigation", sensitivity: "internal" },
  { key: "coverage", paths: ["penetration-testing/coverage.json"], format: "json", owner: "investigation", sensitivity: "internal" },
  { key: "agent_runs", paths: [".xekute/logs/agent-runs.jsonl"], format: "jsonl", owner: "session", sensitivity: "internal" },
  { key: "agent_actions", paths: [".xekute/logs/agent-actions.jsonl"], format: "jsonl", owner: "session", sensitivity: "confidential" },
  { key: "agent_hypotheses", paths: [".xekute/logs/agent-hypotheses.jsonl"], format: "jsonl", owner: "investigation", sensitivity: "confidential" },
  { key: "tool_output", paths: [".xekute/logs/tool-output.jsonl"], format: "jsonl", owner: "artifact", sensitivity: "restricted" },
  { key: "plans", paths: [".xekute/plans", ".xekute/plan"], format: "directory", owner: "session", sensitivity: "internal" },
  { key: "assessment_assets", paths: ["recon/active-recon.json", "recon/passive-recon.json", "enumeration/assets.json", "enumeration/pages.json", "enumeration/subdomains.json", "enumeration/endpoints.json", "enumeration/services.json"], format: "json", owner: "project", sensitivity: "confidential" },
  { key: "scan_results", paths: ["vulnerability-scans/info.json", "vulnerability-scans/easy.json", "vulnerability-scans/medium.json", "vulnerability-scans/high.json", "vulnerability-scans/critical.json", "vulnerability-scans/services.json"], format: "json", owner: "investigation", sensitivity: "confidential" },
  { key: "identity_metadata", paths: [".xekute/identities"], format: "directory", owner: "sensitive", sensitivity: "restricted" },
  { key: "special_skill_runs", paths: [".xekute/special-skills/pentest/runs"], format: "directory", owner: "investigation", sensitivity: "confidential" },
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = MAX_TEXT) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_MIGRATION_FIELD_TOO_LARGE", "A migration field exceeds its maximum length.", { maximum });
  return result;
}

function integer(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  assert(Number.isSafeInteger(result) && result >= 0 && result <= maximum, "MEMORY_MIGRATION_INTEGER_INVALID", "A migration count or revision is invalid.");
  return result;
}

function list(value, maximum, itemMaximum = 500) {
  assert(value === undefined || Array.isArray(value), "MEMORY_MIGRATION_LIST_INVALID", "Migration list fields must be arrays.");
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function hash(value, field = "hash") {
  const result = text(value, 128).toLowerCase();
  assert(!result || /^[a-f0-9]{64}$/i.test(result), "MEMORY_MIGRATION_HASH_INVALID", `${field} must be a SHA-256 hash.`);
  return result;
}

function projectIdOf(value, { required = true } = {}) {
  const input = text(value, 240);
  if (!input && !required) return "";
  return assertMemoryId(input, "proj");
}

function operationIdOf(value, { required = true } = {}) {
  const input = text(value, 240);
  if (!input && !required) return "";
  return assertMemoryId(input, "op");
}

function warning(value) {
  const source = value && typeof value === "object" ? value : { message: value };
  return {
    code: text(source.code || "MEMORY_MIGRATION_WARNING", 160),
    message: text(source.message || source.error || "Migration requires attention.", 2_000),
    source_key: text(source.source_key || source.sourceKey || "", 160),
    path: text(source.path || "", 1_000),
    ...(source.line == null ? {} : { line: integer(source.line, 0, 10_000_000) }),
  };
}

function normalizeSource(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_MIGRATION_SOURCE_INVALID", "A legacy source summary must be an object.");
  const source = {
    key: text(input.key || input.source_key, 160),
    path: text(input.path || input.relative_path || input.relativePath, 1_000),
    format: text(input.format || "unknown", 40),
    owner: text(input.owner || "unclassified", 80),
    sensitivity: text(input.sensitivity || "confidential", 40),
    exists: Boolean(input.exists),
    readable: input.readable !== false,
    bytes: integer(input.bytes, 0, 2 ** 53 - 1),
    sha256: hash(input.sha256, "source sha256"),
    schema_version: text(input.schema_version || input.schemaVersion || "", 120),
    record_count: integer(input.record_count ?? input.recordCount, 0, 10_000_000),
    invalid_count: integer(input.invalid_count ?? input.invalidCount, 0, 10_000_000),
    secret_markers: integer(input.secret_markers ?? input.secretMarkers, 0, 10_000_000),
    truncated: Boolean(input.truncated),
    warnings: (Array.isArray(input.warnings) ? input.warnings : []).slice(0, MAX_WARNINGS).map(warning),
  };
  assert(source.key, "MEMORY_MIGRATION_SOURCE_KEY_REQUIRED", "A legacy source key is required.");
  assert(source.path, "MEMORY_MIGRATION_SOURCE_PATH_REQUIRED", "A legacy source path is required.");
  return source;
}

function normalizeMapping(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_MIGRATION_MAPPING_INVALID", "A migration mapping must be an object.");
  const disposition = text(input.disposition || "legacy_unclassified", 80);
  assert(MIGRATION_DISPOSITIONS.includes(disposition), "MEMORY_MIGRATION_DISPOSITION_INVALID", "A migration mapping disposition is unsupported.");
  return {
    source_key: text(input.source_key || input.sourceKey, 160),
    path: text(input.path, 1_000),
    source_index: integer(input.source_index ?? input.sourceIndex, 0, 10_000_000),
    legacy_id: text(input.legacy_id || input.legacyId, 500),
    owner: text(input.owner || "unclassified", 80),
    disposition,
    reason: text(input.reason || "", 2_000),
    record_type: text(input.record_type || input.recordType, 120),
    record_id: text(input.record_id || input.recordId, 300),
  };
}

function normalizeCounts(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input && typeof input === "object" ? input : {})) {
    const cleanKey = text(key, 120);
    if (!cleanKey) continue;
    result[cleanKey] = integer(value, 0, 10_000_000);
  }
  return result;
}

function createMigrationPreview(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_MIGRATION_PREVIEW_INVALID", "A migration preview must be an object.");
  const sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, MAX_SOURCES).map(normalizeSource);
  const mappings = (Array.isArray(input.mappings) ? input.mappings : []).slice(0, MAX_MAPPINGS).map(normalizeMapping);
  const warnings = (Array.isArray(input.warnings) ? input.warnings : []).slice(0, MAX_WARNINGS).map(warning);
  const projectId = projectIdOf(input.project_id || input.projectId, { required: false });
  const operationId = operationIdOf(input.operation_id || input.operationId, { required: false });
  const sourceHashes = sources.filter((source) => source.sha256).map((source) => `${source.key}:${source.path}:${source.sha256}`).sort();
  const previewHash = hash(canonicalKeyHash({ project_id: projectId, sources: sourceHashes, mappings, counts: normalizeCounts(input.counts) }), "preview_hash");
  return Object.freeze({
    schema_version: MIGRATION_CONTRACT_VERSION,
    kind: "xekute-memory-migration-preview",
    project_id: projectId,
    operation_id: operationId,
    state: "preview",
    generated_at: text(input.generated_at || new Date().toISOString(), 80),
    source_hashes: sourceHashes,
    sources,
    mappings,
    counts: normalizeCounts(input.counts),
    warnings,
    preview_hash: text(input.preview_hash || previewHash, 128),
    initialized: Boolean(input.initialized),
    read_only: true,
  });
}

function createMigrationBatch(input = {}) {
  const projectId = projectIdOf(input.project_id || input.projectId);
  const operationId = operationIdOf(input.operation_id || input.operationId);
  const state = text(input.state || "importing", 40);
  assert(MIGRATION_STATES.includes(state) && state !== "preview", "MEMORY_MIGRATION_STATE_INVALID", "A migration batch state is unsupported.");
  const imported = input.imported_record_ids || input.importedRecordIds || {};
  const importedRecordIds = {};
  for (const [domain, ids] of Object.entries(imported && typeof imported === "object" ? imported : {})) importedRecordIds[text(domain, 80)] = list(ids, MAX_IDS, 300);
  const sourceHashes = list(input.source_hashes || input.sourceHashes, MAX_SOURCES, 300);
  const batch = {
    schema_version: MIGRATION_CONTRACT_VERSION,
    kind: "xekute-memory-migration-batch",
    project_id: projectId,
    operation_id: operationId,
    preview_hash: hash(input.preview_hash || input.previewHash, "preview_hash"),
    source_hashes: sourceHashes,
    source_paths: list(input.source_paths || input.sourcePaths, MAX_SOURCES, 1_000),
    state,
    created_at: text(input.created_at || input.createdAt || new Date().toISOString(), 80),
    updated_at: text(input.updated_at || input.updatedAt || new Date().toISOString(), 80),
    completed_at: text(input.completed_at || input.completedAt || "", 80),
    rolled_back_at: text(input.rolled_back_at || input.rolledBackAt || "", 80),
    imported_record_ids: importedRecordIds,
    aliases: list(input.aliases, MAX_IDS, 500),
    warnings: (Array.isArray(input.warnings) ? input.warnings : []).slice(0, MAX_WARNINGS).map(warning),
    counts: normalizeCounts(input.counts),
    rollback: input.rollback && typeof input.rollback === "object" ? {
      available: input.rollback.available !== false,
      reason: text(input.rollback.reason || "", 2_000),
      excluded: Boolean(input.rollback.excluded),
    } : { available: true, reason: "", excluded: false },
  };
  return Object.freeze(batch);
}

function createMigrationRollback(input = {}) {
  const projectId = projectIdOf(input.project_id || input.projectId);
  const operationId = operationIdOf(input.operation_id || input.operationId);
  const rollbackOperationId = operationIdOf(input.rollback_operation_id || input.rollbackOperationId, { required: false });
  return Object.freeze({
    schema_version: MIGRATION_CONTRACT_VERSION,
    kind: "xekute-memory-migration-rollback",
    project_id: projectId,
    operation_id: operationId,
    rollback_operation_id: rollbackOperationId,
    state: "rolled_back",
    reason: text(input.reason || "operator_requested", 2_000),
    created_at: text(input.created_at || input.createdAt || new Date().toISOString(), 80),
    excluded_record_ids: Object.fromEntries(Object.entries(input.excluded_record_ids || input.excludedRecordIds || {}).map(([domain, ids]) => [text(domain, 80), list(ids, MAX_IDS, 300)])),
  });
}

module.exports = Object.freeze({
  MIGRATION_CONTRACT_VERSION,
  MIGRATION_STATES,
  MIGRATION_DISPOSITIONS,
  LEGACY_SOURCE_DEFINITIONS,
  normalizeSource,
  normalizeMapping,
  normalizeCounts,
  createMigrationPreview,
  createMigrationBatch,
  createMigrationRollback,
  validateMigrationPreview: (input) => validate(createMigrationPreview, input),
  validateMigrationBatch: (input) => validate(createMigrationBatch, input),
  validateMigrationRollback: (input) => validate(createMigrationRollback, input),
});
