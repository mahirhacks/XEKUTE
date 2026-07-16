const PromptCompiler = require("./prompt-compiler");

const TESTING_MODES = Object.freeze({
  planner: { family: "testing", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Create a grounded testing plan with full authorized context." },
  agent: { family: "testing", key: "agent", label: "Agent", legacyMode: "agent", capability: "active", description: "Execute, observe, verify, and report within runtime policy." },
  ask: { family: "testing", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Analyze and answer from testing evidence without execution." },
});

const ASSIST_ROLES = Object.freeze({
  planner: { family: "assist", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Create a grounded, hypothesis-driven testing plan." },
  agent: { family: "assist", key: "agent", label: "Agent", legacyMode: "agent", capability: "workspace", description: "Execute safe workspace actions while analyzing, observing, verifying, and reporting." },
  ask: { family: "assist", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Analyze, observe, and answer questions without sensitive execution." },
});

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
  return selected.capability === "observe" || selected.capability === "assess" || selected.capability === "plan" || selected.capability === "verify" || selected.capability === "report";
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
