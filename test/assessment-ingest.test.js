const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createAssessmentWorkspace } = require("../src/bugbounty/assessment-workspace");

function runIngest(payload) {
  const executable = process.env.POINTER_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(
    executable,
    [path.join(__dirname, "..", "src", "commands", "assessment_ingest.py"), "--payload", "-"],
    { input: JSON.stringify(payload), encoding: "utf8" },
  );
  const parsed = JSON.parse(result.stdout.trim());
  return { ...parsed, status: result.status, stderr: result.stderr };
}

test("typed Python ingestion preserves schemas, drops unknown fields, and deduplicates", () => {
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

test("typed Python ingestion refuses scope, traffic, and finding buckets", () => {
  for (const resource of ["in-scope", "raw-traffic", "critical-findings"]) {
    const result = runIngest({ workspace: process.cwd(), resource, source: "agent", records: [{ value: "x" }] });
    assert.notEqual(result.status, 0);
    assert.equal(result.code, "RESOURCE_NOT_ALLOWED");
  }
});
