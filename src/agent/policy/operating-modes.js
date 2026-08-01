const PromptCompiler = require("../instructions/prompt-compiler");
const { ASSIST_ROLES, TESTING_MODES, READ_ONLY_CAPABILITIES } = require("../../prompts/rules/operating-mode-rules");

const LEGACY_PROFILES = Object.freeze({
  ask: ASSIST_ROLES.ask,
  plan: ASSIST_ROLES.planner,
  agent: ASSIST_ROLES.agent,
});

function normalizeProfile(familyOrMode = "assist", mode = "executor") {
  const normalized = PromptCompiler.normalizeProfile(familyOrMode, mode);
  return normalized.family === "testing" ? TESTING_MODES[normalized.key] : ASSIST_ROLES[normalized.key];
}

function profileKey(profile) {
  const selected = profile?.key ? profile : normalizeProfile(profile?.family, profile?.key);
  return `${selected.family}:${selected.key}`;
}

function isTestingProfile(profile) {
  return normalizeProfile(profile?.family, profile?.key).family === "testing";
}

function isReadOnlyProfile(profile) {
  const selected = normalizeProfile(profile?.family, profile?.key);
  return READ_ONLY_CAPABILITIES.has(selected.capability);
}

module.exports = {
  ASSIST_ROLES,
  LEGACY_PROFILES,
  TESTING_MODES,
  isReadOnlyProfile,
  isTestingProfile,
  normalizeProfile,
  profileKey,
};
