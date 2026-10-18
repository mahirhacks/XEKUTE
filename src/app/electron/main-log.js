"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Append-only main-process error log. Background work that must not fail its
 * caller still leaves a trace here instead of disappearing.
 */
function createMainLog({ directory, fs = nodeFs, path = nodePath, now = () => new Date() } = {}) {
  const file = () => path.join(typeof directory === "function" ? directory() : directory, "main.log");

  function write(scope, error) {
    const entry = JSON.stringify({
      at: now().toISOString(),
      scope: String(scope || "main"),
      code: error?.code || "",
      message: String(error?.message || error || "").slice(0, 2000),
      stack: String(error?.stack || "").split("\n").slice(1, 6).join("\n"),
    });
    console.warn(`[${scope}]`, error?.message || error);
    try {
      const target = file();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { if (fs.statSync(target).size > MAX_LOG_BYTES) fs.renameSync(target, `${target}.1`); } catch { /* No log yet. */ }
      fs.appendFileSync(target, `${entry}\n`, "utf8");
    } catch { /* Logging must never break the caller. */ }
  }

  // For fire-and-forget promises: `.catch(log.ignored("scope"))`.
  const ignored = (scope) => (error) => write(scope, error);

  return Object.freeze({ write, ignored, file });
}

module.exports = { createMainLog, MAX_LOG_BYTES };
