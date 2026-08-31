"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSkillKnowledgeGraph, parseFrontmatter } = require("../src/app/services/assessment/knowledge/skill-knowledge-graph.js");
const { createMcpRuntime } = require("../src/app/services/assessment/knowledge/mcp-runtime.js");

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), "xekute-knowledge-")); }

test("Markdown skills use stable filename IDs and support exact, phase, and ranked queries", () => {
  const graph = createSkillKnowledgeGraph({ libraryRoot: path.resolve(__dirname, "../src/prompts/skills") });
  assert.equal(graph.validation().ok, true);
  const exact = graph.query({ skill: "passive_recon" });
  assert.equal(exact.exact, true);
  assert.equal(exact.items[0].id, "passive_recon");
  assert.match(exact.items[0].workflow, /certificates/i);
  assert.ok(exact.pagination);
  assert.ok(exact.tokenAccounting.estimatedTokens > 0);
  assert.ok(graph.query({ phase: "recon", limit: 30 }).items.length >= 3);
  const firstPage = graph.query({ phase: "recon", limit: 1, offset: 0 });
  const secondPage = graph.query({ phase: "recon", limit: 1, offset: firstPage.pagination.nextOffset });
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
  assert.equal(secondPage.pagination.offset, 1);
  assert.ok(graph.query({ query: "negative control verification", limit: 10 }).items.length >= 1);
  assert.ok(graph.query({ skill: "passive-recon" }).items[0].aliases.includes("passive-recon"));
});

test("malformed frontmatter and duplicate normalized skill IDs fail graph validation", () => {
  assert.match(parseFrontmatter("---\ntitle: broken\n" ).error, /terminated/i);
  const root = workspace();
  try {
    fs.mkdirSync(path.join(root, "one"), { recursive: true });
    fs.mkdirSync(path.join(root, "two"), { recursive: true });
    const body = "---\ntitle: Same\nphase: recon\n---\n\n## Purpose\nSame";
    fs.writeFileSync(path.join(root, "one", "same.md"), body);
    fs.writeFileSync(path.join(root, "two", "same.md"), body);
    const graph = createSkillKnowledgeGraph({ libraryRoot: root });
    assert.equal(graph.validation().ok, false);
    assert.match(graph.validation().error, /duplicate/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP resolution prefers project configuration, activates only allowlisted tools, and fails closed", async () => {
  const root = workspace();
  const globalRoot = workspace();
  const connections = [];
  try {
    fs.mkdirSync(path.join(root, ".xekute"), { recursive: true });
    fs.mkdirSync(path.join(globalRoot, ".xekute"), { recursive: true });
    fs.writeFileSync(path.join(globalRoot, ".xekute", "mcp.json"), JSON.stringify({ mcpServers: { scout: { command: "global" } } }));
    fs.writeFileSync(path.join(root, ".xekute", "mcp.json"), JSON.stringify({ mcpServers: { scout: { command: "project" } } }));
    const runtime = createMcpRuntime({
      home: () => globalRoot,
      connect: async ({ config }) => {
        connections.push(config.command);
        return {
          initialize: async () => [{ name: "host_search", description: "search", inputSchema: { type: "object", properties: { host: { type: "string" } } } }],
          request: async (_method, params) => ({ ok: true, params }),
          close() {},
        };
      },
    });
    const active = await runtime.activate({
      workspace: root,
      sessionId: "session-1",
      mode: "agent",
      mappings: [{ server: "scout", tools: [{ name: "host_search", modes: ["agent"], access: "read", target_types: ["network"], target_arguments: ["host"] }] }],
    });
    assert.deepEqual(connections, ["project"]);
    assert.equal(active.tools[0].function.name, "mcp__scout__host_search");
    const missingContext = await runtime.execute("mcp__scout__host_search", { host: "example.com" });
    assert.equal(missingContext.code, "MCP_TOOL_NOT_ACTIVE");
    const result = await runtime.execute("mcp__scout__host_search", { host: "example.com" }, { workspace: root, sessionId: "session-1", mode: "agent" });
    assert.equal(result.ok, true);
    assert.equal(runtime.activeForSession("session-1")[0].metadata.targetArguments[0], "host");
    const incomplete = await runtime.activate({ workspace: root, sessionId: "session-2", mode: "agent", mappings: [{ server: "scout", tools: [{ name: "host_search", modes: ["agent"], access: "read" }] }] });
    assert.equal(incomplete.tools.length, 0);
    assert.equal(incomplete.unavailable[0].code, "MCP_MAPPING_INCOMPLETE");
    await runtime.activate({
      workspace: root,
      sessionId: "session-2",
      mode: "agent",
      mappings: [{ server: "scout", tools: [{ name: "host_search", modes: ["agent"], access: "read", target_types: ["network"], target_arguments: ["host"] }] }],
    });
    assert.equal(runtime.activeForSession("session-1", { workspace: root }).length, 1);
    assert.equal(runtime.activeForSession("session-2", { workspace: root }).length, 1);
    assert.equal((await runtime.execute("mcp__scout__host_search", { host: "example.com" }, { workspace: root, sessionId: "session-1", mode: "agent" })).ok, true);
    runtime.clearSession("session-1");
    assert.equal(runtime.activeForSession("session-1").length, 0);
    assert.equal(runtime.activeForSession("session-2").length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(globalRoot, { recursive: true, force: true });
  }
});

test("incomplete MCP metadata leaves skill methodology available and reports the mapping unavailable", async () => {
  const root = workspace();
  let connections = 0;
  try {
    fs.writeFileSync(path.join(root, "incomplete.md"), `---\ntitle: Incomplete Mapping\nphase: recon\nmcp:\n  - server: scout\n    tools:\n      - name: host_search\n        modes: [agent]\n        target_types: [network]\n        target_arguments: [host]\n---\n\n## Purpose\nKeep this methodology available.\n`);
    const runtime = createMcpRuntime({
      home: () => root,
      connect: async () => { connections += 1; throw new Error("should not connect"); },
    });
    const graph = createSkillKnowledgeGraph({ libraryRoot: root, mcpRuntime: runtime });
    assert.equal(graph.validation().ok, true);
    const result = await graph.query({ skill: "incomplete" }, { workspace: root, sessionId: "session-1", mode: "agent" });
    assert.match(result.items[0].methodology, /Keep this methodology available/);
    assert.equal(result.unavailableMcp[0].code, "MCP_MAPPING_INCOMPLETE");
    assert.equal(connections, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an oversized skill is paginated without activating its MCP mappings", async () => {
  const root = workspace();
  let connections = 0;
  try {
    const sections = ["Purpose", "Prerequisites", "Workflow", "Evidence to collect", "Verification rules", "Stop conditions"]
      .map((heading) => `## ${heading}\n${"oversized methodology ".repeat(90)}`)
      .join("\n");
    fs.writeFileSync(path.join(root, "oversized.md"), `---\ntitle: Oversized\nphase: recon\nmcp:\n  - server: scout\n    tools:\n      - name: host_search\n        modes: [agent]\n        access: read\n        target_types: [network]\n        target_arguments: [host]\n---\n\n${sections}\n\n## Notes\n${"filler ".repeat(1000)}\n`);
    const runtime = createMcpRuntime({
      home: () => root,
      connect: async () => { connections += 1; throw new Error("should not connect"); },
    });
    const graph = createSkillKnowledgeGraph({ libraryRoot: root, mcpRuntime: runtime });
    const result = await graph.query({ skill: "oversized" }, { workspace: root, sessionId: "session-1", mode: "agent" });
    assert.equal(result.items.length, 0);
    assert.equal(result.activeTools.length, 0);
    assert.equal(connections, 0);
    assert.equal(result.pagination.nextOffset, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
