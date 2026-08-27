"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, assertSensitivity, canonicalKeyHash, createOpaqueId } = require("../../../contracts/memory/index.js");
const { redactSecrets, redactStructuredValue } = require("../../../shared/secret-redaction.js");
const {
  atomicWriteJson,
  assertNoSecretKeys,
  clone,
  fileSha256,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const ARTIFACT_REGISTRY_SCHEMA_VERSION = 1;
const MAX_PREVIEW_CHARS = 4_000;
const MAX_ARTIFACT_READ_BYTES = 16 * 1024 * 1024;
const HEX_SHA256 = /^[a-f0-9]{64}$/i;

function createArtifactRegistry({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  now = () => new Date(),
  maxPreviewChars = MAX_PREVIEW_CHARS,
  maxReadBytes = MAX_ARTIFACT_READ_BYTES,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Artifact registry dependencies are required.");

  function workspaceRoot(workspace) { return resolvedWorkspace(path, workspace); }
  function registryDirectory(workspace) { return path.join(workspaceRoot(workspace), ".xekute", "memory", "artifacts"); }
  function registryFile(workspace) { return path.join(registryDirectory(workspace), "registry.json"); }
  function projectIdOf(value) {
    try { return assertMemoryId(value, "proj"); } catch (error) { throw error; }
  }
  function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
  function text(value, limit = 8_000) { return String(value == null ? "" : value).replace(/\u0000/g, "").slice(0, limit); }

  function emptyRegistry(projectId) {
    return { schema_version: ARTIFACT_REGISTRY_SCHEMA_VERSION, kind: "xekute-artifact-registry", project_id: projectId, revision: 0, created_at: timestamp(now), updated_at: timestamp(now), artifacts: [] };
  }

  function normalizeRegistry(value, projectId) {
    const source = value && typeof value === "object" ? value : {};
    const actualProjectId = projectIdOf(source.project_id || projectId);
    if (actualProjectId !== projectId) throw Object.assign(new Error("The artifact registry belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    const artifacts = (Array.isArray(source.artifacts) ? source.artifacts : []).map((entry) => normalizeArtifact(entry, projectId)).filter(Boolean);
    return {
      schema_version: ARTIFACT_REGISTRY_SCHEMA_VERSION,
      kind: "xekute-artifact-registry",
      project_id: projectId,
      revision: Number.isInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
      created_at: text(source.created_at || timestamp(now), 80),
      updated_at: text(source.updated_at || timestamp(now), 80),
      artifacts,
    };
  }

  function safeRelativePath(workspace, rawPath) {
    const relative = text(rawPath, 4_000).trim().replace(/\\/g, "/");
    if (!relative || path.isAbsolute(relative)) throw Object.assign(new Error("Artifact locations must use a relative workspace path."), { code: "MEMORY_ARTIFACT_PATH_INVALID" });
    const absolute = path.resolve(workspace, relative);
    const root = path.resolve(workspace);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(prefix)) throw Object.assign(new Error("Artifact locations must remain inside the project workspace."), { code: "MEMORY_ARTIFACT_PATH_INVALID" });
    return relative.replace(/\/+/g, "/");
  }

  function normalizeLocation(value, workspace) {
    const source = value && typeof value === "object" ? value : {};
    const relativePath = source.relative_path || source.relativePath || source.path || "";
    const location = {
      store: text(source.store || "workspace", 120),
      relative_path: relativePath ? safeRelativePath(workspace, relativePath) : "",
    };
    const hasOffset = source.offset !== undefined || source.source_offset !== undefined;
    const hasLength = source.length !== undefined || source.source_length !== undefined;
    if (hasOffset || hasLength) {
      const offset = Number(source.offset ?? source.source_offset);
      const length = Number(source.length ?? source.source_length);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > maxReadBytes) throw Object.assign(new Error("Artifact source positions are invalid or exceed the expansion limit."), { code: "MEMORY_ARTIFACT_POSITION_INVALID" });
      location.offset = offset;
      location.length = length;
    }
    return location;
  }

  function normalizeArtifact(value, projectId, workspace = "") {
    const source = value && typeof value === "object" ? value : {};
    const artifactId = String(source.artifact_id || source.artifactId || "").trim();
    if (artifactId) {
      try { assertMemoryId(artifactId, "artifact"); } catch { return null; }
    }
    const location = workspace ? normalizeLocation(source.location || source, workspace) : {
      store: text(source.location?.store || source.store || "workspace", 120),
      relative_path: text(source.location?.relative_path || source.location?.relativePath || source.relative_path || "", 4_000).replace(/\\/g, "/"),
      ...(source.location?.offset !== undefined ? { offset: Number(source.location.offset) } : {}),
      ...(source.location?.length !== undefined ? { length: Number(source.location.length) } : {}),
    };
    const sensitivity = assertSensitivity(source.sensitivity || "confidential");
    const sha256 = text(source.sha256 || "", 128).toLowerCase();
    if (sha256 && !HEX_SHA256.test(sha256)) throw Object.assign(new Error("Artifact SHA-256 must contain 64 hexadecimal characters."), { code: "MEMORY_ARTIFACT_HASH_INVALID" });
    const sourceHash = text(source.source_hash || source.sourceHash || "", 128).toLowerCase();
    if (sourceHash && !HEX_SHA256.test(sourceHash)) throw Object.assign(new Error("Artifact source SHA-256 must contain 64 hexadecimal characters."), { code: "MEMORY_ARTIFACT_HASH_INVALID" });
    return {
      artifact_id: artifactId || createOpaqueId("artifact", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }),
      project_id: projectId,
      kind: text(source.kind || source.type || "artifact", 120),
      location,
      sha256,
      source_hash: sourceHash,
      byte_length: Math.max(0, Number(source.byte_length ?? source.byteLength ?? 0) || 0),
      captured_at: text(source.captured_at || source.capturedAt || timestamp(now), 80),
      captured_by: text(source.captured_by || source.capturedBy || "unknown", 160),
      redaction: {
        state: text(source.redaction?.state || source.redaction_state || "unknown", 40),
        policy_version: text(source.redaction?.policy_version || source.redaction?.policyVersion || "", 80),
      },
      sensitivity,
      retention: {
        policy: text(source.retention?.policy || "project_default", 120),
        expires_at: source.retention?.expires_at || source.retention?.expiresAt ? text(source.retention.expires_at || source.retention.expiresAt, 80) : null,
        pinned: Boolean(source.retention?.pinned),
        deleted_at: source.retention?.deleted_at || source.retention?.deletedAt ? text(source.retention.deleted_at || source.retention.deletedAt, 80) : null,
        deletion_reason: text(source.retention?.deletion_reason || source.retention?.deletionReason || "", 240),
        source_location: text(source.retention?.source_location || source.retention?.sourceLocation || "", 4_000),
        source_deleted: Boolean(source.retention?.source_deleted || source.retention?.sourceDeleted),
      },
      integrity_state: text(source.integrity_state || source.integrityState || "unverified", 40),
      preview: text(redactSecrets(typeof source.preview === "string" ? source.preview : JSON.stringify(redactStructuredValue(source.preview || ""))), maxPreviewChars),
      canonical_key: text(source.canonical_key || source.canonicalKey || "", 128),
      metadata: source.metadata && typeof source.metadata === "object" ? clone(redactStructuredValue(source.metadata)) : {},
    };
  }

  function readRegistry(workspace, projectId) {
    let root;
    try { root = workspaceRoot(workspace); projectIdOf(projectId); } catch (error) { return operationFailure(error.code || "MEMORY_ARTIFACT_INPUT_INVALID", error.message, error.details || {}); }
    const file = registryFile(root);
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_ARTIFACT_REGISTRY_CORRUPT", `The artifact registry could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: true, initialized: false, exists: false, recovered: false, registry: emptyRegistry(projectId), path: file };
    try {
      const registry = normalizeRegistry(loaded.value, projectId);
      return { ok: true, initialized: true, exists: true, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", registry, path: file, sourcePath: loaded.sourcePath };
    } catch (error) {
      return operationFailure(error.code || "MEMORY_ARTIFACT_REGISTRY_INVALID", `The artifact registry is invalid: ${error.message}.`, { path: file, ...(error.details || {}) });
    }
  }

  function persistRegistry(workspace, registry) {
    const root = workspaceRoot(workspace);
    const projectId = projectIdOf(registry.project_id);
    const normalized = normalizeRegistry(registry, projectId);
    try {
      const result = atomicWriteJson({ fs, path, crypto }, registryFile(root), normalized, {
        validate: (textValue) => normalizeRegistry(JSON.parse(textValue), projectId),
      });
      return { ok: true, path: result.path, registry: normalized };
    } catch (error) {
      return operationFailure("MEMORY_ARTIFACT_REGISTRY_WRITE_FAILED", `The artifact registry could not be written: ${error.message}.`, { path: registryFile(root) }, true);
    }
  }

  function sourceBytes(workspace, location, suppliedContent = undefined) {
    if (suppliedContent !== undefined) {
      const bytes = Buffer.isBuffer(suppliedContent) ? Buffer.from(suppliedContent) : Buffer.from(typeof suppliedContent === "string" ? suppliedContent : JSON.stringify(suppliedContent), "utf8");
      return { bytes, sourceBytes: bytes, sourcePath: "" };
    }
    if (!location.relative_path) return { bytes: null, sourceBytes: null, sourcePath: "" };
    const sourcePath = path.resolve(workspace, location.relative_path);
    if (!fs.existsSync(sourcePath)) return { bytes: null, sourceBytes: null, sourcePath };
    const source = fs.readFileSync(sourcePath);
    if (source.length > maxReadBytes && location.offset === undefined) return { bytes: null, sourceBytes: source, sourcePath, tooLarge: true };
    const offset = Number(location.offset || 0);
    const length = location.length === undefined ? source.length - offset : Number(location.length);
    return { bytes: source.subarray(offset, offset + length), sourceBytes: source, sourcePath };
  }

  function canonicalKey(input, location, digest, sourceHash) {
    return canonicalKeyHash({ kind: text(input.kind || input.type || "artifact", 120), location, sha256: digest, source_hash: sourceHash || "" });
  }

  function register(workspace, projectId, input = {}) {
    let root;
    try { root = workspaceRoot(workspace); projectIdOf(projectId); assertNoSecretKeys({ ...input, content: undefined }); } catch (error) { return operationFailure(error.code || "MEMORY_ARTIFACT_INPUT_INVALID", error.message, error.details || {}); }
    let location;
    try { location = normalizeLocation(input.location || input, root); } catch (error) {
      return operationFailure(error.code || "MEMORY_ARTIFACT_PATH_INVALID", error.message, error.details || {});
    }
    let captured;
    try { captured = sourceBytes(root, location, input.content); } catch (error) { return operationFailure("MEMORY_ARTIFACT_READ_FAILED", `The artifact source could not be read: ${error.message}.`, { location }, true); }
    if (captured.tooLarge) return operationFailure("MEMORY_ARTIFACT_TOO_LARGE", "The artifact source exceeds the registry expansion limit.", { maximumBytes: maxReadBytes, location });
    let digest = String(input.sha256 || "").trim().toLowerCase();
    if (captured.bytes) digest = hash(captured.bytes);
    if (digest && !HEX_SHA256.test(digest)) return operationFailure("MEMORY_ARTIFACT_HASH_INVALID", "Artifact SHA-256 must contain 64 hexadecimal characters.");
    if (!digest) return operationFailure("MEMORY_ARTIFACT_HASH_REQUIRED", "An artifact needs a SHA-256 digest or readable source content.");
    const sourceHash = captured.sourceBytes ? hash(captured.sourceBytes) : text(input.source_hash || input.sourceHash || "", 128).toLowerCase();
    if (sourceHash && !HEX_SHA256.test(sourceHash)) return operationFailure("MEMORY_ARTIFACT_HASH_INVALID", "Artifact source SHA-256 must contain 64 hexadecimal characters.");
    if (input.sha256 && captured.bytes && String(input.sha256).toLowerCase() !== digest) return operationFailure("MEMORY_ARTIFACT_HASH_MISMATCH", "The supplied artifact hash does not match the source bytes.", { expected: String(input.sha256).toLowerCase(), actual: digest });
    if (input.source_hash && sourceHash && String(input.source_hash).toLowerCase() !== sourceHash) return operationFailure("MEMORY_ARTIFACT_HASH_MISMATCH", "The supplied source hash does not match the source file.", { expected: String(input.source_hash).toLowerCase(), actual: sourceHash });
    const loaded = readRegistry(root, projectId);
    if (!loaded.ok) return loaded;
    const registry = loaded.registry;
    const key = canonicalKey(input, location, digest, sourceHash);
    const existing = registry.artifacts.find((artifact) => artifact.canonical_key === key);
    if (existing) return { ok: true, changed: false, duplicate: true, artifact: clone(existing), artifactId: existing.artifact_id, revision: registry.revision, path: registryFile(root) };
    let artifact;
    try {
      artifact = normalizeArtifact({ ...input, location, sha256: digest, source_hash: sourceHash, byte_length: captured.bytes?.length ?? input.byte_length ?? input.byteLength ?? 0, integrity_state: captured.sourcePath ? (captured.bytes ? "verified" : "missing") : "verified", preview: input.preview ?? (captured.bytes ? redactSecrets(captured.bytes.toString("utf8", 0, maxPreviewChars)) : ""), canonical_key: key }, projectId, root);
      assertNoSecretKeys(artifact);
    } catch (error) { return operationFailure(error.code || "MEMORY_ARTIFACT_INVALID", error.message, error.details || {}); }
    registry.artifacts.push(artifact);
    registry.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
    registry.revision += 1;
    registry.updated_at = timestamp(now);
    const saved = persistRegistry(root, registry);
    if (!saved.ok) return saved;
    return { ok: true, changed: true, duplicate: false, artifact: clone(artifact), artifactId: artifact.artifact_id, previousRevision: registry.revision - 1, revision: registry.revision, path: saved.path };
  }

  function list(workspace, projectId, { kind = "", integrityState = "", limit = 50, cursor = "" } = {}) {
    const loaded = readRegistry(workspace, projectId);
    if (!loaded.ok) return loaded;
    const bounded = Math.min(200, Math.max(1, Number(limit) || 50));
    const start = cursor ? Math.max(0, loaded.registry.artifacts.findIndex((artifact) => artifact.artifact_id === cursor) + 1) : 0;
    const filtered = loaded.registry.artifacts.filter((artifact) => (!kind || artifact.kind === kind) && (!integrityState || artifact.integrity_state === integrityState));
    const artifacts = filtered.slice(start, start + bounded).map(clone);
    return { ok: true, initialized: loaded.initialized, artifacts, total: filtered.length, nextCursor: artifacts.length === bounded ? artifacts.at(-1).artifact_id : "", sourceRevision: loaded.registry.revision, warnings: loaded.warning ? [{ code: "MEMORY_ARTIFACT_REGISTRY_RECOVERED", message: loaded.warning }] : [] };
  }

  function get(workspace, projectId, artifactId) {
    try { assertMemoryId(artifactId, "artifact"); } catch (error) { return operationFailure(error.code, error.message, error.details || {}); }
    const loaded = readRegistry(workspace, projectId);
    if (!loaded.ok) return loaded;
    const artifact = loaded.registry.artifacts.find((entry) => entry.artifact_id === artifactId);
    if (!artifact) return operationFailure("MEMORY_ARTIFACT_NOT_FOUND", "The artifact is not registered.", { artifactId });
    return { ok: true, artifact: clone(artifact), sourceRevision: loaded.registry.revision };
  }

  function expand(workspace, projectId, artifactId, { maxBytes = 256 * 1024, maxChars = 200_000, authorize = null, includeRaw = false } = {}) {
    const found = get(workspace, projectId, artifactId);
    if (!found.ok) return found;
    const artifact = found.artifact;
    if (artifact.integrity_state === "expired" || artifact.retention?.deleted_at) {
      return operationFailure("MEMORY_ARTIFACT_EXPIRED", "The artifact was expired by retention policy and is no longer expandable.", { artifactId, integrityState: artifact.integrity_state });
    }
    const requestedBytes = Math.min(maxReadBytes, Math.max(1, Number(maxBytes) || 256 * 1024));
    if (includeRaw && typeof authorize !== "function") return operationFailure("MEMORY_ARTIFACT_AUTHORIZATION_REQUIRED", "Raw artifact expansion requires an explicit trusted authorization callback.");
    if (includeRaw && !authorize({ projectId, artifact: clone(artifact) })) return operationFailure("MEMORY_ARTIFACT_ACCESS_DENIED", "Artifact expansion was denied by the authority policy.");
    const location = artifact.location || {};
    const root = workspaceRoot(workspace);
    let captured;
    try { captured = sourceBytes(root, location); } catch (error) { return operationFailure("MEMORY_ARTIFACT_READ_FAILED", `The artifact could not be expanded: ${error.message}.`, { artifactId }, true); }
    if (!captured.bytes) return operationFailure("MEMORY_ARTIFACT_UNAVAILABLE", "The artifact source is unavailable.", { artifactId, integrityState: artifact.integrity_state });
    const bounded = captured.bytes.subarray(0, requestedBytes);
    const value = includeRaw ? bounded.toString("utf8", 0, Math.min(bounded.length, maxChars)) : redactSecrets(bounded.toString("utf8", 0, Math.min(bounded.length, maxChars)));
    return { ok: true, artifactId, value, truncated: bounded.length < captured.bytes.length || value.length >= maxChars, byteLength: captured.bytes.length, sourceRevision: found.sourceRevision, sensitivity: artifact.sensitivity, raw: Boolean(includeRaw) };
  }

  function verify(workspace, projectId, artifactId) {
    const found = get(workspace, projectId, artifactId);
    if (!found.ok) return found;
    const artifact = found.artifact;
    if (artifact.integrity_state === "expired" || artifact.retention?.deleted_at) {
      return { ok: true, artifactId, integrityState: "expired", sourceHash: "", selectedHash: "", revision: found.sourceRevision, retained: false };
    }
    const root = workspaceRoot(workspace);
    let captured;
    try { captured = sourceBytes(root, artifact.location || {}); } catch (error) { return operationFailure("MEMORY_ARTIFACT_READ_FAILED", error.message, { artifactId }, true); }
    let state = "missing";
    if (captured.sourceBytes) {
      const sourceHash = hash(captured.sourceBytes);
      const selectedHash = captured.bytes ? hash(captured.bytes) : "";
      state = (artifact.source_hash && artifact.source_hash !== sourceHash) || (artifact.sha256 && artifact.sha256 !== selectedHash) ? "hash_mismatch" : "verified";
    }
    const loaded = readRegistry(root, projectId);
    if (!loaded.ok) return loaded;
    const registry = loaded.registry;
    const index = registry.artifacts.findIndex((entry) => entry.artifact_id === artifactId);
    if (index < 0) return operationFailure("MEMORY_ARTIFACT_NOT_FOUND", "The artifact is not registered.", { artifactId });
    if (registry.artifacts[index].integrity_state !== state) {
      registry.artifacts[index].integrity_state = state;
      registry.revision += 1;
      registry.updated_at = timestamp(now);
      const saved = persistRegistry(root, registry);
      if (!saved.ok) return saved;
    }
    return { ok: true, artifactId, integrityState: state, sourceHash: captured.sourceBytes ? hash(captured.sourceBytes) : "", selectedHash: captured.bytes ? hash(captured.bytes) : "", revision: registry.revision };
  }

  function expire(workspace, projectId, { nowAt = null, retentionDays = null, includePinned = false, reason = "retention_expired" } = {}) {
    const loaded = readRegistry(workspace, projectId);
    if (!loaded.ok) return loaded;
    const current = nowAt instanceof Date ? nowAt : nowAt ? new Date(nowAt) : new Date(now());
    if (Number.isNaN(current.getTime())) return operationFailure("MEMORY_ARTIFACT_RETENTION_DATE_INVALID", "The artifact retention clock returned an invalid date.");
    const defaultDays = Number.isFinite(Number(retentionDays)) && Number(retentionDays) >= 0 ? Number(retentionDays) : null;
    const expired = [];
    const warnings = [];
    for (const artifact of loaded.registry.artifacts) {
      if (artifact.integrity_state === "expired" || artifact.retention?.deleted_at) continue;
      if (artifact.retention?.pinned && !includePinned) continue;
      const explicitExpiry = artifact.retention?.expires_at ? new Date(artifact.retention.expires_at) : null;
      const fallbackExpiry = !explicitExpiry && defaultDays !== null && artifact.captured_at
        ? new Date(new Date(artifact.captured_at).getTime() + defaultDays * 24 * 60 * 60 * 1_000)
        : null;
      const expiresAt = explicitExpiry && !Number.isNaN(explicitExpiry.getTime()) ? explicitExpiry : fallbackExpiry;
      if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > current.getTime()) continue;
      const originalLocation = artifact.location && typeof artifact.location === "object" ? { ...artifact.location } : {};
      const sourceRelativePath = String(originalLocation.relative_path || "");
      const sourcePath = sourceRelativePath ? path.resolve(workspaceRoot(workspace), sourceRelativePath) : "";
      const workspaceRootPath = path.resolve(workspaceRoot(workspace));
      const workspacePrefix = workspaceRootPath.endsWith(path.sep) ? workspaceRootPath : `${workspaceRootPath}${path.sep}`;
      const sharedSource = sourceRelativePath && loaded.registry.artifacts.some((other) => other.artifact_id !== artifact.artifact_id
        && other.integrity_state !== "expired"
        && !other.retention?.deleted_at
        && String(other.location?.relative_path || "") === sourceRelativePath);
      let sourceDeleted = false;
      let sourceIsFile = false;
      try { sourceIsFile = Boolean(sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()); } catch { sourceIsFile = false; }
      if (sourcePath && sourcePath !== workspaceRootPath && sourcePath.startsWith(workspacePrefix) && !sharedSource && sourceIsFile) {
        try {
          fs.rmSync(sourcePath, { force: true });
          sourceDeleted = true;
        } catch (error) {
          warnings.push({ code: "MEMORY_ARTIFACT_SOURCE_DELETE_FAILED", artifactId: artifact.artifact_id, message: text(error.message, 500) });
        }
      }
      artifact.integrity_state = "expired";
      artifact.location = { store: "tombstone", relative_path: "" };
      artifact.preview = "";
      artifact.retention = {
        ...(artifact.retention || {}),
        deleted_at: current.toISOString(),
        deletion_reason: text(reason || "retention_expired", 240),
        source_location: sourceRelativePath,
        source_deleted: sourceDeleted,
      };
      expired.push(artifact.artifact_id);
    }
    if (!expired.length) {
      return { ok: true, operationId: "", recordIds: [], previousRevision: loaded.registry.revision, revision: loaded.registry.revision, changed: false, conflicts: [], warnings: [], expired: [], sourceRevision: loaded.registry.revision };
    }
    const previousRevision = loaded.registry.revision;
    loaded.registry.revision += 1;
    loaded.registry.updated_at = timestamp(now);
    const saved = persistRegistry(workspace, loaded.registry);
    if (!saved.ok) return saved;
    const operationId = createOpaqueId("op", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
    return { ok: warnings.length === 0, operationId, recordIds: expired, previousRevision, revision: loaded.registry.revision, changed: true, conflicts: [], warnings: warnings.slice(0, 100), expired, sourceRevision: loaded.registry.revision, path: saved.path };
  }

  return Object.freeze({
    ARTIFACT_REGISTRY_SCHEMA_VERSION,
    registryDirectory,
    registryFile,
    emptyRegistry,
    normalizeArtifact,
    readRegistry,
    register,
    list,
    get,
    expand,
    verify,
    expire,
  });
}

module.exports = Object.freeze({ createArtifactRegistry, ARTIFACT_REGISTRY_SCHEMA_VERSION, MAX_PREVIEW_CHARS, MAX_ARTIFACT_READ_BYTES });
