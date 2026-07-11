const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ASSESSMENT_ITEM_FILES,
  ASSESSMENT_VERSION,
  JSON_TEMPLATES,
  createAssessmentWorkspace,
} = require("../src/bugbounty/assessment-workspace");

test("every assessment sidebar item maps to its required backing file", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  for (const [item, relativePath] of Object.entries(ASSESSMENT_ITEM_FILES)) {
    assert.ok(
      html.includes(`data-bounty-item="${item}" data-bounty-file="${relativePath}"`),
      `${item} should open ${relativePath}`,
    );
  }
});

test("security workspace exposes Traffic Raw history with request and response details", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  assert.ok(html.includes('id="security-history-toggle"'));
  assert.ok(html.includes('id="security-history-rows"'));
  assert.ok(html.indexOf('id="security-history-panel"') < html.indexOf('id="security-workbench"'));
  assert.ok(html.includes('id="security-request-editor"'));
  assert.ok(html.includes('id="security-response-editor"'));
});

test("professional assessment schemas cover scope, evidence, services, findings, and frameworks", () => {
  assert.equal(ASSESSMENT_VERSION, 2);
  assert.ok(Object.values(JSON_TEMPLATES).every((template) => template.schemaVersion === 2));

  const inScope = JSON_TEMPLATES["scope/in-scope.json"];
  assert.deepEqual(Object.keys(inScope.engagement), [
    "name", "programName", "platform", "engagementType", "clientOrOwner", "primaryContact",
    "emergencyContact", "timezone", "startDate", "endDate",
  ]);
  assert.ok("authorizationReference" in inScope.authorization);
  assert.ok("allowedTechniques" in inScope.targetTemplate);
  assert.ok("credentialsReference" in inScope.targetTemplate);

  const configurations = JSON_TEMPLATES["scope/configurations.json"];
  assert.ok("authorizationGate" in configurations);
  assert.ok("stopConditions" in configurations);
  assert.ok("dataHandling" in configurations);
  assert.ok("rateLimits" in configurations);

  const finding = JSON_TEMPLATES["vulnerability-scans/high.json"].findingTemplate;
  assert.ok("cvss" in finding);
  assert.ok("classification" in finding);
  assert.ok("reproduction" in finding);
  assert.ok("remediation" in finding);
  assert.ok("validation" in finding);

  const service = JSON_TEMPLATES["vulnerability-scans/services.json"].serviceTemplate;
  assert.ok("latestKnownVersion" in service);
  assert.ok("endOfLife" in service);
  assert.ok("cveIds" in service);

  const settings = JSON_TEMPLATES["settings.config"];
  assert.equal(settings.listener.bindAddress, "127.0.0.1");
  assert.equal(settings.listener.port, 8080);
  assert.ok("interception" in settings);
  assert.ok("authorization" in settings);
  assert.ok("authorizationGate" in settings);
  assert.ok("upstreamProxy" in settings);
  assert.ok("intruder" in settings);
  assert.ok("logging" in settings);
});

test("settings UI controls map to real settings.config fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  const settings = JSON_TEMPLATES["settings.config"];
  const paths = [...html.matchAll(/data-setting-path="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths.length >= 20);
  for (const settingPath of paths) {
    const value = settingPath.split(".").reduce((current, key) => current?.[key], settings);
    assert.notEqual(value, undefined, `${settingPath} must exist in settings.config`);
  }
});

test("assessment repair creates the complete versioned workspace", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "example-target");
  const workspace = createAssessmentWorkspace({
    fs,
    path,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  const initial = workspace.verify(root);
  assert.equal(initial.code, "NOT_FOUND");

  const repaired = workspace.repair(root, { createRoot: true });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.valid, true);
  assert.equal(repaired.missingCount, 0);
  assert.ok(repaired.created.includes(".pointer-assessment.json"));
  assert.ok(repaired.created.includes("penetration-testing/wstg-checklist.json"));
  assert.ok(repaired.created.includes("report/report.md"));

  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".pointer-assessment.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.name, "example-target");
  assert.equal(manifest.createdAt, "2026-01-02T03:04:05.000Z");

  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment migration adds missing fields without losing existing evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "preserve-data");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const evidencePath = path.join(root, "scope", "in-scope.json");
  const missingPath = path.join(root, "enumeration", "endpoints.json");
  const evidence = '{"targets":["https://authorized.example"]}\n';
  fs.writeFileSync(evidencePath, evidence, "utf8");
  fs.rmSync(missingPath);

  const invalid = workspace.verify(root);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.missing.map((entry) => entry.path).sort(), [
    "enumeration/endpoints.json",
    "scope/in-scope.json",
  ]);

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, true);
  assert.deepEqual(repaired.created, ["enumeration/endpoints.json"]);
  assert.ok(repaired.updated.includes("scope/in-scope.json"));
  const migrated = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.deepEqual(migrated.targets, ["https://authorized.example"]);
  assert.equal(migrated.schemaVersion, 2);
  assert.ok("engagement" in migrated);
  assert.ok("authorization" in migrated);
  assert.ok("targetTemplate" in migrated);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment repair does not replace paths having the wrong type", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "wrong-type");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const reportPath = path.join(root, "report", "report.md");
  fs.rmSync(reportPath);
  fs.mkdirSync(reportPath);

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, false);
  assert.deepEqual(repaired.blocked, [{ path: "report/report.md", reason: "wrong_type" }]);
  assert.equal(fs.lstatSync(reportPath).isDirectory(), true);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("traffic history reads newest HTTP exchanges from Traffic Raw with bounded, resilient parsing", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "traffic-history");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  workspace.appendTrafficRecord(root, {
    requestId: "first",
    method: "GET",
    url: "https://authorized.example/one",
    statusCode: 200,
    request: "GET /one HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\none",
  });
  workspace.appendTrafficRecord(root, {
    requestId: "second",
    method: "POST",
    url: "https://authorized.example/two",
    statusCode: 201,
    request: "POST /two HTTP/1.1\r\nHost: authorized.example\r\n\r\ntwo",
    response: "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n\r\n{}",
  });
  fs.appendFileSync(path.join(root, "traffic", "raw.jsonl"), "not-json\n", "utf8");

  const history = workspace.readTrafficHistory(root, { limit: 1 });
  assert.equal(history.ok, true);
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].requestId, "second");
  assert.equal(history.records[0].statusCode, 201);
  assert.equal(history.invalidCount, 1);
  assert.equal(history.truncated, true);

  fs.rmSync(parent, { recursive: true, force: true });
});
