"use strict";

const { assert, validate } = require("../memory/memory-errors.js");
const { assertMemoryId } = require("../memory/memory-identity.js");

const MEMORY_IPC_SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_QUERY_TOKENS = 200_000;
const MAX_COMMANDS = 50;
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_WORKSPACE_LENGTH = 32_768;
const MAX_CURSOR_LENGTH = 1_000;
const MAX_TEXT_LENGTH = 4_000;

const MEMORY_IPC_CHANNELS = Object.freeze([
  "memory:status",
  "memory:diagnostics",
  "memory:projectQuery",
  "memory:investigationQuery",
  "memory:evidenceQuery",
  "memory:graphQuery",
  "memory:artifactList",
  "memory:artifactExpand",
  "memory:checkpoint",
  "memory:checkpointView",
  "memory:finalizationHealth",
  "memory:finalizationStatus",
  "memory:migrationPreview",
  "memory:operatorMutation",
  "memory:securityAudit",
  "memory:maintenanceStatus",
  "memory:maintenanceBenchmark",
]);

const QUERY_OPERATIONS = Object.freeze({
  project: Object.freeze(["overview", "entity", "neighbors", "claims", "search", "conflicts", "changes", "provenance", "coverage_inputs"]),
  investigation: Object.freeze(["overview", "investigation", "details", "programmes", "programme", "investigations", "applicability", "test_cases", "testcases", "assignments", "attempts", "negative_results", "candidates", "blockers", "coverage", "remaining_work", "changes", "records", "search", "provenance"]),
  evidence: Object.freeze(["overview", "finding", "details", "findings", "search", "verifications", "remediations", "retests", "changes", "report", "provenance"]),
});

const GRAPH_OPERATIONS = Object.freeze(["overview", "node", "search", "neighbors", "paths", "rebuild", "status"]);
const OPERATOR_MEMORY_TYPES = Object.freeze(["project", "investigation", "evidence"]);

function text(value, maximum = MAX_TEXT_LENGTH) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_IPC_FIELD_TOO_LARGE", "A memory IPC field exceeds its maximum length.", { maximum });
  return result;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function safeValue(value, depth = 0, key = "") {
  assert(depth <= 10, "MEMORY_IPC_PAYLOAD_TOO_DEEP", "A memory IPC payload is nested too deeply.");
  const lowerKey = String(key || "").toLowerCase();
  assert(!/(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|raw[_-]?value|ciphertext|credential)/i.test(lowerKey), "MEMORY_IPC_SECRET_FIELD", "Raw sensitive fields cannot cross the memory IPC boundary.", { field: key });
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return text(value, 8_000);
  if (Array.isArray(value)) {
    assert(value.length <= 200, "MEMORY_IPC_ARRAY_TOO_LARGE", "A memory IPC array exceeds its maximum item count.");
    return value.map((entry) => safeValue(entry, depth + 1));
  }
  assert(value && typeof value === "object", "MEMORY_IPC_VALUE_INVALID", "Memory IPC payloads must contain JSON-compatible values.");
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) result[text(childKey, 120)] = safeValue(childValue, depth + 1, childKey);
  assert(Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_COMMAND_BYTES, "MEMORY_IPC_COMMAND_TOO_LARGE", "A memory IPC command exceeds its maximum size.");
  return result;
}

function workspaceOf(input) {
  const workspace = text(input?.workspace || input?.projectPath || "", MAX_WORKSPACE_LENGTH);
  assert(workspace.length > 0, "MEMORY_IPC_WORKSPACE_REQUIRED", "A workspace is required for a memory IPC request.");
  return workspace;
}

function optionalProjectId(input) {
  const value = text(input?.project_id || input?.projectId || "", 240);
  return value ? assertMemoryId(value, "proj") : "";
}

function sessionIdOf(input, required = false) {
  const value = text(input?.session_id || input?.sessionId || "", 240);
  assert(!required || value.length > 0, "MEMORY_IPC_SESSION_REQUIRED", "A session ID is required for this memory IPC request.");
  return value;
}

function limitOf(value) {
  const limit = value == null ? DEFAULT_LIMIT : Number(value);
  assert(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT, "MEMORY_IPC_LIMIT_INVALID", `Memory IPC limit must be between 1 and ${MAX_LIMIT}.`);
  return limit;
}

function graphDepthOf(value) {
  const depth = value == null ? 1 : Number(value);
  assert(Number.isInteger(depth) && depth >= 0 && depth <= 3, "MEMORY_IPC_GRAPH_DEPTH_INVALID", "Memory graph depth must be between 0 and 3.");
  return depth;
}

function common(input, { requireProject = false, requireSession = false } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_IPC_REQUEST_INVALID", "A memory IPC request must be an object.");
  const workspace = workspaceOf(input);
  const projectId = optionalProjectId(input);
  assert(!requireProject || projectId.length > 0, "MEMORY_IPC_PROJECT_REQUIRED", "A project ID is required for this memory IPC request.");
  return {
    schema_version: MEMORY_IPC_SCHEMA_VERSION,
    workspace,
    project_id: projectId,
    session_id: sessionIdOf(input, requireSession),
  };
}

function query(input, memoryType) {
  const result = common(input);
  const requestedOperation = text(input.operation || input.kind || "overview", 80).toLowerCase();
  assert(QUERY_OPERATIONS[memoryType].includes(requestedOperation), "MEMORY_IPC_QUERY_OPERATION_INVALID", `Unsupported ${memoryType} Memory query operation.`, { operation: requestedOperation });
  const filters = safeValue(input.filters && typeof input.filters === "object" ? input.filters : {});
  const sourceRevisions = safeValue(input.source_revisions || input.sourceRevisions || {});
  for (const value of Object.values(sourceRevisions)) assert(Number.isSafeInteger(Number(value)) && Number(value) >= 0, "MEMORY_IPC_REVISION_INVALID", "Source revisions must be non-negative integers.");
  return Object.freeze({
    ...result,
    operation: requestedOperation,
    record_id: text(input.record_id || input.recordId || input.entity_id || input.entityId || input.investigation_id || input.investigationId || input.finding_id || input.findingId || "", 240),
    query: text(input.query, 4_000),
    filters,
    source_revisions: sourceRevisions,
    limit: limitOf(input.limit),
    cursor: text(input.cursor || "", MAX_CURSOR_LENGTH),
    token_budget: input.token_budget == null && input.tokenBudget == null ? 16_000 : Number(input.token_budget ?? input.tokenBudget),
    include_provenance: input.include_provenance !== false && input.includeProvenance !== false,
  });
}

function graphQuery(input) {
  const result = common(input);
  const operation = text(input.operation || "search", 80).toLowerCase();
  assert(GRAPH_OPERATIONS.includes(operation), "MEMORY_IPC_GRAPH_OPERATION_INVALID", "The graph operation is unsupported.", { operation });
  const tokenBudget = input.token_budget == null && input.tokenBudget == null ? 16_000 : Number(input.token_budget ?? input.tokenBudget);
  assert(Number.isFinite(tokenBudget) && tokenBudget >= 0 && tokenBudget <= MAX_QUERY_TOKENS, "MEMORY_IPC_TOKEN_BUDGET_INVALID", "The graph token budget is outside the supported bound.");
  return Object.freeze({
    ...result,
    operation,
    node_id: text(input.node_id || input.nodeId || input.id || "", 300),
    from: text(input.from, 300),
    to: text(input.to, 300),
    query: text(input.query, 4_000),
    edge_types: [...new Set((Array.isArray(input.edge_types || input.edgeTypes) ? (input.edge_types || input.edgeTypes) : []).map((value) => text(value, 120)).filter(Boolean))].slice(0, 30),
    depth: graphDepthOf(input.depth ?? input.graph_depth ?? input.graphDepth),
    limit: limitOf(input.limit),
    cursor: text(input.cursor, MAX_CURSOR_LENGTH),
    token_budget: tokenBudget,
  });
}

function createMemoryIpcRequest(channel, input = {}) {
  const name = String(channel || "");
  if (name === "memory:status") {
    const result = common(input);
    return Object.freeze({ ...result, session_id: sessionIdOf(input), include_details: input.include_details !== false && input.includeDetails !== false });
  }
  if (name === "memory:diagnostics") {
    const result = common(input);
    return Object.freeze({ ...result, limit: limitOf(input.limit), cursor: text(input.cursor || "", MAX_CURSOR_LENGTH), verify: input.verify !== false });
  }
  if (name === "memory:projectQuery") return query(input, "project");
  if (name === "memory:investigationQuery") return query(input, "investigation");
  if (name === "memory:evidenceQuery") return query(input, "evidence");
  if (name === "memory:graphQuery") return graphQuery(input);
  if (name === "memory:artifactList") {
    const result = common(input);
    return Object.freeze({ ...result, kind: text(input.kind, 120), integrity_state: text(input.integrity_state || input.integrityState, 80), limit: limitOf(input.limit), cursor: text(input.cursor, MAX_CURSOR_LENGTH) });
  }
  if (name === "memory:artifactExpand") {
    const result = common(input, { requireProject: true });
    const artifactId = assertMemoryId(input.artifact_id || input.artifactId, "artifact");
    const maxBytes = input.max_bytes == null && input.maxBytes == null ? 256 * 1024 : Number(input.max_bytes ?? input.maxBytes);
    const maxChars = input.max_chars == null && input.maxChars == null ? 200_000 : Number(input.max_chars ?? input.maxChars);
    assert(Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= 256 * 1024, "MEMORY_IPC_ARTIFACT_LIMIT_INVALID", "Artifact byte expansion is outside the supported bound.");
    assert(Number.isInteger(maxChars) && maxChars >= 1 && maxChars <= 200_000, "MEMORY_IPC_ARTIFACT_LIMIT_INVALID", "Artifact character expansion is outside the supported bound.");
    assert(input.include_raw !== true && input.includeRaw !== true, "MEMORY_IPC_RAW_ARTIFACT_FORBIDDEN", "Raw artifact expansion is not available through renderer IPC.");
    return Object.freeze({ ...result, artifact_id: artifactId, max_bytes: maxBytes, max_chars: maxChars, include_raw: false });
  }
  if (name === "memory:checkpoint" || name === "memory:checkpointView") {
    const result = common(input, { requireProject: true, requireSession: true });
    return Object.freeze({ ...result, include_recent_tail: input.include_recent_tail !== false && input.includeRecentTail !== false });
  }
  if (name === "memory:finalizationHealth" || name === "memory:finalizationStatus") {
    const result = common(input, { requireProject: true });
    const waitMs = input.wait_ms == null && input.waitMs == null ? 0 : Number(input.wait_ms ?? input.waitMs);
    assert(Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 250, "MEMORY_IPC_WAIT_INVALID", "Finalization wait must be between 0 and 250 milliseconds.");
    return Object.freeze({ ...result, block_id: text(input.block_id || input.blockId, 240), wait_ms: waitMs });
  }
  if (name === "memory:migrationPreview") {
    const result = common(input);
    return Object.freeze({ ...result, sources: safeValue(input.sources && typeof input.sources === "object" ? input.sources : {}), refresh: Boolean(input.refresh) });
  }
  if (name === "memory:securityAudit") {
    const result = common(input);
    assert(input.values === undefined && input.records === undefined && input.value === undefined, "MEMORY_IPC_RUNTIME_VALUES_FORBIDDEN", "Runtime values cannot cross the renderer boundary for a security audit.");
    return Object.freeze({
      ...result,
      include_legacy_compatibility: Boolean(input.include_legacy_compatibility || input.includeLegacyCompatibility),
    });
  }
  if (name === "memory:maintenanceStatus") {
    return Object.freeze(common(input));
  }
  if (name === "memory:maintenanceBenchmark") {
    const result = common(input, { requireProject: true });
    const iterations = input.iterations == null ? 3 : Number(input.iterations);
    assert(Number.isInteger(iterations) && iterations >= 1 && iterations <= 20, "MEMORY_IPC_ITERATIONS_INVALID", "Maintenance benchmark iterations must be between 1 and 20.");
    return Object.freeze({ ...result, iterations });
  }
  if (name === "memory:operatorMutation") {
    const result = common(input, { requireProject: true });
    const memoryType = text(input.memory_type || input.memoryType, 40).toLowerCase();
    assert(OPERATOR_MEMORY_TYPES.includes(memoryType), "MEMORY_IPC_MUTATION_DOMAIN_INVALID", "Operator mutations may target only Project, Investigation, or Evidence Memory.", { memoryType });
    const commands = Array.isArray(input.commands) ? input.commands : [];
    assert(commands.length > 0 && commands.length <= MAX_COMMANDS, "MEMORY_IPC_MUTATION_REQUIRED", `Operator mutations must contain between 1 and ${MAX_COMMANDS} commands.`);
    const safeCommands = commands.map((command) => safeValue(command));
    const operationId = text(input.operation_id || input.operationId, 240);
    assert(operationId.length > 0, "MEMORY_IPC_OPERATION_REQUIRED", "Operator mutations require an operation ID.");
    const expectedRevision = Number(input.expected_revision ?? input.expectedRevision);
    assert(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, "MEMORY_IPC_REVISION_INVALID", "Operator mutations require a non-negative expected revision.");
    return Object.freeze({ ...result, memory_type: memoryType, commands: clone(safeCommands), operation_id: operationId, expected_revision: expectedRevision, reason: text(input.reason, 2_000) });
  }
  const error = new Error(`Unsupported memory IPC channel: ${name || "<empty>"}.`);
  error.code = "MEMORY_IPC_CHANNEL_INVALID";
  throw error;
}

module.exports = Object.freeze({
  MEMORY_IPC_SCHEMA_VERSION,
  MEMORY_IPC_CHANNELS,
  QUERY_OPERATIONS,
  GRAPH_OPERATIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createMemoryIpcRequest,
  validateMemoryIpcRequest: (channel, input) => validate(() => createMemoryIpcRequest(channel, input), input),
});
