"use strict";

/* Bounded context extraction for the workspace runtime. */

const fs = require("node:fs");
const path = require("node:path");

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

function csvRows(raw, delimiter) {
  return raw.split(/\r?\n/).slice(0, 2000).map((line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { cells.push(cell.replace(/\|/g, "\\|")); cell = ""; }
      else cell += char;
    }
    cells.push(cell.replace(/\|/g, "\\|"));
    return cells.join(" | ");
  });
}

function extract(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES) return { text: "", kind: "skipped: file exceeds 8 MB" };
  const suffix = path.extname(filePath).toLowerCase();
  try {
    let raw = fs.readFileSync(filePath, "utf8");
    if (suffix === ".json") raw = JSON.stringify(JSON.parse(raw), null, 2);
    else if ([".html", ".htm"].includes(suffix)) raw = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    else if (suffix === ".csv") raw = csvRows(raw, ",").join("\n");
    else if (suffix === ".tsv") raw = csvRows(raw, "\t").join("\n");
    else if ([".pdf", ".docx", ".xlsx", ".xlsm", ".pptx", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"].includes(suffix)) return { text: "", kind: `skipped: optional ${suffix.slice(1)} parser is not installed` };
    return { text: raw, kind: suffix.slice(1).toUpperCase() || "text" };
  } catch (error) {
    return { text: "", kind: `skipped: ${error.message}` };
  }
}

function buildContext({ output, files = [] }) {
  if (!output) throw new Error("Context output path is required");
  if (!Array.isArray(files) || !files.length) throw new Error("At least one context file is required");
  const sections = ["# Penetration Testing Context", "", "Generated from imported source material.", ""];
  let parsed = 0;
  for (const rawPath of files) {
    const filePath = path.resolve(String(rawPath));
    const result = extract(filePath);
    sections.push(`## ${path.basename(filePath)}`, "", `_Source: \`${filePath}\` · ${result.kind}_`, "");
    if (result.text.trim()) {
      sections.push("```text", result.text.trim().slice(0, MAX_TEXT_CHARS), "```", "");
      parsed += 1;
    } else sections.push(`> ${result.kind}`, "");
  }
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sections.join("\n"), "utf8");
  return { ok: true, parsed, total: files.length, output: target };
}

module.exports = { extract, buildContext, MAX_FILE_BYTES, MAX_TEXT_CHARS };
