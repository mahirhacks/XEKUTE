"use strict";

function endTurnCall(id = "end-turn-1") {
  return {
    id,
    type: "function",
    function: {
      name: "end_turn",
      arguments: { status: "stop" },
    },
  };
}

function endTurnRound(fullText = "done", extra = {}) {
  return {
    ok: true,
    error: null,
    aborted: false,
    fullText,
    toolCalls: [endTurnCall("end-turn-1")],
    finishReason: "stop",
    ...extra,
  };
}

module.exports = { endTurnCall, endTurnRound };
