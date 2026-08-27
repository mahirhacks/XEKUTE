"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/index.js");
const {
  atomicWriteJson,
  assertNoSecretKeys,
  clone,
  operationFailure,
  readJsonWithBackup,
  timestamp,
} = require("./memory-storage-utils.js");

const FINALIZATION_SCHEMA_VERSION = 1;
const JOB_STATES = Object.freeze(["queued", "processing", "completed", "failed", "cancelled", "interrupted"]);

function createMemoryFinalizationStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir,
  protector = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Memory finalization store dependencies are required.");
  const rootDir = path.resolve(String(baseDir));

  function available() {
    try { return Boolean(protector?.available?.()); } catch { return false; }
  }
  function operationIdOf(value) {
    const id = String(value || "").trim();
    try { return assertMemoryId(id, "op"); } catch (error) { throw error; }
  }
  function jobFile(operationId) { return path.join(rootDir, `${String(operationId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`); }
  function encrypt(job) { return protector.encrypt(JSON.stringify(job)); }
  function decrypt(payload) { return JSON.parse(protector.decrypt(String(payload || ""))); }

  function normalizeJob(input = {}) {
    const operationId = operationIdOf(input.operation_id || input.operationId);
    const projectId = assertMemoryId(input.project_id || input.projectId, "proj");
    const blockId = assertMemoryId(input.block_id || input.blockId, "block");
    const eventRangeHash = String(input.event_range_hash || input.eventRangeHash || "").trim().toLowerCase();
    if (!/^[a-f0-9]{32,128}$/i.test(eventRangeHash)) throw Object.assign(new Error("A finalization job requires an event-range hash."), { code: "MEMORY_FINALIZATION_RANGE_HASH_INVALID" });
    const state = String(input.state || "queued").trim().toLowerCase();
    if (!JOB_STATES.includes(state)) throw Object.assign(new Error("The finalization job state is unsupported."), { code: "MEMORY_FINALIZATION_STATE_INVALID" });
    const createdAt = String(input.created_at || input.createdAt || timestamp(now)).trim();
    const updatedAt = String(input.updated_at || input.updatedAt || createdAt).trim();
    if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) throw Object.assign(new Error("Finalization job timestamps are invalid."), { code: "MEMORY_TIMESTAMP_INVALID" });
    const job = {
      schema_version: FINALIZATION_SCHEMA_VERSION,
      kind: "xekute-memory-finalization-job",
      operation_id: operationId,
      idempotency_key: String(input.idempotency_key || input.idempotencyKey || operationId).trim().slice(0, 240),
      project_id: projectId,
      session_id: input.session_id || input.sessionId ? assertMemoryId(input.session_id || input.sessionId, "session") : "",
      block_id: blockId,
      event_range_hash: eventRangeHash,
      sealed_event_range: input.sealed_event_range && typeof input.sealed_event_range === "object" ? clone(input.sealed_event_range) : (input.sealedEventRange && typeof input.sealedEventRange === "object" ? clone(input.sealedEventRange) : {}),
      state,
      attempts: Math.max(0, Number(input.attempts) || 0),
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(updatedAt).toISOString(),
      next_attempt_at: input.next_attempt_at || input.nextAttemptAt ? String(input.next_attempt_at || input.nextAttemptAt).trim().slice(0, 80) : "",
      payload: input.payload && typeof input.payload === "object" ? clone(input.payload) : {},
      result: input.result && typeof input.result === "object" ? clone(input.result) : {},
      error: input.error && typeof input.error === "object" ? clone(input.error) : null,
    };
    assertNoSecretKeys(job);
    return job;
  }

  function encode(job) {
    if (!available()) throw Object.assign(new Error("Encrypted finalization recovery is unavailable on this device."), { code: "MEMORY_FINALIZATION_PROTECTION_UNAVAILABLE" });
    return { schema_version: FINALIZATION_SCHEMA_VERSION, encrypted: true, payload: encrypt(job) };
  }

  function decode(value) {
    if (!value?.encrypted) throw Object.assign(new Error("Finalization recovery data is not encrypted."), { code: "MEMORY_FINALIZATION_UNENCRYPTED" });
    if (!available()) throw Object.assign(new Error("Encrypted finalization recovery is unavailable on this device."), { code: "MEMORY_FINALIZATION_PROTECTION_UNAVAILABLE" });
    const job = normalizeJob(decrypt(value.payload));
    return job;
  }

  function read(operationId) {
    let id;
    try { id = operationIdOf(operationId); } catch (error) { return operationFailure(error.code || "MEMORY_FINALIZATION_INPUT_INVALID", error.message, error.details || {}); }
    const file = jobFile(id);
    if (!fs.existsSync(file) && !fs.existsSync(`${file}.bak`)) return { ok: true, exists: false, operationId: id, path: file, job: null };
    const loaded = readJsonWithBackup({ fs }, file, { parse: (text) => JSON.parse(text), validate: (value) => decode(value) });
    if (!loaded.ok) return operationFailure(loaded.error?.code || "MEMORY_FINALIZATION_CORRUPT", `The finalization job could not be recovered: ${loaded.error?.message || "invalid job"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, exists: false, operationId: id, path: file, job: null };
    try {
      const job = decode(loaded.value);
      return { ok: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", operationId: id, path: file, job };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_FINALIZATION_CORRUPT", `The finalization job is invalid: ${error.message}.`, { path: file }, true);
    }
  }

  function persist(input = {}) {
    let job;
    try { job = normalizeJob(input); } catch (error) { return operationFailure(error.code || "MEMORY_FINALIZATION_INPUT_INVALID", error.message, error.details || {}); }
    const current = read(job.operation_id);
    if (!current.ok) return current;
    if (current.exists) {
      if (current.job.project_id !== job.project_id || current.job.block_id !== job.block_id || current.job.event_range_hash !== job.event_range_hash) return operationFailure("MEMORY_FINALIZATION_IDEMPOTENCY_CONFLICT", "The operation ID is already bound to a different finalization range.", { operationId: job.operation_id });
      return { ok: true, changed: false, duplicate: true, operationId: job.operation_id, path: current.path, job: clone(current.job) };
    }
    try {
      const target = jobFile(job.operation_id);
      const written = atomicWriteJson({ fs, path, crypto }, target, encode(job), { validate: (text) => decode(JSON.parse(text)) });
      return { ok: true, changed: true, duplicate: false, operationId: job.operation_id, path: written.path, job: clone(job) };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_FINALIZATION_WRITE_FAILED", `The finalization job could not be persisted: ${error.message}.`, { path: jobFile(job.operation_id) }, true);
    }
  }

  function update(operationId, patch = {}) {
    const current = read(operationId);
    if (!current.ok) return current;
    if (!current.exists) return operationFailure("MEMORY_FINALIZATION_NOT_FOUND", "The finalization job was not found.", { operationId });
    let next;
    try { next = normalizeJob({ ...current.job, ...patch, operation_id: current.job.operation_id, project_id: current.job.project_id, block_id: current.job.block_id, event_range_hash: current.job.event_range_hash, updated_at: timestamp(now) }); } catch (error) { return operationFailure(error.code || "MEMORY_FINALIZATION_INVALID", error.message, error.details || {}); }
    try {
      const written = atomicWriteJson({ fs, path, crypto }, current.path, encode(next), { validate: (text) => decode(JSON.parse(text)) });
      return { ok: true, changed: true, operationId: next.operation_id, path: written.path, previousState: current.job.state, job: clone(next) };
    } catch (error) { return operationFailure(error.code || "MEMORY_FINALIZATION_WRITE_FAILED", `The finalization job could not be updated: ${error.message}.`, { path: current.path }, true); }
  }

  function markProcessing(operationId) { return update(operationId, { state: "processing", attempts: (read(operationId).job?.attempts || 0) + 1 }); }
  function markCompleted(operationId, result = {}) { return update(operationId, { state: "completed", result: clone(result), error: null }); }
  function markFailed(operationId, error = {}, { retryable = true } = {}) { return update(operationId, { state: retryable ? "queued" : "failed", error: { code: String(error.code || "MEMORY_FINALIZATION_FAILED"), message: String(error.message || error.error || "Finalization failed.").slice(0, 2_000), retryable: Boolean(retryable) } }); }
  function markCancelled(operationId, reason = "cancelled") { return update(operationId, { state: "cancelled", error: { code: "MEMORY_FINALIZATION_CANCELLED", message: String(reason).slice(0, 500), retryable: false } }); }

  function list({ projectId = "", states = [] } = {}) {
    if (!available() && fs.existsSync(rootDir)) return operationFailure("MEMORY_FINALIZATION_PROTECTION_UNAVAILABLE", "Encrypted finalization recovery is unavailable on this device.");
    if (!fs.existsSync(rootDir)) return { ok: true, jobs: [], warnings: [] };
    const wanted = new Set((Array.isArray(states) ? states : []).map((state) => String(state).trim().toLowerCase()).filter((state) => JOB_STATES.includes(state)));
    const jobs = [];
    const warnings = [];
    for (const entry of fs.readdirSync(rootDir)) {
      if (!entry.endsWith(".json") || entry.endsWith(".bak")) continue;
      const id = entry.slice(0, -5);
      const loaded = read(id);
      if (!loaded.ok) { warnings.push({ path: loaded.path, code: loaded.code, error: loaded.error }); continue; }
      if (!loaded.job) continue;
      if (projectId && loaded.job.project_id !== projectId) continue;
      if (wanted.size && !wanted.has(loaded.job.state)) continue;
      jobs.push(clone(loaded.job));
    }
    jobs.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.operation_id.localeCompare(right.operation_id));
    return { ok: true, jobs, warnings };
  }

  function recoverInterrupted({ projectId = "" } = {}) {
    const listed = list({ projectId, states: ["processing", "interrupted"] });
    if (!listed.ok) return listed;
    const recovered = [];
    for (const job of listed.jobs) {
      const result = update(job.operation_id, { state: "queued", error: { code: "MEMORY_FINALIZATION_RECOVERED", message: "Recovered after process interruption.", retryable: true } });
      if (result.ok) recovered.push(result.job);
    }
    return { ok: true, recovered };
  }

  return Object.freeze({
    FINALIZATION_SCHEMA_VERSION,
    JOB_STATES,
    rootDir,
    jobFile,
    normalizeJob,
    read,
    persist,
    update,
    markProcessing,
    markCompleted,
    markFailed,
    markCancelled,
    list,
    recoverInterrupted,
  });
}

module.exports = Object.freeze({ createMemoryFinalizationStore, FINALIZATION_SCHEMA_VERSION, JOB_STATES });
