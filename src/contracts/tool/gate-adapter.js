"use strict";

const GATE_DECISIONS = Object.freeze(["allow", "deny", "require_approval", "restrict", "defer"]);

function validateGateDecision(value, expectedName = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Gate decision must be an object" };
  if (typeof value.moduleName !== "string" || !value.moduleName.trim()) return { ok: false, error: "Gate decision requires moduleName" };
  if (expectedName && value.moduleName !== expectedName) return { ok: false, error: "Gate decision moduleName does not match adapter" };
  if (!GATE_DECISIONS.includes(value.decision)) return { ok: false, error: "Unsupported gate decision" };
  if (typeof value.terminal !== "boolean") return { ok: false, error: "Gate decision requires terminal" };
  if (typeof value.reason !== "string") return { ok: false, error: "Gate decision requires reason" };
  if (value.restrictions !== undefined && !Array.isArray(value.restrictions)) return { ok: false, error: "Gate restrictions must be an array" };
  return { ok: true, value };
}

function assertGateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) throw new TypeError("Gate adapter must be an object");
  if (typeof adapter.name !== "string" || !adapter.name.trim()) throw new TypeError("Gate adapter requires a name");
  if (typeof adapter.evaluate !== "function") throw new TypeError("Gate adapter requires evaluate");
  return adapter;
}

function decision(moduleName, value = {}) {
  const result = {
    moduleName,
    decision: value.decision || "allow",
    terminal: Boolean(value.terminal),
    reason: String(value.reason || ""),
    policyReference: String(value.policyReference || ""),
    restrictions: Array.isArray(value.restrictions) ? value.restrictions : [],
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {},
    timestamp: value.timestamp || new Date().toISOString(),
  };
  const checked = validateGateDecision(result, moduleName);
  if (!checked.ok) throw new TypeError(checked.error);
  return result;
}

module.exports = { GATE_DECISIONS, assertGateAdapter, decision, validateGateDecision };
