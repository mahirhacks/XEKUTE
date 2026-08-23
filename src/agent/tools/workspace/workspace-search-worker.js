"use strict";

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const {
  root,
  query,
  limit,
  batchSize,
  maxResults,
  maxFiles,
  maxFileBytes,
  skipDirs,
} = workerData;

const skipped = new Set(skipDirs);
const needle = String(query).toLowerCase();
let batch = [];
let totalCount = 0;
let emittedCount = 0;
let filesScanned = 0;
let capped = false;

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
    payload: { results: batch, totalCount, filesScanned },
  });
  batch = [];
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
