"use strict";

const crypto = require("node:crypto");
const Artifacts = require("../artifacts/investigation-artifacts.js");

const ASSESSMENT_VERSION = 5;
const ASSESSMENT_ITEM_FILES = Object.freeze({
  "active-recon": "recon/active-recon.json", "passive-recon": "recon/passive-recon.json",
  endpoints: "enumeration/endpoints.json", pages: "enumeration/pages.json", subdomains: "enumeration/subdomains.json", assets: "enumeration/assets.json",
  "raw-traffic": "traffic/raw.jsonl", "filtered-traffic": "traffic/filtered.jsonl", runs: "runs/runs.json", report: "report/report.md",
  "agent-actions": ".xekute/logs/agent-actions.jsonl", "project-info": Artifacts.PATHS.projectIndex,
  hypotheses: Artifacts.PATHS.hypotheses, "investigation-checklist": Artifacts.PATHS.checklist, evidence: Artifacts.PATHS.evidenceIndex,
  "agent-runs": ".xekute/logs/agent-runs.jsonl", "tool-output": ".xekute/logs/tool-output.jsonl",
});
const REQUIRED_DIRECTORIES = Object.freeze([
  "recon", "enumeration", "traffic", "runs", "report", "context/sources", "evidence", "custom", "custom_scripts", "tools", "Map", "WebClone",
  ".xekute", ".xekute/project_info", ".xekute/evidence", ".xekute/logs", ".xekute/.internal", ".xekute/.internal/transactions",
]);
const RESERVED_ASSESSMENT_NAMES = new Set([
  ...REQUIRED_DIRECTORIES.flatMap((item) => item.split("/")), ...Object.values(ASSESSMENT_ITEM_FILES).flatMap((item) => item.split("/")),
].map((item) => item.toLowerCase()));

const RECON_RUN_TEMPLATE = { id: "", startedAt: "", completedAt: "", operator: "", tool: "", toolVersion: "", commandReference: "", sourceIp: "", targetIds: [], status: "not-started", requestsSent: 0, rateLimitPerSecond: null, outputFiles: [], errors: [], notes: "" };
const EVIDENCE_REFERENCE_TEMPLATE = { id: "", type: "request-response", title: "", filePath: "", capturedAt: "", capturedBy: "", sha256: "", redacted: false, notes: "" };
const RUN_TEMPLATE = { id: "", type: "assessment", status: "planned", profile: "agent", operator: "", createdAt: "", startedAt: "", completedAt: "", scopeSnapshotSha256: "", configurationSnapshotSha256: "", toolVersions: {}, approvedBy: "", approvalReference: "", stopReason: "", actions: [], hypotheses: [], checklistIds: [], evidenceIds: [], coverage: { tested: 0, passed: 0, failed: 0, blocked: 0, notApplicable: 0 }, notes: "" };

const JSON_TEMPLATES = Object.freeze({
  "recon/active-recon.json": { schemaVersion: ASSESSMENT_VERSION, authorizationRequired: true, runTemplate: RECON_RUN_TEMPLATE, runs: [], techniques: [], discoveredAssetTemplate: { targetId: "", type: "", value: "", source: "", discoveredAt: "", confidence: "", inScope: null, notes: "" }, discoveredAssets: [], evidenceTemplate: EVIDENCE_REFERENCE_TEMPLATE, evidence: [] },
  "recon/passive-recon.json": { schemaVersion: ASSESSMENT_VERSION, authorizationRequired: false, runTemplate: RECON_RUN_TEMPLATE, runs: [], sources: [], sourceTemplate: { name: "", type: "", url: "", queriedAt: "", terms: [], reliability: "", notes: "" }, discoveredAssetTemplate: { targetId: "", type: "", value: "", source: "", firstSeen: "", lastSeen: "", confidence: "", inScope: null, notes: "" }, discoveredAssets: [], evidenceTemplate: EVIDENCE_REFERENCE_TEMPLATE, evidence: [] },
  "enumeration/assets.json": { schemaVersion: ASSESSMENT_VERSION, assetTemplate: { id: "", assetType: "host", value: "", rootDomain: "", owner: "", environment: "production", source: "", firstSeen: "", lastSeen: "", inScope: null, scopeReason: "", status: "unknown", services: [], relationships: [], confidence: "unconfirmed", evidence: [], tags: [], notes: "" }, assets: [], relationships: [], statistics: { total: 0, inScope: 0, outOfScope: 0, unknownScope: 0, live: 0, stale: 0, untested: 0 }, lastReconciledAt: "", reconciliationNotes: [] },
  "enumeration/endpoints.json": { schemaVersion: ASSESSMENT_VERSION, endpointTemplate: { id: "", targetId: "", method: "GET", scheme: "https", host: "", port: 443, path: "", url: "", parameters: [], headers: {}, requestContentTypes: [], responseContentTypes: [], authentication: "unknown", authorizationRoles: [], statusCodes: [], technologies: [], discoveredBy: "", firstSeen: "", lastSeen: "", deprecated: false, tested: false, evidence: [], notes: "", tags: [] }, parameterTemplate: { name: "", location: "query", dataType: "string", required: false, exampleRedacted: "", observedValues: [], notes: "" }, endpoints: [], statistics: { total: 0, authenticated: 0, unauthenticated: 0, tested: 0, untested: 0 } },
  "enumeration/pages.json": { schemaVersion: ASSESSMENT_VERSION, pageTemplate: { id: "", targetId: "", url: "", path: "", title: "", statusCode: null, contentType: "", contentLength: null, authentication: "unknown", roles: [], technologies: [], forms: [], scripts: [], apiCalls: [], parameters: [], securityHeaders: {}, cacheControls: {}, discoveredBy: "", firstSeen: "", lastSeen: "", screenshotPath: "", tested: false, evidence: [], notes: "", tags: [] }, pages: [], statistics: { total: 0, authenticated: 0, unauthenticated: 0, tested: 0, untested: 0 } },
  "enumeration/subdomains.json": { schemaVersion: ASSESSMENT_VERSION, subdomainTemplate: { id: "", targetId: "", hostname: "", rootDomain: "", inScope: null, source: "", firstSeen: "", lastSeen: "", dns: { a: [], aaaa: [], cname: [], mx: [], ns: [], txt: [] }, resolvedIps: [], httpStatus: null, httpsStatus: null, title: "", technologies: [], cdn: "", cloudProvider: "", takeoverStatus: "not-checked", takeoverEvidence: [], live: null, tested: false, notes: "", tags: [] }, subdomains: [], statistics: { total: 0, live: 0, inScope: 0, takeoverCandidates: 0, tested: 0 } },
  "runs/runs.json": { schemaVersion: ASSESSMENT_VERSION, runTemplate: RUN_TEMPLATE, activeRunId: "", runs: [], defaults: { profile: "agent", retainToolOutput: true }, statistics: { total: 0, planned: 0, running: 0, paused: 0, completed: 0, stopped: 0, failed: 0 } },
});
const JSONL_TEMPLATES = Object.freeze({
  "traffic/raw.jsonl": { recordType: "xekute-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "direction", "protocol", "method", "url", "statusCode", "headers", "request", "response", "durationMs", "source", "tags"] },
  "traffic/filtered.jsonl": { recordType: "xekute-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "filterReason", "method", "url", "statusCode", "parameterNames", "contentType", "evidenceFiles", "notes", "tags"] },
  ".xekute/logs/agent-actions.jsonl": { recordType: "xekute-agent-action-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "type", "timestamp", "profile", "phase", "tool", "target", "risk", "allowed", "reason", "ok", "errorCode", "output", "claim"] },
  ".xekute/logs/agent-runs.jsonl": { recordType: "xekute-agent-run-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "type", "timestamp", "profile", "status", "scopeSnapshotSha256", "configurationSnapshotSha256", "approvedBy", "approvalReference", "stopReason"] },
  ".xekute/logs/tool-output.jsonl": { recordType: "xekute-tool-output-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "timestamp", "tool", "version", "command", "target", "exitCode", "outputPath", "sha256", "redacted", "truncated"] },
});
const REPORT_TEMPLATE = "# Security Assessment Report\n\n## Engagement and Scope\n\n## Executive Summary\n\n## Attack Surface\n\n## Verified Evidence\n\n## Investigation Coverage\n\n## Limitations\n\n## Evidence Index\n";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sha256(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value ?? "")).digest("hex"); }
function formatTrafficTimestamp(date) { const pad = (value, width = 2) => String(value).padStart(width, "0"); return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(date.getMilliseconds(), 3)}`; }
function redactHttpMessage(value) { return String(value || ""); }
function redactTrafficRecord(record = {}) { return { ...record, redacted: false }; }

function httpHeaderValue(rawMessage, headerName) {
  const wanted = String(headerName || "").toLowerCase();
  for (const line of String(rawMessage || "").split(/\r?\n/).slice(1)) {
    if (!line.trim()) break;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toLowerCase() === wanted) return line.slice(separator + 1).trim();
  }
  return "";
}

function httpMessageBody(rawMessage) {
  const message = String(rawMessage || "");
  const match = message.match(/\r?\n\r?\n/);
  return match ? message.slice(match.index + match[0].length) : "";
}

function trafficRecordHasBodyParams(request) {
  const body = httpMessageBody(request).trim();
  if (!body) return false;
  const contentType = httpHeaderValue(request, "content-type").toLowerCase();
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("json") || contentType.includes("multipart/");
}

function trafficMimeLabel(contentType) {
  const subtype = String(contentType || "").split(";", 1)[0].toLowerCase().split("/").at(-1) || "";
  if (subtype === "html") return "HTML";
  if (subtype === "json") return "JSON";
  if (subtype.includes("javascript")) return "script";
  if (subtype === "plain") return "text";
  return subtype;
}

function summarizeTrafficRecord(record = {}) {
  const request = String(record.request || "");
  const response = String(record.response || "");
  let host = String(record.host || "");
  let requestPath = String(record.url || "");
  let hasParams = false;
  try {
    const url = new URL(record.url);
    host = host || url.origin;
    requestPath = `${url.pathname || "/"}${url.search || ""}`;
    hasParams = Boolean(url.search);
  } catch {
    host = host || httpHeaderValue(request, "host");
  }
  const contentType = String(record.contentType || record.requestContentType || httpHeaderValue(response, "content-type") || "").split(";", 1)[0];
  const statusMatch = response.match(/^HTTP\/\S+\s+(\d{3})/i);
  return {
    recordType: record.recordType || "http-exchange",
    requestId: record.requestId,
    url: record.url,
    method: record.method,
    statusCode: Number(record.statusCode) || Number(statusMatch?.[1]) || null,
    timestamp: record.timestamp,
    isoTimestamp: record.isoTimestamp,
    tool: record.tool,
    host,
    path: requestPath,
    hasParams: hasParams || trafficRecordHasBodyParams(request),
    contentType,
    mime: trafficMimeLabel(contentType),
    requestLength: Buffer.byteLength(request, "utf8"),
    responseLength: Buffer.byteLength(response, "utf8"),
    durationMs: record.durationMs,
  };
}

function validateCustomEntryPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/");
  if (parts[0]?.toLowerCase() !== "custom" || parts.length < 2) return { error: "Custom entries must stay inside Custom", code: "INVALID_CUSTOM_PATH" };
  for (const name of parts.slice(1)) {
    const lower = name.toLowerCase();
    if (!name || name === "." || name === "..") return { error: "File and folder names cannot be empty, '.' or '..'", code: "INVALID_NAME" };
    if (RESERVED_ASSESSMENT_NAMES.has(lower)) return { error: `“${name}” is reserved by the assessment workspace. Choose a different name.`, code: "RESERVED_NAME", name };
    if (/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return { error: `“${name}” is not a valid cross-platform file or folder name.`, code: "INVALID_NAME", name };
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) return { error: `“${name}” is reserved by Windows. Choose a different name.`, code: "RESERVED_NAME", name };
  }
  return { ok: true, normalized };
}

function collectSchemaIssues(actual, expected, prefix = "") {
  if (!isPlainObject(actual) || !isPlainObject(expected)) return [prefix || "$"];
  const issues = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)) { issues.push(field); continue; }
    const value = actual[key];
    if (isPlainObject(expectedValue)) issues.push(...collectSchemaIssues(value, expectedValue, field));
    else if (Array.isArray(expectedValue) && !Array.isArray(value)) issues.push(field);
    else if (expectedValue !== null && !Array.isArray(expectedValue) && typeof value !== typeof expectedValue) issues.push(field);
  }
  return issues;
}

function createAssessmentWorkspace({ fs, path, now = () => new Date(), projectArtifacts = null, projectProfileProvider = null } = {}) {
  function resolveRoot(rawRoot) {
    const value = String(rawRoot || "").trim();
    if (!value) return { error: "Missing assessment folder", code: "MISSING_PATH" };
    if (!path.isAbsolute(value)) return { error: "Assessment folder must be an absolute path", code: "INVALID_PATH" };
    const root = path.resolve(value);
    if (root === path.parse(root).root) return { error: "A drive or filesystem root cannot be used as an assessment folder", code: "UNSAFE_PATH" };
    return { root };
  }
  function atomicWrite(target, content) {
    const temporary = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    try { fs.renameSync(temporary, target); } catch { fs.copyFileSync(temporary, target); fs.rmSync(temporary, { force: true }); }
  }
  function atomicWriteJson(target, value) { atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`); }
  function expectedEntries() {
    return [
      ...REQUIRED_DIRECTORIES.map((relativePath) => ({ relativePath, type: "directory" })),
      ...Object.entries(JSON_TEMPLATES).map(([relativePath, template]) => ({ relativePath, type: "file", content: () => `${JSON.stringify(template, null, 2)}\n` })),
      ...Object.entries(JSONL_TEMPLATES).map(([relativePath, template]) => ({ relativePath, type: "file", content: () => `${JSON.stringify(template)}\n` })),
      { relativePath: "report/report.md", type: "file", content: () => REPORT_TEMPLATE },
      { relativePath: Artifacts.PATHS.gitignore, type: "file", content: Artifacts.gitignoreTemplate },
      ...Artifacts.PROJECT_DOCUMENTS.map((document) => ({ relativePath: document.path, type: "file", content: () => Artifacts.projectDocumentTemplate(document.id) })),
      { relativePath: Artifacts.PATHS.hypotheses, type: "file", content: Artifacts.hypothesesTemplate },
      { relativePath: Artifacts.PATHS.checklist, type: "file", content: Artifacts.checklistTemplate },
    ];
  }
  function entryStatus(root, entry) {
    const target = path.join(root, ...entry.relativePath.split("/"));
    if (!fs.existsSync(target)) return { ...entry, target, reason: "missing" };
    let stat; try { stat = fs.lstatSync(target); } catch { return { ...entry, target, reason: "unreadable" }; }
    return (entry.type === "directory" ? stat.isDirectory() : stat.isFile()) ? null : { ...entry, target, reason: "wrong_type" };
  }
  function schemaIssues(root) {
    const issues = [];
    for (const [relativePath, template] of Object.entries(JSON_TEMPLATES)) {
      const target = path.join(root, ...relativePath.split("/"));
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue;
      let parsed; try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch { issues.push({ path: relativePath, type: "file", reason: "invalid_json", fields: [] }); continue; }
      const fields = collectSchemaIssues(parsed, template); if (fields.length) issues.push({ path: relativePath, type: "file", reason: "missing_fields", fields });
    }
    return issues;
  }
  function artifactIssues(root) {
    const checks = [...Artifacts.PROJECT_DOCUMENTS.map((document) => [document.path, (text) => Artifacts.parseProjectDocument(document.id, text)]), [Artifacts.PATHS.hypotheses, Artifacts.parseHypotheses], [Artifacts.PATHS.checklist, Artifacts.parseChecklist]];
    const issues = [];
    for (const [relativePath, parser] of checks) {
      const file = path.join(root, ...relativePath.split("/")); if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
      const parsed = parser(fs.readFileSync(file, "utf8")); if (!parsed.ok) issues.push({ path: relativePath, type: "file", reason: "invalid_artifact", fields: [], code: parsed.code, message: parsed.error });
    }
    const directory = path.join(root, ...Artifacts.PATHS.evidenceDirectory.split("/"));
    if (fs.existsSync(directory)) for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^E-\d{4,}\.md$/i.test(entry.name)) continue;
      const parsed = Artifacts.parseEvidence(fs.readFileSync(path.join(directory, entry.name), "utf8"));
      if (!parsed.ok) issues.push({ path: `${Artifacts.PATHS.evidenceDirectory}/${entry.name}`, type: "file", reason: "invalid_artifact", fields: [], code: parsed.code, message: parsed.error });
    }
    return issues;
  }
  function verify(rawRoot) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved; const { root } = resolved;
    if (!fs.existsSync(root)) return { error: "Assessment folder does not exist", code: "NOT_FOUND", root };
    try { if (!fs.lstatSync(root).isDirectory()) return { error: "Assessment path is not a folder", code: "NOT_DIRECTORY", root }; } catch (error) { return { error: error.message, code: "UNREADABLE", root }; }
    const entries = expectedEntries();
    const structural = entries.map((entry) => entryStatus(root, entry)).filter(Boolean).map((entry) => ({ path: entry.relativePath, type: entry.type, reason: entry.reason, fields: [] }));
    const missing = [...structural, ...schemaIssues(root), ...artifactIssues(root)];
    return { ok: true, root, name: path.basename(root), schemaVersion: ASSESSMENT_VERSION, valid: missing.length === 0, expectedCount: entries.length, missingCount: missing.length, fileMissingCount: structural.filter((item) => item.reason === "missing").length, schemaIssueCount: missing.filter((item) => ["missing_fields", "invalid_json"].includes(item.reason)).length, missing };
  }
  function repair(rawRoot, { createRoot = false } = {}) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved; const { root } = resolved;
    try {
      if (!fs.existsSync(root)) { if (!createRoot) return { error: "Assessment folder does not exist", code: "NOT_FOUND", root }; fs.mkdirSync(root, { recursive: true }); }
      if (!fs.lstatSync(root).isDirectory()) return { error: "Assessment path is not a folder", code: "NOT_DIRECTORY", root };
      const created = [], blocked = [], entries = expectedEntries();
      for (const entry of entries.filter((item) => item.type === "directory")) { const status = entryStatus(root, entry); if (!status) continue; if (status.reason !== "missing") { blocked.push({ path: entry.relativePath, reason: status.reason }); continue; } fs.mkdirSync(status.target, { recursive: true }); created.push(entry.relativePath); }
      for (const entry of entries.filter((item) => item.type === "file")) { const status = entryStatus(root, entry); if (!status) continue; if (status.reason !== "missing") { blocked.push({ path: entry.relativePath, reason: status.reason }); continue; } fs.mkdirSync(path.dirname(status.target), { recursive: true }); fs.writeFileSync(status.target, entry.content(), { encoding: "utf8", flag: "wx" }); created.push(entry.relativePath); }
      return { ...verify(root), repaired: true, created, updated: [], blocked };
    } catch (error) { return { error: error.message, code: "REPAIR_FAILED", root }; }
  }
  function appendJsonl(root, relativePath, record, maxBytes = 1_500_000) {
    const serialized = JSON.stringify(record); if (Buffer.byteLength(serialized, "utf8") > maxBytes) return { error: "Record exceeds the configured evidence limit", code: "RECORD_TOO_LARGE" };
    const target = path.join(root, ...relativePath.split("/")); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.appendFileSync(target, `${serialized}\n`, "utf8"); return { ok: true, path: relativePath, record };
  }
  function appendEvidenceRecord(rawRoot, record = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification;
    const capturedAt = String(record.capturedAt || now().toISOString()), request = String(record.request || ""), response = String(record.response || ""), content = String(record.content || `${request}\n${response}`);
    const entry = { id: String(record.id || record.requestId || `evidence-${Date.now().toString(36)}`).slice(0, 160), type: String(record.type || "request-response"), title: String(record.title || record.url || "Captured evidence").slice(0, 300), capturedAt, capturedBy: String(record.capturedBy || record.tool || "XEKUTE").slice(0, 160), source: String(record.source || record.tool || "unknown").slice(0, 120), requestId: String(record.requestId || ""), targetId: String(record.targetId || ""), host: String(record.host || ""), url: String(record.url || "").slice(0, 2000), sha256: String(record.sha256 || sha256(content)), requestSha256: request ? sha256(request) : "", responseSha256: response ? sha256(response) : "", redacted: record.redacted !== false, redactionProfile: String(record.redactionProfile || "default"), filePath: String(record.filePath || ""), semanticEvidenceRefs: Array.isArray(record.semanticEvidenceRefs) ? record.semanticEvidenceRefs.map(String).slice(0, 50) : [], notes: String(record.notes || "").slice(0, 2000) };
    try { return appendJsonl(verification.root, "evidence/index.jsonl", entry); } catch (error) { return { error: error.message, code: "EVIDENCE_WRITE_FAILED" }; }
  }
  function readJsonl(rawRoot, relativePath, { limit = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification;
    const target = path.join(verification.root, ...String(relativePath || "").replace(/\\/g, "/").split("/")), boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 2000)), boundedBytes = Math.max(1024 * 1024, Math.min(Number(maxBytes) || 20 * 1024 * 1024, 50 * 1024 * 1024));
    try {
      if (!fs.existsSync(target)) return { ok: true, path: relativePath, records: [], invalidCount: 0, truncated: false };
      const size = fs.statSync(target).size, start = Math.max(0, size - boundedBytes), buffer = Buffer.alloc(size - start), descriptor = fs.openSync(target, "r"); try { fs.readSync(descriptor, buffer, 0, buffer.length, start); } finally { fs.closeSync(descriptor); }
      let text = buffer.toString("utf8"); if (start > 0) { const newline = text.indexOf("\n"); text = newline >= 0 ? text.slice(newline + 1) : ""; }
      const records = []; let invalidCount = 0; for (const line of text.split(/\r?\n/)) { if (!line.trim()) continue; try { records.push(JSON.parse(line)); } catch { invalidCount += 1; } }
      return { ok: true, path: relativePath, records: records.slice(-boundedLimit).reverse(), invalidCount, truncated: start > 0 || records.length > boundedLimit };
    } catch (error) { return { error: error.message, code: "JSONL_READ_FAILED" }; }
  }
  function appendTrafficRecord(rawRoot, record, { filtered = false } = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification; const date = now();
    const safeRecord = { recordType: "http-exchange", schemaVersion: ASSESSMENT_VERSION, timestamp: formatTrafficTimestamp(date), isoTimestamp: date.toISOString(), ...record, redacted: false }, serialized = JSON.stringify(safeRecord);
    if (Buffer.byteLength(serialized, "utf8") > 1_500_000) return { error: "Traffic record exceeds the 1500000 byte log limit", code: "RECORD_TOO_LARGE" };
    const relativePath = filtered ? "traffic/filtered.jsonl" : "traffic/raw.jsonl";
    try { fs.appendFileSync(path.join(verification.root, ...relativePath.split("/")), `${serialized}\n`, "utf8"); return { ok: true, path: relativePath, timestamp: safeRecord.timestamp, record: safeRecord }; } catch (error) { return { error: error.message, code: "TRAFFIC_LOG_FAILED" }; }
  }
  function readTrafficHistory(rawRoot, options = {}) {
    const read = readJsonl(rawRoot, "traffic/raw.jsonl", { limit: Math.min(Number(options.limit) || 500, 1000), maxBytes: options.maxBytes });
    if (read.error) return { ...read, code: "TRAFFIC_HISTORY_READ_FAILED" };
    const records = (read.records || []).filter((record) => record?.recordType === "http-exchange");
    return options.includeBodies === false ? { ...read, records: records.map(summarizeTrafficRecord) } : { ...read, records };
  }
  function readTrafficRecords(rawRoot, { requestIds = [] } = {}) {
    const ids = [...new Set((Array.isArray(requestIds) ? requestIds : []).map(String).filter(Boolean))].slice(0, 100);
    if (!ids.length) return { ok: true, records: [], missing: [] };
    const wanted = new Set(ids);
    const read = readJsonl(rawRoot, "traffic/raw.jsonl", { limit: 1000, maxBytes: 20 * 1024 * 1024 });
    if (read.error) return { ...read, code: "TRAFFIC_RECORD_READ_FAILED" };
    const records = (read.records || []).filter((record) => record?.recordType === "http-exchange" && wanted.has(String(record.requestId)));
    const found = new Set(records.map((record) => String(record.requestId)));
    return { ok: true, records, missing: ids.filter((id) => !found.has(id)) };
  }
  function deleteTrafficRecords(rawRoot, { requestIds = [] } = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification; const ids = new Set((Array.isArray(requestIds) ? requestIds : []).map(String).filter(Boolean)); if (!ids.size) return { ok: true, deleted: 0 }; const target = path.join(verification.root, "traffic", "raw.jsonl");
    try { if (!fs.existsSync(target)) return { ok: true, deleted: 0 }; let deleted = 0; const kept = fs.readFileSync(target, "utf8").split(/\r?\n/).filter(Boolean).filter((line) => { try { const record = JSON.parse(line); if (record?.recordType === "http-exchange" && ids.has(String(record.requestId))) { deleted += 1; return false; } } catch { /* Preserve malformed rows. */ } return true; }); fs.writeFileSync(target, kept.length ? `${kept.join("\n")}\n` : "", "utf8"); return { ok: true, deleted }; } catch (error) { return { error: error.message, code: "TRAFFIC_DELETE_FAILED" }; }
  }
  function projectProfile(root) { try { return typeof projectProfileProvider === "function" ? projectProfileProvider(root) || null : null; } catch { return null; } }
  function createRun(rawRoot, input = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification; const target = path.join(verification.root, "runs", "runs.json");
    try { const document = JSON.parse(fs.readFileSync(target, "utf8")), profile = projectProfile(verification.root) || {}; const entry = { ...clone(RUN_TEMPLATE), ...input, id: String(input.id || `run-${Date.now().toString(36)}`).slice(0, 160), createdAt: input.createdAt || now().toISOString(), scopeSnapshotSha256: input.scopeSnapshotSha256 || sha256(JSON.stringify(profile.scope || {})), configurationSnapshotSha256: input.configurationSnapshotSha256 || sha256(JSON.stringify({ authorization: profile.authorization || {}, rulesOfEngagement: profile.rulesOfEngagement || {} })) }; document.runs = [...(Array.isArray(document.runs) ? document.runs : []), entry]; document.activeRunId = entry.status === "running" ? entry.id : document.activeRunId || ""; document.statistics = { ...(document.statistics || {}), total: document.runs.length }; atomicWriteJson(target, document); return { ok: true, run: entry, path: "runs/runs.json" }; } catch (error) { return { error: error.message, code: "RUN_WRITE_FAILED" }; }
  }
  function updateRun(rawRoot, runId, patch = {}) {
    const verification = verify(rawRoot); if (verification.error) return verification; const target = path.join(verification.root, "runs", "runs.json");
    try { const document = JSON.parse(fs.readFileSync(target, "utf8")), index = (document.runs || []).findIndex((run) => run.id === String(runId)); if (index < 0) return { error: `Run not found: ${runId}`, code: "RUN_NOT_FOUND" }; const allowed = ["status", "startedAt", "completedAt", "approvedBy", "approvalReference", "stopReason", "actions", "hypotheses", "checklistIds", "evidenceIds", "coverage", "notes"]; document.runs[index] = { ...document.runs[index], ...Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]])) }; if (["completed", "inconclusive", "stopped", "failed"].includes(document.runs[index].status) && document.activeRunId === runId) document.activeRunId = ""; atomicWriteJson(target, document); return { ok: true, run: document.runs[index], path: "runs/runs.json" }; } catch (error) { return { error: error.message, code: "RUN_UPDATE_FAILED" }; }
  }
  function generateReport(rawRoot) {
    const verification = verify(rawRoot); if (verification.error) return verification;
    const readJson = (relativePath, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(verification.root, ...relativePath.split("/")), "utf8")); } catch { return fallback; } };
    const profile = projectProfile(verification.root) || {}, snapshot = projectArtifacts?.inspect ? projectArtifacts.inspect(verification.root) : { ok: false, evidence: [], checklist: [] }, semantic = snapshot.ok ? snapshot.evidence || [] : [], verified = semantic.filter((item) => item.status === "verified"), checklist = snapshot.ok ? snapshot.checklist || [] : [], assets = readJson("enumeration/assets.json", { assets: [] }), endpoints = readJson("enumeration/endpoints.json", { endpoints: [] }), runs = readJson("runs/runs.json", { runs: [] }), operational = readJsonl(verification.root, "evidence/index.jsonl", { limit: 500 }), stamp = now().toISOString();
    const clean = (value, fallback = "") => String(value == null || value === "" ? fallback : value).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|"), statusCounts = checklist.reduce((counts, item) => { const key = String(item.status || "not_started"); counts[key] = (counts[key] || 0) + 1; return counts; }, {}), profileScope = profile.scope || {}, rules = profile.rulesOfEngagement || {}, title = clean(profile.engagement?.name || profile.project?.name || verification.name || "Security Assessment").slice(0, 240);
    const rows = verified.map((item) => `| ${clean(item.id)} | ${clean(item.title)} | ${clean(item.severity, "unrated")} | ${clean(item.confidence)} | ${clean((item.target_refs || []).join(", "), "not recorded")} |`), details = verified.flatMap((item) => [`### ${clean(item.id)}: ${clean(item.title)}`, "", `- Targets: ${clean((item.target_refs || []).join(", "), "not recorded")}`, `- Severity: ${clean(item.severity, "unrated")}`, `- Confidence: ${clean(item.confidence, "unknown")}`, `- Impact: ${clean(item.impact, "not recorded")}`, `- Remediation: ${clean(item.remediation, "not recorded")}`, `- Retest criteria: ${clean(item.retest_criteria, "not recorded")}`, `- Checklist references: ${clean((item.checklist_refs || []).join(", "), "none")}`, ""]);
    const report = [`# ${title}`, "", "## Engagement and Scope", "", `- Authorization confirmed: ${profile.authorization?.confirmed ? "yes" : "no"}`, `- In-scope targets: ${(profileScope.inScopeTargets || []).map((item) => clean(item)).join(", ") || "not recorded"}`, `- Out-of-scope targets: ${(profileScope.outOfScopeTargets || []).map((item) => clean(item)).join(", ") || "none recorded"}`, `- Testing windows: ${(rules.testingWindows || []).map((item) => clean(item)).join(", ") || "not configured"}`, "", "## Executive Summary", "", `- Verified evidence records: ${verified.length}`, `- Other evidence records: ${semantic.length - verified.length}`, `- Discovered assets: ${(assets.assets || []).length}`, `- Recorded endpoints: ${(endpoints.endpoints || []).length}`, `- Runs: ${(runs.runs || []).length}`, "", "## Attack Surface", "", `- Assets: ${(assets.assets || []).length}`, `- Endpoints: ${(endpoints.endpoints || []).length}`, "", "## Verified Evidence", "", "| ID | Title | Severity | Confidence | Targets |", "|---|---|---|---|---|", ...(rows.length ? rows : ["| none | No verified evidence recorded | unrated | unknown | not recorded |"]), "", ...details, "## Investigation Coverage", "", ...Object.entries(statusCounts).sort().map(([status, count]) => `- ${status}: ${count}`), "", "## Limitations", "", `- Inconclusive evidence: ${semantic.filter((item) => item.status === "inconclusive").length}`, `- Rejected evidence: ${semantic.filter((item) => item.status === "rejected").length}`, `- Blocked checklist items: ${statusCounts.blocked || 0}`, `- Not-started checklist items: ${statusCounts.not_started || 0}`, "", "## Evidence Index", "", "| Evidence ID | File/source | SHA-256 |", "|---|---|---|", ...(operational.records || []).map((item) => `| ${clean(item.id)} | ${clean(item.filePath || item.source, "not recorded")} | ${clean(item.sha256, "not recorded")} |`), ""].join("\n");
    try { const reportDir = path.join(verification.root, "report"), exportDir = path.join(reportDir, "exports"), target = path.join(exportDir, `security-report-${stamp.replace(/[:.]/g, "-")}.md`); atomicWrite(path.join(reportDir, "report.md"), report); fs.mkdirSync(exportDir, { recursive: true }); atomicWrite(target, report); return { ok: true, path: path.relative(verification.root, target).replace(/\\/g, "/"), workingPath: "report/report.md", generatedAt: stamp, summary: { verifiedEvidence: verified.length, evidence: semantic.length, assets: (assets.assets || []).length, runs: (runs.runs || []).length } }; } catch (error) { return { error: error.message, code: "REPORT_GENERATION_FAILED" }; }
  }
  function deleteCustomEntries(rawRoot, relativePaths = []) {
    const verification = verify(rawRoot); if (verification.error) return verification; const requested = [...new Set((Array.isArray(relativePaths) ? relativePaths : []).map((value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean))].slice(0, 100); if (!requested.length) return { error: "Select at least one Custom item", code: "NO_SELECTION" }; const customRoot = path.resolve(verification.root, "custom"), resolved = [];
    for (const relativePath of requested) { const validated = validateCustomEntryPath(`custom/${relativePath}`); if (validated.error) return validated; const target = path.resolve(verification.root, ...validated.normalized.split("/")); if (target === customRoot || !target.startsWith(`${customRoot}${path.sep}`)) return { error: "Only Custom items can be deleted", code: "UNSAFE_DELETE" }; if (!fs.existsSync(target)) return { error: `Custom item no longer exists: ${relativePath}`, code: "NOT_FOUND" }; resolved.push({ relativePath, target }); }
    const roots = resolved.filter((entry) => !resolved.some((candidate) => candidate !== entry && entry.relativePath.startsWith(`${candidate.relativePath}/`))); try { for (const entry of roots) fs.rmSync(entry.target, { recursive: true, force: false }); return { ok: true, deleted: roots.map((entry) => entry.relativePath), requestedCount: requested.length }; } catch (error) { return { error: `Could not delete Custom items: ${error.message}`, code: "DELETE_FAILED" }; }
  }
  return Object.freeze({ verify, repair, appendTrafficRecord, appendEvidenceRecord, readJsonl, createRun, updateRun, generateReport, deleteTrafficRecords, deleteCustomEntries, readTrafficHistory, readTrafficRecords, expectedEntries, requiredDirectories: [...REQUIRED_DIRECTORIES] });
}

module.exports = { ASSESSMENT_ITEM_FILES, ASSESSMENT_VERSION, JSON_TEMPLATES, REQUIRED_DIRECTORIES, RESERVED_ASSESSMENT_NAMES, createAssessmentWorkspace, formatTrafficTimestamp, redactHttpMessage, redactTrafficRecord, summarizeTrafficRecord, validateCustomEntryPath };
