"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CATALOG_VERSION,
  PUBLIC_TOOL_NAMES,
  PROFILE_TOOL_NAMES,
  LEGACY_OR_INTERNAL_NAMES,
  assertCatalogIntegrity,
  toolNamesForProfile,
  profileCatalog,
  serializedCatalogSize,
  validateCatalogSize,
} = require("../src/contracts/tool/unified-catalog");
const { UNIFIED_INPUT_SCHEMAS, RESULT_DATA_SCHEMAS, validateSchemaShape } = require("../src/contracts/tool/unified-schemas");
const { createToolResult, validateToolResult } = require("../src/contracts/tool/tool-result");

const expectedNames = [
  "exec_command", "read_file", "search_workspace", "apply_patch", "manage_plan", "manage_state",
  "check_scope", "ingest_traffic", "manage_identity", "replay_request", "run_test_case", "browser_action",
  "compare_responses", "verify_finding", "store_finding", "attack_graph", "delegate_agent",
];

test("unified catalog is exactly xekute.vapt.v1 with 17 public names", () => {
  assert.equal(CATALOG_VERSION, "xekute.vapt.v1");
  assert.deepEqual(PUBLIC_TOOL_NAMES, expectedNames);
  assert.equal(new Set(PUBLIC_TOOL_NAMES).size, 17);
  assert.equal(assertCatalogIntegrity(), true);
  for (const legacyName of LEGACY_OR_INTERNAL_NAMES) assert.equal(PUBLIC_TOOL_NAMES.includes(legacyName), false);
});

test("profile catalogs are subsets and Agent receives the complete public surface", () => {
  assert.deepEqual(toolNamesForProfile("agent"), expectedNames);
  for (const [profile, names] of Object.entries(PROFILE_TOOL_NAMES)) {
    assert.ok(names.every((name) => PUBLIC_TOOL_NAMES.includes(name)), `${profile} must be a subset`);
    assert.equal(new Set(names).size, names.length);
  }
});

test("every public tool has a closed input and result-data schema", () => {
  assert.deepEqual(Object.keys(UNIFIED_INPUT_SCHEMAS).sort(), expectedNames.slice().sort());
  assert.deepEqual(Object.keys(RESULT_DATA_SCHEMAS).sort(), expectedNames.slice().sort());
  for (const name of expectedNames) {
    assert.equal(validateSchemaShape(UNIFIED_INPUT_SCHEMAS[name], name).ok, true);
    assert.equal(validateSchemaShape(RESULT_DATA_SCHEMAS[name], `${name}.result`).ok, true);
    assert.equal(UNIFIED_INPUT_SCHEMAS[name].additionalProperties, false);
    assert.equal(RESULT_DATA_SCHEMAS[name].additionalProperties, false);
  }
});

test("catalog serialization and schema budgets fail closed", () => {
  const schemas = Object.fromEntries(expectedNames.map((name) => [name, {
    name,
    description: `Bounded ${name}`,
    parameters: UNIFIED_INPUT_SCHEMAS[name],
  }]));
  assert.ok(serializedCatalogSize("agent", schemas) > 0);
  assert.equal(validateCatalogSize("agent", schemas).ok, true);
  assert.equal(validateCatalogSize("agent", schemas, { maxCatalogBytes: 10 }).ok, false);
  assert.equal(UNIFIED_INPUT_SCHEMAS.run_test_case.required.includes("executor"), true);
});

test("standard result envelope contains bounded references and redaction metadata", () => {
  const result = createToolResult({
    status: "success",
    code: "OK",
    summary: "Read completed",
    data: { token: "never-returned", count: 1 },
    evidence_refs: ["evidence-1"],
    audit_id: "audit-1",
    operation_id: "operation-1",
  });
  assert.equal(validateToolResult(result).ok, true);
  assert.equal(result.redactions_applied, true);
  assert.equal(result.data.token, "[REDACTED]");
  assert.equal(Object.keys(result).sort().join(","), "audit_id,code,data,evidence_refs,operation_id,redactions_applied,retryable,status,summary");
});

test("result validation rejects raw output fields and missing references", () => {
  const invalid = {
    status: "success",
    code: "OK",
    summary: "bad",
    data: { stdout: "raw output" },
    evidence_refs: [],
    audit_id: "audit-1",
    operation_id: "operation-1",
    retryable: false,
    redactions_applied: true,
  };
  assert.equal(validateToolResult(invalid).ok, false);
  assert.equal(validateToolResult({ ...invalid, data: {}, evidence_refs: ["e-1"] }).ok, true);
});
