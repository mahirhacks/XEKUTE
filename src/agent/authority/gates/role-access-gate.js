"use strict";

const { MODE_TOOL_GROUPS } = require("../../tools/config/tool-metadata.js");
const { allow, deny, gate } = require("./gate-utils.js");

function createRoleAccessGate() {
  return gate("role_access_gate", ({ context, toolName }) => {
    const mode = String(context?.role || context?.mode || "agent").toLowerCase();
    const name = String(toolName || "");
    const allowed = MODE_TOOL_GROUPS[mode] || MODE_TOOL_GROUPS.agent;
    if (name.startsWith("mcp__")) {
      if (mode === "ask") {
        return deny("role_access_gate", "Ask mode cannot invoke MCP tools.", { code: "TOOL_UNAVAILABLE_IN_MODE", mode, toolName: name });
      }
      return allow("role_access_gate", `${name} is available to Agent mode pending scope and authority checks.`);
    }
    if (!allowed.includes(name)) {
      return deny(
        "role_access_gate",
        `${name} is not available in ${mode} mode.`,
        { code: "TOOL_UNAVAILABLE_IN_MODE", mode, toolName: name },
      );
    }
    return allow("role_access_gate", `${name} is on the ${mode} mode surface.`);
  });
}

module.exports = { createRoleAccessGate };
