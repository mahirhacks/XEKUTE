"use strict";

const { createHash } = require("node:crypto");
const {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  chmodSync,
  rmSync,
  realpathSync,
} = require("node:fs");
const {
  resolve: resolvePath,
  dirname,
  isAbsolute,
  relative: relativePath,
  join: joinPath,
  sep: pathSeparator,
} = require("node:path");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const MAX_OPERATIONS = 50;
const MAX_DIFF_LINES = 220;
const REVISION_PATTERN = "^sha256:[0-9a-f]{64}$";

const APPLY_PATCH_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["operations"],
  properties: {
    operations: {
      type: "array",
      minItems: 1,
      maxItems: MAX_OPERATIONS,
      description:
        "Sequential file operations. create requires content; modify requires either content OR search+replaceWith; move requires target; delete and ensure_dir require only kind+path. expectedRevision is recommended for modify/move/delete.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "path"],
        properties: {
          kind: {
            type: "string",
            enum: ["create", "modify", "move", "delete", "ensure_dir"],
            description: "Filesystem operation to perform.",
          },
          path: {
            type: "string",
            minLength: 1,
            description: "Workspace-relative source/target path. Absolute paths must remain inside the workspace root.",
          },
          content: {
            type: "string",
            description: "For create: complete UTF-8 content. For modify: complete replacement content; do not combine with search/replaceWith.",
          },
          search: {
            type: "string",
            minLength: 1,
            description: "For targeted modify: exact unique text copied from read_file. CRLF/LF differences are handled automatically.",
          },
          replaceWith: {
            type: "string",
            description: "Replacement text paired with search. Empty string deletes the matched text.",
          },
          target: {
            type: "string",
            minLength: 1,
            description: "Destination path for move.",
          },
          expectedRevision: {
            type: "string",
            pattern: REVISION_PATTERN,
            description: "Revision returned by read_file. Recommended for modify/move/delete so stale edits are rejected safely.",
          },
        },
      },
    },
    dryRun: {
      type: "boolean",
      description: "Validate and preview every operation without changing the filesystem.",
    },
  },
});

const APPLY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_APPLY_PATCH_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  OUTSIDE_WORKSPACE: "APPLY_PATCH_OUTSIDE_WORKSPACE",
  SYMBOLIC_LINK: "APPLY_PATCH_SYMBOLIC_LINK_UNSUPPORTED",
  CREATE_CONFLICT: "APPLY_PATCH_CREATE_ALREADY_EXISTS",
  NOT_FOUND: "APPLY_PATCH_TARGET_NOT_FOUND",
  TARGET_EXISTS: "APPLY_PATCH_TARGET_ALREADY_EXISTS",
  IS_DIRECTORY: "APPLY_PATCH_TARGET_IS_DIRECTORY",
  NOT_DIRECTORY: "APPLY_PATCH_TARGET_NOT_DIRECTORY",
  BINARY_FILE: "APPLY_PATCH_BINARY_MODIFY_UNSUPPORTED",
  SEARCH_MISSING: "APPLY_PATCH_SEARCH_NOT_FOUND",
  SEARCH_AMBIGUOUS: "APPLY_PATCH_SEARCH_AMBIGUOUS",
  STALE_REVISION: "APPLY_PATCH_STALE_REVISION",
  CONCURRENT_CHANGE: "APPLY_PATCH_CONCURRENT_CHANGE",
  WRITE_FAILED: "APPLY_PATCH_WRITE_FAILED",
  ROLLBACK_FAILED: "APPLY_PATCH_ROLLBACK_FAILED",
  INVALID_PATCH: "APPLY_PATCH_INVALID_OPERATION",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: APPLY_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateRevision(value, fieldName) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    return `${fieldName} must be a sha256 revision returned by read_file`;
  }
  return null;
}

function hasInvalidPathChars(value) {
  return /\u0000|\r|\n/.test(value);
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  const topLevelKeys = Object.keys(input);
  if (topLevelKeys.some((key) => !["operations", "dryRun"].includes(key))) {
    return invalidInput("input contains unsupported top-level fields");
  }
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    return invalidInput("operations must be a non-empty array");
  }
  if (input.operations.length > MAX_OPERATIONS) {
    return invalidInput(`operations must contain at most ${MAX_OPERATIONS} items`);
  }
  if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") {
    return invalidInput("dryRun must be a boolean");
  }

  const allowedByKind = {
    create: new Set(["kind", "path", "content"]),
    modify: new Set(["kind", "path", "content", "search", "replaceWith", "expectedRevision"]),
    move: new Set(["kind", "path", "target", "expectedRevision"]),
    delete: new Set(["kind", "path", "expectedRevision"]),
    ensure_dir: new Set(["kind", "path"]),
  };

  for (let i = 0; i < input.operations.length; i += 1) {
    const op = input.operations[i];
    if (!isRecord(op)) return invalidInput(`operations[${i}] must be an object`);
    if (!allowedByKind[op.kind]) {
      return invalidInput(`operations[${i}].kind must be create, modify, move, delete, or ensure_dir`);
    }
    const unsupported = Object.keys(op).find((key) => !allowedByKind[op.kind].has(key));
    if (unsupported) return invalidInput(`operations[${i}].${unsupported} is not valid for kind ${op.kind}`);

    if (typeof op.path !== "string" || op.path.trim() === "") {
      return invalidInput(`operations[${i}].path must be a non-empty string`);
    }
    if (hasInvalidPathChars(op.path)) {
      return invalidInput(`operations[${i}].path contains an invalid control character`);
    }

    const revisionError = validateRevision(op.expectedRevision, `operations[${i}].expectedRevision`);
    if (revisionError) return invalidInput(revisionError);

    if (op.kind === "create") {
      if (typeof op.content !== "string") {
        return invalidInput(`operations[${i}].content must be a string for create`);
      }
    } else if (op.kind === "modify") {
      const hasContent = typeof op.content === "string";
      const hasSearch = typeof op.search === "string";
      const hasReplace = typeof op.replaceWith === "string";
      if (hasContent && (hasSearch || hasReplace)) {
        return invalidInput(`operations[${i}] must use either content or search+replaceWith, not both`);
      }
      if (!hasContent && !(hasSearch && hasReplace)) {
        return invalidInput(`operations[${i}] must provide content or search+replaceWith for modify`);
      }
      if (hasSearch && op.search.length === 0) {
        return invalidInput(`operations[${i}].search must not be empty`);
      }
    } else if (op.kind === "move") {
      if (typeof op.target !== "string" || op.target.trim() === "") {
        return invalidInput(`operations[${i}].target must be a non-empty string for move`);
      }
      if (hasInvalidPathChars(op.target)) {
        return invalidInput(`operations[${i}].target contains an invalid control character`);
      }
    }
  }

  return { ok: true };
}

function normalizeSeparators(value) {
  return String(value).replace(/\\/g, "/");
}

function isInsideRoot(root, candidate) {
  const relative = relativePath(root, candidate);
  return relative === "" || (!relative.startsWith(`..${pathSeparator}`) && relative !== ".." && !isAbsolute(relative));
}

function patchError(code, message, extra = {}) {
  const error = new Error(message);
  error.patchCode = code;
  error.patchExtra = extra;
  return error;
}

function resolveUnderRoot(root, rawPath) {
  const candidate = isAbsolute(rawPath) ? resolvePath(rawPath) : resolvePath(root, rawPath);
  if (!isInsideRoot(root, candidate)) {
    throw patchError(APPLY_ERROR_CODES.OUTSIDE_WORKSPACE, "path resolves outside the workspace root", { path: rawPath });
  }
  return candidate;
}

function assertNoSymlinkTraversal(root, candidate) {
  const relative = relativePath(root, candidate);
  if (relative === "") return;
  const parts = relative.split(pathSeparator).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = joinPath(current, part);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw patchError(APPLY_ERROR_CODES.SYMBOLIC_LINK, "symbolic links are not supported by apply_patch", {
        path: normalizeSeparators(relativePath(root, current)),
      });
    }
  }
}

function sha256Revision(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function cloneState(state) {
  if (state.type === "file") {
    return { type: "file", content: Buffer.from(state.content), mode: state.mode };
  }
  return { ...state };
}

function loadFilesystemState(root, abs) {
  assertNoSymlinkTraversal(root, abs);
  if (!existsSync(abs)) return { type: "missing" };
  const stat = lstatSync(abs);
  if (stat.isSymbolicLink()) {
    throw patchError(APPLY_ERROR_CODES.SYMBOLIC_LINK, "symbolic links are not supported by apply_patch", {
      path: normalizeSeparators(relativePath(root, abs)),
    });
  }
  if (stat.isDirectory()) return { type: "dir", mode: stat.mode };
  if (!stat.isFile()) {
    throw patchError(APPLY_ERROR_CODES.INVALID_PATCH, "target is not a regular file or directory", {
      path: normalizeSeparators(relativePath(root, abs)),
    });
  }
  return { type: "file", content: readFileSync(abs), mode: stat.mode };
}

function stateRevision(state) {
  return state.type === "file" ? sha256Revision(state.content) : null;
}

function statesEquivalent(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === "file") return stateRevision(a) === stateRevision(b);
  return true;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= text.length - needle.length) {
    const found = text.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function normalizeEol(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function preferredEol(rawText) {
  const crlf = (rawText.match(/\r\n/g) || []).length;
  const lf = (rawText.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

function convertToEol(text, eol) {
  const normalized = normalizeEol(text);
  return eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function normalizeWithBoundaryMap(rawText) {
  const normalized = [];
  const boundaries = [];
  let rawIndex = 0;

  while (rawIndex < rawText.length) {
    boundaries.push(rawIndex);
    if (rawText[rawIndex] === "\r" && rawText[rawIndex + 1] === "\n") {
      normalized.push("\n");
      rawIndex += 2;
    } else if (rawText[rawIndex] === "\r") {
      normalized.push("\n");
      rawIndex += 1;
    } else {
      normalized.push(rawText[rawIndex]);
      rawIndex += 1;
    }
  }
  boundaries.push(rawText.length);
  return { normalized: normalized.join(""), boundaries };
}

function replaceUniqueNormalized(rawText, searchText, replacementText) {
  const { normalized, boundaries } = normalizeWithBoundaryMap(rawText);
  const normalizedSearch = normalizeEol(searchText);
  const occurrences = countOccurrences(normalized, normalizedSearch);

  if (occurrences === 0) return { ok: false, reason: "missing", occurrences };
  if (occurrences !== 1) return { ok: false, reason: "ambiguous", occurrences };

  const normalizedStart = normalized.indexOf(normalizedSearch);
  const normalizedEnd = normalizedStart + normalizedSearch.length;
  const rawStart = boundaries[normalizedStart];
  const rawEnd = boundaries[normalizedEnd];
  const replacement = convertToEol(replacementText, preferredEol(rawText));

  return {
    ok: true,
    content: rawText.slice(0, rawStart) + replacement + rawText.slice(rawEnd),
  };
}

function makeCompactDiff(oldContent, newContent) {
  if (oldContent !== null && newContent !== null && normalizeEol(oldContent) === normalizeEol(newContent)) {
    return { diff: "", diffTruncated: false };
  }

  const oldLines = oldContent === null ? [] : normalizeEol(oldContent).split("\n");
  const newLines = newContent === null ? [] : normalizeEol(newContent).split("\n");

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextBeforeStart = Math.max(0, prefix - 3);
  const oldChangedEnd = Math.max(prefix, oldLines.length - suffix);
  const newChangedEnd = Math.max(prefix, newLines.length - suffix);
  const contextAfterCount = Math.min(3, suffix);
  const output = [];

  for (let i = contextBeforeStart; i < prefix; i += 1) output.push(`  ${oldLines[i]}`);
  for (let i = prefix; i < oldChangedEnd; i += 1) output.push(`- ${oldLines[i]}`);
  for (let i = prefix; i < newChangedEnd; i += 1) output.push(`+ ${newLines[i]}`);
  for (let i = 0; i < contextAfterCount; i += 1) {
    output.push(`  ${oldLines[oldLines.length - suffix + i]}`);
  }

  const truncated = output.length > MAX_DIFF_LINES;
  const lines = truncated ? output.slice(0, MAX_DIFF_LINES) : output;
  if (truncated) lines.push(`â€¦ diff truncated after ${MAX_DIFF_LINES} lines`);
  return { diff: lines.join("\n"), diffTruncated: truncated };
}

function validateExpectedRevision(op, state, relPath) {
  if (!op.expectedRevision) return;
  const actual = stateRevision(state);
  if (actual !== op.expectedRevision) {
    throw patchError(APPLY_ERROR_CODES.STALE_REVISION, `file changed since it was read: ${relPath}`, {
      path: relPath,
      expectedRevision: op.expectedRevision,
      actualRevision: actual,
      retryable: true,
    });
  }
}

function ensureDirectoryTracked(dirPath, root, createdDirs) {
  if (dirPath === root) return;
  const missing = [];
  let current = dirPath;

  while (current !== root && !existsSync(current)) {
    if (!isInsideRoot(root, current)) {
      throw patchError(APPLY_ERROR_CODES.OUTSIDE_WORKSPACE, "directory creation escapes workspace root", {
        path: normalizeSeparators(relativePath(root, current)),
      });
    }
    missing.push(current);
    current = dirname(current);
  }

  if (existsSync(current)) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw patchError(APPLY_ERROR_CODES.SYMBOLIC_LINK, "cannot create through a symbolic link", {
        path: normalizeSeparators(relativePath(root, current)),
      });
    }
    if (!stat.isDirectory()) {
      throw patchError(APPLY_ERROR_CODES.NOT_DIRECTORY, "parent path is not a directory", {
        path: normalizeSeparators(relativePath(root, current)),
      });
    }
  }

  for (const pathToCreate of missing.reverse()) {
    mkdirSync(pathToCreate);
    createdDirs.add(pathToCreate);
  }
}

function depthOfPath(value) {
  return normalizeSeparators(value).split("/").length;
}

function rollbackFilesystem(root, initialStates, touchedPaths, createdDirs) {
  const failures = [];
  const paths = [...touchedPaths].sort((a, b) => depthOfPath(b) - depthOfPath(a));

  for (const abs of paths) {
    const initial = initialStates.get(abs);
    if (!initial) continue;
    try {
      if (initial.type === "missing") {
        if (existsSync(abs)) {
          const stat = lstatSync(abs);
          if (stat.isDirectory()) rmSync(abs, { recursive: true, force: true });
          else unlinkSync(abs);
        }
      } else if (initial.type === "file") {
        if (existsSync(abs) && lstatSync(abs).isDirectory()) {
          rmSync(abs, { recursive: true, force: true });
        }
        ensureDirectoryTracked(dirname(abs), root, new Set());
        writeFileSync(abs, initial.content);
        if (initial.mode !== undefined) chmodSync(abs, initial.mode);
      } else if (initial.type === "dir") {
        if (existsSync(abs) && !lstatSync(abs).isDirectory()) unlinkSync(abs);
        if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
      }
    } catch (error) {
      failures.push({ path: normalizeSeparators(relativePath(root, abs)), message: error.message });
    }
  }

  for (const dirPath of [...createdDirs].sort((a, b) => depthOfPath(b) - depthOfPath(a))) {
    try {
      if (existsSync(dirPath) && lstatSync(dirPath).isDirectory()) {
        rmSync(dirPath, { recursive: false, force: true });
      }
    } catch {
      // Keep non-empty directories still required by restored state.
    }
  }

  return failures;
}

function createApplyPatchTool() {
  return {
    name: "apply_patch",
    description:
      "Create, modify, move, delete files, or ensure directories inside the workspace. Read an existing file with read_file before modifying it and pass expectedRevision when available. For targeted edits, use a short exact unique search snippet copied from read_file; line-ending differences are handled automatically. Batches are simulated sequentially first, so createâ†’modify and other dependent operations work in one call. For very large generated content (approaching the completion budget), split the write into multiple sequential bounded operations: create with a chunk plus a trailing sentinel comment like <!-- XEKUTE_CONTINUE -->, then modify operations that replace the sentinel with the next chunk plus the sentinel again, and finish with a modify that removes the sentinel; then verify with read_file.",
    inputSchema: APPLY_PATCH_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(APPLY_ERROR_CODES.INVALID_CONTEXT, "apply_patch requires a restricted tool execution context projection");
      }

      let root;
      try {
        const configuredRoot = resolvePath(executionContext.workspace?.root || process.cwd());
        if (!existsSync(configuredRoot) || !lstatSync(configuredRoot).isDirectory()) {
          return structuredFailure(APPLY_ERROR_CODES.WRITE_FAILED, "workspace root does not exist or is not a directory", {
            path: normalizeSeparators(configuredRoot),
          });
        }
        root = realpathSync(configuredRoot);
      } catch (error) {
        return structuredFailure(APPLY_ERROR_CODES.WRITE_FAILED, `unable to resolve workspace root: ${error.message}`);
      }

      const dryRun = Boolean(input.dryRun);
      const initialStates = new Map();
      const virtualStates = new Map();
      const touchedPaths = new Set();
      const changes = [];

      const getState = (abs) => {
        if (!virtualStates.has(abs)) {
          const initial = loadFilesystemState(root, abs);
          initialStates.set(abs, cloneState(initial));
          virtualStates.set(abs, cloneState(initial));
        }
        return virtualStates.get(abs);
      };

      const setState = (abs, state) => {
        getState(abs);
        virtualStates.set(abs, cloneState(state));
        touchedPaths.add(abs);
      };

      try {
        for (let index = 0; index < input.operations.length; index += 1) {
          const op = input.operations[index];
          const abs = resolveUnderRoot(root, op.path);
          assertNoSymlinkTraversal(root, abs);
          const rel = normalizeSeparators(relativePath(root, abs) || ".");
          const before = getState(abs);

          if (op.kind === "ensure_dir") {
            if (before.type === "file") {
              throw patchError(APPLY_ERROR_CODES.NOT_DIRECTORY, `ensure_dir target is a file: ${rel}`, { path: rel, operationIndex: index });
            }
            setState(abs, { type: "dir", mode: before.mode });
            changes.push({ operationIndex: index, kind: "ensure_dir", path: rel, changed: before.type === "missing" });
            continue;
          }

          if (op.kind === "create") {
            if (before.type !== "missing") {
              throw patchError(APPLY_ERROR_CODES.CREATE_CONFLICT, `create target already exists: ${rel}`, { path: rel, operationIndex: index });
            }
            const content = Buffer.from(op.content, "utf8");
            setState(abs, { type: "file", content, mode: undefined });
            const diffResult = makeCompactDiff(null, op.content);
            changes.push({
              operationIndex: index,
              kind: "create",
              path: rel,
              changed: true,
              bytesWritten: content.length,
              revisionBefore: null,
              revisionAfter: sha256Revision(content),
              ...diffResult,
            });
            continue;
          }

          if (before.type === "missing") {
            throw patchError(APPLY_ERROR_CODES.NOT_FOUND, `${op.kind} target does not exist: ${rel}`, { path: rel, operationIndex: index });
          }
          if (before.type === "dir") {
            throw patchError(APPLY_ERROR_CODES.IS_DIRECTORY, `${op.kind} supports files only: ${rel} is a directory`, { path: rel, operationIndex: index });
          }

          validateExpectedRevision(op, before, rel);

          if (op.kind === "modify") {
            if (before.content.includes(0)) {
              throw patchError(APPLY_ERROR_CODES.BINARY_FILE, `cannot text-modify binary file: ${rel}`, { path: rel, operationIndex: index });
            }

            const oldRaw = before.content.toString("utf8");
            let newRaw;

            if (typeof op.search === "string") {
              const replacement = replaceUniqueNormalized(oldRaw, op.search, op.replaceWith);
              if (!replacement.ok && replacement.reason === "missing") {
                throw patchError(APPLY_ERROR_CODES.SEARCH_MISSING, `search text not found in ${rel}; re-read the file and retry with a smaller exact unique snippet`, {
                  path: rel,
                  operationIndex: index,
                  retryable: true,
                });
              }
              if (!replacement.ok) {
                throw patchError(APPLY_ERROR_CODES.SEARCH_AMBIGUOUS, `search text matched ${replacement.occurrences} occurrences in ${rel}; use a more specific unique snippet`, {
                  path: rel,
                  operationIndex: index,
                  occurrences: replacement.occurrences,
                  retryable: true,
                });
              }
              newRaw = replacement.content;
            } else {
              newRaw = convertToEol(op.content, preferredEol(oldRaw));
            }

            const newContent = Buffer.from(newRaw, "utf8");
            const changed = !before.content.equals(newContent);
            setState(abs, { type: "file", content: newContent, mode: before.mode });
            const diffResult = makeCompactDiff(oldRaw, newRaw);
            changes.push({
              operationIndex: index,
              kind: "modify",
              path: rel,
              changed,
              bytesWritten: newContent.length,
              revisionBefore: sha256Revision(before.content),
              revisionAfter: sha256Revision(newContent),
              ...diffResult,
            });
            continue;
          }

          if (op.kind === "move") {
            const targetAbs = resolveUnderRoot(root, op.target);
            assertNoSymlinkTraversal(root, targetAbs);
            const targetRel = normalizeSeparators(relativePath(root, targetAbs));
            const targetState = getState(targetAbs);
            if (targetState.type !== "missing") {
              throw patchError(APPLY_ERROR_CODES.TARGET_EXISTS, `move target already exists: ${targetRel}`, {
                path: targetRel,
                operationIndex: index,
              });
            }
            setState(targetAbs, before);
            setState(abs, { type: "missing" });
            changes.push({
              operationIndex: index,
              kind: "move",
              path: rel,
              target: targetRel,
              changed: rel !== targetRel,
              revisionBefore: sha256Revision(before.content),
              revisionAfter: sha256Revision(before.content),
            });
            continue;
          }

          if (op.kind === "delete") {
            setState(abs, { type: "missing" });
            const oldRaw = before.content.includes(0) ? null : before.content.toString("utf8");
            const diffResult = oldRaw === null ? { diff: null, diffTruncated: false } : makeCompactDiff(oldRaw, null);
            changes.push({
              operationIndex: index,
              kind: "delete",
              path: rel,
              changed: true,
              revisionBefore: sha256Revision(before.content),
              revisionAfter: null,
              ...diffResult,
            });
          }
        }
      } catch (error) {
        if (error.patchCode) {
          const extra = error.patchExtra || {};
          return structuredFailure(error.patchCode, error.message, extra);
        }
        return structuredFailure(APPLY_ERROR_CODES.INVALID_PATCH, error.message);
      }

      if (dryRun) {
        return {
          ok: true,
          value: {
            dryRun: true,
            root: normalizeSeparators(root),
            applied: changes.length,
            changed: changes.filter((change) => change.changed).length,
            changes,
          },
        };
      }

      try {
        for (const abs of touchedPaths) {
          const actual = loadFilesystemState(root, abs);
          const initial = initialStates.get(abs);
          if (!statesEquivalent(initial, actual)) {
            const rel = normalizeSeparators(relativePath(root, abs));
            return structuredFailure(APPLY_ERROR_CODES.CONCURRENT_CHANGE, `workspace changed while preparing patch: ${rel}`, {
              path: rel,
              retryable: true,
              expectedRevision: stateRevision(initial),
              actualRevision: stateRevision(actual),
            });
          }
        }
      } catch (error) {
        if (error.patchCode) return structuredFailure(error.patchCode, error.message, error.patchExtra || {});
        return structuredFailure(APPLY_ERROR_CODES.WRITE_FAILED, error.message);
      }

      const createdDirs = new Set();
      try {
        // Remove files that end as missing or become directories.
        for (const abs of [...touchedPaths].sort((a, b) => depthOfPath(b) - depthOfPath(a))) {
          const initial = initialStates.get(abs);
          const final = virtualStates.get(abs);
          if (initial.type === "file" && (final.type === "missing" || final.type === "dir") && existsSync(abs)) {
            unlinkSync(abs);
          }
        }

        // Create explicit directories first.
        for (const abs of [...touchedPaths].sort((a, b) => depthOfPath(a) - depthOfPath(b))) {
          const final = virtualStates.get(abs);
          if (final.type !== "dir") continue;
          ensureDirectoryTracked(dirname(abs), root, createdDirs);
          if (!existsSync(abs)) {
            mkdirSync(abs);
            createdDirs.add(abs);
          } else if (!lstatSync(abs).isDirectory()) {
            throw patchError(APPLY_ERROR_CODES.NOT_DIRECTORY, "cannot create directory over non-directory", {
              path: normalizeSeparators(relativePath(root, abs)),
            });
          }
        }

        // Materialize final file states. This also implements moves using the validated in-memory state.
        for (const abs of touchedPaths) {
          const final = virtualStates.get(abs);
          if (final.type !== "file") continue;
          ensureDirectoryTracked(dirname(abs), root, createdDirs);
          writeFileSync(abs, final.content);
          if (final.mode !== undefined) chmodSync(abs, final.mode);
        }
      } catch (error) {
        const rollbackFailures = rollbackFilesystem(root, initialStates, touchedPaths, createdDirs);

        if (rollbackFailures.length > 0) {
          return structuredFailure(APPLY_ERROR_CODES.ROLLBACK_FAILED, `patch failed and rollback was incomplete: ${error.message}`, {
            originalError: error.message,
            rollbackFailures,
          });
        }
        return structuredFailure(error.patchCode || APPLY_ERROR_CODES.WRITE_FAILED, error.message, error.patchExtra || {});
      }

      return {
        ok: true,
        value: {
          dryRun: false,
          root: normalizeSeparators(root),
          applied: changes.length,
          changed: changes.filter((change) => change.changed).length,
          changes,
        },
      };
    },
  };
}

module.exports = {
  APPLY_PATCH_INPUT_SCHEMA,
  APPLY_ERROR_CODES,
  createApplyPatchTool,
  validateInput,
  sha256Revision,
};
