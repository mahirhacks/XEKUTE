"use strict";

const { allow, gate } = require("./gate-utils.js");

function selectRecovery({ state, context }) {
  const verification = state.verification?.status || "inconclusive";
  const code = String(state.rawResult?.code || state.rawResult?.error?.code || state.rawResult?.errorCode || "");
  const count = Number(context?.failureCount || 0);
  if (verification === "verified") return { status: "none", action: null, reason: "No recovery is required.", sourceOutcome: "success", nextInvocationId: "", restrictions: [], selectedAt: "" };
  let action = "retry";
  if (/SCOPE|DENIED|APPROVAL/.test(code)) action = "escalate";
  else if (count >= 2) action = "replan";
  else if (verification === "partial") action = "modify_arguments";
  else if (verification === "inconclusive") action = "switch_tool";
  return { status: "recovery_selected", action, reason: `Recovery selected after ${verification} lifecycle verification.`, sourceOutcome: verification === "failed" ? "failure" : verification, nextInvocationId: "", restrictions: state.restrictions || [], selectedAt: new Date().toISOString() };
}

function createRecoveryModule() {
  return gate("recovery_module", ({ context, state }) => {
    state.recovery = selectRecovery({ context, state });
    return allow("recovery_module", state.recovery.reason, { recovery: state.recovery });
  });
}

module.exports = { createRecoveryModule, selectRecovery };
