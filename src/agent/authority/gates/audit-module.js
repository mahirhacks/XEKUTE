"use strict";

const { allow, gate } = require("./gate-utils.js");

function createAuditModule() {
  return gate("audit_module", ({ context, state, runtime }) => {
    const finalized = runtime?.audit?.append?.(context.workspace?.root || "", {
      type: "tool_invocation_finalized",
      invocationId: context.invocationId,
      toolName: context.toolName,
      role: context.role,
      authority: context.authority,
      decisions: state.decisions,
      monitor: state.monitorState,
      transformation: state.outputTransformation,
      verification: state.verification,
      recovery: state.recovery,
      rollback: state.rollback,
      completedAt: new Date().toISOString(),
    }) || { reference: "", integrityHash: "" };
    state.auditReference = finalized.reference || "";
    state.auditIntegrityHash = finalized.integrityHash || "";
    return allow("audit_module", "Lifecycle audit finalized.", { auditReference: state.auditReference });
  });
}

module.exports = { createAuditModule };
