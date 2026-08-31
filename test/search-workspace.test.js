"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSearchWorkspaceTool } = require("../src/agent/tools/workspace/search-workspace.js");
const { createToolRegistry, registerSearchWorkspace } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-workspace-test-"));
  fs.writeFileSync(path.join(root, "alpha.js"), "export function alphaFn() {}\nconst alphaVar = 1;\nrequire('./beta');\n", "utf8");
  fs.writeFileSync(path.join(root, "beta.js"), "export function betaFn() {}\nimport value from './alpha';\n", "utf8");
  fs.writeFileSync(path.join(root, "notes.md"), "# Alpha notes\n\nThe alpha section is here.\nalpha repeated twice\n", "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "deep.txt"), "deep content alpha\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "deep.js"), "function deepFn() {}\n", "utf8");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "dep.js"), "require('ignored');\n", "utf8");
  fs.mkdirSync(path.join(root, ".hidden"));
  fs.writeFileSync(path.join(root, ".hidden", "secret.txt"), "hidden alpha\n", "utf8");
  return { root };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-search-1",
    toolName: "search_workspace",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function assertSearch(tool, input, root, expectedCount, expectedFirstPath = null) {
  const result = awaitToolExecute(tool, input, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.count, expectedCount);
  if (expectedFirstPath) {
    assert.equal(result.value.matches[0].path, expectedFirstPath);
  }
  return result;
}

async function awaitToolExecute(tool, input, root) {
  return tool.execute(input, execContext({ root }));
}

test("search_workspace filename mode matches basename case-insensitively", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "filename", query: "alpha" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "filename");
  const names = result.value.matches.map(m => m.name).sort();
  assert.deepEqual(names, ["alpha.js"]);
  assert.equal(result.value.matches[0].path, "alpha.js");
});

test("search_workspace filename mode is deterministic and bounded", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const first = await awaitToolExecute(tool, { mode: "filename", query: "deep" }, root);
  const second = await awaitToolExecute(tool, { mode: "filename", query: "deep" }, root);
  assert.deepEqual(first.value.matches, second.value.matches);
  assert.equal(first.value.count, 2);
});

test("search_workspace text mode returns line locations and snippets", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "text", query: "alpha" }, root);
  assert.equal(result.ok, true);
  assert.ok(result.value.count >= 2);
  const alphaJs = result.value.matches.filter(m => m.path.endsWith("alpha.js"));
  assert.equal(alphaJs.length, 2); // alphaFn (line 1), alphaVar (line 2)
  assert.equal(alphaJs[0].line, 1);
  assert.match(alphaJs[0].snippet, /alphaFn/);
  const notes = result.value.matches.filter(m => m.path.endsWith("notes.md"));
  assert.ok(notes.length >= 2);
  assert.ok(notes.every(m => typeof m.line === "number" && typeof m.column === "number"));
});

test("search_workspace pattern mode uses a regular expression", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "pattern", query: "alphaFn|betaFn" }, root);
  assert.equal(result.ok, true);
  const paths = result.value.matches.map(m => m.path).sort();
  assert.deepEqual(paths, ["alpha.js", "beta.js"]);
});

test("search_workspace symbol mode matches declared functions", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "symbol", query: "deepFn" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.count, 1);
  assert.equal(result.value.matches[0].path, "src/deep.js");
  assert.equal(result.value.matches[0].line, 1);
});

test("search_workspace reference mode matches imports and requires", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "reference", query: "./alpha" }, root);
  assert.equal(result.ok, true);
  assert.ok(result.value.matches.some(m => m.path === "beta.js"));
  const result2 = await awaitToolExecute(tool, { mode: "reference", query: "./beta" }, root);
  assert.ok(result2.value.matches.some(m => m.path === "alpha.js"));
});

test("search_workspace skips node_modules and hidden files by default", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "filename", query: "dep" }, root);
  assert.equal(result.value.count, 0);
  const hiddenResult = await awaitToolExecute(tool, { mode: "text", query: "hidden alpha" }, root);
  assert.equal(hiddenResult.value.count, 0);
});

test("search_workspace includeHidden searches hidden paths", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "text", query: "hidden alpha", includeHidden: true }, root);
  assert.equal(result.ok, true);
  assert.ok(result.value.count >= 1);
  assert.ok(result.value.matches.some(m => m.path.includes(".hidden")));
});

test("search_workspace returns an empty result set for no matches", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "text", query: "zzzz-nonexistent" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.count, 0);
  assert.deepEqual(result.value.matches, []);
  assert.equal(result.value.truncated, false);
});

test("search_workspace rejects a malformed query", async () => {
  const tool = createSearchWorkspaceTool();
  assert.equal((await awaitToolExecute(tool, { mode: "pattern", query: "(" }, null)).error.code, "INVALID_SEARCH_WORKSPACE_INPUT");
  assert.equal((await awaitToolExecute(tool, { mode: "text", query: "" }, null)).error.code, "INVALID_SEARCH_WORKSPACE_INPUT");
  assert.equal((await awaitToolExecute(tool, { mode: "text", query: "a\nb" }, null)).error.code, "INVALID_SEARCH_WORKSPACE_INPUT");
  assert.equal((await awaitToolExecute(tool, { mode: "other", query: "x" }, null)).error.code, "INVALID_SEARCH_WORKSPACE_INPUT");
  assert.equal((await awaitToolExecute(tool, { mode: "text", query: "x", maxResults: 0 }, null)).error.code, "INVALID_SEARCH_WORKSPACE_INPUT");
});

test("search_workspace rejects an unrestricted execution context projection", async () => {
  const tool = createSearchWorkspaceTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-search-2",
    toolName: "search_workspace",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ mode: "filename", query: "x" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("search_workspace registration adds exactly one raw tool entry", () => {
  const tool = createSearchWorkspaceTool();
  const registry = createToolRegistry();
  const entry = registerSearchWorkspace(registry, tool);
  assert.equal(entry.name, "search_workspace");
  assert.deepEqual(registry.names(), ["search_workspace"]);
  assert.throws(() => registerSearchWorkspace(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.deepEqual(entry.metadata.targetTypes, ["file", "workspace"]);
  assert.equal(entry.metadata.mutating, false);
});

test("search_workspace raw adapter contains no authority decision result", async () => {
  const { root } = makeFixture();
  const tool = createSearchWorkspaceTool();
  const result = await awaitToolExecute(tool, { mode: "text", query: "alpha" }, root);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
});