"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { redactStructuredValue, redactKnownSecrets } = require("../../../shared/secret-redaction.js");

const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

function text(value, fallback = "", limit = 2_000) {
  return String(value == null ? fallback : value).replace(/[\u0000\r\n]/g, "").slice(0, limit);
}

function keyPart(value) { return Buffer.from(text(value), "utf8").toString("base64url"); }
function unkeyPart(value) {
  try { return Buffer.from(String(value || ""), "base64url").toString("utf8"); }
  catch { return String(value || ""); }
}

function commonBrowserPaths(env = process.env, path = nodePath) {
  const local = env.LOCALAPPDATA || "";
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || "";
  const programFilesX86 = env["ProgramFiles(x86)"] || env.PROGRAMFILES_X86 || "";
  return [
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
}

function findInstalledBrowser({ fs = nodeFs, path = nodePath, env = process.env } = {}) {
  for (const executablePath of commonBrowserPaths(env, path)) {
    try {
      if (fs.existsSync(executablePath)) return { executablePath, name: /chrome/i.test(executablePath) ? "chrome" : "edge" };
    } catch { /* Continue through the known Windows installation paths. */ }
  }
  return null;
}

function createBrowserSessionManager({
  chromium = null,
  identityVault = null,
  fs = nodeFs,
  path = nodePath,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  beforeNavigation = null,
  loginNavigation = null,
  onStatus = () => {},
  sharedContextProvider = null,
} = {}) {
  const provider = chromium || require("playwright-core").chromium;
  const contexts = new Map();
  const loginContexts = new Map();
  const locks = new Map();
  const persistenceJobs = new Map();
  const persistenceWarnings = new Map();
  let browser = null;
  let browserRuntime = null;
  let browserPromise = null;

  // Workspace paths are security boundaries. Do not turn them into lossy
  // display keys: two different paths must never share an authenticated
  // BrowserContext.
  function workspaceKey(workspace) {
    try { return path.resolve(String(workspace || ".")).toLowerCase(); }
    catch { return String(workspace || "").trim().toLowerCase(); }
  }
  function contextKey(workspace, identityId, sessionId) {
    const identity = identityId ? `identity:${keyPart(identityId)}` : `anonymous:${keyPart(sessionId || "direct")}`;
    return `${workspaceKey(workspace)}::${identity}`;
  }
  function pageKey(record, sessionId, pageId) { return `${record.key}::${keyPart(sessionId || "direct")}::${keyPart(pageId || "main")}`; }

  function queue(key, task) {
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    locks.set(key, next);
    return next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  }

  async function withAbort(task, signal, page = null, { closeOnAbort = true } = {}) {
    if (!signal) return task();
    if (signal.aborted) {
      const error = new Error("browser action stopped by the operator");
      error.code = "BROWSER_ACTION_STOPPED";
      throw error;
    }
    let abortHandler;
    const operation = Promise.resolve().then(task);
    const stopped = new Promise((_, reject) => {
      abortHandler = () => {
        // The operator can be using a shared visible page. Stopping the
        // agent must not close that browser tab underneath them.
        if (closeOnAbort) Promise.resolve().then(() => page?.close?.()).catch(() => {});
        const error = new Error("browser action stopped by the operator");
        error.code = "BROWSER_ACTION_STOPPED";
        reject(error);
      };
      signal.addEventListener("abort", abortHandler, { once: true });
      // Abort can occur between the initial check and listener registration.
      // Re-check after subscribing so a cancellation is never lost in that
      // small race window.
      if (signal.aborted) abortHandler();
    });
    try { return await Promise.race([operation, stopped]); }
    finally { signal.removeEventListener("abort", abortHandler); }
  }

  function runtime() {
    if (browserRuntime) return browserRuntime;
    browserRuntime = findInstalledBrowser({ fs, path, env });
    return browserRuntime;
  }

  async function launch(headless) {
    const selected = runtime();
    if (!selected) {
      const error = new Error("Microsoft Edge or Google Chrome is required for real browser actions.");
      error.code = "BROWSER_RUNTIME_NOT_FOUND";
      throw error;
    }
    return provider.launch({ headless, executablePath: selected.executablePath });
  }

  async function ensureBrowser() {
    if (browser) return browser;
    if (!browserPromise) browserPromise = launch(true).then((value) => { browser = value; return value; }).finally(() => { browserPromise = null; });
    return browserPromise;
  }

  function originMatches(url, configuredOrigin) {
    try {
      const actual = new URL(url);
      const expected = new URL(configuredOrigin);
      const expectedPath = expected.pathname.replace(/\/+$/, "") || "/";
      return actual.protocol === expected.protocol && actual.host === expected.host
        && (expectedPath === "/" || actual.pathname === expectedPath || actual.pathname.startsWith(`${expectedPath}/`));
    } catch { return false; }
  }

  function headerBindingsFor(secret) {
    return Array.isArray(secret?.headerBindings) ? secret.headerBindings : [];
  }

  function identityHeaderNames(secret) {
    return new Set(headerBindingsFor(secret).flatMap((binding) => Object.keys(binding?.headers || {}).map((name) => String(name).toLowerCase())));
  }

  async function configureContext(record) {
    const context = record.context;
    if (typeof context.route !== "function") return;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && typeof beforeNavigation === "function") {
        let decision;
        try { decision = await beforeNavigation(request.url(), record.executionContext); }
        catch (error) { decision = { ok: false, code: "BROWSER_SCOPE_CHECK_FAILED", reason: error.message }; }
        if (decision?.ok === false) {
          await route.abort("blockedbyclient");
          return;
        }
      }
      const headers = { ...(typeof request.headers === "function" ? request.headers() : {}) };
      // Chromium may carry headers from the previous request across a
      // redirect. Remove every identity-controlled name before evaluating the
      // current URL, then re-add only exact-origin/path bindings.
      const identityNames = identityHeaderNames(record.secret);
      for (const name of Object.keys(headers)) if (identityNames.has(name.toLowerCase())) delete headers[name];
      for (const binding of headerBindingsFor(record.secret)) {
        if (!originMatches(request.url(), binding.origin)) continue;
        for (const [name, value] of Object.entries(binding.headers || {})) headers[name] = value;
      }
      try { await route.continue({ headers }); } catch { /* The page may have closed during cancellation. */ }
    });
  }

  async function loadSecret(workspace, identityId) {
    if (!identityId || !identityVault?.readSecret) return { storageState: { cookies: [], origins: [] }, headerBindings: [] };
    if (typeof identityVault.metadataFor === "function" && !identityVault.metadataFor(workspace, identityId)) {
      const error = new Error(`identity not found: ${identityId}`);
      error.code = "IDENTITY_NOT_FOUND";
      throw error;
    }
    const loaded = identityVault.readSecret(workspace, identityId);
    if (!loaded?.ok) {
      if (loaded?.error?.code === "IDENTITY_SECRET_NOT_FOUND") {
        const error = new Error(`identity is not authenticated: ${identityId}`);
        error.code = "IDENTITY_NOT_AUTHENTICATED";
        throw error;
      }
      if (loaded?.error?.code === "IDENTITY_NOT_FOUND") {
        const error = new Error(`identity not found: ${identityId}`);
        error.code = "IDENTITY_NOT_FOUND";
        throw error;
      }
      const error = new Error(loaded?.error?.message || "Identity authentication state could not be loaded.");
      error.code = loaded?.error?.code || "IDENTITY_SECRET_UNAVAILABLE";
      throw error;
    }
    return loaded.secret || { storageState: { cookies: [], origins: [] }, headerBindings: [] };
  }

  async function loadSharedSecret(workspace, identityId) {
    if (!identityId) return { storageState: { cookies: [], origins: [] }, headerBindings: [] };
    try { return await loadSecret(workspace, identityId); }
    catch {
      // A live operator browser can have a valid in-memory login which has
      // not been saved to the vault yet. Its existing BrowserContext remains
      // usable and is the source of truth for this shared session.
      return { storageState: { cookies: [], origins: [] }, headerBindings: [] };
    }
  }

  async function getRecord(workspace, identityId, sessionId, executionContext = {}) {
    let shared = null;
    if (typeof sharedContextProvider === "function") {
      try { shared = await sharedContextProvider({ workspace, identityId, sessionId, executionContext }); }
      catch { shared = null; }
    }
    // A human may close and reopen the visible browser between two agent
    // actions. Drop only our reference to an obsolete shared context; the
    // proxy-browser service owns the actual browser lifecycle.
    for (const [existingKey, existingRecord] of [...contexts.entries()]) {
      if (!existingRecord.shared || existingRecord.workspaceKey !== workspaceKey(workspace) || existingRecord.identityId !== String(identityId || "")) continue;
      if (!shared || existingRecord.context !== shared.context) contexts.delete(existingKey);
    }
    const key = shared?.key ? `shared:${shared.key}` : contextKey(workspace, identityId, sessionId);
    let record = contexts.get(key);
    if (record?.shared && record.context?.isClosed?.()) {
      contexts.delete(key);
      record = null;
    }
    if (record) {
      record.executionContext = executionContext;
      return record;
    }
    const secret = shared ? await loadSharedSecret(workspace, identityId) : await loadSecret(workspace, identityId);
    const context = shared?.context || await ensureBrowser().then((targetBrowser) => targetBrowser.newContext({ storageState: secret.storageState || undefined }));
    record = {
      key,
      workspace,
      workspaceKey: workspaceKey(workspace),
      identityId: identityId || "",
      context,
      pages: new Map(),
      secret,
      executionContext,
      shared: Boolean(shared),
      sharedMainPage: shared?.mainPage || null,
      sharedPageKeys: new Set(),
    };
    contexts.set(key, record);
    await configureContext(record);
    return record;
  }

  async function getPage(record, sessionId, pageId, create = true) {
    const normalized = text(pageId || "main", "main", 120);
    if (!PAGE_ID_RE.test(normalized)) throw new Error("pageId contains unsupported characters.");
    const owner = keyPart(sessionId || "direct");
    const bindingKey = `${owner}::${keyPart(normalized)}`;
    const existing = record.pages.get(bindingKey);
    if (existing && !existing.isClosed?.()) return existing;
    if (!create) return null;
    if (record.shared && normalized === "main" && record.sharedMainPage && !record.sharedMainPage.isClosed?.()) {
      record.pages.set(bindingKey, record.sharedMainPage);
      record.sharedPageKeys.add(bindingKey);
      return record.sharedMainPage;
    }
    const page = await record.context.newPage();
    record.pages.set(bindingKey, page);
    return page;
  }

  function isSharedOperatorPage(record, sessionId, pageId) {
    const bindingKey = `${keyPart(sessionId || "direct")}::${keyPart(pageId || "main")}`;
    return Boolean(record.shared && record.sharedPageKeys?.has(bindingKey));
  }

  async function captureRecordState(record) {
    if (!record.identityId || !record.context?.storageState) return null;
    const storageState = await record.context.storageState();
    record.secret = { ...(record.secret || {}), storageState };
    return {
      storageState,
      headerBindings: record.secret?.headerBindings || [],
      unmappedTokens: record.secret?.unmappedTokens || {},
    };
  }

  async function persistRecord(record, snapshot = null) {
    if (!record.identityId || (!identityVault?.saveSecretAsync && !identityVault?.saveSecret) || !record.context?.storageState) return { ok: true, persisted: false };
    try {
      const state = snapshot || await captureRecordState(record);
      if (!state) return { ok: true, persisted: false };
      const saver = identityVault.saveSecretAsync || identityVault.saveSecret;
      const result = await saver.call(identityVault, record.workspace, record.identityId, state);
      return result?.ok ? { ok: true, persisted: true } : result;
    } catch (error) {
      return { ok: false, error: { code: error.code || "IDENTITY_STATE_SAVE_FAILED", message: error.message, retryable: true } };
    }
  }

  function schedulePersistRecord(record, snapshot) {
    if (!record.identityId || !snapshot) return Promise.resolve({ ok: true, persisted: false });
    const key = record.key;
    const previous = persistenceJobs.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => persistRecord(record, snapshot)).then((result) => {
      const warningKey = `${record.workspaceKey}::${record.identityId}`;
      if (result?.ok === false) {
        const warning = {
          ok: false,
          workspace: record.workspace,
          identityId: record.identityId,
          code: result.error?.code || result.code || "IDENTITY_STATE_SAVE_FAILED",
          message: result.error?.message || result.error || "The refreshed identity state could not be saved.",
          recordedAt: new Date().toISOString(),
        };
        persistenceWarnings.set(warningKey, warning);
        onStatus(warning);
      } else {
        const recovered = persistenceWarnings.delete(warningKey);
        if (recovered) onStatus({ ok: true, workspace: record.workspace, identityId: record.identityId, persisted: true, recovered: true });
      }
      return result;
    });
    persistenceJobs.set(key, next);
    next.finally(() => { if (persistenceJobs.get(key) === next) persistenceJobs.delete(key); }).catch(() => {});
    return next;
  }

  async function queueCurrentState(record) {
    try {
      const snapshot = await captureRecordState(record);
      schedulePersistRecord(record, snapshot);
      return { ok: true, queued: Boolean(snapshot) };
    } catch (error) {
      const result = { ok: false, error: { code: error.code || "IDENTITY_STATE_CAPTURE_FAILED", message: error.message, retryable: true } };
      const warningKey = `${record.workspaceKey}::${record.identityId}`;
      persistenceWarnings.set(warningKey, { ...result.error, ok: false, workspace: record.workspace, identityId: record.identityId, recordedAt: new Date().toISOString() });
      onStatus(persistenceWarnings.get(warningKey));
      return result;
    }
  }

  async function flushRecordPersistence(record) {
    const pending = persistenceJobs.get(record.key);
    return pending ? pending : { ok: true, pending: false };
  }

  function cleanEvidence(value, secret = null) {
    const sanitized = redactStructuredValue(value);
    const values = [
      ...(Array.isArray(secret?.storageState?.cookies) ? secret.storageState.cookies.map((cookie) => cookie?.value) : []),
      ...(Array.isArray(secret?.headerBindings) ? secret.headerBindings.flatMap((binding) => Object.values(binding?.headers || {})) : []),
      ...Object.values(secret?.unmappedTokens || {}),
    ];
    return redactKnownSecrets(sanitized, values);
  }

  async function execute(input = {}, executionContext = {}, runtimeOptions = {}) {
    const action = text(input.action, "", 40);
    const workspace = executionContext.workspace?.root || "";
    const sessionId = executionContext.sessionId || "direct";
    const identityId = text(input.identityId || "", "", 120);
    const pageId = text(input.pageId || "main", "main", 120);
    if (runtimeOptions.signal?.aborted) {
      const error = new Error("browser action stopped by the operator");
      error.code = "BROWSER_ACTION_STOPPED";
      throw error;
    }
    const record = await getRecord(workspace, identityId, sessionId, {
      ...executionContext,
      identityId,
      sensitiveAuthority: runtimeOptions.authorityDecision || runtimeOptions.sensitiveAuthority || executionContext.sensitiveAuthority || null,
    });

    if (action === "list_pages") {
      const owner = `${keyPart(sessionId)}::`;
      return cleanEvidence({ ok: true, pages: [...record.pages.entries()]
        .filter(([key]) => key.startsWith(owner))
        .map(([key, page]) => ({ pageId: unkeyPart(key.split("::").slice(-1)[0]), url: page.url?.() || "about:blank", closed: Boolean(page.isClosed?.()) })), sharedBrowser: Boolean(record.shared) }, record.secret);
    }
    if (action === "open_page") {
      const result = await queue(pageKey(record, sessionId, pageId), async () => {
        const page = await getPage(record, sessionId, pageId, true);
          return withAbort(async () => {
          if (input.url) {
            if (typeof beforeNavigation === "function") {
              const decision = await beforeNavigation(input.url, record.executionContext);
              if (decision?.ok === false) return { ok: false, error: decision.reason, code: decision.code, scope: decision };
            }
            await page.goto(input.url, { timeout: input.timeoutMs || timeoutMs, waitUntil: "domcontentloaded" });
          }
          return { ok: true, pageId, url: page.url() };
          }, runtimeOptions.signal, page, { closeOnAbort: !isSharedOperatorPage(record, sessionId, pageId) });
      });
      await queueCurrentState(record);
      return cleanEvidence(result, record.secret);
    }
    if (action === "close_page") {
      const result = await queue(pageKey(record, sessionId, pageId), async () => {
        const page = await getPage(record, sessionId, pageId, false);
        if (page && isSharedOperatorPage(record, sessionId, pageId)) {
          return { ok: false, error: { code: "SHARED_BROWSER_PAGE_PROTECTED", message: "The main page belongs to the operator's shared browser and cannot be closed by the agent." } };
        }
        if (page) await withAbort(() => page.close(), runtimeOptions.signal, page);
        record.pages.delete(`${keyPart(sessionId)}::${keyPart(pageId)}`);
        return { ok: true, pageId, closed: Boolean(page) };
      });
      await queueCurrentState(record);
      return cleanEvidence(result, record.secret);
    }

    const run = async (page) => {
      switch (action) {
        case "navigate":
          await page.goto(input.url, { timeout: input.timeoutMs || timeoutMs, waitUntil: "domcontentloaded" });
          return { action, pageId, url: page.url(), title: await page.title() };
        case "click":
          await page.click(input.selector, { timeout: input.timeoutMs || timeoutMs });
          return { action, pageId, clicked: input.selector, url: page.url() };
        case "type":
          await page.fill(input.selector, input.text, { timeout: input.timeoutMs || timeoutMs });
          return { action, pageId, into: input.selector, textLength: String(input.text || "").length };
        case "select":
          await page.selectOption(input.selector, input.option, { timeout: input.timeoutMs || timeoutMs });
          return { action, pageId, selected: input.option, in: input.selector };
        case "wait":
          await page.waitForTimeout(input.waitMs || 0);
          return { action, pageId, waitedMs: input.waitMs || 0 };
        case "extract": {
          const extract = input.extract || { type: "text" };
          const selector = input.selector || "body";
          if (extract.type === "title") return cleanEvidence({ action, pageId, title: await page.title() }, record.secret);
          if (extract.type === "url") return cleanEvidence({ action, pageId, url: page.url() }, record.secret);
          if (extract.type === "html") return cleanEvidence({ action, pageId, html: (await page.content()).slice(0, 100_000) }, record.secret);
          if (extract.type === "attribute") return cleanEvidence({ action, pageId, attribute: { [extract.attribute || "href"]: await page.getAttribute(selector, extract.attribute || "href", { timeout: input.timeoutMs || timeoutMs }) } }, record.secret);
          if (extract.type === "all") return cleanEvidence({ action, pageId, url: page.url(), title: await page.title(), html: (await page.content()).slice(0, 100_000) }, record.secret);
          return cleanEvidence({ action, pageId, text: (await page.locator(selector).textContent({ timeout: input.timeoutMs || timeoutMs }) || "").slice(0, 50_000), url: page.url() }, record.secret);
        }
        default: {
          const error = new Error(`unsupported browser action: ${action}`);
          error.code = "INVALID_BROWSER_ACTION_INPUT";
          throw error;
        }
      }
    };
    const result = await queue(pageKey(record, sessionId, pageId), async () => {
      const page = await getPage(record, sessionId, pageId, true);
      return withAbort(() => run(page), runtimeOptions.signal, page, { closeOnAbort: !isSharedOperatorPage(record, sessionId, pageId) });
    });
    await queueCurrentState(record);
    return { ok: true, ...cleanEvidence({ ...result, sharedBrowser: Boolean(record.shared) }, record.secret) };
  }

  async function startLogin({ workspace, identityId, url, beforeNavigate: loginGuard = loginNavigation } = {}) {
    if (!identityId) return { ok: false, error: { code: "IDENTITY_REQUIRED", message: "identityId is required for manual login.", retryable: false } };
    if (typeof identityVault?.metadataFor === "function" && !identityVault.metadataFor(workspace, identityId)) {
      return { ok: false, error: { code: "IDENTITY_NOT_FOUND", message: `identity not found: ${identityId}`, retryable: false } };
    }
    const selected = runtime();
    if (!selected) return { ok: false, error: { code: "BROWSER_RUNTIME_NOT_FOUND", message: "Microsoft Edge or Google Chrome is required for manual login.", retryable: false } };
    const key = `${workspaceKey(workspace)}::${keyPart(identityId)}`;
    if (loginContexts.has(key)) return { ok: true, value: { identityId, alreadyOpen: true } };
    try {
      const loginBrowser = await launch(false);
      const context = await loginBrowser.newContext();
      if (typeof context.route === "function") {
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (request.isNavigationRequest() && typeof loginGuard === "function") {
            const decision = await loginGuard(request.url(), { workspace: { root: workspace }, identityId, operatorControlled: true });
            if (decision?.ok === false) { await route.abort("blockedbyclient"); return; }
          }
          await route.continue();
        });
      }
      const page = await context.newPage();
      loginContexts.set(key, { key, workspace, identityId, browser: loginBrowser, context, page, startedAt: new Date().toISOString() });
      if (url) await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
      return { ok: true, value: { identityId, runtime: selected.name } };
    } catch (error) {
      return { ok: false, error: { code: error.code || "IDENTITY_LOGIN_START_FAILED", message: "The operator-controlled login window could not be opened.", retryable: false } };
    }
  }

  async function saveLogin({ workspace, identityId } = {}) {
    const key = `${workspaceKey(workspace)}::${keyPart(identityId)}`;
    const record = loginContexts.get(key);
    if (!record) return { ok: false, error: { code: "IDENTITY_LOGIN_NOT_OPEN", message: "No manual login window is open for this identity.", retryable: false } };
    try {
      const storageState = await record.context.storageState();
      const existing = identityVault?.readSecret?.(workspace, identityId);
      // Remove the old headless context without persisting it. Otherwise the
      // replacement state below can be overwritten by stale cookies from the
      // context that is being replaced.
      await closeIdentity(workspace, identityId, { persist: false });
      const saver = identityVault?.saveSecretAsync || identityVault?.saveSecret;
      const saved = await saver?.call(identityVault, workspace, identityId, {
        storageState,
        headerBindings: existing?.ok ? existing.secret.headerBindings : [],
        unmappedTokens: existing?.ok ? existing.secret.unmappedTokens : {},
        clientCertificates: existing?.ok ? existing.secret.clientCertificates : [],
      });
      if (!saved?.ok) return saved || { ok: false, error: { code: "IDENTITY_VAULT_UNAVAILABLE", message: "Identity vault is unavailable.", retryable: false } };
      await record.context.close();
      await record.browser.close();
      loginContexts.delete(key);
      return { ok: true, value: { identityId, saved: true } };
    } catch (error) {
      return { ok: false, error: { code: error.code || "IDENTITY_LOGIN_SAVE_FAILED", message: "The authenticated browser state could not be saved securely.", retryable: false } };
    }
  }

  async function cancelLogin({ workspace, identityId } = {}) {
    const key = `${workspaceKey(workspace)}::${keyPart(identityId)}`;
    const record = loginContexts.get(key);
    if (!record) return { ok: true, value: { identityId, cancelled: false } };
    try { await record.context.close(); } catch { /* Best effort. */ }
    try { await record.browser.close(); } catch { /* Best effort. */ }
    loginContexts.delete(key);
    return { ok: true, value: { identityId, cancelled: true } };
  }

  async function close() {
    for (const record of contexts.values()) {
      const snapshot = await captureRecordState(record).catch(() => null);
      if (snapshot) await schedulePersistRecord(record, snapshot);
      await flushRecordPersistence(record);
      if (!record.shared) {
        try { await record.context.close(); } catch { /* Best effort during shutdown. */ }
      }
    }
    contexts.clear();
    for (const record of loginContexts.values()) {
      try { await record.context.close(); } catch { /* Best effort during shutdown. */ }
      try { await record.browser.close(); } catch { /* Best effort during shutdown. */ }
    }
    loginContexts.clear();
    if (browser) {
      try { await browser.close(); } catch { /* Best effort during shutdown. */ }
      browser = null;
    }
  }

  async function closeIdentity(workspace, identityId, { persist = true } = {}) {
    for (const [key, record] of [...contexts.entries()]) {
      if (record.workspaceKey !== workspaceKey(workspace) || record.identityId !== String(identityId || "")) continue;
      await flushRecordPersistence(record);
      if (persist) {
        const snapshot = await captureRecordState(record).catch(() => null);
        if (snapshot) await schedulePersistRecord(record, snapshot);
      }
      if (!record.shared) {
        try { await record.context.close(); } catch { /* Best effort. */ }
      }
      contexts.delete(key);
    }
    return { ok: true, identityId, closed: true };
  }

  async function closeSession(workspace, sessionId) {
    const owner = `${keyPart(sessionId || "direct")}::`;
    const expectedWorkspaceKey = workspaceKey(workspace);
    for (const [key, record] of [...contexts.entries()]) {
      if (record.workspaceKey !== expectedWorkspaceKey) continue;
      if (!record.identityId && !record.shared && key === contextKey(workspace, "", sessionId)) {
        try { await record.context.close(); } catch { /* Best effort when a chat closes. */ }
        contexts.delete(key);
        continue;
      }
      for (const [pageKey, page] of [...record.pages.entries()]) {
        if (!pageKey.startsWith(owner)) continue;
        if (!record.sharedPageKeys?.has(pageKey)) {
          try { await page.close(); } catch { /* Best effort when a chat closes. */ }
        }
        record.pages.delete(pageKey);
        record.sharedPageKeys?.delete(pageKey);
      }
      const snapshot = await captureRecordState(record).catch(() => null);
      if (snapshot) await schedulePersistRecord(record, snapshot);
    }
    return { ok: true, sessionId, closed: true };
  }

  function activePages(workspace, identityId = "") {
    const pages = new Set();
    for (const record of contexts.values()) {
      if (record.workspaceKey !== workspaceKey(workspace) || record.identityId !== String(identityId || "")) continue;
      for (const page of record.pages.values()) if (!page.isClosed?.()) pages.add(page);
    }
    return pages.size;
  }

  return Object.freeze({
    execute,
    startLogin,
    saveLogin,
    cancelLogin,
    closeIdentity,
    closeSession,
    activePages,
    close,
    runtime: () => runtime() || { name: "none", executablePath: "" },
    activeContexts: () => contexts.size,
    activeLogins: () => loginContexts.size,
    persistenceStatus: (workspace) => {
      const prefix = `${workspaceKey(workspace)}::`;
      const warnings = [...persistenceWarnings.entries()].filter(([key]) => key.startsWith(prefix)).map(([, warning]) => warning);
      return { ok: warnings.length === 0, pending: [...persistenceJobs.keys()].filter((key) => key.startsWith(`${workspaceKey(workspace)}::`)).length, warnings };
    },
    findInstalledBrowser: () => runtime(),
  });
}

module.exports = { createBrowserSessionManager, findInstalledBrowser, commonBrowserPaths };
