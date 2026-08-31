"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");
const { createJavascriptArtifactStore, extractJavaScriptMetadata } = require("../src/domain/assessment/javascript-artifact-store.js");
const { createAssessmentMap } = require("../src/domain/assessment/assessment-map.js");
const { createJavascriptCollector } = require("../src/app/services/assessment/traffic-graph/javascript-collector.js");

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-traffic-graph-"));
  const root = path.join(parent, "assessment");
  const assessmentWorkspace = createAssessmentWorkspace({ fs, path });
  assessmentWorkspace.repair(root, { createRoot: true });
  const artifacts = createJavascriptArtifactStore({ fs, path, crypto, now: () => new Date("2026-08-10T01:02:03.456Z") });
  const map = createAssessmentMap({ fs, path, crypto, assessmentWorkspace, javascriptArtifacts: artifacts, now: () => new Date("2026-08-10T01:02:03.456Z") });
  return { parent, root, assessmentWorkspace, artifacts, map };
}

function exchange(id, url, options = {}) {
  const target = new URL(url);
  const method = options.method || "GET";
  const identity = options.identity || null;
  return {
    tool: "interceptor", requestId: id, method, url, statusCode: options.statusCode || 200,
    isoTimestamp: options.isoTimestamp || "2026-08-10T01:00:00.000Z",
    captureIdentity: identity,
    request: `${method} ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n${options.cookie === false ? "" : "Cookie: sid=test\r\n"}\r\n${options.requestBody || ""}`,
    response: `HTTP/1.1 ${options.statusCode || 200} OK\r\nContent-Type: ${options.contentType || "application/json"}\r\n\r\n${options.responseBody || "{\"ok\":true}"}`,
  };
}

test("JavaScript artifacts are content-addressed, URL-deduplicated, and metadata-only", async (t) => {
  const { parent, root, artifacts } = fixture();
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const source = 'import "./chunk.js"; fetch("/api/orders", {method:"POST"}); axios.get("/api/me");';
  const first = await artifacts.capture(root, { url: "https://app.example/assets/app.js?token=secret", content: source, contentType: "application/javascript", source: "passive-proxy" });
  const second = await artifacts.capture(root, { url: "https://cdn.example/app.js", content: source, contentType: "text/javascript", source: "active-deep-collect" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const manifest = artifacts.readManifest(root);
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].urls.length, 2);
  assert.match(manifest.artifacts[0].urls[0].url, /token=%5BREDACTED%5D/);
  assert.doesNotMatch(JSON.stringify(manifest), /token=secret/);
  assert.equal(manifest.artifacts[0].endpoints.some((entry) => entry.method === "POST" && entry.url === "https://app.example/api/orders"), true);
  assert.equal(fs.readdirSync(artifacts.objectsDirectory(root)).filter((name) => name.endsWith(".js")).length, 1);
});

test("JavaScript extraction discovers imports, source maps, XHR, and security signals deterministically", () => {
  const metadata = extractJavaScriptMetadata('import("./lazy.mjs"); xhr.open("PATCH", "/api/users/4"); localStorage.setItem("access_token", token); //# sourceMappingURL=app.js.map', "https://app.example/assets/app.js");
  assert.deepEqual(metadata.imports, ["https://app.example/assets/lazy.mjs"]);
  assert.deepEqual(metadata.sourceMaps, ["https://app.example/assets/app.js.map"]);
  assert.equal(metadata.endpoints.some((entry) => entry.method === "PATCH" && entry.url === "https://app.example/api/users/4"), true);
  assert.ok(metadata.signals.storageReferences > 0);
  assert.ok(metadata.signals.authorizationReferences > 0);
});

test("rich graph snapshots are immutable, deduplicated, queryable, and embed graph provenance in HTML", async (t) => {
  const { parent, root, assessmentWorkspace, artifacts, map } = fixture();
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  await artifacts.capture(root, { url: "https://app.example/assets/app.js", content: 'fetch("/api/orders", {method:"POST"})', contentType: "application/javascript" });
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-a", "https://app.example/api/orders", { method: "POST", identity: { id: "account-a", label: "Account A", role: "user" }, responseBody: '{"order_id":42}' }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("req-b", "https://app.example/api/orders", { method: "POST", identity: { id: "account-b", label: "Account B", role: "admin" }, statusCode: 403, responseBody: '{"error":"denied"}' }));
  const first = map.build(root);
  assert.equal(first.ok, true);
  assert.equal(first.graph.nodes.some((node) => node.type === "JavaScript"), true);
  assert.equal(first.graph.nodes.filter((node) => node.type === "Identity").length, 2);
  assert.equal(first.graph.nodes.some((node) => node.type === "ResponseVariant"), true);
  assert.equal(first.graph.nodes.some((node) => node.type === "ApplicationState"), true);
  assert.equal(first.graph.nodes.some((node) => node.type === "Action"), true);
  assert.equal(first.graph.nodes.some((node) => node.type === "Workflow"), true);
  assert.equal(first.graph.edges.some((edge) => edge.type === "DECLARES_ENDPOINT"), true);
  assert.equal(first.graph.edges.some((edge) => edge.type === "REQUIRES_STATE"), true);
  assert.equal(first.graph.edges.some((edge) => edge.type === "PRODUCES_STATE"), true);
  assert.equal(first.graph.edges.some((edge) => edge.type === "TRANSITIONS_TO"), true);
  assert.ok(first.graph.stateModel.states.length > 0);
  assert.ok(first.graph.stateModel.actions.some((action) => action.actionKind === "create" && action.resource === "order"));
  assert.ok(first.graph.stateModel.anomalies.every((anomaly) => anomaly.status === "candidate"));
  const stateProjection = map.getStateModel(root, { limit: 10 });
  assert.equal(stateProjection.ok, true);
  assert.equal(stateProjection.derivation, "deterministic-traffic-projection");
  assert.equal(stateProjection.summary.actions, first.graph.stats.actions);
  assert.equal(first.graph.communities.length > 0, true);
  assert.equal(map.getIdentityDiff(root).differences.length, 1);
  assert.equal(map.getAnomalies(root).anomalies.some((item) => item.reasons.includes("multi_identity_behavior")), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "traffic", "graph", "manifest.json"), "utf8"));
  assert.equal(manifest.snapshots.length, 1);
  const html = fs.readFileSync(path.join(root, ...first.htmlPath.split("/")), "utf8");
  assert.doesNotMatch(html, /req-a|req-b/);
  assert.match(html, /Raw traffic remains in XEKUTE/);
  assert.match(html, /ApplicationState/);
  const second = map.build(root);
  assert.equal(second.unchanged, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "traffic", "graph", "manifest.json"), "utf8")).snapshots.length, 1);
});

test("active JavaScript collection follows discovered imports, enforces scope per URL, and deduplicates content", async (t) => {
  const { parent, root, artifacts, map } = fixture();
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const responses = new Map([
    ["https://app.example/app.js", 'import "./chunk.js"; fetch("/api")'],
    ["https://app.example/chunk.js", 'export const value = 1;'],
  ]);
  const contacted = [];
  const collector = createJavascriptCollector({
    artifacts,
    assessmentMap: map,
    authorizeUrl: async (url) => ({ ok: new URL(url).hostname === "app.example", code: "TEST_SCOPE" }),
    fetchImpl: async (url) => {
      contacted.push(url);
      const body = responses.get(url);
      return new Response(body || "missing", { status: body ? 200 : 404, headers: { "content-type": "application/javascript" } });
    },
  });
  const result = await collector.collect({ workspace: root, seeds: ["https://app.example/app.js", "https://outside.example/no.js"], maxFiles: 10 });
  assert.equal(result.downloaded, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(contacted.sort(), ["https://app.example/app.js", "https://app.example/chunk.js"]);
  assert.equal(artifacts.readManifest(root).artifacts.length, 2);
});

test("graph snapshots recover from damaged manifests and damaged latest snapshots", (t) => {
  const { parent, root, assessmentWorkspace, map } = fixture();
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  assessmentWorkspace.appendTrafficRecord(root, exchange("first", "https://app.example/first"));
  const first = map.build(root);
  assessmentWorkspace.appendTrafficRecord(root, exchange("second", "https://app.example/second"));
  const second = map.build(root);
  assert.notEqual(first.path, second.path);
  const manifestPath = path.join(root, "traffic", "graph", "manifest.json");
  fs.writeFileSync(manifestPath, "{damaged", "utf8");
  const recoveredLatest = map.read(root);
  assert.equal(recoveredLatest.recovered, true);
  assert.equal(recoveredLatest.path, second.path);
  fs.writeFileSync(path.join(root, ...second.path.split("/")), "{damaged", "utf8");
  const recoveredPrior = map.read(root);
  assert.equal(recoveredPrior.recovered, true);
  assert.equal(recoveredPrior.path, first.path);
});
