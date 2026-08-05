"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createUnifiedToolRouter } = require("../src/application/tools/unified-tool-router");
const { createExecutionContext } = require("../src/contracts/tool/execution-context");
const { issueScopeDecision } = require("../src/contracts/tool/scope-decision");
const { issueApprovalGrant } = require("../src/contracts/tool/approval-grant");

function scopeFor(input, operationCategory = "test_case") {
  return issueScopeDecision({
    assessmentId: input.assessment_id,
    actorId: "agent",
    target: input.target,
    operationCategory,
    operationInput: input,
    expiresAt: Date.now() + 10000,
    integrityTag: "test-integrity",
  });
}

test("router rejects unknown, legacy, malformed, and profile-denied calls before port dispatch", async () => {
  let calls = 0;
  const router = createUnifiedToolRouter({ ports: { read_file: { execute: async () => { calls += 1; return { ok: true }; } } } });
  assert.equal((await router.execute("run_security_tool", {})).code, "UNKNOWN_TOOL");
  assert.equal((await router.execute("read_file", { action: "write", path: "a.txt" })).code, "UNKNOWN_ACTION");
  assert.equal((await router.execute("read_file", { action: "read", path: "a.txt", extra: true })).code, "INVALID_INPUT");
  assert.equal((await router.execute("apply_patch", { action: "apply", path: "a.txt", patches: [] }, { profile: "ask" })).code, "PROFILE_DENIED");
  assert.equal(calls, 0);
});

test("router creates operation and audit references before unavailable and policy denial", async () => {
  const audit = [];
  const router = createUnifiedToolRouter({ auditSink: (entry) => audit.push(entry), policy: () => ({ allowed: false, code: "SCOPE_DENIED", reason: "not authorized" }) });
  const result = await router.execute("read_file", { action: "read", path: "a.txt" });
  assert.equal(result.status, "denied");
  assert.equal(result.code, "SCOPE_DENIED");
  assert.match(result.operation_id, /^operation-/);
  assert.match(result.audit_id, /^audit-/);
  assert.ok(audit.some((entry) => entry.event === "operation_created"));
});

test("router dispatches only typed ports and projects the standard envelope", async () => {
  let receivedContext = null;
  const router = createUnifiedToolRouter({
    ports: {
      read_file: {
        async execute(input, context) {
          receivedContext = context;
          return { ok: true, summary: "read", content: "bounded content", token: "secret" };
        },
      },
    },
  });
  const result = await router.execute("read_file", { action: "read", path: "README.md" });
  assert.equal(result.status, "success");
  assert.equal(result.redactions_applied, true);
  assert.equal(result.data.content, "bounded content");
  assert.equal(result.data.token, undefined);
  assert.equal(receivedContext.operationId, result.operation_id);
  assert.equal(receivedContext.auditId, result.audit_id);
});

test("router requires a bound scope decision for active typed operations", async () => {
  let dispatched = false;
  const router = createUnifiedToolRouter({ ports: { run_test_case: { execute: async () => { dispatched = true; return { ok: true }; } } } });
  const input = { action: "execute", assessment_id: "assessment-1", executor: "nmap", category: "recon", target: "https://leadbondhuai.online", scope_decision_id: "scope-1", test_case_id: "case-1" };
  const denied = await router.execute("run_test_case", input, { actorId: "agent" });
  assert.equal(denied.status, "denied");
  assert.equal(denied.code, "SCOPE_DENIED");
  assert.equal(dispatched, false);
});

test("router validates scope, requests bounded approval, and dispatches after grant", async () => {
  let dispatched = false;
  const input = { action: "execute", assessment_id: "assessment-1", executor: "nmap", category: "recon", target: "https://leadbondhuai.online", scope_decision_id: "scope-1", test_case_id: "case-1" };
  const scopeDecision = scopeFor(input);
  const grant = issueApprovalGrant({ assessmentId: "assessment-1", actorId: "agent", runId: "run-1", targetPattern: "leadbondhuai.online", operationCategories: ["test_case"], allowedTestCategories: ["recon"], expiresAt: Date.now() + 10000, authorizationVersion: "authorization-v1", integrityTag: "test" });
  const router = createUnifiedToolRouter({
    ports: { run_test_case: { execute: async () => { dispatched = true; return { ok: true, summary: "tested" }; } } },
    policy: () => ({ allowed: true, requiresApproval: true }),
    requestApproval: async () => grant,
  });
  const result = await router.execute("run_test_case", input, { actorId: "agent", runId: "run-1", scopeDecision });
  assert.equal(result.status, "success");
  assert.equal(dispatched, true);
});

test("router returns unavailable without a generic fallback and cancellation is terminal", async () => {
  const browserInput = { action: "navigate", assessment_id: "assessment-1", target: "https://leadbondhuai.online", scope_decision_id: "scope-1" };
  const unavailable = await createUnifiedToolRouter().execute("browser_action", browserInput, { actorId: "agent", scopeDecision: scopeFor({ ...browserInput, target: browserInput.target }, "browser") });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.code, "ADAPTER_UNAVAILABLE");

  const controller = new AbortController();
  const router = createUnifiedToolRouter({ ports: { read_file: { execute: async (_input, context) => { context.throwIfCancelled(); return { ok: true }; } } } });
  controller.abort();
  const cancelled = await router.execute("read_file", { action: "read", path: "a.txt" }, { abortSignal: controller.signal });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.code, "OPERATION_CANCELLED");
});
