"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { APPLY_ERROR_CODES, createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");

function ctx(root) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "patch-test",
    toolName: "apply_patch",
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root },
    sessionId: "session-1",
    mode: "agent",
  }));
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-patch-"));
  fs.mkdirSync(path.join(root, ".xekute"), { recursive: true });
  return root;
}

const CANONICAL_PATHS = [
  Artifacts.PATHS.projectEngagement,
  Artifacts.PATHS.projectTargets,
  Artifacts.PATHS.projectIdentities,
  Artifacts.PATHS.projectSurface,
  Artifacts.PATHS.projectControls,
  Artifacts.PATHS.projectIndex,
  Artifacts.PATHS.hypotheses,
  Artifacts.PATHS.checklist,
  Artifacts.PATHS.evidenceIndex,
  ".xekute/evidence/E-0001.md",
];

test("APPLY_PATCH_CANONICAL_ARTIFACT is exported", () => {
  assert.equal(APPLY_ERROR_CODES.CANONICAL_ARTIFACT, "APPLY_PATCH_CANONICAL_ARTIFACT");
});

test("create modify move delete on canonical investigation Markdown are rejected", async () => {
  const root = tempRoot();
  const tool = createApplyPatchTool();
  const execution = ctx(root);
  for (const relative of CANONICAL_PATHS) {
    const parent = path.join(root, path.dirname(relative));
    fs.mkdirSync(parent, { recursive: true });
    const existing = path.join(root, relative);
    fs.writeFileSync(existing, "# existing\n");
    for (const [kind, extra] of [
      ["create", { content: "new" }],
      ["modify", { content: "changed" }],
      ["move", { target: relative.replace(/\.md$/, "-moved.md") }],
      ["delete", {}],
    ]) {
      const result = await tool.execute({ operations: [{ kind, path: relative, ...extra }] }, execution);
      assert.equal(result.ok, false, `${kind} ${relative}`);
      assert.equal(result.error.code, "APPLY_PATCH_CANONICAL_ARTIFACT", `${kind} ${relative}`);
      assert.equal(result.error.retryable, false);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("leftover project_info.md is not treated as canonical", async () => {
  const root = tempRoot();
  const leftover = path.join(root, ".xekute", "project_info.md");
  fs.mkdirSync(path.dirname(leftover), { recursive: true });
  const tool = createApplyPatchTool();
  const created = await tool.execute({
    operations: [{ kind: "create", path: ".xekute/project_info.md", content: "legacy leftover\n" }],
  }, ctx(root));
  assert.equal(created.ok, true, created.error?.message || created.error);
  assert.equal(fs.readFileSync(leftover, "utf8"), "legacy leftover\n");
  const modified = await tool.execute({
    operations: [{ kind: "modify", path: ".xekute/project_info.md", content: "still leftover\n" }],
  }, ctx(root));
  assert.equal(modified.ok, true, modified.error?.message || modified.error);
  fs.rmSync(root, { recursive: true, force: true });
});

test("update_project_artifacts still writes canonical Markdown", () => {
  const root = tempRoot();
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(artifacts.bootstrap(root).ok, true);
  const snapshot = artifacts.inspect(root);
  const staged = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: snapshot.revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Project", value: "canonical write", source_refs: ["s1"] }],
  });
  assert.equal(staged.ok, true, staged.error);
  const committed = artifacts.commit(root, staged.staging_id);
  assert.equal(committed.ok, true, committed.error);
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.projectEngagement), "utf8"), /canonical write/);
  fs.rmSync(root, { recursive: true, force: true });
});
