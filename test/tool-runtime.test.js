const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/tools/tool-map");
const { createToolHandlers } = require("../src/tools/tool-handlers");
const { createWorkspaceSearch } = require("../src/tools/workspace-search");

test("ToolMap.validateToolCall sanitizes paths and normalizes patch args", () => {
  const result = ToolMap.validateToolCall("patch_file", {
    path: "\\src\\app.js",
    search: "oldValue",
    replace: "newValue",
  });

  assert.equal(result.ok, true);
  assert.equal(result.args.path, "src/app.js");
  assert.deepEqual(result.args.patches, [
    { search: "oldValue", replace: "newValue" },
  ]);
});

test("ToolMap.validateToolCall normalizes batch read paths", () => {
  const result = ToolMap.validateToolCall("read_files", {
    paths: ["\\src\\app.js", "/README.md", ""],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.args.paths, ["src/app.js", "README.md"]);
});

test("workspace search finds files by basename and content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-search-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "chat-controller.js"), "export function runAgentTurn() {}\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "The chat runtime uses runAgentTurn for tool orchestration.\n", "utf8");

  const search = createWorkspaceSearch({ fs, path });

  const fileMatches = search.findWorkspaceFiles(root, "chat-controller", { limit: 5 });
  assert.equal(fileMatches.ok, true);
  assert.equal(fileMatches.results[0].path, "src/chat-controller.js");

  const codeMatches = search.searchWorkspaceIndex(root, "runAgentTurn", { limit: 5 });
  assert.equal(codeMatches.ok, true);
  assert.equal(codeMatches.results[0].path, "src/chat-controller.js");
  assert.match(codeMatches.results[0].snippet, /runAgentTurn/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("tool handlers expose workspace inspection, batch reads, and outlines", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-tools-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "agent.js"),
    "const fs = require('fs');\nfunction runAgentTurn() {}\nclass ToolRunner {}\n",
    "utf8",
  );

  const search = createWorkspaceSearch({ fs, path });
  const handlers = createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: search.resolveWorkspaceTarget,
    editWorkspaceFile: async () => ({ error: "not used" }),
    deleteWorkspaceFile: () => ({ error: "not used" }),
    buildWorkspaceIndex: search.buildWorkspaceIndex,
    searchWorkspaceIndex: search.searchWorkspaceIndex,
    findWorkspaceFiles: search.findWorkspaceFiles,
    runWorkspaceCommand: async () => ({ error: "not used" }),
    startWorkspaceProcess: () => ({ error: "not used" }),
    readToolProcess: () => ({ error: "not used" }),
    stopToolProcess: () => ({ error: "not used" }),
    listProjectFiles: search.listProjectFiles,
    searchWeb: async (query) => ({
      ok: true,
      provider: "test",
      query,
      count: 1,
      results: [{ title: "Official docs", url: "https://example.com/docs", snippet: "Reference" }],
    }),
    fetchWebPage: async (url) => ({
      ok: true,
      url,
      finalUrl: url,
      title: "Official docs",
      contentType: "text/html",
      truncated: false,
      content: "Supported API behavior.",
    }),
  });

  const inspect = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "inspect_workspace", arguments: {} } },
  });
  assert.equal(inspect.ok, true);
  assert.match(inspect.content, /npm test/);

  const batch = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "read_files", arguments: { paths: ["package.json", "src/agent.js"] } } },
  });
  assert.equal(batch.ok, true);
  assert.match(batch.content, /File: src\/agent\.js/);

  const outline = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "get_file_outline", arguments: { path: "src/agent.js" } } },
  });
  assert.equal(outline.ok, true);
  assert.match(outline.content, /function runAgentTurn/);
  assert.match(outline.content, /class ToolRunner/);

  const webSearch = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "search_web", arguments: { query: "official api docs", limit: 3 } } },
  });
  assert.equal(webSearch.ok, true);
  assert.match(webSearch.content, /https:\/\/example\.com\/docs/);

  const webPage = await handlers.executeToolCall({
    workspace: root,
    toolCall: { function: { name: "fetch_url", arguments: { url: "https://example.com/docs" } } },
  });
  assert.equal(webPage.ok, true);
  assert.match(webPage.content, /Supported API behavior/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("ToolMap validates and bounds web research arguments", () => {
  const search = ToolMap.validateToolCall("search_web", { query: "  current docs  ", limit: 99 });
  assert.equal(search.ok, true);
  assert.equal(search.args.query, "current docs");
  assert.equal(search.args.limit, 20);

  const page = ToolMap.validateToolCall("fetch_url", { url: " https://example.com ", max_chars: 999999 });
  assert.equal(page.ok, true);
  assert.equal(page.args.url, "https://example.com");
  assert.equal(page.args.max_chars, 30000);
});
