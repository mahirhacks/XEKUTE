"use strict";

const { readdirSync, readFileSync, lstatSync, realpathSync } = require("node:fs");
const {
  join: joinPath,
  relative: relativePath,
  extname,
  basename,
  resolve: resolvePath,
  isAbsolute,
  sep: pathSeparator,
} = require("node:path");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS = 500;
const DEFAULT_MAX_FILES = 8000;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;

const SEARCH_WORKSPACE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["mode", "query"],
  properties: {
    mode: {
      type: "string",
      enum: ["filename", "text", "symbol", "pattern", "reference"],
      description: "Search by filename, literal text, declared symbol, regular expression, or import/require reference.",
    },
    query: {
      type: "string",
      description: "Search query. pattern mode treats this value as a JavaScript regular expression.",
    },
    path: {
      type: "string",
      minLength: 1,
      description: "Optional workspace-relative directory to search. Defaults to the workspace root.",
    },
    caseSensitive: {
      type: "boolean",
      description: "Use case-sensitive matching. Defaults to false.",
    },
    maxResults: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RESULTS,
      description: `Maximum matches returned. Defaults to ${DEFAULT_MAX_RESULTS}.`,
    },
    includeHidden: {
      type: "boolean",
      description: "Include hidden files and directories except hard-skipped dependency/build directories. Defaults to false.",
    },
  },
});

const SEARCH_SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".next", "dist", "build", "out", "coverage",
  ".venv", "venv", ".cache", ".idea", ".commandcode",
]);

const SEARCH_TEXT_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".jsonc", ".css", ".scss", ".sass",
  ".less", ".html", ".htm", ".md", ".mdx", ".txt", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".kts", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php", ".vue", ".svelte", ".yml", ".yaml",
  ".toml", ".xml", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".sql", ".env",
  ".gitignore", ".gitattributes", ".ini", ".cfg", ".conf", ".properties", ".gradle", ".graphql", ".gql",
]);

const SEARCH_TEXT_BASENAMES = new Set([
  "dockerfile", "makefile", "procfile", "gemfile", "rakefile", "license", "readme", "agents.md", "skill.md",
]);

const SEARCH_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_SEARCH_WORKSPACE_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  OUTSIDE_WORKSPACE: "SEARCH_WORKSPACE_OUTSIDE_WORKSPACE",
  NOT_FOUND: "SEARCH_WORKSPACE_ROOT_NOT_FOUND",
  NOT_DIRECTORY: "SEARCH_WORKSPACE_ROOT_NOT_DIRECTORY",
  SYMBOLIC_LINK: "SEARCH_WORKSPACE_SYMBOLIC_LINK_UNSUPPORTED",
  READ_FAILED: "SEARCH_WORKSPACE_READ_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: SEARCH_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["filename", "text", "symbol", "pattern", "reference"].includes(input.mode)) {
    return invalidInput("mode must be filename, text, symbol, pattern, or reference");
  }
  if (typeof input.query !== "string") return invalidInput("query must be a string");
  if (/\u0000|\r|\n/.test(input.query)) return invalidInput("query must not contain control characters");

  if (input.mode === "pattern") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(input.query);
    } catch {
      return invalidInput("query must be a valid JavaScript regular expression for pattern mode");
    }
  } else if (input.query.trim() === "") {
    return invalidInput("query must be a non-empty string");
  }

  if (input.path !== undefined) {
    if (typeof input.path !== "string" || input.path.trim() === "") {
      return invalidInput("path must be a non-empty string");
    }
    if (/\u0000|\r|\n/.test(input.path)) return invalidInput("path must not contain control characters");
  }

  if (input.caseSensitive !== undefined && typeof input.caseSensitive !== "boolean") {
    return invalidInput("caseSensitive must be a boolean");
  }
  if (input.includeHidden !== undefined && typeof input.includeHidden !== "boolean") {
    return invalidInput("includeHidden must be a boolean");
  }
  if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > MAX_RESULTS)) {
    return invalidInput(`maxResults must be an integer between 1 and ${MAX_RESULTS}`);
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
  const candidate = rawPath
    ? (isAbsolute(rawPath) ? resolvePath(rawPath) : resolvePath(rootResolved, rawPath))
    : rootResolved;
  if (!isInsideRoot(rootResolved, candidate)) {
    return structuredFailure(SEARCH_ERROR_CODES.OUTSIDE_WORKSPACE, "search path resolves outside the workspace root", {
      path: rawPath,
    });
  }
  return { ok: true, root: rootResolved, path: candidate };
}

function isHiddenName(name) {
  return name.startsWith(".");
}

function isTextFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (SEARCH_TEXT_EXTS.has(ext)) return true;
  return SEARCH_TEXT_BASENAMES.has(basename(filePath).toLowerCase());
}

function collectFiles(searchRoot, workspaceRoot, { includeHidden = false, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const files = [];
  let directoriesScanned = 0;
  let inaccessibleEntries = 0;
  let truncated = false;

  function walk(dir) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
      directoriesScanned += 1;
    } catch {
      inaccessibleEntries += 1;
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      if (!includeHidden && isHiddenName(entry.name)) continue;

      const full = joinPath(dir, entry.name);
      if (!isInsideRoot(workspaceRoot, full)) continue;

      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  walk(searchRoot);
  return { files, directoriesScanned, inaccessibleEntries, truncated };
}

function searchFilename(files, query, { caseSensitive, workspaceRoot, maxResults }) {
  const needle = caseSensitive ? query : query.toLowerCase();
  const results = [];

  for (const file of files) {
    const rel = normalizeSeparators(relativePath(workspaceRoot, file));
    const base = basename(file);
    const haystack = caseSensitive ? rel : rel.toLowerCase();
    const baseHaystack = caseSensitive ? base : base.toLowerCase();
    if (!haystack.includes(needle) && !baseHaystack.includes(needle)) continue;

    let size = null;
    try {
      size = lstatSync(file).size;
    } catch {
      // A filename match remains useful even if metadata races with a filesystem change.
    }
    results.push({ path: rel, name: base, size });
    if (results.length >= maxResults) break;
  }

  return results;
}

function extractSymbols(line) {
  const symbols = [];
  const patterns = [
    /^\s*(?:export\s+default\s+|export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
    /^\s*def\s+([A-Za-z_][\w]*)/,
    /^\s*class\s+([A-Za-z_][\w]*)/,
    /^\s*(?:public|private|protected|internal|static|final|abstract|async|virtual|override|sealed|partial|\s)+\s*(?:class|interface|enum|struct)\s+([A-Za-z_][\w]*)/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) symbols.push(match[1]);
  }
  return symbols;
}

function extractReferences(line) {
  const refs = [];
  const patterns = [
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /import\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /export\s+[^"']+?\s+from\s+["']([^"']+)["']/g,
    /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/g,
    /^\s*import\s+([A-Za-z0-9_\.]+)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      const ref = match[1];
      if (ref && !ref.startsWith("node:")) refs.push(ref);
    }
  }
  return refs;
}

function makeSnippet(lines, lineIndex, window = 2) {
  const start = Math.max(0, lineIndex - window);
  const end = Math.min(lines.length, lineIndex + window + 1);
  return lines
    .slice(start, end)
    .map((line, i) => `${start + i + 1}: ${line}`)
    .join("\n");
}

function takeLimited(value, max = 1000) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}â€¦` : text;
}

function searchTextInFile(file, query, mode, { caseSensitive, maxResults, workspaceRoot, compiledPattern }) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return { matches: [], skipped: true, reason: "stat_failed" };
  }
  if (!stat.isFile()) return { matches: [], skipped: true, reason: "not_file" };
  if (stat.size > MAX_SEARCH_FILE_BYTES) return { matches: [], skipped: true, reason: "too_large" };

  let content;
  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return { matches: [], skipped: true, reason: "binary" };
    content = buffer.toString("utf8").replace(/\r\n/g, "\n");
  } catch {
    return { matches: [], skipped: true, reason: "read_failed" };
  }

  const rel = normalizeSeparators(relativePath(workspaceRoot, file));
  const lines = content.split("\n");
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches = [];

  for (let i = 0; i < lines.length && matches.length < maxResults; i += 1) {
    const line = lines[i];
    const comparableLine = caseSensitive ? line : line.toLowerCase();
    let matchedText = null;
    let columnIndex = -1;

    if (mode === "text") {
      columnIndex = comparableLine.indexOf(needle);
      if (columnIndex !== -1) matchedText = line.slice(columnIndex, columnIndex + query.length);
    } else if (mode === "pattern") {
      compiledPattern.lastIndex = 0;
      const match = compiledPattern.exec(line);
      if (match) {
        columnIndex = match.index;
        matchedText = match[0];
      }
    } else if (mode === "symbol") {
      const symbols = extractSymbols(line);
      const symbol = symbols.find((value) => caseSensitive ? value === query : value.toLowerCase() === query.toLowerCase());
      if (symbol) {
        columnIndex = line.indexOf(symbol);
        matchedText = symbol;
      }
    } else if (mode === "reference") {
      const refs = extractReferences(line);
      const ref = refs.find((value) => caseSensitive ? value.includes(query) : value.toLowerCase().includes(query.toLowerCase()));
      if (ref) {
        columnIndex = line.indexOf(ref);
        matchedText = ref;
      }
    }

    if (columnIndex === -1) continue;
    matches.push({
      path: rel,
      line: i + 1,
      column: columnIndex + 1,
      match: takeLimited(matchedText, 200),
      snippet: takeLimited(makeSnippet(lines, i)),
    });
  }

  return { matches, skipped: false, reason: null };
}

function createSearchWorkspaceTool() {
  return {
    name: "search_workspace",
    description:
      "Locate files and code before reading or editing them. Use filename for paths, text for literal content, symbol for declarations, pattern for regex, and reference for imports/requires. Returned paths are always relative to the workspace root and are suitable for read_file/apply_patch.",
    inputSchema: SEARCH_WORKSPACE_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(SEARCH_ERROR_CODES.INVALID_CONTEXT, "search_workspace requires a restricted tool execution context projection");
      }

      const root = executionContext.workspace?.root || process.cwd();
      const resolvedResult = resolveWorkspacePath(root, input.path);
      if (!resolvedResult.ok) return resolvedResult;
      const { root: workspaceRoot, path: searchRoot } = resolvedResult;

      try {
        const stat = lstatSync(searchRoot);
        if (stat.isSymbolicLink()) {
          return structuredFailure(SEARCH_ERROR_CODES.SYMBOLIC_LINK, "symbolic links cannot be used as search roots", {
            path: input.path || ".",
          });
        }
        if (!stat.isDirectory()) {
          return structuredFailure(SEARCH_ERROR_CODES.NOT_DIRECTORY, "search root is not a directory", {
            path: normalizeSeparators(relativePath(workspaceRoot, searchRoot)),
          });
        }

        const realRoot = realpathSync(workspaceRoot);
        const realSearchRoot = realpathSync(searchRoot);
        if (!isInsideRoot(realRoot, realSearchRoot)) {
          return structuredFailure(SEARCH_ERROR_CODES.OUTSIDE_WORKSPACE, "resolved search root escapes the workspace", {
            path: input.path || ".",
          });
        }
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
          return structuredFailure(SEARCH_ERROR_CODES.NOT_FOUND, "search root does not exist", {
            path: input.path || ".",
          });
        }
        if (error.code === "EACCES" || error.code === "EPERM") {
          return structuredFailure(SEARCH_ERROR_CODES.READ_FAILED, "permission denied reading search root", {
            path: input.path || ".",
          });
        }
        return structuredFailure(SEARCH_ERROR_CODES.READ_FAILED, error.message, { path: input.path || "." });
      }

      const includeHidden = Boolean(input.includeHidden);
      const caseSensitive = Boolean(input.caseSensitive);
      const maxResults = input.maxResults || DEFAULT_MAX_RESULTS;
      const scan = collectFiles(searchRoot, workspaceRoot, { includeHidden });

      let matches = [];
      let skippedBinary = 0;
      let skippedLarge = 0;
      let skippedUnreadable = 0;

      if (input.mode === "filename") {
        matches = searchFilename(scan.files, input.query, { caseSensitive, workspaceRoot, maxResults });
      } else {
        const compiledPattern = input.mode === "pattern"
          ? new RegExp(input.query, caseSensitive ? "g" : "gi")
          : null;

        for (const file of scan.files) {
          if (matches.length >= maxResults) break;
          if (!isTextFile(file)) continue;

          const result = searchTextInFile(file, input.query, input.mode, {
            caseSensitive,
            maxResults: maxResults - matches.length,
            workspaceRoot,
            compiledPattern,
          });

          if (result.skipped) {
            if (result.reason === "binary") skippedBinary += 1;
            else if (result.reason === "too_large") skippedLarge += 1;
            else skippedUnreadable += 1;
            continue;
          }
          matches.push(...result.matches);
        }
      }

      return {
        ok: true,
        value: {
          mode: input.mode,
          query: input.query,
          root: normalizeSeparators(workspaceRoot),
          searchPath: normalizeSeparators(relativePath(workspaceRoot, searchRoot) || "."),
          count: matches.length,
          truncated: matches.length >= maxResults,
          matches,
          scan: {
            filesDiscovered: scan.files.length,
            directoriesScanned: scan.directoriesScanned,
            scanTruncated: scan.truncated,
            inaccessibleEntries: scan.inaccessibleEntries,
            skippedBinary,
            skippedLarge,
            skippedUnreadable,
          },
        },
      };
    },
  };
}

module.exports = {
  SEARCH_WORKSPACE_INPUT_SCHEMA,
  SEARCH_ERROR_CODES,
  createSearchWorkspaceTool,
  validateInput,
  isTextFile,
};
