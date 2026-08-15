"use strict";

const { allow, deny, gate } = require("./gate-utils.js");

function createApprovalGate() {
  return gate("approval_gate", async ({ context, state, profile, toolName, args, runtime }) => {
    if (profile?.approvalMode === "disabled") {
      state.approvalSkipped = true;
      return allow("approval_gate", "Approval stage skipped for Full Authorization.", { skipped: true });
    }
    const required = state.decisions.some((item) => item.decision === "require_approval");
    if (!required) return allow("approval_gate", "No approval is required.");
    if (typeof runtime?.approvalProvider !== "function") {
      return deny("approval_gate", "Operator approval is required before this action can run.", { code: "APPROVAL_REQUIRED", toolName });
    }
    const approval = await runtime.approvalProvider({ invocationId: context.invocationId, toolName, args, risk: state.risk, profile: profile.id });
    state.approval = approval;
    return approval?.approved
      ? allow("approval_gate", "Operator approved the invocation.", { approvalId: approval.id || "" })
      : deny("approval_gate", approval?.reason || "Operator denied the invocation.", { code: "APPROVAL_DENIED", approvalId: approval?.id || "" });
  });
}

module.exports = { createApprovalGate };
