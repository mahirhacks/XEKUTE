"use strict";

const crypto = require("node:crypto");

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex")}`;
}

function parseResponse(raw = "") {
  const text = String(raw || "").slice(0, 1000000);
  const split = text.indexOf("\n\n");
  const head = split >= 0 ? text.slice(0, split) : text;
  const body = split >= 0 ? text.slice(split + 2) : "";
  const status = Number(head.match(/^HTTP\/\S+\s+(\d{3})/)?.[1]) || null;
  const headers = Object.fromEntries(head.split(/\r?\n/).slice(1).map((line) => { const i = line.indexOf(":"); return i > 0 ? [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()] : null; }).filter(Boolean));
  return { status, headers, body, fingerprint: fingerprint(body) };
}

function createResponsePort({ evidenceStore = null } = {}) {
  async function execute(input, context) {
    const baseline = typeof evidenceStore?.get === "function" ? await evidenceStore.get(context.workspace, input.baseline_id) : null;
    const mutated = typeof evidenceStore?.get === "function" ? await evidenceStore.get(context.workspace, input.mutated_id) : null;
    if (!baseline || !mutated) return { ok: false, error: "Both immutable response evidence references are required.", code: "EVIDENCE_NOT_FOUND" };
    const left = parseResponse(baseline.response || baseline.content);
    const right = parseResponse(mutated.response || mutated.content);
    const differences = [];
    if (left.status !== right.status) differences.push({ signal: "status", baseline: left.status, mutated: right.status });
    if (left.fingerprint !== right.fingerprint) differences.push({ signal: "content_fingerprint", baseline: left.fingerprint, mutated: right.fingerprint });
    for (const header of ["location", "content-type", "www-authenticate"]) if (left.headers[header] !== right.headers[header]) differences.push({ signal: `header:${header}`, baseline: left.headers[header] || "", mutated: right.headers[header] || "" });
    return { ok: true, differences: differences.slice(0, input.max_differences || 50), baseline_status: left.status, mutated_status: right.status, baseline_fingerprint: left.fingerprint, mutated_fingerprint: right.fingerprint, evidence_refs: [input.baseline_id, input.mutated_id] };
  }
  return Object.freeze({ execute, fingerprint, parseResponse });
}

module.exports = { fingerprint, parseResponse, createResponsePort };
