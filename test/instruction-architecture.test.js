const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("model instructions have one human-readable source layer", () => {
  const compiler = read("src/application/prompt/prompt-compiler.js");
  const systemPrompt = read("src/content/build/manifest.json");
  assert.match(compiler, /prompt-source/);
  assert.match(compiler, /getSystemPrompt/);
  assert.doesNotMatch(compiler, /You are XEKUTE/);
  assert.ok(JSON.parse(systemPrompt).modules.some((entry) => entry.logicalName === "system_prompt"));
  const generated = read("src/content/build/" + JSON.parse(systemPrompt).modules.find((entry) => entry.logicalName === "system_prompt").file);
  assert.match(generated, /You are XEKUTE/);
  assert.match(generated, /Runtime policy is authoritative/);
});

test("skills, rules, and guardrails are consumed by runtime orchestration", () => {
  assert.match(read("src/application/agent/runtime.js"), /require\("\.\.\/policies\/agentic-loop"\)/);
  assert.match(read("src/application/policies/policy-engine.js"), /require\("\.\/runtime-policy-rules"\)/);
  assert.match(read("src/application/policies/operating-modes.js"), /require\("\.\/operating-mode-rules"\)/);
  assert.match(read("src/application/agent/controller.js"), /require\("\.\.\/policies\/command-guardrails"\)/);
  assert.match(read("src/application/agent/controller.js"), /require\("\.\.\/\.\.\/prompts\/skills\/mode-skills"\)/);
  assert.match(read("src/application/agent/controller.js"), /require\("\.\.\/\.\.\/prompts\/skills\/vapt-skill-library"\)/);
  assert.match(read("src/application/agent/memory/action-log.js"), /require\("\.\.\/\.\.\/policies\/data-guardrails"\)/);
  assert.match(read("src/application/agent/controller.js"), /require\("\.\.\/\.\.\/prompts\/skills\/context-router"\)/);
});

test("browser prompt sources load before their compatibility consumers", () => {
  const html = read("src/presentation/ui/index.html");
  assert.match(html, /prompts\/instructs\/system_prompt\.js[\s\S]+application\/prompt\/prompt-compiler\.js/);
  assert.match(html, /prompts\/instructs\/initial_prompt\.js[\s\S]+agent\/memory\/context-memory\.js/);
});
