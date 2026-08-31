"use strict";

// Tier 1 checkpoint and Tier 3 knowledge wire formats retain schema version
// 3. Project-owned semantic state is intentionally absent from this registry.
const V3_SCHEMA_VERSION = 3;
const ID = "^(?:proj|session|block|entity|claim|rel|attempt|finding|verification|artifact|procedure|checkpoint|kb|sel)_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$";
const SHA256 = "^[a-f0-9]{64}$";
const RELEASE_ID = "^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$";
const ISO = { type: "string", minLength: 1, maxLength: 80 };
const ID_SCHEMA = { type: "string", pattern: ID, maxLength: 240 };
const TYPED_ID = (prefix) => ({ type: "string", pattern: `^${prefix}_[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$`, maxLength: 240 });
const OPTIONAL_ID = { anyOf: [ID_SCHEMA, { type: "null" }] };
const SAFE_VALUE = { type: ["string", "number", "boolean", "null", "object", "array"] };
const SOURCE_REFS = { type: "array", items: ID_SCHEMA, maxItems: 500, uniqueItems: true };
const SENSITIVITY = { type: "string", enum: ["public", "internal", "confidential", "restricted"] };
const PROVENANCE = { type: "object", additionalProperties: false, required: ["source_type", "source_refs"], properties: { source_type: { type: "string", enum: ["tool_result", "runtime_event", "operator_assertion", "project_profile", "canonical_derivation", "artifact", "knowledge"] }, source_refs: SOURCE_REFS, captured_at: ISO, model: { type: "string", maxLength: 240 }, provider: { type: "string", maxLength: 120 }, redacted: { type: "boolean" } } };

function object(properties, required = [], extra = {}) { return { type: "object", additionalProperties: false, required: [...required], properties: { ...properties }, ...extra }; }
function versionedObject(properties, required = [], extra = {}) { const schema = object(properties, required, extra); schema.required = ["schema_version", ...required]; schema.properties = { schema_version: { const: V3_SCHEMA_VERSION }, ...schema.properties }; return schema; }

const CurrentWorkflowV3 = versionedObject({
  workflow_id: TYPED_ID("block"), project_id: TYPED_ID("proj"), session_id: TYPED_ID("session"),
  state: { type: "string", enum: ["idle", "active", "completed", "blocked", "cancelled", "failed"] },
  objective: { type: "string", maxLength: 8_000 },
  steps: { type: "array", maxItems: 500, items: object({ step_id: { type: "string", maxLength: 240 }, description: { type: "string", maxLength: 2_000 }, state: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "blocked", "cancelled"] }, tool_call_refs: SOURCE_REFS, result_refs: SOURCE_REFS }, ["step_id", "description", "state", "tool_call_refs", "result_refs"]) },
  continuation_point: { anyOf: [object({ step_id: { type: "string", maxLength: 240 }, next_action: { type: "string", maxLength: 2_000 }, required_refs: SOURCE_REFS, blockers: { type: "array", items: { type: "string", maxLength: 1_000 }, maxItems: 50 } }, ["step_id", "next_action", "required_refs", "blockers"]), { type: "null" }] },
  blockers: { type: "array", items: { type: "string", maxLength: 1_000 }, maxItems: 100 }, memory_refs: SOURCE_REFS,
  artifact_refs: { type: "array", items: TYPED_ID("artifact"), maxItems: 100 }, updated_at: ISO,
}, ["workflow_id", "project_id", "session_id", "state", "objective", "steps", "continuation_point", "blockers", "memory_refs", "artifact_refs", "updated_at"]);

const WorkingReferenceV3 = versionedObject({
  record_id: ID_SCHEMA, source_domain: { type: "string", enum: ["project", "investigation", "evidence", "knowledge", "graph"] }, source_revision: { type: "integer", minimum: 0 }, source_hash: { type: "string", pattern: SHA256 }, token_cost: { type: "integer", minimum: 0 }, expires_at: ISO, pin_owner: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] }, sensitivity: SENSITIVITY, provenance: PROVENANCE, content: { type: "object", additionalProperties: SAFE_VALUE, maxProperties: 100 },
}, ["record_id", "source_domain", "source_revision", "source_hash", "token_cost", "expires_at", "pin_owner", "sensitivity", "provenance", "content"]);

const ConversationCheckpointV3 = versionedObject({
  checkpoint_id: TYPED_ID("checkpoint"), project_id: TYPED_ID("proj"), session_id: TYPED_ID("session"), previous_checkpoint_id: OPTIONAL_ID,
  transcript_boundary: { type: "integer", minimum: 0 }, objective: { type: "string", maxLength: 8_000 },
  constraints: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 200 }, decisions: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 200 }, grounded_facts: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 300 }, significant_events: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 300 }, unverified_claims: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 200 }, unresolved_work: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 200 },
  workflow_continuity: CurrentWorkflowV3, protected_refs: SOURCE_REFS, source_block_refs: SOURCE_REFS, content_hash: { type: "string", pattern: SHA256 }, generated_by: { type: "string", enum: ["deterministic", "model"] }, created_at: ISO,
}, ["checkpoint_id", "project_id", "session_id", "previous_checkpoint_id", "transcript_boundary", "objective", "constraints", "decisions", "grounded_facts", "significant_events", "unverified_claims", "unresolved_work", "workflow_continuity", "protected_refs", "source_block_refs", "content_hash", "generated_by", "created_at"]);

const KagSelectionV3 = versionedObject({
  project_id: TYPED_ID("proj"), project_revision: { type: "integer", minimum: 0 },
  selections: { type: "array", maxItems: 5000, items: object({ procedure_id: TYPED_ID("procedure"), release_id: { type: "string", pattern: RELEASE_ID, maxLength: 240 }, release_hash: { type: "string", pattern: SHA256 }, procedure_hash: { type: "string", pattern: SHA256 }, selected: { type: "boolean" }, rank: { type: "integer", minimum: 0 }, reason: { type: "string", maxLength: 2_000 }, source_refs: { type: "array", items: TYPED_ID("kb"), maxItems: 500 }, prerequisite_state: { type: "string", enum: ["satisfied", "unknown", "blocked"] } }, ["procedure_id", "release_id", "release_hash", "procedure_hash", "selected", "rank", "reason", "source_refs", "prerequisite_state"]) }, solver_state: { type: "string", enum: ["ready", "degraded", "unavailable"] }, scoring_version: { type: "string", maxLength: 80 },
}, ["project_id", "project_revision", "selections", "solver_state", "scoring_version"]);

const KnowledgeProcedurePackageV3 = versionedObject({
  package_id: TYPED_ID("kb"), release_id: { type: "string", pattern: RELEASE_ID, minLength: 1, maxLength: 240 }, version: { type: "string", minLength: 1, maxLength: 80 }, publisher: { type: "string", maxLength: 240 }, license: { type: "string", maxLength: 240 }, source_refs: { type: "array", items: { type: "string", maxLength: 2_000 }, minItems: 1, maxItems: 500 }, file_hashes: { type: "object", additionalProperties: { type: "string", pattern: SHA256 }, maxProperties: 5_000 }, compatibility: { type: "object", additionalProperties: SAFE_VALUE, maxProperties: 100 },
  procedures: { type: "array", maxItems: 50_000, items: object({ procedure_id: TYPED_ID("procedure"), title: { type: "string", minLength: 1, maxLength: 500 }, objective: { type: "string", maxLength: 4_000 }, prerequisites: { type: "array", items: { type: "string", maxLength: 1_000 }, maxItems: 100 }, target_features: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 100 }, classifications: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 100 }, mandatory: { type: "boolean" }, baseline: { type: "boolean" }, required: { type: "boolean" }, steps: { type: "array", items: { type: "string", maxLength: 4_000 }, minItems: 1, maxItems: 200 }, expected_signals: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 100 }, rejecting_signals: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 100 }, stop_conditions: { type: "array", items: { type: "string", maxLength: 2_000 }, maxItems: 100 }, verification_rule_id: { type: "string", maxLength: 240 }, remediation: { type: "string", maxLength: 4_000 }, source_chunk_refs: { type: "array", items: TYPED_ID("kb"), minItems: 1, maxItems: 200 } }, ["procedure_id", "title", "objective", "prerequisites", "target_features", "steps", "expected_signals", "rejecting_signals", "stop_conditions", "verification_rule_id", "remediation", "source_chunk_refs"]) },
  chunks: { type: "array", maxItems: 100_000, items: object({ chunk_id: TYPED_ID("kb"), text: { type: "string", minLength: 1, maxLength: 20_000 }, source_ref: { type: "string", maxLength: 2_000 }, content_hash: { type: "string", pattern: SHA256 }, token_count: { type: "integer", minimum: 1, maximum: 384 } }, ["chunk_id", "text", "source_ref", "content_hash", "token_count"]) }, concepts: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 20_000 }, aliases: { type: "object", additionalProperties: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 100 }, maxProperties: 20_000 }, applicability: { type: "object", additionalProperties: SAFE_VALUE, maxProperties: 500 }, proof_rules: { type: "object", additionalProperties: { type: "object", additionalProperties: SAFE_VALUE, maxProperties: 100 }, maxProperties: 50_000 }, signature: { anyOf: [{ type: "string", maxLength: 4_000 }, { type: "null" }] }, content_hash: { type: "string", pattern: SHA256 },
}, ["package_id", "release_id", "version", "publisher", "license", "source_refs", "file_hashes", "compatibility", "procedures", "chunks", "concepts", "aliases", "applicability", "proof_rules", "signature"]);

const SCHEMAS = { CurrentWorkflowV3, WorkingReferenceV3, ConversationCheckpointV3, KagSelectionV3, KnowledgeProcedurePackageV3 };
for (const [name, schema] of Object.entries(SCHEMAS)) { schema.$id = `xekute://schemas/memory/${name}.json`; schema.title = name; }

module.exports = Object.freeze({ V3_SCHEMA_VERSION, ID, SHA256, SCHEMAS: Object.freeze(SCHEMAS) });
