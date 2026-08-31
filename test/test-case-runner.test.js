"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestCaseRunner } = require("../src/app/services/assessment/test-case-runner.js");

function registry(names = ["replay_request", "browser_action"]) { return { names: () => names }; }

test("production test runner dispatches authenticated steps sequentially", async () => {
  const calls = [];
  const run = createTestCaseRunner({
    registry: registry(),
    executeToolCall: async ({ toolCall }) => {
      const name = toolCall.function.name;
      const args = toolCall.function.arguments;
      calls.push({ name, args });
      return { ok: true, value: { status: name === "replay_request" ? 200 : 201, identityId: args.identityId || null } };
    },
  });
  const result = await run({ workspace: "C:\\project", sessionId: "chat-1", input: { testCase: { id: "tc", steps: [
    { id: "a", action: "replay_request", identityId: "account-a", input: { request: { url: "https://fixture.test/a" } }, expected: { status: 200 } },
    { id: "b", action: "replay_request", identityId: "account-b", input: { request: { url: "https://fixture.test/b" } }, expected: { status: 200 } },
  ] } } });
  assert.equal(result.ok, true);
  assert.equal(result.value.outcome, "passed");
  assert.deepEqual(calls.map((call) => call.args.identityId), ["account-a", "account-b"]);
});

test("barrier groups release together and enforce project limits", async () => {
  const starts = [];
  let release;
  const run = createTestCaseRunner({
    registry: registry(["replay_request"]),
    projectProfileProvider: () => ({ rulesOfEngagement: { maximumConcurrency: 2, requestsPerSecond: 2 } }),
    executeToolCall: async ({ toolCall }) => {
      starts.push(toolCall.function.arguments.identityId);
      await new Promise((resolve) => { release = resolve; setImmediate(resolve); });
      return { ok: true, value: { status: 200 } };
    },
  });
  const result = await run({ workspace: "C:\\project", input: { testCase: { id: "race", steps: [
    { id: "a", action: "replay_request", identityId: "account-a", execution: { mode: "barrier", groupId: "race-1" }, input: { request: { url: "https://fixture.test/a" } }, expected: { status: 200 } },
    { id: "b", action: "replay_request", identityId: "account-b", execution: { mode: "barrier", groupId: "race-1" }, input: { request: { url: "https://fixture.test/b" } }, expected: { status: 200 } },
  ] } } });
  assert.deepEqual(starts.sort(), ["account-a", "account-b"]);
  assert.equal(result.value.outcome, "passed");

  const limited = createTestCaseRunner({ registry: registry(["replay_request"]), projectProfileProvider: () => ({ rulesOfEngagement: { maximumConcurrency: 1, requestsPerSecond: 1 } }), executeToolCall: async () => ({ ok: true, value: { status: 200 } }) });
  const denied = await limited({ workspace: "C:\\project", input: { testCase: { id: "race-limit", steps: [
    { id: "a", action: "replay_request", execution: { mode: "barrier", groupId: "race-2" }, input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", execution: { mode: "barrier", groupId: "race-2" }, input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } } });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "RUN_TEST_CASE_BARRIER_LIMIT");
  if (release) release();
});

test("runner compares a completed prior step and preserves ordered evidence", async () => {
  const calls = [];
  const run = createTestCaseRunner({
    registry: registry(["replay_request", "compare_responses"]),
    executeToolCall: async ({ toolCall }) => {
      const name = toolCall.function.name;
      const args = toolCall.function.arguments;
      calls.push({ name, args });
      if (name === "compare_responses") return { ok: true, value: { allEqual: false, differencesFound: true } };
      return { ok: true, value: { status: args.identityId === "account-a" ? 200 : 403, body: args.identityId || "anonymous" } };
    },
  });
  const result = await run({ workspace: "C:\\project", input: { testCase: { id: "compare", steps: [
    { id: "a", action: "replay_request", identityId: "account-a", input: { request: { url: "https://fixture.test/a" } }, expected: { status: 200 } },
    { id: "b", action: "replay_request", identityId: "account-b", compare: { stepId: "a", dimensions: ["status", "body"] }, input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.evidence.map((entry) => entry.stepId), ["a", "b"]);
  assert.deepEqual(calls.map((call) => call.name), ["replay_request", "replay_request", "compare_responses"]);
  assert.deepEqual(calls[2].args.responses.map((response) => response.id), ["a", "b"]);
});

test("browser barriers are rejected and cancellation is reported", async () => {
  const run = createTestCaseRunner({ registry: registry(), executeToolCall: async () => ({ ok: true, value: {} }) });
  const unsupported = await run({ workspace: "C:\\project", input: { testCase: { id: "browser-race", steps: [{ id: "a", action: "browser_action", execution: { mode: "barrier", groupId: "g" }, input: {}, expected: {} }] } } });
  assert.equal(unsupported.error.code, "RUN_TEST_CASE_BARRIER_UNSUPPORTED");
  const controller = new AbortController();
  controller.abort();
  const stopped = await run({ workspace: "C:\\project", signal: controller.signal, input: { testCase: { id: "stop", steps: [{ id: "a", action: "replay_request", input: { request: { url: "https://fixture.test" } }, expected: {} }] } } });
  assert.equal(stopped.value.outcome, "stopped");
});

test("runner stops an in-flight nested action when its signal aborts", async () => {
  const controller = new AbortController();
  const run = createTestCaseRunner({
    registry: registry(["replay_request"]),
    executeToolCall: async ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({ ok: false, aborted: true, code: "REPLAY_REQUEST_STOPPED" }), { once: true });
      setImmediate(() => controller.abort());
    }),
  });
  const result = await run({ workspace: "C:\\project", signal: controller.signal, input: { testCase: { id: "stop-in-flight", steps: [{ id: "a", action: "replay_request", input: { request: { url: "https://fixture.test" } }, expected: {} }] } } });
  assert.equal(result.value.outcome, "stopped");
});

test("runner cancellation interrupts an active rate-limit wait", async () => {
  const controller = new AbortController();
  let calls = 0;
  const run = createTestCaseRunner({
    registry: registry(["replay_request"]),
    projectProfileProvider: () => ({ rulesOfEngagement: { maximumConcurrency: 1, requestsPerSecond: 1 } }),
    executeToolCall: async () => {
      calls += 1;
      if (calls === 1) setTimeout(() => controller.abort(), 20);
      return { ok: true, value: { status: 200 } };
    },
  });
  const started = Date.now();
  const result = await run({ workspace: "C:\\project", signal: controller.signal, input: { testCase: { id: "rate-stop", steps: [
    { id: "a", action: "replay_request", input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } } });
  assert.equal(result.value.outcome, "stopped");
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 300);
});

test("runner applies the lower approved-plan barrier limit and bounds returned evidence", async () => {
  const run = createTestCaseRunner({
    registry: registry(["replay_request"]),
    projectProfileProvider: () => ({ rulesOfEngagement: { maximumConcurrency: 10, requestsPerSecond: 10 } }),
    planLimitsProvider: () => ({ maximumConcurrency: 1, requestsPerSecond: 1 }),
    executeToolCall: async () => ({ ok: true, value: { status: 200, body: "x".repeat(100_000) } }),
    evidenceRecorder: async () => ({ ok: true, evidenceIds: ["runtime-evidence-1"] }),
  });
  const denied = await run({ workspace: "C:\\project", planBinding: { planId: "plan-1", runId: "run-1" }, input: { testCase: { id: "race-plan-limit", steps: [
    { id: "a", action: "replay_request", execution: { mode: "barrier", groupId: "race" }, input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", execution: { mode: "barrier", groupId: "race" }, input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } } });
  assert.equal(denied.error.code, "RUN_TEST_CASE_BARRIER_LIMIT");

  const bounded = createTestCaseRunner({
    registry: registry(["replay_request"]),
    executeToolCall: async () => ({ ok: true, value: { status: 200, body: "x".repeat(100_000) } }),
    evidenceRecorder: async () => ({ ok: true, evidenceIds: ["runtime-evidence-1"] }),
  });
  const result = await bounded({ workspace: "C:\\project", input: { testCase: { id: "large", steps: [{ id: "a", action: "replay_request", input: { request: { url: "https://fixture.test/a" } }, expected: {} }] } } });
  assert.equal(result.value.evidence[0].evidenceIds[0], "runtime-evidence-1");
  assert.deepEqual(result.value.evidenceIds, ["runtime-evidence-1"]);
  assert.ok(JSON.stringify(result.value).length < 40_000);
});

test("runner rejects duplicate step IDs and non-contiguous barrier groups", async () => {
  const run = createTestCaseRunner({ registry: registry(["replay_request"]), executeToolCall: async () => ({ ok: true, value: {} }) });
  const duplicate = await run({ workspace: "C:\\project", input: { testCase: { id: "duplicate", steps: [
    { id: "same", action: "replay_request", input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "same", action: "replay_request", input: { request: { url: "https://fixture.test/b" } }, expected: {} },
  ] } } });
  assert.equal(duplicate.error.code, "INVALID_RUN_TEST_CASE_INPUT");
  const nonContiguous = await run({ workspace: "C:\\project", input: { testCase: { id: "groups", steps: [
    { id: "a", action: "replay_request", execution: { mode: "barrier", groupId: "g" }, input: { request: { url: "https://fixture.test/a" } }, expected: {} },
    { id: "b", action: "replay_request", input: { request: { url: "https://fixture.test/b" } }, expected: {} },
    { id: "c", action: "replay_request", execution: { mode: "barrier", groupId: "g" }, input: { request: { url: "https://fixture.test/c" } }, expected: {} },
  ] } } });
  assert.equal(nonContiguous.error.code, "INVALID_RUN_TEST_CASE_INPUT");
});
