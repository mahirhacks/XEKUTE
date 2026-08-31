"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");
const { createKnowledgeLibraryService } = require("../src/app/services/knowledge/knowledge-library-service.js");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-knowledge-"));
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
  return { root, artifacts };
}

test("create/repair bootstrap writes project and evidence indexes", () => {
  const { root, artifacts } = boot();
  const artifactsReady = artifacts.bootstrap(root);
  assert.equal(artifactsReady.ok, true, artifactsReady.error);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.projectIndex)), true);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.evidenceIndex)), true);
  assert.equal(Artifacts.PATHS.findingsIndex, undefined);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "findings")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Knowledge Library IPC channels and create/repair bootstrap are wired", () => {
  const projectIpc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "ipc", "project.js"), "utf8");
  const settingsIpc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "ipc", "settings.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");
  const contracts = fs.readFileSync(path.join(__dirname, "..", "src", "contracts", "ipc", "IpcContracts.js"), "utf8");
  for (const channel of ["knowledge:list", "knowledge:status", "knowledge:preview", "knowledge:install", "knowledge:remove", "knowledge:reindex"]) {
    assert.match(projectIpc, new RegExp(`ipcMain\\.handle\\("${channel}"`));
    assert.match(projectIpc, new RegExp(`"${channel}"`));
    assert.match(settingsIpc, new RegExp(`"${channel}"`));
  }
  assert.match(projectIpc, /assessmentWorkspace\.repair[\s\S]*projectArtifacts\.bootstrap/);
  assert.match(preload, /knowledgeList:/);
  assert.match(preload, /knowledgeStatus:/);
  assert.match(preload, /knowledgePreview:/);
  assert.match(preload, /knowledgeInstall:/);
  assert.match(preload, /knowledgeRemove:/);
  assert.match(preload, /knowledgeReindex:/);
  assert.match(contracts, /"knowledge:install"/);
});

test("list status install remove reindex hit the knowledge library service and bundled remove is protected", async () => {
  const { root, artifacts } = boot();
  artifacts.bootstrap(root);
  const calls = [];
  const store = {
    list: () => { calls.push("list"); return { ok: true, releases: [{ id: "bundled-wstg", bundled: true }] }; },
    get: () => { calls.push("get"); return { ok: true, release_id: "bundled-wstg" }; },
    releaseFile: () => path.join(root, "does-not-exist.json"),
    previewInstall: (pkg) => { calls.push("preview"); return { ok: true, preview: { signed: false }, package: pkg }; },
    install: (pkg, options) => { calls.push("install"); return { ok: true, package: pkg, ...options }; },
  };
  const kag = {
    retrieve: async () => ({ ok: true, records: [] }),
    health: () => ({ ok: true, status: "ready", model: "bge", chunkCount: 1, vectorCount: 1, recordCount: 1, releaseCount: 1 }),
    rebuildProjectIndex: () => { calls.push("reindex"); return { ok: true, rebuilt: true }; },
  };
  const lib = createKnowledgeLibraryService({
    store,
    kag,
    artifacts,
    projectIdentityStore: { resolveProject: () => ({ project_id: "proj_test" }) },
  });
  assert.equal(lib.list().ok, true);
  assert.equal(lib.status(root).ok, true);
  assert.equal(lib.previewInstall({ release_id: "demo" }).ok, true);
  assert.equal(lib.install({ release_id: "demo" }, { confirmation: "hash" }).ok, true);
  const protectedRemove = lib.remove("bundled-wstg");
  assert.equal(protectedRemove.ok, false);
  assert.equal(protectedRemove.code, "KNOWLEDGE_BUNDLED_RELEASE_PROTECTED");
  assert.equal(lib.reindex(root).ok, true);
  assert.ok(calls.includes("list"));
  assert.ok(calls.includes("get"));
  assert.ok(calls.includes("preview"));
  assert.ok(calls.includes("install"));
  assert.ok(calls.includes("reindex"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("Hypothesis/Plan artifactStates come from inspect().project.documents and verified evidence", () => {
  const { root, artifacts } = boot();
  artifacts.bootstrap(root);
  const snapshot = artifacts.inspect(root);
  const staged = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: snapshot.revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Project", value: "library-input", source_refs: ["s1"] }],
  });
  assert.equal(staged.ok, true, staged.error);
  assert.equal(artifacts.commit(root, staged.staging_id).ok, true);
  const lib = createKnowledgeLibraryService({
    store: { list: () => ({ ok: true, releases: [] }), get: () => ({ ok: false }), releaseFile: () => path.join(root, "x.json") },
    kag: { retrieve: async () => ({ ok: true, records: [] }), health: () => ({ ok: true, model: "none" }), rebuildProjectIndex: () => ({ ok: true }) },
    artifacts,
    projectIdentityStore: { resolveProject: () => ({ project_id: "proj_test" }) },
  });
  const states = lib.artifactStates(root, "proj_test");
  assert.equal(states.ok, true);
  assert.ok(states.projectState.entities.some((entity) => String(entity.attributes?.value || "").includes("library-input")));
  assert.ok(Array.isArray(states.evidenceState.findings));
  for (const finding of states.evidenceState.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ["id", "severity", "status"]);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
