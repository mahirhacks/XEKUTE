"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const QUERY_ASSESSMENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    domain: { type: "string", enum: ["engagement", "knowledge", "both"] },
    operation: { type: "string", enum: [
      "overview", "search", "entity", "relationships", "hypotheses", "knowledge",
      "graph_overview", "graph_search", "graph_node", "graph_neighbors", "graph_paths",
      "graph_workflow", "graph_state_model", "graph_identity_diff", "graph_variants", "graph_anomalies", "graph_evidence",
    ] },
    query: { type: "string", maxLength: 4000 },
    id: { type: "string", maxLength: 300 },
    entityId: { type: "string", maxLength: 300 },
    from: { type: "string", maxLength: 300 },
    to: { type: "string", maxLength: 300 },
    maxHops: { type: "integer", minimum: 1, maximum: 8 },
    minConfidence: { type: "number", minimum: 0, maximum: 1 },
    types: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
    edgeTypes: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
    evidenceIds: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    limit: { type: "integer", minimum: 1, maximum: 30 },
  },
});

const MEMORY_GRAPH_OPERATIONS = Object.freeze({
  graph_overview: "overview",
  graph_search: "search",
  graph_node: "node",
  graph_neighbors: "neighbors",
  graph_paths: "paths",
  graph_workflow: "search",
  graph_state_model: "search",
  graph_identity_diff: "search",
  graph_variants: "search",
  graph_anomalies: "search",
  graph_evidence: "search",
});

function memoryDomains(input = {}) {
  if (MEMORY_GRAPH_OPERATIONS[input.operation]) return ["graph"];
  if (input.domain === "knowledge" || input.operation === "knowledge") return ["knowledge"];
  if (input.domain === "both") return ["project", "investigation", "evidence", "knowledge"];
  return ["project", "investigation", "evidence"];
}

async function queryMemory({ memoryRetrieval, projectIdentityStore, memoryFeatureFlags, input, executionContext, workspace }) {
  if (memoryFeatureFlags?.knowledgeRetrievalV2 !== true || !memoryRetrieval?.query) return null;
  const resolved = projectIdentityStore?.resolveProject?.(workspace, { persist: false });
  if (!resolved?.ok) return resolved || { ok: false, error: "The protected project registry is unavailable.", code: "MEMORY_PROJECT_REGISTRY_UNAVAILABLE" };
  if (!resolved.projectId) return { ok: false, error: "Project Memory is not initialized for this workspace.", code: "MEMORY_PROJECT_UNINITIALIZED", retryable: false };
  const graphOperation = MEMORY_GRAPH_OPERATIONS[input.operation] || "";
  return memoryRetrieval.query({
    workspace,
    projectId: resolved.projectId,
    objective: String(input.query || input.operation || "assessment memory").slice(0, 2_000),
    domains: memoryDomains(input),
    filters: {
      ...(input.query ? { query: String(input.query).slice(0, 500) } : {}),
      ...(input.id || input.entityId ? { record_id: input.id || input.entityId } : {}),
      ...(graphOperation ? { operation: graphOperation, node_id: input.id || input.entityId || "", from: input.from || "", to: input.to || "" } : {}),
    },
    limit: Math.max(1, Math.min(Number(input.limit) || 20, 50)),
    tokenBudget: 16_000,
    sensitivityCeiling: "confidential",
    includeProvenance: true,
    graphDepth: Math.min(3, Math.max(0, Number(input.maxHops) || 1)),
  });
}

function createQueryAssessmentTool({ intelligence, memoryRetrieval = null, projectIdentityStore = null, memoryFeatureFlags = {} } = {}) {
  return {
    name: "query_assessment",
    inputSchema: QUERY_ASSESSMENT_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, error: "query_assessment requires a restricted tool context.", code: "INVALID_EXECUTION_CONTEXT" };
      const workspace = executionContext.workspace?.root || "";
      if (!workspace || (!intelligence && memoryFeatureFlags?.knowledgeRetrievalV2 !== true)) return { ok: false, error: "Assessment intelligence is unavailable.", code: "INTELLIGENCE_UNAVAILABLE" };
      const memoryResult = await queryMemory({ memoryRetrieval, projectIdentityStore, memoryFeatureFlags, input, executionContext, workspace });
      if (memoryResult) return memoryResult;
      if (!intelligence) return { ok: false, error: "Assessment intelligence is unavailable.", code: "INTELLIGENCE_UNAVAILABLE" };
      return intelligence.query(workspace, {
        domain: input.domain || "engagement",
        operation: input.operation || "search",
        query: String(input.query || "").slice(0, 4000),
        id: input.id || input.entityId || "",
        entityId: input.entityId || "",
        from: input.from || "",
        to: input.to || "",
        maxHops: input.maxHops,
        minConfidence: input.minConfidence,
        types: input.types,
        edgeTypes: input.edgeTypes,
        evidenceIds: input.evidenceIds,
        limit: Math.max(1, Math.min(Number(input.limit) || 20, 30)),
        sessionId: executionContext.sessionId || executionContext.requestMetadata?.sessionId || "",
        mode: executionContext.mode || executionContext.requestMetadata?.mode || "agent",
      });
    },
  };
}

module.exports = { QUERY_ASSESSMENT_INPUT_SCHEMA, createQueryAssessmentTool };
