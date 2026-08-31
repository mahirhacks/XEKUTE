"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createExpandEvidenceTool } = require("../src/agent/tools/assessment/expand-evidence.js");
const { SOURCE_FILES, indexWorkspaceSync } = require("../src/app/services/assessment/intelligence/intelligence-indexer.js");
const Store = require("../src/app/services/assessment/intelligence/intelligence-store.js");
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
  commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]);
  commitOps(artifacts, root, "plan", [{
    kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
    target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
  }]);
  commitOps(artifacts, root, "agent", [{
    kind: "evidence.create", client_ref: "e1", title: extraEvidence.title || "Cookie observed", status: "verified", verifier: "hybrid-accept",
    checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid",
    ...extraEvidence,
  }]);
}

function ctx(root, toolName) {
  return projectExecutionContext(createExecutionContext({
    invocationId: `${toolName}-test`,
    toolName,
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root },
    sessionId: "session-1",
    mode: "agent",
  }));
}

test("indexer SOURCE_FILES omits findings.json, pointer manifests, and agent-hypotheses.jsonl", () => {
  const listed = SOURCE_FILES.map(([relative]) => relative);
  assert.equal(listed.includes("findings/findings.json"), false);
  assert.equal(listed.includes(".xekute/logs/agent-hypotheses.jsonl"), false);
  assert.equal(listed.includes(".pointer-assessment.json"), false);
  assert.equal(listed.includes("pen_context.md"), false);
});

test("E-####.md is indexed and leftover findings JSON is unread", async () => {
  const { root, artifacts } = boot();
  seedVerified(artifacts, root, { title: "CanonicalIndexedEvidence" });
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "LegacyJsonFinding" }] }, null, 2)}\n`);
  fs.mkdirSync(path.join(root, ".xekute", "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".xekute", "logs", "agent-hypotheses.jsonl"), `${JSON.stringify({ title: "LegacyHypothesisLog" })}\n`);
  const indexPath = path.join(root, ".xekute", "intelligence", "index.sqlite");
  const indexed = await indexWorkspaceSync({ workspace: root, indexPath });
  assert.equal(indexed.ok, true, indexed.error);
  const db = Store.openDatabase(indexPath);
  try {
    const rows = db.prepare("SELECT label, summary, data_json FROM entities").all();
    const blob = JSON.stringify(rows);
    assert.match(blob, /CanonicalIndexedEvidence/);
    assert.doesNotMatch(blob, /LegacyJsonFinding/);
    assert.doesNotMatch(blob, /LegacyHypothesisLog/);
  } finally {
    db.close();
  }
  const indexerSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "assessment", "intelligence", "intelligence-indexer.js"), "utf8");
  assert.match(indexerSource, /parseEvidence/);
  assert.match(indexerSource, /function indexEvidenceMarkdown/);
  assert.doesNotMatch(indexerSource, /parseFinding|indexFindingMarkdown|findings\/findings\.json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("engagement-context and expand_evidence use inspect() evidence, not findings", async () => {
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
  const expander = createExpandEvidenceTool({ artifacts });
  const expanded = await expander.execute({ refs: ["E-0001"] }, ctx(root, "expand_evidence"));
  assert.equal(expanded.ok, true);
  assert.equal(expanded.records[0].id, "E-0001");
  assert.equal(expanded.source, "project-artifacts");
  fs.rmSync(root, { recursive: true, force: true });
});

test("reports use verified E-#### and do not read findings.json as a reportable store", () => {
  const { root, artifacts, workspace } = boot();
  seedVerified(artifacts, root, { title: "ReportableEvidence", severity: "high" });
  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "JsonOnlyFinding" }] }, null, 2)}\n`);
  const report = workspace.generateReport(root);
  assert.equal(report.error, undefined, report.error);
  const markdown = fs.readFileSync(path.join(root, "report", "report.md"), "utf8");
  assert.match(markdown, /E-0001/);
  assert.match(markdown, /ReportableEvidence/);
  assert.doesNotMatch(markdown, /JsonOnlyFinding|F-0001/);
  assert.match(markdown, /Verified Evidence/);
  const reportSource = fs.readFileSync(path.join(__dirname, "..", "src", "domain", "assessment", "assessment-workspace.js"), "utf8");
  assert.doesNotMatch(reportSource, /readJson\("findings\/findings\.json"/);
  fs.rmSync(root, { recursive: true, force: true });
});
