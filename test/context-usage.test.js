"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("context meter uses routed previews and Ollama's measured last prompt", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const runtimeModules = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "core", "runtime-modules.js"), "utf8");

  assert.match(renderer, /selectedCatalog|toolsForProfile|availableTools/i);
  assert.match(renderer, /storeLastContextUsage\(payload\.usage, \{ session: runSession, model: runModel, contextPlan: runContextPlan \}\)/);
  assert.match(renderer, /source: \["ollama", "openrouter"\]\.includes\(stored\?\.source\) \? "actual" : "estimate"/);
  assert.match(controller, /result\?\.usage\?\.promptTokens/);
  assert.match(controller, /type: "context_usage"/);
  assert.match(controller, /selectedCatalog|toolsForProfile|availableTools/i);
  assert.match(renderer, /const CONTEXT_OPTIONS = \[AUTO_CONTEXT, "128K", "256K", "1M"\]/);
  assert.ok(runtimeModules.includes('"../../prompts/skills/context-router.js"'));
  assert.ok(html.includes('id="context-usage-heading-value"'));
  assert.ok(html.includes('id="context-usage-breakdown"'));
  for (const section of ["System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "Summarized Conversation", "Active Conversation", "Current Workflow", "Working References"]) {
    assert.match(renderer, new RegExp(`label: "${section}"`));
  }
  assert.doesNotMatch(renderer, /recent_tail|label: "Project"|label: "Investigation"|label: "Evidence"/);
  assert.doesNotMatch(html, /id="context-memory-open"/);
  assert.doesNotMatch(html, /context-usage-measure-note|context-usage-diagnostics/);
  assert.doesNotMatch(html, /id="context-usage-model"/);
  assert.doesNotMatch(html, /id="context-memory-note"/);
  assert.doesNotMatch(html, /class="model-edit-description"/);
});

test("context checkpointing is automatic and renderer-owned compaction is absent", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");

  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");
  const projectIpc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "ipc", "project.js"), "utf8");
  assert.doesNotMatch(renderer, /maybeCompactContext|v3_checkpoint_owned/);
  assert.doesNotMatch(renderer, /window\.api\.(?:compactContext|summarizeContext|consolidateContext)\(/);
  assert.doesNotMatch(renderer, /recent_tail/);
  assert.doesNotMatch(preload, /(?:compactContext|summarizeContext|consolidateContext|recordContextEvent|operationalContext)/);
  assert.doesNotMatch(projectIpc, /ipcMain\.(?:handle|on)\("context:/);
  assert.doesNotMatch(main, /(?:context:compact|CONTEXT_SUMMARY_PROVIDER_TIMEOUT|CONTEXT_COMPACTION_TIMEOUT|CapsuleReducer|summarizeOpenRouterContext)/);
  assert.match(renderer, /Context checkpointing…/);
  assert.doesNotMatch(html, /id="context-usage-compact"|id="context-compaction-status"/);
});
