"use strict";

const crypto = require("node:crypto");

function parseRawHttp(raw) {
  const text = String(raw || "").slice(0, 500000);
  const split = text.indexOf("\n\n");
  const head = split >= 0 ? text.slice(0, split) : text;
  const body = split >= 0 ? text.slice(split + 2) : "";
  const lines = head.split(/\r?\n/);
  const start = lines.shift() || "";
  const headers = Object.fromEntries(lines.map((line) => { const index = line.indexOf(":"); return index > 0 ? [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()] : null; }).filter(Boolean));
  return { start, headers, body };
}

function createTrafficPort({ assessmentWorkspace } = {}) {
  async function execute(input, context) {
    const content = String(input.content || "").slice(0, 500000);
    if (!content && !input.artifact_id) return { ok: false, error: "Traffic content or artifact reference is required.", code: "TRAFFIC_INPUT_REQUIRED" };
    const parsed = input.action === "raw_http" ? parseRawHttp(content) : { start: "", headers: {}, body: content };
    const requestId = `traffic-${crypto.randomUUID()}`;
    const record = { requestId, tool: "ingest_traffic", source: input.source || input.action, provenance: input.provenance || "model-visible-ingest", request: content.slice(0, 200000), method: parsed.start.split(/\s+/)[0] || "GET", url: parsed.headers.host ? `https://${parsed.headers.host}/` : "", statusCode: null, response: "", redacted: true };
    const stored = assessmentWorkspace?.appendTrafficRecord?.(context.workspace, record);
    if (stored?.error) return stored;
    return { ok: true, request_id: requestId, artifact_refs: [stored?.evidence?.id || requestId], provenance: record.provenance, truncated: content.length >= 500000 };
  }
  return Object.freeze({ execute });
}

module.exports = { parseRawHttp, createTrafficPort };
