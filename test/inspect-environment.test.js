"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInspectEnvironmentTool } = require("../src/agent/tools/workspace/inspect-environment.js");
const { createToolRegistry, registerInspectEnvironment } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-inspect-1",
    toolName: "inspect_environment",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-env-test-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { depA: "^1.0.0" }, devDependencies: { depB: "^2.0.0" } }), "utf8");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "sentinel.txt"), "sentinel\n", "utf8");
  return { root };
}

test("inspect_environment returns structured OS data", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool();
  const result = await tool.execute({ sections: ["os"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.os.available, true);
  assert.equal(typeof result.value.sections.os.data.platform, "string");
  assert.equal(typeof result.value.sections.os.data.hostname, "string");
  assert.equal(typeof result.value.sections.os.data.cpus, "number");
  assert.equal(typeof result.value.sections.os.data.totalMemory, "number");
});

test("inspect_environment returns a workspace snapshot", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool();
  const result = await tool.execute({ sections: ["workspace"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.workspace.available, true);
  assert.equal(result.value.sections.workspace.data.root, root);
  assert.ok(result.value.sections.workspace.data.files.includes("sentinel.txt"));
  assert.ok(result.value.sections.workspace.data.folders.includes("src"));
  assert.equal(typeof result.value.sections.workspace.data.fileCount, "number");
});

test("inspect_environment returns dependencies from package.json", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool();
  const result = await tool.execute({ sections: ["dependencies"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.dependencies.available, true);
  assert.equal(result.value.sections.dependencies.data.name, "fixture");
  assert.deepEqual(result.value.sections.dependencies.data.dependencies, ["depA"]);
  assert.deepEqual(result.value.sections.dependencies.data.devDependencies, ["depB"]);
});

test("inspect_environment reflects an unavailable process provider gracefully", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool({ processManager: null });
  const result = await tool.execute({ sections: ["processes"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.processes.available, false);
  assert.equal(typeof result.value.sections.processes.error, "string");
});

test("inspect_environment reflects unavailable services when no provider is configured", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool({ serviceChecker: null });
  const result = await tool.execute({ sections: ["services"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.services.available, false);
  assert.equal(typeof result.value.sections.services.error, "string");
});

test("inspect_environment uses an injected process provider for inspection", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool({
    processManager: { list: () => ({ available: true, processes: [{ pid: 123, name: "fake", status: "running" }] }) },
  });
  const result = await tool.execute({ sections: ["processes"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal(result.value.sections.processes.available, true);
  assert.equal(result.value.sections.processes.data.processes[0].pid, 123);
});

test("inspect_environment does not mutate the filesystem", async () => {
  const { root } = makeFixture();
  const sentinelBefore = fs.readFileSync(path.join(root, "sentinel.txt"), "utf8");
  const entriesBefore = fs.readdirSync(root);
  const tool = createInspectEnvironmentTool();
  await tool.execute({}, execContext({ root }));
  await tool.execute({ sections: ["os", "workspace", "dependencies", "processes", "services"], includeUnavailable: true }, execContext({ root }));
  const sentinelAfter = fs.readFileSync(path.join(root, "sentinel.txt"), "utf8");
  const entriesAfter = fs.readdirSync(root);
  assert.equal(sentinelBefore, sentinelAfter);
  assert.deepEqual(entriesBefore, entriesAfter);
});

test("inspect_environment rejects malformed input", async () => {
  const tool = createInspectEnvironmentTool();
  assert.equal((await tool.execute({ sections: ["bad"] }, execContext())).error.code, "INVALID_INSPECT_ENVIRONMENT_INPUT");
  assert.equal((await tool.execute({ sections: ["os", "os"] }, execContext())).error.code, "INVALID_INSPECT_ENVIRONMENT_INPUT");
  assert.equal((await tool.execute({ includeUnavailable: "yes" }, execContext())).error.code, "INVALID_INSPECT_ENVIRONMENT_INPUT");
});

test("inspect_environment rejects an unrestricted execution context projection", async () => {
  const tool = createInspectEnvironmentTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-inspect-2",
    toolName: "inspect_environment",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({}, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("inspect_environment registration adds exactly one raw tool entry", () => {
  const tool = createInspectEnvironmentTool();
  const registry = createToolRegistry();
  const entry = registerInspectEnvironment(registry, tool);
  assert.equal(entry.name, "inspect_environment");
  assert.deepEqual(registry.names(), ["inspect_environment"]);
  assert.throws(() => registerInspectEnvironment(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, false);
  assert.equal(entry.metadata.reversible, false);
});

test("inspect_environment raw adapter contains no authority decision result", async () => {
  const { root } = makeFixture();
  const tool = createInspectEnvironmentTool();
  const result = await tool.execute({ sections: ["os"] }, execContext({ root }));
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
});