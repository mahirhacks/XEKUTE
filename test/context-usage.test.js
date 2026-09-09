"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("context meter uses the nine Tier 1 sections and current usage snapshots", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "react", "AppShell.jsx"), "utf8");
  const runtimeModules = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "core", "runtime-modules.js"), "utf8");

  assert.match(renderer, /selectedCatalog|toolsForProfile|availableTools/i);
  assert.match(renderer, /storeLastContextUsage\(payload\.usage, \{ session: runSession, model: runModel, contextPlan: runContextPlan \}\)/);
  assert.match(renderer, /source: "estimate"/);
  assert.match(renderer, /Tier 1 estimate/);
  assert.doesNotMatch(renderer, /Measured · \$\{provider === "openrouter"/);
  assert.match(controller, /result\?\.usage\?\.promptTokens/);
  assert.match(controller, /type: "context_usage"/);
  assert.match(controller, /selectedCatalog|toolsForProfile|availableTools/i);
  assert.match(renderer, /const CONTEXT_OPTIONS = \[AUTO_CONTEXT, "128K", "256K", "1M"\]/);
  assert.ok(runtimeModules.includes('"../../prompts/skills/context-router.js"'));
  assert.ok(html.includes('id="context-usage-heading-value"'));
  assert.ok(html.includes('id="context-usage-breakdown"'));
  for (const section of ["System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP", "Summarized Conversation", "Active Conversation", "Current Workflow"]) {
    assert.match(renderer, new RegExp(`label: "${section}"`));
  }
  assert.doesNotMatch(renderer, /label: "Working References"/);
  assert.match(controller, /tier1UsageSections\(tier1Assembly\)/);
  assert.match(controller, /method: "tier1-approximate"/);
  assert.match(renderer, /authoritative: storedIsTier1/);
  assert.doesNotMatch(renderer, /liveDeltaTokens|streamDeltaTokens|draftDeltaTokens/);
  assert.doesNotMatch(renderer, /runSession\.lastContextUsage = null/);
  assert.match(renderer, /lastContextUsage: session\.lastContextUsage/);
  assert.doesNotMatch(renderer, /function onChatInputChange\(\) \{[\s\S]{0,180}updateContextUsage\(\)/);
  assert.doesNotMatch(renderer, /recent_tail|label: "Project"|label: "Investigation"|label: "Evidence"/);
  assert.doesNotMatch(html, /id="context-memory-open"/);
  assert.doesNotMatch(html, /context-usage-measure-note|context-usage-diagnostics/);
  assert.doesNotMatch(html, /id="context-usage-model"/);
  assert.doesNotMatch(html, /id="context-memory-note"/);
  assert.doesNotMatch(html, /class="model-edit-description"/);
});

test("the meter reads Tier 1 for an idle chat instead of waiting for the first send", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");

  assert.match(preload, /contextTier1Usage:[\s\S]{0,80}"context:tier1Usage"/);
  assert.match(main, /ipcMain\.handle\("context:tier1Usage"/);
  assert.match(main, /previewOnly: true/);
  assert.match(controller, /if \(previewOnly\) \{/);
  assert.match(controller, /previewTier1Usage/);
  assert.match(renderer, /function updateContextUsage\(\) \{[\s\S]{0,160}scheduleTier1ContextPreview\(\)/);
  assert.match(renderer, /window\.api\.contextTier1Usage\(\{/);
  // A preview must never claim the meter while a run owns it, and must not
  // measure anything the operator has only typed.
  assert.match(renderer, /if \(isChatSessionRunning\(session\.id\)\) return;/);
  const previewPayload = renderer.match(/window\.api\.contextTier1Usage\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || "";
  assert.ok(previewPayload);
  assert.doesNotMatch(previewPayload, /userMessage|chatInput|draft/);
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
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.match(renderer, /Chat context being summarized\.\.\./);
  assert.match(renderer, /Summarized Conversation Updated/);
  assert.match(renderer, /finishContextCheckpointNotice/);
  assert.match(renderer, /function checkpointNoticeHost/);
  assert.match(renderer, /function wrapAssistantInRunChunk/);
  assert.match(renderer, /function lastAgentRunChunk/);
  assert.match(renderer, /function ensureAgentResponseHost/);
  assert.match(renderer, /agent-response-host/);
  assert.match(renderer, /splitAtContextCheckpoint\(notice\)/);
  assert.match(renderer, /notice\.after\(nextChunk\)/);
  assert.match(renderer, /ensureContextCheckpointNotice\(container, \{ assistant: run\?\.assistant \}\)/);
  assert.match(renderer, /lastAgentRunChunk\(body\) \|\| body \|\| root/);
  assert.match(css, /#messages \.agent-run-chunk \{/);
  assert.match(renderer, /const notice = pendingContextCheckpointNotice\(container \|\| messages\);/);
  assert.doesNotMatch(renderer, /if \(affectsActiveChat\) ensureContextCheckpointNotice/);
  assert.match(renderer, /assets\/icons\/compress_icon\.svg/);
  assert.match(renderer, /context-checkpoint-icon/);
  const dialog = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "dialog", "app-dialog.js"), "utf8");
  assert.match(dialog, /assets\/icons\/Danger_icon\.svg/);
  assert.match(css, /#messages \.context-checkpoint-notice \{[\s\S]{0,220}font: 500 14px/);
  assert.match(renderer, /if \(state === "complete" \|\| state === "error"\) return;/);
  assert.match(renderer, /applyCheckpointToSession/);
  assert.match(renderer, /summarizedConversationTokens/);
  assert.match(renderer, /updateRunContextUsage\(\)/);
  assert.doesNotMatch(html, /id="context-usage-compact"|id="context-compaction-status"/);
});
