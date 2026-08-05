"use strict";

const { createToolResult, normalizeData, validateToolResult } = require("../../contracts/tool/tool-result");
const { RESULT_CODES } = require("../../contracts/tool/tool-result-codes");

const RAW_KEYS = new Set(["stdout", "stderr", "stack", "trace", "transcript", "raw", "raw_output", "raw_response"]);
const BOUNDED_KEYS = new Set([
  "mode", "file", "path", "files", "count", "exitCode", "signal", "timedOut", "status", "target", "provider",
  "terminalId", "processId", "subagentId", "waitId", "waitMs", "query", "summary", "errorCode", "errorClass",
  "lines_added", "lines_removed", "patches_applied", "fallback", "warnings", "missing", "datasets", "provisioned",
  "unprovisioned", "overview", "analysis", "graphMeta", "node", "edges", "neighbors", "paths", "routes", "objects",
  "hypotheses", "annotation", "scope", "finalUrl", "title", "contentType", "truncated", "outputCompleteness",
  "content", "error", "artifact_refs", "decision_id", "expires_at", "request_id", "finding_id", "plan_id", "step_id",
  "continuation_required", "checkpoint_id", "managed_operation_id", "lines_available", "lines_returned",
  "log_lines", "process_status", "running", "exit_code", "signal", "segment_count", "truncation_reason",
  "output_complete", "output_truncated", "last_checkpoint_sequence", "continuation_turns",
]);

function reference(value, fallback) {
  const normalized = String(value || fallback || "").trim();
  return normalized && normalized.length <= 160 && !/[\r\n]/.test(normalized) ? normalized : fallback;
}

function boundedData(result = {}, maxBytes) {
  const data = {};
  const artifact = reference(result.artifactId || result.artifact_id, "");
  for (const [key, value] of Object.entries(result || {})) {
    if (!BOUNDED_KEYS.has(key) || RAW_KEYS.has(key) || value === undefined) continue;
    data[key] = value;
  }
  if (artifact) data.artifact_refs = [artifact];
  const normalized = normalizeData(data);
  if (normalized === null) return { artifact_refs: artifact ? [artifact] : [] };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") <= maxBytes) return normalized;
  return {
    artifact_refs: artifact ? [artifact] : [],
    truncated: true,
  };
}

function statusForLegacy(result = {}) {
  if (result.cancelled || result.status === "cancelled") return "cancelled";
  if (result.denied || result.status === "denied") return "denied";
  if (result.unavailable || result.code === "ADAPTER_UNAVAILABLE") return "unavailable";
  if (result.status === "partial" || result.partial || result.outputCompleteness === "partial") return "partial";
  if (result.error || result.ok === false) return result.partial || result.outputCompleteness === "partial" ? "partial" : "failed";
  if (result.partial || result.outputCompleteness === "partial") return "partial";
  return "success";
}

function projectToolResult(result = {}, {
  operationId = "operation-unknown",
  auditId = "audit-unknown",
  evidenceRefs = [],
  maxDataBytes = 50000,
  artifactRef = "",
} = {}) {
  const status = statusForLegacy(result);
  const code = result.code || result.errorCode || (status === "success" ? RESULT_CODES.OK : status === "cancelled" ? RESULT_CODES.OPERATION_CANCELLED : status === "unavailable" ? RESULT_CODES.ADAPTER_UNAVAILABLE : status === "partial" ? RESULT_CODES.PARTIAL : RESULT_CODES.ADAPTER_FAILED);
  const summary = String(result.summary || result.error || (status === "success" ? "Operation completed." : "Operation did not complete."));
  const refs = [...new Set([
    ...(Array.isArray(evidenceRefs) ? evidenceRefs : []),
    ...(artifactRef ? [artifactRef] : []),
    ...(result.evidence_refs || result.evidenceRefs || result.artifact_refs || []),
  ].map((value) => reference(value)).filter(Boolean))];
  const projected = createToolResult({
    status,
    code,
    summary,
    data: boundedData(result, maxDataBytes),
    evidence_refs: refs,
    audit_id: auditId,
    operation_id: operationId,
    retryable: Boolean(result.retryable),
  });
  const validation = validateToolResult(projected);
  if (!validation.ok) {
    return createToolResult({
      status: "failed",
      code: RESULT_CODES.INVALID_INPUT,
      summary: "The operation result could not be projected safely.",
      data: {},
      evidence_refs: [],
      audit_id: auditId,
      operation_id: operationId,
      retryable: false,
    });
  }
  return projected;
}

function resultForModel(result, options = {}) {
  return projectToolResult(result, options);
}

module.exports = { projectToolResult, resultForModel, boundedData, statusForLegacy };
