"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId } = require("./memory-identity.js");
const { assertSensitivity, SENSITIVITY_LEVELS } = require("./memory-lifecycle.js");

const CONTEXT_ASSEMBLY_SCHEMA_VERSION = 1;
const OBJECTIVE_KINDS = Object.freeze([
  "recon",
  "authentication",
  "authorization",
  "evidence_review",
  "reporting",
  "project_editing",
  "generic",
]);
const ASSEMBLY_STATES = Object.freeze(["current", "stale", "pending", "degraded", "unavailable"]);
const ASSEMBLY_DOMAINS = Object.freeze([
  "project",
  "investigation",
  "evidence",
  "knowledge",
  "graph",
  "artifact",
  "checkpoint",
  "recent_tail",
]);
const MAX_PACKET_TOKENS = 200_000;
const MAX_RECORDS_PER_SECTION = 200;

function text(value, maximum = 2_000) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_CONTEXT_FIELD_TOO_LARGE", "A Context Assembly field exceeds its maximum length.", { maximum });
  return result;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function nonNegative(value, field) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= 0, "MEMORY_CONTEXT_REVISION_INVALID", `${field} must be a non-negative integer.`, { field });
  return number;
}

function revisionMap(value, field = "source_revisions") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, revision] of Object.entries(source)) result[text(key, 100)] = nonNegative(revision, `${field}.${key}`);
  return result;
}

function createObjectiveClassification(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_CONTEXT_OBJECTIVE_INVALID", "Objective classification must be an object.");
  const kind = text(input.kind, 80).toLowerCase();
  assert(OBJECTIVE_KINDS.includes(kind), "MEMORY_CONTEXT_OBJECTIVE_KIND_INVALID", "Objective classification contains an unsupported kind.", { kind });
  const confidence = text(input.confidence || "deterministic", 40).toLowerCase();
  assert(["deterministic", "fallback"].includes(confidence), "MEMORY_CONTEXT_OBJECTIVE_CONFIDENCE_INVALID", "Objective classification confidence is invalid.", { confidence });
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : []).map((value) => text(value, 80).toLowerCase()).filter(Boolean))];
  assert(domains.length > 0, "MEMORY_CONTEXT_OBJECTIVE_DOMAINS_REQUIRED", "Objective classification must select at least one memory domain.");
  assert(domains.every((domain) => ASSEMBLY_DOMAINS.includes(domain)), "MEMORY_CONTEXT_DOMAIN_INVALID", "Objective classification contains an unsupported memory domain.", { domains });
  return Object.freeze({
    schema_version: CONTEXT_ASSEMBLY_SCHEMA_VERSION,
    kind,
    objective: text(input.objective, 2_000),
    mode: text(input.mode || "agent", 80),
    confidence,
    domains,
    policy_id: text(input.policy_id || input.policyId || `context:${kind}`, 120),
    tool_authorization: false,
    scope_expansion: false,
  });
}

function createContextAssemblyRequest(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_CONTEXT_REQUEST_INVALID", "Context Assembly input must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const sessionId = text(input.session_id || input.sessionId, 240);
  const objective = text(input.objective || input.userMessage || input.user_message, 2_000);
  const tokenBudget = input.token_budget == null && input.tokenBudget == null ? 16_000 : Number(input.token_budget ?? input.tokenBudget);
  assert(Number.isFinite(tokenBudget) && tokenBudget >= 0 && tokenBudget <= MAX_PACKET_TOKENS, "MEMORY_CONTEXT_TOKEN_BUDGET_INVALID", "Context packet token budget is outside the supported bound.", { tokenBudget });
  const promptBudget = input.prompt_budget_tokens == null && input.promptBudgetTokens == null ? null : Number(input.prompt_budget_tokens ?? input.promptBudgetTokens);
  if (promptBudget !== null) assert(Number.isFinite(promptBudget) && promptBudget >= 0 && promptBudget <= MAX_PACKET_TOKENS, "MEMORY_CONTEXT_PROMPT_BUDGET_INVALID", "Prompt budget is outside the supported bound.", { promptBudget });
  const responseReserve = input.response_reserve_tokens == null && input.responseReserveTokens == null ? 0 : Number(input.response_reserve_tokens ?? input.responseReserveTokens);
  assert(Number.isFinite(responseReserve) && responseReserve >= 0 && responseReserve <= MAX_PACKET_TOKENS, "MEMORY_CONTEXT_RESPONSE_RESERVE_INVALID", "Response reserve is outside the supported bound.", { responseReserve });
  const authorityMinimum = input.authority_minimum_tokens == null && input.authorityMinimumTokens == null ? 0 : Number(input.authority_minimum_tokens ?? input.authorityMinimumTokens);
  assert(Number.isFinite(authorityMinimum) && authorityMinimum >= 0 && authorityMinimum <= MAX_PACKET_TOKENS, "MEMORY_CONTEXT_AUTHORITY_BUDGET_INVALID", "Authority minimum is outside the supported bound.", { authorityMinimum });
  const graphDepth = input.graph_depth == null && input.graphDepth == null ? 1 : Number(input.graph_depth ?? input.graphDepth);
  assert(Number.isInteger(graphDepth) && graphDepth >= 0 && graphDepth <= 3, "MEMORY_CONTEXT_GRAPH_DEPTH_INVALID", "Context graph depth must be between 0 and 3.", { graphDepth });
  const sensitivity = assertSensitivity(input.sensitivity_ceiling || input.sensitivityCeiling || "confidential");
  assert(sensitivity !== "restricted", "MEMORY_CONTEXT_SENSITIVITY_INVALID", "Context Assembly cannot retrieve restricted Sensitive Working Memory values.");
  return Object.freeze({
    schema_version: CONTEXT_ASSEMBLY_SCHEMA_VERSION,
    project_id: projectId,
    session_id: sessionId,
    objective,
    mode: text(input.mode || "agent", 80),
    source_revisions: revisionMap(input.source_revisions || input.sourceRevisions),
    preceding_block_id: text(input.preceding_block_id || input.precedingBlockId, 240),
    token_budget: tokenBudget,
    prompt_budget_tokens: promptBudget,
    response_reserve_tokens: responseReserve,
    authority_minimum_tokens: authorityMinimum,
    sensitivity_ceiling: sensitivity,
    graph_depth: graphDepth,
    expand_artifacts: Boolean(input.expand_artifacts || input.expandArtifacts),
    include_provenance: input.include_provenance !== false && input.includeProvenance !== false,
    cursor: text(input.cursor, 1_000),
    filters: clone(input.filters && typeof input.filters === "object" ? input.filters : {}),
  });
}

function createContextAssemblyPacket(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_CONTEXT_PACKET_INVALID", "A context packet must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const classification = createObjectiveClassification(input.objective_classification || input.objectiveClassification || {});
  const state = text(input.state || "current", 40).toLowerCase();
  assert(ASSEMBLY_STATES.includes(state), "MEMORY_CONTEXT_STATE_INVALID", "Context packet state is invalid.", { state });
  const sections = input.sections && typeof input.sections === "object" && !Array.isArray(input.sections) ? input.sections : {};
  const normalizedSections = {};
  for (const domain of ASSEMBLY_DOMAINS) {
    const section = sections[domain];
    if (!section) continue;
    const records = Array.isArray(section.records) ? section.records.slice(0, MAX_RECORDS_PER_SECTION) : [];
    normalizedSections[domain] = {
      records: clone(records),
      omitted: Array.isArray(section.omitted) ? clone(section.omitted).slice(0, MAX_RECORDS_PER_SECTION) : [],
      source_revision: nonNegative(section.source_revision ?? section.sourceRevision ?? 0, `${domain}.source_revision`),
      staleness: text(section.staleness || state, 40),
      token_accounting: {
        requested_tokens: Math.max(0, Number(section.token_accounting?.requested_tokens ?? section.requestedTokens ?? 0) || 0),
        included_tokens: Math.max(0, Number(section.token_accounting?.included_tokens ?? section.includedTokens ?? 0) || 0),
        omitted_tokens: Math.max(0, Number(section.token_accounting?.omitted_tokens ?? section.omittedTokens ?? 0) || 0),
      },
    };
  }
  const tokenAccounting = input.token_accounting || input.tokenAccounting || {};
  const requested = Math.max(0, Number(tokenAccounting.requested_tokens ?? tokenAccounting.requestedTokens ?? 0) || 0);
  const included = Math.max(0, Number(tokenAccounting.included_tokens ?? tokenAccounting.includedTokens ?? 0) || 0);
  const omitted = Math.max(0, Number(tokenAccounting.omitted_tokens ?? tokenAccounting.omittedTokens ?? 0) || 0);
  assert(included <= MAX_PACKET_TOKENS, "MEMORY_CONTEXT_PACKET_TOO_LARGE", "The assembled context packet exceeds the supported token bound.", { included });
  return Object.freeze({
    ok: true,
    schema_version: CONTEXT_ASSEMBLY_SCHEMA_VERSION,
    project_id: projectId,
    session_id: text(input.session_id || input.sessionId, 240),
    objective_classification: classification,
    state,
    source_revisions: revisionMap(input.source_revisions || input.sourceRevisions),
    checkpoint_revision: nonNegative(input.checkpoint_revision ?? input.checkpointRevision ?? 0, "checkpoint_revision"),
    watermark: clone(input.watermark || null),
    sections: normalizedSections,
    recent_tail: clone(input.recent_tail || input.recentTail || null),
    pending_gaps: clone(input.pending_gaps || input.pendingGaps || {}),
    token_accounting: { requested_tokens: requested, included_tokens: included, omitted_tokens: omitted },
    omissions: clone(input.omissions && typeof input.omissions === "object" ? input.omissions : {}),
    warnings: Array.isArray(input.warnings) ? clone(input.warnings).slice(0, 100) : [],
    source_manifest: clone(input.source_manifest || input.sourceManifest || {}),
    assembled_at: text(input.assembled_at || input.assembledAt || new Date(0).toISOString(), 80),
  });
}

module.exports = Object.freeze({
  CONTEXT_ASSEMBLY_SCHEMA_VERSION,
  OBJECTIVE_KINDS,
  ASSEMBLY_STATES,
  ASSEMBLY_DOMAINS,
  MAX_PACKET_TOKENS,
  createObjectiveClassification,
  createContextAssemblyRequest,
  createContextAssemblyPacket,
  validateObjectiveClassification: (input) => validate(createObjectiveClassification, input),
  validateContextAssemblyRequest: (input) => validate(createContextAssemblyRequest, input),
  validateContextAssemblyPacket: (input) => validate(createContextAssemblyPacket, input),
});
