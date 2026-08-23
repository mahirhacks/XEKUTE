"use strict";

const VAULT_VERSION = 1;
const MAX_IDENTITIES = 200;
const MAX_CREDENTIALS = 100;
const MAX_HEADERS = 100;
const MAX_COOKIES = 2_000;
const MAX_HEADER_VALUE = 32_768;
const MAX_CREDENTIAL_PASSWORD = 4_096;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "", limit = 1_000) {
  return String(value == null ? fallback : value).replace(/[\u0000\r\n]/g, "").slice(0, limit);
}

function secretText(value, fallback = "", limit = MAX_CREDENTIAL_PASSWORD) {
  return String(value == null ? fallback : value).replace(/\u0000/g, "").slice(0, limit);
}

function clone(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function createIdentityVault({
  fs,
  path,
  crypto,
  baseDir,
  protector = null,
  projectResolver = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto || !baseDir) throw new Error("Identity vault dependencies are required.");

  const rootDir = path.resolve(String(baseDir));
  const identitiesDir = path.join(rootDir, "identities");
  const pendingSecretWrites = new Map();

  function timestamp() { return now().toISOString(); }

  function error(code, message, details = {}) {
    return { ok: false, error: { code, message, retryable: false, ...details } };
  }

  function projectIdFor(workspace, persist = true) {
    const root = String(workspace || "").trim();
    if (!root) return "";
    if (typeof projectResolver === "function") {
      try {
        const resolved = projectResolver(root, { persist });
        const id = typeof resolved === "string" ? resolved : resolved?.projectId;
        if (id) return text(id, "", 240);
      } catch { /* Fall through to the deterministic local fallback. */ }
    }
    const canonical = path.resolve(root).replace(/[\\/]+$/, "").toLowerCase();
    return `project-${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
  }

  function vaultFile(projectId) {
    const safe = text(projectId).replace(/[^a-z0-9_-]/gi, "_");
    return path.join(identitiesDir, `${safe}.json`);
  }

  function metadataDir(workspace) { return path.join(path.resolve(String(workspace || ".")), ".xekute", "identities"); }
  function metadataFile(workspace, identityId) { return path.join(metadataDir(workspace), `${identityId}.json`); }

  function validIdentityId(identityId) { return typeof identityId === "string" && SAFE_ID.test(identityId); }

  function sanitizePublicValue(value, depth = 0) {
    if (depth > 3 || value === null || value === undefined) return undefined;
    if (["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? text(value, "", 2_000) : value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizePublicValue(item, depth + 1)).filter((item) => item !== undefined);
    if (!isRecord(value)) return undefined;
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      if (/(?:password|secret|token|cookie|credential|authorization|session|api[-_]?key|header)/i.test(key)) continue;
      const clean = sanitizePublicValue(child, depth + 1);
      if (clean !== undefined) output[text(key, "", 120)] = clean;
    }
    return output;
  }

  function atomicWrite(file, value, mode = 0o600, { preserveBackup = false } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temporary, "wx", mode);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      try { fs.fsyncSync(descriptor); } catch { /* Best effort on Windows/filesystems without fsync. */ }
    } finally {
      fs.closeSync(descriptor);
    }
    if (!preserveBackup && fs.existsSync(file)) {
      try { fs.copyFileSync(file, `${file}.bak`); } catch { /* Primary write remains authoritative. */ }
    }
    try {
      fs.renameSync(temporary, file);
    } catch (renameError) {
      try {
        fs.copyFileSync(temporary, file);
        fs.rmSync(temporary, { force: true });
      } catch {
        try { fs.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ }
        throw renameError;
      }
    }
    try { fs.chmodSync(file, mode); } catch { /* Windows ACLs protect the user-data directory. */ }
  }

  async function atomicWriteAsync(file, value, mode = 0o600, { preserveBackup = false } = {}) {
    if (!fs.promises?.mkdir || !fs.promises?.open) {
      atomicWrite(file, value, mode, { preserveBackup });
      return;
    }
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      const descriptor = await fs.promises.open(temporary, "wx", mode);
      try {
        await descriptor.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        try { await descriptor.sync(); } catch { /* Best effort on filesystems without fsync. */ }
      } finally {
        await descriptor.close();
      }
      if (!preserveBackup) {
        try { await fs.promises.copyFile(file, `${file}.bak`); } catch { /* A missing primary has no backup yet. */ }
      }
      try {
        await fs.promises.rename(temporary, file);
      } catch (renameError) {
        try { await fs.promises.copyFile(temporary, file); }
        catch { throw renameError; }
      }
      try { await fs.promises.chmod(file, mode); } catch { /* Windows ACLs protect the user-data directory. */ }
    } finally {
      try { await fs.promises.rm(temporary, { force: true }); } catch { /* Best effort temporary-file cleanup. */ }
    }
  }

  function secureStorageAvailable() {
    try { return Boolean(protector?.available?.()); } catch { return false; }
  }

  function encrypt(value) {
    if (!secureStorageAvailable()) throw new Error("Secure identity storage is unavailable on this device.");
    return protector.encrypt(JSON.stringify(value));
  }

  function decrypt(value) {
    if (!secureStorageAvailable()) throw new Error("Encrypted identity storage is unavailable on this device.");
    return JSON.parse(protector.decrypt(String(value || "")));
  }

  function emptyVault(projectId) {
    return { version: VAULT_VERSION, project_id: projectId, updated_at: timestamp(), identities: {}, credentials: {} };
  }

  function normalizeVault(value, projectId) {
    if (!value || !isRecord(value) || !isRecord(value.identities)) throw new Error("Identity vault has an invalid encrypted payload.");
    if (value.credentials === undefined) value.credentials = {};
    if (!isRecord(value.credentials)) throw new Error("Identity vault has an invalid credential payload.");
    return { ...value, version: VAULT_VERSION, project_id: value.project_id || projectId };
  }

  function readVault(projectId) {
    const file = vaultFile(projectId);
    if (!fs.existsSync(file)) return { ok: true, exists: false, file, vault: emptyVault(projectId) };
    if (!secureStorageAvailable()) {
      return { ...error("SECURE_STORAGE_UNAVAILABLE", "Encrypted identity and credential storage is unavailable on this device."), file };
    }
    try {
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      const value = envelope?.encrypted === true ? decrypt(envelope.payload) : null;
      return { ok: true, exists: true, file, vault: normalizeVault(value, projectId) };
    } catch (primaryError) {
      try {
        const backup = JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"));
        const value = backup?.encrypted === true ? decrypt(backup.payload) : null;
        if (value && isRecord(value) && isRecord(value.identities)) {
          const recoveredVault = normalizeVault(value, projectId);
          // Repair the primary without copying the damaged primary over the
          // known-good backup. A crash during repair must retain a recovery
          // source containing the valid encrypted vault.
          try {
            atomicWrite(file, { version: VAULT_VERSION, encrypted: true, payload: encrypt({ ...recoveredVault, version: VAULT_VERSION, updated_at: timestamp() }) }, 0o600, { preserveBackup: true });
          } catch { /* The recovered backup remains usable on the next read. */ }
          return { ok: true, exists: true, recovered: true, file, vault: recoveredVault, warning: `Identity vault backup was recovered: ${primaryError.message}` };
        }
      } catch { /* Return the primary error below. */ }
      return { ...error("IDENTITY_VAULT_CORRUPT", `Identity vault could not be read: ${primaryError.message}`), file };
    }
  }

  function writeVault(projectId, vault) {
    if (!secureStorageAvailable()) return error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; authenticated state was not persisted.");
    try {
      const envelope = { version: VAULT_VERSION, encrypted: true, payload: encrypt({ ...vault, version: VAULT_VERSION, updated_at: timestamp() }) };
      atomicWrite(vaultFile(projectId), envelope);
      return { ok: true, projectId, file: vaultFile(projectId) };
    } catch (writeError) {
      return error("IDENTITY_VAULT_WRITE_FAILED", writeError.message);
    }
  }

  async function writeVaultAsync(projectId, vault) {
    if (!secureStorageAvailable()) return error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; authenticated state was not persisted.");
    try {
      const envelope = { version: VAULT_VERSION, encrypted: true, payload: encrypt({ ...vault, version: VAULT_VERSION, updated_at: timestamp() }) };
      await atomicWriteAsync(vaultFile(projectId), envelope);
      return { ok: true, projectId, file: vaultFile(projectId) };
    } catch (writeError) {
      return error("IDENTITY_VAULT_WRITE_FAILED", writeError.message);
    }
  }

  function queueSecretWrite(projectId, task) {
    const key = String(projectId || "");
    const previous = pendingSecretWrites.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    pendingSecretWrites.set(key, next);
    next.finally(() => {
      if (pendingSecretWrites.get(key) === next) pendingSecretWrites.delete(key);
    }).catch(() => {});
    return next;
  }

  function normalizeHeaderBindings(input) {
    const source = Array.isArray(input) ? input : isRecord(input) ? Object.entries(input).map(([origin, headers]) => ({ origin, headers })) : [];
    const output = [];
    for (const entry of source.slice(0, MAX_HEADERS)) {
      if (!isRecord(entry)) continue;
      const origin = text(entry.origin || entry.url || "", "", 2_000).trim();
      if (!origin) continue;
      let parsed;
      try { parsed = new URL(origin); } catch { continue; }
      if (!/^https?:$/.test(parsed.protocol)) continue;
      const headers = isRecord(entry.headers) ? entry.headers : {};
      const cleanHeaders = {};
      for (const [name, value] of Object.entries(headers).slice(0, MAX_HEADERS)) {
        const headerName = text(name, "", 200).trim();
        if (!headerName || /^(?:host|cookie|set-cookie|content-length|connection|transfer-encoding)$/i.test(headerName)) continue;
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) continue;
        const headerValue = text(value, "", MAX_HEADER_VALUE);
        if (headerValue) cleanHeaders[headerName] = headerValue;
      }
      if (Object.keys(cleanHeaders).length) output.push({ origin: `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`, headers: cleanHeaders });
    }
    return output;
  }

  function normalizeCookies(input) {
    const source = isRecord(input) && Array.isArray(input.cookies) ? input.cookies : Array.isArray(input) ? input : [];
    return source.slice(0, MAX_COOKIES).filter(isRecord).map((cookie) => {
      const result = {};
      for (const key of ["name", "value", "domain", "path", "sameSite", "url"]) {
        if (cookie[key] !== undefined) result[key] = text(cookie[key], "", key === "value" ? MAX_HEADER_VALUE : 2_000);
      }
      for (const key of ["expires", "expirationDate"]) {
        if (cookie[key] !== undefined && Number.isFinite(Number(cookie[key]))) result.expires = Number(cookie[key]);
      }
      for (const key of ["httpOnly", "secure"]) if (cookie[key] !== undefined) result[key] = Boolean(cookie[key]);
      if (!result.name || result.value === undefined) return null;
      if (!result.domain && !result.url) return null;
      return result;
    }).filter(Boolean);
  }

  function normalizeStorageState(input) {
    if (!isRecord(input)) return { cookies: [], origins: [] };
    return {
      cookies: normalizeCookies(input.cookies),
      origins: Array.isArray(input.origins) ? input.origins.slice(0, 500).filter(isRecord).map((origin) => ({
        origin: text(origin.origin, "", 2_000),
        localStorage: Array.isArray(origin.localStorage) ? origin.localStorage.slice(0, 2_000).filter(isRecord).map((item) => ({ name: text(item.name, "", 500), value: text(item.value, "", MAX_HEADER_VALUE) })).filter((item) => item.name) : [],
      })).filter((origin) => origin.origin) : [],
    };
  }

  function normalizeSecret(input = {}) {
    const source = isRecord(input) ? input : {};
    const state = normalizeStorageState(source.storageState || source);
    const cookies = state.cookies.length ? state.cookies : normalizeCookies(source.cookies);
    const headerBindings = normalizeHeaderBindings(source.headerBindings || source.headers);
    const unmappedTokens = isRecord(source.unmappedTokens) ? clone(source.unmappedTokens) : {};
    return { storageState: { cookies, origins: state.origins }, headerBindings, unmappedTokens };
  }

  function publicMetadata(value = {}) {
    const source = isRecord(value) ? value : {};
    return {
      identityId: text(source.identityId, "", 120),
      name: text(source.name || source.identityId, "Identity", 240),
      role: text(source.role || "default", "default", 120),
      account: isRecord(source.account) ? (sanitizePublicValue(source.account) || {}) : {},
      metadata: isRecord(source.metadata) ? (sanitizePublicValue(source.metadata) || {}) : {},
      createdAt: text(source.createdAt || timestamp(), "", 80),
      updatedAt: text(source.updatedAt || timestamp(), "", 80),
      authStatus: text(source.authStatus || "not_configured", "not_configured", 40),
      authSavedAt: text(source.authSavedAt || "", "", 80),
      cookieCount: Math.max(0, Number(source.cookieCount) || 0),
      originCount: Math.max(0, Number(source.originCount) || 0),
      headerOriginCount: Math.max(0, Number(source.headerOriginCount) || 0),
      requiresMapping: Boolean(source.requiresMapping),
      migration: source.migration ? clone(source.migration) : undefined,
    };
  }

  function publicCredential(value = {}) {
    const source = isRecord(value) ? value : {};
    return {
      credentialId: text(source.credentialId, "", 120),
      label: text(source.label || source.name || source.credentialId, "Test account", 240),
      username: text(source.username, "", 500),
      role: text(source.role || "user", "user", 120),
      notes: text(source.notes, "", 1_000),
      createdAt: text(source.createdAt || timestamp(), "", 80),
      updatedAt: text(source.updatedAt || timestamp(), "", 80),
      passwordSet: Boolean(source.payload || source.passwordSet),
      cookieSet: Boolean(source.cookieSet),
    };
  }

  function metadataFor(workspace, identityId) {
    if (!validIdentityId(identityId)) return null;
    try {
      const file = metadataFile(workspace, identityId);
      if (!fs.existsSync(file)) return null;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && parsed.identityId === identityId ? publicMetadata(parsed) : null;
    } catch { return null; }
  }

  function writeMetadata(workspace, metadata) {
    const clean = publicMetadata(metadata);
    atomicWrite(metadataFile(workspace, clean.identityId), clean);
    return clean;
  }

  function listMetadata(workspace) {
    const dir = metadataDir(workspace);
    try {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((entry) => entry.endsWith(".json") && entry !== "active.json").slice(0, MAX_IDENTITIES).map((entry) => metadataFor(workspace, entry.replace(/\.json$/, ""))).filter(Boolean);
    } catch { return []; }
  }

  function readSecret(workspace, identityId) {
    if (!validIdentityId(identityId)) return error("IDENTITY_INVALID_ID", "identityId is invalid.", { identityId });
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    const projectId = projectIdFor(workspace, false);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const record = loaded.vault.identities?.[identityId];
    if (!record?.payload) return error("IDENTITY_SECRET_NOT_FOUND", `No encrypted authentication state exists for identity ${identityId}.`, { identityId });
    try {
      return { ok: true, identityId, secret: decrypt(record.payload), metadata: metadataFor(workspace, identityId) };
    } catch (decryptError) {
      return error("IDENTITY_SECRET_UNAVAILABLE", decryptError.message, { identityId });
    }
  }

  function create(workspace, input = {}) {
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    const identityId = text(input.identityId || input.name, "", 120).trim();
    if (!SAFE_ID.test(identityId)) return error("IDENTITY_INVALID_ID", "identityId must contain only letters, numbers, dots, underscores, or hyphens.");
    const existing = metadataFor(workspace, identityId);
    if (existing) return error("IDENTITY_ALREADY_EXISTS", `identity already exists: ${identityId}`, { identityId });
    const metadata = writeMetadata(workspace, { ...input, identityId, authStatus: "not_configured" });
    return { ok: true, value: { identity: metadata } };
  }

  function list(workspace) {
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    const metadata = listMetadata(workspace);
    const activeFile = path.join(metadataDir(workspace), "active.json");
    let activeId = null;
    try { activeId = JSON.parse(fs.readFileSync(activeFile, "utf8"))?.activeId || null; } catch { /* Optional metadata. */ }
    return { ok: true, value: { identities: metadata, count: metadata.length, activeId, secureStorageAvailable: secureStorageAvailable() } };
  }

  function listCredentials(workspace) {
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    const projectId = projectIdFor(workspace, false);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const credentials = Object.values(loaded.vault.credentials || {})
      .slice(0, MAX_CREDENTIALS)
      .map((credential) => publicCredential(credential))
      .filter((credential) => credential.credentialId);
    return { ok: true, value: { credentials, count: credentials.length, secureStorageAvailable: secureStorageAvailable() } };
  }

  function createCredential(workspace, input = {}) {
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    if (!secureStorageAvailable()) return error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; test credentials were not persisted.");
    const source = isRecord(input) ? input : {};
    const label = text(source.label || source.name, "", 240).trim();
    const username = text(source.username, "", 500).trim();
    const password = secretText(source.password, "", MAX_CREDENTIAL_PASSWORD);
    if (!label) return error("CREDENTIAL_LABEL_REQUIRED", "A test account label is required.");
    if (!username) return error("CREDENTIAL_USERNAME_REQUIRED", "A test account username is required.");
    if (!password) return error("CREDENTIAL_PASSWORD_REQUIRED", "A test account password is required.");
    const projectId = projectIdFor(workspace, true);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const vault = loaded.vault;
    vault.credentials = vault.credentials || {};
    if (Object.keys(vault.credentials).length >= MAX_CREDENTIALS) return error("CREDENTIAL_LIMIT_REACHED", `A project may contain at most ${MAX_CREDENTIALS} test credentials.`);
    let credentialId = text(source.credentialId || source.id, "", 120).trim();
    if (credentialId && !SAFE_ID.test(credentialId)) return error("CREDENTIAL_INVALID_ID", "credentialId must contain only letters, numbers, dots, underscores, or hyphens.");
    if (!credentialId) {
      const entropy = typeof crypto.randomBytes === "function" ? crypto.randomBytes(8).toString("hex") : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      credentialId = `credential-${entropy}`.slice(0, 120);
    }
    if (vault.credentials[credentialId]) return error("CREDENTIAL_ALREADY_EXISTS", `test credential already exists: ${credentialId}`, { credentialId });
    const createdAt = timestamp();
    vault.credentials[credentialId] = {
      credentialId,
      label,
      username,
      role: text(source.role || "user", "user", 120).trim() || "user",
      notes: text(source.notes, "", 1_000),
      cookieSet: Boolean(secretText(source.cookie, "", MAX_HEADER_VALUE)),
      createdAt,
      updatedAt: createdAt,
      payload: encrypt({ username, password, cookie: secretText(source.cookie, "", MAX_HEADER_VALUE) }),
    };
    const written = writeVault(projectId, vault);
    if (!written.ok) return written;
    return { ok: true, value: { credential: publicCredential(vault.credentials[credentialId]), projectId } };
  }

  function saveCredential(workspace, input = {}) {
    const migration = migrateLegacy(workspace);
    if (!migration.ok) return migration;
    if (!secureStorageAvailable()) return error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; test credentials were not persisted.");
    const source = isRecord(input) ? input : {};
    const username = text(source.username, "", 500).trim();
    if (!username) return error("CREDENTIAL_USERNAME_REQUIRED", "A test account username is required.");
    const projectId = projectIdFor(workspace, true);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const vault = loaded.vault;
    vault.credentials = vault.credentials || {};
    let credentialId = text(source.credentialId || source.id, "", 120).trim();
    if (credentialId && !SAFE_ID.test(credentialId)) return error("CREDENTIAL_INVALID_ID", "credentialId must contain only letters, numbers, dots, underscores, or hyphens.");
    if (!credentialId) {
      if (Object.keys(vault.credentials).length >= MAX_CREDENTIALS) return error("CREDENTIAL_LIMIT_REACHED", `A project may contain at most ${MAX_CREDENTIALS} test credentials.`);
      const entropy = typeof crypto.randomBytes === "function" ? crypto.randomBytes(8).toString("hex") : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      credentialId = `credential-${entropy}`.slice(0, 120);
    }
    const existing = vault.credentials[credentialId] || null;
    let existingSecret = {};
    if (existing?.payload) {
      try { existingSecret = decrypt(existing.payload) || {}; }
      catch (decryptError) { return error("CREDENTIAL_SECRET_UNAVAILABLE", decryptError.message, { credentialId }); }
    }
    const password = secretText(source.password, "", MAX_CREDENTIAL_PASSWORD) || secretText(existingSecret.password, "", MAX_CREDENTIAL_PASSWORD);
    if (!password) return error("CREDENTIAL_PASSWORD_REQUIRED", "A test account password is required.");
    const suppliedCookie = secretText(source.cookie, "", MAX_HEADER_VALUE);
    const cookie = suppliedCookie || secretText(existingSecret.cookie, "", MAX_HEADER_VALUE);
    const savedAt = timestamp();
    vault.credentials[credentialId] = {
      credentialId,
      label: text(source.label, existing?.label || "Test account", 240).trim() || "Test account",
      username,
      role: text(source.role, existing?.role || "", 120).trim(),
      notes: text(existing?.notes, "", 1_000),
      cookieSet: Boolean(cookie),
      createdAt: existing?.createdAt || savedAt,
      updatedAt: savedAt,
      payload: encrypt({ username, password, cookie }),
    };
    const written = writeVault(projectId, vault);
    if (!written.ok) return written;
    return { ok: true, value: { credential: publicCredential(vault.credentials[credentialId]), projectId } };
  }

  function readCredential(workspace, credentialId) {
    if (!validIdentityId(credentialId)) return error("CREDENTIAL_INVALID_ID", "credentialId is invalid.", { credentialId });
    const projectId = projectIdFor(workspace, false);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const record = loaded.vault.credentials?.[credentialId];
    if (!record?.payload) return error("CREDENTIAL_NOT_FOUND", `test credential not found: ${credentialId}`, { credentialId });
    try {
      return { ok: true, credentialId, secret: decrypt(record.payload), metadata: publicCredential(record) };
    } catch (decryptError) {
      return error("CREDENTIAL_SECRET_UNAVAILABLE", decryptError.message, { credentialId });
    }
  }

  function removeCredential(workspace, credentialId) {
    if (!validIdentityId(credentialId)) return error("CREDENTIAL_INVALID_ID", "credentialId is invalid.", { credentialId });
    const projectId = projectIdFor(workspace, false);
    if (!projectId) return error("IDENTITY_PROJECT_REQUIRED", "A project workspace is required.");
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    if (!loaded.vault.credentials?.[credentialId]) return error("CREDENTIAL_NOT_FOUND", `test credential not found: ${credentialId}`, { credentialId });
    delete loaded.vault.credentials[credentialId];
    const written = writeVault(projectId, loaded.vault);
    if (!written.ok) return written;
    try { fs.rmSync(`${vaultFile(projectId)}.bak`, { force: true }); } catch { /* The current encrypted vault is authoritative. */ }
    return { ok: true, value: { credentialId, removed: true } };
  }

  function update(workspace, identityId, patch = {}) {
    if (!validIdentityId(identityId)) return error("IDENTITY_INVALID_ID", "identityId is invalid.", { identityId });
    const current = metadataFor(workspace, identityId);
    if (!current) return error("IDENTITY_NOT_FOUND", `identity not found: ${identityId}`, { identityId });
    const metadata = writeMetadata(workspace, { ...current, ...patch, identityId, updatedAt: timestamp() });
    return { ok: true, value: { identity: metadata } };
  }

  function saveSecret(workspace, identityId, input = {}) {
    if (!metadataFor(workspace, identityId)) return error("IDENTITY_NOT_FOUND", `identity not found: ${identityId}`, { identityId });
    if (!secureStorageAvailable()) return error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; authenticated state was not persisted.");
    const secret = normalizeSecret(input);
    if (!secret.storageState.cookies.length && !secret.storageState.origins.length && !secret.headerBindings.length && !Object.keys(secret.unmappedTokens).length) {
      return error("IDENTITY_AUTH_STATE_EMPTY", "No supported cookies, origins, or origin-bound headers were provided.", { identityId });
    }
    const projectId = projectIdFor(workspace, true);
    const loaded = readVault(projectId);
    if (!loaded.ok) return loaded;
    const vault = loaded.vault;
    vault.identities = vault.identities || {};
    vault.identities[identityId] = { identityId, updatedAt: timestamp(), payload: encrypt(secret) };
    const written = writeVault(projectId, vault);
    if (!written.ok) return written;
    const metadata = update(workspace, identityId, {
      authStatus: "authenticated",
      authSavedAt: timestamp(),
      cookieCount: secret.storageState.cookies.length,
      originCount: secret.storageState.origins.length,
      headerOriginCount: secret.headerBindings.length,
      requiresMapping: Object.keys(secret.unmappedTokens).length > 0,
      updatedAt: timestamp(),
    });
    return { ok: true, value: { identity: metadata.value?.identity || metadata.identity, projectId } };
  }

  function saveSecretAsync(workspace, identityId, input = {}) {
    if (!metadataFor(workspace, identityId)) return Promise.resolve(error("IDENTITY_NOT_FOUND", `identity not found: ${identityId}`, { identityId }));
    if (!secureStorageAvailable()) return Promise.resolve(error("SECURE_STORAGE_UNAVAILABLE", "Secure identity storage is unavailable; authenticated state was not persisted."));
    const secret = normalizeSecret(input);
    if (!secret.storageState.cookies.length && !secret.storageState.origins.length && !secret.headerBindings.length && !Object.keys(secret.unmappedTokens).length) {
      return Promise.resolve(error("IDENTITY_AUTH_STATE_EMPTY", "No supported cookies, origins, or origin-bound headers were provided.", { identityId }));
    }
    const projectId = projectIdFor(workspace, true);
    return queueSecretWrite(projectId, async () => {
      if (!metadataFor(workspace, identityId)) return error("IDENTITY_NOT_FOUND", `identity not found: ${identityId}`, { identityId });
      const loaded = readVault(projectId);
      if (!loaded.ok) return loaded;
      const vault = loaded.vault;
      vault.identities = vault.identities || {};
      vault.identities[identityId] = { identityId, updatedAt: timestamp(), payload: encrypt(secret) };
      const written = await writeVaultAsync(projectId, vault);
      if (!written.ok) return written;
      const metadata = update(workspace, identityId, {
        authStatus: "authenticated",
        authSavedAt: timestamp(),
        cookieCount: secret.storageState.cookies.length,
        originCount: secret.storageState.origins.length,
        headerOriginCount: secret.headerBindings.length,
        requiresMapping: Object.keys(secret.unmappedTokens).length > 0,
        updatedAt: timestamp(),
      });
      return { ok: true, value: { identity: metadata.value?.identity || metadata.identity, projectId } };
    });
  }

  async function flush() {
    const pending = [...pendingSecretWrites.values()];
    const results = await Promise.all(pending.map((job) => job.catch((writeError) => error("IDENTITY_VAULT_WRITE_FAILED", writeError.message))));
    return { ok: results.every((result) => result?.ok !== false), pending: pending.length, results };
  }

  function remove(workspace, identityId) {
    if (!validIdentityId(identityId)) return error("IDENTITY_INVALID_ID", "identityId is invalid.", { identityId });
    const projectId = projectIdFor(workspace, false);
    const loaded = projectId ? readVault(projectId) : { ok: true, vault: emptyVault("") };
    if (!loaded.ok) return loaded;
    if (projectId && loaded.vault?.identities?.[identityId]) {
      delete loaded.vault.identities[identityId];
      const written = writeVault(projectId, loaded.vault);
      if (!written.ok) return written;
      try { fs.rmSync(`${vaultFile(projectId)}.bak`, { force: true }); } catch { /* The current encrypted vault is authoritative. */ }
    }
    try {
      fs.rmSync(metadataFile(workspace, identityId), { force: true });
      fs.rmSync(`${metadataFile(workspace, identityId)}.bak`, { force: true });
    } catch (removeError) { return error("IDENTITY_DELETE_FAILED", removeError.message, { identityId }); }
    return { ok: true, value: { identityId, removed: true } };
  }

  function migrateLegacy(workspace) {
    const dir = metadataDir(workspace);
    if (!fs.existsSync(dir)) return { ok: true, migrated: 0, skipped: 0 };
    const entries = fs.readdirSync(dir).filter((entry) => entry.endsWith(".json") && entry !== "active.json");
    let migrated = 0;
    let skipped = 0;
    for (const entry of entries) {
      const file = path.join(dir, entry);
      let legacy;
      try { legacy = JSON.parse(fs.readFileSync(file, "utf8")); } catch { skipped += 1; continue; }
      if (legacy?.migration?.identityVaultVersion >= VAULT_VERSION && legacy.cookies === undefined && legacy.tokens === undefined) { skipped += 1; continue; }
      const identityId = text(legacy.identityId || entry.replace(/\.json$/, ""), "", 120);
      if (!SAFE_ID.test(identityId)) { skipped += 1; continue; }
      const hasSecrets = Array.isArray(legacy.cookies) && legacy.cookies.length || isRecord(legacy.tokens) && Object.keys(legacy.tokens).length;
      if (!hasSecrets) {
        writeMetadata(workspace, { ...legacy, identityId, migration: { identityVaultVersion: VAULT_VERSION, migratedAt: timestamp() } });
        try { fs.rmSync(`${file}.bak`, { force: true }); } catch { /* Ensure no legacy backup can retain plaintext secrets. */ }
        skipped += 1;
        continue;
      }
      const secret = normalizeSecret({ cookies: legacy.cookies, unmappedTokens: legacy.tokens || {} });
      const saved = saveSecret(workspace, identityId, secret);
      if (!saved.ok) return { ...saved, migrated, skipped };
      const sanitized = { ...legacy, ...saved.value.identity, cookies: undefined, tokens: undefined, migration: { identityVaultVersion: VAULT_VERSION, migratedAt: timestamp() } };
      delete sanitized.cookies;
      delete sanitized.tokens;
      writeMetadata(workspace, sanitized);
      try { fs.rmSync(`${file}.bak`, { force: true }); } catch { /* Ensure no legacy backup can retain plaintext secrets. */ }
      migrated += 1;
    }
    return { ok: true, migrated, skipped };
  }

  return Object.freeze({
    projectIdFor,
    secureStorageAvailable,
    create,
    list,
    listCredentials,
    createCredential,
    saveCredential,
    readCredential,
    removeCredential,
    update,
    saveSecret,
    saveSecretAsync,
    readSecret,
    remove,
    migrateLegacy,
    normalizeSecret,
    normalizeCookies,
    normalizeHeaderBindings,
    metadataFor,
    flush,
  });
}

module.exports = { createIdentityVault, VAULT_VERSION };
