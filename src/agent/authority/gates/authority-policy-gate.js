"use strict";

const { decision } = require("../../../contracts/tool/gate-adapter.js");
const { allow, gate, restrict } = require("./gate-utils.js");

function createAuthorityPolicyGate() {
  return gate("authority_policy_gate", ({ state, profile, entry, runtime }) => {
    const mode = profile?.approvalMode || "conditional";
    const softScope = state.scopeDecision === "soft_violation";
    const allowRulesConfigured = Array.isArray((runtime?.authorityRules || {}).allow) && runtime.authorityRules.allow.length > 0;
    const unlisted = (allowRulesConfigured || state.allowList?.required) && !state.allowList?.matched;
    if (mode === "disabled") {
      if (softScope && profile?.policy?.softScope !== "allow") {
        return restrict("authority_policy_gate", "Full Authorization cannot interactively approve a soft scope exception; execution is restricted.", [{ type: "scope", action: "revise_scope_or_use_in_scope_target" }], { code: "SOFT_SCOPE_RESTRICTED", profile: profile.id });
      }
      return allow("authority_policy_gate", "Interactive approval is disabled; all non-approval controls remain active.", { risk: state.risk, unlisted });
    }
    const requireApproval = mode === "always"
      || (softScope && profile?.policy?.softScope === "require_approval")
      || (unlisted && profile?.policy?.unlisted === "require_approval")
      || state.risk?.level === "high"
      || (entry?.metadata?.reversible === false && profile?.policy?.irreversible === "require_approval");
    if (!requireApproval) return allow("authority_policy_gate", "Profile permits automatic continuation.");
    return decision("authority_policy_gate", {
      decision: "require_approval",
      terminal: false,
      reason: mode === "always" ? "The selected profile requires operator approval." : "Scope, allow-list, reversibility, or risk policy requires operator approval.",
      metadata: { risk: state.risk, profile: profile.id, softScope, unlisted, irreversible: entry?.metadata?.reversible === false },
    });
  });
}

module.exports = { createAuthorityPolicyGate };
