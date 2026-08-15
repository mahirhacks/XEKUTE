"use strict";

const AgentRuntime = require("../runtime/agent-runtime.js");

function startTurn({ runId, profile, objective, model } = {}) {
  return AgentRuntime.createRunState({ runId, profile, objective, model });
}

function completeTurn(state, { status = "completed", reason = "", limitations = [] } = {}) {
  return AgentRuntime.finalize(state, { status, reason, limitations });
}

function advanceTurn(state, phase, options = {}) {
  return AgentRuntime.advancePhase(state, phase, options);
}

module.exports = { startTurn, completeTurn, advanceTurn };
