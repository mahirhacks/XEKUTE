"use strict";

const { assert } = require("./memory-errors.js");
const { assertMemoryId } = require("./memory-identity.js");

const GRAPH_OPERATIONS = Object.freeze(["overview", "search", "node", "neighbors", "paths"]);
const DEFAULT_GRAPH_LIMIT = 50;
const MAX_GRAPH_LIMIT = 200;
const DEFAULT_GRAPH_DEPTH = 1;
const MAX_GRAPH_DEPTH = 3;

function text(value, maximum = 500) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }

function createGraphQueryRequest(input = {}) {
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const operation = text(input.operation || input.kind || "overview", 80).toLowerCase();
  assert(GRAPH_OPERATIONS.includes(operation), "MEMORY_GRAPH_OPERATION_INVALID", `Unsupported graph query operation: ${operation}.`, { operation });
  const limit = Math.min(MAX_GRAPH_LIMIT, Math.max(1, Number(input.limit) || DEFAULT_GRAPH_LIMIT));
  const depthValue = input.depth ?? input.max_depth ?? input.maxDepth;
  const depth = Math.min(MAX_GRAPH_DEPTH, Math.max(0, Number.isInteger(Number(depthValue)) ? Number(depthValue) : DEFAULT_GRAPH_DEPTH));
  const nodeId = text(input.node_id || input.nodeId || input.id || "", 240);
  const from = text(input.from || input.source_id || input.sourceId || "", 240);
  const to = text(input.to || input.target_id || input.targetId || "", 240);
  if (operation === "node" || operation === "neighbors") assert(nodeId, "MEMORY_GRAPH_NODE_ID_REQUIRED", "This graph operation requires a node ID.");
  if (operation === "paths") assert(from && to, "MEMORY_GRAPH_PATH_ENDPOINTS_REQUIRED", "A graph path requires both endpoints.");
  return {
    project_id: projectId,
    operation,
    limit,
    depth,
    node_id: nodeId,
    from,
    to,
    query: text(input.query || input.search || "", 500),
    domain: text(input.domain || "", 80).toLowerCase(),
    record_type: text(input.record_type || input.recordType || "", 120),
    edge_type: text(input.edge_type || input.edgeType || "", 120),
    cursor: text(input.cursor || "", 2_000),
    directed: input.directed !== false,
  };
}

function validateGraphQueryRequest(input) {
  try { return { ok: true, request: createGraphQueryRequest(input) }; } catch (error) { return { ok: false, code: error.code || "MEMORY_GRAPH_QUERY_INVALID", error: error.message, details: error.details || {} }; }
}

module.exports = Object.freeze({ GRAPH_OPERATIONS, DEFAULT_GRAPH_LIMIT, MAX_GRAPH_LIMIT, DEFAULT_GRAPH_DEPTH, MAX_GRAPH_DEPTH, createGraphQueryRequest, validateGraphQueryRequest });
