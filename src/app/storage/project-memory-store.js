"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");

const PROJECT_MEMORY_SCHEMA_VERSION = 1;
const MAX_ITEMS = Object.freeze({ observations: 300, findings: 200, completedWork: 250, completedPlans: 100, completedRuns: 150, failures: 250, negativeResults: 200, evidenceRefs: 500, relationships: 400, anomalies: 200, decisions: 150, knownGaps: 150 });
const MAX_PROCESSED_EVENTS = 500;

function now() { return new Date().toISOString(); }

function text(value, maximum = 8_000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableId(prefix, value) {
  return `${prefix}:${nodeCrypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24)}`;
}

function projectRoot(workspace) {
  return nodePath.resolve(String(workspace || "."));
}

function defaultMemory(workspace) {
  const root = projectRoot(workspace);
  return {
    schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
    projectId: stableId("project", root.toLowerCase()),
    workspace: root,
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    current: {
      targetSummary: "",
      scopeSummary: "",
      assessmentPhase: "",
      importantEntities: [],
      completedSummary: "",
      unresolvedSummary: "",
    },
    activeHypothesis: null,
    observations: [],
    findings: [],
    completedWork: [],
    completedPlans: [],
    completedRuns: [],
    failures: [],
    negativeResults: [],
    evidenceRefs: [],
    relationships: [],
    anomalies: [],
    decisions: [],
    knownGaps: [],
    sourceSessions: [],
    processedEventIds: [],
  };
}

function normalizeItem(value, fallbackPrefix = "memory") {
  const source = value && typeof value === "object" ? value : { summary: value };
  const clean = redactStructuredValue(source);
  const item = clean && typeof clean === "object" ? clean : { summary: clean };
  const identity = text(item.id || item.ref || item.key || "", 240);
  return {
    ...item,
    id: identity || stableId(fallbackPrefix, JSON.stringify(item)),
    summary: text(item.summary || item.statement || item.title || "", 4_000),
    sourceRefs: [...new Set((Array.isArray(item.sourceRefs) ? item.sourceRefs : Array.isArray(item.evidenceRefs) ? item.evidenceRefs : []).map((entry) => text(entry, 300)).filter(Boolean))].slice(0, 100),
    updatedAt: text(item.updatedAt || item.recordedAt || now(), 80),
  };
}

function normalizeMemory(input, workspace = "") {
  const base = defaultMemory(workspace);
  const source = input && typeof input === "object" ? input : {};
  const memory = {
    ...base,
    schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
    projectId: text(source.projectId || base.projectId, 240),
    workspace: projectRoot(source.workspace || workspace),
    revision: Math.max(0, Number(source.revision) || 0),
    current: { ...base.current, ...(source.current && typeof source.current === "object" ? source.current : {}) },
    activeHypothesis: source.activeHypothesis && typeof source.activeHypothesis === "object" ? normalizeItem(source.activeHypothesis, "hypothesis") : null,
    observations: [],
    findings: [],
    completedWork: [],
    completedPlans: [],
    completedRuns: [],
    failures: [],
    negativeResults: [],
    evidenceRefs: [],
    relationships: [],
    anomalies: [],
    decisions: [],
    knownGaps: [],
    processedEventIds: [...new Set((Array.isArray(source.processedEventIds) ? source.processedEventIds : []).map((entry) => text(entry, 240)).filter(Boolean))].slice(-MAX_PROCESSED_EVENTS),
    sourceSessions: [...new Set((Array.isArray(source.sourceSessions) ? source.sourceSessions : []).map((entry) => text(entry, 240)).filter(Boolean))].slice(-200),
  };
  for (const key of Object.keys(MAX_ITEMS)) {
    const values = Array.isArray(source[key]) ? source[key] : [];
    memory[key] = values.map((entry) => normalizeItem(entry, key.slice(0, -1))).slice(-MAX_ITEMS[key]);
  }
  for (const key of ["targetSummary", "scopeSummary", "assessmentPhase", "completedSummary", "unresolvedSummary"]) {
    memory.current[key] = text(redactStructuredValue(memory.current[key], key), 8_000);
  }
  memory.current.importantEntities = Array.isArray(memory.current.importantEntities)
    ? memory.current.importantEntities.map((entry) => normalizeItem(entry, "entity")).slice(-200)
    : [];
  memory.createdAt = text(source.createdAt || base.createdAt, 80);
  memory.updatedAt = text(source.updatedAt || base.updatedAt, 80);
  return memory;
}

function projectMemoryProjection(input, workspace = "") {
  const memory = normalizeMemory(input, workspace || input?.workspace || "");
  return {
    schemaVersion: memory.schemaVersion,
    projectId: memory.projectId,
    revision: memory.revision,
    updatedAt: memory.updatedAt,
    current: redactStructuredValue(memory.current),
    activeHypothesis: memory.activeHypothesis ? redactStructuredValue(memory.activeHypothesis) : null,
    observations: redactStructuredValue(memory.observations),
    findings: redactStructuredValue(memory.findings),
    completedWork: redactStructuredValue(memory.completedWork),
    completedPlans: redactStructuredValue(memory.completedPlans),
    completedRuns: redactStructuredValue(memory.completedRuns),
    failures: redactStructuredValue(memory.failures),
    negativeResults: redactStructuredValue(memory.negativeResults),
    evidenceRefs: redactStructuredValue(memory.evidenceRefs),
    relationships: redactStructuredValue(memory.relationships),
    anomalies: redactStructuredValue(memory.anomalies),
    decisions: redactStructuredValue(memory.decisions),
    knownGaps: redactStructuredValue(memory.knownGaps),
  };
}

function mergeCollection(existing, incoming, key, maximum) {
  const map = new Map((Array.isArray(existing) ? existing : []).map((entry) => [String(entry?.id || stableId(key, JSON.stringify(entry))), entry]));
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const item = normalizeItem(raw, key.slice(0, -1));
    const previous = map.get(item.id);
    map.set(item.id, previous ? { ...previous, ...item, sourceRefs: [...new Set([...(previous.sourceRefs || []), ...(item.sourceRefs || [])])].slice(0, 100) } : item);
  }
  return [...map.values()].sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""))).slice(-maximum);
}

function applyDelta(memoryInput, delta = {}) {
  const memory = normalizeMemory(memoryInput, memoryInput?.workspace);
  const source = delta && typeof delta === "object" ? delta : {};
  const idempotencyKey = text(source.idempotencyKey || source.finalizationId || "", 240);
  if (idempotencyKey && memory.processedEventIds.includes(idempotencyKey)) return memory;
  if (source.current && typeof source.current === "object") {
    for (const key of ["targetSummary", "scopeSummary", "assessmentPhase", "completedSummary", "unresolvedSummary"]) {
      const sanitized = redactStructuredValue(source.current[key], key);
      if (source.current[key] !== undefined && text(sanitized)) memory.current[key] = text(sanitized, 8_000);
    }
    if (Array.isArray(source.current.importantEntities)) memory.current.importantEntities = mergeCollection(memory.current.importantEntities, source.current.importantEntities, "entities", 200);
  }
  if (source.activeHypothesis && typeof source.activeHypothesis === "object") {
    const incoming = normalizeItem(source.activeHypothesis, "hypothesis");
    const previous = memory.activeHypothesis;
    memory.activeHypothesis = previous && previous.id === incoming.id
      ? { ...previous, ...incoming, sourceRefs: [...new Set([...(previous.sourceRefs || []), ...(incoming.sourceRefs || [])])].slice(0, 100) }
      : incoming;
  }
  for (const key of Object.keys(MAX_ITEMS)) {
    memory[key] = mergeCollection(memory[key], source[key], key, MAX_ITEMS[key]);
  }
  if (source.sessionId) memory.sourceSessions = [...new Set([...memory.sourceSessions, text(source.sessionId, 240)])].slice(-200);
  if (idempotencyKey) memory.processedEventIds = [...new Set([...memory.processedEventIds, idempotencyKey])].slice(-MAX_PROCESSED_EVENTS);
  memory.revision += 1;
  memory.updatedAt = now();
  return memory;
}

function createProjectMemoryStore({ fs = nodeFs, path = nodePath, crypto = nodeCrypto } = {}) {
  function filePath(workspace) { return path.join(projectRoot(workspace), ".xekute", "context", "project-memory.json"); }
  function backupPath(workspace) { return `${filePath(workspace)}.bak`; }
  function readFile(target) {
    try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { return null; }
  }
  function load(workspace) {
    const target = filePath(workspace);
    const primary = readFile(target);
    if (primary && typeof primary === "object") return { ok: true, memory: normalizeMemory(primary, workspace), recovered: false, path: target };
    const backup = readFile(backupPath(workspace));
    if (backup && typeof backup === "object") return { ok: true, memory: normalizeMemory(backup, workspace), recovered: true, warning: "Project memory was recovered from its backup.", path: target };
    return { ok: true, memory: defaultMemory(workspace), recovered: false, exists: false, path: target };
  }
  function atomicWrite(target, value, { backup = true } = {}) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    try { if (backup && fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`); } catch { /* Backup is best effort. */ }
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      fs.renameSync(temporary, target);
    } catch {
      fs.copyFileSync(temporary, target);
      fs.rmSync(temporary, { force: true });
    }
    try { fs.chmodSync(target, 0o600); } catch { /* Windows ACLs provide the protection. */ }
  }
  function save(workspace, memory, options = {}) {
    const normalized = normalizeMemory(memory, workspace);
    atomicWrite(filePath(workspace), normalized, options);
    return { ok: true, memory: normalized, path: filePath(workspace) };
  }
  function consolidate(workspace, delta = {}) {
    const loaded = load(workspace);
    const memory = applyDelta(loaded.memory, delta);
    return { ...save(workspace, memory, { backup: !loaded.recovered }), recovered: Boolean(loaded.recovered) };
  }
  function rebuild(workspace, deltas = []) {
    let memory = defaultMemory(workspace);
    for (const delta of Array.isArray(deltas) ? deltas : []) memory = applyDelta(memory, delta);
    return save(workspace, memory);
  }
  function status(workspace) {
    const loaded = load(workspace);
    return { ok: true, path: loaded.path, exists: Boolean(loaded.exists || fs.existsSync(loaded.path)), recovered: Boolean(loaded.recovered), revision: loaded.memory.revision, updatedAt: loaded.memory.updatedAt, sourceCount: loaded.memory.sourceSessions.length };
  }
  return Object.freeze({ filePath, backupPath, load, save, consolidate, rebuild, status, normalizeMemory, projectMemoryProjection, applyDelta, stableId });
}

module.exports = { PROJECT_MEMORY_SCHEMA_VERSION, createProjectMemoryStore, normalizeMemory, projectMemoryProjection, applyDelta, stableId };
