"use strict";

const crypto = require("node:crypto");
const Artifacts = require("../artifacts/investigation-artifacts.js");

const ASSESSMENT_VERSION = 6;
const ASSESSMENT_ITEM_FILES = Object.freeze({
  "raw-traffic": "traffic/raw.jsonl",
  "filtered-traffic": "traffic/filtered.jsonl",
  "project-info": Artifacts.PATHS.projectIndex,
});
const REQUIRED_DIRECTORIES = Object.freeze([
  "traffic",
  ".xekute",
  ".xekute/project_info",
]);
const RESERVED_ASSESSMENT_NAMES = new Set([
  ...REQUIRED_DIRECTORIES.flatMap((item) => item.split("/")),
  ...Object.values(ASSESSMENT_ITEM_FILES).flatMap((item) => item.split("/")),
  "custom", "webclone", "report", "report.md", "recon", "enumeration", "runs", "evidence",
  "checklist.md", "hypotheses.md", "agent-actions.jsonl", "agent-runs.jsonl", "tool-output.jsonl",
].map((item) => item.toLowerCase()));

const RUN_TEMPLATE = { id: "", type: "assessment", status: "planned", profile: "agent", operator: "", createdAt: "", startedAt: "", completedAt: "", scopeSnapshotSha256: "", configurationSnapshotSha256: "", toolVersions: {}, approvedBy: "", approvalReference: "", stopReason: "", actions: [], hypotheses: [], checklistIds: [], evidenceIds: [], coverage: { tested: 0, passed: 0, failed: 0, blocked: 0, notApplicable: 0 }, notes: "" };

const JSON_TEMPLATES = Object.freeze({});
const JSONL_TEMPLATES = Object.freeze({
  "traffic/raw.jsonl": { recordType: "xekute-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "direction", "protocol", "method", "url", "statusCode", "headers", "request", "response", "durationMs", "source", "tags"] },
  "traffic/filtered.jsonl": { recordType: "xekute-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "filterReason", "method", "url", "statusCode", "parameterNames", "contentType", "evidenceFiles", "notes", "tags"] },
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function sha256(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value ?? "")).digest("hex"); }
function formatTrafficTimestamp(date) { const pad = (value, width = 2) => String(value).padStart(width, "0"); return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(date.getMilliseconds(), 3)}`; }
function serializeTrafficRecord(record, maximumRecordBytes) {
  let serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, "utf8") <= maximumRecordBytes) return { record, serialized };
  const slim = { ...record, request: "", response: "", truncated: true, requestBodyTruncated: true, omittedBodies: true };
  serialized = JSON.stringify(slim);
  if (Buffer.byteLength(serialized, "utf8") > maximumRecordBytes) return { error: `Traffic record exceeds the ${maximumRecordBytes} byte log limit`, code: "RECORD_TOO_LARGE" };
  return { record: slim, serialized };
}
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
  const runStore = new Map();
  function runsFor(root) {
    const key = String(root || "").toLowerCase();
    if (!runStore.has(key)) runStore.set(key, { runs: [], activeRunId: "" });
    return runStore.get(key);
  }
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
      ...Object.entries(JSONL_TEMPLATES).map(([relativePath, template]) => ({ relativePath, type: "file", content: () => `${JSON.stringify(template)}\n` })),
      ...Artifacts.PROJECT_DOCUMENTS.map((document) => ({ relativePath: document.path, type: "file", content: () => Artifacts.projectDocumentTemplate(document.id) })),
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
    const issues = [];
    for (const document of Artifacts.PROJECT_DOCUMENTS) {
      const file = path.join(root, ...document.path.split("/"));
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
      const parsed = Artifacts.parseProjectDocument(document.id, fs.readFileSync(file, "utf8"));
      if (!parsed.ok) issues.push({ path: document.path, type: "file", reason: "invalid_artifact", fields: [], code: parsed.code, message: parsed.error });
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
    const normalized = String(relativePath || "").replace(/\\/g, "/");
    if (!normalized.startsWith("traffic/")) return { ok: true, skipped: true, path: normalized, record };
    const target = path.join(root, ...normalized.split("/")); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.appendFileSync(target, `${serialized}\n`, "utf8"); return { ok: true, path: normalized, record };
  }
  function appendEvidenceRecord(rawRoot, record = {}) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved;
    const capturedAt = String(record.capturedAt || now().toISOString()), request = String(record.request || ""), response = String(record.response || ""), content = String(record.content || `${request}\n${response}`);
    const entry = { id: String(record.id || record.requestId || `evidence-${Date.now().toString(36)}`).slice(0, 160), type: String(record.type || "request-response"), title: String(record.title || record.url || "Captured evidence").slice(0, 300), capturedAt, capturedBy: String(record.capturedBy || record.tool || "XEKUTE").slice(0, 160), source: String(record.source || record.tool || "unknown").slice(0, 120), requestId: String(record.requestId || ""), targetId: String(record.targetId || ""), host: String(record.host || ""), url: String(record.url || "").slice(0, 2000), sha256: String(record.sha256 || sha256(content)), requestSha256: request ? sha256(request) : "", responseSha256: response ? sha256(response) : "", redacted: record.redacted !== false, redactionProfile: String(record.redactionProfile || "default"), filePath: String(record.filePath || ""), semanticEvidenceRefs: Array.isArray(record.semanticEvidenceRefs) ? record.semanticEvidenceRefs.map(String).slice(0, 50) : [], notes: String(record.notes || "").slice(0, 2000) };
    return { ok: true, skipped: true, record: entry };
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
  function ensureTrafficLog(rawRoot) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved; const { root } = resolved;
    try {
      fs.mkdirSync(path.join(root, "traffic"), { recursive: true });
      for (const [relativePath, template] of Object.entries(JSONL_TEMPLATES)) {
        const target = path.join(root, ...relativePath.split("/"));
        try { fs.writeFileSync(target, `${JSON.stringify(template)}\n`, { encoding: "utf8", flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
      }
      return { ok: true, root, path: "traffic/raw.jsonl" };
    } catch (error) {
      return { error: error.message, code: "TRAFFIC_LOG_FAILED" };
    }
  }
  function appendTrafficRecord(rawRoot, record, { filtered = false } = {}) {
    const prepared = ensureTrafficLog(rawRoot); if (prepared.error) return prepared; const date = now();
    const fitted = serializeTrafficRecord({ recordType: "http-exchange", schemaVersion: ASSESSMENT_VERSION, timestamp: formatTrafficTimestamp(date), isoTimestamp: date.toISOString(), ...record, redacted: false }, 1_500_000);
    if (fitted.error) return fitted;
    const relativePath = filtered ? "traffic/filtered.jsonl" : "traffic/raw.jsonl";
    try { fs.appendFileSync(path.join(prepared.root, ...relativePath.split("/")), `${fitted.serialized}\n`, "utf8"); return { ok: true, path: relativePath, timestamp: fitted.record.timestamp, record: fitted.record }; } catch (error) { return { error: error.message, code: "TRAFFIC_LOG_FAILED" }; }
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
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved;
    const document = runsFor(resolved.root);
    const profile = projectProfile(resolved.root) || {};
    const entry = { ...clone(RUN_TEMPLATE), ...input, id: String(input.id || `run-${Date.now().toString(36)}`).slice(0, 160), createdAt: input.createdAt || now().toISOString(), scopeSnapshotSha256: input.scopeSnapshotSha256 || sha256(JSON.stringify(profile.scope || {})), configurationSnapshotSha256: input.configurationSnapshotSha256 || sha256(JSON.stringify({ authorization: profile.authorization || {}, rulesOfEngagement: profile.rulesOfEngagement || {} })) };
    document.runs.push(entry);
    document.activeRunId = entry.status === "running" ? entry.id : document.activeRunId || "";
    return { ok: true, run: entry, skipped: true };
  }
  function updateRun(rawRoot, runId, patch = {}) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved;
    const document = runsFor(resolved.root);
    const index = document.runs.findIndex((run) => run.id === String(runId));
    if (index < 0) return { error: `Run not found: ${runId}`, code: "RUN_NOT_FOUND" };
    const allowed = ["status", "startedAt", "completedAt", "approvedBy", "approvalReference", "stopReason", "actions", "hypotheses", "checklistIds", "evidenceIds", "coverage", "notes"];
    document.runs[index] = { ...document.runs[index], ...Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]])) };
    if (["completed", "inconclusive", "stopped", "failed"].includes(document.runs[index].status) && document.activeRunId === runId) document.activeRunId = "";
    return { ok: true, run: document.runs[index], skipped: true };
  }
  function generateReport(rawRoot) {
    const resolved = resolveRoot(rawRoot); if (resolved.error) return resolved;
    const profile = projectProfile(resolved.root) || {}, snapshot = projectArtifacts?.inspect ? projectArtifacts.inspect(resolved.root) : { ok: false, evidence: [], checklist: [] }, semantic = snapshot.ok ? snapshot.evidence || [] : [], verified = semantic.filter((item) => item.status === "verified"), checklist = snapshot.ok ? snapshot.checklist || [] : [], runs = runsFor(resolved.root), stamp = now().toISOString();
    const clean = (value, fallback = "") => String(value == null || value === "" ? fallback : value).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|"), statusCounts = checklist.reduce((counts, item) => { const key = String(item.status || "not_started"); counts[key] = (counts[key] || 0) + 1; return counts; }, {}), profileScope = profile.scope || {}, rules = profile.rulesOfEngagement || {}, title = clean(profile.engagement?.name || profile.project?.name || path.basename(resolved.root) || "Security Assessment").slice(0, 240);
    const rows = verified.map((item) => `| ${clean(item.id)} | ${clean(item.title)} | ${clean(item.severity, "unrated")} | ${clean(item.confidence)} | ${clean((item.target_refs || []).join(", "), "not recorded")} |`), details = verified.flatMap((item) => [`### ${clean(item.id)}: ${clean(item.title)}`, "", `- Targets: ${clean((item.target_refs || []).join(", "), "not recorded")}`, `- Severity: ${clean(item.severity, "unrated")}`, `- Confidence: ${clean(item.confidence, "unknown")}`, `- Impact: ${clean(item.impact, "not recorded")}`, `- Remediation: ${clean(item.remediation, "not recorded")}`, `- Retest criteria: ${clean(item.retest_criteria, "not recorded")}`, `- Checklist references: ${clean((item.checklist_refs || []).join(", "), "none")}`, ""]);
    const report = [`# ${title}`, "", "## Engagement and Scope", "", `- Authorization confirmed: ${profile.authorization?.confirmed ? "yes" : "no"}`, `- In-scope targets: ${(profileScope.inScopeTargets || []).map((item) => clean(item)).join(", ") || "not recorded"}`, `- Out-of-scope targets: ${(profileScope.outOfScopeTargets || []).map((item) => clean(item)).join(", ") || "none recorded"}`, `- Testing windows: ${(rules.testingWindows || []).map((item) => clean(item)).join(", ") || "not configured"}`, "", "## Executive Summary", "", `- Verified evidence records: ${verified.length}`, `- Other evidence records: ${semantic.length - verified.length}`, `- Runs: ${runs.runs.length}`, "", "## Attack Surface", "", "", "## Verified Evidence", "", "| ID | Title | Severity | Confidence | Targets |", "|---|---|---|---|---|", ...(rows.length ? rows : ["| none | No verified evidence recorded | unrated | unknown | not recorded |"]), "", ...details, "## Investigation Coverage", "", ...Object.entries(statusCounts).sort().map(([status, count]) => `- ${status}: ${count}`), "", "## Limitations", "", `- Inconclusive evidence: ${semantic.filter((item) => item.status === "inconclusive").length}`, `- Rejected evidence: ${semantic.filter((item) => item.status === "rejected").length}`, `- Blocked checklist items: ${statusCounts.blocked || 0}`, `- Not-started checklist items: ${statusCounts.not_started || 0}`, "", "## Evidence Index", "", "| Evidence ID | File/source | SHA-256 |", "|---|---|---|", ...verified.map((item) => `| ${clean(item.id)} | ${clean(item.source || "memory", "not recorded")} | ${clean(item.sha256, "not recorded")} |`), ""].join("\n");
    return { ok: true, skipped: true, markdown: report, generatedAt: stamp, summary: { verifiedEvidence: verified.length, evidence: semantic.length, runs: runs.runs.length } };
  }
  function deleteCustomEntries(rawRoot, relativePaths = []) {
    const verification = verify(rawRoot); if (verification.error) return verification; const requested = [...new Set((Array.isArray(relativePaths) ? relativePaths : []).map((value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean))].slice(0, 100); if (!requested.length) return { error: "Select at least one Custom item", code: "NO_SELECTION" }; const customRoot = path.resolve(verification.root, "custom"), resolved = [];
    for (const relativePath of requested) { const validated = validateCustomEntryPath(`custom/${relativePath}`); if (validated.error) return validated; const target = path.resolve(verification.root, ...validated.normalized.split("/")); if (target === customRoot || !target.startsWith(`${customRoot}${path.sep}`)) return { error: "Only Custom items can be deleted", code: "UNSAFE_DELETE" }; if (!fs.existsSync(target)) return { error: `Custom item no longer exists: ${relativePath}`, code: "NOT_FOUND" }; resolved.push({ relativePath, target }); }
    const roots = resolved.filter((entry) => !resolved.some((candidate) => candidate !== entry && entry.relativePath.startsWith(`${candidate.relativePath}/`))); try { for (const entry of roots) fs.rmSync(entry.target, { recursive: true, force: false }); return { ok: true, deleted: roots.map((entry) => entry.relativePath), requestedCount: requested.length }; } catch (error) { return { error: `Could not delete Custom items: ${error.message}`, code: "DELETE_FAILED" }; }
  }
  return Object.freeze({ verify, repair, ensureTrafficLog, appendTrafficRecord, appendEvidenceRecord, readJsonl, createRun, updateRun, generateReport, deleteTrafficRecords, deleteCustomEntries, readTrafficHistory, readTrafficRecords, expectedEntries, requiredDirectories: [...REQUIRED_DIRECTORIES] });
}

module.exports = { ASSESSMENT_ITEM_FILES, ASSESSMENT_VERSION, JSON_TEMPLATES, JSONL_TEMPLATES, REQUIRED_DIRECTORIES, RESERVED_ASSESSMENT_NAMES, createAssessmentWorkspace, formatTrafficTimestamp, redactHttpMessage, redactTrafficRecord, summarizeTrafficRecord, validateCustomEntryPath };
