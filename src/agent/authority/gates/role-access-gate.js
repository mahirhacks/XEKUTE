"use strict";

const { MODE_TOOL_GROUPS } = require("../../tools/config/tool-metadata.js");
const { allow, deny, gate } = require("./gate-utils.js");

function createRoleAccessGate() {
  return gate("role_access_gate", ({ context, toolName, entry }) => {
    const mode = String(context?.role || context?.mode || "agent");
    const allowedTools = MODE_TOOL_GROUPS[mode] || MODE_TOOL_GROUPS.agent;
    const declaredModes = Array.isArray(entry?.metadata?.modes) ? entry.metadata.modes : Array.isArray(entry?.modes) ? entry.modes : [];
    const dynamicAllowed = String(toolName || "").startsWith("mcp__") && declaredModes.includes(mode);
    return allowedTools.includes(toolName) || dynamicAllowed
      ? allow("role_access_gate", `${toolName} is exposed in ${mode} mode.`)
      : deny("role_access_gate", `${toolName} is unavailable in ${mode} mode.`, { code: "MODE_TOOL_UNAVAILABLE", mode, toolName });
  });
}

module.exports = { createRoleAccessGate };
