"use strict";

const STATUS_VERSION = 1;
const STATUS_DIMENSIONS = Object.freeze([
  "action",
  "durability",
  "semantic_finalization",
  "outbox",
  "projection",
  "summarization",
  "sensitive_store",
  "migration",
]);
const STATUS_STATES = new Set(["unknown", "healthy", "pending", "failed", "degraded", "disabled"]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, maximum = 500) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function safeDetails(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanText(value, 2_000);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => safeDetails(entry, depth + 1));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value).slice(0, 50)) {
      if (/^(?:cookie|authorization|token|secret|password|private[_-]?key|passphrase|raw[_-]?value)/i.test(key)) continue;
      result[cleanText(key, 120)] = safeDetails(child, depth + 1);
    }
    return result;
  }
  return undefined;
}

function normalizeDimension(dimension, input = {}, now) {
  const key = String(dimension || "").trim().toLowerCase();
  if (!STATUS_DIMENSIONS.includes(key)) {
    const error = new Error(`Unsupported memory status dimension: ${key || "<empty>"}.`);
    error.code = "MEMORY_STATUS_DIMENSION_INVALID";
    throw error;
  }
  const state = String(input.state || input.status || "unknown").trim().toLowerCase();
  if (!STATUS_STATES.has(state)) {
    const error = new Error(`Unsupported memory status state: ${state || "<empty>"}.`);
    error.code = "MEMORY_STATUS_STATE_INVALID";
    throw error;
  }
  return {
    state,
    code: cleanText(input.code || "", 120),
    message: cleanText(input.message || input.error || "", 2_000),
    retryable: Boolean(input.retryable),
    details: safeDetails(input.details || {}),
    updated_at: new Date(now()).toISOString(),
  };
}

function emptyDimensions(now) {
  return Object.fromEntries(STATUS_DIMENSIONS.map((dimension) => [dimension, normalizeDimension(dimension, { state: "unknown" }, now)]));
}

function createMemoryStatus({ now = () => new Date() } = {}) {
  const scopes = new Map();

  function scopeKey(scope = {}) {
    const projectId = cleanText(scope.project_id || scope.projectId || "", 240);
    const sessionId = cleanText(scope.session_id || scope.sessionId || "", 240);
    return `${projectId}|${sessionId}`;
  }

  function read(scope = {}) {
    const key = scopeKey(scope);
    const current = scopes.get(key) || { version: STATUS_VERSION, project_id: cleanText(scope.project_id || scope.projectId || "", 240), session_id: cleanText(scope.session_id || scope.sessionId || "", 240), updated_at: new Date(now()).toISOString(), dimensions: emptyDimensions(now) };
    return clone({ ok: true, ...current, dimensions: current.dimensions });
  }

  function update(scope = {}, dimension, patch = {}) {
    let normalized;
    try { normalized = normalizeDimension(dimension, patch, now); } catch (error) { return { ok: false, code: error.code || "MEMORY_STATUS_INVALID", error: error.message, retryable: false, details: {} }; }
    const key = scopeKey(scope);
    const current = read(scope);
    current.updated_at = new Date(now()).toISOString();
    current.dimensions[dimension] = normalized;
    scopes.set(key, current);
    return clone({ ok: true, status: current, changed: true, dimension });
  }

  function merge(scope = {}, dimensions = {}) {
    const results = [];
    for (const [dimension, patch] of Object.entries(dimensions || {})) {
      const result = update(scope, dimension, patch);
      if (!result.ok) return result;
      results.push(result);
    }
    return { ok: true, status: read(scope), changed: results.some((result) => result.changed) };
  }

  function reset(scope = {}) {
    const key = scopeKey(scope);
    scopes.delete(key);
    return { ok: true, status: read(scope), changed: true };
  }

  return Object.freeze({ STATUS_VERSION, STATUS_DIMENSIONS, STATUS_STATES: [...STATUS_STATES], read, status: read, update, merge, reset, size: () => scopes.size });
}

module.exports = Object.freeze({ createMemoryStatus, STATUS_VERSION, STATUS_DIMENSIONS, STATUS_STATES: [...STATUS_STATES] });
