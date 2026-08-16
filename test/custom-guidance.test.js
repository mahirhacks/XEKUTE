const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  formatWorkspaceGuidance,
  listGuidanceEntries,
  listWorkspaceGuidance,
  writeGuidanceFile,
} = require("../src/app/services/guidance/custom-guidance.js");

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

test(".xekute guidance supports project and global scopes without overwriting files", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-project-guidance-"));
  const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-global-guidance-"));
  try {
    const projectWrite = writeGuidanceFile({
      workspace: project,
      globalRoot,
      scope: "project",
      kind: "rules",
      name: "review-quality",
      content: "# Review quality\nPrefer focused, evidence-backed changes.",
    });
    const globalWrite = writeGuidanceFile({
      workspace: project,
      globalRoot,
      scope: "global",
      kind: "subagents",
      name: "documentation-helper.md",
      content: "# Documentation helper\nKeep explanations concise.",
    });
    const duplicate = writeGuidanceFile({
      workspace: project,
      globalRoot,
      scope: "project",
      kind: "rules",
      name: "review-quality.md",
      content: "replacement",
    });

    assert.equal(projectWrite.ok, true);
    assert.equal(globalWrite.ok, true);
    assert.equal(duplicate.code, "GUIDANCE_EXISTS");
    assert.equal(fs.existsSync(path.join(project, ".xekute", "rules", "review-quality.md")), true);
    assert.equal(fs.existsSync(path.join(globalRoot, ".xekute", "subagents", "documentation-helper.md")), true);

    const entries = listGuidanceEntries({ workspace: project, globalRoot, scope: "all" });
    assert.deepEqual(entries.map((entry) => `${entry.scope}:${entry.relativePath}`), [
      "global:.xekute/subagents/documentation-helper.md",
      "project:.xekute/rules/review-quality.md",
    ]);
    const context = formatWorkspaceGuidance(project, undefined, { globalRoot });
    assert.match(context, /GLOBAL/);
    assert.match(context, /PROJECT/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(globalRoot, { recursive: true, force: true });
  }
});
