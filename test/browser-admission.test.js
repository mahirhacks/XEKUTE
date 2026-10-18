"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConcurrencyCoordinator, resourceClaims } = require("../src/agent/authority/gates/concurrency-gate.js");
const { evaluateBrowserPolicyAsync } = require("../src/agent/authority/scope/browser-scope.js");

const context = { workspace: { root: "G:/Project" } };
const claims = browser => resourceClaims({ context, toolName: "browser_action", args: {}, state: {}, browser });
const settle = promise => Promise.race([promise.then(() => "acquired"), new Promise(resolve => setTimeout(() => resolve("waiting"), 80))]);

test("browser claims lock the tab, share the identity, and take a traffic slot only for traffic", () => {
  assert.deepEqual(claims({ tabId: "Tab-1", identityId: "Admin", traffic: true, slots: 3 }), [
    { key: "browser-tab:g:/project:tab-1", mode: "write" },
    { key: "browser-traffic:g:/project", mode: "slot", capacity: 3 },
    { key: "identity:g:/project:admin", mode: "read" },
  ]);
  assert.deepEqual(claims({ tabId: "tab-1", identityId: "", traffic: false }), [{ key: "browser-tab:g:/project:tab-1", mode: "write" }]);
});

test("independent tabs with one identity progress together up to the project concurrency", async () => {
  const coordinator = createConcurrencyCoordinator({ pollMs: 5 });
  const one = await coordinator.acquireMany(claims({ tabId: "a", identityId: "admin", traffic: true, slots: 2 }), "one");
  assert.equal(await settle(coordinator.acquireMany(claims({ tabId: "b", identityId: "admin", traffic: true, slots: 2 }), "two")), "acquired");
  const third = coordinator.acquireMany(claims({ tabId: "c", identityId: "admin", traffic: true, slots: 2 }), "three");
  assert.equal(await settle(third), "waiting");
  assert.equal(await settle(coordinator.acquireMany(claims({ tabId: "d", identityId: "admin", traffic: false }), "read")), "acquired");
  coordinator.release(one);
  assert.equal(await settle(third), "acquired");
});

test("an identity edit waits for in-flight browser work on that identity, and the same tab stays serialized", async () => {
  const coordinator = createConcurrencyCoordinator({ pollMs: 5 });
  const browsing = await coordinator.acquireMany(claims({ tabId: "a", identityId: "admin", traffic: true, slots: 4 }), "browse");
  const edit = coordinator.acquireMany([{ key: "identity:g:/project:admin", mode: "write" }], "edit");
  assert.equal(await settle(edit), "waiting");
  assert.equal(await settle(coordinator.acquireMany(claims({ tabId: "a", traffic: false }), "same-tab")), "waiting");
  coordinator.release(browsing);
  assert.equal(await settle(edit), "acquired");
});

test("blocked transfers are denied before the browser reads any file", async () => {
  const projectProfile = { scope: { inScopeTargets: ["app.example.com"] }, browser: { uploads: "blocked", downloads: "blocked" } };
  const tab = { id: "t", controlGeneration: 1, purpose: "assessment", url: "https://app.example.com/" };
  const upload = await evaluateBrowserPolicyAsync({ projectProfile, tab, input: { action: "upload", paths: ["secret.txt"] } });
  assert.equal(upload.ok, false);
  assert.equal(upload.code, "BROWSER_UPLOAD_BLOCKED");
  assert.equal((await evaluateBrowserPolicyAsync({ projectProfile, tab, input: { action: "download", downloadId: "d" } })).code, "BROWSER_DOWNLOAD_BLOCKED");
  const allowed = await evaluateBrowserPolicyAsync({ projectProfile: { ...projectProfile, browser: { uploads: "allowed" } }, tab, input: { action: "upload", paths: ["a.txt"] } });
  assert.equal(allowed.ok, true);
});

test("a decision made before queueing does not survive a stricter scope at dispatch", async () => {
  const { browserPolicyStillHolds } = require("../src/agent/authority/scope/browser-scope.js");
  const publicDns = async target => ({ ok: true, target, addresses: ["93.184.216.34"] });
  const tab = { id: "t", controlGeneration: 2, purpose: "assessment", url: "https://app.example.com/" };
  const decide = (projectProfile, input, page = tab) => evaluateBrowserPolicyAsync({ projectProfile, tab: page, input, resolveAddresses: publicDns });
  const wide = { scope: { inScopeTargets: ["app.example.com"] } };
  const queued = await decide(wide, { action: "click" });
  assert.equal(browserPolicyStillHolds(queued, await decide(wide, { action: "click" })), true);
  assert.equal(browserPolicyStillHolds(queued, await decide({ scope: { inScopeTargets: ["other.example.com"] } }, { action: "click" })), false);
  assert.equal(browserPolicyStillHolds(queued, await decide({ scope: {} }, { action: "click" })), false);
  assert.equal(browserPolicyStillHolds(queued, await decide({ ...wide, scope: { ...wide.scope, outOfScopeTargets: ["app.example.com"] } }, { action: "click" })), false);
  const drifted = { ...tab, url: "https://unrelated.test/" };
  const approved = await decide(wide, { action: "click" }, drifted);
  assert.equal(browserPolicyStillHolds(approved, await decide(wide, { action: "click" }, drifted)), true);
  assert.equal(browserPolicyStillHolds(approved, await decide(wide, { action: "click" }, { ...drifted, url: "https://elsewhere.test/" })), false);
});
