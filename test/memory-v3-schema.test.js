"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SCHEMAS } = require("../src/contracts/memory/v3-schemas.js");
const { getDefaultMemorySchemaRegistry } = require("../src/contracts/memory/schema-registry.js");

const TYPED_PREFIX = /^\^(?:(?:proj|session|block|entity|claim|rel|attempt|finding|verification|artifact|procedure|txn|job|checkpoint|blocker|op|event|kb|sel)|(?:verification|event))_/;

function walk(value, visit, path = "") {
  visit(value, path);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) walk(child, visit, path ? `${path}.${key}` : key);
}

test("V3 typed ID schema nodes require a non-empty bounded suffix", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    walk(schema, (node, path) => {
      if (!node || typeof node !== "object" || typeof node.pattern !== "string") return;
      if (!TYPED_PREFIX.test(node.pattern)) return;
      assert.equal(node.pattern.endsWith("_"), false, `${name} ${path} still accepts a bare typed prefix`);
      assert.ok(Number(node.maxLength) <= 240, `${name} ${path} must cap typed IDs at 240 characters`);
    });
  }
});

test("KAG selections require immutable release provenance", () => {
  const registry = getDefaultMemorySchemaRegistry();
  const base = {
    schema_version: 3,
    project_id: "proj_x",
    project_revision: 1,
    selections: [{
      procedure_id: "procedure_x",
      release_id: "release-x",
      release_hash: "a".repeat(64),
      procedure_hash: "b".repeat(64),
      selected: true,
      rank: 0,
      reason: "mandatory",
      source_refs: ["kb_source"],
      prerequisite_state: "unknown",
    }],
    solver_state: "ready",
    scoring_version: "v3.0",
  };
  assert.equal(registry.validate("KagSelectionV3", base).ok, true);
  const withoutReleaseHash = structuredClone(base);
  delete withoutReleaseHash.selections[0].release_hash;
  assert.equal(registry.validate("KagSelectionV3", withoutReleaseHash).ok, false);
});
