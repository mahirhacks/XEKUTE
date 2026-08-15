"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const ATTACK_GRAPH_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["operation"],
  properties: {
    operation: { type: "string", enum: ["create_node", "create_edge", "query", "update_node", "update_edge", "list", "delete"] },
    node: {
      type: "object",
      required: ["id", "type"],
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["identity", "request", "endpoint", "resource", "observation", "finding"] },
        label: { type: "string" },
        metadata: { type: "object" },
        evidenceRefs: { type: "array", items: { type: "string" } },
      },
    },
    edge: {
      type: "object",
      required: ["id", "from", "to", "relation"],
      properties: {
        id: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        relation: { type: "string" },
        metadata: { type: "object" },
        evidenceRefs: { type: "array", items: { type: "string" } },
      },
    },
    nodeId: { type: "string" },
    edgeId: { type: "string" },
    query: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["identity", "request", "endpoint", "resource", "observation", "finding"] },
        nodeId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        relation: { type: "string" },
      },
    },
  },
});

const ATTACK_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_ATTACK_GRAPH_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NOT_FOUND: "ATTACK_GRAPH_NOT_FOUND",
  ALREADY_EXISTS: "ATTACK_GRAPH_ALREADY_EXISTS",
  INVALID_EDGE: "ATTACK_GRAPH_INVALID_EDGE",
  WRITE_FAILED: "ATTACK_GRAPH_WRITE_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: ATTACK_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

const VALID_NODE_TYPES = new Set(["identity", "request", "endpoint", "resource", "observation", "finding"]);

function validateNode(node) {
  if (!isRecord(node)) return invalidInput("node must be an object");
  if (typeof node.id !== "string" || node.id.trim() === "") return invalidInput("node.id must be a non-empty string");
  if (!VALID_NODE_TYPES.has(node.type)) return invalidInput(`node.type must be one of ${[...VALID_NODE_TYPES].join(", ")}`);
  if (node.metadata !== undefined && !isRecord(node.metadata)) return invalidInput("node.metadata must be an object");
  if (node.evidenceRefs !== undefined && (!Array.isArray(node.evidenceRefs) || node.evidenceRefs.some(r => typeof r !== "string" || r.trim() === ""))) {
    return invalidInput("node.evidenceRefs must be an array of non-empty strings");
  }
  return { ok: true };
}

function validateEdge(edge) {
  if (!isRecord(edge)) return invalidInput("edge must be an object");
  if (typeof edge.id !== "string" || edge.id.trim() === "") return invalidInput("edge.id must be a non-empty string");
  if (typeof edge.from !== "string" || edge.from.trim() === "") return invalidInput("edge.from must be a non-empty string");
  if (typeof edge.to !== "string" || edge.to.trim() === "") return invalidInput("edge.to must be a non-empty string");
  if (typeof edge.relation !== "string" || edge.relation.trim() === "") return invalidInput("edge.relation must be a non-empty string");
  if (edge.metadata !== undefined && !isRecord(edge.metadata)) return invalidInput("edge.metadata must be an object");
  if (edge.evidenceRefs !== undefined && (!Array.isArray(edge.evidenceRefs) || edge.evidenceRefs.some(r => typeof r !== "string" || r.trim() === ""))) {
    return invalidInput("edge.evidenceRefs must be an array of non-empty strings");
  }
  return { ok: true };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["create_node", "create_edge", "query", "update_node", "update_edge", "list", "delete"].includes(input.operation)) {
    return invalidInput("operation must be create_node, create_edge, query, update_node, update_edge, list, or delete");
  }
  if (input.operation === "create_node") {
    return validateNode(input.node);
  }
  if (input.operation === "create_edge") {
    return validateEdge(input.edge);
  }
  if (input.operation === "update_node") {
    const n = input.node;
    if (!isRecord(n) || typeof n.id !== "string" || n.id.trim() === "") return invalidInput("update_node requires node.id");
    if (n.type !== undefined && !VALID_NODE_TYPES.has(n.type)) return invalidInput(`node.type must be one of ${[...VALID_NODE_TYPES].join(", ")}`);
    if (n.metadata !== undefined && !isRecord(n.metadata)) return invalidInput("node.metadata must be an object");
    if (n.evidenceRefs !== undefined && (!Array.isArray(n.evidenceRefs) || n.evidenceRefs.some(r => typeof r !== "string" || r.trim() === ""))) {
      return invalidInput("node.evidenceRefs must be an array of non-empty strings");
    }
    return { ok: true };
  }
  if (input.operation === "update_edge") {
    const e = input.edge;
    if (!isRecord(e) || typeof e.id !== "string" || e.id.trim() === "") return invalidInput("update_edge requires edge.id");
    if (e.relation !== undefined && (typeof e.relation !== "string" || e.relation.trim() === "")) return invalidInput("edge.relation must be a non-empty string");
    if (e.metadata !== undefined && !isRecord(e.metadata)) return invalidInput("edge.metadata must be an object");
    if (e.evidenceRefs !== undefined && (!Array.isArray(e.evidenceRefs) || e.evidenceRefs.some(r => typeof r !== "string" || r.trim() === ""))) {
      return invalidInput("edge.evidenceRefs must be an array of non-empty strings");
    }
    return { ok: true };
  }
  if (input.operation === "delete") {
    if (input.nodeId === undefined && input.edgeId === undefined) return invalidInput("delete requires nodeId or edgeId");
  }
  if (input.query !== undefined && !isRecord(input.query)) return invalidInput("query must be an object");
  return { ok: true };
}

function createAttackGraphTool({ fs = null, path = null } = {}) {
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");
  const nodes = new Map();
  const edges = new Map();

  function graphDir(root) {
    return realPath.join(root, ".xekute", "graph");
  }

  function nodesFile(root) {
    return realPath.join(graphDir(root), "nodes.json");
  }

  function edgesFile(root) {
    return realPath.join(graphDir(root), "edges.json");
  }

  function loadGraph(root) {
    if (nodes.size || edges.size) return;
    if (!root) return;
    try {
      const rawNodes = realFs.readFileSync(nodesFile(root), "utf8");
      const parsedNodes = JSON.parse(rawNodes);
      if (Array.isArray(parsedNodes)) for (const n of parsedNodes) nodes.set(n.id, n);
      const rawEdges = realFs.readFileSync(edgesFile(root), "utf8");
      const parsedEdges = JSON.parse(rawEdges);
      if (Array.isArray(parsedEdges)) for (const e of parsedEdges) edges.set(e.id, e);
    } catch {
      // Not persisted yet; start empty.
    }
  }

  function persistGraph(root) {
    if (!root) return;
    try {
      realFs.mkdirSync(graphDir(root), { recursive: true });
      realFs.writeFileSync(nodesFile(root), JSON.stringify([...nodes.values()], null, 2), "utf8");
      realFs.writeFileSync(edgesFile(root), JSON.stringify([...edges.values()], null, 2), "utf8");
    } catch (error) {
      throw error;
    }
  }

  function createNode(input, root) {
    const { node } = input;
    loadGraph(root);
    if (nodes.has(node.id)) return structuredFailure(ATTACK_ERROR_CODES.ALREADY_EXISTS, `node already exists: ${node.id}`, { id: node.id });
    const now = new Date().toISOString();
    const stored = {
      id: node.id,
      type: node.type,
      label: node.label || node.id,
      metadata: node.metadata || {},
      evidenceRefs: node.evidenceRefs || [],
      createdAt: now,
      updatedAt: now,
    };
    nodes.set(stored.id, stored);
    try {
      persistGraph(root);
    } catch (error) {
      nodes.delete(stored.id);
      return structuredFailure(ATTACK_ERROR_CODES.WRITE_FAILED, error.message);
    }
    return { ok: true, value: { operation: "create_node", node: stored } };
  }

  function createEdge(input, root) {
    const { edge } = input;
    loadGraph(root);
    if (edges.has(edge.id)) return structuredFailure(ATTACK_ERROR_CODES.ALREADY_EXISTS, `edge already exists: ${edge.id}`, { id: edge.id });
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      return structuredFailure(ATTACK_ERROR_CODES.INVALID_EDGE, "edge endpoints must reference existing nodes", { from: edge.from, to: edge.to });
    }
    const now = new Date().toISOString();
    const stored = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      metadata: edge.metadata || {},
      evidenceRefs: edge.evidenceRefs || [],
      createdAt: now,
      updatedAt: now,
    };
    edges.set(stored.id, stored);
    try {
      persistGraph(root);
    } catch (error) {
      edges.delete(stored.id);
      return structuredFailure(ATTACK_ERROR_CODES.WRITE_FAILED, error.message);
    }
    return { ok: true, value: { operation: "create_edge", edge: stored } };
  }

  function queryGraph(input, root) {
    loadGraph(root);
    const q = input.query || {};
    let matchedNodes = [...nodes.values()];
    if (q.type) matchedNodes = matchedNodes.filter(n => n.type === q.type);
    if (q.nodeId) matchedNodes = matchedNodes.filter(n => n.id === q.nodeId);

    let matchedEdges = [...edges.values()];
    if (q.from) matchedEdges = matchedEdges.filter(e => e.from === q.from);
    if (q.to) matchedEdges = matchedEdges.filter(e => e.to === q.to);
    if (q.relation) matchedEdges = matchedEdges.filter(e => e.relation === q.relation);

    return {
      ok: true,
      value: {
        operation: "query",
        nodes: matchedNodes.map(n => ({ id: n.id, type: n.type, label: n.label, evidenceRefs: n.evidenceRefs })),
        edges: matchedEdges.map(e => ({ id: e.id, from: e.from, to: e.to, relation: e.relation, evidenceRefs: e.evidenceRefs })),
        nodeCount: matchedNodes.length,
        edgeCount: matchedEdges.length,
      },
    };
  }

  function updateNode(input, root) {
    const { node } = input;
    loadGraph(root);
    const existing = nodes.get(node.id);
    if (!existing) return structuredFailure(ATTACK_ERROR_CODES.NOT_FOUND, `node not found: ${node.id}`, { id: node.id });
    const merged = {
      ...existing,
      ...(node.label !== undefined ? { label: node.label } : {}),
      ...(node.metadata !== undefined ? { metadata: node.metadata } : {}),
      ...(node.evidenceRefs !== undefined ? { evidenceRefs: [...node.evidenceRefs] } : {}),
      updatedAt: new Date().toISOString(),
    };
    nodes.set(node.id, merged);
    try {
      persistGraph(root);
    } catch (error) {
      nodes.set(node.id, existing);
      return structuredFailure(ATTACK_ERROR_CODES.WRITE_FAILED, error.message);
    }
    return { ok: true, value: { operation: "update_node", node: merged } };
  }

  function updateEdge(input, root) {
    const { edge } = input;
    loadGraph(root);
    const existing = edges.get(edge.id);
    if (!existing) return structuredFailure(ATTACK_ERROR_CODES.NOT_FOUND, `edge not found: ${edge.id}`, { id: edge.id });
    const merged = {
      ...existing,
      ...(edge.relation !== undefined ? { relation: edge.relation } : {}),
      ...(edge.metadata !== undefined ? { metadata: edge.metadata } : {}),
      ...(edge.evidenceRefs !== undefined ? { evidenceRefs: [...edge.evidenceRefs] } : {}),
      updatedAt: new Date().toISOString(),
    };
    edges.set(edge.id, merged);
    try {
      persistGraph(root);
    } catch (error) {
      edges.set(edge.id, existing);
      return structuredFailure(ATTACK_ERROR_CODES.WRITE_FAILED, error.message);
    }
    return { ok: true, value: { operation: "update_edge", edge: merged } };
  }

  function listGraph(root) {
    loadGraph(root);
    return {
      ok: true,
      value: {
        operation: "list",
        nodeCount: nodes.size,
        edgeCount: edges.size,
        nodes: [...nodes.values()].map(n => ({ id: n.id, type: n.type, label: n.label })),
        edges: [...edges.values()].map(e => ({ id: e.id, from: e.from, to: e.to, relation: e.relation })),
      },
    };
  }

  function deleteItem(input, root) {
    loadGraph(root);
    if (input.nodeId !== undefined) {
      if (!nodes.has(input.nodeId)) return structuredFailure(ATTACK_ERROR_CODES.NOT_FOUND, `node not found: ${input.nodeId}`, { id: input.nodeId });
      nodes.delete(input.nodeId);
      for (const [eid, e] of edges) {
        if (e.from === input.nodeId || e.to === input.nodeId) edges.delete(eid);
      }
    } else if (input.edgeId !== undefined) {
      if (!edges.has(input.edgeId)) return structuredFailure(ATTACK_ERROR_CODES.NOT_FOUND, `edge not found: ${input.edgeId}`, { id: input.edgeId });
      edges.delete(input.edgeId);
    }
    try {
      persistGraph(root);
    } catch (error) {
      return structuredFailure(ATTACK_ERROR_CODES.WRITE_FAILED, error.message);
    }
    return { ok: true, value: { operation: "delete", deletedNode: input.nodeId || null, deletedEdge: input.edgeId || null } };
  }

  const adapter = {
    name: "attack_graph",
    inputSchema: ATTACK_GRAPH_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(ATTACK_ERROR_CODES.INVALID_CONTEXT, "attack_graph requires a restricted tool execution context projection");
      }
      const root = executionContext.workspace?.root || null;

      switch (input.operation) {
        case "create_node": return createNode(input, root);
        case "create_edge": return createEdge(input, root);
        case "query": return queryGraph(input, root);
        case "update_node": return updateNode(input, root);
        case "update_edge": return updateEdge(input, root);
        case "list": return listGraph(root);
        case "delete": return deleteItem(input, root);
        default: return invalidInput(`unknown operation: ${input.operation}`);
      }
    },
  };

  return adapter;
}

module.exports = {
  ATTACK_GRAPH_INPUT_SCHEMA,
  ATTACK_ERROR_CODES,
  createAttackGraphTool,
  validateInput,
};