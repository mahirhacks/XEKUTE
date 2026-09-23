"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PromptCompiler = require("../src/agent/runtime/prompt-compiler.js");
const SystemPrompt = require("../src/prompts/instructions/system-prompt.js");

test("direct prompt modules compile deterministically without generated hashes", () => {
  const first = PromptCompiler.compile({ mode: "agent" });
  assert.equal(first, PromptCompiler.compile({ mode: "agent" }));
  assert.equal(SystemPrompt.VERSION, 2);
  assert.deepEqual(SystemPrompt.MODULE_ORDER, ["role", "evidence", "loop", "failure", "feedback", "guardrails"]);
  assert.match(first, /You are XEKUTE/);
  assert.match(first, /Runtime scope checks are enforced/i);
  assert.match(first, /end_turn with status stop/);
  assert.match(first, /Write a clear answer to the user's question, then call end_turn/);
  assert.doesNotMatch(first, /end_turn message|put a clear answer to the user's question in message/i);
  assert.doesNotMatch(first, /summariz|writeup|paraphrase/i);
  assert.doesNotMatch(first, /AUTO-GENERATED|content-addressed|prompt_builder|approval token/i);
  assert.equal(PromptCompiler.validate(PromptCompiler.defaults()).ok, true);
});

test("prompt assembly keeps mode and specialist context selectable", () => {
  const ask = PromptCompiler.compile({ mode: "ask" });
  const agent = PromptCompiler.compile({ mode: "agent" });
  const leftoverPlan = PromptCompiler.compile({ mode: "plan" });
  const leftoverHypothesis = PromptCompiler.compile({ mode: "hypothesis" });
  assert.match(ask, /PROFILE — Ask/);
  assert.match(agent, /PROFILE — Agent/);
  assert.equal(leftoverPlan, ask);
  assert.equal(leftoverHypothesis, ask);
  assert.notEqual(ask, agent);
  assert.doesNotMatch(ask, /PROFILE — Plan|PROFILE — Hypothesis/);
  assert.ok(PromptCompiler.checksum(PromptCompiler.defaults()).length >= 8);
});
