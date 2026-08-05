"use strict";

const { issueScopeDecision, validateScopeDecision } = require("../../../contracts/tool/scope-decision");
const ScopeEngine = require("../../../domain/scope/scope-engine");
const { loadPolicy } = require("../../policies/policy-engine");

function createScopePort({ fs, path, decisionStore = null } = {}) {
  function save(context, decision) {
    if (typeof decisionStore?.save === "function") return decisionStore.save(context, decision);
    const target = path.join(context.workspace, ".xekute", "scope-decisions.jsonl");
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.appendFileSync(target, `${JSON.stringify(decision)}\n`, "utf8");
    return { ok: true };
  }
  async function execute(input, context) {
    const policy = loadPolicy(context.workspace, null, null);
    const target = ScopeEngine.canonicalTarget(input.target);
    if (!target) return { ok: false, error: "Target is not canonical.", code: "TARGET_INVALID" };
    const scope = ScopeEngine.evaluateTarget(target, { targets: policy.targets, wildcardRules: policy.wildcardRules, excludedTargets: policy.excludedTargets });
    const window = ScopeEngine.testingWindowAllows(policy.testingWindows, { timeZone: policy.timezone });
    const authorized = input.authorization === true && policy.authorizationConfirmed !== false && policy.scopeReviewed !== false && policy.rulesAccepted !== false;
    if (!scope.allowed) return { ok: false, error: scope.reason, code: scope.code, scope, window };
    if (!window.allowed) return { ok: false, error: window.reason, code: window.code, scope, window };
    if (!authorized) return { ok: false, error: "Authorization, scope review, and Rules of Engagement are required.", code: "AUTHORIZATION_REQUIRED", scope, window };
    if (input.action === "evaluate") return { ok: true, allowed: true, target, scope, window, explanation: "Target is authorized and inside the current testing window." };
    const decision = issueScopeDecision({
      assessmentId: input.assessment_id,
      actorId: context.actorId,
      target: target.toString(),
      operationCategory: input.operation_category,
      intensity: input.intensity,
      operationInput: input,
      operationDigestValue: input.operation_digest || undefined,
      policyVersion: "policy-v1",
      authorizationVersion: "authorization-v1",
      expiresAt: Date.now() + 300000,
      integrityTag: `host:${context.operationId}`,
    });
    save(context, decision);
    return { ok: true, decision_id: decision.decision_id, expires_at: decision.expires_at, decision, explanation: "Scope decision issued for this exact operation digest." };
  }
  function resolve(context, decisionId) {
    if (typeof decisionStore?.load === "function") return decisionStore.load(context, decisionId);
    const target = path.join(context.workspace, ".xekute", "scope-decisions.jsonl");
    try { return fs.readFileSync(target, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find((item) => item.decision_id === decisionId) || null; } catch { return null; }
  }
  return Object.freeze({ execute, resolve, validate: validateScopeDecision });
}

module.exports = { createScopePort };
