"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId } = require("../../../contracts/memory/memory-identity.js");
const { validateKnowledgeRelease, releaseHash } = require("../../../domain/memory/knowledge/knowledge-release.js");
const { atomicWriteJson, clone, operationFailure, readJsonWithBackup, safeComponent } = require("./memory-storage-utils.js");

const KNOWLEDGE_RELEASE_STORE_VERSION = 1;

function createKnowledgeReleaseStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  baseDir,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !baseDir) throw new TypeError("Knowledge release store dependencies are required.");
  const root = path.resolve(String(baseDir));
  const releasesDir = path.join(root, "knowledge-releases");
  const cache = new Map();

  function releaseFile(releaseId) { return path.join(releasesDir, `${safeComponent(releaseId, "release")}.json`); }
  function readFile(file) {
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_KB_RELEASE_CORRUPT", `Knowledge release could not be read: ${loaded.error?.message || "invalid JSON"}.`, { path: file }, true);
    if (!loaded.exists) return { ok: false, code: "MEMORY_KB_RELEASE_NOT_FOUND", error: "Knowledge release was not found.", retryable: false, details: { path: file } };
    const checked = validateKnowledgeRelease(loaded.value, { crypto, now });
    if (!checked.ok) return operationFailure("MEMORY_KB_RELEASE_INVALID", checked.error, { path: file, cause: checked.code }, false);
    return { ok: true, release: checked.release, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", path: file };
  }
  function install(input = {}) {
    const checked = validateKnowledgeRelease(input, { crypto, now });
    if (!checked.ok) return checked;
    const release = checked.release;
    const file = releaseFile(release.release_id);
    if (cache.has(release.release_id)) {
      const prior = cache.get(release.release_id);
      if (prior.content_hash !== release.content_hash) return operationFailure("MEMORY_KB_RELEASE_IMMUTABLE", "A Knowledge release ID is already installed with different content.", { releaseId: release.release_id });
      return { ok: true, changed: false, duplicate: true, releaseId: release.release_id, contentHash: release.content_hash, release: clone(prior) };
    }
    const existing = readJsonWithBackup({ fs }, file);
    if (existing.exists) {
      if (!existing.ok) return operationFailure("MEMORY_KB_RELEASE_CORRUPT", "An existing Knowledge release could not be validated.", { path: file }, true);
      const loaded = validateKnowledgeRelease(existing.value, { crypto, now });
      if (!loaded.ok) return operationFailure("MEMORY_KB_RELEASE_INVALID", loaded.error, { path: file, cause: loaded.code });
      if (loaded.release.content_hash !== release.content_hash) return operationFailure("MEMORY_KB_RELEASE_IMMUTABLE", "A Knowledge release cannot be overwritten with different content.", { releaseId: release.release_id, existingHash: loaded.release.content_hash, requestedHash: release.content_hash });
      cache.set(release.release_id, clone(loaded.release));
      return { ok: true, changed: false, duplicate: true, releaseId: release.release_id, contentHash: release.content_hash, release: clone(loaded.release) };
    }
    try {
      atomicWriteJson({ fs, path, crypto }, file, release, { backup: false });
    } catch (error) {
      return operationFailure("MEMORY_KB_RELEASE_WRITE_FAILED", `Knowledge release could not be installed: ${error.message}.`, { path: file }, true);
    }
    cache.set(release.release_id, clone(release));
    return { ok: true, changed: true, duplicate: false, releaseId: release.release_id, contentHash: release.content_hash, release: clone(release) };
  }
  function get(releaseId) {
    let id;
    try { id = assertMemoryId(releaseId, "kb"); } catch (error) { return operationFailure(error.code || "MEMORY_KB_RELEASE_ID_INVALID", error.message, error.details || {}); }
    if (cache.has(id)) return { ok: true, release: clone(cache.get(id)), source: "cache" };
    const loaded = readFile(releaseFile(id));
    if (!loaded.ok) return loaded;
    cache.set(id, clone(loaded.release));
    return { ok: true, release: clone(loaded.release), source: loaded.recovered ? "backup" : "disk", warning: loaded.warning || "" };
  }
  function procedure(releaseId, procedureId) {
    const loaded = get(releaseId);
    if (!loaded.ok) return loaded;
    const id = String(procedureId || "").trim();
    const found = loaded.release.procedures.find((entry) => entry.procedure_id === id || entry.aliases.includes(id));
    if (!found) return operationFailure("MEMORY_KB_PROCEDURE_NOT_FOUND", "The requested Knowledge procedure was not found in the release.", { releaseId, procedureId: id });
    return { ok: true, releaseId, contentHash: loaded.release.content_hash, procedure: clone(found) };
  }
  function list({ state = "", limit = 50, cursor = "" } = {}) {
    const maximum = Math.max(1, Math.min(Number(limit) || 50, 200));
    let files = [];
    try { files = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b)) : []; } catch (error) { return operationFailure("MEMORY_KB_RELEASE_LIST_FAILED", error.message, { path: releasesDir }, true); }
    const start = cursor ? (() => {
      const index = files.findIndex((file) => file.replace(/\.json$/, "") > cursor);
      return index < 0 ? files.length : index;
    })() : 0;
    const items = [];
    for (const file of files.slice(start)) {
      const loaded = get(file.replace(/\.json$/, ""));
      if (!loaded.ok) continue;
      if (state && loaded.release.state !== state) continue;
      items.push({ release_id: loaded.release.release_id, content_hash: loaded.release.content_hash, state: loaded.release.state, created_at: loaded.release.created_at, published_at: loaded.release.published_at, source: clone(loaded.release.source), procedure_count: loaded.release.procedures.length, aliases: clone(loaded.release.aliases) });
      if (items.length >= maximum) break;
    }
    const last = items.at(-1)?.release_id || "";
    return { ok: true, items, limit: maximum, cursor: cursor || "", nextCursor: items.length === maximum ? last : null, total: files.length };
  }
  function catalogue(releaseId = "") {
    if (releaseId) {
      const loaded = get(releaseId);
      if (!loaded.ok) return loaded;
      return { ok: true, release_id: loaded.release.release_id, content_hash: loaded.release.content_hash, state: loaded.release.state, catalogue: clone(loaded.release.catalogue) };
    }
    return list({ limit: 200 });
  }
  function invalidate() { cache.clear(); }
  return Object.freeze({
    KNOWLEDGE_RELEASE_STORE_VERSION,
    root,
    releasesDir,
    install,
    get,
    procedure,
    list,
    catalogue,
    invalidate,
    releaseHash,
  });
}

module.exports = Object.freeze({ createKnowledgeReleaseStore, KNOWLEDGE_RELEASE_STORE_VERSION });
