"use strict";

const { redactStructuredValue } = require("../../../shared/secret-redaction.js");
const { allow, gate } = require("./gate-utils.js");

function boundValue(value, maxBytes = 2_000_000) {
  const redacted = redactStructuredValue(value);
  const encoded = JSON.stringify(redacted);
  if (Buffer.byteLength(encoded, "utf8") <= maxBytes) return { value: redacted, truncated: false, originalBytes: Buffer.byteLength(encoded, "utf8") };
  const preview = encoded.slice(0, Math.max(0, maxBytes - 128));
  return { value: { truncated: true, preview, note: "Output exceeded the configured release limit." }, truncated: true, originalBytes: Buffer.byteLength(encoded, "utf8") };
}

function createOutputControlGate() {
  return gate("output_control_gate", ({ state }) => {
    const bounded = boundValue(state.rawResult, Number(state.resourceLimits?.outputBytes) || 2_000_000);
    state.controlledResult = bounded.value;
    state.outputTransformation = { redacted: true, truncated: bounded.truncated, originalBytes: bounded.originalBytes };
    return allow("output_control_gate", "Tool output was bounded and sensitive values were redacted.", state.outputTransformation);
  });
}

module.exports = { boundValue, createOutputControlGate };
