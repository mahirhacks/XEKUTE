"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const MANAGE_STATE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["operation"],
  properties: {
    operation: { type: "string", enum: ["read", "write", "checkpoint", "summary", "progress", "delete"] },
    key: { type: "string" },
    value: { type: "object" },
    data: { type: "object" },
    summary: { type: "string" },
    progress: { type: "number", minimum: 0, maximum: 100 },
    label: { type: "string" },
  },
});

const MANAGE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_MANAGE_STATE_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NOT_FOUND: "MANAGE_STATE_NOT_FOUND",
  WRITE_FAILED: "MANAGE_STATE_WRITE_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: MANAGE_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["read", "write", "checkpoint", "summary", "progress", "delete"].includes(input.operation)) {
    return invalidInput("operation must be read, write, checkpoint, summary, progress, or delete");
  }
  if (input.key !== undefined && (typeof input.key !== "string" || input.key.trim() === "")) {
    return invalidInput("key must be a non-empty string");
  }
  if (/[\u0000\r\n]/.test(String(input.key || ""))) return invalidInput("key must not contain control characters");
  if (input.value !== undefined && !isRecord(input.value)) return invalidInput("value must be an object");
  if (input.data !== undefined && !isRecord(input.data)) return invalidInput("data must be an object");
  if (input.summary !== undefined && (typeof input.summary !== "string" || input.summary.trim() === "")) {
    return invalidInput("summary must be a non-empty string");
  }
  if (input.progress !== undefined && (typeof input.progress !== "number" || !Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100)) {
    return invalidInput("progress must be a number between 0 and 100");
  }
  return { ok: true };
}

function createManageStateTool({ fs = null, path = null } = {}) {
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");
  // In-memory state store; persists per-workspace JSON under .xekute/state/ when fs is provided.
  const states = new Map();

  function workspaceKey(root) {
    return root ? realPath.resolve(root).replace(/[\\/]+$/, "").toLowerCase() : "__memory__";
  }

  function cacheKey(root, key) { return `${workspaceKey(root)}\u0000${key}`; }

  function stateFile(root, key) {
    return realPath.join(root, ".xekute", "state", `${key}.json`);
  }

  function loadState(root, key) {
    const scopedKey = cacheKey(root, key);
    if (states.has(scopedKey)) return states.get(scopedKey);
    if (!root) return null;
    try {
      const raw = realFs.readFileSync(stateFile(root, key), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.key === key) {
        states.set(scopedKey, parsed);
        return parsed;
      }
    } catch {
      // Not persisted; return null.
    }
    return null;
  }

  function persistState(root, state) {
    if (!root) return;
    try {
      realFs.mkdirSync(realPath.join(root, ".xekute", "state"), { recursive: true });
      realFs.writeFileSync(stateFile(root, state.key), JSON.stringify(state, null, 2), "utf8");
    } catch (error) {
      throw error;
    }
  }

  function readState(input, root, invocationId) {
    const key = input.key || "workflow";
    const state = loadState(root, key);
    if (!state) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `no state found for key: ${key}`, { key });
    return { ok: true, value: { operation: "read", key, state, isolatedBy: invocationId } };
  }

  function writeState(input, root, invocationId) {
    const key = input.key || "workflow";
    const now = new Date().toISOString();
    const existing = loadState(root, key);
    const state = existing
      ? { ...existing, ...(input.value || {}), updatedAt: now, updatedBy: invocationId }
      : { key, ...(input.value || {}), createdAt: now, updatedAt: now, createdBy: invocationId, updatedBy: invocationId };
    const scopedKey = cacheKey(root, key);
    states.set(scopedKey, state);
    if (root) {
      try {
        persistState(root, state);
      } catch (error) {
        states.delete(scopedKey);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "write", key, state } };
  }

  function checkpoint(input, root, invocationId) {
    const key = input.key || "workflow";
    const now = new Date().toISOString();
    const existing = loadState(root, key);
    const base = existing ? { ...existing } : { key, createdAt: now, createdBy: invocationId };
    const label = input.label || `checkpoint-${Date.now().toString(36)}`;
    const snapshot = {
      key,
      label,
      createdAt: now,
      createdBy: invocationId,
      data: input.data || {},
    };
    base.checkpoints = Array.isArray(base.checkpoints) ? [...base.checkpoints, snapshot] : [snapshot];
    base.updatedAt = now;
    base.updatedBy = invocationId;
    const scopedKey = cacheKey(root, key);
    states.set(scopedKey, base);
    if (root) {
      try {
        persistState(root, base);
      } catch (error) {
        states.delete(scopedKey);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "checkpoint", key, label, checkpoint: snapshot, checkpoints: base.checkpoints.length } };
  }

  function summary(input, root, invocationId) {
    const key = input.key || "workflow";
    const now = new Date().toISOString();
    const existing = loadState(root, key);
    const base = existing ? { ...existing } : { key, createdAt: now, createdBy: invocationId };
    base.summary = input.summary;
    base.updatedAt = now;
    base.updatedBy = invocationId;
    const scopedKey = cacheKey(root, key);
    states.set(scopedKey, base);
    if (root) {
      try {
        persistState(root, base);
      } catch (error) {
        states.delete(scopedKey);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "summary", key, summary: base.summary } };
  }

  function progress(input, root, invocationId) {
    const key = input.key || "workflow";
    const now = new Date().toISOString();
    const existing = loadState(root, key);
    const base = existing ? { ...existing } : { key, createdAt: now, createdBy: invocationId };
    base.progress = input.progress;
    base.updatedAt = now;
    base.updatedBy = invocationId;
    const scopedKey = cacheKey(root, key);
    states.set(scopedKey, base);
    if (root) {
      try {
        persistState(root, base);
      } catch (error) {
        states.delete(scopedKey);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "progress", key, progress: base.progress } };
  }

  function deleteState(input, root) {
    const key = input.key || "workflow";
    const state = loadState(root, key);
    if (!state) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `no state found for key: ${key}`, { key });
    const scopedKey = cacheKey(root, key);
    states.delete(scopedKey);
    if (root) {
      try {
        realFs.rmSync(stateFile(root, key), { force: true });
      } catch (error) {
        states.set(scopedKey, state);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "delete", key, deleted: true } };
  }

  const adapter = {
    name: "manage_state",
    inputSchema: MANAGE_STATE_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(MANAGE_ERROR_CODES.INVALID_CONTEXT, "manage_state requires a restricted tool execution context projection");
      }
      const root = executionContext.workspace?.root || null;
      const invocationId = executionContext.invocationId || "unknown";

      switch (input.operation) {
        case "read": return readState(input, root, invocationId);
        case "write": return writeState(input, root, invocationId);
        case "checkpoint": return checkpoint(input, root, invocationId);
        case "summary": return summary(input, root, invocationId);
        case "progress": return progress(input, root, invocationId);
        case "delete": return deleteState(input, root);
        default: return invalidInput(`unknown operation: ${input.operation}`);
      }
    },
  };

  return adapter;
}

module.exports = {
  MANAGE_STATE_INPUT_SCHEMA,
  MANAGE_ERROR_CODES,
  createManageStateTool,
  validateInput,
};
