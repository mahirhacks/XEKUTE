"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretValues, atomicWriteText, clone, hashText, operationFailure, timestamp } = require("./memory-storage-utils.js");

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
      const value = JSON.parse(protector.decrypt(envelope.payload));
      return { ok: true, value };
    } catch (error) { return operationFailure("MEMORY_SENSITIVE_DECRYPT_FAILED", `The encrypted Tier 1 state could not be decrypted: ${error.message}.`, {}, true); }
  }
  function writeFile(file, value) {
    const encrypted = encryptEnvelope(value);
    if (!encrypted.ok) {
      // Never shadow an existing durable encrypted value with a process-only
      // replacement.  When safeStorage is temporarily unavailable the old
      // envelope is deliberately unreadable, but it is still the last known
      // durable state.  Replacing it in the ephemeral map would let callers
      // clear/advance Tier 1 buffers while silently losing the new state on
      // restart.  A file that was created only by this process in ephemeral
      // mode may still be updated in memory.
      let durableExists = false;
      try { durableExists = fs.existsSync(file); } catch { durableExists = false; }
      if (durableExists && !ephemeral.has(key(file))) {
        return operationFailure("MEMORY_SECURE_STORAGE_UNAVAILABLE", "Electron secure storage is unavailable; the existing encrypted Tier 1 state was preserved.", { path: file }, false);
      }
      // Secure storage failure is a supported degraded mode for chat
      // continuity.  Keep the exact value in the process-only map and report
      // success with durable:false so callers can continue without making a
      // false promise that the state will survive process exit.
      ephemeral.set(key(file), clone(value));
      return { ok: true, changed: true, encrypted: false, durable: false, ephemeral: true, warning: encrypted.error, path: file };
    }
    try {
      const raw = JSON.stringify(encrypted.envelope, null, 2) + "\n";
      // Use the shared atomic writer instead of a bare rename.  Windows does
      // not reliably replace an existing file with renameSync, so the helper
      // includes the copy/replace fallback while still fsyncing the complete
      // encrypted envelope before publication.  Sensitive files deliberately
      // do not retain an additional plaintext or encrypted .bak copy here;
      // checkpoint rollback is represented by the separate previous file.
      atomicWriteText({ fs, path, crypto }, file, raw, { mode: 0o600, backup: false });
      // A process may begin in the supported ephemeral mode and later regain
      // access to Electron safeStorage (for example after the app keyring is
      // unlocked).  Remove the stale in-memory shadow once a durable write
      // succeeds; otherwise readFile() would keep returning the old
      // plaintext-in-memory value ahead of the newly committed envelope.
      ephemeral.delete(key(file));
      return { ok: true, changed: true, encrypted: true, ephemeral: false, path: file, sha256: encrypted.envelope.sha256 };
    } catch (error) { return operationFailure("MEMORY_SENSITIVE_WRITE_FAILED", `The encrypted Tier 1 state could not be written: ${error.message}.`, { path: file }, true); }
  }
  function readFile(file) {
    if (ephemeral.has(key(file))) return { ok: true, exists: true, encrypted: false, ephemeral: true, value: clone(ephemeral.get(key(file))), path: file };
    try {
      // Keep the existence probe inside the guarded read path.  A locked
      // profile, ACL failure, or test double can throw from existsSync itself;
      // that must become the stable sensitive-read error rather than escaping
      // into checkpoint/retry orchestration.
      if (!fs.existsSync(file)) return { ok: true, exists: false, encrypted: false, ephemeral: false, value: null, path: file };
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      const decoded = decryptEnvelope(envelope);
      if (!decoded.ok) return decoded;
      if (envelope.sha256 && envelope.sha256 !== hashText(crypto, JSON.stringify(decoded.value))) return operationFailure("MEMORY_SENSITIVE_HASH_MISMATCH", "The encrypted Tier 1 state hash does not match.", { path: file }, true);
      return { ok: true, exists: true, encrypted: true, ephemeral: false, value: decoded.value, path: file };
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
    try { assertNoSecretValues(value); } catch (error) {
      return operationFailure(error.code || "MEMORY_CHECKPOINT_SECRET", "The encrypted Tier 1 checkpoint contains an invalid protected field.", {}, true);
    }
    return { ok: true, value };
  }

  function readTranscript(projectId, sessionId) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const loaded = readFile(transcriptFile(project, session));
    if (!loaded.ok || !loaded.exists) return loaded;
    const checked = validateTranscriptValue(loaded.value, project, session);
    return checked.ok ? { ...loaded, value: checked.value } : checked;
  }
  function writeTranscript(projectId, sessionId, transcript) {
    let project;
    let session;
    try {
      project = assertMemoryId(projectId, "proj");
      session = assertMemoryId(sessionId, "session");
    } catch (error) {
      return operationFailure(error.code || "MEMORY_TIER1_INPUT_INVALID", error.message, {}, false);
    }
    const candidate = {
      ...clone(transcript || {}),
      schema_version: 3,
      project_id: project,
      session_id: session,
      blocks: Array.isArray(transcript?.blocks) ? clone(transcript.blocks) : [],
    };
    const checked = validateTranscriptValue(candidate, project, session);
    if (!checked.ok) return checked;
    for (const block of candidate.blocks) {
      try { assertMemoryId(block?.block_id, "block"); } catch {
        return operationFailure("MEMORY_TRANSCRIPT_BLOCK_INVALID", "The encrypted Tier 1 transcript contains an invalid block ID.", { project_id: project, session_id: session }, false);
      }
    }
    return writeFile(transcriptFile(project, session), candidate);
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
  function status(projectId) {
    let directory;
    try { directory = projectDir(projectId); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    let persisted = false;
    try { persisted = fs.existsSync(directory); } catch { persisted = false; }
    const secureStorageAvailable = available();
    return { ok: true, project_id: projectId, secureStorageAvailable, persisted, ephemeral: !secureStorageAvailable };
  }
  function flush() { return Promise.resolve({ ok: true, flushed: true }); }
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

  return Object.freeze({ root, available, ephemeral: () => !available(), projectDir, sessionDir, transcriptFile, checkpointFile, writeFile, readFile, readTranscript, writeTranscript, listSessionIds, writeCheckpoint, readCheckpoint, deleteSession, status, flush, resetProject, clearEphemeral });
}

module.exports = Object.freeze({ createTier1SensitiveStore });
