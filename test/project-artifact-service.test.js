"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-artifacts-"));
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  const repaired = workspace.repair(root);
  assert.equal(repaired.error, undefined, repaired.error);
  const result = artifacts.bootstrap(root);
  assert.equal(result.ok, true, result.error);
  return { root, artifacts, workspace };
}

function commitOps(artifacts, root, mode, operations, extra = {}) {
  const snapshot = artifacts.inspect(root);
  assert.equal(snapshot.ok, true, snapshot.error);
  const staged = artifacts.stage(root, { mode, expected_revisions: snapshot.revisions, operations, ...extra });
  if (!staged.ok) return staged;
  const committed = artifacts.commit(root, staged.staging_id);
  if (!committed.ok) return committed;
  return { ok: true, staged, committed, inspect: artifacts.inspect(root) };
}

function seedVerifiedEvidence(artifacts, root) {
  assert.equal(commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]).ok, true);
  assert.equal(commitOps(artifacts, root, "plan", [{
    kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
    target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
  }]).ok, true);
  const result = commitOps(artifacts, root, "agent", [{
    kind: "evidence.create", client_ref: "e1", title: "Cookie observed", status: "verified", verifier: "hybrid-accept",
    severity: "medium", target_refs: ["app.example"], checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"],
    source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid", impact: "Session exposure",
    remediation: "Set the secure cookie attributes", retest_criteria: "Cookie carries required flags",
  }]);
  assert.equal(result.ok, true, result.error);
  return result.inspect;
}

test("inspect exposes documents and H/C/E state with eight revision hashes", () => {
  const { root, artifacts } = boot();
  const snapshot = artifacts.inspect(root);
  assert.equal(snapshot.ok, true);
  assert.deepEqual(Object.keys(snapshot.project.documents).sort(), ["controls", "engagement", "identities", "surface", "targets"]);
  assert.ok(Array.isArray(snapshot.hypotheses));
  assert.ok(Array.isArray(snapshot.checklist));
  assert.ok(Array.isArray(snapshot.evidence));
  assert.equal(snapshot.findings, undefined);
  assert.deepEqual(Object.keys(snapshot.revisions).sort(), [...Artifacts.REVISION_KEYS].sort());
  assert.equal(Artifacts.REVISION_KEYS.length, 8);
  for (const key of Artifacts.REVISION_KEYS) assert.match(snapshot.revisions[key], /^[a-f0-9]{64}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("context reads deterministic indexes without rebuilding a missing index", () => {
  const { root, artifacts } = boot();
  const indexPath = path.join(root, Artifacts.PATHS.projectIndex);
  assert.match(artifacts.context(root, { mode: "ask" }).content, /UNTRUSTED DATA/);
  fs.unlinkSync(indexPath);
  const context = artifacts.context(root, { mode: "ask" });
  assert.equal(context.ok, true);
  assert.equal(fs.existsSync(indexPath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("runtime assigns stable H/C/E IDs, resolves refs, and rebuilds both indexes", () => {
  const { root, artifacts } = boot();
  const h = commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.create", client_ref: "h", title: "Unicode 探测" }]);
  assert.equal(h.staged.assigned_ids.h, "H-0001");
  const c = commitOps(artifacts, root, "plan", [{ kind: "checklist.create", client_ref: "c", hypothesis_id: "H-0001", title: "Probe", phase: "passive_recon" }]);
  assert.equal(c.staged.assigned_ids.c, "C-0001");
  const e = commitOps(artifacts, root, "agent", [{ kind: "evidence.create", client_ref: "e", title: "Signal", checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"] }]);
  assert.equal(e.staged.assigned_ids.e, "E-0001");
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.evidenceDirectory, "E-0001.md")), true);
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.evidenceIndex), "utf8"), /E-0001/);
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.projectIndex), "utf8"), /Project Information Index/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("validated no-op stages without rewriting canonical sources", () => {
  const { root, artifacts } = boot();
  const before = artifacts.inspect(root);
  const staged = artifacts.stage(root, { mode: "agent", expected_revisions: before.revisions, operations: [], no_op_reason: "No material project-state change." });
  assert.equal(staged.ok, true, staged.error);
  assert.deepEqual(staged.changed_paths, []);
  assert.equal(artifacts.commit(root, staged.staging_id).ok, true);
  assert.deepEqual(artifacts.inspect(root).revisions, before.revisions);
  fs.rmSync(root, { recursive: true, force: true });
});

test("evidence severity, remediation, and retest fields change only E body and index", () => {
  const { root, artifacts } = boot();
  seedVerifiedEvidence(artifacts, root);
  const result = commitOps(artifacts, root, "agent", [{ kind: "evidence.update", id: "E-0001", severity: "critical", remediation: "Rotate and harden", retest_criteria: "No exposed cookie" }]);
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.existsSync(path.join(root, ".xekute/evidence/E-0001.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute/evidence/E-0099.md")), false);
  assert.match(fs.readFileSync(path.join(root, ".xekute/evidence/E-0001.md"), "utf8"), /Severity: critical/);
  const rename = commitOps(artifacts, root, "agent", [{ kind: "evidence.update", id: "E-0001", path: ".xekute/evidence/E-0099.md" }]);
  assert.equal(rename.ok, false);
  assert.equal(rename.code, "ARTIFACT_RENAME_FORBIDDEN");
  fs.rmSync(root, { recursive: true, force: true });
});

test("reference integrity rejects orphan checklist/evidence and unsupported hypotheses", () => {
  const { root, artifacts } = boot();
  const orphanC = commitOps(artifacts, root, "plan", [{ kind: "checklist.create", client_ref: "c", hypothesis_id: "H-9999", title: "orphan" }]);
  assert.equal(orphanC.code, "ARTIFACT_CHECKLIST_HYPOTHESIS_REQUIRED");
  commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.create", client_ref: "h", title: "H" }]);
  const orphanE = commitOps(artifacts, root, "agent", [{ kind: "evidence.create", client_ref: "e", title: "orphan", source_refs: ["raw:1"] }]);
  assert.equal(orphanE.code, "ARTIFACT_EVIDENCE_CHECKLIST_REQUIRED");
  const unsupported = commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.support", id: "H-0001" }]);
  assert.equal(unsupported.code, "ARTIFACT_HYPOTHESIS_EVIDENCE_REQUIRED");
  fs.rmSync(root, { recursive: true, force: true });
});

test("mode ownership is enforced at the service boundary", () => {
  const { root, artifacts } = boot();
  const attempts = [
    ["ask", { kind: "hypothesis.create", client_ref: "h", title: "H" }, "ARTIFACT_MODE_READ_ONLY"],
    ["hypothesis", { kind: "project.upsert", document: "targets", key: "host", value: "a", source_refs: ["x"] }, "ARTIFACT_OPERATION_FORBIDDEN"],
    ["plan", { kind: "evidence.create", client_ref: "e", title: "E", checklist_refs: ["C-1"], source_refs: ["x"] }, "ARTIFACT_OPERATION_FORBIDDEN"],
    ["agent", { kind: "hypothesis.refine", id: "H-1", title: "x" }, "ARTIFACT_OPERATION_FORBIDDEN"],
  ];
  for (const [mode, operation, code] of attempts) assert.equal(commitOps(artifacts, root, mode, [operation]).code, code);
  fs.rmSync(root, { recursive: true, force: true });
});

test("terminal checklist states require trusted execution provenance", () => {
  const { root, artifacts } = boot();
  seedVerifiedEvidence(artifacts, root);
  const missing = commitOps(artifacts, root, "agent", [{ kind: "checklist.execution", id: "C-0001", status: "confirmed", execution_result: "worked" }]);
  assert.equal(missing.code, "ARTIFACT_EXECUTION_PROOF_REQUIRED");
  const proven = commitOps(artifacts, root, "agent", [{ kind: "checklist.execution", id: "C-0001", status: "confirmed", execution_result: "worked", evidence_refs: ["E-0001"] }]);
  assert.equal(proven.ok, true, proven.error);
  assert.equal(proven.inspect.checklist[0].status, "confirmed");
  fs.rmSync(root, { recursive: true, force: true });
});

test("project facts preserve contradictory observations and explicit corrections", () => {
  const { root, artifacts } = boot();
  assert.equal(commitOps(artifacts, root, "agent", [{ kind: "project.upsert", document: "targets", key: "host", value: "a.example", source_refs: ["traffic:1"], confidence: "high", scope_decision: "in_scope" }]).ok, true);
  assert.equal(commitOps(artifacts, root, "agent", [{ kind: "project.upsert", document: "targets", key: "host", value: "b.example", source_refs: ["traffic:2"] }]).ok, true);
  const snapshot = artifacts.inspect(root);
  const corrected = commitOps(artifacts, root, "agent", [{ kind: "project.correct", document: "targets", id: snapshot.project.documents.targets[0].fact_id, key: "host", value: "fixed.example", source_refs: ["operator:1"] }]);
  assert.equal(corrected.ok, true, corrected.error);
  assert.equal(corrected.inspect.project.documents.targets.length, 3);
  assert.equal(corrected.inspect.project.documents.targets[2].corrects, corrected.inspect.project.documents.targets[0].fact_id);
  fs.rmSync(root, { recursive: true, force: true });
});

test("queries expose artifacts only and reject the removed findings domain", () => {
  const { root, artifacts } = boot();
  seedVerifiedEvidence(artifacts, root);
  assert.equal(artifacts.query(root, { domain: "evidence" }).records[0].id, "E-0001");
  assert.equal(artifacts.query(root, { domain: "checklist", phase: "execution" }).records[0].id, "C-0001");
  const removed = artifacts.query(root, { domain: "findings" });
  assert.equal(removed.ok, false);
  assert.equal(removed.code, "ARTIFACT_QUERY_DOMAIN_INVALID");
  fs.rmSync(root, { recursive: true, force: true });
});

test("clean-slate runtime ignores and preserves old data placed beside new files", () => {
  const { root, artifacts } = boot();
  const legacy = {
    ".pointer-assessment.json": "legacy pointer\n",
    "settings.config": "legacy settings\n",
    "pen_context.md": "legacy context\n",
    "findings/findings.json": '{"findings":[{"id":"legacy"}]}\n',
    "scope/in-scope.json": '{"targets":["legacy.example"]}\n',
  };
  for (const [relative, content] of Object.entries(legacy)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const before = Object.fromEntries(Object.keys(legacy).map((relative) => [relative, fs.readFileSync(path.join(root, ...relative.split("/")), "utf8")]));
  assert.equal(artifacts.inspect(root).evidence.length, 0);
  assert.equal(artifacts.bootstrap(root).ok, true);
  for (const [relative, content] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(root, ...relative.split("/")), "utf8"), content);
  fs.rmSync(root, { recursive: true, force: true });
});

test("plaintext secrets reject the complete stage and sanitized retry succeeds", () => {
  const { root, artifacts } = boot();
  const revisions = artifacts.inspect(root).revisions;
  const rejected = artifacts.stage(root, { mode: "agent", expected_revisions: revisions, operations: [{ kind: "project.upsert", document: "identities", key: "token", value: "ghp_abcdefghijklmnopqrstuvwxyz1234567890", source_refs: ["operator:1"] }] });
  assert.equal(rejected.ok, false);
  const safe = artifacts.stage(root, { mode: "agent", expected_revisions: revisions, operations: [{ kind: "project.upsert", document: "identities", key: "identity", value: "credential handle AUTH-1", source_refs: ["operator:1"] }] });
  assert.equal(safe.ok, true, safe.error);
  artifacts.discard(root, safe.staging_id);
  fs.rmSync(root, { recursive: true, force: true });
});
