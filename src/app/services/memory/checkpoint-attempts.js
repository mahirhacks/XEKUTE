"use strict";

// What was run, against what, and how it ended. Attempts are derived from the
// Active Conversation ledger, where an assistant tool call keeps its full
// arguments and the tool message that answers it shares its tool_call_id. Per-run
// tool events are not used as the source: they are cleared at every checkpoint
// and carry no arguments. When an event exists for a call it only supplies the
// outcome and excerpt.

const { redactCommandArgv, redactCommandLine } = require("../../../shared/secret-redaction.js");

const OUTCOMES = Object.freeze(["success", "failure", "timeout", "cancelled", "unknown"]);
const DIGEST_MAX = 200;
const EXCERPT_MAX = 240;
const FIELD_MAX = 60;

// Tools whose calls say nothing about what was tried.
const OMITTED_TOOLS = new Set(["release_blocks", "recall_block", "end_turn", "ask_questions", "delegate_agent", "view_active_terminal"]);
const POLLING_OPERATIONS = new Set(["status", "stop", "list"]);
const QUIET_BROWSER_ACTIONS = new Set(["list_pages", "observe", "screenshot", "wait"]);
const TEXT_BROWSER_ACTIONS = new Set(["type", "insert_text", "select"]);
const GENERIC_KEYS = ["url", "target", "host", "hostname", "domain", "ip", "path", "file", "query", "operation", "action", "method", "command"];
const SECRET_QUERY_KEY = /(?:pass|pwd|secret|token|key|auth|session|csrf|cookie|credential|sig)/i;
const EVENT_PATTERN = /^(.+?) -> (success|failure|timeout|cancelled|unknown)(?: x(\d+))?$/;

function squash(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
function field(value) { return squash(value).slice(0, FIELD_MAX); }

function parseArguments(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return { command: raw }; }
}

// A URL without credentials, fragment, or secret-looking query values.
function safeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const query = [...url.searchParams.entries()].map(([key, item]) => `${key}=${SECRET_QUERY_KEY.test(key) || item.length > 24 ? "[REDACTED]" : item}`).join("&");
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch { return redactCommandLine(text); }
}

// A short, redacted description of a tool call. "" means the call is not an
// attempt worth recording. Only the fields listed here are ever read, so an
// `env`, `headers`, `body`, typed text or `account` value cannot end up in a digest.
function digestToolCall(toolName, rawArguments, { retainSecrets = false } = {}) {
  const name = String(toolName || "").trim();
  if (!name || OMITTED_TOOLS.has(name)) return "";
  const args = parseArguments(rawArguments);
  let digest = "";
  switch (name) {
    case "exec_command": {
      if (POLLING_OPERATIONS.has(String(args.operation || "run").toLowerCase())) return "";
      if (typeof args.command === "string" && args.command.trim()) digest = args.command;
      else if (typeof args.executable === "string" && args.executable.trim()) digest = redactCommandArgv(args.executable, Array.isArray(args.args) ? args.args : [], { retainSecrets });
      break;
    }
    case "replay_request": {
      const request = args.request && typeof args.request === "object" ? args.request : {};
      const url = safeUrl(request.url);
      if (!url) return "";
      digest = `${String(request.method || "GET").toUpperCase()} ${url}${args.identityId ? ` identity=${field(args.identityId)}` : ""}`;
      break;
    }
    case "browser_action": {
      const action = field(args.action);
      if (!action || QUIET_BROWSER_ACTIONS.has(action)) return "";
      digest = [action, args.url ? safeUrl(args.url) : "", args.selector ? field(args.selector) : "", TEXT_BROWSER_ACTIONS.has(action) ? "[text withheld]" : ""].filter(Boolean).join(" ");
      break;
    }
    case "web_research": digest = `${field(args.operation) || "search"} ${field(args.query) || safeUrl(args.url)}`; break;
    case "read_file": digest = `${field(args.path)}${args.mode === "directory" ? " (directory)" : ""}`; break;
    case "search_workspace": digest = `${field(args.mode) || "text"} ${field(args.query)}`; break;
    case "apply_patch": {
      const operations = Array.isArray(args.operations) ? args.operations : [];
      digest = operations.slice(0, 4).map((operation) => `${field(operation?.kind) || "modify"} ${field(operation?.path)}`.trim()).join(", ") + (operations.length > 4 ? ` +${operations.length - 4} more` : "");
      break;
    }
    case "manage_identity": digest = `${field(args.operation)} ${field(args.identityId) || field(args.name)}`; break;
    default:
      digest = GENERIC_KEYS.filter((key) => (typeof args[key] === "string" || typeof args[key] === "number") && String(args[key]).trim()).map((key) => `${key}=${field(args[key])}`).join(" ");
  }
  const redacted = retainSecrets ? String(digest) : redactCommandLine(digest);
  return squash(redacted).slice(0, DIGEST_MAX);
}

function normalizeOutcome(value) {
  const outcome = String(value || "").toLowerCase();
  return OUTCOMES.includes(outcome) ? outcome : "unknown";
}

// Reads the model-facing tool message (the envelope written by the result projector).
function readToolMessage(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  let envelope = null;
  try { envelope = JSON.parse(text); } catch { envelope = null; }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { outcome: "unknown", excerpt: text };
  let payload = envelope.payload;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = { summary: payload }; } }
  payload = payload && typeof payload === "object" ? payload : {};
  const known = envelope.ok !== undefined || envelope.status !== undefined;
  const ok = envelope.ok === true || envelope.status === "success" || envelope.status === "partial";
  const code = String(envelope.errorCode || envelope.code || "").toLowerCase();
  const excerpt = envelope.error ? String(envelope.error) : String(payload.summary || payload.stdout || payload.message || envelope.summary || envelope.stdout || "");
  const outcome = !known ? "unknown" : ok && !envelope.error ? "success" : code.includes("timeout") ? "timeout" : "failure";
  return { outcome, excerpt };
}

// Pairs every assistant tool call in the ledger with its result. Identical
// (tool, digest, outcome) attempts collapse into one entry with a count that sits
// at the position of the last occurrence. `callIds` lists every tool call seen,
// including deliberately omitted ones, so callers can tell which per-run events
// are already accounted for.
function attemptsFromLedger(messages, toolEvents = [], { retainSecrets = false, redact = (text, maximum) => String(text).slice(0, maximum) } = {}) {
  const calls = new Map();
  const eventsByCall = new Map((Array.isArray(toolEvents) ? toolEvents : []).filter((event) => event && event.call_id).map((event) => [String(event.call_id), event]));
  const entries = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const id = String(call?.id || "").trim();
        if (!id) continue;
        const tool = String(call?.function?.name || call?.name || "").slice(0, 120);
        const digest = digestToolCall(tool, call?.function?.arguments, { retainSecrets });
        calls.set(id, digest ? { tool, digest } : null);
      }
    } else if (message.role === "tool" && message.tool_call_id) {
      const id = String(message.tool_call_id);
      const call = calls.get(id);
      if (!call) continue;
      const event = eventsByCall.get(id);
      const read = event ? { outcome: normalizeOutcome(event.outcome), excerpt: event.safe_excerpt } : readToolMessage(message.content);
      entries.push({ tool: call.tool, digest: call.digest, outcome: read.outcome, excerpt: squash(redact(read.excerpt || "", EXCERPT_MAX)) });
    }
  }
  const collapsed = new Map();
  for (const entry of entries) {
    const key = `${entry.tool}\u0000${entry.digest}\u0000${entry.outcome}`;
    const count = (collapsed.get(key)?.count || 0) + 1;
    collapsed.delete(key);
    collapsed.set(key, { ...entry, count });
  }
  return { attempts: [...collapsed.values()], callIds: [...calls.keys()] };
}

function attemptFact(attempt) {
  return `Attempt: ${attempt.tool} ${attempt.digest} -> ${attempt.outcome}${attempt.excerpt ? `: ${attempt.excerpt}` : ""}`.slice(0, 600);
}

function attemptEvent(attempt) {
  return `${attempt.tool} ${attempt.digest} -> ${attempt.outcome}${attempt.count > 1 ? ` x${attempt.count}` : ""}`;
}

// Folds this reduction's attempts into the events of the previous checkpoint:
// matching entries add their counts and move to the newest position, strings in
// the older tool-and-outcome format are kept as they are, and legacy events from
// this run follow.
function mergeAttemptEvents(previousEvents, attempts, legacyEvents = []) {
  const list = [];
  const add = (key, count) => {
    const at = list.findIndex((entry) => entry.key === key);
    if (at >= 0) { count += list[at].count; list.splice(at, 1); }
    list.push({ key, count });
  };
  for (const text of Array.isArray(previousEvents) ? previousEvents : []) {
    const match = EVENT_PATTERN.exec(String(text));
    if (match) add(`${match[1]} -> ${match[2]}`, match[3] ? Number(match[3]) : 1);
    else list.push({ text: String(text) });
  }
  for (const attempt of Array.isArray(attempts) ? attempts : []) add(`${attempt.tool} ${attempt.digest} -> ${attempt.outcome}`, attempt.count || 1);
  const merged = list.map((entry) => (entry.text !== undefined ? entry.text : `${entry.key}${entry.count > 1 ? ` x${entry.count}` : ""}`));
  return [...merged, ...(Array.isArray(legacyEvents) ? legacyEvents : [])];
}

module.exports = { OUTCOMES, attemptEvent, attemptFact, attemptsFromLedger, digestToolCall, mergeAttemptEvents, readToolMessage, safeUrl };
