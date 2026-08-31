"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createManageIdentityTool } = require("../src/agent/tools/assessment/manage-identity.js");
const { createToolRegistry, registerManageIdentity } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manage-identity-test-"));
  return { root };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-identity-1",
    toolName: "manage_identity",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

async function run(tool, input, root) {
  return tool.execute(input, execContext({ root }));
}

test("manage_identity creates an identity and never exposes secrets", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  const result = await run(tool, {
    operation: "create",
    identityId: "user-alice",
    name: "Alice",
    account: { accountId: "acct-1", tenant: "acme" },
    cookies: [{ name: "session", value: "abc123" }],
    tokens: { accessToken: "secret-token-xyz" },
    role: "tester",
  }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.identityId, "user-alice");
  // Secrets must not leak into results
  assert.equal(result.value.identity.cookies, undefined);
  assert.equal(result.value.identity.tokens, undefined);
  assert.equal(result.value.identity.hasCookies, true);
  assert.equal(result.value.identity.hasTokens, true);
  assert.equal(result.value.identity.cookieCount, 1);
  assert.equal(JSON.stringify(result.value).includes("secret-token-xyz"), false);
});

test("manage_identity loads an identity back", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  await run(tool, { operation: "create", identityId: "u1", name: "One", account: { accountId: "a1" } }, root);
  const result = await run(tool, { operation: "load", identityId: "u1" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.name, "One");
  assert.equal(result.value.identity.account.accountId, "a1");
});

test("manage_identity switches the active identity and isolates it", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  await run(tool, { operation: "create", identityId: "u1", account: { accountId: "acct-1" }, cookies: [{ name: "c", value: "v" }], tokens: { accessToken: "t" }, role: "admin" }, root);
  const switched = await run(tool, { operation: "switch", identityId: "u1" }, root);
  assert.equal(switched.ok, true);
  assert.equal(switched.value.identityId, "u1");
  const isolated = await run(tool, { operation: "isolate" }, root);
  assert.equal(isolated.ok, true);
  assert.equal(isolated.value.identityId, "u1");
  assert.equal(isolated.value.accountContext.role, "admin");
  assert.equal(isolated.value.cookieCount, 1);
  assert.deepEqual(isolated.value.tokenNames, ["configured"]);
  // Isolation bundle must not include the raw cookie/token values
  assert.equal(JSON.stringify(isolated.value).includes('"value":"v"'), false);
  assert.equal(JSON.stringify(isolated.value).includes('"t"'), false);
});

test("manage_identity isolate with no active identity fails cleanly", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  const result = await run(tool, { operation: "isolate" }, root);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MANAGE_IDENTITY_NONE_ACTIVE");
});

test("manage_identity lists identities and reports the active one", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  await run(tool, { operation: "create", identityId: "u1" }, root);
  await run(tool, { operation: "create", identityId: "u2" }, root);
  await run(tool, { operation: "switch", identityId: "u2" }, root);
  const result = await run(tool, { operation: "list" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.count, 2);
  assert.equal(result.value.activeId, "u2");
});

test("manage_identity persists identities to the workspace and reloads them", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  await run(tool, { operation: "create", identityId: "persist", name: "Persisted" }, root);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "identities", "persist.json")), true);
  const fresh = createManageIdentityTool();
  const result = await run(fresh, { operation: "load", identityId: "persist" }, root);
  assert.equal(result.ok, true);
  assert.equal(result.value.identity.name, "Persisted");
});

test("manage_identity rejects duplicate and missing identities", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  await run(tool, { operation: "create", identityId: "u1" }, root);
  const dup = await run(tool, { operation: "create", identityId: "u1" }, root);
  assert.equal(dup.error.code, "MANAGE_IDENTITY_ALREADY_EXISTS");
  const missing = await run(tool, { operation: "load", identityId: "nope" }, root);
  assert.equal(missing.error.code, "MANAGE_IDENTITY_NOT_FOUND");
  const badSwitch = await run(tool, { operation: "switch", identityId: "nope" }, root);
  assert.equal(badSwitch.error.code, "MANAGE_IDENTITY_NOT_FOUND");
});

test("manage_identity rejects malformed input", async () => {
  const tool = createManageIdentityTool();
  assert.equal((await run(tool, {}, null)).error.code, "INVALID_MANAGE_IDENTITY_INPUT");
  assert.equal((await run(tool, { operation: "bogus" }, null)).error.code, "INVALID_MANAGE_IDENTITY_INPUT");
  assert.equal((await run(tool, { operation: "create", cookies: "not-array" }, null)).error.code, "INVALID_MANAGE_IDENTITY_INPUT");
  assert.equal((await run(tool, { operation: "create", tokens: "not-object" }, null)).error.code, "INVALID_MANAGE_IDENTITY_INPUT");
  assert.equal((await run(tool, { operation: "create", identityId: "a\nb" }, null)).error.code, "INVALID_MANAGE_IDENTITY_INPUT");
});

test("manage_identity rejects an unrestricted execution context projection", async () => {
  const tool = createManageIdentityTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-identity-2",
    toolName: "manage_identity",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ operation: "create", identityId: "x" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("manage_identity registration adds exactly one raw tool entry", () => {
  const tool = createManageIdentityTool();
  const registry = createToolRegistry();
  const entry = registerManageIdentity(registry, tool);
  assert.equal(entry.name, "manage_identity");
  assert.deepEqual(registry.names(), ["manage_identity"]);
  assert.throws(() => registerManageIdentity(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.equal(entry.metadata.mutating, true);
});

test("manage_identity does not independently authorize execution", async () => {
  const { root } = makeFixture();
  const tool = createManageIdentityTool();
  const result = await run(tool, { operation: "create", identityId: "u1", tokens: { accessToken: "t" } }, root);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("authorized" in result.value, false);
});

test("manage_identity closes browser contexts before deleting an identity", async () => {
  const { root } = makeFixture();
  const closed = [];
  const tool = createManageIdentityTool({ onDelete: async (workspace, identityId) => {
    closed.push({ workspace, identityId });
    return { ok: true };
  } });
  await run(tool, { operation: "create", identityId: "account-a" }, root);
  const result = await run(tool, { operation: "delete", identityId: "account-a" }, root);
  assert.equal(result.ok, true);
  assert.deepEqual(closed, [{ workspace: root, identityId: "account-a" }]);
});
