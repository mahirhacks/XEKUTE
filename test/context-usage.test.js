"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("context meter uses routed previews and Ollama's measured last prompt", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");

  assert.match(renderer, /ToolMap\.toolsForRoute\(modeTools\(\), route\)/);
  assert.match(renderer, /storeLastContextUsage\(payload\.usage\)/);
  assert.match(renderer, /prompt_eval_count and eval_count/);
  assert.match(controller, /result\?\.usage\?\.promptTokens/);
  assert.match(controller, /type: "context_usage"/);
  assert.ok(html.includes('src="../prompts/skills/context-router.js"'));
  assert.ok(html.includes('id="context-usage-measure-note"'));
});
