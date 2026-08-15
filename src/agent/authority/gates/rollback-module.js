"use strict";

const { allow, gate } = require("./gate-utils.js");

async function performRollback({ context, state, runtime }) {
  if (!runtime?.rollbackRequired) return { status: "not_required", action: "", reason: "Rollback was not required.", restoredArtifacts: [], compensationReference: "", error: "", completedAt: "" };
  if (typeof runtime.rollbackProvider !== "function") return { status: "rollback_failed", action: "", reason: "No supported rollback provider is registered.", restoredArtifacts: [], compensationReference: "", error: "ROLLBACK_UNSUPPORTED", completedAt: new Date().toISOString() };
  try {
    const result = await runtime.rollbackProvider({ context, state });
    return result?.ok
      ? { status: "rollback_completed", action: result.action || "compensate", reason: result.reason || "Rollback completed.", restoredArtifacts: result.restoredArtifacts || [], compensationReference: result.reference || "", error: "", completedAt: new Date().toISOString() }
      : { status: "rollback_failed", action: result?.action || "compensate", reason: result?.reason || "Rollback failed.", restoredArtifacts: result?.restoredArtifacts || [], compensationReference: result?.reference || "", error: result?.error || "ROLLBACK_FAILED", completedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "rollback_failed", action: "compensate", reason: error.message, restoredArtifacts: [], compensationReference: "", error: error.code || "ROLLBACK_FAILED", completedAt: new Date().toISOString() };
  }
}

function createRollbackModule() {
  return gate("rollback_module", async ({ context, state, runtime }) => {
    state.rollback = await performRollback({ context, state, runtime });
    return allow("rollback_module", state.rollback.reason, { rollback: state.rollback });
  });
}

module.exports = { createRollbackModule, performRollback };
