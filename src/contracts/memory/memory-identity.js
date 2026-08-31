"use strict";

const crypto = require("node:crypto");
const { assert } = require("./memory-errors.js");

// V3 uses opaque, typed identifiers.  The older prefixes are retained as
// parser aliases for non-memory application records, but every V3 identifier
// has one of the explicit prefixes below.  Keeping the validation here means
// storage, IPC, model output, and tests all agree on identity semantics.
const ID_PREFIXES = Object.freeze([
  "proj", "session", "block", "entity", "claim", "rel", "inv", "attempt",
  "finding", "verification", "artifact", "kb", "procedure", "sel", "op", "event",
  "txn", "job", "checkpoint", "blocker",
]);
const ID_PREFIX_SET = new Set(ID_PREFIXES);
const ID_PATTERN = /^(proj|session|block|entity|claim|rel|inv|attempt|finding|verification|artifact|kb|procedure|sel|op|event|txn|job|checkpoint|blocker)_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const MAX_CANONICAL_DEPTH = 32;
const TOO_DEEP = "[OMITTED_TOO_DEEP]";
const CIRCULAR = "[CIRCULAR]";

function canonicalize(value, depth = 0, seen = null) {
  // Prefix hashing wraps tool JSON Schema several levels deep. A hard throw at
  // depth 12 aborted ordinary chat turns (including "hi") before the model ran.
  // Truncate instead of failing the turn; the sentinel is stable for hashes.
  if (depth > MAX_CANONICAL_DEPTH) return TOO_DEEP;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) || (value && typeof value === "object")) {
    const nextSeen = seen || new WeakSet();
    if (nextSeen.has(value)) return CIRCULAR;
    nextSeen.add(value);
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, depth + 1, nextSeen));
    return Object.keys(value).sort().reduce((result, key) => {
      result[String(key)] = canonicalize(value[key], depth + 1, nextSeen);
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
  // Validation failures may be surfaced through IPC/diagnostics.  Never echo
  // the rejected value: callers can pass secrets, credentials, or arbitrary
  // attacker-controlled text in an ID-shaped field.  The length is enough to
  // make malformed-input diagnostics useful without retaining the payload.
  const supplied = String(value == null ? "" : value);
  assert(isMemoryId(value, expectedPrefix), "MEMORY_ID_INVALID", "Memory IDs must be opaque, prefixed, and bounded.", {
    expectedPrefix: String(expectedPrefix || ""),
    valueLength: supplied.length,
  });
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
