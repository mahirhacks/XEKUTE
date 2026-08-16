"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { createProjectProfileStore } = require("../src/app/storage/project-profile-store.js");
const { evaluateNetworkTarget, loadScopePolicy } = require("../src/agent/authority/scope/scope-policy.js");

test("project profiles are app-managed and do not scaffold the project folder", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-project-profile-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, "plain-project");
  const appData = path.join(temporary, "app-data");
  fs.mkdirSync(projectRoot);

  const store = createProjectProfileStore({ fs, path, crypto, baseDirectory: appData });
  const initial = store.read(projectRoot);
  assert.equal(initial.ok, true);
  assert.equal(initial.exists, false);
  assert.deepEqual(fs.readdirSync(projectRoot), []);

  const saved = store.save(projectRoot, {
    ...initial.profile,
    project: { ...initial.profile.project, name: "Client Portal Review", status: "active" },
    authorization: { ...initial.profile.authorization, confirmed: true, authorizedBy: "Asset owner" },
    scope: { ...initial.profile.scope, inScopeTargets: ["https://app.example.com"], outOfScopeTargets: ["admin.example.com"] },
    rulesOfEngagement: { ...initial.profile.rulesOfEngagement, allowActiveRecon: true, allowedTechniques: ["httpx"] },
    review: { ...initial.profile.review, scopeReviewed: true, exclusionsConfirmed: true, rulesAccepted: true },
    engagement: { ...initial.profile.engagement, executionModel: "browser_bound", authenticationSelection: { kind: "credential", id: "account-a" } },
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.profile.project.name, "Client Portal Review");
  assert.equal(saved.profile.engagement.executionModel, "browser_bound");
  assert.deepEqual(saved.profile.engagement.authenticationSelection, { kind: "credential", id: "account-a" });
  assert.deepEqual(fs.readdirSync(projectRoot), []);
  assert.equal(fs.readdirSync(appData).length, 1);

  const secondSave = store.save(projectRoot, {
    ...saved.profile,
    project: { ...saved.profile.project, description: "Backup recovery check" },
  });
  assert.equal(secondSave.ok, true);
  const primary = fs.readdirSync(appData).find((name) => name.endsWith(".json"));
  fs.writeFileSync(path.join(appData, primary), "{damaged", "utf8");
  const recovered = store.read(projectRoot);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recoveredFromBackup, true);
  assert.equal(recovered.profile.project.name, "Client Portal Review");

  const scope = loadScopePolicy(projectRoot, saved.profile);
  assert.deepEqual(scope.targets, ["https://app.example.com"]);
  assert.deepEqual(scope.excludedTargets, ["admin.example.com"]);
  assert.equal(evaluateNetworkTarget("https://app.example.com/login", scope).ok, true);
  assert.equal(evaluateNetworkTarget("https://admin.example.com", scope).code, "TARGET_OUT_OF_SCOPE");
});

test("project profiles clear authentication selections without a reference id", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-project-profile-auth-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, "plain-project");
  const appData = path.join(temporary, "app-data");
  fs.mkdirSync(projectRoot);

  const store = createProjectProfileStore({ fs, path, crypto, baseDirectory: appData });
  const initial = store.read(projectRoot);
  const saved = store.save(projectRoot, {
    ...initial.profile,
    engagement: { ...initial.profile.engagement, authenticationSelection: { kind: "credential", id: "" } },
  });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.profile.engagement.authenticationSelection, { kind: "none", id: "" });

  const invalid = store.save(projectRoot, {
    ...saved.profile,
    engagement: { ...saved.profile.engagement, authenticationSelection: { kind: "identity", id: "../account-a" } },
  });
  assert.deepEqual(invalid.profile.engagement.authenticationSelection, { kind: "none", id: "" });

  const invalidExecutionModel = store.save(projectRoot, {
    ...invalid.profile,
    engagement: { ...invalid.profile.engagement, executionModel: "share_browser_cookies_with_scanners" },
  });
  assert.equal(invalidExecutionModel.profile.engagement.executionModel, "operator_choice");
});
