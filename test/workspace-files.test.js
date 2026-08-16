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
