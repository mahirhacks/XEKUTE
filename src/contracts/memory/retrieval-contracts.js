"use strict";

const { assert, validate } = require("./memory-errors.js");
const { assertMemoryId } = require("./memory-identity.js");
const { assertSensitivity, SENSITIVITY_LEVELS } = require("./memory-lifecycle.js");

const RETRIEVAL_SCHEMA_VERSION = 1;
const RETRIEVAL_DOMAINS = Object.freeze(["project", "investigation", "evidence", "knowledge", "graph", "artifact", "checkpoint", "recent_tail"]);
const DEFAULT_RETRIEVAL_LIMIT = 50;
const MAX_RETRIEVAL_LIMIT = 200;
const MAX_TOKEN_BUDGET = 200_000;

function text(value, maximum = 2_000) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_RETRIEVAL_FIELD_TOO_LARGE", "A retrieval field exceeds its maximum length.", { maximum });
  return result;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function nonNegativeRevision(value, field) {
  const revision = Number(value);
  assert(Number.isSafeInteger(revision) && revision >= 0, "MEMORY_RETRIEVAL_REVISION_INVALID", `${field} must be a non-negative integer.`, { field });
  return revision;
}

function createRetrievalRequest(input = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_RETRIEVAL_REQUEST_INVALID", "A retrieval request must be an object.");
  const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : []).map((value) => text(value, 80).toLowerCase()).filter(Boolean))];
  assert(domains.every((domain) => RETRIEVAL_DOMAINS.includes(domain)), "MEMORY_RETRIEVAL_DOMAIN_INVALID", "A retrieval request contains an unsupported memory domain.", { domains });
  const limit = input.limit == null ? DEFAULT_RETRIEVAL_LIMIT : Number(input.limit);
  assert(Number.isInteger(limit) && limit >= 1 && limit <= MAX_RETRIEVAL_LIMIT, "MEMORY_RETRIEVAL_LIMIT_INVALID", `Retrieval limit must be between 1 and ${MAX_RETRIEVAL_LIMIT}.`, { limit });
  const graphDepth = input.graph_depth == null ? 1 : Number(input.graph_depth);
  assert(Number.isInteger(graphDepth) && graphDepth >= 0 && graphDepth <= 3, "MEMORY_RETRIEVAL_GRAPH_DEPTH_INVALID", "Graph depth must be between 0 and 3.", { graphDepth });
  const tokenBudget = input.token_budget == null ? 16_000 : Number(input.token_budget);
  assert(Number.isFinite(tokenBudget) && tokenBudget >= 0 && tokenBudget <= MAX_TOKEN_BUDGET, "MEMORY_RETRIEVAL_TOKEN_BUDGET_INVALID", "Retrieval token budget is outside the supported bound.", { tokenBudget });
  const sensitivity = assertSensitivity(input.sensitivity_ceiling || input.sensitivityCeiling || "confidential");
  const sourceRevisions = {};
  const revisions = input.source_revisions || input.sourceRevisions || {};
  assert(revisions && typeof revisions === "object" && !Array.isArray(revisions), "MEMORY_RETRIEVAL_REVISIONS_INVALID", "source_revisions must be an object.");
  for (const [key, value] of Object.entries(revisions)) sourceRevisions[text(key, 80)] = nonNegativeRevision(value, `source_revisions.${key}`);
  return Object.freeze({
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    project_id: projectId,
    objective: text(input.objective, 2_000),
    domains,
    filters: clone(input.filters && typeof input.filters === "object" ? input.filters : {}),
    source_revisions: sourceRevisions,
    limit,
    cursor: text(input.cursor, 1_000),
    token_budget: tokenBudget,
    sensitivity_ceiling: sensitivity,
    graph_depth: graphDepth,
    expand_artifacts: Boolean(input.expand_artifacts || input.expandArtifacts),
    include_provenance: input.include_provenance !== false && input.includeProvenance !== false,
  });
}

function createRetrievalResult(input = {}) {
  const request = input.request || {};
  const projectId = assertMemoryId(input.project_id || input.projectId || request.project_id, "proj");
  const records = Array.isArray(input.records) ? input.records : [];
  const omitted = Array.isArray(input.omitted) ? input.omitted : [];
  const usedTokens = Math.max(0, Number(input.token_accounting?.used_tokens ?? input.usedTokens ?? 0) || 0);
  return Object.freeze({
    ok: true,
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    project_id: projectId,
    records: clone(records),
    omitted: clone(omitted),
    omissions: clone(input.omissions && typeof input.omissions === "object" ? input.omissions : {}),
    source_revisions: clone(input.source_revisions && typeof input.source_revisions === "object" ? input.source_revisions : {}),
    staleness: String(input.staleness || "current").slice(0, 40),
    next_cursor: text(input.next_cursor || input.nextCursor, 1_000) || null,
    token_accounting: {
      requested_tokens: Math.max(0, Number(request.token_budget || input.requestedTokens || 0) || 0),
      used_tokens: usedTokens,
      omitted_tokens: Math.max(0, Number(input.token_accounting?.omitted_tokens ?? input.omittedTokens ?? 0) || 0),
    },
    warnings: Array.isArray(input.warnings) ? clone(input.warnings).slice(0, 100) : [],
  });
}

module.exports = Object.freeze({
  RETRIEVAL_SCHEMA_VERSION,
  RETRIEVAL_DOMAINS,
  DEFAULT_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_LIMIT,
  MAX_TOKEN_BUDGET,
  createRetrievalRequest,
  createRetrievalResult,
  validateRetrievalRequest: (input) => validate(createRetrievalRequest, input),
  validateRetrievalResult: (input) => validate(createRetrievalResult, input),
  SENSITIVITY_LEVELS,
});
