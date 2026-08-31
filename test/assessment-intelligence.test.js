"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAssessmentIntelligenceService } = require("../src/app/services/assessment/intelligence/assessment-intelligence-service.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-intelligence-"));
  fs.mkdirSync(path.join(root, "traffic"), { recursive: true });
  const record = { id: "e-1", method: "GET", url: "https://example.test/api/users/123", response: { status: 200, headers: { "content-type": "application/json" }, body: "{\"id\":123,\"token\":\"secret\"}" } };
  fs.writeFileSync(path.join(root, "traffic", "raw.jsonl"), `${JSON.stringify(record)}\n`);
  return root;
}

test("assessment intelligence builds a bounded searchable index and verifies raw evidence", async () => {
  const root = fixture();
  const service = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    assert.equal(service.status(root).status, "not_built");
    const built = await service.start(root);
    assert.equal(built.ok, true);
    assert.equal(service.status(root).status, "ready");
    const search = service.query(root, { operation: "search", query: "users", limit: 30 });
    assert.ok(search.items.some((item) => item.type === "endpoint" || item.type === "evidence"));
    const expanded = service.expand(root, { refs: ["e-1"], level: "raw" });
    assert.equal(expanded.items.length, 1);
    assert.equal(expanded.items[0].sourceVerified, true);
    assert.match(JSON.stringify(expanded.items[0].sanitized), /secret/);
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assessment intelligence resumes JSONL sources after append without recounting prior evidence", async () => {
  const root = fixture();
  const service = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    const first = await service.start(root);
    assert.equal(first.records, 1);
    const record = { id: "e-2", method: "GET", url: "https://example.test/api/orders/456", response: { status: 200, body: "ok" } };
    fs.appendFileSync(path.join(root, "traffic", "raw.jsonl"), `${JSON.stringify(record)}\n`);
    const second = await service.start(root);
    assert.equal(second.records, 1);
    assert.equal(second.overview.counts.evidence, 2);
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assessment intelligence records bounded plan-run evidence with provenance", async () => {
  const root = fixture();
  const service = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    await service.start(root);
    const recorded = service.recordRuntimeEvidence(root, {
      runId: "run-1",
      planId: "plan-1",
      stepId: "step-1",
      repetition: 1,
      action: "replay_request",
      identityId: "account-a",
      pageId: "main",
      result: { status: 200, authorization: "Bearer runtime-secret" },
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.evidenceIds.length, 1);
    await service.flush();
    const expanded = service.expand(root, { refs: recorded.evidenceIds, level: "summary" });
    assert.equal(expanded.items.length, 1);
    assert.equal(expanded.items[0].producedRunId, "run-1");
    assert.doesNotMatch(JSON.stringify(expanded.items[0]), /runtime-secret/);
    assert.match(JSON.stringify(expanded.items[0]), /\[REDACTED\]/);
    const raw = service.expand(root, { refs: recorded.evidenceIds, level: "raw" });
    assert.equal(raw.items[0].sourceVerified, true);
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime evidence remains durable when the intelligence index has not been built yet", async () => {
  const root = fixture();
  const service = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    const recorded = service.recordRuntimeEvidence(root, {
      runId: "run-before-index",
      planId: "plan-before-index",
      stepId: "step-before-index",
      action: "replay_request",
      result: { status: 204, body: "safe" },
    });
    assert.equal(recorded.ok, true);
    assert.equal(service.status(root).status, "not_built");
    await service.flush();
    assert.equal(fs.existsSync(path.join(root, ".xekute", "evidence", "runtime.jsonl")), true);
    await service.start(root);
    const expanded = service.expand(root, { refs: recorded.evidenceIds, level: "raw" });
    assert.equal(expanded.items[0].sourceVerified, true);
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assessment intelligence pause and resume use persisted source cursors", async () => {
  const root = fixture();
  const traffic = Array.from({ length: 500 }, (_, index) => JSON.stringify({ id: `e-${index}`, method: "GET", url: `https://example.test/api/items/${index}`, response: { status: 200, body: "ok" } })).join("\n") + "\n";
  fs.writeFileSync(path.join(root, "traffic", "raw.jsonl"), traffic);
  let pausedOnce = false;
  const service = createAssessmentIntelligenceService({ enableWorker: false, onEvent: (event) => {
    if (!pausedOnce && event.type === "progress" && Number(event.progress?.records || 0) >= 100) {
      pausedOnce = true;
      service.pause(root);
    }
  } });
  try {
    const paused = await service.start(root);
    assert.equal(paused.status, "paused");
    assert.equal(service.status(root).status, "paused");
    const resumed = await service.resume(root);
    assert.equal(resumed.ok, true);
    assert.equal(service.status(root).status, "ready");
    assert.equal(service.query(root, { operation: "overview" }).overview.counts.evidence, 500);
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assessment knowledge retrieval is separate from engagement index data", async () => {
  const root = fixture();
  const service = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    const result = service.query(root, { domain: "knowledge", operation: "knowledge", query: "verification", limit: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.domain, "knowledge");
    assert.ok(result.items.length > 0);
    assert.equal(service.status(root).status, "not_built");
  } finally {
    await service.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
