"use strict";

const pathDefault = require("node:path");
const { discoverPackages } = require("./loader.js");

const RESERVED_COMMANDS = Object.freeze(new Set(["/pentest", "/report", "/create-rule", "/create-skill", "/create-subagent"]));

function invocationParts(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("/")) return { command: "", userContext: "", raw: text };
  const [token, ...rest] = text.split(/\s+/);
  return { command: token.toLowerCase(), userContext: rest.join(" "), raw: text };
}

function createSpecialSkillRegistry({ root = pathDefault.resolve(__dirname), fs, path = pathDefault } = {}) {
  let snapshot = null;
  function load() {
    if (!snapshot) {
      const result = discoverPackages({ root, fs, path });
      const byId = new Map();
      const byCommand = new Map();
      const diagnostics = [...result.diagnostics];
      for (const pkg of result.packages) {
        const { id, command } = pkg.manifest;
        if (byId.has(id) || byCommand.has(command)) {
          diagnostics.push({ package: id, code: "SPECIAL_SKILL_DUPLICATE", error: `Duplicate special skill id or command: ${id}/${command}` });
          continue;
        }
        byId.set(id, pkg);
        byCommand.set(command, pkg);
      }
      snapshot = { packages: [...byId.values()].sort((a, b) => a.manifest.command.localeCompare(b.manifest.command)), byId, byCommand, diagnostics };
    }
    return snapshot;
  }
  function list() {
    return load().packages.map(({ manifest }) => ({ ...manifest, resources: [...manifest.resources] }));
  }
  function resolve(commandOrInput, options = {}) {
    const { command, userContext, raw } = invocationParts(typeof commandOrInput === "object" ? commandOrInput.command : commandOrInput);
    const pkg = load().byCommand.get(command) || load().byId.get(String(commandOrInput || "").replace(/^\//, "").toLowerCase());
    if (!pkg) return { ok: false, error: `Unknown special skill: ${command || commandOrInput}`, code: "SPECIAL_SKILL_NOT_FOUND", command, raw };
    const mode = String(options?.mode || "").trim().toLowerCase();
    if (mode && !pkg.manifest.modes.includes(mode)) {
      return { ok: false, error: `${pkg.manifest.command} is unavailable in ${mode} mode.`, code: "SPECIAL_SKILL_MODE_UNSUPPORTED", command, raw, mode };
    }
    if (userContext && !pkg.manifest.acceptsContext) {
      return { ok: false, error: `${pkg.manifest.command} does not accept trailing chat context.`, code: "SPECIAL_SKILL_CONTEXT_UNSUPPORTED", command, raw };
    }
    return { ok: true, ...pkg, command, userContext: pkg.manifest.acceptsContext ? userContext : "", raw };
  }
  function diagnostics() { return [...load().diagnostics]; }
  function invalidate() { snapshot = null; }
  return Object.freeze({ diagnostics, invalidate, list, resolve, reservedCommands: RESERVED_COMMANDS });
}

const defaultRegistry = createSpecialSkillRegistry();

module.exports = Object.freeze({ RESERVED_COMMANDS, createSpecialSkillRegistry, defaultRegistry, invocationParts });
