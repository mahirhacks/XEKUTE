"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runOpenRouterDecision } = require("../src/agent/runtime/openrouter-decision.js");

const request = {
  model: "typesafe/jev-1.14",
  state: { task: "Review supplied evidence" },
  questions: { skill_evidence_review: { type: "noul", instructions: "Would an evidence-review skill help?" } },
  apiKey: "test-key",
  baseUrl: "https://openrouter.ai/api/v1",
  headers: { Authorization: "Bearer test-key", "HTTP-Referer": "https://xekute.local" },
};

test("OpenRouter decision provider sends one native request and validates all typed answers", async () => {
  let call;
  const body = { answers: { skill_evidence_review: { type: "noul", noul: 0.72 } }, usage: { prompt_tokens: 12 } };
  const result = await runOpenRouterDecision({
    ...request,
    fetchImpl: async (url, init) => {
      call = { url, init };
      return { ok: true, json: async () => body };
    },
  });
  assert.equal(call.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer test-key");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(call.init.body), {
    model: request.model,
    state: request.state,
    questions: request.questions,
  });
  assert.equal(call.init.signal.aborted, false);
  assert.equal(result, body);
});

test("OpenRouter decision provider rejects missing, extra, and malformed answers", async () => {
  const responses = [
    { answers: {} },
    { answers: { skill_evidence_review: { type: "noul", noul: 0.5 }, unexpected: { type: "noul", noul: 0.5 } } },
    { answers: { skill_evidence_review: { type: "noul", noul: 1.2 } } },
    { answers: { skill_evidence_review: { type: "boolean", value: true } } },
  ];
  for (const body of responses) {
    await assert.rejects(runOpenRouterDecision({
      ...request,
      fetchImpl: async () => ({ ok: true, json: async () => body }),
    }), { code: "SKILL_ROUTER_RESPONSE_INVALID" });
  }
});

test("OpenRouter technical errors do not trigger HTTP retries in the provider boundary", async () => {
  let calls = 0;
  await assert.rejects(runOpenRouterDecision({
    ...request,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network unavailable");
    },
  }), /network unavailable/);
  assert.equal(calls, 1);
});

test("OpenRouter decision provider honors cancellation and its bounded timeout", async () => {
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  let calls = 0;
  await assert.rejects(runOpenRouterDecision({
    ...request,
    signal: alreadyCancelled.signal,
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({}) }; },
  }), { code: "SKILL_ROUTER_CANCELLED" });
  assert.equal(calls, 0);

  await assert.rejects(runOpenRouterDecision({
    ...request,
    timeoutMs: 1_000,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }), { code: "SKILL_ROUTER_TIMEOUT" });
});
