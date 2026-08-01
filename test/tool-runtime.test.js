const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/harness/core/tool-map");
const { createToolHandlers } = require("../src/harness/core/tool-handlers");
const { createWorkspaceSearch } = require("../src/harness/os/workspace-search");

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

test("Map query tools are bounded and annotation tools are validated", () => {
  assert.ok(ToolMap.TOOL_NAMES.includes("get_map_overview"));
  assert.ok(ToolMap.TOOL_NAMES.includes("find_map_paths"));
  assert.ok(ToolMap.TOOL_NAMES.includes("annotate_map_finding"));
  assert.equal(ToolMap.validateToolCall("get_map_node", { id: "route:abc" }).ok, true);
  assert.equal(ToolMap.validateToolCall("find_map_paths", { from: "host:a", to: "route:b", max_hops: 20 }).args.max_hops, 8);
  assert.equal(ToolMap.validateToolCall("get_map_evidence", { evidence_ids: ["one", "two"] }).ok, true);
  assert.equal(ToolMap.validateToolCall("annotate_map_finding", {}).code, "MISSING_HYPOTHESIS");
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

test("ToolMap accepts only approved schema-managed ingestion resources", () => {
  const valid = ToolMap.validateToolCall("ingest_assessment_records", {
    resource: "endpoints",
    source: "katana",
    records: [{ method: "GET", url: "https://example.test/" }],
  });
  assert.equal(valid.ok, true);
  assert.equal(ToolMap.TOOL_META.ingest_assessment_records.capability, "evidence");

  const traffic = ToolMap.validateToolCall("ingest_assessment_records", {
    resource: "traffic",
    source: "agent",
    records: [{ url: "https://example.test/" }],
  });
  assert.equal(traffic.ok, false);
  assert.equal(traffic.code, "RESOURCE_NOT_ALLOWED");
});

test("Toolbox uses a bundled Codicon for Nmap", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const codicons = fs.readFileSync(path.join(__dirname, "..", "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");
  assert.match(renderer, /nmap:\s*"codicon-server-process"/);
  assert.match(codicons, /\.codicon-server-process:before/);
  assert.doesNotMatch(renderer, /nmap:\s*"codicon-network"/);
});

test("Toolbox exposes the Firewall and WAF Analysis set with bundled icons", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const codicons = fs.readFileSync(path.join(__dirname, "..", "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");
  assert.match(renderer, /category:\s*"Firewall & WAF Analysis"/);
  for (const [tool, icon] of [["wafw00f", "shield"], ["nmap-firewall", "server-process"], ["hping3", "pulse"], ["traceroute", "git-merge"]]) {
    assert.match(renderer, new RegExp(`${tool.replace("-", "\\-")}[^\\n]+codicon-${icon}`));
    assert.match(codicons, new RegExp(`\\.codicon-${icon}:before`));
  }
});

test("tool handlers deny generic mutations of every Core assessment directory", async () => {
  const handlers = createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: () => ({ target: "unused" }),
    editWorkspaceFile: async () => ({ ok: true }),
    deleteWorkspaceFile: () => ({ ok: true }),
    runWorkspaceCommand: async () => ({ ok: true }),
    startWorkspaceProcess: () => ({ ok: true }),
  });
  for (const protectedPath of [
    "scope/in-scope.json",
    "recon/passive-recon.json",
    "enumeration/endpoints.json",
    "traffic/raw.jsonl",
    "vulnerability-scans/high.json",
  ]) {
    const result = await handlers.executeToolCall({
      workspace: process.cwd(),
      toolCall: { function: { name: "write_file", arguments: { path: protectedPath, content: "{}" } } },
    });
    assert.equal(result.ok, false, protectedPath);
    assert.equal(result.errorCode, "TYPED_ASSESSMENT_MUTATION_REQUIRED", protectedPath);
  }
});
