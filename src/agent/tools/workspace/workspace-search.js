const { spawn, spawnSync } = require("child_process");
const { Worker } = require("worker_threads");

const INDEX_SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".next", "dist", "build", "out", "coverage", ".venv", "venv",
]);

const INDEX_TEXT_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".md", ".txt",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".yml", ".yaml",
  ".toml", ".xml", ".sh", ".ps1", ".bat", ".sql", ".env", ".gitignore",
]);

const EXACT_SEARCH_MAX_RESULTS = 5000;
const EXACT_SEARCH_MAX_FILES = 25000;
const EXACT_SEARCH_MAX_FILE_BYTES = 5 * 1024 * 1024;
const STREAM_SEARCH_MAX_RESULTS = 50000;
const STREAM_SEARCH_BATCH_SIZE = 100;

function normalizedResultLimit(limit, fallback = 500) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), EXACT_SEARCH_MAX_RESULTS));
}

function createWorkspaceSearch({ fs, path }) {
  let indexCache = null;

  function resolveWorkspaceTarget(workspace, relPath = "") {
    if (!workspace) return { error: "No workspace open" };
    const root = path.resolve(workspace);
    const target = path.resolve(root, relPath || ".");
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return { error: "Path escapes workspace" };
    }
    return { root, target, relative: relative || "" };
  }

  function invalidate(workspace = null) {
    if (!workspace) {
      indexCache = null;
      return;
    }
    const root = path.resolve(workspace);
    if (indexCache?.workspace === root) {
      indexCache = null;
    }
  }

  function isIndexableFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext && path.basename(filePath).startsWith(".")) return true;
    return INDEX_TEXT_EXTS.has(ext);
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .match(/[a-z_][a-z0-9_]{1,}|[0-9]+/g) || [];
  }

  function takeLimited(text, max = 12000) {
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
  }

  function collectWorkspaceFiles(root, { maxFiles = 1500 } = {}) {
    const files = [];

    function walk(dir) {
      if (files.length >= maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") {
          if (entry.isDirectory()) continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!INDEX_SKIP_DIRS.has(entry.name)) walk(full);
          continue;
        }
        if (!entry.isFile() || !isIndexableFile(full)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 400_000) continue;
          files.push({
            full,
            rel: path.relative(root, full).replace(/\\/g, "/"),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // Ignore unreadable files.
        }
      }
    }

    walk(root);
    return files;
  }

  function tryRipgrepFileList(root) {
    try {
      const result = spawnSync(
        "rg",
        ["--files", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!__pycache__"],
        { cwd: root, encoding: "utf8", windowsHide: true },
      );
      if (result.status !== 0 || !result.stdout) return null;
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((rel) => rel.replace(/\\/g, "/"))
        .filter((rel) => !INDEX_SKIP_DIRS.has(rel.split("/")[0]))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return null;
    }
  }

  function exactResult(rel, line, column, match, lineText) {
    const cleanLine = String(lineText || "").replace(/[\r\n]+$/, "");
    const normalizedPath = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
    const trimmedLine = cleanLine.trim();
    const matchIndex = trimmedLine.toLowerCase().indexOf(String(match || "").toLowerCase());
    const previewStart = trimmedLine.length > 360 ? Math.max(0, matchIndex - 140) : 0;
    const previewEnd = Math.min(trimmedLine.length, previewStart + 360);
    const preview = `${previewStart ? "…" : ""}${trimmedLine.slice(previewStart, previewEnd)}${previewEnd < trimmedLine.length ? "…" : ""}`;
    return {
      path: normalizedPath,
      line,
      column,
      match,
      lineText: preview,
      snippet: `${line}: ${preview}`,
    };
  }

  function tryRipgrepExactSearch(root, query, limit) {
    const args = [
      "--json",
      "--fixed-strings",
      "--ignore-case",
      "--line-number",
      "--column",
      "--hidden",
      "--no-ignore",
      "--sort",
      "path",
      "--max-filesize",
      "5M",
    ];
    for (const dir of INDEX_SKIP_DIRS) args.push("-g", `!**/${dir}/**`);
    args.push("--", query, ".");

    let result;
    try {
      result = spawnSync("rg", args, {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return null;
    }
    if (result.error?.code === "ENOENT") return null;
    if (![0, 1, null].includes(result.status)) return null;

    const matches = [];
    let totalCount = 0;
    for (const rawLine of String(result.stdout || "").split(/\r?\n/)) {
      if (!rawLine) continue;
      let event;
      try {
        event = JSON.parse(rawLine);
      } catch {
        continue;
      }
      if (event?.type !== "match") continue;
      const data = event.data || {};
      const rel = data.path?.text || "";
      const lineNumber = Number(data.line_number) || 1;
      const lineText = data.lines?.text || "";
      for (const occurrence of data.submatches || []) {
        totalCount += 1;
        if (matches.length >= limit) continue;
        matches.push(exactResult(
          rel,
          lineNumber,
          Number(occurrence.start) + 1,
          occurrence.match?.text || query,
          lineText,
        ));
      }
    }

    return {
      matches,
      totalCount,
      truncated: totalCount > matches.length || Boolean(result.error),
    };
  }

  function fallbackExactSearch(root, query, limit) {
    const matches = [];
    let totalCount = 0;
    let filesScanned = 0;
    let scanTruncated = false;
    const needle = query.toLowerCase();

    function walk(dir) {
      if (filesScanned >= EXACT_SEARCH_MAX_FILES) {
        scanTruncated = true;
        return;
      }
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (filesScanned >= EXACT_SEARCH_MAX_FILES) {
          scanTruncated = true;
          return;
        }
        if (entry.isSymbolicLink?.()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!INDEX_SKIP_DIRS.has(entry.name)) walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        filesScanned += 1;

        let stat;
        let buffer;
        try {
          stat = fs.statSync(full);
          if (stat.size > EXACT_SEARCH_MAX_FILE_BYTES) continue;
          buffer = fs.readFileSync(full);
        } catch {
          continue;
        }
        if (buffer.includes(0)) continue;
        const lines = buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
        const rel = path.relative(root, full).replace(/\\/g, "/");
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const lineText = lines[lineIndex];
          const comparable = lineText.toLowerCase();
          let from = 0;
          while (from <= comparable.length - needle.length) {
            const columnIndex = comparable.indexOf(needle, from);
            if (columnIndex === -1) break;
            totalCount += 1;
            if (matches.length < limit) {
              matches.push(exactResult(
                rel,
                lineIndex + 1,
                columnIndex + 1,
                lineText.slice(columnIndex, columnIndex + query.length),
                lineText,
              ));
            }
            from = columnIndex + Math.max(needle.length, 1);
          }
        }
      }
    }

    walk(root);
    return {
      matches,
      totalCount,
      truncated: totalCount > matches.length || scanTruncated,
      scanTruncated,
    };
  }

  function streamRipgrepExactSearch(root, query, {
    limit,
    batchSize,
    signal,
    onBatch,
  }) {
    const args = [
      "--json",
      "--fixed-strings",
      "--ignore-case",
      "--line-number",
      "--column",
      "--hidden",
      "--no-ignore",
      "--sort",
      "path",
      "--max-filesize",
      "5M",
    ];
    for (const dir of INDEX_SKIP_DIRS) args.push("-g", `!**/${dir}/**`);
    args.push("--", query, ".");

    return new Promise((resolve) => {
      let child;
      try {
        child = spawn("rg", args, { cwd: root, windowsHide: true });
      } catch {
        resolve(null);
        return;
      }

      let settled = false;
      let buffer = "";
      let batch = [];
      let totalCount = 0;
      let emittedCount = 0;
      let filesScanned = 0;
      let capped = false;
      let cancelled = Boolean(signal?.aborted);

      const emitBatch = () => {
        if (!batch.length || cancelled) return;
        const rows = batch;
        batch = [];
        try {
          onBatch?.({ results: rows, totalCount, filesScanned });
        } catch {
          // A renderer disappearing must not keep the search process alive.
        }
      };

      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.("abort", abort);
        if (!cancelled) emitBatch();
        resolve(value);
      };

      const stopChild = () => {
        if (!child?.killed) {
          try { child.kill(); } catch { /* process already exited */ }
        }
      };

      const abort = () => {
        cancelled = true;
        stopChild();
      };

      const acceptEvent = (event) => {
        if (event?.type === "begin") {
          filesScanned += 1;
          return;
        }
        if (event?.type !== "match" || capped || cancelled) return;
        const data = event.data || {};
        const rel = data.path?.text || "";
        const lineNumber = Number(data.line_number) || 1;
        const lineText = data.lines?.text || "";
        for (const occurrence of data.submatches || []) {
          if (totalCount >= STREAM_SEARCH_MAX_RESULTS) {
            capped = true;
            stopChild();
            break;
          }
          totalCount += 1;
          if (emittedCount < limit) {
            batch.push(exactResult(
              rel,
              lineNumber,
              Number(occurrence.start) + 1,
              occurrence.match?.text || query,
              lineText,
            ));
            emittedCount += 1;
            if (batch.length >= batchSize) emitBatch();
          }
        }
      };

      const consume = (flush = false) => {
        const lines = buffer.split(/\r?\n/);
        buffer = flush ? "" : (lines.pop() || "");
        for (const rawLine of lines) {
          if (!rawLine) continue;
          try { acceptEvent(JSON.parse(rawLine)); } catch { /* incomplete diagnostic line */ }
        }
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        buffer += chunk;
        consume(false);
      });
      child.stderr?.resume();
      child.once("error", (error) => {
        if (error?.code === "ENOENT") finish(null);
        else finish(null);
      });
      child.once("close", () => {
        consume(true);
        finish({
          ok: true,
          mode: "exact",
          query,
          count: emittedCount,
          totalCount,
          filesScanned,
          truncated: capped || totalCount > emittedCount,
          capped,
          cancelled,
        });
      });

      signal?.addEventListener?.("abort", abort, { once: true });
      if (cancelled) abort();
    });
  }

  function streamFallbackWorker(root, query, {
    limit,
    batchSize,
    signal,
    onBatch,
  }) {
    return new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, "workspace-search-worker.js"), {
        workerData: {
          root,
          query,
          limit,
          batchSize,
          maxResults: STREAM_SEARCH_MAX_RESULTS,
          maxFiles: EXACT_SEARCH_MAX_FILES,
          maxFileBytes: EXACT_SEARCH_MAX_FILE_BYTES,
          skipDirs: [...INDEX_SKIP_DIRS],
        },
      });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.("abort", abort);
        resolve(value);
      };
      const abort = () => {
        void worker.terminate();
        finish({
          ok: true,
          mode: "exact",
          query,
          count: 0,
          totalCount: 0,
          truncated: false,
          capped: false,
          cancelled: true,
        });
      };
      worker.on("message", (message) => {
        if (message?.type === "batch") onBatch?.(message.payload);
        else if (message?.type === "done") finish(message.payload);
      });
      worker.once("error", (error) => finish({ error: error.message || "Workspace search worker failed" }));
      worker.once("exit", (code) => {
        if (!settled && code !== 0) finish({ error: `Workspace search worker exited with code ${code}` });
      });
      signal?.addEventListener?.("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  async function searchWorkspaceStream(workspace, query, {
    limit = STREAM_SEARCH_MAX_RESULTS,
    batchSize = STREAM_SEARCH_BATCH_SIZE,
    signal,
    onBatch,
    forceFallback = false,
  } = {}) {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) return { error: "Empty search query" };
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return resolved;
    const boundedLimit = Math.max(1, Math.min(Number(limit) || STREAM_SEARCH_MAX_RESULTS, STREAM_SEARCH_MAX_RESULTS));
    const boundedBatchSize = Math.max(10, Math.min(Number(batchSize) || STREAM_SEARCH_BATCH_SIZE, 500));
    if (signal?.aborted) return { ok: true, cancelled: true, count: 0, totalCount: 0 };

    const ripgrepResult = forceFallback ? null : await streamRipgrepExactSearch(resolved.root, cleanQuery, {
        limit: boundedLimit,
        batchSize: boundedBatchSize,
        signal,
        onBatch,
      });
    if (ripgrepResult) return ripgrepResult;
    return streamFallbackWorker(resolved.root, cleanQuery, {
      limit: boundedLimit,
      batchSize: boundedBatchSize,
      signal,
      onBatch,
    });
  }

  function listProjectFiles(workspace) {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return resolved;

    const rgFiles = tryRipgrepFileList(resolved.root);
    if (rgFiles?.length) {
      return { ok: true, files: rgFiles };
    }

    const files = collectWorkspaceFiles(resolved.root, { maxFiles: 4000 })
      .map((entry) => entry.rel)
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, files };
  }

  function extractGraphFacts(rel, content) {
    const imports = [];
    const symbols = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines.slice(0, 700)) {
      const importMatch = line.match(/^\s*(?:import\s+.*?\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|from\s+([\w.]+)\s+import\s+|require\(["']([^"']+)["']\))/);
      const target = importMatch?.[1] || importMatch?.[2] || importMatch?.[3] || importMatch?.[4];
      if (target) imports.push(target);

      const symbolMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|^\s*def\s+([A-Za-z_][\w]*)|^\s*class\s+([A-Za-z_][\w]*)/);
      const symbol = symbolMatch?.[1] || symbolMatch?.[2] || symbolMatch?.[3] || symbolMatch?.[4];
      if (symbol) symbols.push(symbol);
    }

    return {
      file: rel,
      imports: [...new Set(imports)].slice(0, 20),
      symbols: [...new Set(symbols)].slice(0, 40),
    };
  }

  function buildWorkspaceIndex(workspace) {
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return resolved;

    const root = resolved.root;
    const files = collectWorkspaceFiles(root);
    const docs = [];
    const graph = [];
    const df = new Map();

    for (const file of files) {
      let content = "";
      try {
        content = fs.readFileSync(file.full, "utf8");
      } catch {
        continue;
      }

      const tokens = tokenize(`${file.rel}\n${content}`);
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      for (const token of counts.keys()) df.set(token, (df.get(token) || 0) + 1);

      docs.push({
        path: file.rel,
        size: file.size,
        mtimeMs: file.mtimeMs,
        content,
        counts,
        tokenCount: tokens.length || 1,
      });
      graph.push(extractGraphFacts(file.rel, content));
    }

    indexCache = {
      workspace: root,
      builtAt: Date.now(),
      docs,
      df,
      graph,
    };
    return indexCache;
  }

  function getWorkspaceIndex(workspace) {
    const root = path.resolve(workspace || ".");
    if (indexCache?.workspace === root) return indexCache;
    return buildWorkspaceIndex(root);
  }

  function fuzzyPathScore(relPath, queryTokens) {
    const rel = relPath.toLowerCase();
    const base = rel.split("/").pop() || rel;
    let score = 0;

    for (const token of queryTokens) {
      if (!token) continue;
      if (rel === token) score += 15;
      if (base === token) score += 24;
      if (base.startsWith(token)) score += 18;
      if (base.includes(token)) score += 12;
      if (rel.includes(token)) score += 8;
      const dotToken = `.${token}`;
      if (base.endsWith(dotToken) || rel.endsWith(dotToken)) score += 14;
    }

    return score;
  }

  function formatSnippet(content, query) {
    const lines = String(content || "").split(/\r?\n/);
    const queryTokens = tokenize(query);
    let bestLine = 0;
    let bestScore = -1;

    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase();
      let score = 0;
      if (lower.includes(String(query || "").toLowerCase())) score += 6;
      for (const token of queryTokens) {
        if (lower.includes(token)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLine = i;
      }
    }

    const start = Math.max(0, bestLine - 2);
    const end = Math.min(lines.length, bestLine + 3);
    const snippet = lines.slice(start, end)
      .map((line, index) => `${start + index + 1}: ${line}`)
      .join("\n");
    return takeLimited(snippet, 1200);
  }

  function findWorkspaceFiles(workspace, query, { limit = 8 } = {}) {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) return { error: "Empty search query" };
    const listed = listProjectFiles(workspace);
    if (listed.error) return listed;

    const queryTokens = tokenize(cleanQuery);
    const loweredQuery = cleanQuery.toLowerCase();
    const results = listed.files
      .map((file) => {
        const rel = file.toLowerCase();
        let score = fuzzyPathScore(file, queryTokens);
        if (rel.includes(loweredQuery)) score += 20;
        return { path: file, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, Math.max(1, Math.min(limit, 20)));

    return {
      ok: true,
      mode: "find",
      query: cleanQuery,
      count: results.length,
      results,
    };
  }

  function searchWorkspaceIndex(workspace, query, { limit = 500 } = {}) {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) return { error: "Empty search query" };
    const resolved = resolveWorkspaceTarget(workspace);
    if (resolved.error) return resolved;
    const resultLimit = normalizedResultLimit(limit);
    const exact = tryRipgrepExactSearch(resolved.root, cleanQuery, resultLimit)
      || fallbackExactSearch(resolved.root, cleanQuery, resultLimit);

    return {
      ok: true,
      mode: "exact",
      query: cleanQuery,
      count: exact.matches.length,
      totalCount: exact.totalCount,
      truncated: exact.truncated,
      results: exact.matches,
    };
  }

  return {
    resolveWorkspaceTarget,
    invalidate,
    listProjectFiles,
    buildWorkspaceIndex,
    searchWorkspaceIndex,
    searchWorkspaceStream,
    findWorkspaceFiles,
    takeLimited,
  };
}

module.exports = {
  createWorkspaceSearch,
};
