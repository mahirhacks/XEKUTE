"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunTestCaseTool } = require("../src/agent/tools/assessment/run-test-case.js");
const { createToolRegistry, registerRunTestCase } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-testcase-1",
    toolName: "run_test_case",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function createFixtureRunTestCaseTool() {
  return createRunTestCaseTool({
    stepExecutor: async (step) => ({
      ok: true,
      observed: step.input !== undefined ? step.input : { action: step.action, id: step.id },
    }),
  });
}

test("run_test_case passes a deterministic fixture and records step evidence", async () => {
  const tool = createFixtureRunTestCaseTool();
  const result = await tool.execute({
    testCase: {
      id: "tc-1",
      name: "Happy path",
      steps: [
        { id: "s1", action: "check-echo", input: { value: "hello" }, expected: { value: "hello" } },
        { id: "s2", action: "check-status", input: { status: 200 }, expected: { status: 200 } },
      ],
    },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.outcome, "passed");
  assert.equal(result.value.passedSteps, 2);
  assert.equal(result.value.failedSteps, 0);
  assert.equal(result.value.evidence.length, 2);
  assert.equal(result.value.evidence[0].passed, true);
  assert.equal(result.value.evidence[0].observed.value, "hello");
});

test("run_test_case fails a step with structured evidence", async () => {
  const tool = createFixtureRunTestCaseTool();
  const result = await tool.execute({
    testCase: {
      id: "tc-2",
      steps: [
        { id: "s1", action: "check-echo", input: { value: "hello" }, expected: { value: "world" } },
      ],
    },
  }, execContext());
  assert.equal(result.value.outcome, "failed");
  assert.equal(result.value.failedSteps, 1);
  assert.ok(result.value.evidence[0].failures.some(f => f.includes("expected")));
});

test("run_test_case marks partial when some observations match and others fail", async () => {
  const tool = createFixtureRunTestCaseTool();
  const result = await tool.execute({
    testCase: {
      id: "tc-3",
      steps: [
        { id: "s1", action: "a", input: { status: 200, body: "ok" }, expected: { status: 200, body: "nope" } },
      ],
    },
  }, execContext());
  assert.equal(result.value.outcome, "partial");
  assert.equal(result.value.evidence[0].partial, true);
});

test("run_test_case supports nested expectation matchers", async () => {
  const tool = createFixtureRunTestCaseTool();
  const result = await tool.execute({
    testCase: {
      id: "tc-4",
      steps: [
        { id: "s1", action: "match", input: { body: "welcome to example" }, expected: { body: { includes: "example" } } },
        { id: "s2", action: "match", input: { body: "abc123" }, expected: { body: { regex: "^[a-z]+[0-9]+$" } } },
        { id: "s3", action: "match", input: { status: 200 }, expected: { status: { status: 200 } } },
      ],
    },
  }, execContext());
  assert.equal(result.value.outcome, "passed");
  assert.equal(result.value.passedSteps, 3);
});

test("run_test_case supports the bodyContains matcher", async () => {
  const tool = createFixtureRunTestCaseTool();
  const pass = await tool.execute({
    testCase: {
      id: "tc-body-1",
      steps: [{ id: "s1", action: "match", input: { body: "Apple Juice (1000ml)" }, expected: { body: { bodyContains: "Apple Juice" } } }],
    },
  }, execContext());
  assert.equal(pass.value.outcome, "passed");
  const fail = await tool.execute({
    testCase: {
      id: "tc-body-2",
      steps: [{ id: "s1", action: "match", input: { body: "Orange Juice" }, expected: { body: { bodyContains: "Apple Juice" } } }],
    },
  }, execContext());
  assert.equal(fail.value.outcome, "failed");
  assert.ok(fail.value.evidence[0].failures.some(f => f.includes("body to contain")));
});

test("run_test_case uses an injected step executor and surfaces its observations", async () => {
  const calls = [];
  const tool = createRunTestCaseTool({
    stepExecutor: async (step) => {
      calls.push(step.id);
      return { ok: true, observed: { status: 201, location: "/created" } };
    },
  });
  const result = await tool.execute({
    testCase: {
      id: "tc-5",
      steps: [
        { id: "s1", action: "create", expected: { status: 201, location: "/created" } },
      ],
    },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.outcome, "passed");
  assert.deepEqual(calls, ["s1"]);
  assert.equal(result.value.evidence[0].observed.status, 201);
});

test("run_test_case structures a step executor failure", async () => {
  const tool = createRunTestCaseTool({
    stepExecutor: async () => { throw new Error("executor exploded"); },
  });
  const result = await tool.execute({
    testCase: { id: "tc-6", steps: [{ id: "s1", action: "x", expected: { value: 1 } }] },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.outcome, "failed");
  assert.ok(result.value.evidence[0].failures.some(f => f.includes("executor exploded")));
});

test("run_test_case rejects malformed cases", async () => {
  const tool = createFixtureRunTestCaseTool();
  assert.equal((await tool.execute({}, execContext())).error.code, "INVALID_RUN_TEST_CASE_INPUT");
  assert.equal((await tool.execute({ testCase: { id: "x" } }, execContext())).error.code, "INVALID_RUN_TEST_CASE_INPUT");
  assert.equal((await tool.execute({ testCase: { id: "x", steps: [] } }, execContext())).error.code, "INVALID_RUN_TEST_CASE_INPUT");
  assert.equal((await tool.execute({ testCase: { id: "x", steps: [{ id: "s1" }] } }, execContext())).error.code, "INVALID_RUN_TEST_CASE_INPUT");
  assert.equal((await tool.execute({ testCase: { id: "x", steps: [{ id: "s1", action: "a", expected: "not-object" }] } }, execContext())).error.code, "INVALID_RUN_TEST_CASE_INPUT");
});

test("run_test_case rejects comparisons that point forward or into the same barrier", async () => {
  const tool = createFixtureRunTestCaseTool();
  const forward = await tool.execute({ testCase: { id: "forward", steps: [
    { id: "a", action: "replay_request", compare: { stepId: "b" }, input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } }, execContext());
  assert.equal(forward.error.code, "INVALID_RUN_TEST_CASE_INPUT");
  const sameBarrier = await tool.execute({ testCase: { id: "same-barrier", steps: [
    { id: "a", action: "replay_request", execution: { mode: "barrier", groupId: "g" }, input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", execution: { mode: "barrier", groupId: "g" }, compare: { stepId: "a" }, input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } }, execContext());
  assert.equal(sameBarrier.error.code, "INVALID_RUN_TEST_CASE_INPUT");
});

test("run_test_case rejects an unrestricted execution context projection", async () => {
  const tool = createRunTestCaseTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-testcase-2",
    toolName: "run_test_case",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ testCase: { id: "x", steps: [{ id: "s1", action: "a", expected: {} }] } }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("run_test_case registration adds exactly one raw tool entry", () => {
  const tool = createRunTestCaseTool();
  const registry = createToolRegistry();
  const entry = registerRunTestCase(registry, tool);
  assert.equal(entry.name, "run_test_case");
  assert.deepEqual(registry.names(), ["run_test_case"]);
  assert.throws(() => registerRunTestCase(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("run_test_case contains no authority or lifecycle verification decision", async () => {
  const tool = createFixtureRunTestCaseTool();
  const result = await tool.execute({
    testCase: { id: "tc-7", steps: [{ id: "s1", action: "a", input: { v: 1 }, expected: { v: 1 } }] },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("verification" in result.value, false);
  assert.equal("recovery" in result.value, false);
  assert.equal("rollback" in result.value, false);
});

test("run_test_case matches nested headers and JSON structures structurally", async () => {
  const tool = createRunTestCaseTool({
    stepExecutor: async () => ({
      ok: true,
      observed: {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "x-powered-by": "Express" },
        json: { user: { email: "admin@juice-sh.op", role: "admin" }, items: [1, 2, 3] },
      },
    }),
  });
  const result = await tool.execute({
    testCase: {
      id: "tc-struct",
      steps: [{
        id: "s1",
        action: "request",
        expected: {
          headers: { "content-type": { includes: "application/json" } },
          json: { user: { email: { equals: "admin@juice-sh.op" }, role: "admin" }, items: [1, 2, 3] },
        },
      }],
    },
  }, execContext());
  assert.equal(result.value.outcome, "passed");
});

test("run_test_case structural match fails on a mismatched nested field", async () => {
  const tool = createRunTestCaseTool({
    stepExecutor: async () => ({ ok: true, observed: { json: { user: { role: "customer" } } } }),
  });
  const result = await tool.execute({
    testCase: {
      id: "tc-struct-fail",
      steps: [{ id: "s1", action: "request", expected: { json: { user: { role: { equals: "admin" } } } } }],
    },
  }, execContext());
  assert.equal(result.value.outcome, "failed");
  assert.ok(result.value.evidence[0].failures.some(f => f.includes("json.user.role")));
});

test("run_test_case supports length, type, and in matchers", async () => {
  const tool = createRunTestCaseTool({
    stepExecutor: async () => ({
      ok: true,
      observed: { status: 200, body: "a".repeat(120), tokens: ["a", "b", "c"], count: 5 },
    }),
  });
  const pass = await tool.execute({
    testCase: {
      id: "tc-matchers",
      steps: [{
        id: "s1",
        action: "request",
        expected: {
          status: { in: [200, 201, 204] },
          body: { length: { min: 100, max: 200 }, type: "string" },
          tokens: { length: 3, type: "array" },
          count: { type: "number", in: [1, 5, 9] },
        },
      }],
    },
  }, execContext());
  assert.equal(pass.value.outcome, "passed");

  const fail = await tool.execute({
    testCase: {
      id: "tc-matchers-fail",
      steps: [{
        id: "s1",
        action: "request",
        expected: { status: { in: [404, 500] }, body: { length: { max: 10 } }, count: { type: "string" } },
      }],
    },
  }, execContext());
  assert.equal(fail.value.outcome, "failed");
  const failures = fail.value.evidence[0].failures;
  assert.ok(failures.some(f => f.includes("expected one of")));
  assert.ok(failures.some(f => f.includes("expected length <=")));
  assert.ok(failures.some(f => f.includes("expected type string")));
});
