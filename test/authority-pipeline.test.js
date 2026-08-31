"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createExecutionContext, projectExecutionContext, isRestrictedToolContext } = require("../src/contracts/tool/execution-context.js");
const { createAuthorityComposition } = require("../src/agent/authority/composition.js");
const { createInvocationPipeline } = require("../src/agent/authority/invocation-pipeline.js");
const { moduleOrder } = require("../src/agent/authority/gates/pipeline-manifest.js");
const { MODE_TOOL_GROUPS, TOOL_REGISTRY_NAMES } = require("../src/agent/tools/config/tool-metadata.js");
const { createRoleAccessGate } = require("../src/agent/authority/gates/role-access-gate.js");
const { createRequestValidationGate } = require("../src/agent/authority/gates/request-validation-gate.js");
const { classifyScope, createScopeBasedGate } = require("../src/agent/authority/gates/scope-based-gate.js");
const { createAllowListGate } = require("../src/agent/authority/gates/allow-list-gate.js");
const { createDenyListGate } = require("../src/agent/authority/gates/deny-list-gate.js");
const { createIdentityContextGate } = require("../src/agent/authority/gates/identity-context-gate.js");
const { classifyRisk } = require("../src/agent/authority/gates/risk-classifier-module.js");
const { createAuthorityPolicyGate } = require("../src/agent/authority/gates/authority-policy-gate.js");
const { createApprovalGate } = require("../src/agent/authority/gates/approval-gate.js");
const { createEnvironmentGate } = require("../src/agent/authority/gates/environment-gate.js");
const { createResourceLimitGate, requestedResources } = require("../src/agent/authority/gates/resource-limit-gate.js");
const { createConcurrencyCoordinator, resourceClaims } = require("../src/agent/authority/gates/concurrency-gate.js");
const { timeoutPolicyFor } = require("../src/agent/authority/gates/timeout-module.js");
const { runMonitoredExecution } = require("../src/agent/authority/gates/execution-monitor-module.js");
const { boundValue } = require("../src/agent/authority/gates/output-control-gate.js");
const { verifyLifecycle } = require("../src/agent/authority/gates/verification-module.js");
const { selectRecovery } = require("../src/agent/authority/gates/recovery-module.js");
const { performRollback } = require("../src/agent/authority/gates/rollback-module.js");
const { createInvocationState } = require("../src/agent/authority/invocation-state.js");
const { createToolAuditStore } = require("../src/app/storage/tool-audit-store.js");

function executionContext(root, overrides = {}) {
  return createExecutionContext({
    invocationId: overrides.invocationId || `inv-${Math.random().toString(36).slice(2)}`,
    toolName: overrides.toolName || "read_file",
    role: overrides.role || "agent",
    authority: overrides.authority || "full_authority",
    workspace: { root },
    sessionId: overrides.sessionId || "session-1",
    mode: overrides.role || "agent",
    identityContext: overrides.identityContext || { identityId: "", pageId: "main" },
    resourceLimits: overrides.resourceLimits || { outputBytes: 100_000, processCount: 4, maximumConcurrency: 4, requestsPerSecond: 10 },
    ...(overrides.delegationContext ? { delegationContext: overrides.delegationContext } : {}),
  });
}

function entry(name = "read_file", metadata = {}) {
  return {
    name,
    adapter: { execute: async () => ({ ok: true }) },
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", minLength: 1 }, flags: { type: "array", items: { type: "string" }, uniqueItems: true } }, additionalProperties: false },
    metadata: { mutating: false, reversible: true, targetTypes: ["file"], targetArguments: ["path"], ...metadata },
  };
}

test("G0/G20/C1 registry contains exactly one resolver, 19 resolved stages, and three production profiles", () => {
  const composition = createAuthorityComposition({ evaluateScope: async () => ({ ok: true }) });
  assert.equal(composition.registry.modules().length, 20);
  assert.deepEqual(composition.registry.modules().map((item) => item.name).sort(), ["authority_profile_resolver", ...moduleOrder].sort());
  assert.deepEqual(composition.registry.profiles().map((item) => item.id).sort(), ["approve_for_me", "ask_for_approval", "full_authority"]);
  for (const profile of composition.registry.profiles()) {
    assert.equal(profile.modulePipeline[0], "role_access_gate");
    assert.equal(profile.modulePipeline.includes("authority_profile_resolver"), false);
    assert.equal(new Set(profile.modulePipeline).size, profile.modulePipeline.length);
  }
  assert.equal(composition.registry.profile("full_authority").modulePipeline.includes("approval_gate"), false);
});

test("G1 role access enforces every canonical mode surface under every authority", async () => {
  const gate = createRoleAccessGate();
  for (const authority of ["ask_for_approval", "approve_for_me", "full_authority"]) {
    for (const mode of Object.keys(MODE_TOOL_GROUPS)) {
      for (const toolName of TOOL_REGISTRY_NAMES) {
        if (!MODE_TOOL_GROUPS[mode].includes(toolName)) continue;
        const decision = await gate.evaluate({ context: { role: mode, authority }, toolName, entry: entry(toolName) });
        assert.equal(decision.decision, "allow", `${authority}/${mode}/${toolName}`);
      }
    }
  }
});

test("G2 request validation applies schema structure and canonicalizes nested targets", async () => {
  const gate = createRequestValidationGate();
  const state = createInvocationState({ invocationId: "inv-validation" });
  const root = path.resolve("validation-workspace");
  const toolEntry = {
    ...entry("fixture"),
    inputSchema: {
      type: "object",
      required: ["path", "request"],
      properties: {
        path: { type: "string", minLength: 1 },
        request: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" } }, additionalProperties: false },
        mode: { oneOf: [{ type: "string", enum: ["a"] }, { type: "integer", minimum: 1 }] },
      },
      additionalProperties: false,
    },
    metadata: { targetArguments: ["path", "request.url"] },
  };
  const valid = await gate.evaluate({ context: { workspace: { root } }, entry: toolEntry, args: { path: "src/file.js", request: { url: "HTTPS://Example.COM:443/a#x" }, mode: "a" }, state });
  assert.equal(valid.decision, "allow");
  assert.ok(state.normalizedTargets.some((target) => target.kind === "file" && target.value === path.resolve(root, "src/file.js")));
  assert.ok(state.normalizedTargets.some((target) => target.kind === "network" && target.value === "https://example.com/a"));
  const invalid = await gate.evaluate({ context: { workspace: { root } }, entry: toolEntry, args: { path: "", request: { url: "not a URI", extra: true }, extra: true }, state: createInvocationState() });
  assert.equal(invalid.terminal, true);
  assert.equal(invalid.metadata.code, "INVALID_TOOL_INPUT");
});

test("G3 typed scope permits in-scope, defers only explicit soft boundaries, and terminates hard boundaries", async () => {
  assert.equal(classifyScope({ ok: true }), "in_scope");
  assert.equal(classifyScope({ ok: false, boundary: "soft" }), "soft_violation");
  assert.equal(classifyScope({ ok: false, code: "WORKSPACE_OUT_OF_SCOPE" }), "hard_violation");
  for (const fixture of [
    [{ ok: true, code: "TARGET_IN_SCOPE" }, "allow", false],
    [{ ok: false, boundary: "soft", code: "SCOPE_REVIEW" }, "defer", false],
    [{ ok: false, code: "TARGET_OUT_OF_SCOPE" }, "deny", true],
  ]) {
    const state = createInvocationState();
    const gate = createScopeBasedGate({ evaluateScope: async () => fixture[0] });
    const result = await gate.evaluate({ context: { workspace: { root: "C:/w" } }, toolName: "read_file", args: {}, entry: entry(), state, runtime: {} });
    assert.equal(result.decision, fixture[1]);
    assert.equal(result.terminal, fixture[2]);
  }
});

test("G4/G5 explicit allow and deny rules match tool, operation, command, path, domain, and arguments independently", async () => {
  const context = { authorityRules: {} };
  const state = createInvocationState();
  state.normalizedTargets = [
    { kind: "file", value: "C:\\workspace\\reports\\one.txt" },
    { kind: "network", value: "https://api.example.test/v1" },
  ];
  const args = { operation: "run", command: "nmap -sV api.example.test", options: { rate: "safe" } };
  const allowGate = createAllowListGate();
  const allowed = await allowGate.evaluate({ context, toolName: "exec_command", args, state, runtime: { authorityRules: { allow: [{ id: "allow-scan", tool: "exec_*", operation: "run", command: "nmap *", arguments: { "options.rate": "safe" }, restrictions: [{ type: "rate", maximum: 5 }] }] } } });
  assert.equal(allowed.decision, "restrict");
  assert.equal(allowed.terminal, false);
  const denyGate = createDenyListGate();
  const denied = await denyGate.evaluate({ context, toolName: "exec_command", args, state, runtime: { authorityRules: { deny: [{ id: "deny-target", tool: "exec_command", domains: "*.example.test", reason: "Fixture denied" }] } } });
  assert.equal(denied.decision, "deny");
  assert.equal(denied.metadata.rule, "deny-target");
});

test("G6 identity gate validates configured identities and prevents delegated identity expansion", async () => {
  const gate = createIdentityContextGate();
  const state = createInvocationState();
  state.normalizedTargets = [{ kind: "identity", type: "identityid", value: "account-a" }];
  const accepted = await gate.evaluate({ context: { sessionId: "s", identityContext: { identityId: "account-a" } }, toolName: "browser_action", args: { identityId: "account-a" }, state, runtime: { identityExists: async (id) => id === "account-a" } });
  assert.equal(accepted.decision, "allow");
  const unknown = await gate.evaluate({ context: { sessionId: "s", identityContext: { identityId: "missing" } }, toolName: "browser_action", args: { identityId: "missing" }, state, runtime: { identityExists: async () => false } });
  assert.equal(unknown.metadata.code, "IDENTITY_NOT_CONFIGURED");
  const delegated = await gate.evaluate({ context: { sessionId: "s", identityContext: { identityId: "account-b" }, delegationContext: { parentIdentityId: "account-a" } }, toolName: "browser_action", args: { identityId: "account-b" }, state, runtime: {} });
  assert.equal(delegated.metadata.code, "DELEGATED_IDENTITY_EXPANSION");
});

test("G7 risk classification is deterministic and never makes an authority decision", () => {
  const low = classifyRisk({ toolName: "exec_command", args: { operation: "status", process_id: "p" }, entry: entry("exec_command", { mutating: true, reversible: false }) });
  const high = classifyRisk({ toolName: "exec_command", args: { operation: "start", command: "scanner", identityId: "account-a", execution: { mode: "barrier", repetitions: 12 } }, entry: entry("exec_command", { mutating: true, reversible: false }) });
  assert.equal(low.level, "low");
  assert.equal(high.level, "high");
  assert.ok(high.dimensions.length > low.dimensions.length);
  assert.equal(Object.hasOwn(high, "decision"), false);
});

test("G8/G9 policy requests approval only for exec_command and records command approval", async () => {
  const policyGate = createAuthorityPolicyGate();
  const state = createInvocationState();
  state.scopeDecision = "soft_violation";
  state.risk = { level: "low" };
  state.allowList = { matched: true };
  const conditional = await policyGate.evaluate({ state, profile: { id: "approve_for_me", approvalMode: "conditional", policy: { softScope: "require_approval" } }, toolName: "exec_command", entry: entry("exec_command", { mutating: true, reversible: false }), runtime: {} });
  assert.equal(conditional.decision, "require_approval");
  const nonCommand = await policyGate.evaluate({ state: Object.assign(createInvocationState(), { scopeDecision: "in_scope", risk: { level: "high" }, allowList: { matched: false, required: true } }), profile: { id: "ask_for_approval", approvalMode: "always", policy: {} }, toolName: "apply_patch", entry: entry("apply_patch", { mutating: true, reversible: true }), runtime: {} });
  assert.equal(nonCommand.decision, "allow", "apply_patch must not request interactive approval");
  const nonCommandSoftScope = await policyGate.evaluate({ state, profile: { id: "ask_for_approval", approvalMode: "always", policy: {} }, toolName: "replay_request", entry: entry("replay_request"), runtime: {} });
  assert.equal(nonCommandSoftScope.decision, "restrict", "a non-command soft-scope exception must fail closed without showing approval UI");
  const interactive = await policyGate.evaluate({
    state,
    profile: { id: "ask_for_approval", approvalMode: "always", policy: {} },
    toolName: "ask_questions",
    entry: entry("ask_questions", { interactive: true, targetTypes: ["operator", "interaction"] }),
    runtime: {},
  });
  assert.equal(interactive.decision, "allow", "asking the operator must not require approval to ask");
  state.decisions.push(conditional);
  const approval = await createApprovalGate().evaluate({ context: { invocationId: "i" }, state, profile: { id: "approve_for_me", approvalMode: "conditional" }, toolName: "exec_command", args: { command: "npm test" }, runtime: { approvalProvider: async () => ({ id: "approval-1", approved: true }) } });
  assert.equal(approval.decision, "allow");
  assert.equal(state.approval.id, "approval-1");
  const restricted = await policyGate.evaluate({ state, profile: { id: "full_authority", approvalMode: "disabled", policy: { softScope: "restrict" } }, toolName: "exec_command", entry: entry("exec_command"), runtime: {} });
  assert.equal(restricted.decision, "restrict");
  assert.equal(restricted.terminal, true);
});

test("G10 environment gate fails before execution when workspace or provider prerequisites are absent", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-environment-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gate = createEnvironmentGate();
  assert.equal((await gate.evaluate({ context: { workspace: { root: "" } }, toolName: "ask_questions", entry: entry("ask_questions", { interactive: true, targetTypes: ["operator"] }), runtime: {} })).decision, "allow");
  assert.equal((await gate.evaluate({ context: { workspace: { root } }, toolName: "read_file", entry: entry(), runtime: {} })).decision, "allow");
  assert.equal((await gate.evaluate({ context: { workspace: { root: path.join(root, "missing") } }, toolName: "read_file", entry: entry(), runtime: {} })).metadata.code, "WORKSPACE_UNAVAILABLE");
  assert.equal((await gate.evaluate({ context: { workspace: { root } }, toolName: "dynamic", entry: { adapter: null }, runtime: { dynamicTool: false } })).metadata.code, "EXECUTION_PROVIDER_UNAVAILABLE");
});

test("G11 resource gate understands nested barrier demand and current durable-process usage", async () => {
  const requested = requestedResources("run_test_case", { testCase: { steps: [
    { execution: { mode: "barrier", groupId: "g", repetitions: 2 } },
    { execution: { mode: "barrier", groupId: "g", repetitions: 3 } },
  ] } });
  assert.equal(requested.concurrency, 5);
  const state = createInvocationState();
  const denied = await createResourceLimitGate().evaluate({ context: { resourceLimits: { maximumConcurrency: 4, requestsPerSecond: 10 } }, toolName: "run_test_case", args: { testCase: { steps: [{ execution: { mode: "barrier", groupId: "g", repetitions: 5 } }] } }, state, runtime: {} });
  assert.equal(denied.metadata.code, "CONCURRENCY_LIMIT_EXCEEDED");
  const processDenied = await createResourceLimitGate().evaluate({ context: { resourceLimits: { maximumConcurrency: 4, requestsPerSecond: 10, processCount: 1 } }, toolName: "exec_command", args: { operation: "start" }, state: createInvocationState(), runtime: { resourceUsage: async () => ({ processCount: 1 }) } });
  assert.equal(processDenied.metadata.code, "PROCESS_LIMIT_EXCEEDED");
});

test("G12 reader/writer concurrency permits readers, queues a conflicting writer, and releases leases", async () => {
  const coordinator = createConcurrencyCoordinator({ pollMs: 2 });
  const first = await coordinator.acquireMany([{ key: "file:x", mode: "read" }], "reader-1");
  const second = await coordinator.acquireMany([{ key: "file:x", mode: "read" }], "reader-2");
  let writerAcquired = false;
  const writer = coordinator.acquireMany([{ key: "file:x", mode: "write" }], "writer").then((lease) => { writerAcquired = true; return lease; });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(writerAcquired, false);
  coordinator.release(first);
  coordinator.release(second);
  const writerLease = await writer;
  assert.equal(writerAcquired, true);
  coordinator.release(writerLease);
  assert.deepEqual(coordinator.snapshot(), []);
  const claims = resourceClaims({ context: { workspace: { root: "C:/w" } }, toolName: "exec_command", args: { operation: "status", process_id: "process-1" }, state: { normalizedTargets: [{ kind: "process", value: "process-1" }], risk: { dimensions: [] } } });
  assert.deepEqual(claims, [], "status observation must not block a concurrent stop request");
});

test("G13 timeout policy distinguishes explicit deadlines from disabled long-horizon defaults", () => {
  const defaultPolicy = timeoutPolicyFor("exec_command", { operation: "run" });
  assert.equal(defaultPolicy.hardMs, null);
  assert.equal(defaultPolicy.taskMs, null);
  assert.equal(defaultPolicy.workflowMs, null);
  assert.equal(defaultPolicy.sources.hard, "default_disabled");
  assert.equal(defaultPolicy.maxObservationExtensions, null);
  const explicit = timeoutPolicyFor("exec_command", { operation: "run", timeout_ms: 1_000 });
  assert.equal(explicit.hardMs, 1_000);
  assert.equal(explicit.sources.hard, "explicit");
  assert.equal(timeoutPolicyFor("exec_command", { operation: "start", timeout_ms: 1_000 }).hardMs, null);
  const observationsDisabled = timeoutPolicyFor("exec_command", { operation: "run" }, { startMs: 0, idleObservationMs: null, softObservationMs: false });
  assert.equal(observationsDisabled.startMs, null);
  assert.equal(observationsDisabled.idleObservationMs, null);
  assert.equal(observationsDisabled.softObservationMs, null);
  assert.equal(observationsDisabled.sources.idle, "explicit_disabled");
});

test("G14 monitor wraps execution in exact lifecycle order and preserves partial cancellation", async () => {
  const state = createInvocationState({ invocationId: "inv-monitor" });
  state.timeoutPolicy = { hardMs: null, idleObservationMs: 10_000, softObservationMs: 20_000, adaptive: true, maxObservationExtensions: null };
  const events = [];
  const result = await runMonitoredExecution({
    context: { invocationId: "inv-monitor" },
    state,
    emit: (event) => events.push(event),
    execute: async (runtime) => {
      runtime.childProcess({ pid: 42 });
      runtime.progress({ bytes: 10 });
      runtime.heartbeat({ phase: "alive" });
      return { ok: true, value: { done: true } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(events[0].type, "monitor_started");
  assert.equal(events[1].type, "execution_started");
  assert.deepEqual(events.slice(-2).map((event) => event.type), ["execution_completed", "monitor_completed"]);
  const controller = new AbortController();
  const cancelled = runMonitoredExecution({
    context: { invocationId: "inv-cancel" },
    state: Object.assign(createInvocationState(), { timeoutPolicy: {} }),
    signal: controller.signal,
    execute: (runtime) => new Promise((resolve) => runtime.signal.addEventListener("abort", () => resolve({ ok: true, value: { partial: true } }), { once: true })),
  });
  controller.abort();
  const stopped = await cancelled;
  assert.equal(stopped.ok, false);
  assert.equal(stopped.status, "partial");
  assert.equal(stopped.aborted, true);
});

test("G15 output control redacts secrets and bounds oversized output", () => {
  const safe = boundValue({ authorization: "Bearer abcdefghijklmnop", nested: { password: "secret" } }, 10_000);
  assert.equal(safe.value.authorization, "[REDACTED]");
  assert.equal(safe.value.nested.password, "[REDACTED]");
  const bounded = boundValue({ data: "x".repeat(10_000) }, 500);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.value.truncated, true);
});

test("G16/G17/G18 verification, recovery selection, and supported rollback remain separate", async () => {
  assert.equal(verifyLifecycle({ ok: true }).status, "verified");
  assert.equal(verifyLifecycle({ ok: false, error: { code: "X" } }).status, "failed");
  assert.equal(verifyLifecycle({ ok: false, value: { outputCompleteness: "partial" } }).status, "partial");
  const recovery = selectRecovery({ state: { verification: { status: "partial" }, rawResult: {}, restrictions: [] }, context: {} });
  assert.equal(recovery.status, "recovery_selected");
  assert.equal(recovery.action, "modify_arguments");
  const rollback = await performRollback({ context: {}, state: {}, runtime: { rollbackRequired: true, rollbackProvider: async () => ({ ok: true, action: "restore", restoredArtifacts: ["a"] }) } });
  assert.equal(rollback.status, "rollback_completed");
  assert.deepEqual(rollback.restoredArtifacts, ["a"]);
});

test("G19/C2/C4 pipeline executes once in order, redacts output, and audits Full Authorization approval skip", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-pipeline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const composition = createAuthorityComposition({ evaluateScope: async () => ({ ok: true, code: "IN_SCOPE" }) });
  const pipeline = createInvocationPipeline({ authorityRegistry: composition.registry, concurrency: composition.concurrency });
  const events = [];
  let executions = 0;
  let approvals = 0;
  const toolEntry = entry("read_file");
  const auditStore = createToolAuditStore();
  const result = await pipeline.invoke({
    context: executionContext(root, { toolName: "read_file", role: "agent", authority: "full_authority" }),
    toolName: "read_file",
    args: { path: "package.json" },
    entry: toolEntry,
    execute: async () => { executions += 1; return { ok: true, value: { authorization: "Bearer abcdefghijklmnop", content: "ok" } }; },
    runtime: {
      approvalProvider: async () => { approvals += 1; return { approved: true }; },
      onEvent: (event) => events.push(event),
      audit: auditStore,
    },
  });
  assert.equal(executions, 1);
  assert.equal(approvals, 0);
  assert.equal(result.ok, true);
  assert.equal(result.value.authorization, "[REDACTED]");
  assert.equal(events.filter((event) => event.stage === "authority_profile_resolver").length, 1);
  assert.equal(events.some((event) => event.stage === "approval_stage_skipped"), true);
  assert.equal(events.at(-1).stage, "audit_module");
  assert.ok(result.auditReference);
  const auditVerification = auditStore.verify(root);
  assert.equal(auditVerification.ok, true);
  assert.ok(auditVerification.records >= 20);
  assert.match(auditVerification.tailHash, /^[a-f0-9]{64}$/);
  const rawContext = projectExecutionContext(executionContext(root));
  assert.equal(isRestrictedToolContext(rawContext), true);
  assert.equal(Object.hasOwn(rawContext, "authority"), false);
  assert.equal(Object.hasOwn(rawContext, "role"), false);
});

test("G19 protected audit verifier detects a modified lifecycle record", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-audit-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = createToolAuditStore();
  audit.append(root, { type: "first", invocationId: "inv-1" });
  audit.append(root, { type: "second", invocationId: "inv-2" });
  assert.equal(audit.verify(root).ok, true);
  const file = audit.fileFor(root);
  const records = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  records[0].invocationId = "tampered";
  fs.writeFileSync(file, `${records.map(JSON.stringify).join("\n")}\n`);
  const verification = audit.verify(root);
  assert.equal(verification.ok, false);
  assert.equal(verification.code, "AUDIT_INTEGRITY_FAILED");
  assert.equal(verification.record, 1);
});

test("hard scope denials remain enforced while selected modes do not deny tools", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-hard-deny-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const authority of ["ask_for_approval", "approve_for_me", "full_authority"]) {
    const composition = createAuthorityComposition({ evaluateScope: async () => ({ ok: false, code: "TARGET_OUT_OF_SCOPE", reason: "outside" }) });
    const pipeline = createInvocationPipeline({ authorityRegistry: composition.registry, concurrency: composition.concurrency });
    let raw = 0;
    let approval = 0;
    const result = await pipeline.invoke({
      context: executionContext(root, { authority, role: "agent" }),
      toolName: "read_file",
      args: { path: "x" },
      entry: entry(),
      execute: async () => { raw += 1; return { ok: true }; },
      runtime: { approvalProvider: async () => { approval += 1; return { approved: true }; } },
    });
    assert.equal(result.outcome, "denied");
    assert.equal(raw, 0);
    assert.equal(approval, 0);
  }
  const modeDecision = await createRoleAccessGate().evaluate({
    context: executionContext(root, { role: "ask", authority: "full_authority", toolName: "exec_command" }),
    toolName: "exec_command",
    args: { operation: "run", command: "echo ok" },
    entry: entry("exec_command"),
  });
  assert.equal(modeDecision.decision, "allow");
});
