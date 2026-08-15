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

function createQueryAssessmentTool({ intelligence } = {}) {
  return {
    name: "query_assessment",
    inputSchema: QUERY_ASSESSMENT_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, error: "query_assessment requires a restricted tool context.", code: "INVALID_EXECUTION_CONTEXT" };
      const workspace = executionContext.workspace?.root || "";
      if (!workspace || !intelligence) return { ok: false, error: "Assessment intelligence is unavailable.", code: "INTELLIGENCE_UNAVAILABLE" };
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
