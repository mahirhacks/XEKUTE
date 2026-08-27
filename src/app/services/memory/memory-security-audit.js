"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/memory-identity.js");
const { operationFailure, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const MEMORY_SECURITY_AUDIT_VERSION = 1;
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FINDINGS = 200;
const RAW_SECRET_KEY = /^(?:cookie|set[-_]?cookie|authorization|proxy[-_]?authorization|access[-_]?token|refresh[-_]?token|csrf[-_]?token|bearer[-_]?token|private[-_]?key|client[-_]?private[-_]?key|passphrase|password|secret(?:[-_]?value)?|raw[-_]?value|credential(?:s)?)$/i;
const RAW_SECRET_TEXT = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/_=.-]{12,}/i,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]{4,}/i,
  /\b(?:access[_-]?token|refresh[_-]?token|csrf[_-]?token|api[_-]?key|password|passphrase|secret)\s*[:=]\s*["']?[^\s,;"']{4,}/i,
];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function hash(crypto, value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function issue(findings, code, path, source = "memory", details = {}) {
  if (findings.length >= MAX_FINDINGS) return;
  findings.push({ code, source: text(source, 240), path: text(path, 1_000), details: clone(details) });
}

function scanValue(value, { source = "value", path = "$", projectId = "", findings = [], maxDepth = 14, encryptedEnvelope = false, crypto = nodeCrypto } = {}, depth = 0, seen = new WeakSet()) {
  if (findings.length >= MAX_FINDINGS) return findings;
  if (depth > maxDepth) {
    issue(findings, "MEMORY_SECURITY_VALUE_TOO_DEEP", path, source);
    return findings;
  }
  if (typeof value === "string") {
    for (const pattern of RAW_SECRET_TEXT) {
      if (pattern.test(value)) {
        issue(findings, "MEMORY_SECRET_VALUE_DETECTED", path, source, { value_hash: hash(crypto, value).slice(0, 16) });
        break;
      }
    }
    return findings;
  }
  if (value === null || typeof value !== "object") return findings;
  if (seen.has(value)) return findings;
  seen.add(value);
  if (Array.isArray(value)) {
    value.slice(0, 2_000).forEach((child, index) => scanValue(child, { source, path: `${path}[${index}]`, projectId, findings, maxDepth, encryptedEnvelope, crypto }, depth + 1, seen));
    return findings;
  }
  const encrypted = value.encrypted === true && typeof value.payload === "string";
  for (const [key, child] of Object.entries(value).slice(0, 2_000)) {
    const childPath = `${path}.${key}`;
    if (RAW_SECRET_KEY.test(key)) {
      issue(findings, "MEMORY_SECRET_FIELD_DETECTED", childPath, source, { field: text(key, 120) });
      continue;
    }
    if (encrypted && key === "payload") continue;
    if (/^(?:project_id|projectId)$/.test(key) && projectId && String(child) !== projectId) {
      issue(findings, "MEMORY_PROJECT_ISOLATION_VIOLATION", childPath, source, { expected_project_id: projectId });
      continue;
    }
    scanValue(child, { source, path: childPath, projectId, findings, maxDepth, encryptedEnvelope: encryptedEnvelope || encrypted, crypto }, depth + 1, seen);
  }
  return findings;
}

function walkFiles(fs, path, root, limit = MAX_FILES) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const visit = (current) => {
    if (result.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (result.length >= limit) break;
      const target = path.join(current, entry.name);
      let stat;
      try { stat = fs.lstatSync(target); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) result.push(target);
    }
  };
  visit(root);
  return result;
}

function scanTextFile(fs, target, relative, projectId, findings, warnings, crypto = nodeCrypto) {
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    warnings.push({ code: "MEMORY_SECURITY_STAT_FAILED", path: relative, message: text(error.message, 500) });
    return false;
  }
  if (stat.size > MAX_FILE_BYTES) {
    warnings.push({ code: "MEMORY_SECURITY_FILE_TOO_LARGE", path: relative, bytes: stat.size });
    return false;
  }
  let raw;
  try { raw = fs.readFileSync(target, "utf8"); } catch (error) {
    warnings.push({ code: "MEMORY_SECURITY_READ_FAILED", path: relative, message: text(error.message, 500) });
    return false;
  }
  const isSqlite = pathExtension(relative) === ".sqlite";
  if (isSqlite) {
    // The derived index is not authoritative. Scan its textual byte content
    // for obvious leaks, while avoiding a lossy attempt to parse SQLite.
    for (const pattern of RAW_SECRET_TEXT) {
      if (pattern.test(raw)) {
        issue(findings, "MEMORY_SECRET_VALUE_DETECTED", relative, "derived_sqlite", { content_hash: hash(crypto, raw).slice(0, 16) });
        break;
      }
    }
    return true;
  }
  let parsed = false;
  try {
    if (relative.toLowerCase().endsWith(".jsonl")) {
      for (const [index, line] of raw.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try {
          scanValue(JSON.parse(line), { source: "persisted_memory", path: `${relative}#${index + 1}`, projectId, findings, crypto });
          parsed = true;
        } catch {
          issue(findings, "MEMORY_SECURITY_UNPARSEABLE_RECORD", `${relative}#${index + 1}`, "persisted_memory");
        }
      }
    } else {
      scanValue(JSON.parse(raw), { source: "persisted_memory", path: relative, projectId, findings, crypto });
      parsed = true;
    }
  } catch {
    // Textual legacy compatibility fields can be non-JSON. They still need
    // the same raw-value check, but the scanner deliberately reports only the
    // path and a hash, never the offending value.
    for (const pattern of RAW_SECRET_TEXT) {
      if (pattern.test(raw)) {
        issue(findings, "MEMORY_SECRET_VALUE_DETECTED", relative, "persisted_memory", { content_hash: hash(crypto, raw).slice(0, 16) });
        break;
      }
    }
  }
  return parsed;
}

function pathExtension(value) {
  const normalized = String(value || "").toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

function createMemorySecurityAudit({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  projectIdentityStore = null,
  sensitiveWorkingMemory = null,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory security audit dependencies are required.");

  function auditValues(values = [], projectId = "") {
    const findings = [];
    const warnings = [];
    for (const [index, value] of (Array.isArray(values) ? values : [values]).entries()) {
      scanValue(value, { source: "runtime_output", path: `$[${index}]`, projectId, findings, crypto });
    }
    return { findings, warnings };
  }

  function resolveScope(workspace, requestedProjectId = "") {
    const root = resolvedWorkspace(path, workspace);
    let projectId = String(requestedProjectId || "").trim();
    if (projectId) projectId = assertMemoryId(projectId, "proj");
    if (projectIdentityStore?.resolveProject) {
      const resolved = projectIdentityStore.resolveProject(root, { persist: false, projectId });
      if (!resolved?.ok) return resolved;
      if (projectId && resolved.projectId !== projectId) return operationFailure("MEMORY_PROJECT_MISMATCH", "The security audit project does not match the protected project registry.", { expectedProjectId: projectId, actualProjectId: resolved.projectId });
      projectId = String(resolved.projectId || projectId || "");
    }
    return { ok: true, workspace: root, projectId };
  }

  function auditWorkspace(input = {}) {
    let scope;
    try { scope = resolveScope(input.workspace, input.projectId || input.project_id); } catch (error) { return operationFailure(error.code || "MEMORY_SECURITY_AUDIT_INPUT_INVALID", error.message, error.details || {}); }
    if (!scope?.ok) return scope;
    const findings = [];
    const warnings = [];
    const memoryRoot = path.join(scope.workspace, ".xekute", "memory");
    const includeLegacy = input.includeLegacyCompatibility === true;
    const roots = [memoryRoot];
    if (includeLegacy) roots.push(path.join(scope.workspace, ".xekute", "context"));
    const scanned = [];
    for (const root of roots) {
      for (const target of walkFiles(fs, path, root)) {
        const relative = path.relative(scope.workspace, target).replace(/\\/g, "/");
        scanTextFile(fs, target, relative, scope.projectId, findings, warnings, crypto);
        scanned.push(relative);
      }
    }
    const runtime = auditValues(input.values || input.records || [], scope.projectId);
    findings.push(...runtime.findings.slice(0, Math.max(0, MAX_FINDINGS - findings.length)));
    warnings.push(...runtime.warnings);
    let sensitive = null;
    if (sensitiveWorkingMemory?.status && scope.projectId) {
      sensitive = sensitiveWorkingMemory.status({ projectId: scope.projectId });
      if (sensitive?.ok === false) warnings.push({ code: sensitive.code, message: "Sensitive Working Memory status could not be inspected." });
      if (sensitive?.ok && sensitive.persisted && sensitive.secureStorageAvailable !== true) {
        issue(findings, "MEMORY_SENSITIVE_PLAINTEXT_RISK", "sensitive-working-memory", "sensitive_store");
      }
    }
    const isolationFindings = findings.filter((finding) => finding.code === "MEMORY_PROJECT_ISOLATION_VIOLATION");
    const secretFindings = findings.filter((finding) => finding.code.startsWith("MEMORY_SECRET_") || finding.code === "MEMORY_SENSITIVE_PLAINTEXT_RISK");
    return {
      ok: findings.length === 0,
      version: MEMORY_SECURITY_AUDIT_VERSION,
      project_id: scope.projectId,
      workspace: scope.workspace,
      generated_at: timestamp(now),
      checks: {
        project_isolation: isolationFindings.length === 0,
        secret_containment: secretFindings.length === 0,
        sensitive_store_protection: !sensitive || sensitive.ok === false ? sensitive?.ok !== false : sensitive.persisted ? sensitive.secureStorageAvailable === true : true,
      },
      scanned_files: scanned,
      scanned_file_count: scanned.length,
      findings: findings.slice(0, MAX_FINDINGS),
      warnings: warnings.slice(0, 200),
      truncated: findings.length > MAX_FINDINGS || scanned.length >= MAX_FILES,
    };
  }

  function scan(input = {}) {
    const runtime = auditValues(input.values || input.records || [input.value], input.projectId || input.project_id || "");
    return { ok: runtime.findings.length === 0, version: MEMORY_SECURITY_AUDIT_VERSION, findings: runtime.findings, warnings: runtime.warnings };
  }

  return Object.freeze({ MEMORY_SECURITY_AUDIT_VERSION, scan, auditValues, auditWorkspace });
}

module.exports = Object.freeze({ MEMORY_SECURITY_AUDIT_VERSION, MAX_FILES, MAX_FILE_BYTES, scanValue, createMemorySecurityAudit });
