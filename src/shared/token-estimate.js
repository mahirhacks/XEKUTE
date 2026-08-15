"use strict";

// Small provider-neutral estimate used by contracts and prompt planning.
function estimateTokenCount(value) {
  const text = String(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

module.exports = { estimateTokenCount };
