"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createUpdateProjectArtifactsTool } = require("../src/agent/tools/workspace/update-project-artifacts.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-finalizer-"));
  fs.mkdirSync(path.join(root, ".xekute"), { recursive: true });
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(artifacts.bootstrap(root).ok, true);
  return { root, artifacts };
}

function toolCtx(root, extra = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "finalizer-test",
    toolName: "update_project_artifacts",
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root },
    sessionId: "session-1",
    mode: "agent",
    ...extra,
  }));
}

test("required no-op stages without rewriting sources; successful commit writes then rebuilds indexes", () => {
  const { root, artifacts } = boot();
  const before = artifacts.inspect(root);
  const engagement = fs.readFileSync(path.join(root, Artifacts.PATHS.projectEngagement), "utf8");
  const staged = artifacts.stage(root, { mode: "agent", expected_revisions: before.revisions, no_op_reason: "Nothing durable changed." });
  assert.equal(staged.ok, true, staged.error);
  assert.deepEqual(staged.changed_paths, []);
  const committed = artifacts.commit(root, staged.staging_id);
  assert.equal(committed.ok, true, committed.error);
  assert.equal(fs.readFileSync(path.join(root, Artifacts.PATHS.projectEngagement), "utf8"), engagement);
  const write = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Project", value: "committed", source_refs: ["s1"] }],
  });
  assert.equal(write.ok, true, write.error);
  assert.equal(artifacts.commit(root, write.staging_id).ok, true);
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.projectEngagement), "utf8"), /committed/);
  assert.equal(fs.existsSync(path.join(root, Artifacts.PATHS.projectIndex)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("secret reject is retryable after sanitizing; stale hashes retry; commit conflict is closed", () => {
  const { root, artifacts } = boot();
  const revisions = artifacts.inspect(root).revisions;
  const secret = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Note", value: "password=hunter2secretxx", source_refs: ["s1"] }],
  });
  assert.equal(secret.ok, false);
  assert.ok(["ARTIFACT_SECRET_VALUE", "ARTIFACT_SECRET_FIELD"].includes(secret.code));
  assert.equal(secret.retryable, true);
  const sanitized = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Note", value: "public note", source_refs: ["s1"] }],
  });
  assert.equal(sanitized.ok, true, sanitized.error);
  const stale = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: { ...revisions, hypotheses: "0".repeat(64) },
    operations: [{ kind: "project.upsert", document: "engagement", key: "Other", value: "later", source_refs: ["s2"] }],
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "ARTIFACT_REVISION_CONFLICT");
  assert.equal(stale.retryable, true);
  const current = artifacts.inspect(root).revisions;
  const conflictStage = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: current,
    operations: [{ kind: "project.upsert", document: "targets", key: "Host", value: "app.example", source_refs: ["s3"] }],
  });
  assert.equal(conflictStage.ok, true, conflictStage.error);
  fs.writeFileSync(path.join(root, Artifacts.PATHS.projectTargets), `${fs.readFileSync(path.join(root, Artifacts.PATHS.projectTargets), "utf8")}\nchanged after stage\n`);
  const conflict = artifacts.commit(root, conflictStage.staging_id);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "ARTIFACT_COMMIT_CONFLICT");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(main, /artifact_sync_failed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("nested stage is parent-only; stop/fail discards prepared; recover prepared vs committing vs quarantine", async () => {
  const { root, artifacts } = boot();
  const tool = createUpdateProjectArtifactsTool({ artifacts });
  const nested = await tool.execute({
    expected_revisions: artifacts.inspect(root).revisions,
    no_op_reason: "child attempt",
  }, toolCtx(root, { parentInvocationId: "parent-1" }));
  assert.equal(nested.ok, false);
  assert.equal(nested.code, "ARTIFACT_PARENT_ONLY");
  const prepared = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Keep", value: "discard-me", source_refs: ["s1"] }],
  });
  assert.equal(prepared.ok, true, prepared.error);
  const discarded = artifacts.discard(root, prepared.staging_id);
  assert.equal(discarded.ok, true);
  const recoveredPrepared = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: artifacts.inspect(root).revisions,
    no_op_reason: "leave prepared",
  });
  const recovered = artifacts.recover(root);
  assert.ok(recovered.discarded.includes(recoveredPrepared.staging_id));
  const committing = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{ kind: "project.upsert", document: "engagement", key: "Recover", value: "from-committing", source_refs: ["s2"] }],
  });
  const txnDir = path.join(root, Artifacts.PATHS.transactionDirectory, committing.staging_id);
  const manifestPath = path.join(txnDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.state = "committing";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const resumed = artifacts.recover(root);
  assert.ok(resumed.recovered.includes(committing.staging_id));
  assert.match(fs.readFileSync(path.join(root, Artifacts.PATHS.projectEngagement), "utf8"), /from-committing/);
  const quarantineStage = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{ kind: "project.upsert", document: "surface", key: "Route", value: "broken", source_refs: ["s3"] }],
  });
  const qDir = path.join(root, Artifacts.PATHS.transactionDirectory, quarantineStage.staging_id);
  const qManifestPath = path.join(qDir, "manifest.json");
  const qManifest = JSON.parse(fs.readFileSync(qManifestPath, "utf8"));
  qManifest.state = "committing";
  fs.writeFileSync(qManifestPath, `${JSON.stringify(qManifest, null, 2)}\n`);
  fs.writeFileSync(path.join(root, Artifacts.PATHS.projectSurface), `${fs.readFileSync(path.join(root, Artifacts.PATHS.projectSurface), "utf8")}\nmutated\n`);
  const quarantined = artifacts.recover(root);
  assert.equal(quarantined.ok, false);
  assert.equal(quarantined.quarantined.length > 0, true);
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(main, /projectArtifacts\.discard/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("missing-finalizer retries once then artifact_sync_failed; verify_finding remains non-writing", async () => {
  const { root } = boot();
  const events = [];
  const result = await runAgentTurn({
    mode: "agent",
    workspace: root,
    userMessage: "Summarize the engagement.",
    requireArtifactFinalization: true,
    isFirstAgentTurn: false,
    runModelRound: async () => ({ fullText: "done", toolCalls: [] }),
    executeToolCall: async () => ({ ok: true, staging_id: "should-not-run" }),
    sendEvent: (event) => events.push(event),
  });
  assert.equal(result.artifactSync?.code, "ARTIFACT_FINALIZER_MISSING");
  assert.equal(result.runState.status, "artifact_sync_failed");
  assert.ok(events.some((event) => event.type === "artifact_finalization" && event.status === "required"));
  const verifySource = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "tools", "assessment", "verify-finding.js"), "utf8");
  assert.doesNotMatch(verifySource, /writeFile|appendFile|mkdirSync/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a completed Tier 2 turn stages and commits project information, checklist state, and evidence together", async () => {
  const { root, artifacts } = boot();
  const hypothesis = artifacts.stage(root, {
    mode: "hypothesis",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }],
  });
  assert.equal(hypothesis.ok, true, hypothesis.error);
  assert.equal(artifacts.commit(root, hypothesis.staging_id).ok, true);
  const checklist = artifacts.stage(root, {
    mode: "plan",
    expected_revisions: artifacts.inspect(root).revisions,
    operations: [{
      kind: "checklist.create",
      client_ref: "c1",
      hypothesis_id: "H-0001",
      title: "Inspect the session cookie",
      phase: "execution",
      target: "app.example",
    }],
  });
  assert.equal(checklist.ok, true, checklist.error);
  assert.equal(artifacts.commit(root, checklist.staging_id).ok, true);

  const updateTool = createUpdateProjectArtifactsTool({ artifacts });
  const expectedRevisions = artifacts.inspect(root).revisions;
  const operations = [
    { kind: "project.upsert", document: "targets", key: "Host", value: "app.example", source_refs: ["traffic:1"] },
    { kind: "checklist.execution", id: "C-0001", status: "in_progress", execution_result: "Cookie behavior observed." },
    {
      kind: "evidence.create",
      client_ref: "e1",
      title: "Session cookie observed",
      status: "observed",
      checklist_refs: ["C-0001"],
      hypothesis_refs: ["H-0001"],
      target_refs: ["app.example"],
      source_refs: ["traffic:1"],
      sanitized_excerpts: "Set-Cookie header observed",
    },
  ];
  let round = 0;
  const result = await runAgentTurn({
    mode: "agent",
    workspace: root,
    userMessage: "Record the completed cookie inspection.",
    requireArtifactFinalization: true,
    isFirstAgentTurn: false,
    tools: [{
      type: "function",
      function: {
        name: updateTool.name,
        description: "Stage canonical Tier 2 project artifacts.",
        parameters: updateTool.inputSchema,
      },
    }],
    runModelRound: async () => {
      if (round++ === 0) {
        return {
          fullText: "",
          toolCalls: [{
            id: "tier2-finalizer",
            type: "function",
            function: {
              name: "update_project_artifacts",
              arguments: JSON.stringify({ expected_revisions: expectedRevisions, operations }),
            },
          }],
        };
      }
      return { fullText: "Tier 2 maintenance complete.", toolCalls: [] };
    },
    executeToolCall: async ({ toolCall, mode }) => {
      const input = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
      return artifacts.stage(root, {
        mode,
        expected_revisions: input.expected_revisions,
        operations: input.operations,
        trusted_provenance: { successfulToolRefs: [] },
      });
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.runState.status, "completed", JSON.stringify(result));
  assert.ok(result.artifactFinalization?.staging_id);
  const committed = artifacts.commit(root, result.artifactFinalization.staging_id);
  assert.equal(committed.ok, true, committed.error);

  const snapshot = artifacts.inspect(root);
  assert.equal(snapshot.project.documents.targets.some((fact) => fact.value === "app.example"), true);
  assert.equal(snapshot.checklist.find((item) => item.id === "C-0001")?.status, "in_progress");
  assert.equal(snapshot.evidence.find((item) => item.id === "E-0001")?.title, "Session cookie observed");
  fs.rmSync(root, { recursive: true, force: true });
});
