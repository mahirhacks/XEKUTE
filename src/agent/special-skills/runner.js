"use strict";

const MAX_COMPILED_CHARS = 96_000;

function compilePrompt(skill, { userContext = "", mode = "agent", workspace = "" } = {}) {
  if (!skill?.ok && !skill?.manifest) return "";
  const manifest = skill.manifest || skill;
  const resources = Array.isArray(skill.resources) ? skill.resources : [];
  const sections = [
    `XEKUTE SPECIAL SKILL: ${manifest.title} (${manifest.command})`,
    `Skill version: ${manifest.version}`,
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

function resolveInvocation(registry, raw, options = {}) {
  const resolved = registry?.resolve?.(raw, options);
  if (!resolved?.ok) return resolved || { ok: false, code: "SPECIAL_SKILL_NOT_FOUND" };
  return { ...resolved, prompt: compilePrompt(resolved, options) };
}

module.exports = Object.freeze({ MAX_COMPILED_CHARS, compilePrompt, resolveInvocation });
