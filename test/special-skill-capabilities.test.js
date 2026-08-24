"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CREATE_GUIDANCE_TOOL,
  createSpecialSkillToolDefinitions,
  executeCreateGuidance,
} = require("../src/agent/special-skills/capabilities.js");
const { writeGuidanceFile } = require("../src/app/services/guidance/custom-guidance.js");

function manifest(id = "create-rule") {
  return {
    manifest: {
      id,
      requiredTools: ["ask_questions", CREATE_GUIDANCE_TOOL],
      requiredCapabilities: [CREATE_GUIDANCE_TOOL],
    },
  };
}

test("creation special skills receive create_guidance only in their turn catalog", () => {
  const definitions = createSpecialSkillToolDefinitions(manifest());
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].function.name, CREATE_GUIDANCE_TOOL);
  assert.deepEqual(definitions[0].function.parameters.required, ["kind", "name", "content"]);
  assert.equal(createSpecialSkillToolDefinitions({ manifest: { id: "pentest", requiredTools: [] } }).length, 0);
});

test("create_guidance uses the safe guidance writer and refuses duplicates", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-special-guidance-"));
  try {
    const first = executeCreateGuidance({
      workspace,
      args: { kind: "rule", name: "review.md", content: "Use the review checklist." },
      writeGuidanceFile,
    });
    assert.equal(first.ok, true);
    assert.equal(first.guidancePath, ".xekute/rules/review.md");
    assert.equal(fs.readFileSync(path.join(workspace, ".xekute", "rules", "review.md"), "utf8"), "Use the review checklist.");

    const duplicate = executeCreateGuidance({
      workspace,
      args: { kind: "rule", name: "review.md", content: "replace me" },
      writeGuidanceFile,
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, "GUIDANCE_EXISTS");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

