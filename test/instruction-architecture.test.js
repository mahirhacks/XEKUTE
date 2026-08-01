const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("model instructions have one human-readable source layer", () => {
  const compiler = read("src/agent/instructions/prompt-compiler.js");
  const systemPrompt = read("src/prompts/instructs/system_prompt.js");
  assert.match(compiler, /require\("\.\.\/\.\.\/prompts\/instructs\/system_prompt"\)/);
  assert.doesNotMatch(compiler, /You are XEKUTE/);
  assert.match(systemPrompt, /You are XEKUTE/);
  assert.match(systemPrompt, /Runtime policy is authoritative/);
});

test("skills, rules, and guardrails are consumed by runtime orchestration", () => {
  assert.match(read("src/agent/runtime.js"), /require\("\.\.\/prompts\/skills\/agentic-loop"\)/);
  assert.match(read("src/agent/policy/policy-engine.js"), /require\("\.\.\/\.\.\/prompts\/rules\/runtime-policy-rules"\)/);
  assert.match(read("src/agent/policy/operating-modes.js"), /require\("\.\.\/\.\.\/prompts\/rules\/operating-mode-rules"\)/);
  assert.match(read("src/agent/controller.js"), /require\("\.\.\/prompts\/guardrail\/command-guardrails"\)/);
  assert.match(read("src/agent/memory/action-log.js"), /require\("\.\.\/\.\.\/prompts\/guardrail\/data-guardrails"\)/);
  assert.match(read("src/agent/controller.js"), /require\("\.\.\/prompts\/skills\/context-router"\)/);
});

test("browser prompt sources load before their compatibility consumers", () => {
  const html = read("src/ui/index.html");
  assert.match(html, /prompts\/instructs\/system_prompt\.js[\s\S]+agent\/instructions\/prompt-compiler\.js/);
  assert.match(html, /prompts\/instructs\/initial_prompt\.js[\s\S]+agent\/memory\/context-memory\.js/);
});
