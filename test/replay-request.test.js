"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createReplayRequestTool } = require("../src/agent/tools/assessment/replay-request.js");
const { createToolRegistry, registerReplayRequest } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-replay-1",
    toolName: "replay_request",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function fakeResponse({ status = 200, statusText = "OK", headers = {}, body = "" } = {}) {
  return {
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    async text() { return body; },
  };
}

test("replay_request sends the request through the injected fetch and returns timing", async () => {
  const calls = [];
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ status: 200, body: "hello", headers: { "Content-Type": "text/plain" } });
    },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/a", method: "GET" } }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 200);
  assert.equal(result.value.body, "hello");
  assert.equal(result.value.method, "GET");
  assert.equal(typeof result.value.elapsedMs, "number");
  assert.equal(typeof result.value.startedAt, "number");
  assert.equal(typeof result.value.finishedAt, "number");
  assert.equal(calls[0].url, "https://fixture.test/a");
  // Redirects are always handled manually so identity material can be
  // recomputed and stripped at every hop.
  assert.equal(calls[0].options.redirect, "manual");
});

test("replay_request manually revalidates each redirect before following it", async () => {
  const calls = [];
  const checks = [];
  const tool = createReplayRequestTool({
    redirectGuard: async (target) => {
      checks.push(target);
      return target.includes("/outside") ? { ok: false, reason: "redirect is outside scope" } : { ok: true };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ status: 302, headers: { location: "https://fixture.test/outside" } });
    },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/start", followRedirects: true } }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPLAY_REQUEST_REDIRECT_SCOPE_DENIED");
  assert.deepEqual(calls.map((call) => call.url), ["https://fixture.test/start"]);
  assert.deepEqual(checks, ["https://fixture.test/start", "https://fixture.test/outside"]);
  assert.equal(calls[0].options.redirect, "manual");
});

test("replay_request applies browser-compatible redirect method semantics", async () => {
  const calls = [];
  const responses = [
    fakeResponse({ status: 303, headers: { location: "/after-303" } }),
    fakeResponse({ status: 307, headers: { location: "/after-307" } }),
    fakeResponse({ status: 200 }),
  ];
  const tool = createReplayRequestTool({
    redirectGuard: async () => ({ ok: true }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responses.shift(); },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/start", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "7" }, body: "{\"a\":1}", followRedirects: true } }, execContext());
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.options.method), ["POST", "GET", "GET"]);
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls[1].options.headers["Content-Type"], undefined);
  assert.equal(calls[1].options.headers["Content-Length"], undefined);
  assert.equal(result.value.finalMethod, "GET");
});

test("replay_request preserves method and body across a 307 redirect", async () => {
  const calls = [];
  const tool = createReplayRequestTool({
    redirectGuard: async () => ({ ok: true }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? fakeResponse({ status: 307, headers: { location: "/next" } }) : fakeResponse({ status: 200 });
    },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/start", method: "POST", body: "payload", followRedirects: true } }, execContext());
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.options.method), ["POST", "POST"]);
  assert.equal(calls[1].options.body, "payload");
});

test("replay_request applies origin-bound identity cookies and headers", async () => {
  const calls = [];
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ status: 200 });
    },
    identityProvider: { load: (id) => id === "u1" ? {
      identityId: "u1",
      storageState: { cookies: [{ name: "session", value: "secret-cookie", domain: "fixture.test", path: "/" }] },
      headerBindings: [{ origin: "https://fixture.test/", headers: { Authorization: "Bearer secret-token" } }],
    } : null },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/", headers: { Accept: "application/json" } }, identityId: "u1" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.identityId, "u1");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].options.headers.Cookie, "session=secret-cookie");
  assert.equal(calls[0].options.headers["x-account-id"], undefined);
  assert.equal(calls[0].options.headers["x-identity-role"], undefined);
});

test("replay_request treats header binding paths as path segments", async () => {
  const calls = [];
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => { calls.push({ url, options }); return fakeResponse({ status: 200 }); },
    identityProvider: { load: () => ({ headerBindings: [{ origin: "https://fixture.test/api", headers: { Authorization: "Bearer secret" } }] }) },
  });
  await tool.execute({ request: { url: "https://fixture.test/apix" }, identityId: "u1" }, execContext());
  await tool.execute({ request: { url: "https://fixture.test/api/v1" }, identityId: "u1" }, execContext());
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "Bearer secret");
});

test("replay_request redacts identity material from response headers and body", async () => {
  const tool = createReplayRequestTool({
    fetchImpl: async () => fakeResponse({
      status: 200,
      headers: { "x-reflected": "secret-cookie", authorization: "Bearer secret-token" },
      body: "secret-cookie Bearer secret-token",
    }),
    identityProvider: { load: () => ({
      storageState: { cookies: [{ name: "session", value: "secret-cookie", domain: "fixture.test", path: "/" }] },
      headerBindings: [{ origin: "https://fixture.test/", headers: { Authorization: "Bearer secret-token" } }],
    }) },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/" }, identityId: "u1" }, execContext());
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(serialized, /secret-cookie/);
  assert.doesNotMatch(serialized, /secret-token/);
  assert.match(serialized, /\[REDACTED\]/);
});

test("replay_request strips identity material after a cross-origin redirect", async () => {
  const calls = [];
  let count = 0;
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => {
      calls.push({ url, options: { ...options, headers: { ...options.headers } } });
      count += 1;
      return count === 1
        ? fakeResponse({ status: 302, headers: { location: "https://other.test/landing" } })
        : fakeResponse({ status: 200 });
    },
    identityProvider: { load: () => ({ storageState: { cookies: [{ name: "session", value: "secret", domain: "fixture.test", path: "/" }] }, headerBindings: [{ origin: "https://fixture.test/", headers: { Authorization: "Bearer secret" } }] }) },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/start", followRedirects: true }, identityId: "u1" }, execContext());
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].options.headers.Cookie, "session=secret");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Cookie, undefined);
});

test("replay_request rejects a missing identity", async () => {
  const tool = createReplayRequestTool({
    fetchImpl: async () => fakeResponse({ status: 200 }),
    identityProvider: { load: () => null },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/" }, identityId: "nope" }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_REPLAY_REQUEST_INPUT");
});

test("replay_request reports identity provider unavailable when none is wired", async () => {
  const tool = createReplayRequestTool({ fetchImpl: async () => fakeResponse({ status: 200 }) });
  const result = await tool.execute({ request: { url: "https://fixture.test/" }, identityId: "u1" }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPLAY_REQUEST_IDENTITY_PROVIDER_UNAVAILABLE");
  // Without identityId, no provider is needed.
  const bare = await tool.execute({ request: { url: "https://fixture.test/" } }, execContext());
  assert.equal(bare.ok, true);
});

test("replay_request handles a network error", async () => {
  const tool = createReplayRequestTool({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  const result = await tool.execute({ request: { url: "https://fixture.test/" } }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPLAY_REQUEST_NETWORK_FAILED");
  assert.match(result.error.message, /ECONNREFUSED/);
});

test("replay_request returns a structured timeout", async () => {
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/", timeoutMs: 100 } }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPLAY_REQUEST_TIMEOUT");
});

test("replay_request aborts an in-flight request when the operator stops it", async () => {
  const controller = new AbortController();
  const tool = createReplayRequestTool({
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); }, { once: true });
    }),
  });
  const pending = tool.execute({ request: { url: "https://fixture.test/", timeoutMs: 10_000 } }, execContext(), { signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPLAY_REQUEST_STOPPED");
});

test("replay_request merges config headers", async () => {
  const calls = [];
  const tool = createReplayRequestTool({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ status: 200 });
    },
  });
  await tool.execute({
    request: { url: "https://fixture.test/", headers: { Accept: "text/html" } },
    config: { headers: { "X-Custom": "yes" } },
  }, execContext());
  assert.equal(calls[0].options.headers.Accept, "text/html");
  assert.equal(calls[0].options.headers["X-Custom"], "yes");
});

test("replay_request rejects malformed input", async () => {
  const tool = createReplayRequestTool();
  assert.equal((await tool.execute({}, execContext())).error.code, "INVALID_REPLAY_REQUEST_INPUT");
  assert.equal((await tool.execute({ request: { url: "not-a-url" } }, execContext())).error.code, "INVALID_REPLAY_REQUEST_INPUT");
  assert.equal((await tool.execute({ request: { url: "ftp://x/" } }, execContext())).error.code, "INVALID_REPLAY_REQUEST_INPUT");
  assert.equal((await tool.execute({ request: { url: "https://x/", body: 42 } }, execContext())).error.code, "INVALID_REPLAY_REQUEST_INPUT");
});

test("replay_request rejects an unrestricted execution context projection", async () => {
  const tool = createReplayRequestTool({ fetchImpl: async () => fakeResponse({ status: 200 }) });
  const fullContext = createExecutionContext({
    invocationId: "invocation-replay-2",
    toolName: "replay_request",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ request: { url: "https://fixture.test/" } }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("replay_request registration adds exactly one raw tool entry", () => {
  const tool = createReplayRequestTool();
  const registry = createToolRegistry();
  const entry = registerReplayRequest(registry, tool);
  assert.equal(entry.name, "replay_request");
  assert.deepEqual(registry.names(), ["replay_request"]);
  assert.throws(() => registerReplayRequest(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("replay_request contains no scope or approval decision", async () => {
  const tool = createReplayRequestTool({ fetchImpl: async () => fakeResponse({ status: 200, body: "ok" }) });
  const result = await tool.execute({ request: { url: "https://fixture.test/" } }, execContext());
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
  assert.equal("authorized" in result.value, false);
});
