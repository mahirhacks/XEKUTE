"use strict";

const { allow, gate } = require("./gate-utils.js");

const DISABLED = null;
const LONG_RUNNING_TOOLS = new Set(["exec_command", "delegate_agent", "run_test_case"]);

function observationValue(overrides, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(overrides, key)) return fallback;
  if (overrides[key] === null || overrides[key] === false || Number(overrides[key]) === 0) return DISABLED;
  const value = Number(overrides[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function timeoutPolicyFor(toolName, args = {}, overrides = {}) {
  const background = Boolean(args.background || args.operation === "start");
  const hardWasProvided = Object.prototype.hasOwnProperty.call(args, "timeout_ms") || Object.prototype.hasOwnProperty.call(overrides, "hardMs");
  const explicit = Number(args.timeout_ms ?? overrides.hardMs);
  const hardMs = !background && explicit > 0 ? explicit : DISABLED;
  const defaultIdle = LONG_RUNNING_TOOLS.has(toolName) ? 15 * 60_000 : 2 * 60_000;
  const defaultSoft = LONG_RUNNING_TOOLS.has(toolName) ? 60 * 60_000 : 10 * 60_000;
  return {
    startMs: observationValue(overrides, "startMs", 60_000),
    idleObservationMs: observationValue(overrides, "idleObservationMs", defaultIdle),
    softObservationMs: observationValue(overrides, "softObservationMs", defaultSoft),
    hardMs,
    taskMs: DISABLED,
    workflowMs: DISABLED,
    adaptive: true,
    maxObservationExtensions: Number.isFinite(Number(overrides.maxObservationExtensions)) && Number(overrides.maxObservationExtensions) >= 0 ? Number(overrides.maxObservationExtensions) : DISABLED,
    extensionMs: observationValue(overrides, "extensionMs", 15 * 60_000),
    sources: {
      start: Object.prototype.hasOwnProperty.call(overrides, "startMs") ? (observationValue(overrides, "startMs", 60_000) === DISABLED ? "explicit_disabled" : "override") : "default",
      idle: Object.prototype.hasOwnProperty.call(overrides, "idleObservationMs") ? (observationValue(overrides, "idleObservationMs", defaultIdle) === DISABLED ? "explicit_disabled" : "override") : "default",
      soft: Object.prototype.hasOwnProperty.call(overrides, "softObservationMs") ? (observationValue(overrides, "softObservationMs", defaultSoft) === DISABLED ? "explicit_disabled" : "override") : "default",
      hard: background ? "disabled_for_background" : hardWasProvided ? (explicit > 0 ? "explicit" : "explicit_disabled") : "default_disabled",
      task: "disabled_for_long_horizon",
      workflow: "disabled_for_long_horizon",
    },
  };
}

function createTimeoutModule() {
  return gate("timeout_module", ({ toolName, args, state, context }) => {
    state.timeoutPolicy = timeoutPolicyFor(toolName, args, context?.timeoutOverrides || {});
    return allow("timeout_module", "Adaptive observation policy assigned; workflow time is unlimited by default.", { timeoutPolicy: state.timeoutPolicy });
  });
}

module.exports = { DISABLED, createTimeoutModule, observationValue, timeoutPolicyFor };
