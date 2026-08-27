"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");

const DEFAULT_MODE = 0o600;
const DEFAULT_DIRECTORY_MODE = 0o700;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function timestamp(now = () => new Date()) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("The memory clock returned an invalid date.");
  return date.toISOString();
}

function resolvedWorkspace(pathImpl = nodePath, workspace) {
  const value = String(workspace == null ? "" : workspace).trim();
  if (!value) throw new TypeError("A workspace path is required.");
  return pathImpl.resolve(value);
}

function safeComponent(value, fallback = "memory") {
  const result = String(value == null ? "" : value).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return result || fallback;
}

function hashText(cryptoImpl = nodeCrypto, value = "") {
  return cryptoImpl.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function uniqueTemporaryPath(pathImpl, target, cryptoImpl = nodeCrypto, suffix = "tmp") {
  const random = typeof cryptoImpl.randomBytes === "function"
    ? cryptoImpl.randomBytes(8).toString("hex")
    : `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${target}.${process.pid}.${Date.now()}.${random}.${suffix}`;
}

function ensureDirectory(fsImpl = nodeFs, pathImpl = nodePath, directory) {
  fsImpl.mkdirSync(directory, { recursive: true, mode: DEFAULT_DIRECTORY_MODE });
  try { fsImpl.chmodSync(directory, DEFAULT_DIRECTORY_MODE); } catch { /* Windows ACLs protect the workspace. */ }
}

function closeDescriptor(fsImpl, descriptor) {
  try { fsImpl.closeSync(descriptor); } catch { /* The original write error is more useful. */ }
}

/**
 * Write a complete file before replacing the primary. The validator runs
 * against the exact bytes that would become authoritative, which prevents a
 * malformed snapshot or manifest from advancing the store.
 */
function atomicWriteText({ fs: fsImpl = nodeFs, path: pathImpl = nodePath, crypto: cryptoImpl = nodeCrypto } = {}, target, content, {
  mode = DEFAULT_MODE,
  backup: createBackup = true,
  validate = null,
} = {}) {
  const file = String(target || "");
  if (!file) throw new TypeError("An atomic-write target is required.");
  const text = String(content == null ? "" : content);
  if (typeof validate === "function") validate(text);

  ensureDirectory(fsImpl, pathImpl, pathImpl.dirname(file));
  const temporary = uniqueTemporaryPath(pathImpl, file, cryptoImpl, "tmp");
  const backupPath = `${file}.bak`;
  const backupTemporary = uniqueTemporaryPath(pathImpl, backupPath, cryptoImpl, "tmp");
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(temporary, "wx", mode);
    fsImpl.writeFileSync(descriptor, text, "utf8");
    try { fsImpl.fsyncSync(descriptor); } catch { /* Best effort on filesystems without fsync. */ }
  } catch (error) {
    if (descriptor !== null) closeDescriptor(fsImpl, descriptor);
    try { fsImpl.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ }
    throw error;
  } finally {
    if (descriptor !== null) closeDescriptor(fsImpl, descriptor);
  }

  try {
    if (createBackup && fsImpl.existsSync(file)) {
      try {
        fsImpl.copyFileSync(file, backupTemporary);
        try {
          const backupDescriptor = fsImpl.openSync(backupTemporary, "r");
          try { fsImpl.fsyncSync(backupDescriptor); } catch { /* Best effort. */ }
          closeDescriptor(fsImpl, backupDescriptor);
        } catch { /* Best effort. */ }
        try { fsImpl.rmSync(backupPath, { force: true }); } catch { /* Rename below may replace it. */ }
        try {
          fsImpl.renameSync(backupTemporary, backupPath);
        } catch {
          fsImpl.copyFileSync(backupTemporary, backupPath);
          fsImpl.rmSync(backupTemporary, { force: true });
        }
      } catch {
        try { fsImpl.rmSync(backupTemporary, { force: true }); } catch { /* Best effort cleanup. */ }
        // A backup failure must not prevent a valid primary write. The
        // previous primary remains available in the filesystem until replace.
      }
    }

    try {
      fsImpl.renameSync(temporary, file);
    } catch (renameError) {
      try {
        fsImpl.copyFileSync(temporary, file);
        fsImpl.rmSync(temporary, { force: true });
      } catch (copyError) {
        // If replacement failed before the primary became valid, restore the
        // known-good backup where possible. The original replacement error is
        // retained as the failure users need to diagnose.
        try {
          if (fsImpl.existsSync(backupPath)) fsImpl.copyFileSync(backupPath, file);
        } catch { /* Preserve the original failure. */ }
        try { fsImpl.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ }
        copyError.cause = renameError;
        throw copyError;
      }
    }
    try { fsImpl.chmodSync(file, mode); } catch { /* Windows ACLs protect the workspace. */ }
    try { if (fsImpl.existsSync(backupPath)) fsImpl.chmodSync(backupPath, mode); } catch { /* Best effort. */ }
    return { ok: true, path: file, backupPath };
  } finally {
    try { fsImpl.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ }
    try { fsImpl.rmSync(backupTemporary, { force: true }); } catch { /* Best effort cleanup. */ }
  }
}

function atomicWriteJson(dependencies, target, value, options = {}) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return atomicWriteText(dependencies, target, text, {
    ...options,
    validate: (candidate) => {
      JSON.parse(candidate);
      if (typeof options.validate === "function") options.validate(candidate);
    },
  });
}

function readJsonWithBackup({ fs: fsImpl = nodeFs } = {}, target, {
  parse = JSON.parse,
  validate = null,
} = {}) {
  const file = String(target || "");
  const candidates = [
    { path: file, recovered: false },
    { path: `${file}.bak`, recovered: true },
  ];
  let primaryError = null;
  for (const candidate of candidates) {
    if (!fsImpl.existsSync(candidate.path)) continue;
    try {
      const raw = fsImpl.readFileSync(candidate.path, "utf8");
      const value = typeof parse === "function" ? parse(raw) : JSON.parse(raw);
      if (typeof validate === "function") validate(value, raw);
      return {
        ok: true,
        exists: true,
        recovered: candidate.recovered,
        path: file,
        sourcePath: candidate.path,
        value,
        ...(candidate.recovered && primaryError ? { warning: `Primary memory file was recovered from its backup: ${primaryError.message}` } : {}),
      };
    } catch (error) {
      if (!candidate.recovered) primaryError = error;
    }
  }
  if (primaryError) return { ok: false, exists: true, recovered: false, path: file, error: primaryError };
  return { ok: true, exists: false, recovered: false, path: file, value: null };
}

function appendCompleteLine({ fs: fsImpl = nodeFs, path: pathImpl = nodePath } = {}, target, line, {
  mode = DEFAULT_MODE,
  maxBytes = 1_048_576,
} = {}) {
  const text = String(line == null ? "" : line);
  const complete = text.endsWith("\n") ? text : `${text}\n`;
  const bytes = Buffer.byteLength(complete, "utf8");
  if (bytes > maxBytes) {
    const error = new RangeError(`The JSONL event exceeds the ${maxBytes}-byte limit.`);
    error.code = "MEMORY_EVENT_TOO_LARGE";
    throw error;
  }
  ensureDirectory(fsImpl, pathImpl, pathImpl.dirname(target));
  const descriptor = fsImpl.openSync(target, "a", mode);
  try {
    fsImpl.writeFileSync(descriptor, complete, "utf8");
    try { fsImpl.fsyncSync(descriptor); } catch { /* Best effort. */ }
  } finally {
    closeDescriptor(fsImpl, descriptor);
  }
  try { fsImpl.chmodSync(target, mode); } catch { /* Windows ACLs protect the workspace. */ }
  return { ok: true, path: target, bytes, line: complete };
}

function readJsonLines({ fs: fsImpl = nodeFs } = {}, target, {
  maxBytes = 1_048_576,
  validate = null,
} = {}) {
  if (!fsImpl.existsSync(target)) return { ok: true, exists: false, records: [], warnings: [], bytes: 0, validBytes: 0, complete: true };
  const raw = fsImpl.readFileSync(target, "utf8");
  const records = [];
  const warnings = [];
  const lines = raw.split("\n");
  const hasPartialTail = lines.length > 1 && lines.at(-1) !== "";
  const parseLines = hasPartialTail ? lines.slice(0, -1) : lines;
  const validBytes = Buffer.byteLength(hasPartialTail ? `${parseLines.join("\n")}\n` : raw, "utf8");
  if (hasPartialTail) warnings.push({ code: "MEMORY_EVENT_PARTIAL_TAIL", message: "The final unterminated JSONL line was ignored after a possible crash." });
  for (let index = 0; index < parseLines.length; index += 1) {
    const line = parseLines[index];
    if (!line) continue;
    const complete = `${line}\n`;
    if (Buffer.byteLength(complete, "utf8") > maxBytes) {
      const error = new Error(`JSONL line ${index + 1} exceeds the ${maxBytes}-byte limit.`);
      error.code = "MEMORY_EVENT_TOO_LARGE";
      return { ok: false, exists: true, records, warnings, bytes: Buffer.byteLength(raw, "utf8"), validBytes, complete: !hasPartialTail, error, line: index + 1 };
    }
    try {
      const record = JSON.parse(line);
      if (typeof validate === "function") validate(record, { line: index + 1, raw: line });
      records.push(record);
    } catch (error) {
      error.code = error.code || "MEMORY_EVENT_CORRUPT";
      return { ok: false, exists: true, records, warnings, bytes: Buffer.byteLength(raw, "utf8"), validBytes, complete: !hasPartialTail, error, line: index + 1 };
    }
  }
  return { ok: true, exists: true, records, warnings, bytes: Buffer.byteLength(raw, "utf8"), validBytes, complete: !hasPartialTail };
}

function fileSha256({ fs: fsImpl = nodeFs, crypto: cryptoImpl = nodeCrypto } = {}, target) {
  const hash = cryptoImpl.createHash("sha256");
  const data = fsImpl.readFileSync(target);
  hash.update(data);
  return hash.digest("hex");
}

function operationFailure(code, message, details = {}, retryable = false) {
  return {
    ok: false,
    code: String(code || "MEMORY_OPERATION_FAILED"),
    error: String(message || "Memory operation failed."),
    retryable: Boolean(retryable),
    details: details && typeof details === "object" ? details : {},
  };
}

const RAW_SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret[_-]?value|raw[_-]?value|password)$/i;

function assertNoSecretKeys(value, { maxDepth = 12 } = {}, key = "", depth = 0) {
  if (depth > maxDepth) {
    const error = new Error("The value is too deeply nested for protected memory storage.");
    error.code = "MEMORY_PAYLOAD_TOO_DEEP";
    throw error;
  }
  if (RAW_SECRET_KEY.test(String(key || ""))) {
    const error = new Error("Raw secret fields are not permitted outside Sensitive Working Memory.");
    error.code = "MEMORY_SECRET_FIELD";
    error.details = { field: String(key) };
    throw error;
  }
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretKeys(item, { maxDepth }, "", depth + 1);
    return true;
  }
  if (typeof value !== "object") {
    const error = new Error("Protected memory values must be JSON-compatible.");
    error.code = "MEMORY_PAYLOAD_INVALID";
    throw error;
  }
  for (const [childKey, child] of Object.entries(value)) assertNoSecretKeys(child, { maxDepth }, childKey, depth + 1);
  return true;
}

module.exports = Object.freeze({
  DEFAULT_MODE,
  DEFAULT_DIRECTORY_MODE,
  clone,
  timestamp,
  resolvedWorkspace,
  safeComponent,
  hashText,
  uniqueTemporaryPath,
  ensureDirectory,
  atomicWriteText,
  atomicWriteJson,
  readJsonWithBackup,
  appendCompleteLine,
  readJsonLines,
  fileSha256,
  operationFailure,
  assertNoSecretKeys,
});
