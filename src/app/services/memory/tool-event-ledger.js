"use strict";

const nodeCrypto = require("node:crypto");
const {
  canonicalJson,
  canonicalKeyHash,
  isMemoryId,
} = require("../../../contracts/memory/memory-identity.js");
const { createToolLedgerEntry } = require("../../../contracts/memory/operational-context-contracts.js");
const { assertNoSecretKeys } = require("../../storage/memory/memory-storage-utils.js");
const { redactSecrets } = require("../../../shared/secret-redaction.js");

const TOOL_EVENT_LEDGER_VERSION = 1;
const MAX_INPUT_EVENTS = 10_000;
const MAX_CLUSTERS = 500;
const MAX_SOURCE_REFS = 100;
const EPOCH = "1970-01-01T00:00:00.000Z";

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function lower(value, maximum = 500) { return text(value, maximum).toLowerCase(); }

function array(value, maximum = MAX_SOURCE_REFS) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => text(entry, 240))
    .filter(Boolean))].sort().slice(0, maximum);
}

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw.length > 1_000_000) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function nestedPayload(source) {
  if (!source || typeof source !== "object") return {};
  const payload = source.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return parseJson(payload) || {};
}

function structuredSource(message) {
  const result = message?.result && typeof message.result === "object" ? message.result : {};
  const parsedContent = parseJson(message?.content);
  const content = parsedContent || {};
  const nestedResult = result && typeof result.result === "object" ? result.result : {};
  const payload = nestedPayload(result).constructor === Object && Object.keys(nestedPayload(result)).length
    ? nestedPayload(result)
    : nestedPayload(content);
  return { result, content, nestedResult, payload };
}

function normalizePath(value) {
  const raw = redactSecrets(text(value, 4_000));
  if (!raw) return "";
  const compact = raw.replace(/[\\/]+/g, "/").replace(/\/\.\//g, "/");
  return compact.length > 2_000 ? compact.slice(0, 1_985) + "...[truncated]" : compact;
}

function dynamicSegment(segment) {
  const value = String(segment || "");
  if (!value) return "";
  if (/^\d+$/.test(value) || /^[0-9a-f]{8,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return ":id";
  return value.length > 160 ? ":value" : value;
}

function normalizeRoute(value) {
  const raw = redactSecrets(text(value, 4_000));
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const pathname = `/${url.pathname.split("/").filter(Boolean).map(dynamicSegment).join("/")}`.replace(/\/+/g, "/");
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${pathname === "/" ? "/" : pathname}`;
  } catch {
    const withoutQuery = raw.split(/[?#]/, 1)[0];
    const pathname = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
    return `route:${pathname.split("/").filter(Boolean).map(dynamicSegment).join("/") || "root"}`.slice(0, 4_000);
  }
}

function normalizeCommand(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  // Keep only the executable class. Full commands can contain credentials,
  // request bodies, or authorization headers and never belong in the ledger.
  const match = raw.match(/^(?:["']([^"']+)["']|([^\s;&|]+))/);
  const executable = text(match?.[1] || match?.[2] || "command", 240).replace(/[\\/]+/g, "/").split("/").at(-1);
  return `command:${lower(executable, 160)}`;
}

function statusCode(source) {
  const candidates = [source.statusCode, source.status_code, source.httpStatus, source.http_status, source.response?.statusCode, source.response?.status_code, source.response?.status];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 100 && number <= 999) return number;
  }
  return null;
}

function normalizedStatus(source) {
  const code = statusCode(source);
  if (code !== null) return String(code);
  const value = lower(source.status || source.state || source.outcome || source.result, 80);
  if (["success", "succeeded", "complete", "completed", "ok", "passed"].includes(value)) return "complete";
  if (["error", "failed", "failure", "blocked", "cancelled", "canceled", "timeout", "timed_out"].includes(value)) return value;
  if (source.ok === true) return "complete";
  if (source.ok === false) return "failed";
  return value || "unknown";
}

function terminalOutcome(source, status) {
  const value = lower(source.outcome || source.state || source.status, 80);
  if (source.ok === false || ["error", "failed", "failure", "blocked", "cancelled", "canceled", "timeout", "timed_out"].includes(value)) return value === "blocked" ? "blocked" : "failed";
  const code = Number(status);
  if (Number.isInteger(code) && code >= 500) return "http_error";
  return "completed";
}

function authState(source) {
  const explicit = lower(source.authState || source.auth_state || source.authenticationState || source.authentication_state, 120);
  if (explicit) return explicit;
  if (source.authenticated === true || source.isAuthenticated === true) return "authenticated";
  if (source.authenticated === false || source.isAuthenticated === false) return "anonymous";
  if (source.identityId || source.identity_id || source.identityRef || source.identity_ref) return "identity_bound";
  return "unknown";
}

function identityRef(source) {
  const value = source.identityRef || source.identity_ref || source.identityId || source.identity_id || source.identity?.id || "";
  return text(value, 240);
}

function roleOf(source) { return text(source.role || source.identity?.role || source.operatorRole || source.operator_role, 160); }

function schemaShape(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value === null ? "null" : "unknown";
  if (Array.isArray(value)) return [value.length ? schemaShape(value[0], depth + 1) : "unknown"];
  if (typeof value !== "object") return typeof value;
  return Object.keys(value).sort().slice(0, 100).reduce((result, key) => {
    result[key] = schemaShape(value[key], depth + 1);
    return result;
  }, {});
}

function responseSchemaHash(crypto, source) {
  const candidate = source.response && typeof source.response === "object"
    ? source.response
    : source.body && typeof source.body === "object"
      ? source.body
      : source.payload && typeof source.payload === "object"
        ? source.payload
        : null;
  if (!candidate) return "";
  try { return crypto.createHash("sha256").update(canonicalJson(schemaShape(candidate)), "utf8").digest("hex"); } catch { return ""; }
}

function securityFlags(source) {
  const flags = [];
  const supplied = source.securityFlags || source.security_flags || source.flags;
  if (Array.isArray(supplied)) flags.push(...supplied);
  if (source.redirect || source.redirected || source.location) flags.push("redirect");
  if (source.setCookie || source.set_cookie || source.cookies) flags.push("set_cookie");
  if (source.cors || source.corsHeaders || source.cors_headers) flags.push("cors");
  if (source.csrf || source.csrfToken || source.csrf_token) flags.push("csrf");
  if (source.authorization || source.authorizationRequired || source.authorization_required) flags.push("authorization");
  return [...new Set(flags.map((value) => lower(value, 80)).filter((value) => /^[a-z0-9._:-]+$/.test(value)))].sort().slice(0, 50);
}

function observedAt(source) {
  const candidates = [source.observedAt, source.observed_at, source.createdAt, source.created_at, source.timestamp, source.time_stamp];
  for (const value of candidates) {
    const date = new Date(String(value || ""));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return EPOCH;
}

function sourceMessageId(message) { return text(message?.id || message?.messageId || message?.message_id, 240); }

function artifactRefs(source) {
  return array([
    ...(Array.isArray(source.artifactRefs) ? source.artifactRefs : []),
    ...(Array.isArray(source.artifact_refs) ? source.artifact_refs : []),
    ...(Array.isArray(source.evidenceRefs) ? source.evidenceRefs : []),
    ...(Array.isArray(source.evidence_refs) ? source.evidence_refs : []),
  ], 100);
}

function sourceFields(message) {
  const { result, content, nestedResult, payload } = structuredSource(message);
  return {
    ...payload,
    ...nestedResult,
    ...result,
    ...content,
    ...message,
  };
}

function toolNameOf(message, source) {
  return text(message?.tool_name || message?.toolName || message?.name || source.tool_name || source.toolName || "tool", 160);
}

function argumentSource(message) {
  const call = Array.isArray(message?.tool_calls) ? message.tool_calls[0] : message?.tool_call;
  const functionValue = call?.function || call || {};
  let args = functionValue.arguments || message?.arguments || message?.args || {};
  if (typeof args === "string") args = parseJson(args) || {};
  return args && typeof args === "object" ? args : {};
}

function actionRecord(message, kind, crypto) {
  const source = sourceFields(message);
  const args = argumentSource(message);
  const toolName = toolNameOf(message, source);
  const method = lower(source.method || source.httpMethod || source.http_method || args.method, 20).toUpperCase();
  const route = normalizeRoute(source.url || source.route || source.path || source.targetUrl || source.target_url || args.url || args.route || args.path || args.target);
  const targetKey = kind === "traffic"
    ? `${method || "UNKNOWN"} ${route || "route:unknown"}`
    : toolName.toLowerCase() === "exec_command"
      ? normalizeCommand(args.command || source.command || args.executable || source.executable)
      : route || normalizePath(source.target || args.target || args.path || "") || "target:unknown";
  const status = normalizedStatus(source);
  const identity = identityRef(source);
  const role = roleOf(source);
  const auth = authState(source);
  const schemaHash = responseSchemaHash(crypto, source);
  const flags = securityFlags(source);
  const outcome = terminalOutcome(source, status);
  const variationFlags = [
    ...(kind === "traffic" ? ["traffic"] : ["tool"]),
    ...(flags.length ? ["security_relevant"] : []),
    ...(schemaHash ? ["response_schema"] : []),
    ...(Number(status) >= 400 ? ["http_error"] : []),
  ];
  const retryCount = Math.max(0, Number(source.retryCount ?? source.retry_count ?? source.retries ?? 0) || 0);
  const isRetry = Boolean(source.retry === true || source.isRetry === true || source.is_retry === true || retryCount > 0);
  const fingerprint = canonicalKeyHash({
    category: kind,
    tool_name: toolName.toLowerCase(),
    method,
    target_key: targetKey,
    identity_ref: identity,
    role,
    auth_state: auth,
    status,
    response_schema_hash: schemaHash,
    security_flags: flags,
    terminal_outcome: outcome,
  });
  return {
    category: kind,
    toolName,
    targetKey,
    method,
    identityRef: identity,
    role,
    authState: auth,
    status,
    responseSchemaHash: schemaHash,
    securityFlags: flags,
    terminalOutcome: outcome,
    variationFlags: [...new Set(variationFlags)].sort(),
    retryCount: isRetry ? Math.max(1, retryCount) : 0,
    sourceMessageId: sourceMessageId(message),
    artifactRefs: artifactRefs(source),
    observedAt: observedAt(source),
    fingerprint,
  };
}

function eventCandidates(input, kind) {
  const messages = Array.isArray(input) ? input : [];
  return messages.slice(0, MAX_INPUT_EVENTS).filter((entry) => entry && typeof entry === "object").map((entry) => actionRecord(entry, kind, nodeCrypto));
}

function aggregate(records, { projectId, sessionId, crypto = nodeCrypto, actor = { type: "system", id: "tool-event-ledger" }, sourcePrefix = "message" } = {}) {
  const map = new Map();
  for (const record of records) {
    const prior = map.get(record.fingerprint);
    if (!prior) {
      map.set(record.fingerprint, {
        ...record,
        count: 1,
        failureCount: ["failed", "blocked", "http_error"].includes(record.terminalOutcome) ? 1 : 0,
        retryCount: record.retryCount,
        omittedCount: 0,
        sourceMessageIds: record.sourceMessageId ? [record.sourceMessageId] : [],
        representativeArtifactRefs: [...record.artifactRefs],
        failureArtifactRefs: ["failed", "blocked", "http_error"].includes(record.terminalOutcome) ? [...record.artifactRefs] : [],
        firstObservedAt: record.observedAt,
        firstObservedTie: record.sourceMessageId,
        lastObservedAt: record.observedAt,
        lastObservedTie: record.sourceMessageId,
      });
      continue;
    }
    prior.count += 1;
    prior.omittedCount += 1;
    prior.failureCount += ["failed", "blocked", "http_error"].includes(record.terminalOutcome) ? 1 : 0;
    prior.retryCount += record.retryCount;
    prior.sourceMessageIds = array([...prior.sourceMessageIds, record.sourceMessageId], MAX_SOURCE_REFS);
    prior.representativeArtifactRefs = array([...prior.representativeArtifactRefs, ...record.artifactRefs], 100);
    if (["failed", "blocked", "http_error"].includes(record.terminalOutcome)) prior.failureArtifactRefs = array([...prior.failureArtifactRefs, ...record.artifactRefs], 100);
    prior.variationFlags = [...new Set([...prior.variationFlags, ...record.variationFlags])].sort().slice(0, 50);
    if (`${record.observedAt}\u0000${record.sourceMessageId}` < `${prior.firstObservedAt}\u0000${prior.firstObservedTie}`) {
      prior.firstObservedAt = record.observedAt;
      prior.firstObservedTie = record.sourceMessageId;
    }
    if (`${record.observedAt}\u0000${record.sourceMessageId}` > `${prior.lastObservedAt}\u0000${prior.lastObservedTie}`) {
      prior.lastObservedAt = record.observedAt;
      prior.lastObservedTie = record.sourceMessageId;
    }
  }
  const ordered = [...map.values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)).slice(0, MAX_CLUSTERS);
  const omittedClusters = Math.max(0, map.size - ordered.length);
  const entries = ordered.map((record) => {
    const recordId = `event_${record.fingerprint.slice(0, 32)}`;
    const refs = array([
      ...record.sourceMessageIds.map((value) => `${sourcePrefix}:${value}`),
      `ledger:${record.fingerprint}`,
    ], MAX_SOURCE_REFS);
    const entry = createToolLedgerEntry({
      record_id: recordId,
      project_id: projectId,
      session_id: sessionId,
      category: record.category,
      created_at: record.firstObservedAt,
      updated_at: record.lastObservedAt,
      fingerprint: record.fingerprint,
      canonical_key_hash: canonicalKeyHash({ project_id: projectId, session_id: sessionId, category: record.category, fingerprint: record.fingerprint }),
      tool_name: record.toolName || "tool",
      target_key: record.targetKey,
      identity_ref: record.identityRef,
      role: record.role,
      auth_state: record.authState,
      terminal_outcome: record.terminalOutcome,
      status: record.status,
      response_schema_hash: record.responseSchemaHash,
      variation_flags: record.variationFlags,
      count: record.count,
      failure_count: record.failureCount,
      retry_count: record.retryCount,
      omitted_count: record.omittedCount,
      first_observed_at: record.firstObservedAt,
      last_observed_at: record.lastObservedAt,
      representative_artifact_refs: record.representativeArtifactRefs,
      failure_artifact_refs: record.failureArtifactRefs,
      source_message_ids: record.sourceMessageIds,
      actor,
      provenance: { source_type: "runtime_event", source_refs: refs, captured_at: record.lastObservedAt },
      sensitivity: "internal",
    });
    return entry;
  });
  return { entries, omittedClusters, clusterCount: map.size, sourceCount: records.length };
}

function reduceToolEvents({ projectId, sessionId, messages = [], events = [], actor, crypto = nodeCrypto } = {}) {
  if (!isMemoryId(String(projectId || ""), "proj")) return { ok: false, code: "MEMORY_PROJECT_ID_INVALID", error: "A protected proj_ project ID is required for the tool ledger." };
  const all = [...(Array.isArray(messages) ? messages : []), ...(Array.isArray(events) ? events : [])].filter((entry) => entry && typeof entry === "object").slice(0, MAX_INPUT_EVENTS);
  const tools = all.filter((entry) => {
    const role = lower(entry.role, 40);
    return role === "tool" || entry.tool_name || entry.toolName || entry.tool || entry.tool_calls || entry.tool_call;
  });
  const traffic = all.filter((entry) => {
    const source = sourceFields(entry);
    return Boolean(source.url || source.route || source.method || source.statusCode || source.status_code || source.responseSchemaHash || source.response_schema_hash);
  });
  const toolResult = aggregate(tools.map((entry) => actionRecord(entry, "tool", crypto)), { projectId, sessionId, actor, crypto, sourcePrefix: "message" });
  const trafficResult = aggregate(traffic.map((entry) => actionRecord(entry, "traffic", crypto)), { projectId, sessionId, actor, crypto, sourcePrefix: "traffic" });
  const entries = [...toolResult.entries, ...trafficResult.entries].sort((left, right) => `${left.category}\u0000${left.fingerprint}`.localeCompare(`${right.category}\u0000${right.fingerprint}`));
  const omittedCount = Math.max(0, tools.length - toolResult.entries.reduce((sum, entry) => sum + entry.count, 0))
    + Math.max(0, traffic.length - trafficResult.entries.reduce((sum, entry) => sum + entry.count, 0));
  const output = {
    ok: true,
    version: TOOL_EVENT_LEDGER_VERSION,
    projectId: String(projectId),
    sessionId: String(sessionId || ""),
    toolEntries: toolResult.entries,
    trafficEntries: trafficResult.entries,
    entries,
    sourceCount: all.length,
    toolSourceCount: tools.length,
    trafficSourceCount: traffic.length,
    clusterCount: entries.length,
    omittedCount: omittedCount + toolResult.omittedClusters + trafficResult.omittedClusters,
    warnings: [],
  };
  try {
    assertNoSecretKeys(output);
    output.reductionHash = crypto.createHash("sha256").update(canonicalJson({
      version: output.version,
      toolEntries: output.toolEntries,
      trafficEntries: output.trafficEntries,
      sourceCount: output.sourceCount,
      omittedCount: output.omittedCount,
    }), "utf8").digest("hex");
  } catch (error) {
    return { ok: false, code: error.code || "MEMORY_CONTEXT_LEDGER_INVALID", error: error.message || "Tool ledger output is invalid." };
  }
  return output;
}

module.exports = Object.freeze({
  TOOL_EVENT_LEDGER_VERSION,
  MAX_INPUT_EVENTS,
  MAX_CLUSTERS,
  normalizeRoute,
  normalizeCommand,
  responseSchemaHash,
  actionRecord,
  reduceToolEvents,
});
