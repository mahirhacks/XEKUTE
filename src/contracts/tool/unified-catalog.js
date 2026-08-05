"use strict";

const CATALOG_VERSION = "xekute.vapt.v1";
const PUBLIC_TOOL_NAMES = Object.freeze([
  "exec_command",
  "read_file",
  "search_workspace",
  "apply_patch",
  "manage_plan",
  "manage_state",
  "check_scope",
  "ingest_traffic",
  "manage_identity",
  "replay_request",
  "run_test_case",
  "browser_action",
  "compare_responses",
  "verify_finding",
  "store_finding",
  "attack_graph",
  "delegate_agent",
]);

const LEGACY_OR_INTERNAL_NAMES = new Set([
  "load_tool_schemas",
  "request_operator_questions",
  "run_command",
  "start_process",
  "read_process",
  "stop_process",
  "run_security_tool",
  "run_traffsucker",
  "record_hypothesis",
  "record_finding_candidate",
  "verify_finding_candidate",
  "ingest_assessment_records",
  "list_datasets",
]);

const PROFILE_TOOL_NAMES = Object.freeze({
  agent: PUBLIC_TOOL_NAMES,
  planner: Object.freeze([
    "read_file",
    "search_workspace",
    "apply_patch",
    "manage_plan",
    "manage_state",
  ]),
  ask: Object.freeze([
    "read_file",
    "search_workspace",
    "manage_plan",
    "manage_state",
    "compare_responses",
  ]),
  hypothesis: Object.freeze([
    "read_file",
    "search_workspace",
    "manage_plan",
    "manage_state",
    "check_scope",
    "compare_responses",
  ]),
});

const MAX_CATALOG_BYTES = 64 * 1024;
const MAX_SCHEMA_BYTES = 12 * 1024;
const PUBLIC_TOOL_SET = new Set(PUBLIC_TOOL_NAMES);

function assertCatalogIntegrity(names = PUBLIC_TOOL_NAMES) {
  if (!Array.isArray(names) || names.length !== PUBLIC_TOOL_NAMES.length) {
    throw new Error(`Unified catalog must contain exactly ${PUBLIC_TOOL_NAMES.length} tools`);
  }
  if (new Set(names).size !== names.length) throw new Error("Unified catalog contains duplicate tool names");
  for (const name of names) {
    if (!PUBLIC_TOOL_SET.has(name) || LEGACY_OR_INTERNAL_NAMES.has(name)) {
      throw new Error(`Invalid unified public tool name: ${name}`);
    }
  }
  for (const [profile, profileNames] of Object.entries(PROFILE_TOOL_NAMES)) {
    if (!profileNames.every((name) => PUBLIC_TOOL_SET.has(name))) {
      throw new Error(`Profile ${profile} contains a tool outside the unified catalog`);
    }
    if (new Set(profileNames).size !== profileNames.length) {
      throw new Error(`Profile ${profile} contains duplicate tool names`);
    }
  }
  if (PROFILE_TOOL_NAMES.agent.length !== PUBLIC_TOOL_NAMES.length) {
    throw new Error("Agent profile must receive all unified public tools");
  }
  return true;
}

function normalizeProfile(profile = "agent") {
  const raw = typeof profile === "object" ? profile.key || profile.mode || profile.id : profile;
  const key = String(raw || "agent").toLowerCase();
  if (["plan", "planner"].includes(key)) return "planner";
  if (key === "hypothesis") return "hypothesis";
  if (key === "ask") return "ask";
  return "agent";
}

function toolNamesForProfile(profile = "agent") {
  assertCatalogIntegrity();
  return PROFILE_TOOL_NAMES[normalizeProfile(profile)];
}

function profileCatalog(profile = "agent", schemas = {}) {
  const names = toolNamesForProfile(profile);
  return Object.freeze(names.map((name) => Object.freeze({
    type: "function",
    function: schemas[name] || { name, description: `Execute ${name}.`, parameters: { type: "object", properties: {}, additionalProperties: false } },
  })));
}

function serializedCatalogSize(profile = "agent", schemas = {}) {
  return Buffer.byteLength(JSON.stringify(profileCatalog(profile, schemas)), "utf8");
}

function validateCatalogSize(profile = "agent", schemas = {}, { maxCatalogBytes = MAX_CATALOG_BYTES, maxSchemaBytes = MAX_SCHEMA_BYTES } = {}) {
  const catalog = profileCatalog(profile, schemas);
  const catalogBytes = Buffer.byteLength(JSON.stringify(catalog), "utf8");
  const oversizedSchemas = catalog
    .filter((tool) => Buffer.byteLength(JSON.stringify(tool.function?.parameters || {}), "utf8") > maxSchemaBytes)
    .map((tool) => tool.function?.name);
  if (catalogBytes > maxCatalogBytes || oversizedSchemas.length) {
    return { ok: false, catalogBytes, maxCatalogBytes, oversizedSchemas, maxSchemaBytes, code: "CATALOG_SIZE_EXCEEDED" };
  }
  return { ok: true, catalogBytes, maxCatalogBytes, oversizedSchemas: [], maxSchemaBytes };
}

assertCatalogIntegrity();

module.exports = {
  CATALOG_VERSION,
  PUBLIC_TOOL_NAMES,
  PROFILE_TOOL_NAMES,
  LEGACY_OR_INTERNAL_NAMES,
  MAX_CATALOG_BYTES,
  MAX_SCHEMA_BYTES,
  assertCatalogIntegrity,
  normalizeProfile,
  toolNamesForProfile,
  profileCatalog,
  serializedCatalogSize,
  validateCatalogSize,
};
