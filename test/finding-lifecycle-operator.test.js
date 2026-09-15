"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");
const { readUiShell } = require("./helpers/ui-shell.js");

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-finding-ui-"));
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
  assert.equal(artifacts.bootstrap(root).ok, true);
  return { root, artifacts, workspace };
}

function seedVerified(artifacts, root) {
  const snapshot = artifacts.inspect(root);
  const ops = [
    ["agent", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]],
    ["agent", [{
      kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
      target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
    }]],
    ["agent", [{
      kind: "evidence.create", client_ref: "e1", title: "Cookie observed", status: "verified", verifier: "hybrid-accept",
      checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid",
    }]],
  ];
  let revisions = snapshot.revisions;
  for (const [mode, operations] of ops) {
    const staged = artifacts.stage(root, { mode, expected_revisions: revisions, operations });
    assert.equal(staged.ok, true, staged.error);
    assert.equal(artifacts.commit(root, staged.staging_id).ok, true);
    revisions = artifacts.inspect(root).revisions;
  }
}

test("workspace has no findings API; verified evidence is E-#### and leftover findings stay unread", () => {
  const { root, artifacts, workspace } = boot();
  assert.equal(typeof workspace.appendFinding, "undefined");
  assert.equal(fs.existsSync(path.join(__dirname, "..", "src", "domain", "assessment", "finding-validation.js")), false);
  seedVerified(artifacts, root);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "evidence", "E-0001.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "findings")), false);
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "Leftover" }] }, null, 2)}\n`);
  const snapshot = artifacts.inspect(root);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.evidence.some((item) => item.id === "E-0001"), true);
  assert.equal(snapshot.findings, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot.evidence), /Leftover/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Explorer has no leftover findings layer", () => {
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const html = readUiShell();
  assert.doesNotMatch(bootstrap, /\.xekute\/findings\/index\.md/);
  assert.doesNotMatch(html, /data-bounty-file="\.xekute\/findings\/index\.md"/);
  assert.doesNotMatch(html, /data-bounty-file="findings\/findings\.json"/);
  assert.match(html, /data-bounty-file="\.xekute\/project_info\/index\.md"/);
  assert.match(html, /data-bounty-file="traffic\/raw\.jsonl"/);
  assert.doesNotMatch(html, /data-bounty-file="\.xekute\/evidence\/index\.md"/);
  assert.doesNotMatch(html, /data-bounty-file="\.xekute\/checklist\.md"/);
  assert.doesNotMatch(html, /data-app-settings-section="knowledge"|Knowledge Library|app-settings-knowledge-panel/);
  assert.doesNotMatch(html, /Memory Health/);
  assert.doesNotMatch(bootstrap, /Memory Health|knowledgeList|knowledgeInstall|scheduleTier2MemoryMaintenance/);
  assert.match(bootstrap, /MODE_TOOL_GROUPS = globalThis\.XekuteOperatingModes\?\.MODE_TOOL_GROUPS/);
  assert.doesNotMatch(bootstrap, /every selected mode receives the canonical catalog/);
});
