const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/bugbounty/assessment-workspace");
const { createProxyListenerService } = require("../src/bugbounty/proxy-listener");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

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

  const inScopePath = path.join(root, "scope", "in-scope.json");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets.push({ ...inScope.targetTemplate, value: `http://127.0.0.1:${targetPort}` });
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`);

  const settingsPath = path.join(root, "settings.config");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.listener.enabled = true;
  settings.listener.bindAddress = "127.0.0.1";
  settings.listener.port = 0;
  settings.interception.enabled = true;
  settings.interception.interceptRequests = true;
  settings.interception.onlyInScope = true;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

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
    const started = await service.configure(root);
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
  const inScopePath = path.join(root, "scope", "in-scope.json");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets.push({ ...inScope.targetTemplate, value: `http://127.0.0.1:${targetPort}` });
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`);
  const settingsPath = path.join(root, "settings.config");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.listener = { ...settings.listener, enabled: true, bindAddress: "127.0.0.1", port: 0 };
  settings.interception = { ...settings.interception, enabled: true, interceptRequests: true, onlyInScope: true };
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

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
    const started = await service.configure(root);
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
