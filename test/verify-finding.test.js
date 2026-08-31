"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVerifyFindingTool } = require("../src/agent/tools/assessment/verify-finding.js");
const { createToolRegistry, registerVerifyFinding } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-verify-1",
    toolName: "verify_finding",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function goodEvidence() {
  return [
    { ref: "ev-1", kind: "request-response", content: "200 OK body", metadata: { status: 200 } },
    { ref: "ev-2", kind: "observation", content: "header present" },
  ];
}

test("verify_finding accepts supported evidence via the default procedure", async () => {
  const tool = createVerifyFindingTool();
  const result = await tool.execute({ findingId: "f-1", procedure: "evidence-integrity", evidence: goodEvidence() }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.findingId, "f-1");
  assert.equal(result.value.verdict, "accept");
  assert.equal(result.value.reason, "Evidence is consistent and supports the finding");
  assert.deepEqual(result.value.evidenceRefs, ["ev-1", "ev-2"]);
  assert.equal(result.value.procedureReference, "evidence-integrity");
});

test("verify_finding returns inconclusive for insufficient evidence", async () => {
  const tool = createVerifyFindingTool();
  const result = await tool.execute({
    findingId: "f-2",
    procedure: "evidence-integrity",
    evidence: [{ ref: "ev-1", kind: "request-response", content: "" }],
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.verdict, "inconclusive");
  assert.match(result.value.reason, /Insufficient evidence/);
});

test("verify_finding rejects on error-status evidence", async () => {
  const tool = createVerifyFindingTool();
  const result = await tool.execute({
    findingId: "f-3",
    procedure: "evidence-integrity",
    evidence: [{ ref: "ev-1", kind: "request-response", content: "500 error", metadata: { status: 500 } }],
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.verdict, "reject");
  assert.match(result.value.reason, /error-status response/);
});

test("verify_finding supports an injected procedure runner", async () => {
  const calls = [];
  const tool = createVerifyFindingTool({
    procedureRunner: async (input) => {
      calls.push(input.findingId);
      return { verdict: "partial", reason: "some evidence matched", evidenceRefs: input.evidence.map(e => e.ref) };
    },
  });
  const result = await tool.execute({ findingId: "f-4", procedure: "custom", evidence: goodEvidence() }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.verdict, "partial");
  assert.deepEqual(calls, ["f-4"]);
});

test("verify_finding structures a procedure failure", async () => {
  const tool = createVerifyFindingTool({
    procedureRunner: async () => { throw new Error("procedure exploded"); },
  });
  const result = await tool.execute({ findingId: "f-5", procedure: "custom", evidence: goodEvidence() }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VERIFY_FINDING_PROCEDURE_FAILED");
  assert.match(result.error.message, /procedure exploded/);
});

test("verify_finding rejects malformed input", async () => {
  const tool = createVerifyFindingTool();
  assert.equal((await tool.execute({}, execContext())).error.code, "INVALID_VERIFY_FINDING_INPUT");
  assert.equal((await tool.execute({ findingId: "f", procedure: "p", evidence: [] }, execContext())).error.code, "INVALID_VERIFY_FINDING_INPUT");
  assert.equal((await tool.execute({ findingId: "f", procedure: "p", evidence: [{ ref: "", kind: "k" }] }, execContext())).error.code, "INVALID_VERIFY_FINDING_INPUT");
  assert.equal((await tool.execute({ findingId: "f", procedure: "p", evidence: [{ ref: "r", kind: "k", metadata: "x" }] }, execContext())).error.code, "INVALID_VERIFY_FINDING_INPUT");
  assert.equal((await tool.execute({ findingId: "", procedure: "p", evidence: goodEvidence() }, execContext())).error.code, "INVALID_VERIFY_FINDING_INPUT");
});

test("verify_finding rejects an unrestricted execution context projection", async () => {
  const tool = createVerifyFindingTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-verify-2",
    toolName: "verify_finding",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ findingId: "f", procedure: "p", evidence: goodEvidence() }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("verify_finding registration adds exactly one raw tool entry", () => {
  const tool = createVerifyFindingTool();
  const registry = createToolRegistry();
  const entry = registerVerifyFinding(registry, tool);
  assert.equal(entry.name, "verify_finding");
  assert.deepEqual(registry.names(), ["verify_finding"]);
  assert.throws(() => registerVerifyFinding(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("verify_finding stays separate from lifecycle verification", async () => {
  const tool = createVerifyFindingTool();
  const result = await tool.execute({ findingId: "f-6", procedure: "evidence-integrity", evidence: goodEvidence() }, execContext());
  assert.equal(result.ok, true);
  assert.equal("verification" in result.value, false);
  assert.equal("recovery" in result.value, false);
  assert.equal("rollback" in result.value, false);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  // verdict is the domain finding verdict, not a lifecycle status
  assert.equal(result.value.verdict, "accept");
});