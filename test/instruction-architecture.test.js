"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the system prompt has exactly one readable source", () => {
  const system = read("src/prompts/instructions/system-prompt.js");
  const compiler = read("src/agent/runtime/prompt-compiler.js");
  assert.match(system, /You are XEKUTE/);
  assert.match(compiler, /system-prompt/);
  assert.doesNotMatch(compiler, /content-loader|prompt_builder|prompt-source|generated hash/i);
  const promptFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/system[-_]prompt/i.test(entry.name)) promptFiles.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
    }
  }
  visit(path.join(root, "src", "prompts"));
  assert.deepEqual(promptFiles, ["src/prompts/instructions/system-prompt.js"]);
});

test("skills are model guidance, not runtime gates", () => {
  const controller = read("src/agent/controller/agent-controller.js");
  const compiler = read("src/agent/runtime/prompt-compiler.js");
  const skills = read("src/prompts/skills/mode-skills.js");
  const system = read("src/prompts/instructions/system-prompt.js");
  const redaction = read("src/shared/secret-redaction.js");
  assert.match(controller, /context-router/);
  assert.match(skills, /render|MODE_SKILL/);
  assert.match(system, /MODEL GUIDANCE/);
  assert.match(redaction, /redactStructuredValue|secret/i);
  assert.match(compiler, /MODE_OVERLAYS|guardrails/i);
  assert.doesNotMatch(controller, /evaluateAction|requestApproval|approval_required|GATES_DISABLED/);
});

test("agent skill teaches run waits for exit and status as secondary", () => {
  const agentSkill = read("src/prompts/skills/modes/agent-skill.js");
  assert.match(agentSkill, /waits until the command exits/);
  assert.match(agentSkill, /one at a time/);
  assert.match(agentSkill, /wait_ms:\s*0/);
  assert.match(agentSkill, /timeout_ms/);
  assert.match(agentSkill, /terminal_complete/);
  assert.match(agentSkill, /secondary/);
  assert.doesNotMatch(agentSkill, /default 1500/);
  assert.doesNotMatch(agentSkill, /operation=status[\s\S]{0,120}wait mechanism/i);
});
