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
    hypothesis: defineProfile("hypothesis", "Hypothesis", "assess", "Emphasize grounded hypotheses while honoring the user's requested actions."),
    plan: defineProfile("plan", "Plan", "plan", "Emphasize structured planning while honoring the user's requested actions."),
    agent: defineProfile("agent", "Agent", "active", "Execute, observe, verify, and report within configured scope."),
    ask: defineProfile("ask", "Ask", "observe", "Emphasize direct answers while honoring the user's requested actions."),
  });

  // Input aliases normalize older UI payloads to the four public mode IDs.
  const MODE_KEY_ALIASES = Object.freeze({
    analyze: "ask",
    execution: "agent",
    exploit: "agent",
    executor: "agent",
    observer: "ask",
    verifier: "ask",
    reporter: "ask",
    planner: "plan",
    "assist:hypothesis": "hypothesis",
    "assist:planner": "plan",
    "assist:agent": "agent",
    "assist:ask": "ask",
    "testing:hypothesis": "hypothesis",
    "testing:planner": "plan",
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

  const READ_ONLY_CAPABILITIES = new Set();

  const ALL_MODE_TOOLS = Object.freeze([
    "ask_questions", "update_task_list", "exec_command", "read_file", "search_workspace", "apply_patch", "inspect_environment",
    "manage_plan", "manage_state", "ingest_traffic", "manage_identity", "replay_request", "run_test_case", "browser_action",
    "compare_responses", "verify_finding", "store_finding", "attack_graph", "delegate_agent", "query_assessment",
    "expand_evidence", "query_knowledge", "web_research",
  ]);
  const MODE_TOOL_GROUPS = Object.freeze({ ask: ALL_MODE_TOOLS, agent: ALL_MODE_TOOLS, hypothesis: ALL_MODE_TOOLS, plan: ALL_MODE_TOOLS });

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
