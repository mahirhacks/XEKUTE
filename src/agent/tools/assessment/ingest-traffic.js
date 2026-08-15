"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const INGEST_TRAFFIC_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["format"],
  properties: {
    format: { type: "string", enum: ["jsonl", "json", "har", "pair"] },
    source: { type: "string" },
    data: { type: ["string", "array", "object"] },
    records: { type: "array", items: { type: "object" } },
    request: { type: "object" },
    response: { type: "object" },
  },
});

const INGEST_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INGEST_TRAFFIC_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  PARSE_FAILED: "INGEST_TRAFFIC_PARSE_FAILED",
  EMPTY: "INGEST_TRAFFIC_EMPTY",
  UNSUPPORTED_FORMAT: "INGEST_TRAFFIC_UNSUPPORTED_FORMAT",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: INGEST_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["jsonl", "json", "har", "pair"].includes(input.format)) {
    return invalidInput("format must be jsonl, json, har, or pair");
  }
  if (input.source !== undefined && (typeof input.source !== "string" || input.source.trim() === "")) {
    return invalidInput("source must be a non-empty string");
  }
  if (input.format === "pair") {
    if (!isRecord(input.request)) return invalidInput("request must be an object for pair format");
    if (!isRecord(input.response)) return invalidInput("response must be an object for pair format");
  } else if (input.format === "har") {
    if (typeof input.data !== "string" && !isRecord(input.data)) return invalidInput("data must be a string or object for har format");
  } else {
    if (typeof input.data !== "string" && !Array.isArray(input.records)) {
      return invalidInput("data (string) or records (array) is required for jsonl/json format");
    }
  }
  return { ok: true };
}

function normalizeHeaderValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) out[key] = normalizeHeaderValue(value);
  return out;
}

function normalizeRequest(request) {
  const req = request || {};
  return {
    method: String(req.method || "GET").toUpperCase(),
    url: String(req.url || req.path || ""),
    httpVersion: req.httpVersion ? String(req.httpVersion) : undefined,
    headers: normalizeHeaders(req.headers),
    body: req.body !== undefined ? String(req.body) : undefined,
    query: req.query ? normalizeHeaders(req.query) : undefined,
  };
}

function normalizeResponse(response) {
  const res = response || {};
  return {
    status: res.status !== undefined ? Number(res.status) : (res.statusCode !== undefined ? Number(res.statusCode) : undefined),
    statusText: res.statusText ? String(res.statusText) : undefined,
    httpVersion: res.httpVersion ? String(res.httpVersion) : undefined,
    headers: normalizeHeaders(res.headers),
    body: res.body !== undefined ? String(res.body) : undefined,
  };
}

function normalizeHttpExchangeRecord(record) {
  const request = normalizeRequest(record.request);
  const response = normalizeResponse(record.response);
  const normalized = {
    recordType: "http-exchange",
    schemaVersion: 1,
    timestamp: record.timestamp ? String(record.timestamp) : undefined,
    isoTimestamp: record.isoTimestamp || record.timestamp ? String(record.isoTimestamp || record.timestamp) : new Date().toISOString(),
    requestId: record.requestId || record.id ? String(record.requestId || record.id) : undefined,
    targetId: record.targetId ? String(record.targetId) : undefined,
    source: record.source ? String(record.source) : "ingest",
    request,
    response,
  };
  if (record.durationMs !== undefined) normalized.durationMs = Number(record.durationMs);
  if (record.direction) normalized.direction = String(record.direction);
  return normalized;
}

function parseRecords(input) {
  if (input.format === "pair") {
    return [{ request: input.request, response: input.response, source: input.source }];
  }
  if (input.format === "jsonl") {
    const text = String(input.data || "");
    if (!text.trim()) return [];
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { __parseError: `line ${index + 1}: ${error.message}` };
      }
    });
  }
  if (input.format === "json") {
    if (Array.isArray(input.records)) return input.records;
    if (typeof input.data === "string") {
      try {
        const parsed = JSON.parse(input.data);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (error) {
        return [{ __parseError: error.message }];
      }
    }
    return [];
  }
  if (input.format === "har") {
    let har;
    try {
      har = typeof input.data === "string" ? JSON.parse(input.data) : input.data;
    } catch (error) {
      return [{ __parseError: error.message }];
    }
    const entries = har?.log?.entries || [];
    return entries.map((entry) => ({
      requestId: entry._requestId || entry.id,
      timestamp: entry.startedDateTime,
      isoTimestamp: entry.startedDateTime,
      source: "har",
      request: {
        method: entry.request?.method,
        url: entry.request?.url,
        httpVersion: entry.request?.httpVersion,
        headers: Object.fromEntries((entry.request?.headers || []).map(h => [h.name, h.value])),
        body: entry.request?.postData?.text,
        query: Object.fromEntries((entry.request?.queryString || []).map(q => [q.name, q.value])),
      },
      response: {
        status: entry.response?.status,
        statusText: entry.response?.statusText,
        httpVersion: entry.response?.httpVersion,
        headers: Object.fromEntries((entry.response?.headers || []).map(h => [h.name, h.value])),
        body: entry.response?.content?.text,
      },
      durationMs: entry.time,
    }));
  }
  return [];
}

function createIngestTrafficTool() {
  const adapter = {
    name: "ingest_traffic",
    inputSchema: INGEST_TRAFFIC_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(INGEST_ERROR_CODES.INVALID_CONTEXT, "ingest_traffic requires a restricted tool execution context projection");
      }

      let rawRecords;
      try {
        rawRecords = parseRecords(input);
      } catch (error) {
        return structuredFailure(INGEST_ERROR_CODES.PARSE_FAILED, error.message);
      }

      const parseErrors = rawRecords.filter(r => r.__parseError).map(r => r.__parseError);
      const valid = rawRecords.filter(r => !r.__parseError);

      if (valid.length === 0) {
        return structuredFailure(INGEST_ERROR_CODES.PARSE_FAILED, "no valid records could be parsed", { parseErrors });
      }

      const records = valid.map(record => normalizeHttpExchangeRecord(record));

      return {
        ok: true,
        value: {
          format: input.format,
          source: input.source || null,
          total: rawRecords.length,
          parsed: records.length,
          parseErrors,
          records,
        },
      };
    },
  };

  return adapter;
}

module.exports = {
  INGEST_TRAFFIC_INPUT_SCHEMA,
  INGEST_ERROR_CODES,
  createIngestTrafficTool,
  validateInput,
};
