"use strict";

const { assertToolAdapter } = require("../../../contracts/tool/tool-adapter.js");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const END_TURN_TOOL_NAME = "end_turn";
const END_TURN_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "End this agent turn. Pass status stop after answering. A reply without this call does not finish the run.",
  properties: {
    status: {
      type: "string",
      enum: ["stop"],
      description: "Pass stop to finish the turn.",
    },
  },
  required: ["status"],
  additionalProperties: false,
});

function isEndTurnStop(tool = {}) {
  const name = String(tool.toolName || tool.action || tool.function?.name || "").trim();
  const status = String(tool.args?.status || tool.function?.arguments?.status || "").trim().toLowerCase();
  return name === END_TURN_TOOL_NAME && status === "stop";
}

function executeEndTurn(input = {}) {
  const status = String(input.status || "").trim().toLowerCase();
  if (status !== "stop") {
    return {
      ok: false,
      error: "end_turn requires status stop.",
      errorCode: "INVALID_END_TURN_STATUS",
      retryable: false,
    };
  }
  return {
    ok: true,
    endTurn: true,
    value: {
      status: "stop",
    },
  };
}

function createEndTurnTool() {
  return assertToolAdapter({
    name: END_TURN_TOOL_NAME,
    description: END_TURN_INPUT_SCHEMA.description,
    inputSchema: END_TURN_INPUT_SCHEMA,
    async execute(input, executionContext) {
      if (!isRestrictedToolContext(executionContext)) {
        return { ok: false, error: { code: "INVALID_EXECUTION_CONTEXT", message: "end_turn requires a restricted execution context projection", retryable: false } };
      }
      return executeEndTurn(input);
    },
  });
}

module.exports = {
  END_TURN_TOOL_NAME,
  END_TURN_INPUT_SCHEMA,
  isEndTurnStop,
  executeEndTurn,
  createEndTurnTool,
};
