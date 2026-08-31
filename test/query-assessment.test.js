"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { QUERY_ASSESSMENT_INPUT_SCHEMA, createQueryAssessmentTool } = require("../src/agent/tools/assessment/query-assessment.js");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");

function ctx(root) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "query-test",
    toolName: "query_assessment",
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root },
    sessionId: "session-1",
    mode: "agent",
  }));
}

function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-query-"));
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-08-30T00:00:00.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
  const bootstrapped = artifacts.bootstrap(root);
  assert.equal(bootstrapped.ok, true, bootstrapped.error);
  return { root, artifacts };
}

function commitOps(artifacts, root, mode, operations) {
  const snapshot = artifacts.inspect(root);
  const staged = artifacts.stage(root, { mode, expected_revisions: snapshot.revisions, operations });
  assert.equal(staged.ok, true, staged.error);
  const committed = artifacts.commit(root, staged.staging_id);
  assert.equal(committed.ok, true, committed.error);
  return committed;
}

test("query_assessment schema enum is the public investigation-state domains plus knowledge and graph", () => {
  assert.deepEqual(QUERY_ASSESSMENT_INPUT_SCHEMA.properties.domain.enum, [
    "engagement", "hypotheses", "checklist", "evidence", "knowledge", "graph",
  ]);
  assert.deepEqual(QUERY_ASSESSMENT_INPUT_SCHEMA.properties.phase.enum, [...Artifacts.CHECKLIST_PHASES]);
  assert.equal(QUERY_ASSESSMENT_INPUT_SCHEMA.properties.target.maxLength, 500);
});

test("query_assessment forwards phase and target to artifacts.query", async () => {
  const { root } = boot();
  const forwarded = [];
  const tool = createQueryAssessmentTool({
    artifacts: { query: async (_workspace, input) => { forwarded.push(input); return { ok: true, records: [] }; } },
  });
  const result = await tool.execute({ domain: "checklist", query: "cookie", id: "C-0001", phase: "execution", target: "app.example", limit: 5 }, ctx(root));
  assert.equal(result.ok, true);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].domain, "checklist");
  assert.equal(forwarded[0].query, "cookie");
  assert.equal(forwarded[0].id, "C-0001");
  assert.equal(forwarded[0].phase, "execution");
  assert.equal(forwarded[0].target, "app.example");
  assert.equal(forwarded[0].limit, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test("project, investigation, and findings domains are invalid even if schema is bypassed", async () => {
  const { root } = boot();
  let queried = false;
  const tool = createQueryAssessmentTool({
    artifacts: { query: async () => { queried = true; return { ok: true, records: [] }; } },
  });
  for (const domain of ["project", "investigation", "findings"]) {
    queried = false;
    const result = await tool.execute({ domain }, ctx(root));
    assert.equal(result.ok, false);
    assert.equal(result.code, "ARTIFACT_QUERY_DOMAIN_INVALID");
    assert.equal(queried, false);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("graph and knowledge branch before artifact query", async () => {
  const { root } = boot();
  const order = [];
  const tool = createQueryAssessmentTool({
    intelligence: {
      query: async () => { order.push("graph"); return { ok: true, source: "graph" }; },
      knowledge: { query: async () => { order.push("knowledge"); return { ok: true, source: "knowledge" }; } },
    },
    artifacts: { query: async () => { order.push("artifacts"); return { ok: true, records: [] }; } },
  });
  const graph = await tool.execute({ domain: "graph" }, ctx(root));
  const knowledge = await tool.execute({ domain: "knowledge" }, ctx(root));
  assert.equal(graph.source, "graph");
  assert.equal(knowledge.source, "knowledge");
  assert.deepEqual(order, ["graph", "knowledge"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("evidence domain reads E-#### via the artifact service", async () => {
  const { root, artifacts } = boot();
  commitOps(artifacts, root, "hypothesis", [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }]);
  commitOps(artifacts, root, "plan", [{
    kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
    target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
  }]);
  commitOps(artifacts, root, "agent", [{
    kind: "evidence.create", client_ref: "e1", title: "Cookie observed", status: "verified", verifier: "hybrid-accept",
    checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid",
  }]);
  const tool = createQueryAssessmentTool({ artifacts });
  const result = await tool.execute({ domain: "evidence" }, ctx(root));
  assert.equal(result.ok, true);
  assert.equal(result.records[0].id, "E-0001");
  fs.rmSync(root, { recursive: true, force: true });
});

test("engagement domain returns index rows by default", async () => {
  const { root, artifacts } = boot();
  commitOps(artifacts, root, "agent", [{ kind: "project.upsert", document: "engagement", key: "Project", value: "demo", source_refs: ["scope:engagement"] }]);
  const tool = createQueryAssessmentTool({ artifacts });
  const result = await tool.execute({ domain: "engagement" }, ctx(root));
  assert.equal(result.ok, true);
  assert.ok(result.records.length >= 1);
  assert.equal(result.records[0].source_refs, undefined);
  assert.ok(result.records[0].fact_id);
  assert.equal(result.records[0].document, "engagement");
  const full = await tool.execute({ domain: "engagement", id: "engagement" }, ctx(root));
  assert.ok(Array.isArray(full.records[0].source_refs));
  fs.rmSync(root, { recursive: true, force: true });
});
