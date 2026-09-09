/* Canonical operating-mode profiles shared by Node and the renderer. */

(function exposeOperatingModes(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteOperatingModes = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function defineProfile(key, label, capability, description) {
    return Object.freeze({
      family: "xekute",
      key,
      id: key,
      label,
      capability,
      description,
    });
  }

  const MODES = Object.freeze({
    agent: defineProfile("agent", "Agent", "active", "Execute the user's request, observe, verify, and report within configured scope."),
    ask: defineProfile("ask", "Ask", "observe", "Strictly read-only questions and analysis over available project evidence."),
  });

  // Input aliases normalize older UI payloads to the two public mode IDs.
  // Removed Hypothesis/Plan modes keep their former read-only tool surface via Ask.
  const MODE_KEY_ALIASES = Object.freeze({
    analyze: "ask",
    execution: "agent",
    exploit: "agent",
    executor: "agent",
    observer: "ask",
    verifier: "ask",
    reporter: "ask",
    planner: "ask",
    plan: "ask",
    hypothesis: "ask",
    "assist:hypothesis": "ask",
    "assist:planner": "ask",
    "assist:agent": "agent",
    "assist:ask": "ask",
    "testing:hypothesis": "ask",
    "testing:planner": "ask",
    "testing:agent": "agent",
    "testing:ask": "ask",
    "assist:executor": "agent",
    "assist:observer": "ask",
    "assist:verifier": "ask",
    "assist:reporter": "ask",
    "testing:analyze": "ask",
    "testing:execution": "agent",
    "testing:exploit": "agent",
  });

  const MODE_PROFILES = Object.freeze(Object.fromEntries(
    Object.values(MODES).map((profile) => [profile.id, profile]),
  ));

  const READ_ONLY_CAPABILITIES = new Set(["observe"]);

  const AGENT_TOOLS = Object.freeze([
    "ask_questions", "exec_command", "read_file", "search_workspace", "apply_patch",
    "manage_identity", "replay_request", "browser_action", "delegate_agent", "web_research",
  ]);
  const SAFE_READ_TOOLS = Object.freeze(["ask_questions", "read_file", "search_workspace"]);
  const MODE_TOOL_GROUPS = Object.freeze({ ask: SAFE_READ_TOOLS, agent: AGENT_TOOLS });

  function normalizeProfile(familyOrProfile = "agent", mode = "agent") {
    const objectProfile = familyOrProfile && typeof familyOrProfile === "object" ? familyOrProfile : null;
    const rawFamily = String(objectProfile ? (objectProfile.family || "") : (familyOrProfile || "")).toLowerCase();
    const rawMode = String(objectProfile?.key || objectProfile?.mode || mode || "agent").toLowerCase();
    const combined = rawFamily.includes(":")
      ? rawFamily
      : rawMode.includes(":")
        ? rawMode
        : (rawFamily && ["assist", "testing", "xekute"].includes(rawFamily) ? rawMode : (rawFamily || rawMode));
    const aliased = MODE_KEY_ALIASES[combined] || MODE_KEY_ALIASES[rawMode] || combined;
    const key = MODE_KEY_ALIASES[aliased] || aliased;
    return MODES[key] || MODES.agent;
  }

  function profileKey(profile) {
    return normalizeProfile(profile).key;
  }

  function isReadOnlyProfile(profile) {
    return READ_ONLY_CAPABILITIES.has(normalizeProfile(profile).capability);
  }

  return Object.freeze({
    MODES,
    MODE_KEY_ALIASES,
    MODE_PROFILES,
    MODE_TOOL_GROUPS,
    READ_ONLY_CAPABILITIES,
    profileKey,
    isReadOnlyProfile,
    normalizeProfile,
  });
});
