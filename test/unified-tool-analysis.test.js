"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestingPort } = require("../src/application/tools/ports/testing-port");
const { buildAction } = require("../src/adapters/tools/cyber/security-tool-adapters");
const { createResponsePort } = require("../src/application/tools/ports/response-port");
const { createFindingPort } = require("../src/application/tools/ports/finding-port");
const { createGraphPort } = require("../src/application/tools/ports/graph-port");
const { createBrowserPort } = require("../src/application/tools/ports/browser-port");
const { createDelegationPort, intersectCapabilities } = require("../src/application/tools/ports/delegation-port");

test("testing port fails closed when no typed executor exists", async () => {
  const port = createTestingPort({ buildAction });
  const result = await port.execute({ executor: "nmap", category: "recon", test_case_id: "nmap", target: "https://leadbondhuai.online", expected_evidence: ["ports"] }, { workspace: process.cwd() });
  assert.equal(result.code, "ADAPTER_UNAVAILABLE");
});

test("response port compares immutable evidence without returning raw bodies", async () => {
  const port = createResponsePort({ evidenceStore: { get: async (_workspace, id) => id === "a" ? { response: "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nalpha" } : { response: "HTTP/1.1 403 Forbidden\nContent-Type: text/plain\n\nbeta" } } });
  const result = await port.execute({ baseline_id: "a", mutated_id: "b", max_differences: 10 }, { workspace: process.cwd() });
  assert.equal(result.ok, true);
  assert.ok(result.differences.some((item) => item.signal === "status"));
  assert.equal(result.body, undefined);
});

test("finding port preserves finding-gate failure and evidence references", async () => {
  const port = createFindingPort({ assessmentWorkspace: { readJsonl: () => ({ records: [] }), appendFinding: () => ({ ok: true, finding: { id: "finding-1" } }) } });
  const result = await port.execute({ action: "create", finding_id: "finding-1", title: "Test", asset_id: "asset-1", severity: "low", confidence: 0.5, evidence_refs: [] }, { workspace: process.cwd() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence_refs, []);
});

test("graph port enforces controlled assertion promotion transitions", async () => {
  const port = createGraphPort({ assessmentMap: { mapAnnotateFinding: () => ({ ok: true, annotation: {} }) } });
  const invalid = await port.execute({ action: "promote_assertion", assertion_id: "a", from_state: "inferred", state: "disputed", evidence_refs: ["e"] }, { workspace: process.cwd() });
  assert.equal(invalid.code, "GRAPH_PROMOTION_INVALID");
  const valid = await port.execute({ action: "promote_assertion", assertion_id: "a", from_state: "inferred", state: "verified", evidence_refs: ["e"] }, { workspace: process.cwd() });
  assert.equal(valid.ok, true);
});

test("browser port returns explicit unavailable and delegation intersects parent capabilities", async () => {
  const browser = await createBrowserPort().execute({ action: "navigate" }, {});
  assert.equal(browser.code, "DRIVER_UNAVAILABLE");
  const intersection = intersectCapabilities({ max_depth: 1, max_parallel: 2, max_runtime_ms: 5000, selected_context: ["a"] }, { specialist: "network_analysis", max_depth: 3, max_parallel: 4, max_runtime_ms: 10000, selected_context: ["a", "b"] });
  assert.deepEqual(intersection.selected_context, ["a"]);
  assert.equal(intersection.max_depth, 1);
  const delegation = await createDelegationPort().execute({ action: "delegate", specialist: "network_analysis", task: "map", max_depth: 1, max_parallel: 1, max_runtime_ms: 1000, selected_context: [] }, { delegation: { max_depth: 1, max_parallel: 1, max_runtime_ms: 1000, selected_context: [] } });
  assert.equal(delegation.code, "DELEGATION_UNAVAILABLE");
});
