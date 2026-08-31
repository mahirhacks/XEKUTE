"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createWebResearchTool } = require("../src/agent/tools/assessment/web-research.js");

function restrictedContext() {
  return projectExecutionContext(createExecutionContext({
    invocationId: "web-research-test",
    toolName: "web_research",
    role: "ask",
    authority: "ask_for_approval",
    workspace: { root: process.cwd() },
  }));
}

test("web_research returns bounded public search results", async () => {
  const tool = createWebResearchTool({
    webResearch: {
      async searchWeb() { return { ok: true, provider: "fixture", query: "xekute", results: [{ rank: 1, title: "Result", url: "https://example.com/", snippet: "Public result" }] }; },
      async fetchWebPage() { return { ok: true, content: "unused" }; },
    },
  });
  const result = await tool.execute({ operation: "search", query: "xekute", limit: 1 }, restrictedContext());
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.results[0].url, "https://example.com/");
});

test("web_research fetch_page returns bounded readable content", async () => {
  const tool = createWebResearchTool({
    webResearch: {
      async searchWeb() { return { ok: true, results: [] }; },
      async fetchWebPage(url) { return { ok: true, url, finalUrl: url, title: "Page", contentType: "text/html", content: "Readable page", truncated: false }; },
    },
  });
  const result = await tool.execute({ operation: "fetch_page", url: "https://example.com/", maxChars: 2_000 }, restrictedContext());
  assert.equal(result.ok, true);
  assert.equal(result.content, "Readable page");
});

test("web_research rejects unrestricted execution contexts", async () => {
  const tool = createWebResearchTool({ webResearch: { searchWeb() {}, fetchWebPage() {} } });
  const result = await tool.execute({ operation: "search", query: "x" }, {});
  assert.equal(result.code, "INVALID_EXECUTION_CONTEXT");
});
