"use strict";

const { isDeepStrictEqual } = require("node:util");

const CONTEXT_ERROR_CODES = Object.freeze({
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  MISSING_FIELD: "MISSING_EXECUTION_CONTEXT_FIELD",
  INVALID_FIELD: "INVALID_EXECUTION_CONTEXT_FIELD",
  INVALID_DELEGATION: "INVALID_DELEGATED_CONTEXT",
  PERMISSION_EXPANSION: "DELEGATED_CONTEXT_PERMISSION_EXPANSION",
});

const REQUIRED_STRING_FIELDS = Object.freeze([
  "invocationId",
  "toolName",
  "role",
  "authority",
]);

const EXACT_BOUND_FIELDS = Object.freeze([
  "role",
  "authority",
  "workspace",
  "identityContext",
  // V3 memory identity is a capability-bound projection.  A delegated child
  // may inherit it, but can never replace it with another project or block.
  "memoryContext",
  "artifactProvenance",
]);

const RAW_TOOL_CONTEXT_FIELDS = Object.freeze([
  "invocationId",
  "toolName",
  "workspace",
  "sessionId",
  "mode",
  "identityContext",
  "delegationContext",
  "resourceLimits",
  "parentInvocationId",
  "memoryContext",
  "artifactProvenance",
]);

const RESTRICTED_CONTEXT_KIND = "raw_tool_projection";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (isRecord(value)) {
    const clone = {};
    for (const [key, child] of Object.entries(value)) clone[key] = cloneValue(child);
    return clone;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError("Execution context values must be structured data");
  }
  return value;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function validateExecutionContext(input) {
  if (!isRecord(input)) return failure(CONTEXT_ERROR_CODES.INVALID_CONTEXT, "Execution context must be an object");

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof input[field] !== "string" || input[field].trim() === "") {
      return failure(CONTEXT_ERROR_CODES.MISSING_FIELD, `${field} must be a non-empty string`);
    }
  }

  for (const field of ["parentInvocationId"]) {
    if (input[field] !== undefined && (typeof input[field] !== "string" || input[field].trim() === "")) {
      return failure(CONTEXT_ERROR_CODES.INVALID_FIELD, `${field} must be a non-empty string when provided`);
    }
  }

  for (const field of ["declaredScope", "identityContext", "delegationContext", "requestMetadata", "resourceLimits", "memoryContext", "artifactProvenance"]) {
    if (input[field] !== undefined && !isRecord(input[field]) && !Array.isArray(input[field])) {
      return failure(CONTEXT_ERROR_CODES.INVALID_FIELD, `${field} must be structured data when provided`);
    }
  }

  try {
    cloneValue(input);
  } catch (error) {
    return failure(CONTEXT_ERROR_CODES.INVALID_FIELD, error.message);
  }

  return { ok: true, value: input };
}

function createExecutionContext(input = {}) {
  const result = validateExecutionContext(input);
  if (!result.ok) throw new TypeError(result.error.message);
  return deepFreeze(cloneValue(input));
}

function isExecutionContext(value) {
  return Boolean(validateExecutionContext(value).ok) && Object.isFrozen(value);
}

function isBounded(parent, child) {
  if (child === undefined) return true;
  if (parent === undefined) return false;
  if (typeof parent === "number" && typeof child === "number") return child <= parent;
  if (Array.isArray(parent) && Array.isArray(child)) {
    return child.every(childValue => parent.some(parentValue => isDeepStrictEqual(parentValue, childValue)));
  }
  if (isRecord(parent) && isRecord(child)) {
    return Object.entries(child).every(([key, value]) => Object.prototype.hasOwnProperty.call(parent, key) && isBounded(parent[key], value));
  }
  return isDeepStrictEqual(parent, child);
}

function assertBounded(parent, field, childValue) {
  if (!isBounded(parent[field], childValue)) {
    throw new RangeError(`${field} cannot expand the parent execution context`);
  }
}

function deriveDelegatedExecutionContext(parent, overrides = {}) {
  if (!isExecutionContext(parent)) {
    throw new TypeError("Parent execution context must be a frozen execution context");
  }
  if (!isRecord(overrides)) throw new TypeError("Delegated context overrides must be an object");
  if (typeof overrides.invocationId !== "string" || overrides.invocationId.trim() === "") {
    throw new TypeError("Delegated context requires a new invocationId");
  }
  if (overrides.invocationId === parent.invocationId) {
    throw new RangeError("Delegated context invocationId must differ from its parent");
  }

  for (const field of EXACT_BOUND_FIELDS) {
    if (overrides[field] !== undefined && !isDeepStrictEqual(parent[field], overrides[field])) {
      throw new RangeError(`${field} cannot expand or change the parent execution context`);
    }
  }
  for (const field of ["declaredScope", "resourceLimits"]) assertBounded(parent, field, overrides[field]);

  const child = {
    ...cloneValue(parent),
    ...cloneValue(overrides),
    parentInvocationId: parent.invocationId,
    delegationContext: {
      ...(cloneValue(parent.delegationContext) || {}),
      ...(cloneValue(overrides.delegationContext) || {}),
      parentInvocationId: parent.invocationId,
    },
  };

  return createExecutionContext(child);
}

function projectExecutionContext(executionContext) {
  if (!isExecutionContext(executionContext)) {
    throw new TypeError("Execution context must be a frozen execution context");
  }

  const projected = { contextKind: RESTRICTED_CONTEXT_KIND };
  for (const field of RAW_TOOL_CONTEXT_FIELDS) {
    if (executionContext[field] !== undefined) {
      projected[field] = cloneValue(executionContext[field]);
    }
  }

  return deepFreeze(projected);
}

function isRestrictedToolContext(value) {
  if (!isRecord(value) || !Object.isFrozen(value)) return false;
  if (value.contextKind !== RESTRICTED_CONTEXT_KIND) return false;
  if (typeof value.invocationId !== "string" || value.invocationId.trim() === "") return false;
  if (typeof value.toolName !== "string" || value.toolName.trim() === "") return false;

  for (const key of Object.keys(value)) {
    if (key === "contextKind") continue;
    if (!RAW_TOOL_CONTEXT_FIELDS.includes(key)) return false;
  }

  return true;
}

module.exports = {
  CONTEXT_ERROR_CODES,
  RAW_TOOL_CONTEXT_FIELDS,
  RESTRICTED_CONTEXT_KIND,
  createExecutionContext,
  deriveDelegatedExecutionContext,
  isExecutionContext,
  isRestrictedToolContext,
  projectExecutionContext,
  validateExecutionContext,
};
