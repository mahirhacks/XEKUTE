"use strict";

const SECRET_KEY_RE = /(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?token)/i;
const HEADER_SECRET_RE = /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi;
const TOKEN_ASSIGNMENT_RE = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[=:]\s*(["']?)[^\s,;"']{4,}\2/gi;
const PRIVATE_KEY_RE = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;

function redactSecrets(value) {
  return String(value ?? "")
    .replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]")
    .replace(HEADER_SECRET_RE, (_match, name) => `${name}: [REDACTED]`)
    .replace(BEARER_RE, (_match, scheme) => `${scheme} [REDACTED]`)
    .replace(TOKEN_ASSIGNMENT_RE, (_match, name) => `${name}=[REDACTED]`);
}

function redactStructuredValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactStructuredValue(child, seen);
  }
  return output;
}

function redactKnownSecrets(value, knownSecrets = [], seen = new WeakSet()) {
  const secrets = Array.isArray(knownSecrets)
    ? [...new Set(knownSecrets.map((secret) => String(secret || "")).filter((secret) => secret.length >= 4))]
    : [];
  const visit = (item) => {
    if (typeof item === "string") {
      let output = redactSecrets(item);
      for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
      return output;
    }
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[CIRCULAR]";
    seen.add(item);
    if (Array.isArray(item)) return item.map(visit);
    const output = {};
    for (const [key, child] of Object.entries(item)) output[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : visit(child);
    return output;
  };
  return visit(value);
}

module.exports = { SECRET_KEY_RE, redactKnownSecrets, redactSecrets, redactStructuredValue };
