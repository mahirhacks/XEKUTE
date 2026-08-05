"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLLOUT_MODES,
  normalizeRollout,
  buildUnifiedProviderCatalog,
  buildProviderCatalog,
  catalogNames,
  assertCatalogNames,
} = require("../src/application/tools/provider-catalog");
const { PUBLIC_TOOL_NAMES } = require("../src/contracts/tool/unified-catalog");

test("unified provider catalog exposes exactly 17 Agent tools and stable profile subsets", () => {
  const agent = buildUnifiedProviderCatalog("agent");
  assert.equal(agent.version, "xekute.vapt.v1");
  assert.deepEqual(agent.names, PUBLIC_TOOL_NAMES);
  assert.equal(agent.tools.length, 17);
  assertCatalogNames(agent, "agent");
  for (const profile of ["planner", "ask", "hypothesis"]) {
    const catalog = buildUnifiedProviderCatalog(profile);
    assertCatalogNames(catalog, profile);
    assert.ok(catalog.tools.every((tool) => PUBLIC_TOOL_NAMES.includes(tool.function.name)));
  }
});

test("rollout selector preserves legacy default and supports shadow/enabled modes", () => {
  assert.deepEqual(ROLLoutModesSafe(), ["legacy", "unified_shadow", "unified_enabled"]);
  assert.equal(normalizeRollout("unknown"), "legacy");
  const legacy = buildProviderCatalog({ profile: "agent", legacyTools: [{ function: { name: "run_command" } }] });
  assert.equal(legacy.version, "legacy");
  assert.deepEqual(catalogNames(legacy), ["run_command"]);
  const shadow = buildProviderCatalog({ profile: "agent", rollout: "unified_shadow", legacyTools: [{ function: { name: "run_command" } }] });
  assert.equal(shadow.version, "legacy");
  assert.deepEqual(catalogNames(shadow), ["run_command"]);
  assert.deepEqual(shadow.shadow.names, PUBLIC_TOOL_NAMES);
  const enabled = buildProviderCatalog({ profile: "agent", rollout: "unified_enabled", legacyTools: [{ function: { name: "run_command" } }] });
  assert.deepEqual(catalogNames(enabled), PUBLIC_TOOL_NAMES);
});

function ROLLoutModesSafe() {
  return ROLLOUT_MODES.slice();
}
