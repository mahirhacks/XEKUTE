const { parseRawHttpRequest, urlMatchesTarget } = require("./http-workbench");
const { summarizeTrafficRecord } = require("../domain/assessment/assessment-workspace");
const {
  decodeHttpBody,
  decodeHttpBodyBuffer,
  decodeHttpRequestBody,
  getContentEncoding,
  headersWithDecodedBodyLength,
} = require("./http-body-decoder");

const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_JAVASCRIPT_ARTIFACT_BYTES = 20 * 1024 * 1024;
const INTERCEPT_TIMEOUT_MS = 60000;
const CAPTURE_CONTEXT_HEADER = "x-xekute-capture-context";

function headerLines(headers = {}) {
  return Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
}

function requestUrl(ctx) {
  const request = ctx.clientToProxyRequest;
  if (/^https?:\/\//i.test(request.url || "")) return new URL(request.url);
  const host = request.headers.host;
  return new URL(request.url || "/", `${ctx.isSSL ? "https" : "http"}://${host}`);
}

function rawRequest(ctx, body = "") {
  const request = ctx.clientToProxyRequest;
  const target = /^https?:\/\//i.test(request.url || "")
    ? requestUrl(ctx).pathname + requestUrl(ctx).search
    : request.url || "/";
  return rawRequestFromParts({ method: request.method, target, httpVersion: request.httpVersion, headers: request.headers }, body);
}

function rawRequestFromParts({ method = "GET", target = "/", httpVersion = "1.1", headers = {} } = {}, body = "") {
  const displayHeaders = headersWithDecodedBodyLength(headers, body);
  return [`${method} ${target} HTTP/${httpVersion}`, ...headerLines(displayHeaders), "", body].join("\r\n");
}

function rawResponse(ctx, body = "") {
  const response = ctx.serverToProxyResponse;
  if (!response) return "";
  const displayHeaders = headersWithDecodedBodyLength(response.headers, body);
  return [`HTTP/${response.httpVersion || "1.1"} ${response.statusCode || 0} ${response.statusMessage || ""}`.trimEnd(), ...headerLines(displayHeaders), "", body].join("\r\n");
}

function appendBounded(chunks, chunk, state, key, limit = MAX_CAPTURE_BYTES) {
  const value = Buffer.from(chunk);
  const previousSize = state[key];
  const remaining = Math.max(0, limit - Math.min(previousSize, limit));
  if (remaining > 0) chunks.push(value.subarray(0, remaining));
  state[key] = previousSize + value.length;
}

function isConnectionProxyError(ctx, error, kind) {
  if (ctx) return true;
  const errorKind = String(kind || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (/(?:^|_)(?:HTTP|HTTPS|TLS|WEBSOCKET)?_?CLIENT_ERROR$/.test(errorKind)) return true;
  const message = String(error?.message || error || "");
  return /ECONNRESET|EPIPE|socket hang up|client network socket disconnected|SSLV3_ALERT|TLSV1_ALERT/i.test(message);
}

function defaultProxyAdapter() {
  const { Proxy } = require("http-mitm-proxy");
  let instance = null;
  return {
    create() {
      instance = new Proxy();
      return instance;
    },
    listen(options) {
      return new Promise((resolve) => {
        instance.listen(options, (error) => resolve({ error: error ? error.message || String(error) : "" }));
      });
    },
    close() {
      if (!instance) return;
      try { instance.close(); } catch { /* ignore */ }
      instance = null;
    },
  };
}

function createProxyListenerService({ fs, path, assessmentWorkspace, javascriptArtifacts = null, getCaDirectory, sendEvent = () => {}, proxyAdapter = null } = {}) {
  const adapter = proxyAdapter || defaultProxyAdapter();
  let proxy = null;
  let root = "";
  let settings = null;
  let configuredTargets = null;
  let status = { running: false };
  const pending = new Map();
  const records = new Map();
  const captureContexts = new Map();
  const artifactJobs = new Set();

  function emitStatus(extra = {}) {
    status = { ...status, ...extra };
    sendEvent("proxy:status", status);
  }

  function emitCapture(payload) {
    const intercepting = Boolean(payload.paused) || Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
    const next = { ...payload };
    if (payload.logged?.record) next.history = summarizeTrafficRecord(payload.logged.record);
    if (!intercepting) {
      delete next.request;
      delete next.response;
      if (payload.logged) next.logged = { timestamp: payload.logged.timestamp, error: payload.logged.error };
    }
    sendEvent("proxy:capture", next);
  }

  function scopeTargets() {
    return Array.isArray(configuredTargets) ? configuredTargets : [];
  }

  function isInScope(ctx) {
    try {
      const url = requestUrl(ctx);
      return scopeTargets().some((target) => urlMatchesTarget(url, target));
    } catch {
      return false;
    }
  }

  function shouldCapture(ctx) {
    if (!settings?.interception?.onlyInScope) return true;
    return isInScope(ctx);
  }

  function removeInternalCaptureHeader(headers = {}) {
    let token = "";
    for (const name of Object.keys(headers || {})) {
      if (name.toLowerCase() !== CAPTURE_CONTEXT_HEADER) continue;
      token = String(headers[name] || "");
      delete headers[name];
    }
    return token;
  }

  function registerCaptureContext(token, metadata = {}) {
    const key = String(token || "").trim();
    if (!/^[a-f0-9-]{16,128}$/i.test(key)) return { ok: false, code: "CAPTURE_CONTEXT_INVALID", error: "Capture context token is invalid." };
    if (captureContexts.size >= 256 && !captureContexts.has(key)) captureContexts.delete(captureContexts.keys().next().value);
    captureContexts.set(key, {
      id: String(metadata.id || metadata.identityId || "anonymous").slice(0, 120),
      label: String(metadata.label || metadata.displayName || "Anonymous").slice(0, 160),
      role: String(metadata.role || "anonymous").slice(0, 120),
    });
    return { ok: true };
  }

  function unregisterCaptureContext(token) {
    captureContexts.delete(String(token || ""));
    return { ok: true };
  }

  async function stop() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      try { entry.callback(); } catch { /* ignore */ }
    }
    pending.clear();
    records.clear();
    if (proxy) {
      try { adapter.close(); } catch { /* ignore */ }
      proxy = null;
    }
    captureContexts.clear();
    await Promise.all([...artifactJobs].map((job) => job.catch(() => {})));
    artifactJobs.clear();
    try { await javascriptArtifacts?.flush?.(root); } catch { /* Artifact persistence failures do not block proxy shutdown. */ }
    emitStatus({ running: false, host: "", port: null, assessmentPath: "", warning: "", error: "" });
    return { ok: true, running: false };
  }

  function attachHandlers(instance) {
    instance.onError((ctx, error, kind) => {
      const message = error?.message || String(error);
      if (isConnectionProxyError(ctx, error, kind)) {
        if (ctx?.uuid) emitCapture({ id: ctx.uuid, phase: "error", error: message, transient: true });
        return;
      }
      emitStatus({ error: `${kind || "Proxy error"}: ${message}` });
      if (ctx?.uuid) emitCapture({ id: ctx.uuid, phase: "error", error: message });
    });

    instance.onRequest((ctx, callback) => {
      let url;
      try { url = requestUrl(ctx); } catch { callback(); return; }
      const requestHeaders = ctx.clientToProxyRequest.headers || {};
      const proxyHeaders = ctx.proxyToServerRequestOptions?.headers || {};
      const captureToken = removeInternalCaptureHeader(requestHeaders) || removeInternalCaptureHeader(proxyHeaders);
      removeInternalCaptureHeader(proxyHeaders);
      if (!shouldCapture(ctx)) { callback(); return; }
      const record = {
        id: ctx.uuid,
        ctx,
        url: url.toString(),
        requestChunks: [],
        responseChunks: [],
        requestBytes: 0,
        responseBytes: 0,
        request: rawRequest(ctx),
        response: "",
        startedAt: Date.now(),
        replacementBody: null,
        replacementSent: false,
        effectiveRequest: null,
        captureIdentity: captureContexts.get(captureToken) || null,
        inScope: isInScope(ctx),
        javascriptChunks: [],
        javascriptBytes: 0,
        captureJavascript: false,
        responseContentType: "",
      };
      records.set(ctx.uuid, record);
      const paused = Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
      emitCapture({ id: ctx.uuid, phase: "request", request: record.request, response: "", url: record.url, paused });
      if (!paused) { callback(); return; }

      const timer = setTimeout(() => {
        const entry = pending.get(ctx.uuid);
        if (!entry) return;
        pending.delete(ctx.uuid);
        emitCapture({ id: ctx.uuid, phase: "status", status: "Auto-forwarded after 60 seconds" });
        entry.callback();
      }, INTERCEPT_TIMEOUT_MS);
      pending.set(ctx.uuid, { ctx, callback, timer, record });
    });

    instance.onRequestData((ctx, chunk, callback) => {
      const record = records.get(ctx.uuid);
      if (!record) { callback(null, chunk); return; }
      if (record.replacementBody != null) {
        if (record.replacementSent) { callback(null, Buffer.alloc(0)); return; }
        record.replacementSent = true;
        record.requestBytes = record.replacementBody.length;
        record.requestChunks = [record.replacementBody.subarray(0, MAX_CAPTURE_BYTES)];
        callback(null, record.replacementBody);
        return;
      }
      appendBounded(record.requestChunks, chunk, record, "requestBytes");
      callback(null, chunk);
    });

    instance.onRequestEnd((ctx, callback) => {
      const record = records.get(ctx.uuid);
      if (!record) { callback(); return; }

      if (record.replacementBody != null && !record.replacementSent) {
        record.replacementSent = true;
        record.requestBytes = record.replacementBody.length;
        record.requestChunks = [record.replacementBody.subarray(0, MAX_CAPTURE_BYTES)];
        if (record.replacementBody.length) ctx.proxyToServerRequest.write(record.replacementBody);
      }

      const rawBuffer = record.replacementBody != null
        ? record.replacementBody
        : record.requestChunks.length > 0
          ? Buffer.concat(record.requestChunks)
          : Buffer.alloc(0);
      const captureHeaders = record.effectiveRequest?.headers || ctx.clientToProxyRequest.headers;

      decodeHttpRequestBody(rawBuffer, captureHeaders).then((bodyText) => {
        record.request = record.effectiveRequest
          ? rawRequestFromParts(record.effectiveRequest, bodyText)
          : rawRequest(ctx, bodyText);
        emitCapture({ id: ctx.uuid, phase: "request-complete", request: record.request, url: record.url, paused: false });
        callback();
      }).catch((error) => {
        emitCapture({ id: ctx.uuid, phase: "warning", url: record.url, error: `Request body decoding failed: ${error.message}` });
        callback();
      });
    });

    instance.onResponse((ctx, callback) => {
      const record = records.get(ctx.uuid);
      if (record) {
        const headers = ctx.serverToProxyResponse?.headers || {};
        record.responseContentType = String(Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] || "");
        const statusCode = Number(ctx.serverToProxyResponse?.statusCode) || 0;
        record.captureJavascript = Boolean(record.inScope && statusCode >= 200 && statusCode < 400 && javascriptArtifacts?.isJavaScriptResponse?.({ url: record.url, headers, contentType: record.responseContentType }));
        emitCapture({ id: ctx.uuid, phase: "response-headers", request: record.request, response: rawResponse(ctx), url: record.url });
      }
      callback();
    });

    instance.onResponseData((ctx, chunk, callback) => {
      const record = records.get(ctx.uuid);
      if (record) {
        appendBounded(record.responseChunks, chunk, record, "responseBytes");
        if (record.captureJavascript) appendBounded(record.javascriptChunks, chunk, record, "javascriptBytes", MAX_JAVASCRIPT_ARTIFACT_BYTES + 1);
      }
      callback(null, chunk);
    });

    instance.onResponseEnd((ctx, callback) => {
      const record = records.get(ctx.uuid);
      if (!record) { callback(); return; }

      const rawBuffer = record.responseChunks.length > 0
        ? Buffer.concat(record.responseChunks)
        : Buffer.alloc(0);
      const encoding = getContentEncoding(ctx.serverToProxyResponse?.headers || {});

      decodeHttpBody(rawBuffer, encoding).then((bodyText) => {
        record.response = rawResponse(ctx, bodyText);
        const logged = assessmentWorkspace.appendTrafficRecord(root, {
          tool: "interceptor",
          requestId: record.id,
          url: record.url,
          method: ctx.clientToProxyRequest.method,
          statusCode: ctx.serverToProxyResponse?.statusCode || null,
          durationMs: Date.now() - record.startedAt,
          request: record.request,
          response: record.response,
          requestContentType: String(Object.entries(record.effectiveRequest?.headers || ctx.clientToProxyRequest.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] || ""),
          requestBodyBytes: record.requestBytes,
          requestBodyCapturedBytes: Math.min(record.requestBytes, MAX_CAPTURE_BYTES),
          requestBodyTruncated: record.requestBytes > MAX_CAPTURE_BYTES,
          truncated: record.requestBytes > MAX_CAPTURE_BYTES || record.responseBytes > MAX_CAPTURE_BYTES,
          captureIdentity: record.captureIdentity || undefined,
        });
        emitCapture({ id: record.id, phase: "response", request: record.request, response: record.response, url: record.url, logged });
        if (record.captureJavascript && record.javascriptBytes <= MAX_JAVASCRIPT_ARTIFACT_BYTES && record.javascriptChunks.length) {
          const compressed = Buffer.concat(record.javascriptChunks);
          const artifactJob = decodeHttpBodyBuffer(compressed, encoding, MAX_JAVASCRIPT_ARTIFACT_BYTES).then((content) => {
            if (encoding && content === compressed) return null;
            return javascriptArtifacts.capture(root, {
              url: record.url,
              content,
              headers: ctx.serverToProxyResponse?.headers || {},
              contentType: record.responseContentType,
              statusCode: ctx.serverToProxyResponse?.statusCode || null,
              source: "passive-proxy",
              evidenceId: record.id,
              captureIdentity: record.captureIdentity,
            });
          }).then((artifact) => {
            if (artifact?.ok) emitCapture({ id: record.id, phase: "javascript-artifact", url: record.url, artifactId: artifact.artifactId, duplicate: artifact.duplicate });
          }).catch((error) => emitCapture({ id: record.id, phase: "warning", url: record.url, error: `JavaScript artifact capture failed: ${error.message}` }));
          artifactJobs.add(artifactJob);
          artifactJob.finally(() => artifactJobs.delete(artifactJob)).catch(() => {});
        }
        records.delete(ctx.uuid);
        callback();
      }).catch((error) => {
        records.delete(ctx.uuid);
        emitCapture({ id: record.id, phase: "warning", url: record.url, error: `Response body decoding failed: ${error.message}` });
        callback();
      });
    });
  }

  async function start(assessmentRoot, nextSettings) {
    await stop();
    root = assessmentRoot;
    settings = nextSettings;
    const listener = settings.listener || {};
    const host = String(listener.bindAddress || "127.0.0.1");
    const port = Number(listener.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: "Proxy listener port must be between 1 and 65535", code: "INVALID_PORT" };
    const legacyCaDir = path.join(root, ".pointer-ca");
    const sslCaDir = typeof getCaDirectory === "function" ? getCaDirectory(root) : legacyCaDir;
    if (sslCaDir !== legacyCaDir && fs.existsSync(legacyCaDir) && !fs.existsSync(sslCaDir)) {
      fs.mkdirSync(path.dirname(sslCaDir), { recursive: true });
      fs.cpSync(legacyCaDir, sslCaDir, { recursive: true, errorOnExist: false });
    }
    fs.mkdirSync(sslCaDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(sslCaDir, 0o700); } catch { /* Windows ACLs are inherited from protected user data. */ }
    const instance = adapter.create();
    attachHandlers(instance);

    return new Promise((resolve) => {
      // Do not impose a fixed socket lifetime. Production applications use
      // streaming responses, WebSockets, and slow endpoints that legitimately
      // stay open beyond 30 seconds. Individual intercepted requests retain
      // their separate 60-second auto-forward deadline above.
      adapter.listen({ host, port, sslCaDir, keepAlive: true, timeout: 0 }).then(({ error }) => {
        if (error) {
          try { adapter.close(); } catch { /* ignore */ }
          emitStatus({ running: false, error });
          resolve({ error, code: "PROXY_START_FAILED" });
          return;
        }
        proxy = instance;
        const actualPort = instance.httpPort;
        const caCertPath = path.join(sslCaDir, "certs", "ca.pem");
        if (sslCaDir !== legacyCaDir && fs.existsSync(caCertPath) && fs.existsSync(legacyCaDir)) {
          try { fs.rmSync(legacyCaDir, { recursive: true, force: true }); } catch { /* Keep the verified legacy copy for manual recovery. */ }
        }
        const targetCount = scopeTargets().length;
        const onlyInScope = Boolean(settings.interception?.onlyInScope);
        const warning = onlyInScope && targetCount === 0 ? "Only in-scope capture is enabled, but In-Scope has no targets" : "";
        emitStatus({ running: true, host, port: actualPort, assessmentPath: root, caDirectory: sslCaDir, caCertPath, targetCount, onlyInScope, warning, error: "" });
        resolve({ ok: true, running: true, host, port: actualPort, assessmentPath: root, caDirectory: sslCaDir, caCertPath, targetCount, onlyInScope, warning });
      });
    });
  }

  async function configure(assessmentPath, overrides = {}) {
    if (!assessmentPath) { await stop(); return { ok: true, running: false }; }
    const suppliedSettings = overrides?.settings && typeof overrides.settings === "object" ? overrides.settings : null;
    if (suppliedSettings) {
      try {
        root = path.resolve(assessmentPath);
        if (!fs.statSync(root).isDirectory()) throw new Error("Project path is not a directory");
      } catch (error) {
        await stop();
        return { error: error.message, code: "PROJECT_NOT_FOUND" };
      }
      settings = suppliedSettings;
    } else return { error: "App-managed project runtime settings are required", code: "PROJECT_SETTINGS_REQUIRED" };
    configuredTargets = Array.isArray(overrides?.targets) ? overrides.targets : null;
    if (!settings.listener?.enabled) { await stop(); return { ok: true, running: false }; }
    const host = String(settings.listener.bindAddress || "127.0.0.1");
    const port = Number(settings.listener.port);
    const caDirectory = typeof getCaDirectory === "function" ? getCaDirectory(root) : path.join(root, ".pointer-ca");
    if (proxy && status.running && status.host === host && status.port === port && status.caDirectory === caDirectory) {
      emitStatus({ settingsUpdated: true, error: "" });
      return { ok: true, ...status };
    }
    return start(root, settings);
  }

  function forward(id, editedRequest) {
    const entry = pending.get(String(id || ""));
    if (!entry) return { error: "Intercepted request is no longer pending", code: "CAPTURE_NOT_PENDING" };
    const requestText = String(editedRequest || "");
    const parseInput = /\nx-pointer-scheme\s*:/i.test(`\n${requestText}`)
      ? requestText
      : requestText.replace(/\r?\n/, (newline) => `${newline}X-Pointer-Scheme: ${entry.ctx.isSSL ? "https" : "http"}${newline}`);
    const parsed = parseRawHttpRequest(parseInput);
    if (parsed.error) return parsed;
    const originalUrl = requestUrl(entry.ctx);
    if (parsed.url.origin !== originalUrl.origin) return { error: "Interceptor edits cannot change the destination origin", code: "ORIGIN_CHANGE_BLOCKED" };

    const captureHeaders = { ...parsed.headers };
    for (const name of Object.keys(captureHeaders)) {
      if (["x-pointer-scheme", CAPTURE_CONTEXT_HEADER].includes(name.toLowerCase())) delete captureHeaders[name];
    }
    const headers = { ...captureHeaders };
    for (const name of Object.keys(headers)) {
      if (["host", "proxy-connection", "connection", "transfer-encoding"].includes(name.toLowerCase())) delete headers[name];
    }
    const incomingHeaders = entry.ctx.clientToProxyRequest.headers || {};
    const originalLength = Number(Object.entries(incomingHeaders).find(([name]) => name.toLowerCase() === "content-length")?.[1]) || 0;
    const originalChunked = /chunked/i.test(String(Object.entries(incomingHeaders).find(([name]) => name.toLowerCase() === "transfer-encoding")?.[1] || ""));
    const preserveIncomingBody = !parsed.body && (originalLength > 0 || originalChunked);
    const body = Buffer.from(parsed.body || "", "utf8");
    if (!preserveIncomingBody) {
      if (body.length) headers["content-length"] = String(body.length);
      else delete headers["content-length"];
    }
    entry.ctx.proxyToServerRequestOptions.method = parsed.method;
    entry.ctx.proxyToServerRequestOptions.path = `${parsed.url.pathname}${parsed.url.search}`;
    entry.ctx.proxyToServerRequestOptions.headers = headers;
    entry.record.replacementBody = preserveIncomingBody ? null : body;
    entry.record.effectiveRequest = {
      method: parsed.method,
      target: `${parsed.url.pathname}${parsed.url.search}`,
      httpVersion: entry.ctx.clientToProxyRequest.httpVersion || "1.1",
      headers: captureHeaders,
    };
    entry.record.url = parsed.url.toString();
    entry.record.request = String(editedRequest);
    clearTimeout(entry.timer);
    pending.delete(String(id));
    entry.callback();
    return { ok: true, id: String(id) };
  }

  function drop(id) {
    const entry = pending.get(String(id || ""));
    if (!entry) return { error: "Intercepted request is no longer pending", code: "CAPTURE_NOT_PENDING" };
    clearTimeout(entry.timer);
    pending.delete(String(id));
    records.delete(String(id));
    try {
      entry.ctx.proxyToClientResponse.writeHead(403, { "content-type": "text/plain; charset=utf-8", connection: "close" });
      entry.ctx.proxyToClientResponse.end("Request dropped by XEKUTE Interceptor");
      entry.ctx.clientToProxyRequest.destroy();
    } catch { /* ignore */ }
    return { ok: true, id: String(id) };
  }

  function getStatus() {
    return { ...status, pending: pending.size };
  }

  function clearError() {
    if (status.error) emitStatus({ error: "" });
    return getStatus();
  }

  return { configure, start, stop, forward, drop, getStatus, clearError, registerCaptureContext, unregisterCaptureContext };
}

module.exports = {
  createProxyListenerService,
  rawRequest,
  rawResponse,
  requestUrl,
  isConnectionProxyError,
  CAPTURE_CONTEXT_HEADER,
};
