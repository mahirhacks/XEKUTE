"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { projectToolResult, statusForLegacy } = require("../src/application/tools/result-projector");
const { validateToolResult } = require("../src/contracts/tool/tool-result");

test("projector maps all terminal legacy outcomes to the standard envelope", () => {
  const cases = [
    [{ ok: true, summary: "done" }, "success"],
    [{ ok: true, partial: true, summary: "partial" }, "partial"],
    [{ denied: true, error: "denied", errorCode: "SCOPE_DENIED" }, "denied"],
    [{ ok: false, error: "failed" }, "failed"],
    [{ ok: false, unavailable: true }, "unavailable"],
    [{ ok: false, cancelled: true }, "cancelled"],
  ];
  for (const [legacy, status] of cases) {
    assert.equal(statusForLegacy(legacy), status);
    const result = projectToolResult(legacy, { operationId: "op-1", auditId: "audit-1" });
    assert.equal(result.status, status);
    assert.equal(validateToolResult(result).ok, true);
    assert.equal(result.redactions_applied, true);
  }
});

test("projector excludes raw process output and keeps bounded artifact references", () => {
  const result = projectToolResult({
    ok: true,
    mode: "command",
    command: "npm test",
    stdout: "raw stdout should not reach model",
    stderr: "raw stderr should not reach model",
    stack: "raw stack should not reach model",
    artifactId: "artifact-123",
    summary: "Command completed",
  }, { operationId: "op-2", auditId: "audit-2" });
  assert.equal(result.status, "success");
  assert.equal(result.data.stdout, undefined);
  assert.equal(result.data.stderr, undefined);
  assert.deepEqual(result.data.artifact_refs, ["artifact-123"]);
});

test("projector redacts secrets and bounds oversized fields", () => {
  const result = projectToolResult({
    ok: true,
    summary: "completed",
    token: "secret-token",
    authorization: "Bearer top-secret",
    analysis: "x".repeat(100000),
    artifact_id: "artifact-large",
  }, { operationId: "op-3", auditId: "audit-3", maxDataBytes: 1000 });
  assert.equal(validateToolResult(result).ok, true);
  assert.equal(result.data.token, undefined);
  assert.equal(result.data.authorization, undefined);
  assert.deepEqual(result.data.artifact_refs, ["artifact-large"]);
  assert.equal(result.data.truncated, true);
});

test("projector creates explicit cancellation and unavailable results", () => {
  const cancelled = projectToolResult({ cancelled: true, summary: "Stopped by operator" }, { operationId: "op-c", auditId: "audit-c" });
  const unavailable = projectToolResult({ unavailable: true, summary: "Browser driver unavailable" }, { operationId: "op-u", auditId: "audit-u" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.code, "OPERATION_CANCELLED");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.code, "ADAPTER_UNAVAILABLE");
});
