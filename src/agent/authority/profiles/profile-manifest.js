"use strict";

const PROFILE_IDS = Object.freeze(["ask_for_approval", "approve_for_me", "full_authority"]);
const UI_PROFILE_ALIASES = Object.freeze({ ask: "ask_for_approval", approve: "approve_for_me", full: "full_authority" });

function normalizeAuthorityProfile(value = "approve_for_me") {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return UI_PROFILE_ALIASES[key] || (PROFILE_IDS.includes(key) ? key : "approve_for_me");
}

const PROFILES = Object.freeze({
  ask_for_approval: Object.freeze({ id: "ask_for_approval", label: "Ask for Approval", approvalMode: "always", policy: Object.freeze({ softScope: "require_approval", hardScope: "deny", highRisk: "require_approval", irreversible: "require_approval", unlisted: "require_approval" }) }),
  approve_for_me: Object.freeze({ id: "approve_for_me", label: "Approve for Me", approvalMode: "conditional", policy: Object.freeze({ softScope: "require_approval", hardScope: "deny", highRisk: "require_approval", irreversible: "require_approval", unlisted: "require_approval" }) }),
  full_authority: Object.freeze({ id: "full_authority", label: "Full Authorization", approvalMode: "disabled", policy: Object.freeze({ softScope: "restrict", hardScope: "deny", highRisk: "allow", irreversible: "allow", unlisted: "allow" }) }),
});

module.exports = Object.freeze({ status: "active", PROFILE_IDS, PROFILES, UI_PROFILE_ALIASES, normalizeAuthorityProfile });
