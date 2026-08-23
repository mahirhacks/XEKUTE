"use strict";

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const {
  parseAdvancedQuery,
  metadataOnlyQuery,
  extractStructuredItems,
  locateStructuredLine,
  deriveDocument,
  evaluateAst,
  resultForDocument,
  correlateAuthorization,
} = require("./advanced-search.js");

const {
  root,
  query,
  limit,
  batchSize,
  maxResults,
  maxFiles,
  maxFileBytes,
  structuredMaxFileBytes,
  skipDirs,
  advanced,
} = workerData;

const skipped = new Set(skipDirs);
const needle = String(query).toLowerCase();
let batch = [];
let totalCount = 0;
let emittedCount = 0;
let filesScanned = 0;
let capped = false;
let scanTruncated = false;
let skippedLargeFiles = 0;
const sourceCounts = {};

function compactLine(lineText, match) {
  const trimmed = String(lineText || "").trim();
  const index = trimmed.toLowerCase().indexOf(String(match || "").toLowerCase());
  const start = trimmed.length > 360 ? Math.max(0, index - 140) : 0;
  const end = Math.min(trimmed.length, start + 360);
  return `${start ? "…" : ""}${trimmed.slice(start, end)}${end < trimmed.length ? "…" : ""}`;
}

function flush() {
  if (!batch.length) return;
  parentPort.postMessage({
    type: "batch",
    payload: { results: batch, totalCount, filesScanned, sourceCounts: { ...sourceCounts }, advanced: Boolean(advanced) },
  });
  batch = [];
}

function readJson(relative) {
  try { return JSON.parse(fs.readFileSync(path.join(root, ...relative.split("/")), "utf8")); }
  catch { return null; }
}

function createScopeDecision() {
  const inside = readJson("scope/in-scope.json") || {};
  const outside = readJson("scope/out-of-scope.json") || {};
  const targets = Array.isArray(inside.targets) ? inside.targets : [];
  const wildcardRules = Array.isArray(inside.wildcardRules) ? inside.wildcardRules : [];
  const excludedTargets = Array.isArray(outside.assets) ? outside.assets : [];
  if (!targets.length && !wildcardRules.length && !excludedTargets.length) return null;
  // This mirrors saved scope strings for search metadata only. Execution
  // authorization remains centralized in the authority pipeline.
  const targetText = (entry) => String(entry?.value || entry?.target || entry?.host || entry?.url || entry?.pattern || entry || "").trim().toLowerCase();
  const included = [...targets, ...wildcardRules].map(targetText).filter(Boolean);
  const excluded = excludedTargets.map(targetText).filter(Boolean);
  const matches = (candidate, pattern) => {
    const clean = pattern.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
    return candidate === pattern || candidate.includes(pattern) || Boolean(clean && (candidate === clean || candidate.endsWith(`.${clean}`) || candidate.includes(`://${clean}`)));
  };
  return (target) => {
    if (!target) return undefined;
    const value = String(target).toLowerCase();
    if (excluded.some((entry) => matches(value, entry))) return false;
    return included.some((entry) => matches(value, entry));
  };
}

function emitAdvancedResult(result) {
  if (totalCount >= maxResults) { capped = true; return; }
  totalCount += 1;
  const source = result.source || "workspace";
  sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  if (emittedCount < limit) {
    batch.push(result);
    emittedCount += 1;
    if (batch.length >= batchSize) flush();
  }
}

function advancedSearch() {
  const parsedQuery = parseAdvancedQuery(query);
  if (!parsedQuery.ok) {
    parentPort.postMessage({ type: "done", payload: {
      ok: false,
      error: parsedQuery.error,
      code: parsedQuery.code,
      position: parsedQuery.position,
      mode: "advanced",
      query,
      count: 0,
      totalCount: 0,
      filesScanned: 0,
      sourceCounts: {},
      cancelled: false,
    } });
    return;
  }

  const scopeDecision = createScopeDecision();
  const metadataOnly = metadataOnlyQuery(parsedQuery.ast);
  const correlationDocuments = [];
  const metadataFilterFields = new Set(["path", "file", "ext", "size", "after", "before", "source"]);

  function requiredMetadataFilters(node, allow = true) {
    if (!node || !allow) return [];
    if (node.type === "and") return [...requiredMetadataFilters(node.left, true), ...requiredMetadataFilters(node.right, true)];
    if (node.type === "field" && metadataFilterFields.has(node.field)) return [node];
    return [];
  }

  const metadataFilters = requiredMetadataFilters(parsedQuery.ast);

  function passesMetadataFilters(relative, stat) {
    const normalized = String(relative).replace(/\\/g, "/");
    if (parsedQuery.options.correlation) {
      const trafficEvidence = /(?:^|\/)traffic\/(?!artifacts\/|graph\/).*\.jsonl?$/i.test(normalized)
        || /(?:^|\/)evidence\/.*\.jsonl$/i.test(normalized)
        || /\.har$/i.test(normalized);
      if (!trafficEvidence) return false;
    }
    if (!metadataFilters.length) return true;
    const document = deriveDocument({ relativePath: normalized, content: "", stat, scopeDecision, options: parsedQuery.options });
    const structured = /\.(?:json|jsonl|har)$/i.test(normalized);
    return metadataFilters.every((filter) => structured && ["after", "before"].includes(filter.field)
      ? true
      : evaluateAst(filter, document, parsedQuery.options));
  }

  function entryPriority(directory, entry) {
    if (!entry.isDirectory()) return 50;
    const relative = path.relative(root, path.join(directory, entry.name)).replace(/\\/g, "/").toLowerCase();
    const sources = (parsedQuery.fields.source || []).map((value) => String(value).toLowerCase());
    if (parsedQuery.options.correlation && relative === "traffic") return 0;
    if (sources.includes("traffic") && relative === "traffic") return 0;
    if ((sources.includes("finding") || sources.includes("findings")) && /^(?:findings|vulnerability-scans|\.xekute\/findings)$/.test(relative)) return 0;
    if ((sources.includes("evidence")) && relative === "evidence") return 0;
    if ((sources.includes("map")) && /^(?:map|traffic)$/.test(relative)) return 0;
    if ((sources.includes("javascript") || sources.includes("js")) && relative === "traffic") return 1;
    return 20;
  }

  function acceptDocument(document, lines, baseLine = 1) {
    if (!evaluateAst(parsedQuery.ast, document, parsedQuery.options)) return;
    if (parsedQuery.options.correlation) {
      if (document.http?.isHttp) correlationDocuments.push(document);
      return;
    }
    const result = resultForDocument(document, lines, parsedQuery);
    if (lines.length === 1 && baseLine > 1) {
      result.line = baseLine;
      result.snippet = `${baseLine}: ${result.lineText}`;
    }
    emitAdvancedResult(result);
  }

  function processFile(full, relative, stat) {
    const normalized = relative.replace(/\\/g, "/");
    const isJsonl = /\.jsonl$/i.test(normalized);
    const isLargeStructured = isJsonl || /\.har$/i.test(normalized);
    const allowedBytes = isLargeStructured ? Math.max(maxFileBytes, Number(structuredMaxFileBytes) || maxFileBytes) : maxFileBytes;
    if (stat.size > allowedBytes) {
      skippedLargeFiles += 1;
      scanTruncated = true;
      return;
    }
    let buffer;
    try { buffer = fs.readFileSync(full); } catch { return; }
    if (buffer.includes(0)) return;
    const content = buffer.toString("utf8").replace(/\r\n/g, "\n");
    const lines = content.split("\n");

    if (isJsonl) {
      for (let lineIndex = 0; lineIndex < lines.length && !capped; lineIndex += 1) {
        const lineText = lines[lineIndex];
        if (!lineText.trim()) continue;
        let record = null;
        try { record = JSON.parse(lineText); } catch { /* Search malformed JSONL as text. */ }
        const document = deriveDocument({
          relativePath: normalized,
          content: lineText,
          stat,
          record,
          line: lineIndex + 1,
          scopeDecision,
          options: parsedQuery.options,
        });
        acceptDocument(document, [lineText], lineIndex + 1);
      }
      return;
    }

    if (/\.(?:json|har)$/i.test(normalized)) {
      try {
        const parsed = JSON.parse(content);
        const items = extractStructuredItems(parsed, normalized);
        for (const record of items) {
          if (capped) break;
          const recordLine = locateStructuredLine(lines, record);
          const document = deriveDocument({
            relativePath: normalized,
            content: JSON.stringify(record),
            stat,
            record,
            line: recordLine,
            scopeDecision,
            options: parsedQuery.options,
          });
          acceptDocument(document, lines, 1);
        }
        return;
      } catch { /* Search malformed JSON as ordinary text. */ }
    }

    if (metadataOnly) {
      const document = deriveDocument({ relativePath: normalized, content: "", stat, scopeDecision, options: parsedQuery.options });
      acceptDocument(document, lines, 1);
      return;
    }
    for (let lineIndex = 0; lineIndex < lines.length && !capped; lineIndex += 1) {
      const lineText = lines[lineIndex];
      const document = deriveDocument({
        relativePath: normalized,
        content: lineText,
        stat,
        line: lineIndex + 1,
        scopeDecision,
        options: parsedQuery.options,
      });
      acceptDocument(document, [lineText], lineIndex + 1);
    }
  }

  function walkAdvanced(directory) {
    if (capped || filesScanned >= maxFiles) {
      if (filesScanned >= maxFiles) scanTruncated = true;
      return;
    }
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => entryPriority(directory, a) - entryPriority(directory, b) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (capped || filesScanned >= maxFiles) {
        if (filesScanned >= maxFiles) scanTruncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) walkAdvanced(full);
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned += 1;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const relative = path.relative(root, full);
      if (!passesMetadataFilters(relative, stat)) continue;
      processFile(full, relative, stat);
    }
  }

  walkAdvanced(root);
  if (parsedQuery.options.correlation && !capped) {
    const correlated = correlateAuthorization(correlationDocuments, parsedQuery, { limit: maxResults });
    for (const result of correlated.results) emitAdvancedResult(result);
    if (correlated.truncated) capped = true;
  }
  flush();
  parentPort.postMessage({ type: "done", payload: {
    ok: true,
    mode: "advanced",
    query,
    count: emittedCount,
    totalCount,
    filesScanned,
    truncated: capped || totalCount > emittedCount || scanTruncated,
    capped,
    scanTruncated,
    skippedLargeFiles,
    cancelled: false,
    sourceCounts,
    correlation: parsedQuery.options.correlation,
    operators: Object.keys(parsedQuery.fields),
  } });
}

function walk(directory) {
  if (capped || filesScanned >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (capped || filesScanned >= maxFiles) return;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    filesScanned += 1;

    let stat;
    let buffer;
    try {
      stat = fs.statSync(full);
      if (stat.size > maxFileBytes) continue;
      buffer = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;

    const rel = path.relative(root, full).replace(/\\/g, "/");
    const lines = buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    for (let lineIndex = 0; lineIndex < lines.length && !capped; lineIndex += 1) {
      const lineText = lines[lineIndex];
      const comparable = lineText.toLowerCase();
      let from = 0;
      while (from <= comparable.length - needle.length) {
        const columnIndex = comparable.indexOf(needle, from);
        if (columnIndex === -1) break;
        if (totalCount >= maxResults) {
          capped = true;
          break;
        }
        const match = lineText.slice(columnIndex, columnIndex + query.length);
        totalCount += 1;
        if (emittedCount < limit) {
          const preview = compactLine(lineText, match);
          batch.push({
            path: rel,
            line: lineIndex + 1,
            column: columnIndex + 1,
            match,
            lineText: preview,
            snippet: `${lineIndex + 1}: ${preview}`,
          });
          emittedCount += 1;
          if (batch.length >= batchSize) flush();
        }
        from = columnIndex + Math.max(needle.length, 1);
      }
    }
  }
}

if (advanced) advancedSearch();
else {
  walk(root);
  flush();
  parentPort.postMessage({
    type: "done",
    payload: {
      ok: true,
      mode: "exact",
      query,
      count: emittedCount,
      totalCount,
      filesScanned,
      truncated: capped || totalCount > emittedCount || filesScanned >= maxFiles,
      capped,
      cancelled: false,
    },
  });
}
