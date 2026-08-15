"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");

function browserCandidates(env = process.env, path = nodePath) {
  const local = env.LOCALAPPDATA || "";
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || "";
  const programFilesX86 = env["ProgramFiles(x86)"] || env.PROGRAMFILES_X86 || "";
  return [
    ["chrome", path.join(local, "Google", "Chrome", "Application", "chrome.exe")],
    ["chrome", path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe")],
    ["chrome", path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")],
    ["edge", path.join(local, "Microsoft", "Edge", "Application", "msedge.exe")],
    ["edge", path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")],
    ["edge", path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")],
  ].filter(([, executablePath]) => executablePath);
}

function findInstalledProxyBrowser({ fs = nodeFs, path = nodePath, env = process.env } = {}) {
  for (const [name, executablePath] of browserCandidates(env, path)) {
    try {
      if (fs.existsSync(executablePath)) return { name, executablePath };
    } catch { /* Continue through known Windows browser locations. */ }
  }
  return null;
}

function proxyConnectHost(host) {
  const value = String(host || "").trim();
  return ["", "0.0.0.0", "::", "[::]"].includes(value) ? "127.0.0.1" : value;
}

function createProxyBrowserService({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  chromium = null,
  profilesDirectory,
  findBrowser = () => findInstalledProxyBrowser({ fs, path }),
  onStatus = () => {},
} = {}) {
  if (!profilesDirectory) throw new TypeError("Proxy browser profilesDirectory is required.");
  const provider = chromium || require("playwright-core").chromium;
  const contexts = new Map();

  function workspaceKey(workspace) {
    return path.resolve(String(workspace || ".")).toLowerCase();
  }

  function normalizedIdentityId(identity = null) {
    return String(identity?.id || identity?.identityId || "anonymous").trim().toLowerCase() || "anonymous";
  }

  function contextKey(workspace, identity = null) {
    return `${workspaceKey(workspace)}|${normalizedIdentityId(identity)}`;
  }

  function profileDirectory(workspace, identity = null) {
    const digest = crypto.createHash("sha256").update(contextKey(workspace, identity)).digest("hex").slice(0, 32);
    return path.join(path.resolve(profilesDirectory), digest);
  }

  function publicStatus(record = null, extra = {}) {
    return {
      ok: true,
      running: Boolean(record),
      browser: record?.browser?.name || "",
      proxyHost: record?.proxyHost || "",
      proxyPort: record?.proxyPort || null,
      caCertPath: record?.caCertPath || "",
      workspace: record?.workspace || "",
      identityId: record?.identity?.id || "anonymous",
      identityLabel: record?.identity?.label || "Anonymous",
      identityRole: record?.identity?.role || "anonymous",
      activeContexts: contexts.size,
      agentShareAvailable: Boolean(record),
      ...extra,
    };
  }

  // This is deliberately an in-process-only hand-off. It is never exposed
  // through IPC, so no browser/session material crosses into the renderer or
  // model. The browser-action provider can use the live Playwright context
  // when the operator has opened the matching proxied browser.
  function getAgentContext(workspace = "", identityId = "") {
    const root = String(workspace || "").trim();
    if (!root) return null;
    const requestedIdentity = String(identityId || "").trim();
    // An omitted identity can share only the explicitly anonymous browser.
    // Do not silently select an arbitrary authenticated identity when several
    // operator browsers are open for the same project.
    const record = contexts.get(contextKey(root, { id: requestedIdentity || "anonymous" }));
    if (!record?.context) return null;
    try {
      const pages = record.context.pages?.() || [];
      const page = pages.find((candidate) => !candidate?.isClosed?.()) || null;
      return {
        key: contextKey(root, record.identity),
        context: record.context,
        mainPage: page,
        workspace: record.workspace,
        identityId: record.identity?.id || "anonymous",
        identityLabel: record.identity?.label || "Anonymous",
        proxied: true,
      };
    } catch {
      return null;
    }
  }

  function getAgentPageTarget(workspace = "", identityId = "", pageId = "main") {
    const shared = getAgentContext(workspace, identityId);
    if (!shared || String(pageId || "main") !== "main") return "";
    try { return shared.mainPage?.url?.() || ""; }
    catch { return ""; }
  }

  async function launch({ workspace, proxy = {}, caCertPath = "", startUrl = "", identity = null, captureToken = "" } = {}) {
    const root = String(workspace || "").trim();
    if (!root) return { ok: false, error: { code: "PROXY_BROWSER_PROJECT_REQUIRED", message: "Open a project before launching the proxied browser.", retryable: false } };
    const port = Number(proxy.port);
    if (!proxy.running || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: { code: "PROXY_BROWSER_PROXY_NOT_RUNNING", message: "The XEKUTE proxy listener is not running.", retryable: false } };
    }
    if (!caCertPath || !fs.existsSync(caCertPath)) {
      return { ok: false, error: { code: "PROXY_BROWSER_CA_UNAVAILABLE", message: "The XEKUTE proxy CA certificate has not been generated.", retryable: false } };
    }

    const captureIdentity = {
      id: normalizedIdentityId(identity),
      label: String(identity?.label || identity?.displayName || (identity ? normalizedIdentityId(identity) : "Anonymous")).slice(0, 160),
      role: String(identity?.role || (identity ? "user" : "anonymous")).slice(0, 120),
    };
    const key = contextKey(root, captureIdentity);
    const existing = contexts.get(key);
    if (existing) {
      try {
        const pages = existing.context.pages();
        if (pages[0]) await pages[0].bringToFront();
        return publicStatus(existing, { alreadyOpen: true });
      } catch { contexts.delete(key); }
    }

    // One listener can belong to only one project at a time. Close any older
    // project browser before switching so its traffic can never be recorded
    // into the newly active assessment.
    for (const [otherKey, otherRecord] of [...contexts.entries()]) {
      if (otherKey === key || workspaceKey(otherRecord.workspace) === workspaceKey(root)) continue;
      contexts.delete(otherKey);
      try { await otherRecord.context.close(); } catch { /* Already closed by the operator. */ }
    }

    const browser = findBrowser();
    if (!browser?.executablePath) {
      return { ok: false, error: { code: "PROXY_BROWSER_RUNTIME_NOT_FOUND", message: "Install Microsoft Edge or Google Chrome to use the XEKUTE proxied browser.", retryable: false } };
    }

    const proxyHost = proxyConnectHost(proxy.host);
    const userDataDir = profileDirectory(root, captureIdentity);
    fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(userDataDir, 0o700); } catch { /* Windows ACLs protect Electron user data. */ }

    try {
      const context = await provider.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: browser.executablePath,
        // Playwright otherwise appends --no-sandbox. Installed Windows Chrome
        // and Edge support Chromium's process sandbox, so keep it enabled for
        // the operator-facing shared browser.
        chromiumSandbox: true,
        ignoreHTTPSErrors: true,
        viewport: null,
        proxy: { server: `http://${proxyHost}:${port}`, bypass: "<-loopback>" },
        ...(captureToken ? { extraHTTPHeaders: { "X-Xekute-Capture-Context": String(captureToken) } } : {}),
        args: [
          "--start-maximized",
          "--no-first-run",
          "--no-default-browser-check",
          // HTTP/3 does not traverse an HTTP CONNECT proxy. Force the browser
          // onto proxy-visible TCP transports instead of allowing QUIC to
          // silently bypass capture or fail independently of the listener.
          "--disable-quic",
        ],
      });
      const record = { context, workspace: root, browser, proxyHost, proxyPort: port, caCertPath, identity: captureIdentity };
      contexts.set(key, record);
      context.on?.("close", () => {
        if (contexts.get(key)?.context === context) contexts.delete(key);
        const remaining = [...contexts.values()].find((item) => workspaceKey(item.workspace) === workspaceKey(root)) || null;
        onStatus(publicStatus(remaining, { workspace: root, closed: true, closedIdentityId: captureIdentity.id }));
      });
      let pages = context.pages();
      if (!pages.length) pages = [await context.newPage()];
      if (startUrl) await pages[0].goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await pages[0].bringToFront?.();
      const status = publicStatus(record);
      onStatus(status);
      return status;
    } catch (error) {
      return { ok: false, error: { code: error.code || "PROXY_BROWSER_LAUNCH_FAILED", message: error.message || "The proxied browser could not be launched.", retryable: false } };
    }
  }

  function status(workspace = "", identityId = "") {
    let record = null;
    if (workspace && identityId) record = contexts.get(contextKey(workspace, { id: identityId }));
    else if (workspace) record = [...contexts.values()].find((item) => workspaceKey(item.workspace) === workspaceKey(workspace));
    else record = contexts.values().next().value;
    const activeContexts = workspace ? [...contexts.values()].filter((item) => workspaceKey(item.workspace) === workspaceKey(workspace)).length : contexts.size;
    return publicStatus(record || null, { activeContexts });
  }

  async function close(workspace = "", identityId = "") {
    const targets = workspace
      ? [...contexts.entries()].filter(([, record]) => workspaceKey(record.workspace) === workspaceKey(workspace) && (!identityId || record.identity?.id === String(identityId).toLowerCase()))
      : [...contexts.entries()];
    for (const [key, record] of targets) {
      if (!record) continue;
      contexts.delete(key);
      try { await record.context.close(); } catch { /* Browser may already be closed by the operator. */ }
    }
    return publicStatus(null, { closed: true });
  }

  return Object.freeze({ launch, status, close, findBrowser, profileDirectory, getAgentContext, getAgentPageTarget });
}

module.exports = { createProxyBrowserService, findInstalledProxyBrowser, browserCandidates, proxyConnectHost };
