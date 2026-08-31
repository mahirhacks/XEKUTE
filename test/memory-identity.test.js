"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { canonicalize, canonicalJson, canonicalKeyHash } = require("../src/contracts/memory/memory-identity.js");
const { createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
const { toOpenAITool } = require("../src/agent/tools/config/tool-registry.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000004011";
const sessionId = "session_00000000-0000-4000-8000-000000004012";

function applyPatchProviderTool() {
  const entry = createApplyPatchTool();
  return toOpenAITool({ name: entry.name, description: entry.description, inputSchema: entry.inputSchema });
}

test("canonicalize sorts object keys and keeps JSON-compatible scalars", () => {
  assert.equal(canonicalJson({ b: 1, a: true, z: null }), '{"a":true,"b":1,"z":null}');
  assert.equal(canonicalize("hi"), "hi");
});

test("canonicalize omits values deeper than the supported nesting depth instead of throwing", () => {
  let nested = "leaf";
  for (let index = 0; index < 40; index += 1) nested = { child: nested };
  assert.doesNotThrow(() => canonicalize(nested));
  assert.match(canonicalJson(nested), /\[OMITTED_TOO_DEEP\]/);
});

test("canonicalize treats circular references as a stable sentinel", () => {
  const cycle = { name: "loop" };
  cycle.self = cycle;
  assert.doesNotThrow(() => canonicalize(cycle));
  assert.equal(JSON.parse(canonicalJson(cycle)).self, "[CIRCULAR]");
});

test("canonicalize still rejects non-JSON values", () => {
  assert.throws(() => canonicalize(() => {}), /JSON-compatible/);
  assert.throws(() => canonicalize(undefined), /JSON-compatible/);
});

test("prefix hashing of live apply_patch tool schemas does not abort", () => {
  const prefix = {
    A: [{ label: "Tool Definitions", value: [applyPatchProviderTool()] }],
  };
  assert.doesNotThrow(() => canonicalKeyHash(prefix));
  assert.equal(canonicalKeyHash(prefix).length, 64);
});

test("Tier 1 assemble hashes a greeting turn that includes provider tool schemas", () => {
  const coordinator = createTier1ContextCoordinator({
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  const assembled = coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    current_user_prompt: "hi",
    tool_definitions: [applyPatchProviderTool()],
    effective_context_limit: 100_000,
  });
  assert.notEqual(assembled.ok, false);
  assert.equal(typeof assembled.prefix_hash, "string");
  assert.equal(assembled.prefix_hash.length, 64);
});
