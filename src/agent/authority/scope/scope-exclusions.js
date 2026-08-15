"use strict";

const ScopeEngine = require("../../../domain/scope/scope-engine");

function evaluateExclusions(target, excludedTargets = []) {
  const decision = ScopeEngine.evaluateTarget(target, {
    targets: [target],
    excludedTargets: Array.isArray(excludedTargets) ? excludedTargets : [],
  });
  return decision.code === "TARGET_OUT_OF_SCOPE"
    ? { matched: true, code: decision.code, reason: "The target matches an explicit out-of-scope rule." }
    : { matched: false, code: "NO_EXCLUSION_MATCH", reason: "No explicit out-of-scope rule matches the target." };
}

module.exports = { evaluateExclusions };
