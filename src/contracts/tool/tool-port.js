"use strict";

const { estimateTokenCount } = require("../../shared/token-estimate.js");
const { deriveErrorClass } = require("../../agent/runtime/error-class");
const { parseToolArguments } = require("../../contracts/tool/parse-tool-arguments");
const { toOpenAITool } = require("../../agent/tools/config/tool-registry");
const { MODE_TOOL_GROUPS, TOOL_METADATA, TOOL_REGISTRY_NAMES } = require("../../agent/tools/config/tool-metadata.js");

// Tool port shared by the controller and the canonical tool registry. It defines the mode tool groups,
// the catalog builder, tool-call normalization, validation, and mutation
// classification, all against the new tool names (read_file, search_workspace,
// apply_patch, ...) rather than the deleted legacy surface.

// Canonical tool registry entries used by the port. In production the DI
// container constructs the real registry; this module provides a static,
// provider-schema-compatible catalog so the controller works without wiring.
const REGISTRY_TOOL_NAMES = TOOL_REGISTRY_NAMES;

const MUTATING_TOOL_NAMES = new Set([
  "exec_command",
  "apply_patch",
  "update_project_artifacts",
  "manage_state",
  "manage_identity",
  "attack_graph",
]);

const READ_ONLY_TOOL_NAMES = new Set([
  "ask_questions",
  "update_task_list",
  "read_file",
  "search_workspace",
  "inspect_environment",
  "ingest_traffic",
  "replay_request",
  "run_test_case",
  "browser_action",
  "compare_responses",
  "verify_finding",
  "delegate_agent",
  "query_assessment",
  "expand_evidence",
  "query_knowledge",
  "web_research",
]);

const TOOL_META = TOOL_METADATA;

const LOADABLE_PACK_NAMES = Object.freeze([]);

const TOOL_GROUPS = Object.freeze({
  cyber: Object.freeze({
    isSecurityCommand: () => false,
    ALL: Object.freeze([]),
  }),
});

// Provider-schema-compatible catalog (name, description, parameters). The
// controller exposes these to the model; the schema is the canonical
// inputSchema of each tool.
const STATIC_CATALOG = Object.freeze(
  REGISTRY_TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description: "",
      parameters: { type: "object", properties: {} },
    },
  })),
);

function toolsForProfile(profile, _registry = undefined, tools = []) {
  const key = profile?.key || profile?.mode || "agent";
  const group = MODE_TOOL_GROUPS[key] || MODE_TOOL_GROUPS.agent;
  const available = Array.isArray(tools) ? tools : [];
  if (!available.length) {
    return group.map((name) => ({
      type: "function",
      function: {
        name,
        description: TOOL_META[name]?.targetTypes?.join(", ") || "",
        parameters: { type: "object", properties: {} },
      },
    }));
  }
  return available.filter((tool) => {
    const name = String(tool?.function?.name || "");
    return group.includes(name) || name.startsWith("mcp__");
  });
}

function toolsForRoute(tools = []) {
  return Array.isArray(tools) ? tools : [];
}

function hotToolNamesForProfile(profile) {
  return toolsForProfile(profile).map((tool) => tool.function.name);
}

function compactTools(tools = []) {
  return Array.isArray(tools) ? tools : [];
}

function buildToolCatalog(profile, _registry = undefined, loadedSchemaNames = null) {
  const tools = toolsForProfile(profile);
  const names = loadedSchemaNames instanceof Set ? loadedSchemaNames : null;
  return tools.filter((tool) => !names || names.has(tool.function.name));
}

// F-009: Canonical argument parsing shared with the harness. Never silently
// collapses parse errors to {}.
function parseArguments(raw) {
  return parseToolArguments(raw);
}

function normalizeToolCall(call) {
  if (!call || typeof call !== "object") return null;
  const name = call.function?.name || call.action || call.toolName;
  if (typeof name !== "string" || !name.trim()) return null;
  const parsed = parseArguments(call.function?.arguments);
  return {
    callId: call.id || call.callId,
    type: call.type || "function",
    toolName: name,
    action: name,
    args: parsed.ok ? parsed.value : (call.args || {}),
  };
}

function validateToolCall(call) {
  if (!call || typeof call !== "object") {
    return { ok: false, error: "Tool call must be an object.", code: "INVALID_TOOL_CALL", retryable: false };
  }
  const name = call.function?.name || call.action || call.toolName;
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Tool call must include a tool name.", code: "INVALID_TOOL_CALL", retryable: false };
  }
  if (!REGISTRY_TOOL_NAMES.includes(name)) {
    return { ok: false, error: `Tool '${name}' is not registered.`, code: "UNKNOWN_TOOL", retryable: false };
  }
  const parsed = parseArguments(call.function?.arguments);
  return { ok: true, value: { toolName: name, args: parsed.ok ? parsed.value : (call.args || {}) } };
}

function targetForTool(tool = {}) {
  return tool.file || tool.query || tool.command || tool.processId || "workspace";
}

function isMutating(toolName) {
  return MUTATING_TOOL_NAMES.has(toolName);
}

function clampWaitMs(raw, fallback = 60000) {
  if (raw === 0 || raw === "0") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  return Math.max(1000, Math.min(Math.round(value), 24 * 60 * 60 * 1000));
}

module.exports = {
  estimateTokenCount,
  deriveErrorClass,
  MODE_TOOL_GROUPS,
  TOOL_GROUPS,
  TOOL_META,
  LOADABLE_PACK_NAMES,
  REGISTRY_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  STATIC_CATALOG,
  toolsForProfile,
  toolsForRoute,
  hotToolNamesForProfile,
  compactTools,
  buildToolCatalog,
  normalizeToolCall,
  parseArguments,
  validateToolCall,
  targetForTool,
  isMutating,
  clampWaitMs,
  toOpenAITool,
};
