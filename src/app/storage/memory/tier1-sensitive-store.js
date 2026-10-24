"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretKeys, atomicWriteText, clone, hashText, operationFailure, timestamp } = require("./memory-storage-utils.js");
const { validateRunControl } = require("../../../agent/runtime/session-input.js");
const { atomicWriteEncrypted } = require("./atomic-write-async.js");

/*
 * Exact Tier 1 data is intentionally kept out of readable workspace memory.
 * safeStorage is the only durable backend.  When it is unavailable this store
 * becomes explicitly ephemeral; it never creates a plaintext fallback file.
 */
function createTier1SensitiveStore({ fs = nodeFs, path = nodePath, crypto = nodeCrypto, baseDir, protector = null, schemaRegistry = null, now = () => new Date() } = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new TypeError("Tier 1 sensitive store dependencies are required.");
  const root = path.resolve(String(baseDir));
  const schemas = schemaRegistry || getDefaultMemorySchemaRegistry();
  const ephemeral = new Map();
  // Last durable transcript per file, reused while the file's identity, size and mtime
  // are unchanged. Chat history writes on every event; re-reading, decrypting
  // and validating the whole session each time grew with chat length.
  const transcripts = new Map();
  const pendingWrites = new Map();
  function fileStamp(file) {
    try { const stat = fs.statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}`; } catch { return ""; }
  }

  function available() {
    try {
      return Boolean(protector?.available?.() && typeof protector.encrypt === "function" && typeof protector.decrypt === "function");
    } catch {
      // A platform keyring can throw while it is locked or unavailable.  That
      // is the same supported degraded mode as an explicit false result; it
      // must not escape as an unhandled exception from status/read paths.
      return false;
    }
  }
  function projectDir(projectId) { return path.join(root, "projects", assertMemoryId(projectId, "proj")); }
  function sessionDir(projectId, sessionId) { return path.join(projectDir(projectId), "sessions", assertMemoryId(sessionId, "session")); }
  function transcriptFile(projectId, sessionId) { return path.join(sessionDir(projectId, sessionId), "transcript.enc.json"); }
  function checkpointFile(projectId, sessionId, which = "current") { return path.join(sessionDir(projectId, sessionId), which === "previous" ? "checkpoint-previous.enc.json" : "checkpoint-current.enc.json"); }
  function checkpointTransitionFile(projectId, sessionId, checkpointId) {
    const id = assertMemoryId(checkpointId, "checkpoint");
    return path.join(sessionDir(projectId, sessionId), `checkpoint-transition-${id}.enc.json`);
  }
  function cleanupCheckpointTransitions(projectId, sessionId, keepCheckpointIds = []) {
    const directory = sessionDir(projectId, sessionId);
    const keep = new Set(Array.isArray(keepCheckpointIds) ? keepCheckpointIds : [keepCheckpointIds].filter(Boolean));
    let entries;
    try { entries = fs.readdirSync(directory); } catch { return; }
    for (const entry of entries) {
      const name = String(entry?.name || entry);
      const prefix = "checkpoint-transition-";
      const suffix = ".enc.json";
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      const id = name.slice(prefix.length, -suffix.length);
      if (!id || keep.has(id)) continue;
      const file = path.join(directory, name);
      try { fs.rmSync(file, { force: true }); } catch { /* stale transition cleanup is best effort */ }
      ephemeral.delete(key(file));
    }
  }
  function activeFile(projectId, sessionId) { return path.join(sessionDir(projectId, sessionId), "active.enc.json"); }
  function referenceFile(projectId, snapshotId) {
    if (!/^[a-f0-9]{64}$/.test(String(snapshotId))) throw new TypeError("Invalid chat snapshot identity.");
    return path.join(projectDir(projectId), "chat-references", `${snapshotId}.enc.json`);
  }
  function key(file) { return path.resolve(file); }

  function encryptEnvelope(value) {
    if (!available()) return operationFailure("MEMORY_SECURE_STORAGE_UNAVAILABLE", "Electron secure storage is unavailable; exact Tier 1 state is ephemeral.", {}, false);
    try {
      const plaintext = JSON.stringify(value);
      const encrypted = protector.encrypt(plaintext);
      const payload = Buffer.isBuffer(encrypted) ? encrypted.toString("base64") : String(encrypted);
      return { ok: true, envelope: { schema_version: 3, encrypted: true, algorithm: "electron.safeStorage", created_at: timestamp(now), sha256: hashText(crypto, plaintext), payload } };
    } catch (error) {
      return operationFailure("MEMORY_SENSITIVE_ENCRYPT_FAILED", `The exact Tier 1 state could not be encrypted: ${error.message}.`, {}, true);
    }
  }
  function decryptEnvelope(envelope) {
    if (!envelope || envelope.schema_version !== 3 || envelope.encrypted !== true || typeof envelope.payload !== "string") return operationFailure("MEMORY_SENSITIVE_ENVELOPE_INVALID", "The encrypted Tier 1 envelope is invalid.");
    if (!available()) return operationFailure("MEMORY_SECURE_STORAGE_UNAVAILABLE", "Electron secure storage is unavailable; exact Tier 1 state is ephemeral.");
    try {
      // Exact transcripts/checkpoints are allowed to contain sensitive values
      // precisely because the entire payload is encrypted.  Secret-key
      // rejection applies to readable semantic state, not this protected
      // backend.
      const plaintext = protector.decrypt(envelope.payload);
      if (envelope.sha256 && envelope.sha256 !== hashText(crypto, plaintext)) return operationFailure("MEMORY_SENSITIVE_HASH_MISMATCH", "The encrypted Tier 1 state hash does not match.", {}, true);
      const value = JSON.parse(plaintext);
      return { ok: true, value };
    } catch (error) { return operationFailure("MEMORY_SENSITIVE_DECRYPT_FAILED", `The encrypted Tier 1 state could not be decrypted: ${error.message}.`, {}, true); }
  }
  function writeEphemeral(file, value, failure, { requireDurable = false } = {}) {
    if (requireDurable) return failure;
    // Never shadow an existing durable encrypted value with a process-only
    // replacement. When safeStorage is unavailable, preserve the last
    // durable state until it can be read and updated safely.
    let durableExists = false;
    try { durableExists = fs.existsSync(file); } catch { durableExists = false; }
    if (durableExists && !ephemeral.has(key(file))) {
      return operationFailure("MEMORY_SECURE_STORAGE_UNAVAILABLE", "Electron secure storage is unavailable; the existing encrypted Tier 1 state was preserved.", { path: file }, false);
    }
    ephemeral.set(key(file), clone(value));
    return { ok: true, changed: true, encrypted: false, durable: false, ephemeral: true, warning: failure.error, path: file };
  }
  function writeFile(file, value, options = {}) {
    const encrypted = encryptEnvelope(value);
    if (!encrypted.ok) return writeEphemeral(file, value, encrypted, options);
    try {
      const raw = JSON.stringify(encrypted.envelope, null, 2) + "\n";
      atomicWriteText({ fs, path, crypto }, file, raw, { mode: 0o600, backup: false, strictAtomic: true });
      // A process may begin in the supported ephemeral mode and later regain
      // access to Electron safeStorage (for example after the app keyring is
      // unlocked).  Remove the stale in-memory shadow once a durable write
      // succeeds; otherwise readFile() would keep returning the old
      // plaintext-in-memory value ahead of the newly committed envelope.
      ephemeral.delete(key(file));
      return { ok: true, changed: true, encrypted: true, durable: true, ephemeral: false, path: file, sha256: encrypted.envelope.sha256 };
    } catch (error) { return operationFailure("MEMORY_SENSITIVE_WRITE_FAILED", `The encrypted Tier 1 state could not be written: ${error.message}.`, { path: file }, true); }
  }
  function readFile(file) {
    if (ephemeral.has(key(file))) return { ok: true, exists: true, encrypted: false, durable: false, ephemeral: true, value: clone(ephemeral.get(key(file))), path: file };
    try {
      // Keep the existence probe inside the guarded read path.  A locked
      // profile, ACL failure, or test double can throw from existsSync itself;
      // that must become the stable sensitive-read error rather than escaping
      // into checkpoint/retry orchestration.
      if (!fs.existsSync(file)) return { ok: true, exists: false, encrypted: false, durable: false, ephemeral: false, value: null, path: file };
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      const decoded = decryptEnvelope(envelope);
      if (!decoded.ok) return { ...decoded, details: { ...decoded.details, path: file } };
      return { ok: true, exists: true, encrypted: true, durable: true, ephemeral: false, value: decoded.value, path: file };
    } catch (error) { return operationFailure("MEMORY_SENSITIVE_READ_FAILED", `The encrypted Tier 1 state could not be read: ${error.message}.`, { path: file }, true); }
  }

  function validateTranscriptValue(value, projectId, sessionId) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema_version !== 3
      || value.project_id !== projectId
      || value.session_id !== sessionId
      || !Array.isArray(value.blocks)) {
      return operationFailure("MEMORY_TRANSCRIPT_INVALID", "The encrypted Tier 1 transcript is invalid or belongs to another project/session.", { project_id: projectId, session_id: sessionId }, true);
    }
    if (value.run_control !== undefined) {
      try { validateRunControl(value.run_control); }
      catch (error) { return operationFailure(error.code || "SESSION_CONTROL_INVALID", "The encrypted session control state is invalid.", {}, true); }
    }
    // The transcript is an approved encrypted/raw store.  Unlike readable
    // semantic state, it may contain the exact user/tool exchange, including
    // sensitive values.  Project/session binding above is the protection at
    // this boundary; never copy these values into diagnostics or model input.
    return { ok: true, value };
  }

  function validateCheckpointValue(value, projectId, sessionId) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.project_id !== projectId
      || value.session_id !== sessionId) {
      return operationFailure("MEMORY_PROJECT_MISMATCH", "The encrypted Tier 1 checkpoint belongs to another project/session.", { project_id: projectId, session_id: sessionId }, true);
    }
    const validation = schemas.validate("ConversationCheckpointV3", value);
    if (!validation.ok) return operationFailure("MEMORY_CHECKPOINT_INVALID", "The encrypted Tier 1 checkpoint is invalid.", { details: validation.error.details }, true);
    try { assertNoSecretKeys(value); } catch (error) {
      return operationFailure(error.code || "MEMORY_CHECKPOINT_SECRET", "The encrypted Tier 1 checkpoint contains an invalid protected field.", {}, true);
    }
    return { ok: true, value };
  }

  function readTranscript(projectId, sessionId, { cache = true } = {}) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const file = transcriptFile(project, session);
    const cached = cache && transcripts.get(key(file));
    const stamp = cached && !ephemeral.has(key(file)) ? fileStamp(file) : "";
    if (stamp && cached.stamp === stamp) return { ok: true, exists: true, encrypted: true, durable: true, ephemeral: false, value: clone(cached.value), path: file };
    if (cache) transcripts.delete(key(file));
    const loaded = readFile(file);
    if (!loaded.ok || !loaded.exists) return loaded;
    const checked = validateTranscriptValue(loaded.value, project, session);
    if (!checked.ok) return checked;
    if (loaded.durable && cache) transcripts.set(key(file), { stamp: fileStamp(file), value: clone(checked.value) });
    return { ...loaded, value: checked.value };
  }
  function prepareTranscript(projectId, sessionId, transcript) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const copy = clone(transcript || {});
    const candidate = {
      ...copy,
      schema_version: 3,
      project_id: project,
      session_id: session,
      blocks: Array.isArray(copy.blocks) ? copy.blocks : [],
    };
    const checked = validateTranscriptValue(candidate, project, session);
    if (!checked.ok) return checked;
    for (const block of candidate.blocks) {
      try { assertMemoryId(block?.block_id, "block"); } catch {
        return operationFailure("MEMORY_TRANSCRIPT_BLOCK_INVALID", "The encrypted Tier 1 transcript contains an invalid block ID.", { project_id: project, session_id: session }, false);
      }
    }
    const file = transcriptFile(project, session);
    return { ok: true, file, candidate };
  }
  function writeTranscript(projectId, sessionId, transcript, options = {}) {
    const prepared = prepareTranscript(projectId, sessionId, transcript);
    if (!prepared.ok) return prepared;
    const { file, candidate } = prepared;
    if (pendingWrites.has(key(file))) return operationFailure("MEMORY_WRITE_PENDING", "The encrypted session has a pending commit.", {}, true);
    transcripts.delete(key(file));
    const written = writeFile(file, candidate, options);
    if (written.ok && written.durable) transcripts.set(key(file), { stamp: fileStamp(file), value: candidate });
    return written;
  }
  function writeTranscriptAsync(projectId, sessionId, transcript, options = {}) {
    if (typeof protector?.encryptAsync !== "function" || !fs.promises) return Promise.resolve(writeTranscript(projectId, sessionId, transcript, options));
    const prepared = prepareTranscript(projectId, sessionId, transcript);
    if (!prepared.ok) return Promise.resolve(prepared);
    const { file, candidate } = prepared;
    if (pendingWrites.has(key(file))) return Promise.resolve(operationFailure("MEMORY_WRITE_PENDING", "The encrypted session has a pending commit.", {}, true));
    if (!available()) return Promise.resolve(writeTranscript(projectId, sessionId, transcript, options));
    const pending = (async () => {
      let envelope;
      try {
        const plaintext = JSON.stringify(candidate);
        const encrypted = await protector.encryptAsync(plaintext);
        envelope = { schema_version: 3, encrypted: true, algorithm: "electron.safeStorage", created_at: timestamp(now), sha256: hashText(crypto, plaintext), payload: Buffer.isBuffer(encrypted) ? encrypted.toString("base64") : String(encrypted) };
      } catch (error) { return writeEphemeral(file, candidate, operationFailure("MEMORY_SENSITIVE_ENCRYPT_FAILED", `The exact Tier 1 state could not be encrypted: ${error.message}.`, { path: file }, true), options); }
      try {
        await atomicWriteEncrypted(fs.promises, file, JSON.stringify(envelope) + "\n");
        ephemeral.delete(key(file));
        transcripts.set(key(file), { stamp: fileStamp(file), value: candidate });
        return { ok: true, changed: true, encrypted: true, durable: true, ephemeral: false, path: file, sha256: envelope.sha256 };
      } catch (error) { return operationFailure("MEMORY_SENSITIVE_WRITE_FAILED", `The encrypted Tier 1 state could not be written: ${error.message}.`, { path: file }, true); }
    })();
    pendingWrites.set(key(file), pending);
    return pending.finally(() => { pendingWrites.delete(key(file)); });
  }
  function listSessionIds(projectId) {
    let directory;
    try { directory = path.join(projectDir(projectId), "sessions"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    const ids = new Set();
    try {
      if (fs.existsSync(directory)) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory() && isMemoryId(entry.name, "session")) ids.add(entry.name);
        }
      }
      const prefix = `${path.resolve(directory)}${path.sep}`;
      for (const file of ephemeral.keys()) {
        if (!file.startsWith(prefix)) continue;
        const relative = path.relative(directory, file).split(path.sep);
        if (relative.length > 0 && isMemoryId(relative[0], "session")) ids.add(relative[0]);
      }
      return { ok: true, session_ids: [...ids].sort() };
    } catch (error) {
      return operationFailure("MEMORY_SENSITIVE_SESSION_LIST_FAILED", `The encrypted Tier 1 sessions could not be listed: ${error.message}.`, { project_id: projectId }, true);
    }
  }
  function writeCheckpoint(projectId, sessionId, checkpoint) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const candidate = { ...clone(checkpoint || {}), schema_version: 3, project_id: project, session_id: session };
    const validation = schemas.validate("ConversationCheckpointV3", candidate);
    if (!validation.ok) return operationFailure("MEMORY_CHECKPOINT_INVALID", "The encrypted Tier 1 checkpoint is invalid.", { details: validation.error.details });
    const currentFile = checkpointFile(projectId, sessionId, "current");
    const previousFile = checkpointFile(projectId, sessionId, "previous");
    const prior = readFile(currentFile);
    if (prior.ok && prior.exists) {
      const checkedPrior = validateCheckpointValue(prior.value, project, session);
      if (!checkedPrior.ok) return { ...checkedPrior, checkpointed: false, activePreserved: true };
      // Rotate through the same encrypted, fsync'd writer used for the
      // current checkpoint.  Copying the old envelope directly leaves a
      // window where a partially written previous file can become the only
      // usable rollback point (and is not portable across Windows rename
      // semantics).  If this rotation fails, keep the current checkpoint and
      // report the failure rather than clearing the source buffers.
      const rotated = writeFile(previousFile, prior.value);
      if (!rotated.ok) return { ...rotated, checkpointed: false, activePreserved: true };
    }
    return writeFile(currentFile, candidate);
  }
  function readCheckpoint(projectId, sessionId, which = "current") {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const requested = which === "previous" ? "previous" : "current";
    const currentPath = checkpointFile(project, session, requested);
    const loaded = readFile(currentPath);
    const checkedLoaded = loaded.ok && loaded.exists
      ? { ...loaded, ...validateCheckpointValue(loaded.value, project, session) }
      : loaded;
    // A checkpoint rotation is deliberately two-phase: the previous file is
    // the rollback point if the process died while replacing the current
    // file, or if a disk/provider fault later corrupts the current envelope.
    // Do not mask secure-storage unavailability (there is no durable value to
    // recover in that mode), but do recover a valid previous checkpoint when
    // the current file is missing, malformed, or hash/decryption-invalid.
    if (requested !== "current" || (checkedLoaded.ok && checkedLoaded.exists) || checkedLoaded.code === "MEMORY_SECURE_STORAGE_UNAVAILABLE") return checkedLoaded;
    const previousPath = checkpointFile(project, session, "previous");
    const previous = readFile(previousPath);
    const checkedPrevious = previous.ok && previous.exists
      ? { ...previous, ...validateCheckpointValue(previous.value, project, session) }
      : previous;
    if (checkedPrevious.ok && checkedPrevious.exists) {
      return {
        ...checkedPrevious,
        path: currentPath,
        requested_path: currentPath,
        recovered: true,
        recovered_from: previousPath,
        warning: `The current Tier 1 checkpoint was unavailable and was recovered from its previous checkpoint${checkedLoaded.error ? `: ${checkedLoaded.error}` : "."}`,
      };
    }
    return checkedLoaded;
  }
  function validateActiveValue(value, projectId, sessionId) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema_version !== 3
      || value.project_id !== projectId
      || value.session_id !== sessionId
      || !Array.isArray(value.active)) {
      return operationFailure("MEMORY_ACTIVE_INVALID", "The encrypted Tier 1 active conversation is invalid or belongs to another project/session.", { project_id: projectId, session_id: sessionId }, true);
    }
    return { ok: true, value };
  }
  function readActive(projectId, sessionId) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const loaded = readFile(activeFile(project, session));
    const checked = loaded.ok && loaded.exists ? validateActiveValue(loaded.value, project, session) : null;

    // A checkpoint and its replacement active ledger live in separate files.
    // The transition record bridges the crash window between them: if the new
    // checkpoint (or its rollback checkpoint) is current, expose the ledger
    // prepared for that checkpoint even when active.enc.json is unreadable.
    const checkpoint = readCheckpoint(project, session, "current");
    const currentId = checkpoint?.ok && checkpoint.exists ? String(checkpoint.value?.checkpoint_id || "") : "";
    if (currentId) {
      const pending = readFile(checkpointTransitionFile(project, session, currentId));
      if (!pending.ok) return pending;
      if (pending.exists) {
        const transition = pending.value;
        const active = validateActiveValue(transition?.active_after, project, session);
        if (transition?.schema_version !== 1 || transition.project_id !== project || transition.session_id !== session
          || transition.checkpoint_id !== currentId || !active.ok) {
          return operationFailure("MEMORY_CHECKPOINT_TRANSITION_INVALID", "The encrypted Tier 1 checkpoint transition is invalid.", { project_id: project, session_id: session }, true);
        }
        if (checked?.ok && String(checked.value.checkpoint_id || "") === currentId) return { ...loaded, value: checked.value };
        return { ...pending, exists: true, recovered: true, value: active.value };
      }
      if (checked?.ok && String(checked.value.checkpoint_id || "") === currentId) return { ...loaded, value: checked.value };
      if (checked?.ok && !checked.value.checkpoint_id) return loaded;
      if (checked?.ok && checked.value.checkpoint_id) return operationFailure("MEMORY_ACTIVE_CHECKPOINT_MISMATCH", "The encrypted Tier 1 active ledger belongs to a different checkpoint.", { project_id: project, session_id: session }, true);
    }
    if (checked && !checked.ok) return checked;
    if (!loaded.ok) return loaded;
    if (!checkpoint?.ok && checked?.ok && checked.value.checkpoint_id) return checkpoint;
    if (!currentId && checked?.ok && checked.value.checkpoint_id) return operationFailure("MEMORY_ACTIVE_CHECKPOINT_MISMATCH", "The encrypted Tier 1 active ledger has no matching checkpoint.", { project_id: project, session_id: session }, true);
    return loaded.exists ? { ...loaded, value: checked.value } : loaded;
  }
  function writeActive(projectId, sessionId, messages, { nextBlockIndex = null, pinnedBlocks = null, operatorDirectives = null, checkpointId = "" } = {}) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const candidate = {
      schema_version: 3,
      project_id: project,
      session_id: session,
      active: (Array.isArray(messages) ? messages : []).slice(0, 2_000).map(clone),
      ...(Number.isSafeInteger(nextBlockIndex) && nextBlockIndex >= 0 ? { next_block_index: nextBlockIndex } : {}),
      ...(Array.isArray(pinnedBlocks) ? { pinned_blocks: pinnedBlocks.filter((index) => Number.isSafeInteger(index) && index >= 0) } : {}),
      ...(Array.isArray(operatorDirectives) ? { operator_directives: operatorDirectives.slice(-50).map((entry) => ({ text: String(entry?.text || "").slice(0, 600), source_message_id: String(entry?.source_message_id || "").slice(0, 240), revision: Number(entry?.revision) || 0 })) } : {}),
      ...(typeof checkpointId === "string" && checkpointId ? { checkpoint_id: checkpointId } : {}),
    };
    const checked = validateActiveValue(candidate, project, session);
    if (!checked.ok) return checked;
    const written = writeFile(activeFile(project, session), candidate);
    return written;
  }

  function writeCheckpointTransition(projectId, sessionId, checkpoint, activeAfter = {}) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const candidate = { ...clone(checkpoint || {}), schema_version: 3, project_id: project, session_id: session };
    const validation = schemas.validate("ConversationCheckpointV3", candidate);
    if (!validation.ok) return operationFailure("MEMORY_CHECKPOINT_INVALID", "The encrypted Tier 1 checkpoint is invalid.", { details: validation.error.details });
    const checkpointId = String(candidate.checkpoint_id || "");
    if (!checkpointId) return operationFailure("MEMORY_CHECKPOINT_INVALID", "The checkpoint transition needs a checkpoint identity.");
    const after = {
      schema_version: 3,
      project_id: project,
      session_id: session,
      active: (Array.isArray(activeAfter.active) ? activeAfter.active : []).slice(0, 2_000).map(clone),
      ...(Number.isSafeInteger(activeAfter.nextBlockIndex) && activeAfter.nextBlockIndex >= 0 ? { next_block_index: activeAfter.nextBlockIndex } : {}),
      ...(Array.isArray(activeAfter.pinnedBlocks) ? { pinned_blocks: activeAfter.pinnedBlocks.filter((index) => Number.isSafeInteger(index) && index >= 0) } : {}),
      ...(Array.isArray(activeAfter.operatorDirectives) ? { operator_directives: activeAfter.operatorDirectives.slice(-50).map((entry) => ({ text: String(entry?.text || "").slice(0, 600), source_message_id: String(entry?.source_message_id || "").slice(0, 240), revision: Number(entry?.revision) || 0 })) } : {}),
      checkpoint_id: checkpointId,
    };
    const checkedActive = validateActiveValue(after, project, session);
    if (!checkedActive.ok) return checkedActive;
    const transitionPath = checkpointTransitionFile(project, session, checkpointId);
    const staged = writeFile(transitionPath, { schema_version: 1, project_id: project, session_id: session, checkpoint_id: checkpointId, active_after: after });
    if (!staged.ok) return staged;
    // Once this checkpoint is visible, readActive can recover the corresponding
    // replacement ledger from the staged record until writeActive completes.
    const saved = writeCheckpoint(project, session, candidate);
    if (!saved.ok) {
      // Keep a transition that may already have become current despite a
      // late durability error. Otherwise discard only this uncommitted record;
      // a prior committed checkpoint may still need its own recovery ledger.
      const current = readCheckpoint(project, session, "current");
      const currentId = current?.ok && current.exists ? String(current.value?.checkpoint_id || "") : "";
      if (current?.ok && currentId !== checkpointId) {
        try { fs.rmSync(transitionPath, { force: true }); } catch { /* failed checkpoint record is best-effort cleanup */ }
        ephemeral.delete(key(transitionPath));
      }
      return saved;
    }
    const previous = readCheckpoint(project, session, "previous");
    const previousId = previous?.ok && previous.exists ? String(previous.value?.checkpoint_id || "") : "";
    cleanupCheckpointTransitions(project, session, [checkpointId, previousId]);
    return saved;
  }
  // Released Active Conversation blocks keep their full messages here, encrypted
  // like the active ledger and inside the session directory, so deleting the
  // session deletes them. The prompt only carries a tombstone for each one.
  function releasedBlockFile(projectId, sessionId, index) {
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("Invalid released block index.");
    return path.join(sessionDir(projectId, sessionId), "released", `block-${index}.enc.json`);
  }
  function writeReleasedBlock(projectId, sessionId, index, block = {}) {
    let file;
    try { file = releasedBlockFile(projectId, sessionId, index); } catch (error) { return operationFailure(error.code || "MEMORY_RELEASED_BLOCK_INVALID", error.message, {}, false); }
    if (!Array.isArray(block.messages) || !block.messages.length) return operationFailure("MEMORY_RELEASED_BLOCK_INVALID", "A released block needs at least one message.", {}, false);
    return writeFile(file, { schema_version: 1, index, block_id: String(block.block_id || ""), messages: block.messages.map(clone) });
  }
  function readReleasedBlock(projectId, sessionId, index) {
    let file;
    try { file = releasedBlockFile(projectId, sessionId, index); } catch (error) { return operationFailure(error.code || "MEMORY_RELEASED_BLOCK_INVALID", error.message, {}, false); }
    const read = readFile(file);
    if (!read.ok || !read.exists) return read;
    const value = read.value || {};
    if (value.index !== index || !Array.isArray(value.messages) || !value.messages.length) {
      return operationFailure("MEMORY_RELEASED_BLOCK_INVALID", "The stored released block is invalid.", { path: file }, false);
    }
    return { ok: true, exists: true, durable: read.durable, index, blockId: String(value.block_id || ""), messages: value.messages };
  }
  // Images attached to chat messages are kept at full sent quality, encrypted
  // like the transcript and inside its session directory, so deleting the
  // session deletes them. The id is the SHA-256 of the base64 image data.
  const CHAT_IMAGE_ID = /^[a-f0-9]{64}$/;
  const CHAT_IMAGE_TYPE = /^image\/(?:png|jpeg|webp)$/;
  function chatImageFile(projectId, sessionId, imageId) {
    if (!CHAT_IMAGE_ID.test(String(imageId))) throw new TypeError("Invalid chat image identity.");
    return path.join(sessionDir(projectId, sessionId), "images", `${imageId}.enc.json`);
  }
  function chatImageId(data) { return crypto.createHash("sha256").update(String(data)).digest("hex"); }
  function writeChatImage(projectId, sessionId, { mediaType, data } = {}) {
    if (!CHAT_IMAGE_TYPE.test(String(mediaType)) || typeof data !== "string" || !data) {
      return operationFailure("MEMORY_CHAT_IMAGE_INVALID", "The chat image must be PNG, JPEG or WebP data.", {}, false);
    }
    const imageId = chatImageId(data);
    let file;
    try { file = chatImageFile(projectId, sessionId, imageId); } catch (error) { return operationFailure(error.code || "MEMORY_SESSION_ID_INVALID", error.message, {}, false); }
    try { if (fs.existsSync(file)) return { ok: true, changed: false, imageId, path: file }; } catch { /* write below */ }
    return { ...writeFile(file, { schema_version: 1, media_type: mediaType, data }), imageId };
  }
  function readChatImage(projectId, sessionId, imageId) {
    let file;
    try { file = chatImageFile(projectId, sessionId, imageId); } catch (error) { return operationFailure(error.code || "MEMORY_CHAT_IMAGE_ID_INVALID", error.message, {}, false); }
    const read = readFile(file);
    if (!read.ok || !read.exists) return { ...read, imageId };
    const value = read.value || {};
    if (!CHAT_IMAGE_TYPE.test(String(value.media_type)) || typeof value.data !== "string" || chatImageId(value.data) !== imageId) {
      return operationFailure("MEMORY_CHAT_IMAGE_INVALID", "The stored chat image is invalid.", { path: file }, false);
    }
    return { ok: true, exists: true, durable: read.durable, imageId, mediaType: value.media_type, data: value.data };
  }

  function deleteSession(projectId, sessionId) {
    let directory;
    try { directory = sessionDir(projectId, sessionId); } catch (error) { return operationFailure(error.code || "MEMORY_SESSION_ID_INVALID", error.message, {}, false); }
    const prefix = `${path.resolve(directory)}${path.sep}`;
    const priorEphemeral = new Map([...ephemeral.entries()].filter(([file]) => file === path.resolve(directory) || file.startsWith(prefix)).map(([file, value]) => [file, clone(value)]));
    try {
      // Session cleanup is intentionally narrower than project reset.  The
      // path is derived from two validated opaque IDs and can never escape
      // the V3 sensitive store root or affect another session/project.
      fs.rmSync(directory, { recursive: true, force: true });
      for (const file of priorEphemeral.keys()) ephemeral.delete(file);
      return { ok: true, changed: true, project_id: projectId, session_id: sessionId, path: directory };
    } catch (error) {
      for (const [file, value] of priorEphemeral) ephemeral.set(file, value);
      return operationFailure("MEMORY_SESSION_DELETE_FAILED", `The encrypted V3 session state could not be removed: ${error.message}.`, { project_id: projectId, session_id: sessionId, path: directory }, true);
    }
  }
  function readChatReferenceSnapshot(projectId, snapshotId) {
    try {
      const loaded = readFile(referenceFile(projectId, snapshotId));
      if (!loaded.ok || !loaded.exists) return loaded;
      if (loaded.value?.projectId !== projectId || loaded.value?.snapshot?.id !== snapshotId) return operationFailure("CHAT_REFERENCE_INVALID", "The saved chat snapshot belongs to another project or identity.");
      return { ...loaded, value: loaded.value.snapshot };
    } catch (error) { return operationFailure("CHAT_REFERENCE_INVALID", error.message); }
  }
  function writeChatReferenceSnapshot(projectId, snapshot) {
    try {
      const file = referenceFile(projectId, snapshot.id);
      const previous = readChatReferenceSnapshot(projectId, snapshot.id);
      if (!previous.ok) return previous;
      if (previous.exists) return { ok: true, encrypted: previous.encrypted, durable: previous.durable };
      return writeFile(file, { projectId, snapshot }, { requireDurable: true });
    } catch (error) { return operationFailure("CHAT_REFERENCE_WRITE_FAILED", error.message); }
  }
  function status(projectId) {
    let directory;
    try { directory = projectDir(projectId); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    let persisted = false;
    try { persisted = fs.existsSync(directory); } catch { persisted = false; }
    const secureStorageAvailable = available();
    return { ok: true, project_id: projectId, secureStorageAvailable, persisted, ephemeral: !secureStorageAvailable };
  }
  async function flush() { await Promise.all([...pendingWrites.values()]); return { ok: true, flushed: true }; }
  function resetProject(projectId) {
    let directory;
    try { directory = projectDir(projectId); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    const prefix = `${path.resolve(directory)}${path.sep}`;
    const priorEphemeral = new Map([...ephemeral.entries()].filter(([file]) => file === path.resolve(directory) || file.startsWith(prefix)).map(([file, value]) => [file, clone(value)]));
    try {
      // This path is derived from the validated opaque project ID and the
      // store-owned root.  It is deliberately narrower than the memory-v3
      // root so a reset cannot affect another project's transcripts/jobs.
      fs.rmSync(directory, { recursive: true, force: true });
      for (const file of priorEphemeral.keys()) ephemeral.delete(file);
      return { ok: true, changed: true, project_id: projectId, path: directory };
    } catch (error) {
      for (const [file, value] of priorEphemeral) ephemeral.set(file, value);
      return operationFailure("MEMORY_SENSITIVE_RESET_FAILED", `The encrypted V3 project state could not be reset: ${error.message}.`, { project_id: projectId, path: directory }, true);
    }
  }
  function clearEphemeral() { ephemeral.clear(); }

  return Object.freeze({ root, available, ephemeral: () => !available(), projectDir, sessionDir, transcriptFile, checkpointFile, activeFile, writeFile, readFile, readTranscript, writeTranscript, writeTranscriptAsync, listSessionIds, writeCheckpoint, writeCheckpointTransition, readCheckpoint, readActive, writeActive, writeReleasedBlock, readReleasedBlock, writeChatReferenceSnapshot, readChatReferenceSnapshot, writeChatImage, readChatImage, deleteSession, status, flush, resetProject, clearEphemeral });
}

module.exports = Object.freeze({ createTier1SensitiveStore });
