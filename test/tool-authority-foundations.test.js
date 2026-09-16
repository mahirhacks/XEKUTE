"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateToolScope, evaluateToolScopeAsync, evaluateNetworkTarget } = require("../src/agent/authority/scope/scope-policy.js");

test("workspace scope accepts contained paths and rejects escapes", () => {
  const root = path.resolve("scope-fixture");
  assert.equal(evaluateToolScope({ workspace: root, toolName: "read_file", args: { path: "package.json" } }).ok, true);
  assert.equal(evaluateToolScope({ workspace: root, toolName: "read_file", args: { path: "..\\outside.txt" } }).code, "WORKSPACE_OUT_OF_SCOPE");
  assert.equal(evaluateToolScope({ workspace: root, toolName: "exec_command", args: { cwd: root } }).ok, true);
});

test("network tools require configured scope and enforce exclusions", () => {
  const missing = evaluateToolScope({ workspace: path.resolve("scope-fixture"), toolName: "replay_request", args: { url: "https://example.test" } });
  assert.equal(missing.code, "SCOPE_NOT_CONFIGURED");
  const policy = { configured: true, targets: ["example.test"], excludedTargets: ["admin.example.test"] };
  assert.equal(evaluateNetworkTarget("https://example.test/login", policy).ok, true);
  assert.equal(evaluateNetworkTarget("https://admin.example.test", policy).code, "TARGET_OUT_OF_SCOPE");
});

test("dynamic MCP scope checks every declared network target", () => {
  const decision = evaluateToolScope({
    workspace: path.resolve("scope-fixture"),
    toolName: "mcp__scout__bulk_lookup",
    args: { hosts: ["allowed.example", "outside.example"] },
    projectProfile: { scope: { inScopeTargets: ["allowed.example"] } },
    toolMetadata: { targetTypes: ["network"], targetArguments: ["hosts"] },
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "TARGET_OUT_OF_SCOPE");
});

test("async network scope rechecks DNS safety before execution", async () => {
  const safe = await evaluateToolScopeAsync({
    workspace: path.resolve("scope-fixture"),
    toolName: "replay_request",
    args: { url: "https://example.test" },
    projectProfile: { scope: { inScopeTargets: ["example.test"] } },
    resolveAddresses: async () => ({ ok: true, addresses: ["93.184.216.34"] }),
  });
  assert.equal(safe.ok, true);
  assert.deepEqual(safe.resolvedAddresses, ["93.184.216.34"]);
  const unsafe = await evaluateToolScopeAsync({
    workspace: path.resolve("scope-fixture"),
    toolName: "replay_request",
    args: { url: "https://example.test" },
    projectProfile: { scope: { inScopeTargets: ["example.test"] } },
    resolveAddresses: async () => ({ ok: false, code: "DNS_PRIVATE_OR_RESERVED", reason: "private address" }),
  });
  assert.equal(unsafe.code, "DNS_PRIVATE_OR_RESERVED");
});

test("browser follow-up actions reuse only an already scoped page target", async () => {
  const missing = await evaluateToolScopeAsync({
    workspace: path.resolve("scope-fixture"),
    toolName: "browser_action",
    args: { action: "click", selector: "#submit" },
    projectProfile: { scope: { inScopeTargets: ["example.test"] } },
    resolveAddresses: async () => ({ ok: true, addresses: ["93.184.216.34"] }),
  });
  assert.equal(missing.code, "TARGET_REQUIRED");
  const followUp = await evaluateToolScopeAsync({
    workspace: path.resolve("scope-fixture"),
    toolName: "browser_action",
    args: { action: "click", selector: "#submit" },
    browserTarget: "https://example.test/start",
    projectProfile: { scope: { inScopeTargets: ["example.test"] } },
    resolveAddresses: async () => ({ ok: true, addresses: ["93.184.216.34"] }),
  });
  assert.equal(followUp.ok, true);
});

test("exec_command network probes require configured scope; local commands do not", () => {
  const root = path.resolve("scope-fixture");
  assert.equal(evaluateToolScope({ workspace: root, toolName: "exec_command", args: { command: "echo ok", context: "print ok" } }).ok, true);
  assert.equal(evaluateToolScope({ workspace: root, toolName: "exec_command", args: { command: "nmap --version", context: "check nmap" } }).ok, true);
  const unscope = evaluateToolScope({
    workspace: root,
    toolName: "exec_command",
    args: { command: "nmap 8.8.8.8", context: "scan resolver" },
  });
  assert.equal(unscope.ok, false);
  assert.equal(unscope.code, "SCOPE_NOT_CONFIGURED");
  const allowed = evaluateToolScope({
    workspace: root,
    toolName: "exec_command",
    args: { command: "nmap 10.0.0.5", context: "scan in scope" },
    projectProfile: { scope: { inScopeTargets: ["10.0.0.5"] } },
  });
  assert.equal(allowed.ok, true);
  const curlDenied = evaluateToolScope({
    workspace: root,
    toolName: "exec_command",
    args: { command: "curl https://example.com", context: "fetch page" },
  });
  assert.equal(curlDenied.code, "SCOPE_NOT_CONFIGURED");
});

test("in-scope literal private IPs are not rejected as DNS rebinding", async () => {
  const allowed = await evaluateToolScopeAsync({
    workspace: path.resolve("scope-fixture"),
    toolName: "exec_command",
    args: { command: "nmap 10.0.0.5", context: "scan lab host" },
    projectProfile: { scope: { inScopeTargets: ["10.0.0.5"] } },
  });
  assert.equal(allowed.ok, true, allowed.reason || allowed.code || "");
});

test("scope policy contains no executable or approval gate imports", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "authority", "scope", "scope-policy.js"), "utf8");
  assert.doesNotMatch(source, /approval|risk-classifier|deny-list|allow-list/i);
});
