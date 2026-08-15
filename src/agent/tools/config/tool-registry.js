"use strict";

const { TOOL_METADATA } = require("./tool-metadata.js");

const REGISTRY_ERROR_CODES = Object.freeze({
  INVALID_ENTRY: "INVALID_TOOL_REGISTRATION",
  DUPLICATE_NAME: "DUPLICATE_TOOL_NAME",
  UNKNOWN_ADAPTER: "UNKNOWN_TOOL_ADAPTER",
  UNKNOWN_SCHEMA: "UNKNOWN_TOOL_SCHEMA",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createToolRegistry({ adapters = new Map(), schemas = new Set() } = {}) {
  const entries = new Map();

  function register(entry) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") {
      throw new TypeError(REGISTRY_ERROR_CODES.INVALID_ENTRY);
    }
    if (entries.has(entry.name)) throw new Error(REGISTRY_ERROR_CODES.DUPLICATE_NAME);
    if (adapters.size > 0 && !adapters.has(entry.name) && typeof entry.adapter !== "object") {
      throw new Error(REGISTRY_ERROR_CODES.UNKNOWN_ADAPTER);
    }
    if (schemas.size > 0 && entry.inputSchema !== undefined && !schemas.has(entry.inputSchema)) {
      throw new Error(REGISTRY_ERROR_CODES.UNKNOWN_SCHEMA);
    }
    const description = entry.description || (isRecord(entry.adapter) && typeof entry.adapter.description === "string" ? entry.adapter.description : "");
    const metadata = TOOL_METADATA[entry.name] || entry.metadata;
    entries.set(entry.name, Object.freeze({ ...entry, ...(metadata ? { metadata } : {}), description }));
    return entries.get(entry.name);
  }

  return Object.freeze({
    register,
    has(name) {
      return entries.has(name);
    },
    get(name) {
      return entries.get(name);
    },
    names() {
      return [...entries.keys()];
    },
    size() {
      return entries.size;
    },
    entries() {
      return [...entries.values()];
    },
  });
}

// F-007: Canonical provider serializer. The registry is the single source of
// truth for every tool's name, description, and schema; this converts a
// registry entry into an OpenRouter/OpenAI function-tool definition.
function toOpenAITool(entry) {
  return {
    type: "function",
    function: {
      name: entry.name,
      description: entry.description || "",
      parameters: entry.inputSchema,
    },
  };
}

function toOpenAITools(registry) {
  return registry.entries().map(toOpenAITool);
}

function registerExecCommand(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "exec_command",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["process", "workspace"],
      mutating: true,
      reversible: false,
    },
  });
}

function registerReadFile(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "read_file",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["file", "workspace"],
      mutating: false,
      reversible: true,
    },
  });
}

function registerSearchWorkspace(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "search_workspace",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["file", "workspace"],
      mutating: false,
      reversible: true,
    },
  });
}

function registerApplyPatch(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "apply_patch",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["file", "workspace"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerInspectEnvironment(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "inspect_environment",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["process", "environment", "workspace"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerManagePlan(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "manage_plan",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["workspace", "plan"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerManageState(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "manage_state",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["workspace", "state"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerIngestTraffic(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "ingest_traffic",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["traffic", "network"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerManageIdentity(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "manage_identity",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["identity", "session", "workspace"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerReplayRequest(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "replay_request",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["network", "request"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerRunTestCase(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "run_test_case",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["test", "verification"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerBrowserAction(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "browser_action",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["browser", "network"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerCompareResponses(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "compare_responses",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["response", "network"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerVerifyFinding(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "verify_finding",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["finding", "evidence"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerStoreFinding(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "store_finding",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["finding", "workspace"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerAttackGraph(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "attack_graph",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["graph", "workspace"],
      mutating: true,
      reversible: true,
    },
  });
}

function registerDelegateAgent(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "delegate_agent",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["delegated-resource", "agent"],
      mutating: false,
      reversible: false,
    },
  });
}

function registerQueryAssessment(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({ name: "query_assessment", adapter, inputSchema: adapter.inputSchema, metadata: { mutating: false, reversible: true, targetTypes: ["assessment", "evidence", "knowledge"] } });
}

function registerExpandEvidence(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({ name: "expand_evidence", adapter, inputSchema: adapter.inputSchema, metadata: { mutating: false, reversible: true, targetTypes: ["evidence", "artifact"] } });
}

function registerQueryKnowledge(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({ name: "query_knowledge", adapter, inputSchema: adapter.inputSchema, metadata: { mutating: false, reversible: true, targetTypes: ["knowledge", "methodology"] } });
}

function registerWebResearch(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "web_research",
    adapter,
    inputSchema: adapter.inputSchema,
    description: adapter.description,
    metadata: { mutating: false, reversible: false, targetTypes: ["research", "public-web"] },
  });
}

module.exports = {
  REGISTRY_ERROR_CODES,
  createToolRegistry,
  toOpenAITool,
  toOpenAITools,
  registerExecCommand,
  registerReadFile,
  registerSearchWorkspace,
  registerApplyPatch,
  registerInspectEnvironment,
  registerManagePlan,
  registerManageState,
  registerIngestTraffic,
  registerManageIdentity,
  registerReplayRequest,
  registerRunTestCase,
  registerBrowserAction,
  registerCompareResponses,
  registerVerifyFinding,
  registerStoreFinding,
  registerAttackGraph,
  registerDelegateAgent,
  registerQueryAssessment,
  registerExpandEvidence,
  registerQueryKnowledge,
  registerWebResearch,
};
