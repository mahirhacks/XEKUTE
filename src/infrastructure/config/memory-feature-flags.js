"use strict";

const MEMORY_FEATURE_DEFAULTS = Object.freeze({
  durabilityFoundation: false,
  projectMemoryV2: false,
  blockMemoryUpdater: false,
  knowledgeRetrievalV2: false,
  investigationMemoryV2: false,
  evidenceMemoryV2: false,
  sensitiveWorkingMemory: false,
  operationalContextV2: false,
  contextAssemblyV2: false,
  derivedMemoryViews: false,
  multiAgentMemoryV2: false,
  memoryUiV2: false,
  migrationDualRead: false,
  migrationDualWrite: false,
});

function createMemoryFeatureFlags({ overrides = {}, source = "main" } = {}) {
  if (source !== "main") throw Object.assign(new Error("Memory feature flags may only be created by the main process."), { code: "MEMORY_FEATURE_FLAGS_FORBIDDEN" });
  const input = overrides && typeof overrides === "object" ? overrides : {};
  const unknown = Object.keys(input).filter((key) => !Object.prototype.hasOwnProperty.call(MEMORY_FEATURE_DEFAULTS, key));
  if (unknown.length) throw Object.assign(new Error(`Unknown memory feature flag: ${unknown[0]}`), { code: "MEMORY_FEATURE_FLAG_UNKNOWN", details: { unknown } });
  const result = { ...MEMORY_FEATURE_DEFAULTS };
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "boolean") throw Object.assign(new Error(`Memory feature flag '${key}' must be boolean.`), { code: "MEMORY_FEATURE_FLAG_INVALID", details: { key } });
    result[key] = value;
  }
  return Object.freeze(result);
}

function isMemoryFeatureEnabled(flags, name) { return Boolean(flags && flags[name] === true); }

module.exports = Object.freeze({ MEMORY_FEATURE_DEFAULTS, createMemoryFeatureFlags, isMemoryFeatureEnabled });
