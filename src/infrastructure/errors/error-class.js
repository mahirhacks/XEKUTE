"use strict";

/**
 * Error classification seam. The adapter/tool error-class compatibility path
 * re-exports from here; application and container code classify errors through
 * this single module.
 */
function classifyErrorCode(error) {
  if (!error || typeof error !== "object") return "UNKNOWN_ERROR";
  return String(error.code || error.errorClass || "UNKNOWN_ERROR");
}

function deriveErrorClass(input) {
  if (!input || typeof input !== "object") return "UNKNOWN_ERROR";
  return String(input.errorClass || input.code || "UNKNOWN_ERROR");
}

module.exports = { classifyErrorCode, deriveErrorClass };
