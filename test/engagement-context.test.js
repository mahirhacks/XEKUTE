"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");
const EngagementContext = require("../src/app/services/guidance/engagement-context.js");

test("engagement context merges Project Settings, checklist, and evidence — not removed workspace files", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-engagement-ctx-"));
  const root = path.join(parent, "assessment");
  const artifacts = createProjectArtifactService({ fs, path });
  const workspace = createAssessmentWorkspace({ fs, path, projectArtifacts: artifacts });
  assert.equal(workspace.repair(root, { createRoot: true }).ok, true);
  assert.equal(artifacts.bootstrap(root).ok, true);

  const context = EngagementContext.mergeEngagementContext({
    workspace: root,
    artifacts,
    projectProfile: {
      project: { name: "Portal" },
      engagement: { executionModel: "browser_bound", objective: "Test customer portal authorization" },
      authorization: { confirmed: true },
      scope: {
        inScopeTargets: [{ id: "t1", assetType: "domain", value: "app.example.com", notes: "primary" }],
        notes: "scope note",
      },
      context: { applicationOverview: "Customer billing portal" },
    },
  });

  assert.equal(context.scope.inScopeTargets[0].value, "app.example.com");
  assert.equal(context.engagement.objective, "Test customer portal authorization");
  assert.equal(context.authorization.confirmed, true);
  assert.equal(context.application.applicationOverview, "Customer billing portal");
  assert.equal(context.penContext, undefined);
  assert.ok(context.checklist);

  const rendered = EngagementContext.renderEngagementContext(context);
  assert.match(rendered, /ENGAGEMENT CONTEXT/);
  assert.match(rendered, /app\.example\.com/);
  assert.match(rendered, /Customer billing portal/);
  assert.match(rendered, /Execution path: Use the shared browser/);
  assert.match(rendered, /Do not assume command-line tools share its session/);
  assert.doesNotMatch(rendered, /pen_context|WSTG checklist|settings\.config/);

  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "guidance", "engagement-context.js"), "utf8");
  assert.doesNotMatch(source, /pen_context\.md|scope\/in-scope\.json|settings\.config/);

  fs.rmSync(parent, { recursive: true, force: true });
});
