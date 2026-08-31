"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const EXPAND_EVIDENCE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    refs: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    ref: { type: "string", maxLength: 300 },
    level: { type: "string", enum: ["representative", "raw"] },
  },
  anyOf: [{ required: ["refs"] }, { required: ["ref"] }],
  additionalProperties: false,
});

function createExpandEvidenceTool({ intelligence = null, artifacts = null } = {}) {
  return {
    name: "expand_evidence",
    inputSchema: EXPAND_EVIDENCE_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, code: "INVALID_EXECUTION_CONTEXT", error: "expand_evidence requires a restricted tool context." };
      if (input.level === "raw") return { ok: false, code: "RAW_ARTIFACT_AUTH_REQUIRED", error: "Raw evidence expansion requires explicit privileged authorization." };
      const workspace = executionContext.workspace?.root || "";
      const refs = (Array.isArray(input.refs) ? input.refs : [input.ref]).filter(Boolean).map(String).slice(0, 10);
      const snapshot = artifacts?.inspect?.(workspace);
      if (snapshot?.ok) {
        const records = refs.map((ref) => snapshot.evidence.find((item) => item.id === ref)).filter(Boolean);
        if (records.length) return { ok: true, level: "representative", records, omitted: refs.length - records.length, source: "project-artifacts" };
      }
      if (intelligence?.expand) return intelligence.expand(workspace, refs, { level: "representative" });
      return { ok: false, code: "EVIDENCE_NOT_FOUND", error: "No matching canonical evidence was found." };
    },
  };
}

module.exports = { EXPAND_EVIDENCE_INPUT_SCHEMA, createExpandEvidenceTool };
