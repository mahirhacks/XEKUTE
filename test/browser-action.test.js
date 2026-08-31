"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBrowserActionTool } = require("../src/agent/tools/assessment/browser-action.js");
const { createToolRegistry, registerBrowserAction } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-browser-1",
    toolName: "browser_action",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function fakeProvider(handler) {
  return { execute: async (input) => handler(input) };
}

test("browser_action forwards each action to the injected provider", async () => {
  const seen = [];
  const tool = createBrowserActionTool({
    browserProvider: fakeProvider(async (input) => {
      seen.push(input.action);
      return { ok: true, url: "https://fixture.test/", title: "Fixture" };
    }),
  });
  const navigate = await tool.execute({ action: "navigate", url: "https://fixture.test/" }, execContext());
  assert.equal(navigate.ok, true);
  assert.equal(navigate.value.action, "navigate");
  assert.equal(navigate.value.evidence.title, "Fixture");
  await tool.execute({ action: "click", selector: "#btn" }, execContext());
  await tool.execute({ action: "type", selector: "#input", text: "hello" }, execContext());
  await tool.execute({ action: "select", selector: "#sel", option: "opt-2" }, execContext());
  await tool.execute({ action: "wait", waitMs: 50 }, execContext());
  await tool.execute({ action: "extract", selector: "body", extract: { type: "text" } }, execContext());
  assert.deepEqual(seen, ["navigate", "click", "type", "select", "wait", "extract"]);
});

test("browser_action returns provider evidence for extraction", async () => {
  const tool = createBrowserActionTool({
    browserProvider: fakeProvider(async (input) => ({
      ok: true,
      url: "https://fixture.test/page",
      title: "Page Title",
      text: "Some page text",
      attribute: { href: "https://fixture.test/link" },
    })),
  });
  const result = await tool.execute({ action: "extract", selector: "a", extract: { type: "attribute", attribute: "href" } }, execContext());
  assert.equal(result.ok, true);
  assert.equal(result.value.evidence.attribute.href, "https://fixture.test/link");
  assert.equal(result.value.evidence.title, "Page Title");
});

test("browser_action structures a provider error", async () => {
  const tool = createBrowserActionTool({
    browserProvider: fakeProvider(async () => { throw new Error("selector not found"); }),
  });
  const result = await tool.execute({ action: "click", selector: "#missing" }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BROWSER_ACTION_FAILED");
  assert.match(result.error.message, /selector not found/);
});

test("browser_action reports provider unavailable when none is wired", async () => {
  const tool = createBrowserActionTool();
  const result = await tool.execute({ action: "navigate", url: "https://fixture.test/" }, execContext());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BROWSER_PROVIDER_UNAVAILABLE");
});

test("browser_action rejects malformed input", async () => {
  const tool = createBrowserActionTool({ browserProvider: fakeProvider(async () => ({ ok: true })) });
  assert.equal((await tool.execute({ action: "bogus" }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.equal((await tool.execute({ action: "navigate" }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.equal((await tool.execute({ action: "navigate", url: "ftp://x/" }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.equal((await tool.execute({ action: "click" }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.equal((await tool.execute({ action: "type", selector: "#i" }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.equal((await tool.execute({ action: "wait", waitMs: 99999999 }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
});

test("browser_action allows title/url extraction without a selector", async () => {
  const seen = [];
  const tool = createBrowserActionTool({
    browserProvider: fakeProvider(async (input) => {
      seen.push({ action: input.action, selector: input.selector, extract: input.extract });
      return { ok: true, title: "Page Title", url: "https://fixture.test/" };
    }),
  });
  const title = await tool.execute({ action: "extract", extract: { type: "title" } }, execContext());
  assert.equal(title.ok, true);
  assert.equal(title.value.evidence.title, "Page Title");
  const url = await tool.execute({ action: "extract", extract: { type: "url" } }, execContext());
  assert.equal(url.ok, true);
  assert.equal(url.value.evidence.url, "https://fixture.test/");
  assert.equal(seen[0].selector, undefined);
  assert.equal(seen[1].selector, undefined);
});

test("browser_action defaults to whole-document extraction without a selector", async () => {
  const seen = [];
  const tool = createBrowserActionTool({ browserProvider: fakeProvider(async (input) => {
    seen.push(input.extract.type);
    return { ok: true, title: "Page", url: "https://fixture.test/", text: "Body", html: "<main>Body</main>" };
  }) });
  assert.equal((await tool.execute({ action: "extract", extract: { type: "text" } }, execContext())).ok, true);
  assert.equal((await tool.execute({ action: "extract", extract: { type: "html" } }, execContext())).ok, true);
  assert.equal((await tool.execute({ action: "extract", extract: { type: "all" } }, execContext())).ok, true);
  assert.equal((await tool.execute({ action: "extract", extract: { type: "attribute", attribute: "href" } }, execContext())).error.code, "INVALID_BROWSER_ACTION_INPUT");
  assert.deepEqual(seen, ["text", "html", "all"]);
});

test("browser_action rejects an unrestricted execution context projection", async () => {
  const tool = createBrowserActionTool({ browserProvider: fakeProvider(async () => ({ ok: true })) });
  const fullContext = createExecutionContext({
    invocationId: "invocation-browser-2",
    toolName: "browser_action",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ action: "navigate", url: "https://fixture.test/" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("browser_action registration adds exactly one raw tool entry", () => {
  const tool = createBrowserActionTool();
  const registry = createToolRegistry();
  const entry = registerBrowserAction(registry, tool);
  assert.equal(entry.name, "browser_action");
  assert.deepEqual(registry.names(), ["browser_action"]);
  assert.throws(() => registerBrowserAction(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
});

test("browser_action contains no authority or scope decision", async () => {
  const tool = createBrowserActionTool({
    browserProvider: fakeProvider(async () => ({ ok: true, url: "https://fixture.test/" })),
  });
  const result = await tool.execute({ action: "navigate", url: "https://fixture.test/" }, execContext());
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
  assert.equal("authorized" in result.value, false);
});
