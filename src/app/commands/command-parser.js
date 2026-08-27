"use strict";

/*
 * Shared slash-command boundary.
 *
 * Built-in Markdown package bodies remain internal. This boundary exposes
 * only their safe invocation metadata, alongside user-authored prompt aliases.
 * Executable/static command adapters are not part of the chat command surface.
 */

const DEFAULT_COMMANDS = Object.freeze({
  "/pentest": Object.freeze({ id: "pentest", title: "Adaptive penetration testing", description: "Run adaptive, scope-aware penetration testing." }),
  "/report": Object.freeze({ id: "report", title: "VAPT report generation", description: "Generate an evidence-linked VAPT report." }),
  "/create-rule": Object.freeze({ id: "create-rule", title: "Create a project rule", description: "Create a project or global rule." }),
  "/create-skill": Object.freeze({ id: "create-skill", title: "Create user guidance skill", description: "Create user-authored guidance." }),
  "/create-subagent": Object.freeze({ id: "create-subagent", title: "Create a subagent profile", description: "Create a bounded subagent profile." }),
});
const INTERNAL_COMMAND_NAMES = new Set(Object.keys(DEFAULT_COMMANDS));

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
  if (INTERNAL_COMMAND_NAMES.has(name)) {
    const systemSkill = DEFAULT_COMMANDS[name];
    return {
      ok: true,
      command: name,
      args: [],
      userContext: parts.slice(1).join(" "),
      role: "special",
      id: systemSkill.id,
      title: systemSkill.title,
      aim: systemSkill.description,
      description: systemSkill.description,
      prompt: "",
      expectedOutput: "",
      constraints: "",
      output: "",
      tools: [],
      parameterPolicy: "context-only",
      acceptsContext: true,
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

module.exports = { DEFAULT_COMMANDS, INTERNAL_COMMAND_NAMES, parseCommand, runCommand };
