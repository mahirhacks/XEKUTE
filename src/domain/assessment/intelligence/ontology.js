"use strict";

const crypto = require("node:crypto");
const { redactStructuredValue } = require("../../../shared/secret-redaction.js");

const MAX_TEXT = 12_000;
const MAX_ARRAY = 100;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableId(prefix, value) {
  return `${prefix}:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24)}`;
}

function text(value, maximum = MAX_TEXT) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function safeJson(value) {
  try {
    const sanitized = redactStructuredValue(value);
    return text(typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized));
  } catch {
    return text(value);
  }
}

function parseUrl(rawUrl, host = "") {
  const raw = text(rawUrl, 4_000);
  if (!raw) return null;
  try {
    return new URL(raw, host ? `http://${host}` : undefined);
  } catch {
    try { return new URL(`http://${raw.replace(/^\/+/, "")}`); } catch { return null; }
  }
}

function singular(value) {
  const clean = text(value, 80).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "item";
  if (clean.endsWith("ies") && clean.length > 3) return `${clean.slice(0, -3)}y`;
  if (clean.endsWith("s") && !clean.endsWith("ss")) return clean.slice(0, -1);
  return clean;
}

function dynamicSegment(value) {
  const segment = text(value, 200);
  if (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[0-9a-f]{16,}$/i.test(segment)) return "id";
  if (/^\d{4}-\d{2}-\d{2}/.test(segment)) return "date";
  if (segment.length >= 24 && /^[a-z0-9_=-]+$/i.test(segment)) return "token";
  return "";
}

function normalizeRoute(pathname = "/") {
  const parts = text(pathname || "/", 4_000).split("/");
  const parameters = [];
  const route = parts.map((part, index) => {
    if (!part) return part;
    let decoded = part;
    try { decoded = decodeURIComponent(part); } catch { /* keep the raw segment */ }
    const category = dynamicSegment(decoded);
    if (!category) return part;
    const name = `${singular(parts[index - 1] || "item")}_${category === "token" ? "token" : "id"}`;
    parameters.push({ name, location: "path", category });
    return `{${name}}`;
  }).join("/");
  return { template: route || "/", parameters };
}

function headersOf(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value.headers || value.header || value;
  const headers = {};
  for (const line of String(value).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function bodyOf(value) {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value)) return firstValue(value.body, value.content, value.text, "");
  return String(value);
}

function responseShape(response) {
  const headers = headersOf(response);
  const body = bodyOf(response);
  const contentType = text(headers["content-type"] || headers["Content-Type"] || "", 160).split(";", 1)[0].toLowerCase();
  let shape = { type: contentType || "unknown", lengthBucket: Math.ceil(body.length / 1024) };
  if (contentType.includes("json") || /^\s*[\[{]/.test(body)) {
    try {
      const value = JSON.parse(body);
      const visit = (entry, depth = 0) => {
        if (depth > 4 || entry == null) return typeof entry;
        if (Array.isArray(entry)) return [entry.length ? visit(entry[0], depth + 1) : "unknown"];
        if (typeof entry === "object") return Object.fromEntries(Object.keys(entry).sort().slice(0, 80).map((key) => [key, visit(entry[key], depth + 1)]));
        return typeof entry;
      };
      shape = visit(value);
    } catch { /* retain coarse shape */ }
  }
  return { contentType: contentType || "unknown", shape, length: body.length };
}

function responseSignature(response) {
  const status = Number(response?.status ?? response?.statusCode ?? 0) || 0;
  const shaped = responseShape(response);
  return crypto.createHash("sha256").update(canonicalJson({ status, shape: shaped })).digest("hex").slice(0, 32);
}

function recordUrl(record) {
  const request = record?.request && typeof record.request === "object" ? record.request : {};
  return firstValue(record?.url, record?.target, request.url, record?.requestUrl, "");
}

function recordMethod(record) {
  const request = record?.request && typeof record.request === "object" ? record.request : {};
  return text(firstValue(record?.method, request.method, record?.httpMethod, "GET"), 20).toUpperCase();
}

function recordResponse(record) {
  return record?.response && typeof record.response === "object" ? record.response : {
    status: firstValue(record?.status, record?.statusCode, 0),
    headers: record?.responseHeaders || {},
    body: firstValue(record?.responseBody, record?.body, ""),
  };
}

function entity(type, key, label, summary, data = {}) {
  const id = stableId(type, key);
  return {
    id,
    type,
    key: text(key, 2_000),
    label: text(label || key, 500),
    summary: text(summary || label || key, 4_000),
    data: redactStructuredValue(data),
  };
}

function normalizeRecord(record, { sourcePath = "", sourceOffset = 0, sourceLength = 0, runId = "", planId = "" } = {}) {
  const source = record && typeof record === "object" ? record : { value: record };
  const producedRunId = text(runId || source.runId || source.producedRunId || "", 200);
  const producedPlanId = text(planId || source.planId || "", 200);
  const url = parseUrl(recordUrl(source), source.host || source.hostname || "");
  const method = recordMethod(source);
  const response = recordResponse(source);
  const status = Number(response?.status ?? response?.statusCode ?? source.status ?? source.statusCode ?? 0) || 0;
  const host = text(url?.hostname || source.host || source.hostname || "", 500).toLowerCase();
  const pathname = text(url?.pathname || source.path || source.pathname || "/", 4_000) || "/";
  const route = normalizeRoute(pathname);
  const identity = text(firstValue(source.identityId, source.identity, source.userId, source.user, source.account, ""), 300);
  const sourceKey = `${sourcePath}|${sourceOffset}|${sourceLength}|${source.requestId || source.id || canonicalJson(source)}`;
  const evidenceId = text(firstValue(source.evidenceId, source.requestId, source.id, stableId("evidence", sourceKey)), 300);
  const sanitized = redactStructuredValue(source);
  const evidence = {
    id: evidenceId,
    type: text(source.recordType || source.type || "observation", 100),
    sourcePath: text(sourcePath, 2_000),
    sourceOffset: Number(sourceOffset) || 0,
    sourceLength: Number(sourceLength) || 0,
    sourceHash: crypto.createHash("sha256").update(safeJson(source)).digest("hex"),
    summary: text(`${method} ${host}${route.template}${status ? ` → ${status}` : ""}`, 4_000),
    sanitized,
    producedRunId,
    planId: producedPlanId,
    createdAt: text(firstValue(source.isoTimestamp, source.timestamp, source.createdAt, new Date().toISOString()), 80),
  };
  const entities = [];
  const relationships = [];
  if (host) {
    const hostEntity = entity("host", host, host, `Observed host ${host}`, { host });
    entities.push(hostEntity);
  }
  if (host || route.template) {
    const endpointKey = `${method}|${host}|${route.template}`;
    const endpoint = entity("endpoint", endpointKey, `${method} ${route.template}`, `Observed ${method} ${route.template}`, {
      host, method, path: route.template, parameters: route.parameters, status, identity,
    });
    entities.push(endpoint);
    if (host) relationships.push({ sourceId: stableId("host", host), targetId: endpoint.id, type: "EXPOSES", confidence: 1 });
    if (identity) {
      const identityEntity = entity("identity", identity, identity, `Observed identity ${identity}`, { identity });
      entities.push(identityEntity);
      relationships.push({ sourceId: identityEntity.id, targetId: endpoint.id, type: "ACCESSES", confidence: 0.8 });
    }
    relationships.push({ sourceId: endpoint.id, targetId: stableId("response-cluster", responseSignature(response)), type: "RETURNS", confidence: 1 });
  }
  const responseCluster = entity("response-cluster", responseSignature(response), `Response ${responseSignature(response).slice(0, 8)}`, `Observed response cluster${status ? ` ${status}` : ""}`, { status, shape: responseShape(response) });
  entities.push(responseCluster);
  const observations = [];
  if (host && route.template) {
    observations.push({
      id: stableId("observation", `${evidenceId}|${method}|${host}|${route.template}|${status}`),
      key: `${method}|${host}|${route.template}|${status}`,
      summary: `${method} ${host}${route.template} was observed${status ? ` with status ${status}` : ""}.`,
      evidenceIds: [evidenceId],
      entityIds: entities.map((item) => item.id),
      data: { method, host, route: route.template, status, identity, responseShape: responseShape(response) },
    });
  }
  return { evidence, entities, relationships, observations };
}

function normalizeGenericRecord(record, options = {}) {
  const normalized = normalizeRecord(record, options);
  if (!normalized.entities.length && record && typeof record === "object") {
    const label = firstValue(record.title, record.name, record.id, options.sourcePath, "record");
    const generic = entity(String(record.type || "artifact"), `${options.sourcePath}|${label}|${canonicalJson(record)}`, label, safeJson(record), record);
    normalized.entities.push(generic);
  }
  return normalized;
}

module.exports = {
  MAX_TEXT,
  canonicalJson,
  stableId,
  normalizeRoute,
  responseShape,
  responseSignature,
  normalizeRecord,
  normalizeGenericRecord,
};
