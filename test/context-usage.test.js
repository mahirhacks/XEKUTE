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
  assert.ok(html.includes('id="context-usage-compact"'));
  for (const section of ["System prompt", "Tool definitions", "Project", "Investigation", "Evidence", "Conversation", "Rules", "Skills"]) {
    assert.match(renderer, new RegExp(`label: "${section}"`));
  }
  assert.match(renderer, /active_workflow:\s*"conversation"/);
  assert.match(renderer, /recent_working_set:\s*"conversation"/);
  assert.doesNotMatch(html, /id="context-memory-open"/);
  assert.doesNotMatch(html, /context-usage-measure-note|context-usage-diagnostics/);
  assert.doesNotMatch(html, /id="context-usage-model"/);
  assert.doesNotMatch(html, /id="context-memory-note"/);
  assert.doesNotMatch(html, /class="model-edit-description"/);
});

test("context compaction keeps trusted validation and supports ordinary conversation fallback", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");

  assert.match(renderer, /CONTEXT_SUMMARY_RENDERER_TIMEOUT_MS\s*=\s*35_000/);
  assert.match(renderer, /window\.api\.compactContext\(/);
  assert.match(renderer, /\["NO_TRUSTED_RECORDS", "CAPSULE_SNAPSHOT_FAILED"\]\.includes\(compacted\?\.code\)/);
  assert.match(renderer, /compactTranscriptFallback/);
  assert.match(renderer, /ContextMemory\?\.projectDurableMessages\?\.\(newMessagesToSummarize\)/);
  assert.match(renderer, /compactContextManually/);
  assert.match(renderer, /maybeCompactContext\(getContextUsage\(\), \{ force: true \}\)/);
  assert.match(renderer, /throughMessageId:\s*split\.oldMessages\.at\(-1\)\?\.id/);
  assert.match(renderer, /transcript:\s*summaryTranscript/);
  assert.match(renderer, /messages:\s*durableMessages/);
  assert.match(renderer, /Compression changes model-visible memory only/);
  assert.doesNotMatch(renderer, /body\.dataset\.loaded\s*=\s*"false"/);
  assert.match(renderer, /CONTEXT_POST_COMPRESSION_TARGET\s*=\s*0\.22/);
  assert.match(renderer, /CONTEXT_POST_COMPRESSION_URGENT_TARGET\s*=\s*0\.16/);
  assert.match(renderer, /Math\.floor\(promptBudget \* targetRatio\) - fixedTokens - summaryReserveTokens/);
  assert.match(renderer, /ContextMemory\.projectRecentContextMessages\(messages\)/);
  assert.match(renderer, /ContextMemory\.projectRecentContextMessages\(recent\)/);
  assert.match(renderer, /finally\s*\{[\s\S]*setContextCompactionUi\(false\)/);
  assert.match(main, /CONTEXT_SUMMARY_PROVIDER_TIMEOUT_MS\s*=\s*30_000/);
  assert.match(main, /timeoutMs:\s*CONTEXT_SUMMARY_PROVIDER_TIMEOUT_MS/);
  assert.match(main, /maxCompletionTokens:\s*Math\.max\(420, Math\.ceil\(maxChars \/ 3\)\)/);
  assert.match(main, /responseFormat:\s*null/);
  assert.match(main, /controller\.abort\("CONTEXT_SUMMARY_TIMEOUT"\)/);
  assert.match(main, /CONTEXT_COMPACTION_TIMEOUT_MS\s*=\s*180_000/);
  assert.match(main, /ipcMain\.handle\("context:compact"/);
  assert.match(main, /CapsuleReducer\.renderCanonicalMarkdown/);
  assert.match(main, /CapsuleReducer\.defaultSynthesisPlan\(reduced\)/);
  assert.doesNotMatch(html, /id="context-compaction-status"|Context compressed using bounded/);
});
