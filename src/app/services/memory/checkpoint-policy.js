"use strict";

// Switches for the parts of checkpoint summarization that change behavior.
// Redaction, recency, attempts and directive capture are corrections and are not
// switchable: turning redaction off would keep the leak it closes.
//
//   trustTiers  fields that steer the next action are grounded only in operator
//               words and runtime state (off restores the single shared corpus)
//   requestV2   the summarizer gets one projected copy of the ledger and returns
//               only a delta, instead of the older full-checkpoint request
//
// XEKUTE_CHECKPOINT_POLICY is a JSON object of booleans. XEKUTE_CHECKPOINT_LEGACY=1
// turns both new behaviors off.

const DEFAULT_CHECKPOINT_POLICY = Object.freeze({ trustTiers: true, requestV2: false });

function resolveCheckpointPolicy(env = process.env, overrides = null) {
  const policy = { ...DEFAULT_CHECKPOINT_POLICY };
  const apply = (source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    for (const key of Object.keys(DEFAULT_CHECKPOINT_POLICY)) if (typeof source[key] === "boolean") policy[key] = source[key];
  };
  try { apply(JSON.parse(String(env?.XEKUTE_CHECKPOINT_POLICY || "null"))); } catch { /* an unreadable override is ignored */ }
  apply(overrides);
  if (String(env?.XEKUTE_CHECKPOINT_LEGACY || "") === "1") { policy.trustTiers = false; policy.requestV2 = false; }
  return Object.freeze(policy);
}

module.exports = { DEFAULT_CHECKPOINT_POLICY, resolveCheckpointPolicy };
