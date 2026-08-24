"use strict";

/*
 * Shared slash-command boundary.
 *
 * Shipped commands are discovered from the special-skill registry. User
 * aliases can still be stored in Settings, but they are prompt expansions
 * only; executable/static command adapters are intentionally not part of the
 * chat command surface.
 */

const { defaultRegistry } = require("../../agent/special-skills/registry.js");

const DEFAULT_COMMANDS = Object.freeze(Object.fromEntries(defaultRegistry.list().map((skill) => [skill.command, {
  role: "special",
  description: skill.description,
  title: skill.title,
  version: skill.version,
  entrypoint: skill.entrypoint,
  resources: skill.resources,
  modes: skill.modes,
  parameterPolicy: skill.parameterPolicy,
  requiredTools: skill.requiredTools,
}])));

function loadOverrides(raw) {
  if (!raw) return {};
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function customCommandConfig(name, overrides) {
  const key = String(name || "").toLowerCase();
  const config = overrides[key] || overrides[name] || {};
  return config && typeof config === "object" && !Array.isArray(config) ? config : {};
}

function parseCommand(raw, overrides = null) {
  const text = String(raw || "").trim();
  if (!text.startsWith("/")) return { ok: false, error: "Command must start with '/'", code: "NOT_SLASH_COMMAND" };
  const parts = text.split(/\s+/);
  const name = parts[0].toLowerCase();
  const special = defaultRegistry.resolve(text);
  if (special.ok) {
    return {
      ok: true,
      command: special.command,
      args: [],
      userContext: special.userContext || "",
      role: "special",
      id: special.manifest.id,
      title: special.manifest.title,
      aim: special.manifest.description,
      description: special.manifest.description,
      prompt: "",
      expectedOutput: "",
      constraints: "",
      output: "",
      tools: special.manifest.requiredTools || [],
      parameterPolicy: special.manifest.parameterPolicy,
      acceptsContext: special.manifest.acceptsContext !== false,
      version: special.manifest.version,
    };
  }

  const config = customCommandConfig(name, loadOverrides(overrides));
  if (!Object.keys(config).length) return { ok: false, error: `Unknown slash command: ${name}`, code: "UNKNOWN_COMMAND" };
  if (config.enabled === false) return { ok: false, error: `Slash command is disabled in XEKUTE Settings: ${name}`, code: "COMMAND_DISABLED" };
  if (String(config.role || "ai").toLowerCase() === "static") {
    return {
      ok: false,
      error: "Static slash commands are no longer supported. Store this command as user-authored prompt guidance instead.",
      code: "STATIC_COMMAND_UNSUPPORTED",
    };
  }
  return {
    ok: true,
    command: name,
    args: [],
    userContext: parts.slice(1).join(" "),
    role: "ai",
    aim: config.aim || "",
    description: config.description || "",
    prompt: config.prompt || "",
    expectedOutput: config.expectedOutput || "",
    constraints: config.constraints || "",
    output: "",
    tools: [],
    parameterPolicy: "context-only",
  };
}

async function runCommand(raw, _assessment, overrides = null) {
  const parsed = parseCommand(raw, overrides);
  if (!parsed.ok) return parsed;
  return { ...parsed, ok: true, mode: parsed.role === "special" ? "special" : "ai" };
}

module.exports = { DEFAULT_COMMANDS, parseCommand, runCommand };
