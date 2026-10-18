"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { browserScopeStanding, classifyBrowserAction, evaluateBrowserPolicyAsync } = require("../src/agent/authority/scope/browser-scope.js");

const profile = { scope: { inScopeTargets: ["https://app.example.com"], outOfScopeTargets: ["billing.example.com"], authenticationDependencies: ["login.idp.test"] } };
const standing = url => browserScopeStanding(url, { projectProfile: profile }).standing;
const publicDns = async target => ({ ok: true, target, addresses: ["93.184.216.34"] });
const tab = (url, extra = {}) => ({ id: "tab-1", controlGeneration: 3, purpose: "assessment", url, ...extra });
const decide = (input, options = {}) => evaluateBrowserPolicyAsync({ projectProfile: profile, resolveAddresses: publicDns, profileId: "approve_for_me", granted: () => false, ...options, input });

test("cosmetic redirect variants stay in scope", () => {
  assert.equal(standing("https://app.example.com/login"), "in_scope");
  assert.equal(standing("http://app.example.com/"), "in_scope");
  assert.equal(standing("https://www.app.example.com/"), "in_scope");
  assert.equal(standing("https://app.example.com:443/x"), "in_scope");
});

test("sibling subdomains and login hosts are restricted, exclusions and private hosts denied", () => {
  assert.equal(standing("https://admin.example.com/"), "restricted");
  assert.equal(standing("https://login.idp.test/authorize"), "restricted");
  assert.equal(standing("https://billing.example.com/"), "denied");
  assert.equal(standing("http://127.0.0.1:8080/"), "denied");
  assert.equal(standing("https://unrelated.test/"), "off_scope");
  assert.equal(browserScopeStanding("https://app.example.com/", { projectProfile: { scope: {} } }).standing, "unconfigured");
});

test("research tabs are public-web only", () => {
  assert.equal(browserScopeStanding("https://news.test/", { purpose: "research" }).standing, "public");
  assert.equal(browserScopeStanding("http://192.168.1.4/", { purpose: "research" }).standing, "denied");
  assert.equal(browserScopeStanding("http://localhost:3000/", { purpose: "research" }).standing, "denied");
});

test("action classes follow the agreed approval list", () => {
  assert.deepEqual(["observe", "screenshot", "scroll", "hover", "wait", "extract"].map(action => classifyBrowserAction({ action })), Array(6).fill("read"));
  assert.equal(classifyBrowserAction({ action: "click" }), "interact");
  assert.equal(classifyBrowserAction({ action: "click" }, { element: { submits: true } }), "sensitive");
  assert.equal(classifyBrowserAction({ action: "press_key", key: "Enter" }), "sensitive");
  assert.equal(classifyBrowserAction({ action: "press_key", key: "Tab" }), "interact");
  assert.equal(classifyBrowserAction({ action: "type" }), "sensitive");
  assert.equal(classifyBrowserAction({ action: "navigate", url: "https://app.example.com/b" }, { fromOrigin: "https://app.example.com" }), "interact");
  assert.equal(classifyBrowserAction({ action: "navigate", url: "https://other.example.com/" }, { fromOrigin: "https://app.example.com" }), "sensitive");
});

test("in-scope pages run freely except sensitive actions under Ask for Approval", async () => {
  const page = tab("https://app.example.com/cart");
  assert.equal((await decide({ action: "type", text: "x" }, { tab: page })).browserPolicy.decision, "allow");
  assert.equal((await decide({ action: "click" }, { tab: page, profileId: "full_authority" })).browserPolicy.decision, "allow");
  assert.equal((await decide({ action: "type", text: "x" }, { tab: page, profileId: "ask_for_approval" })).browserPolicy.decision, "require_approval");
  assert.equal((await decide({ action: "scroll" }, { tab: page, profileId: "ask_for_approval" })).browserPolicy.decision, "allow");
});

test("a drifted tab asks once per ownership grant, even in Full Authority", async () => {
  const drifted = tab("https://unrelated.test/landing");
  const first = await decide({ action: "observe" }, { tab: drifted, profileId: "full_authority" });
  assert.equal(first.ok, true);
  assert.equal(first.browserPolicy.decision, "require_approval");
  assert.equal(first.browserPolicy.grantKey, "tab-1:3:https://unrelated.test");
  const granted = await decide({ action: "observe" }, { tab: drifted, granted: key => key === "tab-1:3:https://unrelated.test" });
  assert.equal(granted.browserPolicy.decision, "allow");
  const takenBack = await decide({ action: "observe" }, { tab: { ...drifted, controlGeneration: 4 }, granted: key => key === "tab-1:3:https://unrelated.test" });
  assert.equal(takenBack.browserPolicy.decision, "require_approval");
});

test("restricted subdomains allow reading and ask before interaction", async () => {
  const admin = tab("https://admin.example.com/");
  assert.equal((await decide({ action: "observe" }, { tab: admin })).browserPolicy.decision, "allow");
  assert.equal((await decide({ action: "click" }, { tab: admin })).browserPolicy.decision, "require_approval");
  assert.equal((await decide({ action: "navigate", url: "https://admin.example.com/users" }, { tab: tab("https://app.example.com/") })).browserPolicy.decision, "require_approval");
});

test("element actions inside an off-scope frame use the frame's address", async () => {
  const result = await decide({ action: "click" }, { tab: tab("https://app.example.com/"), element: { frameUrl: "https://widgets.unrelated.test/embed" } });
  assert.equal(result.browserPolicy.decision, "require_approval");
});

test("deliberate off-scope navigation, exclusions, private DNS and empty scope are denied", async () => {
  const page = tab("https://app.example.com/");
  assert.equal((await decide({ action: "navigate", url: "https://unrelated.test/" }, { tab: page })).code, "TARGET_OUT_OF_SCOPE");
  assert.equal((await decide({ action: "navigate", url: "https://billing.example.com/" }, { tab: page })).ok, false);
  const privateDns = async () => ({ ok: false, code: "DNS_PRIVATE_OR_RESERVED", reason: "private" });
  assert.equal((await decide({ action: "navigate", url: "https://app.example.com/x" }, { tab: page, resolveAddresses: privateDns })).code, "DNS_PRIVATE_OR_RESERVED");
  const empty = await evaluateBrowserPolicyAsync({ projectProfile: { scope: {} }, input: { action: "observe" }, tab: page, resolveAddresses: publicDns });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "SCOPE_NOT_CONFIGURED");
});

test("research tabs skip assessment scope but never reach private networks", async () => {
  const research = { action: "open_page", purpose: "research", url: "https://docs.example.org/" };
  assert.equal((await evaluateBrowserPolicyAsync({ projectProfile: { scope: {} }, input: research, resolveAddresses: publicDns })).browserPolicy.decision, "allow");
  const rebound = await evaluateBrowserPolicyAsync({ projectProfile: { scope: {} }, input: research, resolveAddresses: async () => ({ ok: false, code: "DNS_PRIVATE_OR_RESERVED", reason: "private" }) });
  assert.equal(rebound.ok, false);
});

test("the real authority pipeline asks for browser scope exceptions in every mode and runs nothing on denial", async () => {
  const { createAuthorityComposition } = require("../src/agent/authority/composition.js");
  const { createInvocationPipeline } = require("../src/agent/authority/invocation-pipeline.js");
  const { createExecutionContext } = require("../src/contracts/tool/execution-context.js");
  const { createToolRegistry, registerBrowserAction } = require("../src/agent/tools/config/tool-registry.js");
  const { createBrowserActionTool } = require("../src/agent/tools/assessment/browser-action.js");
  const { evaluateToolScopeAsync } = require("../src/agent/authority/scope/scope-policy.js");
  const registry = createToolRegistry();
  registerBrowserAction(registry, createBrowserActionTool({ browserProvider: { execute: async () => ({}) } }));
  const composition = createAuthorityComposition({ evaluateScope: evaluateToolScopeAsync });
  const pipeline = createInvocationPipeline({ authorityRegistry: composition.registry, concurrency: composition.concurrency });
  const run = async (authority, args, page, answer) => {
    const asked = [], ran = [];
    const browserPolicy = await evaluateBrowserPolicyAsync({ projectProfile: profile, input: args, tab: page, profileId: authority, granted: () => false, resolveAddresses: publicDns });
    const result = await pipeline.invoke({
      context: createExecutionContext({ invocationId: `inv-${asked.length}-${Math.random()}`, toolName: "browser_action", role: "agent", authority, workspace: { root: process.cwd() }, sessionId: "chat", browserSessionId: "chat", mode: "agent", requestMetadata: { actorId: "local-user", source: "agent" } }),
      toolName: "browser_action", args, entry: registry.get("browser_action"),
      execute: async () => { ran.push(args.action); return { ok: true, value: {} }; },
      runtime: { projectProfile: profile, browserPolicy, approvalProvider: async proposal => { asked.push(proposal.reason); return { approved: answer }; } },
    });
    return { result, asked, ran };
  };
  const drifted = tab("https://unrelated.test/landing");
  const denied = await run("full_authority", { action: "observe", tabId: "tab-1" }, drifted, false);
  assert.deepEqual(denied.ran, []);
  assert.equal(denied.asked.length, 1);
  assert.match(denied.asked[0], /unrelated\.test/);
  assert.equal(denied.result.code, "APPROVAL_DENIED");
  const approved = await run("full_authority", { action: "observe", tabId: "tab-1" }, drifted, true);
  assert.deepEqual(approved.ran, ["observe"]);
  const inScope = tab("https://app.example.com/");
  assert.deepEqual((await run("full_authority", { action: "type", tabId: "tab-1", target: { kind: "selector", selector: "#q" }, text: "x" }, inScope, false)).ran, ["type"]);
  const askMode = await run("ask_for_approval", { action: "type", tabId: "tab-1", target: { kind: "selector", selector: "#q" }, text: "x" }, inScope, false);
  assert.deepEqual(askMode.ran, []);
  assert.equal(askMode.asked.length, 1);
  assert.deepEqual((await run("ask_for_approval", { action: "observe", tabId: "tab-1" }, inScope, false)).asked, []);
  const offScopeNav = await run("full_authority", { action: "navigate", tabId: "tab-1", url: "https://unrelated.test/" }, inScope, true);
  assert.deepEqual(offScopeNav.ran, []);
  assert.equal(offScopeNav.result.code, "TARGET_OUT_OF_SCOPE");
});

test("a blank frame inside a drifted page still asks", async () => {
  const result = await decide({ action: "click" }, { tab: tab("https://unrelated.test/"), element: { frameUrl: "about:blank" } });
  assert.equal(result.browserPolicy.decision, "require_approval");
});

test("shared hosting tenants are separate sites, not related subdomains", () => {
  const heroku = { scope: { inScopeTargets: ["victim.herokuapp.com"] } };
  assert.equal(browserScopeStanding("https://other.herokuapp.com/", { projectProfile: heroku }).standing, "off_scope");
  assert.equal(browserScopeStanding("https://api.victim.herokuapp.com/", { projectProfile: heroku }).standing, "restricted");
});

test("research tabs cannot reach excluded, in-scope, or scope-related hosts", () => {
  for (const url of ["https://billing.example.com/", "https://app.example.com/", "https://admin.example.com/"]) {
    assert.equal(browserScopeStanding(url, { projectProfile: profile, purpose: "research" }).code, "RESEARCH_ASSESSMENT_TARGET", url);
  }
  assert.equal(browserScopeStanding("https://news.test/", { projectProfile: profile, purpose: "research" }).standing, "public");
});

test("closing or listing tabs never asks, even on a drifted page", async () => {
  const drifted = tab("https://unrelated.test/");
  assert.equal((await decide({ action: "close_page", tabId: "tab-1" }, { tab: drifted, profileId: "full_authority" })).browserPolicy.decision, "allow");
  assert.equal((await decide({ action: "list_pages" }, { tab: null })).browserPolicy.decision, "allow");
});
