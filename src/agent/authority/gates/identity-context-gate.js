"use strict";

const { allow, deny, gate } = require("./gate-utils.js");

function createIdentityContextGate() {
  return gate("identity_context_gate", async ({ context, toolName, args, state, runtime }) => {
    const requested = String(args?.identityId || "");
    const bound = String(context?.identityContext?.identityId || "");
    if (bound && requested && bound !== requested) return deny("identity_context_gate", "Requested identity does not match the invocation identity context.", { code: "IDENTITY_CONTEXT_MISMATCH" });
    const parentIdentity = String(context?.delegationContext?.parentIdentityId || "");
    if (parentIdentity && requested && parentIdentity !== requested) return deny("identity_context_gate", "A delegated invocation cannot cross its parent identity boundary.", { code: "DELEGATED_IDENTITY_EXPANSION" });
    const identityIds = [...new Set([
      ...state.normalizedTargets.filter((target) => target.kind === "identity" && target.type === "identityid").map((target) => target.value),
      requested,
    ].filter(Boolean))];
    const operation = String(args?.operation || "");
    const requiresExisting = toolName !== "manage_identity" || !["create", "list"].includes(operation);
    if (requiresExisting && typeof runtime?.identityExists === "function") {
      for (const identityId of identityIds) {
        if (!(await runtime.identityExists(identityId, context))) return deny("identity_context_gate", `Identity '${identityId}' is not configured for this project.`, { code: "IDENTITY_NOT_CONFIGURED", identityId });
      }
    }
    state.identity = { identityIds, sessionId: String(context?.sessionId || ""), actorId: String(context?.requestMetadata?.actorId || "local-user") };
    return allow("identity_context_gate", "Actor, workspace, session, and identity boundaries are consistent.", state.identity);
  });
}

module.exports = { createIdentityContextGate };
