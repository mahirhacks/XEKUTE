"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const {
  atomicWriteJson,
  clone,
  operationFailure,
  readJsonWithBackup,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");
const { createOpaqueId, isMemoryId } = require("../../../contracts/memory/memory-identity.js");

const REGISTRY_SCHEMA_VERSION = 2;
const LEGACY_PROJECT_ID = /^(?:project[-_:])[a-z0-9._:-]{8,240}$/i;

function createProjectIdentityStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Project identity store dependencies are required.");

  const rootDir = path.resolve(String(baseDir));
  const registryFile = path.join(rootDir, "project-registry.json");
  const writeQueue = { pending: Promise.resolve() };

  function displayWorkspace(rawWorkspace) {
    return resolvedWorkspace(path, rawWorkspace);
  }

  function canonicalWorkspace(rawWorkspace) {
    const workspace = displayWorkspace(rawWorkspace).replace(/[\\/]+$/, "") || path.parse(displayWorkspace(rawWorkspace)).root;
    return process.platform === "win32" ? workspace.toLowerCase() : workspace;
  }

  function manifestFile(rawWorkspace) {
    return path.join(displayWorkspace(rawWorkspace), ".xekute", "memory", "manifest.json");
  }

  function defaultRegistry() {
    return { schema_version: REGISTRY_SCHEMA_VERSION, updated_at: timestamp(now), projects: {} };
  }

  function validProjectId(value) {
    const input = String(value == null ? "" : value).trim();
    return isMemoryId(input, "proj") || LEGACY_PROJECT_ID.test(input);
  }

  function normalizeEntry(value, canonical, fallbackTime) {
    const source = typeof value === "string" ? { project_id: value } : (value && typeof value === "object" ? value : {});
    const projectId = String(source.project_id || source.projectId || "").trim();
    if (!validProjectId(projectId)) return null;
    const aliases = [...new Set([
      ...(Array.isArray(source.aliases) ? source.aliases : []),
      ...(Array.isArray(source.workspace_aliases) ? source.workspace_aliases : []),
    ].map((value) => String(value || "").trim()).filter(Boolean))].slice(-100);
    return {
      project_id: projectId,
      project_path: String(source.project_path || source.workspace || canonical).trim().slice(0, 4_000),
      created_at: String(source.created_at || source.createdAt || fallbackTime),
      updated_at: String(source.updated_at || source.updatedAt || fallbackTime),
      aliases,
    };
  }

  function normalizeRegistry(value) {
    const source = value && typeof value === "object" ? value : {};
    const fallbackTime = timestamp(now);
    const projects = {};
    for (const [key, entry] of Object.entries(source.projects && typeof source.projects === "object" ? source.projects : {})) {
      const canonical = String(key || "").trim();
      if (!canonical) continue;
      const normalized = normalizeEntry(entry, canonical, fallbackTime);
      if (normalized) projects[canonical] = normalized;
    }
    // A few early development builds used a top-level alias map. Preserve it
    // as regular path entries so a registry repair cannot lose a binding.
    for (const [alias, projectId] of Object.entries(source.aliases && typeof source.aliases === "object" ? source.aliases : {})) {
      const canonical = String(alias || "").trim();
      if (!canonical || projects[canonical]) continue;
      const normalized = normalizeEntry({ project_id: projectId, project_path: canonical }, canonical, fallbackTime);
      if (normalized) projects[canonical] = normalized;
    }
    return { schema_version: REGISTRY_SCHEMA_VERSION, updated_at: String(source.updated_at || source.updatedAt || fallbackTime), projects };
  }

  function readRegistry() {
    const loaded = readJsonWithBackup({ fs }, registryFile);
    if (!loaded.ok) return { ok: false, ...operationFailure("MEMORY_PROJECT_REGISTRY_CORRUPT", `The project registry could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: registryFile }) };
    const registry = normalizeRegistry(loaded.value || defaultRegistry());
    return { ok: true, registry, exists: loaded.exists, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", path: registryFile };
  }

  function persistRegistry(registry) {
    const normalized = normalizeRegistry(registry);
    const result = atomicWriteJson({ fs, path, crypto }, registryFile, {
      schema_version: REGISTRY_SCHEMA_VERSION,
      updated_at: timestamp(now),
      projects: normalized.projects,
    });
    return { ok: true, path: result.path, registry: normalized };
  }

  function readManifestProjectId(workspace) {
    const file = manifestFile(workspace);
    if (!fs.existsSync(file)) return { ok: true, exists: false, projectId: "", path: file };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const projectId = String(parsed?.project_id || parsed?.projectId || "").trim();
      if (!validProjectId(projectId)) return operationFailure("MEMORY_PROJECT_MANIFEST_INVALID", "The workspace memory manifest contains an invalid project ID.", { path: file });
      return { ok: true, exists: true, projectId, path: file };
    } catch (error) {
      return operationFailure("MEMORY_PROJECT_MANIFEST_INVALID", `The workspace memory manifest could not be read: ${error.message}.`, { path: file });
    }
  }

  function registryEntry(registry, canonical) {
    const entry = registry?.projects?.[canonical];
    return entry && typeof entry === "object" ? entry : entry ? { project_id: entry } : null;
  }

  function persistBinding(registry, canonical, workspace, projectId, { alias = "" } = {}) {
    const stamp = timestamp(now);
    const prior = registryEntry(registry, canonical);
    if (prior && prior.project_id && prior.project_id !== projectId) {
      return operationFailure("MEMORY_PROJECT_ID_CONFLICT", "The workspace is already bound to a different project ID.", {
        canonical,
        existingProjectId: prior.project_id,
        requestedProjectId: projectId,
      });
    }
    const aliases = [...new Set([...(prior?.aliases || []), alias].map((value) => String(value || "").trim()).filter(Boolean))].slice(-100);
    registry.projects[canonical] = {
      project_id: projectId,
      project_path: workspace,
      created_at: prior?.created_at || stamp,
      updated_at: stamp,
      aliases,
    };
    return { ok: true, registry };
  }

  function resolveProject(rawWorkspace, { persist = false, projectId: requestedProjectId = "" } = {}) {
    let workspace;
    try { workspace = displayWorkspace(rawWorkspace); } catch (error) {
      return operationFailure("MEMORY_WORKSPACE_REQUIRED", error.message);
    }
    const canonical = canonicalWorkspace(workspace);
    const manifest = readManifestProjectId(workspace);
    if (!manifest.ok) return manifest;

    const loaded = readRegistry();
    if (!loaded.ok) return loaded;
    const entry = registryEntry(loaded.registry, canonical);
    const registryProjectId = String(entry?.project_id || "").trim();
    const manifestProjectId = manifest.projectId;
    if (manifestProjectId && registryProjectId && manifestProjectId !== registryProjectId) {
      return operationFailure("MEMORY_PROJECT_ID_CONFLICT", "The workspace manifest and protected registry disagree about project identity.", {
        canonical,
        manifestProjectId,
        registryProjectId,
      });
    }
    const requested = String(requestedProjectId || "").trim();
    if (requested && !validProjectId(requested)) return operationFailure("MEMORY_PROJECT_ID_INVALID", "The requested project ID is invalid.", { projectId: requested });
    if (requested && ((manifestProjectId && requested !== manifestProjectId) || (registryProjectId && requested !== registryProjectId))) {
      return operationFailure("MEMORY_PROJECT_ID_CONFLICT", "The requested project ID conflicts with the known workspace binding.", { requestedProjectId: requested, manifestProjectId, registryProjectId });
    }

    const projectId = manifestProjectId || registryProjectId || requested;
    if (projectId) {
      if (persist && (!entry || entry.project_id !== projectId || entry.project_path !== workspace)) {
        const bound = persistBinding(loaded.registry, canonical, workspace, projectId, { alias: entry?.project_path || "" });
        if (!bound.ok) return bound;
        try { persistRegistry(bound.registry); } catch (error) {
          return operationFailure("MEMORY_PROJECT_REGISTRY_WRITE_FAILED", `The project registry could not be updated: ${error.message}.`, { path: registryFile }, true);
        }
      }
      return {
        ok: true,
        initialized: true,
        workspace,
        canonical,
        projectId,
        persisted: Boolean(entry || manifestProjectId),
        source: manifestProjectId ? "workspace_manifest" : "protected_registry",
        registryRecovered: Boolean(loaded.recovered),
        warning: loaded.warning || "",
      };
    }
    if (!persist) return { ok: true, initialized: false, workspace, canonical, projectId: "", persisted: false, source: "uninitialized" };

    const createdProjectId = createOpaqueId("proj", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
    const bound = persistBinding(loaded.registry, canonical, workspace, createdProjectId);
    if (!bound.ok) return bound;
    try { persistRegistry(bound.registry); } catch (error) {
      return operationFailure("MEMORY_PROJECT_REGISTRY_WRITE_FAILED", `The project registry could not be created: ${error.message}.`, { path: registryFile }, true);
    }
    return { ok: true, initialized: true, workspace, canonical, projectId: createdProjectId, persisted: true, source: "created", registryRecovered: false, warning: "" };
  }

  function bindWorkspace(rawWorkspace, projectId, { persist = true } = {}) {
    let workspace;
    try { workspace = displayWorkspace(rawWorkspace); } catch (error) { return operationFailure("MEMORY_WORKSPACE_REQUIRED", error.message); }
    const requested = String(projectId || "").trim();
    if (!validProjectId(requested)) return operationFailure("MEMORY_PROJECT_ID_INVALID", "A valid project ID is required to bind a workspace.", { projectId: requested });
    const loaded = readRegistry();
    if (!loaded.ok) return loaded;
    const canonical = canonicalWorkspace(workspace);
    const existing = registryEntry(loaded.registry, canonical);
    if (existing?.project_id && existing.project_id !== requested) return operationFailure("MEMORY_PROJECT_ID_CONFLICT", "The workspace is already bound to a different project ID.", { canonical, existingProjectId: existing.project_id, requestedProjectId: requested });
    if (!persist) return { ok: true, workspace, canonical, projectId: requested, persisted: false };
    const result = persistBinding(loaded.registry, canonical, workspace, requested, { alias: existing?.project_path || "" });
    if (!result.ok) return result;
    try { persistRegistry(result.registry); } catch (error) { return operationFailure("MEMORY_PROJECT_REGISTRY_WRITE_FAILED", `The project registry could not be updated: ${error.message}.`, { path: registryFile }, true); }
    return { ok: true, workspace, canonical, projectId: requested, persisted: true };
  }

  function listBindings(projectId = "") {
    const loaded = readRegistry();
    if (!loaded.ok) return loaded;
    const filter = String(projectId || "").trim();
    const bindings = Object.entries(loaded.registry.projects).filter(([, entry]) => !filter || entry.project_id === filter).map(([canonical, entry]) => ({ canonical, ...clone(entry) }));
    return { ok: true, bindings, recovered: Boolean(loaded.recovered), warning: loaded.warning || "" };
  }

  function enqueue(operation) {
    const prior = writeQueue.pending;
    const next = prior.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (writeQueue.pending === queued) writeQueue.pending = Promise.resolve(); });
    writeQueue.pending = queued;
    return queued;
  }

  return Object.freeze({
    registryFile,
    manifestFile,
    canonicalWorkspace,
    displayWorkspace,
    readRegistry,
    listBindings,
    resolveProject,
    bindWorkspace,
    enqueue,
    REGISTRY_SCHEMA_VERSION,
  });
}

module.exports = Object.freeze({ createProjectIdentityStore, REGISTRY_SCHEMA_VERSION });
