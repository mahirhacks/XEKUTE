const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const {
  buildIntruderRequests,
  createSecurityHttpWorkbench,
  parseRawHttpRequest,
  urlMatchesTarget,
} = require("../src/interceptor/http-workbench.js");

function response(body = "ok", status = 200) {
  const headers = new Map([["content-type", "text/plain"], ["content-length", String(Buffer.byteLength(body))]]);
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { entries: () => headers.entries(), get: (name) => headers.get(String(name).toLowerCase()) || null },
    arrayBuffer: async () => Buffer.from(body),
  };
}

function runtimeSettings() {
  return { requests: { timeoutSeconds: 15, maximumResponseBytes: 1_000_000 }, logging: { logRawTraffic: true } };
}

function authorizedProfile(targets = ["https://authorized.example"]) {
  return {
    authorization: { confirmed: true },
    scope: { inScopeTargets: targets.map((value, index) => ({ id: `t${index + 1}`, assetType: "url", value })) },
    rulesOfEngagement: { requestTimeoutSeconds: 15 },
  };
}

function emptyProfile() {
  return { authorization: { confirmed: true }, scope: { inScopeTargets: [] }, rulesOfEngagement: {} };
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
  const raw = "GET /?user=§user§&pin=§pin§ HTTP/1.1\nHost: authorized.example";
  const payloads = JSON.stringify({ user: ["alice", "bob"], pin: ["1", "2"] });
  const sniper = buildIntruderRequests(raw, payloads, "sniper", 25);
  assert.equal(sniper.ok, true);
  assert.equal(sniper.requests.length, 4);
  const pitchfork = buildIntruderRequests(raw, payloads, "pitchfork", 25);
  assert.match(pitchfork.requests[1], /user=bob&pin=2/);
  const cluster = buildIntruderRequests(raw, payloads, "cluster-bomb", 3);
  assert.equal(cluster.requests.length, 3);
});

test("Intruder does not treat dollar signs in cookies as payload positions", () => {
  const raw = [
    "GET / HTTP/1.1",
    "Host: www.nasa.gov",
    "cookie: _ga=GA1.1.123.$o1$g0$t1787796549$j60$l0$h0; _ga_CSLL4ZEK4L=GS2.1.s1787796608$o1$g0$t1787796608$j60$l0$h0",
  ].join("\n");
  const none = buildIntruderRequests(raw, JSON.stringify({ o1: ["x"] }), "sniper", 25);
  assert.equal(none.code, "NO_PAYLOAD_POSITIONS");

  const marked = buildIntruderRequests(
    raw.replace("www.nasa.gov", "§host§"),
    JSON.stringify({ host: ["www.nasa.gov"] }),
    "sniper",
    25,
  );
  assert.equal(marked.ok, true);
  assert.deepEqual(marked.slots, ["host"]);
  assert.match(marked.requests[0], /Host: www\.nasa\.gov/);
  assert.match(marked.requests[0], /\$o1\$g0\$t1787796549\$/);
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

  const missingSettings = await workbench.run({ assessmentPath: root, rawRequest: "GET / HTTP/1.1\nHost: authorized.example", mode: "repeater" });
  assert.equal(missingSettings.code, "PROJECT_SETTINGS_REQUIRED");
  const unauthorized = await workbench.run({
    assessmentPath: root,
    rawRequest: "GET / HTTP/1.1\nHost: authorized.example",
    mode: "repeater",
    projectProfile: emptyProfile(),
    runtimeSettings: runtimeSettings(),
  });
  assert.equal(unauthorized.code, "OUT_OF_SCOPE");
  const outside = await workbench.run({
    assessmentPath: root,
    rawRequest: "GET / HTTP/1.1\nHost: outside.example",
    mode: "repeater",
    projectProfile: authorizedProfile(),
    runtimeSettings: runtimeSettings(),
  });
  assert.equal(outside.code, "OUT_OF_SCOPE");
  assert.equal(fetches, 0);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("authorized workbench requests are returned and timestamped in Traffic Raw", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path, now: () => new Date(2026, 6, 11, 10, 23, 31, 19) });
  assessment.repair(root, { createRoot: true });
  const workbench = createSecurityHttpWorkbench({ fs, path, assessmentWorkspace: assessment, fetchImpl: async () => response("hello") });
  const result = await workbench.run({
    assessmentPath: root,
    rawRequest: "GET / HTTP/1.1\nHost: authorized.example",
    mode: "repeater",
    projectProfile: authorizedProfile(),
    runtimeSettings: runtimeSettings(),
  });
  assert.equal(result.ok, true);
  assert.match(result.response, /HTTP\/1\.1 200 OK/);
  assert.equal(result.logged.timestamp, "11/07/26-10:23:31:019");
  const lines = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.at(-1).recordType, "http-exchange");
  assert.equal(lines.at(-1).url, "https://authorized.example/");
  assert.equal(lines.at(-1).response.includes("hello"), true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("workbench uses configured scope independently of authority metadata", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });

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
    projectProfile: authorizedProfile(),
    runtimeSettings: runtimeSettings(),
  });
  assert.equal(result.ok, true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("authority metadata cannot bypass configured scope", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-http-"));
  const root = path.join(parent, "assessment");
  const assessment = createAssessmentWorkspace({ fs, path });
  assessment.repair(root, { createRoot: true });

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
    projectProfile: emptyProfile(),
    runtimeSettings: runtimeSettings(),
  });
  assert.equal(result.code, "OUT_OF_SCOPE");
  fs.rmSync(parent, { recursive: true, force: true });
});
