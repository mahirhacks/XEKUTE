const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace, summarizeTrafficRecord } = require("../src/domain/assessment/assessment-workspace");

test("summarizeTrafficRecord drops bodies and keeps list metadata", () => {
  const summary = summarizeTrafficRecord({
    recordType: "http-exchange",
    requestId: "req-1",
    url: "https://app.example/search?q=nasa",
    method: "POST",
    statusCode: 200,
    timestamp: "31/08/26-13:00:00:000",
    isoTimestamp: "2026-08-31T05:00:00.000Z",
    tool: "interceptor",
    request: "POST /search?q=nasa HTTP/1.1\r\nHost: app.example\r\nContent-Type: application/json\r\n\r\n{\"q\":\"nasa\"}",
    response: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}",
  });
  assert.equal(summary.request, undefined);
  assert.equal(summary.response, undefined);
  assert.equal(summary.requestId, "req-1");
  assert.equal(summary.host, "https://app.example");
  assert.equal(summary.path, "/search?q=nasa");
  assert.equal(summary.hasParams, true);
  assert.equal(summary.mime, "JSON");
  assert.equal(summary.statusCode, 200);
  assert.ok(summary.requestLength > 0);
  assert.ok(summary.responseLength > 0);
});

test("readTrafficHistory can return summaries without bodies", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-traffic-history-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path, now: () => new Date("2026-08-31T05:00:00.000Z") });
  try {
    const repaired = workspace.repair(root, { createRoot: true });
    assert.equal(repaired.error, undefined);
    const hugeBody = "x".repeat(50_000);
    const logged = workspace.appendTrafficRecord(root, {
      tool: "interceptor",
      requestId: "req-live",
      url: "https://app.example/page",
      method: "GET",
      statusCode: 200,
      request: "GET /page HTTP/1.1\r\nHost: app.example\r\n\r\n",
      response: `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n${hugeBody}`,
    });
    assert.equal(logged.ok, true);
    assert.equal(logged.evidence, undefined);
    assert.equal(fs.existsSync(path.join(root, "evidence", "index.jsonl")), false);

    const summaries = workspace.readTrafficHistory(root, { limit: 50, includeBodies: false });
    assert.equal(summaries.ok, true);
    const row = summaries.records.find((record) => record.requestId === "req-live");
    assert.ok(row);
    assert.equal(row.request, undefined);
    assert.equal(row.response, undefined);
    assert.equal(row.mime, "HTML");
    assert.equal(row.responseLength, Buffer.byteLength(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n${hugeBody}`, "utf8"));

    const full = workspace.readTrafficRecords(root, { requestIds: ["req-live"] });
    assert.equal(full.records.length, 1);
    assert.match(full.records[0].response, /xxxxx/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
