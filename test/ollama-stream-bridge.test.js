"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "main.js"), "utf8");

test("agent round forwards the controller's live callbacks into the Ollama transport", () => {
  assert.match(mainSource, /runModelRound:\s*\(roundPayload\)\s*=>\s*runOllamaAgentRound\([\s\S]*?onThinking:\s*roundPayload\.onThinking,[\s\S]*?onToken:\s*roundPayload\.onToken,[\s\S]*?onToolCalls:\s*roundPayload\.onToolCalls/);
});

test("both Ollama chat paths use the shared lossless stream capture", () => {
  const calls = mainSource.match(/await captureOllamaStream\(res\.body/g) || [];
  assert.equal(calls.length, 2);
  assert.doesNotMatch(mainSource, /createReasoningRouter|legacyContentReasoning/);
});

test("agent transport can stop a text-only mutation stream early", () => {
  assert.match(mainSource, /const control = hooks\.onToken\?\.\(token\)/);
  assert.match(mainSource, /control\?\.abort[\s\S]*?controller\.abort\(control\.code/);
});
