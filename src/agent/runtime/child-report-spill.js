"use strict";

// A delegated child returns a bounded summary. When its report is longer than
// that bound, the full text is written to the workspace so the parent can read
// the rest with read_file instead of losing it to truncation.

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { redactSecrets } = require("../../shared/secret-redaction.js");

const REPORT_DIRECTORY = [".xekute", "delegated"];
const MAX_REPORT_CHARS = 400_000;

function safeFileName(id) {
  const name = String(id || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+/, "").slice(0, 80);
  return name || "child";
}

function spillChildReport({ workspace = "", childInvocationId = "", text = "", fsImpl = nodeFs, pathImpl = nodePath, redact = redactSecrets } = {}) {
  const root = String(workspace || "").trim();
  const body = String(text || "");
  if (!root || !body) return { ok: false, code: "CHILD_REPORT_NOT_SAVED", error: "No workspace or report text to save." };
  try {
    const directory = pathImpl.resolve(root, ...REPORT_DIRECTORY);
    const file = pathImpl.resolve(directory, `${safeFileName(childInvocationId)}.md`);
    const relative = pathImpl.relative(directory, file);
    if (relative.startsWith("..") || pathImpl.isAbsolute(relative)) return { ok: false, code: "CHILD_REPORT_NOT_SAVED", error: "The report path left the delegated report folder." };
    const clipped = body.length > MAX_REPORT_CHARS ? `${body.slice(0, MAX_REPORT_CHARS)}\n[report bounded by XEKUTE]` : body;
    fsImpl.mkdirSync(directory, { recursive: true });
    fsImpl.writeFileSync(file, `# Delegated report ${safeFileName(childInvocationId)}\n\n${redact(clipped)}\n`, "utf8");
    return { ok: true, relativePath: [...REPORT_DIRECTORY, pathImpl.basename(file)].join("/") };
  } catch (error) {
    return { ok: false, code: "CHILD_REPORT_NOT_SAVED", error: String(error?.message || error).slice(0, 300) };
  }
}

module.exports = { spillChildReport, REPORT_DIRECTORY, MAX_REPORT_CHARS };
