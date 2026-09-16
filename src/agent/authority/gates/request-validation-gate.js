"use strict";

const { evaluateMutationSafety } = require("../scope/command-intent.js");
const { allow, deny, gate, targetValues, validateValue } = require("./gate-utils.js");

function createRequestValidationGate() {
  return gate("request_validation_gate", ({ context, entry, args, state, toolName }) => {
    if (!entry) return deny("request_validation_gate", "The requested tool is not registered.", { code: "UNKNOWN_TOOL" });
    const errors = validateValue(args, entry.inputSchema);
    if (errors.length) return deny("request_validation_gate", errors[0], { code: "INVALID_TOOL_INPUT", errors: errors.slice(0, 20) });
    const mutation = evaluateMutationSafety(toolName || entry.name, args);
    if (!mutation.ok) {
      return deny("request_validation_gate", mutation.reason, { code: mutation.code, remediation: mutation.remediation });
    }
    try { state.normalizedArguments = args && typeof args === "object" ? structuredClone(args) : {}; }
    catch { return deny("request_validation_gate", "Tool input must contain only structured cloneable values.", { code: "INVALID_TOOL_INPUT" }); }
    state.normalizedTargets = targetValues(state.normalizedArguments, entry.metadata || {}, context?.workspace?.root || "");
    return allow("request_validation_gate", "Tool input is valid and targets were normalized.", { targets: state.normalizedTargets });
  });
}

module.exports = { createRequestValidationGate };
