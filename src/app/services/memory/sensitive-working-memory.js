"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId } = require("../../../contracts/memory/memory-identity.js");
const {
  createSensitiveHandle,
  createSensitiveLease,
  createSensitiveAuditRecord,
  SENSITIVE_ENTRY_TYPES,
} = require("../../../contracts/memory/sensitive-contracts.js");
const {
  atomicWriteJson,
  readJsonWithBackup,
  timestamp,
  safeComponent,
} = require("../../storage/memory/memory-storage-utils.js");
const {
  createSensitiveCookieJar,
  normalizeCookie,
  parseSetCookie,
  cookieScopeKey,
  isExpired,
} = require("./sensitive-cookie-jar.js");

const CONTAINER_VERSION = 1;
const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_HANDLE_TTL_MS = 60 * 60 * 1_000;
const MAX_ENTRIES = 5_000;
const MAX_AUDIT_RECORDS = 2_000;
const MAX_SECRET_BYTES = 512 * 1_024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const PRIVATE_KEY_MARKER = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|(?:private[_-]?key|client[_-]?private[_-]?key)\s*:/i;

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "", maximum = 2_000) {
  return String(value == null ? fallback : value).replace(/[\u0000\r\n]/g, " ").slice(0, maximum);
}

function errorResult(error, fallbackCode = "MEMORY_SENSITIVE_OPERATION_FAILED", retryable = false) {
  return {
    ok: false,
    code: String(error?.code || fallbackCode),
    error: String(error?.message || error || "Sensitive Working Memory operation failed."),
    retryable: Boolean(error?.retryable || retryable),
    details: error?.details && typeof error.details === "object" ? clone(error.details) : {},
  };
}

function assertTrusted(input = {}) {
  if (input.trusted === true) return true;
  const error = new Error("Raw Sensitive Working Memory values are available only to trusted adapters.");
  error.code = "MEMORY_SENSITIVE_TRUST_REQUIRED";
  throw error;
}

function secretClone(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    const error = new Error("A sensitive value must be JSON-compatible and defined.");
    error.code = "MEMORY_SENSITIVE_VALUE_INVALID";
    throw error;
  }
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (raw === undefined) {
    const error = new Error("A sensitive value must be JSON-compatible.");
    error.code = "MEMORY_SENSITIVE_VALUE_INVALID";
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_SECRET_BYTES) {
    const error = new Error(`A sensitive value exceeds the ${MAX_SECRET_BYTES}-byte limit.`);
    error.code = "MEMORY_SENSITIVE_VALUE_TOO_LARGE";
    throw error;
  }
  return typeof value === "string" ? String(value) : JSON.parse(raw);
}

function secretJson(value) { return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value); }

function validSecretId(value) { return SAFE_ID.test(String(value || "")); }

function validProjectId(value) {
  try { return Boolean(assertMemoryId(value, "proj")); }
  catch { return false; }
}

function nowDate(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("The Sensitive Working Memory clock returned an invalid date.");
  return date;
}

function safeAuthorityDecision(value) {
  if (!value || (value.ok !== true && value.authorized !== true)) return { ok: false, code: "AUTHORITY_REQUIRED" };
  return {
    ok: true,
    code: text(value.code || value.policy || "authorized", "authorized", 120),
    policy: text(value.policy || "", "", 240),
  };
}

function sourceProvenance(input = {}, source = "runtime_event", reference = "sensitive-working-memory") {
  const allowed = new Set(["tool_result", "runtime_event", "operator_assertion", "project_profile", "import", "canonical_derivation", "artifact"]);
  const sourceType = allowed.has(String(input.provenance?.source_type || input.provenance?.sourceType || ""))
    ? String(input.provenance.source_type || input.provenance.sourceType)
    : source === "operator" ? "operator_assertion" : "runtime_event";
  const refs = Array.isArray(input.provenance?.source_refs || input.provenance?.sourceRefs)
    ? (input.provenance.source_refs || input.provenance.sourceRefs).map((value) => text(value, "", 240)).filter(Boolean).slice(0, 20)
    : [];
  if (!refs.length) refs.push(text(input.sourceRef || input.blockId || input.operationId || reference, reference, 240));
  return { source_type: sourceType, source_refs: refs };
}

function actorOf(input = {}) {
  return isRecord(input.actor) && input.actor.type && input.actor.id
    ? { type: text(input.actor.type, "tool", 40), id: text(input.actor.id, "sensitive-working-memory", 240) }
    : { type: "tool", id: "sensitive-working-memory" };
}

function originMatches(url, configuredOrigin) {
  try {
    const actual = new URL(String(url || ""));
    const expected = new URL(String(configuredOrigin || ""));
    const expectedPath = expected.pathname.replace(/\/+$/, "") || "/";
    return actual.protocol === expected.protocol && actual.host === expected.host
      && (expectedPath === "/" || actual.pathname === expectedPath || actual.pathname.startsWith(`${expectedPath}/`));
  } catch { return false; }
}

function metadataForEntry(entry) {
  return clone(entry?.handle || {});
}

function createSensitiveWorkingMemory({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir,
  protector = null,
  projectResolver = null,
  now = () => new Date(),
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  handleTtlMs = DEFAULT_HANDLE_TTL_MS,
} = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Sensitive Working Memory dependencies are required.");

  const rootDir = path.resolve(String(baseDir));
  const projects = new Map();
  const leases = new Map();
  let closed = false;

  function timestampNow() { return nowDate(now).toISOString(); }
  function uuid() { return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID(); }
  function operationId() { return createOpaqueId("op", { uuid }); }
  function handleId() { return createOpaqueId("sel", { uuid }); }
  function auditId() { return createOpaqueId("event", { uuid }); }
  function secureAvailable() {
    try { return Boolean(protector?.available?.()); } catch { return false; }
  }
  function fileForProject(projectId) {
    const safe = safeComponent(String(projectId || "")).slice(0, 80) || "project";
    return path.join(rootDir, `${safe}-${crypto.createHash("sha256").update(String(projectId || ""), "utf8").digest("hex").slice(0, 24)}.json`);
  }
  function encrypt(value) {
    if (!secureAvailable()) throw Object.assign(new Error("Secure storage is unavailable."), { code: "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE" });
    const encrypted = protector.encrypt(secretJson(value));
    if (Buffer.isBuffer(encrypted)) return encrypted.toString("base64");
    const result = String(encrypted || "");
    if (!result) throw Object.assign(new Error("Secure storage returned an empty ciphertext."), { code: "MEMORY_SENSITIVE_ENCRYPTION_FAILED" });
    return result;
  }
  function decrypt(value) {
    if (!secureAvailable()) throw Object.assign(new Error("Secure storage is unavailable."), { code: "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE" });
    const decoded = protector.decrypt(String(value || ""));
    return JSON.parse(String(decoded || ""));
  }

  function resolveProjectId(input = {}, { persist = true } = {}) {
    const requested = String(input.projectId || input.project_id || "").trim();
    if (requested) {
      if (!validProjectId(requested)) throw Object.assign(new Error("A protected proj_ project ID is required."), { code: "MEMORY_PROJECT_ID_INVALID", details: { projectId: requested } });
      return requested;
    }
    const workspace = String(input.workspace || "").trim();
    if (workspace && typeof projectResolver === "function") {
      const resolved = projectResolver(workspace, { persist });
      const projectId = typeof resolved === "string" ? resolved : resolved?.projectId || resolved?.project_id;
      if (validProjectId(projectId)) return String(projectId);
      throw Object.assign(new Error("The protected project registry returned an invalid project ID."), { code: "MEMORY_PROJECT_ID_INVALID" });
    }
    throw Object.assign(new Error("project_id or a resolvable workspace is required."), { code: "MEMORY_PROJECT_REQUIRED" });
  }

  function contextOf(input = {}, options = {}) {
    const projectId = resolveProjectId(input, options);
    const sessionId = text(input.sessionId || input.session_id, "", 240).trim();
    const agentId = text(input.agentId || input.agent_id, "", 240).trim();
    if (!sessionId) throw Object.assign(new Error("session_id is required."), { code: "MEMORY_SESSION_REQUIRED" });
    if (!agentId) throw Object.assign(new Error("agent_id is required."), { code: "MEMORY_AGENT_REQUIRED" });
    return {
      projectId,
      sessionId,
      agentId,
      identityId: text(input.identityId || input.identity_id, "", 240),
      browserContext: text(input.browserContext || input.browser_context, "", 240),
      origin: text(input.origin, "", 2_000),
    };
  }

  function emptyState(projectId, mode = secureAvailable() ? "encrypted" : "process_only") {
    return {
      projectId,
      mode,
      revision: 0,
      entries: new Map(),
      audits: [],
      warning: "",
      loaded: true,
    };
  }

  function normalizeStoredAudit(value, projectId) {
    if (!isRecord(value) || value.project_id !== projectId || value.record_type !== "sensitive_audit") return null;
    try {
      return createSensitiveAuditRecord({
        ...value,
        project_id: projectId,
        record_id: value.record_id,
        session_id: value.session_id,
        agent_id: value.agent_id,
        handle_ids: value.handle_ids || [],
        lease_id: value.lease_id || "",
        purpose: value.purpose || "",
        adapter: value.adapter || "",
        decision: value.decision || {},
        outcome: value.outcome,
        recorded_at: value.recorded_at,
        actor: value.actor,
        provenance: value.provenance,
      }, { idFactory: auditId, now });
    } catch { return null; }
  }

  function loadProject(projectId) {
    const existing = projects.get(projectId);
    if (existing) return { ok: true, state: existing };
    const file = fileForProject(projectId);
    if (!fs.existsSync(file)) {
      const state = emptyState(projectId);
      projects.set(projectId, state);
      return { ok: true, state };
    }
    if (!secureAvailable()) return errorResult(Object.assign(new Error("An encrypted Sensitive Working Memory container exists but secure storage is unavailable."), { code: "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE" }), "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE");
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return errorResult(Object.assign(new Error(`The sensitive container could not be read: ${loaded.error?.message || "invalid JSON"}.`), { code: "MEMORY_SENSITIVE_CONTAINER_CORRUPT" }), "MEMORY_SENSITIVE_CONTAINER_CORRUPT", true);
    try {
      if (loaded.value?.encrypted !== true || Number(loaded.value?.version) !== CONTAINER_VERSION) throw Object.assign(new Error("The sensitive container is not an encrypted supported version."), { code: "MEMORY_SENSITIVE_CONTAINER_INVALID" });
      const value = decrypt(loaded.value.payload);
      if (!isRecord(value) || value.project_id !== projectId) throw Object.assign(new Error("The sensitive container belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH" });
      const state = emptyState(projectId, "encrypted");
      state.revision = Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
      state.warning = loaded.warning || "";
      for (const stored of Array.isArray(value.entries) ? value.entries.slice(0, MAX_ENTRIES) : []) {
        if (!isRecord(stored) || !isRecord(stored.handle) || !stored.protected_value) continue;
        try {
          const handle = createSensitiveHandle(stored.handle, { idFactory: handleId, now });
          state.entries.set(handle.handle_id, {
            handle,
            protectedValue: String(stored.protected_value),
            rawValue: undefined,
            cookieKey: text(stored.cookie_key, "", 2_000),
          });
        } catch { /* A malformed entry is ignored; the encrypted container remains bounded and usable. */ }
      }
      state.audits = (Array.isArray(value.audits) ? value.audits : []).map((audit) => normalizeStoredAudit(audit, projectId)).filter(Boolean).slice(-MAX_AUDIT_RECORDS);
      projects.set(projectId, state);
      return { ok: true, state };
    } catch (error) {
      return errorResult(error, "MEMORY_SENSITIVE_CONTAINER_CORRUPT", true);
    }
  }

  function serializableState(state) {
    return {
      version: CONTAINER_VERSION,
      project_id: state.projectId,
      revision: state.revision,
      updated_at: timestampNow(),
      entries: [...state.entries.values()].map((entry) => ({
        handle: clone(entry.handle),
        protected_value: String(entry.protectedValue || ""),
        cookie_key: text(entry.cookieKey, "", 2_000),
      })).filter((entry) => entry.protected_value),
      audits: state.audits.map((audit) => clone(audit)).slice(-MAX_AUDIT_RECORDS),
    };
  }

  function persistState(state) {
    if (state.mode === "process_only") return { ok: true, persisted: false, mode: "process_only" };
    if (!secureAvailable()) return errorResult(Object.assign(new Error("Secure storage became unavailable; the encrypted sensitive state was not written."), { code: "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE" }), "MEMORY_SENSITIVE_SECURE_STORAGE_UNAVAILABLE", true);
    try {
      const envelope = { version: CONTAINER_VERSION, encrypted: true, payload: encrypt(serializableState(state)) };
      // Do not retain backups of old ciphertext for a sensitive container.
      // Atomic replacement still protects against partial writes while an old
      // encrypted snapshot is not left behind after rotation or revocation.
      atomicWriteJson({ fs, path, crypto }, fileForProject(state.projectId), envelope, { backup: false });
      return { ok: true, persisted: true, mode: "encrypted" };
    } catch (error) {
      return errorResult(Object.assign(error, { code: error.code || "MEMORY_SENSITIVE_CONTAINER_WRITE_FAILED" }), "MEMORY_SENSITIVE_CONTAINER_WRITE_FAILED", true);
    }
  }

  function mutationResult(operation, state, previousRevision, changed, recordIds = [], warnings = []) {
    return {
      ok: true,
      operationId: operation,
      recordIds: [...new Set(recordIds.filter(Boolean))],
      previousRevision,
      revision: state.revision,
      changed: Boolean(changed),
      conflicts: [],
      warnings: warnings.filter(Boolean),
      persisted: state.mode === "encrypted",
      storageMode: state.mode,
    };
  }

  function addAudit(state, input, { handleIds = [], leaseId = "", outcome, decision = {} } = {}) {
    const record = createSensitiveAuditRecord({
      project_id: state.projectId,
      session_id: input.sessionId || input.session_id,
      agent_id: input.agentId || input.agent_id,
      handle_ids: handleIds,
      lease_id: leaseId,
      purpose: input.purpose || "",
      adapter: input.adapter || input.toolName || input.tool_name || "",
      decision: safeAuthorityDecision(decision),
      outcome,
      actor: actorOf(input),
      provenance: sourceProvenance(input, input.source || "runtime_event", leaseId || input.operationId || "sensitive-audit"),
      recorded_at: timestampNow(),
    }, { idFactory: uuid, now });
    state.audits.push(record);
    state.audits = state.audits.slice(-MAX_AUDIT_RECORDS);
    return record;
  }

  function entryUsable(entry, date = nowDate(now)) {
    if (!entry?.handle || !["active", "rotated"].includes(entry.handle.state)) return false;
    return new Date(entry.handle.expires_at).getTime() > date.getTime();
  }

  function entryMatchesContext(entry, context, { allowDelegation = false } = {}) {
    if (!entry?.handle || entry.handle.project_id !== context.projectId || entry.handle.session_id !== context.sessionId) return false;
    if (entry.handle.agent_id === context.agentId) return true;
    return allowDelegation && entry.handle.delegation?.allowed === true;
  }

  function findEntry(state, id) { return state.entries.get(String(id || "")) || null; }

  function valueForEntry(entry) {
    if (entry.rawValue !== undefined) return secretClone(entry.rawValue);
    if (!entry.protectedValue) throw Object.assign(new Error("Sensitive value is unavailable."), { code: "MEMORY_SENSITIVE_VALUE_UNAVAILABLE" });
    return secretClone(decrypt(entry.protectedValue));
  }

  function storeValue(value) {
    const secret = secretClone(value);
    if (secureAvailable()) return { protectedValue: encrypt(secret), rawValue: undefined, mode: "encrypted" };
    return { protectedValue: "", rawValue: secret, mode: "process_only" };
  }

  function buildHandle(input, context, entryType, id, state = "active", generation = 0) {
    const current = nowDate(now);
    const expiresAt = input.expiresAt || input.expires_at || new Date(current.getTime() + Math.max(1, Number(handleTtlMs) || DEFAULT_HANDLE_TTL_MS)).toISOString();
    return createSensitiveHandle({
      handle_id: id,
      project_id: context.projectId,
      session_id: context.sessionId,
      agent_id: context.agentId,
      identity_id: context.identityId,
      entry_type: entryType,
      origin: input.origin || context.origin,
      browser_context: input.browserContext || input.browser_context || context.browserContext,
      state,
      generation,
      created_at: input.createdAt || input.created_at || current.toISOString(),
      updated_at: current.toISOString(),
      expires_at: expiresAt,
      delegation: input.delegation || { allowed: false },
      metadata: input.metadata || {},
      actor: actorOf(input),
      provenance: sourceProvenance(input, input.source || "runtime_event", input.sourceRef || id),
    }, { idFactory: handleId, now });
  }

  function put(input = {}) {
    try {
      if (closed) throw Object.assign(new Error("Sensitive Working Memory is closed."), { code: "MEMORY_SENSITIVE_STORE_CLOSED" });
      assertTrusted(input);
      const context = contextOf(input, { persist: true });
      const entryType = String(input.entryType || input.entry_type || input.secretType || input.secret_type || "").toLowerCase();
      if (!SENSITIVE_ENTRY_TYPES.includes(entryType)) throw Object.assign(new Error(`Unsupported sensitive entry type: ${entryType || "<empty>"}.`), { code: "MEMORY_SENSITIVE_TYPE_INVALID" });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      if (state.entries.size >= MAX_ENTRIES) throw Object.assign(new Error("The Sensitive Working Memory entry limit has been reached."), { code: "MEMORY_SENSITIVE_LIMIT_REACHED" });
      const operation = operationId();
      const id = input.handleId || input.handle_id || handleId();
      if (!/^sel_/.test(String(id))) throw Object.assign(new Error("Sensitive handles must use the sel_ prefix."), { code: "MEMORY_SENSITIVE_HANDLE_INVALID" });
      if (state.entries.has(id)) throw Object.assign(new Error("The sensitive handle already exists."), { code: "MEMORY_SENSITIVE_HANDLE_EXISTS" });
      const handle = buildHandle({ ...input, operationId: operation }, context, entryType, id);
      const stored = storeValue(input.value);
      const entry = { handle, ...stored, cookieKey: text(input.cookieKey || input.cookie_key, "", 2_000) };
      state.entries.set(id, entry);
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: input.purpose || "entry_created" }, { handleIds: [id], outcome: "stored" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return { ...mutationResult(operation, state, previousRevision, true, [id]), handle: clone(handle) };
    } catch (error) { return errorResult(error); }
  }

  function rotate(input = {}) {
    try {
      if (closed) throw Object.assign(new Error("Sensitive Working Memory is closed."), { code: "MEMORY_SENSITIVE_STORE_CLOSED" });
      assertTrusted(input);
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const id = String(input.handleId || input.handle_id || "");
      const entry = findEntry(state, id);
      if (!entry) throw Object.assign(new Error("The sensitive handle was not found."), { code: "MEMORY_SENSITIVE_HANDLE_NOT_FOUND" });
      if (!entryMatchesContext(entry, context, { allowDelegation: false })) throw Object.assign(new Error("The sensitive handle is bound to another session or agent."), { code: "MEMORY_SENSITIVE_BINDING_MISMATCH" });
      if (entry.handle.state === "revoked" || entry.handle.state === "expired") throw Object.assign(new Error("The sensitive handle is no longer usable."), { code: "MEMORY_SENSITIVE_HANDLE_UNUSABLE" });
      const operation = operationId();
      const nextHandle = buildHandle({ ...input, createdAt: entry.handle.created_at, expiresAt: input.expiresAt || entry.handle.expires_at, metadata: input.metadata || entry.handle.metadata, delegation: input.delegation || entry.handle.delegation, operationId: operation }, context, entry.handle.entry_type, id, "rotated", Number(entry.handle.generation || 0) + 1);
      const stored = storeValue(input.value);
      const previousRevision = state.revision;
      state.entries.set(id, { ...entry, handle: nextHandle, ...stored });
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: input.purpose || "entry_rotated" }, { handleIds: [id], outcome: "rotated" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return { ...mutationResult(operation, state, previousRevision, true, [id]), handle: clone(nextHandle) };
    } catch (error) { return errorResult(error); }
  }

  function revoke(input = {}) {
    try {
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const id = String(input.handleId || input.handle_id || "");
      const entry = findEntry(state, id);
      if (!entry) return mutationResult(operationId(), state, state.revision, false, []);
      if (!entryMatchesContext(entry, context, { allowDelegation: false })) throw Object.assign(new Error("The sensitive handle is bound to another session or agent."), { code: "MEMORY_SENSITIVE_BINDING_MISMATCH" });
      const operation = operationId();
      const previousRevision = state.revision;
      const revoked = { ...entry.handle, state: "revoked", updated_at: timestampNow() };
      state.entries.set(id, { handle: revoked, protectedValue: "", rawValue: undefined, cookieKey: entry.cookieKey });
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: input.purpose || "entry_revoked" }, { handleIds: [id], outcome: "revoked" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return { ...mutationResult(operation, state, previousRevision, true, [id]), handle: clone(revoked) };
    } catch (error) { return errorResult(error); }
  }

  function cleanupExpired(input = {}) {
    try {
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const expired = [];
      const current = nowDate(now);
      for (const [id, entry] of state.entries) {
        if (entry.handle.project_id !== context.projectId) continue;
        if (["active", "rotated"].includes(entry.handle.state) && new Date(entry.handle.expires_at).getTime() <= current.getTime()) {
          expired.push(id);
          state.entries.set(id, { handle: { ...entry.handle, state: "expired", updated_at: current.toISOString() }, protectedValue: "", rawValue: undefined, cookieKey: entry.cookieKey });
        }
      }
      for (const [id, lease] of leases) if (lease.projectId === context.projectId && new Date(lease.lease.expires_at).getTime() <= current.getTime()) leases.delete(id);
      if (!expired.length) return mutationResult(operationId(), state, state.revision, false, []);
      const operation = operationId();
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: "expiry_cleanup" }, { handleIds: expired, outcome: "expired" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return mutationResult(operation, state, previousRevision, true, expired);
    } catch (error) { return errorResult(error); }
  }

  function cleanupProject(input = {}) {
    try {
      if (closed) throw Object.assign(new Error("Sensitive Working Memory is closed."), { code: "MEMORY_SENSITIVE_STORE_CLOSED" });
      assertTrusted(input);
      const projectId = resolveProjectId(input, { persist: false });
      const loaded = loadProject(projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const removed = [...state.entries.keys()];
      const releasedLeases = [];
      for (const [leaseId, lease] of leases) {
        if (lease.projectId !== projectId) continue;
        releasedLeases.push(leaseId);
        leases.delete(leaseId);
      }
      if (!removed.length && !releasedLeases.length) return mutationResult(operationId(), state, state.revision, false, []);
      for (const entry of state.entries.values()) {
        entry.rawValue = undefined;
        entry.protectedValue = "";
      }
      state.entries.clear();
      const operation = operationId();
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, {
        ...input,
        projectId,
        sessionId: "memory-maintenance",
        agentId: "memory-maintenance",
        operationId: operation,
        actor: { type: "system", id: "memory-maintenance" },
        source: "runtime_event",
        purpose: input.purpose || "project_sensitive_state_deleted",
      }, {
        handleIds: removed,
        outcome: "project_sensitive_state_deleted",
        decision: { ok: true, code: "retention_cleanup" },
      });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return mutationResult(operation, state, previousRevision, true, [...removed, ...releasedLeases], persisted.persisted ? [] : ["Sensitive state was deleted from process memory; no encrypted file was present."]);
    } catch (error) { return errorResult(error); }
  }

  function issueUseLease(input = {}) {
    try {
      if (closed) throw Object.assign(new Error("Sensitive Working Memory is closed."), { code: "MEMORY_SENSITIVE_STORE_CLOSED" });
      const authority = safeAuthorityDecision(input.authorityDecision || input.authority || input);
      if (!authority.ok) throw Object.assign(new Error("A successful authority decision is required before sensitive materialization."), { code: "MEMORY_SENSITIVE_AUTHORITY_REQUIRED" });
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const handleIds = [...new Set((Array.isArray(input.handleIds || input.handle_ids) ? (input.handleIds || input.handle_ids) : [input.handleId || input.handle_id]).filter(Boolean).map(String))];
      if (!handleIds.length) throw Object.assign(new Error("At least one sensitive handle is required."), { code: "MEMORY_SENSITIVE_HANDLES_REQUIRED" });
      const entries = handleIds.map((id) => findEntry(state, id));
      if (entries.some((entry) => !entry)) throw Object.assign(new Error("One or more sensitive handles were not found."), { code: "MEMORY_SENSITIVE_HANDLE_NOT_FOUND" });
      const delegation = input.delegation || {};
      for (const entry of entries) {
        if (!entryUsable(entry)) throw Object.assign(new Error("One or more sensitive handles are expired or revoked."), { code: "MEMORY_SENSITIVE_HANDLE_UNUSABLE" });
        const sameAgent = entry.handle.agent_id === context.agentId;
        const delegated = !sameAgent && entry.handle.delegation?.allowed === true
          && delegation.allowed === true
          && String(delegation.delegatedBy || delegation.delegated_by || "") === entry.handle.agent_id;
        if (!sameAgent && !delegated) throw Object.assign(new Error("The sensitive handle cannot be delegated to this agent."), { code: "MEMORY_SENSITIVE_DELEGATION_DENIED" });
        if (entry.handle.delegation?.scope && entry.handle.delegation.scope !== String(input.purpose || "")) throw Object.assign(new Error("The sensitive delegation scope does not match the requested purpose."), { code: "MEMORY_SENSITIVE_DELEGATION_SCOPE" });
      }
      const issued = nowDate(now);
      const expires = new Date(issued.getTime() + Math.max(1, Number(leaseTtlMs) || DEFAULT_LEASE_TTL_MS)).toISOString();
      const lease = createSensitiveLease({
        lease_id: operationId(),
        project_id: context.projectId,
        session_id: context.sessionId,
        agent_id: context.agentId,
        handle_ids: handleIds,
        purpose: input.purpose || "trusted_tool_invocation",
        adapter: input.adapter || input.toolName || input.tool_name || "trusted-adapter",
        issued_at: issued.toISOString(),
        expires_at: expires,
        actor: actorOf(input),
        provenance: sourceProvenance(input, input.source || "runtime_event", input.sourceRef || "sensitive-lease"),
      }, { idFactory: operationId, now });
      leases.set(lease.lease_id, {
        lease,
        projectId: context.projectId,
        handleIds,
        consumed: false,
        context: { ...context },
        request: input.url ? { url: text(input.url, "", 2_000), method: text(input.method || "GET", "GET", 20) } : null,
      });
      const previousRevision = state.revision;
      const operation = operationId();
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: lease.purpose, adapter: lease.adapter }, { handleIds, leaseId: lease.lease_id, outcome: "lease_issued", decision: authority });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return { ...mutationResult(operation, state, previousRevision, true, [lease.lease_id]), lease: clone(lease) };
    } catch (error) { return errorResult(error); }
  }

  function consumeUseLease(input = {}) {
    try {
      if (closed) throw Object.assign(new Error("Sensitive Working Memory is closed."), { code: "MEMORY_SENSITIVE_STORE_CLOSED" });
      assertTrusted(input);
      const requestedId = typeof input.lease === "string" ? input.lease : input.leaseId || input.lease_id || input.lease?.lease_id || input.lease?.leaseId;
      const storedLease = leases.get(String(requestedId || ""));
      if (!storedLease) throw Object.assign(new Error("The sensitive use lease was not found or has expired."), { code: "MEMORY_SENSITIVE_LEASE_NOT_FOUND" });
      const context = contextOf(input, { persist: true });
      if (storedLease.projectId !== context.projectId || storedLease.lease.session_id !== context.sessionId || storedLease.lease.agent_id !== context.agentId) throw Object.assign(new Error("The sensitive use lease is bound to another project, session, or agent."), { code: "MEMORY_SENSITIVE_BINDING_MISMATCH" });
      if (storedLease.consumed) throw Object.assign(new Error("A sensitive use lease can be consumed only once."), { code: "MEMORY_SENSITIVE_LEASE_CONSUMED" });
      if (new Date(storedLease.lease.expires_at).getTime() <= nowDate(now).getTime()) {
        storedLease.consumed = true;
        throw Object.assign(new Error("The sensitive use lease has expired."), { code: "MEMORY_SENSITIVE_LEASE_EXPIRED" });
      }
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      storedLease.consumed = true;
      const values = [];
      try {
        for (const id of storedLease.handleIds) {
          const entry = findEntry(state, id);
          if (!entry || !entryUsable(entry)) throw Object.assign(new Error("A leased sensitive handle is no longer usable."), { code: "MEMORY_SENSITIVE_HANDLE_UNUSABLE" });
          values.push({ handleId: id, value: valueForEntry(entry), entryType: entry.handle.entry_type, metadata: metadataForEntry(entry) });
        }
      } catch (error) {
        addAudit(state, { ...input, ...context, purpose: storedLease.lease.purpose, adapter: input.adapter || storedLease.lease.adapter }, { handleIds: storedLease.handleIds, leaseId: storedLease.lease.lease_id, outcome: "materialization_failed", decision: { ok: true, code: "lease_authorized" } });
        state.revision += 1;
        persistState(state);
        return errorResult(error, "MEMORY_SENSITIVE_MATERIALIZATION_FAILED", true);
      }
      const previousRevision = state.revision;
      addAudit(state, { ...input, ...context, purpose: storedLease.lease.purpose, adapter: input.adapter || storedLease.lease.adapter }, { handleIds: storedLease.handleIds, leaseId: storedLease.lease.lease_id, outcome: "materialized", decision: { ok: true, code: "lease_authorized" } });
      state.revision += 1;
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      const safeMetadata = values.map(({ handleId, entryType, metadata }) => ({ handleId, entryType, metadata }));
      const result = { ok: true, leaseId: storedLease.lease.lease_id, operationId: storedLease.lease.lease_id, previousRevision, revision: state.revision, changed: true, conflicts: [], warnings: [], metadata: safeMetadata, values };
      if (values.length === 1) result.value = values[0].value;
      return result;
    } catch (error) { return errorResult(error); }
  }

  function releaseLease(input = {}) {
    try {
      const id = String(input.leaseId || input.lease_id || input.lease?.lease_id || input.lease || "");
      const lease = leases.get(id);
      if (!lease) return { ok: true, released: false, leaseId: id };
      const context = contextOf(input, { persist: true });
      if (lease.projectId !== context.projectId || lease.lease.session_id !== context.sessionId || lease.lease.agent_id !== context.agentId) throw Object.assign(new Error("The sensitive use lease is bound to another project, session, or agent."), { code: "MEMORY_SENSITIVE_BINDING_MISMATCH" });
      leases.delete(id);
      const stateResult = loadProject(context.projectId);
      if (!stateResult.ok) return stateResult;
      const state = stateResult.state;
      const operation = operationId();
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: lease.lease.purpose, adapter: lease.lease.adapter }, { handleIds: lease.handleIds, leaseId: id, outcome: "lease_released" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return { ...mutationResult(operation, state, previousRevision, true, [id]), released: true, leaseId: id };
    } catch (error) { return errorResult(error); }
  }

  function handleView(input = {}) {
    try {
      const context = contextOf(input, { persist: false });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const id = String(input.handleId || input.handle_id || "");
      const entry = findEntry(loaded.state, id);
      if (!entry || entry.handle.session_id !== context.sessionId) return { ok: true, found: false, handle: null };
      return { ok: true, found: true, handle: clone(entry.handle), usable: entryUsable(entry) };
    } catch (error) { return errorResult(error); }
  }

  function listHandles(input = {}) {
    try {
      const context = contextOf(input, { persist: false });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const handles = [...loaded.state.entries.values()]
        .filter((entry) => entry.handle.session_id === context.sessionId && (!context.identityId || entry.handle.identity_id === context.identityId))
        .map((entry) => ({ handle: clone(entry.handle), usable: entryUsable(entry) }));
      return { ok: true, projectId: context.projectId, sessionId: context.sessionId, handles, count: handles.length, storageMode: loaded.state.mode, revision: loaded.state.revision };
    } catch (error) { return errorResult(error); }
  }

  function audit(input = {}) {
    try {
      const context = contextOf(input, { persist: false });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const records = loaded.state.audits.filter((record) => !input.sessionId || record.session_id === context.sessionId).map(clone);
      return { ok: true, records, count: records.length, revision: loaded.state.revision };
    } catch (error) { return errorResult(error); }
  }

  function status(input = {}) {
    try {
      const projectId = resolveProjectId(input, { persist: false });
      const loaded = loadProject(projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const activeEntries = [...state.entries.values()].filter((entry) => entryUsable(entry)).length;
      const activeLeases = [...leases.values()].filter((entry) => entry.projectId === projectId && !entry.consumed && new Date(entry.lease.expires_at).getTime() > nowDate(now).getTime()).length;
      return { ok: true, projectId, revision: state.revision, storageMode: state.mode, secureStorageAvailable: secureAvailable(), persisted: state.mode === "encrypted" && fs.existsSync(fileForProject(projectId)), entryCount: state.entries.size, activeEntryCount: activeEntries, activeLeaseCount: activeLeases, warning: state.warning || "", path: fileForProject(projectId) };
    } catch (error) { return errorResult(error); }
  }

  function setCookies(input = {}) {
    try {
      assertTrusted(input);
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const list = Array.isArray(input.cookies) ? input.cookies : [];
      const headers = Array.isArray(input.setCookieHeaders || input.set_cookie_headers) ? (input.setCookieHeaders || input.set_cookie_headers) : [];
      const nowMs = nowDate(now).getTime();
      const normalized = [...list.map((cookie) => normalizeCookie(cookie, { url: input.url, nowMs })), ...headers.map((header) => parseSetCookie(header, input.url, { nowMs }))].filter(Boolean);
      const handles = [];
      const deleted = [];
      const warnings = [];
      for (const cookie of normalized) {
        const scopeKey = cookieScopeKey({ ...context, ...cookie });
        const matching = [...projects.get(context.projectId)?.entries.values() || []].find((entry) => entry.cookieKey === scopeKey && entry.handle.session_id === context.sessionId && entry.handle.identity_id === context.identityId && entry.handle.browser_context === context.browserContext);
        if (isExpired(cookie, nowMs)) {
          if (matching) {
            const result = revoke({ ...input, handleId: matching.handle.handle_id, purpose: "cookie_deleted" });
            if (result.ok) deleted.push(matching.handle.handle_id); else warnings.push(result.error || result.code);
          }
          continue;
        }
        const metadata = {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          hostOnly: cookie.hostOnly,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          partitionKey: cookie.partitionKey,
          partitioned: cookie.partitioned,
          expires: cookie.expires,
          origin: cookie.origin,
          creationIndex: cookie.creationIndex,
        };
        const result = matching
          ? rotate({ ...input, handleId: matching.handle.handle_id, value: cookie.value, metadata, cookieKey: scopeKey, entryType: "cookie", purpose: "cookie_rotated" })
          : put({ ...input, value: cookie.value, entryType: "cookie", metadata, cookieKey: scopeKey, origin: cookie.origin, purpose: "cookie_stored" });
        if (!result.ok) warnings.push(result.error || result.code);
        else handles.push(result.handle);
      }
      return { ok: warnings.length === 0, handles, deleted, count: handles.length, warnings, ...(warnings.length ? { code: "MEMORY_COOKIE_PARTIAL" } : {}) };
    } catch (error) { return errorResult(error); }
  }

  function requestHandleIds(state, context, input = {}) {
    const requestedTypes = Array.isArray(input.entryTypes || input.entry_types)
      ? new Set((input.entryTypes || input.entry_types).map((value) => String(value || "").toLowerCase()))
      : null;
    const allowed = (type) => !requestedTypes || requestedTypes.has(type);
    const cookieJar = createSensitiveCookieJar({ crypto, now });
    const cookieIdsByKey = new Map();
    for (const entry of state.entries.values()) {
      if (entry.handle.entry_type !== "cookie" || !allowed("cookie") || !entryMatchesContext(entry, context) || !entryUsable(entry)) continue;
      const metadata = entry.handle.metadata || {};
      let value;
      try { value = valueForEntry(entry); } catch { continue; }
      if (typeof value !== "string") continue;
      const result = cookieJar.set({ ...metadata, value }, {
        projectId: context.projectId,
        sessionId: context.sessionId,
        identityId: context.identityId,
        browserContext: context.browserContext,
        nowMs: nowDate(now).getTime(),
      });
      if (result.ok) cookieIdsByKey.set(result.key, entry.handle.handle_id);
    }
    const matched = cookieJar.match({
      ...input,
      projectId: context.projectId,
      sessionId: context.sessionId,
      identityId: context.identityId,
      browserContext: context.browserContext,
    });
    if (!matched.ok) return matched;
    const ids = matched.cookies.map((item) => cookieIdsByKey.get(item.key)).filter(Boolean);
    for (const entry of state.entries.values()) {
      if (!["authorization_header", "access_token", "refresh_token", "csrf_token", "nonce", "certificate_chain"].includes(entry.handle.entry_type)) continue;
      if (!allowed(entry.handle.entry_type) || !entryMatchesContext(entry, context) || !entryUsable(entry)) continue;
      const metadata = entry.handle.metadata || {};
      const targetOrigin = metadata.origin || entry.handle.origin || "";
      if (input.url && targetOrigin && !originMatches(input.url, targetOrigin)) continue;
      if (entry.handle.entry_type === "certificate_chain" && input.includeClientCertificate !== true) continue;
      if (["access_token", "refresh_token", "csrf_token", "nonce"].includes(entry.handle.entry_type) && !metadata.headerName && !metadata.header_name) continue;
      ids.push(entry.handle.handle_id);
    }
    return { ok: true, handleIds: [...new Set(ids)], cookieHandleIds: [...new Set(ids.filter((id) => cookieIdsByKeyHas(cookieIdsByKey, id)))], cookieIdsByKey };
  }

  function cookieIdsByKeyHas(map, id) { return [...map.values()].includes(id); }

  function issueRequestLease(input = {}) {
    try {
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const selected = requestHandleIds(loaded.state, context, input);
      if (!selected.ok) return selected;
      if (!selected.handleIds.length) return { ok: true, lease: null, handleIds: [], metadata: [], request: { headers: {}, cookies: [], cookieHeader: "" } };
      const lease = issueUseLease({ ...input, ...context, handleIds: selected.handleIds, purpose: input.purpose || "request_materialization", adapter: input.adapter || "request-adapter" });
      if (!lease.ok) return lease;
      return { ...lease, handleIds: selected.handleIds };
    } catch (error) { return errorResult(error); }
  }

  function materializeRequestForTrustedAdapter(input = {}) {
    const materialized = consumeUseLease(input);
    if (!materialized.ok) return materialized;
    const request = { headers: {}, cookies: [], cookieHeader: "", clientCertificate: null };
    for (const item of materialized.values || []) {
      const metadata = item.metadata?.metadata || item.metadata || {};
      if (item.entryType === "cookie") {
        request.cookies.push({ handleId: item.handleId, name: text(metadata.name, "", 256), value: item.value, domain: text(metadata.domain, "", 512), path: text(metadata.path || "/", "/", 4_000) });
      } else if (item.entryType === "certificate_chain") {
        request.clientCertificate = item.value;
      } else {
        const name = text(metadata.headerName || metadata.header_name || metadata.name, "", 240);
        if (name) request.headers[name] = item.value;
      }
    }
    request.cookieHeader = request.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    return { ok: true, leaseId: materialized.leaseId, operationId: materialized.operationId, previousRevision: materialized.previousRevision, revision: materialized.revision, changed: materialized.changed, conflicts: [], warnings: materialized.warnings || [], request, metadata: materialized.metadata, handleIds: (materialized.values || []).map((item) => item.handleId) };
  }

  function cookiesForRequest(input = {}) {
    try {
      assertTrusted(input);
      const lease = issueRequestLease({ ...input, entryTypes: ["cookie"], includeClientCertificate: false, purpose: input.purpose || "request_cookie_materialization", adapter: input.adapter || "request-adapter" });
      if (!lease.ok) return lease;
      if (!lease.lease) return { ok: true, cookies: [], cookieHeader: "", metadata: [], handleIds: [] };
      const materialized = materializeRequestForTrustedAdapter({ ...input, leaseId: lease.lease.lease_id, trusted: true, adapter: input.adapter || "request-adapter" });
      if (!materialized.ok) return materialized;
      return { ok: true, leaseId: materialized.leaseId, cookieHeader: materialized.request.cookieHeader, cookies: materialized.request.cookies, metadata: materialized.metadata, handleIds: materialized.handleIds };
    } catch (error) { return errorResult(error); }
  }

  function putTyped(input = {}) { return put(input); }

  function putToken(input = {}) {
    const requested = String(input.entryType || input.entry_type || input.tokenType || input.token_type || "access_token").toLowerCase();
    const entryType = ["access_token", "refresh_token", "csrf_token", "nonce"].includes(requested) ? requested : "access_token";
    return put({
      ...input,
      entryType,
      origin: input.origin,
      metadata: {
        headerName: text(input.headerName || input.header_name, "", 240),
        origin: text(input.origin, "", 2_000),
        tokenType: text(input.tokenType || input.token_type || entryType, entryType, 80),
      },
      purpose: input.purpose || "typed_token",
    });
  }

  function putHeaderBinding(input = {}) {
    try {
      assertTrusted(input);
      const handles = [];
      const rejected = [];
      const headers = isRecord(input.headers) ? Object.entries(input.headers).slice(0, 100) : [];
      for (const [name, value] of headers) {
        const result = put({
          ...input,
          entryType: "authorization_header",
          value,
          origin: input.origin,
          metadata: { name: text(name, "", 240), headerName: text(name, "", 240), origin: text(input.origin, "", 2_000) },
          purpose: input.purpose || "header_binding",
        });
        if (result.ok) handles.push(result.handle); else rejected.push({ name: text(name, "", 240), code: result.code });
      }
      return { ok: rejected.length === 0, handles, rejected, count: handles.length, ...(rejected.length ? { code: "MEMORY_SENSITIVE_HEADER_PARTIAL" } : {}) };
    } catch (error) { return errorResult(error); }
  }

  function putBrowserStorageEntries(input = {}) {
    try {
      assertTrusted(input);
      const entries = Array.isArray(input.entries) ? input.entries.slice(0, 200) : [];
      const handles = [];
      const rejected = [];
      for (const entry of entries) {
        if (entry?.selected !== true && entry?.authRelated !== true) { rejected.push({ name: text(entry?.name, "", 240), code: "MEMORY_SENSITIVE_STORAGE_SELECTION_REQUIRED" }); continue; }
        const result = put({
          ...input,
          entryType: "browser_storage",
          value: entry.value,
          origin: entry.origin || input.origin,
          metadata: { name: text(entry.name, "", 500), origin: text(entry.origin || input.origin, "", 2_000), storageArea: text(entry.storageArea || entry.storage_area || "localStorage", "localStorage", 80), selected: true, authRelated: entry.authRelated === true },
          purpose: input.purpose || "selected_browser_storage",
        });
        if (result.ok) handles.push(result.handle); else rejected.push({ name: text(entry.name, "", 240), code: result.code });
      }
      return { ok: rejected.length === 0, handles, rejected, count: handles.length, ...(rejected.length ? { code: "MEMORY_SENSITIVE_STORAGE_PARTIAL" } : {}) };
    } catch (error) { return errorResult(error); }
  }

  function putClientCertificate(input = {}) {
    try {
      assertTrusted(input);
      if (input.privateKey !== undefined || input.private_key !== undefined || input.clientPrivateKey !== undefined || input.client_private_key !== undefined || PRIVATE_KEY_MARKER.test(String(input.certificateChain || input.certificate_chain || ""))) {
        throw Object.assign(new Error("Private keys must remain in Identity Vault and cannot enter Sensitive Working Memory."), { code: "MEMORY_SENSITIVE_PRIVATE_KEY_FORBIDDEN" });
      }
      const chain = input.certificateChain || input.certificate_chain;
      if (!chain) throw Object.assign(new Error("A client certificate chain is required."), { code: "MEMORY_SENSITIVE_CERTIFICATE_REQUIRED" });
      const result = put({
        ...input,
        entryType: "certificate_chain",
        value: { certificateChain: secretClone(chain), passphrase: secretClone(input.passphrase || "") },
        metadata: { origin: text(input.origin, "", 2_000), identityVaultRef: text(input.identityVaultRef || input.identity_vault_ref, "", 500), certificateCount: Array.isArray(chain) ? chain.length : 1 },
        purpose: input.purpose || "client_certificate",
      });
      return result;
    } catch (error) { return errorResult(error); }
  }

  function materializeClientCertificateForTrustedAdapter(input = {}) {
    const lease = input.leaseId || input.lease_id || input.lease ? null : issueUseLease({
      ...input,
      handleIds: [input.handleId || input.handle_id],
      purpose: input.purpose || "client_certificate",
      adapter: input.adapter || "certificate-adapter",
    });
    const leaseId = lease?.lease?.lease_id || input.leaseId || input.lease_id || input.lease?.lease_id;
    if (!leaseId) return lease || errorResult(Object.assign(new Error("A certificate handle or lease is required."), { code: "MEMORY_SENSITIVE_HANDLES_REQUIRED" }));
    const materialized = materializeRequestForTrustedAdapter({ ...input, leaseId, trusted: true, adapter: input.adapter || "certificate-adapter" });
    if (!materialized.ok) return materialized;
    return { ...materialized, certificate: materialized.request.clientCertificate };
  }

  function importIdentityVaultState(input = {}) {
    try {
      assertTrusted(input);
      if (!input.identityVault?.readSecret) throw Object.assign(new Error("Identity Vault integration is unavailable."), { code: "MEMORY_IDENTITY_VAULT_UNAVAILABLE" });
      const context = contextOf(input, { persist: true });
      const loaded = input.identityVault.readSecret(input.workspace, context.identityId);
      if (!loaded?.ok) return errorResult(Object.assign(new Error(loaded?.error?.message || "Identity state could not be read."), { code: loaded?.error?.code || "MEMORY_IDENTITY_STATE_UNAVAILABLE" }));
      const secret = loaded.secret || {};
      const cookies = setCookies({ ...input, ...context, cookies: secret.storageState?.cookies || [], source: "identity_vault", purpose: "identity_vault_cookie_import" });
      const headerHandles = [];
      for (const binding of Array.isArray(secret.headerBindings) ? secret.headerBindings.slice(0, 100) : []) {
        for (const [name, value] of Object.entries(binding.headers || {}).slice(0, 100)) {
          const result = put({ ...input, ...context, entryType: "authorization_header", value, origin: binding.origin, metadata: { name: text(name, "", 200), origin: text(binding.origin, "", 2_000) }, source: "identity_vault", purpose: "identity_vault_header_import" });
          if (result.ok) headerHandles.push(result.handle); else return result;
        }
      }
      const certificateHandles = [];
      for (const certificate of Array.isArray(secret.clientCertificates) ? secret.clientCertificates.slice(0, 20) : []) {
        const result = putClientCertificate({
          ...input,
          ...context,
          origin: certificate.origin,
          certificateChain: certificate.certificateChain,
          passphrase: certificate.passphrase,
          identityVaultRef: certificate.identityVaultRef || certificate.certificateId,
          source: "identity_vault",
          purpose: "identity_vault_client_certificate_import",
        });
        if (result.ok) certificateHandles.push(result.handle); else return result;
      }
      return { ok: cookies.ok, cookieHandles: cookies.handles, headerHandles, certificateHandles, deleted: cookies.deleted, warnings: cookies.warnings || [] };
    } catch (error) { return errorResult(error); }
  }

  function closeSession(input = {}) {
    try {
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const removed = [];
      for (const [id, entry] of state.entries) {
        if (entry.handle.session_id !== context.sessionId) continue;
        removed.push(id);
        state.entries.delete(id);
      }
      for (const [id, lease] of leases) if (lease.projectId === context.projectId && lease.lease.session_id === context.sessionId) leases.delete(id);
      if (!removed.length) return mutationResult(operationId(), state, state.revision, false, []);
      const operation = operationId();
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: "session_closed" }, { handleIds: removed, outcome: "session_closed" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return mutationResult(operation, state, previousRevision, true, removed);
    } catch (error) { return errorResult(error); }
  }

  function closeIdentity(input = {}) {
    try {
      const context = contextOf(input, { persist: true });
      const loaded = loadProject(context.projectId);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      const removed = [];
      for (const [id, entry] of state.entries) {
        if (entry.handle.session_id === context.sessionId && entry.handle.identity_id === context.identityId) { removed.push(id); state.entries.delete(id); }
      }
      if (!removed.length) return mutationResult(operationId(), state, state.revision, false, []);
      const operation = operationId();
      const previousRevision = state.revision;
      state.revision += 1;
      addAudit(state, { ...input, ...context, operationId: operation, purpose: "identity_closed" }, { handleIds: removed, outcome: "identity_closed" });
      const persisted = persistState(state);
      if (!persisted.ok) return persisted;
      return mutationResult(operation, state, previousRevision, true, removed);
    } catch (error) { return errorResult(error); }
  }

  function clearProcessOnly() {
    for (const state of projects.values()) {
      for (const entry of state.entries.values()) { entry.rawValue = undefined; entry.protectedValue = ""; }
      state.entries.clear();
    }
    projects.clear();
    leases.clear();
  }

  function close() {
    if (closed) return { ok: true, closed: true };
    clearProcessOnly();
    closed = true;
    return { ok: true, closed: true };
  }

  return Object.freeze({
    CONTAINER_VERSION,
    DEFAULT_LEASE_TTL_MS,
    fileForProject,
    secureStorageAvailable: secureAvailable,
    put,
    putTyped,
    putToken,
    putHeaderBinding,
    rotate,
    revoke,
    release: revoke,
    cleanupExpired,
    cleanupProject,
    issueUseLease,
    consumeUseLease,
    materializeForTrustedAdapter: consumeUseLease,
    materializeRequestForTrustedAdapter,
    releaseLease,
    getHandle: handleView,
    listHandles,
    audit,
    status,
    setCookies,
    rotateFromBrowserState: setCookies,
    cookiesForRequest,
    matchCookiesForTrustedAdapter: cookiesForRequest,
    putBrowserStorageEntries,
    putClientCertificate,
    materializeClientCertificateForTrustedAdapter,
    importIdentityVaultState,
    issueRequestLease,
    closeSession,
    closeIdentity,
    close,
  });
}

module.exports = Object.freeze({
  CONTAINER_VERSION,
  DEFAULT_LEASE_TTL_MS,
  createSensitiveWorkingMemory,
});
