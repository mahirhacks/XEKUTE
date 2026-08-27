"use strict";

const MAX_COMPILED_CHARS = 96_000;

function compilePrompt(skill, { userContext = "", mode = "agent", workspace = "" } = {}) {
  if (!skill?.ok && !skill?.manifest) return "";
  const manifest = skill.manifest || skill;
  const resources = Array.isArray(skill.resources) ? skill.resources : [];
  const sections = [
    `XEKUTE INTERNAL SKILL: ${manifest.title} (${manifest.id})`,
    `Skill version: ${manifest.version}`,
    "Instruction role: skill-context. This package never defines or replaces a system prompt.",
    `Invocation mode: ${mode}. Preserve this mode; never instruct the user to switch modes.`,
    workspace ? `Workspace: ${workspace}` : "Workspace: not selected",
    "This is a built-in skill contract. Follow the user's direct request while respecting the existing authority, scope, identity, approval, resource, verification, and recovery gates.",
  ];
  if (userContext && manifest.acceptsContext !== false) sections.push("USER-PROVIDED CONTEXT (not command parameters):", String(userContext).slice(0, 8_000));
  for (const resource of resources) {
    sections.push(`\n--- ${resource.path} ---\n${String(resource.content || "")}`);
  }
  return sections.join("\n").slice(0, MAX_COMPILED_CHARS);
}

function resolveInternalSkill(registry, id, options = {}) {
  const resolved = registry?.resolve?.(id, options);
  if (!resolved?.ok) return resolved || { ok: false, code: "SPECIAL_SKILL_NOT_FOUND" };
  return { ...resolved, prompt: compilePrompt(resolved, options) };
}

function selectInternalSkill(registry, raw, options = {}) {
  const selected = registry?.select?.(raw, options);
  if (!selected?.ok) return selected || { ok: false, code: "SPECIAL_SKILL_NOT_SELECTED" };
  return { ...selected, prompt: compilePrompt(selected, { ...options, userContext: selected.userContext || "" }) };
}

module.exports = Object.freeze({ MAX_COMPILED_CHARS, compilePrompt, resolveInternalSkill, selectInternalSkill });
