(() => {
const Tunables = (typeof require !== "undefined" ? require("../tunables") : null) || globalThis.AgentTunables || {
  REPEAT_CLASS_LIMIT: 2,
  FAILURE_MEMORY_TTL_MS: 24 * 60 * 60 * 1000,
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 24;

function normalizeRecord(raw = {}) {
  const toolName = String(raw.toolName || raw.tool || "").trim();
  const signature = String(raw.signature || "").trim();
  const errorClass = String(raw.errorClass || "").trim();
  if (!toolName || !signature || !errorClass) return null;
  const count = Math.max(1, Number(raw.count) || Tunables.REPEAT_CLASS_LIMIT);
  const recordedAt = String(raw.recordedAt || new Date().toISOString());
  const expiresAt = String(raw.expiresAt || new Date(Date.now() + DEFAULT_TTL_MS).toISOString());
  return { toolName, signature, errorClass, count, recordedAt, expiresAt };
}

function isExpired(record, now = Date.now()) {
  const expiry = Date.parse(record?.expiresAt || "");
  return Number.isFinite(expiry) && expiry <= now;
}

function pruneFailureRecords(records = [], now = Date.now()) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter(Boolean)
    .filter((record) => !isExpired(record, now))
    .slice(-MAX_RECORDS);
}

function recordKey(record) {
  return `${record.toolName}:${record.signature}:${record.errorClass}`;
}

function mergeFailureRecords(existing = [], additions = [], { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const merged = new Map();
  for (const record of pruneFailureRecords(existing, now)) merged.set(recordKey(record), record);
  for (const addition of Array.isArray(additions) ? additions : []) {
    const normalized = normalizeRecord({
      ...addition,
      expiresAt: addition?.expiresAt || new Date(now + ttlMs).toISOString(),
    });
    if (!normalized || isExpired(normalized, now)) continue;
    const key = recordKey(normalized);
    const prior = merged.get(key);
    merged.set(key, prior
      ? { ...prior, count: Math.max(prior.count, normalized.count), expiresAt: normalized.expiresAt }
      : normalized);
  }
  return [...merged.values()].slice(-MAX_RECORDS);
}

function applyFailureRecordsToRuntime(records, failedToolCalls, failedToolClasses, failedErrorClassesGlobal, { now = Date.now() } = {}) {
  for (const record of pruneFailureRecords(records, now)) {
    if (record.count >= Tunables.REPEAT_CLASS_LIMIT) {
      failedToolCalls.set(record.signature, Tunables.REPEAT_CLASS_LIMIT);
      failedToolClasses.set(record.signature, { errorClass: record.errorClass, count: record.count });
    }
  }
}

function buildFailureRecord({ toolName, signature, errorClass, count = Tunables.REPEAT_CLASS_LIMIT, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!toolName || !signature || !errorClass || count < Tunables.REPEAT_CLASS_LIMIT) return null;
  const now = Date.now();
  return normalizeRecord({
    toolName,
    signature,
    errorClass,
    count,
    recordedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  });
}

function serializeFailureRecords(records = []) {
  return pruneFailureRecords(records).map((record) => ({ ...record }));
}

const FailureMemory = {
  DEFAULT_TTL_MS,
  MAX_RECORDS,
  applyFailureRecordsToRuntime,
  buildFailureRecord,
  isExpired,
  mergeFailureRecords,
  normalizeRecord,
  pruneFailureRecords,
  serializeFailureRecords,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = FailureMemory;
}

if (typeof globalThis !== "undefined") {
  globalThis.FailureMemory = FailureMemory;
}
})();
