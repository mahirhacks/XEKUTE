"use strict";

const nodeCrypto = require("node:crypto");
const { canonicalJson, canonicalKeyHash, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretValues, clone, hashText, operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");
const { redactToolCallMessages } = require("../../../shared/secret-redaction.js");
const { neutralizeContextMarkers } = require("../../../shared/context-markers.js");
const { NON_OPERATOR_ID, isOperatorInput, messageOrigin, operatorText } = require("./message-provenance.js");
const { resolveCheckpointPolicy } = require("./checkpoint-policy.js");
const { buildSummarizerRequest } = require("./tier1-checkpoint-request.js");
const { attemptFact, attemptsFromLedger, mergeAttemptEvents } = require("./checkpoint-attempts.js");

const SUMMARY_MAX = 32_768;
const SUMMARY_RATIO = 0.05;
const CHECKPOINT_RATIO = 0.90;
const ACTIVE_MAX = 2_000;
const METER_ROWS = Object.freeze([
  "System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP",
  "Summarized Conversation", "Active Conversation", "Current Workflow",
]);
const SEMANTIC_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "for", "was", "were", "has", "have",
  "into", "then", "when", "will", "must", "should", "could", "would", "user", "agent",
]);
const SECRET_TEXT = /(?:bearer\s+|basic\s+|(?:cookie|set-cookie|authorization|proxy-authorization)\s*:\s*(?:(?:bearer|basic)\s+)?|(?:password|passwd|passphrase|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*|-----BEGIN [^-]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)[^\s,;]*/gi;

// Replaces, in place, every string the final secret gate would reject with
// "[REDACTED]" and returns how many were replaced.
function quarantineSecretStrings(value) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (typeof child === "string") {
        try { assertNoSecretValues(child); } catch { node[key] = "[REDACTED]"; count += 1; }
      } else visit(child);
    }
  };
  visit(value);
  return count;
}

const INTERRUPTED = "MEMORY_CHECKPOINT_INTERRUPTED";
function interruption() {
  return Object.assign(new Error("The checkpoint was stopped."), { code: INTERRUPTED });
}
function interrupted() {
  return { ok: false, code: INTERRUPTED, interrupted: true, error: "The checkpoint was stopped before it was written.", details: [], activePreserved: true };
}

// The legacy summarizer request carries raw ledger messages; label who wrote
// each one and neutralize look-alike markers in anything not trusted.
function labelForSummarizer(message) {
  if (!message || typeof message !== "object") return message;
  const origin = messageOrigin(message);
  const trusted = message.block_tombstone === true || origin === "operator";
  const content = typeof message.content === "string" && !trusted ? neutralizeContextMarkers(message.content) : message.content;
  return { ...message, content, ...(origin ? { origin: message.block_tombstone === true ? "runtime" : origin } : {}) };
}

function redactText(value, maximum = 8_000, retainSecrets = false) {
  const text = String(value == null ? "" : value);
  return (retainSecrets ? text : text.replace(SECRET_TEXT, "[REDACTED]"))
    .replace(/[\u0000\r\n]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function sanitizeValue(value, key = "", depth = 0, seen = new WeakSet(), retainSecrets = false, maxItems = 100) {
  if (depth > 10) return "[OMITTED_TOO_DEEP]";
  if (!retainSecrets && /(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|credential|raw[_-]?value)/i.test(String(key))) return undefined;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value, 4_000, retainSecrets);
  if (typeof value !== "object") return redactText(value, 2_000);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, maxItems).map((entry) => sanitizeValue(entry, "", depth + 1, seen, retainSecrets, maxItems)).filter((entry) => entry !== undefined);
  const result = {};
  for (const [childKey, child] of Object.entries(value).slice(0, 100)) {
    const safe = sanitizeValue(child, childKey, depth + 1, seen, retainSecrets, maxItems);
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
// The objective is the run's inputs joined in time order, so the newest steering
// sits at the end. Cutting only the tail of the text would remove exactly that.
function truncateHeadTail(value, maximum) {
  const text = String(value == null ? "" : value);
  if (text.length <= maximum) return text;
  const marker = "\n[middle deterministically truncated]\n";
  const room = Math.max(0, maximum - marker.length);
  const head = Math.ceil(room / 2);
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (room - head))}`;
}
// Chronological lists keep the newest entries. A value that is repeated moves to
// the position of its last occurrence, so re-stating a fact keeps it fresh.
function keepNewest(values, maximum) {
  const limit = Math.floor(Number(maximum));
  if (!Array.isArray(values) || !(limit > 0)) return [];
  const seen = new Set();
  const kept = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] == null) continue;
    const value = String(values[index]);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    kept.push(value);
    if (kept.length === limit) break;
  }
  return kept.reverse();
}
// What one reduction adds to a checkpoint, apart from what the previous
// checkpoint already holds.
function freshRecords({ reduction, constraints, decisions, workflow } = {}) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const facts = [];
  for (const message of list(reduction?.messages)) {
    if (message.tombstone && message.content) facts.push(`Released work: ${truncateText(message.content, 1_900)}`);
    else if (message.role === "user" && message.content) {
      // A late tool result and an internal notice are user-role messages too; they
      // must not be recorded as something the operator asked for.
      const label = message.origin === "tool_delivery" ? "Late tool result" : message.origin === "runtime" ? "Runtime note" : "User request";
      facts.push(`${label}: ${truncateText(message.content, 1_900)}`);
    }
  }
  const attempts = list(reduction?.attempts);
  for (const attempt of attempts) facts.push(attemptFact(attempt));
  // An event whose call is in the ledger is described by that call's attempt.
  const explained = new Set(list(reduction?.ledger_call_ids));
  const legacy = list(reduction?.tool_events).filter((event) => event.tool_name && !(event.call_id && explained.has(event.call_id)));
  for (const event of legacy) facts.push(`Tool ${event.tool_name} completed with outcome ${event.outcome}.${event.safe_excerpt ? ` Result: ${truncateText(event.safe_excerpt, 1_000)}` : ""}`);
  return {
    facts,
    attempts,
    legacyEvents: legacy.map((event) => `${event.tool_name}: ${event.outcome}`),
    constraints: list(constraints).map(String),
    decisions: list(decisions).map(String),
    unresolved: workflow?.continuation_point?.next_action ? [workflow.continuation_point.next_action] : [],
  };
}

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`\\)\]}]+/gi;
const PORT_PATTERN = /\b(\d{1,5})\/(tcp|udp)\b/gi;
const CVE_PATTERN = /\bCVE-\d{4}-\d{4,7}\b/gi;
const FINDING_LIST_MAX = 6;
const FINDINGS_MAX = 700;

function messageText(message) {
  const parts = [];
  const content = message?.content;
  if (typeof content === "string") parts.push(content);
  else if (Array.isArray(content)) for (const part of content) parts.push(typeof part === "string" ? part : String(part?.text || ""));
  if (Array.isArray(message?.tool_calls)) {
    for (const call of message.tool_calls) {
      const args = call?.function?.arguments;
      parts.push(typeof args === "string" ? args : JSON.stringify(args ?? {}));
    }
  }
  return parts.join("\n");
}

function touchedPaths(messages) {
  const paths = [];
  const visit = (value, key = "", depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") { if (/^(?:path|file|paths|files)$/i.test(key) && value.trim()) paths.push(value.trim()); return; }
    if (Array.isArray(value)) { for (const entry of value) visit(entry, key, depth + 1); return; }
    if (typeof value === "object") for (const [name, entry] of Object.entries(value)) visit(entry, name, depth + 1);
  };
  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      let args = call?.function?.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
      visit(args);
    }
  }
  return paths;
}

function uniqueMatches(text, pattern, normalize = (value) => value) {
  return [...new Set((text.match(pattern) || []).map(normalize).filter(Boolean))];
}

// Durable engagement facts pulled from a block with plain pattern matching, so a
// block released without a model-written note still leaves its hosts, ports,
// URLs, CVEs and touched files behind. Credential-like values are only counted.
function extractBlockFindings(messages, { retainSecrets = false } = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter(Boolean);
  const text = list.map(messageText).join("\n");
  const capped = (values) => values.slice(0, FINDING_LIST_MAX).join(", ") + (values.length > FINDING_LIST_MAX ? `, +${values.length - FINDING_LIST_MAX} more` : "");
  const sections = [];
  const hosts = uniqueMatches(text, IPV4_PATTERN);
  const urls = uniqueMatches(text, URL_PATTERN, (url) => redactText(url.split(/[?#]/)[0].replace(/[.,;:!]+$/, ""), 160, retainSecrets));
  const ports = uniqueMatches(text, PORT_PATTERN, (port) => port.toLowerCase());
  const cves = uniqueMatches(text, CVE_PATTERN, (cve) => cve.toUpperCase());
  const files = [...new Set(touchedPaths(list).map((file) => redactText(file, 160, retainSecrets)))];
  if (hosts.length) sections.push(`hosts: ${capped(hosts)}`);
  if (ports.length) sections.push(`ports: ${capped(ports)}`);
  if (urls.length) sections.push(`urls: ${capped(urls)}`);
  if (cves.length) sections.push(`cves: ${capped(cves)}`);
  if (files.length) sections.push(`files: ${capped(files)}`);
  const failed = list.filter((message) => message.role === "tool" && /"ok"\s*:\s*false/.test(messageText(message))).length;
  if (failed) sections.push(`${failed} failed tool result${failed === 1 ? "" : "s"}`);
  const secrets = retainSecrets ? 0 : (text.match(SECRET_TEXT) || []).filter((match) => !/\[REDACTED\]/.test(match)).length;
  if (secrets) sections.push(`${secrets} credential-like value${secrets === 1 ? "" : "s"} not shown`);
  return sections.join("; ").slice(0, FINDINGS_MAX);
}

const FILE_EXTENSIONS = new Set(["js", "mjs", "cjs", "json", "txt", "md", "py", "sh", "log", "yml", "yaml", "xml", "html", "htm", "css", "ts", "tsx", "jsx", "conf", "cfg", "ini", "env", "csv", "pdf", "png", "jpg", "jpeg", "gif", "svg", "ico", "zip", "gz", "tar", "bak", "sql", "exe", "dll", "so", "c", "h", "cpp", "java", "rb", "go", "rs", "php", "asp", "aspx", "jsp", "lock", "map", "woff", "ttf", "mp4", "mp3"]);
const CIDR_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\b/g;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
// Hosts, addresses and ranges a piece of text names. Used to tell a lead that
// points at something the operator never mentioned from one that does.
function ipv4ToNumber(value) {
  const parts = String(value).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}
function ipv4InRange(address, range) {
  const [base, bits] = String(range).split("/");
  const value = ipv4ToNumber(address);
  const start = ipv4ToNumber(base);
  const width = Number(bits);
  if (value === null || start === null || !Number.isInteger(width) || width < 0 || width > 32) return false;
  const size = 2 ** (32 - width);
  return Math.floor(value / size) === Math.floor(start / size);
}
function networkEntities(text) {
  const value = String(text == null ? "" : text);
  const entities = new Set();
  for (const ip of value.match(IPV4_PATTERN) || []) entities.add(ip);
  for (const cidr of value.match(CIDR_PATTERN) || []) entities.add(cidr);
  for (const url of value.match(URL_PATTERN) || []) {
    try { entities.add(new URL(url).hostname.toLowerCase()); } catch { /* not a URL after all */ }
  }
  for (const host of value.match(HOSTNAME_PATTERN) || []) {
    const name = host.toLowerCase();
    if (!FILE_EXTENSIONS.has(name.split(".").pop())) entities.add(name);
  }
  return entities;
}

// Active Conversation stays one flat chronological ledger. A block is one turn:
// it opens at a `user` message (or at the first message) and runs through the
// assistant and tool messages that answer it. Each opener carries a stable
// `block_index` stamped once and never reused, so index 7 stays 7 after block 3
// is released. Unstamped ledgers (previews, legacy files) fall back to
// positional order until the coordinator stamps them.
function ledgerOf(messages) { return (Array.isArray(messages) ? messages : []).filter(Boolean); }
function isBlockOpener(message, position) { return position === 0 || String(message?.role || "") === "user"; }
function blockOpeners(messages) { return ledgerOf(messages).filter((message, position) => isBlockOpener(message, position)); }
function openerKey(message) {
  const sourceId = String(message?.source_message_id || "").trim();
  return sourceId || `content_${canonicalKeyHash({ role: message?.role || "", content: message?.content || "" })}`;
}

// Stamps `block_index` in place on every unstamped opener in `incoming` and
// returns the next free index. Callers re-send whole ledgers whose objects are
// not guaranteed to carry stamps yet, so an unstamped opener first re-adopts the
// index of the matching opener in `previous` (same message, in order) before a
// new one is issued.
function stampBlocks(previousMessages, incomingMessages, nextIndex = 0) {
  const previous = blockOpeners(previousMessages).filter((message) => Number.isSafeInteger(message.block_index));
  let next = Number.isSafeInteger(nextIndex) && nextIndex >= 0 ? nextIndex : 0;
  let cursor = 0;
  for (const opener of blockOpeners(incomingMessages)) {
    if (Number.isSafeInteger(opener.block_index)) {
      next = Math.max(next, opener.block_index + 1);
      const at = previous.findIndex((entry, position) => position >= cursor && entry.block_index === opener.block_index);
      if (at >= 0) cursor = at + 1;
      continue;
    }
    const key = openerKey(opener);
    const at = previous.findIndex((entry, position) => position >= cursor && openerKey(entry) === key);
    const assigned = at >= 0 ? previous[at].block_index : next;
    if (at >= 0) cursor = at + 1;
    if (!Object.isFrozen(opener)) opener.block_index = assigned;
    next = Math.max(next, assigned + 1);
  }
  return next;
}

function blocksFromActive(messages, estimate = approximateTokens) {
  const source = ledgerOf(messages);
  const measure = typeof estimate === "function" ? estimate : approximateTokens;
  const groups = [];
  for (let position = 0; position < source.length; position += 1) {
    if (isBlockOpener(source[position], position)) groups.push({ start: position, messages: [] });
    groups[groups.length - 1].messages.push(source[position]);
  }
  return groups.map((group, ordinal) => {
    const opener = group.messages[0];
    const stamped = Number.isSafeInteger(opener.block_index);
    const index = stamped ? opener.block_index : ordinal;
    const sourceId = String(opener.source_message_id || opener.id || "").trim();
    const blockId = sourceId || (stamped ? `block_${index}` : `block_${canonicalKeyHash({ role: opener.role || "", content: opener.content || "" }).slice(0, 32)}`);
    return {
      index,
      blockId,
      state: opener.block_tombstone === true ? "evicted" : "active",
      ...(opener.block_partial === true ? { partial: true } : {}),
      start: group.start,
      messages: group.messages,
      tokenEstimate: group.messages.reduce((sum, message) => sum + Math.max(0, Number(measure(message)) || 0), 0),
    };
  });
}

function createTier1ContextCoordinator({
  sensitiveStore = null,
  schemaRegistry = null,
  tokenCounter = null,
  model = null,
  now = () => new Date(),
  crypto = nodeCrypto,
  onChange = null,
  policy = null,
} = {}) {
  const checkpointPolicy = resolveCheckpointPolicy({}, policy);
  const schemas = schemaRegistry || getDefaultMemorySchemaRegistry();
  const sessions = new Map();

  function sessionKey(projectId, sessionId) { return `${String(projectId)}|${String(sessionId)}`; }
  function stateFor(projectId, sessionId) {
    const key = sessionKey(projectId, sessionId);
    if (!sessions.has(key)) sessions.set(key, { summary: null, active: [], workflow: null, currentPrompt: "", checkpointRevision: 0, lastAssembly: null, blockA: null, activeHydrated: false, nextBlockIndex: 0, released: new Map(), pinned: new Set(), directives: [] });
    return sessions.get(key);
  }
  function hydrateActive(projectId, sessionId, state) {
    if (!state || state.activeHydrated) return state;
    state.activeHydrated = true;
    if (!sensitiveStore?.readActive) return state;
    try {
      const loaded = sensitiveStore.readActive(projectId, sessionId);
      if (loaded?.ok && loaded.exists && Array.isArray(loaded.value?.active)) {
        state.active = loaded.value.active.filter(Boolean).map(clone);
        state.nextBlockIndex = stampBlocks([], state.active, Number(loaded.value.next_block_index));
        state.pinned = new Set((Array.isArray(loaded.value.pinned_blocks) ? loaded.value.pinned_blocks : []).filter((index) => Number.isSafeInteger(index) && index >= 0));
        state.directives = (Array.isArray(loaded.value.operator_directives) ? loaded.value.operator_directives : []).filter((entry) => entry && typeof entry.text === "string" && entry.text && typeof entry.source_message_id === "string" && entry.source_message_id).slice(-50).map((entry) => ({ text: entry.text, source_message_id: entry.source_message_id, revision: Number(entry.revision) || 0 }));
      }
    } catch { /* keep the in-memory ledger empty rather than injecting unsafe data */ }
    return state;
  }
  function persistActive(projectId, sessionId) {
    if (!sensitiveStore?.writeActive) return;
    const state = stateFor(projectId, sessionId);
    prunePins(state);
    try { sensitiveStore.writeActive(projectId, sessionId, state.active, { nextBlockIndex: state.nextBlockIndex, pinnedBlocks: [...state.pinned], operatorDirectives: state.directives }); } catch { /* in-memory ledger remains authoritative */ }
  }
  // A pin only means something while its block is in the ledger; a front trim
  // removes the block and the pin goes with it. An empty ledger is the moment
  // between a checkpoint and the controller re-sending the live task, so pins
  // wait for the next ledger to say which blocks came back.
  function prunePins(state) {
    if (!state.pinned.size || !state.active.length) return;
    const present = new Set(blockOpeners(state.active).map((opener) => opener.block_index));
    for (const index of [...state.pinned]) if (!present.has(index)) state.pinned.delete(index);
  }
  // A trim that cuts into a block leaves that block's index on its surviving
  // head. Otherwise the head would be numbered by position, as block 0, and
  // collide with a released block 0. The head is marked partial: releasing
  // only its tail would let a re-sent ledger bring the opener back as a second
  // block with the same index.
  function capActive(messages) {
    const source = (Array.isArray(messages) ? messages : []).filter(Boolean).map(clone);
    if (source.length <= ACTIVE_MAX) return source;
    const kept = source.slice(-ACTIVE_MAX);
    if (!Number.isSafeInteger(kept[0].block_index)) {
      const opener = blockOpeners(source.slice(0, source.length - ACTIVE_MAX)).filter((message) => Number.isSafeInteger(message.block_index)).pop();
      if (opener) Object.assign(kept[0], { block_index: opener.block_index, block_partial: true });
    }
    return kept;
  }
  // Stamp block indexes in place on the caller's objects before cloning them, so
  // a controller that keeps re-sending its own ledger keeps the same indexes.
  function ingestActive(state, messages) {
    const incoming = Array.isArray(messages) ? messages : [];
    state.nextBlockIndex = stampBlocks(state.active, incoming, state.nextBlockIndex);
    return capActive(incoming);
  }
  function emitChange(projectId, sessionId, changed, assembly) {
    if (typeof onChange !== "function" || !assembly || assembly.ok === false) return;
    try { onChange({ projectId, sessionId, changed, assembly, rows: assembly.rows }); } catch { /* display updates must not fail the ledger */ }
  }
  function hydrateSession(projectId, sessionId) {
    return hydrateActive(projectId, sessionId, hydrateSummary(projectId, sessionId, stateFor(projectId, sessionId)));
  }
  function syncMeter(projectId, sessionId, changed) {
    persistActive(projectId, sessionId);
    const state = stateFor(projectId, sessionId);
    if (!state.blockA) return null;
    return assemble({
      project_id: projectId,
      session_id: sessionId,
      effective_context_limit: state.lastAssembly?.effective_context_limit || 1,
      changed: Array.isArray(changed) ? changed : ["Active Conversation"],
      ...state.blockA,
    });
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
          state.summary = value;
          state.workflow = value.workflow_continuity?.state === "completed" ? null : clone(value.workflow_continuity || null);
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
    const state = hydrateSession(projectId, sessionId);
    // A preview reports what Tier 1 currently holds for the display meter. It
    // must never advance the ledger, its durable copy, or the cached Block A
    // used by later OnChange recalculation.
    const preview = input.preview === true;
    const summary = input.summary === undefined ? state.summary : input.summary;
    if (input.active_conversation !== undefined && !preview) {
      state.active = ingestActive(state, input.active_conversation);
    }
    const active = preview && input.active_conversation !== undefined
      ? capActive(Array.isArray(input.active_conversation) ? input.active_conversation : [])
      : state.active;
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
    if (preview) return result;
    if (input.current_user_prompt !== undefined || input.currentUserPrompt !== undefined) {
      state.currentPrompt = String(input.current_user_prompt ?? input.currentUserPrompt ?? "");
    }
    state.blockA = {
      system_prompt: input.system_prompt || input.systemPrompt || "",
      tool_definitions: clone(input.tool_definitions || input.toolDefinitions || []),
      rules: clone(input.rules || []),
      active_skills: clone(input.active_skills || input.activeSkills || []),
      active_subagent_instructions: clone(input.active_subagent_instructions || input.activeSubagentInstructions || []),
      mcp_definitions: clone(input.mcp_definitions || input.mcpDefinitions || []),
    };
    state.lastAssembly = result;
    persistActive(projectId, sessionId);
    emitChange(projectId, sessionId, Array.isArray(input.changed) ? input.changed : METER_ROWS.slice(), result);
    return result;
  }

  function pressure(input = {}) {
    const assembled = input.assembled || assemble(input);
    const limit = Number(input.effective_context_limit || input.effectiveContextLimit || assembled.effective_context_limit || 1);
    return { ok: true, shouldCheckpoint: Number(assembled.conservative_prompt_upper_bound) >= Math.floor(limit * CHECKPOINT_RATIO), protectedOverflow: assembled.blocks.A.components.reduce((sum, item) => sum + item.tokens, 0) > limit, threshold: Math.floor(limit * CHECKPOINT_RATIO), totalTokens: assembled.total_tokens, estimated: assembled.estimated };
  }

  function reduceConversation(messages = [], toolEvents = [], retainSecrets = false) {
    // Deterministic checkpoint stage: extract and normalize tool output, then
    // extract workflow results. Semantic checkpointing later adds grounded
    // continuation facts, decisions, and significant events.
    const source = Array.isArray(messages) ? messages : [];
    const events = Array.isArray(toolEvents) ? toolEvents : [];
    const normalized = [];
    for (const message of source) {
      const role = String(message?.role || "unknown");
      // Where a user-role message came from decides how it may be described later.
      const origin = messageOrigin(message) === "unattributed" ? "" : messageOrigin(message);
      // Only real placeholders and the operator's own words keep marker text as is.
      const trustedText = message?.block_tombstone === true || origin === "operator";
      const content = redactText(trustedText ? message?.content || "" : neutralizeContextMarkers(String(message?.content || "")), 4_000, retainSecrets);
      normalized.push({ id: String(message?.id || ""), role, content, tool_name: redactText(message?.tool_name || message?.toolName || "", 160), outcome: redactText(message?.outcome || "", 80), ...(message?.block_tombstone === true ? { tombstone: true } : {}), ...(origin ? { origin } : {}) });
    }
    const eventSummary = events.map((event) => ({ id: String(event?.id || event?.event_id || ""), tool_name: String(event?.tool_name || event?.toolName || "").slice(0, 120), outcome: String(event?.outcome || event?.terminal_outcome || "unknown"), safe_excerpt: redactText(event?.safe_excerpt || event?.safeExcerpt || "", 1_000, retainSecrets), artifact_refs: Array.isArray(event?.artifact_refs) ? event.artifact_refs.slice(0, 20) : [], call_id: String(event?.call_id || "").slice(0, 200) }));
    // Commands live in the assistant tool calls, which the normalized messages do
    // not keep, so attempts are read from the raw ledger.
    const ledger = attemptsFromLedger(source, events, { retainSecrets, redact: (text, maximum) => redactText(text, maximum, retainSecrets) });
    return { messages: normalized, tool_events: eventSummary, attempts: ledger.attempts, ledger_call_ids: ledger.callIds, message_count: normalized.length, event_count: eventSummary.length, digest: canonicalKeyHash({ messages: normalized, tool_events: eventSummary }) };
  }

  function deterministicFallback({ projectId, sessionId, previous, reduction, workflow, objective, constraints, decisions, protectedRefs, sourceBlocks, limit }) {
    const max = summaryBudget(limit);
    const fresh = freshRecords({ reduction, constraints, decisions, workflow });
    const earlier = (field) => (Array.isArray(previous?.[field]) ? previous[field] : []);
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
      objective: truncateHeadTail(objective || previous?.objective || "", 8_000),
      constraints: keepNewest([...earlier("constraints"), ...fresh.constraints], 200),
      decisions: keepNewest([...earlier("decisions"), ...fresh.decisions], 200),
      grounded_facts: keepNewest([...earlier("grounded_facts"), ...fresh.facts], 300),
      significant_events: keepNewest(mergeAttemptEvents(earlier("significant_events"), fresh.attempts, fresh.legacyEvents), 300),
      unverified_claims: [],
      unresolved_work: keepNewest([...earlier("unresolved_work"), ...fresh.unresolved], 200),
      workflow_continuity: workflow,
      protected_refs: [...new Set((Array.isArray(protectedRefs) ? protectedRefs : []).filter(Boolean))].slice(0, 500),
      source_block_refs: [...new Set((Array.isArray(sourceBlocks) ? sourceBlocks : []).filter(Boolean))].slice(0, 500),
      content_hash: "",
      generated_by: "deterministic",
      created_at: timestamp(now),
    };
    const rendered = JSON.stringify(summary);
    if (rendered.length > max * 4) {
      summary.grounded_facts = summary.grounded_facts.slice(-100);
      summary.significant_events = summary.significant_events.slice(-100);
      summary.decisions = summary.decisions.slice(-80);
    }
    const hashInput = { ...summary };
    delete hashInput.content_hash;
    summary.content_hash = hashText(crypto, stable(hashInput));
    return summary;
  }

  // Fits a checkpoint into its token budget. Historical detail goes first and the
  // OLDEST entries go before the newest. Constraints are operator restrictions:
  // they are shortened as a last resort and never removed, and a checkpoint that
  // still does not fit is refused (null) so the caller keeps the live ledger.
  // `stats` receives how much was removed so the loss is observable.
  function fitCheckpointToBudget(value, limit, stats = null) {
    const maximum = summaryBudget(limit);
    const candidate = clone(value);
    const measured = () => approximateTokens(candidate);
    const jsonBytes = (item) => Buffer.byteLength(JSON.stringify(item), "utf8");
    let bytes = jsonBytes(candidate);
    const over = () => Math.ceil(bytes / 3.6) > maximum;
    const shedOldest = (field, floor) => {
      const values = candidate[field];
      if (!Array.isArray(values)) return;
      let drop = 0;
      while (over() && values.length - drop > floor) { bytes -= jsonBytes(values[drop]) + 1; drop += 1; }
      if (!drop) return;
      values.splice(0, drop);
      if (stats) stats[field] = (stats[field] || 0) + drop;
    };
    shedOldest("unverified_claims", 0);
    shedOldest("grounded_facts", 0);
    shedOldest("significant_events", 0);
    shedOldest("decisions", 1);
    shedOldest("unresolved_work", 1);
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
      candidate.objective = truncateHeadTail(candidate.objective, 1_000);
      candidate.decisions = (candidate.decisions || []).map((entry) => truncateText(entry, 320));
      candidate.unresolved_work = (candidate.unresolved_work || []).map((entry) => truncateText(entry, 320));
    }
    for (const width of [240, 120]) {
      if (measured() <= maximum) break;
      candidate.constraints = (candidate.constraints || []).map((entry) => truncateText(entry, width));
      if (stats) stats.constraintsTruncated = width;
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
  function corpusFrom(sources) {
    const values = [];
    const add = (value) => {
      if (value == null) return;
      if (typeof value === "string") { if (value.trim()) values.push(redactText(value, 8_000).toLowerCase()); return; }
      if (Array.isArray(value)) { for (const item of value) add(item); return; }
      if (typeof value === "object") { for (const child of Object.values(value)) add(child); }
    };
    for (const source of sources) add(source);
    const text = values.join(" ");
    const words = new Set((text.match(/[a-z0-9][a-z0-9._:/-]{2,}/gi) || []).map((word) => word.toLowerCase()));
    return { values, words, entities: networkEntities(text) };
  }

  // What may vouch for a value depends on what the value is for. Fields that
  // steer the next action are grounded only in what the operator said and in
  // runtime state (`trusted`). A lead may also rest on the assistant's own
  // words (`assistant`), but see the entity rule. Facts and events may rest on
  // anything seen, tool output included (`full`). Text that only a tool or the
  // assistant vouches for can therefore describe the engagement but never
  // direct it.
  function semanticCorpora(context) {
    const messages = Array.isArray(context?.reduction?.messages) ? context.reduction.messages : [];
    const trustedSources = [
      context?.objective, context?.constraints, context?.decisions, context?.currentPrompt,
      context?.previous?.objective, context?.previous?.constraints, context?.previous?.decisions, context?.previous?.unresolved_work,
      context?.workflow, context?.operatorTexts,
    ];
    const assistantSources = [...trustedSources, messages.filter((message) => message.role === "assistant" && !message.tombstone).map((message) => message.content)];
    const full = corpusFrom([...assistantSources, messages, context?.reduction?.tool_events, context?.reduction?.attempts, context?.previous?.grounded_facts, context?.previous?.significant_events]);
    if (checkpointPolicy.trustTiers === false) return { trusted: full, assistant: full, full };
    return {
      trusted: corpusFrom(trustedSources),
      assistant: corpusFrom(assistantSources),
      full,
    };
  }

  // A lead that names a host, address or range the operator never mentioned is
  // not kept as work to do unless the project's scope covers it.
  function entitiesAllowed(value, check) {
    if (!check) return true;
    for (const entity of networkEntities(value)) {
      if (check.trusted.has(entity)) continue;
      if (ipv4ToNumber(entity) !== null && [...check.trusted].some((known) => known.includes("/") && ipv4InRange(entity, known))) continue;
      let inScope = false;
      try { inScope = typeof check.scopeCheck === "function" && check.scopeCheck(entity) === true; } catch { inScope = false; }
      if (!inScope) return false;
    }
    return true;
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

  // Returns the model's values that have enough lexical support in the source
  // reduction, and routes the rest to the non-authoritative unverified list.
  function normalizeSemanticField(values, corpus, { allowUnsupported = false, retainSecrets = false, entityCheck = null } = {}) {
    const safe = [];
    const unsupported = [];
    for (const raw of Array.isArray(values) ? values : []) {
      const value = redactText(raw, 2_000, retainSecrets);
      if (!value) continue;
      if (allowUnsupported || (semanticValueIsGrounded(value, corpus) && entitiesAllowed(value, entityCheck))) safe.push(value);
      else unsupported.push(value);
    }
    return { values: [...new Set(safe)], unsupported: keepNewest(unsupported, 200) };
  }

  function checkpointCandidate(raw, context, generatedBy = "model") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const fallback = deterministicFallback(context);
    // A model may return a full checkpoint, so its arrays get the largest cap any
    // field has instead of the default 100 that would cut the newest entries.
    const safeRaw = sanitizeValue(raw, "", 0, new WeakSet(), context?.retainSecrets === true, 300) || {};
    // A delta answer may add facts, decisions, leads and unverified claims. The
    // constraints, the events and the workflow are owned by code.
    if (context?.deltaOutput === true) for (const key of ["constraints", "significant_events", "workflow_continuity"]) delete safeRaw[key];
    const candidate = { ...fallback, ...safeRaw, schema_version: 3, project_id: context.projectId, session_id: context.sessionId, generated_by: generatedBy };
    const corpora = semanticCorpora(context);
    const retainSecrets = context?.retainSecrets === true;
    const fresh = freshRecords(context);
    const earlier = (field) => (Array.isArray(context.previous?.[field]) ? context.previous[field] : []);
    const clean = (list) => list.map((value) => redactText(value, 2_000, retainSecrets)).filter(Boolean);
    // Order is previous, then what only the model added, then this reduction's own
    // records, so a trim by cap or budget always removes the oldest first.
    const merge = (field, modelValues, freshValues, maximum) => {
      const known = new Set([...clean(earlier(field)), ...clean(freshValues)]);
      return keepNewest([...clean(earlier(field)), ...modelValues.filter((value) => !known.has(value)), ...clean(freshValues)], maximum);
    };
    const groundedFacts = normalizeSemanticField(candidate.grounded_facts, corpora.full, { retainSecrets });
    const constraints = normalizeSemanticField(candidate.constraints, corpora.trusted, { retainSecrets });
    const decisions = normalizeSemanticField(candidate.decisions, corpora.trusted, { retainSecrets });
    const significantEvents = normalizeSemanticField(candidate.significant_events, corpora.full, { retainSecrets });
    const unresolvedWork = normalizeSemanticField(candidate.unresolved_work, corpora.assistant, { retainSecrets, entityCheck: checkpointPolicy.trustTiers === false ? null : { trusted: corpora.trusted.entities, scopeCheck: context?.scopeCheck } });
    candidate.grounded_facts = merge("grounded_facts", groundedFacts.values, fresh.facts, 300);
    candidate.constraints = merge("constraints", constraints.values, fresh.constraints, 200);
    candidate.decisions = merge("decisions", decisions.values, fresh.decisions, 200);
    const mergedEvents = mergeAttemptEvents(earlier("significant_events"), fresh.attempts, fresh.legacyEvents);
    const knownEvents = new Set(mergedEvents);
    candidate.significant_events = keepNewest([...clean(significantEvents.values.filter((value) => !knownEvents.has(value))), ...clean(mergedEvents)], 300);
    candidate.unresolved_work = merge("unresolved_work", unresolvedWork.values, fresh.unresolved, 200);
    candidate.unverified_claims = keepNewest([
      ...(Array.isArray(candidate.unverified_claims) ? candidate.unverified_claims : []),
      ...groundedFacts.unsupported,
      ...constraints.unsupported,
      ...decisions.unsupported,
      ...significantEvents.unsupported,
      ...unresolvedWork.unsupported,
    ].map((value) => redactText(value, 2_000, retainSecrets)).filter(Boolean), 200);
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
    // sanitizeValue caps every array, and it keeps the first entries. A long
    // ledger would therefore reach the model as its oldest messages only, so the
    // newest window is cut first and the omitted count is stated.
    const newest = (list, count = 100) => {
      const items = Array.isArray(list) ? list : [];
      return items.length > count ? { items: items.slice(-count), omitted: items.length - count } : { items, omitted: 0 };
    };
    const messageWindow = newest(context.reduction?.messages);
    const eventWindow = newest(context.reduction?.tool_events);
    const attemptWindow = newest(context.reduction?.attempts);
    const activeWindow = newest(context.active);
    const previousWindow = context.previous ? { ...context.previous } : null;
    if (previousWindow) for (const field of ["grounded_facts", "significant_events", "constraints", "decisions", "unresolved_work", "unverified_claims"]) previousWindow[field] = newest(previousWindow[field]).items;
    const useRequestV2 = checkpointPolicy.requestV2 === true;
    if (useRequestV2) context = { ...context, deltaOutput: true };
    const requestV2 = useRequestV2 ? buildSummarizerRequest({
      context,
      fresh: freshRecords(context),
      redact: (text, maximum) => redactText(text, maximum, context?.retainSecrets === true),
      budgetTokens: Math.max(2_000, Math.min(Math.floor(Number(context.limit) * 0.6) || 20_000, Number(context.summarizerInputTokens) || 20_000)),
    }) : null;
    const payload = requestV2 ? sanitizeValue(requestV2.request, "", 0, new WeakSet(), context?.retainSecrets === true, 400) || {} : sanitizeValue({
      previous_checkpoint: previousWindow,
      deterministic_reduction: context.reduction ? { ...context.reduction, ledger_call_ids: undefined, messages: messageWindow.items, tool_events: eventWindow.items, attempts: attemptWindow.items } : context.reduction,
      // Each user message says where it came from, as in the v2 request, and
      // untrusted text cannot imitate a placeholder or the Tier 1 header.
      active_conversation: redactToolCallMessages(activeWindow.items.map(labelForSummarizer), { retainSecrets: context?.retainSecrets === true }),
      omitted_before: { messages: messageWindow.omitted, tool_events: eventWindow.omitted, attempts: attemptWindow.omitted, active_conversation: activeWindow.omitted },
      current_prompt_context_only: context.currentPrompt,
      current_workflow: context.workflow || null,
      objective: context.objective || "",
      constraints: Array.isArray(context.constraints) ? context.constraints.slice(0, 200) : [],
      decisions: Array.isArray(context.decisions) ? context.decisions.slice(0, 200) : [],
      authoritative_refs: context.protectedRefs,
      source_block_refs: context.sourceBlocks,
    }, "", 0, new WeakSet(), context?.retainSecrets === true) || {};
    // A stop from the operator ends the call at once; the adapter also gets the
    // signal so it can cancel its own request.
    const signal = context.signal || null;
    const callModel = async (input) => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, interruption());
      const timer = setTimeout(() => finish(reject, Object.assign(new Error("checkpoint model timeout"), { code: "MEMORY_CHECKPOINT_TIMEOUT" })), 60_000);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener?.("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => checkpointModel(input, { signal }))
        .then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
    let raw;
    try { raw = await callModel(payload); } catch (error) { return operationFailure(signal?.aborted ? INTERRUPTED : error.code || "MEMORY_CHECKPOINT_MODEL_FAILED", error.message, {}, true); }
    // The adapter may attach how the call went as a non-enumerable `stats`.
    const modelStats = raw && typeof raw === "object" && raw.stats && typeof raw.stats === "object" ? { ...raw.stats, ...(requestV2 ? { omittedBefore: requestV2.omittedBefore } : {}) } : (requestV2 ? { omittedBefore: requestV2.omittedBefore } : null);
    let candidate = checkpointCandidate(raw, context, "model");
    let grounding = candidate ? validateCheckpointGrounding(candidate, context) : { ok: false, details: [{ instancePath: "", message: "checkpoint output must be an object" }] };
    let validation = candidate ? schemas.validate("ConversationCheckpointV3", candidate) : { ok: false, error: { details: [{ instancePath: "", message: "checkpoint output must be an object" }] } };
    if (!grounding.ok) validation = { ok: false, error: grounding };
    // A valid answer that cannot fit its budget would not fit after a repair either.
    if (validation.ok && !fitCheckpointToBudget(candidate, context.limit)) return { ok: false, code: "MEMORY_CHECKPOINT_BUDGET_EXCEEDED", details: [] };
    if (!validation.ok) {
      // One repair maximum.  The invalid output itself is never sent back, only
      // its hash and bounded schema paths, alongside the same redacted request:
      // a stateless provider has nothing to repair from otherwise.
      const invalidOutputHash = hashText(crypto, stable(raw == null ? null : raw));
      let repaired;
      try {
        repaired = await callModel({
          ...payload,
          repair: true,
          invalid_output_hash: invalidOutputHash,
          schema_error_paths: (validation.error?.details || []).slice(0, 20).map((entry) => ({ path: entry.instancePath || entry.schemaPath || "", message: String(entry.message || "").slice(0, 240) })),
          required_fields: ["objective", "constraints", "decisions", "grounded_facts", "significant_events", "unverified_claims", "unresolved_work", "workflow_continuity"],
          authoritative_refs: sanitizeValue(context.protectedRefs) || [],
        });
      } catch (error) {
        return operationFailure(signal?.aborted ? INTERRUPTED : error.code || "MEMORY_CHECKPOINT_MODEL_FAILED", error.message, {}, true);
      }
      candidate = checkpointCandidate(repaired, context, "model");
      grounding = candidate ? validateCheckpointGrounding(candidate, context) : { ok: false, details: [] };
      validation = candidate ? schemas.validate("ConversationCheckpointV3", candidate) : { ok: false, error: { details: [] } };
      if (!grounding.ok) validation = { ok: false, error: grounding };
      if (!validation.ok || !fitCheckpointToBudget(candidate, context.limit)) return { ok: false, code: "MEMORY_CHECKPOINT_OUTPUT_INVALID", details: validation.error?.details || [] };
    } else {
      candidate = fitCheckpointToBudget(candidate, context.limit, context.trimStats);
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
    return { ok: true, checkpoint: candidate, modelStats };
  }

  async function checkpoint(input = {}) {
    // A stopped checkpoint writes nothing: the ledger stays as it was and the
    // next checkpoint starts from the beginning.
    const signal = input.signal || null;
    if (signal?.aborted) return interrupted();
    const projectId = String(input.project_id || input.projectId || "");
    const sessionId = String(input.session_id || input.sessionId || "");
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_CHECKPOINT_INPUT_INVALID", "A V3 checkpoint requires opaque project_id and session_id.");
    const state = hydrateSession(projectId, sessionId);
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
    const retainSecrets = input.retain_secrets === true || input.retainSecrets === true;
    const reduction = reduceConversation(reductionMessages, input.tool_events || input.toolEvents || [], retainSecrets);
    const operatorTexts = reductionMessages.filter(isOperatorInput).map((message) => redactText(operatorText(message), 4_000, retainSecrets)).filter(Boolean);
    // Steering recorded as it arrived. It survives the block it arrived in being
    // released, which the ledger alone would not.
    const consumedDirectives = state.directives.map((entry) => entry.source_message_id);
    const directiveConstraints = state.directives.map((entry) => `Operator: ${entry.text.slice(0, 300)}`);
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
    // The objective keeps its head and its tail: its tail holds the newest steering.
    const objective = truncateHeadTail(redactText(input.objective || "", 100_000, retainSecrets), 8_000);
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
      constraints: keepNewest([...(Array.isArray(rawConstraints) ? rawConstraints : [rawConstraints]).map((value) => redactText(value, 2_000, retainSecrets)).filter(Boolean), ...directiveConstraints], 200),
      operatorTexts,
      scopeCheck: typeof input.scope_check === "function" ? input.scope_check : null,
      decisions: (Array.isArray(input.decisions) ? input.decisions : [input.decisions]).map((value) => redactText(value, 2_000, retainSecrets)).filter(Boolean).slice(0, 200),
      // Checkpoint references are identifiers, not arbitrary caller-provided
      // strings. Invalid values are replaced with deterministic opaque handles
      // so a secret can never be persisted or echoed in a repair request.
      protectedRefs: safeReferenceIds(rawProtectedRefs, projectId, "event"),
      sourceBlocks: safeReferenceIds(rawSourceBlocks, projectId, "block"),
      limit: Number(input.effective_context_limit || input.effectiveContextLimit || 1_000_000),
      model: input.model,
      retainSecrets,
      trimStats: {},
      summarizerInputTokens: Number(input.summarizer_input_tokens ?? input.summarizerInputTokens) || 0,
      signal,
    };
    let semantic = null;
    if (input.allow_model !== false) semantic = await semanticCheckpoint(context);
    // Never fall back to the deterministic summary for a run that was stopped.
    if (signal?.aborted) return interrupted();
    let checkpointValue = semantic?.ok ? semantic.checkpoint : deterministicFallback(context);
    checkpointValue = fitCheckpointToBudget(checkpointValue, context.limit, context.trimStats);
    // A summary that cannot fit its budget is refused and the live ledger is
    // kept. Silently dropping an operator restriction to make it fit would be
    // worse than failing this checkpoint.
    if (!checkpointValue) return { ok: false, code: "MEMORY_CHECKPOINT_BUDGET_EXCEEDED", error: "The checkpoint exceeds its adaptive budget.", details: [], activePreserved: true, trimmed: context.trimStats };
    // One credential-shaped string the redactor missed costs that string, not the
    // checkpoint: a whole-checkpoint rejection would repeat at every checkpoint.
    const quarantined = retainSecrets ? 0 : quarantineSecretStrings(checkpointValue);
    const hashInput = { ...checkpointValue };
    delete hashInput.content_hash;
    checkpointValue.content_hash = hashText(crypto, stable(hashInput));
    try {
      // The checkpoint is persisted in sensitive storage, but it is also
      // copied into the readable Tier 1 assembly and diagnostics.  Keep the
      // final boundary defensive in case a custom model/provider callback
      // returns a credential-shaped value that earlier normalization missed.
      if (!retainSecrets) assertNoSecretValues(checkpointValue);
    } catch (error) {
      return { ok: false, code: error.code || "MEMORY_CHECKPOINT_SECRET_REJECTED", error: "Checkpoint contains a prohibited sensitive value.", details: {}, activePreserved: true };
    }
    const validation = schemas.validate("ConversationCheckpointV3", checkpointValue);
    if (!validation.ok) return { ok: false, code: "MEMORY_CHECKPOINT_INVALID", error: validation.error.message, details: validation.error.details, activePreserved: true };
    // The commit below is synchronous, so a stop either lands before this check
    // and discards everything, or after the checkpoint is fully written.
    if (signal?.aborted) return interrupted();
    let stored = { ok: true, ephemeral: true };
    if (sensitiveStore?.writeCheckpoint) stored = sensitiveStore.writeCheckpoint(projectId, sessionId, checkpointValue);
    if (!stored.ok) return { ...stored, checkpointed: false, activePreserved: true };
    state.summary = checkpointValue;
    state.checkpointRevision += 1;
    state.directives = state.directives.filter((entry) => !consumedDirectives.includes(entry.source_message_id));
    state.active = [];
    state.currentPrompt = "";
    // The workflow visible in Tier 1 changes only at this checkpoint boundary.
    state.workflow = checkpointValue.workflow_continuity?.state === "completed" ? null : clone(checkpointValue.workflow_continuity);
    syncMeter(projectId, sessionId, ["Summarized Conversation", "Active Conversation", "Current Workflow"]);
    return { ok: true, checkpointed: true, checkpoint: clone(checkpointValue), active: [], currentWorkflow: state.workflow, stored, summaryBudget: summaryBudget(context.limit), reduction, modelUsed: semantic?.ok === true ? "model" : "deterministic", semanticCode: semantic && semantic.ok !== true ? String(semantic.code || "") : "", modelStats: semantic?.ok === true ? semantic.modelStats || null : null, trimmed: context.trimStats, quarantined };
  }

  // Operator steering is recorded when it arrives and folded into the
  // checkpoint's constraints at the next checkpoint. Only the operator's own words
  // belong here, so a late tool result is refused.
  function recordDirective(projectId, sessionId, { text = "", sourceMessageId = "", revision = 0, retainSecrets = false } = {}) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "A directive needs opaque project and session IDs.");
    const id = String(sourceMessageId || "").trim().slice(0, 240);
    if (!id || NON_OPERATOR_ID.test(id)) return operationFailure("MEMORY_DIRECTIVE_NOT_OPERATOR", "Only operator messages can be recorded as directives.");
    const clean = redactText(text, 600, retainSecrets);
    if (!clean) return operationFailure("MEMORY_DIRECTIVE_EMPTY", "A directive needs text.");
    const state = hydrateSession(projectId, sessionId);
    state.directives = [...state.directives.filter((entry) => entry.source_message_id !== id), { text: clean, source_message_id: id, revision: Number(revision) || 0 }].slice(-50);
    persistActive(projectId, sessionId);
    return { ok: true, count: state.directives.length };
  }

  function appendConversation(projectId, sessionId, messages) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 conversation state requires opaque project and session IDs.");
    const state = hydrateSession(projectId, sessionId);
    const list = Array.isArray(messages) ? messages : [messages];
    state.active = ingestActive(state, [...state.active, ...list.filter(Boolean).map(clone)]);
    syncMeter(projectId, sessionId, ["Active Conversation"]);
    return { ok: true, active: clone(state.active), count: state.active.length };
  }
  function setActiveConversation(projectId, sessionId, messages) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 conversation state requires opaque project and session IDs.");
    const state = hydrateSession(projectId, sessionId);
    state.active = ingestActive(state, messages);
    syncMeter(projectId, sessionId, ["Active Conversation"]);
    return { ok: true, active: clone(state.active), count: state.active.length };
  }
  function setWorkflow(projectId, sessionId, workflow) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 workflow state requires opaque project and session IDs.");
    const state = hydrateSession(projectId, sessionId);
    state.workflow = normalizeWorkflow(workflow, projectId, sessionId, state.workflow);
    syncMeter(projectId, sessionId, ["Current Workflow"]);
    return clone(state.workflow);
  }
  function cloneSession(projectId, sourceSessionId, destSessionId) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sourceSessionId, "session") || !isMemoryId(destSessionId, "session")) {
      return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Tier 1 session clone requires opaque project and session IDs.");
    }
    if (sourceSessionId === destSessionId) return { ok: true, sessionId: destSessionId, activeCount: 0, copied: false };
    const source = hydrateSession(projectId, sourceSessionId);
    const dest = stateFor(projectId, destSessionId);
    dest.active = capActive(source.active);
    dest.summary = source.summary ? clone(source.summary) : null;
    dest.workflow = source.workflow ? clone(source.workflow) : null;
    dest.checkpointRevision = Number(source.checkpointRevision) || 0;
    dest.blockA = source.blockA ? clone(source.blockA) : null;
    dest.lastAssembly = null;
    dest.activeHydrated = true;
    dest.nextBlockIndex = source.nextBlockIndex;
    dest.pinned = new Set(source.pinned);
    dest.directives = clone(source.directives);
    dest.released = new Map();
    // Every released block is copied, not only those whose tombstone is still in
    // the ledger: the copied summary names earlier ones as recallable too.
    for (let index = 0; index < (Number(source.nextBlockIndex) || 0); index += 1) {
      const entry = loadReleased(projectId, sourceSessionId, source, index);
      if (!entry) continue;
      let stored = false;
      try { stored = sensitiveStore?.writeReleasedBlock?.(projectId, destSessionId, index, { block_id: entry.blockId, messages: entry.messages })?.ok === true; } catch { stored = false; }
      if (!stored) dest.released.set(index, { blockId: entry.blockId, messages: entry.messages.map(clone) });
    }
    persistActive(projectId, destSessionId);
    if (dest.summary && sensitiveStore?.writeCheckpoint) {
      try { sensitiveStore.writeCheckpoint(projectId, destSessionId, dest.summary); } catch { /* in-memory summary remains */ }
    }
    return { ok: true, sessionId: destSessionId, activeCount: dest.active.length, copied: true };
  }
  function state(projectId, sessionId) {
    const value = hydrateSession(projectId, sessionId);
    return { summary: clone(value.summary), active: clone(value.active), workflow: clone(value.workflow), checkpointRevision: value.checkpointRevision, lastAssembly: clone(value.lastAssembly), directives: clone(value.directives) };
  }
  function tokenCount(message) { return count(message).tokens; }
  function tombstoneText(block, reason, retainSecrets) {
    const opener = block.messages.find((message) => message.role === "user" && message.block_tombstone !== true);
    const prompt = redactText(opener?.content || "", 160, retainSecrets);
    const tools = new Map();
    for (const message of block.messages) {
      if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        const name = String(call?.function?.name || call?.name || "").trim();
        if (name) tools.set(name, (tools.get(name) || 0) + 1);
      }
    }
    const toolText = [...tools].map(([name, calls]) => (calls > 1 ? `${name} x${calls}` : name)).join(", ");
    const note = redactText(reason || "", 240, retainSecrets);
    const findings = extractBlockFindings(block.messages, { retainSecrets });
    // The full arguments of this block's tool calls are about to leave the ledger,
    // so what was run is written into the tombstone while it can still be read.
    const ran = attemptsFromLedger(block.messages, [], { retainSecrets, redact: (text, maximum) => redactText(text, maximum, retainSecrets) }).attempts
      .slice(-6).map((attempt) => `${attempt.tool} ${attempt.digest} -> ${attempt.outcome}${attempt.count > 1 ? ` x${attempt.count}` : ""}`).join("; ").slice(0, 480);
    return `[Block ${block.index} released from context: ${block.messages.length} messages${prompt ? `, started by "${prompt}"` : ""}${toolText ? `, tools: ${toolText}` : ""}${findings ? `. Findings: ${findings}` : ""}${ran ? `. Ran: ${ran}` : ""}${note ? `. Note: ${note}` : ""}. Call recall_block with index ${block.index} to read it again.]`;
  }
  function loadReleased(projectId, sessionId, state, index) {
    const cached = state.released.get(index);
    if (cached) return cached;
    if (!sensitiveStore?.readReleasedBlock) return null;
    try {
      const loaded = sensitiveStore.readReleasedBlock(projectId, sessionId, index);
      if (!loaded?.ok || !loaded.exists) return null;
      return { blockId: loaded.blockId, messages: loaded.messages.map(clone) };
    } catch { return null; }
  }
  // Releases whole finished blocks from the Active Conversation. The full
  // messages are written to the encrypted session store first; only then is the
  // block replaced in place by one tombstone that keeps its block_index. A block
  // is never half released, so every tool_call keeps its tool result. The newest
  // block is the live turn and is never released.
  function evictBlocks(projectId, sessionId, requested = [], { retainSecrets = false } = {}) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Releasing blocks requires opaque project and session IDs.");
    const state = hydrateSession(projectId, sessionId);
    const blocks = blocksFromActive(state.active, tokenCount);
    const newest = blocks.at(-1);
    const rejected = [];
    const plan = [];
    const seen = new Set();
    for (const entry of Array.isArray(requested) ? requested : [requested]) {
      const request = entry && typeof entry === "object" ? entry : { index: entry };
      const index = typeof request.index === "string" && request.index.trim() !== "" ? Number(request.index) : request.index;
      if (!Number.isSafeInteger(index) || index < 0) { rejected.push({ index: request.index, code: "BLOCK_INDEX_INVALID" }); continue; }
      if (seen.has(index)) continue;
      seen.add(index);
      const block = blocks.find((candidate) => candidate.index === index);
      if (!block) rejected.push({ index, code: "BLOCK_NOT_FOUND" });
      else if (block.state === "evicted") rejected.push({ index, code: "BLOCK_ALREADY_RELEASED" });
      else if (state.pinned.has(block.index)) rejected.push({ index, code: "BLOCK_PINNED" });
      else if (block.partial) rejected.push({ index, code: "BLOCK_PARTIAL" });
      else if (block === newest) rejected.push({ index, code: "BLOCK_IN_FLIGHT" });
      else plan.push({ block, reason: request.reason });
    }
    const stored = [];
    for (const item of plan) {
      const messages = item.block.messages.map(clone);
      let saved;
      try { saved = sensitiveStore?.writeReleasedBlock ? sensitiveStore.writeReleasedBlock(projectId, sessionId, item.block.index, { block_id: item.block.blockId, messages }) : { ok: true }; }
      catch (error) { saved = { ok: false, code: "MEMORY_RELEASED_BLOCK_WRITE_FAILED", error: error.message }; }
      if (saved?.ok !== true) { rejected.push({ index: item.block.index, code: saved?.code || "BLOCK_PERSIST_FAILED" }); continue; }
      // With a store the encrypted copy is the source of truth; keeping every
      // released block in memory as well would defeat the point of releasing it.
      if (!sensitiveStore?.writeReleasedBlock) state.released.set(item.block.index, { blockId: item.block.blockId, messages });
      stored.push(item);
    }
    const evicted = [];
    for (const item of [...stored].sort((left, right) => right.block.start - left.block.start)) {
      const content = tombstoneText(item.block, item.reason, retainSecrets);
      const tombstone = { role: "user", content, block_index: item.block.index, block_tombstone: true, released_tokens: item.block.tokenEstimate };
      state.active.splice(item.block.start, item.block.messages.length, tombstone);
      evicted.unshift({ index: item.block.index, blockId: item.block.blockId, messages: item.block.messages.length, tokensBefore: item.block.tokenEstimate, tokensAfter: tokenCount(tombstone), tombstone: content });
    }
    if (evicted.length) syncMeter(projectId, sessionId, ["Active Conversation"]);
    return { ok: true, evicted, rejected, active: clone(state.active), count: state.active.length };
  }
  // Reads a released block back. The ledger is not touched: the caller returns
  // the messages as the tool result of the current turn, which is the "new
  // block" and keeps the provider prefix append-only.
  function recallBlock(projectId, sessionId, index) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Recalling a block requires opaque project and session IDs.");
    const number = typeof index === "string" && index.trim() !== "" ? Number(index) : index;
    if (!Number.isSafeInteger(number) || number < 0) return operationFailure("MEMORY_BLOCK_INDEX_INVALID", "A block index must be a non-negative integer.");
    const state = hydrateSession(projectId, sessionId);
    const live = blocksFromActive(state.active, tokenCount).find((block) => block.index === number);
    if (live && live.state === "active") return operationFailure("MEMORY_BLOCK_ACTIVE", `Block ${number} is still in context.`);
    const entry = loadReleased(projectId, sessionId, state, number);
    if (!entry) return operationFailure("MEMORY_BLOCK_NOT_RELEASED", `Block ${number} was not released or its stored copy is unavailable.`);
    const messages = entry.messages.map(clone);
    return { ok: true, index: number, blockId: entry.blockId, messages, tokens: count(messages).tokens };
  }
  function activeBlocks(projectId, sessionId) {
    const value = hydrateSession(projectId, sessionId);
    return blocksFromActive(value.active, tokenCount).map((block) => ({ ...block, pinned: value.pinned.has(block.index) }));
  }
  // Pinned blocks are skipped by automatic release and refused by release_blocks.
  function pinBlock(projectId, sessionId, index, pinned = true) {
    if (!isMemoryId(projectId, "proj") || !isMemoryId(sessionId, "session")) return operationFailure("MEMORY_TIER1_INPUT_INVALID", "Pinning a block requires opaque project and session IDs.");
    const number = typeof index === "string" && index.trim() !== "" ? Number(index) : index;
    if (!Number.isSafeInteger(number) || number < 0) return operationFailure("MEMORY_BLOCK_INDEX_INVALID", "A block index must be a non-negative integer.");
    const state = hydrateSession(projectId, sessionId);
    const block = blocksFromActive(state.active, tokenCount).find((candidate) => candidate.index === number);
    if (!block) return operationFailure("MEMORY_BLOCK_NOT_FOUND", `Block ${number} is not in the conversation.`);
    if (block.state === "evicted") return operationFailure("MEMORY_BLOCK_RELEASED", `Block ${number} was already released.`);
    if (pinned === false) state.pinned.delete(number); else state.pinned.add(number);
    persistActive(projectId, sessionId);
    return { ok: true, index: number, pinned: state.pinned.has(number), pinnedBlocks: [...state.pinned].sort((left, right) => left - right) };
  }
  function clear(projectId, sessionId) { sessions.delete(sessionKey(projectId, sessionId)); return { ok: true }; }
  function clearProject(projectId) {
    const prefix = `${String(projectId)}|`;
    let cleared = 0;
    for (const key of [...sessions.keys()]) if (key.startsWith(prefix)) { sessions.delete(key); cleared += 1; }
    return { ok: true, project_id: String(projectId), cleared_sessions: cleared };
  }

  return Object.freeze({ CHECKPOINT_RATIO, SUMMARY_MAX, ACTIVE_MAX, METER_ROWS, summaryBudget, approximateTokens, assemble, pressure, reduceConversation, deterministicFallback, semanticCheckpoint, checkpoint, appendConversation, setActiveConversation, setWorkflow, cloneSession, state, activeBlocks, evictBlocks, recallBlock, pinBlock, recordDirective, clear, clearProject });
}

module.exports = Object.freeze({ createTier1ContextCoordinator, CHECKPOINT_RATIO, SUMMARY_MAX, ACTIVE_MAX, summaryBudget, approximateTokens, blocksFromActive, extractBlockFindings, isOperatorInput, keepNewest, networkEntities, operatorText, METER_ROWS });
