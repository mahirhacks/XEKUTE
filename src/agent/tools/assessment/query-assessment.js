"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");
const Artifacts = require("../../../domain/artifacts/investigation-artifacts.js");

const QUERY_ASSESSMENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    domain: { type: "string", enum: ["engagement", "hypotheses", "checklist", "evidence", "knowledge", "graph"] },
    operation: { type: "string", maxLength: 80 },
    query: { type: "string", maxLength: 4000 },
    id: { type: "string", maxLength: 300 },
    entityId: { type: "string", maxLength: 300 },
    from: { type: "string", maxLength: 300 },
    to: { type: "string", maxLength: 300 },
    maxHops: { type: "integer", minimum: 1, maximum: 8 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    phase: { type: "string", enum: [...Artifacts.CHECKLIST_PHASES] },
    target: { type: "string", maxLength: 500 },
  },
  additionalProperties: false,
});

function createQueryAssessmentTool({ intelligence = null, artifacts = null } = {}) {
  return {
    name: "query_assessment",
    inputSchema: QUERY_ASSESSMENT_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, code: "INVALID_EXECUTION_CONTEXT", error: "query_assessment requires a restricted tool context." };
      const workspace = executionContext.workspace?.root || "";
      const operation = String(input.operation || "search");
      const graphOperation = input.domain === "graph" || operation.startsWith("graph_");
      if (graphOperation && intelligence?.query) return intelligence.query(workspace, { ...input, operation: operation.replace(/^graph_/, ""), domain: "graph" });
      if (input.domain === "knowledge" && intelligence?.knowledge?.query) return intelligence.knowledge.query(input, { workspace, sessionId: executionContext.sessionId || "" });
      if (input.domain === "project" || input.domain === "investigation" || input.domain === "findings") {
        return { ok: false, code: "ARTIFACT_QUERY_DOMAIN_INVALID", error: `Unsupported investigation-state domain: ${input.domain}.` };
      }
      if (!artifacts?.query) return { ok: false, code: "PROJECT_ARTIFACTS_UNAVAILABLE", error: "Project artifacts are unavailable." };
      return artifacts.query(workspace, {
        domain: input.domain || "engagement",
        query: input.query || "",
        id: input.id || input.entityId || "",
        phase: input.phase || "",
        target: input.target || "",
        limit: input.limit || 20,
      });
    },
  };
}

module.exports = { QUERY_ASSESSMENT_INPUT_SCHEMA, createQueryAssessmentTool };
