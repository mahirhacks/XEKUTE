const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { formatWorkspaceGuidance, listWorkspaceGuidance } = require("../src/agent/instructions/custom-guidance");

test("project guidance loads only supported custom skill, rule, and instruction files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-guidance-"));
  try {
    fs.mkdirSync(path.join(root, "custom", "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, "custom", "rules"), { recursive: true });
    fs.mkdirSync(path.join(root, "custom", "instructions"), { recursive: true });
    fs.writeFileSync(path.join(root, "custom", "skills", "triage.md"), "Prefer evidence-backed triage.", "utf8");
    fs.writeFileSync(path.join(root, "custom", "rules", "roe.yaml"), "- Ask before active testing", "utf8");
    fs.writeFileSync(path.join(root, "custom", "instructions", "report.txt"), "Use concise headings.", "utf8");
    fs.writeFileSync(path.join(root, "custom", "instructions", "ignored.js"), "not guidance", "utf8");

    const entries = listWorkspaceGuidance(root);
    assert.deepEqual(entries.map((entry) => entry.relativePath), [
      "custom/instructions/report.txt",
      "custom/rules/roe.yaml",
      "custom/skills/triage.md",
    ]);
    const context = formatWorkspaceGuidance(root, entries);
    assert.match(context, /XEKUTE USER-PROVIDED GUIDANCE/);
    assert.match(context, /triage\.md/);
    assert.match(context, /Ask before active testing/);
    assert.doesNotMatch(context, /not guidance/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
