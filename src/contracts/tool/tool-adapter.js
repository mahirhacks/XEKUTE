"use strict";

const TOOL_ADAPTER_ERROR_CODES = Object.freeze({
  INVALID_ADAPTER: "INVALID_TOOL_ADAPTER",
  INVALID_NAME: "INVALID_TOOL_ADAPTER_NAME",
  INVALID_SCHEMA: "INVALID_TOOL_ADAPTER_SCHEMA",
  INVALID_EXECUTOR: "INVALID_TOOL_ADAPTER_EXECUTOR",
});

function failure(code, message) {
  return {
    ok: false,
    error: { code, message },
  };
}

function validateToolAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    return failure(TOOL_ADAPTER_ERROR_CODES.INVALID_ADAPTER, "Tool adapter must be an object");
  }
  if (typeof adapter.name !== "string" || adapter.name.trim() === "") {
    return failure(TOOL_ADAPTER_ERROR_CODES.INVALID_NAME, "Tool adapter name must be a non-empty string");
  }
  if (
    !adapter.inputSchema
    || (typeof adapter.inputSchema !== "object" && typeof adapter.inputSchema !== "function")
  ) {
    return failure(
      TOOL_ADAPTER_ERROR_CODES.INVALID_SCHEMA,
      "Tool adapter inputSchema must be an object or function",
    );
  }
  if (typeof adapter.execute !== "function") {
    return failure(TOOL_ADAPTER_ERROR_CODES.INVALID_EXECUTOR, "Tool adapter execute must be a function");
  }
  return { ok: true, value: adapter };
}

function assertToolAdapter(adapter) {
  const result = validateToolAdapter(adapter);
  if (!result.ok) throw new TypeError(result.error.message);
  return adapter;
}

module.exports = {
  TOOL_ADAPTER_ERROR_CODES,
  validateToolAdapter,
  assertToolAdapter,
};
