const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const { createToolHandlers } = require("../src/adapters/tools/core/tool-handlers");
const { createWorkspaceSearch } = require("../src/adapters/tools/os/workspace-search");
const { resolveSecurityExecutable } = require("../src/adapters/tools/cyber/executable-resolver");

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

test("security executable resolution avoids PATH collisions with app-managed binaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-tool-bin-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const expected = path.join(bin, "httpx.exe");
  fs.writeFileSync(expected, "placeholder", "utf8");

  const resolved = resolveSecurityExecutable("httpx", {
    env: { XEKUTE_TOOLS_BIN: bin },
    homeDir: root,
    resourcesPath: "",
    cwd: root,
    platform: "win32",
    fsImpl: fs,
  });

  assert.equal(resolved, expected);
  fs.rmSync(root, { recursive: true, force: true });
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

function makeHandlers(extra = {}) {
  return createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: () => ({ ok: false, error: "unused" }),
    editWorkspaceFile: async () => ({ error: "not used" }),
    deleteWorkspaceFile: () => ({ error: "not used" }),
    buildWorkspaceIndex: async () => ({}),
    searchWorkspaceIndex: async () => ({ count: 0, results: [] }),
    findWorkspaceFiles: async () => ({ files: [] }),
    runWorkspaceCommand: async () => ({ error: "not used" }),
    startWorkspaceProcess: () => ({ error: "not used" }),
    readToolProcess: () => ({ error: "not used" }),
    stopToolProcess: () => ({ error: "not used" }),
    listProjectFiles: async () => ({ files: [] }),
    searchWeb: async () => ({ ok: true, provider: "test", count: 0, results: [] }),
    fetchWebPage: async () => ({ ok: true, url: "", title: "", contentType: "text/html", content: "" }),
    listDatasets: (w) => ({
      ok: true,
      datasets: [
        { resource: "passive-recon", path: "recon/passive-recon.json", collection: "discoveredAssets", keyFields: ["type", "value"], exists: true },
        { resource: "endpoints", path: "enumeration/endpoints.json", collection: "endpoints", keyFields: ["method", "url"], exists: false },
      ],
      provisioned: ["passive-recon"],
      unprovisioned: ["endpoints"],
    }),
    ...extra,
  });
}

test("list_datasets exposes canonical names and provision state at runtime", async () => {
  const handlers = makeHandlers();
  const listed = await handlers.executeToolCall({
    workspace: { detectedRootId: "proj" },
    toolCall: { function: { name: "list_datasets", arguments: {} } },
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.mode, "dataset_list");
  assert.equal(listed.datasets.length, 2);
  assert.ok(listed.provisioned.includes("passive-recon"), "passive sink reported provisioned");
  assert.ok(listed.unprovisioned.includes("endpoints"));
});

test("failure results carry an errorClass the agent can adapt to", async () => {
  const handlers = makeHandlers({
    ingestAssessmentRecords: async () => ({ ok: false, error: "Canonical dataset does not exist yet", code: "DATASET_NOT_FOUND" }),
  });
  const denied = await handlers.executeToolCall({
    workspace: { detectedRootId: "proj" },
    toolCall: { function: { name: "ingest_assessment_records", arguments: { resource: "in-scope", records: [{ value: "x" }], source: "t" } } },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.errorClass, "not_authorized");

  const missing = await handlers.executeToolCall({
    workspace: { detectedRootId: "proj" },
    toolCall: { function: { name: "ingest_assessment_records", arguments: { resource: "endpoints", records: [{ method: "GET", url: "https://x.test/a" }], source: "t" } } },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorClass, "not_found_or_schema");
  assert.match(missing.content, /class: not_found_or_schema/);
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

test("run_security_tool auto-records a ready hypothesis when none exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-run-tool-"));
  const handlers = createToolHandlers({
    fs,
    path,
    resolveWorkspaceTarget: (w, file) => ({ target: path.join(root, file || "") }),
    editWorkspaceFile: async () => ({ ok: true }),
    deleteWorkspaceFile: () => ({ ok: true }),
    buildWorkspaceIndex: async () => ({ files: 0, graph: [] }),
    searchWorkspaceIndex: async () => ({ results: [] }),
    findWorkspaceFiles: async () => ({ results: [] }),
    runWorkspaceCommand: async () => ({ ok: true, exitCode: 0, stdout: "PORT STATE SERVICE\n443/tcp open https" }),
    runWorkspaceProcessArgs: async () => ({ ok: true, exitCode: 0, stdout: "PORT STATE SERVICE\n443/tcp open https" }),
    startWorkspaceProcess: () => ({ ok: true, id: "p1" }),
    readToolProcess: () => ({ ok: true, running: false, exitCode: 0 }),
    stopToolProcess: () => ({ ok: true }),
    listProjectFiles: async () => ({ results: [] }),
    searchWeb: async () => ({ ok: true, results: [] }),
    fetchWebPage: async () => ({ ok: true }),
    assessmentMap: null,
    assessmentWorkspace: null,
    crypto,
    verifyFindingCandidate: async () => ({ ok: true }),
    ingestAssessmentRecords: async () => ({ ok: true }),
    listDatasets: () => ({ datasets: [], provisioned: [], unprovisioned: [] }),
    writeGuidanceFile: async () => ({ ok: true }),
    globalGuidanceRoot: "",
    subagentRunner: null,
  });

  const result = await handlers.executeToolCall({
    workspace: root,
    toolCall: {
      function: {
        name: "run_security_tool",
        arguments: {
          adapter_id: "nmap",
          target: "example.com",
          hypothesis_id: "hyp-auto-1",
          expected_signal: "Open port",
          technique_ids: ["service-discovery"],
          evidence_plan: ["nmap output"],
          configuration: { rateLimit: 2, timeoutMs: 5000 },
        },
      },
    },
  });
  // The hypothesis is recorded and ready before the tool runs; the DNS
  // stability check may still reject in a sandbox, but the deadlock is gone.
  const file = path.join(root, ".xekute", "logs", "agent-hypotheses.jsonl");
  assert.equal(fs.existsSync(file), true);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length >= 1, true);
  const rec = JSON.parse(lines[lines.length - 1]);
  assert.equal(rec.id, "hyp-auto-1");
  assert.equal(rec.status, "ready");
  assert.equal(rec.source, "agent-run-security-tool");
  assert.equal(result.ok, false); // DNS stability check is the only remaining gate in the sandbox
  assert.notEqual(result.errorCode, "HYPOTHESIS_NOT_READY");
  fs.rmSync(root, { recursive: true, force: true });
});
