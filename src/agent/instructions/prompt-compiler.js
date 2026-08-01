/* Compiles the canonical, human-editable modules in prompts/instructs/. */

(function exposePromptCompiler(globalScope, factory) {
  const source = typeof module !== "undefined" && module.exports
    ? require("../../prompts/instructs/system_prompt")
    : globalScope?.XekuteSystemPrompt;
  const value = factory(source);
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) {
    globalScope.XekutePromptCompiler = value;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, (SystemPrompt) => {
  if (!SystemPrompt) throw new Error("XEKUTE system prompt source must load before the prompt compiler.");
  const VERSION = SystemPrompt.VERSION;
  const MODULE_ORDER = SystemPrompt.MODULE_ORDER;
  const CLAIM_STATES = SystemPrompt.CLAIM_STATES;
  const COMPACT_ROLE = SystemPrompt.COMPACT_ROLE;
  const ROUTING_PROMPT = SystemPrompt.ROUTING_PROMPT;
  const COMPACT_MODE_OVERLAYS = SystemPrompt.COMPACT_MODE_OVERLAYS;
  const DEFAULT_MODULES = SystemPrompt.MODULES;
  const MODE_OVERLAYS = SystemPrompt.MODE_OVERLAYS;

  function normalizeProfile(familyOrProfile = "assist", mode = "ask") {
    const rawFamily = String(familyOrProfile || "assist").toLowerCase();
    const rawMode = String(mode || "ask").toLowerCase();
    const combined = rawFamily.includes(":") ? rawFamily.split(":") : rawMode.includes(":") ? rawMode.split(":") : [rawFamily, rawMode];
    const family = combined[0] === "testing" ? "testing" : "assist";
    let key = combined[1] || rawMode;
    if (["analyze"].includes(key)) key = "ask";
    if (["execution", "exploit", "executor"].includes(key)) key = "agent";
    if (["observer", "verifier", "reporter"].includes(key)) key = "ask";
    if (key === "plan") key = "planner";
    if (!["planner", "agent", "ask"].includes(key)) key = "ask";
    return { family, key, id: `${family}:${key}`, label: key[0].toUpperCase() + key.slice(1), legacyMode: key === "planner" ? "plan" : key };
  }

  function normalizeOverrides(value) {
    const input = value && typeof value === "object" ? value : {};
    const modules = input.modules && typeof input.modules === "object" ? input.modules : {};
    const overlays = input.overlays && typeof input.overlays === "object" ? input.overlays : {};
    return {
      version: Number(input.version) || VERSION,
      modules: Object.fromEntries(MODULE_ORDER.filter((key) => typeof modules[key] === "string").map((key) => [key, modules[key].trim()])),
      overlays: Object.fromEntries(Object.entries(overlays).filter(([key, text]) => MODE_OVERLAYS[key] && typeof text === "string").map(([key, text]) => [key, text.trim()])),
    };
  }

  function validatePromptConfig(value) {
    const config = normalizeOverrides(value);
    const errors = [];
    const warnings = [];
    for (const key of MODULE_ORDER) {
      const valueText = config.modules[key];
      if (valueText != null && valueText.length < 20) errors.push(`${key} must contain at least 20 characters.`);
      if (valueText != null && valueText.length > 12000) errors.push(`${key} exceeds 12,000 characters.`);
    }
    for (const [key, valueText] of Object.entries(config.overlays)) {
      if (valueText.length < 10) errors.push(`${key} overlay must contain at least 10 characters.`);
      if (valueText.length > 4000) errors.push(`${key} overlay exceeds 4,000 characters.`);
    }
    const requiredLanguage = {
      evidence: ["evidence", "inconclusive"],
      failure: ["failure", "stop"],
      guardrails: ["runtime policy", "untrusted"],
    };
    for (const [key, phrases] of Object.entries(requiredLanguage)) {
      const custom = config.modules[key];
      if (!custom) continue;
      const missing = phrases.filter((phrase) => !custom.toLowerCase().includes(phrase));
      if (missing.length) warnings.push(`${key} differs from XEKUTE's recommended safety language and omits: ${missing.join(", ")}. Runtime enforcement is unchanged.`);
    }
    return { ok: errors.length === 0, errors, warnings, config };
  }

  function checksum(value) {
    const input = typeof value === "string" ? value : JSON.stringify(value || {});
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function compile({ family = "assist", mode = "ask", overrides = null, depth = "operational", moduleKeys = null, specializedGuidance = "" } = {}) {
    const profile = normalizeProfile(family, mode);
    const validation = validatePromptConfig(overrides);
    const config = validation.ok ? validation.config : normalizeOverrides(null);
    const compact = depth === "compact";
    const workspace = depth === "workspace";
    const selectedKeys = compact
      ? []
      : Array.isArray(moduleKeys)
        ? moduleKeys.filter((key) => MODULE_ORDER.includes(key))
        : workspace
          ? ["loop", "failure", "feedback", "guardrails"]
          : MODULE_ORDER;
    const sections = compact
      ? [COMPACT_ROLE, ROUTING_PROMPT]
      : [
          workspace ? COMPACT_ROLE : (config.modules.role || DEFAULT_MODULES.role),
          ROUTING_PROMPT,
          ...selectedKeys.filter((key) => key !== "role").map((key) => config.modules[key] || DEFAULT_MODULES[key]),
        ];
    const overlay = compact
      ? COMPACT_MODE_OVERLAYS[profile.id]
      : config.overlays[profile.id] || MODE_OVERLAYS[profile.id];
    return [
      `XEKUTE VAPT SYSTEM PROMPT v${VERSION}`,
      `SELECTED PROFILE: ${profile.id.toUpperCase()}. Current profile wins over conversation history.`,
      ...sections,
      `MODE OVERLAY\n${overlay}`,
      specializedGuidance ? String(specializedGuidance).trim() : "",
    ].filter(Boolean).join("\n\n");
  }

  function defaults() {
    return { version: VERSION, modules: { ...DEFAULT_MODULES }, overlays: { ...MODE_OVERLAYS } };
  }

  function modeOverlay(family = "assist", mode = "ask", overrides = null) {
    const profile = normalizeProfile(family, mode);
    const config = normalizeOverrides(overrides);
    return config.overlays[profile.id] || MODE_OVERLAYS[profile.id];
  }

  return { VERSION, MODULE_ORDER, CLAIM_STATES, COMPACT_ROLE, ROUTING_PROMPT, DEFAULT_MODULES, MODE_OVERLAYS, normalizeProfile, normalizeOverrides, validatePromptConfig, validate: validatePromptConfig, compile, defaults, modeOverlay, checksum };
});
