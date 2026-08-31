"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
const { createToolRegistry, registerApplyPatch } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-test-"));
  fs.writeFileSync(path.join(root, "existing.txt"), "hello world\nsecond line\nthird line\n", "utf8");
  fs.writeFileSync(path.join(root, "move-source.txt"), "move me\n", "utf8");
  return { root };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-apply-1",
    toolName: "apply_patch",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

async function run(tool, operations, root, extra = {}) {
  return tool.execute({ operations, ...extra }, execContext({ root }));
}

test("apply_patch creates a file", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "create", path: "new-file.txt", content: "new content\n" }], root);
  assert.equal(result.ok, true);
  assert.equal(result.value.applied, 1);
  assert.equal(result.value.changes[0].kind, "create");
  assert.match(result.value.changes[0].diff, /\+ new content/);
  assert.equal(fs.readFileSync(path.join(root, "new-file.txt"), "utf8"), "new content\n");
});

test("apply_patch modifies a file by replacing exact content", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "modify", path: "existing.txt", content: "replaced\n" }], root);
  assert.equal(result.ok, true);
  assert.equal(result.value.changes[0].kind, "modify");
  assert.match(result.value.changes[0].diff, /- hello world/);
  assert.match(result.value.changes[0].diff, /\+ replaced/);
  assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "replaced\n");
});

test("apply_patch modifies with a search that must match exactly once", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "modify", path: "existing.txt", search: "hello world", replaceWith: "hello there" }], root);
  assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), /^hello there/);
});

test("apply_patch rejects a search that occurs zero times", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "modify", path: "existing.txt", search: "zzz-nonexist", replaceWith: "x" }], root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "APPLY_PATCH_SEARCH_NOT_FOUND");
  assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "hello world\nsecond line\nthird line\n");
});

test("apply_patch rejects a search that occurs more than once", async () => {
  const { root } = makeFixture();
  fs.writeFileSync(path.join(root, "dup.txt"), "dup dup dup\n", "utf8");
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "modify", path: "dup.txt", search: "dup", replaceWith: "once" }], root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "APPLY_PATCH_SEARCH_AMBIGUOUS");
  assert.equal(fs.readFileSync(path.join(root, "dup.txt"), "utf8"), "dup dup dup\n");
});

test("apply_patch moves a file", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "move", path: "move-source.txt", target: "moved.txt" }], root);
  assert.equal(result.ok, true);
  assert.equal(result.value.changes[0].kind, "move");
  assert.equal(fs.existsSync(path.join(root, "move-source.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "moved.txt"), "utf8"), "move me\n");
});

test("apply_patch deletes a file", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "delete", path: "move-source.txt" }], root);
  assert.equal(result.ok, true);
  assert.equal(result.value.changes[0].kind, "delete");
  assert.equal(fs.existsSync(path.join(root, "move-source.txt")), false);
});

test("apply_patch rejects deleting a directory with a structured error", async () => {
  const { root } = makeFixture();
  fs.mkdirSync(path.join(root, "adirectory"));
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "delete", path: "adirectory" }], root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "APPLY_PATCH_TARGET_IS_DIRECTORY");
  assert.equal(fs.existsSync(path.join(root, "adirectory")), true);
});

test("apply_patch ensure_dir creates a directory", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "ensure_dir", path: "newdir/subdir" }], root);
  assert.equal(result.ok, true);
  assert.equal(fs.statSync(path.join(root, "newdir", "subdir")).isDirectory(), true);
  assert.equal(result.value.changes[0].kind, "ensure_dir");
});

test("apply_patch atomic failure does not write any file", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [
    { kind: "create", path: "should-not-exist.txt", content: "written\n" },
    { kind: "create", path: "existing.txt", content: "conflict\n" },
  ], root);
  assert.equal(result.ok, false);
  assert.ok(result.error.code.includes("CREATE") || result.error.code.includes("CONFLICT"));
  assert.equal(fs.existsSync(path.join(root, "should-not-exist.txt")), false);
  assert.equal(fs.readFileSync(path.join(root, "existing.txt"), "utf8"), "hello world\nsecond line\nthird line\n");
});

test("apply_patch rejects malformed input", async () => {
  const tool = createApplyPatchTool();
  assert.equal((await run(tool, [], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
  assert.equal((await run(tool, [{ kind: "unknown", path: "x" }], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
  assert.equal((await run(tool, [{ kind: "create", path: "a\nb", content: "x" }], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
  assert.equal((await run(tool, [{ kind: "create", path: "x" }], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
  assert.equal((await run(tool, [{ kind: "modify", path: "x" }], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
  assert.equal((await run(tool, [{ kind: "move", path: "x" }], null)).error.code, "INVALID_APPLY_PATCH_INPUT");
});

test("apply_patch rejects an unrestricted execution context projection", async () => {
  const tool = createApplyPatchTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-apply-2",
    toolName: "apply_patch",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ operations: [{ kind: "delete", path: "x" }] }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("apply_patch registration adds exactly one raw tool entry", () => {
  const tool = createApplyPatchTool();
  const registry = createToolRegistry();
  const entry = registerApplyPatch(registry, tool);
  assert.equal(entry.name, "apply_patch");
  assert.deepEqual(registry.names(), ["apply_patch"]);
  assert.throws(() => registerApplyPatch(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.deepEqual(entry.metadata.targetTypes, ["file", "workspace"]);
  assert.equal(entry.metadata.mutating, true);
});

test("apply_patch raw adapter contains no authority decision result", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "create", path: "safe.txt", content: "safe\n" }], root);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
});

test("apply_patch dryRun returns a diff without writing", async () => {
  const { root } = makeFixture();
  const tool = createApplyPatchTool();
  const result = await run(tool, [{ kind: "create", path: "dry.txt", content: "dry run\n" }], root, { dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.dryRun, true);
  assert.match(result.value.changes[0].diff, /\+ dry run/);
  assert.equal(fs.existsSync(path.join(root, "dry.txt")), false);
});