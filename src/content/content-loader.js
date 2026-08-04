"use strict";

/**
 * content-loader.js
 *
 * Stable resolver for generated prompt modules in src/content/build. Consumers
 * reference modules by logical name; this loader reads the deterministic
 * manifest and requires the content-addressed generated file. Runtime never
 * parses Markdown and never hardcodes a generated hash filename.
 */

const fs = require("node:fs");
const path = require("node:path");

const BUILD_ROOT = path.join(__dirname, "build");
const MANIFEST_PATH = path.join(BUILD_ROOT, "manifest.json");

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.modules)) {
    throw new Error("content/build manifest is invalid: expected a modules array");
  }
  return parsed;
}

function moduleRecord(logicalName) {
  const manifest = loadManifest();
  const record = manifest.modules.find((entry) => entry.logicalName === logicalName);
  if (!record) {
    const known = manifest.modules.map((entry) => entry.logicalName).join(", ");
    throw new Error(`Content module not found: ${logicalName}. Known modules: ${known}`);
  }
  return record;
}

function resolvePath(logicalName) {
  const record = moduleRecord(logicalName);
  return path.join(BUILD_ROOT, record.file);
}

function requireModule(logicalName) {
  const target = resolvePath(logicalName);
  return require(target);
}

function systemPrompt() {
  return requireModule("system_prompt");
}

module.exports = {
  BUILD_ROOT,
  MANIFEST_PATH,
  loadManifest,
  moduleRecord,
  resolvePath,
  requireModule,
  systemPrompt,
};
