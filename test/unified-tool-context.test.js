"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutionContext } = require("../src/contracts/tool/execution-context");
const { createOperationContext } = require("../src/application/tools/operation-context");
const { issueScopeDecision, validateScopeDecision, operationDigest } = require("../src/contracts/tool/scope-decision");
const { issueApprovalGrant, validateApprovalGrant } = require("../src/contracts/tool/approval-grant");
const { validateOperationState } = require("../src/contracts/tool/operation-state");

test("execution context enforces abort and deadline boundaries", () => {
  const controller = new AbortController();
  const context = createExecutionContext({ operationId: "op-1", auditId: "audit-1", abortSignal: controller.signal, deadline: Date.now() + 5000 });
  assert.equal(context.isCancelled(), false);
  assert.equal(context.remainingMs() > 0, true);
  controller.abort();
  assert.equal(context.isCancelled(), true);
  assert.throws(() => context.throwIfCancelled(), /Operation cancelled/);
});

test("operation context creates audit before transitions and terminal state is idempotent", () => {
  const audit = [];
  const operation = createOperationContext({ operationId: "op-2", auditId: "audit-2", toolName: "read_file", auditSink: (entry) => audit.push(entry) });
  assert.equal(operation.status, "created");
  operation.transition("dispatching");
  operation.addEvidence(["evidence-1"]);
  operation.markCleanup({ completed: true });
  operation.transition("success");
  operation.transition("failed");
  assert.equal(operation.status, "success");
  assert.ok(audit.some((entry) => entry.event === "operation_created"));
  assert.deepEqual(operation.snapshot().evidenceRefs, ["evidence-1"]);
});

test("scope decisions bind target, category, digest, versions, and expiry", () => {
  const input = { target: "https://leadbondhuai.online", action: "read" };
  const decision = issueScopeDecision({ assessmentId: "assessment-1", actorId: "run-1", target: input.target, operationCategory: "replay", operationInput: input, expiresAt: Date.now() + 10000, integrityTag: "tag" });
  assert.equal(validateScopeDecision(decision, { assessmentId: "assessment-1", actorId: "run-1", target: input.target, operationCategory: "replay", operationInput: input }).ok, true);
  assert.equal(operationDigest(input), decision.operation_digest);
  assert.equal(validateScopeDecision(decision, { operationInput: { target: input.target, action: "write" } }).ok, false);
});

test("approval grants enforce run, target, category, expiry, and revocation", () => {
  const grant = issueApprovalGrant({ assessmentId: "assessment-1", actorId: "operator", runId: "run-1", targetPattern: "leadbondhuai.online", operationCategories: ["replay"], expiresAt: Date.now() + 10000, integrityTag: "tag" });
  assert.equal(validateApprovalGrant(grant, { assessmentId: "assessment-1", actorId: "operator", runId: "run-1", target: "leadbondhuai.online", operationCategory: "replay" }).ok, true);
  assert.equal(validateApprovalGrant(grant, { target: "other.example", operationCategory: "replay" }).ok, false);
  assert.equal(validateApprovalGrant({ ...grant, revoked: true }).ok, false);
});

test("operation state validation rejects incomplete terminal records", () => {
  assert.equal(validateOperationState({ state: "dispatching", operationId: "op", auditId: "audit" }).ok, true);
  assert.equal(validateOperationState({ state: "terminal", resultStatus: "success", operationId: "op", auditId: "audit" }).ok, true);
  assert.equal(validateOperationState({ state: "terminal", operationId: "op", auditId: "audit" }).ok, false);
});
