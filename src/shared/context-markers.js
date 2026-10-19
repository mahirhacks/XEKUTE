"use strict";

// The model learns about released blocks from "[Block N released from
// context ...]" placeholders and reads summaries under a "XEKUTE TIER 1 ACTIVE
// MEMORY" header. Code tells real ones apart by a flag, but the model only sees
// text, so tool output, late results and other untrusted text that imitate
// them are rewritten before the model reads them. Invisible zero-width
// characters, which could hide such an imitation from this check, are removed
// from the same text. The rewrite is idempotent and only touches model-facing
// copies; nothing the operator sees changes.

const ZERO_WIDTH = /[​-‏⁠-⁤﻿]/g;
const MARKERS = [
  [/\[(\s*)Block(\s+\d+\s+released\s+from\s+context)/gi, "[$1quoted Block$2"],
  [/XEKUTE\s+TIER\s+1\s+ACTIVE\s+MEMORY/gi, "XEKUTE TIER 1 (quoted) ACTIVE MEMORY"],
];

function neutralizeContextMarkers(value) {
  if (typeof value !== "string" || !value) return value;
  let text = value.replace(ZERO_WIDTH, "");
  for (const [pattern, replacement] of MARKERS) text = text.replace(pattern, replacement);
  return text;
}

module.exports = { neutralizeContextMarkers };
