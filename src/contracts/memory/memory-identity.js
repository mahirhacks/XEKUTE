"use strict";

const crypto = require("node:crypto");
const { assert } = require("./memory-errors.js");

const ID_PREFIXES = Object.freeze([
  "proj", "session", "block", "entity", "claim", "rel", "inv", "attempt",
  "finding", "artifact", "kb", "procedure", "sel", "op", "event",
]);
const ID_PREFIX_SET = new Set(ID_PREFIXES);
const ID_PATTERN = /^(proj|session|block|entity|claim|rel|inv|attempt|finding|artifact|kb|procedure|sel|op|event)_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

function canonicalize(value, depth = 0) {
  assert(depth <= 12, "MEMORY_CANONICAL_VALUE_TOO_DEEP", "Canonical values may not exceed the supported nesting depth.");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[String(key)] = canonicalize(value[key], depth + 1);
      return result;
    }, {});
  }
  assert(false, "MEMORY_CANONICAL_VALUE_INVALID", "Canonical values must contain only JSON-compatible data.");
}

function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }

function canonicalKeyHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function createOpaqueId(prefix, { uuid = crypto.randomUUID } = {}) {
  const cleanPrefix = String(prefix || "").trim().toLowerCase();
  assert(ID_PREFIX_SET.has(cleanPrefix), "MEMORY_ID_PREFIX_INVALID", `Unsupported memory ID prefix: ${cleanPrefix || "<empty>"}.`);
  const value = String(uuid()).trim();
  assert(/^[0-9a-f-]{16,80}$/i.test(value), "MEMORY_ID_GENERATOR_INVALID", "The memory ID generator returned an invalid value.");
  return `${cleanPrefix}_${value}`;
}

function isMemoryId(value, expectedPrefix = "") {
  const input = String(value || "");
  if (!ID_PATTERN.test(input)) return false;
  return !expectedPrefix || input.startsWith(`${String(expectedPrefix).toLowerCase()}_`);
}

function assertMemoryId(value, expectedPrefix = "") {
  assert(isMemoryId(value, expectedPrefix), "MEMORY_ID_INVALID", "Memory IDs must be opaque, prefixed, and bounded.", { value: String(value || ""), expectedPrefix: String(expectedPrefix || "") });
  return String(value);
}

function canonicalProjectKey(value) {
  const normalized = String(value == null ? "" : value).normalize("NFKC").trim();
  assert(normalized.length > 0, "MEMORY_PROJECT_KEY_EMPTY", "A project canonical key is required.");
  return normalized;
}

function createAlias({ projectId, legacyId, canonicalId, aliasType = "legacy" } = {}) {
  assertMemoryId(projectId, "proj");
  assertMemoryId(canonicalId);
  const legacy = String(legacyId || "").replace(/[\u0000\r\n]/g, "").trim().slice(0, 240);
  assert(legacy.length > 0, "MEMORY_ALIAS_INVALID", "An alias must have a non-empty legacy ID.");
  return Object.freeze({
    project_id: projectId,
    alias_type: String(aliasType || "legacy").slice(0, 40),
    legacy_id: legacy,
    canonical_id: canonicalId,
  });
}

function assertProjectBinding(record, projectId) {
  const expected = assertMemoryId(projectId, "proj");
  const actual = record && typeof record === "object" ? String(record.project_id || record.projectId || "") : "";
  assert(actual === expected, "MEMORY_PROJECT_MISMATCH", "The record does not belong to the requested project.", { expectedProjectId: expected, actualProjectId: actual });
  return true;
}

module.exports = Object.freeze({ ID_PREFIXES, ID_PATTERN, canonicalize, canonicalJson, canonicalKeyHash, createOpaqueId, isMemoryId, assertMemoryId, canonicalProjectKey, createAlias, assertProjectBinding });
