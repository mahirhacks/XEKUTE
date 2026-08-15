"use strict";

/** Structured logger seam. Values pass through unchanged. */
function redact(value) {
  return typeof value === "string" ? value : safeJson(value);
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
