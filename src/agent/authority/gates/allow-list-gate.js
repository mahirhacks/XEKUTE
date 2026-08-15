"use strict";

const { decision } = require("../../../contracts/tool/gate-adapter.js");
const { allow, gate, restrict } = require("./gate-utils.js");
const { findMatchingRule } = require("./rule-matcher.js");

function createAllowListGate() {
  return gate("allow_list_gate", ({ context, toolName, args, state, runtime }) => {
    const authorityRules = runtime?.authorityRules || context?.authorityRules || {};
    const rules = Array.isArray(authorityRules.allow) ? authorityRules.allow : [];
    const result = findMatchingRule(rules, { toolName, args, targets: state.normalizedTargets });
    state.allowList = { matched: result.matched, ruleId: result.rule?.id || "", required: Boolean(authorityRules.requireAllowMatch) };
    if (result.matched && Array.isArray(result.rule?.restrictions) && result.rule.restrictions.length) {
      return restrict("allow_list_gate", "Invocation matches an allow rule with restrictions.", result.rule.restrictions, { matched: true, ruleId: result.rule.id, matchReasons: result.reasons }, false);
    }
    if (result.matched) return allow("allow_list_gate", "Invocation matches an explicit operator allow rule.", { matched: true, ruleId: result.rule.id, matchReasons: result.reasons });
    if (authorityRules.requireAllowMatch) {
      return decision("allow_list_gate", { decision: "defer", terminal: false, reason: "No explicit allow rule matched this invocation.", policyReference: "allow-list-required", metadata: { code: "ALLOW_RULE_REQUIRED", matched: false } });
    }
    return allow("allow_list_gate", "No explicit allow rule is required.", { matched: false });
  });
}

module.exports = { createAllowListGate };
