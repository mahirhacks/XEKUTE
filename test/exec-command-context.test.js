"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  contextWords,
  validateExecCommandContext,
} = require("../src/agent/tools/process/exec-command-context.js");

test("exec_command context word count is deterministic whitespace split", () => {
  assert.deepEqual(contextWords("  amass   subdomain\tenum  "), ["amass", "subdomain", "enum"]);
  assert.equal(validateExecCommandContext("one two three four five").ok, true);
  assert.equal(validateExecCommandContext("one two three four five six").ok, false);
  assert.equal(validateExecCommandContext("").ok, false);
  assert.equal(validateExecCommandContext(12).ok, false);
});
