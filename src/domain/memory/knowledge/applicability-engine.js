"use strict";

const nodeCrypto = require("node:crypto");
const { canonicalJson, canonicalKeyHash } = require("../../../contracts/memory/memory-identity.js");

const APPLICABILITY_ENGINE_VERSION = 1;
const COVERAGE_FIELDS = Object.freeze(["target_types", "technologies", "auth_mechanisms", "roles", "endpoints", "workflows", "input_surfaces", "environments"]);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function text(value, maximum = 500) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function values(value, maximum = 2_000) { return [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map((entry) => text(typeof entry === "object" ? entry.key || entry.id || entry.name || entry.type || "" : entry, 500).toLowerCase()).filter(Boolean))].sort().slice(0, maximum); }

function normalizeCoverageInputs(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const entities = Array.isArray(source.entities) ? source.entities : [];
  const claims = Array.isArray(source.claims) ? source.claims : [];
  const entityValues = (type) => entities.filter((entity) => !type || String(entity.entity_type || entity.type || "").toLowerCase() === type).map((entity) => entity.canonical_key_hash || entity.key || entity.record_id || entity.name || entity.value);
  const claimValues = (predicates) => claims.filter((claim) => predicates.includes(String(claim.predicate || "").toLowerCase())).map((claim) => claim.canonical_key_hash || claim.object?.value || claim.object?.entity_id || claim.subject_id || claim.record_id);
  const normalized = {
    target_types: values(source.target_types || source.targetTypes || entities.map((entity) => entity.entity_type || entity.type)),
    technologies: values(source.technologies || entityValues("technology") || claimValues(["uses_technology"])),
    auth_mechanisms: values(source.auth_mechanisms || source.authMechanisms || entityValues("authentication_mechanism") || claimValues(["uses_authentication"])),
    roles: values(source.roles || entityValues("role") || claimValues(["requires_role"])),
    endpoints: values(source.endpoints || entityValues("endpoint") || entityValues("graphql_operation") || entityValues("websocket_channel")),
    workflows: values(source.workflows || entityValues("workflow")),
    input_surfaces: values(source.input_surfaces || entityValues("input_surface")),
    environments: values(source.environments || entityValues("environment")),
  };
  return { values: normalized, hash: canonicalKeyHash(normalized) };
}

function coverageDelta(previous, current) {
  const before = normalizeCoverageInputs(previous).values;
  const after = normalizeCoverageInputs(current).values;
  const fields = {};
  for (const field of COVERAGE_FIELDS) {
    const added = after[field].filter((value) => !before[field].includes(value));
    const removed = before[field].filter((value) => !after[field].includes(value));
    fields[field] = { added, removed, changed: added.length > 0 || removed.length > 0 };
  }
  const changedFields = COVERAGE_FIELDS.filter((field) => fields[field].changed);
  return { changed: changedFields.length > 0, changedFields, fields, previousHash: canonicalKeyHash(before), currentHash: canonicalKeyHash(after) };
}

function featureAliases(value) {
  const normalized = text(value, 200).toLowerCase().replace(/[_-]+/g, " ");
  const aliases = new Set([normalized, normalized.replace(/\s+/g, "-")]);
  if (normalized.includes("authentication")) aliases.add("auth");
  if (normalized.includes("authorization")) aliases.add("access control");
  if (normalized.includes("data object")) aliases.add("object");
  if (normalized.includes("graphql")) aliases.add("api");
  return aliases;
}

function procedureMatches(procedure, coverage) {
  const required = Array.isArray(procedure?.target_features) ? procedure.target_features : [];
  if (!required.length) return { applicable: true, matches: [], missing: [] };
  const available = new Set();
  for (const [field, items] of Object.entries(coverage.values || {})) {
    if (items.length) {
      const label = field.replace(/_/g, " ");
      available.add(label);
      available.add(label.endsWith("s") ? label.slice(0, -1) : label);
    }
    for (const item of items) for (const alias of featureAliases(item)) available.add(alias);
  }
  const matches = [];
  const missing = [];
  for (const feature of required) {
    const aliases = featureAliases(feature);
    if ([...aliases].some((alias) => available.has(alias))) matches.push(text(feature, 200));
    else missing.push(text(feature, 200));
  }
  // A procedure is relevant when at least one declared binding is present;
  // missing optional bindings are retained as reasons, not dropped silently.
  return { applicable: matches.length > 0, matches, missing };
}

function procedureAffectedByField(procedure, field, deltaField) {
  const targets = [
    ...(Array.isArray(procedure?.target_features) ? procedure.target_features : []),
    ...(Array.isArray(procedure?.applicable_technologies) ? procedure.applicable_technologies : []),
    ...(Array.isArray(procedure?.required_roles) ? procedure.required_roles : []),
  ].map((value) => text(value, 200).toLowerCase().replace(/[_-]+/g, " "));
  const changedValues = [...(deltaField?.added || []), ...(deltaField?.removed || [])].map((value) => text(value, 200).toLowerCase().replace(/[_-]+/g, " "));
  if (field === "technologies") return changedValues.some((value) => (procedure.applicable_technologies || []).map((entry) => text(entry, 200).toLowerCase().replace(/[_-]+/g, " ")).includes(value)) || !procedure.applicable_technologies?.length;
  if (field === "roles") return targets.some((value) => value.includes("role") || value.includes("identity")) || changedValues.some((value) => value.includes("role") || value.includes("identity"));
  if (field === "auth_mechanisms") return targets.some((value) => value.includes("auth") || value.includes("session") || value.includes("token"));
  if (field === "endpoints") return targets.some((value) => value.includes("endpoint") || value.includes("api") || value.includes("route"));
  if (field === "workflows") return targets.some((value) => value.includes("workflow") || value.includes("state") || value.includes("business"));
  if (field === "input_surfaces") return targets.some((value) => value.includes("input") || value.includes("graphql") || value.includes("websocket"));
  if (field === "environments") return targets.some((value) => value.includes("environment") || value.includes("deployment"));
  if (field === "target_types") return targets.length > 0 || changedValues.some((value) => targets.includes(value));
  return false;
}

function createApplicabilityEngine({ crypto = nodeCrypto } = {}) {
  function evaluate({ projectCoverage = {}, previousCoverage = null, procedures = [], existingInvestigations = [], projectRevision = 0, knowledgeReleaseId = "", knowledgeContentHash = "", forceRefresh = false } = {}) {
    const coverage = normalizeCoverageInputs(projectCoverage);
    const delta = previousCoverage == null ? { changed: true, changedFields: [...COVERAGE_FIELDS], fields: {}, previousHash: "", currentHash: coverage.hash } : coverageDelta(previousCoverage, projectCoverage);
    const investigationByProcedure = new Map((Array.isArray(existingInvestigations) ? existingInvestigations : []).map((item) => [String(item.procedure_id || item.procedureId || ""), item]));
    const proposals = [];
    const considered = [];
    const sourceProcedures = Array.isArray(procedures) ? procedures : [];
    for (const procedure of sourceProcedures) {
      const procedureId = text(procedure?.procedure_id || procedure?.procedureId || "", 240);
      if (!procedureId) continue;
      const match = procedureMatches(procedure, coverage);
      const prior = investigationByProcedure.get(procedureId);
      const releaseChanged = Boolean(prior && knowledgeContentHash && String(prior.knowledge_content_hash || prior.knowledgeContentHash || "") && String(prior.knowledge_content_hash || prior.knowledgeContentHash) !== knowledgeContentHash);
      const affected = Boolean(forceRefresh || !previousCoverage || delta.changedFields.some((field) => procedureAffectedByField(procedure, field, delta.fields[field])));
      considered.push({ procedureId, applicable: match.applicable, matches: match.matches, missing: match.missing, affected, releaseChanged });
      const base = { procedure_id: procedureId, project_revision: Number(projectRevision) || 0, knowledge_release_id: text(knowledgeReleaseId, 240), knowledge_content_hash: text(knowledgeContentHash, 128), coverage_hash: coverage.hash, reason: { matched_features: match.matches, missing_features: match.missing, changed_fields: delta.changedFields } };
      const priorStatus = String(prior?.status || prior?.state || "");
      if (!match.applicable) {
        if (prior && priorStatus !== "not_applicable" && (affected || releaseChanged || forceRefresh)) proposals.push({ type: "not_applicable", ...base, existing_investigation_id: prior.investigation_id || prior.id || prior.record_id || "" });
        else if (!prior) proposals.push({ type: "not_applicable", ...base });
        continue;
      }
      if (!prior) {
        proposals.push({ type: "create", ...base, priority: Math.max(1, match.matches.length) });
        continue;
      }
      if (releaseChanged || (affected && ["completed", "not_applicable"].includes(priorStatus))) proposals.push({ type: "needs_retest", ...base, existing_investigation_id: prior.investigation_id || prior.id || prior.record_id || "" });
      if (String(prior.coverage_hash || "") !== coverage.hash && affected && !["completed", "needs_retest"].includes(priorStatus)) proposals.push({ type: "retarget", ...base, existing_investigation_id: prior.investigation_id || prior.id || prior.record_id || "" });
      if (match.matches.length !== Number(prior.priority || 0)) proposals.push({ type: "reprioritize", ...base, existing_investigation_id: prior.investigation_id || prior.id || prior.record_id || "", priority: Math.max(1, match.matches.length) });
    }
    proposals.sort((left, right) => `${left.procedure_id}|${left.type}|${canonicalJson(left.reason)}`.localeCompare(`${right.procedure_id}|${right.type}|${canonicalJson(right.reason)}`));
    return { ok: true, engine_version: APPLICABILITY_ENGINE_VERSION, coverage, delta, considered, proposals, knowledge_queries: considered.filter((item) => item.affected || item.releaseChanged).map((item) => item.procedureId).sort(), query_scope: delta.changed ? "relevant_procedures" : "none" };
  }
  return Object.freeze({ APPLICABILITY_ENGINE_VERSION, normalizeCoverageInputs, coverageDelta, evaluate });
}

module.exports = Object.freeze({ APPLICABILITY_ENGINE_VERSION, COVERAGE_FIELDS, normalizeCoverageInputs, coverageDelta, procedureMatches, procedureAffectedByField, createApplicabilityEngine });
