const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const { createJavascriptArtifactStore } = require("../src/domain/assessment/javascript-artifact-store");
const { createProxyListenerService, isConnectionProxyError, CAPTURE_CONTEXT_HEADER } = require("../src/interceptor/proxy-listener.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function listenerSettings(overrides = {}) {
  return {
    listener: { enabled: true, bindAddress: "127.0.0.1", port: 0, ...(overrides.listener || {}) },
    interception: { enabled: true, interceptRequests: true, onlyInScope: true, ...(overrides.interception || {}) },
    logging: { logRawTraffic: true },
  };
}

function configureListener(service, root, targetValue, settingsOverrides = {}) {
  return service.configure(root, {
    settings: listenerSettings(settingsOverrides),
    targets: [{ id: "t1", assetType: "url", value: targetValue }],
  });
}

test("client TLS disconnects are connection-local and do not poison a running listener", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-client-error-"));
  let reportError;
  let listenOptions;
  const instance = {
    httpPort: 43123,
    onError(handler) { reportError = handler; },
    onRequest() {},
    onRequestData() {},
    onRequestEnd() {},
    onResponse() {},
    onResponseData() {},
    onResponseEnd() {},
  };
  const service = createProxyListenerService({
    fs,
    path,
    assessmentWorkspace: {},
    proxyAdapter: {
      create: () => instance,
      listen: async (options) => { listenOptions = options; return { error: "" }; },
      close() {},
    },
  });

  try {
    const started = await service.configure(parent, {
      settings: {
        listener: { enabled: true, bindAddress: "127.0.0.1", port: 43123 },
        interception: { enabled: false, onlyInScope: false },
      },
      targets: [],
    });
    assert.equal(started.running, true);
    assert.equal(listenOptions.timeout, 0);
    assert.equal(listenOptions.keepAlive, true);

    reportError(null, new Error("SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN"), "HTTPS_CLIENT_ERROR");
    assert.equal(service.getStatus().running, true);
    assert.equal(service.getStatus().error, "");

    reportError(null, new Error("listener failed"), "PROXY_ERROR");
    assert.match(service.getStatus().error, /listener failed/);
    assert.equal(service.clearError().error, "");
  } finally {
    await service.stop();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("proxy client error classification covers browser-close TLS failures", () => {
  assert.equal(isConnectionProxyError(null, new Error("SSLV3_ALERT_CERTIFICATE_UNKNOWN"), "HTTPS_CLIENT_ERROR"), true);
  assert.equal(isConnectionProxyError(null, new Error("listener failed"), "PROXY_ERROR"), false);
});

test("proxy listener pauses, forwards, captures, and logs an in-scope HTTP exchange", { timeout: 15000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-proxy-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });

  const targetServer = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(`proxied:${request.url}`);
  });
  const targetPort = await listen(targetServer);
  const targetUrl = `http://127.0.0.1:${targetPort}/hello?source=proxy`;

  const events = [];
  const centralCaDirectory = path.join(parent, "pointer-user-data", "certificates", "proxy-ca");
  let resolveIntercept;
  let resolveResponse;
  const intercepted = new Promise((resolve) => { resolveIntercept = resolve; });
  const capturedResponse = new Promise((resolve) => { resolveResponse = resolve; });
  const service = createProxyListenerService({
    fs,
    path,
    assessmentWorkspace: assessment,
    getCaDirectory: () => centralCaDirectory,
    sendEvent(channel, payload) {
      events.push({ channel, payload });
      if (channel === "proxy:capture" && payload.phase === "request") resolveIntercept(payload);
      if (channel === "proxy:capture" && payload.phase === "response") resolveResponse(payload);
    },
  });

  try {
    const started = await configureListener(service, root, `http://127.0.0.1:${targetPort}`);
    assert.equal(started.ok, true);
    assert.equal(started.running, true);
    assert.equal(started.caDirectory, centralCaDirectory);
    assert.equal(started.caCertPath, path.join(centralCaDirectory, "certs", "ca.pem"));
    assert.ok(fs.existsSync(started.caCertPath));
    assert.equal(fs.existsSync(path.join(root, ".pointer-ca")), false);

    const browserRequest = new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        method: "GET",
        path: targetUrl,
        headers: { host: `127.0.0.1:${targetPort}` },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject);
      request.end();
    });

    const capture = await intercepted;
    assert.equal(capture.paused, true);
    assert.match(capture.request, /GET \/hello\?source=proxy HTTP\/1\.1/);
    const forwarded = service.forward(capture.id, capture.request.replace("source=proxy", "source=edited"));
    assert.equal(forwarded.ok, true);

    const browserResponse = await browserRequest;
    assert.equal(browserResponse.status, 200);
    assert.equal(browserResponse.body, "proxied:/hello?source=edited");
    const finalCapture = await capturedResponse;
    assert.match(finalCapture.response, /proxied:\/hello\?source=edited/);
    assert.equal(finalCapture.history.requestId, finalCapture.id);
    assert.equal(finalCapture.history.request, undefined);
    assert.equal(finalCapture.history.method, "GET");

    const traffic = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(traffic.at(-1).recordType, "http-exchange");
    assert.equal(traffic.at(-1).tool, "interceptor");
    assert.ok(events.some((event) => event.channel === "proxy:status" && event.payload.running));
  } finally {
    await service.stop();
    await close(targetServer);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("intercepted POST bodies survive Forward and are recorded after the request stream completes", { timeout: 15000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-proxy-post-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });
  let upstreamBody = "";
  let upstreamHeader = "";
  const targetServer = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      upstreamBody = Buffer.concat(chunks).toString("utf8");
      upstreamHeader = request.headers["x-edited"] || "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ received: upstreamBody }));
    });
  });
  const targetPort = await listen(targetServer);
  const targetUrl = `http://127.0.0.1:${targetPort}/submit`;

  let resolveIntercept;
  let resolveResponse;
  const intercepted = new Promise((resolve) => { resolveIntercept = resolve; });
  const capturedResponse = new Promise((resolve) => { resolveResponse = resolve; });
  const service = createProxyListenerService({
    fs, path, assessmentWorkspace: assessment,
    sendEvent(channel, payload) {
      if (channel === "proxy:capture" && payload.phase === "request") resolveIntercept(payload);
      if (channel === "proxy:capture" && payload.phase === "response") resolveResponse(payload);
    },
  });

  try {
    const started = await configureListener(service, root, `http://127.0.0.1:${targetPort}`);
    const body = JSON.stringify({ email: "tester@example.com", role: "member" });
    const browserRequest = new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: started.port, method: "POST", path: targetUrl, headers: { host: `127.0.0.1:${targetPort}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end(body);
    });
    const capture = await intercepted;
    assert.doesNotMatch(capture.request, /tester@example\.com/);
    const editedHeaders = capture.request.replace("\r\n\r\n", "\r\nX-Edited: yes\r\n\r\n");
    assert.equal(service.forward(capture.id, editedHeaders).ok, true);
    assert.equal(await browserRequest, 200);
    const finalCapture = await capturedResponse;
    assert.equal(upstreamBody, body);
    assert.equal(upstreamHeader, "yes");
    assert.match(finalCapture.request, /tester@example\.com/);
    assert.match(finalCapture.request, /x-edited: yes/i);
    const traffic = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter((record) => record.recordType === "http-exchange");
    assert.match(traffic.at(-1).request, /tester@example\.com/);
    assert.equal(traffic.at(-1).requestBodyBytes, Buffer.byteLength(body));
    assert.equal(traffic.at(-1).requestBodyTruncated, false);
  } finally {
    await service.stop();
    await close(targetServer);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("proxy capture strips the private identity header and passively indexes in-scope JavaScript", { timeout: 15000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-javascript-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  const javascriptArtifacts = createJavascriptArtifactStore({ fs, path, crypto });
  assessment.repair(root, { createRoot: true });
  let leakedCaptureHeader = "";
  const targetServer = http.createServer((request, response) => {
    leakedCaptureHeader = String(request.headers[CAPTURE_CONTEXT_HEADER] || "");
    response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    response.end('import "./chunk.js"; fetch("/api/orders?token=secret");');
  });
  const targetPort = await listen(targetServer);
  const targetUrl = `http://127.0.0.1:${targetPort}/assets/app.js`;
  const service = createProxyListenerService({ fs, path, assessmentWorkspace: assessment, javascriptArtifacts });
  const captureToken = "abcdef0123456789abcdef0123456789";

  try {
    const started = await configureListener(service, root, `http://127.0.0.1:${targetPort}`, {
      interception: { enabled: false, onlyInScope: true },
    });
    assert.equal(service.registerCaptureContext(captureToken, { id: "account-a", label: "Account A", role: "user" }).ok, true);
    const response = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: started.port, method: "GET", path: targetUrl, headers: { host: `127.0.0.1:${targetPort}`, [CAPTURE_CONTEXT_HEADER]: captureToken } }, (incoming) => {
        incoming.resume();
        incoming.on("end", () => resolve(incoming.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(response, 200);
    await service.stop();
    assert.equal(leakedCaptureHeader, "");
    const manifest = javascriptArtifacts.readManifest(root);
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].urls[0].captureIdentity.id, "account-a");
    assert.deepEqual(manifest.artifacts[0].imports, [`http://127.0.0.1:${targetPort}/assets/chunk.js`]);
    assert.equal(manifest.artifacts[0].endpoints[0].url, `http://127.0.0.1:${targetPort}/api/orders?token=%5BREDACTED%5D`);
    const traffic = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(traffic.at(-1).captureIdentity.id, "account-a");
  } finally {
    await service.stop();
    await close(targetServer);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("passive browsing capture events omit bodies and include a history summary", { timeout: 15000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-proxy-history-slim-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });
  const targetServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<html>${"x".repeat(8000)}</html>`);
  });
  const targetPort = await listen(targetServer);
  const targetUrl = `http://127.0.0.1:${targetPort}/home`;
  const captures = [];
  let resolveResponse;
  const capturedResponse = new Promise((resolve) => { resolveResponse = resolve; });
  const service = createProxyListenerService({
    fs,
    path,
    assessmentWorkspace: assessment,
    sendEvent(channel, payload) {
      if (channel !== "proxy:capture") return;
      captures.push(payload);
      if (payload.phase === "response") resolveResponse(payload);
    },
  });

  try {
    const started = await configureListener(service, root, `http://127.0.0.1:${targetPort}`, {
      interception: { enabled: false, interceptRequests: false, onlyInScope: true },
    });
    await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        method: "GET",
        path: targetUrl,
        headers: { host: `127.0.0.1:${targetPort}` },
      }, (incoming) => {
        incoming.resume();
        incoming.on("end", resolve);
      });
      request.on("error", reject);
      request.end();
    });
    const finalCapture = await capturedResponse;
    assert.equal(finalCapture.request, undefined);
    assert.equal(finalCapture.response, undefined);
    assert.equal(finalCapture.logged.record, undefined);
    assert.equal(finalCapture.history.method, "GET");
    assert.equal(finalCapture.history.mime, "HTML");
    assert.ok(finalCapture.history.responseLength > 8000);
    assert.equal(captures.some((event) => event.request || event.response), false);
  } finally {
    await service.stop();
    await close(targetServer);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
