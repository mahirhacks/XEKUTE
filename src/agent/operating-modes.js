const TESTING_MODES = Object.freeze({
  planner: { family: "testing", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Analyze context and create a hypothesis-driven testing plan with full testing context." },
  agent: { family: "testing", key: "agent", label: "Agent", legacyMode: "agent", capability: "active", description: "Execute, observe, verify, and report within the approved testing policy." },
  ask: { family: "testing", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Analyze, observe, and answer questions with testing context." },
  analyze: { family: "testing", key: "analyze", label: "Analyze", legacyMode: "ask", capability: "observe", description: "Analyze existing traffic, files, and evidence without running tests." },
  execution: { family: "testing", key: "execution", label: "Execution", legacyMode: "agent", capability: "active", description: "Run approved active tests within the configured scope and limits." },
  exploit: { family: "testing", key: "exploit", label: "Exploit", legacyMode: "agent", capability: "exploit", description: "Validate a specific hypothesis with explicit exploit authorization." },
});

const ASSIST_ROLES = Object.freeze({
  planner: { family: "assist", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Create a grounded, hypothesis-driven testing plan." },
  agent: { family: "assist", key: "agent", label: "Agent", legacyMode: "agent", capability: "workspace", description: "Execute safe workspace actions while analyzing, observing, verifying, and reporting." },
  ask: { family: "assist", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Analyze, observe, and answer questions without sensitive execution." },
  executor: { family: "assist", key: "executor", label: "Executor", legacyMode: "agent", capability: "workspace", description: "Select and execute approved workspace actions." },
  observer: { family: "assist", key: "observer", label: "Observer", legacyMode: "ask", capability: "observe", description: "Parse responses and update evidence." },
  verifier: { family: "assist", key: "verifier", legacyMode: "ask", capability: "verify", description: "Check whether a suspected issue is reproducible." },
  reporter: { family: "assist", key: "reporter", legacyMode: "ask", capability: "report", description: "Write findings with evidence, confidence, and remediation." },
});

const LEGACY_PROFILES = Object.freeze({
  ask: ASSIST_ROLES.observer,
  plan: ASSIST_ROLES.planner,
  agent: ASSIST_ROLES.executor,
});

function normalizeProfile(familyOrMode = "assist", mode = "executor") {
  const family = String(familyOrMode || "").toLowerCase();
  const selected = String(mode || "").toLowerCase();
  if (family === "testing" && TESTING_MODES[selected]) return TESTING_MODES[selected];
  if (family === "assist" && ASSIST_ROLES[selected]) return ASSIST_ROLES[selected];

  const combined = family.includes(":") ? family.split(":") : selected.includes(":") ? selected.split(":") : [];
  if (combined.length === 2) {
    if (combined[0] === "testing" && TESTING_MODES[combined[1]]) return TESTING_MODES[combined[1]];
    if (combined[0] === "assist" && ASSIST_ROLES[combined[1]]) return ASSIST_ROLES[combined[1]];
  }

  return LEGACY_PROFILES[family] || LEGACY_PROFILES[selected] || ASSIST_ROLES.executor;
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
