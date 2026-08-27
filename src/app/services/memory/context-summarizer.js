"use strict";

const nodeCrypto = require("node:crypto");
const {
  canonicalKeyHash,
  isMemoryId,
} = require("../../../contracts/memory/memory-identity.js");
const {
  createConversationSynopsis,
  validateSynopsis,
} = require("../../../contracts/memory/operational-context-contracts.js");
const { assertNoSecretKeys } = require("../../storage/memory/memory-storage-utils.js");
const { redactSecrets, redactStructuredValue } = require("../../../shared/secret-redaction.js");

const CONTEXT_SUMMARIZER_VERSION = 1;
const PRESSURE_BANDS = Object.freeze({ prepare: 0.55, compress: 0.70, urgent: 0.82, emergency: 0.90 });
const CONTINUITY_REASONS = new Set(["handoff", "close", "model_change", "explicit", "recovery"]);
const ALL_TRIGGERS = new Set(["prepare", "compress", "urgent", "emergency", ...CONTINUITY_REASONS]);
const SYNOPSIS_FIELDS = new Set([
  "version", "record_id", "project_id", "session_id", "boundary_id", "generated_by",
  "objective", "constraints", "decisions", "blockers", "unresolved_questions",
  "next_actions", "known_gaps", "retained_refs", "source_message_ids", "source_record_ids",
  "validation", "content_hash", "created_at", "updated_at", "actor", "provenance", "sensitivity",
  "schema_version", "memory_type", "record_type",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maximum);
}

function list(value, maximum = 200, itemMaximum = 2_000) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry, itemMaximum))
    .filter(Boolean))].slice(0, maximum);
}

function pressureOf(input = {}) {
  const supplied = Number(input.pressure);
  if (Number.isFinite(supplied) && supplied >= 0) return supplied;
  const used = Number(input.usedTokens ?? input.used_tokens);
  const capacity = Number(input.capacityTokens ?? input.capacity_tokens);
  return Number.isFinite(used) && Number.isFinite(capacity) && capacity > 0 ? Math.max(0, used / capacity) : 0;
}

function normalizeTrigger(value) {
  const reason = text(value, 80).toLowerCase();
  if (reason === "block_completed" || reason === "block_complete" || reason === "ordinary_block") return "normal";
  return ALL_TRIGGERS.has(reason) ? reason : "";
}

function decideTrigger(input = {}) {
  const pressure = pressureOf(input);
  const explicit = normalizeTrigger(input.reason || input.trigger || input.event);
  const force = Boolean(input.force || input.explicit);
  if (explicit === "normal") {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "normal", pressure, shouldSummarize: false, modelAllowed: true, reason: "ordinary_block_completion" };
  }
  if (explicit === "emergency" || pressure >= PRESSURE_BANDS.emergency) {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "emergency", pressure, shouldSummarize: true, modelAllowed: false, reason: explicit === "emergency" ? "explicit_emergency" : "context_pressure_emergency" };
  }
  if (explicit && CONTINUITY_REASONS.has(explicit)) {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: explicit, pressure, shouldSummarize: true, modelAllowed: true, reason: `continuity_${explicit}` };
  }
  if (pressure >= PRESSURE_BANDS.urgent) {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "urgent", pressure, shouldSummarize: true, modelAllowed: true, reason: "context_pressure_urgent" };
  }
  if (pressure >= PRESSURE_BANDS.compress || force || explicit === "compress") {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "compress", pressure, shouldSummarize: true, modelAllowed: true, reason: force ? "explicit_compress" : "context_pressure_compress" };
  }
  if (pressure >= PRESSURE_BANDS.prepare || explicit === "prepare") {
    return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "prepare", pressure, shouldSummarize: false, modelAllowed: true, reason: "context_pressure_prepare" };
  }
  return { ok: true, version: CONTEXT_SUMMARIZER_VERSION, trigger: "normal", pressure, shouldSummarize: false, modelAllowed: true, reason: "below_summary_threshold" };
}

function safeIso(value, fallback = "1970-01-01T00:00:00.000Z") {
  const date = new Date(String(value || fallback));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function messageId(message) { return text(message?.id || message?.messageId || message?.message_id, 240); }

function safeMessage(message) {
  const role = text(message?.role || "message", 40).toLowerCase();
  const result = {
    id: messageId(message),
    role,
    createdAt: safeIso(message?.createdAt || message?.created_at || message?.timestamp),
  };
  if (role === "tool") {
    result.toolName = text(message?.tool_name || message?.toolName || message?.name || "tool", 160);
    result.content = "[tool result omitted; see deterministic tool ledger and artifact references]";
  } else {
    result.content = redactSecrets(text(message?.content ?? message?.text ?? "", 4_000));
  }
  return result;
}

function safeLedgerEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  return {
    recordId: text(entry.record_id || entry.recordId || entry.ledger_id || entry.ledgerId, 240),
    category: text(entry.category || "tool", 40),
    toolName: text(entry.tool_name || entry.toolName || "tool", 160),
    targetKey: redactSecrets(text(entry.target_key || entry.targetKey, 2_000)),
    identityRef: text(entry.identity_ref || entry.identityRef, 240),
    role: text(entry.role, 160),
    authState: text(entry.auth_state || entry.authState, 160),
    terminalOutcome: text(entry.terminal_outcome || entry.terminalOutcome || entry.outcome, 80),
    status: text(entry.status, 80),
    responseSchemaHash: text(entry.response_schema_hash || entry.responseSchemaHash, 64),
    variationFlags: list(entry.variation_flags || entry.variationFlags, 50, 80),
    count: Math.max(1, Number(entry.count) || 1),
    failureCount: Math.max(0, Number(entry.failure_count || entry.failureCount) || 0),
    retryCount: Math.max(0, Number(entry.retry_count || entry.retryCount) || 0),
    omittedCount: Math.max(0, Number(entry.omitted_count || entry.omittedCount) || 0),
    artifactRefs: list(entry.representative_artifact_refs || entry.representativeArtifactRefs, 100, 240),
    sourceMessageIds: list(entry.source_message_ids || entry.sourceMessageIds, 100, 240),
  };
}

function buildSafeModelInput(input = {}) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .filter((message) => message && typeof message === "object")
    .slice(-500)
    .map(safeMessage);
  const ledger = (Array.isArray(input.toolLedger || input.tool_ledger) ? input.toolLedger || input.tool_ledger : [])
    .map(safeLedgerEntry).filter(Boolean).slice(-500);
  const authoritativeRefs = list(input.authoritativeRefs || input.authoritative_refs || input.retainedRefs || input.retained_refs, 500, 240);
  const sourceRecordIds = list(input.sourceRecordIds || input.source_record_ids || authoritativeRefs, 500, 240);
  const sourceMessageIds = list(input.sourceMessageIds || input.source_message_ids || messages.map(messageId), 500, 240);
  const safeInput = redactStructuredValue({
    version: CONTEXT_SUMMARIZER_VERSION,
    objective: redactSecrets(text(input.objective, 8_000)),
    constraints: list(input.constraints || input.operatorConstraints || input.operator_constraints, 100),
    previousSynopsis: input.previousSynopsis && typeof input.previousSynopsis === "object" ? redactStructuredValue(input.previousSynopsis) : null,
    messages,
    toolLedger: ledger,
    authoritativeRefs,
    sourceRecordIds,
    sourceMessageIds,
    knownGaps: list(input.knownGaps || input.known_gaps, 200),
    requiredSourceMessageIds: list(input.requiredSourceMessageIds || input.required_source_message_ids || sourceMessageIds, 500, 240),
  });
  assertNoSecretKeys(safeInput);
  return safeInput;
}

function parseModelOutput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return clone(value);
  const raw = String(value == null ? "" : value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(raw); } catch { return null; }
}

function validateModelShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "MEMORY_CONTEXT_SYNOPSIS_SHAPE_INVALID", error: "The synopsis must be a JSON object." };
  const unknown = Object.keys(value).filter((key) => !SYNOPSIS_FIELDS.has(key));
  if (unknown.length) return { ok: false, code: "MEMORY_CONTEXT_SYNOPSIS_UNKNOWN_FIELD", error: "The synopsis contains fields outside the continuity schema.", details: { unknown } };
  return { ok: true };
}

function defaultRefs(input, safeInput) {
  return list(input.authoritativeRefs || input.authoritative_refs || input.retainedRefs || input.retained_refs || safeInput.authoritativeRefs, 500, 240);
}

function createDeterministicSynopsis(input = {}, safeInput = buildSafeModelInput(input), trigger = "compress") {
  const sourceMessageIds = list(safeInput.sourceMessageIds || (safeInput.messages || []).map(messageId), 500, 240);
  const required = list(input.requiredSourceMessageIds || input.required_source_message_ids || sourceMessageIds, 500, 240);
  const userMessages = (safeInput.messages || []).filter((message) => message.role === "user" && message.content).map((message) => message.content);
  const objective = text(input.objective || userMessages.at(-1) || "Continue from the latest validated session state.", 20_000);
  const explicitDecisions = list(input.decisions, 200);
  const assistantDecisions = (safeInput.messages || [])
    .filter((message) => message.role === "assistant" && message.content)
    .slice(-10)
    .map((message) => `[assistant-unverified] ${text(message.content, 1_600)}`);
  const decisions = [...new Set([...explicitDecisions, ...assistantDecisions])].slice(-200);
  const provenanceRefs = list([
    ...(Array.isArray(input.provenance?.source_refs) ? input.provenance.source_refs : []),
    ...sourceMessageIds.map((id) => `message:${id}`),
    ...defaultRefs(input, safeInput).map((ref) => `ref:${ref}`),
  ], 100, 240);
  const projectId = text(input.projectId || input.project_id);
  const sessionId = text(input.sessionId || input.session_id);
  if (!isMemoryId(projectId, "proj")) throw Object.assign(new Error("A protected proj_ project ID is required for a synopsis."), { code: "MEMORY_PROJECT_ID_INVALID" });
  return createConversationSynopsis({
    record_id: input.recordId || input.record_id,
    project_id: projectId,
    session_id: sessionId,
    boundary_id: input.boundaryId || input.boundary_id || "",
    generated_by: "deterministic",
    objective,
    constraints: list(input.constraints || input.operatorConstraints || input.operator_constraints || safeInput.constraints, 100),
    decisions,
    blockers: list(input.blockers, 200),
    unresolved_questions: list(input.unresolvedQuestions || input.unresolved_questions, 200),
    next_actions: list(input.nextActions || input.next_actions, 200),
    known_gaps: list([...safeInput.knownGaps || [], ...(input.pendingGaps ? ["Memory finalization is pending before all shared revisions are current."] : [])], 200),
    retained_refs: defaultRefs(input, safeInput),
    source_message_ids: sourceMessageIds,
    source_record_ids: defaultRefs(input, safeInput),
    validation: { mode: "deterministic", trigger, required_source_message_count: required.length },
    created_at: input.createdAt || input.created_at || "1970-01-01T00:00:00.000Z",
    updated_at: input.updatedAt || input.updated_at || input.createdAt || input.created_at || "1970-01-01T00:00:00.000Z",
    actor: input.actor || { type: "system", id: "context-summarizer" },
    provenance: input.provenance || { source_type: "runtime_event", source_refs: provenanceRefs, captured_at: "1970-01-01T00:00:00.000Z" },
    sensitivity: "internal",
  });
}

function normalizeValidatedSynopsis(raw, input, safeInput, trigger) {
  const shape = validateModelShape(raw);
  if (!shape.ok) return shape;
  const sourceRecordIds = list(raw.source_record_ids || raw.sourceRecordIds || [], 500, 240);
  const retainedRefs = list(raw.retained_refs || raw.retainedRefs || [], 500, 240);
  const sourceMessageIds = list(raw.source_message_ids || raw.sourceMessageIds || [], 500, 240);
  const allowedRefs = defaultRefs(input, safeInput);
  const required = list(input.requiredSourceMessageIds || input.required_source_message_ids || safeInput.requiredSourceMessageIds, 500, 240);
  try {
    const synopsis = validateSynopsis({
      ...raw,
      record_id: input.recordId || input.record_id || "",
      project_id: input.projectId || input.project_id,
      session_id: input.sessionId || input.session_id,
      boundary_id: input.boundaryId || input.boundary_id || raw.boundary_id || "",
      generated_by: "model",
      content_hash: "",
      created_at: input.createdAt || input.created_at || "1970-01-01T00:00:00.000Z",
      updated_at: input.updatedAt || input.updated_at || input.createdAt || input.created_at || "1970-01-01T00:00:00.000Z",
      source_record_ids: sourceRecordIds,
      retained_refs: retainedRefs,
      source_message_ids: sourceMessageIds,
      actor: input.actor || { type: "system", id: "context-summarizer" },
      provenance: input.provenance || { source_type: "runtime_event", source_refs: [`synopsis:${canonicalKeyHash({ projectId: input.projectId || input.project_id, sessionId: input.sessionId || input.session_id })}`], captured_at: "1970-01-01T00:00:00.000Z" },
      sensitivity: "internal",
      validation: { ...(raw.validation && typeof raw.validation === "object" ? raw.validation : {}), mode: "model", trigger },
    }, { allowedRefs, requiredSourceMessageIds: required });
    return { ok: true, synopsis };
  } catch (error) {
    return { ok: false, code: error.code || "MEMORY_CONTEXT_SYNOPSIS_INVALID", error: error.message || "The model synopsis failed validation.", details: error.details || {} };
  }
}

function createContextSummarizer({ modelSummarizer = null, crypto = nodeCrypto } = {}) {
  if (!crypto?.createHash) throw new TypeError("Context summarizer requires crypto.");

  async function summarize(input = {}) {
    const decision = decideTrigger(input);
    if (!decision.ok) return decision;
    if (!decision.shouldSummarize) return { ok: true, summarized: false, decision, synopsis: null, warnings: [] };
    let safeInput;
    try { safeInput = buildSafeModelInput(input); } catch (error) {
      return { ok: false, code: error.code || "MEMORY_CONTEXT_SUMMARY_INPUT_INVALID", error: error.message || "Summary input could not be made safe." };
    }
    let deterministic;
    try { deterministic = createDeterministicSynopsis(input, safeInput, decision.trigger); } catch (error) {
      return { ok: false, code: error.code || "MEMORY_CONTEXT_SUMMARY_FALLBACK_FAILED", error: error.message || "Deterministic summary fallback failed." };
    }
    if (decision.trigger === "emergency" || typeof modelSummarizer !== "function") {
      return { ok: true, summarized: true, source: "deterministic", decision, synopsis: deterministic, safeInput, warnings: decision.trigger === "emergency" ? ["Emergency summarization bypassed optional model synthesis."] : ["No synopsis model was configured; deterministic fallback was used."] };
    }
    try {
      const raw = await modelSummarizer({
        input: clone(safeInput),
        schema: "ConversationSynopsisV1",
        prompt: JSON.stringify(safeInput),
        trigger: decision.trigger,
      });
      const parsed = parseModelOutput(raw);
      const validated = normalizeValidatedSynopsis(parsed, input, safeInput, decision.trigger);
      if (validated.ok) return { ok: true, summarized: true, source: "model", decision, synopsis: validated.synopsis, safeInput, warnings: [] };
      return { ok: true, summarized: true, source: "deterministic", decision, synopsis: deterministic, safeInput, warnings: [validated.error || "The model synopsis failed validation; deterministic fallback was used."] };
    } catch (error) {
      return { ok: true, summarized: true, source: "deterministic", decision, synopsis: deterministic, safeInput, warnings: [`Model synopsis failed; deterministic fallback was used: ${error.message || "provider failure"}.`] };
    }
  }

  return Object.freeze({
    CONTEXT_SUMMARIZER_VERSION,
    PRESSURE_BANDS,
    decideTrigger,
    buildSafeModelInput,
    createDeterministicSynopsis,
    validateModelShape,
    normalizeValidatedSynopsis,
    summarize,
  });
}

module.exports = Object.freeze({
  CONTEXT_SUMMARIZER_VERSION,
  PRESSURE_BANDS,
  decideTrigger,
  buildSafeModelInput,
  createDeterministicSynopsis,
  validateModelShape,
  normalizeValidatedSynopsis,
  createContextSummarizer,
});
