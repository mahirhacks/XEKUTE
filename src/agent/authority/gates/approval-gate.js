"use strict";

const { allow, deny, gate } = require("./gate-utils.js");

function createApprovalGate() {
  return gate("approval_gate", async ({ context, state, profile, toolName, args, runtime }) => {
    const requests = state.decisions.filter((item) => item.decision === "require_approval");
    // Full Authorization skips approvals, except a browser scope exception:
    // a tab that drifted off scope or a related subdomain always asks.
    if (profile?.approvalMode === "disabled" && !requests.some((item) => item.metadata?.browserScopeApproval)) {
      state.approvalSkipped = true;
      return allow("approval_gate", "Approval stage skipped for Full Authorization.", { skipped: true });
    }
    if (!requests.length) return allow("approval_gate", "No approval is required.");
    if (typeof runtime?.approvalProvider !== "function") {
      return deny("approval_gate", "Operator approval is required before this action can run.", { code: "APPROVAL_REQUIRED", toolName });
    }
    const approval = await runtime.approvalProvider({ invocationId: context.invocationId, toolName, args, risk: state.risk, profile: profile.id, reason: requests.at(-1)?.reason || "" });
    state.approval = approval;
    return approval?.approved
      ? allow("approval_gate", "Operator approved the invocation.", { approvalId: approval.id || "" })
      : deny("approval_gate", approval?.reason || "Operator denied the invocation.", { code: "APPROVAL_DENIED", approvalId: approval?.id || "" });
  });
}

module.exports = { createApprovalGate };
