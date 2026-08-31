"use strict";

// The canonical inventory is deliberately data-only. Adapters own execution;
// this module owns names, categories, mutation flags, and mode surfaces.
const TOOL_REGISTRY_NAMES = Object.freeze([
  "ask_questions",
  "update_task_list",
  "exec_command",
  "read_file",
  "search_workspace",
  "apply_patch",
  "inspect_environment",
  "update_project_artifacts",
  "manage_state",
  "ingest_traffic",
  "manage_identity",
  "replay_request",
  "run_test_case",
  "browser_action",
  "compare_responses",
  "verify_finding",
  "attack_graph",
  "delegate_agent",
  "query_assessment",
  "expand_evidence",
  "query_knowledge",
  "web_research",
]);

const TOOL_METADATA = Object.freeze({
  ask_questions: Object.freeze({ mutating: false, reversible: true, interactive: true, targetTypes: ["operator", "interaction"] }),
  update_task_list: Object.freeze({ mutating: false, reversible: true, targetTypes: ["runtime", "task-list"] }),
  exec_command: Object.freeze({ mutating: true, reversible: false, targetTypes: ["process", "workspace"] }),
  read_file: Object.freeze({ mutating: false, reversible: true, targetTypes: ["file", "workspace"] }),
  search_workspace: Object.freeze({ mutating: false, reversible: true, targetTypes: ["file", "workspace"] }),
  apply_patch: Object.freeze({ mutating: true, reversible: true, targetTypes: ["file", "workspace"] }),
  inspect_environment: Object.freeze({ mutating: false, reversible: false, targetTypes: ["process", "environment", "workspace"] }),
  update_project_artifacts: Object.freeze({ mutating: true, reversible: true, targetTypes: ["workspace", "project-artifacts"] }),
  manage_state: Object.freeze({ mutating: true, reversible: true, targetTypes: ["workspace", "state"] }),
  ingest_traffic: Object.freeze({ mutating: false, reversible: false, targetTypes: ["traffic", "network"] }),
  manage_identity: Object.freeze({ mutating: true, reversible: true, targetTypes: ["identity", "session", "workspace"] }),
  replay_request: Object.freeze({ mutating: false, reversible: false, targetTypes: ["network", "request"] }),
  run_test_case: Object.freeze({ mutating: false, reversible: false, targetTypes: ["test", "verification"] }),
  browser_action: Object.freeze({ mutating: false, reversible: false, targetTypes: ["browser", "network"] }),
  compare_responses: Object.freeze({ mutating: false, reversible: false, targetTypes: ["response", "network"] }),
  verify_finding: Object.freeze({ mutating: false, reversible: false, targetTypes: ["finding", "evidence"] }),
  attack_graph: Object.freeze({ mutating: true, reversible: true, targetTypes: ["graph", "workspace"] }),
  delegate_agent: Object.freeze({ mutating: false, reversible: false, targetTypes: ["delegated-resource", "agent"] }),
  query_assessment: Object.freeze({ mutating: false, reversible: true, targetTypes: ["assessment", "evidence", "knowledge"] }),
  expand_evidence: Object.freeze({ mutating: false, reversible: true, targetTypes: ["evidence", "artifact"] }),
  query_knowledge: Object.freeze({ mutating: false, reversible: true, targetTypes: ["knowledge", "methodology"] }),
  web_research: Object.freeze({ mutating: false, reversible: false, targetTypes: ["research", "public-web"] }),
});

const ALL_MODE_TOOLS = Object.freeze([...TOOL_REGISTRY_NAMES]);
const SAFE_READ_TOOLS = Object.freeze(["ask_questions", "read_file", "search_workspace", "inspect_environment", "query_assessment", "expand_evidence", "query_knowledge"]);
const MODE_TOOL_GROUPS = Object.freeze({
  ask: SAFE_READ_TOOLS,
  hypothesis: Object.freeze([...SAFE_READ_TOOLS, "update_project_artifacts"]),
  plan: Object.freeze([...SAFE_READ_TOOLS, "update_project_artifacts"]),
  agent: ALL_MODE_TOOLS,
});

module.exports = { MODE_TOOL_GROUPS, SAFE_READ_TOOLS, TOOL_METADATA, TOOL_REGISTRY_NAMES };
