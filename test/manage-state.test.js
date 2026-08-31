"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createManageStateTool } = require("../src/agent/tools/workspace/manage-state.js");
const { createToolRegistry, registerManageState } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manage-state-test-"));
  return { root };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-state-1",
    toolName: "manage_state",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

async function run(tool, input, root, invocationId = "invocation-state-1") {
  return tool.execute(input, execContext({ root, invocationId }));
}

test("manage_state writes and reads structured state", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const write = await run(tool, { operation: "write", key: "wf", value: { stage: "recon", target: "example.com" } }, root);
  assert.equal(write.ok, true);
  assert.equal(write.value.operation, "write");
  const read = await run(tool, { operation: "read", key: "wf" }, root);
  assert.equal(read.ok, true);
  assert.equal(read.value.state.stage, "recon");
  assert.equal(read.value.state.target, "example.com");
});

test("manage_state caches identical keys independently per project", async () => {
  const first = makeFixture().root;
  const second = makeFixture().root;
  const tool = createManageStateTool();
  await run(tool, { operation: "write", key: "workflow", value: { project: "first" } }, first);
  await run(tool, { operation: "write", key: "workflow", value: { project: "second" } }, second);
  assert.equal((await run(tool, { operation: "read", key: "workflow" }, first)).value.state.project, "first");
  assert.equal((await run(tool, { operation: "read", key: "workflow" }, second)).value.state.project, "second");
});

test("manage_state creates a checkpoint and appends to history", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const c1 = await run(tool, { operation: "checkpoint", key: "wf", label: "after-recon", data: { hosts: 3 } }, root);
  assert.equal(c1.ok, true);
  assert.equal(c1.value.checkpoints, 1);
  const c2 = await run(tool, { operation: "checkpoint", key: "wf", label: "after-scan", data: { findings: 1 } }, root);
  assert.equal(c2.ok, true);
  assert.equal(c2.value.checkpoints, 2);
  const read = await run(tool, { operation: "read", key: "wf" }, root);
  assert.equal(read.value.state.checkpoints.length, 2);
  assert.equal(read.value.state.checkpoints[0].label, "after-recon");
  assert.equal(read.value.state.checkpoints[1].data.findings, 1);
});

test("manage_state stores a summary", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const result = await run(tool, { operation: "summary", key: "wf", summary: "Recon complete; 3 hosts found" }, root);
  assert.equal(result.ok, true);
  const read = await run(tool, { operation: "read", key: "wf" }, root);
  assert.equal(read.value.state.summary, "Recon complete; 3 hosts found");
});

test("manage_state stores progress and clamps it to 0..100", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const ok = await run(tool, { operation: "progress", key: "wf", progress: 42 }, root);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.progress, 42);
  const read = await run(tool, { operation: "read", key: "wf" }, root);
  assert.equal(read.value.state.progress, 42);
  const bad = await run(tool, { operation: "progress", key: "wf", progress: 150 }, root);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "INVALID_MANAGE_STATE_INPUT");
});

test("manage_state reads missing state as a structured error", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const result = await run(tool, { operation: "read", key: "missing" }, root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MANAGE_STATE_NOT_FOUND");
});

test("manage_state deletes state", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  await run(tool, { operation: "write", key: "doomed", value: { stage: "recon" } }, root);
  const result = await run(tool, { operation: "delete", key: "doomed" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.deleted, true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "state", "doomed.json")), false);
  const after = await run(tool, { operation: "read", key: "doomed" }, root);
  assert.equal(after.error.code, "MANAGE_STATE_NOT_FOUND");
});

test("manage_state persists state to the workspace and reloads it", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  await run(tool, { operation: "write", key: "persist", value: { stage: "done" } }, root);
  const file = path.join(root, ".xekute", "state", "persist.json");
  assert.equal(fs.existsSync(file), true);
  const fresh = createManageStateTool();
  const result = await run(fresh, { operation: "read", key: "persist" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.state.stage, "done");
});

test("manage_state isolates state by invocation context", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  await run(tool, { operation: "write", key: "shared", value: { owner: "first" } }, root, "invocation-a");
  await run(tool, { operation: "write", key: "shared", value: { owner: "second" } }, root, "invocation-b");
  const read = await run(tool, { operation: "read", key: "shared" }, root, "invocation-c");
  assert.equal(read.value.state.owner, "second");
  // Checkpoint and summary record their invocation context
  await run(tool, { operation: "checkpoint", key: "shared", label: "ck", data: {} }, root, "invocation-b");
  const read2 = await run(tool, { operation: "read", key: "shared" }, root, "invocation-c");
  assert.equal(read2.value.state.checkpoints[0].createdBy, "invocation-b");
});

test("manage_state rejects malformed input", async () => {
  const tool = createManageStateTool();
  assert.equal((await run(tool, {}, null)).error.code, "INVALID_MANAGE_STATE_INPUT");
  assert.equal((await run(tool, { operation: "bogus" }, null)).error.code, "INVALID_MANAGE_STATE_INPUT");
  assert.equal((await run(tool, { operation: "write", key: "x", value: "not-object" }, null)).error.code, "INVALID_MANAGE_STATE_INPUT");
  assert.equal((await run(tool, { operation: "summary", key: "x", summary: "" }, null)).error.code, "INVALID_MANAGE_STATE_INPUT");
  assert.equal((await run(tool, { operation: "progress", key: "x", progress: "high" }, null)).error.code, "INVALID_MANAGE_STATE_INPUT");
});

test("manage_state rejects an unrestricted execution context projection", async () => {
  const tool = createManageStateTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-state-2",
    toolName: "manage_state",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ operation: "write", key: "x", value: {} }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("manage_state registration adds exactly one raw tool entry", () => {
  const tool = createManageStateTool();
  const registry = createToolRegistry();
  const entry = registerManageState(registry, tool);
  assert.equal(entry.name, "manage_state");
  assert.deepEqual(registry.names(), ["manage_state"]);
  assert.throws(() => registerManageState(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, true);
});

test("manage_state contains no authority or recovery decision", async () => {
  const { root } = makeFixture();
  const tool = createManageStateTool();
  const result = await run(tool, { operation: "write", key: "wf", value: { stage: "recon" } }, root);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
  assert.equal("recovery" in result.value, false);
});
