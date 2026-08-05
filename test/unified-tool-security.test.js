"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildUnifiedProviderCatalog } = require("../src/application/tools/provider-catalog");
const { PUBLIC_TOOL_NAMES, LEGACY_OR_INTERNAL_NAMES } = require("../src/contracts/tool/unified-catalog");
const { createUnifiedToolRouter } = require("../src/application/tools/unified-tool-router");
const { createExecutionContext } = require("../src/contracts/tool/execution-context");

test("CI rejects legacy/internal provider exposure and reports deterministic catalog budgets", () => {
  const catalog = buildUnifiedProviderCatalog("agent");
  assert.deepEqual(catalog.names, PUBLIC_TOOL_NAMES);
  assert.equal(catalog.catalogBytes, buildUnifiedProviderCatalog("agent").catalogBytes);
  assert.ok(catalog.catalogBytes < 64 * 1024);
  for (const name of LEGACY_OR_INTERNAL_NAMES) assert.equal(catalog.names.includes(name), false);
  for (const size of Object.values(catalog.schemaBytes)) assert.ok(size < 12 * 1024);
});

test("router rejects generic security and active calls without typed scope/adapter paths", async () => {
  const router = createUnifiedToolRouter({ ports: { exec_command: { execute: async () => ({ ok: true }) } } });
  const command = await router.execute("exec_command", { action: "execute", command: "nmap leadbondhuai.online" }, { profile: "agent" });
  assert.equal(command.status, "denied");
  assert.equal(command.code, "TYPED_VAPT_OPERATION_REQUIRED");
  const active = await router.execute("run_test_case", { action: "execute", assessment_id: "a", executor: "nmap", category: "recon", target: "https://leadbondhuai.online", scope_decision_id: "missing", test_case_id: "nmap" }, { profile: "agent" });
  assert.equal(active.status, "denied");
  assert.equal(active.code, "SCOPE_DENIED");
});

test("operation context cancellation remains observable to application ports", () => {
  const context = createExecutionContext({ operationId: "op", auditId: "audit" });
  context.cancel();
  assert.equal(context.isCancelled(), true);
  assert.throws(() => context.throwIfCancelled(), /cancelled/i);
});
