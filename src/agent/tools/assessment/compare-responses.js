"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const COMPARE_RESPONSES_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["responses"],
  properties: {
    responses: {
      type: "array",
      minItems: 2,
      maxItems: 10,
      items: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          status: { type: "integer" },
          statusText: { type: "string" },
          headers: { type: "object" },
          body: { type: "string" },
          bodyStructure: { type: "object" },
          length: { type: "integer", minimum: 0 },
          durationMs: { type: "integer", minimum: 0 },
        },
      },
    },
    compare: {
      type: "array",
      items: {
        type: "string",
        enum: ["status", "headers", "body", "length", "timing", "semantic"],
      },
      uniqueItems: true,
    },
  },
});

const COMPARE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_COMPARE_RESPONSES_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: COMPARE_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!Array.isArray(input.responses) || input.responses.length < 2 || input.responses.length > 10) {
    return invalidInput("responses must be an array of 2-10 items");
  }
  for (let i = 0; i < input.responses.length; i += 1) {
    const r = input.responses[i];
    if (!isRecord(r) || typeof r.id !== "string" || r.id.trim() === "") {
      return invalidInput(`responses[${i}].id must be a non-empty string`);
    }
    if (r.status !== undefined && (!Number.isInteger(r.status) || r.status < 100 || r.status > 599)) {
      return invalidInput(`responses[${i}].status must be an integer between 100 and 599`);
    }
    if (r.headers !== undefined && !isRecord(r.headers)) return invalidInput(`responses[${i}].headers must be an object`);
    if (r.body !== undefined && typeof r.body !== "string") return invalidInput(`responses[${i}].body must be a string`);
    if (r.length !== undefined && (!Number.isInteger(r.length) || r.length < 0)) return invalidInput(`responses[${i}].length must be a non-negative integer`);
    if (r.durationMs !== undefined && (!Number.isInteger(r.durationMs) || r.durationMs < 0)) return invalidInput(`responses[${i}].durationMs must be a non-negative integer`);
  }
  if (input.compare !== undefined) {
    if (!Array.isArray(input.compare)) return invalidInput("compare must be an array");
    const valid = new Set(["status", "headers", "body", "length", "timing", "semantic"]);
    for (const c of input.compare) {
      if (!valid.has(c)) return invalidInput(`compare entry must be one of status, headers, body, length, timing, semantic (got ${c})`);
    }
    if (new Set(input.compare).size !== input.compare.length) return invalidInput("compare must not contain duplicates");
  }
  return { ok: true };
}

function normalizeBodyForCompare(body, bodyStructure) {
  if (bodyStructure) return JSON.stringify(bodyStructure);
  if (typeof body === "string") return body;
  return "";
}

function compareStatus(responses) {
  const statuses = responses.map(r => r.status);
  const distinct = [...new Set(statuses)];
  return {
    equal: distinct.length === 1,
    values: statuses,
    differences: distinct.length > 1 ? `status differs: ${distinct.join(" vs ")}` : null,
  };
}

function compareLength(responses) {
  const lengths = responses.map(r => (r.length !== undefined ? r.length : String(r.body || "").length));
  const distinct = [...new Set(lengths)];
  return {
    equal: distinct.length === 1,
    values: lengths,
    differences: distinct.length > 1 ? `length differs: ${distinct.join(" vs ")}` : null,
  };
}

function compareTiming(responses) {
  const timings = responses.map(r => r.durationMs ?? null);
  const present = timings.filter(t => t !== null);
  const equal = present.length === responses.length && new Set(present).size === 1;
  return {
    equal,
    values: timings,
    differences: !equal && present.length === responses.length ? `timing differs: ${present.join("ms vs ")}ms` : (present.length !== responses.length ? "timing missing on some responses" : null),
  };
}

function compareHeaders(responses) {
  const keys = new Set();
  for (const r of responses) for (const k of Object.keys(r.headers || {})) keys.add(k.toLowerCase());
  const differences = [];
  for (const key of keys) {
    const vals = responses.map(r => {
      const entry = Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === key);
      return entry ? entry[1] : undefined;
    });
    const distinct = [...new Set(vals.map(v => String(v ?? "")))];
    if (distinct.length > 1) differences.push(`header "${key}": ${distinct.join(" vs ")}`);
  }
  return { equal: differences.length === 0, differences };
}

function compareBody(responses) {
  const bodies = responses.map(r => normalizeBodyForCompare(r.body, r.bodyStructure));
  const distinct = [...new Set(bodies)];
  return {
    equal: distinct.length === 1,
    differences: distinct.length > 1 ? `body content differs (${distinct.length} distinct bodies)` : null,
    bodyCounts: bodies.map(b => b.length),
  };
}

// Deterministic semantic comparison: structural signature of the body
// (for JSON, key set + nesting; for text, normalized token set) without
// interpreting meaning.
function semanticSignature(body) {
  const text = String(body || "");
  if (!text.trim()) return "empty";
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed !== null && typeof parsed === "object") {
    return `json:${Object.keys(parsed).sort().join(",")}`;
  }
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort();
  return `text:${[...new Set(tokens)].join(",")}`;
}

function compareSemantic(responses) {
  const sigs = responses.map(r => semanticSignature(r.body));
  const distinct = [...new Set(sigs)];
  return {
    equal: distinct.length === 1,
    signatures: sigs,
    differences: distinct.length > 1 ? `semantic structure differs (${distinct.length} distinct signatures)` : null,
  };
}

function createCompareResponsesTool() {
  const adapter = {
    name: "compare_responses",
    inputSchema: COMPARE_RESPONSES_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(COMPARE_ERROR_CODES.INVALID_CONTEXT, "compare_responses requires a restricted tool execution context projection");
      }

      const compare = input.compare || ["status", "headers", "body", "length", "timing", "semantic"];

      const responses = input.responses.map(r => ({
        id: r.id,
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
        body: r.body,
        bodyStructure: r.bodyStructure,
        length: r.length,
        durationMs: r.durationMs,
      }));

      const report = { responses: responses.map(r => ({ id: r.id, status: r.status, length: r.length ?? String(r.body || "").length, durationMs: r.durationMs ?? null })) };

      if (compare.includes("status")) report.status = compareStatus(responses);
      if (compare.includes("headers")) report.headers = compareHeaders(responses);
      if (compare.includes("body")) report.body = compareBody(responses);
      if (compare.includes("length")) report.length = compareLength(responses);
      if (compare.includes("timing")) report.timing = compareTiming(responses);
      if (compare.includes("semantic")) report.semantic = compareSemantic(responses);

      const sections = Object.keys(report).filter(k => k !== "responses");
      report.allEqual = sections.every(k => report[k].equal !== false);
      report.differencesFound = sections.some(k => report[k].equal === false);

      return { ok: true, value: report };
    },
  };

  return adapter;
}

module.exports = {
  COMPARE_RESPONSES_INPUT_SCHEMA,
  COMPARE_ERROR_CODES,
  createCompareResponsesTool,
  validateInput,
};