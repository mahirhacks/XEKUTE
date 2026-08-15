"use strict";

const { decision } = require("../../../contracts/tool/gate-adapter.js");
const { allow, deny, gate } = require("./gate-utils.js");

function classifyScope(scope = {}) {
  if (scope.ok) return "in_scope";
  return ["soft", "soft_violation", "review"].includes(String(scope.boundary || scope.severity || "").toLowerCase())
    ? "soft_violation"
    : "hard_violation";
}

function createScopeBasedGate({ evaluateScope } = {}) {
  return gate("scope_based_gate", async ({ context, toolName, args, entry, state, runtime }) => {
    const evaluator = runtime?.evaluateScope || evaluateScope;
    const scope = typeof evaluator === "function"
      ? await evaluator({ workspace: context.workspace?.root || "", toolName, args, normalizedTargets: state.normalizedTargets, toolMetadata: entry?.metadata || null, projectProfile: runtime?.projectProfile || null, browserTarget: runtime?.browserTarget || "" })
      : { ok: true, code: "SCOPE_NOT_REQUIRED" };
    state.scope = scope;
    state.scopeDecision = classifyScope(scope);
    if (state.scopeDecision === "in_scope") return allow("scope_based_gate", scope.reason || "Targets are within configured scope.", { scopeType: state.scopeDecision, scope });
    if (state.scopeDecision === "soft_violation") {
      return decision("scope_based_gate", {
        decision: "defer",
        terminal: false,
        reason: scope.reason || "The target requires explicit scope review.",
        policyReference: scope.code || "soft-scope",
        metadata: { code: scope.code || "SOFT_SCOPE_VIOLATION", scopeType: state.scopeDecision, scope },
      });
    }
    return deny("scope_based_gate", scope.reason || "Target violates a hard scope boundary.", { code: scope.code || "SCOPE_DENIED", scopeType: state.scopeDecision, scope }, scope.code || "scope");
  });
}

module.exports = { classifyScope, createScopeBasedGate };
