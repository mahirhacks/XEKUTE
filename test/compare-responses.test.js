"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCompareResponsesTool } = require("../src/agent/tools/assessment/compare-responses.js");
const { createToolRegistry, registerCompareResponses } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-compare-1",
    toolName: "compare_responses",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function baseResponses() {
  return [
    { id: "r1", status: 200, statusText: "OK", headers: { "Content-Type": "application/json" }, body: '{"a":1}', durationMs: 100 },
    { id: "r2", status: 200, statusText: "OK", headers: { "Content-Type": "application/json" }, body: '{"a":1}', durationMs: 100 },
  ];
}

test("compare_responses reports all equal for identical responses", async () => {
  const tool = createCompareResponsesTool();
  const result = await tool.execute({ responses: baseResponses() }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.allEqual, true);
  assert.equal(result.value.differencesFound, false);
  assert.equal(result.value.status.equal, true);
  assert.equal(result.value.body.equal, true);
  assert.equal(result.value.length.equal, true);
  assert.equal(result.value.timing.equal, true);
  assert.equal(result.value.semantic.equal, true);
});

test("compare_responses detects a status difference", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].status = 500;
  const result = await tool.execute({ responses }, execContext());
  assert.equal(result.value.allEqual, false);
  assert.equal(result.value.status.equal, false);
  assert.equal(result.value.status.differences, "status differs: 200 vs 500");
});

test("compare_responses detects a header difference", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].headers = { "Content-Type": "text/html" };
  const result = await tool.execute({ responses, compare: ["headers"] }, execContext());
  assert.equal(result.value.headers.equal, false);
  assert.ok(result.value.headers.differences.some(d => d.includes("content-type")));
});

test("compare_responses detects a body difference and reports lengths", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].body = '{"a":2}';
  const result = await tool.execute({ responses }, execContext());
  assert.equal(result.value.body.equal, false);
  assert.ok(result.value.body.differences.includes("body content differs"));
});

test("compare_responses detects a length difference", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].body = '{"a":1,"b":2}';
  const result = await tool.execute({ responses }, execContext());
  assert.equal(result.value.length.equal, false);
  assert.equal(result.value.length.differences, "length differs: 7 vs 13");
});

test("compare_responses detects a timing difference", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].durationMs = 250;
  const result = await tool.execute({ responses }, execContext());
  assert.equal(result.value.timing.equal, false);
  assert.match(result.value.timing.differences, /timing differs/);
});

test("compare_responses semantic comparison flags structural change but not value change", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  // Same keys, different value → semantically equal
  responses[1].body = '{"a":999}';
  let result = await tool.execute({ responses, compare: ["semantic"] }, execContext());
  assert.equal(result.value.semantic.equal, true);
  // Different keys → semantically different
  responses[1].body = '{"b":1}';
  result = await tool.execute({ responses, compare: ["semantic"] }, execContext());
  assert.equal(result.value.semantic.equal, false);
});

test("compare_responses compares sensitive headers without masking", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[0].headers.Authorization = "Bearer secret";
  responses[1].headers.Authorization = "Bearer other";
  const result = await tool.execute({ responses, compare: ["headers"] }, execContext());
  assert.equal(result.value.headers.equal, false);
  assert.ok(result.value.headers.differences.length > 0);
});

test("compare_responses supports a selected compare subset", async () => {
  const tool = createCompareResponsesTool();
  const responses = baseResponses();
  responses[1].status = 500;
  responses[1].body = "different";
  const result = await tool.execute({ responses, compare: ["status"] }, execContext());
  assert.equal(result.value.status.equal, false);
  assert.equal(result.value.body, undefined);
  assert.equal(result.value.length, undefined);
});

test("compare_responses rejects malformed input", async () => {
  const tool = createCompareResponsesTool();
  assert.equal((await tool.execute({ responses: [] }, execContext())).error.code, "INVALID_COMPARE_RESPONSES_INPUT");
  assert.equal((await tool.execute({ responses: [{ id: "x" }] }, execContext())).error.code, "INVALID_COMPARE_RESPONSES_INPUT");
  assert.equal((await tool.execute({ responses: [{ id: "x" }, { id: "y", status: 99 }] }, execContext())).error.code, "INVALID_COMPARE_RESPONSES_INPUT");
  assert.equal((await tool.execute({ responses: [{ id: "x" }, { id: "y" }], compare: ["bogus"] }, execContext())).error.code, "INVALID_COMPARE_RESPONSES_INPUT");
  assert.equal((await tool.execute({}, execContext())).error.code, "INVALID_COMPARE_RESPONSES_INPUT");
});

test("compare_responses rejects an unrestricted execution context projection", async () => {
  const tool = createCompareResponsesTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-compare-2",
    toolName: "compare_responses",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ responses: baseResponses() }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("compare_responses registration adds exactly one raw tool entry", () => {
  const tool = createCompareResponsesTool();
  const registry = createToolRegistry();
  const entry = registerCompareResponses(registry, tool);
  assert.equal(entry.name, "compare_responses");
  assert.deepEqual(registry.names(), ["compare_responses"]);
  assert.throws(() => registerCompareResponses(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("compare_responses contains no finding or authority decision", async () => {
  const tool = createCompareResponsesTool();
  const result = await tool.execute({ responses: baseResponses() }, execContext());
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("finding" in result.value, false);
  assert.equal("authorized" in result.value, false);
});