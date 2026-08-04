const test = require("node:test");
const assert = require("node:assert/strict");

const PlanDocument = require("../src/application/planning/plan-document");

test("buildPlanDocumentPath uses topic date and time slug", () => {
  const path = PlanDocument.buildPlanDocumentPath(
    "Build a VAPT hypothesis plan for the API auth flow",
    new Date("2026-08-03T07:31:00"),
  );
  assert.match(path, /^plans\/plan-api-auth-flow_2026-08-03_0731\.md$/);
});

test("plan document contract requires create_file", () => {
  const contract = PlanDocument.planDocumentContract({
    path: "plans/plan-api_2026-08-03_0731.md",
    userMessage: "plan the API test",
  });
  assert.match(contract, /create_file/);
  assert.match(contract, /Do not write the full hypothesis plan in chat/);
  assert.match(contract, /plans\/plan-api_2026-08-03_0731\.md/);
});

test("plan document update contract requires an in-place plan revision", () => {
  const contract = PlanDocument.planDocumentContract({
    path: "plans/plan-api.md",
    userMessage: "update the priorities",
    operation: "update",
  });
  assert.match(contract, /Update the existing hypothesis plan in place/);
  assert.match(contract, /read_file/);
  assert.match(contract, /patch_file/);
  assert.match(contract, /write_file/);
  assert.match(contract, /Required path: plans\/plan-api\.md/);
  assert.match(contract, /Do not create or update source code/);
});
