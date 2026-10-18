"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID, X509Certificate } = require("node:crypto");
const net = require("node:net");
const forge = require("node-forge");
const { importBrowserStorage, exportBrowserStorage } = require("./browser-storage.js");

const CAPTURE_HEADER = "x-xekute-capture-context";
const fail = (code, message) => Object.assign(new Error(message), { code });

function matchesBinding(url, origin) {
  const actual = new URL(url), expected = new URL(origin);
  const prefix = expected.pathname.replace(/\/+$/, "");
  return actual.origin === expected.origin && (!prefix || actual.pathname === prefix || actual.pathname.startsWith(prefix + "/"));
}

function certificateVerifier(caPem) {
  const ca = forge.pki.createCaStore([caPem]);
  return (request, callback) => {
    if (request.verificationResult === "OK") return callback(-3);
    try {
      const chain = [], seen = new Set();
      let certificate = request.certificate;
      while (certificate?.data && !seen.has(certificate.data) && chain.length < 10) {
        seen.add(certificate.data);
        chain.push(forge.pki.certificateFromPem(certificate.data));
        certificate = certificate.issuerCert;
      }
      const leaf = new X509Certificate(request.certificate.data);
      const hostMatches = net.isIP(request.hostname) ? leaf.checkIP(request.hostname) : leaf.checkHost(request.hostname);
      if (!hostMatches || !forge.pki.verifyCertificateChain(ca, chain)) return callback(-2);
      callback(0);
    } catch { callback(-2); }
  };
}

function createNativeBrowserSessions({ electron, identityVault, proxyListener, requestPolicy = null, onWarning = () => {} }) {
  const records = new Map();
  const instanceId = randomUUID();
  let epoch = 0;

  function currentProxy(project) {
    const proxy = proxyListener?.getStatus();
    if (!proxy?.running || proxy.error || !proxy.port || path.resolve(proxy.assessmentPath || ".") !== path.resolve(project.workspace)) {
      throw fail("BROWSER_PROXY_UNAVAILABLE", "Start this project's capture listener before opening an assessment tab.");
    }
    return proxy;
  }

  async function get(project, purpose, identityId) {
    const key = JSON.stringify([project.id, purpose, identityId]);
    if (purpose === "assessment") currentProxy(project);
    if (records.has(key)) return records.get(key);
    let secret = { storageState: { cookies: [], origins: [] }, headerBindings: [] };
    let metadata = null;
    if (identityId) {
      metadata = identityVault?.metadataFor(project.workspace, identityId);
      if (!metadata) throw fail("IDENTITY_NOT_FOUND", "The selected browser identity does not exist.");
      const loaded = identityVault.readSecret(project.workspace, identityId);
      if (loaded.ok) secret = loaded.secret;
      else if (loaded.error?.code !== "IDENTITY_SECRET_NOT_FOUND") throw fail(loaded.error?.code || "IDENTITY_SECRET_UNAVAILABLE", loaded.error?.message || "Browser identity could not be read.");
    }
    const digest = createHash("sha256").update(key).digest("hex");
    const session = electron.session.fromPartition(`xekute-browser-${instanceId}-${epoch}-${digest}`, { cache: false });
    const record = { key, project, purpose, identityId, session, secret, origins: new Set((secret.storageState?.origins || []).map(item => item.origin)), token: null, blocked: false };
    try {
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      if (purpose === "assessment") {
        const proxy = currentProxy(project);
        record.proxyPort = proxy.port;
        const caPem = fs.readFileSync(proxy.caCertPath, "utf8");
        session.setCertificateVerifyProc(certificateVerifier(caPem));
        const hostname = ["0.0.0.0", "::"].includes(proxy.host) ? "127.0.0.1" : proxy.host;
        const proxyHost = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
        await session.setProxy({ mode: "fixed_servers", proxyRules: `http://${proxyHost}:${proxy.port}`, proxyBypassRules: "<-loopback>" });
        record.token = randomUUID();
        const registered = proxyListener.registerCaptureContext(record.token, { id: identityId || "anonymous", label: metadata?.name || "Anonymous", role: metadata?.role || "anonymous" });
        if (!registered.ok) throw fail(registered.code || "BROWSER_CAPTURE_UNAVAILABLE", "Browser capture attribution could not be registered.");
      } else await session.setProxy({ mode: "direct" });

      const names = new Set((secret.headerBindings || []).flatMap(binding => Object.keys(binding.headers).map(name => name.toLowerCase())));
      session.webRequest.onBeforeRequest((details, callback) => {
        if (record.blocked || !requestPolicy || !["mainFrame", "subFrame"].includes(details.resourceType)) return callback({ cancel: record.blocked });
        Promise.resolve(requestPolicy({ purpose, url: details.url, resourceType: details.resourceType, webContentsId: details.webContentsId }))
          .then(block => callback({ cancel: record.blocked || Boolean(block) }), () => callback({ cancel: true }));
      });
      session.webRequest.onBeforeSendHeaders((details, callback) => {
        if (purpose === "assessment") {
          try { if (currentProxy(project).port !== record.proxyPort) return callback({ cancel: true }); }
          catch { return callback({ cancel: true }); }
        }
        const headers = { ...details.requestHeaders };
        for (const name of Object.keys(headers)) if (names.has(name.toLowerCase()) || name.toLowerCase() === CAPTURE_HEADER) delete headers[name];
        if (purpose === "assessment") {
          for (const binding of secret.headerBindings || []) {
            if (matchesBinding(details.url, binding.origin)) Object.assign(headers, binding.headers);
          }
          headers[CAPTURE_HEADER] = record.token;
        }
        callback({ cancel: record.blocked, requestHeaders: headers });
      });
      await importBrowserStorage({ WebContentsView: electron.WebContentsView, session }, secret.storageState || { cookies: [], origins: [] });
      records.set(key, record);
      return record;
    } catch (error) {
      await dispose(record);
      throw error;
    }
  }

  async function persist(record) {
    if (record.purpose !== "assessment" || !record.identityId) return;
    try {
      const storageState = await exportBrowserStorage({ WebContentsView: electron.WebContentsView, session: record.session }, record.origins);
      const result = await identityVault.saveSecretAsync(record.project.workspace, record.identityId, { ...record.secret, storageState });
      if (!result.ok) throw fail(result.error?.code || "BROWSER_IDENTITY_SAVE_FAILED", result.error?.message || "Browser identity could not be saved.");
      record.secret = { ...record.secret, storageState };
    } catch (error) {
      onWarning({ code: error.code || "BROWSER_IDENTITY_SAVE_FAILED", message: error.message, identityId: record.identityId });
      throw error;
    }
  }

  async function dispose(record) {
    record.blocked = true;
    if (record.token) proxyListener.unregisterCaptureContext(record.token);
    record.session.webRequest.onBeforeSendHeaders(null);
    // Keep the closed partition blocked if a worker attempts a later request.
    record.session.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
    record.session.setCertificateVerifyProc(null);
    record.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const errors = [];
    for (const cleanup of [() => record.session.closeAllConnections(), () => record.session.clearStorageData(), () => record.session.clearCache()]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Browser partition cleanup failed.");
  }

  async function closeAll() {
    const errors = [];
    for (const record of records.values()) {
      try { await persist(record); } catch (error) { errors.push(error); }
      try { await dispose(record); } catch (error) { errors.push(error); }
    }
    records.clear(); epoch++;
    if (errors.length) throw new AggregateError(errors, "Browser session cleanup completed with persistence errors.");
  }

  async function closeIdentity(identityId, { persist: save = false } = {}) {
    for (const [key, record] of [...records]) {
      if (record.identityId !== identityId) continue;
      try { if (save) await persist(record); }
      finally { try { await dispose(record); } finally { records.delete(key); } }
    }
  }
  return Object.freeze({ get, persist, closeAll, closeIdentity, count: () => records.size });
}

module.exports = { createNativeBrowserSessions, certificateVerifier, matchesBinding };
