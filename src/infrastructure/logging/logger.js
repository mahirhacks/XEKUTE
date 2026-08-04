"use strict";

/**
 * Structured logger with source-level redaction. Preserves the current
 * console/error behavior while giving the container a single logging seam.
 */
const SECRET_PATTERN = /(api[_-]?key|authorization|password|passwd|secret|token|client_secret)\s*[:=]\s*["']?[^\s"',;]+/gi;

function redact(value) {
  const text = typeof value === "string" ? value : safeJson(value);
  return text.replace(SECRET_PATTERN, "$1=[REDACTED]");
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createLogger({ sink = console } = {}) {
  return {
    info(...args) { sink.log(...args.map(redact)); },
    warn(...args) { sink.warn(...args.map(redact)); },
    error(...args) { sink.error(...args.map(redact)); },
    debug(...args) { if (process.env.XEKUTE_DEBUG) sink.log(...args.map(redact)); },
  };
}

module.exports = { createLogger, redact };
