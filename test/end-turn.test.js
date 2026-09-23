"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  END_TURN_INPUT_SCHEMA,
  executeEndTurn,
  isEndTurnStop,
} = require("../src/agent/tools/process/end-turn.js");

test("end_turn accepts status stop only and ignores extra text fields", () => {
  assert.deepEqual(END_TURN_INPUT_SCHEMA.properties.status.enum, ["stop"]);
  assert.equal(END_TURN_INPUT_SCHEMA.properties.message, undefined);
  assert.equal(END_TURN_INPUT_SCHEMA.properties.summary, undefined);
  assert.deepEqual(END_TURN_INPUT_SCHEMA.required, ["status"]);
  assert.equal(END_TURN_INPUT_SCHEMA.additionalProperties, false);

  const result = executeEndTurn({ status: "stop", summary: "should be ignored", message: "should be ignored" });
  assert.equal(result.ok, true);
  assert.equal(result.endTurn, true);
  assert.deepEqual(result.value, { status: "stop" });
  assert.equal(result.value.summary, undefined);
  assert.equal(result.value.message, undefined);
});

test("end_turn rejects any status other than stop", () => {
  const result = executeEndTurn({ status: "complete" });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "INVALID_END_TURN_STATUS");
  assert.equal(isEndTurnStop({ toolName: "end_turn", args: { status: "complete" } }), false);
  assert.equal(isEndTurnStop({ toolName: "end_turn", args: { status: "stop" } }), true);
});
