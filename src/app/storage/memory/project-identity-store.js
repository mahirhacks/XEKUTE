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

const REGISTRY_SCHEMA_VERSION = 3;

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

  function defaultRegistry() {
    return { schema_version: REGISTRY_SCHEMA_VERSION, updated_at: timestamp(now), projects: {} };
  }

  function validProjectId(value) {
    const input = String(value == null ? "" : value).trim();
    return isMemoryId(input, "proj");
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
    const loaded = readRegistry();
    if (!loaded.ok) return loaded;
    const entry = registryEntry(loaded.registry, canonical);
    const registryProjectId = String(entry?.project_id || "").trim();
    const requested = String(requestedProjectId || "").trim();
    if (requested && !validProjectId(requested)) return operationFailure("MEMORY_PROJECT_ID_INVALID", "The requested project ID is invalid.", { projectId: requested });
    if (requested && registryProjectId && requested !== registryProjectId) {
      return operationFailure("MEMORY_PROJECT_ID_CONFLICT", "The requested project ID conflicts with the protected workspace binding.", { requestedProjectId: requested, registryProjectId });
    }

    // The protected registry is the sole project identity source.  In
    // particular, do not inspect a workspace `.xekute/memory/manifest.json`:
    // that path belonged to a retired workspace memory implementation and must
    // remain inert in the clean-slate runtime.
    const projectId = registryProjectId || requested;
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
        persisted: Boolean(entry) || persist,
        source: entry ? "protected_registry" : "requested",
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

  // V3 resolution deliberately consults only the protected project registry.
  // It never opens a workspace memory manifest or any prior memory store.
  function resolveV3Project(rawWorkspace, { persist = false, projectId: requestedProjectId = "" } = {}) {
    return resolveProject(rawWorkspace, { persist, projectId: requestedProjectId });
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
    canonicalWorkspace,
    displayWorkspace,
    readRegistry,
    listBindings,
    resolveProject,
    resolveV3Project,
    bindWorkspace,
    enqueue,
    REGISTRY_SCHEMA_VERSION,
  });
}

module.exports = Object.freeze({ createProjectIdentityStore, REGISTRY_SCHEMA_VERSION });
