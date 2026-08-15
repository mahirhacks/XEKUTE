"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const EXPAND_EVIDENCE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["refs"],
  properties: {
    refs: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    ref: { type: "string", maxLength: 300 },
    level: { type: "string", enum: ["representative", "raw"] },
  },
});

function createExpandEvidenceTool({ intelligence } = {}) {
  return {
    name: "expand_evidence",
    inputSchema: EXPAND_EVIDENCE_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, error: "expand_evidence requires a restricted tool context.", code: "INVALID_EXECUTION_CONTEXT" };
      const workspace = executionContext.workspace?.root || "";
      if (!workspace || !intelligence) return { ok: false, error: "Assessment intelligence is unavailable.", code: "INTELLIGENCE_UNAVAILABLE" };
      const refs = (Array.isArray(input.refs) ? input.refs : [input.ref]).filter(Boolean).slice(0, 10).map((ref) => String(ref).slice(0, 300));
      return intelligence.expand(workspace, { refs, level: input.level === "raw" ? "raw" : "representative" });
    },
  };
}

module.exports = { EXPAND_EVIDENCE_INPUT_SCHEMA, createExpandEvidenceTool };
