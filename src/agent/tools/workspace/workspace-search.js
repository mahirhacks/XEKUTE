const { spawnSync } = require("child_process");

const INDEX_SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".next", "dist", "build", "out", "coverage", ".venv", "venv",
]);

const INDEX_TEXT_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".md", ".txt",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".yml", ".yaml",
  ".toml", ".xml", ".sh", ".ps1", ".bat", ".sql", ".env", ".gitignore",
]);

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

  function searchWorkspaceIndex(workspace, query, { limit = 8 } = {}) {
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) return { error: "Empty search query" };
    const index = getWorkspaceIndex(workspace);
    if (index.error) return index;

    const qTokens = tokenize(cleanQuery);
    const qSet = new Set(qTokens);
    const totalDocs = Math.max(index.docs.length, 1);
    const graphByFile = new Map(index.graph.map((entry) => [entry.file, entry]));

    const scored = index.docs.map((doc) => {
      let score = fuzzyPathScore(doc.path, qTokens);
      for (const token of qSet) {
        const tf = doc.counts.get(token) || 0;
        if (!tf) continue;
        const idf = Math.log(1 + totalDocs / (1 + (index.df.get(token) || 0)));
        score += (tf / doc.tokenCount) * idf * 1300;
      }

      const lower = doc.content.toLowerCase();
      const phrase = cleanQuery.toLowerCase();
      if (lower.includes(phrase)) score += 18;

      const graph = graphByFile.get(doc.path);
      for (const token of qSet) {
        if (graph?.symbols?.some((symbol) => symbol.toLowerCase() === token)) score += 20;
        else if (graph?.symbols?.some((symbol) => symbol.toLowerCase().includes(token))) score += 10;
      }

      return { doc, score };
    })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path))
      .slice(0, Math.max(1, Math.min(limit, 20)));

    const results = scored.map(({ doc, score }) => ({
      path: doc.path,
      score: Number(score.toFixed(3)),
      snippet: formatSnippet(doc.content, cleanQuery),
    }));

    return {
      ok: true,
      mode: "search",
      query: cleanQuery,
      count: results.length,
      results,
    };
  }

  return {
    resolveWorkspaceTarget,
    invalidate,
    listProjectFiles,
    buildWorkspaceIndex,
    searchWorkspaceIndex,
    findWorkspaceFiles,
    takeLimited,
  };
}

module.exports = {
  createWorkspaceSearch,
};
