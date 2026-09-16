"use strict";

// The canonical inventory is deliberately data-only. Adapters own execution;
// this module owns names, categories, mutation flags, and mode surfaces.
const TOOL_REGISTRY_NAMES = Object.freeze([
  "ask_questions",
  "exec_command",
  "view_active_terminal",
  "read_file",
  "search_workspace",
  "apply_patch",
  "manage_identity",
  "replay_request",
  "browser_action",
  "delegate_agent",
  "web_research",
]);

const TOOL_METADATA = Object.freeze({
  ask_questions: Object.freeze({ mutating: false, reversible: true, interactive: true, targetTypes: ["operator", "interaction"] }),
  exec_command: Object.freeze({ mutating: true, reversible: false, targetTypes: ["process", "workspace"] }),
  view_active_terminal: Object.freeze({ mutating: false, reversible: true, targetTypes: ["process", "workspace"] }),
  read_file: Object.freeze({ mutating: false, reversible: true, targetTypes: ["file", "workspace"] }),
  search_workspace: Object.freeze({ mutating: false, reversible: true, targetTypes: ["file", "workspace"] }),
  apply_patch: Object.freeze({ mutating: true, reversible: true, targetTypes: ["file", "workspace"] }),
  manage_identity: Object.freeze({ mutating: true, reversible: true, targetTypes: ["identity", "session", "workspace"] }),
  replay_request: Object.freeze({ mutating: false, reversible: false, targetTypes: ["network", "request"] }),
  browser_action: Object.freeze({ mutating: false, reversible: false, targetTypes: ["browser", "network"] }),
  delegate_agent: Object.freeze({ mutating: false, reversible: false, targetTypes: ["delegated-resource", "agent"] }),
  web_research: Object.freeze({ mutating: false, reversible: false, targetTypes: ["research", "public-web"] }),
});

const ALL_MODE_TOOLS = Object.freeze([...TOOL_REGISTRY_NAMES]);
const SAFE_READ_TOOLS = Object.freeze(["ask_questions", "read_file", "search_workspace", "view_active_terminal"]);
const MODE_TOOL_GROUPS = Object.freeze({
  ask: SAFE_READ_TOOLS,
  agent: ALL_MODE_TOOLS,
});

module.exports = { MODE_TOOL_GROUPS, SAFE_READ_TOOLS, TOOL_METADATA, TOOL_REGISTRY_NAMES };
