"use strict";

const { MODE_TOOL_GROUPS, TOOL_METADATA, TOOL_REGISTRY_NAMES } = require("./tool-metadata.js");

// The agent always exposes the canonical registry. A mode changes the
// capability surface; it never disables the tool system through an environment
// variable or a chat-only compatibility branch.

function toolsEnabled() {
  return true;
}

function providerTools(profile = "agent") {
  const key = typeof profile === "string" ? profile : profile?.key || profile?.mode || "agent";
  return [...(MODE_TOOL_GROUPS[key] || MODE_TOOL_GROUPS.agent)];
}

function metadataFor(toolName) {
  return TOOL_METADATA[String(toolName || "")] || null;
}

module.exports = {
  MODE_TOOL_GROUPS,
  TOOL_REGISTRY_NAMES,
  metadataFor,
  toolsEnabled,
  providerTools,
};
