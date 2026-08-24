"use strict";

const { allow, gate } = require("./gate-utils.js");

function createRoleAccessGate() {
  return gate("role_access_gate", ({ context, toolName, entry }) => {
    const mode = String(context?.role || context?.mode || "agent");
    return allow("role_access_gate", `${toolName} is not restricted by the selected ${mode} mode; downstream registry, authority, and scope validation applies.`);
  });
}

module.exports = { createRoleAccessGate };
