"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8").replace(/\r\n/g, "\n");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}

async function setup() {
  const { thinkingElapsedMs } = await import("../src/ui/features/chat/chat-transcript.js");
  const dom = new JSDOM('<div class="agent-thinking-fold" data-expanded="true"><button class="agent-thinking-toggle" aria-expanded="true"><span class="agent-thinking-text">Thinking</span></button><div class="agent-thinking-content streaming">Reasoning</div></div>');
  const context = vm.createContext({ thinkingElapsedMs, Date });
  for (const name of ["setCollapsibleFoldExpanded", "toggleCollapsibleFold", "thinkingContentOf", "thinkingFoldLabel", "setThinkingFoldLabel", "finishThinkingFold", "formatAgentWorkDuration"]) {
    vm.runInContext(functionSource(name), context);
  }
  const fold = dom.window.document.querySelector(".agent-thinking-fold");
  fold.dataset.startedAt = String(Date.now() - 2000);
  return { context, fold };
}

test("a reasoning fold closed by the reader stays closed when another token arrives", async () => {
  const { context, fold } = await setup();
  context.toggleCollapsibleFold(fold);
  context.setCollapsibleFoldExpanded(fold, true);
  assert.equal(fold.dataset.expanded, "false");
  assert.equal(fold.querySelector("button").getAttribute("aria-expanded"), "false");
});

test("a reasoning fold opened by the reader stays open after thinking finishes", async () => {
  const { context, fold } = await setup();
  context.setCollapsibleFoldExpanded(fold, false);
  context.toggleCollapsibleFold(fold);
  context.finishThinkingFold(fold);
  assert.equal(fold.dataset.expanded, "true");
  assert.equal(fold.dataset.final, "true");
  assert.equal(fold.querySelector(".agent-thinking-text").textContent, "Thought briefly");
  assert.equal(fold.querySelector(".agent-thinking-content").classList.contains("streaming"), false);
});

test("untouched reasoning folds still collapse on completion", async () => {
  const { context, fold } = await setup();
  context.finishThinkingFold(fold);
  assert.equal(fold.dataset.expanded, "false");
});
