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
  assert.equal(commitOps(artifacts, root, "agent", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]).ok, true);
  assert.equal(commitOps(artifacts, root, "agent", [{
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
  const h = commitOps(artifacts, root, "agent", [{ kind: "hypothesis.create", client_ref: "h", title: "Unicode 探测" }]);
  assert.equal(h.staged.assigned_ids.h, "H-0001");
  const c = commitOps(artifacts, root, "agent", [{ kind: "checklist.create", client_ref: "c", hypothesis_id: "H-0001", title: "Probe", phase: "passive_recon" }]);
  assert.equal(c.staged.assigned_ids.c, "C-0001");
  const e = commitOps(artifacts, root, "agent", [{ kind: "evidence.create", client_ref: "e", title: "Signal", checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"] }]);
  assert.equal(e.staged.assigned_ids.e, "E-0001");
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.hypotheses)), true);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.checklist)), true);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.evidenceDirectory, "E-0001.md")), true);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.evidenceIndex)), true);
  assert.equal(e.inspect.evidence[0].id, "E-0001");
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.projectIndex), "utf8"), /Project Information Index/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("committed H/C/E artifacts persist as canonical Markdown and survive a fresh service bootstrap", () => {
  const { root, artifacts } = boot();
  try {
    const result = commitOps(artifacts, root, "agent", [
      { kind: "project.upsert", document: "targets", key: "host", value: "app.example", source_refs: ["operator:1"], scope_decision: "in_scope" },
      { kind: "hypothesis.create", client_ref: "h", title: "Profile authorization" },
      { kind: "checklist.create", client_ref: "c", hypothesis_id: "h", title: "Compare identities", phase: "assessment_l1" },
      {
        kind: "evidence.create", client_ref: "e", title: "Baseline response observed", status: "verified", verifier: "hybrid-accept",
        checklist_refs: ["c"], hypothesis_refs: ["h"], target_refs: ["app.example"], source_refs: ["traffic:source-1"],
      },
    ]);
    assert.equal(result.ok, true, result.error);

    const canonicalFiles = [
      [Artifacts.PATHS.hypotheses, /H-0001: Profile authorization/],
      [Artifacts.PATHS.checklist, /C-0001: Compare identities/],
      [`${Artifacts.PATHS.evidenceDirectory}/E-0001.md`, /E-0001: Baseline response observed/],
      [Artifacts.PATHS.evidenceIndex, /E-0001.*Baseline response observed/],
    ];
    for (const [relativePath, expected] of canonicalFiles) {
      const file = path.join(root, relativePath);
      assert.equal(fs.existsSync(file), true, `${relativePath} should be durable after commit`);
      assert.match(fs.readFileSync(file, "utf8"), expected, relativePath);
    }

    const restarted = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
    const bootstrap = restarted.bootstrap(root);
    assert.equal(bootstrap.ok, true, bootstrap.error);
    const recovered = restarted.inspect(root);
    assert.equal(recovered.ok, true, recovered.error);
    assert.equal(recovered.hypotheses[0].title, "Profile authorization");
    assert.equal(recovered.checklist[0].title, "Compare identities");
    assert.equal(recovered.evidence[0].status, "verified");
    assert.deepEqual(recovered.revisions, result.inspect.revisions);
    assert.equal(recovered.project.documents.targets[0].value, "app.example");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit preflights persisted artifact conflicts before changing project documents and permits retry", () => {
  const { root, artifacts } = boot();
  try {
    const snapshot = artifacts.inspect(root);
    const targetFile = path.join(root, Artifacts.PATHS.projectTargets);
    const originalTargets = fs.readFileSync(targetFile, "utf8");
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "app.example", source_refs: ["operator:1"] },
        { kind: "hypothesis.create", client_ref: "h", title: "Authorization boundary" },
      ],
    });
    assert.equal(staged.ok, true, staged.error);

    const hypothesesFile = path.join(root, Artifacts.PATHS.hypotheses);
    fs.writeFileSync(hypothesesFile, "# External conflicting edit\n", "utf8");
    const rejected = artifacts.commit(root, staged.staging_id);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "ARTIFACT_COMMIT_CONFLICT");
    assert.equal(fs.readFileSync(targetFile, "utf8"), originalTargets);

    fs.unlinkSync(hypothesesFile);
    const retried = artifacts.commit(root, staged.staging_id);
    assert.equal(retried.ok, true, retried.error);
    const recovered = artifacts.inspect(root);
    assert.equal(recovered.project.documents.targets[0].value, "app.example");
    assert.equal(recovered.hypotheses[0].title, "Authorization boundary");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed staged write is recovered as one complete commit on bootstrap", () => {
  const { root } = boot();
  let failedHypothesisWrite = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "writeFileSync") {
        return (file, ...args) => {
          if (!failedHypothesisWrite && path.basename(String(file)).includes("hypotheses.md")) {
            failedHypothesisWrite = true;
            throw new Error("simulated hypothesis write failure");
          }
          return target.writeFileSync(file, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: failingFs, path });
    const snapshot = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "app.example", source_refs: ["operator:1"] },
        { kind: "hypothesis.create", client_ref: "h", title: "Authorization boundary" },
        { kind: "checklist.create", client_ref: "c", hypothesis_id: "h", title: "Compare roles", phase: "assessment_l1" },
        { kind: "evidence.create", client_ref: "e", title: "Role baseline", status: "verified", verifier: "hybrid-accept", checklist_refs: ["c"], hypothesis_refs: ["h"], source_refs: ["traffic:source-1"] },
      ],
    });
    assert.equal(staged.ok, true, staged.error);
    const committed = artifacts.commit(root, staged.staging_id);
    assert.equal(failedHypothesisWrite, true);
    assert.equal(committed.ok, false);

    const restarted = createProjectArtifactService({ fs, path });
    const bootstrap = restarted.bootstrap(root);
    assert.equal(bootstrap.ok, true, bootstrap.error);
    const recovered = restarted.inspect(root);
    assert.equal(recovered.project.documents.targets[0].value, "app.example");
    assert.equal(recovered.hypotheses[0]?.title, "Authorization boundary");
    assert.equal(recovered.checklist[0]?.title, "Compare roles");
    assert.equal(recovered.evidence[0]?.title, "Role baseline");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("same-service recovery reloads cached H/C/E after a partially applied commit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-artifact-overlay-recovery-"));
  let failHypothesisWrite = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "writeFileSync") {
        return (file, ...args) => {
          if (failHypothesisWrite && path.basename(String(file)).includes("hypotheses.md")) {
            failHypothesisWrite = false;
            throw new Error("simulated hypothesis write failure");
          }
          return target.writeFileSync(file, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const artifacts = createProjectArtifactService({ fs: failingFs, path });
  const workspace = createAssessmentWorkspace({ fs: failingFs, path, projectArtifacts: artifacts });
  try {
    assert.equal(workspace.repair(root).error, undefined);
    assert.equal(artifacts.bootstrap(root).ok, true);
    seedVerifiedEvidence(artifacts, root);
    const before = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: before.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "recovered.example", source_refs: ["operator:2"] },
        { kind: "hypothesis.create", client_ref: "h2", title: "Recovered after retry" },
      ],
    });
    assert.equal(staged.ok, true, staged.error);

    failHypothesisWrite = true;
    const failed = artifacts.commit(root, staged.staging_id);
    assert.equal(failed.ok, false);
    assert.equal(failHypothesisWrite, false);

    const recoveredTransaction = artifacts.recover(root);
    assert.equal(recoveredTransaction.ok, true, recoveredTransaction.error);
    assert.deepEqual(recoveredTransaction.recovered, [staged.staging_id]);
    const recovered = artifacts.inspect(root);
    assert.equal(recovered.project.documents.targets[0].value, "recovered.example");
    assert.equal(recovered.hypotheses.some((item) => item.title === "Recovered after retry"), true);
    assert.equal(recovered.evidence[0].status, "verified");
    assert.notEqual(recovered.revisions.hypotheses, before.revisions.hypotheses);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("journal directory sync errors fail closed and leave the staged transaction recoverable", () => {
  const { root } = boot();
  const transactionDirectory = path.join(root, Artifacts.PATHS.transactionDirectory);
  let transactionDirectoryDescriptor = null;
  let failDirectorySync = true;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "openSync") {
        return (file, ...args) => {
          const descriptor = target.openSync(file, ...args);
          if (path.resolve(String(file)) === path.resolve(transactionDirectory)) transactionDirectoryDescriptor = descriptor;
          return descriptor;
        };
      }
      if (property === "fsyncSync") {
        return (descriptor) => {
          if (failDirectorySync && descriptor === transactionDirectoryDescriptor) {
            failDirectorySync = false;
            const error = new Error("simulated transaction directory fsync failure");
            error.code = "EIO";
            throw error;
          }
          return target.fsyncSync(descriptor);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: failingFs, path });
    const snapshot = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "durable.example", source_refs: ["operator:3"] },
        { kind: "hypothesis.create", client_ref: "h", title: "Durable journal" },
      ],
    });
    assert.equal(staged.ok, true, staged.error);

    const committed = artifacts.commit(root, staged.staging_id);
    assert.equal(committed.ok, false);
    assert.equal(committed.code, "EIO");
    assert.equal(committed.retryable, true);
    assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.hypotheses)), false);
    assert.equal(fs.existsSync(path.join(transactionDirectory, `${staged.staging_id}.json`)), true);
    const discarded = artifacts.discard(root, staged.staging_id);
    assert.equal(discarded.ok, false);
    assert.equal(discarded.code, "ARTIFACT_TRANSACTION_DURABLE");

    const restarted = createProjectArtifactService({ fs, path });
    assert.equal(restarted.bootstrap(root).ok, true);
    const recovered = restarted.inspect(root);
    assert.equal(recovered.project.documents.targets[0].value, "durable.example");
    assert.equal(recovered.hypotheses[0].title, "Durable journal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project index publication participates in transaction recovery", () => {
  const { root } = boot();
  let failedIndexWrite = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "writeFileSync") return (file, ...args) => {
        const name = path.basename(String(file));
        if (!failedIndexWrite && name.includes("index.md") && name.endsWith(".tmp")) {
          failedIndexWrite = true;
          const error = new Error("simulated project index write failure"); error.code = "EIO"; throw error;
        }
        return target.writeFileSync(file, ...args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: failingFs, path });
    const staged = artifacts.stage(root, {
      mode: "agent", expected_revisions: artifacts.inspect(root).revisions,
      operations: [{ kind: "project.upsert", document: "targets", key: "host", value: "indexed.example", source_refs: ["operator:index"] }],
    });
    assert.equal(staged.ok, true, staged.error);
    const committed = artifacts.commit(root, staged.staging_id);
    assert.equal(failedIndexWrite, true);
    assert.equal(committed.ok, false);
    assert.equal(committed.retryable, true);

    const restarted = createProjectArtifactService({ fs, path });
    assert.equal(restarted.bootstrap(root).ok, true);
    assert.match(restarted.context(root, { mode: "ask" }).content, /indexed\.example/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transaction recovery quarantines journals that conflict with an outside edit", () => {
  const { root } = boot();
  const targetsFile = path.join(root, Artifacts.PATHS.projectTargets);
  const originalTargets = fs.readFileSync(targetsFile, "utf8");
  let failedHypothesisWrite = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "writeFileSync") {
        return (file, ...args) => {
          if (!failedHypothesisWrite && path.basename(String(file)).includes("hypotheses.md")) {
            failedHypothesisWrite = true;
            throw new Error("simulated hypothesis write failure");
          }
          return target.writeFileSync(file, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: failingFs, path });
    const snapshot = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "app.example", source_refs: ["operator:1"] },
        { kind: "hypothesis.create", client_ref: "h", title: "Authorization boundary" },
      ],
    });
    assert.equal(staged.ok, true, staged.error);
    assert.equal(artifacts.commit(root, staged.staging_id).ok, false);
    assert.equal(failedHypothesisWrite, true);

    const hypothesesFile = path.join(root, Artifacts.PATHS.hypotheses);
    fs.writeFileSync(hypothesesFile, "# External operator edit\n", "utf8");
    const restarted = createProjectArtifactService({ fs, path });
    const bootstrap = restarted.bootstrap(root);
    assert.equal(bootstrap.ok, false);
    assert.equal(bootstrap.code, "ARTIFACT_RECOVERY_CONFLICT");
    assert.equal(fs.readFileSync(hypothesesFile, "utf8"), "# External operator edit\n");
    assert.equal(fs.readFileSync(targetsFile, "utf8"), originalTargets, "recovery conflict rolls back files already published by the transaction");
    assert.equal(bootstrap.recovery.quarantined.length, 1);
    assert.equal(fs.existsSync(path.join(root, bootstrap.recovery.quarantined[0])), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact commits reject destination and journal directory junction substitution", { skip: typeof fs.symlinkSync !== "function" }, () => {
  const { root, artifacts } = boot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-artifacts-outside-"));
  const projectDirectory = path.join(root, Artifacts.PATHS.projectDirectory);
  const outsideProject = path.join(outside, "project_info");
  try {
    const snapshot = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [{ kind: "project.upsert", document: "targets", key: "host", value: "escape.example", source_refs: ["operator:junction"] }],
    });
    assert.equal(staged.ok, true, staged.error);

    fs.cpSync(projectDirectory, outsideProject, { recursive: true });
    const outsideTargets = path.join(outsideProject, "targets.md");
    const beforeOutside = fs.readFileSync(outsideTargets, "utf8");
    fs.rmSync(projectDirectory, { recursive: true, force: true });
    fs.symlinkSync(outsideProject, projectDirectory, process.platform === "win32" ? "junction" : "dir");
    const escaped = artifacts.commit(root, staged.staging_id);
    assert.equal(escaped.ok, false);
    assert.match(escaped.code, /ARTIFACT_(?:COMMIT_CONFLICT|PATH_INVALID)/);
    assert.equal(fs.readFileSync(outsideTargets, "utf8"), beforeOutside);

    fs.unlinkSync(projectDirectory);
    fs.cpSync(outsideProject, projectDirectory, { recursive: true });
    const retried = artifacts.commit(root, staged.staging_id);
    assert.equal(retried.ok, true, retried.error);

    const second = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: artifacts.inspect(root).revisions,
      operations: [{ kind: "hypothesis.create", client_ref: "h", title: "Journal confinement" }],
    });
    assert.equal(second.ok, true, second.error);
    const internal = path.join(root, ".xekute", ".internal");
    const outsideInternal = path.join(outside, "internal");
    fs.mkdirSync(outsideInternal, { recursive: true });
    fs.rmSync(internal, { recursive: true, force: true });
    fs.symlinkSync(outsideInternal, internal, process.platform === "win32" ? "junction" : "dir");
    const journalEscape = artifacts.commit(root, second.staging_id);
    assert.equal(journalEscape.ok, false);
    assert.equal(journalEscape.code, "ARTIFACT_TRANSACTION_DIRECTORY_INVALID");
    assert.equal(fs.existsSync(path.join(outsideInternal, "transactions")), false);
    fs.unlinkSync(internal);
  } finally {
    try { if (fs.lstatSync(projectDirectory).isSymbolicLink()) fs.unlinkSync(projectDirectory); } catch { /* already restored */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("post-commit journal cleanup failure keeps committed overlay and the next artifact id", () => {
  const { root } = boot();
  const transactionDirectory = path.join(root, Artifacts.PATHS.transactionDirectory);
  let transactionDescriptor = null;
  let cleanupSyncFailed = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "openSync") return (file, ...args) => {
        const descriptor = target.openSync(file, ...args);
        if (path.resolve(String(file)) === path.resolve(transactionDirectory)) transactionDescriptor = descriptor;
        return descriptor;
      };
      if (property === "fsyncSync") return (descriptor) => {
        const journalPresent = fs.existsSync(transactionDirectory)
          && fs.readdirSync(transactionDirectory).some(name => name.endsWith(".json"));
        if (descriptor === transactionDescriptor && !journalPresent && !cleanupSyncFailed) {
          cleanupSyncFailed = true;
          const error = new Error("simulated cleanup fsync failure"); error.code = "EIO"; throw error;
        }
        return target.fsyncSync(descriptor);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: failingFs, path });
    const first = artifacts.stage(root, {
      mode: "agent", expected_revisions: artifacts.inspect(root).revisions,
      operations: [{ kind: "hypothesis.create", client_ref: "h1", title: "First durable hypothesis" }],
    });
    assert.equal(first.ok, true, first.error);
    const committed = artifacts.commit(root, first.staging_id);
    assert.equal(committed.ok, true, committed.error);
    assert.equal(cleanupSyncFailed, true);
    assert.match(committed.warning || "", /cleanup/i);
    assert.equal(artifacts.inspect(root).hypotheses[0].title, "First durable hypothesis");

    const second = artifacts.stage(root, {
      mode: "agent", expected_revisions: artifacts.inspect(root).revisions,
      operations: [{ kind: "hypothesis.create", client_ref: "h2", title: "Second durable hypothesis" }],
    });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.assigned_ids.h2, "H-0002");
    assert.equal(artifacts.commit(root, second.staging_id).ok, true);
    assert.deepEqual(artifacts.inspect(root).hypotheses.map(item => item.id), ["H-0001", "H-0002"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit rechecks the destination after staging temp content and preserves an outside edit", () => {
  const { root } = boot();
  const hypothesesFile = path.join(root, Artifacts.PATHS.hypotheses);
  let injectOutsideEdit = false;
  let outsideEditInjected = false;
  const racingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "writeFileSync") {
        return (file, ...args) => {
          const result = target.writeFileSync(file, ...args);
          if (injectOutsideEdit && !outsideEditInjected && path.basename(String(file)).includes("hypotheses.md") && String(file).endsWith(".tmp")) {
            outsideEditInjected = true;
            fs.writeFileSync(hypothesesFile, "# External edit during commit\n", "utf8");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const artifacts = createProjectArtifactService({ fs: racingFs, path });
    const snapshot = artifacts.inspect(root);
    const staged = artifacts.stage(root, {
      mode: "agent",
      expected_revisions: snapshot.revisions,
      operations: [
        { kind: "project.upsert", document: "targets", key: "host", value: "commit-race.example", source_refs: ["operator:4"] },
        { kind: "hypothesis.create", client_ref: "h", title: "Must not erase operator edit" },
      ],
    });
    assert.equal(staged.ok, true, staged.error);

    injectOutsideEdit = true;
    const committed = artifacts.commit(root, staged.staging_id);
    assert.equal(outsideEditInjected, true);
    assert.equal(committed.ok, false);
    assert.equal(committed.code, "ARTIFACT_COMMIT_CONFLICT");
    assert.equal(fs.readFileSync(hypothesesFile, "utf8"), "# External edit during commit\n");

    const restarted = createProjectArtifactService({ fs, path });
    const bootstrap = restarted.bootstrap(root);
    assert.equal(bootstrap.ok, false);
    assert.equal(bootstrap.code, "ARTIFACT_RECOVERY_CONFLICT");
    assert.equal(fs.readFileSync(hypothesesFile, "utf8"), "# External edit during commit\n");
    assert.equal(bootstrap.recovery.quarantined.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
  assert.equal(result.inspect.evidence[0].severity, "critical");
  assert.match(fs.readFileSync(path.join(root, ".xekute/evidence/E-0001.md"), "utf8"), /- Severity: critical/);
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.evidenceIndex), "utf8"), /E-0001.*critical/);
  assert.equal(fs.existsSync(path.join(root, ".xekute/evidence/E-0099.md")), false);
  const rename = commitOps(artifacts, root, "agent", [{ kind: "evidence.update", id: "E-0001", path: ".xekute/evidence/E-0099.md" }]);
  assert.equal(rename.ok, false);
  assert.equal(rename.code, "ARTIFACT_RENAME_FORBIDDEN");
  fs.rmSync(root, { recursive: true, force: true });
});

test("verified evidence remains durable when its referenced traffic record is deleted", () => {
  const { root, artifacts, workspace } = boot();
  try {
    const captured = workspace.appendTrafficRecord(root, {
      requestId: "source-1",
      method: "GET",
      url: "https://authorized.example/",
      statusCode: 200,
      request: "GET / HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
      response: "HTTP/1.1 200 OK\r\n\r\n",
    });
    assert.equal(captured.ok, true, captured.error);

    const result = commitOps(artifacts, root, "agent", [
      { kind: "hypothesis.create", client_ref: "h", title: "Baseline behavior" },
      { kind: "checklist.create", client_ref: "c", hypothesis_id: "h", title: "Record baseline", phase: "verification" },
      {
        kind: "evidence.create", client_ref: "e", title: "Baseline response", status: "verified", verifier: "hybrid-accept",
        checklist_refs: ["c"], hypothesis_refs: ["h"], source_refs: ["traffic:source-1"], sanitized_excerpts: "HTTP 200 baseline",
      },
    ]);
    assert.equal(result.ok, true, result.error);
    assert.equal(artifacts.inspect(root).evidence[0].status, "verified");

    const deleted = workspace.deleteTrafficRecords(root, { requestIds: ["source-1"] });
    assert.equal(deleted.ok, true, deleted.error);
    assert.equal(deleted.deleted, 1);
    assert.equal(workspace.readTrafficHistory(root).records.length, 0);

    const restarted = createProjectArtifactService({ fs, path });
    assert.equal(restarted.bootstrap(root).ok, true);
    const recovered = restarted.inspect(root);
    assert.equal(recovered.evidence[0].status, "verified");
    assert.deepEqual(recovered.evidence[0].source_refs, ["traffic:source-1"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reference integrity rejects orphan checklist/evidence and unsupported hypotheses", () => {
  const { root, artifacts } = boot();
  const orphanC = commitOps(artifacts, root, "agent", [{ kind: "checklist.create", client_ref: "c", hypothesis_id: "H-9999", title: "orphan" }]);
  assert.equal(orphanC.code, "ARTIFACT_CHECKLIST_HYPOTHESIS_REQUIRED");
  commitOps(artifacts, root, "agent", [{ kind: "hypothesis.create", client_ref: "h", title: "H" }]);
  const orphanE = commitOps(artifacts, root, "agent", [{ kind: "evidence.create", client_ref: "e", title: "orphan", source_refs: ["raw:1"] }]);
  assert.equal(orphanE.code, "ARTIFACT_EVIDENCE_CHECKLIST_REQUIRED");
  const unsupported = commitOps(artifacts, root, "agent", [{ kind: "hypothesis.support", id: "H-0001" }]);
  assert.equal(unsupported.code, "ARTIFACT_HYPOTHESIS_EVIDENCE_REQUIRED");
  fs.rmSync(root, { recursive: true, force: true });
});

test("mode ownership is enforced at the service boundary", () => {
  const { root, artifacts } = boot();
  const attempts = [
    ["ask", { kind: "hypothesis.create", client_ref: "h", title: "H" }, "ARTIFACT_MODE_READ_ONLY"],
    ["hypothesis", { kind: "project.upsert", document: "targets", key: "host", value: "a", source_refs: ["x"] }, "ARTIFACT_MODE_READ_ONLY"],
    ["plan", { kind: "evidence.create", client_ref: "e", title: "E", checklist_refs: ["C-1"], source_refs: ["x"] }, "ARTIFACT_MODE_READ_ONLY"],
  ];
  for (const [mode, operation, code] of attempts) assert.equal(commitOps(artifacts, root, mode, [operation]).code, code);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Agent artifact staging can atomically populate project, hypothesis, checklist, and evidence state", () => {
  const { root, artifacts } = boot();
  const result = commitOps(artifacts, root, "agent", [
    { kind: "project.upsert", document: "surface", key: "endpoint", value: "GET /api/profile", source_refs: ["traffic:1"], scope_decision: "in_scope" },
    { kind: "hypothesis.create", client_ref: "h-profile", title: "Profile object authorization", objective: "Compare object access across authorized identities." },
    { kind: "checklist.create", client_ref: "c-profile", hypothesis_id: "h-profile", title: "Profile authorization baseline", phase: "assessment_l1", target: "GET /api/profile", knowledge_release_id: "wstg-v3", procedure_id: "wstg-athz-04", source_hash: "abc123" },
    { kind: "evidence.create", client_ref: "e-profile", title: "Profile baseline observed", status: "observed", checklist_refs: ["c-profile"], hypothesis_refs: ["h-profile"], target_refs: ["GET /api/profile"], source_refs: ["traffic:1"] },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.inspect.project.documents.surface.length, 1);
  assert.equal(result.inspect.hypotheses[0].id, "H-0001");
  assert.equal(result.inspect.checklist[0].phase, "assessment_l1");
  assert.equal(result.inspect.evidence[0].checklist_refs[0], "C-0001");
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
