"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSpecialSkillRegistry, internalSkillIdForIntent } = require("../src/agent/special-skills/registry.js");
const { loadPackage } = require("../src/agent/special-skills/loader.js");
const { selectInternalSkill } = require("../src/agent/special-skills/runner.js");
const { buildSkillContext, buildSystemContext } = require("../src/agent/runtime/prompt-context.js");
const { createSpecialSkillToolDefinitions } = require("../src/agent/special-skills/capabilities.js");
const { createWebArtifactStore } = require("../src/domain/assessment/web-artifact-store.js");

test("internal Markdown skills support safe explicit invocation and remain subordinate to the canonical system prompt", () => {
  const registry = createSpecialSkillRegistry({ root: path.resolve(__dirname, "../src/agent/special-skills") });
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.listInternal().map((entry) => entry.id), ["create-rule", "create-skill", "create-subagent", "pentest", "report"]);
  assert.equal(internalSkillIdForIntent("Please run a penetration test against the configured target"), "pentest");
  assert.equal(internalSkillIdForIntent("Explain what penetration testing means"), "");
  assert.equal(internalSkillIdForIntent("/pentest example.com"), "pentest");
  const explicitlyResolved = selectInternalSkill(registry, "/pentest example.com", { mode: "ask" });
  assert.equal(explicitlyResolved.ok, true);
  assert.equal(explicitlyResolved.selectedBy, "explicit");
  assert.equal(explicitlyResolved.userContext, "example.com");
  assert.match(explicitlyResolved.prompt, /USER-PROVIDED CONTEXT[\s\S]*example\.com/);
  const resolved = selectInternalSkill(registry, "Please run a penetration test against the configured target", { mode: "ask" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.manifest.visibility, "internal");
  assert.equal(resolved.manifest.instructionRole, "skill-context");
  assert.match(resolved.prompt, /Preserve this mode/);
  assert.match(resolved.prompt, /never defines or replaces a system prompt/i);
  assert.match(resolved.prompt, /Tier 2 is the canonical durable project state[\s\S]*update_project_artifacts/);
  assert.match(resolved.prompt, /Tier 3[\s\S]*WSTG/);
  assert.deepEqual(createSpecialSkillToolDefinitions(resolved), []);
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].path, "SKILL.md");
  for (const removed of ["map", "webclone"]) assert.equal(registry.resolve(removed).ok, false);
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

test("pentest is one Markdown skill with a shared-memory loop coordinator", () => {
  const skillRoot = path.resolve(__dirname, "../src/agent/special-skills/pentest");
  assert.deepEqual(fs.readdirSync(skillRoot).sort(), ["SKILL.md", "loop-controller.js"]);
  const loaded = loadPackage(skillRoot);
  assert.equal(loaded.resources.length, 1);
  assert.deepEqual(loaded.manifest.resources, []);
  assert.equal(loaded.manifest.requiredTools.includes("manage_pentest"), false);
  assert.ok(loaded.manifest.requiredTools.includes("query_assessment"));
  assert.ok(loaded.manifest.requiredTools.includes("query_knowledge"));
  assert.ok(loaded.manifest.requiredTools.includes("expand_evidence"));
  assert.ok(loaded.manifest.requiredTools.includes("web_research"));
  assert.ok(loaded.manifest.requiredTools.includes("browser_action"));
  assert.ok(loaded.manifest.requiredTools.includes("update_project_artifacts"));
  assert.ok(loaded.manifest.requiredTools.includes("pentest_checkpoint"));
  assert.match(loaded.resources[0].content, /There is no Pentest-private investigation store/);
  assert.match(loaded.resources[0].content, /update_project_artifacts/);
  assert.match(loaded.resources[0].content, /There is no iteration limit/);
  assert.match(loaded.resources[0].content, /Deep passive reconnaissance/);
  assert.match(loaded.resources[0].content, /Deep active reconnaissance/);
  assert.match(loaded.resources[0].content, /Vulnerability assessment level 1/);
  assert.match(loaded.resources[0].content, /Vulnerability assessment level 2/);
  assert.match(loaded.resources[0].content, /JavaScript[\s\S]*runtime-rendered SPA/);
  assert.match(loaded.resources[0].content, /query Tier 3[\s\S]*WSTG/i);
  assert.match(loaded.resources[0].content, /H-####/);
  assert.match(loaded.resources[0].content, /C-####/);
  assert.match(loaded.resources[0].content, /E-####/);
  assert.match(loaded.resources[0].content, /project_info\//);
  assert.match(loaded.resources[0].content, /checklist\.md/);
  assert.doesNotMatch(loaded.resources[0].content, /Never require the user to switch modes/);
  assert.doesNotMatch(loaded.resources[0].content, /Investigation lifecycle|Retrieval Engine|Agent Session summarization|Artifact Registry/);
  assert.equal(fs.existsSync(path.join(skillRoot, "orchestrator.js")), false);
  assert.equal(fs.existsSync(path.join(skillRoot, "state-store.js")), false);
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
