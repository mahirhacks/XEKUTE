"use strict";

// Canonical tool-call argument parser shared by the production controller and
// the disposable harness. Never collapses parse failures to {}. Returns a
// structured result so callers can distinguish:
//   - a valid object payload          -> { ok: true, value, rawLength }
//   - empty / missing arguments       -> { ok: false, code: "EMPTY_TOOL_ARGUMENTS", ... }
//   - malformed JSON                  -> { ok: false, code: "MALFORMED_TOOL_ARGUMENTS", ... }
//   - valid JSON with non-object root -> { ok: false, code: "INVALID_TOOL_ARGUMENT_SHAPE", ... }

const PARSE_TOOL_ARGUMENT_CODES = Object.freeze({
  EMPTY_TOOL_ARGUMENTS: "EMPTY_TOOL_ARGUMENTS",
  MALFORMED_TOOL_ARGUMENTS: "MALFORMED_TOOL_ARGUMENTS",
  INVALID_TOOL_ARGUMENT_SHAPE: "INVALID_TOOL_ARGUMENT_SHAPE",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseToolArguments(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ok: true, value: raw, rawLength: 0, raw };
  }

  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, code: PARSE_TOOL_ARGUMENT_CODES.EMPTY_TOOL_ARGUMENTS, args: null, raw: raw ?? "", rawLength: String(raw ?? "").length };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { ok: false, code: PARSE_TOOL_ARGUMENT_CODES.INVALID_TOOL_ARGUMENT_SHAPE, args: null, raw, rawLength: raw.length };
    }
    return { ok: true, value: parsed, rawLength: raw.length, raw };
  } catch (error) {
    return { ok: false, code: PARSE_TOOL_ARGUMENT_CODES.MALFORMED_TOOL_ARGUMENTS, args: null, raw, rawLength: raw.length, parseError: error.message };
  }
}

module.exports = { PARSE_TOOL_ARGUMENT_CODES, parseToolArguments };
