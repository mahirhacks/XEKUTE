"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkspaceFiles, applyPatchesToContent } = require("../src/app/services/workspace/workspace-files.js");
const { createWorkspaceSearch } = require("../src/agent/tools/workspace/workspace-search.js");
const {
  parseAdvancedQuery,
  deriveDocument,
  evaluateAst,
  detectSecrets,
  hasAdvancedSyntax,
} = require("../src/agent/tools/workspace/advanced-search.js");

test("workspace patches require one exact match and apply in order", () => {
  assert.deepEqual(
    applyPatchesToContent("alpha\nbeta\n", [
      { search: "alpha", replace: "first" },
      { search: "beta", replace: "second" },
    ]),
    { content: "first\nsecond\n", patches_applied: 2 },
  );
  assert.match(applyPatchesToContent("same same", [{ search: "same", replace: "next" }]).error, /matched 2 times/);
  assert.match(applyPatchesToContent("value", [{ search: "missing", replace: "next" }]).error, /not found/);
});

test("workspace file mutations stay inside the root and preserve edit, copy, move, and delete behavior", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-workspace-files-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const files = createWorkspaceFiles({ fs, path, workspaceSearch });

  const created = await files.editWorkspaceFile(workspace, "src/example.txt", { code: "alpha\nbeta\n" });
  assert.equal(created.ok, true);
  assert.equal(fs.readFileSync(path.join(workspace, "src", "example.txt"), "utf8"), "alpha\nbeta\n");

  const escaped = await files.editWorkspaceFile(workspace, "../outside.txt", { code: "blocked" });
  assert.equal(escaped.error, "Path escapes workspace");
  assert.equal(fs.existsSync(path.join(parent, "outside.txt")), false);

  const patched = await files.editWorkspaceFile(workspace, "src/example.txt", {
    patches: [{ search: "beta", replace: "gamma" }],
  });
  assert.equal(patched.mode, "patch");
  assert.equal(patched.content, "alpha\ngamma\n");

  const copied = files.transferWorkspacePath(workspace, "src/example.txt", "src/copy.txt");
  assert.equal(copied.mode, "copy");
  const moved = files.transferWorkspacePath(workspace, "src/copy.txt", "src/moved.txt", { move: true });
  assert.equal(moved.mode, "move");
  assert.equal(fs.existsSync(path.join(workspace, "src", "copy.txt")), false);

  fs.mkdirSync(path.join(workspace, "folder-before", "nested"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "folder-before", "nested", "keep.txt"), "kept", "utf8");
  const renamedFolder = files.transferWorkspacePath(workspace, "folder-before", "folder-after", { move: true });
  assert.equal(renamedFolder.targetType, "directory");
  assert.equal(fs.existsSync(path.join(workspace, "folder-before")), false);
  assert.equal(fs.readFileSync(path.join(workspace, "folder-after", "nested", "keep.txt"), "utf8"), "kept");

  const deleted = files.deleteWorkspaceFile(workspace, "src/moved.txt");
  assert.deepEqual(deleted, { ok: true, mode: "delete", file: "src/moved.txt", targetType: "file" });
  assert.equal(fs.existsSync(path.join(workspace, "src", "moved.txt")), false);
});

test("workspace UI search returns every literal occurrence with exact locations", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-workspace-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(path.join(workspace, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "evidence", "requests.log"), "SQLi marker\nsecond SQLI marker and sqli\n", "utf8");
  fs.writeFileSync(path.join(workspace, "evidence", "other.txt"), "No finding here\n", "utf8");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const result = workspaceSearch.searchWorkspaceIndex(workspace, "sqli", { limit: 100 });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "exact");
  assert.equal(result.totalCount, 3);
  assert.equal(result.count, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.results.map((row) => [row.path, row.line, row.column]), [
    ["evidence/requests.log", 1, 1],
    ["evidence/requests.log", 2, 8],
    ["evidence/requests.log", 2, 24],
  ]);
});

test("workspace UI search streams bounded batches without blocking for the final result", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-workspace-stream-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "many.txt"), `${"marker ".repeat(25)}\n`, "utf8");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const batches = [];
  const result = await workspaceSearch.searchWorkspaceStream(workspace, "marker", {
    limit: 100,
    batchSize: 2,
    onBatch: (payload) => batches.push(payload),
  });

  assert.equal(result.ok, true);
  assert.equal(result.totalCount, 25);
  assert.equal(result.cancelled, false);
  assert.ok(batches.length >= 2);
  assert.equal(batches.flatMap((batch) => batch.results).length, 25);
  assert.ok(batches.every((batch) => batch.results.length <= 10), "batch size is normalized to a safe minimum");
});

test("workspace UI search honors cancellation before starting work", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-workspace-cancel-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const controller = new AbortController();
  controller.abort();
  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const result = await workspaceSearch.searchWorkspaceStream(workspace, "marker", { signal: controller.signal });

  assert.equal(result.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.totalCount, 0);
});

test("workspace UI search worker fallback searches hidden and ignored evidence", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-workspace-worker-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(path.join(workspace, ".evidence"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "ignored"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".gitignore"), "ignored/\n", "utf8");
  fs.writeFileSync(path.join(workspace, ".evidence", "finding.txt"), "worker-marker\n", "utf8");
  fs.writeFileSync(path.join(workspace, "ignored", "capture.log"), "worker-marker\n", "utf8");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const rows = [];
  const result = await workspaceSearch.searchWorkspaceStream(workspace, "worker-marker", {
    forceFallback: true,
    onBatch: (payload) => rows.push(...payload.results),
  });

  assert.equal(result.ok, true);
  assert.equal(result.totalCount, 2);
  assert.deepEqual(rows.map((row) => row.path), [".evidence/finding.txt", "ignored/capture.log"]);
});

test("advanced workspace queries validate Boolean operators and structured VAPT filters", () => {
  const parsed = parseAdvancedQuery("source:traffic AND (status:401 OR status:403) identity:(user,admin) endpoint:/v1/accounts/{id}");
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.fields.status, ["401", "403"]);
  assert.deepEqual(parsed.fields.identity, ["user", "admin"]);
  assert.equal(parseAdvancedQuery("madeup:value").code, "UNKNOWN_SEARCH_OPERATOR");
  assert.equal(parseAdvancedQuery("risk:idorr").code, "INVALID_SEARCH_OPERATOR_VALUE");
  assert.match(parseAdvancedQuery("regex:/(a+)+$/").error, /unsafe/i);
  assert.equal(hasAdvancedSyntax("https://api.example.test/v1/accounts/42"), false);
  assert.equal(hasAdvancedSyntax("foo:bar"), false);
  assert.equal(hasAdvancedSyntax("source:traffic https://api.example.test"), true);

  const record = {
    recordType: "http-exchange",
    method: "GET",
    url: "https://api.example.test/v1/accounts/42",
    statusCode: 403,
    captureIdentity: { id: "user", role: "user" },
    request: { method: "GET", url: "https://api.example.test/v1/accounts/42", headers: { Cookie: "sid=user" } },
    response: { status: 403, headers: { "Content-Type": "application/json" }, body: '{"error":"forbidden"}' },
  };
  const document = deriveDocument({ relativePath: "traffic/raw.jsonl", content: JSON.stringify(record), record, options: parsed.options });
  assert.equal(evaluateAst(parsed.ast, document, parsed.options), true);
});

test("advanced workspace search filters traffic and findings while streaming source counts", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-advanced-workspace-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(path.join(workspace, "traffic"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "findings"), { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const traffic = [
    { recordType: "http-exchange", method: "GET", url: "https://api.test/orders/1001", statusCode: 200, captureIdentity: { id: "account-a" }, request: { method: "GET", url: "https://api.test/orders/1001" }, response: { status: 200, body: '{"id":1001,"owner":"a"}' } },
    { recordType: "http-exchange", method: "GET", url: "https://api.test/orders/1002", statusCode: 500, captureIdentity: { id: "account-b" }, request: { method: "GET", url: "https://api.test/orders/1002" }, response: { status: 500, body: '{"error":"failed"}' } },
  ];
  fs.writeFileSync(path.join(workspace, "traffic", "raw.jsonl"), `${traffic.map(JSON.stringify).join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, "capture.har"), JSON.stringify({ log: { entries: [{ startedDateTime: "2026-08-20T10:00:00Z", request: { method: "POST", url: "https://api.test/session", headers: [], queryString: [] }, response: { status: 401, headers: [{ name: "Content-Type", value: "application/json" }], content: { text: '{"error":"unauthorized"}' } }, time: 12 }] } }), "utf8");
  fs.writeFileSync(path.join(workspace, "findings", "findings.json"), JSON.stringify({ findings: [{ id: "F-1", title: "IDOR", severity: "high", status: "confirmed", confidence: 0.95 }] }, null, 2), "utf8");

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const rows = [];
  const result = await workspaceSearch.searchWorkspaceStream(workspace, "source:traffic status:5xx", { onBatch: (payload) => rows.push(...payload.results) });
  assert.equal(result.mode, "advanced");
  assert.equal(result.totalCount, 1);
  assert.equal(result.sourceCounts.traffic, 1);
  assert.equal(rows[0].line, 2);
  assert.equal(rows[0].status, 500);

  const harRows = [];
  const har = await workspaceSearch.searchWorkspaceStream(workspace, "source:traffic method:POST status:401", { onBatch: (payload) => harRows.push(...payload.results) });
  assert.equal(har.totalCount, 1);
  assert.equal(harRows[0].path, "capture.har");

  const findingRows = [];
  const findings = await workspaceSearch.searchWorkspaceStream(workspace, "source:finding severity:high confidence:>=0.9", { onBatch: (payload) => findingRows.push(...payload.results) });
  assert.equal(findings.totalCount, 1);
  assert.equal(findingRows[0].title, "IDOR");
});

test("IDOR and BOLA search correlates cross-identity object evidence without claiming a confirmed vulnerability", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-idor-search-"));
  const workspace = path.join(parent, "workspace");
  fs.mkdirSync(path.join(workspace, "traffic"), { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const exchange = (identity, id) => ({
    recordType: "http-exchange", method: "GET", url: `https://api.test/api/orders/${id}`, statusCode: 200,
    captureIdentity: { id: identity }, request: { method: "GET", url: `https://api.test/api/orders/${id}`, headers: { Cookie: `sid=${identity}` } },
    response: { status: 200, body: JSON.stringify({ id, amount: 25, state: "paid" }) },
  });
  fs.writeFileSync(path.join(workspace, "traffic", "raw.jsonl"), `${[exchange("account-a", 1001), exchange("account-b", 1001), exchange("account-a", 2001), exchange("account-b", 2002)].map(JSON.stringify).join("\n")}\n`, "utf8");

  const workspaceSearch = createWorkspaceSearch({ fs, path });
  const idorRows = [];
  const idor = await workspaceSearch.searchWorkspaceStream(workspace, "risk:idor same:endpoint compare:identity", { onBatch: (payload) => idorRows.push(...payload.results) });
  assert.equal(idor.correlation, true);
  assert.ok(idorRows.some((row) => row.kind === "authorization-correlation" && /Potential IDOR comparison/.test(row.title)));
  assert.ok(idorRows.every((row) => row.evidence.length === 2 && !/confirmed|vulnerable/i.test(row.title)));

  const bolaRows = [];
  const bola = await workspaceSearch.searchWorkspaceStream(workspace, "risk:bola same:endpoint same:param different:value compare:identity", { onBatch: (payload) => bolaRows.push(...payload.results) });
  assert.ok(bolaRows.some((row) => /Potential BOLA comparison/.test(row.title) && /different path/.test(row.lineText)));
});

test("advanced JavaScript search detects encoded JWT content, likely secrets, sinks, and source maps", () => {
  const payload = Buffer.from(JSON.stringify({ role: "admin", tenantId: "acme" })).toString("base64url");
  const jwt = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${payload}.signature`;
  const parsed = parseAdvancedQuery("source:javascript decode:jwt admin secret-type:jwt sink:dom-xss source-map:true");
  assert.equal(parsed.ok, true, parsed.error);
  const content = `const token = "${jwt}"; element.innerHTML = input; //# sourceMappingURL=app.js.map`;
  const document = deriveDocument({ relativePath: "traffic/artifacts/javascript/objects/app.js", content, options: parsed.options });
  assert.equal(evaluateAst(parsed.ast, document, parsed.options), true);
  assert.ok(detectSecrets(content).includes("jwt"));
});
