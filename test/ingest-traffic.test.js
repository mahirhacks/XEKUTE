"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createIngestTrafficTool } = require("../src/agent/tools/assessment/ingest-traffic.js");
const { createToolRegistry, registerIngestTraffic } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-ingest-1",
    toolName: "ingest_traffic",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

test("ingest_traffic normalizes a jsonl capture", async () => {
  const tool = createIngestTrafficTool();
  const data = [
    JSON.stringify({ requestId: "r1", timestamp: "2026-08-06T10:00:00Z", request: { method: "GET", url: "https://example.com/a", headers: { Host: "example.com" } }, response: { status: 200, headers: { "Content-Type": "text/html" }, body: "<html>" } }),
    JSON.stringify({ requestId: "r2", request: { method: "POST", url: "https://example.com/b" }, response: { status: 500 } }),
  ].join("\n");
  const result = await tool.execute({ format: "jsonl", data }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.parsed, 2);
  assert.equal(result.value.records[0].recordType, "http-exchange");
  assert.equal(result.value.records[0].request.method, "GET");
  assert.equal(result.value.records[0].response.status, 200);
  assert.equal(result.value.records[1].request.method, "POST");
});

test("ingest_traffic normalizes a json array or object", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({ format: "json", records: [{ request: { url: "https://x.dev/1" }, response: { statusCode: 204 } }] }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.parsed, 1);
  assert.equal(result.value.records[0].response.status, 204);
  const asString = await tool.execute({ format: "json", data: JSON.stringify([{ request: { method: "PUT", url: "https://x.dev/2" }, response: { status: 200 } }]) }, execContext());
  assert.equal(asString.value.parsed, 1);
  assert.equal(asString.value.records[0].request.method, "PUT");
});

test("ingest_traffic normalizes a HAR export", async () => {
  const tool = createIngestTrafficTool();
  const har = {
    log: {
      entries: [{
        _requestId: "h1",
        startedDateTime: "2026-08-06T10:00:00Z",
        time: 123,
        request: { method: "GET", url: "https://example.com/", headers: [{ name: "Accept", value: "application/json" }], queryString: [{ name: "q", value: "1" }] },
        response: { status: 200, statusText: "OK", headers: [{ name: "Content-Type", value: "application/json" }], content: { text: "{}" } },
      }],
    },
  };
  const result = await tool.execute({ format: "har", data: JSON.stringify(har) }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.parsed, 1);
  assert.equal(result.value.records[0].request.url, "https://example.com/");
  assert.equal(result.value.records[0].request.query.q, "1");
  assert.equal(result.value.records[0].response.status, 200);
  assert.equal(result.value.records[0].durationMs, 123);
});

test("ingest_traffic normalizes a single request/response pair", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({
    format: "pair",
    source: "manual",
    request: { method: "post", url: "https://example.com/login", headers: { "Content-Type": "application/json" }, body: "{}" },
    response: { status: 302, headers: { Location: "/dashboard" } },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.parsed, 1);
  assert.equal(result.value.records[0].source, "manual");
  assert.equal(result.value.records[0].request.method, "POST"); // uppercased
  assert.equal(result.value.records[0].response.status, 302);
});

test("ingest_traffic preserves sensitive headers", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({
    format: "pair",
    request: { url: "https://example.com/", headers: { Authorization: "Bearer secret-token", "X-API-Key": "key123", Accept: "text/html" } },
    response: { status: 200, headers: { "Set-Cookie": "session=abc", "Content-Type": "text/html" } },
  }, execContext());
  assert.equal(result.value.records[0].request.headers.Authorization, "Bearer secret-token");
  assert.equal(result.value.records[0].request.headers["X-API-Key"], "key123");
  assert.equal(result.value.records[0].request.headers.Accept, "text/html");
  assert.equal(result.value.records[0].response.headers["Set-Cookie"], "session=abc");
});

test("ingest_traffic preserves csrf tokens in JSON bodies", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({
    format: "pair",
    request: { url: "https://example.com/", body: '{"csrfToken":"abc123"}' },
    response: { status: 200, body: '{"csrfToken":"abc123"}' },
  }, execContext());
  assert.match(result.value.records[0].request.body, /abc123/);
  assert.match(result.value.records[0].response.body, /abc123/);
});

test("ingest_traffic returns deterministic parse errors for malformed captures", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({ format: "jsonl", data: '{"request":{"url":"x"}}\nnot-json\n' }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.parsed, 1);
  assert.equal(result.value.parseErrors.length, 1);
  assert.match(result.value.parseErrors[0], /line 2/);
  const empty = await tool.execute({ format: "jsonl", data: "" }, execContext());
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "INGEST_TRAFFIC_PARSE_FAILED");
});

test("ingest_traffic rejects malformed input", async () => {
  const tool = createIngestTrafficTool();
  assert.equal((await tool.execute({ format: "bogus" }, execContext())).error.code, "INVALID_INGEST_TRAFFIC_INPUT");
  assert.equal((await tool.execute({ format: "pair" }, execContext())).error.code, "INVALID_INGEST_TRAFFIC_INPUT");
  assert.equal((await tool.execute({ format: "jsonl" }, execContext())).error.code, "INVALID_INGEST_TRAFFIC_INPUT");
  assert.equal((await tool.execute({ format: "har", data: 42 }, execContext())).error.code, "INVALID_INGEST_TRAFFIC_INPUT");
  assert.equal((await tool.execute({}, execContext())).error.code, "INVALID_INGEST_TRAFFIC_INPUT");
});

test("ingest_traffic rejects an unrestricted execution context projection", async () => {
  const tool = createIngestTrafficTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-ingest-2",
    toolName: "ingest_traffic",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ format: "pair", request: { url: "x" }, response: { status: 200 } }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("ingest_traffic registration adds exactly one raw tool entry", () => {
  const tool = createIngestTrafficTool();
  const registry = createToolRegistry();
  const entry = registerIngestTraffic(registry, tool);
  assert.equal(entry.name, "ingest_traffic");
  assert.deepEqual(registry.names(), ["ingest_traffic"]);
  assert.throws(() => registerIngestTraffic(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("ingest_traffic performs no network calls and contains no authority decision", async () => {
  const tool = createIngestTrafficTool();
  const result = await tool.execute({
    format: "pair",
    request: { url: "https://example.com/", headers: { Authorization: "Bearer token" } },
    response: { status: 200 },
  }, execContext());
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
  assert.equal("replayed" in result.value, false);
  assert.match(result.value.records[0].request.headers.Authorization, /Bearer token/);
});