"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const QUERY_KNOWLEDGE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    skill: { type: "string", maxLength: 160 },
    phase: { type: "string", maxLength: 120 },
    query: { type: "string", maxLength: 4000 },
    limit: { type: "integer", minimum: 1, maximum: 30 },
    offset: { type: "integer", minimum: 0, maximum: 100000 },
  },
  anyOf: [{ required: ["skill"] }, { required: ["phase"] }, { required: ["query"] }],
  additionalProperties: false,
});

function createQueryKnowledgeTool({ knowledge = null } = {}) {
  return {
    name: "query_knowledge",
    inputSchema: QUERY_KNOWLEDGE_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, code: "INVALID_EXECUTION_CONTEXT", error: "query_knowledge requires a restricted tool context." };
      if (!knowledge?.query) return { ok: false, code: "KNOWLEDGE_UNAVAILABLE", error: "Tier 3 knowledge is unavailable." };
      return knowledge.query({ workspace: executionContext.workspace?.root || "", query: String(input.query || "").slice(0, 4000), skill: String(input.skill || "").slice(0, 160), phase: String(input.phase || "").slice(0, 120), limit: Math.max(1, Math.min(Number(input.limit) || 10, 30)), offset: Math.max(0, Number(input.offset) || 0) });
    },
  };
}

module.exports = { QUERY_KNOWLEDGE_INPUT_SCHEMA, createQueryKnowledgeTool };
