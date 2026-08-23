"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorkspaceFiles, applyPatchesToContent } = require("../src/app/services/workspace/workspace-files.js");
const { createWorkspaceSearch } = require("../src/agent/tools/workspace/workspace-search.js");

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
