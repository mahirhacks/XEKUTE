"use strict";

const pathDefault = require("node:path");
const { discoverPackages } = require("./loader.js");

const INTERNAL_SKILL_IDS = Object.freeze(new Set(["pentest", "report", "create-rule", "create-skill", "create-subagent"]));
const INTERNAL_SKILL_INTENTS = Object.freeze([
  Object.freeze({ id: "create-subagent", pattern: /\b(?:create|add|define|build|make)\b.{0,48}\b(?:subagent|sub-agent|specialist\s+agent)\b/i }),
  Object.freeze({ id: "create-rule", pattern: /\b(?:create|add|define|write|make)\b.{0,48}\b(?:project\s+rule|global\s+rule|xekute\s+rule|agent\s+rule|rule)\b/i }),
  Object.freeze({ id: "create-skill", pattern: /\b(?:create|add|define|build|make)\b.{0,48}\b(?:guidance\s+skill|custom\s+skill|xekute\s+skill|agent\s+skill|skill)\b/i }),
  Object.freeze({ id: "report", pattern: /\b(?:create|generate|write|build|update|export)\b.{0,64}\b(?:vapt|pentest|penetration\s+test|security\s+assessment|assessment)?\s*report\b/i }),
  Object.freeze({ id: "pentest", pattern: /(?:\b(?:run|start|perform|conduct|execute|continue|resume)\b.{0,64}\b(?:pentest|penetration\s+test|vapt|security\s+assessment|bug\s+bounty\s+assessment)\b|\b(?:pentest|penetration\s+test|vapt)\b.{0,64}(?:\b(?:target|site|application|app|api|assessment)\b|https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}))/i }),
]);

function internalSkillSelection(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.startsWith("/")) {
    const [command, ...rest] = text.split(/\s+/);
    const id = command.slice(1).toLowerCase();
    return INTERNAL_SKILL_IDS.has(id)
      ? { id, userContext: rest.join(" "), selectedBy: "explicit" }
      : null;
  }
  const id = INTERNAL_SKILL_INTENTS.find((entry) => entry.pattern.test(text))?.id || "";
  return id ? { id, userContext: "", selectedBy: "intent" } : null;
}

function internalSkillIdForIntent(raw) {
  return internalSkillSelection(raw)?.id || "";
}

function createSpecialSkillRegistry({ root = pathDefault.resolve(__dirname), fs, path = pathDefault } = {}) {
  let snapshot = null;
  function load() {
    if (!snapshot) {
      const result = discoverPackages({ root, fs, path });
      const byId = new Map();
      const diagnostics = [...result.diagnostics];
      for (const pkg of result.packages) {
        const { id } = pkg.manifest;
        if (byId.has(id)) {
          diagnostics.push({ package: id, code: "SPECIAL_SKILL_DUPLICATE", error: `Duplicate internal skill id: ${id}` });
          continue;
        }
        byId.set(id, pkg);
      }
      snapshot = { packages: [...byId.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)), byId, diagnostics };
    }
    return snapshot;
  }
  function listInternal() {
    return load().packages.map(({ manifest }) => ({ ...manifest, resources: [...manifest.resources] }));
  }
  function list() { return []; }
  function resolve(id, options = {}) {
    const normalizedId = String(id || "").trim().toLowerCase();
    const pkg = load().byId.get(normalizedId);
    if (!pkg) return { ok: false, error: `Unknown internal skill: ${normalizedId || "<empty>"}`, code: "SPECIAL_SKILL_NOT_FOUND", id: normalizedId };
    const mode = String(options?.mode || "").trim().toLowerCase();
    if (mode && !pkg.manifest.modes.includes(mode)) {
      return { ok: false, error: `${pkg.manifest.id} is unavailable in ${mode} mode.`, code: "SPECIAL_SKILL_MODE_UNSUPPORTED", id: normalizedId, mode };
    }
    return { ok: true, ...pkg, id: normalizedId, userContext: "" };
  }
  function select(raw, options = {}) {
    const selection = internalSkillSelection(raw);
    if (!selection) return { ok: false, code: "SPECIAL_SKILL_NOT_SELECTED", error: "No internal skill matches the current request." };
    const resolved = resolve(selection.id, options);
    return resolved.ok ? { ...resolved, userContext: selection.userContext, selectedBy: selection.selectedBy } : resolved;
  }
  function diagnostics() { return [...load().diagnostics]; }
  function invalidate() { snapshot = null; }
  return Object.freeze({ diagnostics, invalidate, list, listInternal, resolve, select, internalSkillIds: INTERNAL_SKILL_IDS });
}

const defaultRegistry = createSpecialSkillRegistry();

module.exports = Object.freeze({ INTERNAL_SKILL_IDS, INTERNAL_SKILL_INTENTS, createSpecialSkillRegistry, defaultRegistry, internalSkillIdForIntent, internalSkillSelection });
