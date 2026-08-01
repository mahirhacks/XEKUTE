const { Proxy } = require("http-mitm-proxy");
const { parseRawHttpRequest, urlMatchesTarget } = require("./http-workbench");
const {
  decodeHttpBody,
  decodeHttpRequestBody,
  getContentEncoding,
  headersWithDecodedBodyLength,
} = require("./http-body-decoder");

const MAX_CAPTURE_BYTES = 1_000_000;
const INTERCEPT_TIMEOUT_MS = 60000;

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

function appendBounded(chunks, chunk, state, key) {
  const value = Buffer.from(chunk);
  const previousSize = state[key];
  const remaining = Math.max(0, MAX_CAPTURE_BYTES - Math.min(previousSize, MAX_CAPTURE_BYTES));
  if (remaining > 0) chunks.push(value.subarray(0, remaining));
  state[key] = previousSize + value.length;
}

function createProxyListenerService({ fs, path, assessmentWorkspace, getCaDirectory, sendEvent = () => {} } = {}) {
  let proxy = null;
  let root = "";
  let settings = null;
  let configuredTargets = null;
  let status = { running: false };
  const pending = new Map();
  const records = new Map();

  function emitStatus(extra = {}) {
    status = { ...status, ...extra };
    sendEvent("proxy:status", status);
  }

  function emitCapture(payload) {
    sendEvent("proxy:capture", payload);
  }

  function scopeTargets() {
    if (Array.isArray(configuredTargets)) return configuredTargets;
    try {
      const file = path.join(root, "scope", "in-scope.json");
      return JSON.parse(fs.readFileSync(file, "utf8")).targets || [];
    } catch {
      return [];
    }
  }

  function shouldCapture(ctx) {
    if (!settings?.interception?.onlyInScope) return true;
    try {
      const url = requestUrl(ctx);
      return scopeTargets().some((target) => urlMatchesTarget(url, target));
    } catch {
      return false;
    }
  }

  async function stop() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      try { entry.callback(); } catch { /* ignore */ }
    }
    pending.clear();
    records.clear();
    if (proxy) {
      try { proxy.close(); } catch { /* ignore */ }
      proxy = null;
    }
    emitStatus({ running: false, host: "", port: null });
    return { ok: true, running: false };
  }

  function attachHandlers(instance) {
    instance.onError((ctx, error, kind) => {
      emitStatus({ error: `${kind || "Proxy error"}: ${error?.message || error}` });
      if (ctx?.uuid) emitCapture({ id: ctx.uuid, phase: "error", error: error?.message || String(error) });
    });

    instance.onRequest((ctx, callback) => {
      let url;
      try { url = requestUrl(ctx); } catch { callback(); return; }
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
      });
    });

    instance.onResponse((ctx, callback) => {
      const record = records.get(ctx.uuid);
      if (record) emitCapture({ id: ctx.uuid, phase: "response-headers", request: record.request, response: rawResponse(ctx), url: record.url });
      callback();
    });

    instance.onResponseData((ctx, chunk, callback) => {
      const record = records.get(ctx.uuid);
      if (record) appendBounded(record.responseChunks, chunk, record, "responseBytes");
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
        const trafficAllowed = settings.authority?.superMode === "full" || settings.authority?.permissions?.trafficCapture !== false;
        const logged = trafficAllowed ? assessmentWorkspace.appendTrafficRecord(root, {
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
        }) : { ok: true, disabled: true };
        emitCapture({ id: record.id, phase: "response", request: record.request, response: record.response, url: record.url, logged });
        records.delete(ctx.uuid);
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
    const instance = new Proxy();
    attachHandlers(instance);

    return new Promise((resolve) => {
      instance.listen({ host, port, sslCaDir, keepAlive: true, timeout: 30000 }, (error) => {
        if (error) {
          try { instance.close(); } catch { /* ignore */ }
          emitStatus({ running: false, error: error.message || String(error) });
          resolve({ error: error.message || String(error), code: "PROXY_START_FAILED" });
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
        emitStatus({ running: true, host, port: actualPort, caDirectory: sslCaDir, caCertPath, targetCount, onlyInScope, warning, error: "" });
        resolve({ ok: true, running: true, host, port: actualPort, caDirectory: sslCaDir, caCertPath, targetCount, onlyInScope, warning });
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
    } else {
      const read = assessmentWorkspace.readSettings(assessmentPath);
      if (read.error) { await stop(); return read; }
      root = read.root;
      settings = read.settings;
    }
    configuredTargets = Array.isArray(overrides?.targets) ? overrides.targets : null;
    if (settings.authority?.superMode !== "full" && settings.authority?.permissions?.proxyInterception === false) { await stop(); return { ok: true, running: false, authorityDisabled: true }; }
    if (!settings.listener?.enabled) { await stop(); return { ok: true, running: false }; }
    const host = String(settings.listener.bindAddress || "127.0.0.1");
    const port = Number(settings.listener.port);
    const caDirectory = typeof getCaDirectory === "function" ? getCaDirectory(root) : path.join(root, ".pointer-ca");
    if (proxy && status.running && status.host === host && status.port === port && status.caDirectory === caDirectory) {
      emitStatus({ settingsUpdated: true });
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
      if (name.toLowerCase() === "x-pointer-scheme") delete captureHeaders[name];
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

  return { configure, start, stop, forward, drop, getStatus };
}

module.exports = {
  createProxyListenerService,
  rawRequest,
  rawResponse,
  requestUrl,
};
