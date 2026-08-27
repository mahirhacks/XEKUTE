"use strict";

const nodeCrypto = require("node:crypto");
const {
  createContextAssemblyRequest,
  createContextAssemblyPacket,
} = require("../../../contracts/memory/context-assembly-contracts.js");
const { assertMemoryId } = require("../../../contracts/memory/memory-identity.js");
const { operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");
const { redactStructuredValue } = require("../../../shared/secret-redaction.js");
const {
  classifyObjective,
  policyFor,
  budgetForPolicy,
  limitForPolicy,
  DOMAIN_ORDER,
} = require("./context-assembly-policy.js");
const { createContextBudgetAllocator } = require("./context-budget-allocator.js");

const CONTEXT_ASSEMBLY_SERVICE_VERSION = 1;
const MAX_RECENT_TAIL_MESSAGES = 40;
const MAX_CHECKPOINT_CHARS = 40_000;
const UNSAFE_KEY = /^(?:raw(?:[_-].*)?|body|request[_-]?body|response[_-]?body|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|access[_-]?token|refresh[_-]?token|csrf[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|password|secret(?:[_-].*)?)$/i;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function estimate(value) { return Math.max(0, Math.ceil(Buffer.byteLength(JSON.stringify(value == null ? null : value), "utf8") / 4)); }
function unique(values, maximum = 500) { return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 500)).filter(Boolean))].slice(0, maximum); }

function recordIdOf(record) {
  return text(record?.record_id || record?.recordId || record?.id || record?.record?.record_id || record?.record?.id, 240);
}

function safeValue(value, { depth = 0, artifact = false } = {}) {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return text(redactStructuredValue(value), 8_000);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => safeValue(entry, { depth: depth + 1, artifact }));
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    if (UNSAFE_KEY.test(key) || (artifact && /^(?:content|data|text|value)$/i.test(key))) continue;
    result[text(key, 120)] = safeValue(child, { depth: depth + 1, artifact });
  }
  return redactStructuredValue(result);
}

function boundedRecentTail(input, tokenBudget) {
  const source = Array.isArray(input) ? input : [];
  const budget = Math.max(0, Number(tokenBudget) || 0);
  const selected = [];
  let used = 0;
  for (const message of source.slice(-MAX_RECENT_TAIL_MESSAGES).reverse()) {
    const safe = safeValue({
      id: message?.id || message?.messageId || "",
      role: text(message?.role || "", 40),
      name: text(message?.name || "", 120),
      content: text(message?.content || "", 12_000),
      tool_calls: message?.tool_calls ? safeValue(message.tool_calls) : undefined,
    });
    const cost = estimate(safe);
    if (selected.length && used + cost > budget) break;
    if (!selected.length && cost > budget && budget > 0) {
      safe.content = text(safe.content, Math.max(200, budget * 4));
    }
    if (!budget || used + estimate(safe) > budget) break;
    used += estimate(safe);
    selected.unshift(safe);
  }
  return { messages: selected, usedTokens: used, omittedMessages: Math.max(0, source.length - selected.length) };
}

function safeCheckpoint(value, tokenBudget) {
  if (!value || typeof value !== "object") return null;
  const source = value.checkpoint && typeof value.checkpoint === "object" ? value.checkpoint : value;
  const projected = safeValue({
    record_id: source.record_id,
    revision: source.revision,
    trigger: source.trigger,
    objective: source.objective,
    completion_criteria: source.completion_criteria,
    operator_constraints: source.operator_constraints,
    decisions: source.decisions,
    mode: source.mode,
    phase: source.phase,
    active_investigations: source.active_investigations,
    active_processes: source.active_processes,
    blockers: source.blockers,
    unresolved_questions: source.unresolved_questions,
    next_actions: source.next_actions,
    retained_refs: source.retained_refs,
    source_revisions: source.source_revisions,
    known_gaps: source.known_gaps,
    safe_handle_metadata: source.safe_handle_metadata,
    synopsis: source.synopsis,
    tool_ledger: source.tool_ledger,
    pending_gaps: source.pending_gaps,
    transcript_boundary: source.transcript_boundary,
    recent_tail_boundary: source.recent_tail_boundary,
  });
  const maximum = Math.max(0, Number(tokenBudget) || 0) * 4;
  if (maximum <= 0) return null;
  const serialized = JSON.stringify(projected);
  if (serialized.length <= maximum) return projected;
  // A checkpoint remains useful when its bulky optional lists are omitted;
  // authoritative IDs, revisions, blockers, and next actions stay visible.
  const compact = {
    record_id: source.record_id,
    revision: source.revision,
    trigger: source.trigger,
    objective: text(source.objective, 1_000),
    decisions: Array.isArray(source.decisions) ? source.decisions.slice(-20).map((entry) => safeValue(entry)) : [],
    blockers: Array.isArray(source.blockers) ? source.blockers.slice(-20).map((entry) => safeValue(entry)) : [],
    unresolved_questions: Array.isArray(source.unresolved_questions) ? source.unresolved_questions.slice(-20).map((entry) => safeValue(entry)) : [],
    next_actions: Array.isArray(source.next_actions) ? source.next_actions.slice(-20).map((entry) => safeValue(entry)) : [],
    retained_refs: unique(source.retained_refs),
    source_revisions: safeValue(source.source_revisions || {}),
    known_gaps: Array.isArray(source.known_gaps) ? source.known_gaps.slice(-20).map((entry) => safeValue(entry)) : [],
    synopsis: safeValue(source.synopsis || {}),
  };
  return JSON.stringify(compact).length <= maximum ? compact : { record_id: text(source.record_id, 240), revision: Number(source.revision) || 0, retained_refs: unique(source.retained_refs) };
}

function resolveProjectId(input, projectIdentityStore) {
  const requested = text(input.project_id || input.projectId, 240);
  if (requested) {
    try { return assertMemoryId(requested, "proj"); } catch (error) { return { error }; }
  }
  const workspace = text(input.workspace, 32_768);
  if (!workspace || typeof projectIdentityStore?.resolveProject !== "function") return { error: Object.assign(new Error("A protected project ID is required for Context Assembly."), { code: "MEMORY_PROJECT_ID_REQUIRED" }) };
  const resolved = projectIdentityStore.resolveProject(workspace, { persist: false });
  if (!resolved?.ok || !resolved.projectId) return { error: Object.assign(new Error("The workspace is not bound to a protected project ID."), { code: "MEMORY_PROJECT_ID_REQUIRED" }) };
  try { return assertMemoryId(resolved.projectId, "proj"); } catch (error) { return { error }; }
}

function statusFrom({ pending = false, unavailable = false, stale = false, degraded = false } = {}) {
  if (unavailable) return "unavailable";
  if (pending) return "pending";
  if (stale) return "stale";
  if (degraded) return "degraded";
  return "current";
}

function createContextAssemblyService({
  retrievalService,
  checkpointProvider = null,
  watermarkStore = null,
  projectIdentityStore = null,
  sensitiveWorkingMemory = null,
  tokenEstimator = estimate,
  budgetAllocator = null,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!retrievalService?.query) throw new TypeError("Context Assembly requires a retrieval service.");
  if (!crypto?.createHash) throw new TypeError("Context Assembly requires crypto.");
  const allocator = budgetAllocator || createContextBudgetAllocator({ estimate: tokenEstimator });

  function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }

  async function currentWatermark(workspace, projectId, precedingBlockId) {
    if (precedingBlockId && watermarkStore?.waitFor) return watermarkStore.waitFor(workspace, projectId, { blockId: precedingBlockId, timeoutMs: 250 });
    if (watermarkStore?.status) return watermarkStore.status(workspace, projectId);
    return { ok: true, satisfied: true, pending: false, watermark: null };
  }

  async function queryDomain(request, classification, policy, domain, budget) {
    const result = await retrievalService.query({
      workspace: request.workspace,
      project_id: request.project_id,
      objective: request.objective,
      domains: [domain],
      filters: request.filters,
      source_revisions: request.source_revisions,
      limit: limitForPolicy(policy, domain),
      cursor: request.cursor,
      token_budget: Math.max(0, budget),
      sensitivity_ceiling: request.sensitivity_ceiling || policy.sensitivityCeiling,
      graph_depth: Math.min(request.graph_depth, policy.graphDepth),
      expand_artifacts: Boolean(request.expand_artifacts && policy.expandArtifacts),
      include_provenance: request.include_provenance,
    });
    if (!result?.ok) return result;
    const records = (Array.isArray(result.records) ? result.records : []).map((entry) => ({
      ...entry,
      record: safeValue(entry.record, { artifact: domain === "artifact" }),
      provenance: safeValue(entry.provenance),
    }));
    const includedTokens = Math.max(0, Number(result.token_accounting?.used_tokens || 0) || tokenEstimator(records));
    return {
      ok: true,
      records,
      omitted: safeValue(result.omitted || []),
      sourceRevision: Number(result.source_revisions?.[domain] ?? result.source_revision ?? 0) || 0,
      staleness: text(result.staleness || "current", 40),
      tokenAccounting: {
        requested_tokens: Math.max(0, budget),
        included_tokens: Math.min(Math.max(0, budget), includedTokens),
        omitted_tokens: Math.max(0, Number(result.token_accounting?.omitted_tokens || 0) || 0),
      },
      warnings: safeValue(result.warnings || []),
    };
  }

  async function assemble(input = {}) {
    const resolved = resolveProjectId(input, projectIdentityStore);
    if (resolved?.error) return operationFailure(resolved.error.code || "MEMORY_PROJECT_ID_REQUIRED", resolved.error.message, resolved.error.details || {});
    let request;
    try {
      request = createContextAssemblyRequest({ ...input, project_id: resolved });
    } catch (error) {
      return operationFailure(error.code || "MEMORY_CONTEXT_REQUEST_INVALID", error.message, error.details || {});
    }
    const classification = classifyObjective({ objective: request.objective, mode: request.mode });
    const policy = policyFor(classification.kind);
    const promptBudget = request.prompt_budget_tokens == null ? request.token_budget : request.prompt_budget_tokens;
    const authorityRequested = Math.max(
      request.authority_minimum_tokens,
      Number(input.authorityTokens ?? input.authority_tokens ?? 0) || 0,
    );
    const optionalBudget = Math.max(0, promptBudget - request.response_reserve_tokens - authorityRequested);
    const requestedBudgets = {
      authority: authorityRequested,
      ...budgetForPolicy(policy, optionalBudget),
    };
    const allocation = allocator.allocate({
      contextWindowTokens: input.contextWindowTokens ?? input.context_window_tokens,
      promptBudgetTokens: promptBudget,
      responseReserveTokens: request.response_reserve_tokens,
      authorityMinimumTokens: request.authority_minimum_tokens,
      requested: requestedBudgets,
      priority: ["checkpoint", "recent_tail", ...policy.domains, ...DOMAIN_ORDER],
    });
    if (!allocation.ok) return operationFailure("MEMORY_CONTEXT_BUDGET_UNAVAILABLE", "Required Context Assembly reservations do not fit within the provider context budget.", { warnings: allocation.warnings, allocation }, true);
    const budgets = allocation.allocations;
    const workspace = text(input.workspace, 32_768);
    if (!workspace) return operationFailure("MEMORY_CONTEXT_WORKSPACE_REQUIRED", "A workspace is required for Context Assembly.");

    let watermark;
    try { watermark = await currentWatermark(workspace, request.project_id, request.preceding_block_id); }
    catch (error) { watermark = operationFailure("MEMORY_WATERMARK_UNAVAILABLE", error.message, {}, true); }
    const watermarkValue = watermark?.watermark || null;
    const pending = Boolean(watermark?.pending || watermark?.satisfied === false);
    const warnings = [];
    if (watermark?.ok === false) warnings.push({ code: watermark.code || "MEMORY_WATERMARK_UNAVAILABLE", message: watermark.error || "Finalization watermark unavailable." });
    if (pending) warnings.push({ code: "MEMORY_FINALIZATION_PENDING", gap: safeValue(watermark.gap || {}) });

    const checkpointState = checkpointProvider?.read
      ? await Promise.resolve(checkpointProvider.read({ workspace, projectId: request.project_id, sessionId: request.session_id }))
      : { ok: true, checkpoint: null, revision: 0, initialized: false };
    if (checkpointState?.ok === false) warnings.push({ code: checkpointState.code || "MEMORY_CHECKPOINT_UNAVAILABLE", message: checkpointState.error || "Operational Context checkpoint unavailable." });
    const checkpointBudget = budgets.checkpoint || 0;
    const tailBudget = budgets.recent_tail || 0;
    const checkpointRecord = safeCheckpoint(checkpointState, checkpointBudget);
    const tail = boundedRecentTail(checkpointState?.recentTail || checkpointState?.recent_tail || [], tailBudget);
    const sections = {};
    if (classification.domains.includes("checkpoint")) {
      sections.checkpoint = {
        records: checkpointRecord ? [{ domain: "checkpoint", record_id: checkpointRecord.record_id || `event_${hash(checkpointRecord).slice(0, 32)}`, record_type: "checkpoint", sensitivity: "internal", source_revision: Number(checkpointState?.revision || checkpointRecord.revision || 0), record: checkpointRecord }] : [],
        omitted: checkpointRecord ? [] : [],
        source_revision: Number(checkpointState?.revision || 0) || 0,
        staleness: "current",
        token_accounting: { requested_tokens: checkpointBudget, included_tokens: checkpointRecord ? Math.min(checkpointBudget, estimate(checkpointRecord)) : 0, omitted_tokens: 0 },
      };
    }
    if (classification.domains.includes("recent_tail")) {
      sections.recent_tail = {
        records: tail.messages.map((message) => ({ domain: "recent_tail", record_id: text(message.id || `event_${hash(message).slice(0, 32)}`, 240), record_type: "transcript_message", sensitivity: "internal", source_revision: Number(checkpointState?.revision || 0), record: message })),
        omitted: tail.omittedMessages ? [{ reason: "token_budget", count: tail.omittedMessages }] : [],
        source_revision: Number(checkpointState?.revision || 0) || 0,
        staleness: "current",
        token_accounting: { requested_tokens: tailBudget, included_tokens: tail.usedTokens, omitted_tokens: Math.max(0, estimate(checkpointState?.recentTail || []) - tail.usedTokens) },
      };
    }

    const queryDomains = DOMAIN_ORDER.filter((domain) => classification.domains.includes(domain) && !["checkpoint", "recent_tail"].includes(domain));
    const queried = await Promise.all(queryDomains.map((domain) => queryDomain({ ...request, workspace }, classification, policy, domain, budgets[domain] || 0)));
    let unavailable = false;
    let stale = false;
    let degraded = Boolean(watermark?.ok === false || checkpointState?.ok === false);
    for (let index = 0; index < queryDomains.length; index += 1) {
      const domain = queryDomains[index];
      const result = queried[index];
      if (!result?.ok) {
        unavailable = true;
        degraded = true;
        warnings.push({ code: result?.code || "MEMORY_RETRIEVAL_FAILED", domain, message: result?.error || `${domain} retrieval failed.` });
        sections[domain] = { records: [], omitted: [], source_revision: 0, staleness: "unavailable", token_accounting: { requested_tokens: budgets[domain] || 0, included_tokens: 0, omitted_tokens: budgets[domain] || 0 } };
        continue;
      }
      sections[domain] = {
        records: result.records,
        omitted: result.omitted,
        source_revision: result.sourceRevision,
        staleness: result.staleness,
        token_accounting: result.tokenAccounting,
      };
      if (result.staleness === "stale") stale = true;
      if (result.staleness !== "current" || result.warnings?.length) degraded = true;
      warnings.push(...(Array.isArray(result.warnings) ? result.warnings : []).slice(0, 20));
    }

    const sourceRevisions = { ...request.source_revisions };
    for (const [domain, section] of Object.entries(sections)) sourceRevisions[domain] = Number(section.source_revision || 0);
    const checkpointRevisions = checkpointState?.checkpoint?.source_revisions || checkpointState?.checkpoint?.sourceRevisions || {};
    for (const [domain, expected] of Object.entries(checkpointRevisions)) {
      if (sourceRevisions[domain] !== undefined && Number(sourceRevisions[domain]) < Number(expected)) stale = true;
    }
    if (watermarkValue?.failure_state) degraded = true;
    const state = statusFrom({ pending, unavailable, stale, degraded });
    const includedTokens = Object.values(sections).reduce((sum, section) => sum + Number(section.token_accounting?.included_tokens || 0), 0);
    const omittedTokens = Object.values(sections).reduce((sum, section) => sum + Number(section.token_accounting?.omitted_tokens || 0), 0);
    const sourceManifest = {
      policy_id: policy.id,
      source_revisions: sourceRevisions,
      checkpoint_id: checkpointRecord?.record_id || "",
      checkpoint_revision: Number(checkpointState?.revision || 0) || 0,
      watermark: safeValue(watermarkValue),
      knowledge_release: safeValue(input.knowledgeRelease || input.knowledge_release || null),
      packet_hash: hash({ projectId: request.project_id, sessionId: request.session_id, classification, sourceRevisions, state }),
    };
    const packet = createContextAssemblyPacket({
      project_id: request.project_id,
      session_id: request.session_id,
      objective_classification: classification,
      state,
      source_revisions: sourceRevisions,
      checkpoint_revision: Number(checkpointState?.revision || 0) || 0,
      watermark: safeValue(watermarkValue),
      sections,
      recent_tail: { messages: tail.messages, boundary: safeValue(checkpointState?.checkpoint?.recent_tail_boundary || checkpointState?.checkpoint?.recentTailBoundary || null), omitted_messages: tail.omittedMessages },
      pending_gaps: pending ? { finalization: safeValue(watermark?.gap || watermark) } : {},
      token_accounting: { requested_tokens: allocation.requestedTokens, included_tokens: includedTokens, omitted_tokens: omittedTokens + allocation.omittedTokens },
      omissions: {
        by_domain: Object.fromEntries(Object.entries(sections).map(([domain, section]) => [domain, section.omitted?.length || 0])),
        by_budget_allocator: safeValue(allocation.omitted),
      },
      warnings: [...warnings, ...allocation.warnings],
      source_manifest: sourceManifest,
      assembled_at: timestamp(now),
    });
    return packet;
  }

  async function resume(input = {}) {
    const packet = await assemble(input);
    if (!packet?.ok) return packet;
    const requiredRefs = unique(input.requiredRefs || input.required_refs || []);
    const knownRefs = new Set();
    for (const section of Object.values(packet.sections || {})) {
      for (const record of section.records || []) {
        const id = recordIdOf(record);
        if (id) knownRefs.add(id);
        for (const ref of record?.record?.retained_refs || record?.record?.retainedRefs || []) knownRefs.add(text(ref, 500));
      }
    }
    const checkpointRefs = packet.sections?.checkpoint?.records?.flatMap((entry) => entry?.record?.retained_refs || []) || [];
    checkpointRefs.forEach((ref) => knownRefs.add(text(ref, 500)));
    const unresolvedRefs = requiredRefs.filter((ref) => !knownRefs.has(ref));
    const supersededRefs = [];
    for (const section of Object.values(packet.sections || {})) {
      for (const record of section.records || []) {
        const lifecycle = String(record?.record?.lifecycle_state || record?.record?.state || record?.record?.status || "").toLowerCase();
        if (["superseded", "retracted", "deleted", "expired"].includes(lifecycle)) supersededRefs.push({ ref: recordIdOf(record), state: lifecycle });
      }
    }
    let handleHealth = { status: "not_checked", handles: [], reauthentication_required: false };
    if (sensitiveWorkingMemory?.listHandles && input.agentId) {
      const handles = await Promise.resolve(sensitiveWorkingMemory.listHandles({
        projectId: packet.project_id,
        sessionId: packet.session_id,
        agentId: input.agentId,
        identityId: input.identityId || input.identity_id || "",
      }));
      if (handles?.ok === false) {
        handleHealth = { status: "unavailable", handles: [], reauthentication_required: input.requireAuthentication === true, code: handles.code || "MEMORY_SENSITIVE_STATUS_UNAVAILABLE" };
      } else {
        const safeHandles = (Array.isArray(handles?.handles) ? handles.handles : []).map((entry) => ({
          handle_id: text(entry?.handle?.handle_id, 240),
          entry_type: text(entry?.handle?.entry_type, 80),
          origin: text(entry?.handle?.origin, 2_000),
          state: text(entry?.handle?.state, 40),
          expires_at: text(entry?.handle?.expires_at, 80),
          usable: Boolean(entry?.usable),
        })).filter((entry) => entry.handle_id);
        handleHealth = {
          status: "checked",
          handles: safeHandles,
          active_entry_count: safeHandles.filter((entry) => entry.usable).length,
          reauthentication_required: input.requireAuthentication === true && !safeHandles.some((entry) => entry.usable),
        };
      }
    } else if (input.requireAuthentication === true) {
      handleHealth = { status: "not_checked", handles: [], reauthentication_required: true, code: "MEMORY_SENSITIVE_AGENT_REQUIRED" };
    }
    return {
      ...packet,
      resume: {
        required_refs: requiredRefs,
        resolved_refs: requiredRefs.filter((ref) => knownRefs.has(ref)),
        unresolved_refs: unresolvedRefs.map((ref) => ({ ref, status: "unresolved_in_bounded_packet" })),
        superseded_refs: supersededRefs,
        handle_health: handleHealth,
        reauthentication_required: Boolean(handleHealth.reauthentication_required),
      },
    };
  }

  return Object.freeze({ CONTEXT_ASSEMBLY_SERVICE_VERSION, classifyObjective, assemble, resume, policyFor });
}

module.exports = Object.freeze({
  CONTEXT_ASSEMBLY_SERVICE_VERSION,
  createContextAssemblyService,
  boundedRecentTail,
  safeCheckpoint,
});
