"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MAX_BYTES,
  validateIpcRequest,
  normalizeResult,
} = require("../src/shared/ipc-contracts");

test("IPC contracts reject oversized, deeply nested, and unsupported payloads", () => {
  assert.equal(validateIpcRequest("workspace:read", [{ value: "x".repeat(DEFAULT_MAX_BYTES + 1) }])?.code, "IPC_PAYLOAD_TOO_LARGE");
  let nested = "leaf";
  for (let index = 0; index < 14; index += 1) nested = { nested };
  assert.equal(validateIpcRequest("workspace:read", [nested])?.code, "INVALID_IPC_PAYLOAD");
  assert.equal(validateIpcRequest("workspace:read", [() => {}])?.code, "INVALID_IPC_PAYLOAD");
});

test("IPC contracts validate terminal dimensions and normalize result envelopes", () => {
  assert.equal(validateIpcRequest("terminal:resize", [{ cols: 0, rows: 24 }])?.code, "INVALID_IPC_PAYLOAD");
  assert.equal(validateIpcRequest("terminal:resize", [{ cols: 120, rows: 40 }]), null);
  assert.deepEqual(normalizeResult({ value: 1 }), { ok: true, value: { value: 1 } });
  assert.deepEqual(normalizeResult({ error: "No access", code: "DENIED" }), {
    ok: false,
    error: { code: "DENIED", message: "No access", retryable: false },
  });
});
