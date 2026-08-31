"use strict";

const nodeCrypto = require("node:crypto");
const { assert } = require("../../../contracts/memory/memory-errors.js");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/memory-identity.js");

const KNOWLEDGE_RELEASE_SCHEMA_VERSION = 1;
const RELEASE_STATES = Object.freeze(["draft", "published", "superseded", "revoked"]);
const MAX_PROCEDURES = 2_000;
const MAX_STEPS = 100;
const MAX_STRING = 8_000;
const SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret(?:[_-]?value)?|raw[_-]?value|password)$/i;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function assertNoSecretKeys(value, depth = 0) {
  assert(depth <= 10, "MEMORY_PAYLOAD_TOO_DEEP", "Knowledge release data is nested too deeply.");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((entry) => assertNoSecretKeys(entry, depth + 1)); return; }
  for (const [key, child] of Object.entries(value)) {
    assert(!SECRET_KEY.test(String(key)), "MEMORY_SECRET_FIELD", "Raw secret fields are not permitted in Knowledge releases.", { field: String(key) });
    assertNoSecretKeys(child, depth + 1);
  }
}

function text(value, maximum = MAX_STRING) {
  const result = String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim();
  assert(result.length <= maximum, "MEMORY_KB_FIELD_TOO_LARGE", "A Knowledge release field exceeds its maximum length.", { maximum });
  return result;
}

function list(value, maximum = 100, itemMaximum = 500) {
  assert(value === undefined || Array.isArray(value), "MEMORY_KB_LIST_INVALID", "Knowledge release list fields must be arrays.");
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function object(value) {
  assert(value === undefined || (value && typeof value === "object" && !Array.isArray(value)), "MEMORY_KB_OBJECT_INVALID", "Knowledge release metadata must be an object.");
  return value && typeof value === "object" ? clone(value) : {};
}

function hash(value, crypto = nodeCrypto) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function procedureId(value, crypto = nodeCrypto) {
  const digest = hash(value, crypto);
  return `procedure_${digest.slice(0, 32)}`;
}

function normalizeStep(value, index) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : { instruction: value };
  const stepId = text(source.step_id || source.stepId || `step-${index + 1}`, 120);
  const instruction = text(source.instruction || source.action || source.description || "", 4_000);
  assert(instruction, "MEMORY_KB_STEP_INSTRUCTION_REQUIRED", "Every Knowledge procedure step requires an instruction.");
  return {
    step_id: stepId,
    order: index + 1,
    instruction,
    expected: text(source.expected || source.expected_behavior || "", 2_000),
    rejecting: text(source.rejecting || source.rejecting_signal || "", 2_000),
    evidence: list(source.evidence || source.evidence_refs, 30, 400),
    stop_conditions: list(source.stop_conditions || source.stopConditions, 30, 400),
  };
}

function normalizeProcedure(input = {}, { releaseId = "", crypto = nodeCrypto } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_KB_PROCEDURE_INVALID", "A Knowledge procedure must be an object.");
  assertNoSecretKeys(input);
  const source = object(input.source || input.source_metadata);
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, MAX_STEPS).map(normalizeStep) : [];
  assert(steps.length > 0, "MEMORY_KB_STEPS_REQUIRED", "A Knowledge procedure requires at least one step.");
  const base = {
    schema_version: KNOWLEDGE_RELEASE_SCHEMA_VERSION,
    procedure_id: String(input.procedure_id || input.procedureId || "").trim(),
    release_id: String(input.release_id || input.releaseId || releaseId || "").trim(),
    title: text(input.title || input.name || "Untitled procedure", 300),
    objective: text(input.objective || input.summary || "", 2_000),
    prerequisites: list(input.prerequisites, 80),
    target_features: list(input.target_features || input.targetFeatures, 100),
    applicable_technologies: list(input.applicable_technologies || input.technologies, 100),
    required_roles: list(input.required_roles || input.roles, 50),
    steps,
    verification_rule: object(input.verification_rule || input.verificationRule),
    safety_constraints: list(input.safety_constraints || input.safetyConstraints, 80),
    classifications: list(input.classifications || input.tags, 80, 160),
    remediation: text(input.remediation || "", 4_000),
    source_refs: list(input.source_refs || input.sourceRefs, 100, 800),
    aliases: list(input.aliases, 100, 240),
    source: {
      type: text(source.type || source.source_type || "packaged", 80),
      uri: text(source.uri || source.path || source.source || "", 1_000),
      content_hash: text(source.content_hash || source.contentHash || "", 128),
      publisher: text(source.publisher || "", 300),
      license: text(source.license || "", 300),
    },
  };
  if (!base.objective) base.objective = base.title;
  if (base.release_id) assertMemoryId(base.release_id, "kb");
  const unsigned = { ...base, procedure_id: "", release_id: "" };
  const id = base.procedure_id || procedureId(unsigned, crypto);
  assertMemoryId(id, "procedure");
  base.procedure_id = id;
  if (base.release_id) assertMemoryId(base.release_id, "kb");
  return base;
}

function releaseContent(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    schema_version: KNOWLEDGE_RELEASE_SCHEMA_VERSION,
    source: clone(source.source || {}),
    catalogue: clone(source.catalogue || []),
    procedures: clone(source.procedures || []),
  };
}

function createKnowledgeRelease(input = {}, { crypto = nodeCrypto, now = () => new Date() } = {}) {
  assert(input && typeof input === "object" && !Array.isArray(input), "MEMORY_KB_RELEASE_INVALID", "A Knowledge release must be an object.");
  assertNoSecretKeys(input);
  const source = object(input.source || input.source_metadata);
  const proceduresInput = Array.isArray(input.procedures) ? input.procedures : [];
  assert(proceduresInput.length > 0, "MEMORY_KB_PROCEDURES_REQUIRED", "A Knowledge release requires at least one procedure.");
  assert(proceduresInput.length <= MAX_PROCEDURES, "MEMORY_KB_PROCEDURES_TOO_MANY", "A Knowledge release contains too many procedures.", { maximum: MAX_PROCEDURES });
  const provisional = proceduresInput.map((entry) => normalizeProcedure(entry, { crypto }));
  const provisionalCatalog = provisional.map((procedure) => ({
    procedure_id: procedure.procedure_id,
    title: procedure.title,
    objective: procedure.objective,
    classifications: procedure.classifications,
    target_features: procedure.target_features,
    applicable_technologies: procedure.applicable_technologies,
    aliases: procedure.aliases,
  })).sort((left, right) => left.procedure_id.localeCompare(right.procedure_id));
  const content = releaseContent({
    source: {
      type: text(source.type || source.source_type || "packaged", 80),
      name: text(source.name || input.name || "Knowledge release", 300),
      version: text(source.version || input.version || "", 120),
      uri: text(source.uri || source.path || source.source || "", 1_000),
      publisher: text(source.publisher || "", 300),
      license: text(source.license || "", 300),
    },
    catalogue: provisionalCatalog,
    procedures: provisional.sort((left, right) => left.procedure_id.localeCompare(right.procedure_id)),
  });
  const contentHash = hash(content, crypto);
  const releaseId = String(input.release_id || input.releaseId || `kb_${contentHash.slice(0, 32)}`).trim();
  assertMemoryId(releaseId, "kb");
  const procedures = provisional.map((procedure) => ({ ...procedure, release_id: releaseId }));
  const catalogue = procedures.map((procedure) => ({
    procedure_id: procedure.procedure_id,
    title: procedure.title,
    objective: procedure.objective,
    classifications: clone(procedure.classifications),
    target_features: clone(procedure.target_features),
    applicable_technologies: clone(procedure.applicable_technologies),
    aliases: clone(procedure.aliases),
  })).sort((left, right) => left.procedure_id.localeCompare(right.procedure_id));
  const finalContent = releaseContent({ source: content.source, catalogue, procedures });
  const finalHash = hash(finalContent, crypto);
  const suppliedHash = text(input.content_hash || input.contentHash || "", 128);
  assert(!suppliedHash || suppliedHash === finalHash, "MEMORY_KB_HASH_MISMATCH", "Knowledge release content_hash does not match its canonical content.", { expected: finalHash, actual: suppliedHash });
  const stamp = new Date(input.published_at || input.publishedAt || now()).toISOString();
  const release = {
    schema_version: KNOWLEDGE_RELEASE_SCHEMA_VERSION,
    release_id: releaseId,
    content_hash: finalHash,
    state: RELEASE_STATES.includes(String(input.state || "published")) ? String(input.state || "published") : "published",
    created_at: new Date(input.created_at || input.createdAt || stamp).toISOString(),
    published_at: stamp,
    source: clone(content.source),
    catalogue,
    procedures,
    aliases: [...new Set((Array.isArray(input.aliases) ? input.aliases : []).map((entry) => text(entry, 240)).filter(Boolean))].slice(0, 100),
    supersedes: text(input.supersedes || "", 240),
  };
  if (release.supersedes) assertMemoryId(release.supersedes, "kb");
  return deepFreeze(release);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateKnowledgeRelease(input, options = {}) {
  try {
    const release = createKnowledgeRelease(input, options);
    return { ok: true, release };
  } catch (error) {
    return { ok: false, code: error.code || "MEMORY_KB_RELEASE_INVALID", error: error.message, retryable: Boolean(error.retryable), details: error.details || {} };
  }
}

function releaseHash(release, crypto = nodeCrypto) { return hash(releaseContent(release), crypto); }

module.exports = Object.freeze({
  KNOWLEDGE_RELEASE_SCHEMA_VERSION,
  RELEASE_STATES,
  MAX_PROCEDURES,
  MAX_STEPS,
  createKnowledgeRelease,
  validateKnowledgeRelease,
  releaseHash,
  normalizeProcedure,
  releaseContent,
  procedureId,
});
