"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HIDDEN_COMMAND_REVEAL_MS, createHiddenCommandReveal } = require("../src/app/services/terminal/agent-terminal-reveal.js");

test("visible commands reveal immediately without buffering", () => {
  const revealed = [];
  const reveal = createHiddenCommandReveal({ delayMs: 50 });
  reveal.start({ wantVisible: true, onReveal: (payload) => revealed.push(payload) });
  assert.equal(reveal.isRevealed(), true);
  assert.equal(revealed.length, 1);
  assert.deepEqual(revealed[0].replay, []);
  assert.equal(reveal.pushOutput("hello").live, true);
  assert.equal(reveal.complete().revealed, true);
});

test("hidden commands that finish before the delay never open a terminal", async () => {
  const revealed = [];
  const reveal = createHiddenCommandReveal({ delayMs: 40 });
  reveal.start({ wantVisible: false, onReveal: (payload) => revealed.push(payload) });
  assert.equal(reveal.pushOutput("early").live, false);
  assert.equal(reveal.complete().revealed, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(revealed.length, 0);
  assert.equal(reveal.isRevealed(), false);
});

test("hidden commands that outlive the delay replay buffered output then stream live", async () => {
  const revealed = [];
  const reveal = createHiddenCommandReveal({ delayMs: 30 });
  reveal.start({ wantVisible: false, onReveal: (payload) => revealed.push(payload) });
  reveal.pushOutput("one");
  reveal.pushOutput("two");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(reveal.isRevealed(), true);
  assert.deepEqual(revealed[0].replay, ["one", "two"]);
  assert.equal(reveal.pushOutput("three").live, true);
  assert.equal(reveal.complete().revealed, true);
});

test("host display delay is 1.5 seconds", () => {
  assert.equal(HIDDEN_COMMAND_REVEAL_MS, 1500);
});
