"use strict";

const fs = require("node:fs");
const { allow, deny, gate } = require("./gate-utils.js");

function createEnvironmentGate({ fsImpl = fs } = {}) {
  return gate("environment_gate", async ({ context, toolName, entry, runtime }) => {
    if (entry?.metadata?.interactive === true && entry?.adapter) {
      return allow("environment_gate", "The local operator-input provider is available without a workspace dependency.");
    }
    if (entry?.adapter && Array.isArray(entry?.metadata?.targetTypes) && entry.metadata.targetTypes.includes("runtime")) {
      return allow("environment_gate", "The local runtime UI tool is available without a workspace dependency.");
    }
    const root = String(context?.workspace?.root || "");
    if (!root || !fsImpl.existsSync(root)) return deny("environment_gate", "The active workspace is unavailable.", { code: "WORKSPACE_UNAVAILABLE" });
    if (!entry?.adapter && !runtime?.dynamicTool) return deny("environment_gate", "The selected execution provider is unavailable.", { code: "EXECUTION_PROVIDER_UNAVAILABLE" });
    if (runtime?.executionProviderAvailable === false) return deny("environment_gate", "The concrete execution provider is unavailable.", { code: "EXECUTION_PROVIDER_UNAVAILABLE", toolName });
    if (typeof runtime?.environmentProvider === "function") {
      let report;
      try { report = await runtime.environmentProvider({ context, toolName, entry }); }
      catch (error) { return deny("environment_gate", `Environment inspection failed: ${error.message}`, { code: error.code || "ENVIRONMENT_CHECK_FAILED" }); }
      if (report?.ok === false) return deny("environment_gate", report.reason || "A required environment prerequisite is unavailable.", { code: report.code || "ENVIRONMENT_PREREQUISITE_MISSING", report });
      return allow("environment_gate", "Runtime, workspace, dependencies, services, and execution provider are available.", { report: report || null });
    }
    return allow("environment_gate", "Runtime, workspace, and execution provider are available.");
  });
}

module.exports = { createEnvironmentGate };
