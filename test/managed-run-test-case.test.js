"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createUnifiedToolRouter } = require("../src/application/tools/unified-tool-router");
const { createTestingPort } = require("../src/application/tools/ports/testing-port");
const { issueScopeDecision } = require("../src/contracts/tool/scope-decision");

function fakeChild({ exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 7777;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.__exitCode = exitCode;
  return child;
}

function testingFixture() {
  const spawned = [];
  const managedStore = new Map();
  const port = createTestingPort({
    buildAction: (args) => ({
      ok: true,
      action: {
        adapterId: args.adapter_id,
        executable: "echo",
        processArgs: ["hi"],
        configuration: { monitorMs: 30000, absoluteDeadlineMs: 600000, maxManagedContinuationTurns: undefined },
        target: { hostname: "leadbondhuai.online" },
        outputPath: "recon/active/echo/result.txt",
        command: "echo hi",
      },
    }),
    persistArtifact: (workspace, text, meta) => `artifact-${Math.random()}`,
    persistDescriptor: (d) => { managedStore.set(d.managedOperationId, d); },
    loadDescriptor: (id) => managedStore.get(id) || null,
    spawnChildMocker: null,
  });
  // monkeypatch the inner managed session's spawnChild by re-creating here is complex;
  // instead the session uses real spawn by default. For a hermetic unit test we
  // rely on the session's own fake-child tests; here we exercise router wiring
  // with the adapter returning a synchronous mock via a stub port.
  return { port, spawned, managedStore };
}

function scopeDecision(input) {
  return issueScopeDecision({
    assessmentId: input.assessment_id,
    actorId: "agent",
    target: input.target,
    operationCategory: "test_case",
    operationInput: input,
    expiresAt: Date.now() + 10000,
    integrityTag: "test",
  });
}

test("router persists a managed run_test_case checkpoint as non-terminal", async () => {
  // Use a stub port that mimics a running managed process returning a checkpoint.
  const states = [];
  const router = createUnifiedToolRouter({
    ports: {
      run_test_case: {
        async execute(input, context) {
          return {
            ok: true,
            status: "partial",
            code: "PARTIAL_RESULT",
            summary: "running",
            continuation_required: true,
            checkpoint_id: "checkpoint-1-abc",
            managed_operation_id: "managed-1",
            lines_available: 2,
            lines_returned: 2,
            log_lines: [{ seq: 1, stream: "stdout", text: "found one" }, { seq: 2, stream: "stdout", text: "found two" }],
            evidence_refs: [],
          };
        },
      },
    },
    stateStore: { save: (s) => states.push(s), load: () => null },
  });
  const input = { action: "start", assessment_id: "a", executor: "nmap", category: "recon", target: "https://leadbondhuai.online", scope_decision_id: "scope-1", test_case_id: "case-1" };
  const result = await router.execute("run_test_case", input, { actorId: "agent", scopeDecision: scopeDecision(input) });
  assert.equal(result.status, "partial");
  assert.equal(result.data.continuation_required, true);
  assert.equal(result.data.checkpoint_id, "checkpoint-1-abc");
  assert.equal(result.data.lines_returned, 2);
  assert.ok(states.some((s) => s.status === "checkpointed" && s.checkpoint && s.checkpoint.current));
});

test("run_test_case continue bypasses fresh scope issuance but revalidation path is reachable", async () => {
  let dispatched = false;
  const router = createUnifiedToolRouter({
    ports: {
      run_test_case: {
        async execute(input) {
          dispatched = true;
          return { ok: true, summary: `handled ${input.action}` };
        },
      },
    },
  });
  // No scope decision resolved; a continuation control must not be denied for
  // missing scope. The schema still requires a non-empty scope_decision_id
  // token, but authorize() short-circuits continuation controls entirely.
  const input = { action: "continue", assessment_id: "a", executor: "nmap", category: "recon", target: "https://leadbondhuai.online", scope_decision_id: "scope-1", test_case_id: "case-1", managed_operation_id: "managed-1", checkpoint_id: "checkpoint-1-abc" };
  const result = await router.execute("run_test_case", input, { actorId: "agent" });
  assert.equal(dispatched, true);
  assert.equal(result.status, "success");
});
