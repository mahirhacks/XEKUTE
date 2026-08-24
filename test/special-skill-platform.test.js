"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSpecialSkillRegistry, invocationParts } = require("../src/agent/special-skills/registry.js");
const { resolveInvocation } = require("../src/agent/special-skills/runner.js");
const { createPentestStateStore } = require("../src/agent/special-skills/pentest/state-store.js");
const { createPentestOrchestrator } = require("../src/agent/special-skills/pentest/orchestrator.js");
const { createSpecialSkillToolDefinitions } = require("../src/agent/special-skills/capabilities.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace.js");
const { createAssessmentIntelligenceService } = require("../src/app/services/assessment/intelligence/assessment-intelligence-service.js");
const { createSkillKnowledgeGraph } = require("../src/app/services/assessment/knowledge/skill-knowledge-graph.js");
const {
  buildChecklist,
  buildWeaknessVectors,
  resolveVulnerabilitySkills,
  shouldConverge,
  validateChecklistDependencies,
} = require("../src/agent/special-skills/pentest/pipeline.js");
const { createWebArtifactStore } = require("../src/domain/assessment/web-artifact-store.js");

test("special-skill registry discovers only the retained built-ins and treats trailing text as context", () => {
  const registry = createSpecialSkillRegistry({ root: path.resolve(__dirname, "../src/agent/special-skills") });
  assert.deepEqual(registry.list().map((entry) => entry.command), ["/create-rule", "/create-skill", "/create-subagent", "/pentest", "/report"]);
  assert.deepEqual(invocationParts("/pentest --target example.com"), { command: "/pentest", userContext: "--target example.com", raw: "/pentest --target example.com" });
  const resolved = resolveInvocation(registry, "/pentest --target example.com", { mode: "ask" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.userContext, "--target example.com");
  assert.match(resolved.prompt, /Preserve this mode/);
  assert.ok(createSpecialSkillToolDefinitions(resolved).some((tool) => tool.function.name === "manage_pentest"));
  assert.equal(registry.resolve("/map").ok, false);
});

test("pentest state store writes bounded run artifacts and a current pointer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-pentest-state-"));
  try {
    const store = createPentestStateStore({ fs, path, crypto: require("node:crypto"), now: () => new Date("2026-01-02T03:04:05.000Z") });
    const created = store.createRun(root, { runId: "run-1", mode: "ask" });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(root, ".xekute", "special-skills", "pentest", "current.json")), true);
    assert.equal(store.writeMarkdown(root, "run-1", "intelligence", "# Facts\n\n- host observed").ok, true);
    assert.equal(store.writeIteration(root, "run-1", 1, "# Iteration 1").ok, true);
    const updated = store.update(root, "run-1", { status: "reconnaissance", iteration: 1 });
    assert.equal(updated.run.status, "reconnaissance");
    assert.equal(store.read(root, "run-1").run.iteration, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("web artifact store accepts bounded web assets and deduplicates content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-web-artifact-"));
  try {
    const store = createWebArtifactStore({ fs, path, crypto: require("node:crypto") });
    const input = { url: "https://example.test/app.js?token=secret", contentType: "application/javascript", content: "fetch('/api/orders');" };
    const first = store.capture(root, input);
    const second = store.capture(root, input);
    assert.equal(first.ok, true);
    assert.equal(first.type, "javascript");
    assert.equal(second.duplicate, true);
    const manifest = store.readManifest(root);
    assert.equal(manifest.artifacts.length, 1);
    assert.ok(manifest.artifacts[0].endpoints.some((endpoint) => endpoint.url.endsWith("/api/orders")));
    assert.equal(store.capture(root, { url: "https://example.test/image.js", contentType: "application/octet-stream", content: "not a web artifact" }).code, "NOT_WEB_ARTIFACT");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("pentest pipeline deterministically selects skills, includes bases, and validates task dependencies", () => {
  const graph = {
    list: () => [
      { id: "idor", title: "IDOR", source: "libraries/idor.md", sourceHash: "a", category: "authorization", level: "standard", signals: ["object id"], technologies: ["rest"], advanceOf: "" },
      { id: "advance_idor", title: "Advanced IDOR", source: "libraries/advance_idor.md", sourceHash: "b", category: "authorization", level: "advanced", signals: ["bulk"], technologies: ["rest"], advanceOf: "idor" },
    ],
  };
  const selection = resolveVulnerabilitySkills({ knowledgeGraph: graph, facts: [{ route: "/api/orders/123", note: "object id and bulk export" }], technologies: ["rest"] });
  assert.deepEqual(selection.selected.map((item) => item.id), ["advance_idor", "idor"]);
  const vectors = buildWeaknessVectors({ selectedSkills: selection.selected, targets: ["https://example.test/api/orders/123"] });
  const tasks = buildChecklist(vectors);
  assert.equal(validateChecklistDependencies(tasks).ok, true);
  assert.equal(shouldConverge({ iteration: 3, tasks }).reason, "iteration-cap");
});

test("pentest orchestrator wires canonical intelligence into stable vectors, detailed tasks, and runtime state", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-pentest-orchestrator-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path });
  const intelligence = createAssessmentIntelligenceService({ enableWorker: false });
  try {
    assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
    for (const relativePath of ["scope/in-scope.json", "scope/engagement.json"]) {
      const target = path.join(root, ...relativePath.split("/"));
      const document = JSON.parse(fs.readFileSync(target, "utf8"));
      document.authorization.confirmed = true;
      if (Array.isArray(document.targets)) document.targets = [{ id: "app", assetType: "web-application", value: "https://app.test" }];
      fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    }
    const endpointPath = path.join(root, "enumeration", "endpoints.json");
    const endpoints = JSON.parse(fs.readFileSync(endpointPath, "utf8"));
    endpoints.endpoints = [{
      id: "endpoint-user",
      method: "GET",
      url: "https://app.test/api/users/42",
      parameters: [{ name: "user_id" }],
      authentication: "session",
      authorizationRoles: ["user"],
      technologies: ["rest"],
      notes: "numeric id object owner boundary",
      evidence: ["ev-endpoint"],
    }];
    fs.writeFileSync(endpointPath, `${JSON.stringify(endpoints, null, 2)}\n`, "utf8");
    await intelligence.start(root, { runId: "run-wired" });

    const store = createPentestStateStore({ fs, path, crypto: require("node:crypto") });
    const knowledgeGraph = createSkillKnowledgeGraph({ libraryRoot: path.resolve(__dirname, "../src/prompts/skills/libraries") });
    const orchestrator = createPentestOrchestrator({ fs, path, crypto: require("node:crypto"), stateStore: store, assessmentWorkspace: workspace, intelligence, knowledgeGraph });
    const initialized = await orchestrator.initialize(root, { runId: "run-wired", mode: "ask" });
    assert.equal(initialized.ok, true);
    assert.equal(initialized.run.mode, "ask");
    assert.equal(initialized.run.iteration, 1);
    assert.ok(initialized.run.selectedSkills.includes("idor"));
    assert.equal(initialized.run.selectedSkills.includes("client_storage"), false);
    assert.equal(fs.existsSync(store.paths(root, "run-wired").plan), true);

    const firstPlan = store.readPlan(root, "run-wired").plan;
    const idorTask = firstPlan.tasks.find((task) => task.vulnerabilityClass === "idor");
    assert.ok(idorTask);
    assert.equal(idorTask.url, "https://app.test/api/users/42");
    assert.equal(idorTask.method, "GET");
    assert.equal(idorTask.parameter, "user_id");
    assert.equal(idorTask.requiredSession, "session");
    assert.equal(idorTask.requiredRole, "user");
    assert.equal(idorTask.knowledgeSource.id, "idor");
    assert.ok(idorTask.procedure.length > 40);
    assert.equal(validateChecklistDependencies(firstPlan.tasks).ok, true);

    const taskUpdate = await orchestrator.updateTask(root, "run-wired", { taskId: idorTask.id, status: "completed", result: "Negative control retained authorization boundaries.", evidenceIds: ["ev-test-idor"] });
    assert.equal(taskUpdate.ok, true);
    assert.equal(store.readPlan(root, "run-wired").plan.tasks.find((task) => task.fingerprint === idorTask.fingerprint).status, "completed");

    endpoints.endpoints.push({ id: "endpoint-admin", method: "POST", url: "https://app.test/api/admin/users", authentication: "session", authorizationRoles: ["admin"], technologies: ["rest"], notes: "admin privileged management function", evidence: ["ev-admin"] });
    fs.writeFileSync(endpointPath, `${JSON.stringify(endpoints, null, 2)}\n`, "utf8");
    const changedSnapshot = await orchestrator.snapshot(root, "run-wired");
    const changedEndpoint = changedSnapshot.facts.find((fact) => fact?.id === "endpoint-admin");
    assert.ok(changedEndpoint);
    assert.equal(changedEndpoint.notes, "admin privileged management function");
    const changedSelection = resolveVulnerabilitySkills({ knowledgeGraph, facts: changedSnapshot.facts, technologies: changedSnapshot.technologies });
    assert.ok(changedSelection.selected.some((skill) => skill.id === "bfla"), JSON.stringify({ endpoint: changedEndpoint, bfla: knowledgeGraph.list().find((skill) => skill.id === "bfla"), selected: changedSelection.selected }));
    const refreshed = await orchestrator.synchronize(root, "run-wired", { reason: "fixture-new-endpoint" });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.materialChanged, true);
    assert.ok(refreshed.selection.selected.some((skill) => skill.id === "bfla"), refreshed.selection.selected.map((skill) => skill.id).join(","));
    assert.ok(refreshed.run.selectedSkills.includes("bfla"), refreshed.run.selectedSkills.join(","));
    const secondPlan = store.readPlan(root, "run-wired").plan;
    assert.equal(secondPlan.tasks.find((task) => task.fingerprint === idorTask.fingerprint).id, idorTask.id);
    assert.equal(secondPlan.tasks.find((task) => task.fingerprint === idorTask.fingerprint).status, "completed");

    const incomplete = await orchestrator.completeIteration(root, "run-wired");
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.code, "PENTEST_ITERATION_INCOMPLETE");

    const bflaTask = secondPlan.tasks.find((task) => task.vulnerabilityClass === "bfla");
    const observed = await orchestrator.observeToolResult({
      workspace: root,
      runId: "run-wired",
      toolName: "run_test_case",
      args: { testCase: { id: bflaTask.id } },
      result: { ok: true, value: { testCaseId: bflaTask.id, outcome: "passed" }, evidenceIds: ["ev-bfla-runtime"] },
    });
    assert.equal(observed.ok, true);
    assert.equal(store.readPlan(root, "run-wired").plan.tasks.find((task) => task.id === bflaTask.id).status, "completed");

    const terminalPlan = store.readPlan(root, "run-wired").plan;
    terminalPlan.tasks = terminalPlan.tasks.map((task) => ({ ...task, status: "completed", evidenceIds: task.evidenceIds?.length ? task.evidenceIds : ["ev-fixture"] }));
    assert.equal(store.writePlan(root, "run-wired", terminalPlan).ok, true);
    store.update(root, "run-wired", { iteration: 3 });
    const capped = await orchestrator.completeIteration(root, "run-wired");
    assert.equal(capped.ok, true);
    assert.equal(capped.reason, "iteration-cap");
    assert.equal(capped.run.status, "completed");
    assert.equal(fs.existsSync(path.join(store.paths(root, "run-wired").iterations, "iteration-03.md")), true);

    const convergenceRun = await orchestrator.initialize(root, { runId: "run-converged", mode: "plan" });
    assert.equal(convergenceRun.ok, true);
    const convergencePlan = store.readPlan(root, "run-converged").plan;
    convergencePlan.tasks = convergencePlan.tasks.map((task) => ({ ...task, status: "completed", evidenceIds: ["ev-convergence"] }));
    store.writePlan(root, "run-converged", convergencePlan);
    const converged = await orchestrator.completeIteration(root, "run-converged");
    assert.equal(converged.ok, true);
    assert.equal(converged.converged, true);
    assert.equal(converged.run.iteration, 1);
    assert.equal(store.readPlan(root, "run-converged").plan.iteration, 1);
  } finally {
    await intelligence.dispose();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
