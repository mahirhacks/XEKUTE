"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { SOURCE_FILES, indexWorkspaceSync } = require("../src/app/services/assessment/intelligence/intelligence-indexer.js");
const { mergeEngagementContext } = require("../src/app/services/guidance/engagement-context.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-intel-"));
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
  assert.equal(artifacts.bootstrap(root).ok, true);
  return { root, artifacts, workspace };
}

function commitOps(artifacts, root, mode, operations) {
  const snapshot = artifacts.inspect(root);
  const staged = artifacts.stage(root, { mode, expected_revisions: snapshot.revisions, operations });
  assert.equal(staged.ok, true, staged.error);
  assert.equal(artifacts.commit(root, staged.staging_id).ok, true);
}

function seedVerified(artifacts, root, extraEvidence = {}) {
  commitOps(artifacts, root, "agent", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]);
  commitOps(artifacts, root, "agent", [{
    kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
    target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
  }]);
  commitOps(artifacts, root, "agent", [{
    kind: "evidence.create", client_ref: "e1", title: extraEvidence.title || "Cookie observed", status: "verified", verifier: "hybrid-accept",
    checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid",
    ...extraEvidence,
  }]);
}

test("indexer SOURCE_FILES omits findings.json, pointer manifests, and agent-hypotheses.jsonl", () => {
  const listed = SOURCE_FILES.map(([relative]) => relative);
  assert.equal(listed.includes("Map/application-map.json"), false);
  assert.equal(listed.includes("findings/findings.json"), false);
  assert.equal(listed.includes(".xekute/logs/agent-hypotheses.jsonl"), false);
  assert.equal(listed.includes(".pointer-assessment.json"), false);
  assert.equal(listed.includes("pen_context.md"), false);
});

test("E-#### stays in memory and leftover findings JSON is unread", async () => {
  const { root, artifacts } = boot();
  seedVerified(artifacts, root, { title: "CanonicalIndexedEvidence" });
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "LegacyJsonFinding" }] }, null, 2)}\n`);
  fs.mkdirSync(path.join(root, ".xekute", "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".xekute", "logs", "agent-hypotheses.jsonl"), `${JSON.stringify({ title: "LegacyHypothesisLog" })}\n`);
  const indexed = await indexWorkspaceSync({ workspace: root, indexPath: ":memory:" });
  assert.equal(indexed.ok, true, indexed.error);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "intelligence", "index.sqlite")), false);
  assert.equal(artifacts.inspect(root).evidence[0].title, "CanonicalIndexedEvidence");
  const indexerSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "assessment", "intelligence", "intelligence-indexer.js"), "utf8");
  assert.match(indexerSource, /parseEvidence/);
  assert.match(indexerSource, /function indexEvidenceMarkdown/);
  assert.doesNotMatch(indexerSource, /parseFinding|indexFindingMarkdown|findings\/findings\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("engagement-context uses inspect() evidence, not findings", async () => {
  const { root, artifacts } = boot();
  seedVerified(artifacts, root, { title: "InspectedEvidence" });
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "ShouldNotSurface" }] }, null, 2)}\n`);
  const merged = mergeEngagementContext({ workspace: root, artifacts });
  assert.equal(merged.findings, undefined);
  assert.ok(merged.evidence.items.some((item) => item.id === "E-0001"));
  assert.equal(merged.evidence.items.some((item) => item.title === "ShouldNotSurface"), false);
  assert.ok(merged.hypotheses.some((item) => item.id === "H-0001"));
  const engagementSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "guidance", "engagement-context.js"), "utf8");
  assert.doesNotMatch(engagementSource, /readWorkspaceJson\([^)]*findings\/findings\.json/);
  assert.doesNotMatch(engagementSource, /merged\.findings|context\.findings/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("reports use verified E-#### and do not read findings.json as a reportable store", () => {
  const { root, artifacts, workspace } = boot();
  seedVerified(artifacts, root, { title: "ReportableEvidence", severity: "high" });
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "JsonOnlyFinding" }] }, null, 2)}\n`);
  const report = workspace.generateReport(root);
  assert.equal(report.error, undefined, report.error);
  assert.match(report.markdown, /E-0001/);
  assert.match(report.markdown, /ReportableEvidence/);
  assert.doesNotMatch(report.markdown, /JsonOnlyFinding|F-0001/);
  assert.match(report.markdown, /Verified Evidence/);
  assert.equal(fs.existsSync(path.join(root, "report")), false);
  const reportSource = fs.readFileSync(path.join(__dirname, "..", "src", "domain", "assessment", "assessment-workspace.js"), "utf8");
  assert.doesNotMatch(reportSource, /readJson\("findings\/findings\.json"/);
  fs.rmSync(root, { recursive: true, force: true });
});
