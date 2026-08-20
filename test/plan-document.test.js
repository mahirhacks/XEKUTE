const test = require("node:test");
const assert = require("node:assert/strict");

const PlanDocument = require("../src/agent/modes/plan/plan-document.js");

test("buildPlanDocumentPath uses topic date and time slug", () => {
  const path = PlanDocument.buildPlanDocumentPath(
    "Build a VAPT hypothesis plan for the API auth flow",
    new Date("2026-08-03T07:31:00"),
  );
  assert.match(path, /^\.xekute\/plans\/plan-api-auth-flow_2026-08-03_0731\.md$/);
});

test("plan document contract requires manage_plan Markdown creation", () => {
  const contract = PlanDocument.planDocumentContract({
    path: ".xekute/plans/plan-api_2026-08-03_0731.md",
    userMessage: "plan the API test",
  });
  assert.match(contract, /manage_plan/);
  assert.match(contract, /operation create/);
  assert.match(contract, /Do not write the full plan in chat/);
  assert.match(contract, /\.xekute\/plans\/plan-api_2026-08-03_0731\.md/);
});

test("plan document update contract requires an in-place plan revision", () => {
  const contract = PlanDocument.planDocumentContract({
    path: ".xekute/plans/plan-api.md",
    userMessage: "update the priorities",
    operation: "update",
  });
  assert.match(contract, /Update the existing Markdown plan in place/);
  assert.match(contract, /manage_plan/);
  assert.match(contract, /operation update/);
  assert.match(contract, /Required path: \.xekute\/plans\/plan-api\.md/);
  assert.match(contract, /Do not create or update source code/);
});
