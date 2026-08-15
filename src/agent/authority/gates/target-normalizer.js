"use strict";

const path = require("node:path");

const FILE_KEYS = new Set(["path", "file", "cwd", "directory", "workspacepath", "paths", "files"]);
const NETWORK_KEYS = new Set(["url", "target", "host", "domain", "endpoint", "origin", "ip", "urls", "targets"]);
const IDENTITY_KEYS = new Set(["identityid", "accountid", "sessionid", "pageid"]);
const PROCESS_KEYS = new Set(["process_id", "processid", "pid"]);

function readPath(value, expression) {
  const segments = String(expression || "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cursor = value;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function flatten(value, output = []) {
  if (typeof value === "string" && value.trim()) output.push(value.trim());
  else if (Array.isArray(value)) for (const item of value) flatten(item, output);
  return output;
}

function normalizeNetwork(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(candidate);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
    parsed.hash = "";
    return parsed.toString();
  } catch { return text.toLowerCase(); }
}

function normalizeTarget(type, value, workspaceRoot = "") {
  const key = String(type || "").toLowerCase();
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (FILE_KEYS.has(key)) {
    const root = path.resolve(workspaceRoot || process.cwd());
    return { kind: "file", type: key, raw, value: path.resolve(root, raw) };
  }
  if (NETWORK_KEYS.has(key)) return { kind: "network", type: key, raw, value: normalizeNetwork(raw) };
  if (IDENTITY_KEYS.has(key)) return { kind: key.includes("page") ? "browser-page" : "identity", type: key, raw, value: raw };
  if (PROCESS_KEYS.has(key)) return { kind: "process", type: key, raw, value: raw.toLowerCase() };
  return { kind: "resource", type: key || "target", raw, value: raw };
}

function collectTargets(args = {}, metadata = {}, workspaceRoot = "") {
  const candidates = [];
  const directKeys = new Set([...FILE_KEYS, ...NETWORK_KEYS, ...IDENTITY_KEYS, ...PROCESS_KEYS]);
  function visit(value, prefix = "", depth = 0) {
    if (!value || typeof value !== "object" || depth > 6) return;
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (directKeys.has(lower)) for (const item of flatten(child)) candidates.push([lower, item]);
      if (child && typeof child === "object") visit(child, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
  }
  visit(args);
  for (const expression of Array.isArray(metadata.targetArguments) ? metadata.targetArguments : []) {
    const type = String(expression).split(".").at(-1).replace(/\[\d+\]/g, "").toLowerCase();
    for (const item of flatten(readPath(args, expression))) candidates.push([type, item]);
  }
  const seen = new Set();
  const targets = [];
  for (const [type, value] of candidates) {
    const normalized = normalizeTarget(type, value, workspaceRoot);
    if (!normalized) continue;
    const key = `${normalized.kind}:${normalized.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(normalized);
    if (targets.length >= 200) break;
  }
  return targets;
}

module.exports = { collectTargets, flatten, normalizeNetwork, normalizeTarget, readPath };
