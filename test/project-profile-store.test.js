"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { createProjectProfileStore } = require("../src/domain/project/project-profile-store");
const { loadPolicy } = require("../src/agent/policy/policy-engine");

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
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.profile.project.name, "Client Portal Review");
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

  const policy = loadPolicy(projectRoot, { superMode: "approve", permissions: { activeRecon: true } }, saved.profile);
  assert.equal(policy.authorizationConfirmed, true);
  assert.equal(policy.scopeReviewed, true);
  assert.equal(policy.rulesAccepted, true);
  assert.equal(policy.allowActiveTesting, true);
  assert.deepEqual(policy.targets, ["https://app.example.com"]);
  assert.deepEqual(policy.excludedTargets, ["admin.example.com"]);
});
