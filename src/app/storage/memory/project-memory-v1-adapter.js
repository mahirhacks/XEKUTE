"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, isMemoryId } = require("../../../contracts/memory/index.js");
const { normalizeEntity, ENTITY_TYPE_SET } = require("../../../domain/memory/project/entity-catalog.js");
const { normalizeClaim, CLAIM_PREDICATE_SET } = require("../../../domain/memory/project/claim-catalog.js");
const { normalizeRelationship, RELATIONSHIP_DEFINITIONS } = require("../../../domain/memory/project/relationship-catalog.js");
const { redactSecrets, redactStructuredValue } = require("../../../shared/secret-redaction.js");
const { cloneSafe } = require("../../../domain/memory/value-safety.js");
const {
  clone,
  operationFailure,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const V1_ADAPTER_VERSION = 1;
const V1_FILE = [".xekute", "context", "project-memory.json"];
const CONFIRMED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const CONFIRMED_STATUSES = new Set(["verified", "confirmed", "accepted", "reproduced"]);
const ENTITY_TYPE_ALIASES = Object.freeze({
  asset: "application",
  app: "application",
  host: "hostname",
  server: "hostname",
  route: "endpoint",
  api: "endpoint",
  url: "endpoint",
  path: "endpoint",
  parameter: "input_surface",
  input: "input_surface",
  framework: "technology",
  library: "dependency",
  auth: "authentication_mechanism",
  authentication: "authentication_mechanism",
  session: "session_mechanism",
  identity: "identity_reference",
  user: "identity_reference",
});
const CLAIM_ALIASES = Object.freeze({
  hostname: "has_hostname",
  host: "has_hostname",
  resolves: "resolves_to_ip",
  technology: "uses_technology",
  tech: "uses_technology",
  auth: "uses_authentication",
  authentication: "uses_authentication",
  session: "uses_session_mechanism",
  role: "requires_role",
  parameter: "accepts_parameter",
  object: "returns_data_object",
  component: "has_component",
  page: "has_page",
  workflow: "belongs_to_workflow",
});
const RELATIONSHIP_ALIASES = Object.freeze({
  resolves: "RESOLVES_TO",
  resolves_to: "RESOLVES_TO",
  hosts: "HOSTS",
  exposes: "EXPOSES",
  calls: "CALLS",
  redirects: "REDIRECTS_TO",
  redirects_to: "REDIRECTS_TO",
  accesses: "ACCESSES",
  requires_role: "REQUIRES_ROLE",
  uses_auth: "USES_AUTH_MECHANISM",
  uses_authentication: "USES_AUTH_MECHANISM",
  uses_session: "USES_SESSION_MECHANISM",
  sets_cookie: "SETS_COOKIE",
  accepts_parameter: "ACCEPTS_PARAMETER",
  returns_object: "RETURNS_OBJECT",
  part_of_workflow: "PART_OF_WORKFLOW",
  transitions_to: "TRANSITIONS_TO",
  uses_technology: "USES_TECHNOLOGY",
  depends_on: "DEPENDS_ON",
  integrates_with: "INTEGRATES_WITH",
});
const SAFE_ATTRIBUTE_KEYS = new Set([
  "category", "confidence", "description", "environment", "framework", "kind", "label", "location",
  "method", "name", "notes", "path", "pathname", "port", "protocol", "provider", "role", "status",
  "summary", "title", "technology", "transport", "type", "url", "version", "hostname", "host",
]);

function text(value, maximum = 4_000) {
  return redactSecrets(String(value == null ? "" : value).replace(/\u0000/g, "").trim()).slice(0, maximum);
}

function hash(crypto, value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function opaqueFromSeed(crypto, prefix, seed) {
  return `${prefix}_${hash(crypto, seed).slice(0, 32)}`;
}

function sourceReference(sourceHash, field = "source", index = 0) {
  return `legacy_project_memory:${sourceHash}:${text(field, 80)}:${Number.isInteger(index) ? index : 0}`;
}

function legacyIdentifier(value, fallback = "") {
  const source = value && typeof value === "object" ? value : {};
  return text(source.id || source.record_id || source.recordId || source.ref || source.key || fallback, 240);
}

function collection(value) {
  return Array.isArray(value) ? value : [];
}

function itemSummary(item, fallback = "Legacy record") {
  if (typeof item === "string") return text(item, 2_000);
  const source = item && typeof item === "object" ? item : {};
  return text(source.summary || source.statement || source.description || source.title || source.name || source.value || fallback, 2_000);
}

function safeAttributes(item, field, index) {
  const source = item && typeof item === "object" ? item : {};
  const attributes = { legacy_field: text(field, 120), legacy_index: index };
  const legacyId = legacyIdentifier(source);
  if (legacyId) attributes.legacy_id = legacyId;
  for (const key of SAFE_ATTRIBUTE_KEYS) {
    const value = source[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const clean = text(value, 1_000);
    if (clean) attributes[key] = clean;
  }
  return attributes;
}

function normalizeEntityType(item) {
  const source = item && typeof item === "object" ? item : {};
  const candidate = text(source.entity_type || source.entityType || source.kind || source.category || source.type || "", 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (ENTITY_TYPE_SET.has(candidate)) return candidate;
  if (ENTITY_TYPE_ALIASES[candidate]) return ENTITY_TYPE_ALIASES[candidate];
  if (source.ip || source.address) return "ip";
  if (source.cidr || source.network || source.range) return "network_range";
  if (source.hostname || source.host) return "hostname";
  if (source.technology || source.framework) return "technology";
  if (source.role) return "role";
  if (source.identity_id || source.identityId || source.identity) return "identity_reference";
  if (source.parameter || source.parameterName || source.input) return "input_surface";
  if (source.path || source.pathname || source.endpoint || source.route || source.url || source.href) return "endpoint";
  return "";
}

function entityName(item) {
  if (typeof item === "string") return text(item, 1_000);
  const source = item && typeof item === "object" ? item : {};
  return text(source.name || source.label || source.title || source.hostname || source.host || source.url || source.href || source.path || source.value || "", 1_000);
}

function observedAt(item, fallback) {
  const source = item && typeof item === "object" ? item : {};
  const value = source.observed_at || source.observedAt || source.recorded_at || source.recordedAt || source.updated_at || source.updatedAt || source.created_at || source.createdAt || fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function confidence(value, fallback = 0.5) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  const normalized = text(value, 40).toLowerCase();
  if (normalized === "certain" || normalized === "very_high") return 1;
  if (normalized === "high") return 0.85;
  if (normalized === "medium" || normalized === "moderate") return 0.6;
  if (normalized === "low") return 0.35;
  return fallback;
}

function legacyObjectValue(item) {
  const source = item && typeof item === "object" ? item : {};
  const candidate = source.object !== undefined ? source.object : source.value !== undefined ? source.value : source.target_value !== undefined ? source.target_value : source.target;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const id = legacyIdentifier(candidate);
    if (id) return { legacyEntityId: id };
    if (candidate.value !== undefined) return { value: redactStructuredValue(candidate.value), type: text(candidate.type || "", 40).toLowerCase() };
  }
  if (candidate !== undefined && candidate !== null) return { value: redactStructuredValue(candidate), type: Array.isArray(candidate) ? "array" : typeof candidate };
  return null;
}

function sourcePathFor(path, workspace) {
  const root = resolvedWorkspace(path, workspace);
  return path.join(root, ...V1_FILE);
}

function readLegacySource({ fs, path, crypto, workspace }) {
  const primaryPath = sourcePathFor(path, workspace);
  const backupPath = `${primaryPath}.bak`;
  const candidates = [primaryPath, backupPath];
  let primaryError = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const bytes = fs.readFileSync(candidate);
      const value = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The legacy Project Memory root must be an object.");
      const sourceHash = hash(crypto, bytes);
      return {
        ok: true,
        exists: true,
        recovered: candidate !== primaryPath,
        path: primaryPath,
        sourcePath: candidate,
        sourceHash,
        bytes: bytes.length,
        value,
        warnings: candidate !== primaryPath
          ? [{ code: "MEMORY_LEGACY_SOURCE_RECOVERED", message: "The legacy Project Memory preview used its backup file." }]
          : [],
      };
    } catch (error) {
      if (candidate === primaryPath) primaryError = error;
    }
  }
  if (primaryError) return operationFailure("MEMORY_LEGACY_SOURCE_INVALID", `The legacy Project Memory source could not be parsed: ${primaryError.message}.`, { path: primaryPath }, false);
  return { ok: true, exists: false, path: primaryPath, sourcePath: "", sourceHash: "", bytes: 0, value: {}, warnings: [] };
}

function createProjectMemoryV1Adapter({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  repository = null,
  artifactRegistry = null,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Project Memory v1 adapter dependencies are required.");

  function buildPreview(workspace, projectId) {
    let root;
    try { root = resolvedWorkspace(path, workspace); assertMemoryId(projectId, "proj"); } catch (error) {
      return operationFailure(error.code || "MEMORY_LEGACY_INPUT_INVALID", error.message, error.details || {});
    }
    const loaded = readLegacySource({ fs, path, crypto, workspace: root });
    if (!loaded.ok) return loaded;
    const source = loaded.value || {};
    const sourceHash = loaded.sourceHash || hash(crypto, `${root}|missing-v1-project-memory`);
    const operationId = opaqueFromSeed(crypto, "op", `project-memory-v1|${projectId}|${loaded.sourceHash || "missing"}`);
    const capturedAt = timestamp(now);
    const provenance = {
      source_type: "import",
      source_refs: [`legacy_project_memory:${sourceHash}`],
      captured_at: capturedAt,
      source_hash: sourceHash,
    };
    const actor = { type: "importer", id: "project-memory-v1-adapter" };
    const plan = {
      adapter_version: V1_ADAPTER_VERSION,
      schema_version: Number(source.schemaVersion || source.schema_version || 1) || 1,
      kind: "xekute-project-memory-v1-preview",
      project_id: projectId,
      source: {
        path: loaded.path,
        source_path: loaded.sourcePath,
        sha256: loaded.sourceHash,
        bytes: loaded.bytes,
        recovered: Boolean(loaded.recovered),
        exists: Boolean(loaded.exists),
      },
      operation_id: operationId,
      commands: [],
      mappings: [],
      investigation_queue: [],
      evidence_candidates: [],
      artifact_references: [],
      warnings: [...(loaded.warnings || [])],
      counts: { project_commands: 0, project_entities: 0, project_claims: 0, project_relationships: 0, aliases: 0, investigation: 0, evidence_candidates: 0, artifacts: 0, warnings: loaded.warnings?.length || 0 },
    };
    const entityIds = new Map();
    const entityByCanonical = new Map();
    const entityById = new Map();
    const entityTypes = new Map();
    const legacyAliases = new Set();
    const fallbackTime = capturedAt;

    const mapping = (field, index, legacyId, owner, disposition, reason, target = {}) => {
      const value = {
        source_field: text(field, 120),
        source_index: index,
        legacy_id: text(legacyId, 240),
        owner: text(owner, 40),
        disposition: text(disposition, 80),
        reason: text(reason, 500),
        ...(target && Object.keys(target).length ? { target: clone(target) } : {}),
      };
      plan.mappings.push(value);
      return value;
    };

    const queueInvestigation = (field, index, item, reason, recordType = "legacy_unclassified") => {
      const legacyId = legacyIdentifier(item, `${field}-${index}`);
      const entry = {
        record_type: text(recordType, 80),
        legacy_id: legacyId,
        summary: itemSummary(item),
        source_refs: [sourceReference(sourceHash, field, index)],
        state: "legacy_unclassified",
        reason: text(reason, 500),
      };
      plan.investigation_queue.push(entry);
      plan.counts.investigation += 1;
      mapping(field, index, legacyId, "investigation", "queued", reason);
      return entry;
    };

    const addCommand = (field, index, legacyId, mutationType, payload) => {
      const command = {
        schema_version: 1,
        operation_id: operationId,
        idempotency_key: operationId,
        block_id: null,
        sealed_event_range: null,
        finalization_position: null,
        project_id: projectId,
        memory_type: "project",
        expected_base_revision: 0,
        actor,
        session_id: null,
        mutation_type: mutationType,
        target_record_id: null,
        canonical_key: null,
        payload: cloneSafe(payload),
        provenance: { ...provenance, source_refs: [sourceReference(sourceHash, field, index)] },
        sensitivity: "confidential",
      };
      plan.commands.push(command);
      plan.counts.project_commands += 1;
      return command;
    };

    const addAlias = (field, index, legacyId, canonicalId) => {
      const alias = text(legacyId, 240);
      if (!alias || alias === canonicalId || legacyAliases.has(`${alias}|${canonicalId}`)) return;
      legacyAliases.add(`${alias}|${canonicalId}`);
      addCommand(field, index, alias, "register_alias", { legacy_id: alias, canonical_id: canonicalId, alias_type: "legacy_project_memory" });
      plan.counts.aliases += 1;
      mapping(field, index, alias, "project", "alias", "The legacy identifier is retained as a canonical Project entity alias.", { record_type: "entity", record_id: canonicalId });
    };

    const addEntity = (field, index, rawItem, { synthetic = false } = {}) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem : { value: rawItem };
      const type = normalizeEntityType(item);
      const name = entityName(item);
      const legacyId = legacyIdentifier(item, `${field}-${index}`);
      if (!type || !name) {
        queueInvestigation(field, index, item, !type ? "Legacy entity type is missing or unsupported." : "Legacy entity has no bounded identifying value.", "entity_candidate");
        return "";
      }
      const candidate = {
        entity_type: type,
        record_id: opaqueFromSeed(crypto, "entity", `${projectId}|${sourceHash}|${field}|${index}|${legacyId}|${type}|${name}`),
        name,
        url: item.url || item.href || (type === "endpoint" ? item.target : undefined),
        hostname: item.hostname || item.host,
        path: item.path || item.pathname,
        method: item.method,
        port: item.port,
        protocol: item.protocol || item.transport,
        version: item.version,
        aliases: legacyId && !synthetic ? [legacyId] : [],
        attributes: safeAttributes(item, field, index),
      };
      let normalized;
      try { normalized = normalizeEntity(candidate, { projectId, recordId: candidate.record_id }); } catch (error) {
        plan.warnings.push({ code: error.code || "MEMORY_LEGACY_ENTITY_INVALID", message: `Legacy entity ${legacyId || `${field}-${index}`} was not imported: ${error.message}.` });
        plan.counts.warnings += 1;
        mapping(field, index, legacyId, "project", "unclassified", error.message);
        return "";
      }
      const existing = entityByCanonical.get(normalized.canonical_key_hash);
      if (existing) {
        if (legacyId) {
          entityIds.set(legacyId, existing.record_id);
          entityIds.set(legacyId.toLowerCase(), existing.record_id);
          addAlias(field, index, legacyId, existing.record_id);
        }
        mapping(field, index, legacyId, "project", "deduplicated", "An equivalent canonical entity was already staged.", { record_type: "entity", record_id: existing.record_id });
        return existing.record_id;
      }
      entityByCanonical.set(normalized.canonical_key_hash, normalized);
      entityById.set(normalized.record_id, normalized);
      entityTypes.set(normalized.record_id, normalized.entity_type);
      addCommand(field, index, legacyId, "upsert_entity", { entity: normalized });
      plan.counts.project_entities += 1;
      mapping(field, index, legacyId, "project", "accepted", "A factual target entity was normalized into Project Memory.", { record_type: "entity", record_id: normalized.record_id });
      if (legacyId) {
        entityIds.set(legacyId, normalized.record_id);
        entityIds.set(legacyId.toLowerCase(), normalized.record_id);
        addAlias(field, index, legacyId, normalized.record_id);
      }
      if (name) entityIds.set(name.toLowerCase(), normalized.record_id);
      return normalized.record_id;
    };

    const addClaim = (field, index, rawItem) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem : {};
      const predicateCandidate = text(item.predicate || item.relation || item.claim_type || item.claimType || "", 120).toLowerCase().replace(/[\s-]+/g, "_");
      const predicate = CLAIM_PREDICATE_SET.has(predicateCandidate) ? predicateCandidate : CLAIM_ALIASES[predicateCandidate] || "";
      const subjectLegacy = text(item.subject_id || item.subjectId || item.subject || item.entity_id || item.entityId || item.entity || "", 240);
      const subjectId = entityIds.get(subjectLegacy) || entityIds.get(subjectLegacy.toLowerCase());
      const object = legacyObjectValue(item);
      const objectEntityId = object?.legacyEntityId ? (entityIds.get(object.legacyEntityId) || entityIds.get(object.legacyEntityId.toLowerCase())) : entityIds.get(text(item.object_id || item.objectId || "", 240));
      if (!predicate || !subjectId || !object && !objectEntityId) {
        queueInvestigation(field, index, item, !predicate ? "Legacy observation does not contain a supported factual predicate." : !subjectId ? "Legacy claim subject could not be resolved to an imported entity." : "Legacy claim object is not bounded or resolvable.", "observation");
        return "";
      }
      const claimId = opaqueFromSeed(crypto, "claim", `${projectId}|${sourceHash}|${field}|${index}|${subjectId}|${predicate}|${JSON.stringify(object || objectEntityId)}`);
      const claim = {
        record_type: "claim",
        record_id: claimId,
        project_id: projectId,
        subject_id: subjectId,
        predicate,
        object: objectEntityId ? { entity_id: objectEntityId } : { type: object.type || (object.value === null ? "null" : typeof object.value), value: object.value },
        state: "observed",
        confidence: confidence(item.confidence),
        observed_at: observedAt(item, fallbackTime),
        scope: redactStructuredValue(item.scope || {}),
      };
      try { normalizeClaim(claim, { projectId, recordId: claimId }); } catch (error) {
        plan.warnings.push({ code: error.code || "MEMORY_LEGACY_CLAIM_INVALID", message: `Legacy claim ${legacyIdentifier(item, `${field}-${index}`)} was not imported: ${error.message}.` });
        plan.counts.warnings += 1;
        queueInvestigation(field, index, item, error.message, "observation");
        return "";
      }
      addCommand(field, index, legacyIdentifier(item, `${field}-${index}`), "upsert_claim", { claim });
      plan.counts.project_claims += 1;
      mapping(field, index, legacyIdentifier(item, `${field}-${index}`), "project", "accepted", "A factual legacy observation was normalized as a Project claim.", { record_type: "claim", record_id: claimId });
      return claimId;
    };

    const addRelationship = (field, index, rawItem) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem : {};
      const candidate = text(item.relationship_type || item.relationshipType || item.relation || item.type || "", 120).toLowerCase().replace(/[\s-]+/g, "_");
      const relationshipType = RELATIONSHIP_DEFINITIONS[candidate.toUpperCase()] ? candidate.toUpperCase() : RELATIONSHIP_ALIASES[candidate] || "";
      const sourceLegacy = text(item.source_id || item.sourceId || item.from || item.source || "", 240);
      const targetLegacy = text(item.target_id || item.targetId || item.to || item.target || "", 240);
      const sourceId = entityIds.get(sourceLegacy) || entityIds.get(sourceLegacy.toLowerCase());
      const targetId = entityIds.get(targetLegacy) || entityIds.get(targetLegacy.toLowerCase());
      const sourceType = sourceId ? entityTypes.get(sourceId) : "";
      const targetType = targetId ? entityTypes.get(targetId) : "";
      const relationshipId = opaqueFromSeed(crypto, "rel", `${projectId}|${sourceHash}|${field}|${index}|${sourceId || sourceLegacy}|${relationshipType}|${targetId || targetLegacy}`);
      const relationship = {
        record_type: "relationship",
        record_id: relationshipId,
        project_id: projectId,
        relationship_type: relationshipType,
        source_id: sourceId || "",
        target_id: targetId || "",
        source_entity_type: sourceType,
        target_entity_type: targetType,
        observed_at: observedAt(item, fallbackTime),
        confidence: confidence(item.confidence),
        attributes: safeAttributes(item, field, index),
      };
      try { normalizeRelationship(relationship, { projectId, recordId: relationshipId, sourceType, targetType }); } catch (error) {
        queueInvestigation(field, index, item, !relationshipType ? "Legacy relationship type is unsupported." : !sourceId || !targetId ? "Legacy relationship endpoints could not be resolved." : error.message, "relationship_candidate");
        return "";
      }
      addCommand(field, index, legacyIdentifier(item, `${field}-${index}`), "upsert_relationship", { relationship });
      plan.counts.project_relationships += 1;
      mapping(field, index, legacyIdentifier(item, `${field}-${index}`), "project", "accepted", "A typed legacy relationship passed endpoint validation.", { record_type: "relationship", record_id: relationshipId });
      return relationshipId;
    };

    const current = source.current && typeof source.current === "object" ? source.current : {};
    const targetSummary = text(current.targetSummary || current.target_summary || "", 2_000);
    let projectEntityId = "";
    if (targetSummary) projectEntityId = addEntity("current.targetSummary", 0, { entity_type: "project", name: targetSummary, summary: targetSummary }, { synthetic: true });
    for (const [index, item] of collection(current.importantEntities).entries()) {
      const entityId = addEntity("current.importantEntities", index, item);
      if (entityId && item && typeof item === "object" && (item.predicate || item.relation || item.claim_type)) addClaim("current.importantEntities", index, { ...item, subject_id: item.subject_id || item.subjectId || item.id || entityId });
    }
    if (projectEntityId && text(current.scopeSummary || current.scope_summary || "", 2_000)) {
      const scopeClaim = {
        subject_id: projectEntityId,
        predicate: "scope_status",
        object: { type: "string", value: text(current.scopeSummary || current.scope_summary, 2_000) },
        state: "observed",
        confidence: 0.7,
        observed_at: fallbackTime,
      };
      addCommand("current.scopeSummary", 0, "scope-summary", "upsert_claim", { claim: { ...scopeClaim, record_id: opaqueFromSeed(crypto, "claim", `${projectId}|${sourceHash}|scope`) } });
      plan.counts.project_claims += 1;
      mapping("current.scopeSummary", 0, "scope-summary", "project", "accepted", "The legacy scope summary is retained as an attributed Project claim.");
    } else if (text(current.scopeSummary || current.scope_summary || "", 2_000)) {
      queueInvestigation("current.scopeSummary", 0, { summary: current.scopeSummary || current.scope_summary }, "Scope summary could not be attached to a canonical Project entity.", "scope_candidate");
    }

    for (const [index, item] of collection(source.observations).entries()) {
      if (item && typeof item === "object" && (item.predicate || item.relation || item.claim_type || item.subject_id || item.subjectId)) addClaim("observations", index, item);
      else queueInvestigation("observations", index, item, "Legacy observation lacks enough typed information to become a Project claim.", "observation");
    }
    for (const [index, item] of collection(source.relationships).entries()) addRelationship("relationships", index, item);

    const evidenceRefs = collection(source.evidenceRefs || source.evidence_refs);
    for (const [index, raw] of evidenceRefs.entries()) {
      const item = raw && typeof raw === "object" ? raw : { ref: raw };
      const legacyRef = text(item.ref || item.id || item.evidenceId || item.evidence_id || `evidence-${index}`, 300);
      const entry = {
        legacy_ref: legacyRef,
        source_refs: [sourceReference(sourceHash, "evidenceRefs", index)],
        disposition: "artifact_reference",
        location: item.path || item.location || "",
        sha256: text(item.sha256 || item.hash || "", 128).toLowerCase(),
      };
      plan.artifact_references.push(entry);
      plan.counts.artifacts += 1;
      mapping("evidenceRefs", index, legacyRef, "artifact", "referenced", "The legacy evidence reference is preserved for artifact-registry resolution.", { legacy_ref: legacyRef });
    }

    const findings = collection(source.findings);
    for (const [index, raw] of findings.entries()) {
      const item = raw && typeof raw === "object" ? raw : { summary: raw };
      const severity = text(item.severity || item.priority || "", 40).toLowerCase();
      const status = text(item.status || item.state || item.verdict || "", 60).toLowerCase();
      const refs = collection(item.evidenceRefs || item.evidence_refs || item.evidenceIds || item.evidence_ids).map((value) => text(value, 300)).filter(Boolean);
      const target = text(item.target || item.url || item.endpoint || item.asset || item.host || "", 500);
      const reproduction = collection(item.reproduction?.steps || item.reproductionSteps || item.steps);
      const legacyId = legacyIdentifier(item, `finding-${index}`);
      if (CONFIRMED_SEVERITIES.has(severity) && CONFIRMED_STATUSES.has(status) && refs.length && target && reproduction.length) {
        plan.evidence_candidates.push({ legacy_id: legacyId, severity, status, title: itemSummary(item, "Legacy confirmed finding"), target: redactSecrets(target), evidence_refs: refs.slice(0, 20), source_refs: [sourceReference(sourceHash, "findings", index)], disposition: "requires_evidence_memory_validation" });
        plan.counts.evidence_candidates += 1;
        mapping("findings", index, legacyId, "evidence", "candidate", "The legacy finding appears confirmed but still requires the v2 verification gate; it is not promoted automatically.");
      } else {
        queueInvestigation("findings", index, item, "Legacy finding is candidate, informational, ambiguous, or lacks the v2 proof requirements.", "finding_candidate");
      }
    }

    if (source.activeHypothesis) queueInvestigation("activeHypothesis", 0, source.activeHypothesis, "Hypotheses belong to Investigation Memory, never Project Memory.", "hypothesis");
    for (const field of ["failures", "negativeResults", "knownGaps", "completedWork", "completedPlans", "completedRuns", "anomalies"]) {
      for (const [index, item] of collection(source[field]).entries()) queueInvestigation(field, index, item, `${field} belongs to Investigation or Session/Operational Context Memory.`, field === "negativeResults" ? "negative_result" : field === "anomalies" ? "investigation_observation" : "history");
    }
    if (text(current.assessmentPhase || current.assessment_phase || "", 500)) queueInvestigation("current.assessmentPhase", 0, { summary: current.assessmentPhase || current.assessment_phase }, "Assessment phase is Investigation programme state.", "programme_state");
    for (const [index, item] of collection(source.decisions).entries()) {
      if (item && typeof item === "object" && (item.predicate || item.claim_type) && (item.subject_id || item.subjectId || item.subject)) addClaim("decisions", index, item);
      else queueInvestigation("decisions", index, item, "The legacy decision lacks the attribution required for a Project claim and remains operational context.", "decision");
    }
    for (const [index, item] of collection(current.importantEntities).entries()) {
      if (item && typeof item === "object" && (item.predicate || item.relation || item.claim_type)) continue;
      const legacyId = legacyIdentifier(item, `important-entity-${index}`);
      if (!legacyId) continue;
    }
    plan.commands = plan.commands.map((command) => ({ ...command, expected_base_revision: 0 }));
    const mutationOrder = { upsert_entity: 0, upsert_claim: 1, upsert_relationship: 2, register_alias: 3 };
    plan.commands.sort((left, right) => {
      const leftKey = `${mutationOrder[left.mutation_type] ?? 9}|${left.mutation_type}|${left.payload?.entity?.record_id || left.payload?.claim?.record_id || left.payload?.relationship?.record_id || left.payload?.canonical_id || ""}`;
      const rightKey = `${mutationOrder[right.mutation_type] ?? 9}|${right.mutation_type}|${right.payload?.entity?.record_id || right.payload?.claim?.record_id || right.payload?.relationship?.record_id || right.payload?.canonical_id || ""}`;
      return leftKey.localeCompare(rightKey);
    });
    return { ok: true, preview: plan };
  }

  function registerArtifacts(workspace, projectId, preview) {
    if (!artifactRegistry?.register) return { ok: true, artifacts: [], warnings: [] };
    const artifacts = [];
    const warnings = [];
    for (const reference of preview.artifact_references || []) {
      const location = reference.location && typeof reference.location === "object" ? reference.location : { path: reference.location };
      if (!location.path && !location.relative_path && !reference.sha256) continue;
      const result = artifactRegistry.register(workspace, projectId, {
        kind: "legacy_evidence_reference",
        location,
        sha256: reference.sha256,
        metadata: { legacy_ref: reference.legacy_ref, source_hash: preview.source.sha256 },
        sensitivity: "confidential",
      });
      if (result.ok) artifacts.push({ legacy_ref: reference.legacy_ref, artifact_id: result.artifactId, changed: result.changed });
      else warnings.push({ code: result.code || "MEMORY_LEGACY_ARTIFACT_IMPORT_FAILED", message: result.error || "A legacy artifact reference could not be registered.", legacy_ref: reference.legacy_ref });
    }
    return { ok: true, artifacts, warnings };
  }

  async function importLegacy(workspace, projectId, { dryRun = false, registerLegacyArtifacts = false } = {}) {
    const previewResult = buildPreview(workspace, projectId);
    if (!previewResult.ok) return previewResult;
    const preview = previewResult.preview;
    if (dryRun) return { ok: true, imported: false, dry_run: true, preview };
    if (!preview.source.exists) return { ok: true, imported: false, changed: false, reason: "legacy_source_missing", preview };
    if (!repository?.load || !repository?.apply) return operationFailure("MEMORY_PROJECT_REPOSITORY_UNAVAILABLE", "Project Memory v2 repository is unavailable for legacy import.", {}, true);
    const loaded = await repository.load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const commands = preview.commands.map((command) => ({ ...clone(command), expected_base_revision: loaded.revision }));
    let projectResult = { ok: true, changed: false, previousRevision: loaded.revision, revision: loaded.revision, recordIds: [], warnings: [] };
    if (commands.length) {
      projectResult = await repository.apply(workspace, projectId, commands);
      if (!projectResult.ok) return { ...projectResult, preview };
    }
    const artifactResult = registerLegacyArtifacts ? registerArtifacts(workspace, projectId, preview) : { ok: true, artifacts: [], warnings: [] };
    return {
      ok: true,
      imported: true,
      source_hash: preview.source.sha256,
      operation_id: preview.operation_id,
      project: projectResult,
      artifact_results: artifactResult.artifacts,
      warnings: [...(preview.warnings || []), ...(artifactResult.warnings || [])],
      investigation_queue: preview.investigation_queue,
      evidence_candidates: preview.evidence_candidates,
      mappings: preview.mappings,
    };
  }

  return Object.freeze({
    V1_ADAPTER_VERSION,
    sourceFile: (workspace) => sourcePathFor(path, workspace),
    preview: buildPreview,
    import: importLegacy,
  });
}

module.exports = Object.freeze({ createProjectMemoryV1Adapter, V1_ADAPTER_VERSION });
