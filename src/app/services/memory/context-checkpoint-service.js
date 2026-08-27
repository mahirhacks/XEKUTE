"use strict";

const nodeCrypto = require("node:crypto");
const {
  canonicalJson,
  canonicalKeyHash,
  isMemoryId,
} = require("../../../contracts/memory/memory-identity.js");
const { createTranscriptBoundary } = require("../../../contracts/memory/operational-context-contracts.js");
const { redactStructuredValue } = require("../../../shared/secret-redaction.js");

const CONTEXT_CHECKPOINT_SERVICE_VERSION = 1;
const MAX_TAIL_MESSAGES = 40;
const DEFAULT_TAIL_MESSAGES = 12;
const MAX_TAIL_TOKENS = 12_000;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function list(value, maximum = 500) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry, 240)).filter(Boolean))].slice(0, maximum);
}

function messageId(message) { return text(message?.id || message?.messageId || message?.message_id, 240); }

function estimate(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value || "");
  return Math.max(0, Math.ceil(String(raw).length / 4));
}

function blockHash(crypto, blocks) { return crypto.createHash("sha256").update(canonicalJson(blocks), "utf8").digest("hex"); }

function chooseTail(boundaryResult, { maxMessages = DEFAULT_TAIL_MESSAGES, maxTokens = MAX_TAIL_TOKENS } = {}) {
  const messages = Array.isArray(boundaryResult?.messages) ? boundaryResult.messages : [];
  const rows = Array.isArray(boundaryResult?.blocks) ? boundaryResult.blocks : [];
  const count = Math.max(1, Math.min(Number(maxMessages) || DEFAULT_TAIL_MESSAGES, MAX_TAIL_MESSAGES));
  const tokenLimit = Math.max(200, Math.min(Number(maxTokens) || MAX_TAIL_TOKENS, MAX_TAIL_TOKENS));
  let selected = messages.slice(-count).map(clone);
  let usedTokens = estimate(selected);
  while (selected.length > 1 && usedTokens > tokenLimit) {
    selected.shift();
    usedTokens = estimate(selected);
  }
  const firstId = messageId(selected[0]);
  let startBlock = rows.length;
  if (firstId) {
    const index = rows.findIndex((row) => (Array.isArray(row.transcript) ? row.transcript : []).some((message) => messageId(message) === firstId));
    if (index >= 0) startBlock = index;
  }
  const tailRows = startBlock < rows.length ? rows.slice(startBlock).map(clone) : [];
  return { messages: selected, blocks: tailRows, usedTokens, requestedMessages: count };
}

function tailBoundary(boundaryResult, tail, { crypto = nodeCrypto } = {}) {
  const rows = Array.isArray(tail?.blocks) ? tail.blocks : [];
  const messages = rows.flatMap((row) => Array.isArray(row.transcript) ? row.transcript : []);
  const blockIds = rows.map((row) => text(row.blockId)).filter(Boolean);
  const messageIds = messages.map(messageId).filter(Boolean);
  const transcriptHash = blockHash(crypto, rows.map((row) => ({ blockId: row.blockId, transcript: row.transcript })));
  const sourceBoundary = boundaryResult?.boundary || {};
  if (!boundaryResult?.projectId || !boundaryResult?.sessionId) return null;
  return createTranscriptBoundary({
    record_id: `event_${transcriptHash.slice(0, 32)}`,
    project_id: boundaryResult.projectId,
    session_id: boundaryResult.sessionId,
    first_block_id: blockIds[0] || "",
    last_block_id: blockIds.at(-1) || "",
    first_message_id: messageIds[0] || "",
    last_message_id: messageIds.at(-1) || "",
    block_count: rows.length,
    message_count: messages.length,
    transcript_hash: transcriptHash,
    source_revision: Number(sourceBoundary.source_revision || 0),
    status: "sealed",
    block_ids: blockIds,
    message_ids: messageIds,
    created_at: rows[0]?.timeStamp || sourceBoundary.created_at || "1970-01-01T00:00:00.000Z",
    updated_at: rows.at(-1)?.completedAt || rows.at(-1)?.timeStamp || sourceBoundary.updated_at || "1970-01-01T00:00:00.000Z",
    actor: sourceBoundary.actor || { type: "system", id: "context-checkpoint" },
    provenance: sourceBoundary.provenance || { source_type: "runtime_event", source_refs: [`session:${boundaryResult.sessionId}`], captured_at: sourceBoundary.updated_at || "1970-01-01T00:00:00.000Z" },
    sensitivity: "internal",
  });
}

function safeHandleMetadata(sensitiveWorkingMemory, input, projectId, sessionId) {
  const supplied = Array.isArray(input.safeHandleMetadata || input.safe_handle_metadata) ? input.safeHandleMetadata || input.safe_handle_metadata : null;
  if (supplied) return clone(supplied).slice(0, 200).map((handle) => ({
    handle_id: text(handle.handle_id || handle.handleId, 240),
    entry_type: text(handle.entry_type || handle.entryType, 80),
    origin: text(handle.origin, 2_000),
    status: text(handle.status || "unknown", 40),
    expires_at: handle.expires_at || handle.expiresAt || null,
  }));
  if (!sensitiveWorkingMemory?.listHandles || !input.agentId) return [];
  const listed = sensitiveWorkingMemory.listHandles({ projectId, sessionId, agentId: input.agentId, identityId: input.identityId || "" });
  if (!listed?.ok) return [];
  return (listed.handles || []).slice(0, 200).map((entry) => ({
    handle_id: text(entry.handle?.handle_id, 240),
    entry_type: text(entry.handle?.entry_type, 80),
    origin: text(entry.handle?.origin, 2_000),
    status: entry.usable ? "active" : text(entry.handle?.state || "unknown", 40),
    expires_at: entry.handle?.expires_at || null,
  })).filter((entry) => entry.handle_id);
}

function pendingGaps(watermarkResult) {
  if (!watermarkResult) return {};
  if (watermarkResult.ok === false) return { finalization: { status: "unavailable", code: watermarkResult.code || "MEMORY_WATERMARK_UNAVAILABLE" } };
  if (watermarkResult.pending || watermarkResult.satisfied === false) return { finalization: redactStructuredValue({ status: "pending", code: watermarkResult.code || "MEMORY_FINALIZATION_PENDING", gap: watermarkResult.gap || {}, watermark: watermarkResult.watermark || {} }) };
  if (watermarkResult.watermark?.failure_state) return { finalization: redactStructuredValue({ status: "failed", failure: watermarkResult.watermark.failure_state }) };
  return {};
}

function mergeRevisions(input, watermarkResult) {
  const revisions = { ...(input.sourceRevisions || input.source_revisions || {}) };
  const domains = watermarkResult?.watermark?.domain_revisions || {};
  for (const [key, value] of Object.entries(domains)) revisions[key] = Number(value) || 0;
  if (watermarkResult?.watermark?.source_manifest_revision != null) revisions.manifest = Number(watermarkResult.watermark.source_manifest_revision) || 0;
  return revisions;
}

function createContextCheckpointService({
  boundaryService,
  contextStore,
  ledgerService,
  summarizer,
  watermarkStore = null,
  sensitiveWorkingMemory = null,
  crypto = nodeCrypto,
} = {}) {
  if (!boundaryService?.read || !contextStore?.writeCheckpoint || !contextStore?.read) throw new TypeError("Context checkpoint service requires boundary and context stores.");
  if (!ledgerService?.reduceToolEvents || !summarizer?.decideTrigger || !summarizer?.summarize) throw new TypeError("Context checkpoint service requires ledger and summarizer services.");

  async function checkpoint(input = {}) {
    const decision = summarizer.decideTrigger(input);
    if (!decision.shouldSummarize) return { ok: true, checkpointed: false, decision, warnings: [] };
    const boundaryResult = boundaryService.read({
      ...input,
      status: "sealed",
      sourceRevision: input.sourceRevision || input.source_revision || 0,
    });
    if (!boundaryResult.ok) return boundaryResult;
    const projectId = boundaryResult.projectId;
    const sessionId = boundaryResult.sessionId;
    if (!isMemoryId(projectId, "proj")) return { ok: false, code: "MEMORY_PROJECT_ID_INVALID", error: "A protected proj_ project ID is required for context checkpointing." };
    const precedingBlockId = text(input.precedingBlockId || input.preceding_block_id || input.throughBlockId || input.through_block_id || boundaryResult.boundary.last_block_id);
    let watermarkResult = null;
    if (watermarkStore?.waitFor && precedingBlockId) {
      watermarkResult = await watermarkStore.waitFor(input.workspace, projectId, { blockId: precedingBlockId, timeoutMs: 250 });
    }
    const ledger = ledgerService.reduceToolEvents({
      projectId,
      sessionId,
      messages: boundaryResult.messages,
      events: input.events || [],
      actor: input.actor,
      crypto,
    });
    if (!ledger.ok) return ledger;
    const handles = safeHandleMetadata(sensitiveWorkingMemory, input, projectId, sessionId);
    const authoritativeRefs = list([
      ...(input.authoritativeRefs || input.authoritative_refs || []),
      ...(input.retainedRefs || input.retained_refs || []),
      ...ledger.entries.map((entry) => entry.record_id),
      ...ledger.entries.flatMap((entry) => entry.representative_artifact_refs || []),
    ]);
    const gaps = pendingGaps(watermarkResult);
    const summary = await summarizer.summarize({
      ...input,
      projectId,
      sessionId,
      recordId: input.synopsisId || input.synopsis_id || boundaryResult.boundary.record_id,
      boundaryId: boundaryResult.boundary.record_id,
      reason: decision.trigger,
      messages: boundaryResult.messages,
      toolLedger: ledger.entries,
      authoritativeRefs,
      sourceRecordIds: authoritativeRefs,
      pendingGaps: gaps,
      actor: input.actor || boundaryResult.boundary.actor,
      provenance: input.provenance || boundaryResult.boundary.provenance,
      createdAt: boundaryResult.boundary.created_at,
      updatedAt: boundaryResult.boundary.updated_at,
    });
    if (!summary.ok || !summary.synopsis) return summary;
    const tail = chooseTail(boundaryResult, { maxMessages: input.recentTailMessageCount || input.recent_tail_message_count, maxTokens: input.recentTailTokenBudget || input.recent_tail_token_budget });
    const tailMeta = tailBoundary(boundaryResult, tail, { crypto });
    const sourceRevisions = mergeRevisions(input, watermarkResult);
    const checkpointId = input.checkpointId || input.checkpoint_id || `event_${canonicalKeyHash({ projectId, sessionId, boundary: boundaryResult.boundary.transcript_hash, trigger: decision.trigger, ledger: ledger.reductionHash, revisions: sourceRevisions }).slice(0, 32)}`;
    const checkpointInput = {
      record_id: checkpointId,
      operation_id: input.operationId || input.operation_id,
      project_id: projectId,
      session_id: sessionId,
      expectedRevision: input.expectedRevision ?? input.expected_revision,
      trigger: decision.trigger,
      objective: input.objective || summary.synopsis.objective,
      completion_criteria: input.completionCriteria || input.completion_criteria || [],
      operator_constraints: input.operatorConstraints || input.operator_constraints || summary.synopsis.constraints,
      decisions: input.decisions || summary.synopsis.decisions,
      mode: input.mode || "agent",
      phase: input.phase || "",
      active_investigations: input.activeInvestigations || input.active_investigations || [],
      active_processes: input.activeProcesses || input.active_processes || [],
      blockers: input.blockers || summary.synopsis.blockers,
      unresolved_questions: input.unresolvedQuestions || input.unresolved_questions || summary.synopsis.unresolved_questions,
      next_actions: input.nextActions || input.next_actions || summary.synopsis.next_actions,
      retained_refs: authoritativeRefs,
      source_revisions: sourceRevisions,
      known_gaps: [...(input.knownGaps || input.known_gaps || []), ...summary.synopsis.known_gaps],
      safe_handle_metadata: handles,
      synopsis: summary.synopsis,
      tool_ledger: ledger.entries,
      pending_gaps: gaps,
      transcript_boundary: boundaryResult.boundary,
      recent_tail_boundary: tailMeta,
      actor: input.actor || boundaryResult.boundary.actor,
      provenance: input.provenance || boundaryResult.boundary.provenance,
      sensitivity: "internal",
    };
    const stored = await contextStore.writeCheckpoint(checkpointInput);
    if (!stored.ok) return stored;

    // Re-read the same source boundary after activation. A concurrent append
    // that landed after the frozen read is merged by message ID exactly once;
    // the canonical transcript itself remains owned by Session Memory.
    const latestBoundary = boundaryService.read({
      ...input,
      status: "sealed",
      sourceRevision: input.sourceRevision || input.source_revision || 0,
    });
    let late = { ok: true, changed: false, mergedMessageIds: [] };
    if (latestBoundary.ok && latestBoundary.boundary.transcript_hash !== boundaryResult.boundary.transcript_hash) {
      const sourceIds = new Set(boundaryResult.boundary.message_ids || []);
      const newMessages = latestBoundary.messages.filter((message) => !sourceIds.has(messageId(message)));
      late = await contextStore.mergeLate({
        projectId,
        sessionId,
        boundary: latestBoundary.boundary,
        messages: newMessages,
      });
      if (!late.ok) return { ...stored, lateMerge: late, warnings: ["Checkpoint activated, but a concurrent transcript append could not be merged."] };
    }
    const active = contextStore.read({ projectId, sessionId });
    return {
      ok: true,
      checkpointed: true,
      decision,
      sourceBoundary: clone(boundaryResult.boundary),
      watermark: clone(watermarkResult),
      ledger: clone(ledger),
      synopsis: clone(summary.synopsis),
      tail: { messages: clone(tail.messages), boundary: clone(tailMeta), usedTokens: tail.usedTokens },
      pendingGaps: gaps,
      lateMerge: clone(late),
      stored,
      active,
      warnings: [...(summary.warnings || []), ...(stored.warnings || [])],
    };
  }

  function read(input = {}) {
    const active = contextStore.read(input);
    if (!active.ok) return active;
    const boundary = input.workspace && input.sessionId ? boundaryService.read({ ...input, status: "open" }) : null;
    const tail = boundary?.ok ? chooseTail(boundary, input) : { messages: [], blocks: [], usedTokens: 0 };
    return { ...active, currentBoundary: boundary?.ok ? clone(boundary.boundary) : null, recentTail: clone(tail.messages), recentTailTokens: tail.usedTokens };
  }

  function status(input = {}) {
    const active = contextStore.status ? contextStore.status(input) : contextStore.read(input);
    if (!active.ok) return active;
    return { ok: true, version: CONTEXT_CHECKPOINT_SERVICE_VERSION, ...active };
  }

  return Object.freeze({
    CONTEXT_CHECKPOINT_SERVICE_VERSION,
    checkpoint,
    createCheckpoint: checkpoint,
    read,
    status,
    chooseTail,
    tailBoundary,
  });
}

module.exports = Object.freeze({
  CONTEXT_CHECKPOINT_SERVICE_VERSION,
  chooseTail,
  tailBoundary,
  createContextCheckpointService,
});
