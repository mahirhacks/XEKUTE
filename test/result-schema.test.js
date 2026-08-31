"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateToolAdapter, TOOL_ADAPTER_ERROR_CODES } = require("../src/contracts/tool/tool-adapter.js");
const { projectToolResult, toolResultContentForModel } = require("../src/agent/runtime/result-projector.js");
const { createVerifyFindingResult, validateVerifyFindingResult } = require("../src/contracts/tool/verify-finding-result.js");

test("tool adapters expose executable schemas without lifecycle or approval fields", async () => {
  const adapter = { name: "read_file", inputSchema: { type: "object" }, async execute() { return { ok: true }; } };
  assert.deepEqual(validateToolAdapter(adapter), { ok: true, value: adapter });
  assert.equal(validateToolAdapter(null).error.code, TOOL_ADAPTER_ERROR_CODES.INVALID_ADAPTER);
  assert.equal((await adapter.execute()).ok, true);
});

test("result projection keeps structured scope denials model-readable", () => {
  const result = projectToolResult({ ok: false, code: "WORKSPACE_OUT_OF_SCOPE", error: "Keep the path inside the workspace", scope: { remediation: "Use a workspace-relative path" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WORKSPACE_OUT_OF_SCOPE");
  assert.match(toolResultContentForModel({ ...result, value: { remediation: "Use a workspace-relative path" } }), /WORKSPACE_OUT_OF_SCOPE/);
  assert.doesNotMatch(JSON.stringify(result), /approval|policyDecision/);
});

test("top-level knowledge packets remain model-readable without duplicating leased schemas", () => {
  const projected = JSON.parse(toolResultContentForModel({
    ok: true,
    items: [{ id: "passive_recon", methodology: "Inspect certificate transparency logs." }],
    activeTools: [{ type: "function", function: { name: "mcp__scout__host_search", parameters: { secret: "must-not-copy" } } }],
  }));
  const payload = JSON.parse(projected.payload);
  assert.equal(payload.items[0].id, "passive_recon");
  assert.deepEqual(payload.activatedMcpTools, ["mcp__scout__host_search"]);
  assert.doesNotMatch(projected.payload, /must-not-copy/);
});

test("finding verification keeps its specialized result shape", () => {
  const value = createVerifyFindingResult({ findingId: "f-1", verdict: "accept", reason: "reproduced", evidenceRefs: ["e-1"] });
  assert.equal(validateVerifyFindingResult(value).ok, true);
  assert.equal("status" in value, false);
});
