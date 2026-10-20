"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accountMasks,
  describeAccounts,
  loadAccounts,
  maskAccountSecrets,
  resolveAccountVariables,
} = require("../src/agent/runtime/account-variables.js");

const accounts = new Map([
  ["credential-admin", { label: "Admin", role: "admin", username: "admin@example.test", secret: { username: "admin@example.test", password: "Hunter2 pass!", cookie: "sid=abc123def; theme=dark" } }],
  ["credential-user", { label: "User", role: "", username: "user@example.test", secret: { username: "user@example.test", password: "pw-user-9", cookie: "" } }],
]);

test("variables in any argument resolve to the stored values", () => {
  const resolved = resolveAccountVariables({
    action: "type",
    text: "{{account.credential-admin.password}}",
    headers: [{ name: "Cookie", value: "{{ account.credential-admin.cookie }}" }],
    command: "curl -u {{account.credential-user.username}}:{{account.credential-user.password}} https://app.example.test",
  }, accounts);
  assert.deepEqual(resolved, {
    ok: true,
    args: {
      action: "type",
      text: "Hunter2 pass!",
      headers: [{ name: "Cookie", value: "sid=abc123def; theme=dark" }],
      command: "curl -u user@example.test:pw-user-9 https://app.example.test",
    },
  });
});

test("an unknown account or a missing field fails instead of sending the placeholder", () => {
  assert.deepEqual(resolveAccountVariables({ text: "{{account.credential-nope.password}}" }, accounts), {
    ok: false,
    error: { code: "ACCOUNT_VARIABLE_UNRESOLVED", message: "There is no test account credential-nope. Use one listed under testAccounts in the project settings.", retryable: false },
  });
  assert.equal(resolveAccountVariables({ text: "{{account.credential-user.cookie}}" }, accounts).error.message,
    "Test account credential-user has no cookie saved. Ask the operator to add it in Settings > Project > Engagement.");
});

test("results mask stored passwords and cookies, including encoded forms", () => {
  const masks = accountMasks(accounts);
  const result = {
    ok: true,
    value: {
      output: "login as admin@example.test with Hunter2 pass! ok",
      request: "POST /login\nemail=user%40example.test&password=pw-user-9\nCookie: sid=abc123def; theme=dark",
      form: "password=Hunter2+pass%21",
      authorization: `Basic ${Buffer.from("admin@example.test:Hunter2 pass!").toString("base64")}`,
      setCookie: "sid=abc123def; Path=/; HttpOnly",
    },
  };
  assert.deepEqual(maskAccountSecrets(result, masks), {
    ok: true,
    value: {
      output: "login as admin@example.test with {{account.credential-admin.password}} ok",
      request: "POST /login\nemail=user%40example.test&password={{account.credential-user.password}}\nCookie: {{account.credential-admin.cookie}}",
      form: "password={{account.credential-admin.password}}",
      authorization: "Basic base64({{account.credential-admin.username}}:{{account.credential-admin.password}})",
      setCookie: "sid={{account.credential-admin.cookie}}; Path=/; HttpOnly",
    },
  });
});

test("short values and encoded blobs are left alone", () => {
  const masks = accountMasks(new Map([["credential-short", { secret: { username: "u", password: "abc", cookie: "a=b" } }]]));
  assert.deepEqual(masks, []);
  const blob = "data:image/png;base64," + "QUJDRA".repeat(1000) + "Hunter2";
  assert.equal(maskAccountSecrets({ image: blob }, accountMasks(accounts)).image, blob);
});

test("the model sees labels, roles, usernames and variables but no secrets", () => {
  const described = describeAccounts(accounts);
  assert.deepEqual(described.accounts, [
    { label: "Admin", role: "admin", username: "admin@example.test", variables: { username: "{{account.credential-admin.username}}", password: "{{account.credential-admin.password}}", cookie: "{{account.credential-admin.cookie}}" } },
    { label: "User", role: "user", username: "user@example.test", variables: { username: "{{account.credential-user.username}}", password: "{{account.credential-user.password}}" } },
  ]);
  assert.doesNotMatch(JSON.stringify(described), /Hunter2|abc123def|pw-user-9/);
  assert.equal(describeAccounts(new Map()), null);
});

test("accounts load from the vault with their decrypted secrets", () => {
  const vault = {
    listCredentials: () => ({ ok: true, value: { credentials: [{ credentialId: "credential-admin", label: "Admin", role: "admin", username: "admin@example.test" }, { credentialId: "credential-broken" }] } }),
    readCredential: (_workspace, id) => (id === "credential-admin" ? { ok: true, secret: { username: "admin@example.test", password: "p4ssword" } } : { ok: false }),
  };
  const loaded = loadAccounts(vault, "G:/project");
  assert.deepEqual([...loaded.keys()], ["credential-admin"]);
  assert.equal(loaded.get("credential-admin").secret.password, "p4ssword");
  assert.equal(loadAccounts(vault, "").size, 0);
});

test("project settings give the agent each account's variables without its secrets", () => {
  const EngagementContext = require("../src/app/services/guidance/engagement-context.js");
  const InitialPrompts = require("../src/prompts/instructions/initial-context.js");
  const context = EngagementContext.mergeEngagementContext({ projectProfile: { project: { name: "Portal" }, testAccounts: describeAccounts(accounts) } });
  const prompt = InitialPrompts.projectSettings(context);
  assert.match(prompt, /"username": "admin@example\.test"/);
  assert.match(prompt, /"password": "\{\{account\.credential-admin\.password\}\}"/);
  const rendered = EngagementContext.renderEngagementContext(context);
  assert.match(rendered, /- Admin \(admin\), username admin@example\.test: \{\{account\.credential-admin\.username\}\}, \{\{account\.credential-admin\.password\}\}, \{\{account\.credential-admin\.cookie\}\}/);
  assert.doesNotMatch(prompt + rendered, /Hunter2|abc123def|pw-user-9/);
});
