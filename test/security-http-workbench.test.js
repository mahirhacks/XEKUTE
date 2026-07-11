const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/bugbounty/assessment-workspace");
const {
  buildIntruderRequests,
  createSecurityHttpWorkbench,
  parseRawHttpRequest,
  urlMatchesTarget,
} = require("../src/bugbounty/security-http-workbench");

function response(body = "ok", status = 200) {
  const headers = new Map([["content-type", "text/plain"], ["content-length", String(Buffer.byteLength(body))]]);
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { entries: () => headers.entries(), get: (name) => headers.get(String(name).toLowerCase()) || null },
    arrayBuffer: async () => Buffer.from(body),
  };
}

function configureAuthorizedScope(root) {
  const inScopePath = path.join(root, "scope", "in-scope.json");
  const configPath = path.join(root, "scope", "configurations.json");
  const settingsPath = path.join(root, "settings.config");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.authorization.confirmed = true;
  inScope.targets.push({ ...inScope.targetTemplate, id: "target-1", value: "https://authorized.example" });
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.authorizationGate.authorizationConfirmed = true;
  config.authorizationGate.rulesAccepted = true;
  config.authorizationGate.allowAutomatedScanning = true;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.authorization.confirmed = true;
  settings.authorizationGate.authorizationConfirmed = true;
  settings.authorizationGate.rulesAccepted = true;
  settings.authorizationGate.allowAutomatedScanning = true;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

test("raw HTTP parsing and scope matching are strict", () => {
  const parsed = parseRawHttpRequest("POST /api/items HTTP/1.1\nHost: authorized.example\nContent-Type: text/plain\n\nhello");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.url.toString(), "https://authorized.example/api/items");
  assert.equal(parsed.body, "hello");
  assert.equal(urlMatchesTarget(parsed.url, "https://authorized.example/api"), true);
  assert.equal(urlMatchesTarget(parsed.url, "https://other.example"), false);
  assert.equal(urlMatchesTarget(new URL("https://a.example.com/"), "*.example.com"), true);
});

test("Intruder builds capped sniper, pitchfork, and cluster payload requests", () => {
  const raw = "GET /?user=$user$&pin=$pin$ HTTP/1.1\nHost: authorized.example";
  const payloads = JSON.stringify({ user: ["alice", "bob"], pin: ["1", "2"] });
  const sniper = buildIntruderRequests(raw, payloads, "sniper", 25);
  assert.equal(sniper.ok, true);
  assert.equal(sniper.requests.length, 4);
  const pitchfork = buildIntruderRequests(raw, payloads, "pitchfork", 25);
  assert.match(pitchfork.requests[1], /user=bob&pin=2/);
  const cluster = buildIntruderRequests(raw, payloads, "cluster-bomb", 3);
  assert.equal(cluster.requests.length, 3);
});

test("workbench blocks unauthorized and out-of-scope traffic", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });
  let fetches = 0;
  const workbench = createSecurityHttpWorkbench({
    fs,
    path,
    assessmentWorkspace: assessment,
    fetchImpl: async () => { fetches += 1; return response(); },
  });

  const unauthorized = await workbench.run({ assessmentPath: root, rawRequest: "GET / HTTP/1.1\nHost: authorized.example", mode: "repeater" });
  assert.equal(unauthorized.code, "AUTHORIZATION_REQUIRED");
  configureAuthorizedScope(root);
  const outside = await workbench.run({ assessmentPath: root, rawRequest: "GET / HTTP/1.1\nHost: outside.example", mode: "repeater" });
  assert.equal(outside.code, "OUT_OF_SCOPE");
  assert.equal(fetches, 0);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("authorized workbench requests are returned and timestamped in Traffic Raw", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path, now: () => new Date(2026, 6, 11, 10, 23, 31, 19) });
  assessment.repair(root, { createRoot: true });
  configureAuthorizedScope(root);
  const workbench = createSecurityHttpWorkbench({ fs, path, assessmentWorkspace: assessment, fetchImpl: async () => response("hello") });
  const result = await workbench.run({ assessmentPath: root, rawRequest: "GET / HTTP/1.1\nHost: authorized.example", mode: "repeater" });
  assert.equal(result.ok, true);
  assert.match(result.response, /HTTP\/1\.1 200 OK/);
  assert.equal(result.logged.timestamp, "11/07/26-10:23:31:019");
  const lines = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.at(-1).recordType, "http-exchange");
  assert.equal(lines.at(-1).url, "https://authorized.example/");
  assert.equal(lines.at(-1).response.includes("hello"), true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("workbench accepts authorization from settings.config", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });

  const inScopePath = path.join(root, "scope", "in-scope.json");
  const settingsPath = path.join(root, "settings.config");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets.push({ ...inScope.targetTemplate, id: "target-1", value: "https://authorized.example" });
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.authorization.confirmed = true;
  settings.authorizationGate.authorizationConfirmed = true;
  settings.authorizationGate.rulesAccepted = true;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const workbench = createSecurityHttpWorkbench({
    fs,
    path,
    assessmentWorkspace: assessment,
    fetchImpl: async () => response(),
  });
  const result = await workbench.run({
    assessmentPath: root,
    rawRequest: "GET / HTTP/1.1\nHost: authorized.example",
    mode: "repeater",
  });
  assert.equal(result.ok, true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("override authorization bypasses the authorization gate", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });

  const inScopePath = path.join(root, "scope", "in-scope.json");
  const settingsPath = path.join(root, "settings.config");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets.push({ ...inScope.targetTemplate, id: "target-1", value: "https://authorized.example" });
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  settings.authorizationGate.overrideAuthorization = true;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const workbench = createSecurityHttpWorkbench({
    fs,
    path,
    assessmentWorkspace: assessment,
    fetchImpl: async () => response(),
  });
  const result = await workbench.run({
    assessmentPath: root,
    rawRequest: "GET / HTTP/1.1\nHost: authorized.example",
    mode: "intruder",
  });
  assert.equal(result.ok, true);
  fs.rmSync(parent, { recursive: true, force: true });
});
