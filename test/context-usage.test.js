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
  assert.match(renderer, /prompt_eval_count and eval_count/);
  assert.match(controller, /result\?\.usage\?\.promptTokens/);
  assert.match(controller, /type: "context_usage"/);
  assert.match(controller, /selectedCatalog|toolsForProfile|availableTools/i);
  assert.match(renderer, /const CONTEXT_OPTIONS = \[AUTO_CONTEXT, "128K", "256K", "1M"\]/);
  assert.ok(runtimeModules.includes('"../../prompts/skills/context-router.js"'));
  assert.ok(html.includes('id="context-usage-measure-note"'));
  assert.ok(html.includes('id="context-usage-breakdown"'));
  assert.ok(html.includes('id="context-usage-compact"'));
  assert.doesNotMatch(html, /id="context-usage-model"/);
  assert.doesNotMatch(html, /id="context-memory-note"/);
  assert.doesNotMatch(html, /class="model-edit-description"/);
});

test("context summarization has provider and renderer deadlines", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

  assert.match(renderer, /CONTEXT_SUMMARY_RENDERER_TIMEOUT_MS\s*=\s*35_000/);
  assert.match(renderer, /awaitContextSummary\(window\.api\.summarizeContext/);
  assert.match(renderer, /compactContextManually/);
  assert.match(renderer, /maybeCompactContext\(getContextUsage\(\), \{ force: true \}\)/);
  assert.match(renderer, /transcript:\s*summaryTranscript/);
  assert.match(renderer, /messages:\s*durableMessages/);
  assert.doesNotMatch(renderer, /summarizeContext\(\{[\s\S]{0,500}messages:\s*newMessagesToSummarize/);
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
});
