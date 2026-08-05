"use strict";

const SUPPORTED_ACTIONS = new Set(["navigate", "click", "fill", "submit", "observe", "screenshot", "inspect_storage", "evaluate_script", "replay_workflow"]);

function createBrowserPort({ driver = null } = {}) {
  async function execute(input, context) {
    if (!SUPPORTED_ACTIONS.has(input.action)) return { ok: false, error: `Unsupported browser action: ${input.action}`, code: "UNSUPPORTED_ACTION" };
    if (!driver || typeof driver.execute !== "function") return { ok: false, unavailable: true, code: "DRIVER_UNAVAILABLE", error: "No approved browser driver is available." };
    const result = await driver.execute(input, context);
    if (!result || result.unavailable) return { ok: false, unavailable: true, code: result?.code || "DRIVER_UNAVAILABLE", error: result?.error || "Browser driver is unavailable." };
    return { ok: true, capability: "available", observation_ref: result.observation_ref || "", summary: result.summary || "Browser action completed.", artifact_refs: result.artifact_refs || [] };
  }
  return Object.freeze({ execute, SUPPORTED_ACTIONS });
}

module.exports = { SUPPORTED_ACTIONS, createBrowserPort };
