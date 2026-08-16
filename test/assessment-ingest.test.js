const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const { ingest, listDatasets } = require("../src/app/services/assessment/assessment-ingest.js");

function runIngest(payload) {
  try {
    return { ...ingest(payload), status: 0, stderr: "" };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code || "INGEST_FAILED", status: 1, stderr: "" };
  }
}

test("typed assessment ingestion preserves schemas, drops unknown fields, and deduplicates", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-ingest-"));
  const root = path.join(parent, "assessment");
  createAssessmentWorkspace({ fs, path }).repair(root, { createRoot: true });

  const result = runIngest({
    workspace: root,
    resource: "endpoints",
    source: "katana:test",
    records: [
      { method: "get", url: "https://example.test/api/users", unexpected: "discard me" },
      { method: "GET", url: "https://example.test/api/users", notes: "latest observation" },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.ok, true);
  assert.equal(result.accepted, 2);
  assert.equal(result.total, 1);
  const document = JSON.parse(fs.readFileSync(path.join(root, "enumeration", "endpoints.json"), "utf8"));
  assert.equal(document.endpoints.length, 1);
  assert.equal(document.endpoints[0].method, "GET");
  assert.equal(document.endpoints[0].host, "example.test");
  assert.equal(document.endpoints[0].path, "/api/users");
  assert.equal(document.endpoints[0].discoveredBy, "katana:test");
  assert.equal(Object.hasOwn(document.endpoints[0], "unexpected"), false);
  assert.equal(document.statistics.total, 1);
  assert.equal(fs.existsSync(path.join(root, "enumeration", "endpoints.json.bak")), true);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("typed assessment ingestion refuses scope, traffic, and finding buckets", () => {
  for (const resource of ["in-scope", "raw-traffic", "critical-findings"]) {
    const result = runIngest({ workspace: process.cwd(), resource, source: "agent", records: [{ value: "x" }] });
    assert.notEqual(result.status, 0);
    assert.equal(result.code, "RESOURCE_NOT_ALLOWED");
  }
});

test("list_datasets exposes canonical names, schemas, and provision state before ingest", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-list-"));
  const root = path.join(parent, "assessment");
  createAssessmentWorkspace({ fs, path }).repair(root, { createRoot: true });

  const before = listDatasets(root);
  assert.equal(before.ok, true);
  assert.ok(Array.isArray(before.datasets) && before.datasets.length > 0);
  const passiveBefore = before.datasets.find((d) => d.resource === "passive-recon");
  assert.ok(passiveBefore, "passive sink is listed up front");
  assert.equal(passiveBefore.exists, true, "repair provisions the passive sink so it is always writable");
  assert.deepEqual(passiveBefore.keyFields, ["type", "value"]);

  // Ingesting more records keeps it provisioned (and dedup is preserved).
  ingest({ workspace: root, resource: "passive-recon", source: "manual:test", records: [{ type: "domain", value: "example.test" }] });
  const after = listDatasets(root);
  const passive = after.datasets.find((d) => d.resource === "passive-recon");
  assert.equal(passive.exists, true);

  fs.rmSync(parent, { recursive: true, force: true });
});
