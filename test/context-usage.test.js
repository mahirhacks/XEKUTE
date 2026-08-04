"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("context meter uses routed previews and Ollama's measured last prompt", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "bootstrap.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "application", "agent", "controller.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "index.html"), "utf8");

  assert.match(renderer, /hotToolNamesForProfile|buildToolCatalog/);
  assert.match(renderer, /storeLastContextUsage\(payload\.usage\)/);
  assert.match(renderer, /prompt_eval_count and eval_count/);
  assert.match(controller, /result\?\.usage\?\.promptTokens/);
  assert.match(controller, /type: "context_usage"/);
  assert.match(controller, /two-layer catalog|load_tool_schemas|hot schema/i);
  assert.match(renderer, /const CONTEXT_OPTIONS = \[AUTO_CONTEXT, "128K", "256K", "1M"\]/);
  assert.ok(html.includes('src="../../prompts/skills/context-router.js"'));
  assert.ok(html.includes('id="context-usage-measure-note"'));
  assert.ok(html.includes('id="context-usage-breakdown"'));
  assert.doesNotMatch(html, /id="context-usage-model"/);
  assert.doesNotMatch(html, /id="context-memory-note"/);
  assert.doesNotMatch(html, /class="model-edit-description"/);
});
