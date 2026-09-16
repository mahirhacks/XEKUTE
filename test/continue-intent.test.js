"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ContinueIntent = require("../src/prompts/rules/continue-intent");

test("CONTINUE on its own last line is a hidden continue intent", () => {
  const parsed = ContinueIntent.parse("Found the route.\n\nCONTINUE");
  assert.equal(parsed.continue, true);
  assert.equal(parsed.text, "Found the route.");
  assert.equal(ContinueIntent.parse("Yes — I can help with that.").continue, false);
  assert.equal(ContinueIntent.parse("I will continue looking.").continue, false);
  assert.equal(ContinueIntent.parse("continue").continue, true);
  assert.equal(ContinueIntent.strip("Answer.\nCONTINUE."), "Answer.");
});

test("streaming strip hides a completed CONTINUE last line only", () => {
  assert.equal(ContinueIntent.strip("Answer\nCONTIN", { streaming: true }), "Answer\nCONTIN");
  assert.equal(ContinueIntent.strip("Answer\nCONTINUE", { streaming: true }), "Answer");
});
