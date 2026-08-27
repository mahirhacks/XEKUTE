"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, createOpaqueId } = require("../../../contracts/memory/index.js");
const { atomicWriteJson, clone, operationFailure, readJsonWithBackup, resolvedWorkspace, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const KNOWLEDGE_SELECTION_SCHEMA_VERSION = 1;
const MAX_SELECTIONS = 500;
const MAX_PROCEDURES = 200;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function selectionHash(value, crypto = nodeCrypto) { return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }

function createKnowledgeSelectionService({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  releaseStore,
  projectRepository = null,
  manifestStore = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !releaseStore?.get || !releaseStore?.list) throw new TypeError("Knowledge selection requires an immutable release store.");
  const queues = new Map();

  function rootOf(workspace) { return resolvedWorkspace(path, workspace); }
  function selectionFile(workspace) { return path.join(rootOf(workspace), ".xekute", "memory", "knowledge", "selections.json"); }
  function queueKey(workspace, projectId) { return `${rootOf(workspace)}|${projectId}`; }
  function enqueue(workspace, projectId, operation) {
    const key = queueKey(workspace, projectId);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    const pending = next.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
    queues.set(key, pending);
    return pending;
  }
  function empty(projectId) { return { schema_version: KNOWLEDGE_SELECTION_SCHEMA_VERSION, project_id: projectId, revision: 0, selections: [] }; }
  function normalize(input, projectId) {
    const source = input && typeof input === "object" ? input : {};
    const actual = assertMemoryId(source.project_id || projectId, "proj");
    if (actual !== projectId) throw Object.assign(new Error("Knowledge selections belong to a different project."), { code: "MEMORY_PROJECT_MISMATCH" });
    return {
      schema_version: KNOWLEDGE_SELECTION_SCHEMA_VERSION,
      project_id: projectId,
      revision: Number.isSafeInteger(Number(source.revision)) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
      selections: (Array.isArray(source.selections) ? source.selections : []).filter((entry) => entry && typeof entry === "object").map((entry) => ({
        selection_id: text(entry.selection_id || entry.selectionId, 240),
        project_id: projectId,
        objective: text(entry.objective, 2_000),
        release_id: text(entry.release_id || entry.releaseId, 240),
        content_hash: text(entry.content_hash || entry.contentHash, 128),
        project_revision: Number.isSafeInteger(Number(entry.project_revision)) && Number(entry.project_revision) >= 0 ? Number(entry.project_revision) : 0,
        procedure_ids: [...new Set((Array.isArray(entry.procedure_ids) ? entry.procedure_ids : []).map((value) => text(value, 240)).filter(Boolean))].slice(0, MAX_PROCEDURES),
        status: ["pending", "validated", "finalized", "superseded"].includes(String(entry.status || "")) ? String(entry.status) : "pending",
        selection_hash: text(entry.selection_hash || entry.selectionHash, 128),
        created_at: text(entry.created_at || timestamp(now), 80),
        updated_at: text(entry.updated_at || timestamp(now), 80),
        finalized_at: text(entry.finalized_at, 80),
        source: clone(entry.source || { type: "operator_or_agent_selection" }),
      })).filter((entry) => entry.selection_id && entry.release_id).slice(-MAX_SELECTIONS),
    };
  }
  function load(workspace, projectId) {
    let root;
    try { root = rootOf(workspace); assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_SELECTION_INPUT_INVALID", error.message, error.details || {}); }
    const loaded = readJsonWithBackup({ fs }, selectionFile(root));
    if (!loaded.ok) return operationFailure("MEMORY_SELECTION_STORE_CORRUPT", loaded.error?.message || "The selection store could not be read.", { path: selectionFile(root) }, true);
    if (!loaded.exists) return { ok: true, initialized: false, document: empty(projectId), warning: "" };
    try { return { ok: true, initialized: true, document: normalize(loaded.value, projectId), warning: loaded.warning || "" }; } catch (error) { return operationFailure(error.code || "MEMORY_SELECTION_STORE_INVALID", error.message, { path: selectionFile(root) }); }
  }
  function persist(workspace, document) {
    try {
      const written = atomicWriteJson({ fs, path, crypto }, selectionFile(workspace), document);
      return { ok: true, path: written.path, document };
    } catch (error) { return operationFailure("MEMORY_SELECTION_STORE_WRITE_FAILED", error.message, { path: selectionFile(workspace) }, true); }
  }
  async function currentProjectRevision(workspace, projectId, fallback = 0) {
    if (!projectRepository?.status) return Number(fallback) || 0;
    const status = await projectRepository.status(workspace, projectId);
    return status?.ok ? Number(status.revision) || 0 : Number(fallback) || 0;
  }
  function releaseFor(releaseId) {
    if (releaseId) return releaseStore.get(releaseId);
    const list = releaseStore.list({ state: "published", limit: 200 });
    if (!list.ok || !list.items.length) return operationFailure("MEMORY_KB_RELEASE_NOT_FOUND", "No published Knowledge release is installed.");
    return releaseStore.get(list.items.at(-1).release_id);
  }
  function findSelection(document, selectionId) {
    return document.selections.find((entry) => entry.selection_id === String(selectionId || ""));
  }
  function validateProcedureIds(release, procedureIds) {
    const requested = [...new Set((Array.isArray(procedureIds) ? procedureIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
    const valid = [];
    const invalid = [];
    for (const requestedId of requested) {
      const procedure = release.procedures.find((entry) => entry.procedure_id === requestedId || entry.aliases.includes(requestedId));
      if (!procedure) invalid.push({ procedureId: requestedId, code: "MEMORY_KB_PROCEDURE_NOT_FOUND" });
      else valid.push(procedure.procedure_id);
    }
    return { requested, valid: [...new Set(valid)], invalid };
  }

  async function startSelection({ workspace, projectId, objective, releaseId = "", source = {} } = {}) {
    const project = String(projectId || "");
    try { assertMemoryId(project, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_SELECTION_PROJECT_INVALID", error.message, error.details || {}); }
    const goal = text(objective, 2_000);
    if (!goal) return operationFailure("MEMORY_SELECTION_OBJECTIVE_REQUIRED", "A Knowledge selection requires an objective.");
    const release = releaseFor(releaseId);
    if (!release.ok) return release;
    return enqueue(workspace, project, async () => {
      const loaded = load(workspace, project);
      if (!loaded.ok) return loaded;
      const nowStamp = timestamp(now);
      const record = { selection_id: createOpaqueId("sel", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() }), project_id: project, objective: goal, release_id: release.release.release_id, content_hash: release.release.content_hash, project_revision: await currentProjectRevision(workspace, project), procedure_ids: [], status: "pending", selection_hash: "", created_at: nowStamp, updated_at: nowStamp, finalized_at: "", source: { type: text(source.type || "operator_or_agent_selection", 100), refs: Array.isArray(source.refs) ? source.refs.slice(0, 20).map((value) => text(value, 300)) : [] } };
      const document = loaded.document;
      document.selections = [...document.selections.filter((entry) => entry.status !== "pending"), record].slice(-MAX_SELECTIONS);
      document.revision += 1;
      const saved = manifestStore?.initialize ? manifestStore.initialize(workspace, project, { reason: "knowledge_selection" }) : { ok: true };
      if (!saved.ok) return saved;
      const persisted = persist(workspace, normalize(document, project));
      if (!persisted.ok) return persisted;
      return { ok: true, changed: true, selection: clone(record), revision: document.revision };
    });
  }

  function getSelection(workspace, projectId, selectionId) {
    const loaded = load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const selection = findSelection(loaded.document, selectionId);
    if (!selection) return operationFailure("MEMORY_SELECTION_NOT_FOUND", "The Knowledge selection was not found.", { selectionId });
    return { ok: true, selection: clone(selection), revision: loaded.document.revision };
  }

  function queryCatalogue({ releaseId = "" } = {}) {
    const release = releaseFor(releaseId);
    if (!release.ok) return release;
    return { ok: true, release_id: release.release.release_id, content_hash: release.release.content_hash, state: release.release.state, catalogue: clone(release.release.catalogue) };
  }
  function querySections({ releaseId, procedureIds = [], sections = [] } = {}) {
    const release = releaseFor(releaseId);
    if (!release.ok) return release;
    const checked = validateProcedureIds(release.release, procedureIds);
    if (checked.invalid.length) return { ok: false, code: "MEMORY_KB_PROCEDURE_NOT_FOUND", error: "One or more procedures were not found.", retryable: false, details: { invalid: checked.invalid } };
    const wanted = new Set((Array.isArray(sections) ? sections : []).map((value) => String(value || "").trim()).filter(Boolean));
    const procedures = checked.valid.map((id) => release.release.procedures.find((entry) => entry.procedure_id === id)).map((procedure) => {
      if (!wanted.size) return clone(procedure);
      const selected = { procedure_id: procedure.procedure_id, release_id: procedure.release_id, title: procedure.title, objective: procedure.objective };
      for (const field of wanted) if (Object.prototype.hasOwnProperty.call(procedure, field)) selected[field] = clone(procedure[field]);
      return selected;
    });
    return { ok: true, release_id: release.release.release_id, content_hash: release.release.content_hash, procedures };
  }

  async function updateSelection(workspace, projectId, selectionId, operation) {
    return enqueue(workspace, projectId, async () => {
      const loaded = load(workspace, projectId);
      if (!loaded.ok) return loaded;
      const selection = findSelection(loaded.document, selectionId);
      if (!selection) return operationFailure("MEMORY_SELECTION_NOT_FOUND", "The Knowledge selection was not found.", { selectionId });
      if (selection.status === "finalized") return operationFailure("MEMORY_SELECTION_FINALIZED", "A finalized Knowledge selection is immutable.", { selectionId });
      const result = await operation(selection, loaded.document);
      if (!result.ok) return result;
      selection.updated_at = timestamp(now);
      loaded.document.revision += result.changed ? 1 : 0;
      const saved = result.changed ? persist(workspace, normalize(loaded.document, projectId)) : { ok: true };
      if (!saved.ok) return saved;
      return { ...result, selection: clone(selection), revision: loaded.document.revision };
    });
  }
  async function add({ workspace, projectId, selectionId, procedureIds = [] } = {}) {
    const found = getSelection(workspace, projectId, selectionId);
    if (!found.ok) return found;
    const release = releaseStore.get(found.selection.release_id);
    if (!release.ok) return release;
    return updateSelection(workspace, projectId, selectionId, async (selection) => {
      const checked = validateProcedureIds(release.release, procedureIds);
      const before = [...selection.procedure_ids];
      selection.procedure_ids = [...new Set([...before, ...checked.valid])].slice(0, MAX_PROCEDURES);
      return { ok: true, changed: selection.procedure_ids.length !== before.length, added: checked.valid, invalid: checked.invalid };
    });
  }
  async function remove({ workspace, projectId, selectionId, procedureIds = [] } = {}) {
    const found = getSelection(workspace, projectId, selectionId);
    if (!found.ok) return found;
    return updateSelection(workspace, projectId, selectionId, async (selection) => {
      const requested = new Set((Array.isArray(procedureIds) ? procedureIds : []).map(String));
      const before = [...selection.procedure_ids];
      selection.procedure_ids = before.filter((id) => !requested.has(id));
      return { ok: true, changed: selection.procedure_ids.length !== before.length, removed: before.filter((id) => requested.has(id)), invalid: [...requested].filter((id) => !before.includes(id)).map((procedureId) => ({ procedureId, code: "MEMORY_KB_PROCEDURE_NOT_SELECTED" })) };
    });
  }
  async function validateSelection({ workspace, projectId, selectionId } = {}) {
    const found = getSelection(workspace, projectId, selectionId);
    if (!found.ok) return found;
    const release = releaseStore.get(found.selection.release_id);
    if (!release.ok) return { ok: false, selectionId, valid: false, errors: [{ code: release.code, error: release.error }] };
    const checked = validateProcedureIds(release.release, found.selection.procedure_ids);
    const currentRevision = await currentProjectRevision(workspace, projectId, found.selection.project_revision);
    const errors = [];
    if (!found.selection.objective) errors.push({ code: "MEMORY_SELECTION_OBJECTIVE_REQUIRED" });
    if (checked.invalid.length) errors.push(...checked.invalid);
    if (!found.selection.procedure_ids.length) errors.push({ code: "MEMORY_SELECTION_EMPTY" });
    const stale = currentRevision !== found.selection.project_revision;
    return { ok: true, selectionId, valid: errors.length === 0, errors, staleProjectRevision: stale, projectRevision: found.selection.project_revision, currentProjectRevision: currentRevision, releaseId: release.release.release_id, contentHash: release.release.content_hash, procedureIds: checked.valid };
  }
  async function finalizeSelection({ workspace, projectId, selectionId } = {}) {
    const validation = await validateSelection({ workspace, projectId, selectionId });
    if (!validation.ok) return validation;
    if (!validation.valid || validation.staleProjectRevision) return operationFailure(validation.staleProjectRevision ? "MEMORY_SELECTION_PROJECT_STALE" : "MEMORY_SELECTION_INVALID", validation.staleProjectRevision ? "The Project Memory revision changed; start a new selection or explicitly refresh it." : "The Knowledge selection is not valid.", { validation });
    const current = getSelection(workspace, projectId, selectionId);
    if (current.ok && current.selection.status === "finalized") {
      return { ok: true, changed: false, selection: current.selection, selectionHash: current.selection.selection_hash, revision: current.revision };
    }
    return updateSelection(workspace, projectId, selectionId, async (selection) => {
      const hash = selectionHash({ project_id: projectId, objective: selection.objective, release_id: selection.release_id, content_hash: selection.content_hash, project_revision: selection.project_revision, procedure_ids: selection.procedure_ids }, crypto);
      const changed = selection.status !== "finalized" || selection.selection_hash !== hash;
      selection.status = "finalized";
      selection.selection_hash = hash;
      selection.finalized_at ||= timestamp(now);
      return { ok: true, changed, selectionHash: hash };
    });
  }
  function buildInvestigationMemory({ workspace, projectId, selectionId } = {}) {
    const found = getSelection(workspace, projectId, selectionId);
    if (!found.ok) return found;
    if (found.selection.status !== "finalized") return operationFailure("MEMORY_SELECTION_NOT_FINALIZED", "Investigation Memory can only be built from a finalized Knowledge selection.", { selectionId });
    const release = releaseStore.get(found.selection.release_id);
    if (!release.ok) return release;
    const procedures = found.selection.procedure_ids.map((id, index) => {
      const procedure = release.release.procedures.find((entry) => entry.procedure_id === id);
      return { order: index + 1, procedure_id: id, title: procedure?.title || id, objective: procedure?.objective || "", target_features: clone(procedure?.target_features || []), applicable_technologies: clone(procedure?.applicable_technologies || []), release_id: release.release.release_id, content_hash: release.release.content_hash };
    });
    return { ok: true, selection_id: found.selection.selection_id, project_id: projectId, objective: found.selection.objective, project_revision: found.selection.project_revision, release_id: release.release.release_id, content_hash: release.release.content_hash, selection_hash: found.selection.selection_hash, procedures, status: "proposed" };
  }
  function list({ workspace, projectId, status = "", limit = 50 } = {}) {
    const loaded = load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const items = loaded.document.selections.filter((entry) => !status || entry.status === status).slice(-Math.min(200, Math.max(1, Number(limit) || 50))).map(clone);
    return { ok: true, items, revision: loaded.document.revision, initialized: loaded.initialized };
  }

  return Object.freeze({
    KNOWLEDGE_SELECTION_SCHEMA_VERSION,
    load,
    startSelection,
    getSelection,
    queryCatalogue,
    querySections,
    add,
    remove,
    validate: validateSelection,
    finalizeSelection,
    buildInvestigationMemory,
    list,
  });
}

module.exports = Object.freeze({ createKnowledgeSelectionService, KNOWLEDGE_SELECTION_SCHEMA_VERSION });
