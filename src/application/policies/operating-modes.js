const {
  ASSIST_ROLES,
  TESTING_MODES,
  MODES,
  READ_ONLY_CAPABILITIES,
  normalizeProfile: normalizeOperatingProfile,
} = require("./operating-mode-rules");

const LEGACY_PROFILES = Object.freeze({
  ask: MODES.ask,
  plan: MODES.planner,
  agent: MODES.agent,
  hypothesis: MODES.hypothesis,
});

function normalizeProfile(familyOrMode = "agent", mode = "agent") {
  return normalizeOperatingProfile(familyOrMode, mode);
}

function profileKey(profile) {
  const selected = profile?.key ? normalizeProfile(profile) : normalizeProfile(profile?.family, profile?.key);
  return selected.key;
}

function isTestingProfile(profile) {
  // Assessment-phase discipline now applies to Agent mode (Authority gates cyber).
  return normalizeProfile(profile).key === "agent";
}

function isReadOnlyProfile(profile) {
  const selected = normalizeProfile(profile);
  return READ_ONLY_CAPABILITIES.has(selected.capability);
}

module.exports = {
  ASSIST_ROLES,
  LEGACY_PROFILES,
  MODES,
  TESTING_MODES,
  isReadOnlyProfile,
  isTestingProfile,
  normalizeProfile,
  profileKey,
};
