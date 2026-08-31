"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { canonicalKeyHash, createOpaqueId, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretValues, atomicWriteJson, clone, ensureDirectory, fileSha256, operationFailure, readJsonWithBackup, timestamp } = require("../../storage/memory/memory-storage-utils.js");

// The BGE retrieval profile reserves at most 384 approximate tokens per
// knowledge chunk (with a 48-token overlap).  Chunking is intentionally
// content-addressed: the same source text and source reference always produce
// the same IDs, regardless of import order or process restart.
const KNOWLEDGE_CHUNK_MAX_TOKENS = 384;
const KNOWLEDGE_CHUNK_OVERLAP_TOKENS = 48;
const KNOWLEDGE_TOKEN_BYTES = 4;

function normalizedChunkText(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function estimatedChunkTokens(value) {
  return Math.max(1, Math.ceil(Buffer.byteLength(String(value || ""), "utf8") / KNOWLEDGE_TOKEN_BYTES));
}

function splitKnowledgeText(value) {
  const text = normalizedChunkText(value);
  if (!text) return [];
  if (estimatedChunkTokens(text) <= KNOWLEDGE_CHUNK_MAX_TOKENS) return [{ text, token_count: estimatedChunkTokens(text), part: 0 }];

  // Build chunks on whitespace boundaries.  The byte estimate is conservative
  // and keeps non-ASCII text within the declared cap even when the provider's
  // tokenizer is unavailable during package installation.
  const words = text.split(" ");
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    let end = start;
    let candidate = "";
    while (end < words.length) {
      const next = candidate ? `${candidate} ${words[end]}` : words[end];
      if (candidate && estimatedChunkTokens(next) > KNOWLEDGE_CHUNK_MAX_TOKENS) break;
      candidate = next;
      end += 1;
      // A single very long token has no useful whitespace boundary.  Leave it
      // to the character fallback below rather than looping forever.
      if (end === start + 1 && estimatedChunkTokens(candidate) > KNOWLEDGE_CHUNK_MAX_TOKENS) {
        // The first token itself is larger than the cap.  Force the
        // character-bounded fallback below instead of emitting an oversized
        // chunk or spinning on the same word.
        candidate = "";
        end = start;
        break;
      }
    }
    if (!candidate) {
      const maxBytes = KNOWLEDGE_CHUNK_MAX_TOKENS * KNOWLEDGE_TOKEN_BYTES;
      const raw = words[start] || "";
      candidate = raw.slice(0, maxBytes);
      words[start] = raw.slice(candidate.length);
      if (!words[start]) start += 1;
      chunks.push({ text: candidate, token_count: estimatedChunkTokens(candidate), part: chunks.length });
      continue;
    }
    chunks.push({ text: candidate, token_count: estimatedChunkTokens(candidate), part: chunks.length });
    if (end >= words.length) break;
    // Retain a bounded tail for semantic continuity.  The overlap is measured
    // conservatively in bytes, so the resulting chunk still stays under 384
    // estimated tokens after the tail is prepended.
    let overlap = "";
    for (let index = end - 1; index >= start; index -= 1) {
      const next = overlap ? `${words[index]} ${overlap}` : words[index];
      if (estimatedChunkTokens(next) > KNOWLEDGE_CHUNK_OVERLAP_TOKENS) break;
      overlap = next;
    }
    const overlapWords = overlap ? overlap.split(" ").length : 0;
    start = Math.max(start + 1, end - overlapWords);
  }
  return chunks;
}

function contentChunkId(text, sourceRef, part = 0) {
  return `kb_${canonicalKeyHash({ text, source_ref: sourceRef, part, policy: "bge384-overlap48-v1" }).slice(0, 48)}`;
}

function createKnowledgeProcedureStore({ fs = nodeFs, path = nodePath, crypto = nodeCrypto, baseDir, bundledDir = "", schemaRegistry = null, now = () => new Date(), signatureVerifier = null } = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Knowledge procedure store dependencies are required.");
  const schemas = schemaRegistry || getDefaultMemorySchemaRegistry();
  const root = path.resolve(String(baseDir));
  const releasesDir = path.join(root, "releases");
  // Bundled releases are immutable application assets.  They are read-only
  // inputs to the V3 KAG catalogue and are never copied over, replaced, or
  // written through the local-package installation path.  A separate
  // directory also lets packaged Electron builds resolve assets outside ASAR
  // while development keeps using the source-tree resource directory.
  const bundledRoot = bundledDir ? path.resolve(String(bundledDir)) : "";
  const previews = new Map();

  function releaseFile(releaseId) { return path.join(releasesDir, `${String(releaseId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`); }
  function bundledReleaseFile(releaseId) { return bundledRoot ? path.join(bundledRoot, `${String(releaseId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`) : ""; }
  function contentHash(packageValue) { const copy = clone(packageValue); delete copy.signature; delete copy.content_hash; return canonicalKeyHash(copy); }
  function verifySignature(value) {
    if (!value?.signature) return { ok: true, signed: false, verified: false };
    // The public package contract deliberately keeps the signature opaque;
    // trust policy belongs to the composition root.  Never treat mere
    // signature presence as trust (the previous implementation let any
    // non-empty string bypass the unsigned-package confirmation path).
    if (typeof signatureVerifier !== "function") return operationFailure("MEMORY_KNOWLEDGE_SIGNATURE_UNVERIFIED", "This knowledge package contains a signature but no configured verifier is available.");
    try {
      const result = signatureVerifier({ signature: String(value.signature), content_hash: contentHash(value), package: clone(value) });
      const verified = result === true || result?.ok === true || result?.verified === true;
      if (!verified) return operationFailure("MEMORY_KNOWLEDGE_SIGNATURE_INVALID", "The knowledge package signature could not be verified.");
      return { ok: true, signed: true, verified: true };
    } catch (error) {
      return operationFailure("MEMORY_KNOWLEDGE_SIGNATURE_INVALID", "The knowledge package signature could not be verified.", { reason: String(error?.code || error?.message || "verification failed").slice(0, 240) });
    }
  }
  function validatePackage(input) {
    const value = clone(input);
    if (!value || typeof value !== "object") return operationFailure("MEMORY_KNOWLEDGE_PACKAGE_INVALID", "A knowledge package must be an object.");
    try { assertNoSecretValues(value); } catch (error) {
      return operationFailure(error.code || "MEMORY_KNOWLEDGE_SECRET", "Knowledge packages cannot contain protected credential values.");
    }
    // Normalize content-derived identities before validation.  A package
    // author may omit procedure/chunk IDs, but the persisted release must
    // still satisfy the strict public schema and remain byte-stable across
    // preview, install, and reload.  Do not generate a source reference for
    // an entirely source-less package: knowledge without provenance is not a
    // valid Tier 3 release.
    value.version = String(value.version || "1").slice(0, 80);
    const sourceRefs = Array.isArray(value.source_refs) ? value.source_refs.filter(Boolean).map((entry) => String(entry).slice(0, 2_000)).slice(0, 500) : [];
    if (!sourceRefs.length) return operationFailure("MEMORY_KNOWLEDGE_SOURCE_REQUIRED", "A knowledge package must contain at least one source reference.");
    value.source_refs = sourceRefs;
    const suppliedReleaseId = value.release_id;
    const releaseSeed = suppliedReleaseId == null || suppliedReleaseId === ""
      ? canonicalKeyHash({ source_refs: sourceRefs, version: value.version, publisher: value.publisher || "" }).slice(0, 48)
      : suppliedReleaseId;
    value.release_id = String(releaseSeed);
    // The release ID is also the durable filename component.  Sanitizing it
    // only when constructing the path would let two distinct logical releases
    // alias the same file and would make package identity depend on filesystem
    // normalization.  Reject unsafe IDs at the contract boundary instead.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value.release_id) || value.release_id === "." || value.release_id === "..") {
      return operationFailure("MEMORY_KNOWLEDGE_RELEASE_ID_INVALID", "Knowledge release_id must be a safe non-empty filename component.");
    }
    value.package_id = String(value.package_id || `kb_${canonicalKeyHash({ release_id: value.release_id, version: value.version, source_refs: sourceRefs }).slice(0, 48)}`).slice(0, 240);
    const rawChunks = Array.isArray(value.chunks) ? value.chunks.map((chunk) => ({
      ...(chunk && typeof chunk === "object" ? chunk : {}),
      source_ref: String(chunk?.source_ref || sourceRefs[0]).slice(0, 2_000),
      text: normalizedChunkText(chunk?.text || ""),
    })).filter((chunk) => chunk.text) : [];
    value.procedures = Array.isArray(value.procedures) ? value.procedures.map((procedure) => ({ ...(procedure && typeof procedure === "object" ? procedure : {}) })) : [];
    // Ensure every procedure has a source chunk.  This is deliberately
    // deterministic and produces a small structured chunk rather than
    // silently accepting an untraceable procedure.
    for (const procedure of value.procedures) {
      const suppliedProcedureId = String(procedure.procedure_id || "").trim();
      if (suppliedProcedureId && !isMemoryId(suppliedProcedureId, "procedure")) {
        return operationFailure("MEMORY_KB_PROCEDURE_ID_INVALID", "A knowledge procedure ID must be a valid opaque procedure ID.", { procedureId: suppliedProcedureId.slice(0, 80) });
      }
      if (!suppliedProcedureId) procedure.procedure_id = `procedure_${canonicalKeyHash({ release_id: value.release_id, title: procedure.title || "", objective: procedure.objective || "", steps: procedure.steps || [] }).slice(0, 48)}`;
      const declaredRefs = Array.isArray(procedure.source_chunk_refs) ? procedure.source_chunk_refs.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
      if (declaredRefs.some((entry) => !isMemoryId(entry, "kb"))) {
        return operationFailure("MEMORY_KB_SOURCE_CHUNK_ID_INVALID", "Knowledge procedure source chunk references must be valid opaque Tier 3 chunk IDs.", { procedureId: procedure.procedure_id });
      }
      const refs = declaredRefs;
      if (!refs.length) {
        const text = normalizedChunkText([procedure.title, procedure.objective, ...(Array.isArray(procedure.steps) ? procedure.steps : [])].filter(Boolean).join("\n"));
        const chunkId = `kb_${canonicalKeyHash({ release_id: value.release_id, procedure_id: procedure.procedure_id, text, source_ref: sourceRefs[0] }).slice(0, 48)}`;
        if (!rawChunks.some((chunk) => chunk.chunk_id === chunkId)) rawChunks.push({ chunk_id: chunkId, text: text || String(procedure.title || procedure.procedure_id), source_ref: sourceRefs[0] });
        procedure.source_chunk_refs = [chunkId];
      } else procedure.source_chunk_refs = refs.slice(0, 200);
    }
    // Normalize declared chunks only after procedures have supplied any
    // generated source chunks.  A long declared chunk is split into bounded
    // pieces and every procedure reference is expanded to the resulting IDs.
    // Validate a supplied whole-chunk hash before splitting so an author cannot
    // accidentally install content different from the package manifest.
    const chunkIdsByOriginal = new Map();
    const normalizedChunks = [];
    const normalizedChunkById = new Map();
    for (const chunk of rawChunks) {
      const fullText = normalizedChunkText(chunk.text);
      const sourceRef = String(chunk.source_ref || sourceRefs[0]).slice(0, 2_000);
      const expectedWholeHash = canonicalKeyHash({ text: fullText, source_ref: sourceRef });
      if (chunk.content_hash && /^[a-f0-9]{64}$/i.test(String(chunk.content_hash)) && String(chunk.content_hash).toLowerCase() !== expectedWholeHash) {
        return operationFailure("MEMORY_KB_CHUNK_HASH_MISMATCH", "A knowledge source chunk hash does not match its content.", { chunkId: chunk.chunk_id });
      }
      const parts = splitKnowledgeText(fullText);
      const ids = [];
      for (const part of parts) {
        const id = contentChunkId(part.text, sourceRef, part.part);
        ids.push(id);
        if (!normalizedChunkById.has(id)) {
          const normalized = {
            chunk_id: id,
            text: part.text,
            source_ref: sourceRef,
            content_hash: canonicalKeyHash({ text: part.text, source_ref: sourceRef }),
            token_count: part.token_count,
          };
          normalizedChunkById.set(id, normalized);
          normalizedChunks.push(normalized);
        }
      }
      if (chunk.chunk_id) chunkIdsByOriginal.set(String(chunk.chunk_id), ids);
    }
    value.chunks = normalizedChunks;
    for (const procedure of value.procedures) {
      const refs = Array.isArray(procedure.source_chunk_refs) ? procedure.source_chunk_refs : [];
      procedure.source_chunk_refs = refs.flatMap((ref) => chunkIdsByOriginal.get(String(ref)) || []).filter(Boolean).slice(0, 200);
    }
    const chunkIds = new Set();
    for (const chunk of value.chunks) {
      if (chunkIds.has(chunk.chunk_id)) return operationFailure("MEMORY_KB_DUPLICATE_CHUNK", "A knowledge package contains duplicate source chunk IDs.", { chunkId: chunk.chunk_id });
      chunkIds.add(chunk.chunk_id);
    }
    const procedureIds = new Set();
    for (const procedure of value.procedures) {
      if (procedureIds.has(procedure.procedure_id)) return operationFailure("MEMORY_KB_DUPLICATE_PROCEDURE", "A knowledge package contains duplicate procedure IDs.", { procedureId: procedure.procedure_id });
      procedureIds.add(procedure.procedure_id);
      if (!Array.isArray(procedure.source_chunk_refs) || !procedure.source_chunk_refs.length || procedure.source_chunk_refs.some((ref) => !chunkIds.has(String(ref)))) {
        return operationFailure("MEMORY_KB_PROCEDURE_SOURCE_MISSING", "Every knowledge procedure must reference declared source chunks.", { procedureId: procedure.procedure_id });
      }
    }
    value.file_hashes = value.file_hashes && typeof value.file_hashes === "object" ? value.file_hashes : {};
    value.signature = value.signature || null;
    value.content_hash = value.content_hash || contentHash(value);
    const checked = schemas.validate("KnowledgeProcedurePackageV3", value);
    if (!checked.ok) return operationFailure(checked.error.code, checked.error.message, checked.error.details);
    if (value.content_hash !== contentHash(value)) return operationFailure("MEMORY_KB_HASH_MISMATCH", "Knowledge package content_hash does not match canonical content.", { releaseId: value.release_id });
    const signature = verifySignature(value);
    if (!signature.ok) return signature;
    return { ok: true, package: value };
  }
  function previewInstall(input) {
    const checked = validatePackage(input);
    if (!checked.ok) return checked;
    const value = checked.package;
    const createdAt = timestamp(now);
    const previewHash = canonicalKeyHash({ release_id: value.release_id, content_hash: value.content_hash, signature: value.signature || null, created_at: createdAt });
    const uuid = typeof crypto?.randomUUID === "function" ? () => crypto.randomUUID() : () => nodeCrypto.randomUUID();
    // validatePackage() has already verified a present signature.  Avoid
    // invoking a caller-supplied verifier a second time merely to build the
    // preview metadata (verifiers may be rate-limited or stateful).
    const preview = { schema_version: 3, preview_id: createOpaqueId("job", { uuid }), release_id: value.release_id, content_hash: value.content_hash, signed: Boolean(value.signature), preview_hash: previewHash, created_at: createdAt, expires_at: new Date(new Date(createdAt).getTime() + 10 * 60 * 1_000).toISOString() };
    previews.set(preview.preview_id, { ...preview, package: value });
    return { ok: true, preview: clone(preview), package: clone(value) };
  }
  function install(input, { previewId = "", confirmation = "" } = {}) {
    let value;
    let consumedPreviewId = "";
    if (previewId) {
      const preview = previews.get(String(previewId));
      if (!preview || new Date(preview.expires_at).getTime() <= new Date(timestamp(now)).getTime() || confirmation !== preview.preview_hash) return operationFailure("MEMORY_KNOWLEDGE_PREVIEW_STALE", "Knowledge package preview is missing, expired, or not confirmed.");
      value = clone(preview.package);
      // Do not consume the preview until the install has either committed or
      // been proven to be an idempotent duplicate.  A transient filesystem,
      // validation, or immutable-release failure must leave the reviewed
      // package retryable until the preview TTL expires; otherwise an operator
      // would have to repeat the whole preview flow after a recoverable error.
      consumedPreviewId = String(previewId);
    } else {
      const checked = validatePackage(input);
      if (!checked.ok) return checked;
      value = checked.package;
      // Signed packages were already verified by validatePackage().  An
      // unverified signature can never reach this branch; unsigned packages
      // still require explicit content-hash confirmation.
      if (!value.signature && confirmation !== value.content_hash) return operationFailure("MEMORY_KNOWLEDGE_CONFIRMATION_REQUIRED", "Unsigned knowledge packages require explicit confirmation using the content hash.");
    }
    const file = releaseFile(value.release_id);
    let existing;
    try {
      ensureDirectory(fs, path, releasesDir);
      existing = readJsonWithBackup({ fs }, file);
    } catch (error) {
      // Package installation is an operator-controlled write boundary.  A
      // locked directory, ACL failure, or other filesystem error must remain
      // retryable and must not consume the reviewed preview capability.
      return operationFailure(error.code || "MEMORY_KNOWLEDGE_WRITE_FAILED", `The knowledge release could not be inspected for installation: ${error.message}.`, { path: file }, true);
    }
    if (existing.exists) {
      if (!existing.ok) return operationFailure("MEMORY_KNOWLEDGE_PACKAGE_CORRUPT", "The existing knowledge release is corrupt.", { path: file }, true);
      const prior = validatePackage(existing.value);
      if (!prior.ok || prior.package.content_hash !== value.content_hash) return operationFailure("MEMORY_KNOWLEDGE_RELEASE_IMMUTABLE", "An installed knowledge release cannot be replaced with different content.", { releaseId: value.release_id });
      if (consumedPreviewId) previews.delete(consumedPreviewId);
      return { ok: true, changed: false, duplicate: true, releaseId: value.release_id, contentHash: value.content_hash, path: file };
    }
    try { atomicWriteJson({ fs, path, crypto }, file, value, { backup: false, validate: (raw) => { const checked = validatePackage(JSON.parse(raw)); if (!checked.ok) throw Object.assign(new Error(checked.error), { code: checked.code }); } }); } catch (error) { return operationFailure(error.code || "MEMORY_KNOWLEDGE_WRITE_FAILED", error.message, { path: file }, true); }
    if (consumedPreviewId) previews.delete(consumedPreviewId);
    return { ok: true, changed: true, duplicate: false, releaseId: value.release_id, contentHash: value.content_hash, path: file, package: clone(value) };
  }
  function loadReleaseFile(file, releaseId, { bundled = false } = {}) {
    if (!file) return operationFailure("MEMORY_KNOWLEDGE_NOT_FOUND", "Knowledge release was not found.", { releaseId });
    const loaded = readJsonWithBackup({ fs }, file);
    if (!loaded.ok) return operationFailure("MEMORY_KNOWLEDGE_PACKAGE_CORRUPT", loaded.error?.message || "Knowledge package is corrupt.", { releaseId, path: file }, true);
    if (!loaded.exists) return operationFailure("MEMORY_KNOWLEDGE_NOT_FOUND", "Knowledge release was not found.", { releaseId });
    const checked = validatePackage(loaded.value);
    if (!checked.ok) return checked;
    return { ok: true, package: checked.package, recovered: Boolean(loaded.recovered), warning: loaded.warning || "", bundled };
  }
  function get(releaseId) {
    // Release IDs are publisher-defined labels (for example `wstg-2025.1`),
    // unlike the opaque package/procedure/chunk IDs.  Keep the path bounded
    // and reject traversal, but do not incorrectly require a `kb_` prefix.
    const id = String(releaseId == null ? "" : releaseId).trim();
    if (!id || id.length > 240 || id === "." || id === ".." || /[\\/\u0000]/.test(id)) return operationFailure("MEMORY_KNOWLEDGE_ID_INVALID", "A bounded knowledge release ID is required.", { releaseId: id.slice(0, 240) });
    const bundledFile = bundledReleaseFile(id);
    const userFile = releaseFile(id);
    let bundledExists = false;
    let userExists = false;
    try {
      bundledExists = Boolean(bundledFile && fs.existsSync(bundledFile));
      userExists = Boolean(fs.existsSync(userFile));
    } catch (error) {
      return operationFailure(error.code || "MEMORY_KNOWLEDGE_READ_FAILED", `The knowledge release could not be inspected: ${error.message}.`, { releaseId: id }, true);
    }
    if (bundledExists) {
      const bundled = loadReleaseFile(bundledFile, id, { bundled: true });
      if (!bundled.ok) return bundled;
      // A local package may use the same publisher release ID only when it is
      // byte-equivalent to the shipped release.  Never let a local file shadow
      // an application asset with different methodology or proof rules.
      if (userExists) {
        const local = loadReleaseFile(userFile, id);
        if (!local.ok) return local;
        if (local.package.content_hash !== bundled.package.content_hash) return operationFailure("MEMORY_KNOWLEDGE_RELEASE_COLLISION", "A local knowledge release conflicts with an immutable bundled release.", { releaseId: id });
      }
      return bundled;
    }
    return loadReleaseFile(userFile, id);
  }
  function procedure(releaseId, procedureId) {
    const loaded = get(releaseId);
    if (!loaded.ok) return loaded;
    const found = loaded.package.procedures.find((entry) => entry.procedure_id === String(procedureId || ""));
    return found ? { ok: true, procedure: clone(found), release_id: loaded.package.release_id, content_hash: loaded.package.content_hash } : operationFailure("MEMORY_KB_PROCEDURE_NOT_FOUND", "The knowledge procedure was not found.", { releaseId, procedureId });
  }
  function list() {
    let files = [];
    let bundledFiles = [];
    try {
      files = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir).filter((name) => name.endsWith(".json")).sort() : [];
      bundledFiles = bundledRoot && fs.existsSync(bundledRoot) ? fs.readdirSync(bundledRoot).filter((name) => name.endsWith(".json")).sort() : [];
    } catch (error) { return operationFailure("MEMORY_KNOWLEDGE_LIST_FAILED", error.message, { path: releasesDir }, true); }
    const releaseIds = new Set([...files, ...bundledFiles].map((file) => file.slice(0, -5)));
    const releases = [];
    for (const releaseId of [...releaseIds].sort()) {
      const loaded = get(releaseId);
      if (!loaded.ok) return loaded;
      releases.push({ release_id: loaded.package.release_id, package_id: loaded.package.package_id, version: loaded.package.version, content_hash: loaded.package.content_hash, signed: Boolean(loaded.package.signature), bundled: Boolean(loaded.bundled), procedure_count: loaded.package.procedures.length });
    }
    return { ok: true, releases };
  }
  return Object.freeze({ root, releasesDir, bundledRoot, releaseFile, bundledReleaseFile, contentHash, verifySignature, validatePackage, previewInstall, install, get, procedure, list });
}

module.exports = Object.freeze({ createKnowledgeProcedureStore });
