"use strict";

/** Shared failure-class taxonomy for tool envelopes and agent adaptation. */
function classifyErrorCode(code) {
  const value = String(code || "").toUpperCase();
  if (/DATASET_NOT_FOUND|INGEST|PATH_ESCAPE|SCHEMA|PAYLOAD/.test(value)) return "not_found_or_schema";
  if (/MAP_NOT_BUILT|MAP_UNAVAILABLE/.test(value)) return "map_not_built";
  if (/SCOPE|OUT_OF_SCOPE|WORKSPACE_OUT_OF_SCOPE|TARGET_OUT_OF_SCOPE|DENIED|FORBIDDEN|NOT_ALLOWED|RESOURCE_NOT_ALLOWED|TYPED_.*_REQUIRED|NOT_OWNED/.test(value)) return "scope_denied";
  if (/DNS|RESOLUTION|TIMEOUT|TIMED_OUT|NETWORK|UNAVAILABLE/.test(value)) return "infra_or_network";
  if (/SYNTAX|VALID|REQUIRED|MISSING|UNKNOWN_TOOL|TOOL_ERROR|RECORD/.test(value)) return "invalid_input";
  if (/REPEATED_FAILED/.test(value)) return "retry_exhausted";
  return "transient";
}

function deriveErrorClass(result) {
  if (result?.errorClass) return result.errorClass;
  return classifyErrorCode(result?.errorCode || result?.code || "");
}

module.exports = { classifyErrorCode, deriveErrorClass };
