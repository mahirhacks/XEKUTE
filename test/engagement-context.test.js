const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const EngagementContext = require("../src/application/planning/engagement-context");

test("engagement context merges scope, engagement, checklist, and pen_context", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-engagement-ctx-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const inScopePath = path.join(root, "scope", "in-scope.json");
  const inScope = JSON.parse(fs.readFileSync(inScopePath, "utf8"));
  inScope.targets = [{ id: "t1", assetType: "domain", value: "app.example.com", notes: "primary" }];
  inScope.notes = "scope note";
  fs.writeFileSync(inScopePath, `${JSON.stringify(inScope, null, 2)}\n`, "utf8");

  const engagementPath = path.join(root, "scope", "engagement.json");
  const engagement = JSON.parse(fs.readFileSync(engagementPath, "utf8"));
  engagement.engagement.objective = "Test customer portal authorization";
  engagement.authorization.confirmed = true;
  fs.writeFileSync(engagementPath, `${JSON.stringify(engagement, null, 2)}\n`, "utf8");

  fs.writeFileSync(path.join(root, "pen_context.md"), "JWT auth on API routes.\n", "utf8");

  const context = EngagementContext.mergeEngagementContext({
    workspace: root,
    projectProfile: {
      project: { name: "Portal" },
      context: { applicationOverview: "Customer billing portal" },
    },
  });

  assert.equal(context.scope.inScopeTargets[0].value, "app.example.com");
  assert.equal(context.engagement.objective, "Test customer portal authorization");
  assert.equal(context.authorization.confirmed, true);
  assert.equal(context.application.applicationOverview, "Customer billing portal");
  assert.match(context.penContext, /JWT auth/);
  assert.ok(context.checklist.progress);

  const rendered = EngagementContext.renderEngagementContext(context);
  assert.match(rendered, /ENGAGEMENT CONTEXT/);
  assert.match(rendered, /app\.example\.com/);
  assert.match(rendered, /Customer billing portal/);
  assert.match(rendered, /JWT auth/);
  assert.match(rendered, /WSTG/);

  fs.rmSync(parent, { recursive: true, force: true });
});
