"use strict";

const { assert, assertMemoryId, canonicalKeyHash, createOpaqueId } = require("../../../contracts/memory/index.js");
const { cloneSafe, text } = require("../value-safety.js");

const ENTITY_TYPES = Object.freeze([
  "project", "environment", "domain", "hostname", "ip", "network_range", "service", "listener",
  "application", "component", "page", "endpoint", "graphql_operation", "websocket_channel", "input_surface",
  "data_object", "role", "identity_reference", "permission", "authentication_mechanism", "session_mechanism",
  "technology", "dependency", "platform", "waf", "cdn", "third_party", "workflow", "state", "repository",
  "documentation_source",
]);
const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
const URL_TYPES = new Set(["domain", "hostname", "application", "page", "endpoint", "graphql_operation", "websocket_channel", "documentation_source"]);
const REJECTED_PROJECT_TYPES = new Set(["hypothesis", "attempt", "finding", "finding_candidate", "vulnerability", "negative_result", "failure", "test_case", "blocker"]);

function normalizePath(value) {
  const raw = text(value || "/", 4_000) || "/";
  const parts = raw.split("/").filter(Boolean).map((part) => {
    let decoded = part;
    try { decoded = decodeURIComponent(part); } catch { /* Keep the original segment. */ }
    if (/^\d+$/.test(decoded) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded) || (decoded.length >= 24 && /^[a-z0-9_-]+$/i.test(decoded))) return "{id}";
    return encodeURIComponent(decoded).replace(/%2F/gi, "/");
  });
  return `/${parts.join("/")}${raw.endsWith("/") && parts.length ? "/" : ""}` || "/";
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
    url.search = "";
    for (const [key, parameter] of params) url.searchParams.append(key, parameter);
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
    return url;
  } catch { return null; }
}

function normalizeHost(value) {
  const raw = text(value, 500).toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  const parsed = normalizeUrl(raw.includes("://") ? raw : `http://${raw}`);
  return parsed?.hostname?.toLowerCase() || raw;
}

function canonicalKeyFor(type, input) {
  const source = input && typeof input === "object" ? input : { value: input };
  const url = normalizeUrl(source.url || source.target || source.href || source.origin || "");
  const host = normalizeHost(source.hostname || source.host || url?.hostname || "");
  const route = normalizePath(source.path || source.pathname || url?.pathname || "/");
  const method = text(source.method || source.http_method || "GET", 20).toUpperCase();
  const port = Number(source.port || url?.port || 0) || (url?.protocol === "https:" ? 443 : url?.protocol === "http:" ? 80 : 0);
  const name = text(source.name || source.label || source.title || source.value || "", 1_000).toLowerCase();
  switch (type) {
    case "project": return `project|${text(source.project_key || source.key || name, 2_000).toLowerCase()}`;
    case "environment": return `environment|${name || host}`;
    case "domain": return `domain|${normalizeHost(source.domain || source.value || host)}`;
    case "hostname": return `hostname|${host || name}`;
    case "ip": return `ip|${text(source.address || source.ip || source.value || name, 500).toLowerCase()}`;
    case "network_range": return `network_range|${text(source.cidr || source.range || source.value || name, 500).toLowerCase()}`;
    case "service": return `service|${host}|${port}|${text(source.protocol || source.transport || "tcp", 40).toLowerCase()}|${name}`;
    case "listener": return `listener|${host}|${port}|${text(source.protocol || source.transport || "tcp", 40).toLowerCase()}`;
    case "application": return `application|${host}|${normalizePath(source.base_path || source.basePath || route)}`;
    case "component": return `component|${text(source.application_id || source.applicationId || host, 300)}|${name}`;
    case "page": return `page|${host}|${route}`;
    case "endpoint": return `endpoint|${method}|${host}|${route}|${[...(Array.isArray(source.parameters) ? source.parameters : [])].map((item) => text(item?.name || item, 200).toLowerCase()).sort().join(",")}|${port}`;
    case "graphql_operation": return `graphql|${host}|${text(source.operation_name || source.operationName || name, 500).toLowerCase()}`;
    case "websocket_channel": return `websocket|${host}|${route}`;
    case "input_surface": return `input|${text(source.endpoint_id || source.endpointId || `${method}|${host}|${route}`, 500)}|${text(source.name || source.parameter || name, 500).toLowerCase()}|${text(source.location || "query", 80).toLowerCase()}`;
    case "data_object": return `data|${text(source.schema || source.namespace || host, 500).toLowerCase()}|${name}`;
    case "role": return `role|${text(source.role || source.name || name, 500).toLowerCase()}`;
    case "identity_reference": return `identity|${text(source.identity_id || source.identityId || source.reference || name, 500)}`;
    case "permission": return `permission|${text(source.action || name, 500).toLowerCase()}|${text(source.resource || source.resource_id || "", 500).toLowerCase()}`;
    case "authentication_mechanism": return `auth|${text(source.mechanism || source.name || name, 500).toLowerCase()}`;
    case "session_mechanism": return `session|${text(source.mechanism || source.name || name, 500).toLowerCase()}`;
    case "technology": return `technology|${text(source.name || name, 500).toLowerCase()}|${text(source.version || "", 200).toLowerCase()}`;
    case "dependency": return `dependency|${text(source.name || name, 500).toLowerCase()}|${text(source.version || "", 200).toLowerCase()}`;
    case "platform": return `platform|${text(source.name || name, 500).toLowerCase()}|${text(source.version || "", 200).toLowerCase()}`;
    case "waf": return `waf|${text(source.name || name, 500).toLowerCase()}`;
    case "cdn": return `cdn|${text(source.name || name, 500).toLowerCase()}`;
    case "third_party": return `third_party|${text(source.name || source.provider || name, 500).toLowerCase()}`;
    case "workflow": return `workflow|${text(source.name || name, 500).toLowerCase()}`;
    case "state": return `state|${text(source.workflow_id || source.workflowId || "", 500)}|${text(source.name || name, 500).toLowerCase()}`;
    case "repository": return `repository|${text(source.url || source.name || name, 1_000).toLowerCase()}`;
    case "documentation_source": return `documentation|${url?.toString() || text(source.url || source.name || name, 1_000).toLowerCase()}`;
    default: return `${type}|${text(source.canonical_key || source.key || JSON.stringify(source), 2_000).toLowerCase()}`;
  }
}

function normalizeEntity(input = {}, { projectId, recordId = "", idFactory = null } = {}) {
  assertMemoryId(projectId, "proj");
  const source = input && typeof input === "object" ? input : { value: input };
  if (source.project_id || source.projectId) assert(String(source.project_id || source.projectId) === projectId, "MEMORY_PROJECT_MISMATCH", "The entity belongs to a different project.");
  const type = text(source.entity_type || source.entityType || source.type || "", 80).toLowerCase();
  assert(!REJECTED_PROJECT_TYPES.has(type), "MEMORY_PROJECT_OWNERSHIP_VIOLATION", `Project Memory cannot own ${type} records.`, { entityType: type });
  assert(ENTITY_TYPE_SET.has(type), "MEMORY_ENTITY_TYPE_INVALID", `Unsupported Project Memory entity type: ${type || "<empty>"}.`);
  const canonicalKey = text(source.canonical_key || source.canonicalKey || canonicalKeyFor(type, source), 4_000);
  assert(canonicalKey.length > 0, "MEMORY_ENTITY_CANONICAL_KEY_REQUIRED", "An entity canonical key is required.");
  const suppliedId = recordId || source.record_id || source.recordId || source.id || "";
  const entityId = suppliedId ? assertMemoryId(suppliedId, "entity") : assertMemoryId(typeof idFactory === "function" ? idFactory("entity") : createOpaqueId("entity"), "entity");
  const attributes = cloneSafe(source.attributes || source.data || {});
  const aliases = [...new Set((Array.isArray(source.aliases) ? source.aliases : []).map((value) => text(value, 500)).filter(Boolean))].slice(0, 100);
  return {
    record_type: "entity",
    record_id: entityId,
    project_id: projectId,
    entity_type: type,
    canonical_key: canonicalKey,
    canonical_key_hash: canonicalKeyHash({ project_id: projectId, entity_type: type, canonical_key: canonicalKey }),
    label: text(source.label || source.name || source.title || canonicalKey, 500),
    attributes,
    aliases,
    retrieval_labels: [...new Set((Array.isArray(source.retrieval_labels) ? source.retrieval_labels : [type]).map((value) => text(value, 120)).filter(Boolean))].slice(0, 30),
    state: text(source.state || "active", 40).toLowerCase(),
  };
}

module.exports = Object.freeze({ ENTITY_TYPES, ENTITY_TYPE_SET, URL_TYPES, REJECTED_PROJECT_TYPES, normalizePath, normalizeUrl, normalizeHost, canonicalKeyFor, normalizeEntity });
