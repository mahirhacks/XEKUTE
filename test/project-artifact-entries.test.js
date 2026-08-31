"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-entries-"));
  fs.mkdirSync(path.join(root, ".xekute"), { recursive: true });
  return root;
}

test("PATHS, SOURCE_ENTRY_PATHS, and gitignore match the canonical tree", () => {
  assert.equal(Artifacts.PATHS.project, undefined);
  assert.equal(Artifacts.PATHS.projectDirectory, ".xekute/project_info");
  assert.equal(Artifacts.PATHS.checklist, ".xekute/checklist.md");
  assert.equal(Artifacts.PATHS.findingsDirectory, undefined);
  assert.deepEqual([...Artifacts.SOURCE_ENTRY_PATHS], [
    ".xekute/project_info/engagement.md",
    ".xekute/project_info/targets.md",
    ".xekute/project_info/identities.md",
    ".xekute/project_info/surface.md",
    ".xekute/project_info/controls.md",
    ".xekute/hypotheses.md",
    ".xekute/checklist.md",
  ]);
  assert.equal(Artifacts.gitignoreTemplate(), "/evidence/\n/.internal/\n");
  assert.ok(Artifacts.UNREAD_LEGACY_PATHS.includes(".xekute/project_info.md"));
  assert.ok(Artifacts.UNREAD_LEGACY_PATHS.includes(".xekute/investigation_checklist.md"));
  assert.equal(Artifacts.PROJECT_SECTIONS, undefined);
  assert.deepEqual([...Artifacts.REVISION_KEYS], [
    "project_info.engagement", "project_info.targets", "project_info.identities", "project_info.surface", "project_info.controls",
    "hypotheses", "checklist", "evidence",
  ]);
  assert.equal(Artifacts.FINDING_STATES, undefined);
  assert.ok(!Artifacts.CHECKLIST_PHASES.includes("convergence"));
});

test("isCanonicalInvestigationPath covers the tree and ignores leftover single files", () => {
  for (const relative of [
    ".xekute/project_info/engagement.md",
    ".xekute/project_info/index.md",
    ".xekute/hypotheses.md",
    ".xekute/checklist.md",
    ".xekute/evidence/index.md",
    ".xekute/evidence/E-0001.md",
  ]) assert.equal(Artifacts.isCanonicalInvestigationPath(relative), true, relative);
  assert.equal(Artifacts.isCanonicalInvestigationPath(".xekute/project_info.md"), false);
  assert.equal(Artifacts.isCanonicalInvestigationPath(".xekute/investigation_checklist.md"), false);
  assert.equal(Artifacts.isCanonicalInvestigationPath("findings/findings.json"), false);
});

test("mapCheckpointPhaseToChecklistPhase maps passive/active, identity, and convergence", () => {
  assert.equal(Artifacts.mapCheckpointPhaseToChecklistPhase("passive"), "passive_recon");
  assert.equal(Artifacts.mapCheckpointPhaseToChecklistPhase("active"), "active_recon");
  for (const phase of Artifacts.CHECKLIST_PHASES) {
    assert.equal(Artifacts.mapCheckpointPhaseToChecklistPhase(phase), phase);
  }
  assert.equal(Artifacts.mapCheckpointPhaseToChecklistPhase("convergence"), null);
  assert.equal(Artifacts.mapCheckpointPhaseToChecklistPhase("unknown"), null);
});

test("C-#### phase parser rejects convergence", () => {
  const markdown = `# Investigation Checklist

## H-0001: Example

### C-0001: Probe

- Status: not_started
- Phase: convergence
- Priority: medium
- Order: 1
- Dependencies: none
- Technique: not recorded
- Target: not recorded
- Required identity: not recorded
- Required role: not recorded
- Required tenant: not recorded
- Baseline: not recorded
- Negative control: not recorded
- Expected signals: none
- Rejecting signals: none
- Stop conditions: none
- Execution result: not recorded
- Tool refs: none
- Evidence refs: none
- Knowledge release id: not recorded
- Procedure id: not recorded
- Source hash: not recorded
- Created: not recorded
- Updated: not recorded
`;
  const parsed = Artifacts.parseChecklist(markdown);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "ARTIFACT_CHECKLIST_PHASE_INVALID");
});

test("parser round-trip preserves documents, H/C/E, Unicode, and reportable evidence fields", () => {
  const facts = [{
    fact_id: "engagement-0001",
    key: "Project",
    value: "NASA 探测",
    source_refs: ["scope:engagement"],
    observed_at: "2026-08-30T00:00:00.000Z",
    confidence: "high",
    scope_decision: "in_scope",
    heading: "Summary",
  }];
  const engagement = Artifacts.renderProjectDocument("engagement", facts);
  assert.equal(Artifacts.renderProjectDocument("engagement", Artifacts.parseProjectDocument("engagement", engagement).value), engagement);

  const hypotheses = [{
    id: "H-0001", title: "Auth bypass 测试", status: "proposed", confidence: "low", objective: "x",
    known_facts: ["a"], unknowns: ["b"], rationale: "r", supporting_signals: ["s"], rejecting_signals: ["n"],
    smallest_test: "t", stop_conditions: ["stop"], evidence_refs: [], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  }];
  const hMd = Artifacts.renderHypotheses(hypotheses);
  assert.equal(Artifacts.renderHypotheses(Artifacts.parseHypotheses(hMd).value), hMd);

  const checklist = [{
    id: "C-0001", hypothesis_id: "H-0001", title: "Check session", status: "not_started", phase: "passive_recon",
    priority: "medium", order: 1, dependencies: ["C-0002"], technique: "cookie", target: "app.example",
    required_identity: "anon", required_role: "user", required_tenant: "t1", baseline: "none", negative_control: "deny",
    expected_signals: ["set-cookie"], rejecting_signals: ["403"], stop_conditions: ["lockout"],
    execution_result: "", tool_refs: [], evidence_refs: [], knowledge_release_id: "rel-1", procedure_id: "proc-1",
    source_hash: "abc", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  }];
  const cMd = Artifacts.renderChecklist(checklist, hypotheses);
  assert.equal(Artifacts.renderChecklist(Artifacts.parseChecklist(cMd).value, hypotheses), cMd);

  const evidence = [{
    id: "E-0001", title: "Cookie flag", status: "verified", confidence: "high", hypothesis_refs: ["H-0001"],
    checklist_refs: ["C-0001"], target_refs: ["app.example"], severity: "medium", created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", summary: "s", reproduction: "r", expected_behavior: "e",
    observed_behavior: "o", impact: "i", verifier: "hybrid", remediation: "set flag", retest_criteria: "cookie httponly",
    sanitized_excerpts: "x", source_refs: ["raw:1"], hashes: ["deadbeef"],
  }];
  const eMd = Artifacts.renderEvidence(evidence[0]);
  assert.equal(Artifacts.renderEvidence(Artifacts.parseEvidence(eMd).value), eMd);

  assert.match(eMd, /Severity: medium/);
  assert.match(eMd, /## Remediation\n\nset flag/);
  assert.match(eMd, /## Retest Criteria\n\ncookie httponly/);
});

test("expectedEntries emits sources and directories only; repair does not write indexes", () => {
  const root = tempRoot();
  const workspace = createAssessmentWorkspace({ fs, path });
  const entries = workspace.expectedEntries(root);
  const relative = entries.map((entry) => entry.relativePath);
  assert.ok(relative.includes(".xekute/project_info/engagement.md"));
  assert.ok(relative.includes(".xekute/checklist.md"));
  assert.ok(relative.includes(".xekute/project_info"));
  assert.ok(relative.includes(".xekute/evidence"));
  assert.ok(!relative.includes(".xekute/project_info/index.md"));
  assert.ok(!relative.includes(".xekute/evidence/index.md"));
  assert.ok(!relative.includes(".xekute/project_info.md"));
  assert.ok(!relative.includes(".xekute/investigation_checklist.md"));
  const repaired = workspace.repair(root, { createRoot: true });
  assert.equal(repaired.error, undefined);
  assert.equal(fs.existsSync(path.join(root, ".xekute/project_info/index.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".xekute/evidence/index.md")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("bootstrap rebuilds both indexes and preserves valid and malformed sources", () => {
  const root = tempRoot();
  const artifacts = createProjectArtifactService({ fs, path });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  const repaired = workspace.repair(root, { createRoot: true });
  assert.equal(repaired.error, undefined);
  const engagement = path.join(root, ".xekute/project_info/engagement.md");
  const original = fs.readFileSync(engagement, "utf8");
  const boot = artifacts.bootstrap(root);
  assert.equal(boot.ok, true);
  assert.equal(fs.existsSync(path.join(root, ".xekute/project_info/index.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute/evidence/index.md")), true);
  assert.equal(fs.readFileSync(engagement, "utf8"), original);

  fs.writeFileSync(engagement, "# broken\n");
  const again = artifacts.bootstrap(root);
  assert.equal(again.ok, false);
  assert.equal(fs.readFileSync(engagement, "utf8"), "# broken\n");
  fs.rmSync(root, { recursive: true, force: true });
});

test("assessment workspace has no durable findings API or store", () => {
  const root = tempRoot();
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });
  assert.equal(workspace.appendFinding, undefined);
  assert.equal(fs.existsSync(path.join(root, "findings")), false);
  fs.rmSync(root, { recursive: true, force: true });
});
