"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTEXT_ERROR_CODES,
  createExecutionContext,
  deriveDelegatedExecutionContext,
  isRestrictedToolContext,
  projectExecutionContext,
  validateExecutionContext,
} = require("../src/contracts/tool/execution-context");

function context(overrides = {}) {
  return createExecutionContext({
    invocationId: "invocation-1",
    toolName: "fixture_tool",
    role: "agent",
    authority: "approve_for_me",
    actor: "operator-1",
    task: { id: "task-1" },
    workspace: { root: "G:/workspace" },
    declaredScope: { targets: ["example.test"] },
    identityContext: { sessionId: "session-1" },
    delegationContext: { allowed: true },
    requestMetadata: { source: "test" },
    declaredObjective: "exercise fixture",
    expectedOutcome: { status: "success" },
    resourceLimits: { outputBytes: 1000, processCount: 2 },
    ...overrides,
  });
}

test("execution context validates required identity and authority fields", () => {
  assert.equal(validateExecutionContext(context()).ok, true);
  assert.equal(validateExecutionContext({}).error.code, CONTEXT_ERROR_CODES.MISSING_FIELD);
  assert.throws(() => createExecutionContext({ invocationId: "x", toolName: "tool", role: "agent" }), /authority/);
});

test("execution context is deeply immutable after creation", () => {
  const value = context();
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.declaredScope), true);
  assert.throws(() => { value.role = "ask"; }, TypeError);
  assert.throws(() => { value.declaredScope.targets.push("other.test"); }, TypeError);
  assert.equal(value.role, "agent");
});

test("delegated context inherits parent linkage and cannot expand bounded fields", () => {
  const parent = context();
  const child = deriveDelegatedExecutionContext(parent, {
    invocationId: "invocation-2",
    declaredScope: { targets: ["example.test"] },
    resourceLimits: { outputBytes: 500, processCount: 1 },
    delegationContext: { childAgent: "specialist-1" },
  });

  assert.equal(child.parentInvocationId, parent.invocationId);
  assert.equal(child.delegationContext.parentInvocationId, parent.invocationId);
  assert.deepEqual(child.resourceLimits, { outputBytes: 500, processCount: 1 });
  assert.throws(() => deriveDelegatedExecutionContext(parent, {
    invocationId: "invocation-3",
    role: "full_authority",
  }), /role cannot expand/);
  assert.throws(() => deriveDelegatedExecutionContext(parent, {
    invocationId: "invocation-4",
    declaredScope: { targets: ["outside.example"] },
  }), /declaredScope cannot expand/);
  assert.throws(() => deriveDelegatedExecutionContext(parent, {
    invocationId: "invocation-5",
    resourceLimits: { outputBytes: 2000 },
  }), /resourceLimits cannot expand/);
  assert.throws(() => deriveDelegatedExecutionContext(parent, {
    invocationId: "invocation-6",
    identityContext: { sessionId: "session-2" },
  }), /identityContext cannot expand/);
});

test("restricted tool projection exposes only capability fields and stays frozen", () => {
  const full = context();
  const projected = projectExecutionContext(full);

  assert.equal(isRestrictedToolContext(projected), true);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(projected.invocationId, full.invocationId);
  assert.equal(projected.toolName, full.toolName);
  assert.deepEqual(projected.workspace, full.workspace);
  assert.equal("role" in projected, false);
  assert.equal("authority" in projected, false);
  assert.equal("declaredScope" in projected, false);
  assert.equal("declaredObjective" in projected, false);
  assert.equal("requestMetadata" in projected, false);
  assert.throws(() => { projected.workspace = {}; }, TypeError);
  assert.throws(() => projectExecutionContext({ invocationId: "x" }), /frozen execution context/);
});

test("projected execution contexts carry scope-only execution metadata", () => {
  const projected = projectExecutionContext(context({ authority: "scope_only" }));
  assert.equal(projected.contextKind, "raw_tool_projection");
  assert.equal("approval" in projected, false);
  assert.equal("policy" in projected, false);
});
