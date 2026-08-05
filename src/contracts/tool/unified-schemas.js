"use strict";

const { CATALOG_VERSION, PUBLIC_TOOL_NAMES } = require("./unified-catalog");

const string = (description = "") => ({ type: "string", ...(description ? { description } : {}) });
const boundedString = (maxLength, description = "") => ({ ...string(description), maxLength });
const enumValue = (values, description = "") => ({ type: "string", enum: values, ...(description ? { description } : {}) });
const boundedArray = (items, maxItems = 50) => ({ type: "array", items, maxItems });
const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const actionSchema = (actions, properties = {}, required = ["action"]) => object({ action: enumValue(actions), ...properties }, required);

const ID = boundedString(160);
const TARGET = boundedString(2048, "Canonical authorized target or workspace-relative target.");
const SCOPE_DECISION = ID;
const EVIDENCE_REFS = boundedArray(ID, 50);
const OPERATION_CONTEXT = object({
  scope_decision_id: SCOPE_DECISION,
  identity_id: ID,
  operation_id: ID,
}, []);

const UNIFIED_INPUT_SCHEMAS = Object.freeze({
  exec_command: actionSchema(["execute"], {
    command: boundedString(32768),
    cwd: boundedString(2048),
    timeout_ms: { type: "integer", minimum: 1000, maximum: 120000 },
    output_limit: { type: "integer", minimum: 100, maximum: 50000 },
    network: enumValue(["workspace", "development-disabled"]),
  }, ["action", "command"]),
  read_file: actionSchema(["read"], {
    path: boundedString(2048),
    max_bytes: { type: "integer", minimum: 1, maximum: 1000000 },
  }, ["action", "path"]),
  search_workspace: actionSchema(["search_text", "find_files", "list_directory", "inspect_workspace", "get_outline", "ensure_index"], {
    query: boundedString(1000),
    path: boundedString(2048),
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  apply_patch: actionSchema(["apply"], {
    path: boundedString(2048),
    patches: boundedArray(object({ search: boundedString(100000), replace: boundedString(100000) }, ["search", "replace"]), 20),
  }, ["action", "path", "patches"]),
  manage_plan: actionSchema(["get", "create", "update_step", "complete_step", "close"], {
    plan_id: ID,
    title: boundedString(300),
    step_id: ID,
    content: boundedString(50000),
    status: enumValue(["open", "completed", "closed"]),
  }),
  manage_state: actionSchema(["get", "query", "set", "append_event", "checkpoint"], {
    key: boundedString(300),
    value: { type: ["string", "number", "boolean", "object", "array", "null"] },
    event: object({ type: boundedString(120), data: object({}, []) }, ["type"]),
  }),
  check_scope: actionSchema(["evaluate", "issue_decision"], {
    assessment_id: ID,
    target: TARGET,
    operation_category: enumValue(["workspace", "ingest", "replay", "test_case", "browser", "finding", "graph", "delegation"]),
    intensity: enumValue(["read", "passive", "active", "exploit"]),
    authorization: { type: "boolean" },
    exclusions: boundedArray(string(), 100),
    testing_window: boundedString(200),
    operation_digest: ID,
  }),
  ingest_traffic: actionSchema(["har", "burp", "traffsucker", "raw_http", "proxy", "api_collection"], {
    assessment_id: ID,
    source: boundedString(200),
    content: boundedString(500000),
    artifact_id: ID,
    provenance: boundedString(500),
  }, ["action", "assessment_id"]),
  manage_identity: actionSchema(["list", "describe", "select", "refresh", "revoke", "status"], {
    assessment_id: ID,
    identity_id: ID,
    selection_scope: enumValue(["operation", "run", "assessment"]),
    expires_at: boundedString(80),
  }),
  replay_request: actionSchema(["execute"], {
    assessment_id: ID,
    request_id: ID,
    identity_id: ID,
    scope_decision_id: SCOPE_DECISION,
    timeout_ms: { type: "integer", minimum: 1000, maximum: 120000 },
    evidence_policy: enumValue(["none", "capture_redacted"]),
  }, ["action", "assessment_id", "request_id", "identity_id", "scope_decision_id"]),
  run_test_case: actionSchema(["start", "continue", "stop", "status", "execute"], {
    assessment_id: ID,
    executor: boundedString(160),
    category: enumValue(["recon", "authentication", "authorization", "injection", "workflow", "configuration", "custom"]),
    target: TARGET,
    identity_id: ID,
    scope_decision_id: SCOPE_DECISION,
    test_case_id: ID,
    arguments: object({}, []),
    rate_limit: { type: "number", minimum: 0.1, maximum: 100 },
    concurrency: { type: "integer", minimum: 1, maximum: 20 },
    cleanup: enumValue(["required", "best_effort", "none"]),
    evidence_policy: enumValue(["none", "capture_redacted"]),
    stop_conditions: boundedArray(string(), 30),
    managed_operation_id: ID,
    checkpoint_id: ID,
    monitor_ms: { type: "integer", minimum: 1000, maximum: 600000 },
    log_tail_lines: { type: "integer", minimum: 1, maximum: 500 },
  }, ["action", "assessment_id", "executor", "category", "target", "scope_decision_id", "test_case_id"]),
  browser_action: actionSchema(["navigate", "click", "fill", "submit", "observe", "screenshot", "inspect_storage", "evaluate_script", "replay_workflow"], {
    assessment_id: ID,
    target: TARGET,
    scope_decision_id: SCOPE_DECISION,
    selector: boundedString(500),
    value: boundedString(10000),
    url: boundedString(2048),
    workflow_id: ID,
  }, ["action", "assessment_id", "scope_decision_id"]),
  compare_responses: actionSchema(["compare", "fingerprint", "authorization_diff"], {
    baseline_id: ID,
    mutated_id: ID,
    evidence_refs: EVIDENCE_REFS,
    max_differences: { type: "integer", minimum: 1, maximum: 100 },
  }),
  verify_finding: actionSchema(["assess", "confirm", "negative_control", "retest", "status"], {
    finding_id: ID,
    evidence_refs: EVIDENCE_REFS,
    identity_id: ID,
    scope_decision_id: SCOPE_DECISION,
  }),
  store_finding: actionSchema(["create", "update", "deduplicate", "attach_evidence"], {
    finding_id: ID,
    title: boundedString(500),
    asset_id: ID,
    severity: enumValue(["informational", "low", "medium", "high", "critical"]),
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence_refs: EVIDENCE_REFS,
    remediation: boundedString(10000),
    provenance: boundedString(500),
  }),
  attack_graph: actionSchema(["query_nodes", "query_neighbors", "find_paths", "add_assertion", "promote_assertion", "attach_evidence"], {
    node_id: ID,
    from_node: ID,
    to_node: ID,
    assertion_id: ID,
    state: enumValue(["inferred", "observed", "verified", "disputed"]),
    evidence_refs: EVIDENCE_REFS,
  }),
  delegate_agent: actionSchema(["delegate"], {
    specialist: enumValue(["browser_mapping", "request_breaking", "logic_analysis", "penetration_testing", "network_analysis"]),
    task: boundedString(4000),
    scope_decision_id: SCOPE_DECISION,
    selected_context: boundedArray(ID, 100),
    max_depth: { type: "integer", minimum: 0, maximum: 3 },
    max_parallel: { type: "integer", minimum: 1, maximum: 4 },
    max_runtime_ms: { type: "integer", minimum: 1000, maximum: 600000 },
    expected_evidence: boundedArray(string(), 30),
  }, ["action", "specialist", "task", "scope_decision_id"]),
});

const RESULT_DATA_SCHEMAS = Object.freeze(Object.fromEntries(PUBLIC_TOOL_NAMES.map((name) => [
  name,
  object({
    message: boundedString(2000),
    items: boundedArray(object({}, []), 100),
    artifact_refs: boundedArray(ID, 50),
    ...((name === "read_file" || name === "search_workspace") ? { content: boundedString(50000), paths: boundedArray(string(), 100) } : {}),
    ...((name === "exec_command") ? { exit_code: { type: "integer" }, output_ref: ID } : {}),
    ...((name === "check_scope") ? { decision_id: ID, expires_at: boundedString(80) } : {}),
    ...((name === "browser_action") ? { capability: enumValue(["available", "unavailable"]), observation_ref: ID } : {}),
    ...((name === "compare_responses") ? { differences: boundedArray(object({}, []), 100), fingerprint: ID } : {}),
  }, []),
])));

function schemaForTool(name) {
  return UNIFIED_INPUT_SCHEMAS[name];
}

function resultDataSchemaForTool(name) {
  return RESULT_DATA_SCHEMAS[name];
}

function validateSchemaShape(schema, name = "schema") {
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false) {
    return { ok: false, code: "SCHEMA_NOT_CLOSED", error: `${name} must be a closed object schema` };
  }
  return { ok: true };
}

function validateValue(value, schema, name = "value") {
  if (!schema) return { ok: true };
  if (Array.isArray(schema.type)) {
    const allowedTypes = new Set(schema.type);
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (!allowedTypes.has(actual)) return { ok: false, code: "INVALID_INPUT", error: `${name} has an invalid type` };
    return { ok: true };
  }
  if (schema.enum && !schema.enum.includes(value)) return { ok: false, code: "INVALID_INPUT", error: `${name} is not an allowed value` };
  if (schema.type === "string" && typeof value !== "string") return { ok: false, code: "INVALID_INPUT", error: `${name} must be a string` };
  if (schema.type === "integer" && (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum)) return { ok: false, code: "INVALID_INPUT", error: `${name} must be a bounded integer` };
  if (schema.type === "number" && (typeof value !== "number" || value < schema.minimum || value > schema.maximum)) return { ok: false, code: "INVALID_INPUT", error: `${name} must be a bounded number` };
  if (schema.type === "boolean" && typeof value !== "boolean") return { ok: false, code: "INVALID_INPUT", error: `${name} must be a boolean` };
  if (schema.type === "string" && schema.maxLength != null && value.length > schema.maxLength) return { ok: false, code: "INVALID_INPUT", error: `${name} exceeds its length limit` };
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > schema.maxItems) return { ok: false, code: "INVALID_INPUT", error: `${name} exceeds its item limit` };
    for (let index = 0; index < value.length; index += 1) {
      const result = validateValue(value[index], schema.items, `${name}[${index}]`);
      if (!result.ok) return result;
    }
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "INVALID_INPUT", error: `${name} must be an object` };
    for (const required of schema.required || []) if (value[required] === undefined) return { ok: false, code: "INVALID_INPUT", error: `${name}.${required} is required` };
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) return { ok: false, code: "INVALID_INPUT", error: `${name}.${key} is not allowed` };
    }
    for (const [key, child] of Object.entries(value)) {
      const result = validateValue(child, schema.properties?.[key], `${name}.${key}`);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}

for (const name of PUBLIC_TOOL_NAMES) {
  if (!UNIFIED_INPUT_SCHEMAS[name]) throw new Error(`Missing unified input schema: ${name}`);
  const inputCheck = validateSchemaShape(UNIFIED_INPUT_SCHEMAS[name], name);
  const resultCheck = validateSchemaShape(RESULT_DATA_SCHEMAS[name], `${name}.result`);
  if (!inputCheck.ok || !resultCheck.ok) throw new Error(inputCheck.error || resultCheck.error);
}

module.exports = {
  CATALOG_VERSION,
  UNIFIED_INPUT_SCHEMAS,
  RESULT_DATA_SCHEMAS,
  schemaForTool,
  resultDataSchemaForTool,
  validateSchemaShape,
  validateValue,
};
