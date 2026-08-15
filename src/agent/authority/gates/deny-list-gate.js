"use strict";

const { allow, deny, gate } = require("./gate-utils.js");
const { findMatchingRule } = require("./rule-matcher.js");

function createDenyListGate() {
  return gate("deny_list_gate", ({ context, toolName, args, state, runtime }) => {
    const authorityRules = runtime?.authorityRules || context?.authorityRules || {};
    const rules = Array.isArray(authorityRules.deny) ? authorityRules.deny : [];
    const result = findMatchingRule(rules, { toolName, args, targets: state.normalizedTargets });
    state.denyList = { matched: result.matched, ruleId: result.rule?.id || "" };
    return result.matched
      ? deny("deny_list_gate", result.rule?.reason || "Invocation matches an explicit operator deny rule.", { code: "EXPLICIT_DENY_RULE", rule: result.rule.id, matchReasons: result.reasons }, "operator-deny-rule")
      : allow("deny_list_gate", "No explicit operator deny rule matched.");
  });
}

module.exports = { createDenyListGate };
