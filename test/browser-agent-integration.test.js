"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowserActionTool } = require("../src/agent/tools/assessment/browser-action.js");
const { createToolRegistry, registerBrowserAction, toOpenAITool } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext, deriveDelegatedExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { toolResultContentForModel } = require("../src/agent/runtime/result-projector.js");
const { prepareBrowserImageMessages } = require("../src/agent/llm/openrouter/browser-images.js");
const { normalizeOpenRouterMessages } = require("../src/agent/llm/openrouter/openrouter-stream.js");
const { buildChatRequest } = require("../src/agent/llm/openrouter/providers.js");

function context() {
  return createExecutionContext({ invocationId: "tool-1", toolName: "browser_action", role: "agent", authority: "scope_only",
    workspace: { root: "G:/project" }, sessionId: "runtime-run-42", browserSessionId: "visible-chat-1" });
}

test("the existing browser tool accepts structural and coordinate targets while retaining the visible chat owner", async () => {
  const seen = [];
  const controller = new AbortController();
  const tool = createBrowserActionTool({ browserProvider: { execute: async (input, rawContext, runtime) => {
    seen.push({ input, owner: rawContext.browserSessionId, signal: runtime.signal });
    return { backend: "native-workspace", result: "done" };
  } } });
  const registry = createToolRegistry();
  const exposed = toOpenAITool(registerBrowserAction(registry, tool));
  assert.ok(exposed.function.parameters.properties.action.enum.includes("observe"));
  assert.ok(exposed.function.parameters.properties.action.enum.includes("screenshot"));
  assert.match(exposed.function.description, /Refresh once after a stale observation/);
  const raw = projectExecutionContext(context());
  const actions = [
    { action: "click", tabId: "tab-1", target: { kind: "element", observationId: "obs-1", ref: "e-1" } },
    { action: "click", tabId: "tab-1", target: { kind: "point", screenshotId: "shot-1", x: 100, y: 200 } },
    { action: "press_key", tabId: "tab-1", key: "Control+A" },
    { action: "scroll", tabId: "tab-1", deltaX: 0, deltaY: 400 },
    { action: "select", tabId: "tab-1", target: { kind: "selector", selector: "select" }, text: "admin" },
  ];
  for (const action of actions) assert.equal((await tool.execute(action, raw, { signal: controller.signal })).ok, true);
  assert.deepEqual(seen.map(item => item.input), actions);
  assert.ok(seen.every(item => item.owner === "visible-chat-1" && item.signal === controller.signal));
  const before = seen.length;
  for (const action of [
    { action: "click", target: { kind: "point", screenshotId: "shot-1", x: -1, y: 0 } },
    { action: "drag", from: { kind: "selector", selector: "#drag" } },
    { action: "handle_dialog", accept: "yes" },
    { action: "upload", target: { kind: "selector", selector: "input" }, paths: [] },
  ]) assert.equal((await tool.execute(action, raw)).ok, false);
  assert.equal(seen.length, before);
});

test("delegation cannot replace the trusted browser chat binding", () => {
  const parent = context();
  const child = deriveDelegatedExecutionContext(parent, { invocationId: "tool-child" });
  assert.equal(projectExecutionContext(child).browserSessionId, "visible-chat-1");
  assert.throws(() => deriveDelegatedExecutionContext(parent, { invocationId: "forged-child", browserSessionId: "other-chat" }), /browserSessionId cannot expand or change/);
});

test("bounded browser evidence remains valid JSON and reaches the actual OpenRouter request as image input", async () => {
  const screenshot = { id: "shot-1", artifactId: "artifact-1", tabId: "tab-1", documentVersion: 2, viewportRevision: 4,
    mimeType: "image/png", pixelWidth: 800, pixelHeight: 600, viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 0, deviceScaleFactor: 1, zoomFactor: 1 };
  const result = { ok: true, value: { action: "screenshot", evidence: { backend: "native-workspace", projectId: "project-1", screenshot,
    observation: { text: "Large page output ".repeat(20000), elements: Array.from({ length: 300 }, (_, i) => ({ ref: `e-${i}`, name: "Control".repeat(100) })) } } } };
  const content = toolResultContentForModel(result);
  const payload = JSON.parse(JSON.parse(content).payload);
  assert.equal(payload.projectionTruncated, true);
  assert.deepEqual(payload.evidence.screenshot, screenshot);
  assert.ok(JSON.parse(content).payload.length <= 32000);
  const messages = [{ role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "browser_action", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call-1", content }];
  const image = Buffer.from("fixture screenshot binary");
  const prepared = await prepareBrowserImageMessages({ messages, provider: "openrouter", model: "fixture/vision", projectId: "project-1",
    metadata: { inputModalities: ["text", "image"], supportedParameters: ["tools"] },
    artifactStore: { read: async request => { assert.deepEqual(request, { projectId: "project-1", artifactId: "artifact-1" }); return { data: image, mimeType: "image/png" }; } } });
  const request = buildChatRequest({ apiKey: "fixture-key", model: "fixture/vision", messages: normalizeOpenRouterMessages(prepared.messages) });
  assert.equal(request.body.messages[1].role, "tool");
  assert.equal(request.body.messages[2].content[1].image_url.url, `data:image/png;base64,${image.toString("base64")}`);
  assert.equal(request.body.model, "fixture/vision");
  assert.equal(prepared.screenshotCount, 1);
  assert.ok(prepared.imageTokens > 0);
  assert.equal(messages.length, 2);
});
