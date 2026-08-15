"use strict";

const { allow, gate } = require("./gate-utils.js");

function verifyLifecycle(rawResult, context = {}) {
  const stopped = rawResult?.status === "stopped" || rawResult?.aborted;
  const partial = rawResult?.status === "partial" || rawResult?.value?.outputCompleteness === "partial";
  const failed = rawResult?.ok === false || Boolean(rawResult?.error);
  const status = stopped || partial ? "partial" : failed ? "failed" : rawResult?.ok === true ? "verified" : "inconclusive";
  return {
    status,
    evidence: rawResult?.evidenceIds || rawResult?.value?.evidenceIds || [],
    reason: status === "verified" ? "The capability completed successfully." : status === "failed" ? "The capability reported failure." : status === "partial" ? "The capability stopped with partial state." : "The capability outcome could not be verified deterministically.",
    objective: String(context.declaredObjective || ""),
  };
}

function createVerificationModule() {
  return gate("verification_module", ({ context, state }) => {
    state.verification = verifyLifecycle(state.controlledResult || state.rawResult, context);
    return allow("verification_module", `Lifecycle verification is ${state.verification.status}.`, { verification: state.verification });
  });
}

module.exports = { createVerificationModule, verifyLifecycle };
