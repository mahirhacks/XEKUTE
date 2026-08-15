"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const MANAGE_IDENTITY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["operation"],
  properties: {
    operation: { type: "string", enum: ["create", "load", "switch", "isolate", "list", "delete"] },
    identityId: { type: "string" },
    name: { type: "string" },
    account: { type: "object" },
    role: { type: "string" },
    metadata: { type: "object" },
  },
});

const MANAGE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_MANAGE_IDENTITY_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NOT_FOUND: "MANAGE_IDENTITY_NOT_FOUND",
  ALREADY_EXISTS: "MANAGE_IDENTITY_ALREADY_EXISTS",
  NO_ACTIVE_IDENTITY: "MANAGE_IDENTITY_NONE_ACTIVE",
  WRITE_FAILED: "MANAGE_IDENTITY_WRITE_FAILED",
  SECRET_INPUT_REQUIRES_UI: "IDENTITY_SECRET_INPUT_REQUIRES_UI",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message, code = MANAGE_ERROR_CODES.INVALID_INPUT) {
  return { ok: false, error: { code, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["create", "load", "switch", "isolate", "list", "delete"].includes(input.operation)) {
    return invalidInput("operation must be create, load, switch, isolate, or delete");
  }
  if (input.identityId !== undefined && (typeof input.identityId !== "string" || input.identityId.trim() === "")) {
    return invalidInput("identityId must be a non-empty string");
  }
  if (/[\u0000\r\n]/.test(String(input.identityId || ""))) return invalidInput("identityId must not contain control characters");
  if (input.role !== undefined && (typeof input.role !== "string" || input.role.trim() === "")) {
    return invalidInput("role must be a non-empty string");
  }
  return { ok: true };
}

function safeIdentity(identity = {}) {
  const source = identity && typeof identity === "object" ? identity : {};
  const { cookies, tokens, secret, storageState, headerBindings, ...rest } = source;
  return {
    ...rest,
    hasCookies: Number(source.cookieCount || (Array.isArray(cookies) ? cookies.length : 0)) > 0,
    hasTokens: Boolean(source.hasTokens || (tokens && Object.keys(tokens).length) || (Array.isArray(headerBindings) && headerBindings.length)),
    cookieCount: Number(source.cookieCount || (Array.isArray(cookies) ? cookies.length : 0)) || 0,
    authStatus: source.authStatus || (source.hasCookies || source.hasTokens ? "authenticated" : "not_configured"),
  };
}

function createManageIdentityTool({ fs = null, path = null, identityVault = null, onDelete = null } = {}) {
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");
  const identities = new Map();
  const activeBySession = new Map();

  function identityFile(root, id) { return realPath.join(root, ".xekute", "identities", `${id}.json`); }
  function activeFile(root) { return realPath.join(root, ".xekute", "identities", "active.json"); }
  function sessionKey(root, sessionId) { return `${String(root || "").toLowerCase()}::${String(sessionId || "direct")}`; }

  function loadIdentity(root, id) {
    const cacheKey = `${String(root || "").toLowerCase()}::${id}`;
    if (identities.has(cacheKey)) return identities.get(cacheKey);
    if (identityVault?.metadataFor) {
      const metadata = identityVault.metadataFor(root, id);
      if (metadata) { identities.set(cacheKey, metadata); return metadata; }
    }
    if (!root) return null;
    try {
      const parsed = JSON.parse(realFs.readFileSync(identityFile(root, id), "utf8"));
      if (parsed && parsed.identityId === id) {
        const clean = safeIdentity(parsed);
        identities.set(cacheKey, clean);
        return clean;
      }
    } catch { return null; }
    return null;
  }

  function loadActive(root, sessionId = "direct") {
    const key = sessionKey(root, sessionId);
    if (activeBySession.has(key)) return activeBySession.get(key);
    return null;
  }

  function createIdentity(input, root) {
    const id = input.identityId || input.name;
    if (!id || typeof id !== "string" || id.trim() === "") return invalidInput("identityId or name is required for create");
    if (identityVault && (input.cookies !== undefined || input.tokens !== undefined || input.storageState !== undefined || input.headers !== undefined)) {
      return invalidInput("Authentication state must be imported through Project > Engagement settings.", MANAGE_ERROR_CODES.SECRET_INPUT_REQUIRES_UI);
    }
    if (loadIdentity(root, id)) return structuredFailure(MANAGE_ERROR_CODES.ALREADY_EXISTS, `identity already exists: ${id}`, { identityId: id });
    const now = new Date().toISOString();
    const identity = safeIdentity({
      identityId: id,
      name: input.name || id,
      account: input.account || {},
      role: input.role || "default",
      metadata: input.metadata || {},
      // The production vault rejects secret fields at the tool boundary. The
      // no-vault branch is retained for injected unit-test providers and only
      // keeps these values long enough for the redacted summary counters.
      ...(identityVault ? {} : { cookies: input.cookies, tokens: input.tokens }),
      authStatus: "not_configured",
      createdAt: now,
      updatedAt: now,
    });
    identities.set(`${String(root || "").toLowerCase()}::${id}`, identity);
    if (identityVault?.create) {
      const result = identityVault.create(root, identity);
      if (!result.ok) {
        identities.delete(`${String(root || "").toLowerCase()}::${id}`);
        return result;
      }
    } else if (root) {
      try {
        realFs.mkdirSync(realPath.join(root, ".xekute", "identities"), { recursive: true });
        realFs.writeFileSync(identityFile(root, id), JSON.stringify(identity, null, 2), { encoding: "utf8", mode: 0o600 });
      } catch (error) {
        identities.delete(`${String(root || "").toLowerCase()}::${id}`);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "create", identity: safeIdentity(identity) } };
  }

  function loadIdentityOp(input, root) {
    const id = input.identityId || "";
    const identity = loadIdentity(root, id);
    if (!identity) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `identity not found: ${id}`, { identityId: id });
    return { ok: true, value: { operation: "load", identity: safeIdentity(identity) } };
  }

  function switchIdentity(input, root, sessionId) {
    const id = input.identityId || "";
    const identity = loadIdentity(root, id);
    if (!identity) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `identity not found: ${id}`, { identityId: id });
    activeBySession.set(sessionKey(root, sessionId), id);
    return { ok: true, value: { operation: "switch", identityId: id, name: identity.name, role: identity.role, sessionScoped: true } };
  }

  function isolateIdentity(input, root, sessionId) {
    const active = input.identityId || loadActive(root, sessionId);
    if (!active) return structuredFailure(MANAGE_ERROR_CODES.NO_ACTIVE_IDENTITY, "no active identity to isolate");
    const identity = loadIdentity(root, active);
    if (!identity) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `identity not found: ${active}`, { identityId: active });
    return {
      ok: true,
      value: {
        operation: "isolate",
        identityId: identity.identityId,
        accountContext: { accountId: identity.account?.accountId, tenant: identity.account?.tenant, role: identity.role },
        cookieCount: identity.cookieCount || 0,
        tokenNames: identity.hasTokens ? ["configured"] : [],
        authStatus: identity.authStatus || "not_configured",
        isolated: true,
      },
    };
  }

  function listIdentities(root, sessionId = "direct") {
    if (identityVault?.list) {
      const listed = identityVault.list(root);
      if (listed.ok) return { ok: true, value: { operation: "list", ...listed.value, activeId: loadActive(root, sessionId) || listed.value.activeId || null } };
    }
    const values = [];
    try {
      const dir = realPath.join(root, ".xekute", "identities");
      const entries = realFs.existsSync(dir) ? realFs.readdirSync(dir) : [];
      for (const entry of entries) {
        if (entry.endsWith(".json") && entry !== "active.json") {
          const identity = loadIdentity(root, entry.replace(/\.json$/, ""));
          if (identity) values.push(identity);
        }
      }
    } catch { /* Return the identities already held in memory. */ }
    return { ok: true, value: { operation: "list", count: values.length, identities: values, activeId: loadActive(root, sessionId) || null } };
  }

  async function deleteIdentity(input, root) {
    const id = input.identityId || "";
    if (!loadIdentity(root, id)) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `identity not found: ${id}`, { identityId: id });
    if (typeof onDelete === "function") {
      try {
        const closed = await onDelete(root, id);
        if (closed?.ok === false) return closed;
      } catch (error) {
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message || "Identity browser contexts could not be closed.", { identityId: id });
      }
    }
    if (identityVault?.remove) {
      const removed = identityVault.remove(root, id);
      if (!removed.ok) return removed;
    } else {
      try { realFs.rmSync(identityFile(root, id), { force: true }); } catch (error) { return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message); }
    }
    for (const key of [...identities.keys()]) if (key.endsWith(`::${id}`)) identities.delete(key);
    for (const [key, value] of activeBySession) if (value === id && key.startsWith(`${String(root || "").toLowerCase()}::`)) activeBySession.delete(key);
    return { ok: true, value: { operation: "delete", identityId: id } };
  }

  const adapter = {
    name: "manage_identity",
    inputSchema: MANAGE_IDENTITY_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(MANAGE_ERROR_CODES.INVALID_CONTEXT, "manage_identity requires a restricted tool execution context projection");
      }
      const root = executionContext.workspace?.root || null;
      const sessionId = executionContext.sessionId || "direct";
      switch (input.operation) {
        case "create": return createIdentity(input, root);
        case "load": return loadIdentityOp(input, root);
        case "switch": return switchIdentity(input, root, sessionId);
        case "isolate": return isolateIdentity(input, root, sessionId);
        case "list": return listIdentities(root, sessionId);
        case "delete": return deleteIdentity(input, root);
        default: return invalidInput(`unknown operation: ${input.operation}`);
      }
    },
  };

  return adapter;
}

module.exports = {
  MANAGE_IDENTITY_INPUT_SCHEMA,
  MANAGE_ERROR_CODES,
  createManageIdentityTool,
  validateInput,
};
