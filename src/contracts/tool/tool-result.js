"use strict";

const { RESULT_CODES } = require("./tool-result-codes");

const RESULT_STATUSES = Object.freeze(["success", "partial", "denied", "failed", "unavailable", "cancelled"]);
const STATUS_SET = new Set(RESULT_STATUSES);
const MAX_SUMMARY_CHARS = 2000;
const MAX_DATA_BYTES = 50000;
const MAX_REFERENCE_CHARS = 160;
const SECRET_KEY_RE = /authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|password|passwd|secret|token|private[_-]?key|credential/i;
const RAW_OUTPUT_KEY_RE = /^(?:stdout|stderr|trace|stack|transcript|raw(?:_output|_response)?|body)$/i;

function opaqueReference(value) {
  const reference = String(value || "").trim();
  return reference && reference.length <= MAX_REFERENCE_CHARS && !/[\r\n]/.test(reference) ? reference : "";
}

function redactValue(value, key = "", depth = 0) {
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([name, item]) => [name, redactValue(item, name, depth + 1)]));
  }
  if (typeof value === "string") return value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS)}…` : value;
  return value;
}

function isSerializable(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isSerializable(item, depth + 1));
  if (typeof value === "object") return Object.keys(value).length <= 200 && Object.entries(value).every(([key, item]) => !RAW_OUTPUT_KEY_RE.test(key) && isSerializable(item, depth + 1));
  return false;
}

function normalizeData(data) {
  if (data === undefined) return {};
  const redacted = redactValue(data);
  if (!isSerializable(redacted)) return null;
  const serialized = JSON.stringify(redacted);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DATA_BYTES) return null;
  return redacted;
}

function validateToolResult(result, { requireReferences = false } = {}) {
  if (!result || typeof result !== "object") return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Result must be an object" };
  if (!STATUS_SET.has(result.status)) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Result status is invalid" };
  if (!String(result.code || "").trim()) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Result code is required" };
  if (typeof result.summary !== "string" || result.summary.length > MAX_SUMMARY_CHARS) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Result summary is missing or too large" };
  if (!Array.isArray(result.evidence_refs) || result.evidence_refs.some((value) => !opaqueReference(value))) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Evidence references must be opaque bounded identifiers" };
  if (requireReferences && !result.evidence_refs.length) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Evidence references are required" };
  if (!opaqueReference(result.audit_id) || !opaqueReference(result.operation_id)) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Audit and operation references are required" };
  if (typeof result.retryable !== "boolean" || result.redactions_applied !== true) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Retryability and redaction metadata are required" };
  if (normalizeData(result.data) === null) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Result data is not bounded, serializable, or secret-free" };
  return { ok: true };
}

function createToolResult({
  status = "failed",
  code = RESULT_CODES.ADAPTER_FAILED,
  summary = "",
  data = {},
  evidence_refs = [],
  audit_id = "audit-unknown",
  operation_id = "operation-unknown",
  retryable = false,
} = {}) {
  const normalizedData = normalizeData(data);
  const result = {
    status: STATUS_SET.has(status) ? status : "failed",
    code: String(code || RESULT_CODES.ADAPTER_FAILED),
    summary: String(summary || "").slice(0, MAX_SUMMARY_CHARS),
    data: normalizedData === null ? {} : normalizedData,
    evidence_refs: [...new Set((Array.isArray(evidence_refs) ? evidence_refs : []).map(opaqueReference).filter(Boolean))].slice(0, 100),
    audit_id: opaqueReference(audit_id) || "audit-unknown",
    operation_id: opaqueReference(operation_id) || "operation-unknown",
    retryable: Boolean(retryable),
    redactions_applied: true,
  };
  const validation = validateToolResult(result);
  if (!validation.ok) throw new Error(validation.error);
  return Object.freeze(result);
}

module.exports = {
  RESULT_STATUSES,
  MAX_SUMMARY_CHARS,
  MAX_DATA_BYTES,
  normalizeData,
  validateToolResult,
  createToolResult,
};
