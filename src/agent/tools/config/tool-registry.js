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

function registerViewActiveTerminal(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "view_active_terminal",
    adapter,
    inputSchema: adapter.inputSchema,
    description: adapter.description,
    metadata: {
      targetTypes: ["process", "workspace"],
      mutating: false,
      reversible: true,
    },
  });
}

function registerAskQuestions(toolRegistry, adapter) {
  if (!toolRegistry || typeof toolRegistry.register !== "function") throw new TypeError("toolRegistry must support register");
  return toolRegistry.register({
    name: "ask_questions",
    adapter,
    inputSchema: adapter.inputSchema,
    metadata: {
      targetTypes: ["operator", "interaction"],
      mutating: false,
      reversible: true,
      interactive: true,
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
  registerAskQuestions,
  registerExecCommand,
  registerViewActiveTerminal,
  registerReadFile,
  registerSearchWorkspace,
  registerApplyPatch,
  registerManageIdentity,
  registerReplayRequest,
  registerBrowserAction,
  registerDelegateAgent,
  registerWebResearch,
};
