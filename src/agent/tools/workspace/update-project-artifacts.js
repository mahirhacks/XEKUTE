"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");
const Artifacts = require("../../../domain/artifacts/investigation-artifacts.js");

const UPDATE_PROJECT_ARTIFACTS_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    expected_revisions: {
      type: "object",
      properties: Object.fromEntries(Artifacts.REVISION_KEYS.map((key) => [key, { type: "string", pattern: "^[a-f0-9]{64}$" }])),
      required: [...Artifacts.REVISION_KEYS],
      additionalProperties: false,
    },
    operations: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "project.upsert", "project.correct",
              "hypothesis.create", "hypothesis.refine", "hypothesis.support", "hypothesis.reject", "hypothesis.inconclusive", "hypothesis.close", "hypothesis.execution",
              "checklist.create", "checklist.revise", "checklist.reorder", "checklist.close", "checklist.phase", "checklist.annotate", "checklist.execution",
              "evidence.create", "evidence.update",
            ],
          },
          document: { type: "string", enum: [...Artifacts.PROJECT_DOCUMENT_IDS], description: "Required for project.* operations. Writes project_info/{document}.md." },
          key: { type: "string", maxLength: 300, description: "Project fact name only, e.g. Project. Do not write Markdown bullets." },
          value: { type: "string", maxLength: 4000, description: "Project fact value. Xekute renders the Markdown." },
          source_refs: { type: "array", items: { type: "string" } },
          id: { type: "string" },
          client_ref: { type: "string", description: "Required on create operations. Transaction-local unique reference." },
          title: { type: "string" },
          status: { type: "string" },
          phase: { type: "string", enum: [...Artifacts.CHECKLIST_PHASES], description: "C-#### body-field phase." },
          evidence_refs: { type: "array", items: { type: "string" } },
          hypothesis_refs: { type: "array", items: { type: "string" } },
          target_refs: { type: "array", items: { type: "string" } },
          severity: { type: "string", enum: [...Artifacts.EVIDENCE_SEVERITIES] },
          confidence: { type: "string" },
          impact: { type: "string" },
          remediation: { type: "string" },
          retest_criteria: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    no_op_reason: { type: "string", maxLength: 1000 },
  },
  oneOf: [{ required: ["operations"] }, { required: ["no_op_reason"] }],
  required: ["expected_revisions"],
  additionalProperties: false,
});

function createUpdateProjectArtifactsTool({ artifacts } = {}) {
  if (!artifacts?.stage) throw new TypeError("Project artifact service is required.");
  return {
    name: "update_project_artifacts",
    description: "Stage typed updates to canonical .xekute Markdown. Write project_info/{document}.md via document+key+value (engagement|targets|identities|surface|controls). Do not apply_patch canonical investigation Markdown. Agent cannot project.remove. Ask is not a caller. Use no_op_reason when nothing durable changed.",
    inputSchema: UPDATE_PROJECT_ARTIFACTS_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return { ok: false, code: "INVALID_EXECUTION_CONTEXT", error: "update_project_artifacts requires a restricted tool context." };
      if (executionContext.parentInvocationId || executionContext.delegationContext?.nested) return { ok: false, code: "ARTIFACT_PARENT_ONLY", error: "Delegated child agents cannot stage canonical project artifacts." };
      const workspace = executionContext.workspace?.root || "";
      const mode = String(executionContext.mode || executionContext.requestMetadata?.mode || "agent").toLowerCase();
      return artifacts.stage(workspace, { mode, expected_revisions: input.expected_revisions || {}, operations: input.operations || [], no_op_reason: input.no_op_reason || "", trusted_provenance: executionContext.artifactProvenance || {} });
    },
  };
}

module.exports = { UPDATE_PROJECT_ARTIFACTS_INPUT_SCHEMA, createUpdateProjectArtifactsTool };
