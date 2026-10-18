"use strict";

// Named roles for delegated children. A child started with one of these roles
// gets a fixed tool surface and fixed role guidance, so every child of that role
// sends the same request prefix and cannot reach tools its job never needs. Any
// other role string behaves exactly as before.

const ALWAYS_AVAILABLE = Object.freeze(["ask_questions", "end_turn", "release_blocks", "recall_block"]);

const ARCHETYPES = Object.freeze({
  recon: Object.freeze({
    name: "recon",
    tools: Object.freeze([...ALWAYS_AVAILABLE, "read_file", "search_workspace", "view_active_terminal", "exec_command", "web_research", "browser_action", "replay_request"]),
    keepMcp: true,
    guidance: [
      "You are a recon child. Discover and record facts about the in-scope targets. Do not edit workspace files and do not change target state.",
      "Keep raw tool output in your own context. Report only what was observed: hosts, ports, services, versions, URLs and file paths, each with the command or request that produced it.",
      "Mark anything you could not check as unverified.",
    ].join("\n"),
  }),
  analyst: Object.freeze({
    name: "analyst",
    tools: Object.freeze([...ALWAYS_AVAILABLE, "read_file", "search_workspace", "view_active_terminal", "web_research"]),
    keepMcp: false,
    guidance: [
      "You are an analysis child. Read and reason over existing project files, notes and captured evidence. Do not run commands and do not edit files.",
      "Answer the objective with cited file paths and short quotes. Mark any claim the files do not support as unverified.",
    ].join("\n"),
  }),
});

function archetypeFor(role) {
  const key = String(role || "").trim().toLowerCase();
  return Object.hasOwn(ARCHETYPES, key) ? ARCHETYPES[key] : null;
}

function toolNameOf(tool) { return String(tool?.function?.name || tool?.name || ""); }

function narrowToolsForArchetype(tools, archetype) {
  const list = Array.isArray(tools) ? tools : [];
  if (!archetype) return list;
  return list.filter((tool) => {
    const name = toolNameOf(tool);
    return name.startsWith("mcp__") ? archetype.keepMcp === true : archetype.tools.includes(name);
  });
}

module.exports = { ARCHETYPES, archetypeFor, narrowToolsForArchetype };
