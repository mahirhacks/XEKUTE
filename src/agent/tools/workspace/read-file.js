"use strict";

const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync, realpathSync } = require("node:fs");
const {
  resolve: resolvePath,
  join: joinPath,
  relative: relativePath,
  extname,
  isAbsolute,
  sep: pathSeparator,
} = require("node:path");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const DEFAULT_FILE_LINE_LIMIT = 800;
const MAX_FILE_LINE_LIMIT = 5000;
const DEFAULT_DIRECTORY_LIMIT = 200;
const MAX_DIRECTORY_LIMIT = 1000;

const READ_FILE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description: "Workspace-relative file or directory path. Absolute paths are allowed only when they remain inside the workspace root.",
    },
    mode: {
      type: "string",
      enum: ["file", "directory", "metadata"],
      description: "Read text content, list a directory, or return metadata only. If omitted, files use file mode and directories use directory mode.",
    },
    startLine: {
      type: "integer",
      minimum: 1,
      description: "1-based first line to return in file mode.",
    },
    endLine: {
      type: "integer",
      minimum: 1,
      description: "1-based inclusive final line to return in file mode.",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "0-based item/line offset. Use with limit. In file mode, startLine/endLine take precedence.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_FILE_LINE_LIMIT,
      description: "Maximum lines in file mode or entries in directory mode.",
    },
  },
});

const BINARY_FILE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar", ".exe", ".dll", ".so",
  ".dylib", ".bin", ".wasm", ".class", ".jar", ".woff", ".woff2", ".ttf",
  ".otf", ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".flac",
]);

const READ_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_READ_FILE_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  OUTSIDE_WORKSPACE: "READ_FILE_OUTSIDE_WORKSPACE",
  NOT_FOUND: "READ_FILE_NOT_FOUND",
  PERMISSION: "READ_FILE_PERMISSION_DENIED",
  IS_DIRECTORY: "READ_FILE_IS_DIRECTORY",
  NOT_A_DIRECTORY: "READ_FILE_NOT_A_DIRECTORY",
  SYMBOLIC_LINK: "READ_FILE_SYMBOLIC_LINK_UNSUPPORTED",
  BINARY_FILE: "READ_FILE_BINARY_CONTENT",
  READ_FAILED: "READ_FILE_FAILED",
  INVALID_RANGE: "READ_FILE_INVALID_RANGE",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: READ_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (typeof input.path !== "string" || input.path.trim() === "") {
    return invalidInput("path must be a non-empty string");
  }
  if (/\u0000|\r|\n/.test(input.path)) {
    return invalidInput("path contains an invalid control character");
  }
  if (input.mode !== undefined && !["file", "directory", "metadata"].includes(input.mode)) {
    return invalidInput("mode must be file, directory, or metadata");
  }

  for (const field of ["startLine", "endLine"]) {
    if (input[field] !== undefined && (!Number.isInteger(input[field]) || input[field] < 1)) {
      return invalidInput(`${field} must be a positive integer`);
    }
  }

  if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0)) {
    return invalidInput("offset must be a non-negative integer");
  }

  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_FILE_LINE_LIMIT)) {
    return invalidInput(`limit must be an integer between 1 and ${MAX_FILE_LINE_LIMIT}`);
  }

  if (input.startLine !== undefined && input.endLine !== undefined && input.startLine > input.endLine) {
    return invalidInput("startLine must be less than or equal to endLine");
  }

  if ((input.startLine !== undefined || input.endLine !== undefined) && input.offset !== undefined) {
    return invalidInput("use either startLine/endLine or offset/limit, not both");
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

function resolveWorkspacePath(root, rawPath) {
  const rootResolved = resolvePath(root);
  const candidate = isAbsolute(rawPath) ? resolvePath(rawPath) : resolvePath(rootResolved, rawPath);
  if (!isInsideRoot(rootResolved, candidate)) {
    return structuredFailure(READ_ERROR_CODES.OUTSIDE_WORKSPACE, "path resolves outside the workspace root", {
      path: rawPath,
    });
  }
  return { ok: true, root: rootResolved, path: candidate };
}

function assertRealPathInsideRoot(root, candidate) {
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  if (!isInsideRoot(realRoot, realCandidate)) {
    return structuredFailure(READ_ERROR_CODES.OUTSIDE_WORKSPACE, "resolved path escapes the workspace root", {
      path: candidate,
    });
  }
  return { ok: true, realPath: realCandidate };
}

function isBinaryPath(filePath) {
  return BINARY_FILE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function hasNulByte(buffer) {
  return buffer.includes(0);
}

function sha256Revision(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function detectEol(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/(?<!\r)\n/g) || []).length;
  if (crlf === 0 && lf === 0) return "none";
  if (crlf > 0 && lf === 0) return "crlf";
  if (lf > 0 && crlf === 0) return "lf";
  return "mixed";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toMetadata(stat, filePath, root) {
  return {
    path: normalizeSeparators(filePath),
    relativePath: normalizeSeparators(relativePath(root, filePath) || "."),
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    size: stat.size,
    sizeHuman: formatBytes(stat.size),
    mode: stat.mode,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    isSymbolicLink: stat.isSymbolicLink(),
  };
}

function listDirectory(dirPath, root, input) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const offset = input.offset || 0;
  const requestedLimit = input.limit || DEFAULT_DIRECTORY_LIMIT;
  const limit = Math.min(requestedLimit, MAX_DIRECTORY_LIMIT);
  const selected = entries.slice(offset, offset + limit);

  const items = selected.map((entry) => {
    const full = joinPath(dirPath, entry.name);
    let metadata = null;
    try {
      metadata = toMetadata(lstatSync(full), full, root);
    } catch {
      // Directory listings remain useful even if one entry becomes unavailable mid-read.
    }
    return {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
      metadata,
    };
  });

  const nextOffset = offset + items.length < entries.length ? offset + items.length : null;
  return {
    ok: true,
    value: {
      path: normalizeSeparators(dirPath),
      relativePath: normalizeSeparators(relativePath(root, dirPath) || "."),
      mode: "directory",
      entryCount: entries.length,
      offset,
      returned: items.length,
      truncated: nextOffset !== null,
      nextOffset,
      entries: items,
    },
  };
}

function readFileContent(filePath, input, root) {
  const buffer = readFileSync(filePath);
  if (hasNulByte(buffer) || isBinaryPath(filePath)) {
    return structuredFailure(
      READ_ERROR_CODES.BINARY_FILE,
      "binary file content is not returned as text; use mode metadata",
      { path: normalizeSeparators(relativePath(root, filePath)) },
    );
  }

  const rawContent = buffer.toString("utf8");
  const content = rawContent.replace(/\r\n/g, "\n");
  const rawLines = content === "" ? [] : content.split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "" && content.endsWith("\n")) rawLines.pop();

  const lineCount = rawLines.length;
  let startIndex;
  let endExclusive;

  if (input.startLine !== undefined || input.endLine !== undefined) {
    const startLine = input.startLine || 1;
    if (lineCount > 0 && startLine > lineCount) {
      return structuredFailure(READ_ERROR_CODES.INVALID_RANGE, "startLine is beyond the end of the file", {
        lineCount,
      });
    }
    const endLine = Math.min(input.endLine || lineCount, lineCount);
    startIndex = Math.max(0, startLine - 1);
    endExclusive = Math.max(startIndex, endLine);
  } else {
    startIndex = input.offset || 0;
    const limit = input.limit || DEFAULT_FILE_LINE_LIMIT;
    endExclusive = Math.min(startIndex + limit, lineCount);
  }

  const selected = rawLines.slice(startIndex, endExclusive);
  const startLine = lineCount === 0 ? 0 : startIndex + 1;
  const endLine = selected.length === 0 ? 0 : startIndex + selected.length;
  const truncated = endExclusive < lineCount;

  return {
    ok: true,
    value: {
      path: normalizeSeparators(filePath),
      relativePath: normalizeSeparators(relativePath(root, filePath)),
      mode: "file",
      encoding: "utf8",
      eol: detectEol(rawContent),
      revision: sha256Revision(buffer),
      content: selected.join("\n"),
      lineCount,
      startLine,
      endLine,
      returnedLines: selected.length,
      truncated,
      nextStartLine: truncated ? endExclusive + 1 : null,
    },
  };
}

function createReadFileTool() {
  return {
    name: "read_file",
    description:
      "Read workspace text files, directory listings, or metadata. Before modifying an existing file, read it first and pass the returned revision to apply_patch as expectedRevision. File content is normalized to LF for reliable agent editing; the original EOL style is returned separately.",
    inputSchema: READ_FILE_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(READ_ERROR_CODES.INVALID_CONTEXT, "read_file requires a restricted tool execution context projection");
      }

      const root = executionContext.workspace?.root || process.cwd();
      const resolvedResult = resolveWorkspacePath(root, input.path);
      if (!resolvedResult.ok) return resolvedResult;
      const { path: resolved, root: resolvedRoot } = resolvedResult;

      try {
        const stat = lstatSync(resolved);
        if (stat.isSymbolicLink()) {
          return structuredFailure(READ_ERROR_CODES.SYMBOLIC_LINK, "symbolic links are not read by read_file", {
            path: normalizeSeparators(relativePath(resolvedRoot, resolved)),
          });
        }

        const realCheck = assertRealPathInsideRoot(resolvedRoot, resolved);
        if (!realCheck.ok) return realCheck;

        if (stat.isDirectory()) {
          if (input.mode === "file") {
            return structuredFailure(READ_ERROR_CODES.IS_DIRECTORY, "path is a directory; use mode directory or metadata");
          }
          if (input.mode === "metadata") {
            return {
              ok: true,
              value: {
                path: normalizeSeparators(resolved),
                relativePath: normalizeSeparators(relativePath(resolvedRoot, resolved) || "."),
                mode: "metadata",
                metadata: toMetadata(stat, resolved, resolvedRoot),
              },
            };
          }
          return listDirectory(resolved, resolvedRoot, input);
        }

        if (!stat.isFile()) {
          return structuredFailure(READ_ERROR_CODES.READ_FAILED, "path is not a regular file or directory", {
            path: normalizeSeparators(relativePath(resolvedRoot, resolved)),
          });
        }

        if (input.mode === "directory") {
          return structuredFailure(READ_ERROR_CODES.NOT_A_DIRECTORY, "path is not a directory");
        }

        if (input.mode === "metadata") {
          return {
            ok: true,
            value: {
              path: normalizeSeparators(resolved),
              relativePath: normalizeSeparators(relativePath(resolvedRoot, resolved)),
              mode: "metadata",
              metadata: toMetadata(stat, resolved, resolvedRoot),
              revision: sha256Revision(readFileSync(resolved)),
            },
          };
        }

        return readFileContent(resolved, input, resolvedRoot);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
          return structuredFailure(READ_ERROR_CODES.NOT_FOUND, "path does not exist", {
            path: normalizeSeparators(relativePath(resolvedRoot, resolved)),
          });
        }
        if (error.code === "EACCES" || error.code === "EPERM") {
          return structuredFailure(READ_ERROR_CODES.PERMISSION, "permission denied reading path", {
            path: normalizeSeparators(relativePath(resolvedRoot, resolved)),
          });
        }
        return structuredFailure(READ_ERROR_CODES.READ_FAILED, error.message, {
          path: normalizeSeparators(relativePath(resolvedRoot, resolved)),
        });
      }
    },
  };
}

module.exports = {
  READ_FILE_INPUT_SCHEMA,
  READ_ERROR_CODES,
  createReadFileTool,
  validateInput,
  isBinaryPath,
  sha256Revision,
};
