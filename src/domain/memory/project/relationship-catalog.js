"use strict";

const { assert, assertMemoryId, canonicalKeyHash, createOpaqueId } = require("../../../contracts/memory/index.js");
const { cloneSafe, text } = require("../value-safety.js");

const RELATIONSHIP_DEFINITIONS = Object.freeze({
  RESOLVES_TO: { source: ["hostname", "domain"], target: ["ip", "hostname"] },
  HOSTS: { source: ["environment", "domain", "hostname", "application"], target: ["service", "listener", "application", "component"] },
  EXPOSES: { source: ["hostname", "domain", "service", "application", "component"], target: ["listener", "page", "endpoint", "input_surface"] },
  CALLS: { source: ["page", "endpoint", "application", "component", "workflow"], target: ["page", "endpoint", "graphql_operation", "websocket_channel"] },
  REDIRECTS_TO: { source: ["page", "endpoint", "application"], target: ["page", "endpoint", "application"] },
  ACCESSES: { source: ["identity_reference", "role", "application"], target: ["endpoint", "page", "data_object", "application"] },
  REQUIRES_ROLE: { source: ["endpoint", "page", "workflow", "application"], target: ["role"] },
  USES_AUTH_MECHANISM: { source: ["application", "endpoint", "page"], target: ["authentication_mechanism"] },
  USES_SESSION_MECHANISM: { source: ["application", "endpoint", "page"], target: ["session_mechanism"] },
  SETS_COOKIE: { source: ["application", "endpoint", "page"], target: ["session_mechanism"] },
  ACCEPTS_PARAMETER: { source: ["endpoint", "graphql_operation"], target: ["input_surface"] },
  RETURNS_OBJECT: { source: ["endpoint", "graphql_operation"], target: ["data_object"] },
  PART_OF_WORKFLOW: { source: ["endpoint", "page", "state", "application"], target: ["workflow"] },
  TRANSITIONS_TO: { source: ["state"], target: ["state"] },
  USES_TECHNOLOGY: { source: ["application", "component", "service", "platform"], target: ["technology"] },
  DEPENDS_ON: { source: ["application", "component", "technology", "service"], target: ["dependency", "platform", "third_party"] },
  INTEGRATES_WITH: { source: ["application", "component", "workflow"], target: ["third_party", "application", "service"] },
});
const RELATIONSHIP_TYPES = Object.freeze(Object.keys(RELATIONSHIP_DEFINITIONS));

function normalizeRelationship(input = {}, { projectId, recordId = "", sourceType = "", targetType = "", observedAt = "", idFactory = null } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : {};
  if (source.project_id || source.projectId) assert(String(source.project_id || source.projectId) === projectId, "MEMORY_PROJECT_MISMATCH", "The relationship belongs to a different project.");
  const type = text(source.relationship_type || source.relationshipType || source.type, 80).toUpperCase();
  assert(Object.hasOwn(RELATIONSHIP_DEFINITIONS, type), "MEMORY_RELATIONSHIP_TYPE_INVALID", `Unsupported Project Memory relationship type: ${type || "<empty>"}.`);
  const sourceId = assertMemoryId(source.source_id || source.sourceId || source.from, "entity");
  const targetId = assertMemoryId(source.target_id || source.targetId || source.to, "entity");
  const definition = RELATIONSHIP_DEFINITIONS[type];
  const actualSourceType = text(source.source_entity_type || source.sourceEntityType || sourceType, 80).toLowerCase();
  const actualTargetType = text(source.target_entity_type || source.targetEntityType || targetType, 80).toLowerCase();
  if (actualSourceType) assert(definition.source.includes(actualSourceType), "MEMORY_RELATIONSHIP_ENDPOINT_INVALID", `${type} cannot originate from ${actualSourceType}.`, { relationshipType: type, endpoint: "source", entityType: actualSourceType });
  if (actualTargetType) assert(definition.target.includes(actualTargetType), "MEMORY_RELATIONSHIP_ENDPOINT_INVALID", `${type} cannot target ${actualTargetType}.`, { relationshipType: type, endpoint: "target", entityType: actualTargetType });
  const confidence = source.confidence == null ? 0.5 : Number(source.confidence);
  assert(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, "MEMORY_RELATIONSHIP_CONFIDENCE_INVALID", "Relationship confidence must be between 0 and 1.");
  const observed = text(source.observed_at || source.observedAt || observedAt, 80);
  assert(observed && !Number.isNaN(Date.parse(observed)), "MEMORY_RELATIONSHIP_TIME_INVALID", "A relationship requires a valid observed_at timestamp.");
  const suppliedId = recordId || source.record_id || source.recordId || source.id || "";
  const relationshipId = suppliedId ? assertMemoryId(suppliedId, "rel") : assertMemoryId(typeof idFactory === "function" ? idFactory("rel") : createOpaqueId("rel"), "rel");
  return {
    record_type: "relationship",
    record_id: relationshipId,
    project_id: projectId,
    relationship_type: type,
    source_id: sourceId,
    target_id: targetId,
    source_entity_type: actualSourceType,
    target_entity_type: actualTargetType,
    canonical_key: `${sourceId}|${type}|${targetId}`,
    canonical_key_hash: canonicalKeyHash({ project_id: projectId, source_id: sourceId, relationship_type: type, target_id: targetId }),
    state: text(source.state || "active", 40).toLowerCase(),
    confidence,
    observed_at: new Date(observed).toISOString(),
    attributes: cloneSafe(source.attributes || source.data || {}),
  };
}

module.exports = Object.freeze({ RELATIONSHIP_DEFINITIONS, RELATIONSHIP_TYPES, normalizeRelationship });
