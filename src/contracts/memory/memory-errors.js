"use strict";

class MemoryContractError extends Error {
  constructor(code, message, details = {}, { retryable = false } = {}) {
    super(String(message || code || "Memory contract validation failed."));
    this.name = "MemoryContractError";
    this.code = String(code || "MEMORY_CONTRACT_INVALID");
    this.details = details && typeof details === "object" ? details : {};
    this.retryable = Boolean(retryable);
  }
}

function fail(code, message, details = {}, options = {}) {
  return {
    ok: false,
    error: {
      code: String(code || "MEMORY_OPERATION_FAILED"),
      message: String(message || "Memory operation failed."),
      retryable: Boolean(options.retryable),
      ...(details && Object.keys(details).length ? { details } : {}),
    },
  };
}

function success(value, metadata = {}) {
  return { ok: true, value, ...metadata };
}

function assert(condition, code, message, details = {}, options = {}) {
  if (!condition) throw new MemoryContractError(code, message, details, options);
}

function validate(factory, input) {
  try {
    return success(factory(input));
  } catch (error) {
    if (error instanceof MemoryContractError) return fail(error.code, error.message, error.details, { retryable: error.retryable });
    return fail("MEMORY_CONTRACT_INTERNAL_ERROR", error?.message || "Memory contract validation failed.");
  }
}

module.exports = Object.freeze({ MemoryContractError, fail, success, assert, validate });
