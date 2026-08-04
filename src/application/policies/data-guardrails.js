/* Deterministic secret redaction before tool output is shown to a model. */

function redactSecrets(value) {
  return String(value || "")
    .replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,;&}]+/gi, "$1[REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED_JWT]");
}

const SECRET_KEY_RE = /authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|password|passwd|secret|token|private[_-]?key/i;

function redactStructuredValue(value, key = "", depth = 0) {
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactStructuredValue(item, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 300).map(([name, item]) => [name, redactStructuredValue(item, name, depth + 1)]));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length <= 100000) {
      try { return JSON.stringify(redactStructuredValue(JSON.parse(trimmed), "", depth + 1)).slice(0, 12000); } catch { /* Treat as plain text. */ }
    }
    return redactSecrets(value).slice(0, 12000);
  }
  return value;
}

module.exports = { SECRET_KEY_RE, redactSecrets, redactStructuredValue };
