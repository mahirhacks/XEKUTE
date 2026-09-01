"use strict";

const nodeCrypto = require("node:crypto");
const { canonicalJson, canonicalKeyHash, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretValues, clone, hashText, operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const SUMMARY_MAX = 32_768;
const SUMMARY_RATIO = 0.05;
const CHECKPOINT_RATIO = 0.80;
const METER_ROWS = Object.freeze([
  "System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP",
  "Summarized Conversation", "Active Conversation", "Current Workflow",
]);
const SEMANTIC_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "for", "was", "were", "has", "have",
  "into", "then", "when", "will", "must", "should", "could", "would", "user", "agent",
]);
const SECRET_TEXT = /(?:bearer\s+|basic\s+|(?:password|passwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*|-----BEGIN [^-]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)[^\s,;]*/gi;

function redactText(value, maximum = 8_000) {
  return String(value == null ? "" : value)
    .replace(SECRET_TEXT, "[REDACTED]")
    .replace(/[\u0000\r\n]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function sanitizeValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (depth > 10) return "[OMITTED_TOO_DEEP]";
  if (/(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|credential|raw[_-]?value)/i.test(String(key))) return undefined;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value, 4_000);
  if (typeof value !== "object") return redactText(value, 2_000);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeValue(entry, "", depth + 1, seen)).filter((entry) => entry !== undefined);
  const result = {};
  for (const [childKey, child] of Object.entries(value).slice(0, 100)) {
    const safe = sanitizeValue(child, childKey, depth + 1, seen);
    if (safe !== undefined) result[redactText(childKey, 120)] = safe;
  }
  return result;
}

function budgetFor(limit, ratio, maximum, minimum) {
  const value = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 1;
  return Math.min(maximum, Math.max(minimum, Math.floor(value * ratio)));
}
function summaryBudget(limit) { return budgetFor(limit, SUMMARY_RATIO, SUMMARY_MAX, 1_024); }
function approximateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value == null ? "" : value);
  // A deliberately conservative upper estimate. Provider adapters may replace
  // this with exact tokenization while preserving the same public accounting.
  return Math.max(0, Math.ceil(Buffer.byteLength(text, "utf8") / 3.6));
}
function stable(value) { return canonicalJson(value); }
function truncateText(value, maximum) {
  const text = String(value == null ? "" : value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 40))}\n[deterministically truncated]`;
}

function createTier1ContextCoordinator({
  sensitiveStore = null,
  schemaRegistry = null,
  tokenCounter = null,
  model = null,
  now = () => new Date(),
  crypto = nodeCrypto,
} = {}) {
  const schemas = schemaRegistry || getDefaultMemorySchemaRegistry();
  const sessions = new Map();

  function sessionKey(projectId, sessionId) { return `${String(projectId)}|${String(sessionId)}`; }
  function stateFor(projectId, sessionId) {
    const key = sessionKey(projectId, sessionId);
    if (!sessions.has(key)) sessions.set(key, { summary: null, active: [], workflow: null, currentPrompt: "", checkpointRevision: 0, lastAssembly: null });
    return sessions.get(key);
  }
  function hydrateSummary(projectId, sessionId, state) {
    if (!state || state.summary !== null || !sensitiveStore?.readCheckpoint) return state;
    try {
      const loaded = sensitiveStore.readCheckpoint(projectId, sessionId, "current");
      if (loaded?.ok && loaded.exists && loaded.value) {
        // Checkpoints written before a newly-added continuity field may still
        // be present in a developer's userData directory. Normalize the
        // historical omission at the Tier 1 boundary without inventing facts.
        const value = clone(loaded.value);
        value.constraints = Array.isArray(value.constraints) ? value.constraints.slice(0, 200) : [];
        // A decryptable JSON file is not automatically an authoritative
        // checkpoint.  Validate it at the injection boundary so a truncated,
        // hand-edited, or pre-contract payload can never enter Block B.  The
        // secret scan is defense in depth for older files written before the
        // current redaction contract existed.
        const validation = schemas.validate("ConversationCheckpointV3", value);
        if (validation.ok) {
          try {
            assertNoSecretValues(value);
            state.summary = value;
          } catch { /* keep an empty summary rather than injecting unsafe data */ }
        }
      }
    } catch { /* secure storage is optional; keep process-only state empty */ }
    return state;
  }
  function count(value, exact = false) {
    if (typeof tokenCounter === "function") {
      try {
        const counted = tokenCounter(value);
        const result = counted && typeof counted === "object" ? Number(counted.tokens ?? counted.count) : Number(counted);
        if (Number.isFinite(result) && result >= 0) {
          return {
            tokens: Math.ceil(result),
            exact: counted && typeof counted === "object" ? counted.exact === true : true,
          };
        }
      } catch { /* estimator below is safe */ }
    }
    return { tokens: approximateTokens(value), exact: Boolean(exact) };
  }
  function component(label, value) {
    const empty = value == null
      || value === ""
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
    const result = empty ? { tokens: 0, exact: true } : count(value);
    return { label, value: clone(value), tokens: result.tokens, exact: result.exact };
  }
  function safeReferenceIds(values, projectId, kind = "event") {
    const list = Array.isArray(values) ? values : [];
    return [...new Set(list.map((value, index) => {
      const candidate = String(value || "").trim();
      if (isMemoryId(candidate)) return candidate;
      return `${kind}_${canonicalKeyHash({ projectId, value: redactText(candidate, 240), index }).slice(0, 40)}`;
    }))].slice(0, 500);
  }
  function normalizeWorkflow(workflow, projectId, sessionId, previousWorkflow = null) {
    const source = workflow && typeof workflow === "object" ? clone(workflow) : {};
    // An idle workflow is still represented in the contract, but its identity
    // must not change on every prompt assembly.  A random ID here would make
    // the Block A/B/C prefix hash unstable and would cause needless cache
    // misses/checkpoint churn.  Caller-supplied active workflow IDs remain
    // authoritative; only the synthetic idle value is content-derived.
    const syntheticId = `block_${canonicalKeyHash({ projectId, sessionId, kind: "idle-workflow" }).slice(0, 48)}`;
    const suppliedId = String(source.workflow_id || source.workflowId || "").trim();
    const id = isMemoryId(suppliedId, "block") ? suppliedId : syntheticId;
    const steps = Array.isArray(source.steps) ? source.steps.map((step, index) => ({
      step_id: String(step?.step_id || step?.stepId || `step-${index + 1}`).slice(0, 240),
      description: redactText(step?.description || "", 2_000),
      state: ["pending", "in_progress", "completed", "failed", "blocked", "cancelled"].includes(String(step?.state || "pending")) ? String(step.state) : "pending",
      tool_call_refs: safeReferenceIds(step?.tool_call_refs || step?.toolCallRefs, projectId, "event").slice(0, 100),
      result_refs: safeReferenceIds(step?.result_refs || step?.resultRefs, projectId, "event").slice(0, 100),
    })) : [];
    const rawState = source.state == null ? "idle" : String(source.state);
    const state = ["idle", "active", "completed", "blocked", "cancelled", "failed"].includes(rawState) ? rawState : "idle";
    const continuation = source.continuation_point || source.continuationPoint || null;
    // An idle workflow has no runtime event timestamp. Giving it a wall-clock
    // value would mutate an otherwise unchanged Block B on every assembly,
    // defeating provider-prefix caching and creating noisy checkpoint diffs.
    // Active/blocked workflows keep their supplied timestamp (or receive one
    // when first observed); synthetic idle state is stable.
    const suppliedUpdatedAt = String(source.updated_at || source.updatedAt || "");
    const hasActivity = state !== "idle"
      || Boolean(String(source.objective || "").trim())
      || steps.length > 0
      || Boolean(continuation)
      || (Array.isArray(source.blockers) && source.blockers.length > 0);
    const normalizedContinuation = continuation
      ? { step_id: String(continuation.step_id || continuation.stepId || steps.find((step) => step.state !== "completed")?.step_id || "").slice(0, 240), next_action: redactText(continuation.next_action || continuation.nextAction || "Continue the next pending step.", 2_000), required_refs: safeReferenceIds(continuation.required_refs || continuation.requiredRefs, projectId, "event"), blockers: Array.isArray(continuation.blockers) ? continuation.blockers.map((value) => redactText(value, 1_000)).slice(0, 50) : [] }
      : (hasActivity && steps.some((step) => step.state !== "completed")
        ? { step_id: steps.find((step) => step.state !== "completed")?.step_id || "", next_action: "Continue the next pending step.", required_refs: [], blockers: [] }
        : null);
    const comparable = {
      schema_version: 3,
      workflow_id: id,
      project_id: projectId,
      session_id: sessionId,
      state,
      objective: redactText(source.objective || "", 8_000),
      steps,
      continuation_point: normalizedContinuation,
      blockers: Array.isArray(source.blockers) ? source.blockers.map((value) => redactText(value, 1_000)).slice(0, 100) : [],
      memory_refs: safeReferenceIds(source.memory_refs || source.memoryRefs, projectId, "entity"),
      artifact_refs: safeReferenceIds(source.artifact_refs || source.artifactRefs, projectId, "artifact").filter((value) => isMemoryId(value, "artifact")).slice(0, 100),
    };
    const previousComparable = previousWorkflow && typeof previousWorkflow === "object"
      ? Object.fromEntries(Object.entries(previousWorkflow).filter(([key]) => key !== "updated_at"))
      : null;
    const unchanged = previousComparable && canonicalJson(comparable) === canonicalJson(previousComparable);
    const updatedAt = /^\d{4}-\d{2}-\d{2}T/.test(suppliedUpdatedAt)
      ? suppliedUpdatedAt.slice(0, 80)
      : hasActivity && unchanged && /^\d{4}-\d{2}-\d{2}T/.test(String(previousWorkflow?.updated_at || ""))
        ? String(previousWorkflow.updated_at).slice(0, 80)
        : hasActivity ? timestamp(now) : "1970-01-01T00:00:00.000Z";
    return {
      schema_version: 3,
      workflow_id: id,
      project_id: projectId,
      session_id: sessionId,
      state,
      objective: comparable.objective,
      steps: comparable.steps,
      continuation_point: normalizedContinuation,
      blockers: comparable.blockers,
      memory_refs: comparable.memory_refs,
      artifact_refs: comparable.artifact_refs,
      updated_at: updatedAt,
    };
  }

  function assemble(input = {}) {
    const projectId = String(input.project_id || input.projectId || "");
    const sessionId = String(input.session_id || input.sessionId || "");
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 assembly requires opaque project and session IDs.");
    const limit = Math.max(1, Number(input.effective_context_limit || input.effectiveContextLimit || 1));
    const state = hydrateSummary(projectId, sessionId, stateFor(projectId, sessionId));
    const summary = input.summary === undefined ? state.summary : input.summary;
    const active = input.active_conversation === undefined ? state.active : (Array.isArray(input.active_conversation) ? input.active_conversation : []);
    // Current Workflow is checkpoint-owned continuity. It starts empty and is
    // only exposed after a conversation checkpoint has produced it.
    const workflow = summary && state.workflow ? state.workflow : null;
    const a = [
      component("System Prompt", input.system_prompt || input.systemPrompt || ""),
      component("Tool Definitions", input.tool_definitions || input.toolDefinitions || []),
      component("Rules", input.rules || []),
      component("Skills", input.active_skills || input.activeSkills || []),
      component("Subagents", input.active_subagent_instructions || input.activeSubagentInstructions || []),
      component("MCP", input.mcp_definitions || input.mcpDefinitions || []),
    ];
    const b = [component("Summarized Conversation", summary || ""), component("Active Conversation", active), component("Current Workflow", workflow || "")];
    const prefix = { block_a: a, block_b: b };
    const rows = Object.fromEntries([...a, ...b].map((entry) => [entry.label, entry.tokens]));
    const total = Object.values(rows).reduce((sum, value) => sum + value, 0);
    const upperBound = total;
    const result = {
      schema_version: 3,
      effective_context_limit: limit,
      checkpoint_threshold: Math.floor(limit * CHECKPOINT_RATIO),
      blocks: { A: { components: a, exact: true }, B: { components: b, checkpoint_owned: true } },
      rows,
      total_tokens: total,
      conservative_prompt_upper_bound: upperBound,
      estimated: a.some((entry) => !entry.exact) || b.some((entry) => !entry.exact),
      should_checkpoint: upperBound >= Math.floor(limit * CHECKPOINT_RATIO),
      prefix_hash: hashText(crypto, stable({ A: a.map(({ label, value }) => ({ label, value })), B: b.map(({ label, value }) => ({ label, value })) })),
    };
    if (input.current_user_prompt !== undefined || input.currentUserPrompt !== undefined) {
      state.currentPrompt = String(input.current_user_prompt ?? input.currentUserPrompt ?? "");
    }
    state.lastAssembly = result;
    return result;
  }

  function pressure(input = {}) {
    const assembled = input.assembled || assemble(input);
    const limit = Number(input.effective_context_limit || input.effectiveContextLimit || assembled.effective_context_limit || 1);
    return { ok: true, shouldCheckpoint: Number(assembled.conservative_prompt_upper_bound) >= Math.floor(limit * CHECKPOINT_RATIO), protectedOverflow: assembled.blocks.A.components.reduce((sum, item) => sum + item.tokens, 0) > limit, threshold: Math.floor(limit * CHECKPOINT_RATIO), totalTokens: assembled.total_tokens, estimated: assembled.estimated };
  }

  function reduceConversation(messages = [], toolEvents = []) {
    const source = Array.isArray(messages) ? messages : [];
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const normalized = [];
    for (const message of source) {
      const role = String(message?.role || "unknown");
      const content = redactText(message?.content || "", 4_000);
      normalized.push({ id: String(message?.id || ""), role, content, tool_name: redactText(message?.tool_name || message?.toolName || "", 160), outcome: redactText(message?.outcome || "", 80) });
    }
    const eventSummary = events.map((event) => ({ id: String(event?.id || event?.event_id || ""), tool_name: String(event?.tool_name || event?.toolName || ""), outcome: String(event?.outcome || event?.terminal_outcome || "unknown"), safe_excerpt: redactText(event?.safe_excerpt || event?.safeExcerpt || "", 1_000), artifact_refs: Array.isArray(event?.artifact_refs) ? event.artifact_refs.slice(0, 20) : [] }));
    return { messages: normalized, tool_events: eventSummary, message_count: normalized.length, event_count: eventSummary.length, digest: canonicalKeyHash({ messages: normalized, tool_events: eventSummary }) };
  }

  function deterministicFallback({ projectId, sessionId, previous, reduction, workflow, objective, constraints, decisions, protectedRefs, sourceBlocks, limit }) {
    const max = summaryBudget(limit);
    const facts = [];
    for (const message of reduction.messages) if (message.role === "user" && message.content) facts.push(`User request: ${truncateText(message.content, 1_900)}`);
    for (const event of reduction.tool_events) if (event.tool_name) facts.push(`Tool ${event.tool_name} completed with outcome ${event.outcome}.${event.safe_excerpt ? ` Result: ${truncateText(event.safe_excerpt, 1_000)}` : ""}`);
    const previousFacts = Array.isArray(previous?.grounded_facts) ? previous.grounded_facts : [];
    // A deterministic fallback is deliberately content addressed.  If the
    // provider is unavailable and the same ledger is retried, the checkpoint
    // identity must remain stable so a retry cannot create two semantic
    // boundaries for one conversation.  The timestamp is retained as useful
    // metadata, but is excluded from the identity hash below.
    const checkpointIdentity = canonicalKeyHash({
      schema_version: 3,
      project_id: projectId,
      session_id: sessionId,
      previous_checkpoint_id: previous?.checkpoint_id || null,
      transcript_boundary: Number(previous?.transcript_boundary || 0) + reduction.message_count,
      objective: objective || previous?.objective || "",
      constraints: Array.isArray(constraints) ? constraints : [],
      decisions: Array.isArray(decisions) ? decisions : [],
      reduction,
      workflow,
      protected_refs: Array.isArray(protectedRefs) ? protectedRefs : [],
      source_blocks: Array.isArray(sourceBlocks) ? sourceBlocks : [],
    });
    const summary = {
      schema_version: 3,
      checkpoint_id: `checkpoint_${checkpointIdentity.slice(0, 48)}`,
      project_id: projectId,
      session_id: sessionId,
      previous_checkpoint_id: previous?.checkpoint_id || null,
      transcript_boundary: Number(previous?.transcript_boundary || 0) + reduction.message_count,
      objective: truncateText(objective || previous?.objective || "", 8_000),
      constraints: [...new Set([...(Array.isArray(previous?.constraints) ? previous.constraints : []), ...(Array.isArray(constraints) ? constraints : [])].map(String))].slice(0, 200),
      decisions: [...new Set([...(Array.isArray(previous?.decisions) ? previous.decisions : []), ...(Array.isArray(decisions) ? decisions : [])].map(String))].slice(0, 200),
      grounded_facts: [...new Set([...previousFacts, ...facts].map(String))].slice(0, 300),
      significant_events: reduction.tool_events.map((event) => `${event.tool_name}: ${event.outcome}`).slice(0, 300),
      unverified_claims: [],
      unresolved_work: workflow?.continuation_point ? [workflow.continuation_point.next_action] : [],
      workflow_continuity: workflow,
      protected_refs: [...new Set((Array.isArray(protectedRefs) ? protectedRefs : []).filter(Boolean))].slice(0, 500),
      source_block_refs: [...new Set((Array.isArray(sourceBlocks) ? sourceBlocks : []).filter(Boolean))].slice(0, 500),
      content_hash: "",
      generated_by: "deterministic",
      created_at: timestamp(now),
    };
    const rendered = JSON.stringify(summary);
    if (rendered.length > max * 4) {
      summary.grounded_facts = summary.grounded_facts.slice(0, 100);
      summary.significant_events = summary.significant_events.slice(0, 100);
      summary.decisions = summary.decisions.slice(0, 80);
    }
    const hashInput = { ...summary };
    delete hashInput.content_hash;
    summary.content_hash = hashText(crypto, stable(hashInput));
    return summary;
  }

  function fitCheckpointToBudget(value, limit) {
    const maximum = summaryBudget(limit);
    const candidate = clone(value);
    const measured = () => approximateTokens(candidate);
    // Remove low-value historical detail first.  Objective, decisions,
    // unresolved work, workflow continuity, and protected references are
    // retained until the last possible moment because they are the fields
    // required to continue safely after a rotation.
    const discardable = ["significant_events", "grounded_facts", "unverified_claims"];
    for (const field of discardable) {
      while (measured() > maximum && Array.isArray(candidate[field]) && candidate[field].length) candidate[field].pop();
    }
    for (const field of ["constraints", "decisions", "unresolved_work"]) {
      while (measured() > maximum && Array.isArray(candidate[field]) && candidate[field].length > 1) candidate[field].pop();
    }
    if (measured() > maximum && candidate.workflow_continuity) {
      const workflowValue = candidate.workflow_continuity;
      for (const step of Array.isArray(workflowValue.steps) ? workflowValue.steps : []) {
        if (measured() <= maximum) break;
        step.description = truncateText(step.description, 240);
      }
      if (workflowValue.continuation_point) workflowValue.continuation_point.next_action = truncateText(workflowValue.continuation_point.next_action, 480);
      workflowValue.objective = truncateText(workflowValue.objective, 480);
      workflowValue.blockers = (workflowValue.blockers || []).slice(0, 10).map((entry) => truncateText(entry, 240));
    }
    if (measured() > maximum) {
      candidate.objective = truncateText(candidate.objective, 1_000);
      candidate.decisions = (candidate.decisions || []).map((entry) => truncateText(entry, 320));
      candidate.unresolved_work = (candidate.unresolved_work || []).map((entry) => truncateText(entry, 320));
    }
    return measured() <= maximum ? candidate : null;
  }

  function validateCheckpointGrounding(candidate, context) {
    if (!candidate || typeof candidate !== "object") return { ok: false, details: [{ instancePath: "", message: "checkpoint output must be an object" }] };
    const allowed = new Set();
    const add = (values) => {
      for (const value of Array.isArray(values) ? values : []) {
        const id = String(value || "").trim();
        if (id) allowed.add(id);
      }
    };
    add(context?.protectedRefs);
    add(context?.sourceBlocks);
    add(context?.previous?.protected_refs);
    add(context?.previous?.source_block_refs);
    add(context?.reduction?.messages?.map((message) => message?.id));
    add(context?.reduction?.tool_events?.map((event) => event?.id || event?.event_id));
    add(context?.reduction?.tool_events?.flatMap((event) => event?.artifact_refs || []));
    const checkRefs = (field) => {
      const refs = Array.isArray(candidate[field]) ? candidate[field] : [];
      const unknown = refs.map((value) => String(value || "").trim()).filter(Boolean).filter((value) => !allowed.has(value));
      return unknown.length ? { ok: false, details: [{ instancePath: `/${field}`, message: "checkpoint contains a reference not present in the protected or normalized source set" }] } : { ok: true };
    };
    for (const field of ["protected_refs", "source_block_refs"]) {
      const result = checkRefs(field);
      if (!result.ok) return result;
    }
    // Workflow continuity is an exact runtime record, not model-authored
    // prose.  Pin its identity and execution state to the deterministic
    // reduction so a model cannot silently move a continuation point or mark
    // an unfinished step complete.
    const expectedWorkflow = context?.workflow;
    const actualWorkflow = candidate.workflow_continuity;
    if (expectedWorkflow && actualWorkflow) {
      add(expectedWorkflow.memory_refs);
      add(expectedWorkflow.artifact_refs);
      for (const field of ["workflow_id", "project_id", "session_id", "state"]) {
        if (String(actualWorkflow[field] ?? "") !== String(expectedWorkflow[field] ?? "")) {
          return { ok: false, details: [{ instancePath: `/workflow_continuity/${field}`, message: "workflow continuity does not match the deterministic runtime state" }] };
        }
      }
      const expectedContinuation = expectedWorkflow.continuation_point;
      const actualContinuation = actualWorkflow.continuation_point;
      if (Boolean(expectedContinuation) !== Boolean(actualContinuation)
        || (expectedContinuation && (String(expectedContinuation.step_id) !== String(actualContinuation.step_id)
          || String(expectedContinuation.next_action) !== String(actualContinuation.next_action)))) {
        return { ok: false, details: [{ instancePath: "/workflow_continuity/continuation_point", message: "workflow continuation point does not match the deterministic runtime state" }] };
      }
      for (const field of ["memory_refs", "artifact_refs"]) {
        const refs = Array.isArray(actualWorkflow[field]) ? actualWorkflow[field] : [];
        const unknown = refs.map((value) => String(value || "").trim()).filter(Boolean).filter((value) => !allowed.has(value));
        if (unknown.length) return { ok: false, details: [{ instancePath: `/workflow_continuity/${field}`, message: "workflow continuity contains an unknown reference" }] };
      }
    }
    return { ok: true };
  }

  // Semantic checkpoint fields are navigational continuity, not a second
  // source of truth.  The model may paraphrase a supplied message, but it
  // must not be able to introduce a new authoritative fact merely by
  // returning a schema-valid string.  Keep values that have meaningful
  // lexical support in the deterministic source reduction; route unsupported
  // values to the explicitly non-authoritative unverified_claims field.
  function semanticCorpus(context) {
    const values = [];
    const add = (value) => {
      if (value == null) return;
      if (typeof value === "string") { if (value.trim()) values.push(redactText(value, 8_000).toLowerCase()); return; }
      if (Array.isArray(value)) { for (const item of value) add(item); return; }
      if (typeof value === "object") { for (const child of Object.values(value)) add(child); }
    };
    add(context?.objective);
    add(context?.constraints);
    add(context?.decisions);
    add(context?.currentPrompt);
    add(context?.previous?.objective);
    add(context?.previous?.decisions);
    add(context?.previous?.constraints);
    add(context?.previous?.grounded_facts);
    add(context?.previous?.significant_events);
    add(context?.reduction?.messages);
    add(context?.reduction?.tool_events);
    add(context?.workflow);
    const text = values.join(" ");
    const words = new Set((text.match(/[a-z0-9][a-z0-9._:/-]{2,}/gi) || []).map((word) => word.toLowerCase()));
    return { values, words };
  }

  function semanticValueIsGrounded(value, corpus) {
    const text = redactText(value, 2_000).toLowerCase();
    if (!text) return false;
    if (corpus.values.some((source) => source.includes(text))) return true;
    const words = [...new Set(text.match(/[a-z0-9][a-z0-9._:/-]{2,}/gi) || [])]
      .map((word) => word.toLowerCase())
      .filter((word) => !SEMANTIC_STOPWORDS.has(word));
    if (!words.length) return false;
    const overlap = words.filter((word) => corpus.words.has(word)).length;
    // Short values need one distinctive matching token; longer paraphrases
    // need at least two matching tokens and a meaningful fraction of support.
    return (words.length <= 3 && overlap >= 1) || (overlap >= 2 && overlap / words.length >= 0.34);
  }

  function normalizeSemanticField(values, corpus, { fallback = [], allowUnsupported = false } = {}) {
    const safe = [];
    const unsupported = [];
    const source = Array.isArray(values) ? values : [];
    for (const raw of source) {
      const value = redactText(raw, 2_000);
      if (!value) continue;
      if (allowUnsupported || semanticValueIsGrounded(value, corpus)) safe.push(value);
      else unsupported.push(value);
    }
    for (const raw of Array.isArray(fallback) ? fallback : []) {
      const value = redactText(raw, 2_000);
      if (value) safe.push(value);
    }
    return { values: [...new Set(safe)].slice(0, 300), unsupported: [...new Set(unsupported)].slice(0, 200) };
  }

  function checkpointCandidate(raw, context, generatedBy = "model") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const fallback = deterministicFallback(context);
    const safeRaw = sanitizeValue(raw) || {};
    const candidate = { ...fallback, ...safeRaw, schema_version: 3, project_id: context.projectId, session_id: context.sessionId, generated_by: generatedBy };
    const corpus = semanticCorpus(context);
    const groundedFacts = normalizeSemanticField(candidate.grounded_facts, corpus, { fallback: fallback.grounded_facts });
    const constraints = normalizeSemanticField(candidate.constraints, corpus, { fallback: fallback.constraints });
    const decisions = normalizeSemanticField(candidate.decisions, corpus, { fallback: fallback.decisions });
    const significantEvents = normalizeSemanticField(candidate.significant_events, corpus, { fallback: fallback.significant_events });
    const unresolvedWork = normalizeSemanticField(candidate.unresolved_work, corpus, { fallback: fallback.unresolved_work });
    candidate.grounded_facts = groundedFacts.values;
    candidate.constraints = constraints.values;
    candidate.decisions = decisions.values;
    candidate.significant_events = significantEvents.values;
    candidate.unresolved_work = unresolvedWork.values;
    candidate.unverified_claims = [...new Set([
      ...(Array.isArray(candidate.unverified_claims) ? candidate.unverified_claims : []),
      ...groundedFacts.unsupported,
      ...constraints.unsupported,
      ...decisions.unsupported,
      ...significantEvents.unsupported,
      ...unresolvedWork.unsupported,
    ].map((value) => redactText(value, 2_000)).filter(Boolean))].slice(0, 200);
    // These fields are runtime continuity, not model prose.  Pin them to the
    // deterministic reduction so a model cannot move the transcript boundary,
    // replace the checkpoint lineage, drop protected references, or invent a
    // new objective while still producing schema-valid JSON.
    candidate.checkpoint_id = fallback.checkpoint_id;
    candidate.previous_checkpoint_id = fallback.previous_checkpoint_id;
    candidate.transcript_boundary = fallback.transcript_boundary;
    candidate.objective = fallback.objective;
    candidate.protected_refs = clone(fallback.protected_refs);
    candidate.source_block_refs = clone(fallback.source_block_refs);
    candidate.unresolved_work = [...new Set([...(fallback.unresolved_work || []), ...(Array.isArray(candidate.unresolved_work) ? candidate.unresolved_work : [])].map(String))].slice(0, 200);
    // The structured workflow record is produced by the deterministic
    // reducer.  Preserve the model's semantic fields, but never allow it to
    // author an alternate execution state or continuation point.
    candidate.workflow_continuity = clone(context.workflow || fallback.workflow_continuity);
    const hashInput = { ...candidate };
    delete hashInput.content_hash;
    candidate.content_hash = hashText(crypto, stable(hashInput));
    return candidate;
  }

  async function semanticCheckpoint(context) {
    const checkpointModel = typeof context?.model === "function" ? context.model : model;
    if (typeof checkpointModel !== "function") return { ok: false, code: "MEMORY_CHECKPOINT_MODEL_UNAVAILABLE" };
    // Keep the exact protected values in local Tier 1 state, but pass only a
    // redacted, bounded projection to the semantic model.  This is enforced
    // here as well as in the Electron adapter so injected/provider-specific
    // model callbacks cannot accidentally receive raw credentials.
    const payload = sanitizeValue({
      previous_checkpoint: context.previous || null,
      deterministic_reduction: context.reduction,
      active_conversation: context.active,
      current_prompt_context_only: context.currentPrompt,
      current_workflow: context.workflow || null,
      objective: context.objective || "",
      constraints: Array.isArray(context.constraints) ? context.constraints.slice(0, 200) : [],
      decisions: Array.isArray(context.decisions) ? context.decisions.slice(0, 200) : [],
      authoritative_refs: context.protectedRefs,
      source_block_refs: context.sourceBlocks,
    }) || {};
    const callModel = async (input) => new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error("checkpoint model timeout"), { code: "MEMORY_CHECKPOINT_TIMEOUT" }));
      }, 60_000);
      Promise.resolve()
        .then(() => checkpointModel(input))
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
    let raw;
    try { raw = await callModel(payload); } catch (error) { return operationFailure(error.code || "MEMORY_CHECKPOINT_MODEL_FAILED", error.message, {}, true); }
    let candidate = checkpointCandidate(raw, context, "model");
    let grounding = candidate ? validateCheckpointGrounding(candidate, context) : { ok: false, details: [{ instancePath: "", message: "checkpoint output must be an object" }] };
    let validation = candidate ? schemas.validate("ConversationCheckpointV3", candidate) : { ok: false, error: { details: [{ instancePath: "", message: "checkpoint output must be an object" }] } };
    if (!grounding.ok) validation = { ok: false, error: grounding };
    if (!validation.ok || !fitCheckpointToBudget(candidate, context.limit)) {
      // One repair maximum.  The invalid payload itself is never sent back;
      // only its hash and bounded schema paths cross the model boundary.
      const invalidOutputHash = hashText(crypto, stable(raw == null ? null : raw));
      let repaired;
      try {
        repaired = await callModel({
          repair: true,
          invalid_output_hash: invalidOutputHash,
          schema_error_paths: (validation.error?.details || []).slice(0, 20).map((entry) => ({ path: entry.instancePath || entry.schemaPath || "", message: String(entry.message || "").slice(0, 240) })),
          required_fields: ["objective", "constraints", "decisions", "grounded_facts", "significant_events", "unverified_claims", "unresolved_work", "workflow_continuity"],
          authoritative_refs: sanitizeValue(context.protectedRefs) || [],
        });
      } catch (error) {
        return operationFailure(error.code || "MEMORY_CHECKPOINT_MODEL_FAILED", error.message, {}, true);
      }
      candidate = checkpointCandidate(repaired, context, "model");
      grounding = candidate ? validateCheckpointGrounding(candidate, context) : { ok: false, details: [] };
      validation = candidate ? schemas.validate("ConversationCheckpointV3", candidate) : { ok: false, error: { details: [] } };
      if (!grounding.ok) validation = { ok: false, error: grounding };
      if (!validation.ok || !fitCheckpointToBudget(candidate, context.limit)) return { ok: false, code: "MEMORY_CHECKPOINT_OUTPUT_INVALID", details: validation.error?.details || [] };
    } else {
      candidate = fitCheckpointToBudget(candidate, context.limit);
    }
    if (!candidate) return { ok: false, code: "MEMORY_CHECKPOINT_OUTPUT_INVALID", details: [] };
    // Fitting changes the serialized content, so recalculate the content
    // hash after any deterministic reduction.
    const hashInput = { ...candidate };
    delete hashInput.content_hash;
    candidate.content_hash = hashText(crypto, stable(hashInput));
    validation = schemas.validate("ConversationCheckpointV3", candidate);
    grounding = validateCheckpointGrounding(candidate, context);
    if (!grounding.ok) return { ok: false, code: "MEMORY_CHECKPOINT_OUTPUT_INVALID", details: grounding.details || [] };
    if (!validation.ok) return { ok: false, code: "MEMORY_CHECKPOINT_OUTPUT_INVALID", details: validation.error.details };
    return { ok: true, checkpoint: candidate };
  }

  async function checkpoint(input = {}) {
    const projectId = String(input.project_id || input.projectId || "");
    const sessionId = String(input.session_id || input.sessionId || "");
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_CHECKPOINT_INPUT_INVALID", "A V3 checkpoint requires opaque project_id and session_id.");
    const state = hydrateSummary(projectId, sessionId, stateFor(projectId, sessionId));
    const active = Array.isArray(input.active_conversation) ? input.active_conversation : state.active;
    // Active Conversation is the complete raw ledger. Legacy callers may
    // still supply a separately protected prompt; include it only when that
    // exact user message is not already in the active ledger.
    const currentPrompt = input.current_user_prompt !== undefined || input.currentUserPrompt !== undefined
      ? String(input.current_user_prompt ?? input.currentUserPrompt ?? "")
      : String(state.currentPrompt || "");
    const promptAlreadyActive = currentPrompt && active.some((message) => message?.role === "user" && String(message?.content || "") === currentPrompt);
    const reductionMessages = currentPrompt && !promptAlreadyActive
      ? [{ role: "user", content: currentPrompt, id: `prompt_${canonicalKeyHash({ projectId, sessionId, currentPrompt }).slice(0, 32)}` }, ...active]
      : active;
    const reduction = reduceConversation(reductionMessages, input.tool_events || input.toolEvents || []);
    let previous = state.summary;
    if (!previous && sensitiveStore?.readCheckpoint) {
      // A checkpoint can race with a secure-store restart while the session
      // is still empty. Treat that read as an unavailable prior summary and
      // continue with deterministic reduction instead of leaking a storage
      // exception out of the coordinator.
      try {
        const loaded = sensitiveStore.readCheckpoint(projectId, sessionId, "current");
        if (loaded?.ok && loaded.exists) previous = loaded.value;
      } catch {
        previous = state.summary || null;
      }
    }
    const rawProtectedRefs = input.protected_refs || input.protectedRefs || [];
    const rawSourceBlocks = input.source_block_refs || input.sourceBlockRefs || [];
    const rawConstraints = input.constraints || input.operator_constraints || input.operatorConstraints || [];
    const objective = redactText(input.objective || "", 8_000);
    const suppliedWorkflow = input.current_workflow === undefined ? state.workflow : input.current_workflow;
    const workflow = normalizeWorkflow(suppliedWorkflow || {
      state: objective ? "active" : "idle",
      objective,
      continuation_point: objective ? { next_action: `Continue working on: ${objective}` } : null,
    }, projectId, sessionId, state.workflow);
    const context = {
      projectId,
      sessionId,
      previous,
      reduction,
      workflow,
      active,
      currentPrompt,
      objective,
      constraints: (Array.isArray(rawConstraints) ? rawConstraints : [rawConstraints]).map((value) => redactText(value, 2_000)).filter(Boolean).slice(0, 200),
      decisions: (Array.isArray(input.decisions) ? input.decisions : [input.decisions]).map((value) => redactText(value, 2_000)).filter(Boolean).slice(0, 200),
      // Checkpoint references are identifiers, not arbitrary caller-provided
      // strings. Invalid values are replaced with deterministic opaque handles
      // so a secret can never be persisted or echoed in a repair request.
      protectedRefs: safeReferenceIds(rawProtectedRefs, projectId, "event"),
      sourceBlocks: safeReferenceIds(rawSourceBlocks, projectId, "block"),
      limit: Number(input.effective_context_limit || input.effectiveContextLimit || 1_000_000),
      model: input.model,
    };
    let semantic = null;
    if (input.allow_model !== false && input.reason !== "emergency") semantic = await semanticCheckpoint(context);
    let checkpointValue = semantic?.ok ? semantic.checkpoint : deterministicFallback(context);
    checkpointValue = fitCheckpointToBudget(checkpointValue, context.limit);
    if (checkpointValue) {
      const hashInput = { ...checkpointValue };
      delete hashInput.content_hash;
      checkpointValue.content_hash = hashText(crypto, stable(hashInput));
    }
    try {
      // The checkpoint is persisted in sensitive storage, but it is also
      // copied into the readable Tier 1 assembly and diagnostics.  Keep the
      // final boundary defensive in case a custom model/provider callback
      // returns a credential-shaped value that earlier normalization missed.
      if (checkpointValue) assertNoSecretValues(checkpointValue);
    } catch (error) {
      return { ok: false, code: error.code || "MEMORY_CHECKPOINT_SECRET_REJECTED", error: "Checkpoint contains a prohibited sensitive value.", details: {}, activePreserved: true };
    }
    const validation = checkpointValue ? schemas.validate("ConversationCheckpointV3", checkpointValue) : { ok: false, error: { message: "The checkpoint exceeds its adaptive budget.", details: [] } };
    if (!validation.ok) return { ok: false, code: "MEMORY_CHECKPOINT_INVALID", error: validation.error.message, details: validation.error.details, activePreserved: true };
    let stored = { ok: true, ephemeral: true };
    if (sensitiveStore?.writeCheckpoint) stored = sensitiveStore.writeCheckpoint(projectId, sessionId, checkpointValue);
    if (!stored.ok) return { ...stored, checkpointed: false, activePreserved: true };
    state.summary = checkpointValue;
    state.checkpointRevision += 1;
    state.active = [];
    state.currentPrompt = "";
    // The workflow visible in Tier 1 changes only at this checkpoint boundary.
    state.workflow = checkpointValue.workflow_continuity?.state === "completed" ? null : clone(checkpointValue.workflow_continuity);
    return { ok: true, checkpointed: true, checkpoint: clone(checkpointValue), active: [], currentWorkflow: state.workflow, stored, summaryBudget: summaryBudget(context.limit), reduction, modelUsed: semantic?.ok === true ? "model" : "deterministic" };
  }

  function appendConversation(projectId, sessionId, messages) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 conversation state requires opaque project and session IDs.");
    const state = stateFor(projectId, sessionId);
    const list = Array.isArray(messages) ? messages : [messages];
    state.active.push(...list.filter(Boolean).map(clone));
    return { ok: true, active: clone(state.active), count: state.active.length };
  }
  function setActiveConversation(projectId, sessionId, messages) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 conversation state requires opaque project and session IDs.");
    const state = stateFor(projectId, sessionId);
    state.active = (Array.isArray(messages) ? messages : []).filter(Boolean).map(clone);
    return { ok: true, active: clone(state.active), count: state.active.length };
  }
  function setWorkflow(projectId, sessionId, workflow) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 workflow state requires opaque project and session IDs.");
    const state = stateFor(projectId, sessionId); state.workflow = normalizeWorkflow(workflow, projectId, sessionId, state.workflow); return clone(state.workflow);
  }
  function state(projectId, sessionId) { const value = hydrateSummary(projectId, sessionId, stateFor(projectId, sessionId)); return { summary: clone(value.summary), active: clone(value.active), workflow: clone(value.workflow), checkpointRevision: value.checkpointRevision, lastAssembly: clone(value.lastAssembly) }; }
  function clear(projectId, sessionId) { sessions.delete(sessionKey(projectId, sessionId)); return { ok: true }; }
  function clearProject(projectId) {
    const prefix = `${String(projectId)}|`;
    let cleared = 0;
    for (const key of [...sessions.keys()]) if (key.startsWith(prefix)) { sessions.delete(key); cleared += 1; }
    return { ok: true, project_id: String(projectId), cleared_sessions: cleared };
  }

  return Object.freeze({ CHECKPOINT_RATIO, SUMMARY_MAX, METER_ROWS, summaryBudget, approximateTokens, assemble, pressure, reduceConversation, deterministicFallback, semanticCheckpoint, checkpoint, appendConversation, setActiveConversation, setWorkflow, state, clear, clearProject });
}

module.exports = Object.freeze({ createTier1ContextCoordinator, CHECKPOINT_RATIO, SUMMARY_MAX, summaryBudget, approximateTokens, METER_ROWS });
