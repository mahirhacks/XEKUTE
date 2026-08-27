"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/index.js");
const { createAssignmentLease } = require("../../../contracts/memory/multi-agent-contracts.js");
const {
  atomicWriteJson,
  clone,
  hashText,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("../../storage/memory/memory-storage-utils.js");

const ASSIGNMENT_LEASE_SERVICE_VERSION = 1;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1_000;
const MAX_LEASE_TTL_MS = 15 * 60 * 1_000;
const MAX_RETAINED_OPERATIONS = 1_000;

function text(value, maximum = 240) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function clockDate(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("The assignment lease clock returned an invalid date.");
  return date;
}

function operationIdFor(crypto, idFactory, supplied = "") {
  if (supplied) return assertMemoryId(supplied, "op");
  return createOpaqueId("op", { uuid: idFactory || (() => crypto.randomUUID()) });
}

function cloneLease(lease) {
  return lease && typeof lease === "object" ? clone(lease) : null;
}

function createInvestigationAssignmentLeaseService({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir = "",
  now = () => new Date(),
  enabled = true,
  idFactory = null,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Assignment lease service dependencies are required.");
  const memory = new Map();
  const queues = new Map();
  const rootBase = baseDir ? path.resolve(String(baseDir)) : "";

  function isEnabled() { return enabled !== false; }

  function scope(workspace, projectId) {
    const root = resolvedWorkspace(path, workspace);
    const project = assertMemoryId(projectId, "proj");
    return { root, project, key: `${root}|${project}` };
  }

  function fileFor(project, root) {
    const directory = rootBase
      ? path.join(rootBase, "memory", "investigation-leases")
      : path.join(root, ".xekute", "memory", "investigation-leases");
    return path.join(directory, `${hashText(crypto, project)}.json`);
  }

  function emptyState(project) {
    return {
      schema_version: ASSIGNMENT_LEASE_SERVICE_VERSION,
      project_id: project,
      revision: 0,
      leases: [],
      processed_operations: [],
      updated_at: timestamp(now),
    };
  }

  function normalizeState(value, project) {
    const state = value && typeof value === "object" ? value : {};
    if (String(state.project_id || "") !== project) throw Object.assign(new Error("The assignment lease file belongs to another project."), { code: "MEMORY_PROJECT_MISMATCH" });
    const leases = Array.isArray(state.leases) ? state.leases.map((entry) => {
      try {
        return clone(createAssignmentLease(entry, { idFactory: idFactory || (() => crypto.randomUUID()), now }));
      } catch (error) {
        throw Object.assign(new Error(`Assignment lease record is invalid: ${error.message}`), { code: error.code || "MEMORY_ASSIGNMENT_LEASE_CORRUPT" });
      }
    }) : [];
    return {
      schema_version: ASSIGNMENT_LEASE_SERVICE_VERSION,
      project_id: project,
      revision: Math.max(0, Number.isSafeInteger(Number(state.revision)) ? Number(state.revision) : 0),
      leases,
      processed_operations: Array.isArray(state.processed_operations)
        ? state.processed_operations.slice(-MAX_RETAINED_OPERATIONS).map((entry) => clone(entry))
        : [],
      updated_at: text(state.updated_at || timestamp(now), 80),
    };
  }

  function load(scopeInfo) {
    const cached = memory.get(scopeInfo.key);
    if (cached) return { ok: true, state: cached, source: "cache", exists: true };
    const file = fileFor(scopeInfo.project, scopeInfo.root);
    const read = readJsonWithBackup({ fs }, file);
    if (!read.ok) return operationFailure("MEMORY_ASSIGNMENT_LEASE_READ_FAILED", read.error?.message || "The assignment lease store could not be read.", { path: file }, true);
    let state;
    try { state = read.exists ? normalizeState(read.value, scopeInfo.project) : emptyState(scopeInfo.project); } catch (error) {
      return operationFailure(error.code || "MEMORY_ASSIGNMENT_LEASE_CORRUPT", error.message, { path: file }, true);
    }
    memory.set(scopeInfo.key, state);
    return { ok: true, state, source: read.exists ? (read.recovered ? "backup" : "disk") : "empty", exists: read.exists, recovered: Boolean(read.recovered), warning: read.warning || "", path: file };
  }

  function persist(scopeInfo, state) {
    const file = fileFor(scopeInfo.project, scopeInfo.root);
    try {
      const saved = atomicWriteJson({ fs, path, crypto }, file, state, { backup: true });
      memory.set(scopeInfo.key, state);
      return { ok: true, path: saved.path, backupPath: saved.backupPath };
    } catch (error) {
      return operationFailure("MEMORY_ASSIGNMENT_LEASE_WRITE_FAILED", error.message, { path: file }, true);
    }
  }

  function enqueue(scopeInfo, operation) {
    const previous = queues.get(scopeInfo.key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(scopeInfo.key) === queued) queues.delete(scopeInfo.key); });
    queues.set(scopeInfo.key, queued);
    return queued;
  }

  function safeOwner(lease) {
    return { agent_id: lease.agent_id, session_id: lease.session_id, lease_id: lease.lease_id, state: lease.state, expires_at: lease.expires_at };
  }

  function operationReplay(state, operationId) {
    const found = state.processed_operations.find((entry) => entry.operation_id === operationId);
    return found?.result ? { ...clone(found.result), replayed: true } : null;
  }

  function recordOperation(state, operationId, result) {
    state.processed_operations = [
      ...state.processed_operations.filter((entry) => entry.operation_id !== operationId),
      { operation_id: operationId, revision: state.revision, result: clone(result) },
    ].slice(-MAX_RETAINED_OPERATIONS);
  }

  function mutationResult(operationId, previousRevision, revision, lease, { changed = true, warnings = [], conflicts = [] } = {}) {
    return {
      ok: true,
      operationId,
      recordIds: lease ? [lease.lease_id] : [],
      previousRevision,
      revision,
      changed,
      conflicts: clone(conflicts),
      warnings: clone(warnings),
      lease: cloneLease(lease),
    };
  }

  function expireState(state, at = clockDate(now)) {
    const current = at.getTime();
    const expired = [];
    for (let index = 0; index < state.leases.length; index += 1) {
      const lease = state.leases[index];
      if (lease.state !== "active" || new Date(lease.expires_at).getTime() > current) continue;
      const next = createAssignmentLease({
        ...lease,
        state: "expired",
        released_at: new Date(current).toISOString(),
        release_reason: "lease_expired",
        heartbeat_at: lease.heartbeat_at || lease.issued_at,
      }, { idFactory: idFactory || (() => crypto.randomUUID()), now });
      state.leases[index] = clone(next);
      expired.push(clone(next));
    }
    return expired;
  }

  function inputScope(input = {}) {
    try {
      const workspace = text(input.workspace, 4_000);
      if (!workspace) return operationFailure("MEMORY_ASSIGNMENT_WORKSPACE_REQUIRED", "A workspace is required for assignment leases.");
      return { ok: true, scope: scope(workspace, input.project_id || input.projectId) };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_ASSIGNMENT_INPUT_INVALID", error.message, error.details || {});
    }
  }

  function ownerMatches(lease, input = {}) {
    const agent = text(input.agent_id || input.agentId, 240);
    const session = text(input.session_id || input.sessionId, 240);
    return Boolean(agent && session && lease.agent_id === agent && lease.session_id === session);
  }

  async function acquire(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const resolved = inputScope(input);
    if (!resolved.ok) return resolved;
    const info = resolved.scope;
    return enqueue(info, async () => {
      const loaded = load(info);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const operationId = operationIdFor(crypto, idFactory, input.operation_id || input.operationId || "");
      const replay = operationReplay(state, operationId);
      if (replay) return replay;
      const expired = expireState(state);
      const investigationId = (() => { try { return assertMemoryId(input.investigation_id || input.investigationId, "inv"); } catch { return ""; } })();
      const testCaseId = (() => { try { return assertMemoryId(input.test_case_id || input.testCaseId, "inv"); } catch { return ""; } })();
      if (!investigationId || !testCaseId) return operationFailure("MEMORY_ASSIGNMENT_REFERENCE_INVALID", "A valid Investigation and test-case reference are required.");
      const agentId = text(input.agent_id || input.agentId, 240);
      const sessionId = text(input.session_id || input.sessionId, 240);
      if (!agentId || !sessionId) return operationFailure("MEMORY_ASSIGNMENT_OWNER_REQUIRED", "An agent and session are required for assignment ownership.");
      const active = state.leases.find((lease) => lease.state === "active" && lease.exclusive && lease.test_case_id === testCaseId);
      if (active) {
        if (ownerMatches(active, input)) {
          const warnings = expired.length ? [{ code: "MEMORY_ASSIGNMENT_LEASES_EXPIRED", count: expired.length }] : [];
          return mutationResult(operationId, state.revision, state.revision, active, { changed: false, warnings });
        }
        return operationFailure("MEMORY_ASSIGNMENT_ALREADY_LEASED", "The exclusive test case is already assigned to another agent.", { owner: safeOwner(active), testCaseId }, true);
      }
      const issuedAt = clockDate(now);
      const requestedTtl = Number(input.ttl_ms ?? input.ttlMs ?? DEFAULT_LEASE_TTL_MS);
      const ttl = Math.max(1_000, Math.min(MAX_LEASE_TTL_MS, Number.isFinite(requestedTtl) ? requestedTtl : DEFAULT_LEASE_TTL_MS));
      const lease = createAssignmentLease({
        project_id: info.project,
        investigation_id: investigationId,
        test_case_id: testCaseId,
        agent_id: agentId,
        session_id: sessionId,
        assignment_id: input.assignment_id || input.assignmentId || "",
        exclusive: input.exclusive !== false,
        state: "active",
        issued_at: issuedAt,
        expires_at: new Date(issuedAt.getTime() + ttl),
        heartbeat_at: issuedAt,
      }, { idFactory: idFactory || (() => crypto.randomUUID()), now });
      const previousRevision = state.revision;
      state.leases.push(clone(lease));
      state.revision += 1;
      state.updated_at = timestamp(now);
      const result = mutationResult(operationId, previousRevision, state.revision, lease, { warnings: expired.map((entry) => ({ code: "MEMORY_ASSIGNMENT_LEASE_EXPIRED", leaseId: entry.lease_id })) });
      recordOperation(state, operationId, result);
      const saved = persist(info, state);
      if (!saved.ok) return saved;
      return { ...result, storage: saved };
    });
  }

  async function renew(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const resolved = inputScope(input);
    if (!resolved.ok) return resolved;
    const info = resolved.scope;
    return enqueue(info, async () => {
      const loaded = load(info);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const operationId = operationIdFor(crypto, idFactory, input.operation_id || input.operationId || "");
      const replay = operationReplay(state, operationId);
      if (replay) return replay;
      expireState(state);
      const leaseId = text(input.lease_id || input.leaseId, 240);
      const index = state.leases.findIndex((entry) => entry.lease_id === leaseId);
      if (index < 0) return operationFailure("MEMORY_ASSIGNMENT_LEASE_NOT_FOUND", "The assignment lease was not found.");
      const current = state.leases[index];
      if (!ownerMatches(current, input)) return operationFailure("MEMORY_ASSIGNMENT_OWNER_MISMATCH", "Only the owning agent session can renew an assignment lease.");
      if (current.state !== "active") return operationFailure("MEMORY_ASSIGNMENT_LEASE_INACTIVE", "Only an active assignment lease can be renewed.");
      const issuedAt = clockDate(now);
      const requestedTtl = Number(input.ttl_ms ?? input.ttlMs ?? DEFAULT_LEASE_TTL_MS);
      const ttl = Math.max(1_000, Math.min(MAX_LEASE_TTL_MS, Number.isFinite(requestedTtl) ? requestedTtl : DEFAULT_LEASE_TTL_MS));
      const next = createAssignmentLease({ ...current, heartbeat_at: issuedAt, expires_at: new Date(issuedAt.getTime() + ttl) }, { idFactory: idFactory || (() => crypto.randomUUID()), now });
      const previousRevision = state.revision;
      state.leases[index] = clone(next);
      state.revision += 1;
      state.updated_at = timestamp(now);
      const result = mutationResult(operationId, previousRevision, state.revision, next);
      recordOperation(state, operationId, result);
      const saved = persist(info, state);
      if (!saved.ok) return saved;
      return { ...result, storage: saved };
    });
  }

  async function release(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const resolved = inputScope(input);
    if (!resolved.ok) return resolved;
    const info = resolved.scope;
    return enqueue(info, async () => {
      const loaded = load(info);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const operationId = operationIdFor(crypto, idFactory, input.operation_id || input.operationId || "");
      const replay = operationReplay(state, operationId);
      if (replay) return replay;
      const leaseId = text(input.lease_id || input.leaseId, 240);
      const index = state.leases.findIndex((entry) => entry.lease_id === leaseId);
      if (index < 0) return operationFailure("MEMORY_ASSIGNMENT_LEASE_NOT_FOUND", "The assignment lease was not found.");
      const current = state.leases[index];
      const operator = String(input.actor_type || input.actorType || "") === "operator";
      if (!operator && !ownerMatches(current, input)) return operationFailure("MEMORY_ASSIGNMENT_OWNER_MISMATCH", "Only the owning agent session or an operator can release an assignment lease.");
      if (["released", "expired", "cancelled"].includes(current.state)) {
        return mutationResult(operationId, state.revision, state.revision, current, { changed: false });
      }
      const next = createAssignmentLease({ ...current, state: "released", released_at: clockDate(now), release_reason: text(input.reason || input.release_reason || "released", 500) || "released" }, { idFactory: idFactory || (() => crypto.randomUUID()), now });
      const previousRevision = state.revision;
      state.leases[index] = clone(next);
      state.revision += 1;
      state.updated_at = timestamp(now);
      const result = mutationResult(operationId, previousRevision, state.revision, next);
      recordOperation(state, operationId, result);
      const saved = persist(info, state);
      if (!saved.ok) return saved;
      return { ...result, storage: saved };
    });
  }

  async function expire(input = {}) {
    if (!isEnabled()) return { ok: true, enabled: false, skipped: true, changed: false, expired: [] };
    const resolved = inputScope(input);
    if (!resolved.ok) return resolved;
    const info = resolved.scope;
    return enqueue(info, async () => {
      const loaded = load(info);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const expired = expireState(state, input.at ? clockDate(() => new Date(input.at)) : clockDate(now));
      if (!expired.length) return { ok: true, operationId: text(input.operation_id || input.operationId, 240), previousRevision: state.revision, revision: state.revision, changed: false, expired: [], warnings: [] };
      const previousRevision = state.revision;
      state.revision += 1;
      state.updated_at = timestamp(now);
      const operationId = operationIdFor(crypto, idFactory, input.operation_id || input.operationId || "");
      const result = { ok: true, operationId, recordIds: expired.map((entry) => entry.lease_id), previousRevision, revision: state.revision, changed: true, conflicts: [], warnings: [], expired: expired.map(cloneLease) };
      recordOperation(state, operationId, result);
      const saved = persist(info, state);
      if (!saved.ok) return saved;
      return { ...result, storage: saved };
    });
  }

  async function list(input = {}) {
    const resolved = inputScope(input);
    if (!resolved.ok) return resolved;
    const loaded = load(resolved.scope);
    if (!loaded.ok) return loaded;
    const state = loaded.state;
    const expired = expireState(state);
    if (expired.length) {
      state.revision += 1;
      state.updated_at = timestamp(now);
      const saved = persist(resolved.scope, state);
      if (!saved.ok) return saved;
    }
    const includeInactive = input.include_inactive === true || input.includeInactive === true;
    const leases = state.leases.filter((entry) => includeInactive || entry.state === "active").map(cloneLease);
    return { ok: true, projectId: resolved.scope.project, revision: state.revision, leases, warnings: expired.map((entry) => ({ code: "MEMORY_ASSIGNMENT_LEASE_EXPIRED", leaseId: entry.lease_id })) };
  }

  async function status(input = {}) {
    const listed = await list({ ...input, includeInactive: true });
    if (!listed.ok) return listed;
    return { ok: true, enabled: isEnabled(), projectId: listed.projectId, revision: listed.revision, active: listed.leases.filter((entry) => entry.state === "active").length, leases: listed.leases, warnings: listed.warnings || [] };
  }

  return Object.freeze({
    ASSIGNMENT_LEASE_SERVICE_VERSION,
    DEFAULT_LEASE_TTL_MS,
    MAX_LEASE_TTL_MS,
    enabled: isEnabled,
    acquire,
    renew,
    release,
    expire,
    list,
    status,
    pathFor: (workspace, projectId) => {
      const info = scope(workspace, projectId);
      return fileFor(info.project, info.root);
    },
  });
}

module.exports = Object.freeze({
  ASSIGNMENT_LEASE_SERVICE_VERSION,
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
  createInvestigationAssignmentLeaseService,
});
