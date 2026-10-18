"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { normalizeOpenRouterMessages } = require("../src/agent/llm/openrouter/openrouter-stream");
const { buildChatRequest } = require("../src/agent/llm/openrouter/providers");
const { prepareBrowserImageMessages, validateBrowserVisionModel, estimateBrowserImageTokens, retainBrowserScreenshotExchanges } = require("../src/agent/llm/openrouter/browser-images");
const { estimateImageTokens, normalizeModelMetadata } = require("../src/agent/runtime/context-budget");

const metadata = { inputModalities: ["text", "image"], supportedParameters: ["tools"] };
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM7sAAAAASUVORK5CYII=", "base64");
function shot(id) { return { id, artifactId: `artifact-${id}`, projectId: "project-a", tabId: "tab-a", documentVersion: 3, viewportRevision: 2, mimeType: "image/png", pixelWidth: 1024, pixelHeight: 768 }; }
function result(id, screenshot) { return { role: "tool", tool_call_id: id, content: JSON.stringify({ ok: true, payload: JSON.stringify({ evidence: { screenshot } }) }) }; }
function batch(id, screenshot) { return [{ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "browser_action", arguments: "{}" } }] }, result(id, screenshot)]; }
function options(messages, extra = {}) { return { messages, model: "test/vision", provider: "openrouter", metadata, projectId: "project-a", artifactStore: { read: async () => ({ data: image, mimeType: "image/png" }) }, ...extra }; }

test("screenshot bytes survive actual request serialization in streaming and completion requests", async () => {
  const messages = [{ role: "user", content: "What is on the browser page?" }, ...batch("a", shot("one"))];
  const saved = JSON.stringify(messages);
  const prepared = await prepareBrowserImageMessages(options(messages));
  for (const stream of [true, false]) {
    const wire = JSON.parse(JSON.stringify(buildChatRequest({ apiKey: "fixture", model: "test/vision", stream, messages: normalizeOpenRouterMessages(prepared.messages) }).body));
    assert.equal(wire.stream, stream);
    assert.equal(wire.messages[3].content[1].type, "image_url");
    assert.deepEqual(Buffer.from(wire.messages[3].content[1].image_url.url.split(",")[1], "base64"), image);
    assert.equal(wire.messages[3].content[1].image_url.detail, "high");
  }
  assert.equal(JSON.stringify(messages), saved);
  assert.equal(prepared.imageTokens, 3840);
});

test("images follow the full parallel tool batch and keep original pairings", async () => {
  const messages = [
    { role: "assistant", content: "", tool_calls: [{ id: "a" }, { id: "b" }] },
    result("a", shot("one")),
    { role: "tool", tool_call_id: "b", content: "second tool finished" },
    { role: "assistant", content: "Analysis" },
  ];
  const prepared = await prepareBrowserImageMessages(options(messages));
  assert.deepEqual(prepared.messages.map((message) => message.role), ["assistant", "tool", "tool", "user", "assistant"]);
  assert.deepEqual(prepared.messages.slice(1, 3).map((message) => message.tool_call_id), ["a", "b"]);
  await assert.rejects(prepareBrowserImageMessages(options(messages.filter((message) => message.tool_call_id !== "b"))), { code: "BROWSER_IMAGE_TOOL_BATCH_INCOMPLETE" });
});

test("only the latest two unique screenshots are hydrated after persistence and retry", async () => {
  const messages = [...batch("a", shot("one")), ...batch("b", shot("two")), ...batch("c", shot("three"))];
  const reads = [];
  const settings = { artifactStore: { read: async ({ artifactId }) => { reads.push(artifactId); return { data: image, mimeType: "image/png" }; } } };
  const first = await prepareBrowserImageMessages(options(JSON.parse(JSON.stringify(messages)), settings));
  assert.deepEqual(reads, ["artifact-two", "artifact-three"]);
  assert.equal(first.messages[1].content, messages[1].content);
  assert.equal(first.messages.filter((message) => Array.isArray(message.content)).length, 2);
  assert.equal(first.screenshotCount, 2);
  const second = await prepareBrowserImageMessages(options(JSON.parse(JSON.stringify(messages)), settings));
  assert.deepEqual(second, first);
  assert.equal(estimateBrowserImageTokens(messages), 7680);
  const compacted = await prepareBrowserImageMessages(options([{ role: "user", content: "Summary: a screenshot was used" }]));
  assert.equal(compacted.screenshotCount, 0);
});

test("duplicate references consume one image budget and one artifact read", async () => {
  let reads = 0;
  const prepared = await prepareBrowserImageMessages(options([...batch("a", shot("one")), ...batch("b", shot("one"))], { artifactStore: { read: async () => { reads += 1; return { data: image, mimeType: "image/png" }; } } }));
  assert.equal(reads, 1);
  assert.equal(prepared.screenshotCount, 1);
  assert.equal(prepared.messages.length, 5);
});

test("missing images and cross-project references fail explicitly before sending", async () => {
  await assert.rejects(prepareBrowserImageMessages(options(batch("a", shot("one")), { artifactStore: { read: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } } })), { code: "BROWSER_IMAGE_ARTIFACT_UNAVAILABLE" });
  let reads = 0;
  await assert.rejects(prepareBrowserImageMessages(options(batch("a", shot("one")), { projectId: "project-b", artifactStore: { read: async () => { reads += 1; } } })), { code: "BROWSER_IMAGE_PROJECT_MISMATCH" });
  assert.equal(reads, 0);
  await assert.rejects(prepareBrowserImageMessages(options(batch("a", shot("one")), { artifactStore: { read: async () => ({ data: image, mimeType: "text/html" }) } })), { code: "BROWSER_IMAGE_ARTIFACT_INVALID" });
});

test("selected model capability refresh preserves model and refuses unknown or text-only models", async () => {
  let refreshed = null;
  assert.deepEqual(await validateBrowserVisionModel({ model: "selected/vision", metadata: {}, refreshMetadata: async (model) => { refreshed = model; return metadata; } }), metadata);
  assert.equal(refreshed, "selected/vision");
  await assert.rejects(validateBrowserVisionModel({ model: "unknown/model", metadata: {}, refreshMetadata: async () => ({}) }), { code: "BROWSER_VISION_CAPABILITY_UNKNOWN" });
  await assert.rejects(validateBrowserVisionModel({ metadata: { inputModalities: ["text"], supportedParameters: ["tools"] } }), { code: "BROWSER_VISION_MODEL_UNSUPPORTED" });
  await assert.rejects(validateBrowserVisionModel({ metadata: { inputModalities: ["image"], supportedParameters: [] } }), { code: "BROWSER_VISION_MODEL_UNSUPPORTED" });
  await assert.rejects(validateBrowserVisionModel({ provider: "ollama", metadata }), { code: "BROWSER_VISION_PROVIDER_UNSUPPORTED" });
  await assert.rejects(validateBrowserVisionModel({ model: "offline/vision", metadata: { ...metadata, available: false } }), { code: "BROWSER_VISION_MODEL_UNAVAILABLE" });
  assert.deepEqual(normalizeModelMetadata(metadata).inputModalities, ["text", "image"]);
});

test("Ollama history remains text-only and does not read screenshot bytes", async () => {
  const prepared = await prepareBrowserImageMessages(options(batch("a", shot("one")), { provider: "ollama", artifactStore: { read: () => { throw new Error("must not read"); } } }));
  assert.equal(prepared.imageTokens, 0);
  assert.equal(prepared.screenshotCount, 0);
  assert.deepEqual(prepared.messages, batch("a", shot("one")));
});

test("normalizer copies supported content parts and rejects unsupported data", () => {
  const content = [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "low" } }];
  const normalized = normalizeOpenRouterMessages([{ role: "user", content }]);
  assert.deepEqual(normalized[0].content, content);
  assert.notEqual(normalized[0].content[1].image_url, content[1].image_url);
  for (const part of [{ type: "audio", data: "x" }, { type: "text", text: {} }, { type: "image_url", image_url: { url: "file:///secret" } }]) {
    assert.throws(() => normalizeOpenRouterMessages([{ role: "user", content: [part] }]), { code: "OPENROUTER_CONTENT_PART_UNSUPPORTED" });
  }
  assert.equal(estimateImageTokens(1024, 768), 3840);
});

test("artifact metadata and enclosing evidence project remain authoritative", async () => {
  const screenshot = shot("one");
  delete screenshot.projectId;
  const messages = batch("a", screenshot);
  messages[1].content = JSON.stringify({ payload: JSON.stringify({ evidence: { projectId: "project-a", screenshot } }) });
  assert.equal((await prepareBrowserImageMessages(options(messages))).screenshotCount, 1);
  await assert.rejects(prepareBrowserImageMessages(options(messages, { artifactStore: { read: async () => ({ data: image, mimeType: "image/png", metadata: { ...screenshot, pixelWidth: 50 } }) } })), { code: "BROWSER_IMAGE_ARTIFACT_MISMATCH" });
});

test("controller prompt fitting reserves browser image tokens before the provider request", () => {
  const { fitMessagesToContext } = require("../src/agent/controller/agent-controller");
  const history = batch("a", shot("one"));
  const textOnly = fitMessagesToContext({ history, promptBudget: 2000, provider: "ollama" });
  const vision = fitMessagesToContext({ history, promptBudget: 2000, provider: "openrouter" });
  assert.equal(textOnly.ok, true);
  assert.equal(vision.ok, false);
  assert.equal(vision.usedTokens - textOnly.usedTokens, 3840);
});

test("compaction retains the latest screenshots with complete parallel tool exchanges", async () => {
  const oldest = batch("a", shot("one"));
  const middle = batch("b", shot("two"));
  const latest = [{ role: "assistant", tool_calls: [{ id: "c" }, { id: "d" }] }, result("c", shot("three")), { role: "tool", tool_call_id: "d", content: "Other result" }];
  const retained = retainBrowserScreenshotExchanges([...oldest, { role: "user", content: "old question" }, ...middle, { role: "assistant", content: "done" }, ...latest]);
  assert.deepEqual(retained, [middle[0], { ...middle[1], browserImagesConsumed: ["project-a\0artifact-two"] }, ...latest]);
  const prepared = await prepareBrowserImageMessages(options(JSON.parse(JSON.stringify(retained))));
  assert.equal(prepared.screenshotCount, 2);
  assert.deepEqual(prepared.messages.map((message) => message.role), ["assistant", "tool", "user", "assistant", "tool", "tool", "user"]);
});

test("a real controller checkpoint preserves screenshot references for the following model round", async () => {
  const { runAgentTurn } = require("../src/agent/controller/agent-controller");
  const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator");
  const events = [];
  const rounds = [];
  const result = await runAgentTurn({
    model: "test/vision", numCtx: 32768, contextBudget: 32768,
    contextPlan: { provider: "openrouter", effectiveLimitTokens: 32768 },
    projectId: "proj_00000000-0000-4000-8000-000000004121",
    memorySessionId: "session_00000000-0000-4000-8000-000000004122",
    tier1Context: createTier1ContextCoordinator(),
    mode: "agent", modeFamily: "assist", userMessage: "Describe the captured browser page.",
    chatHistory: [{ role: "user", content: "Old notes: " + "note ".repeat(30000) }, ...batch("capture-a", shot("one"))],
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      rounds.push(payload);
      return { ok: true, fullText: "Read the page.", toolCalls: [{ id: "finish", type: "function", function: { name: "end_turn", arguments: JSON.stringify({ status: "stop" }) } }], finishReason: "stop" };
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(events.some((event) => event.type === "context_checkpoint" && event.status === "completed"));
  assert.ok(rounds.length > 0);
  const prepared = await prepareBrowserImageMessages(options(rounds[0].messages));
  assert.equal(prepared.screenshotCount, 1);
  assert.ok(rounds[0].messages.some((message) => message.role === "tool" && message.tool_call_id === "capture-a"));
  assert.equal(rounds[0].contextUsage.tokenCalculation.imageTokens, 3840);
});

test("actual HTTP fetch carries image bytes and paired tool results through the provider request", async (t) => {
  const received = [];
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    received.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(raw) });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "fixture response" } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const prepared = await prepareBrowserImageMessages(options(batch("capture-http", shot("one"))));
  const request = buildChatRequest({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, apiKey: "fixture-only", model: "fixture/vision", messages: normalizeOpenRouterMessages(prepared.messages), stream: false });
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(3000) });
  assert.equal((await response.json()).choices[0].message.content, "fixture response");
  assert.equal(received[0].url, "/api/v1/chat/completions");
  assert.equal(received[0].authorization, "Bearer fixture-only");
  assert.equal(received[0].body.model, "fixture/vision");
  assert.deepEqual(received[0].body.messages.map((message) => message.role), ["assistant", "tool", "user"]);
  assert.equal(received[0].body.messages[1].tool_call_id, "capture-http");
  assert.deepEqual(Buffer.from(received[0].body.messages[2].content[1].image_url.url.split(",")[1], "base64"), image);
});

test("switching to a known text model keeps consumed screenshots as text and never reads artifacts", async () => {
  const textMetadata = { inputModalities: ["text"], supportedParameters: ["tools"] };
  const fresh = batch("a", shot("one"));
  const consumed = [...fresh, { role: "assistant", content: "I read the page." }, { role: "user", content: "Continue with structure only." }];
  const noReads = { read: () => { throw new Error("consumed screenshot must not be read"); } };
  const prepared = await prepareBrowserImageMessages(options(consumed, { metadata: textMetadata, artifactStore: noReads }));
  assert.deepEqual(prepared, { messages: consumed, imageTokens: 0, screenshotCount: 0 });
  assert.equal(estimateBrowserImageTokens(consumed, { metadata: textMetadata }), 0);
  assert.equal(estimateBrowserImageTokens(fresh, { metadata: textMetadata }), 3840);
  await assert.rejects(prepareBrowserImageMessages(options(fresh, { metadata: textMetadata, artifactStore: noReads })), { code: "BROWSER_VISION_MODEL_UNSUPPORTED" });
  await assert.rejects(prepareBrowserImageMessages(options(consumed, { metadata: {}, refreshMetadata: async () => null, artifactStore: noReads })), { code: "BROWSER_VISION_CAPABILITY_UNKNOWN" });
  const refreshed = await prepareBrowserImageMessages(options(consumed, { metadata: {}, refreshMetadata: async () => textMetadata, artifactStore: noReads }));
  assert.equal(refreshed.screenshotCount, 0);
  const { fitMessagesToContext } = require("../src/agent/controller/agent-controller");
  assert.equal(fitMessagesToContext({ history: consumed, provider: "openrouter", metadata: textMetadata, promptBudget: 2000 }).ok, true);
});

test("compaction and reopening preserve consumed screenshots without marking a fresh capture consumed", async () => {
  const textMetadata = { inputModalities: ["text"], supportedParameters: ["tools"] };
  const history = [...batch("old", shot("old")), { role: "assistant", content: "I read the old image." }];
  const original = JSON.stringify(history);
  const retained = JSON.parse(JSON.stringify(retainBrowserScreenshotExchanges(history)));
  const noReads = { read: () => { throw new Error("a consumed screenshot must not be read by a text model"); } };
  const prepared = await prepareBrowserImageMessages(options(retained, { metadata: textMetadata, artifactStore: noReads }));
  assert.equal(prepared.screenshotCount, 0);
  assert.equal(estimateBrowserImageTokens(retained, { metadata: textMetadata }), 0);
  assert.equal(JSON.stringify(history), original);
  const again = retainBrowserScreenshotExchanges(retained);
  assert.equal((await prepareBrowserImageMessages(options(again, { metadata: textMetadata, artifactStore: noReads }))).screenshotCount, 0);
  await assert.rejects(prepareBrowserImageMessages(options([...retained, ...batch("fresh", shot("new"))], { metadata: textMetadata, artifactStore: noReads })), { code: "BROWSER_VISION_MODEL_UNSUPPORTED" });
  assert.equal((await prepareBrowserImageMessages(options(retained))).screenshotCount, 1, "vision models still hydrate retained screenshots");
  assert.equal(normalizeOpenRouterMessages(retained).some(message => Object.hasOwn(message, "browserImagesConsumed")), false);
});
