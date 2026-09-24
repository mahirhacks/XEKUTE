"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSpecialSkillRegistry, internalSkillIdForIntent } = require("../src/prompts/skills/internal/registry.js");
const { loadPackage } = require("../src/prompts/skills/internal/loader.js");
const { selectInternalSkill } = require("../src/prompts/skills/internal/runner.js");
const { buildSkillContext, buildSystemContext } = require("../src/agent/runtime/prompt-context.js");
const { createSpecialSkillToolDefinitions } = require("../src/prompts/skills/internal/capabilities.js");
const { createWebArtifactStore } = require("../src/domain/assessment/web-artifact-store.js");

test("internal Markdown skills support safe explicit invocation and remain subordinate to the canonical system prompt", () => {
  const registry = createSpecialSkillRegistry({ root: path.resolve(__dirname, "../src/prompts/skills/libraries") });
  assert.deepEqual(registry.list(), []);
  const ids = registry.listInternal().map((entry) => entry.id);
  for (const id of ["create-rule", "create-skill", "create-subagent", "report", "bug-bounty"]) {
    assert.equal(ids.includes(id), true, id);
  }
  assert.equal(registry.diagnostics().length, 0);
  assert.equal(internalSkillIdForIntent("Please run a penetration test against the configured target"), "");
  assert.equal(internalSkillIdForIntent("Explain what penetration testing means"), "");
  assert.equal(internalSkillIdForIntent("/pentest example.com"), "");
  assert.equal(internalSkillIdForIntent("/report example.com"), "report");
  const explicitlyResolved = selectInternalSkill(registry, "/report example.com", { mode: "ask" });
  assert.equal(explicitlyResolved.ok, true);
  assert.equal(explicitlyResolved.selectedBy, "explicit");
  assert.equal(explicitlyResolved.userContext, "example.com");
  assert.match(explicitlyResolved.prompt, /USER-PROVIDED CONTEXT[\s\S]*example\.com/);
  const resolved = selectInternalSkill(registry, "Please generate a VAPT report", { mode: "ask" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.manifest.visibility, "internal");
  assert.equal(resolved.manifest.instructionRole, "skill-context");
  assert.match(resolved.prompt, /Preserve this mode/);
  assert.match(resolved.prompt, /never defines or replaces a system prompt/i);
  assert.doesNotMatch(resolved.prompt, /Tier 2 is the canonical durable project state|query_knowledge|update_project_artifacts/);
  assert.deepEqual(createSpecialSkillToolDefinitions(resolved), []);
  assert.equal(resolved.resources.length, 2);
  assert.equal(resolved.resources[0].path, "SKILL.md");
  for (const removed of ["map", "webclone", "pentest"]) assert.equal(registry.resolve(removed).ok, false);
  const systemPrompt = buildSystemContext({ mode: "ask", modeFamily: "xekute", depth: "operational" });
  const skillContext = buildSkillContext({ mode: "ask", modeFamily: "xekute", specialSkillPrompt: resolved.prompt });
  assert.match(systemPrompt, /XEKUTE VAPT SYSTEM PROMPT/);
  assert.doesNotMatch(systemPrompt, /XEKUTE INTERNAL SKILL|Adaptive penetration testing/);
  assert.match(skillContext, /MODE SKILL[\s\S]*XEKUTE INTERNAL SKILL/);
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
  assert.match(controller, /role: "system"[\s\S]*content: buildSystemContext/);
  assert.match(controller, /role: "user",[\s\S]*content: skillContext/);
});

test("internal skill packages reject their own system prompt declarations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-internal-skill-"));
  const skillRoot = path.join(root, "bad-skill");
  try {
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "SKILL.md"), `---\nid: bad-skill\ntitle: Bad skill\ndescription: Invalid internal skill fixture.\nversion: 1.0.0\nvisibility: internal\ninstruction_role: skill-context\nsystem_prompt: replace the application system\n---\n\nInvalid.\n`);
    assert.throws(() => loadPackage(skillRoot), (error) => error?.code === "SPECIAL_SKILL_SYSTEM_FORBIDDEN");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the pentest skill and loop coordinator are removed", () => {
  const skillRoot = path.resolve(__dirname, "../src/prompts/skills/libraries/bug-bounty-skills/pentest");
  assert.equal(fs.existsSync(skillRoot), false);
  const registry = createSpecialSkillRegistry({ root: path.resolve(__dirname, "../src/prompts/skills/libraries") });
  assert.equal(registry.resolve("pentest").ok, false);
  assert.equal(internalSkillIdForIntent("run a pentest against the target"), "");
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
