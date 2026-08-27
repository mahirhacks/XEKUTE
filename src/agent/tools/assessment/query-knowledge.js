"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const QUERY_KNOWLEDGE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    skill: { type: "string", maxLength: 160, description: "Exact extensionless Markdown skill filename, such as passive_recon." },
    phase: { type: "string", maxLength: 120, description: "Assessment phase, such as recon, enumeration, or verification." },
    query: { type: "string", maxLength: 4_000, description: "Narrow methodology or technique query." },
    limit: { type: "integer", minimum: 1, maximum: 30 },
    offset: { type: "integer", minimum: 0, maximum: 100000 },
  },
  anyOf: [
    { required: ["skill"] },
    { required: ["phase"] },
    { required: ["query"] },
  ],
  additionalProperties: false,
});

function createQueryKnowledgeTool({ knowledge, memoryRetrieval = null, projectIdentityStore = null, memoryFeatureFlags = {} } = {}) {
  return {
    name: "query_knowledge",
    inputSchema: QUERY_KNOWLEDGE_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, error: "query_knowledge requires a restricted tool context.", code: "INVALID_EXECUTION_CONTEXT" };
      const workspace = executionContext.workspace?.root || "";
      if (!workspace || (!knowledge?.query && memoryFeatureFlags?.knowledgeRetrievalV2 !== true)) return { ok: false, error: "Assessment knowledge is unavailable.", code: "KNOWLEDGE_UNAVAILABLE" };
      if (memoryFeatureFlags?.knowledgeRetrievalV2 === true && memoryRetrieval?.query && projectIdentityStore?.resolveProject) {
        const resolved = projectIdentityStore.resolveProject(workspace, { persist: false });
        if (!resolved?.ok) return resolved;
        if (!resolved.projectId) return { ok: false, error: "Project Memory is not initialized for this workspace.", code: "MEMORY_PROJECT_UNINITIALIZED", retryable: false };
        return memoryRetrieval.query({
          workspace,
          projectId: resolved.projectId,
          objective: String(input.query || input.skill || input.phase || "knowledge").slice(0, 2_000),
          domains: ["knowledge"],
          filters: { skill: String(input.skill || "").slice(0, 160), phase: String(input.phase || "").slice(0, 120), query: String(input.query || "").slice(0, 500) },
          limit: Math.max(1, Math.min(Number(input.limit) || 10, 50)),
          tokenBudget: 16_000,
          sensitivityCeiling: "confidential",
          includeProvenance: true,
        });
      }
      const result = await knowledge.query({
        skill: String(input.skill || "").slice(0, 160),
        phase: String(input.phase || "").slice(0, 120),
        query: String(input.query || "").slice(0, 4_000),
        limit: Math.max(1, Math.min(Number(input.limit) || 10, 30)),
        offset: Math.max(0, Math.min(Number(input.offset) || 0, 100_000)),
      }, {
        workspace,
        sessionId: executionContext.sessionId || executionContext.requestMetadata?.sessionId || "",
        mode: executionContext.mode || executionContext.requestMetadata?.mode || "agent",
      });
      return result;
    },
  };
}

module.exports = { QUERY_KNOWLEDGE_INPUT_SCHEMA, createQueryKnowledgeTool };
