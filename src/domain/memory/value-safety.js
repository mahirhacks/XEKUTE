"use strict";

const RAW_SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret[_-]?value|raw[_-]?value|password)$/i;

function text(value, maximum = 8_000) {
  const result = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  if (result.length > maximum) {
    const error = new Error("The memory value exceeds its maximum length.");
    error.code = "MEMORY_FIELD_TOO_LARGE";
    throw error;
  }
  return result;
}

function assertSafe(value, key = "", depth = 0, { maxDepth = 10 } = {}) {
  if (depth > maxDepth) throw Object.assign(new Error("Memory values may not be nested this deeply."), { code: "MEMORY_PAYLOAD_TOO_DEEP" });
  if (RAW_SECRET_KEY.test(String(key || ""))) throw Object.assign(new Error("Raw secret fields are not permitted in Project Memory."), { code: "MEMORY_SECRET_FIELD", details: { field: String(key) } });
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    if (value.length > 500) throw Object.assign(new Error("A memory value contains too many items."), { code: "MEMORY_ARRAY_TOO_LARGE" });
    for (const item of value) assertSafe(item, "", depth + 1, { maxDepth });
    return true;
  }
  if (typeof value !== "object") throw Object.assign(new Error("Memory values must be JSON-compatible."), { code: "MEMORY_PAYLOAD_INVALID" });
  for (const [childKey, child] of Object.entries(value)) assertSafe(child, childKey, depth + 1, { maxDepth });
  return true;
}

function cloneSafe(value) {
  assertSafe(value);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = Object.freeze({ RAW_SECRET_KEY, text, assertSafe, cloneSafe });
