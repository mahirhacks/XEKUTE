"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, isMemoryId } = require("../../../contracts/memory/index.js");
const { safeProjection } = require("../../storage/memory/derived-memory-index.js");

const MAP_PROJECTION_ADAPTER_VERSION = 1;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }

function createMapProjectionAdapter({ crypto = nodeCrypto } = {}) {
  function syntheticId(projectId, node) {
    const key = JSON.stringify({ projectId, type: node?.type || "node", host: node?.host || node?.hostname || "", route: node?.template || node?.route || node?.path || "", label: node?.label || node?.name || node?.url || "" });
    return `entity_${crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32)}`;
  }

  function normalize(workspace, projectId, input = {}) {
    let id;
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return { ok: false, code: error.code || "MEMORY_MAP_PROJECT_INVALID", error: error.message, retryable: false, details: error.details || {} }; }
    const graph = input && typeof input === "object" ? input : {};
    const sourceNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const nodeIds = new Map();
    const nodes = [];
    const warnings = [];
    for (const node of sourceNodes) {
      if (!node || typeof node !== "object") continue;
      const legacyId = String(node.id || node.node_id || node.nodeId || node.entity_id || node.entityId || "").trim();
      if (!legacyId) { warnings.push({ code: "MEMORY_MAP_NODE_ID_MISSING" }); continue; }
      const supplied = String(node.canonical_id || node.canonicalId || node.record_id || node.recordId || node.entity_id || node.entityId || "").trim();
      const canonicalId = isMemoryId(supplied) && supplied.startsWith("entity_") ? supplied : syntheticId(id, node);
      nodeIds.set(legacyId, canonicalId);
      const label = text(node.label || node.title || node.name || node.url || node.template || node.route || legacyId, 500);
      nodes.push({
        project_id: id,
        node_id: canonicalId,
        record_id: canonicalId,
        domain: "map",
        record_type: text(node.type || node.kind || "map_node", 120),
        lifecycle_state: "observed",
        source_revision: Number(node.source_revision || node.sourceRevision || 0) || 0,
        canonical_key: text(node.canonical_key || node.canonicalKey || node.key || "", 160),
        label,
        data: safeProjection({
          map_node_id: legacyId,
          type: node.type || node.kind || "map_node",
          host: node.host || node.hostname,
          route: node.route || node.template || node.path,
          method: node.method,
          observed: node.observed,
          confidence: node.confidence,
          priority: node.priorityScore ?? node.priority,
          traffic_source: node.trafficId || node.traffic_id || node.sourceRef || node.source_ref || "",
          map_path: text(workspace, 2_000),
        }) || {},
        provenance: { source_type: "artifact", source_refs: [text(node.sourceRef || node.source_ref || node.trafficId || node.traffic_id || "traffic-map", 240)], legacy_map_node_id: legacyId },
      });
    }
    const edges = [];
    for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
      if (!edge || typeof edge !== "object") continue;
      const sourceLegacy = String(edge.source || edge.source_id || edge.sourceId || edge.from || "").trim();
      const targetLegacy = String(edge.target || edge.target_id || edge.targetId || edge.to || "").trim();
      const source = nodeIds.get(sourceLegacy);
      const target = nodeIds.get(targetLegacy);
      if (!source || !target) {
        warnings.push({ code: "MEMORY_MAP_DANGLING_EDGE", sourceId: sourceLegacy, targetId: targetLegacy });
        continue;
      }
      edges.push({
        project_id: id,
        source_id: source,
        target_id: target,
        edge_type: text(edge.type || edge.edge_type || edge.edgeType || edge.relationship_type || "RELATED_TO", 120),
        source_domain: "map",
        target_domain: "map",
        source_revision: Number(edge.source_revision || edge.sourceRevision || 0) || 0,
        data: safeProjection({ map_edge_id: edge.id || "", confidence: edge.confidence, traffic_source: edge.trafficId || edge.traffic_id || edge.sourceRef || edge.source_ref || "" }) || {},
        provenance: { source_type: "artifact", source_refs: [text(edge.sourceRef || edge.source_ref || edge.trafficId || edge.traffic_id || "traffic-map", 240)] },
      });
    }
    return { ok: true, project_id: id, nodes, edges, warnings };
  }

  return Object.freeze({ MAP_PROJECTION_ADAPTER_VERSION, normalize });
}

module.exports = Object.freeze({ MAP_PROJECTION_ADAPTER_VERSION, createMapProjectionAdapter });
