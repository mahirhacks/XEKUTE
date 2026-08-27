"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const { createGraphQueryRequest } = require("../../../contracts/memory/graph-contracts.js");
const { redactSecrets, redactStructuredValue } = require("../../../shared/secret-redaction.js");
const {
  atomicWriteJson,
  clone,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");
const { safeProjection } = require("./derived-memory-index.js");

const MEMORY_GRAPH_SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_DEPTH = 1;
const MAX_DEPTH = 3;
const GRAPH_DOMAINS = Object.freeze(["project", "investigation", "evidence", "knowledge", "artifact"]);

function text(value, maximum = 2_000) {
  return redactSecrets(String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim()).slice(0, maximum);
}

function limitOf(value) { return Math.min(MAX_LIMIT, Math.max(1, Number(value) || DEFAULT_LIMIT)); }
function depthOf(value) { return Math.min(MAX_DEPTH, Math.max(0, Number.isInteger(Number(value)) ? Number(value) : DEFAULT_DEPTH)); }
function revisionOf(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0; }

function encodeCursor(value) { return Buffer.from(JSON.stringify(value || {}), "utf8").toString("base64url"); }
function decodeCursor(value) {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; }
}

function createMemoryGraphStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory graph store dependencies are required.");

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function graphFile(workspace) { return path.join(rootOf(workspace), ".xekute", "memory", "derived", "graph.json"); }

  function normalizeNode(input, projectId) {
    const source = input && typeof input === "object" ? input : {};
    const actual = String(source.project_id || source.projectId || projectId).trim();
    assertMemoryId(actual, "proj");
    if (actual !== projectId) throw Object.assign(new Error("The graph node belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId: actual } });
    const id = String(source.node_id || source.nodeId || source.record_id || source.recordId || source.id || "").trim().slice(0, 240);
    if (!id) throw Object.assign(new Error("Graph nodes require an opaque node ID."), { code: "MEMORY_GRAPH_NODE_ID_REQUIRED" });
    const domain = text(source.domain || source.layer || "project", 80).toLowerCase();
    if (!GRAPH_DOMAINS.includes(domain) && domain !== "map") throw Object.assign(new Error(`Unsupported graph node domain: ${domain}.`), { code: "MEMORY_GRAPH_DOMAIN_INVALID", details: { domain } });
    const dataValue = safeProjection(redactStructuredValue(source.data || source.record || {}));
    const provenanceValue = safeProjection(redactStructuredValue(source.provenance || {}));
    return {
      project_id: projectId,
      node_id: id,
      domain,
      record_id: String(source.record_id || source.recordId || id).trim().slice(0, 240),
      record_type: text(source.record_type || source.recordType || source.type || domain, 120),
      lifecycle_state: text(source.lifecycle_state || source.lifecycleState || source.state || source.status || "", 80),
      source_revision: revisionOf(source.source_revision ?? source.sourceRevision ?? source.revision),
      canonical_key: text(source.canonical_key || source.canonicalKey || source.canonical_key_hash || "", 160),
      label: text(source.label || source.title || source.name || id, 500),
      data: dataValue && typeof dataValue === "object" ? dataValue : {},
      provenance: provenanceValue && typeof provenanceValue === "object" ? provenanceValue : {},
    };
  }

  function normalizeEdge(input, projectId) {
    const source = input && typeof input === "object" ? input : {};
    const actual = String(source.project_id || source.projectId || projectId).trim();
    assertMemoryId(actual, "proj");
    if (actual !== projectId) throw Object.assign(new Error("The graph edge belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId: actual } });
    const from = String(source.source_id || source.sourceId || source.from || "").trim().slice(0, 240);
    const to = String(source.target_id || source.targetId || source.to || "").trim().slice(0, 240);
    const type = text(source.edge_type || source.edgeType || source.type || "", 120);
    if (!from || !to || !type) throw Object.assign(new Error("Graph edges require source, target, and type."), { code: "MEMORY_GRAPH_EDGE_INVALID" });
    return {
      project_id: projectId,
      source_id: from,
      target_id: to,
      edge_type: type,
      source_domain: text(source.source_domain || source.sourceDomain || "", 80),
      target_domain: text(source.target_domain || source.targetDomain || "", 80),
      source_revision: revisionOf(source.source_revision ?? source.sourceRevision ?? source.revision),
      data: safeProjection(redactStructuredValue(source.data || source.record || {})) || {},
      provenance: safeProjection(redactStructuredValue(source.provenance || {})) || {},
    };
  }

  function normalizeGraph(input, projectId) {
    assertMemoryId(projectId, "proj");
    const source = input && typeof input === "object" ? input : {};
    const actual = String(source.project_id || source.projectId || projectId).trim();
    assertMemoryId(actual, "proj");
    if (actual !== projectId) throw Object.assign(new Error("The graph belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId: actual } });
    const nodes = [...new Map((Array.isArray(source.nodes) ? source.nodes : []).map((node) => {
      const normalized = normalizeNode(node, projectId);
      return [normalized.node_id, normalized];
    })).values()].sort((left, right) => left.node_id.localeCompare(right.node_id));
    const nodeIds = new Set(nodes.map((node) => node.node_id));
    const warnings = Array.isArray(source.warnings) ? source.warnings.map((warning) => safeProjection(warning)).slice(0, 500) : [];
    const edges = [];
    for (const edge of Array.isArray(source.edges) ? source.edges : []) {
      try {
        const normalized = normalizeEdge(edge, projectId);
        if (!nodeIds.has(normalized.source_id) || !nodeIds.has(normalized.target_id)) {
          warnings.push({ code: "MEMORY_GRAPH_DANGLING_EDGE", sourceId: normalized.source_id, targetId: normalized.target_id, edgeType: normalized.edge_type });
          continue;
        }
        edges.push(normalized);
      } catch (error) {
        warnings.push({ code: error.code || "MEMORY_GRAPH_EDGE_INVALID", message: text(error.message, 500) });
      }
    }
    const uniqueEdges = [...new Map(edges.map((edge) => [`${edge.source_id}|${edge.target_id}|${edge.edge_type}`, edge])).values()].sort((left, right) => `${left.source_id}|${left.target_id}|${left.edge_type}`.localeCompare(`${right.source_id}|${right.target_id}|${right.edge_type}`));
    return {
      schema_version: MEMORY_GRAPH_SCHEMA_VERSION,
      kind: "xekute-memory-graph",
      project_id: projectId,
      projection_revision: revisionOf(source.projection_revision ?? source.projectionRevision ?? source.revision),
      source_revisions: source.source_revisions && typeof source.source_revisions === "object" ? safeProjection(source.source_revisions) : {},
      watermark: source.watermark && typeof source.watermark === "object" ? safeProjection(source.watermark) : null,
      content_hash: text(source.content_hash || source.contentHash || "", 128),
      created_at: text(source.created_at || source.createdAt || timestamp(now), 80),
      updated_at: text(source.updated_at || source.updatedAt || timestamp(now), 80),
      nodes,
      edges: uniqueEdges,
      warnings: warnings.slice(0, 500),
    };
  }

  function contentHash(graph) {
    return crypto.createHash("sha256").update(canonicalJson({ nodes: graph.nodes, edges: graph.edges, source_revisions: graph.source_revisions || {}, watermark: graph.watermark || null }), "utf8").digest("hex");
  }

  function read(workspace, projectId) {
    let root;
    try { root = rootOf(workspace); assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_INPUT_INVALID", error.message, error.details || {}); }
    const file = graphFile(root);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_GRAPH_CORRUPT", `The memory graph could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: false, exists: false, project_id: projectId, path: file, graph: emptyGraph(projectId) };
    try {
      const graph = normalizeGraph(loaded.value, projectId);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", project_id: projectId, path: file, graph };
    } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_INVALID", `The memory graph is invalid: ${error.message}.`, { path: file }, true); }
  }

  function emptyGraph(projectId) {
    const stamp = timestamp(now);
    return { schema_version: MEMORY_GRAPH_SCHEMA_VERSION, kind: "xekute-memory-graph", project_id: assertMemoryId(projectId, "proj"), projection_revision: 0, source_revisions: {}, watermark: null, content_hash: "", created_at: stamp, updated_at: stamp, nodes: [], edges: [], warnings: [] };
  }

  function replace(workspace, projectId, input = {}) {
    let graph;
    try { graph = normalizeGraph({ ...input, project_id: projectId }, projectId); } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_INVALID", error.message, error.details || {}); }
    graph.content_hash = contentHash(graph);
    const existing = read(workspace, projectId);
    if (!existing.ok) return existing;
    if (existing.graph.content_hash === graph.content_hash) return { ok: true, changed: false, project_id: projectId, projection_revision: existing.graph.projection_revision, content_hash: graph.content_hash, counts: { nodes: existing.graph.nodes.length, edges: existing.graph.edges.length }, warnings: existing.graph.warnings || [] };
    const previousRevision = revisionOf(existing.graph.projection_revision);
    graph.projection_revision = input.projection_revision == null && input.projectionRevision == null ? previousRevision + 1 : Math.max(previousRevision + 1, revisionOf(input.projection_revision ?? input.projectionRevision));
    graph.created_at = existing.graph.created_at || graph.created_at;
    graph.updated_at = timestamp(now);
    try {
      const saved = atomicWriteJson({ fs, path, crypto }, graphFile(workspace), graph, { validate: (serialized) => normalizeGraph(JSON.parse(serialized), projectId) });
      return { ok: true, changed: true, project_id: projectId, previous_revision: previousRevision, projection_revision: graph.projection_revision, content_hash: graph.content_hash, counts: { nodes: graph.nodes.length, edges: graph.edges.length }, path: saved.path, warnings: graph.warnings };
    } catch (error) { return operationFailure("MEMORY_GRAPH_WRITE_FAILED", `The memory graph could not be written: ${error.message}.`, { path: graphFile(workspace) }, true); }
  }

  function adjacency(graph, { edgeType = "", directed = false } = {}) {
    const result = new Map();
    for (const edge of graph.edges) {
      if (edgeType && edge.edge_type !== edgeType) continue;
      if (!result.has(edge.source_id)) result.set(edge.source_id, []);
      result.get(edge.source_id).push({ edge, nodeId: edge.target_id });
      if (!directed) {
        if (!result.has(edge.target_id)) result.set(edge.target_id, []);
        result.get(edge.target_id).push({ edge, nodeId: edge.source_id });
      }
    }
    for (const values of result.values()) values.sort((left, right) => left.nodeId.localeCompare(right.nodeId) || left.edge.edge_type.localeCompare(right.edge.edge_type));
    return result;
  }

  function baseResult(graph, projectId, warnings = []) {
    return { ok: true, project_id: projectId, sourceRevision: graph.projection_revision, projection_revision: graph.projection_revision, source_revisions: clone(graph.source_revisions || {}), watermark: clone(graph.watermark), warnings: [...(graph.warnings || []), ...warnings].slice(0, 500) };
  }

  function query(workspace, projectId, input = {}) {
    const loaded = read(workspace, projectId);
    if (!loaded.ok) return loaded;
    let request;
    try { request = createGraphQueryRequest({ ...input, project_id: projectId }); } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_QUERY_INVALID", error.message, error.details || {}); }
    const graph = loaded.graph;
    const operation = request.operation;
    const limit = request.limit;
    if (operation === "overview") return { ...baseResult(graph, projectId), overview: { node_count: graph.nodes.length, edge_count: graph.edges.length, by_domain: graph.nodes.reduce((out, node) => { out[node.domain] = (out[node.domain] || 0) + 1; return out; }, {}), by_type: graph.nodes.reduce((out, node) => { out[node.record_type] = (out[node.record_type] || 0) + 1; return out; }, {}) } };
    const byId = new Map(graph.nodes.map((node) => [node.node_id, node]));
    if (operation === "node") {
      const id = request.node_id;
      const node = byId.get(id);
      if (!node) return operationFailure("MEMORY_GRAPH_NODE_NOT_FOUND", "The graph node was not found.", { nodeId: id });
      return { ...baseResult(graph, projectId), node: clone(node), edges: graph.edges.filter((edge) => edge.source_id === id || edge.target_id === id).slice(0, limit).map(clone) };
    }
    if (operation === "search") {
      const term = request.query.toLowerCase();
      const domain = request.domain;
      const type = request.record_type;
      const cursor = decodeCursor(request.cursor);
      if (request.cursor && (!cursor || typeof cursor.node_id !== "string")) return operationFailure("MEMORY_GRAPH_CURSOR_INVALID", "The graph cursor is invalid.");
      const selected = graph.nodes.filter((node) => (!domain || node.domain === domain) && (!type || node.record_type === type) && (!term || JSON.stringify([node.label, node.domain, node.record_type, node.data]).toLowerCase().includes(term))).sort((left, right) => left.node_id.localeCompare(right.node_id)).filter((node) => !cursor || node.node_id > cursor.node_id);
      const page = selected.slice(0, limit).map(clone);
      return { ...baseResult(graph, projectId), nodes: page, total: selected.length, omitted: Math.max(0, selected.length - page.length), next_cursor: page.length === limit && selected.length > limit ? encodeCursor({ node_id: page.at(-1).node_id }) : null };
    }
    if (operation === "neighbors") {
      const center = request.node_id;
      if (!byId.has(center)) return operationFailure("MEMORY_GRAPH_NODE_NOT_FOUND", "The graph node was not found.", { nodeId: center });
      const depth = request.depth;
      const graphAdjacency = adjacency(graph, { edgeType: request.edge_type });
      const distances = new Map([[center, 0]]);
      const queue = [center];
      const selectedEdges = new Map();
      while (queue.length) {
        const current = queue.shift();
        if (distances.get(current) >= depth) continue;
        for (const item of graphAdjacency.get(current) || []) {
          const key = `${item.edge.source_id}|${item.edge.target_id}|${item.edge.edge_type}`;
          selectedEdges.set(key, item.edge);
          if (!distances.has(item.nodeId)) { distances.set(item.nodeId, distances.get(current) + 1); queue.push(item.nodeId); }
        }
      }
      const nodes = [...distances.keys()].map((id) => byId.get(id)).filter(Boolean).sort((left, right) => distances.get(left.node_id) - distances.get(right.node_id) || left.node_id.localeCompare(right.node_id));
      const page = nodes.slice(0, limit).map((node) => ({ ...clone(node), distance: distances.get(node.node_id) }));
      return { ...baseResult(graph, projectId), center_id: center, depth, nodes: page, edges: [...selectedEdges.values()].slice(0, limit * 4).map(clone), omitted: Math.max(0, nodes.length - page.length) };
    }
    if (operation === "paths") {
      const from = request.from;
      const to = request.to;
      if (!byId.has(from) || !byId.has(to)) return operationFailure("MEMORY_GRAPH_NODE_NOT_FOUND", "Both path endpoints must exist in the graph.", { from, to });
      const maxDepth = request.depth;
      const graphAdjacency = adjacency(graph, { edgeType: request.edge_type, directed: request.directed });
      const paths = [];
      const visit = (nodeId, nodePath, edgePath) => {
        if (paths.length >= limit || nodePath.length - 1 > maxDepth) return;
        if (nodeId === to) { paths.push({ nodes: nodePath.map((id) => clone(byId.get(id))), edges: edgePath.map(clone) }); return; }
        for (const item of graphAdjacency.get(nodeId) || []) {
          if (nodePath.includes(item.nodeId)) continue;
          visit(item.nodeId, [...nodePath, item.nodeId], [...edgePath, item.edge]);
        }
      };
      visit(from, [from], []);
      return { ...baseResult(graph, projectId), from, to, max_depth: maxDepth, paths, omitted: paths.length >= limit ? 1 : 0 };
    }
    return operationFailure("MEMORY_GRAPH_OPERATION_INVALID", `Unsupported graph query operation: ${operation}.`, { operation });
  }

  function deleteGraph(workspace, projectId) {
    const file = graphFile(workspace);
    try {
      assertMemoryId(projectId, "proj");
      const loaded = read(workspace, projectId);
      if (!loaded.ok) return loaded;
      if (!loaded.exists) return { ok: true, changed: false, path: file };
      for (const candidate of [file, `${file}.bak`]) fs.rmSync(candidate, { force: true });
      return { ok: true, changed: true, path: file };
    } catch (error) { return operationFailure(error.code || "MEMORY_GRAPH_DELETE_FAILED", error.message, { path: file }, true); }
  }

  return Object.freeze({ MEMORY_GRAPH_SCHEMA_VERSION, graphFile, emptyGraph, normalizeGraph, read, replace, query, delete: deleteGraph });
}

module.exports = Object.freeze({
  MEMORY_GRAPH_SCHEMA_VERSION,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_DEPTH,
  MAX_DEPTH,
  GRAPH_DOMAINS,
  createMemoryGraphStore,
});
