"use strict";

const {
  CATALOG_VERSION,
  PUBLIC_TOOL_NAMES,
  PROFILE_TOOL_NAMES,
  normalizeProfile,
  toolNamesForProfile,
  validateCatalogSize,
} = require("../../contracts/tool/unified-catalog");
const { UNIFIED_INPUT_SCHEMAS } = require("../../contracts/tool/unified-schemas");

const ROLLOUT_MODES = Object.freeze(["legacy", "unified_shadow", "unified_enabled"]);
const DESCRIPTION = Object.freeze({
  exec_command: "Run one bounded workspace/development command through host capabilities.",
  read_file: "Read one bounded workspace file.",
  search_workspace: "Search, list, inspect, or index the bounded workspace.",
  apply_patch: "Apply structured reviewable patches to one workspace file.",
  manage_plan: "Create, inspect, update, complete, or close durable plan state.",
  manage_state: "Read or update durable agent state and checkpoints.",
  check_scope: "Evaluate or issue a bound authorization and scope decision.",
  ingest_traffic: "Normalize bounded traffic input with provenance.",
  manage_identity: "List or manage opaque assessment-scoped identity references.",
  replay_request: "Replay an approved request through a controlled identity and scope decision.",
  run_test_case: "Run one structured approved VAPT test case.",
  browser_action: "Perform one policy-aware browser workflow action when a driver is available.",
  compare_responses: "Compare bounded response evidence and fingerprints.",
  verify_finding: "Run independent finding verification checks.",
  store_finding: "Store or update an evidence-backed finding through the finding gate.",
  attack_graph: "Query or update bounded attack-graph assertions.",
  delegate_agent: "Delegate bounded work to one approved specialist agent.",
});

function normalizeRollout(value = "legacy") {
  const normalized = String(value || "legacy").trim().toLowerCase();
  return ROLLOUT_MODES.includes(normalized) ? normalized : "legacy";
}

function schemaFor(name) {
  return {
    type: "function",
    function: {
      name,
      description: DESCRIPTION[name] || `Execute ${name} through the XEKUTE host boundary.`,
      parameters: UNIFIED_INPUT_SCHEMAS[name],
    },
  };
}

function buildUnifiedProviderCatalog(profile = "agent") {
  const normalized = normalizeProfile(profile);
  const names = toolNamesForProfile(normalized);
  const tools = names.map(schemaFor);
  const size = validateCatalogSize(normalized, Object.fromEntries(tools.map((tool) => [tool.function.name, tool])));
  if (!size.ok) throw new Error(`Unified provider catalog exceeds size budget: ${size.code}`);
  return Object.freeze({
    version: CATALOG_VERSION,
    profile: normalized,
    names: Object.freeze([...names]),
    tools: Object.freeze(tools),
    catalogBytes: size.catalogBytes,
    schemaBytes: Object.freeze(Object.fromEntries(tools.map((tool) => [tool.function.name, Buffer.byteLength(JSON.stringify(tool.function.parameters), "utf8")]))),
  });
}

function buildProviderCatalog({ profile = "agent", rollout = "legacy", legacyTools = [] } = {}) {
  const mode = normalizeRollout(rollout);
  if (mode === "legacy") return { version: "legacy", mode, tools: Array.isArray(legacyTools) ? legacyTools : [], shadow: null };
  const unified = buildUnifiedProviderCatalog(profile);
  return {
    version: mode === "unified_shadow" ? "legacy" : unified.version,
    mode,
    tools: mode === "unified_shadow" ? (Array.isArray(legacyTools) ? legacyTools : []) : unified.tools,
    shadow: mode === "unified_shadow" ? { version: unified.version, names: unified.names, catalogBytes: unified.catalogBytes } : null,
    metadata: unified,
  };
}

function catalogNames(catalog) {
  return (Array.isArray(catalog?.tools) ? catalog.tools : []).map((tool) => tool?.function?.name).filter(Boolean);
}

function assertCatalogNames(catalog, profile = "agent") {
  const expected = PROFILE_TOOL_NAMES[normalizeProfile(profile)];
  const actual = catalogNames(catalog);
  if (catalog?.version !== CATALOG_VERSION) throw new Error("Catalog version is not unified xekute.vapt.v1");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Provider catalog names do not match the approved profile subset");
  if (actual.some((name) => !PUBLIC_TOOL_NAMES.includes(name))) throw new Error("Provider catalog contains a non-public tool");
  return true;
}

module.exports = {
  ROLLOUT_MODES,
  normalizeRollout,
  buildUnifiedProviderCatalog,
  buildProviderCatalog,
  catalogNames,
  assertCatalogNames,
};
