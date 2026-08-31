"use strict";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const LARGE_MAX_BYTES = 16 * 1024 * 1024;
const IDENTITY_MAX_BYTES = 4 * 1024 * 1024;
const PATH_MAX_CHARS = 32768;
const COMMAND_MAX_CHARS = 32768;
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 10000;
const MAX_OBJECT_KEYS = 2000;

const LARGE_CHANNELS = new Set([
  "fs:writeFile",
  "assessment:trafficLog",
  "assessment:writeSettings",
  "project-profile:save",
  "security:httpRequest",
  "security:buildIntruder",
  "proxy:forward",
  "settings:llmSet",
  "ollama:countTokens",
  "ollama:chat",
  "agent:run",
  "chat-history:begin",
  "chat-history:event",
  "chat-history:update",
  "chat-history:archive",
  "chat-history:unarchive",
  "chat-history:flush",
  "chat-history:save-before-close",
  "webclone:previewDocument",
  "assessment:intelligenceStart",
  "assessment:intelligenceRebuild",
  "assessment:intelligenceQuery",
  "assessment:intelligenceExpand",
  "assessment:deepCollectGraph",
  "knowledge:install",
]);

const COMMAND_CHANNELS = new Set([
  "tools:runCommand",
  "tools:startProcess",
]);

const IDENTITY_CHANNELS = new Set([
  "settings:identityImport",
  "settings:credentialCreate",
]);

function error(message, code = "INVALID_IPC_PAYLOAD") {
  return { code, message };
}

function inspectValue(value, state, depth = 0, key = "") {
  if (depth > MAX_DEPTH) return error("IPC payload nesting exceeds the supported depth");
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return null;
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (/path|workspace|file|folder|root/i.test(key) && value.length > PATH_MAX_CHARS) {
      return error(`IPC path field ${key || "value"} is too long`);
    }
    if (/command/i.test(key) && value.length > COMMAND_MAX_CHARS) {
      return error(`IPC command field ${key || "value"} is too long`);
    }
    return null;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    state.bytes += value.byteLength;
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) return error("IPC array contains too many items");
    for (let index = 0; index < value.length; index += 1) {
      const issue = inspectValue(value[index], state, depth + 1, `${key}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) return error("IPC object contains too many fields");
    for (const childKey of keys) {
      const issue = inspectValue(value[childKey], state, depth + 1, childKey);
      if (issue) return issue;
    }
    return null;
  }
  return error(`Unsupported IPC payload value: ${typeof value}`);
}

function validateIpcRequest(channel, args = []) {
  const state = { bytes: 0 };
  const issue = inspectValue(args, state);
  if (issue) return issue;
  const maxBytes = IDENTITY_CHANNELS.has(channel) ? IDENTITY_MAX_BYTES : LARGE_CHANNELS.has(channel) ? LARGE_MAX_BYTES : DEFAULT_MAX_BYTES;
  if (state.bytes > maxBytes) return error(`IPC payload exceeds ${maxBytes} bytes`, "IPC_PAYLOAD_TOO_LARGE");

  const payload = args[0];
  if (channel === "terminal:resize") {
    const cols = Number(payload?.cols);
    const rows = Number(payload?.rows);
    if (!Number.isInteger(cols) || cols < 1 || cols > 1000 || !Number.isInteger(rows) || rows < 1 || rows > 1000) {
      return error("Terminal dimensions must be integers between 1 and 1000");
    }
  }
  if (COMMAND_CHANNELS.has(channel)) {
    const command = String(payload?.command || "");
    if (command.length > COMMAND_MAX_CHARS) return error("Command exceeds the supported length", "IPC_PAYLOAD_TOO_LARGE");
  }
  return null;
}

function ok(value) {
  return { ok: true, value };
}

function fail(input, fallbackCode = "XEKUTE_OPERATION_FAILED") {
  const source = input && typeof input === "object" ? input : {};
  return {
    ok: false,
    error: {
      code: String(source.code || fallbackCode),
      message: String(source.error || source.message || input || "XEKUTE operation failed"),
      retryable: Boolean(source.retryable),
      ...(source.details === undefined ? {} : { details: source.details }),
    },
  };
}

function normalizeResult(value) {
  if (value && typeof value === "object" && value.ok === false && value.error?.message) return value;
  if (value && typeof value === "object" && value.error) return fail(value);
  return ok(value);
}

module.exports = {
  DEFAULT_MAX_BYTES,
  LARGE_MAX_BYTES,
  IDENTITY_MAX_BYTES,
  PATH_MAX_CHARS,
  COMMAND_MAX_CHARS,
  validateIpcRequest,
  ok,
  fail,
  normalizeResult,
};
