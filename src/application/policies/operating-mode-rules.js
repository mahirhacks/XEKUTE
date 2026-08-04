/* Canonical operating-mode profiles shared by Node and the renderer.
 * Modes are flat (Agent / Hypothesis / Plan / Ask). Authority is a separate
 * dimension handled by XEKUTE Authority settings + the policy engine. */

(function exposeOperatingModes(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteOperatingModes = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function defineProfile(key, label, legacyMode, capability, description) {
    return Object.freeze({
      family: "xekute",
      key,
      id: key,
      label,
      legacyMode,
      capability,
      description,
    });
  }

  const MODES = Object.freeze({
    hypothesis: defineProfile("hypothesis", "Hypothesis", "hypothesis", "assess", "Read context and form grounded hypotheses only."),
    planner: defineProfile("planner", "Plan", "plan", "plan", "Create and revise plans; read and write workspace files."),
    agent: defineProfile("agent", "Agent", "agent", "active", "Execute, observe, verify, and report within Authority and policy."),
    ask: defineProfile("ask", "Ask", "ask", "observe", "Analyze evidence and answer with read-only tools."),
  });

  // Backward-compatible aliases while callers migrate off Assist/Testing families.
  const MODE_KEY_ALIASES = Object.freeze({
    analyze: "ask",
    execution: "agent",
    exploit: "agent",
    executor: "agent",
    observer: "ask",
    verifier: "ask",
    reporter: "ask",
    plan: "planner",
    "assist:hypothesis": "hypothesis",
    "assist:planner": "planner",
    "assist:agent": "agent",
    "assist:ask": "ask",
    "testing:hypothesis": "hypothesis",
    "testing:planner": "planner",
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

  const READ_ONLY_CAPABILITIES = new Set(["observe", "assess", "verify", "report"]);

  function normalizeProfile(familyOrProfile = "agent", mode = "agent") {
    const objectProfile = familyOrProfile && typeof familyOrProfile === "object" ? familyOrProfile : null;
    const rawFamily = String(objectProfile?.family || familyOrProfile || "").toLowerCase();
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

  return Object.freeze({
    ASSIST_ROLES: MODES,
    TESTING_MODES: MODES,
    MODES,
    MODE_KEY_ALIASES,
    MODE_PROFILES,
    READ_ONLY_CAPABILITIES,
    normalizeProfile,
  });
});
