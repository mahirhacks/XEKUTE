"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const {
  createOperationalContextCheckpoint,
  createTranscriptBoundary,
} = require("../../../contracts/memory/operational-context-contracts.js");
const { isMemoryId } = require("../../../contracts/memory/memory-identity.js");
const {
  atomicWriteJson,
  assertNoSecretKeys,
  clone,
  hashText,
  operationFailure,
  readJsonWithBackup,
  safeComponent,
  timestamp,
} = require("./memory-storage-utils.js");
const { createOpaqueId } = require("../../../contracts/memory/memory-identity.js");

const OPERATIONAL_CONTEXT_STORE_VERSION = 1;
const MAX_CHECKPOINT_HISTORY = 100;

function createOperationalContextStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir,
  protector = null,
  projectIdentityStore = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Operational Context store dependencies are required.");
  const rootDir = path.resolve(String(baseDir));
  const memoryRoot = path.join(rootDir, "memory", "sessions");
  const queues = new Map();

  function stamp() { return timestamp(now); }
  function text(value, maximum = 240) { return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum); }
  function sessionKey(projectId, sessionId) { return hashText(crypto, `${projectId}\u0000${sessionId}`).slice(0, 40); }
  function fileFor(projectId, sessionId) {
    return path.join(memoryRoot, safeComponent(projectId, "project"), `${sessionKey(projectId, sessionId)}.json`);
  }
  function queueKey(projectId, sessionId) { return `${projectId}\u0000${sessionId}`; }
  function enqueue(projectId, sessionId, operation) {
    const key = queueKey(projectId, sessionId);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function resolveProjectId(input = {}, { persist = false } = {}) {
    const requested = text(input.projectId || input.project_id);
    if (requested) return isMemoryId(requested, "proj") ? requested : "";
    const workspace = text(input.workspace, 32_768);
    if (!workspace || typeof projectIdentityStore?.resolveProject !== "function") return "";
    const resolved = projectIdentityStore.resolveProject(workspace, { persist });
    const projectId = text(resolved?.projectId || resolved?.project_id);
    return isMemoryId(projectId, "proj") ? projectId : "";
  }

  function scope(input = {}, { persist = false } = {}) {
    const projectId = resolveProjectId(input, { persist });
    const sessionId = text(input.sessionId || input.session_id);
    if (!projectId) return operationFailure("MEMORY_PROJECT_ID_REQUIRED", "A protected proj_ project ID is required for Operational Context.");
    if (!sessionId) return operationFailure("MEMORY_SESSION_REQUIRED", "A session ID is required for Operational Context.");
    return { ok: true, projectId, sessionId, path: fileFor(projectId, sessionId) };
  }

  function secureAvailable() { return Boolean(protector?.available?.() && typeof protector.encrypt === "function" && typeof protector.decrypt === "function"); }

  function encode(payload) {
    assertNoSecretKeys(payload);
    const json = JSON.stringify(payload);
    if (secureAvailable()) return { version: OPERATIONAL_CONTEXT_STORE_VERSION, encrypted: true, payload: protector.encrypt(json) };
    return { version: OPERATIONAL_CONTEXT_STORE_VERSION, encrypted: false, payload };
  }

  function decode(envelope, projectId, sessionId) {
    if (!envelope || typeof envelope !== "object" || Number(envelope.version) !== OPERATIONAL_CONTEXT_STORE_VERSION) {
      throw Object.assign(new Error("The Operational Context container has an unsupported version."), { code: "MEMORY_CONTEXT_CONTAINER_INVALID" });
    }
    let payload;
    if (envelope.encrypted === true) {
      if (!secureAvailable()) throw Object.assign(new Error("Encrypted Operational Context is unavailable on this device."), { code: "MEMORY_CONTEXT_ENCRYPTION_UNAVAILABLE" });
      payload = JSON.parse(protector.decrypt(String(envelope.payload || "")) || "{}");
    } else if (envelope.encrypted === false) {
      payload = envelope.payload;
    } else {
      throw Object.assign(new Error("The Operational Context container encryption marker is invalid."), { code: "MEMORY_CONTEXT_CONTAINER_INVALID" });
    }
    if (!payload || typeof payload !== "object" || payload.project_id !== projectId || payload.session_id !== sessionId) {
      throw Object.assign(new Error("The Operational Context container belongs to a different project or session."), { code: "MEMORY_PROJECT_MISMATCH" });
    }
    assertNoSecretKeys(payload);
    const checkpoints = Array.isArray(payload.checkpoints) ? payload.checkpoints.filter((entry) => entry && typeof entry === "object") : [];
    return {
      version: OPERATIONAL_CONTEXT_STORE_VERSION,
      project_id: projectId,
      session_id: sessionId,
      revision: Number.isSafeInteger(Number(payload.revision)) && Number(payload.revision) >= 0 ? Number(payload.revision) : 0,
      active_checkpoint_id: text(payload.active_checkpoint_id),
      checkpoints: checkpoints.slice(-MAX_CHECKPOINT_HISTORY).map(clone),
      updated_at: text(payload.updated_at, 80),
    };
  }

  function emptyState(projectId, sessionId, file) {
    return {
      ok: true,
      initialized: false,
      exists: false,
      recovered: false,
      projectId,
      sessionId,
      revision: 0,
      activeCheckpointId: "",
      checkpoint: null,
      history: [],
      warning: "",
      path: file,
    };
  }

  function read(input = {}) {
    const resolved = scope(input, { persist: false });
    if (!resolved.ok) {
      // Read-only context inspection of an uninitialized workspace is a valid
      // empty state; malformed explicit IDs still return the contract error.
      if (!text(input.projectId || input.project_id) && !text(input.workspace)) {
        return { ok: true, initialized: false, exists: false, projectId: "", sessionId: text(input.sessionId || input.session_id), revision: 0, activeCheckpointId: "", checkpoint: null, history: [], warning: "", path: "" };
      }
      return resolved;
    }
    const file = resolved.path;
    if (!fs.existsSync(file)) return emptyState(resolved.projectId, resolved.sessionId, file);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_CONTEXT_CONTAINER_CORRUPT", `The Operational Context container could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    try {
      const state = decode(loaded.value, resolved.projectId, resolved.sessionId);
      const checkpoint = [...state.checkpoints].reverse().find((entry) => entry.record_id === state.active_checkpoint_id) || state.checkpoints.at(-1) || null;
      return {
        ok: true,
        initialized: true,
        exists: true,
        recovered: Boolean(loaded.recovered),
        projectId: resolved.projectId,
        sessionId: resolved.sessionId,
        revision: state.revision,
        activeCheckpointId: state.active_checkpoint_id || checkpoint?.record_id || "",
        checkpoint: clone(checkpoint),
        history: clone(state.checkpoints),
        warning: loaded.warning || "",
        path: file,
      };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_CONTEXT_CONTAINER_CORRUPT", `The Operational Context container is invalid: ${error.message}.`, { path: file }, true);
    }
  }

  function nextCheckpoint(input, priorRevision, operationId, priorCheckpoint = null) {
    const source = input.checkpoint && typeof input.checkpoint === "object" ? input.checkpoint : input;
    const candidate = {
      ...clone(source),
      project_id: input.projectId || input.project_id,
      session_id: input.sessionId || input.session_id,
      operation_id: operationId || input.operationId || input.operation_id,
      previous_revision: priorRevision,
      revision: priorRevision + 1,
    };
    // Checkpoints are immutable history records. Reusing the previous record
    // ID would make active selection ambiguous after a late merge.
    if (priorCheckpoint && candidate.record_id === priorCheckpoint.record_id) delete candidate.record_id;
    return createOperationalContextCheckpoint(candidate);
  }

  function writeCheckpoint(input = {}) {
    const resolved = scope(input, { persist: false });
    if (!resolved.ok) return Promise.resolve(resolved);
    return enqueue(resolved.projectId, resolved.sessionId, async () => {
      const current = read(resolved);
      if (!current.ok) return current;
      const expected = input.expectedRevision == null && input.expected_revision == null
        ? current.revision
        : Number(input.expectedRevision ?? input.expected_revision);
      if (!Number.isSafeInteger(expected) || expected < 0) return operationFailure("MEMORY_CONTEXT_REVISION_INVALID", "expectedRevision must be a non-negative integer.");
      if (expected !== current.revision) return operationFailure("MEMORY_CONTEXT_STALE_REVISION", "The Operational Context checkpoint is based on a stale revision.", { expected, actual: current.revision }, true);
      const requestedOperation = text(input.operationId || input.operation_id || input.checkpoint?.operation_id || input.checkpoint?.operationId);
      const prior = current.checkpoint;
      if (prior && requestedOperation && prior.operation_id === requestedOperation) {
        const candidateHash = text(input.contentHash || input.content_hash || input.checkpoint?.content_hash || input.checkpoint?.contentHash, 64).toLowerCase();
        if (!candidateHash || candidateHash === prior.content_hash) {
          return { ok: true, operationId: prior.operation_id, recordIds: [prior.record_id], previousRevision: current.revision, revision: current.revision, changed: false, conflicts: [], warnings: [], checkpoint: clone(prior), active: clone(prior) };
        }
        return operationFailure("MEMORY_CONTEXT_OPERATION_CONFLICT", "The operation ID was already used for different checkpoint content.", { operationId: requestedOperation }, false);
      }
      let checkpoint;
      try {
        checkpoint = nextCheckpoint({ ...input, projectId: resolved.projectId, sessionId: resolved.sessionId }, current.revision, requestedOperation, prior);
      } catch (error) {
        return operationFailure(error.code || "MEMORY_CONTEXT_CHECKPOINT_INVALID", error.message, error.details || {});
      }
      if (prior && prior.content_hash === checkpoint.content_hash) {
        return { ok: true, operationId: checkpoint.operation_id, recordIds: [prior.record_id], previousRevision: current.revision, revision: current.revision, changed: false, conflicts: [], warnings: [], checkpoint: clone(prior), active: clone(prior) };
      }
      const history = [...(current.history || []), clone(checkpoint)].slice(-MAX_CHECKPOINT_HISTORY);
      const payload = {
        version: OPERATIONAL_CONTEXT_STORE_VERSION,
        project_id: resolved.projectId,
        session_id: resolved.sessionId,
        revision: checkpoint.revision,
        active_checkpoint_id: checkpoint.record_id,
        checkpoints: history,
        updated_at: stamp(),
      };
      try {
        const envelope = encode(payload);
        const written = atomicWriteJson({ fs, path, crypto }, resolved.path, envelope, {
          mode: 0o600,
          backup: true,
          validate: (serialized) => {
            const parsed = JSON.parse(serialized);
            decode(parsed, resolved.projectId, resolved.sessionId);
          },
        });
        return {
          ok: true,
          operationId: checkpoint.operation_id,
          recordIds: [checkpoint.record_id],
          previousRevision: current.revision,
          revision: checkpoint.revision,
          changed: true,
          conflicts: [],
          warnings: [],
          checkpoint: clone(checkpoint),
          active: clone(checkpoint),
          path: written.path,
        };
      } catch (error) {
        return operationFailure(error.code || "MEMORY_CONTEXT_CHECKPOINT_WRITE_FAILED", `The Operational Context checkpoint could not be committed: ${error.message}.`, { path: resolved.path }, true);
      }
    });
  }

  function mergeLate(input = {}) {
    const current = read(input);
    if (!current.ok) return Promise.resolve(current);
    if (!current.checkpoint) return Promise.resolve(operationFailure("MEMORY_CONTEXT_CHECKPOINT_REQUIRED", "A checkpoint is required before late messages can be merged."));
    const messages = Array.isArray(input.messages || input.lateMessages) ? input.messages || input.lateMessages : [];
    const ids = [...new Set(messages.map((message) => text(message?.id || message?.messageId || message)).filter(Boolean))];
    if (!ids.length) return Promise.resolve({ ok: true, changed: false, mergedMessageIds: [], previousRevision: current.revision, revision: current.revision, checkpoint: clone(current.checkpoint) });
    const checkpoint = clone(current.checkpoint);
    const providedBoundary = input.boundary || input.transcriptBoundary || input.transcript_boundary;
    if (providedBoundary && typeof providedBoundary === "object") {
      try {
        checkpoint.transcript_boundary = createTranscriptBoundary({
          ...clone(providedBoundary),
          project_id: current.projectId,
          session_id: current.sessionId,
        });
      } catch (error) {
        return Promise.resolve(operationFailure(error.code || "MEMORY_CONTEXT_BOUNDARY_INVALID", error.message, error.details || {}));
      }
    }
    const existing = new Set(checkpoint.transcript_boundary?.message_ids || checkpoint.transcript_boundary?.messageIds || []);
    const newIds = ids.filter((id) => !existing.has(id));
    if (!newIds.length) return Promise.resolve({ ok: true, changed: false, mergedMessageIds: [], previousRevision: current.revision, revision: current.revision, checkpoint });
    checkpoint.transcript_boundary = checkpoint.transcript_boundary || checkpoint.transcriptBoundary || {};
    if (!providedBoundary) {
      checkpoint.transcript_boundary.message_ids = [...existing, ...newIds].slice(-500);
      checkpoint.transcript_boundary.message_count = Math.max(Number(checkpoint.transcript_boundary.message_count || 0), checkpoint.transcript_boundary.message_ids.length);
    }
    checkpoint.known_gaps = [...new Set([...(checkpoint.known_gaps || []), "Late transcript messages merged after checkpoint activation."])].slice(-200);
    // The boundary changed, so force the checkpoint constructor to derive a
    // new content hash instead of treating this as a duplicate activation.
    delete checkpoint.content_hash;
    return writeCheckpoint({
      ...input,
      projectId: current.projectId,
      sessionId: current.sessionId,
      expectedRevision: current.revision,
      operationId: input.operationId || input.operation_id || `op_late_${hashText(crypto, `${current.checkpoint.record_id}\u0000${newIds.join("\u0000")}`).slice(0, 32)}`,
      checkpoint,
    }).then((result) => result.ok ? { ...result, mergedMessageIds: newIds } : result);
  }

  function deleteSession(input = {}) {
    const resolved = scope(input, { persist: false });
    if (!resolved.ok) return Promise.resolve(resolved);
    return enqueue(resolved.projectId, resolved.sessionId, async () => {
      const current = read(resolved);
      if (!current.ok) return current;
      const operationId = createOpaqueId("op", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
      if (!current.exists && !current.initialized) {
        return {
          ok: true,
          operationId,
          recordIds: [],
          previousRevision: 0,
          revision: 0,
          changed: false,
          conflicts: [],
          warnings: [],
          deleted: false,
          projectId: resolved.projectId,
          sessionId: resolved.sessionId,
          path: resolved.path,
        };
      }
      try {
        fs.rmSync(resolved.path, { force: true });
        fs.rmSync(`${resolved.path}.bak`, { force: true });
      } catch (error) {
        return operationFailure("MEMORY_CONTEXT_DELETE_FAILED", `The Operational Context session could not be deleted: ${error.message}.`, { path: resolved.path }, true);
      }
      return {
        ok: true,
        operationId,
        recordIds: current.activeCheckpointId ? [current.activeCheckpointId] : [],
        previousRevision: current.revision,
        revision: current.revision + 1,
        changed: true,
        conflicts: [],
        warnings: [],
        deleted: true,
        projectId: resolved.projectId,
        sessionId: resolved.sessionId,
        path: resolved.path,
      };
    });
  }

  function expire(input = {}) {
    const projectId = resolveProjectId(input, { persist: false });
    if (!projectId) return Promise.resolve(operationFailure("MEMORY_PROJECT_ID_REQUIRED", "A protected proj_ project ID is required for Operational Context retention."));
    const retentionDays = Number(input.retentionDays ?? input.retention_days);
    if (!Number.isFinite(retentionDays) || retentionDays < 0) return Promise.resolve(operationFailure("MEMORY_CONTEXT_RETENTION_INVALID", "Operational Context retentionDays must be a non-negative number."));
    const current = input.nowAt instanceof Date ? input.nowAt : input.nowAt ? new Date(input.nowAt) : new Date(now());
    if (Number.isNaN(current.getTime())) return Promise.resolve(operationFailure("MEMORY_CONTEXT_RETENTION_DATE_INVALID", "The Operational Context retention clock returned an invalid date."));
    const excludedSessionId = text(input.excludeSessionId || input.exclude_session_id);
    const projectDirectory = path.join(memoryRoot, safeComponent(projectId, "project"));
    if (!fs.existsSync(projectDirectory)) return Promise.resolve({ ok: true, operationId: "", recordIds: [], previousRevision: 0, revision: 0, changed: false, conflicts: [], warnings: [], expiredSessions: [] });
    const cutoff = current.getTime() - retentionDays * 24 * 60 * 60 * 1_000;
    const expiredSessions = [];
    const warnings = [];
    try {
      const files = fs.readdirSync(projectDirectory).filter((name) => name.endsWith(".json") && !name.endsWith(".bak"));
      for (const name of files) {
        const target = path.join(projectDirectory, name);
        let envelope;
        try { envelope = JSON.parse(fs.readFileSync(target, "utf8")); } catch { warnings.push({ code: "MEMORY_CONTEXT_RETENTION_RECORD_INVALID", path: target }); continue; }
        let payload;
        try {
          if (envelope?.encrypted === true) {
            if (!secureAvailable()) { warnings.push({ code: "MEMORY_CONTEXT_ENCRYPTION_UNAVAILABLE", path: target }); continue; }
            payload = JSON.parse(protector.decrypt(String(envelope.payload || "")) || "{}");
          } else if (envelope?.encrypted === false) payload = envelope.payload;
        } catch { warnings.push({ code: "MEMORY_CONTEXT_RETENTION_RECORD_UNREADABLE", path: target }); continue; }
        if (!payload || payload.project_id !== projectId) { warnings.push({ code: "MEMORY_PROJECT_MISMATCH", path: target }); continue; }
        const sessionId = text(payload.session_id);
        if (!sessionId || sessionId === excludedSessionId) continue;
        const updatedAt = Date.parse(String(payload.updated_at || ""));
        if (!Number.isFinite(updatedAt) || updatedAt > cutoff) continue;
        try {
          fs.rmSync(target, { force: true });
          fs.rmSync(`${target}.bak`, { force: true });
          expiredSessions.push(sessionId);
        } catch (error) {
          warnings.push({ code: "MEMORY_CONTEXT_RETENTION_DELETE_FAILED", path: target, message: text(error.message, 500) });
        }
      }
    } catch (error) {
      return operationFailure("MEMORY_CONTEXT_RETENTION_SCAN_FAILED", `Operational Context retention could not be scanned: ${error.message}.`, { path: projectDirectory }, true);
    }
    const uniqueSessions = [...new Set(expiredSessions)].sort();
    return Promise.resolve({
      ok: warnings.length === 0,
      operationId: uniqueSessions.length ? createOpaqueId("op", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }) : "",
      recordIds: [],
      previousRevision: 0,
      revision: 0,
      changed: uniqueSessions.length > 0,
      conflicts: [],
      warnings: warnings.slice(0, 100),
      expiredSessions: uniqueSessions,
    });
  }

  function status(input = {}) {
    const result = read(input);
    if (!result.ok) return result;
    return {
      ok: true,
      initialized: result.initialized,
      exists: result.exists,
      projectId: result.projectId,
      sessionId: result.sessionId,
      revision: result.revision,
      activeCheckpointId: result.activeCheckpointId,
      historyCount: result.history.length,
      recovered: result.recovered,
      warning: result.warning,
      path: result.path,
    };
  }

  function active(input = {}) { return read(input); }
  function flush() { return Promise.all([...queues.values()].map((pending) => pending.catch(() => null))).then(() => ({ ok: true })); }

  return Object.freeze({
    OPERATIONAL_CONTEXT_STORE_VERSION,
    MAX_CHECKPOINT_HISTORY,
    fileFor,
    read,
    active,
    status,
    writeCheckpoint,
    mergeLate,
    deleteSession,
    remove: deleteSession,
    expire,
    flush,
  });
}

module.exports = Object.freeze({ createOperationalContextStore, OPERATIONAL_CONTEXT_STORE_VERSION, MAX_CHECKPOINT_HISTORY });
