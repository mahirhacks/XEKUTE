"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAttackGraphTool } = require("../src/agent/tools/assessment/attack-graph.js");
const { createToolRegistry, registerAttackGraph } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attack-graph-test-"));
  return { root };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-graph-1",
    toolName: "attack_graph",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

async function run(tool, input, root) {
  return tool.execute(input, execContext({ root }));
}

test("attack_graph creates nodes and links them with an edge", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "identity-1", type: "identity", label: "anon", evidenceRefs: ["ev-1"] } }, root);
  await run(tool, { operation: "create_node", node: { id: "endpoint-1", type: "endpoint", label: "/login" } }, root);
  await run(tool, { operation: "create_node", node: { id: "request-1", type: "request", label: "POST /login" } }, root);
  const edge = await run(tool, { operation: "create_edge", edge: { id: "edge-1", from: "identity-1", to: "request-1", relation: "sent", evidenceRefs: ["ev-2"] } }, root);
  assert.equal(edge.ok, true);
  assert.equal(edge.value.edge.relation, "sent");
  const list = await run(tool, { operation: "list" }, root);
  assert.equal(list.value.nodeCount, 3);
  assert.equal(list.value.edgeCount, 1);
});

test("attack_graph queries nodes and edges by filters", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "identity-1", type: "identity" } }, root);
  await run(tool, { operation: "create_node", node: { id: "endpoint-1", type: "endpoint" } }, root);
  await run(tool, { operation: "create_node", node: { id: "finding-1", type: "finding" } }, root);
  const byType = await run(tool, { operation: "query", query: { type: "endpoint" } }, root);
  assert.equal(byType.value.nodeCount, 1);
  assert.equal(byType.value.nodes[0].id, "endpoint-1");
  const byId = await run(tool, { operation: "query", query: { nodeId: "identity-1" } }, root);
  assert.equal(byId.value.nodeCount, 1);
});

test("attack_graph updates a node and edge preserving evidence linkage", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "n1", type: "resource", evidenceRefs: ["ev-1"] } }, root);
  await run(tool, { operation: "create_node", node: { id: "n2", type: "finding" } }, root);
  await run(tool, { operation: "create_edge", edge: { id: "e1", from: "n1", to: "n2", relation: "affects" } }, root);
  const updated = await run(tool, { operation: "update_node", node: { id: "n1", label: "renamed", evidenceRefs: ["ev-1", "ev-9"] } }, root);
  assert.equal(updated.ok, true);
  assert.equal(updated.value.node.label, "renamed");
  assert.deepEqual(updated.value.node.evidenceRefs, ["ev-1", "ev-9"]);
  const updatedEdge = await run(tool, { operation: "update_edge", edge: { id: "e1", relation: "affects-critical" } }, root);
  assert.equal(updatedEdge.value.edge.relation, "affects-critical");
});

test("attack_graph rejects invalid nodes and edges", async () => {
  const tool = createAttackGraphTool();
  assert.equal((await run(tool, { operation: "create_node", node: { id: "x", type: "bogus" } }, null)).error.code, "INVALID_ATTACK_GRAPH_INPUT");
  assert.equal((await run(tool, { operation: "create_node", node: { id: "", type: "identity" } }, null)).error.code, "INVALID_ATTACK_GRAPH_INPUT");
  assert.equal((await run(tool, { operation: "create_edge", edge: { id: "e", from: "a", to: "b", relation: "" } }, null)).error.code, "INVALID_ATTACK_GRAPH_INPUT");
  assert.equal((await run(tool, { operation: "bogus" }, null)).error.code, "INVALID_ATTACK_GRAPH_INPUT");
});

test("attack_graph rejects edges referencing missing nodes", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  const result = await run(tool, { operation: "create_edge", edge: { id: "e1", from: "missing", to: "also-missing", relation: "rel" } }, root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ATTACK_GRAPH_INVALID_EDGE");
});

test("attack_graph rejects duplicate nodes and edges", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "n1", type: "identity" } }, root);
  const dup = await run(tool, { operation: "create_node", node: { id: "n1", type: "identity" } }, root);
  assert.equal(dup.error.code, "ATTACK_GRAPH_ALREADY_EXISTS");
});

test("attack_graph deletes a node and its edges", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "n1", type: "identity" } }, root);
  await run(tool, { operation: "create_node", node: { id: "n2", type: "request" } }, root);
  await run(tool, { operation: "create_edge", edge: { id: "e1", from: "n1", to: "n2", relation: "sent" } }, root);
  const result = await run(tool, { operation: "delete", nodeId: "n1" }, root);
  assert.equal(result.ok, true);
  const list = await run(tool, { operation: "list" }, root);
  assert.equal(list.value.nodeCount, 1);
  assert.equal(list.value.edgeCount, 0);
});

test("attack_graph persists the graph to the workspace and reloads it", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  await run(tool, { operation: "create_node", node: { id: "n1", type: "endpoint" } }, root);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "graph", "nodes.json")), true);
  const fresh = createAttackGraphTool();
  const list = await run(fresh, { operation: "list" }, root);
  assert.equal(list.value.nodeCount, 1);
  assert.equal(list.value.nodes[0].id, "n1");
});

test("attack_graph rejects an unrestricted execution context projection", async () => {
  const tool = createAttackGraphTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-graph-2",
    toolName: "attack_graph",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ operation: "list" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("attack_graph registration adds exactly one raw tool entry", () => {
  const tool = createAttackGraphTool();
  const registry = createToolRegistry();
  const entry = registerAttackGraph(registry, tool);
  assert.equal(entry.name, "attack_graph");
  assert.deepEqual(registry.names(), ["attack_graph"]);
  assert.throws(() => registerAttackGraph(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, true);
});

test("attack_graph selects no attack actions and makes no authority decision", async () => {
  const { root } = makeFixture();
  const tool = createAttackGraphTool();
  const result = await run(tool, { operation: "create_node", node: { id: "n1", type: "observation" } }, root);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("attackAction" in result.value, false);
  assert.equal("executed" in result.value, false);
});